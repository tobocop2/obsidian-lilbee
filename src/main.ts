import { type EventRef, type Menu, type MenuItem, Notice, Plugin, type TAbstractFile } from "obsidian";
import { LilbeeClient } from "./api";
import { BinaryManager, getLatestRelease, checkForUpdate } from "./binary-manager";
import type { ReleaseInfo } from "./binary-manager";
import { ServerManager } from "./server-manager";
import { LilbeeSettingTab } from "./settings";
import {
    DEFAULT_SETTINGS,
    ERROR_NAME,
    SERVER_MODE,
    SSE_EVENT,
    SYNC_MODE,
    TASK_TYPE,
    type LilbeeSettings,
    type LintIssue,
    type ServerMode,
    type ServerState,
    type SSEEvent,
    type SyncDone,
    type VaultAdapter,
} from "./types";
import { MESSAGES } from "./locales/en";
import { NOTICE_DURATION_MS, NOTICE_ERROR_DURATION_MS, NOTICE_PERMANENT } from "./utils";
import { CatalogModal } from "./views/catalog-modal";
import { ChatView, VIEW_TYPE_CHAT } from "./views/chat-view";
import { CrawlModal } from "./views/crawl-modal";
import { DocumentsModal } from "./views/documents-modal";
import { SearchModal } from "./views/search-modal";
import { SetupWizard } from "./views/setup-wizard";
import { TaskCenterView, VIEW_TYPE_TASKS } from "./views/task-center";
import { WikiView, VIEW_TYPE_WIKI } from "./views/wiki-view";
import { LintModal } from "./views/lint-modal";
import { ConfirmModal } from "./views/confirm-modal";
import { StatusModal } from "./views/status-modal";
import { TaskQueue } from "./task-queue";
import { WikiSync } from "./wiki-sync";

interface LintProgressData {
    checked: number;
    total: number;
}
interface LintDoneData {
    issues: LintIssue[];
}
interface GenerateErrorData {
    message?: string;
}
interface PruneData {
    archived?: number;
}

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
    private autoSyncRefs: EventRef[] = [];
    private previousServerMode: ServerMode = SERVER_MODE.MANAGED;
    private startingServer = false;
    private serverStartFailed = false;
    taskQueue: TaskQueue = new TaskQueue();
    wikiEnabled = false;
    wikiPageCount = 0;
    wikiDraftCount = 0;
    wikiSync: WikiSync | null = null;

    async onload(): Promise<void> {
        await this.loadSettings();

        this.statusBarEl = this.addStatusBarItem();
        this.statusBarEl.style.cursor = "pointer";
        this.statusBarEl.addEventListener("click", () => this.activateTaskView());
        this.registerView(VIEW_TYPE_CHAT, (leaf) => new ChatView(leaf, this));
        this.registerView(VIEW_TYPE_TASKS, (leaf) => new TaskCenterView(leaf, this));
        this.registerView(VIEW_TYPE_WIKI, (leaf) => new WikiView(leaf, this));
        this.addSettingTab(new LilbeeSettingTab(this.app, this));
        this.taskQueue.onChange(() => this.updateStatusBarFromQueue());
        this.registerCommands();

        this.registerEvent(
            this.app.workspace.on("file-menu", (menu: Menu, file: TAbstractFile) => {
                menu.addItem((item: MenuItem) => {
                    item.setTitle(MESSAGES.COMMAND_ADD_TO_LILBEE)
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
            let downloadNotice: Notice | undefined;
            try {
                binaryPath = await this.binaryManager.ensureBinary((msg, url) => {
                    this.updateStatusBar(`lilbee: ${msg}`);
                    if (!downloadNotice && needsDownload) {
                        const text = url ? `lilbee: ${msg}\n${url}` : `lilbee: ${msg}`;
                        downloadNotice = new Notice(text, NOTICE_PERMANENT);
                    } else if (downloadNotice) {
                        const text = url ? `lilbee: ${msg}\n${url}` : `lilbee: ${msg}`;
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
                } catch {
                    /* version tracking is best-effort */
                }
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
                        const detail = stderr ? `\n${stderr.split("\n").slice(-5).join("\n")}` : "";
                        new Notice(`${MESSAGES.ERROR_SERVER_CRASHED}${detail}`, NOTICE_PERMANENT);
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
        const stderrTail = stderr ? `\n${stderr.split("\n").slice(-5).join("\n")}` : "";
        new Notice(`lilbee: ${label} — ${detail}${stderrTail}`, NOTICE_ERROR_DURATION_MS);
        this.updateStatusBar(MESSAGES.STATUS_ERROR);
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
                new Notice(MESSAGES.STATUS_READY, NOTICE_DURATION_MS);
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
            id: "lilbee:wiki",
            name: MESSAGES.COMMAND_WIKI,
            checkCallback: (checking) => {
                if (!this.wikiEnabled) return false;
                if (!checking) void this.activateWikiView();
                return true;
            },
        });

        this.addCommand({
            id: "lilbee:wiki-lint",
            name: MESSAGES.COMMAND_WIKI_LINT,
            checkCallback: (checking) => {
                if (!this.wikiEnabled) return false;
                if (!checking) void this.runWikiLint();
                return true;
            },
        });

        this.addCommand({
            id: "lilbee:wiki-generate",
            name: MESSAGES.COMMAND_WIKI_GENERATE,
            checkCallback: (checking) => {
                if (!this.wikiEnabled) return false;
                const file = this.app.workspace.getActiveFile();
                if (!file) return false;
                if (!checking) void this.runWikiGenerate(file.path);
                return true;
            },
        });

        this.addCommand({
            id: "lilbee:status",
            name: "Show status",
            callback: () => new StatusModal(this.app, this).open(),
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
        const allActive = this.taskQueue.activeAll;
        const queued = this.taskQueue.queued;

        if (allActive.length === 0 && queued.length === 0) {
            this.setStatusReady();
            return;
        }

        const parts = allActive.map((t) => {
            const pct = t.progress > 0 ? ` ${t.progress}%` : "";
            return `${t.name}${pct}`;
        });
        const suffix = queued.length > 0 ? ` +${queued.length}` : "";
        this.updateStatusBar(`lilbee: ${parts.join(" | ")}${suffix}`);
        this.setStatusClass("lilbee-status-adding");
    }

    async fetchActiveModel(): Promise<void> {
        try {
            const models = await this.api.listModels();
            this.activeModel = models.chat.active;
            this.activeVisionModel = models.vision.active;
            this.setStatusReady();
        } catch {
            // Silently fail - will retry on next action
        }

        // Check wiki feature status
        try {
            const status = await this.api.status();
            if (status.isOk()) {
                this.wikiEnabled = !!status.value.wiki?.enabled;
                this.settings.wikiEnabled = this.wikiEnabled;
                this.wikiPageCount = status.value.wiki?.page_count ?? 0;
                this.wikiDraftCount = status.value.wiki?.draft_count ?? 0;
            }
        } catch {
            // wiki detection is best-effort
        }

        if (this.wikiEnabled && this.settings.wikiSyncToVault) {
            this.initWikiSync();
            void this.reconcileWiki();
        }
    }

    initWikiSync(): void {
        this.wikiSync = new WikiSync(this.api, this.app.vault.adapter, this.settings.wikiVaultFolder);
    }

    async reconcileWiki(): Promise<void> {
        if (!this.wikiSync) return;
        try {
            const result = await this.wikiSync.reconcile();
            if (result.written > 0 || result.removed > 0) {
                new Notice(MESSAGES.NOTICE_WIKI_SYNC(result.written, result.removed), NOTICE_DURATION_MS);
            }
        } catch {
            // reconcile is best-effort
        }
    }

    private assertActiveModel(): boolean {
        if (this.activeModel) return true;
        new Notice(MESSAGES.NOTICE_NO_CHAT_MODEL);
        return false;
    }

    async addExternalFiles(paths: string[]): Promise<void> {
        if (!this.statusBarEl || paths.length === 0) return;
        if (!this.assertActiveModel()) return;
        const label = paths.length === 1 ? paths[0].split("/").pop() || paths[0] : `${paths.length} files`;
        new Notice(MESSAGES.STATUS_ADDING.replace("{label}", label));
        await this.runAdd(paths);
    }

    async addToLilbee(file: TAbstractFile): Promise<void> {
        if (!this.statusBarEl) return;
        if (!this.assertActiveModel()) return;
        const absolutePath = `${this.getVaultBasePath()}/${file.path}`;
        const name = file.name ?? file.path;
        new Notice(MESSAGES.STATUS_ADDING.replace("{label}", name));
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
            for await (const event of this.api.addFiles(
                paths,
                false,
                this.activeVisionModel || undefined,
                this.syncController.signal,
            )) {
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
                new Notice(summary ? MESSAGES.NOTICE_SYNC_SUMMARY(summary) : MESSAGES.STATUS_NOTHING_NEW);
            }
            this.taskQueue.complete(taskId);
        } catch (err) {
            if (err instanceof Error && err.name === ERROR_NAME.ABORT_ERROR) {
                new Notice(MESSAGES.STATUS_ADD_CANCELLED);
                this.taskQueue.cancel(taskId);
            } else {
                console.error("[lilbee] add failed:", err);
                const msg = err instanceof Error ? err.message : "cannot connect to server";
                new Notice(MESSAGES.ERROR_ADD_FAILED_DETAIL(msg));
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
            this.app.vault.offref(ref);
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

    async activateWikiView(): Promise<void> {
        const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_WIKI);
        if (existing.length > 0) {
            this.app.workspace.revealLeaf(existing[0]);
            return;
        }
        const leaf = this.app.workspace.getRightLeaf(false);
        if (leaf) {
            await leaf.setViewState({ type: VIEW_TYPE_WIKI, active: true });
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
        const handler = (file: TAbstractFile) => {
            if (this.wikiSync?.isWikiPath(file.path)) return;
            this.debouncedSync();
        };
        const vault = this.app.vault;
        const refs = [
            vault.on("create", handler),
            vault.on("modify", handler),
            vault.on("delete", handler),
            vault.on("rename", handler),
        ];
        for (const ref of refs) {
            this.autoSyncRefs.push(ref);
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

    async runWikiLint(): Promise<void> {
        const taskId = this.taskQueue.enqueue("Wiki lint", TASK_TYPE.WIKI);
        try {
            const issues: LintIssue[] = [];
            for await (const event of this.api.wikiLint()) {
                if (event.event === SSE_EVENT.WIKI_LINT_PROGRESS) {
                    const d = event.data as LintProgressData;
                    const pct = Math.round((d.checked / d.total) * 100);
                    this.taskQueue.update(taskId, pct, `${d.checked}/${d.total}`);
                } else if (event.event === SSE_EVENT.WIKI_LINT_DONE) {
                    const d = event.data as LintDoneData;
                    issues.push(...d.issues);
                }
            }
            this.taskQueue.complete(taskId);
            new Notice(MESSAGES.NOTICE_WIKI_LINT_DONE(issues.length), NOTICE_DURATION_MS);
            new LintModal(this.app, issues).open();
        } catch (err) {
            const msg = err instanceof Error ? err.message : "unknown error";
            this.taskQueue.fail(taskId, msg);
        }
    }

    async runWikiGenerate(source: string): Promise<void> {
        const taskId = this.taskQueue.enqueue(`Generate wiki: ${source}`, TASK_TYPE.WIKI);
        try {
            for await (const event of this.api.wikiGenerate(source)) {
                if (event.event === SSE_EVENT.WIKI_GENERATE_DONE) {
                    break;
                } else if (event.event === SSE_EVENT.WIKI_GENERATE_ERROR) {
                    const d = event.data as GenerateErrorData;
                    throw new Error(d.message ?? "generation failed");
                }
            }
            this.taskQueue.complete(taskId);
            new Notice(MESSAGES.NOTICE_WIKI_GENERATE_DONE(source), NOTICE_DURATION_MS);
            // Refresh wiki view if open
            for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_WIKI)) {
                (leaf.view as WikiView).refresh();
            }
            // Sync generated page to vault
            if (this.wikiSync) {
                void this.reconcileWiki();
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : "unknown error";
            this.taskQueue.fail(taskId, msg);
        }
    }

    async runWikiPrune(): Promise<void> {
        const modal = new ConfirmModal(this.app, MESSAGES.NOTICE_WIKI_PRUNE_CONFIRM);
        modal.open();
        const confirmed = await modal.result;
        if (!confirmed) return;

        const taskId = this.taskQueue.enqueue("Wiki prune", TASK_TYPE.WIKI);
        try {
            let archived = 0;
            for await (const event of this.api.wikiPrune()) {
                if (event.event === SSE_EVENT.WIKI_PRUNE_DONE) {
                    const d = event.data as PruneData;
                    archived = d.archived ?? 0;
                }
            }
            this.taskQueue.complete(taskId);
            new Notice(MESSAGES.NOTICE_WIKI_PRUNE_DONE(archived), NOTICE_DURATION_MS);
            for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_WIKI)) {
                (leaf.view as WikiView).refresh();
            }
            // Reconcile vault after pruning
            if (this.wikiSync) {
                void this.reconcileWiki();
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : "unknown error";
            this.taskQueue.fail(taskId, msg);
        }
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
                if (summary) new Notice(MESSAGES.STATUS_SYNCED.replace("{summary}", summary));
            }
            this.taskQueue.complete(taskId);
        } catch (err) {
            if (err instanceof Error && err.name === ERROR_NAME.ABORT_ERROR) {
                new Notice(MESSAGES.STATUS_SYNC_CANCELLED);
                this.taskQueue.cancel(taskId);
            } else {
                console.error("[lilbee] sync failed:", err);
                new Notice(MESSAGES.STATUS_SYNC_FAILED);
                this.taskQueue.fail(taskId, "cannot connect to server");
            }
        } finally {
            this.syncController = null;
        }
    }
}
