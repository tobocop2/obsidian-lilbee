import { type Menu, type MenuItem, Notice, Plugin, type TAbstractFile } from "obsidian";
import { LilbeeClient } from "./api";
import { BinaryManager, getLatestRelease, checkForUpdate } from "./binary-manager";
import type { ReleaseInfo } from "./binary-manager";
import { ServerManager } from "./server-manager";
import { LilbeeSettingTab } from "./settings";
import { DEFAULT_SETTINGS, SERVER_MODE, SSE_EVENT, type LilbeeSettings, type ServerMode, type ServerState, type SSEEvent, type SyncDone } from "./types";
import { ChatView, VIEW_TYPE_CHAT } from "./views/chat-view";
import { SearchModal } from "./views/search-modal";


function summarizeSyncResult(done: SyncDone): string {
    const parts: string[] = [];
    if (done.added.length > 0) parts.push(`${done.added.length} added`);
    if (done.updated.length > 0) parts.push(`${done.updated.length} updated`);
    if (done.removed.length > 0) parts.push(`${done.removed.length} removed`);
    if (done.failed.length > 0) parts.push(`${done.failed.length} failed`);
    return parts.join(", ");
}

export default class LilbeePlugin extends Plugin {
    settings: LilbeeSettings = { ...DEFAULT_SETTINGS };
    api: LilbeeClient = new LilbeeClient(DEFAULT_SETTINGS.serverUrl);
    activeModel = "";
    activeVisionModel = "";
    statusBarEl: HTMLElement | null = null;
    onProgress: ((event: SSEEvent) => void) | null = null;
    binaryManager: BinaryManager | null = null;
    serverManager: ServerManager | null = null;
    syncController: AbortController | null = null;
    private syncTimeout: ReturnType<typeof setTimeout> | null = null;
    private autoSyncRefs: { id: string }[] = [];
    private previousServerMode: ServerMode = SERVER_MODE.MANAGED;
    private startingServer = false;
    private serverStartFailed = false;

    async onload(): Promise<void> {
        await this.loadSettings();

        this.statusBarEl = this.addStatusBarItem();
        this.registerView(VIEW_TYPE_CHAT, (leaf) => new ChatView(leaf, this));
        this.addSettingTab(new LilbeeSettingTab(this.app, this));
        this.registerCommands();

        this.registerEvent(
            this.app.workspace.on("file-menu" as any, (menu: Menu, file: TAbstractFile) => {
                menu.addItem((item: MenuItem) => {
                    item.setTitle("Add to lilbee")
                        .setIcon("plus-circle")
                        .onClick(() => this.addToLilbee(file));
                });
            }),
        );

        if (this.settings.serverMode === SERVER_MODE.MANAGED) {
            void this.startManagedServer();
        } else {
            this.api = new LilbeeClient(this.settings.serverUrl);
            this.setStatusReady();
            this.fetchActiveModel();
        }

        if (this.settings.syncMode === "auto") {
            this.registerAutoSync();
        }
    }

    async startManagedServer(): Promise<void> {
        if (this.startingServer) return;
        this.startingServer = true;
        this.serverStartFailed = false;

        try {
            const pluginDir = this.getPluginDir();
            this.binaryManager = new BinaryManager(pluginDir);

            const needsDownload = !this.binaryManager.binaryExists();
            if (needsDownload) {
                this.updateStatusBar("lilbee: downloading...");
                this.setStatusClass("lilbee-status-downloading");
            }

            let binaryPath: string;
            let downloadNotice: Notice | null = null;
            try {
                binaryPath = await this.binaryManager.ensureBinary((msg, url) => {
                    this.updateStatusBar(`lilbee: ${msg}`);
                    if (!downloadNotice && needsDownload) {
                        const text = url
                            ? `lilbee: ${msg}\n${url}`
                            : `lilbee: ${msg}`;
                        downloadNotice = new Notice(text, 0);
                    } else if (downloadNotice) {
                        const text = url
                            ? `lilbee: ${msg}\n${url}`
                            : `lilbee: ${msg}`;
                        downloadNotice.setMessage(text);
                    }
                });
                downloadNotice?.hide();
            } catch (err) {
                downloadNotice?.hide();
                this.showError("failed to download server", err);
                return;
            } finally {
                this.setStatusClass(null);
            }

            if (needsDownload && !this.settings.lilbeeVersion) {
                try {
                    const release = await getLatestRelease();
                    this.settings.lilbeeVersion = release.tag;
                    await this.saveData(this.settings);
                } catch { /* version tracking is best-effort */ }
            }

            try {
                this.serverManager = new ServerManager({
                    binaryPath,
                    dataDir: `${pluginDir}/server-data`,
                    port: this.settings.serverPort,
                    ollamaUrl: this.settings.ollamaUrl,
                    systemPrompt: this.settings.systemPrompt,
                    onStateChange: (state) => this.handleServerStateChange(state),
                    onRestartsExhausted: (stderr: string) => {
                        if (this.serverStartFailed) return;
                        const detail = stderr
                            ? `\n${stderr.split("\n").slice(-5).join("\n")}`
                            : "";
                        new Notice(`lilbee: server crashed after multiple restarts${detail}`, 0);
                    },
                });

                this.updateStatusBar("lilbee: starting...");
                this.setStatusClass("lilbee-status-starting");
                await this.serverManager.start();
                this.api = new LilbeeClient(this.serverManager.serverUrl);
                this.fetchActiveModel();
            } catch (err) {
                this.showError("failed to start server", err);
            }
        } finally {
            this.startingServer = false;
        }
    }

    async checkForUpdate(): Promise<{ available: boolean; release?: ReleaseInfo }> {
        const release = await getLatestRelease();
        if (checkForUpdate(this.settings.lilbeeVersion, release.tag)) {
            return { available: true, release };
        }
        return { available: false };
    }

    async updateServer(release: ReleaseInfo, onProgress?: (msg: string) => void): Promise<void> {
        const pluginDir = this.getPluginDir();
        if (!this.binaryManager) {
            this.binaryManager = new BinaryManager(pluginDir);
        }

        // Stop the running server first
        if (this.serverManager) {
            onProgress?.("Stopping server...");
            await this.serverManager.stop();
            this.serverManager = null;
        }

        // Download the new binary (overwrites the old one)
        onProgress?.("Downloading...");
        await this.binaryManager.download(release.assetUrl, onProgress);

        // Save the new version
        this.settings.lilbeeVersion = release.tag;
        await this.saveData(this.settings);

        // Restart if in managed mode
        if (this.settings.serverMode === SERVER_MODE.MANAGED) {
            onProgress?.("Starting server...");
            await this.startManagedServer();
        }

        onProgress?.("Update complete.");
    }

    private showError(label: string, err: unknown): void {
        console.error(`[lilbee] ${label}:`, err);
        const stderr = this.serverManager?.lastStderr;
        if (stderr) console.error(`[lilbee] server stderr:\n${stderr}`);
        const detail = err instanceof Error ? err.message : String(err);
        const stderrTail = stderr
            ? `\n${stderr.split("\n").slice(-5).join("\n")}`
            : "";
        new Notice(`lilbee: ${label} — ${detail}${stderrTail}`, 8000);
        this.updateStatusBar("lilbee: error");
        this.setStatusClass(null);
        this.serverStartFailed = true;
    }

    private handleServerStateChange(state: ServerState): void {
        switch (state) {
            case "ready":
                if (this.serverManager) {
                    this.api = new LilbeeClient(this.serverManager.serverUrl);
                }
                this.setStatusReady();
                new Notice("lilbee: server ready", 3000);
                break;
            case "starting":
                this.updateStatusBar("lilbee: starting...");
                this.setStatusClass("lilbee-status-starting");
                break;
            case "error":
                this.updateStatusBar("lilbee: error");
                this.setStatusClass(null);
                break;
            case "stopped":
                this.updateStatusBar("lilbee: stopped");
                this.setStatusClass(null);
                break;
        }
    }

    private getPluginDir(): string {
        const adapter = this.app.vault.adapter as unknown as { getBasePath(): string };
        return `${adapter.getBasePath()}/.obsidian/plugins/lilbee`;
    }

    private registerCommands(): void {
        this.addCommand({
            id: "lilbee:search",
            name: "Search knowledge base",
            callback: () => new SearchModal(this.app, this).open(),
        });

        this.addCommand({
            id: "lilbee:ask",
            name: "Ask a question",
            callback: () => new SearchModal(this.app, this, "ask").open(),
        });

        this.addCommand({
            id: "lilbee:chat",
            name: "Open chat",
            callback: () => this.activateChatView(),
        });

        this.addCommand({
            id: "lilbee:add-file",
            name: "Add current file to lilbee",
            checkCallback: (checking) => {
                const file = this.app.workspace.getActiveFile();
                if (!file) return false;
                if (!checking) void this.addToLilbee(file);
                return true;
            },
        });

        this.addCommand({
            id: "lilbee:add-folder",
            name: "Add current folder to lilbee",
            checkCallback: (checking) => {
                const file = this.app.workspace.getActiveFile();
                const folder = file?.parent;
                if (!folder) return false;
                if (!checking) void this.addToLilbee(folder);
                return true;
            },
        });

        this.addCommand({
            id: "lilbee:sync",
            name: "Sync vault",
            callback: () => this.triggerSync(),
        });

        this.addCommand({
            id: "lilbee:status",
            name: "Show status",
            callback: async () => {
                try {
                    const status = await this.api.status();
                    new Notice(
                        `lilbee: ${status.sources.length} documents, ${status.total_chunks} chunks`,
                    );
                } catch {
                    new Notice("lilbee: cannot connect to server");
                }
            },
        });
    }

    onunload(): void {
        if (this.syncTimeout) {
            clearTimeout(this.syncTimeout);
        }
        void this.serverManager?.stop();
    }

    async loadSettings(): Promise<void> {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
        this.previousServerMode = this.settings.serverMode;
    }

    async saveSettings(): Promise<void> {
        const previousMode = this.previousServerMode;
        this.previousServerMode = this.settings.serverMode;
        await this.saveData(this.settings);

        if (this.settings.serverMode === SERVER_MODE.MANAGED) {
            if (previousMode !== SERVER_MODE.MANAGED) {
                void this.startManagedServer();
            } else if (this.serverManager) {
                this.serverManager.updateOllamaUrl(this.settings.ollamaUrl);
                this.serverManager.updatePort(this.settings.serverPort);
                this.api = new LilbeeClient(this.serverManager.serverUrl);
            }
        } else {
            if (previousMode === SERVER_MODE.MANAGED) {
                void this.serverManager?.stop();
                this.serverManager = null;
                this.binaryManager = null;
            }
            this.api = new LilbeeClient(this.settings.serverUrl);
        }

        this.updateAutoSync();
    }

    private updateStatusBar(text: string): void {
        if (!this.statusBarEl) return;
        const model = this.activeModel ? ` (${this.activeModel})` : "";
        this.statusBarEl.setText(`${text}${model}`);
    }

    private setStatusClass(cls: string | null): void {
        if (!this.statusBarEl) return;
        this.statusBarEl.classList.remove(
            "lilbee-status-downloading",
            "lilbee-status-starting",
            "lilbee-status-ready",
        );
        if (cls) this.statusBarEl.classList.add(cls);
    }

    private setStatusReady(): void {
        const suffix = this.settings.serverMode === SERVER_MODE.EXTERNAL ? " [external]" : "";
        this.updateStatusBar(`lilbee: ready${suffix}`);
        this.setStatusClass("lilbee-status-ready");
    }

    fetchActiveModel(): void {
        this.api.listModels().then((models) => {
            this.activeModel = models.chat.active;
            this.activeVisionModel = models.vision.active;
            this.setStatusReady();
        }).catch(() => {});
    }

    async addExternalFiles(paths: string[]): Promise<void> {
        if (!this.statusBarEl || paths.length === 0) return;
        const label = paths.length === 1 ? paths[0].split("/").pop() : `${paths.length} files`;
        new Notice(`lilbee: adding ${label}...`);
        await this.runAdd(paths);
    }

    async addToLilbee(file: TAbstractFile): Promise<void> {
        if (!this.statusBarEl) return;
        const adapter = this.app.vault.adapter as unknown as { getBasePath(): string };
        const absolutePath = `${adapter.getBasePath()}/${file.path}`;
        new Notice(`lilbee: adding ${file.name ?? file.path}...`);
        await this.runAdd([absolutePath]);
    }

    private emitProgress(event: SSEEvent): void {
        if (this.onProgress) this.onProgress(event);
    }

    cancelSync(): void {
        this.syncController?.abort();
        this.syncController = null;
    }

    private async runAdd(paths: string[]): Promise<void> {
        this.updateStatusBar("lilbee: adding...");
        this.syncController = new AbortController();

        try {
            let lastEvent: SSEEvent | null = null;
            for await (const event of this.api.addFiles(paths, false, this.activeVisionModel || undefined, this.syncController.signal)) {
                this.emitProgress(event);
                if (event.event === SSE_EVENT.FILE_START) {
                    const d = event.data as { current_file: number; total_files: number };
                    this.updateStatusBar(`lilbee: adding ${d.current_file}/${d.total_files}`);
                }
                lastEvent = event;
            }

            if (lastEvent?.event === SSE_EVENT.DONE) {
                this.emitProgress(lastEvent);
                const summary = summarizeSyncResult(lastEvent.data as SyncDone);
                new Notice(summary ? `lilbee: ${summary}` : "lilbee: nothing new to add");
            }
        } catch (err) {
            if (err instanceof Error && err.name === "AbortError") {
                new Notice("lilbee: add cancelled");
            } else {
                console.error("[lilbee] add failed:", err);
                const msg = err instanceof Error ? err.message : "cannot connect to server";
                new Notice(`lilbee: add failed — ${msg}`);
            }
        } finally {
            this.syncController = null;
            this.setStatusReady();
            this.emitProgress({ event: SSE_EVENT.DONE, data: null });
        }
    }

    private updateAutoSync(): void {
        if (this.settings.syncMode === "auto" && this.autoSyncRefs.length === 0) {
            this.registerAutoSync();
        } else if (this.settings.syncMode === "manual" && this.autoSyncRefs.length > 0) {
            this.unregisterAutoSync();
        }
    }

    private unregisterAutoSync(): void {
        for (const ref of this.autoSyncRefs) {
            this.app.vault.offref(ref as any);
        }
        this.autoSyncRefs = [];
    }

    private async activateChatView(): Promise<void> {
        const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_CHAT);
        if (existing.length > 0) {
            this.app.workspace.revealLeaf(existing[0]);
            return;
        }
        const leaf = this.app.workspace.getRightLeaf(false);
        if (leaf) {
            await leaf.setViewState({ type: VIEW_TYPE_CHAT, active: true });
            this.app.workspace.revealLeaf(leaf);
        }
    }

    private registerAutoSync(): void {
        const handler = () => this.debouncedSync();
        const vault = this.app.vault;
        const refs = [
            vault.on("create", handler),
            vault.on("modify", handler),
            vault.on("delete", handler),
            vault.on("rename", handler),
        ];
        for (const ref of refs) {
            this.autoSyncRefs.push(ref as { id: string });
            this.registerEvent(ref);
        }
    }

    private debouncedSync(): void {
        if (this.syncTimeout) {
            clearTimeout(this.syncTimeout);
        }
        this.syncTimeout = setTimeout(() => {
            this.triggerSync();
        }, this.settings.syncDebounceMs);
    }

    async triggerSync(): Promise<void> {
        if (!this.statusBarEl) return;
        this.updateStatusBar("lilbee: syncing...");
        this.syncController = new AbortController();

        try {
            let lastEvent: SSEEvent | null = null;
            for await (const event of this.api.syncStream(!!this.activeVisionModel, this.syncController.signal)) {
                this.emitProgress(event);
                if (event.event === SSE_EVENT.FILE_START) {
                    const d = event.data as { current_file: number; total_files: number };
                    this.updateStatusBar(`lilbee: syncing ${d.current_file}/${d.total_files}`);
                }
                lastEvent = event;
            }

            if (lastEvent?.event === SSE_EVENT.DONE) {
                this.emitProgress(lastEvent);
                const summary = summarizeSyncResult(lastEvent.data as SyncDone);
                if (summary) new Notice(`lilbee: synced — ${summary}`);
            }
        } catch (err) {
            if (err instanceof Error && err.name === "AbortError") {
                new Notice("lilbee: sync cancelled");
            } else {
                console.error("[lilbee] sync failed:", err);
                new Notice("lilbee: sync failed — cannot connect to server");
            }
        } finally {
            this.syncController = null;
            this.setStatusReady();
            this.emitProgress({ event: SSE_EVENT.DONE, data: null });
        }
    }
}
