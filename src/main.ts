import {
    type ItemView,
    type Menu,
    type MenuItem,
    Notice,
    Plugin,
    type TAbstractFile,
    TFile,
    TFolder,
    type WorkspaceLeaf,
} from "obsidian";
import { LilbeeClient, SessionTokenError } from "./api";
import { BinaryManager, getLatestRelease, checkForUpdate, node } from "./binary-manager";
import { exportDatasetToDisk, importDatasetFromDisk } from "./dataset-io";
import { exportDiagnostics } from "./diagnostics-export";
import { ErrorJournal } from "./error-journal";
import { DownloadCanceledError } from "./binary-manager";
import type { DownloadProgress, ReleaseInfo } from "./binary-manager";
import { ScopeHeldError, ServerManager, askServerToExit, readScopeOwner, serverIsLive } from "./server-manager";
import { executeUninstall, planUninstall } from "./server-uninstall";
import { readSessionToken, resolveExternalDataRoot } from "./session-token";
import { LilbeeSettingTab } from "./settings";
import { VaultRegistry, computeVaultId, resolveSharedRoot, sharedBinDir, sharedModelsDir } from "./vault-registry";
import {
    CONFIG_KEY,
    DEFAULT_SETTINGS,
    DOT_STATE,
    ERROR_NAME,
    LOGS_DIR,
    MANAGED_CONSENT_RESULT,
    MANAGED_PHASE,
    MODEL_TASK,
    REQUEST_OUTCOME,
    SERVER_MODE,
    SERVER_STATE,
    SETUP_OUTCOME,
    SSE_EVENT,
    TASK_STATUS,
    TASK_TYPE,
    type BatchProgressPayload,
    type CrawlRenderMode,
    type DiagnosticsContext,
    type DotState,
    type HealthResponse,
    type LilbeeSettings,
    type ManagedServerProgressHandler,
    type RequestOutcome,
    type ServerMode,
    type SetupOutcome,
    type ServerState,
    type ServerVariant,
    type SetupDonePayload,
    type SetupProgressPayload,
    type SetupStartPayload,
    type SyncDone,
    type SSEEvent,
    type SyncOptions,
    type TaskEntry,
    type UninstallPlan,
    type VaultAdapter,
} from "./types";
import { MESSAGES } from "./locales/en";
import { displayLabelForRef, extractHfRepo } from "./utils/model-ref";
import {
    errorMessage,
    extractSseErrorMessage,
    formatDiskSize,
    isVersionOlder,
    HEALTH_FAILURE_STREAK_THRESHOLD,
    HEALTH_PROBE_INTERVAL_MS,
    NOTICE_DURATION_MS,
    NOTICE_ERROR_DURATION_MS,
    NOTICE_PERMANENT,
    percentOfBytes,
    sessionTokenInvalidMessage,
    supportsSessions,
    STREAM_IDLE_TIMEOUT_MS,
    StreamIdleError,
    withIdleTimeout,
} from "./utils";
import { CatalogModal } from "./views/catalog-modal";
import { ManagedConsentModal } from "./views/managed-consent-modal";
import { ModelInfoModal } from "./views/model-info-modal";
import { ModelPickerModal } from "./views/model-picker-modal";
import { ChatView, VIEW_TYPE_CHAT } from "./views/chat-view";
import { CrawlModal } from "./views/crawl-modal";
import { DocumentsModal } from "./views/documents-modal";
import { SearchModal } from "./views/search-modal";
import { SetupWizard } from "./views/setup-wizard";
import { TaskCenterView, VIEW_TYPE_TASKS } from "./views/task-center";
import { WikiView, VIEW_TYPE_WIKI } from "./views/wiki-view";
import { MemoriesView, VIEW_TYPE_MEMORIES } from "./views/memories-view";
import { PlacementView, VIEW_TYPE_PLACEMENT, revealPlacementBeside } from "./views/placement-view";
import { RememberModal } from "./views/remember-modal";
import { LintModal } from "./views/lint-modal";
import { DraftModal } from "./views/draft-modal";
import { ConfirmModal } from "./views/confirm-modal";
import { StatusModal } from "./views/status-modal";
import { GatekeeperModal } from "./views/gatekeeper-modal";
import { TaskQueue, FLASH_WINDOW_MS as TASK_FLASH_WINDOW_MS } from "./task-queue";
import { WikiSync } from "./wiki-sync";

interface GenerateErrorData {
    message?: string;
}
interface PruneData {
    archived?: number;
}

const BYTES_PER_MB = 1_000_000;

const PENDING_SYNC_HINT_DEBOUNCE_MS = 1000;
/** How long a taken-over server gets to exit after agreeing to stop. */
const TAKE_OVER_SHUTDOWN_TIMEOUT_MS = 10_000;

// How long terminateOwningProcess waits for the previous owner to exit.

const SUPPORTED_SYNC_EXTENSIONS = new Set(["md", "pdf", "txt", "html"]);

// A single /api/add/upload request is bounded server-side by file count and
// body size, so large folders upload in sequential batches that stay under both.
const UPLOAD_BATCH_MAX_FILES = 90;
const UPLOAD_BATCH_MAX_BYTES = 8 * BYTES_PER_MB;

// Vault-relative folder where managed mode stores lilbee's documents
// (see configureManagedStorage). It is the only scope `Sync vault` reconciles.
const MANAGED_DOCS_PREFIX = "lilbee/";

const basename = (p: string): string => p.slice(p.lastIndexOf("/") + 1);

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
    if (done.skipped.length > 0) parts.push(`${done.skipped.length} skipped`);
    return parts.join(", ");
}

/** Task-center label for a sync, distinguishing the recovery variants. */
function syncTaskLabel(options?: SyncOptions): string {
    if (options?.forceRebuild) return MESSAGES.COMMAND_SYNC_REBUILD;
    if (options?.retrySkipped) return MESSAGES.COMMAND_SYNC_RETRY_SKIPPED;
    return MESSAGES.COMMAND_SYNC;
}

function countRecentByStatus(completed: readonly TaskEntry[], status: TaskEntry["status"]): number {
    const now = Date.now();
    return completed.filter(
        (t) => t.status === status && t.completedAt !== null && now - t.completedAt < TASK_FLASH_WINDOW_MS,
    ).length;
}

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

    completeFile(current: number, total: number): void {
        this.currentFile = current + 1;
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
        skipped: Array.isArray(obj.skipped) ? (obj.skipped as string[]) : [],
    };
}

type UploadPayload = { name: string; data: ArrayBuffer };

/** Split uploads into batches that stay under the server's per-request file
 *  count and body-size limits. A lone file over the byte budget still gets its
 *  own batch (the server rejects only if it also exceeds its hard cap). */
export function batchUploads(files: UploadPayload[]): UploadPayload[][] {
    const batches: UploadPayload[][] = [];
    let current: UploadPayload[] = [];
    let bytes = 0;
    for (const file of files) {
        const size = file.data.byteLength;
        if (current.length > 0 && (current.length >= UPLOAD_BATCH_MAX_FILES || bytes + size > UPLOAD_BATCH_MAX_BYTES)) {
            batches.push(current);
            current = [];
            bytes = 0;
        }
        current.push(file);
        bytes += size;
    }
    if (current.length > 0) batches.push(current);
    return batches;
}

/** Progress for a settings-driven install/update: a phase line plus a percent when known. */
export type ServerDownloadProgressHandler = (msg: string, percent?: number) => void;

/** "Downloading... 45% (128 MB of 283 MB)", or bytes-only when the server sends no length. */
function downloadMessage(progress: DownloadProgress): string {
    const received = formatDiskSize(progress.receivedBytes);
    const percent = percentOfBytes(progress.receivedBytes, progress.totalBytes);
    if (percent === undefined || progress.totalBytes === null) return MESSAGES.STATUS_DOWNLOAD_RECEIVED(received);
    return MESSAGES.STATUS_DOWNLOAD_PROGRESS(percent, received, formatDiskSize(progress.totalBytes));
}

/** The status bar is narrow: percent only, with the byte detail left to Settings. */
function downloadStatusBar(progress: DownloadProgress): string {
    const percent = percentOfBytes(progress.receivedBytes, progress.totalBytes);
    if (percent === undefined) return MESSAGES.STATUS_DOWNLOADING;
    return MESSAGES.STATUS_DOWNLOADING_PERCENT(percent);
}

export default class LilbeePlugin extends Plugin {
    settings: LilbeeSettings = { ...DEFAULT_SETTINGS };
    api: LilbeeClient = new LilbeeClient("");
    activeModel = "";
    statusBarEl: HTMLElement | null = null;
    syncPillEl: HTMLElement | null = null;
    chatRibbonIconEl: HTMLElement | null = null;
    binaryManager: BinaryManager | null = null;
    serverManager: ServerManager | null = null;
    journal = new ErrorJournal();
    vaultRegistry: VaultRegistry | null = null;
    vaultId = "";
    syncController: AbortController | null = null;
    private pendingSyncCount = 0;
    private pendingHintTimeout: number | null = null;
    private previousServerMode: ServerMode = SERVER_MODE.MANAGED;
    private startingServer = false;
    private serverStartFailed = false;
    private unloaded = false;
    // Guards chat-leaf creation against re-entrant duplicate tabs while setViewState is in flight (issue #169).
    private openingChatLeaf = false;
    // Same re-entrancy guard for the placement view's main-area tab and beside-chat split.
    private openingPlacementLeaf = false;
    /** Set by the placement dev-builds prompt so the settings tab scrolls to the toggle. */
    revealDevBuildsInSettings = false;
    taskQueue: TaskQueue = new TaskQueue();
    /** Paths whose most-recent add failed — retry skips the reindex confirm. */
    private failedAddPaths = new Set<string>();
    wikiEnabled = false;
    wikiPageCount = 0;
    wikiDraftCount = 0;
    wikiSync: WikiSync | null = null;
    private healthProbeHandle: number | null = null;
    private serverUnreachable = false;
    // True when the server is up but the chat role is still cold-loading (from /api/health).
    private chatWarming = false;
    // While > 0, probeServerHealth() bails: llama.cpp serializes requests,
    // so /api/health stalls behind the active stream and would falsely flip
    // the status bar to error.
    private chatInFlight = 0;
    // Counts consecutive failed probes against HEALTH_FAILURE_STREAK_THRESHOLD.
    private healthFailureStreak = 0;
    // External-mode server version, cached from the health probe; managed mode
    // reads the recorded install version instead.
    private externalServerVersion = "";
    // The managed server has reached READY at least once this session. Until
    // it has, a failing health probe means "still coming up", not "error" —
    // so a fresh install / first-run wizard doesn't flash a red error pill
    // while the binary downloads and the server boots.
    private serverEverReady = false;

    async onload(): Promise<void> {
        this.registerErrorCapture();
        await this.loadSettings();
        this.wikiEnabled = this.settings.wikiEnabled;

        // Sweep up status-bar items + ribbon icons that prior dead lilbee
        // instances left behind. Each crashed/incompletely-unloaded reload
        // accumulates more, so the corner ends up with multiple "lilbee:
        // ready" / "lilbee: error" pills side by side until Obsidian
        // restarts. Take a clean slate before adding our own. Guarded for
        // node-environment tests where document is undefined.
        if (typeof activeDocument !== "undefined") {
            activeDocument.querySelectorAll(".status-bar-item.plugin-lilbee").forEach((el) => el.remove());
            activeDocument.querySelectorAll(".lilbee-ribbon-icon").forEach((el) => el.remove());
        }

        this.statusBarEl = this.addStatusBarItem();
        this.statusBarEl.addClass("lilbee-clickable");
        this.statusBarEl.setAttribute("aria-label", MESSAGES.LABEL_STATUSBAR_OPEN_SETTINGS);
        this.statusBarEl.addEventListener("click", () => this.openPluginSettings());

        // A separate, visually distinct sync pill (refresh glyph + count) that
        // only appears when the vault has documents the server hasn't ingested.
        // Keeping it off the main status pill lets the green "running" state
        // stay clean and prominent; this pill is a sync affordance, not a
        // second status icon. Clicking it triggers a sync.
        this.syncPillEl = this.addStatusBarItem();
        this.syncPillEl.addClass("lilbee-sync-pill");
        this.syncPillEl.addClass("lilbee-clickable");
        this.syncPillEl.hide();
        this.syncPillEl.setAttribute("aria-label", MESSAGES.TOOLTIP_PENDING_SYNC_HINT);
        this.syncPillEl.addEventListener("click", () => void this.triggerSync());

        this.chatRibbonIconEl = this.addRibbonIcon("messages-square", MESSAGES.LABEL_RIBBON_OPEN_CHAT, () =>
            this.activateChatView(),
        );
        this.chatRibbonIconEl.addClass("lilbee-ribbon-icon", "lilbee-ribbon-chat");
        // Guard against Obsidian holding stale view registrations from a
        // previous plugin instance that didn't unload cleanly (e.g. an
        // onload that threw before registerView ran, or a disable that
        // skipped its unregister callback). registerView throws on
        // duplicate registration; wrap so the new instance still loads.
        const safeRegisterView = (type: string, factory: (leaf: WorkspaceLeaf) => ItemView): void => {
            try {
                this.registerView(type, factory);
            } catch (err) {
                if (!(err instanceof Error) || !/existing view type/.test(err.message)) throw err;
            }
        };
        safeRegisterView(VIEW_TYPE_CHAT, (leaf) => new ChatView(leaf, this));
        safeRegisterView(VIEW_TYPE_TASKS, (leaf) => new TaskCenterView(leaf, this));
        safeRegisterView(VIEW_TYPE_WIKI, (leaf) => new WikiView(leaf, this));
        safeRegisterView(VIEW_TYPE_MEMORIES, (leaf) => new MemoriesView(leaf, this));
        safeRegisterView(VIEW_TYPE_PLACEMENT, (leaf) => new PlacementView(leaf, this));
        this.addSettingTab(new LilbeeSettingTab(this.app, this));
        this.taskQueue.onChange(() => this.updateStatusBarFromQueue());
        this.taskQueue.onChange(() => this.schedulePersistHistory());
        // Add/sync/crawl tasks completing is when the server's set of known
        // documents changes, so re-count pending sync then. Vault file events
        // alone miss it: adding a file fires a create event (pill appears),
        // but nothing fires when the ingest finishes (pill would never clear).
        this.taskQueue.onChange(() => this.schedulePendingSyncHint());
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
            if (this.settings.serverMode === SERVER_MODE.MANAGED && this.serverUninstalled) {
                // The user removed the server on purpose. Wait to be asked.
                this.showNotInstalledStatus();
            } else if (this.settings.serverMode === SERVER_MODE.MANAGED) {
                void this.ensureManagedConsentThenStart().then((outcome) => {
                    // If the user opts into external mode from the consent modal,
                    // drop them on the plugin's external-server settings.
                    if (outcome.kind === SETUP_OUTCOME.SWITCHED_TO_EXTERNAL) this.openPluginSettings();
                    if (outcome.kind === SETUP_OUTCOME.STARTED) void this.autoUpdateServerBinary();
                });
            } else {
                this.configureApi(this.settings.serverUrl);
                this.setStatusReady();
                void this.fetchActiveModel();
                void this.warnExternalServerOutdated();
            }
        }

        if (!this.settings.setupCompleted) {
            new SetupWizard(this.app, this).open();
        }

        this.registerPendingSyncHintWatchers();
        void this.updatePendingSyncHint();

        this.startHealthProbe();

        // No view is force-opened here: Obsidian restores whatever leaves the
        // user left open. New users get the chat panel once, from the wizard.

        // Defend against duplicate sidebar leaves persisted in workspace.json
        // from prior sessions. activateChatView() is idempotent for one leaf,
        // but Obsidian restores whatever was saved, so a workspace that ended
        // up with two chat panes restores both.
        this.app.workspace.onLayoutReady(() => {
            this.dedupeLilbeeLeaves();
        });
    }

    /** Collapse multiple lilbee-chat / -tasks / -wiki leaves to one of each. */
    private dedupeLilbeeLeaves(): void {
        for (const type of [VIEW_TYPE_CHAT, VIEW_TYPE_TASKS, VIEW_TYPE_WIKI, VIEW_TYPE_MEMORIES, VIEW_TYPE_PLACEMENT]) {
            const leaves = this.app.workspace.getLeavesOfType(type);
            for (let i = 1; i < leaves.length; i++) leaves[i].detach();
        }
        this.app.workspace.requestSaveLayout?.();
    }

    async startManagedServer(onProgress?: ManagedServerProgressHandler, allowTakeOver = true): Promise<void> {
        if (this.startingServer) return;
        const registry = this.vaultRegistry;
        if (!registry) return;
        if (this.serverUninstalled) {
            this.showNotInstalledStatus();
            return;
        }
        this.startingServer = true;
        this.serverStartFailed = false;

        try {
            const sharedRoot = registry.sharedRoot;
            // Wired before the binary ensure so download failures and early
            // lifecycle lines persist to logs/plugin.log, not just memory.
            this.journal.setLogDir(node.join(registry.resolveDataDir(this.vaultId), LOGS_DIR));

            // A server predating the OS locks cannot refuse our spawn, so scan
            // for a live server another vault started and offer the same
            // take-over the refusal path does — instead of spawning next to it.
            const foreignDataDir = await this.findLiveForeignServer(registry);
            if (foreignDataDir !== null) {
                // Negotiate outside this call's startingServer window.
                window.setTimeout(() => {
                    void this.negotiateTakeOver(registry, onProgress, allowTakeOver, foreignDataDir);
                }, 0);
                return;
            }

            this.binaryManager = new BinaryManager(sharedBinDir(sharedRoot));
            const binaryPath = await this.ensureBinaryWithUi(onProgress);
            if (binaryPath === null) return;
            await this.recordLilbeeVersionAfterDownload();
            // A spawn after unload would leak a server no plugin instance tracks.
            if (this.unloaded) return;

            try {
                this.serverManager = this.buildServerManager(binaryPath, registry, sharedRoot);
                this.updateStatusBar(MESSAGES.STATUS_STARTING, DOT_STATE.PRIMARY);
                this.setStatusClass("lilbee-status-starting");
                onProgress?.({ phase: MANAGED_PHASE.STARTING, message: MESSAGES.STATUS_STARTING_SERVER });
                await this.serverManager.start();
                this.reconcileRecordedVersion();
                this.configureApi(this.serverManager.serverUrl);
                void this.fetchActiveModel();
                void this.configureManagedStorage();
                this.recordReadyState();
                onProgress?.({ phase: MANAGED_PHASE.READY, message: "" });
            } catch (err) {
                if (err instanceof ScopeHeldError) {
                    this.serverManager = null;
                    // Recurse outside this call's startingServer window.
                    window.setTimeout(() => {
                        void this.negotiateTakeOver(registry, onProgress, allowTakeOver);
                    }, 0);
                    return;
                }
                this.showError("failed to start server", err);
                onProgress?.({ phase: MANAGED_PHASE.ERROR, message: errorMessage(err, String(err)) });
            }
        } finally {
            this.startingServer = false;
        }
    }

    /**
     * Another vault's server holds the shared root — found by a refused spawn
     * (*knownOwnerDataDir* null, owner read from the scope sidecar) or by the
     * pre-spawn scan for servers predating the locks. Ask the user, ask that
     * server to exit over its API, then start again — the server-side lock
     * grace rides out the handoff. One round only: a second refusal lands in
     * the quiet "serving another vault" state instead of a loop.
     */
    private async negotiateTakeOver(
        registry: VaultRegistry,
        onProgress?: ManagedServerProgressHandler,
        allowTakeOver = true,
        knownOwnerDataDir: string | null = null,
    ): Promise<void> {
        const owner: { dataDir: string; pid: number | null } | null = knownOwnerDataDir
            ? { dataDir: knownOwnerDataDir, pid: null }
            : readScopeOwner(registry.sharedRoot);
        const ownerName = owner ? this.lookupVaultNameByDataDir(owner.dataDir) : "another vault";
        if (!allowTakeOver) {
            this.updateStatusBar(MESSAGES.STATUS_LOCKED_BY_OTHER(ownerName), DOT_STATE.MUTED);
            onProgress?.({
                phase: MANAGED_PHASE.ERROR,
                message: MESSAGES.NOTICE_TAKE_OVER_DECLINED(ownerName),
            });
            return;
        }
        const takeOver = await this.confirmTakeOver(ownerName);
        if (!takeOver) {
            this.journal.lifecycle(`take-over of the shared root declined (owner: ${ownerName})`);
            new Notice(MESSAGES.NOTICE_TAKE_OVER_DECLINED(ownerName));
            this.updateStatusBar(MESSAGES.STATUS_LOCKED_BY_OTHER(ownerName), DOT_STATE.MUTED);
            onProgress?.({
                phase: MANAGED_PHASE.ERROR,
                message: MESSAGES.NOTICE_TAKE_OVER_DECLINED(ownerName),
            });
            return;
        }
        this.journal.lifecycle(
            `take-over accepted: asking the server of ${ownerName}${owner?.pid != null ? ` (pid ${owner.pid})` : ""} to exit`,
        );
        if (owner && !(await askServerToExit(owner.dataDir, TAKE_OVER_SHUTDOWN_TIMEOUT_MS))) {
            this.journal.lifecycle(`take-over failed: the server of ${ownerName} did not stop when asked`);
            new Notice(MESSAGES.NOTICE_TAKE_OVER_TIMEOUT);
            this.updateStatusBar(MESSAGES.STATUS_LOCKED_BY_OTHER(ownerName), DOT_STATE.MUTED);
            return;
        }
        this.journal.lifecycle(`take-over complete: the server of ${ownerName} is gone; starting ours`);
        new Notice(MESSAGES.NOTICE_TAKE_OVER_SUCCESS(ownerName));
        await this.startManagedServer(onProgress, false);
    }

    /**
     * After a spawn, make the recorded version match what the binary reported.
     * A wrong record would otherwise make adoption replace our own healthy
     * server on every plugin reload. Never reconciled from an adopted server:
     * its version may be the stale one a later start is meant to replace.
     */
    private reconcileRecordedVersion(): void {
        const sm = this.serverManager;
        if (!sm || sm.isAdopted || !sm.spawnedVersion) return;
        const reported = sm.spawnedVersion.replace(/^v/, "");
        const recorded = this.getSharedLilbeeVersion();
        if (recorded.replace(/^v/, "") === reported) return;
        this.setSharedLilbeeVersion(`v${reported}`);
        this.journal.lifecycle(
            `recorded server version corrected to v${reported}${recorded ? ` (was ${recorded})` : ""}`,
        );
    }

    /** Data dir of a live server another vault started, or null. Our own live server is the adopt path, not a foreigner. */
    private async findLiveForeignServer(registry: VaultRegistry): Promise<string | null> {
        const ourDataDir = registry.resolveDataDir(this.vaultId);
        if (await serverIsLive(ourDataDir)) return null;
        const others = registry.list().map((e) => registry.resolveDataDir(e.id));
        const foreign = others.filter((dataDir) => dataDir !== ourDataDir);
        const live = await Promise.all(
            foreign.map(async (dataDir) => ((await serverIsLive(dataDir)) ? dataDir : null)),
        );
        return live.find((dataDir) => dataDir !== null) ?? null;
    }

    /** Display name of the registered vault whose server serves *dataDir*. */
    private lookupVaultNameByDataDir(dataDir: string): string {
        const registry = this.vaultRegistry;
        const entry = registry?.list().find((e) => registry.resolveDataDir(e.id) === dataDir);
        return entry?.displayName ?? "another vault";
    }

    /**
     * Gate run before a first-time managed binary download. When the binary is
     * already present we start straight away; otherwise we ask for consent and
     * route on the user's choice (download / switch-to-external / cancel).
     */
    async ensureManagedConsentThenStart(onProgress?: ManagedServerProgressHandler): Promise<SetupOutcome> {
        const registry = this.vaultRegistry;
        if (!registry) return { kind: SETUP_OUTCOME.CANCELED };

        const binaryPresent = new BinaryManager(sharedBinDir(registry.sharedRoot)).binaryExists();
        if (binaryPresent && !this.serverUninstalled) {
            await this.startManagedServer(onProgress);
            return { kind: SETUP_OUTCOME.STARTED, mode: SERVER_MODE.MANAGED };
        }

        // The gate owns the server lifecycle for each outcome, so it persists
        // directly via persistAll() rather than saveSettings() — the latter
        // would fire its own startManagedServer on a mode switch and race ours.
        const result = await new ManagedConsentModal(this.app, this.settings.includeDevBuilds).openConsent();
        if (result.kind === MANAGED_CONSENT_RESULT.DOWNLOAD) {
            this.settings.serverMode = SERVER_MODE.MANAGED;
            this.previousServerMode = SERVER_MODE.MANAGED;
            await this.persistAll();
            this.setServerUninstalled(false);
            await this.startManagedServer(onProgress);
            return { kind: SETUP_OUTCOME.STARTED, mode: SERVER_MODE.MANAGED };
        }
        if (result.kind === MANAGED_CONSENT_RESULT.EXTERNAL) {
            this.settings.serverMode = SERVER_MODE.EXTERNAL;
            this.previousServerMode = SERVER_MODE.EXTERNAL;
            await this.persistAll();
            this.configureApi(this.settings.serverUrl);
            this.setStatusReady();
            new Notice(MESSAGES.NOTICE_SWITCHED_TO_EXTERNAL);
            // Navigation to the external server settings is the caller's job:
            // onload opens the plugin Settings tab; the wizard reveals its own
            // inline URL/token fields. The gate itself never leaves the app.
            return { kind: SETUP_OUTCOME.SWITCHED_TO_EXTERNAL };
        }
        new Notice(MESSAGES.NOTICE_SERVER_DOWNLOAD_CANCELED);
        return { kind: SETUP_OUTCOME.CANCELED };
    }

    private buildServerManager(binaryPath: string, registry: VaultRegistry, sharedRoot: string): ServerManager {
        return new ServerManager({
            binaryPath,
            dataDir: registry.resolveDataDir(this.vaultId),
            sharedRoot,
            modelsDir: sharedModelsDir(sharedRoot),
            ragSystemPrompt: this.settings.ragSystemPrompt,
            generalSystemPrompt: this.settings.generalSystemPrompt,
            installedVersion: this.getSharedLilbeeVersion(),
            onStateChange: (state) => this.handleServerStateChange(state),
            onRestartsExhausted: (output: string) => {
                if (this.serverStartFailed) return;
                console.error(`[lilbee] server crashed; output:\n${output}`);
                this.journal.record("server-crash", MESSAGES.ERROR_SERVER_CRASHED, output || undefined);
                const detail = output ? `\n${output.split("\n").slice(-5).join("\n")}` : "";
                const notice = new Notice(`${MESSAGES.ERROR_SERVER_CRASHED}${detail}`, NOTICE_PERMANENT);
                this.attachExportLink(notice);
            },
            onShutdownFailure: (err: Error) => {
                new Notice(`${MESSAGES.ERROR_SERVER_SHUTDOWN_FAILED}: ${err.message}`);
            },
            onJournal: (message: string) => this.journal.lifecycle(message),
        });
    }

    private async confirmTakeOver(ownerName: string): Promise<boolean> {
        const modal = new ConfirmModal(this.app, MESSAGES.CONFIRM_TAKE_OVER(ownerName));
        modal.open();
        return modal.result;
    }

    /** Aborts the in-flight server download, if any. Set while a download runs. */
    private downloadController: AbortController | null = null;

    private startDownloadController(): AbortController {
        this.downloadController = new AbortController();
        return this.downloadController;
    }

    private finishDownload(): void {
        this.downloadController = null;
    }

    /** True while a server binary is downloading, so the UI can offer to stop it. */
    isDownloadingServer(): boolean {
        return this.downloadController !== null;
    }

    /** Stop an in-flight server download. The partial file is discarded; any installed binary stays. */
    cancelServerDownload(): void {
        this.downloadController?.abort();
    }

    private async ensureBinaryWithUi(onProgress?: ManagedServerProgressHandler): Promise<string | null> {
        const bm = this.binaryManager;
        if (!bm) return null;
        const needsDownload = !bm.binaryExists();
        if (needsDownload) {
            this.updateStatusBar(MESSAGES.STATUS_DOWNLOADING, DOT_STATE.PRIMARY);
            this.setStatusClass("lilbee-status-downloading");
            onProgress?.({ phase: MANAGED_PHASE.DOWNLOADING, message: MESSAGES.STATUS_DOWNLOADING });
        }
        try {
            const path = await bm.ensureBinary(
                this.settings.includeDevBuilds,
                (rawMsg, url, progress) => {
                    const percent = progress ? percentOfBytes(progress.receivedBytes, progress.totalBytes) : undefined;
                    const msg = progress ? downloadMessage(progress) : rawMsg;
                    this.updateStatusBar(progress ? downloadStatusBar(progress) : `lilbee: ${msg}`, DOT_STATE.PRIMARY);
                    onProgress?.({ phase: MANAGED_PHASE.DOWNLOADING, message: msg, url, percent });
                },
                () => this.showGatekeeperHelp(),
                this.startDownloadController().signal,
            );
            this.finishDownload();
            this.setStatusClass(null);
            return path;
        } catch (err) {
            this.finishDownload();
            this.setStatusClass(null);
            // Cancelling is a choice, not a failure: say so plainly and skip the error journal.
            if (err instanceof DownloadCanceledError) {
                new Notice(MESSAGES.NOTICE_DOWNLOAD_CANCELED);
                this.updateStatusBar(MESSAGES.STATUS_NOT_INSTALLED, DOT_STATE.MUTED, false);
            } else {
                this.showError("failed to download server", err);
            }
            onProgress?.({ phase: MANAGED_PHASE.ERROR, message: errorMessage(err, String(err)) });
            return null;
        }
    }

    /** Tell the user how to allow the unsigned server when macOS Gatekeeper blocks it. */
    private showGatekeeperHelp(): void {
        new GatekeeperModal(this.app).open();
    }

    private async recordLilbeeVersionAfterDownload(): Promise<void> {
        if (this.getSharedLilbeeVersion()) return;
        try {
            const release = await getLatestRelease(this.settings.includeDevBuilds);
            this.setSharedLilbeeVersion(release.tag);
            this.setSharedLilbeeVariant(release.variant);
        } catch {
            /* version tracking is best-effort */
        }
    }

    /** Persist the registry entry once the server is up. */
    private recordReadyState(): void {
        const sm = this.serverManager;
        const registry = this.vaultRegistry;
        if (!sm || !registry) return;
        const now = Date.now();
        const existing = registry.get(this.vaultId);
        registry.upsert({
            id: this.vaultId,
            displayName: existing?.displayName ?? this.getVaultDisplayName(),
            dataDir: sm.dataDir,
            obsidianVaultPath: this.getVaultBasePath(),
            addedAt: existing?.addedAt ?? now,
            lastActiveAt: now,
        });
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

    /** True when the shared bin dir holds a server binary this vault can run. */
    isServerInstalled(): boolean {
        const registry = this.vaultRegistry;
        if (!registry) return false;
        return new BinaryManager(sharedBinDir(registry.sharedRoot)).binaryExists();
    }

    /** Size what an uninstall would delete, so the confirmation can list it. */
    planServerUninstall(): UninstallPlan | null {
        const registry = this.vaultRegistry;
        if (!registry) return null;
        return planUninstall(registry.sharedRoot, registry.resolveDataDir(this.vaultId));
    }

    /**
     * Delete the server binary, the shared models, and this vault's index, then
     * remember the choice so no later launch downloads the server again.
     * Returns the bytes freed. Vault documents are never touched.
     */
    async uninstallServer(plan: UninstallPlan): Promise<number> {
        const registry = this.vaultRegistry;
        if (!registry) return 0;

        // The binary and the models are shared. Deleting them under another
        // vault's running server would break it mid-query.
        const owner = readScopeOwner(registry.sharedRoot);
        const ownDataDir = registry.resolveDataDir(this.vaultId);
        if (owner !== null && owner.dataDir !== ownDataDir) {
            throw new Error(MESSAGES.ERROR_UNINSTALL_SERVER_IN_USE(this.lookupVaultNameByDataDir(owner.dataDir)));
        }

        await this.serverManager?.stop();
        this.serverManager = null;
        this.binaryManager = null;
        // A server orphaned by a crashed Obsidian still writes to the data dir;
        // ask it to exit before deleting the tree out from under it.
        if (owner !== null) await askServerToExit(owner.dataDir, TAKE_OVER_SHUTDOWN_TIMEOUT_MS);

        executeUninstall(plan);

        registry.saveConfig({
            ...registry.loadConfig(),
            lilbeeVersion: "",
            lilbeeVariant: "",
            serverAutoUpdate: true,
            serverUninstalled: true,
        });
        this.serverUninstalled = true;
        this.serverEverReady = false;
        this.serverUnreachable = false;
        this.showNotInstalledStatus();
        return plan.totalBytes;
    }

    /** Download *release* and start it, clearing an earlier uninstall. */
    async installServer(release: ReleaseInfo, onProgress?: ServerDownloadProgressHandler): Promise<void> {
        this.setServerUninstalled(false);
        await this.updateServer(release, onProgress);
    }

    private showNotInstalledStatus(): void {
        this.updateStatusBar(MESSAGES.STATUS_NOT_INSTALLED, DOT_STATE.MUTED, false);
        this.setStatusClass(null);
    }

    async checkForUpdate(): Promise<{ available: boolean; release?: ReleaseInfo }> {
        const release = await getLatestRelease(this.settings.includeDevBuilds);
        const versionChanged = checkForUpdate(this.getSharedLilbeeVersion(), release.tag);
        // A known installed variant that differs from the detected one means the
        // hardware-appropriate build changed (e.g. an NVIDIA driver was added).
        const installedVariant = this.getSharedLilbeeVariant();
        const variantChanged = installedVariant !== "" && installedVariant !== release.variant;
        if (versionChanged || variantChanged) {
            return { available: true, release };
        }
        return { available: false };
    }

    /** Once per plugin version, fetch the latest server release and install it if newer. */
    private async autoUpdateServerBinary(): Promise<void> {
        const registry = this.vaultRegistry;
        if (!registry) return;
        if (this.serverUninstalled) return;
        const config = registry.loadConfig();
        if (!config.serverAutoUpdate) {
            this.journal.lifecycle("automatic server update skipped: turned off in settings");
            return;
        }
        if (config.lastUpdateCheckPluginVersion === this.manifest.version) return;
        let result: { available: boolean; release?: ReleaseInfo };
        try {
            result = await this.checkForUpdate();
        } catch {
            // offline or rate-limited; the next load retries
            return;
        }
        registry.saveConfig({ ...config, lastUpdateCheckPluginVersion: this.manifest.version });
        if (!result.available || !result.release) return;
        const release = result.release;
        const notice = new Notice(MESSAGES.NOTICE_SERVER_AUTO_UPDATING(release.tag), NOTICE_PERMANENT);
        try {
            await this.updateServer(release);
            new Notice(MESSAGES.NOTICE_SERVER_AUTO_UPDATED(release.tag));
        } catch {
            new Notice(MESSAGES.NOTICE_SERVER_AUTO_UPDATE_FAILED, NOTICE_ERROR_DURATION_MS);
        } finally {
            notice.hide();
        }
    }

    /** External mode: on launch, tell the user when the running server is not the
     *  latest release. Best-effort — silent when offline or the server is unreachable. */
    private async warnExternalServerOutdated(): Promise<void> {
        try {
            const health = await this.api.health();
            if (health.isErr()) return;
            const latest = (await getLatestRelease(this.settings.includeDevBuilds)).tag.replace(/^v/, "");
            if (!latest || !isVersionOlder(health.value.version, latest)) return;
            // NOTICE_PERMANENT keeps it up until the user clicks it away.
            new Notice(MESSAGES.NOTICE_EXTERNAL_SERVER_OUTDATED(health.value.version, latest), NOTICE_PERMANENT);
        } catch {
            // offline, unreachable, or rate-limited — stay quiet
        }
    }

    async updateServer(release: ReleaseInfo, onProgress?: ServerDownloadProgressHandler): Promise<void> {
        const registry = this.vaultRegistry;
        if (!registry) return;
        this.journal.lifecycle(
            `updating server binary: ${this.getSharedLilbeeVersion() || "(unknown)"} -> ${release.tag}`,
        );
        if (!this.binaryManager) {
            this.binaryManager = new BinaryManager(sharedBinDir(registry.sharedRoot));
        }

        // Stop the running server first
        if (this.serverManager) {
            onProgress?.("Stopping server...");
            await this.serverManager.stop();
            this.serverManager = null;
        }

        // Download the new binary (replaces the old one once its checksum clears)
        onProgress?.("Downloading...");
        try {
            await this.binaryManager.download(
                release.assetUrl,
                release.sizeBytes,
                release.digest,
                (msg, _url, progress) => {
                    if (!progress) {
                        onProgress?.(msg);
                        return;
                    }
                    onProgress?.(
                        downloadMessage(progress),
                        percentOfBytes(progress.receivedBytes, progress.totalBytes),
                    );
                },
                () => this.showGatekeeperHelp(),
                this.startDownloadController().signal,
            );
        } finally {
            this.finishDownload();
        }

        // Save the new version and the build variant we just installed
        this.setSharedLilbeeVersion(release.tag);
        this.setSharedLilbeeVariant(release.variant);
        this.journal.lifecycle(`server binary updated to ${release.tag}`);

        // Restart if in managed mode
        if (this.settings.serverMode === SERVER_MODE.MANAGED) {
            onProgress?.("Starting server...");
            await this.startManagedServer();
        }

        onProgress?.("Update complete.");
    }

    /** Journal lilbee-originated window errors and unhandled rejections. */
    private registerErrorCapture(): void {
        this.registerDomEvent(window, "error", (e: ErrorEvent) => {
            const stack: string = e.error instanceof Error ? (e.error.stack ?? "") : "";
            if (stack.includes("lilbee")) this.journal.record("window", e.message, stack);
        });
        this.registerDomEvent(window, "unhandledrejection", (e: PromiseRejectionEvent) => {
            const reason: unknown = e.reason;
            if (!(reason instanceof Error)) return;
            const stack = reason.stack ?? "";
            if (stack.includes("lilbee")) this.journal.record("unhandledrejection", reason.message, stack);
        });
    }

    private attachExportLink(notice: Notice): void {
        const link = notice.messageEl.createEl("a", { text: MESSAGES.BUTTON_EXPORT_DIAGNOSTICS });
        link.addEventListener("click", () => void exportDiagnostics(this.diagnosticsContext()));
    }

    /** Snapshot of plugin + server state for the diagnostics collector. */
    diagnosticsContext(): DiagnosticsContext {
        return {
            dataDir: this.serverManager?.dataDir ?? null,
            sharedRoot: this.vaultRegistry?.sharedRoot ?? null,
            settings: this.settings,
            journalEntries: this.journal.entries,
            pluginVersion: this.manifest.version,
            serverVersion: this.getSharedLilbeeVersion(),
            serverState: this.serverManager?.state ?? SERVER_STATE.STOPPED,
            serverUrl: this.serverManager?.serverUrl ?? this.settings.serverUrl,
            lastOutput: this.serverManager?.lastOutput ?? "",
        };
    }

    private showError(label: string, err: unknown): void {
        const detail = errorMessage(err, String(err));
        this.journal.record(label, detail, err instanceof Error ? err.stack : undefined);
        console.error(`[lilbee] ${label}:`, err);
        const output = this.serverManager?.lastOutput;
        if (output) console.error(`[lilbee] server output:\n${output}`);
        const outputTail = output ? `\n${output.split("\n").slice(-5).join("\n")}` : "";
        const notice = new Notice(`lilbee: ${label} — ${detail}${outputTail}`, NOTICE_ERROR_DURATION_MS);
        if (this.serverManager !== null) this.attachExportLink(notice);
        this.updateStatusBar(MESSAGES.STATUS_ERROR, DOT_STATE.ERROR);
        this.setStatusClass(null);
        this.serverStartFailed = true;
    }

    private handleServerStateChange(state: ServerState): void {
        // The managed child fires state transitions even after the user has
        // switched to External mode (e.g. STOPPED on the way out). Painting
        // "stopped" / "starting" / "error" from a now-irrelevant managed
        // process would lie about the user's actually-reachable external
        // server, so external mode owns its own status — set optimistically
        // by saveSettings on the mode switch and corrected by the health
        // probe thereafter.
        if (this.settings.serverMode === SERVER_MODE.EXTERNAL) return;
        switch (state) {
            case SERVER_STATE.READY:
                if (this.serverManager) {
                    this.configureApi(this.serverManager.serverUrl);
                }
                this.serverUnreachable = false;
                this.serverEverReady = true;
                this.setStatusReady();
                this.refreshSettingsTab();
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
                this.updateStatusBar(MESSAGES.STATUS_STOPPED, DOT_STATE.MUTED);
                this.setStatusClass(null);
                break;
        }
    }

    private getVaultBasePath(): string {
        const adapter = this.app.vault.adapter as unknown as VaultAdapter;
        return adapter.getBasePath();
    }

    /**
     * Read the lilbee session token.
     *
     * Managed mode: server-manager's dataDir owns the token. `manualToken`
     * is only consulted in external mode -- sending an external-mode paste
     * to the managed server produces a misleading "paste a new token" error.
     *
     * External mode: auto-discovers the user's data root the same way lilbee
     * itself does (LILBEE_DATA env > .lilbee walk-up > platform default).
     */
    readCurrentToken(): string | null {
        if (this.settings.serverMode === SERVER_MODE.MANAGED) {
            return this.serverManager ? readSessionToken(this.serverManager.dataDir) : null;
        }
        if (this.settings.manualToken) {
            return this.settings.manualToken;
        }
        const dataRoot = resolveExternalDataRoot(this.getVaultBasePath());
        return readSessionToken(dataRoot);
    }

    /** Point the API client at *baseUrl* and re-bind the hooks. Updates the
     * existing client instance in place so any caller already mid-await on
     * fetchWithRetry (waiting for the server to come up) sees the new URL
     * land instead of being orphaned on a replaced reference. */
    private configureApi(baseUrl: string): void {
        this.api.setBaseUrl(baseUrl);
        this.api.setTokenProvider(() => this.readCurrentToken());
        this.api.setToken(this.readCurrentToken());
        this.api.setOutcomeCallback((outcome) => this.handleRequestOutcome(outcome));
    }

    /** Update the status bar to reflect the latest API outcome. */
    private handleRequestOutcome(outcome: RequestOutcome): void {
        if (outcome === REQUEST_OUTCOME.OK) {
            this.setStatusReady();
            return;
        }
        if (outcome === REQUEST_OUTCOME.AUTH_ERROR) {
            this.updateStatusBar(MESSAGES.STATUS_AUTH_ERROR, DOT_STATE.ERROR);
            this.setStatusClass("lilbee-status-error");
            return;
        }
        if (outcome === REQUEST_OUTCOME.SERVER_ERROR || outcome === REQUEST_OUTCOME.UNREACHABLE) {
            // Before the managed server has ever reached READY, a failed
            // request means it's still coming up — don't flash a red error.
            if (this.settings.serverMode === SERVER_MODE.MANAGED && !this.serverEverReady) return;
            this.updateStatusBar(MESSAGES.STATUS_ERROR, DOT_STATE.ERROR);
            this.setStatusClass("lilbee-status-error");
        }
        // "starting" is a no-op — the existing startup UI already says so.
    }

    /**
     * Whether lilbee can actually serve requests right now. Managed mode
     * needs a live server-manager that isn't flagged unreachable; external
     * mode trusts the user's server until a probe says otherwise.
     *
     * Server-dependent commands gate their checkCallback on this so the
     * command palette doesn't offer (and silently fail) catalog / chat /
     * crawl / sync while the managed server is stopped — when it's down,
     * the only lilbee command offered is the one that starts it.
     */
    private isLilbeeReady(): boolean {
        if (this.settings.serverMode === SERVER_MODE.EXTERNAL) {
            return !this.serverUnreachable;
        }
        return this.serverManager !== null && !this.serverUnreachable;
    }

    private registerCommands(): void {
        this.addCommand({
            id: "search",
            name: MESSAGES.COMMAND_SEARCH,
            checkCallback: (checking) => {
                if (!this.isLilbeeReady()) return false;
                if (!checking) new SearchModal(this.app, this).open();
                return true;
            },
        });

        this.addCommand({
            id: "chat",
            name: MESSAGES.COMMAND_CHAT,
            checkCallback: (checking) => {
                if (!this.isLilbeeReady()) return false;
                if (!checking) void this.activateChatView();
                return true;
            },
        });

        this.addCommand({
            id: "open-memories",
            name: MESSAGES.COMMAND_MEMORIES,
            checkCallback: (checking) => {
                if (!this.isLilbeeReady()) return false;
                if (!checking) void this.activateMemoriesView();
                return true;
            },
        });

        this.addCommand({
            id: "open-placement",
            name: MESSAGES.COMMAND_PLACEMENT,
            checkCallback: (checking) => {
                if (!this.isLilbeeReady()) return false;
                if (!checking) void this.openPlacementGated(() => this.activatePlacementView());
                return true;
            },
        });

        this.addCommand({
            id: "open-placement-beside-chat",
            name: MESSAGES.COMMAND_PLACEMENT_BESIDE_CHAT,
            checkCallback: (checking) => {
                if (!this.isLilbeeReady()) return false;
                const chatLeaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_CHAT)[0];
                if (!chatLeaf) return false;
                if (!checking) void this.openPlacementGated(() => this.openPlacementBesideChat(chatLeaf));
                return true;
            },
        });

        this.addCommand({
            id: "remember",
            name: MESSAGES.COMMAND_REMEMBER,
            checkCallback: (checking) => {
                if (!this.isLilbeeReady()) return false;
                if (!checking) new RememberModal(this.app, this).open();
                return true;
            },
        });

        this.addCommand({
            id: "add-file",
            name: MESSAGES.COMMAND_ADD_FILE,
            checkCallback: (checking) => {
                if (!this.isLilbeeReady()) return false;
                const file = this.app.workspace.getActiveFile();
                if (!file) return false;
                if (!checking) void this.addToLilbee(file);
                return true;
            },
        });

        this.addCommand({
            id: "add-folder",
            name: MESSAGES.COMMAND_ADD_FOLDER,
            checkCallback: (checking) => {
                if (!this.isLilbeeReady()) return false;
                const file = this.app.workspace.getActiveFile();
                const folder = file?.parent;
                if (!folder) return false;
                if (!checking) void this.addToLilbee(folder);
                return true;
            },
        });

        this.addCommand({
            id: "sync",
            name: MESSAGES.COMMAND_SYNC,
            checkCallback: (checking) => {
                if (!this.isLilbeeReady()) return false;
                if (!checking) void this.triggerSync();
                return true;
            },
        });

        this.addCommand({
            id: "sync-retry-skipped",
            name: MESSAGES.COMMAND_SYNC_RETRY_SKIPPED,
            checkCallback: (checking) => {
                if (!this.isLilbeeReady()) return false;
                if (!checking) void this.triggerSync({ retrySkipped: true });
                return true;
            },
        });

        this.addCommand({
            id: "sync-rebuild",
            name: MESSAGES.COMMAND_SYNC_REBUILD,
            checkCallback: (checking) => {
                if (!this.isLilbeeReady()) return false;
                if (!checking) {
                    void (async () => {
                        const confirmModal = new ConfirmModal(this.app, MESSAGES.CONFIRM_SYNC_REBUILD);
                        confirmModal.open();
                        if (await confirmModal.result) void this.triggerSync({ forceRebuild: true });
                    })();
                }
                return true;
            },
        });

        this.addCommand({
            id: "export-dataset",
            name: MESSAGES.COMMAND_EXPORT_DATASET,
            checkCallback: (checking) => {
                if (!this.isLilbeeReady()) return false;
                if (!checking) void exportDatasetToDisk(this.api);
                return true;
            },
        });

        this.addCommand({
            id: "import-dataset",
            name: MESSAGES.COMMAND_IMPORT_DATASET,
            checkCallback: (checking) => {
                if (!this.isLilbeeReady()) return false;
                if (!checking) void importDatasetFromDisk(this.app, this.api, this.taskQueue);
                return true;
            },
        });

        this.addCommand({
            id: "catalog",
            name: MESSAGES.COMMAND_CATALOG,
            checkCallback: (checking) => {
                if (!this.isLilbeeReady()) return false;
                if (!checking) new CatalogModal(this.app, this).open();
                return true;
            },
        });

        this.addCommand({
            id: "model-picker-chat",
            name: MESSAGES.COMMAND_MODEL_PICKER_CHAT,
            checkCallback: (checking) => {
                if (!this.isLilbeeReady()) return false;
                if (!checking) new ModelPickerModal(this.app, this, MODEL_TASK.CHAT).open();
                return true;
            },
        });

        this.addCommand({
            id: "model-picker-embedding",
            name: MESSAGES.COMMAND_MODEL_PICKER_EMBED,
            checkCallback: (checking) => {
                if (!this.isLilbeeReady()) return false;
                if (!checking) new ModelPickerModal(this.app, this, MODEL_TASK.EMBEDDING).open();
                return true;
            },
        });

        this.addCommand({
            id: "model-info-active-chat",
            name: MESSAGES.COMMAND_MODEL_INFO_CHAT,
            checkCallback: (checking) => {
                if (!this.isLilbeeReady()) return false;
                if (!checking) void this.openModelInfoForActiveTask(MODEL_TASK.CHAT);
                return true;
            },
        });

        this.addCommand({
            id: "model-info-active-embedding",
            name: MESSAGES.COMMAND_MODEL_INFO_EMBED,
            checkCallback: (checking) => {
                if (!this.isLilbeeReady()) return false;
                if (!checking) void this.openModelInfoForActiveTask(MODEL_TASK.EMBEDDING);
                return true;
            },
        });

        this.addCommand({
            id: "crawl",
            name: MESSAGES.COMMAND_CRAWL,
            checkCallback: (checking) => {
                if (!this.isLilbeeReady()) return false;
                if (!checking) new CrawlModal(this.app, this).open();
                return true;
            },
        });

        this.addCommand({
            id: "documents",
            name: MESSAGES.COMMAND_DOCUMENTS,
            checkCallback: (checking) => {
                if (!this.isLilbeeReady()) return false;
                if (!checking) new DocumentsModal(this.app, this).open();
                return true;
            },
        });

        this.addCommand({
            id: "setup",
            name: MESSAGES.COMMAND_SETUP,
            callback: () => new SetupWizard(this.app, this).open(),
        });

        this.addCommand({
            id: "tasks",
            name: MESSAGES.COMMAND_TASKS,
            callback: () => this.activateTaskView(),
        });

        this.addCommand({
            id: "arrange-views",
            name: "Arrange views",
            callback: () => this.arrangeViews(),
        });

        this.addCommand({
            id: "wiki",
            name: MESSAGES.COMMAND_WIKI,
            checkCallback: (checking) => {
                if (!this.wikiEnabled) return false;
                if (!checking) void this.activateWikiView();
                return true;
            },
        });

        this.addCommand({
            id: "wiki-lint",
            name: MESSAGES.COMMAND_WIKI_LINT,
            checkCallback: (checking) => {
                if (!this.wikiEnabled) return false;
                if (!checking) void this.runWikiLint();
                return true;
            },
        });

        this.addCommand({
            id: "wiki-drafts",
            name: MESSAGES.COMMAND_REVIEW_DRAFTS,
            checkCallback: (checking) => {
                if (!this.wikiEnabled) return false;
                if (!checking) new DraftModal(this.app, this).open();
                return true;
            },
        });

        this.addCommand({
            id: "wiki-generate",
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
            id: "status",
            name: MESSAGES.COMMAND_STATUS,
            callback: () => new StatusModal(this.app, this).open(),
        });

        // Plain callback: exporting diagnostics must work while the server is down.
        this.addCommand({
            id: "export-diagnostics",
            name: MESSAGES.BUTTON_EXPORT_DIAGNOSTICS,
            callback: () => void exportDiagnostics(this.diagnosticsContext()),
        });

        this.addCommand({
            id: "take-over",
            name: MESSAGES.COMMAND_TAKE_OVER,
            checkCallback: (checking) => {
                if (this.settings.serverMode !== SERVER_MODE.MANAGED) return false;
                if (this.serverManager !== null) return false;
                if (!checking) void this.startManagedServer();
                return true;
            },
        });
    }

    /**
     * Re-point this vault at a different lilbee data-dir. Used by Settings →
     * "Use existing lilbee data directory" so a user can adopt an existing
     * `lilbee serve` data-dir or one they moved manually from the old layout.
     */
    async adoptDataDir(dataDir: string): Promise<void> {
        const registry = this.vaultRegistry;
        if (!registry) return;
        const existing = registry.get(this.vaultId);
        const now = Date.now();
        registry.upsert({
            id: this.vaultId,
            displayName: existing?.displayName ?? this.getVaultDisplayName(),
            dataDir,
            obsidianVaultPath: this.getVaultBasePath(),
            addedAt: existing?.addedAt ?? now,
            lastActiveAt: now,
        });
        this.journal.lifecycle(`re-pointing this vault at data dir ${dataDir}`);
        if (this.serverManager) {
            await this.serverManager.stop();
            this.serverManager = null;
        }
        if (this.settings.serverMode === SERVER_MODE.MANAGED) {
            await this.startManagedServer();
        }
    }

    onunload(): void {
        this.unloaded = true;
        if (this.pendingHintTimeout) {
            window.clearTimeout(this.pendingHintTimeout);
            this.pendingHintTimeout = null;
        }
        // Tear down the status-bar items we own. addStatusBarItem returns
        // DOM nodes that survive plugin unload if the plugin doesn't detach
        // them explicitly, so a disable/enable cycle leaves stale duplicates
        // in the bar that the new plugin instance then sits next to.
        this.statusBarEl?.remove();
        this.statusBarEl = null;
        this.syncPillEl?.remove();
        this.syncPillEl = null;
        this.taskQueue.dispose();
        if (this.serverManager) {
            this.journal.lifecycle("plugin unloading; stopping the managed server");
            void this.serverManager.stop();
        }
    }

    async loadSettings(): Promise<void> {
        const raw = (await this.loadData()) as (LilbeeSettings & { taskHistory?: { history?: unknown[] } }) | null;
        this.settings = Object.assign({}, DEFAULT_SETTINGS, raw ?? {});
        this.previousServerMode = this.settings.serverMode;
        this.taskQueue.loadFromJSON(raw?.taskHistory as { history?: import("./types").TaskEntry[] } | undefined);
        this.vaultId = computeVaultId(this.getVaultBasePath());
        this.vaultRegistry = new VaultRegistry(resolveSharedRoot(this.settings.sharedRoot));
        this.serverUninstalled = this.vaultRegistry.loadConfig().serverUninstalled;
    }

    /** Mirrors `SharedConfig.serverUninstalled`; read on every status paint and health probe. */
    private serverUninstalled = false;

    isServerUninstalled(): boolean {
        return this.serverUninstalled;
    }

    setServerUninstalled(uninstalled: boolean): void {
        this.serverUninstalled = uninstalled;
        const reg = this.vaultRegistry;
        if (!reg) return;
        reg.saveConfig({ ...reg.loadConfig(), serverUninstalled: uninstalled });
    }

    getSharedLilbeeVersion(): string {
        return this.vaultRegistry?.loadConfig().lilbeeVersion ?? "";
    }

    setSharedLilbeeVersion(version: string): void {
        const reg = this.vaultRegistry;
        if (!reg) return;
        reg.saveConfig({ ...reg.loadConfig(), lilbeeVersion: version });
    }

    getSharedLilbeeVariant(): ServerVariant | "" {
        return this.vaultRegistry?.loadConfig().lilbeeVariant ?? "";
    }

    setSharedLilbeeVariant(variant: ServerVariant): void {
        const reg = this.vaultRegistry;
        if (!reg) return;
        reg.saveConfig({ ...reg.loadConfig(), lilbeeVariant: variant });
    }

    isServerAutoUpdateEnabled(): boolean {
        return this.vaultRegistry?.loadConfig().serverAutoUpdate ?? true;
    }

    setServerAutoUpdate(enabled: boolean): void {
        const reg = this.vaultRegistry;
        if (!reg) return;
        const config = reg.loadConfig();
        if (config.serverAutoUpdate === enabled) return;
        reg.saveConfig({ ...config, serverAutoUpdate: enabled });
        this.journal.lifecycle(enabled ? "automatic server updates turned on" : "automatic server updates turned off");
    }

    getSharedHfToken(): string {
        return this.vaultRegistry?.loadConfig().hfToken ?? "";
    }

    setSharedHfToken(token: string): void {
        const reg = this.vaultRegistry;
        if (!reg) return;
        reg.saveConfig({ ...reg.loadConfig(), hfToken: token });
    }

    private getVaultDisplayName(): string {
        const path = this.getVaultBasePath();
        const base = path.split("/").filter(Boolean).pop();
        return base ?? "vault";
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
                this.journal.lifecycle("server mode switched to managed; starting the managed server");
                void this.startManagedServer();
            }
        } else {
            if (previousMode === SERVER_MODE.MANAGED) {
                this.journal.lifecycle("server mode switched to external; stopping the managed server");
                void this.serverManager?.stop();
                this.serverManager = null;
                this.binaryManager = null;
            }
            this.configureApi(this.settings.serverUrl);
            // External mode owns its own status via the health probe; paint
            // "ready [external]" optimistically so the user doesn't see a
            // stale "stopped" label between the mode switch and the next
            // probe tick. If the external server is in fact unreachable,
            // the probe will flip to error on its next run.
            this.setStatusReady();
            void this.fetchActiveModel();
        }
    }

    private updateStatusBar(text: string, dotState: DotState | null = null, withModel = true): void {
        if (!this.statusBarEl) return;
        const label = withModel ? displayLabelForRef(this.activeModel) : "";
        const model = label ? ` (${label})` : "";
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
        if (this.settings.serverMode === SERVER_MODE.MANAGED && this.serverUninstalled) {
            this.showNotInstalledStatus();
            return;
        }
        // Managed mode without a running serverManager is the "released"
        // state (after switch-to-another-vault or onunload). Stay stuck
        // on STOPPED instead of cheerfully claiming "ready" against a
        // server that isn't running.
        if (this.settings.serverMode === SERVER_MODE.MANAGED && this.serverManager === null) {
            this.updateStatusBar(MESSAGES.STATUS_STOPPED, DOT_STATE.MUTED, false);
            this.setStatusClass(null);
            return;
        }
        // The main pill always shows running status, plainly and prominently.
        // Pending-sync work lives on the separate sync pill, never here.
        const text =
            this.settings.serverMode === SERVER_MODE.EXTERNAL ? MESSAGES.STATUS_READY_EXTERNAL : MESSAGES.STATUS_READY;
        this.updateStatusBar(text);
        this.setStatusClass("lilbee-status-ready");
    }

    private startHealthProbe(): void {
        if (this.healthProbeHandle !== null) return;
        const handle = window.setInterval(() => void this.probeServerHealth(), HEALTH_PROBE_INTERVAL_MS);
        this.registerInterval(handle);
        this.healthProbeHandle = handle;
    }

    private async probeServerHealth(): Promise<void> {
        if (this.taskQueue.activeAll.length > 0) return;
        if (this.startingServer) return;
        if (this.chatInFlight > 0) return;
        // Nothing to probe, and "error" would misread a deliberate uninstall.
        if (this.serverUninstalled) return;
        // Re-read the token before probing — the server writes a fresh one on
        // every restart, and this is the cheapest way to stay in sync.
        this.api.setToken(this.readCurrentToken());
        const health = await this.api.health().catch(() => null);
        if (health?.isOk()) {
            this.healthFailureStreak = 0;
            if (this.settings.serverMode === SERVER_MODE.EXTERNAL) this.externalServerVersion = health.value.version;
            if (this.serverUnreachable) {
                this.serverUnreachable = false;
                void this.fetchActiveModel();
            } else {
                // Keep the status-bar model in sync with out-of-band changes
                // (CLI/TUI/another client switching the chat model) while the
                // server stays connected.
                void this.refreshActiveModel();
            }
            this.reflectChatWarmth(health.value);
            return;
        }
        this.healthFailureStreak += 1;
        if (this.healthFailureStreak < HEALTH_FAILURE_STREAK_THRESHOLD) return;
        // Managed mode, pre-first-ready (fresh install, wizard still
        // downloading/booting): a failing probe is "starting", not "error".
        // Don't paint a red pill. External mode reports errors normally —
        // it points at a server the user already runs.
        if (this.settings.serverMode === SERVER_MODE.MANAGED && !this.serverEverReady) return;
        if (this.serverUnreachable) return;
        this.serverUnreachable = true;
        this.updateStatusBar(MESSAGES.STATUS_ERROR, DOT_STATE.ERROR);
        this.setStatusClass("lilbee-status-error");
        this.maybeWarnMissingToken();
    }

    /** Reflect the chat engine's warm state from a health snapshot: show a warming
     * pill while it cold-loads, and revert to ready once it is warm. Older servers
     * omit `chat_ready`, which we treat as ready. */
    private reflectChatWarmth(health: HealthResponse): void {
        const warming = health.chat_ready === false;
        if (warming === this.chatWarming) return;
        this.chatWarming = warming;
        if (warming) {
            this.updateStatusBar(MESSAGES.STATUS_WARMING, DOT_STATE.PRIMARY);
            this.setStatusClass("lilbee-status-starting");
        } else {
            this.setStatusReady();
        }
    }

    notifyChatStart(): void {
        this.chatInFlight += 1;
    }

    notifyChatEnd(): void {
        if (this.chatInFlight > 0) this.chatInFlight -= 1;
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

        const first = allActive[0];
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

    async openModelInfoForActiveTask(task: typeof MODEL_TASK.CHAT | typeof MODEL_TASK.EMBEDDING): Promise<void> {
        let cfg: Record<string, unknown>;
        try {
            cfg = await this.api.config();
        } catch {
            new Notice(MESSAGES.NOTICE_NO_ACTIVE_MODEL(task));
            return;
        }
        const key = task === MODEL_TASK.CHAT ? "chat_model" : "embedding_model";
        const ref = typeof cfg[key] === "string" ? cfg[key] : "";
        if (!ref) {
            new Notice(MESSAGES.NOTICE_NO_ACTIVE_MODEL(task));
            return;
        }

        const repo = extractHfRepo(ref);
        const result = await this.api.catalog({ task, search: repo });
        if (result.isErr()) {
            new Notice(MESSAGES.NOTICE_NO_ACTIVE_MODEL(task));
            return;
        }
        const entry = result.value.models.find((e) => e.hf_repo === repo) ?? result.value.models[0];
        if (!entry) {
            new Notice(MESSAGES.NOTICE_NO_ACTIVE_MODEL(task));
            return;
        }
        new ModelInfoModal(this.app, this, entry).open();
    }

    /** Lightweight active-model resync used on every healthy probe tick, so the
     *  status bar reflects an out-of-band chat-model change. Cheaper than
     *  fetchActiveModel (no wiki/reasoning work); repaints only on a change. */
    private async refreshActiveModel(): Promise<void> {
        try {
            const models = await this.api.listModels();
            if (models.chat.active === this.activeModel) return;
            this.activeModel = models.chat.active;
            if (!this.chatWarming) this.setStatusReady();
        } catch {
            // best-effort; the next probe tick retries
        }
    }

    async fetchActiveModel(): Promise<void> {
        try {
            const models = await this.api.listModels();
            this.activeModel = models.chat.active;
            this.setStatusReady();
            await this.applyReasoningDefaultOnce();
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

    /** Turn reasoning display on once, the first time we reach a ready server. */
    private async applyReasoningDefaultOnce(): Promise<void> {
        if (this.settings.reasoningDefaulted) return;
        // Patch only when the server reports it explicitly off; older servers omit the key.
        const cfg = await this.api.config();
        if (cfg.show_reasoning === false) {
            await this.api.updateConfig({ [CONFIG_KEY.SHOW_REASONING]: true });
        }
        this.settings.reasoningDefaulted = true;
        await this.persistAll();
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

    /** Block chat and ingest while the fleet is (re)loading (chat_ready:false), so
     *  requests never hit a half-built fleet. Public so the chat view gates on it too. */
    assertFleetReady(): boolean {
        if (!this.chatWarming) return true;
        new Notice(MESSAGES.NOTICE_FLEET_WARMING);
        return false;
    }

    /** Saved conversations need the /api/sessions routes, which pre-0.6.90 servers
     *  don't have. Managed mode knows the install version up front; external mode
     *  fails open until the first health probe reports one. */
    serverSupportsSessions(): boolean {
        const version =
            this.settings.serverMode === SERVER_MODE.MANAGED
                ? this.getSharedLilbeeVersion()
                : this.externalServerVersion;
        return supportsSessions(version);
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
        if (!this.assertFleetReady()) return;
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
        if (this.settings.serverMode === SERVER_MODE.EXTERNAL) {
            // A remote server can't read the just-copied local paths, so send
            // the bytes — same upload route as the right-click "Add to lilbee".
            let uploads: UploadPayload[];
            try {
                uploads = this.readUploadsFromDisk(copiedPaths);
            } catch (err) {
                console.error("[lilbee] add failed:", err);
                new Notice(MESSAGES.ERROR_ADD_FAILED_DETAIL(errorMessage(err, MESSAGES.ERROR_CANNOT_CONNECT)));
                return;
            }
            await this.runUpload(uploads, paths, () => this.addExternalFiles(paths));
        } else {
            await this.runAdd(copiedPaths, paths, () => this.addExternalFiles(paths));
        }
    }

    /** Read every file under each path (recursing directories) off disk as
     *  upload payloads — for external mode, where the server can't read paths. */
    private readUploadsFromDisk(paths: string[]): UploadPayload[] {
        const out: UploadPayload[] = [];
        const walk = (p: string): void => {
            if (node.statSync(p).isDirectory()) {
                for (const child of node.readdirSync(p)) walk(node.join(p, child));
            } else {
                const buf = node.readFileSync(p);
                out.push({
                    name: node.basename(p),
                    data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
                });
            }
        };
        for (const p of paths) walk(p);
        return out;
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
        if (!this.assertFleetReady()) return;
        const absolutePath = `${this.getVaultBasePath()}/${file.path}`;
        // The vault root's name is the empty string and its path is "/", so
        // `?? file.path` doesn't fall back; both have to be checked.
        const name = file.name || file.path || MESSAGES.LABEL_VAULT_ROOT;

        const isRetry = this.failedAddPaths.has(absolutePath);
        if (!isRetry && !(await this.confirmReindexIfNeeded(name))) return;

        new Notice(MESSAGES.STATUS_ADDING.replace("{label}", name));
        if (this.settings.serverMode === SERVER_MODE.EXTERNAL) {
            // A remote server can't read this machine's paths, so send the file
            // bytes straight from the vault instead of a server-side path. The
            // read runs before runAdd's guard, so surface a failure here too.
            let uploads: { name: string; data: ArrayBuffer }[];
            try {
                uploads = await this.collectVaultUploads(file);
            } catch (err) {
                console.error("[lilbee] add failed:", err);
                new Notice(MESSAGES.ERROR_ADD_FAILED_DETAIL(errorMessage(err, MESSAGES.ERROR_CANNOT_CONNECT)));
                return;
            }
            await this.runUpload(uploads, [absolutePath], () => this.addToLilbee(file));
        } else {
            await this.runAdd([absolutePath], [absolutePath], () => this.addToLilbee(file));
        }
    }

    /** Read every file under *file* (recursing folders) as upload payloads. */
    private async collectVaultUploads(file: TAbstractFile): Promise<{ name: string; data: ArrayBuffer }[]> {
        const tfiles = file instanceof TFolder ? this.filesInFolder(file) : file instanceof TFile ? [file] : [];
        return Promise.all(tfiles.map(async (f) => ({ name: f.name, data: await this.app.vault.readBinary(f) })));
    }

    private filesInFolder(folder: TFolder): TFile[] {
        const out: TFile[] = [];
        for (const child of folder.children) {
            if (child instanceof TFile) out.push(child);
            else if (child instanceof TFolder) out.push(...this.filesInFolder(child));
        }
        return out;
    }

    /** Ingest by uploading file content (external mode); reuses runAdd's stream loop. */
    private async runUpload(
        files: { name: string; data: ArrayBuffer }[],
        retryKeys: string[],
        retry?: () => void | Promise<void>,
    ): Promise<void> {
        if (files.length === 0) {
            new Notice(MESSAGES.STATUS_NOTHING_NEW);
            return;
        }
        await this.runAdd(
            files.map((f) => f.name),
            retryKeys,
            retry,
            (signal) => this.uploadInBatches(files, signal),
            "Uploading files",
        );
    }

    /** Upload files in server-safe batches while presenting one continuous
     *  stream: progress counters are renumbered across the whole set, and a
     *  single merged done event is emitted after the last batch. */
    private async *uploadInBatches(files: UploadPayload[], signal: AbortSignal): AsyncGenerator<SSEEvent, void> {
        const batches = batchUploads(files);
        // One request: the server's counters already span the whole set — stream through untouched.
        if (batches.length <= 1) {
            yield* this.api.uploadFiles(files, signal);
            return;
        }
        const total = files.length;
        const merged: SyncDone = { added: [], updated: [], removed: [], unchanged: 0, failed: [], skipped: [] };
        let done = 0;
        for (const batch of batches) {
            for await (const event of this.api.uploadFiles(batch, signal)) {
                if (event.event === SSE_EVENT.DONE) {
                    const parsed = parseAddDoneEvent(event.data);
                    if (parsed) {
                        merged.added.push(...parsed.added);
                        merged.updated.push(...parsed.updated);
                        merged.removed.push(...parsed.removed);
                        merged.failed.push(...parsed.failed);
                        merged.skipped.push(...parsed.skipped);
                        merged.unchanged += parsed.unchanged;
                    }
                } else if (event.event === SSE_EVENT.FILE_START) {
                    const d = event.data as { current_file: number; total_files: number };
                    yield {
                        event: SSE_EVENT.FILE_START,
                        data: { current_file: done + d.current_file, total_files: total },
                    };
                } else if (event.event === SSE_EVENT.BATCH_PROGRESS) {
                    const d = event.data as BatchProgressPayload;
                    yield { event: SSE_EVENT.BATCH_PROGRESS, data: { ...d, current: done + d.current, total } };
                } else {
                    yield event;
                }
            }
            done += batch.length;
        }
        yield { event: SSE_EVENT.DONE, data: merged };
    }

    cancelSync(): void {
        this.syncController?.abort();
        this.syncController = null;
    }

    private async runAdd(
        paths: string[],
        retryKeys: string[] = paths,
        retry?: () => void | Promise<void>,
        makeStream?: (signal: AbortSignal) => AsyncGenerator<SSEEvent, void>,
        label = "Adding files",
    ): Promise<void> {
        const taskId = this.taskQueue.enqueue(label, TASK_TYPE.ADD, retry);
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
            const rawStream = makeStream
                ? makeStream(controller.signal)
                : this.api.addFiles(paths, true, controller.signal);
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
                } else if (event.event === SSE_EVENT.BATCH_PROGRESS) {
                    const d = event.data as BatchProgressPayload;
                    progress.completeFile(d.current, d.total);
                    this.taskQueue.update(
                        taskId,
                        progress.percent(),
                        MESSAGES.STATUS_TASK_BATCH(d.current, d.total, d.file, d.status),
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
                const msg = sessionTokenInvalidMessage(this.settings.serverMode);
                new Notice(msg);
                this.taskQueue.fail(taskId, msg);
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

    async activateTaskView(): Promise<void> {
        const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_TASKS);
        if (existing.length > 0) {
            void this.app.workspace.revealLeaf(existing[0]);
            return;
        }
        const leaf = this.app.workspace.getRightLeaf(false);
        if (leaf) {
            await leaf.setViewState({ type: VIEW_TYPE_TASKS, active: true });
            void this.app.workspace.revealLeaf(leaf);
        }
    }

    refreshOpenWikiViews(): void {
        for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_WIKI)) {
            void (leaf.view as WikiView).refresh();
        }
    }

    async activateMemoriesView(): Promise<void> {
        const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_MEMORIES);
        if (existing.length > 0) {
            void this.app.workspace.revealLeaf(existing[0]);
            return;
        }
        const leaf = this.app.workspace.getRightLeaf(false);
        if (leaf) {
            await leaf.setViewState({ type: VIEW_TYPE_MEMORIES, active: true });
            void this.app.workspace.revealLeaf(leaf);
        }
    }

    refreshMemoryViews(): void {
        for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_MEMORIES)) {
            void (leaf.view as MemoriesView).reload();
        }
    }

    // TODO: remove this dev-builds gate once the multi-GPU server ships in a stable release.
    /** GPU placement needs a dev-build server for now. Without the opt-in, explain
     *  and offer to jump straight to Settings, where both the toggle and the
     *  version picker live. */
    private async openPlacementGated(open: () => Promise<void>): Promise<void> {
        if (this.settings.includeDevBuilds) {
            await open();
            return;
        }
        const modal = new ConfirmModal(this.app, MESSAGES.PLACEMENT_DEV_BUILDS_PROMPT);
        modal.open();
        if (await modal.result) {
            this.revealDevBuildsInSettings = true;
            this.openPluginSettings();
        }
    }

    /** Open the placement view in a main-area tab (it is wider than the sidebar views). */
    async activatePlacementView(): Promise<void> {
        const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_PLACEMENT);
        if (existing.length > 0) {
            void this.app.workspace.revealLeaf(existing[0]);
            return;
        }
        if (this.openingPlacementLeaf) return;
        this.openingPlacementLeaf = true;
        try {
            // "tab" is the explicit form; the boolean getLeaf(true) is deprecated.
            const leaf = this.app.workspace.getLeaf("tab");
            if (leaf) {
                await leaf.setViewState({ type: VIEW_TYPE_PLACEMENT, active: true });
                void this.app.workspace.revealLeaf(leaf);
            }
        } finally {
            this.openingPlacementLeaf = false;
        }
    }

    private async openPlacementBesideChat(chatLeaf: WorkspaceLeaf): Promise<void> {
        if (this.openingPlacementLeaf) return;
        this.openingPlacementLeaf = true;
        try {
            await revealPlacementBeside(this.app, chatLeaf);
        } finally {
            this.openingPlacementLeaf = false;
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

    /**
     * Re-render the Settings tab if (and only if) the open tab is ours.
     * Called whenever server-owned state — active models, persisted config,
     * server reachability — changes from somewhere other than the Settings
     * UI itself, so the rendered controls don't lie about the live state.
     */
    refreshSettingsTab(): void {
        const setting = (this.app as unknown as { setting?: { activeTab?: unknown } }).setting;
        const activeTab = setting?.activeTab;
        if (activeTab instanceof LilbeeSettingTab) {
            activeTab.render();
        }
    }

    // Re-sync the model rail in every open chat view after a model is switched
    // elsewhere (e.g. the catalog), so the pills don't show a stale selection.
    refreshOpenChatRails(): void {
        for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_CHAT)) {
            const view = leaf.view;
            if (view instanceof ChatView) view.refreshRail();
        }
    }

    async activateWikiView(): Promise<void> {
        const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_WIKI);
        if (existing.length > 0) {
            void this.app.workspace.revealLeaf(existing[0]);
            return;
        }
        const leaf = this.app.workspace.getRightLeaf(false);
        if (leaf) {
            await leaf.setViewState({ type: VIEW_TYPE_WIKI, active: true });
            void this.app.workspace.revealLeaf(leaf);
        }
    }

    async activateChatView(): Promise<void> {
        const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_CHAT);
        if (existing.length > 0) {
            void this.app.workspace.revealLeaf(existing[0]);
            return;
        }
        if (this.openingChatLeaf) return;
        this.openingChatLeaf = true;
        try {
            const leaf = this.app.workspace.getRightLeaf(false);
            if (leaf) {
                await leaf.setViewState({ type: VIEW_TYPE_CHAT, active: true });
                void this.app.workspace.revealLeaf(leaf);
            }
        } finally {
            this.openingChatLeaf = false;
        }
    }

    /**
     * Tile the plugin's views as side-by-side columns in the main area: chat and
     * the Task Center always, plus wiki, memories, and placement when they are
     * already open. Reuses open leaves (chat keeps its conversation) and splits
     * any it has to create beside the previous one. Bind a hotkey in Settings → Hotkeys.
     */
    async arrangeViews(): Promise<void> {
        if (this.openingChatLeaf) return;
        this.openingChatLeaf = true;
        try {
            const workspace = this.app.workspace;
            const included = [
                VIEW_TYPE_CHAT,
                VIEW_TYPE_TASKS,
                VIEW_TYPE_WIKI,
                VIEW_TYPE_MEMORIES,
                VIEW_TYPE_PLACEMENT,
            ].filter(
                (type) =>
                    type === VIEW_TYPE_CHAT || type === VIEW_TYPE_TASKS || workspace.getLeavesOfType(type).length > 0,
            );
            let anchor: WorkspaceLeaf | null = null;
            for (const type of included) {
                let leaf = workspace.getLeavesOfType(type)[0] ?? null;
                if (!leaf) {
                    // Tile as side-by-side columns in the main area: a fresh tab
                    // for the first view, then vertical splits beside it.
                    leaf = anchor ? workspace.createLeafBySplit(anchor, "vertical") : workspace.getLeaf("tab");
                    if (!leaf) continue;
                    await leaf.setViewState({ type, active: true });
                }
                anchor = leaf;
            }
            for (const type of included) {
                const leaf = workspace.getLeavesOfType(type)[0];
                if (leaf) void workspace.revealLeaf(leaf);
            }
        } finally {
            this.openingChatLeaf = false;
        }
    }

    private registerPendingSyncHintWatchers(): void {
        const handler = (file: TAbstractFile) => {
            if (this.wikiSync?.isWikiPath(file.path)) return;
            // Skip paths the server itself writes into the vault — they're
            // already known sources, not work to sync.
            if (file.path.startsWith("lilbee/")) return;
            this.schedulePendingSyncHint();
        };
        const vault = this.app.vault;
        this.registerEvent(vault.on("create", handler));
        this.registerEvent(vault.on("modify", handler));
        this.registerEvent(vault.on("delete", handler));
        this.registerEvent(vault.on("rename", handler));
    }

    private schedulePendingSyncHint(): void {
        if (this.pendingHintTimeout) {
            window.clearTimeout(this.pendingHintTimeout);
        }
        this.pendingHintTimeout = window.setTimeout(() => {
            this.pendingHintTimeout = null;
            // Bail if the plugin was unloaded between scheduling and firing.
            // The statusBarEl guard inside updatePendingSyncHint covers this,
            // but the explicit check here keeps the contract local.
            if (!this.statusBarEl) return;
            void this.updatePendingSyncHint();
        }, PENDING_SYNC_HINT_DEBOUNCE_MS);
    }

    private async countPendingSync(): Promise<number> {
        // Only managed mode with vault storage points the server's documents_dir at
        // <vault>/lilbee; elsewhere Sync can't reconcile these files, so don't count them.
        if (this.settings.serverMode !== SERVER_MODE.MANAGED || !this.settings.storeContentInVault) {
            return 0;
        }
        // The vault adapter can be gone if the timer fires after the host
        // environment teared down (vitest end-of-file cleanup while a real
        // setTimeout was still pending). Bail cleanly instead of crashing.
        const files = this.app?.vault?.getFiles?.();
        if (!Array.isArray(files)) return 0;
        // Only count files inside lilbee's managed document folder
        // (<vault>/lilbee/). That's the scope `Sync vault` actually
        // reconciles. Loose vault notes live outside it and are indexed
        // only via the explicit Add action (which copies them in), so
        // counting them here would show a count that sync can never clear.
        const docFiles = files
            .filter((f) => SUPPORTED_SYNC_EXTENSIONS.has(f.extension.toLowerCase()))
            .filter((f) => f.path.startsWith(MANAGED_DOCS_PREFIX) && !this.wikiSync?.isWikiPath(f.path));
        const known = new Set<string>();
        try {
            // Page through the documents endpoint so we count every known
            // source, not just the first page. Match on basename: crawled
            // sources keep a relative path (_web/.../index.md) while added
            // files use a basename, so the basename is the common key.
            let offset = 0;
            const limit = 100;
            while (true) {
                const page = await this.api.listDocuments(undefined, limit, offset);
                for (const d of page.documents) known.add(basename(d.filename));
                if (!page.has_more || page.documents.length === 0) break;
                offset += page.documents.length;
            }
        } catch {
            // Server offline — leave the hint hidden rather than guessing.
            return 0;
        }
        return docFiles.filter((f) => !known.has(f.name)).length;
    }

    async updatePendingSyncHint(): Promise<void> {
        if (!this.syncPillEl) return;
        const count = await this.countPendingSync();
        if (!this.syncPillEl) return;
        // countPendingSync returns 0 when the server is unreachable, so the
        // pill naturally hides when lilbee isn't up — the main status pill
        // owns the running/stopped state, this one only the sync count.
        this.pendingSyncCount = count;
        if (count > 0) {
            this.syncPillEl.setText(MESSAGES.STATUS_SYNC_PILL(count));
            this.syncPillEl.show();
        } else {
            this.syncPillEl.hide();
        }
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
            this.refreshOpenWikiViews();
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
            this.refreshOpenWikiViews();
            // Reconcile vault after pruning
            if (this.wikiSync) {
                void this.reconcileWiki();
            }
        } catch (err) {
            const msg = errorMessage(err, MESSAGES.ERROR_UNKNOWN);
            this.taskQueue.fail(taskId, msg);
        }
    }

    async runCrawl(
        url: string,
        depth: number | null,
        maxPages: number | null,
        renderMode?: CrawlRenderMode,
        includeSubdomains?: boolean,
    ): Promise<void> {
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
            const rawStream = this.api.crawl(url, depth, maxPages, controller.signal, renderMode, includeSubdomains);
            for await (const event of withIdleTimeout(rawStream, STREAM_IDLE_TIMEOUT_MS, () => controller.abort())) {
                switch (event.event) {
                    case SSE_EVENT.SETUP_START: {
                        // Always surface the preparing-crawler stage on the crawl task —
                        // covers both the Chromium download and the first-run browser warmup.
                        this.taskQueue.update(taskId, -1, MESSAGES.STATUS_TASK_CRAWLER_PREPARING);
                        // Only track a separate download sub-task for a real install (one
                        // with a size estimate). The browser warmup has none and would
                        // otherwise show a misleading "0 MB" download.
                        const d = event.data as SetupStartPayload;
                        if (d.size_estimate_bytes && setupTaskId === null) {
                            setupTaskId = this.taskQueue.enqueue("Chromium setup", TASK_TYPE.SETUP);
                            if (setupTaskId !== null) {
                                this.taskQueue.update(setupTaskId, 0, formatSetupDetail(0, d.size_estimate_bytes));
                            }
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

    async triggerSync(options?: SyncOptions): Promise<void> {
        if (!this.statusBarEl) return;
        // Re-entry guard: if a sync is already active or queued, this trigger
        // is a no-op. Without it, repeated clicks (sync hint, command palette,
        // crawler-finished auto-trigger) stack up — and cancelling the active
        // task just promotes the next queued sync, making cancel feel broken.
        if (this.taskQueue.hasPending(TASK_TYPE.SYNC)) return;
        const taskId = this.taskQueue.enqueue(syncTaskLabel(options), TASK_TYPE.SYNC);
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
            const rawStream = this.api.syncStream(controller.signal, options);
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
                } else if (event.event === SSE_EVENT.BATCH_PROGRESS) {
                    const d = event.data as BatchProgressPayload;
                    progress.completeFile(d.current, d.total);
                    this.taskQueue.update(
                        taskId,
                        progress.percent(),
                        MESSAGES.STATUS_TASK_BATCH(d.current, d.total, d.file, d.status),
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
                const msg = sessionTokenInvalidMessage(this.settings.serverMode);
                new Notice(msg);
                this.taskQueue.fail(taskId, msg);
            } else {
                console.error("[lilbee] sync failed:", err);
                new Notice(MESSAGES.STATUS_SYNC_FAILED);
                this.taskQueue.fail(taskId, MESSAGES.ERROR_CANNOT_CONNECT);
            }
        } finally {
            this.syncController = null;
            this.schedulePendingSyncHint();
        }
    }
}
