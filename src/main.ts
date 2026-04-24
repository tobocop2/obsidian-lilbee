import { type EventRef, type Menu, type MenuItem, Notice, Plugin, type TAbstractFile } from "obsidian";
import { LilbeeClient, SessionTokenError } from "./api";
import { BinaryManager, getLatestRelease, checkForUpdate, node } from "./binary-manager";
import type { ReleaseInfo } from "./binary-manager";
import { ServerManager } from "./server-manager";
import { readSessionToken, resolveExternalDataRoot } from "./session-token";
import { LilbeeSettingTab } from "./settings";
import {
    DEFAULT_SETTINGS,
    DOT_STATE,
    ERROR_NAME,
    SERVER_MODE,
    SERVER_STATE,
    SSE_EVENT,
    SYNC_MODE,
    TASK_STATUS,
    TASK_TYPE,
    type DotState,
    type LilbeeSettings,
    type ServerMode,
    type ServerState,
    type SetupDonePayload,
    type SetupProgressPayload,
    type SetupStartPayload,
    type SyncDone,
    type TaskEntry,
    type VaultAdapter,
} from "./types";
import { MESSAGES } from "./locales/en";
import {
    errorMessage,
    extractSseErrorMessage,
    HEALTH_PROBE_INTERVAL_MS,
    NOTICE_DURATION_MS,
    NOTICE_ERROR_DURATION_MS,
    NOTICE_PERMANENT,
    STREAM_IDLE_TIMEOUT_MS,
    StreamIdleError,
    withIdleTimeout,
} from "./utils";
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
import { TaskQueue, FLASH_WINDOW_MS as TASK_FLASH_WINDOW_MS } from "./task-queue";
import { WikiSync } from "./wiki-sync";

interface GenerateErrorData {
    message?: string;
}
interface PruneData {
    archived?: number;
}

const BYTES_PER_MB = 1_000_000;

function formatSetupDetail(downloaded: number, total: number | null): string {
    const dlMB = (downloaded / BYTES_PER_MB).toFixed(1);
    if (total === null) {
        return MESSAGES.STATUS_TASK_SETUP_PROGRESS_INDETERMINATE.replace("{downloaded}", dlMB);
    }
    const totalMB = (total / BYTES_PER_MB).toFixed(1);
    return MESSAGES.STATUS_TASK_SETUP_PROGRESS.replace("{downloaded}", dlMB).replace("{total}", totalMB);
}

function summarizeSyncResult(done: SyncDone): string {
    const parts: string[] = [];
    if (done.added.length > 0) parts.push(`${done.added.length} added`);
    if (done.updated.length > 0) parts.push(`${done.updated.length} updated`);
    if (done.removed.length > 0) parts.push(`${done.removed.length} removed`);
    if (done.failed.length > 0) parts.push(`${done.failed.length} failed`);
    return parts.join(", ");
}

function countRecentByStatus(completed: readonly TaskEntry[], status: TaskEntry["status"]): number {
    const now = Date.now();
    return completed.filter(
        (t) => t.status === status && t.completedAt !== null && now - t.completedAt < TASK_FLASH_WINDOW_MS,
    ).length;
}

/**
 * Progress phases emitted by {@link LilbeePlugin.startManagedServer} to any
 * observer that passes an ``onProgress`` handler — currently the setup wizard,
 * which wants to show binary-download and server-startup state inline while
 * the user waits on the Server step.
 */
export type ManagedServerProgressPhase = "downloading" | "starting" | "ready" | "error";
export type ManagedServerProgress = {
    phase: ManagedServerProgressPhase;
    message: string;
    url?: string;
};
export type ManagedServerProgressHandler = (event: ManagedServerProgress) => void;

/**
 * Tracks combined file-level + intra-file progress for sync/add streams.
 *
 * Server emits FILE_START per file with `current_file/total_files`, plus
 * EXTRACT (pages within a file) and EMBED (chunks within a file). We split
 * each file's work budget 50/50 between extract and embed so the bar advances
 * smoothly instead of snapping to file boundaries.
 */
export class FileProgressTracker {
    private totalFiles = 1;
    private currentFile = 0;
    private extractFraction = 0;
    private embedFraction = 0;

    startFile(current: number, total: number): void {
        this.currentFile = current;
        this.totalFiles = Math.max(1, total);
        this.extractFraction = 0;
        this.embedFraction = 0;
    }

    setExtractFraction(page: number, totalPages: number): void {
        if (totalPages <= 0) return;
        this.extractFraction = Math.max(0, Math.min(1, page / totalPages));
    }

    setEmbedFraction(chunk: number, totalChunks: number): void {
        if (totalChunks <= 0) return;
        this.embedFraction = Math.max(0, Math.min(1, chunk / totalChunks));
    }

    percent(): number {
        const intra = this.extractFraction * 0.5 + this.embedFraction * 0.5;
        const filesDone = Math.max(0, this.currentFile - 1);
        const pct = ((filesDone + intra) / this.totalFiles) * 100;
        return Math.max(0, Math.min(100, Math.round(pct)));
    }
}

/**
 * Parse the `done` event emitted by `/api/add`. The payload contains
 * `{copied, skipped, errors, sync: SyncDone}`. Extract the nested
 * sync result; fall back to treating the whole object as SyncDone
 * for backwards compatibility.
 */
export function parseAddDoneEvent(data: unknown): SyncDone | null {
    if (!data || typeof data !== "object") return null;
    const obj = data as Record<string, unknown>;
    if (obj.sync && typeof obj.sync === "object") {
        return coerceSyncDone(obj.sync as Record<string, unknown>);
    }
    return coerceSyncDone(obj);
}

function coerceSyncDone(obj: Record<string, unknown>): SyncDone | null {
    if (!Array.isArray(obj.added) || !Array.isArray(obj.updated)) return null;
    return {
        added: obj.added as string[],
        updated: obj.updated as string[],
        removed: Array.isArray(obj.removed) ? (obj.removed as string[]) : [],
        unchanged: typeof obj.unchanged === "number" ? obj.unchanged : 0,
        failed: Array.isArray(obj.failed) ? (obj.failed as string[]) : [],
    };
}

export default class LilbeePlugin extends Plugin {
    settings: LilbeeSettings = { ...DEFAULT_SETTINGS };
    api: LilbeeClient = new LilbeeClient(DEFAULT_SETTINGS.serverUrl);
    activeModel = "";
    statusBarEl: HTMLElement | null = null;
    ribbonIconEl: HTMLElement | null = null;
    binaryManager: BinaryManager | null = null;
    serverManager: ServerManager | null = null;
    syncController: AbortController | null = null;
    private syncTimeout: ReturnType<typeof setTimeout> | null = null;
    private autoSyncRefs: EventRef[] = [];
    private previousServerMode: ServerMode = SERVER_MODE.MANAGED;
    private startingServer = false;
    private serverStartFailed = false;
    taskQueue: TaskQueue = new TaskQueue();
    /** Paths whose most-recent add failed — retry skips the reindex confirm. */
    private failedAddPaths = new Set<string>();
    wikiEnabled = false;
    wikiPageCount = 0;
    wikiDraftCount = 0;
    wikiSync: WikiSync | null = null;
    private healthProbeHandle: number | null = null;
    private serverUnreachable = false;

    async onload(): Promise<void> {
        await this.loadSettings();
        this.wikiEnabled = this.settings.wikiEnabled;

        this.statusBarEl = this.addStatusBarItem();
        this.statusBarEl.style.cursor = "pointer";
        this.statusBarEl.setAttribute("aria-label", MESSAGES.LABEL_STATUSBAR_OPEN_SETTINGS);
        this.statusBarEl.addEventListener("click", () => this.openPluginSettings());
        this.ribbonIconEl = this.addRibbonIcon("list-checks", MESSAGES.LABEL_RIBBON_OPEN_TASK_CENTER, () =>
            this.activateTaskView(),
        );
        this.ribbonIconEl.addClass("lilbee-ribbon-icon");
        this.registerView(VIEW_TYPE_CHAT, (leaf) => new ChatView(leaf, this));
        this.registerView(VIEW_TYPE_TASKS, (leaf) => new TaskCenterView(leaf, this));
        this.registerView(VIEW_TYPE_WIKI, (leaf) => new WikiView(leaf, this));
        this.addSettingTab(new LilbeeSettingTab(this.app, this));
        this.taskQueue.onChange(() => this.updateStatusBarFromQueue());
        this.taskQueue.onChange(() => this.updateRibbonFromQueue());
        this.taskQueue.onChange(() => this.schedulePersistHistory());
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

        // On first-ever load (setupCompleted === false), defer server start
        // to the wizard's Server step. Otherwise users see the binary download
        // fire before they've even picked managed vs. external, and the
        // wizard arrives at the Model step against a server that isn't
        // actually ready yet (empty catalog, failed reads).
        if (this.settings.setupCompleted) {
            if (this.settings.serverMode === SERVER_MODE.MANAGED) {
                void this.startManagedServer();
            } else {
                this.api = new LilbeeClient(this.settings.serverUrl);
                this.api.setTokenProvider(() => this.readCurrentToken());
                this.api.setToken(this.readCurrentToken());
                this.setStatusReady();
                this.fetchActiveModel();
            }
        }

        if (!this.settings.setupCompleted) {
            new SetupWizard(this.app, this).open();
        }

        if (this.settings.syncMode === SYNC_MODE.AUTO) {
            this.registerAutoSync();
        }

        this.startHealthProbe();
    }

    async startManagedServer(onProgress?: ManagedServerProgressHandler): Promise<void> {
        if (this.startingServer) return;
        this.startingServer = true;
        this.serverStartFailed = false;

        try {
            const pluginDir = this.getPluginDir();
            this.binaryManager = new BinaryManager(pluginDir);

            const needsDownload = !this.binaryManager.binaryExists();
            if (needsDownload) {
                this.updateStatusBar(MESSAGES.STATUS_DOWNLOADING, DOT_STATE.PRIMARY);
                this.setStatusClass("lilbee-status-downloading");
                onProgress?.({ phase: "downloading", message: MESSAGES.STATUS_DOWNLOADING });
            }

            let binaryPath: string;
            let downloadNotice: Notice | undefined;
            try {
                binaryPath = await this.binaryManager.ensureBinary((msg, url) => {
                    this.updateStatusBar(`lilbee: ${msg}`, DOT_STATE.PRIMARY);
                    onProgress?.({ phase: "downloading", message: msg, url });
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
                onProgress?.({ phase: "error", message: errorMessage(err, String(err)) });
                return;
            } finally {
                this.setStatusClass(null);
            }

            if (needsDownload && !this.settings.lilbeeVersion) {
                try {
                    const release = await getLatestRelease();
                    this.settings.lilbeeVersion = release.tag;
                    await this.persistAll();
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

                this.updateStatusBar(MESSAGES.STATUS_STARTING, DOT_STATE.PRIMARY);
                this.setStatusClass("lilbee-status-starting");
                onProgress?.({ phase: "starting", message: MESSAGES.STATUS_STARTING_SERVER });
                await this.serverManager.start();
                this.api = new LilbeeClient(this.serverManager.serverUrl);
                this.api.setTokenProvider(() => this.readCurrentToken());
                this.api.setToken(this.readCurrentToken());
                this.fetchActiveModel();
                void this.configureManagedStorage();
                onProgress?.({ phase: "ready", message: "" });
            } catch (err) {
                this.showError("failed to start server", err);
                onProgress?.({ phase: "error", message: errorMessage(err, String(err)) });
            }
        } finally {
            this.startingServer = false;
        }
    }

    /**
     * Tell the managed server to store content under the vault.
     *
     * PATCHes ``documents_dir`` to ``<vault>/lilbee`` and ``vault_base`` to the
     * vault root. Server performs a locked relocation if paths changed, then
     * stamps ``vault_path`` on every Source response so chat-chip clicks can
     * deep-link into the local editor. No-op when the toggle is off, the
     * server is external, or the current values already match.
     */
    async configureManagedStorage(): Promise<void> {
        if (this.settings.serverMode !== SERVER_MODE.MANAGED) return;
        if (!this.settings.storeContentInVault) return;

        const vaultBase = this.getVaultBasePath();
        const desiredDocsDir = `${vaultBase}/lilbee`;

        let current: Record<string, unknown>;
        try {
            current = await this.api.config();
        } catch (err) {
            console.error("[lilbee] could not read server config for vault setup", err);
            return;
        }

        const currentDocs = typeof current.documents_dir === "string" ? current.documents_dir : "";
        const currentVault = typeof current.vault_base === "string" ? current.vault_base : null;
        if (currentDocs === desiredDocsDir && currentVault === vaultBase) {
            return;
        }

        const notice = new Notice(MESSAGES.NOTICE_STORAGE_REORGANIZING, NOTICE_PERMANENT);
        try {
            await this.api.updateConfig({
                documents_dir: desiredDocsDir,
                vault_base: vaultBase,
            });
            notice.hide();
            new Notice(MESSAGES.NOTICE_STORAGE_REORGANIZED);
        } catch (err) {
            notice.hide();
            const detail = errorMessage(err, String(err));
            new Notice(`${MESSAGES.NOTICE_STORAGE_REORGANIZE_FAILED}${detail}`, NOTICE_ERROR_DURATION_MS);
            console.error("[lilbee] storage reorganisation failed", err);
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
        await this.persistAll();

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
        const detail = errorMessage(err, String(err));
        const stderrTail = stderr ? `\n${stderr.split("\n").slice(-5).join("\n")}` : "";
        new Notice(`lilbee: ${label} — ${detail}${stderrTail}`, NOTICE_ERROR_DURATION_MS);
        this.updateStatusBar(MESSAGES.STATUS_ERROR, DOT_STATE.ERROR);
        this.setStatusClass(null);
        this.serverStartFailed = true;
    }

    private handleServerStateChange(state: ServerState): void {
        switch (state) {
            case SERVER_STATE.READY:
                if (this.serverManager) {
                    this.api = new LilbeeClient(this.serverManager.serverUrl);
                    this.api.setTokenProvider(() => this.readCurrentToken());
                    this.api.setToken(this.readCurrentToken());
                }
                this.serverUnreachable = false;
                this.setStatusReady();
                new Notice(MESSAGES.STATUS_READY, NOTICE_DURATION_MS);
                break;
            case SERVER_STATE.STARTING:
                this.updateStatusBar(MESSAGES.STATUS_STARTING, DOT_STATE.PRIMARY);
                this.setStatusClass("lilbee-status-starting");
                break;
            case SERVER_STATE.ERROR:
                this.updateStatusBar(MESSAGES.STATUS_ERROR, DOT_STATE.ERROR);
                this.setStatusClass("lilbee-status-error");
                break;
            case SERVER_STATE.STOPPED:
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

    /**
     * Read the lilbee session token.
     *
     * Managed mode: reads from the plugin-owned server-data directory.
     * External mode: auto-discovers the user's data root the same way lilbee
     * itself does (LILBEE_DATA env > .lilbee walk-up > platform default).
     */
    private readCurrentToken(): string | null {
        if (this.settings.manualToken) {
            return this.settings.manualToken;
        }
        if (this.settings.serverMode === SERVER_MODE.MANAGED) {
            return this.serverManager ? readSessionToken(this.serverManager.dataDir) : null;
        }
        const dataRoot = resolveExternalDataRoot(this.getVaultBasePath());
        return readSessionToken(dataRoot);
    }

    private registerCommands(): void {
        this.addCommand({
            id: "lilbee:search",
            name: "Search knowledge base",
            callback: () => new SearchModal(this.app, this).open(),
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
        this.taskQueue.dispose();
        void this.serverManager?.stop();
    }

    async loadSettings(): Promise<void> {
        const blob = (await this.loadData()) as (LilbeeSettings & { taskHistory?: { history?: unknown[] } }) | null;
        this.settings = Object.assign({}, DEFAULT_SETTINGS, blob ?? {});
        this.previousServerMode = this.settings.serverMode;
        this.taskQueue.loadFromJSON(blob?.taskHistory as { history?: import("./types").TaskEntry[] } | undefined);
    }

    private async persistAll(): Promise<void> {
        await this.saveData({ ...this.settings, taskHistory: this.taskQueue.toJSON() });
    }

    private schedulePersistHistory(): void {
        void this.persistAll();
    }

    async saveSettings(): Promise<void> {
        const previousMode = this.previousServerMode;
        this.previousServerMode = this.settings.serverMode;
        await this.persistAll();

        if (this.settings.serverMode === SERVER_MODE.MANAGED) {
            if (previousMode !== SERVER_MODE.MANAGED) {
                void this.startManagedServer();
            } else if (this.serverManager) {
                this.serverManager.updatePort(this.settings.serverPort);
                this.api = new LilbeeClient(this.serverManager.serverUrl);
                this.api.setTokenProvider(() => this.readCurrentToken());
                this.api.setToken(this.readCurrentToken());
            }
        } else {
            if (previousMode === SERVER_MODE.MANAGED) {
                void this.serverManager?.stop();
                this.serverManager = null;
                this.binaryManager = null;
            }
            this.api = new LilbeeClient(this.settings.serverUrl);
            this.api.setTokenProvider(() => this.readCurrentToken());
            this.api.setToken(this.readCurrentToken());
            // Stopping the managed child fires STATE.STOPPED on the way out
            // which leaves the status bar reading "lilbee: stopped" even
            // though we're about to talk to an external server. Refresh so
            // the bar reflects external reachability instead of the stale
            // managed-stopped label.
            void this.fetchActiveModel();
        }

        this.updateAutoSync();
    }

    private updateStatusBar(text: string, dotState: DotState | null = null): void {
        if (!this.statusBarEl) return;
        const model = this.activeModel ? ` (${this.activeModel})` : "";
        this.statusBarEl.empty();
        if (dotState) {
            const dot = this.statusBarEl.createSpan({ cls: `lilbee-statusbar-dot is-${dotState}` });
            dot.setAttribute("aria-hidden", "true");
        }
        this.statusBarEl.createSpan({ text: `${text}${model}` });
    }

    private setStatusClass(cls: string | null): void {
        if (!this.statusBarEl) return;
        this.statusBarEl.classList.remove(
            "lilbee-status-downloading",
            "lilbee-status-starting",
            "lilbee-status-ready",
            "lilbee-status-adding",
            "lilbee-status-error",
        );
        if (cls) this.statusBarEl.classList.add(cls);
    }

    private setStatusReady(): void {
        const text =
            this.settings.serverMode === SERVER_MODE.EXTERNAL ? MESSAGES.STATUS_READY_EXTERNAL : MESSAGES.STATUS_READY;
        this.updateStatusBar(text);
        this.setStatusClass("lilbee-status-ready");
    }

    private startHealthProbe(): void {
        if (this.healthProbeHandle !== null) return;
        const handle = setInterval(() => void this.probeServerHealth(), HEALTH_PROBE_INTERVAL_MS) as unknown as number;
        this.registerInterval(handle);
        this.healthProbeHandle = handle;
    }

    private async probeServerHealth(): Promise<void> {
        if (this.taskQueue.activeAll.length > 0) return;
        if (this.startingServer) return;
        // Re-read the token before probing — the server writes a fresh one on
        // every restart, and this is the cheapest way to stay in sync.
        this.api.setToken(this.readCurrentToken());
        const ok = (await this.api.health().catch(() => null))?.isOk() ?? false;
        if (ok) {
            if (this.serverUnreachable) {
                this.serverUnreachable = false;
                void this.fetchActiveModel();
            }
        } else if (!this.serverUnreachable) {
            this.serverUnreachable = true;
            this.updateStatusBar(MESSAGES.STATUS_ERROR, DOT_STATE.ERROR);
            this.setStatusClass("lilbee-status-error");
            this.maybeWarnMissingToken();
        }
    }

    private missingTokenNoticeFired = false;

    private maybeWarnMissingToken(): void {
        if (this.missingTokenNoticeFired) return;
        if (this.readCurrentToken() !== null) return;
        this.missingTokenNoticeFired = true;
        const msg =
            this.settings.serverMode === SERVER_MODE.MANAGED
                ? MESSAGES.NOTICE_NO_TOKEN_MANAGED
                : MESSAGES.NOTICE_NO_TOKEN_EXTERNAL;
        new Notice(msg, NOTICE_DURATION_MS);
    }

    private updateStatusBarFromQueue(): void {
        const allActive = this.taskQueue.activeAll;
        const queued = this.taskQueue.queued;
        const completed = this.taskQueue.completed;

        if (allActive.length === 0 && queued.length === 0) {
            const recent = completed[0];
            if (recent && recent.completedAt !== null && Date.now() - recent.completedAt < TASK_FLASH_WINDOW_MS) {
                this.renderStatusFlash(recent, completed);
                return;
            }
            this.setStatusReady();
            return;
        }

        if (allActive.length === 0 && queued.length > 0) {
            this.updateStatusBar(
                `lilbee: ${MESSAGES.STATUS_TASKS_QUEUED_ONLY.replace("{count}", String(queued.length))}`,
                DOT_STATE.PRIMARY,
            );
            this.setStatusClass("lilbee-status-adding");
            return;
        }

        const first = allActive[0]!;
        const pct = first.progress > 0 ? first.progress : 0;
        const suffix = queued.length > 0 ? ` +${queued.length}` : "";

        if (allActive.length === 1) {
            const text = MESSAGES.STATUS_TASK_RUNNING_SINGLE.replace("{name}", first.name).replace(
                "{pct}",
                String(pct),
            );
            this.updateStatusBar(`lilbee: ${text}${suffix}`, DOT_STATE.PRIMARY);
        } else {
            const text = MESSAGES.STATUS_TASKS_RUNNING_PLURAL.replace("{count}", String(allActive.length))
                .replace("{name}", first.name)
                .replace("{pct}", String(pct));
            this.updateStatusBar(`lilbee: ${text}${suffix}`, DOT_STATE.PRIMARY);
        }
        this.setStatusClass("lilbee-status-adding");
    }

    private updateRibbonFromQueue(): void {
        if (!this.ribbonIconEl) return;
        const el = this.ribbonIconEl;
        el.removeClass("lilbee-ribbon-active", "lilbee-ribbon-success", "lilbee-ribbon-error");
        const allActive = this.taskQueue.activeAll;
        const queued = this.taskQueue.queued;
        const completed = this.taskQueue.completed;
        if (allActive.length > 0 || queued.length > 0) {
            el.addClass("lilbee-ribbon-active");
            return;
        }
        const recent = completed[0];
        if (!recent || recent.completedAt === null) return;
        if (Date.now() - recent.completedAt >= TASK_FLASH_WINDOW_MS) return;
        if (recent.status === TASK_STATUS.DONE) el.addClass("lilbee-ribbon-success");
        else if (recent.status === TASK_STATUS.FAILED) el.addClass("lilbee-ribbon-error");
    }

    private renderStatusFlash(recent: TaskEntry, completed: readonly TaskEntry[]): void {
        if (recent.status === TASK_STATUS.DONE) {
            const recentDone = countRecentByStatus(completed, TASK_STATUS.DONE);
            const text =
                recentDone > 1
                    ? MESSAGES.STATUS_TASKS_DONE_FLASH.replace("{count}", String(recentDone)).replace(
                          "{name}",
                          recent.name,
                      )
                    : MESSAGES.STATUS_TASK_DONE_FLASH.replace("{name}", recent.name);
            this.updateStatusBar(`lilbee: ${text}`, DOT_STATE.SUCCESS);
            this.setStatusClass("lilbee-status-ready");
            return;
        }
        if (recent.status === TASK_STATUS.FAILED) {
            const recentFailed = countRecentByStatus(completed, TASK_STATUS.FAILED);
            const template = recentFailed > 1 ? MESSAGES.STATUS_TASKS_FAILED_FLASH : MESSAGES.STATUS_TASK_FAILED_FLASH;
            const text = template.replace("{count}", String(recentFailed)).replace("{name}", recent.name);
            this.updateStatusBar(`lilbee: ${text}`, DOT_STATE.ERROR);
            this.setStatusClass("lilbee-status-error");
            return;
        }
        this.setStatusReady();
    }

    async fetchActiveModel(): Promise<void> {
        try {
            const models = await this.api.listModels();
            this.activeModel = models.chat.active;
            this.setStatusReady();
        } catch {
            // Silently fail - will retry on next action
        }

        // Check wiki feature status
        try {
            const status = await this.api.status();
            if (status.isOk()) {
                this.wikiEnabled = this.settings.wikiEnabled;
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

    private async confirmReindexIfNeeded(name: string): Promise<boolean> {
        try {
            const searchName = name.replace(/\.md$/, "");
            const listing = await this.api.listDocuments(searchName, 1);
            if (listing.documents.length > 0) {
                const modal = new ConfirmModal(this.app, MESSAGES.CONFIRM_REINDEX(searchName));
                modal.open();
                return await modal.result;
            }
        } catch {
            // graceful fallback: proceed with add if check fails
        }
        return true;
    }

    async addExternalFiles(paths: string[]): Promise<void> {
        if (!this.statusBarEl || paths.length === 0) return;
        if (!this.assertActiveModel()) return;
        const label = paths.length === 1 ? paths[0].split("/").pop() || paths[0] : `${paths.length} files`;

        const isRetry = paths.length === 1 && this.failedAddPaths.has(paths[0]);
        if (paths.length === 1 && !isRetry && !(await this.confirmReindexIfNeeded(label))) return;

        // Copy disk-picked files into the vault before indexing so the
        // resulting source lives where the user expects — visible in the
        // file tree, reachable as a native Obsidian file, and eligible for
        // the vault_path deep-link on chat source chips. Skips files whose
        // paths are already inside the vault (right-click "Add to lilbee"
        // routes through here too for single-path external paths).
        const copiedPaths = this.copyExternalFilesToVault(paths);
        if (copiedPaths.length === 0) return;

        new Notice(MESSAGES.STATUS_ADDING.replace("{label}", label));
        await this.runAdd(copiedPaths, paths, () => this.addExternalFiles(paths));
    }

    /**
     * Copy each external path into ``<vault>/lilbee/imports/`` and return the
     * new absolute paths for indexing. Paths already under the vault root
     * are returned unchanged. On copy failure the offending file is dropped
     * with a user-visible Notice so the rest of the batch still proceeds.
     *
     * Directory sources are copied recursively with ``node.cpSync`` — the
     * native file picker's "openDirectory" mode returns folder paths, and
     * ``copyFileSync`` on a directory throws EISDIR. Without the stat-first
     * branch every picked folder would fall into the catch and get silently
     * dropped, regressing folder ingestion.
     *
     * All path joins go through ``node.path`` so Windows ``\\`` separators
     * round-trip correctly — a naïve string ``startsWith(vaultBase + "/")``
     * check would miss every file on Windows and mis-copy them into imports.
     */
    private copyExternalFilesToVault(paths: string[]): string[] {
        const vaultBase = this.getVaultBasePath();
        const importsDir = node.join(vaultBase, "lilbee", "imports");
        try {
            node.mkdirSync(importsDir, { recursive: true });
        } catch (err) {
            console.error("[lilbee] import dir create failed:", importsDir, err);
            new Notice(MESSAGES.ERROR_FILE_PICKER);
            return [];
        }
        const results: string[] = [];
        for (const source of paths) {
            if (this.isUnderVault(source, vaultBase)) {
                results.push(source);
                continue;
            }
            const name = node.basename(source) || "imported";
            const dest = this.uniqueImportPath(importsDir, name);
            try {
                const isDirectory = node.statSync(source).isDirectory();
                if (isDirectory) {
                    node.cpSync(source, dest, { recursive: true });
                } else {
                    node.copyFileSync(source, dest);
                }
                results.push(dest);
            } catch (err) {
                console.error("[lilbee] import copy failed:", source, err);
                new Notice(MESSAGES.ERROR_FILE_PICKER);
            }
        }
        return results;
    }

    /**
     * True if ``source`` sits under ``vaultBase``. Normalises separators so
     * ``C:\\vault\\foo.pdf`` correctly matches a vault base of ``C:\\vault``
     * regardless of which slash flavour either side uses.
     */
    private isUnderVault(source: string, vaultBase: string): boolean {
        const norm = (p: string) => p.replace(/\\/g, "/");
        const prefix = norm(vaultBase).replace(/\/+$/, "");
        return norm(source).startsWith(`${prefix}/`);
    }

    /** Append a ``-N`` suffix until ``<dir>/<name>`` doesn't exist on disk. */
    private uniqueImportPath(dir: string, name: string): string {
        const candidate = node.join(dir, name);
        if (!node.existsSync(candidate)) return candidate;
        const dot = name.lastIndexOf(".");
        const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
        for (let n = 1; n < 1000; n++) {
            const next = node.join(dir, `${stem}-${n}${ext}`);
            if (!node.existsSync(next)) return next;
        }
        return node.join(dir, `${stem}-${Date.now()}${ext}`);
    }

    async addToLilbee(file: TAbstractFile): Promise<void> {
        if (!this.statusBarEl) return;
        if (!this.assertActiveModel()) return;
        const absolutePath = `${this.getVaultBasePath()}/${file.path}`;
        const name = file.name ?? file.path;

        const isRetry = this.failedAddPaths.has(absolutePath);
        if (!isRetry && !(await this.confirmReindexIfNeeded(name))) return;

        new Notice(MESSAGES.STATUS_ADDING.replace("{label}", name));
        await this.runAdd([absolutePath], [absolutePath], () => this.addToLilbee(file));
    }

    cancelSync(): void {
        this.syncController?.abort();
        this.syncController = null;
    }

    private async runAdd(
        paths: string[],
        retryKeys: string[] = paths,
        retry?: () => void | Promise<void>,
    ): Promise<void> {
        const taskId = this.taskQueue.enqueue("Adding files", TASK_TYPE.ADD, retry);
        if (taskId === null) {
            new Notice(MESSAGES.NOTICE_QUEUE_FULL);
            return;
        }
        for (const p of retryKeys) this.failedAddPaths.delete(p);
        this.syncController = new AbortController();
        this.taskQueue.registerAbort(taskId, this.syncController);

        try {
            const progress = new FileProgressTracker();
            let syncResult: SyncDone | null = null;
            const controller = this.syncController;
            const rawStream = this.api.addFiles(paths, true, this.settings.enableOcr, controller.signal);
            for await (const event of withIdleTimeout(rawStream, STREAM_IDLE_TIMEOUT_MS, () => controller.abort())) {
                if (event.event === SSE_EVENT.FILE_START) {
                    const d = event.data as { current_file: number; total_files: number };
                    progress.startFile(d.current_file, d.total_files);
                    this.taskQueue.update(
                        taskId,
                        progress.percent(),
                        MESSAGES.STATUS_TASK_FILE.replace("{current}", String(d.current_file)).replace(
                            "{total}",
                            String(d.total_files),
                        ),
                    );
                } else if (event.event === SSE_EVENT.EXTRACT) {
                    const d = event.data as { page: number; total_pages: number; file: string };
                    progress.setExtractFraction(d.page, d.total_pages);
                    this.taskQueue.update(
                        taskId,
                        progress.percent(),
                        MESSAGES.STATUS_TASK_EXTRACTING.replace("{file}", d.file)
                            .replace("{page}", String(d.page))
                            .replace("{total}", String(d.total_pages)),
                    );
                } else if (event.event === SSE_EVENT.EMBED) {
                    const d = event.data as { chunk: number; total_chunks: number };
                    progress.setEmbedFraction(d.chunk, d.total_chunks);
                    this.taskQueue.update(
                        taskId,
                        progress.percent(),
                        MESSAGES.STATUS_TASK_EMBEDDING.replace("{chunk}", String(d.chunk)).replace(
                            "{total}",
                            String(d.total_chunks),
                        ),
                    );
                } else if (event.event === SSE_EVENT.DONE) {
                    const parsed = parseAddDoneEvent(event.data);
                    if (parsed) syncResult = parsed;
                } else if (event.event === SSE_EVENT.ALREADY_INGESTING) {
                    const d = (event.data ?? {}) as { source?: string };
                    const source = typeof d.source === "string" && d.source ? d.source : paths[0];
                    new Notice(MESSAGES.NOTICE_ALREADY_INGESTING(source));
                    this.taskQueue.markWaiting(taskId, MESSAGES.STATUS_WAITING_ON_SERVER);
                    return;
                } else if (event.event === SSE_EVENT.ERROR) {
                    const d = event.data as { message?: string } | string;
                    const msg = extractSseErrorMessage(d, MESSAGES.ERROR_UNKNOWN);
                    new Notice(MESSAGES.ERROR_ADD_FAILED_DETAIL(msg));
                    this.taskQueue.fail(taskId, msg);
                    this.markAddFailed(retryKeys);
                    return;
                }
            }

            if (syncResult) {
                const summary = summarizeSyncResult(syncResult);
                new Notice(summary ? MESSAGES.NOTICE_SYNC_SUMMARY(summary) : MESSAGES.STATUS_NOTHING_NEW);
            }
            this.taskQueue.complete(taskId);
        } catch (err) {
            if (err instanceof StreamIdleError) {
                new Notice(MESSAGES.ERROR_STREAM_IDLE);
                this.taskQueue.fail(taskId, MESSAGES.ERROR_STREAM_IDLE);
                this.markAddFailed(retryKeys);
            } else if (err instanceof Error && err.name === ERROR_NAME.ABORT_ERROR) {
                new Notice(MESSAGES.STATUS_ADD_CANCELLED);
                this.taskQueue.cancel(taskId);
                this.markAddFailed(retryKeys);
            } else if (err instanceof SessionTokenError) {
                new Notice(MESSAGES.NOTICE_SESSION_TOKEN_INVALID);
                this.taskQueue.fail(taskId, MESSAGES.NOTICE_SESSION_TOKEN_INVALID);
                this.markAddFailed(retryKeys);
            } else {
                console.error("[lilbee] add failed:", err);
                const msg = errorMessage(err, MESSAGES.ERROR_CANNOT_CONNECT);
                new Notice(MESSAGES.ERROR_ADD_FAILED_DETAIL(msg));
                this.taskQueue.fail(taskId, msg);
                this.markAddFailed(retryKeys);
            }
        } finally {
            this.syncController = null;
        }
    }

    private markAddFailed(paths: string[]): void {
        for (const p of paths) this.failedAddPaths.add(p);
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

    openPluginSettings(): void {
        // `app.setting` is an undocumented-but-stable Obsidian API used
        // widely by community plugins to jump straight to their own tab.
        const setting = (this.app as unknown as { setting?: { open: () => void; openTabById: (id: string) => void } })
            .setting;
        if (!setting) return;
        setting.open();
        setting.openTabById(this.manifest.id);
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
            // Skip everything the server itself writes into the vault
            // (crawled/, imported/, documents/, wiki/). Once server PR 3 lands
            // this prevents the vault watcher from re-triggering sync on
            // files lilbee just materialized.
            if (file.path.startsWith("lilbee/")) return;
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
        if (taskId === null) {
            new Notice(MESSAGES.NOTICE_QUEUE_FULL);
            return;
        }
        try {
            const result = await this.api.wikiLint();
            this.taskQueue.complete(taskId);
            new Notice(MESSAGES.NOTICE_WIKI_LINT_DONE(result.issues.length), NOTICE_DURATION_MS);
            new LintModal(this.app, result.issues).open();
        } catch (err) {
            const msg = errorMessage(err, MESSAGES.ERROR_UNKNOWN);
            this.taskQueue.fail(taskId, msg);
        }
    }

    async runWikiGenerate(source: string): Promise<void> {
        const taskId = this.taskQueue.enqueue(`Generate wiki: ${source}`, TASK_TYPE.WIKI);
        if (taskId === null) {
            new Notice(MESSAGES.NOTICE_QUEUE_FULL);
            return;
        }
        const controller = new AbortController();
        this.taskQueue.registerAbort(taskId, controller);
        try {
            for await (const event of this.api.wikiGenerate(source, controller.signal)) {
                if (event.event === SSE_EVENT.WIKI_GENERATE_DONE) {
                    break;
                } else if (event.event === SSE_EVENT.WIKI_GENERATE_ERROR) {
                    const d = event.data as GenerateErrorData;
                    throw new Error(d.message ?? "generation failed");
                } else if (event.event === SSE_EVENT.ERROR) {
                    const d = event.data as { message?: string } | string;
                    throw new Error(extractSseErrorMessage(d, MESSAGES.ERROR_UNKNOWN));
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
            const msg = errorMessage(err, MESSAGES.ERROR_UNKNOWN);
            this.taskQueue.fail(taskId, msg);
        }
    }

    async runWikiPrune(): Promise<void> {
        const modal = new ConfirmModal(this.app, MESSAGES.NOTICE_WIKI_PRUNE_CONFIRM);
        modal.open();
        const confirmed = await modal.result;
        if (!confirmed) return;

        const taskId = this.taskQueue.enqueue("Wiki prune", TASK_TYPE.WIKI);
        if (taskId === null) {
            new Notice(MESSAGES.NOTICE_QUEUE_FULL);
            return;
        }
        const controller = new AbortController();
        this.taskQueue.registerAbort(taskId, controller);
        try {
            let archived = 0;
            for await (const event of this.api.wikiPrune(controller.signal)) {
                if (event.event === SSE_EVENT.WIKI_PRUNE_DONE) {
                    const d = event.data as PruneData;
                    archived = d.archived ?? 0;
                } else if (event.event === SSE_EVENT.ERROR) {
                    const d = event.data as { message?: string } | string;
                    throw new Error(extractSseErrorMessage(d, MESSAGES.ERROR_UNKNOWN));
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
            const msg = errorMessage(err, MESSAGES.ERROR_UNKNOWN);
            this.taskQueue.fail(taskId, msg);
        }
    }

    async runCrawl(url: string, depth: number | null, maxPages: number | null): Promise<void> {
        const taskId = this.taskQueue.enqueue(`Crawl ${url}`, TASK_TYPE.CRAWL);
        if (taskId === null) {
            new Notice(MESSAGES.NOTICE_QUEUE_FULL);
            return;
        }
        const controller = new AbortController();
        this.taskQueue.registerAbort(taskId, controller);
        let setupTaskId: string | null = null;
        let setupResolved = false;
        try {
            let pageCount = 0;
            const rawStream = this.api.crawl(url, depth, maxPages, controller.signal);
            for await (const event of withIdleTimeout(rawStream, STREAM_IDLE_TIMEOUT_MS, () => controller.abort())) {
                switch (event.event) {
                    case SSE_EVENT.SETUP_START: {
                        if (setupTaskId !== null) break;
                        setupTaskId = this.taskQueue.enqueue("Chromium setup", TASK_TYPE.SETUP);
                        this.taskQueue.update(taskId, -1, MESSAGES.STATUS_TASK_CRAWLER_PREPARING);
                        if (setupTaskId !== null) {
                            const d = event.data as SetupStartPayload;
                            this.taskQueue.update(setupTaskId, 0, formatSetupDetail(0, d.size_estimate_bytes));
                        }
                        break;
                    }
                    case SSE_EVENT.SETUP_PROGRESS: {
                        if (setupTaskId === null) break;
                        const d = event.data as SetupProgressPayload;
                        const pct = d.total_bytes ? (d.downloaded_bytes / d.total_bytes) * 100 : -1;
                        this.taskQueue.update(setupTaskId, pct, formatSetupDetail(d.downloaded_bytes, d.total_bytes));
                        break;
                    }
                    case SSE_EVENT.SETUP_DONE: {
                        const d = event.data as SetupDonePayload;
                        setupResolved = true;
                        if (d.success) {
                            if (setupTaskId !== null) this.taskQueue.complete(setupTaskId);
                            this.taskQueue.update(taskId, -1, "");
                        } else {
                            const err = d.error ?? MESSAGES.ERROR_UNKNOWN;
                            if (setupTaskId !== null) this.taskQueue.fail(setupTaskId, err);
                            this.taskQueue.fail(taskId, MESSAGES.ERROR_CRAWLER_SETUP_FAILED_SHORT);
                            new Notice(MESSAGES.ERROR_CRAWLER_SETUP_FAILED.replace("{error}", err));
                            return;
                        }
                        break;
                    }
                    case SSE_EVENT.CRAWL_START:
                        break;
                    case SSE_EVENT.CRAWL_PAGE: {
                        pageCount++;
                        this.taskQueue.update(taskId, -1, `${pageCount} pages`);
                        break;
                    }
                    case SSE_EVENT.CRAWL_DONE: {
                        const d = event.data as { pages_crawled?: number };
                        this.taskQueue.complete(taskId);
                        new Notice(MESSAGES.NOTICE_CRAWL_DONE(d.pages_crawled ?? pageCount));
                        void this.triggerSync();
                        return;
                    }
                    case SSE_EVENT.CRAWL_ERROR:
                    case SSE_EVENT.ERROR: {
                        const d = event.data as { message?: string };
                        this.taskQueue.fail(taskId, d.message ?? "unknown");
                        new Notice(MESSAGES.ERROR_CRAWL_ERROR.replace("{msg}", d.message ?? "unknown"));
                        return;
                    }
                }
            }
            this.taskQueue.complete(taskId);
        } catch (err) {
            if (setupTaskId !== null && !setupResolved) {
                this.taskQueue.fail(setupTaskId, MESSAGES.ERROR_CRAWLER_SETUP_FAILED_SHORT);
            }
            if (err instanceof StreamIdleError) {
                new Notice(MESSAGES.ERROR_STREAM_IDLE);
                this.taskQueue.fail(taskId, MESSAGES.ERROR_STREAM_IDLE);
                return;
            }
            const msg = errorMessage(err, MESSAGES.ERROR_UNKNOWN);
            this.taskQueue.fail(taskId, msg);
            new Notice(MESSAGES.ERROR_CRAWL_FAILED.replace("{msg}", msg));
        }
    }

    async triggerSync(): Promise<void> {
        if (!this.statusBarEl) return;
        const taskId = this.taskQueue.enqueue("Sync vault", TASK_TYPE.SYNC);
        if (taskId === null) {
            new Notice(MESSAGES.NOTICE_QUEUE_FULL);
            return;
        }
        this.syncController = new AbortController();
        this.taskQueue.registerAbort(taskId, this.syncController);

        try {
            const progress = new FileProgressTracker();
            let syncResult: SyncDone | null = null;
            const controller = this.syncController;
            const rawStream = this.api.syncStream(this.settings.enableOcr, controller.signal);
            for await (const event of withIdleTimeout(rawStream, STREAM_IDLE_TIMEOUT_MS, () => controller.abort())) {
                if (event.event === SSE_EVENT.FILE_START) {
                    const d = event.data as { current_file: number; total_files: number };
                    progress.startFile(d.current_file, d.total_files);
                    this.taskQueue.update(
                        taskId,
                        progress.percent(),
                        MESSAGES.STATUS_TASK_SYNCING_FILE.replace("{current}", String(d.current_file)).replace(
                            "{total}",
                            String(d.total_files),
                        ),
                    );
                } else if (event.event === SSE_EVENT.EXTRACT) {
                    const d = event.data as { page: number; total_pages: number; file: string };
                    progress.setExtractFraction(d.page, d.total_pages);
                    this.taskQueue.update(
                        taskId,
                        progress.percent(),
                        MESSAGES.STATUS_TASK_EXTRACTING.replace("{file}", d.file)
                            .replace("{page}", String(d.page))
                            .replace("{total}", String(d.total_pages)),
                    );
                } else if (event.event === SSE_EVENT.EMBED) {
                    const d = event.data as { chunk: number; total_chunks: number };
                    progress.setEmbedFraction(d.chunk, d.total_chunks);
                    this.taskQueue.update(
                        taskId,
                        progress.percent(),
                        MESSAGES.STATUS_TASK_EMBEDDING.replace("{chunk}", String(d.chunk)).replace(
                            "{total}",
                            String(d.total_chunks),
                        ),
                    );
                } else if (event.event === SSE_EVENT.DONE) {
                    const parsed = parseAddDoneEvent(event.data);
                    if (parsed) syncResult = parsed;
                } else if (event.event === SSE_EVENT.ERROR) {
                    const d = event.data as { message?: string } | string;
                    const msg = extractSseErrorMessage(d, MESSAGES.ERROR_UNKNOWN);
                    new Notice(MESSAGES.STATUS_SYNC_FAILED);
                    this.taskQueue.fail(taskId, msg);
                    return;
                }
            }

            if (syncResult) {
                const summary = summarizeSyncResult(syncResult);
                if (summary) new Notice(MESSAGES.STATUS_SYNCED.replace("{summary}", summary));
            }
            this.taskQueue.complete(taskId);
        } catch (err) {
            if (err instanceof StreamIdleError) {
                new Notice(MESSAGES.ERROR_STREAM_IDLE);
                this.taskQueue.fail(taskId, MESSAGES.ERROR_STREAM_IDLE);
            } else if (err instanceof Error && err.name === ERROR_NAME.ABORT_ERROR) {
                new Notice(MESSAGES.STATUS_SYNC_CANCELLED);
                this.taskQueue.cancel(taskId);
            } else if (err instanceof SessionTokenError) {
                // Auto-sync gets 401 when the stored token is stale — e.g. the
                // server restarted with a new data-dir. Surface the same
                // actionable notice the manual-sync paths do so the user
                // knows to paste a fresh token in Settings instead of
                // wondering why sync silently stopped working.
                new Notice(MESSAGES.NOTICE_SESSION_TOKEN_INVALID);
                this.taskQueue.fail(taskId, MESSAGES.NOTICE_SESSION_TOKEN_INVALID);
            } else {
                console.error("[lilbee] sync failed:", err);
                new Notice(MESSAGES.STATUS_SYNC_FAILED);
                this.taskQueue.fail(taskId, MESSAGES.ERROR_CANNOT_CONNECT);
            }
        } finally {
            this.syncController = null;
        }
    }
}
