import { type Menu, type MenuItem, Notice, Plugin, type TAbstractFile } from "obsidian";
import { LilbeeClient } from "./api";
import { BinaryManager, getLatestRelease, checkForUpdate } from "./binary-manager";
import type { ReleaseInfo } from "./binary-manager";
import { ServerManager } from "./server-manager";
import { LilbeeSettingTab } from "./settings";
import { DEFAULT_SETTINGS, NOTICE, SERVER_MODE, SERVER_STATE, SSE_EVENT, SYNC_MODE, TASK_TYPE, type LilbeeSettings, type ServerMode, type ServerState, type SSEEvent, type SyncDone, type VaultAdapter } from "./types";
import { MESSAGES } from "./locales/en";
import { CatalogModal } from "./views/catalog-modal";
import { ChatView, VIEW_TYPE_CHAT } from "./views/chat-view";
import { CrawlModal } from "./views/crawl-modal";
import { DocumentsModal } from "./views/documents-modal";
import { SearchModal } from "./views/search-modal";
import { SetupWizard } from "./views/setup-wizard";
import { TaskCenterView, VIEW_TYPE_TASKS } from "./views/task-center";
import { TaskQueue } from "./task-queue";


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
    binaryManager: BinaryManager | null = null;
    serverManager: ServerManager | null = null;
    syncController: AbortController | null = null;
    private syncTimeout: ReturnType<typeof setTimeout> | null = null;
    private autoSyncRefs: { id: string }[] = [];
    private previousServerMode: ServerMode = SERVER_MODE.MANAGED;
    private startingServer = false;
    private serverStartFailed = false;
    taskQueue: TaskQueue = new TaskQueue();

    async onload(): Promise<void> {
        await this.loadSettings();

        this.statusBarEl = this.addStatusBarItem();
        this.statusBarEl.style.cursor = "pointer";
        this.statusBarEl.addEventListener("click", () => this.activateTaskView());
        this.registerView(VIEW_TYPE_CHAT, (leaf) => new ChatView(leaf, this));
        this.registerView(VIEW_TYPE_TASKS, (leaf) => new TaskCenterView(leaf, this));
        this.addSettingTab(new LilbeeSettingTab(this.app, this));
        this.taskQueue.onChange(() => this.updateStatusBarFromQueue());
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

        if (!this.settings.setupCompleted) {
            new SetupWizard(this.app, this).open();
        }

        if (this.settings.syncMode === SYNC_MODE.AUTO) {
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
                this.updateStatusBar(MESSAGES.STATUS_DOWNLOADING);
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
                    systemPrompt: this.settings.systemPrompt,
                    onStateChange: (state) => this.handleServerStateChange(state),
                    onRestartsExhausted: (stderr: string) => {
                        if (this.serverStartFailed) return;
                        const detail = stderr
                            ? `\n${stderr.split("\n").slice(-5).join("\n")}`
                            : "";
                        new Notice(`${MESSAGES.ERROR_SERVER_CRASHED}${detail}`, 0);
                    },
                });

                this.updateStatusBar(MESSAGES.STATUS_STARTING);
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
                new Notice(MESSAGES.STATUS_READY, 3000);
                break;
            case "starting":
                this.updateStatusBar(MESSAGES.STATUS_STARTING);
                this.setStatusClass("lilbee-status-starting");
                break;
            case "error":
                this.updateStatusBar(MESSAGES.STATUS_ERROR);
                this.setStatusClass(null);
                break;
            case "stopped":
                this.updateStatusBar(MESSAGES.STATUS_STOPPED);
                this.setStatusClass(null);
                break;
        }
    }

    private getPluginDir(): string {
        return `${this.getVaultBasePath()}/.obsidian/plugins/lilbee`;
    }

    private getVaultBasePath(): string {
        const adapter = this.app.vault.adapter as unknown as VaultAdapter;
        return adapter.getBasePath();
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
            id: "lilbee:catalog",
            name: "Browse model catalog",
            callback: () => new CatalogModal(this.app, this).open(),
        });

        this.addCommand({
            id: "lilbee:crawl",
            name: "Crawl web page",
            callback: () => new CrawlModal(this.app, this).open(),
        });

        this.addCommand({
            id: "lilbee:documents",
            name: "Browse documents",
            callback: () => new DocumentsModal(this.app, this).open(),
        });

        this.addCommand({
            id: "lilbee:setup",
            name: "Run setup wizard",
            callback: () => new SetupWizard(this.app, this).open(),
        });

        this.addCommand({
            id: "lilbee:tasks",
            name: "Show task center",
            callback: () => this.activateTaskView(),
        });

        this.addCommand({
            id: "lilbee:status",
            name: "Show status",
            callback: async () => {
                try {
                    const status = await this.api.status();
                    new Notice(
                        MESSAGES.NOTICE_STATUS(status.sources.length, status.total_chunks),
                    );
                } catch {
                    new Notice(MESSAGES.ERROR_COULD_NOT_CONNECT);
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
            "lilbee-status-adding",
        );
        if (cls) this.statusBarEl.classList.add(cls);
    }

    private setStatusReady(): void {
        const suffix = this.settings.serverMode === SERVER_MODE.EXTERNAL ? " [external]" : "";
        this.updateStatusBar(`lilbee: ready${suffix}`);
        this.setStatusClass("lilbee-status-ready");
    }

    private updateStatusBarFromQueue(): void {
        const active = this.taskQueue.active;
        const queued = this.taskQueue.queued;

        if (!active && queued.length === 0) {
            this.setStatusReady();
            return;
        }

        if (active) {
            const suffix = queued.length > 0 ? ` +${queued.length}` : "";
            const pct = active.progress > 0 ? ` ${active.progress}%` : "";
            this.updateStatusBar(`lilbee: ${active.name}${pct}${suffix}`);
            this.setStatusClass("lilbee-status-adding");
        }
    }

    fetchActiveModel(): void {
        this.api.listModels().then((models) => {
            this.activeModel = models.chat.active;
            this.activeVisionModel = models.vision.active;
            this.setStatusReady();
        }).catch(() => {});
    }

    private assertActiveModel(): boolean {
        if (this.activeModel) return true;
        new Notice(NOTICE.NO_CHAT_MODEL);
        return false;
    }

    async addExternalFiles(paths: string[]): Promise<void> {
        if (!this.statusBarEl || paths.length === 0) return;
        if (!this.assertActiveModel()) return;
        const label = paths.length === 1 ? paths[0].split("/").pop() : `${paths.length} files`;
        new Notice(MESSAGES.STATUS_ADDING.replace("{label}", label));
        await this.runAdd(paths);
    }

    async addToLilbee(file: TAbstractFile): Promise<void> {
        if (!this.statusBarEl) return;
        if (!this.assertActiveModel()) return;
        const absolutePath = `${this.getVaultBasePath()}/${file.path}`;
        const name = file.name ?? file.path;
        new Notice(`lilbee: adding ${name}...`);
        await this.runAdd([absolutePath]);
    }

    cancelSync(): void {
        this.syncController?.abort();
        this.syncController = null;
    }

    private async runAdd(paths: string[]): Promise<void> {
        const taskId = this.taskQueue.enqueue("Adding files", TASK_TYPE.ADD);
        this.syncController = new AbortController();

        try {
            let lastEvent: SSEEvent | null = null;
            for await (const event of this.api.addFiles(paths, false, this.activeVisionModel || undefined, this.syncController.signal)) {
                if (event.event === SSE_EVENT.FILE_START) {
                    const d = event.data as { current_file: number; total_files: number };
                    const pct = Math.round((d.current_file / d.total_files) * 100);
                    this.taskQueue.update(taskId, pct, `file ${d.current_file}/${d.total_files}`);
                } else if (event.event === SSE_EVENT.EXTRACT) {
                    const d = event.data as { page: number; total_pages: number; file: string };
                    this.taskQueue.update(taskId, -1, `extracting ${d.file} p${d.page}/${d.total_pages}`);
                } else if (event.event === SSE_EVENT.EMBED) {
                    const d = event.data as { chunk: number; total_chunks: number };
                    this.taskQueue.update(taskId, -1, `embedding chunk ${d.chunk}/${d.total_chunks}`);
                }
                lastEvent = event;
            }

            if (lastEvent?.event === SSE_EVENT.DONE) {
                const summary = summarizeSyncResult(lastEvent.data as SyncDone);
                new Notice(summary ? `lilbee: ${summary}` : "lilbee: nothing new to add");
            }
            this.taskQueue.complete(taskId);
        } catch (err) {
            if (err instanceof Error && err.name === "AbortError") {
                new Notice("lilbee: add cancelled");
                this.taskQueue.cancel(taskId);
            } else {
                console.error("[lilbee] add failed:", err);
                const msg = err instanceof Error ? err.message : "cannot connect to server";
                new Notice(`lilbee: add failed — ${msg}`);
                this.taskQueue.fail(taskId, msg);
            }
        } finally {
            this.syncController = null;
        }
    }

    private updateAutoSync(): void {
        if (this.settings.syncMode === SYNC_MODE.AUTO && this.autoSyncRefs.length === 0) {
            this.registerAutoSync();
        } else if (this.settings.syncMode === SYNC_MODE.MANUAL && this.autoSyncRefs.length > 0) {
            this.unregisterAutoSync();
        }
    }

    private unregisterAutoSync(): void {
        for (const ref of this.autoSyncRefs) {
            this.app.vault.offref(ref as any);
        }
        this.autoSyncRefs = [];
    }

    async activateTaskView(): Promise<void> {
        const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_TASKS);
        if (existing.length > 0) {
            this.app.workspace.revealLeaf(existing[0]);
            return;
        }
        const leaf = this.app.workspace.getRightLeaf(false);
        if (leaf) {
            await leaf.setViewState({ type: VIEW_TYPE_TASKS, active: true });
            this.app.workspace.revealLeaf(leaf);
        }
    }

    async activateChatView(): Promise<void> {
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
        const taskId = this.taskQueue.enqueue("Sync vault", TASK_TYPE.SYNC);
        this.syncController = new AbortController();

        try {
            let lastEvent: SSEEvent | null = null;
            for await (const event of this.api.syncStream(!!this.activeVisionModel, this.syncController.signal)) {
                if (event.event === SSE_EVENT.FILE_START) {
                    const d = event.data as { current_file: number; total_files: number };
                    const pct = Math.round((d.current_file / d.total_files) * 100);
                    this.taskQueue.update(taskId, pct, `syncing ${d.current_file}/${d.total_files}`);
                } else if (event.event === SSE_EVENT.EXTRACT) {
                    const d = event.data as { page: number; total_pages: number; file: string };
                    this.taskQueue.update(taskId, -1, `extracting ${d.file} p${d.page}/${d.total_pages}`);
                } else if (event.event === SSE_EVENT.EMBED) {
                    const d = event.data as { chunk: number; total_chunks: number };
                    this.taskQueue.update(taskId, -1, `embedding chunk ${d.chunk}/${d.total_chunks}`);
                }
                lastEvent = event;
            }

            if (lastEvent?.event === SSE_EVENT.DONE) {
                const summary = summarizeSyncResult(lastEvent.data as SyncDone);
                if (summary) new Notice(`lilbee: synced — ${summary}`);
            }
            this.taskQueue.complete(taskId);
        } catch (err) {
            if (err instanceof Error && err.name === "AbortError") {
                new Notice("lilbee: sync cancelled");
                this.taskQueue.cancel(taskId);
            } else {
                console.error("[lilbee] sync failed:", err);
                new Notice("lilbee: sync failed — cannot connect to server");
                this.taskQueue.fail(taskId, "cannot connect to server");
            }
        } finally {
            this.syncController = null;
        }
    }
}
