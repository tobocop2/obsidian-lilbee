import { type Menu, type MenuItem, Notice, Plugin, type TAbstractFile } from "obsidian";
import { LilbeeClient, OllamaClient } from "./api";
import { BinaryManager } from "./binary-manager";
import { ServerManager } from "./server-manager";
import { LilbeeSettingTab } from "./settings";
import { DEFAULT_SETTINGS, SSE_EVENT, type LilbeeSettings, type ServerState, type SSEEvent, type SyncDone } from "./types";
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
    ollama: OllamaClient = new OllamaClient(DEFAULT_SETTINGS.ollamaUrl);
    activeModel = "";
    activeVisionModel = "";
    statusBarEl: HTMLElement | null = null;
    onProgress: ((event: SSEEvent) => void) | null = null;
    binaryManager: BinaryManager | null = null;
    serverManager: ServerManager | null = null;
    syncController: AbortController | null = null;
    private syncTimeout: ReturnType<typeof setTimeout> | null = null;
    private autoSyncRefs: { id: string }[] = [];
    private previousServerMode: "managed" | "external" = "managed";

    async onload(): Promise<void> {
        await this.loadSettings();
        this.ollama = new OllamaClient(this.settings.ollamaUrl);

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

        if (this.settings.serverMode === "managed") {
            await this.startManagedServer();
        } else {
            this.api = new LilbeeClient(this.settings.serverUrl);
            this.setStatusReady();
            this.fetchActiveModel();
        }

        if (this.settings.syncMode === "auto") {
            this.registerAutoSync();
        }
    }

    private async startManagedServer(): Promise<void> {
        const pluginDir = this.getPluginDir();
        this.binaryManager = new BinaryManager(pluginDir);
        this.updateStatusBar("lilbee: downloading...");

        try {
            const binaryPath = await this.binaryManager.ensureBinary((msg) => {
                this.updateStatusBar(`lilbee: ${msg}`);
            });

            const dataDir = `${pluginDir}/server-data`;
            this.serverManager = new ServerManager({
                binaryPath,
                dataDir,
                port: this.settings.serverPort,
                ollamaUrl: this.settings.ollamaUrl,
                onStateChange: (state) => this.handleServerStateChange(state),
            });

            this.updateStatusBar("lilbee: starting...");
            await this.serverManager.start();
            this.api = new LilbeeClient(this.serverManager.serverUrl);
            this.fetchActiveModel();
        } catch (err) {
            const msg = err instanceof Error ? err.message : "unknown error";
            new Notice(`lilbee: failed to start server — ${msg}`);
            this.updateStatusBar("lilbee: error");
        }
    }

    private handleServerStateChange(state: ServerState): void {
        switch (state) {
            case "ready":
                this.setStatusReady();
                break;
            case "starting":
                this.updateStatusBar("lilbee: starting...");
                break;
            case "error":
                this.updateStatusBar("lilbee: error");
                break;
            case "stopped":
                this.updateStatusBar("lilbee: stopped");
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

        if (this.settings.serverMode === "managed") {
            if (previousMode !== "managed") {
                void this.startManagedServer();
            } else if (this.serverManager) {
                this.serverManager.updateOllamaUrl(this.settings.ollamaUrl);
                this.serverManager.updatePort(this.settings.serverPort);
                this.api = new LilbeeClient(this.serverManager.serverUrl);
            }
        } else {
            if (previousMode === "managed") {
                void this.serverManager?.stop();
                this.serverManager = null;
                this.binaryManager = null;
            }
            this.api = new LilbeeClient(this.settings.serverUrl);
        }

        this.ollama = new OllamaClient(this.settings.ollamaUrl);
        this.updateAutoSync();
    }

    private updateStatusBar(text: string): void {
        if (!this.statusBarEl) return;
        const model = this.activeModel ? ` (${this.activeModel})` : "";
        this.statusBarEl.setText(`${text}${model}`);
    }

    private setStatusReady(): void {
        this.updateStatusBar("lilbee: ready");
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
                const msg = err instanceof Error ? err.message : "cannot connect to server";
                new Notice(`lilbee: add failed — ${msg}`);
            }
        } finally {
            this.syncController = null;
            this.setStatusReady();
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
                new Notice("lilbee: sync failed — cannot connect to server");
            }
        } finally {
            this.syncController = null;
            this.setStatusReady();
        }
    }
}
