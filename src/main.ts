import {
    type ItemView,
    type Menu,
    type MenuItem,
    Notice,
    Plugin,
    type TAbstractFile,
    type WorkspaceLeaf,
} from "obsidian";
import { LilbeeClient, SessionTokenError } from "./api";
import type { RequestOutcome } from "./api";
import { BinaryManager, getLatestRelease, checkForUpdate, node } from "./binary-manager";
import type { ReleaseInfo } from "./binary-manager";
import { ServerManager } from "./server-manager";
import { readSessionToken, resolveExternalDataRoot } from "./session-token";
import { LilbeeSettingTab } from "./settings";
import { VaultRegistry, computeVaultId, resolveSharedRoot, sharedBinDir, sharedModelsDir } from "./vault-registry";
import {
    DEFAULT_SETTINGS,
    DOT_STATE,
    ERROR_NAME,
    LOCK_STATE,
    MANAGED_CONSENT_RESULT,
    MANAGED_PHASE,
    SERVER_MODE,
    SERVER_STATE,
    SETUP_OUTCOME,
    SSE_EVENT,
    TASK_STATUS,
    TASK_TYPE,
    type ActiveLock,
    type BatchProgressPayload,
    type DotState,
    type LilbeeSettings,
    type ManagedServerProgressHandler,
    type ServerMode,
    type SetupOutcome,
    type ServerState,
    type ServerVariant,
    type SetupDonePayload,
    type SetupProgressPayload,
    type SetupStartPayload,
    type SyncDone,
    type SyncOptions,
    type TaskEntry,
    type VaultAdapter,
} from "./types";
import { MESSAGES } from "./locales/en";
import { displayLabelForRef, extractHfRepo } from "./utils/model-ref";
import {
    errorMessage,
    extractSseErrorMessage,
    HEALTH_FAILURE_STREAK_THRESHOLD,
    HEALTH_PROBE_INTERVAL_MS,
    NOTICE_DURATION_MS,
    NOTICE_ERROR_DURATION_MS,
    NOTICE_PERMANENT,
    sessionTokenInvalidMessage,
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

const SUPPORTED_SYNC_EXTENSIONS = new Set(["md", "pdf", "txt", "html"]);

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

export default class LilbeePlugin extends Plugin {
    settings: LilbeeSettings = { ...DEFAULT_SETTINGS };
    api: LilbeeClient = new LilbeeClient("");
    activeModel = "";
    statusBarEl: HTMLElement | null = null;
    syncPillEl: HTMLElement | null = null;
    ribbonIconEl: HTMLElement | null = null;
    chatRibbonIconEl: HTMLElement | null = null;
    binaryManager: BinaryManager | null = null;
    serverManager: ServerManager | null = null;
    vaultRegistry: VaultRegistry | null = null;
    vaultId = "";
    syncController: AbortController | null = null;
    private pendingSyncCount = 0;
    private pendingHintTimeout: ReturnType<typeof setTimeout> | null = null;
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
    // While > 0, probeServerHealth() bails: llama.cpp serializes requests,
    // so /api/health stalls behind the active stream and would falsely flip
    // the status bar to error.
    private chatInFlight = 0;
    // Counts consecutive failed probes against HEALTH_FAILURE_STREAK_THRESHOLD.
    private healthFailureStreak = 0;
    // The managed server has reached READY at least once this session. Until
    // it has, a failing health probe means "still coming up", not "error" —
    // so a fresh install / first-run wizard doesn't flash a red error pill
    // while the binary downloads and the server boots.
    private serverEverReady = false;

    async onload(): Promise<void> {
        await this.loadSettings();
        this.wikiEnabled = this.settings.wikiEnabled;

        // Sweep up status-bar items + ribbon icons that prior dead lilbee
        // instances left behind. Each crashed/incompletely-unloaded reload
        // accumulates more, so the corner ends up with multiple "lilbee:
        // ready" / "lilbee: error" pills side by side until Obsidian
        // restarts. Take a clean slate before adding our own. Guarded for
        // node-environment tests where document is undefined.
        if (typeof document !== "undefined") {
            document.querySelectorAll(".status-bar-item.plugin-lilbee").forEach((el) => el.remove());
            document.querySelectorAll(".lilbee-ribbon-icon").forEach((el) => el.remove());
        }

        this.statusBarEl = this.addStatusBarItem();
        this.statusBarEl.style.cursor = "pointer";
        this.statusBarEl.setAttribute("aria-label", MESSAGES.LABEL_STATUSBAR_OPEN_SETTINGS);
        this.statusBarEl.addEventListener("click", () => this.openPluginSettings());

        // A separate, visually distinct sync pill (refresh glyph + count) that
        // only appears when the vault has documents the server hasn't ingested.
        // Keeping it off the main status pill lets the green "running" state
        // stay clean and prominent; this pill is a sync affordance, not a
        // second status icon. Clicking it triggers a sync.
        this.syncPillEl = this.addStatusBarItem();
        this.syncPillEl.addClass("lilbee-sync-pill");
        this.syncPillEl.style.cursor = "pointer";
        this.syncPillEl.style.display = "none";
        this.syncPillEl.setAttribute("aria-label", MESSAGES.TOOLTIP_PENDING_SYNC_HINT);
        this.syncPillEl.addEventListener("click", () => void this.triggerSync());

        this.chatRibbonIconEl = this.addRibbonIcon("messages-square", MESSAGES.LABEL_RIBBON_OPEN_CHAT, () =>
            this.activateChatView(),
        );
        this.chatRibbonIconEl.addClass("lilbee-ribbon-icon", "lilbee-ribbon-chat");
        this.ribbonIconEl = this.addRibbonIcon("list-checks", MESSAGES.LABEL_RIBBON_OPEN_TASK_CENTER, () =>
            this.activateTaskView(),
        );
        this.ribbonIconEl.addClass("lilbee-ribbon-icon");
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
        this.addSettingTab(new LilbeeSettingTab(this.app, this));
        this.taskQueue.onChange(() => this.updateStatusBarFromQueue());
        this.taskQueue.onChange(() => this.updateRibbonFromQueue());
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
            if (this.settings.serverMode === SERVER_MODE.MANAGED) {
                void this.ensureManagedConsentThenStart().then((outcome) => {
                    // If the user opts into external mode from the consent modal,
                    // drop them on the plugin's external-server settings.
                    if (outcome.kind === SETUP_OUTCOME.SWITCHED_TO_EXTERNAL) this.openPluginSettings();
                });
            } else {
                this.configureApi(this.settings.serverUrl);
                this.setStatusReady();
                this.fetchActiveModel();
            }
        }

        if (!this.settings.setupCompleted) {
            new SetupWizard(this.app, this).open();
        }

        this.registerPendingSyncHintWatchers();
        void this.updatePendingSyncHint();

        this.startHealthProbe();

        // Auto-open chat + task center for returning users so the workspace
        // is immediately usable. Defer until the workspace layout is up so
        // sidebar splits land in the right place. New users go through the
        // wizard, which calls openCockpit on completion.
        if (this.settings.setupCompleted && this.settings.autoOpenCockpit) {
            this.app.workspace.onLayoutReady(() => {
                void this.openCockpit();
            });
        }

        // Defend against duplicate sidebar leaves persisted in workspace.json
        // from prior sessions. activateChatView() / openCockpit() are
        // idempotent for one leaf, but Obsidian restores whatever was saved,
        // so a workspace that ended up with two chat panes restores both.
        this.app.workspace.onLayoutReady(() => {
            this.dedupeLilbeeLeaves();
        });
    }

    /** Collapse multiple lilbee-chat / -tasks / -wiki leaves to one of each. */
    private dedupeLilbeeLeaves(): void {
        for (const type of [VIEW_TYPE_CHAT, VIEW_TYPE_TASKS, VIEW_TYPE_WIKI, VIEW_TYPE_MEMORIES]) {
            const leaves = this.app.workspace.getLeavesOfType(type);
            for (let i = 1; i < leaves.length; i++) leaves[i].detach();
        }
        this.app.workspace.requestSaveLayout?.();
    }

    async startManagedServer(onProgress?: ManagedServerProgressHandler): Promise<void> {
        if (this.startingServer) return;
        const registry = this.vaultRegistry;
        if (!registry) return;
        this.startingServer = true;
        this.serverStartFailed = false;

        try {
            if (!(await this.acquireLockOrBail(registry, onProgress))) return;

            const sharedRoot = registry.sharedRoot;
            this.binaryManager = new BinaryManager(sharedBinDir(sharedRoot));
            const binaryPath = await this.ensureBinaryWithUi(onProgress);
            if (binaryPath === null) return;
            await this.recordLilbeeVersionAfterDownload();

            try {
                this.serverManager = this.buildServerManager(binaryPath, registry, sharedRoot);
                this.updateStatusBar(MESSAGES.STATUS_STARTING, DOT_STATE.PRIMARY);
                this.setStatusClass("lilbee-status-starting");
                onProgress?.({ phase: MANAGED_PHASE.STARTING, message: MESSAGES.STATUS_STARTING_SERVER });
                await this.serverManager.start();
                this.configureApi(this.serverManager.serverUrl);
                this.fetchActiveModel();
                void this.configureManagedStorage();
                this.recordReadyState();
                onProgress?.({ phase: MANAGED_PHASE.READY, message: "" });
            } catch (err) {
                this.showError("failed to start server", err);
                onProgress?.({ phase: MANAGED_PHASE.ERROR, message: errorMessage(err, String(err)) });
            }
        } finally {
            this.startingServer = false;
        }
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
        if (binaryPresent) {
            await this.startManagedServer(onProgress);
            return { kind: SETUP_OUTCOME.STARTED, mode: SERVER_MODE.MANAGED };
        }

        // The gate owns the server lifecycle for each outcome, so it persists
        // directly via persistAll() rather than saveSettings() — the latter
        // would fire its own startManagedServer on a mode switch and race ours.
        const result = await new ManagedConsentModal(this.app).openConsent();
        if (result.kind === MANAGED_CONSENT_RESULT.DOWNLOAD) {
            this.settings.serverMode = SERVER_MODE.MANAGED;
            this.previousServerMode = SERVER_MODE.MANAGED;
            await this.persistAll();
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
            modelsDir: sharedModelsDir(sharedRoot),
            ragSystemPrompt: this.settings.ragSystemPrompt,
            generalSystemPrompt: this.settings.generalSystemPrompt,
            onStateChange: (state) => this.handleServerStateChange(state),
            onRestartsExhausted: (stderr: string) => {
                if (this.serverStartFailed) return;
                const detail = stderr ? `\n${stderr.split("\n").slice(-5).join("\n")}` : "";
                new Notice(`${MESSAGES.ERROR_SERVER_CRASHED}${detail}`, NOTICE_PERMANENT);
            },
            onShutdownFailure: (err: Error) => {
                new Notice(`${MESSAGES.ERROR_SERVER_SHUTDOWN_FAILED}: ${err.message}`);
            },
        });
    }

    /** Decide who owns the shared root and (if not us) ask the user. */
    private async acquireLockOrBail(
        registry: VaultRegistry,
        onProgress?: ManagedServerProgressHandler,
    ): Promise<boolean> {
        const state = registry.lockState(this.vaultId);
        if (state === LOCK_STATE.LIVE_OTHER) {
            const owner = registry.readLock();
            const ownerName = owner ? this.lookupVaultName(owner.vaultId) : "another vault";
            const takeOver = await this.confirmTakeOver(ownerName);
            if (!takeOver) {
                new Notice(MESSAGES.NOTICE_TAKE_OVER_DECLINED(ownerName));
                this.updateStatusBar(MESSAGES.STATUS_LOCKED_BY_OTHER(ownerName), DOT_STATE.MUTED);
                onProgress?.({ phase: MANAGED_PHASE.ERROR, message: MESSAGES.NOTICE_TAKE_OVER_DECLINED(ownerName) });
                return false;
            }
            if (!(await this.terminateOwningProcess(owner))) {
                new Notice(MESSAGES.NOTICE_TAKE_OVER_TIMEOUT);
                return false;
            }
            new Notice(MESSAGES.NOTICE_TAKE_OVER_SUCCESS(ownerName));
        }
        return true;
    }

    private async confirmTakeOver(ownerName: string): Promise<boolean> {
        const modal = new ConfirmModal(this.app, MESSAGES.CONFIRM_TAKE_OVER(ownerName));
        modal.open();
        return modal.result;
    }

    private lookupVaultName(vaultId: string): string {
        return this.vaultRegistry?.get(vaultId)?.displayName ?? "another vault";
    }

    private async terminateOwningProcess(owner: ActiveLock | null): Promise<boolean> {
        if (!owner) return true;
        try {
            node.processKill(owner.pid);
        } catch {
            // already gone — fine
        }
        for (let i = 0; i < 50; i++) {
            try {
                node.processKill(owner.pid, 0);
            } catch {
                return true;
            }
            await new Promise((r) => setTimeout(r, 100));
        }
        return false;
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
        let downloadNotice: Notice | undefined;
        try {
            const path = await bm.ensureBinary(
                (msg, url) => {
                    this.updateStatusBar(`lilbee: ${msg}`, DOT_STATE.PRIMARY);
                    onProgress?.({ phase: MANAGED_PHASE.DOWNLOADING, message: msg, url });
                    if (!downloadNotice && needsDownload) {
                        const text = url ? `lilbee: ${msg}\n${url}` : `lilbee: ${msg}`;
                        downloadNotice = new Notice(text, NOTICE_PERMANENT);
                    } else if (downloadNotice) {
                        const text = url ? `lilbee: ${msg}\n${url}` : `lilbee: ${msg}`;
                        downloadNotice.setMessage(text);
                    }
                },
                () => this.showGatekeeperHelp(),
            );
            downloadNotice?.hide();
            this.setStatusClass(null);
            return path;
        } catch (err) {
            downloadNotice?.hide();
            this.setStatusClass(null);
            this.showError("failed to download server", err);
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
            const release = await getLatestRelease();
            this.setSharedLilbeeVersion(release.tag);
            this.setSharedLilbeeVariant(release.variant);
        } catch {
            /* version tracking is best-effort */
        }
    }

    /** Persist lock + registry entry once the server is up. */
    private recordReadyState(): void {
        const sm = this.serverManager;
        const registry = this.vaultRegistry;
        if (!sm || !registry) return;
        const port = parseInt(sm.serverUrl.split(":").pop() || "0", 10);
        const now = Date.now();
        registry.writeLock({ vaultId: this.vaultId, pid: process.pid, port, startedAt: now });
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

    async checkForUpdate(): Promise<{ available: boolean; release?: ReleaseInfo }> {
        const release = await getLatestRelease();
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

    async updateServer(release: ReleaseInfo, onProgress?: (msg: string) => void): Promise<void> {
        const registry = this.vaultRegistry;
        if (!registry) return;
        if (!this.binaryManager) {
            this.binaryManager = new BinaryManager(sharedBinDir(registry.sharedRoot));
        }

        // Stop the running server first
        if (this.serverManager) {
            onProgress?.("Stopping server...");
            await this.serverManager.stop();
            this.serverManager = null;
        }

        // Download the new binary (overwrites the old one)
        onProgress?.("Downloading...");
        await this.binaryManager.download(release.assetUrl, release.sizeBytes, release.digest, onProgress, () =>
            this.showGatekeeperHelp(),
        );

        // Save the new version and the build variant we just installed
        this.setSharedLilbeeVersion(release.tag);
        this.setSharedLilbeeVariant(release.variant);

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
    private readCurrentToken(): string | null {
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
        if (outcome === "ok") {
            this.setStatusReady();
            return;
        }
        if (outcome === "auth_error") {
            this.updateStatusBar(MESSAGES.STATUS_AUTH_ERROR, DOT_STATE.ERROR);
            this.setStatusClass("lilbee-status-error");
            return;
        }
        if (outcome === "server_error" || outcome === "unreachable") {
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
            id: "lilbee:search",
            name: "Search knowledge base",
            checkCallback: (checking) => {
                if (!this.isLilbeeReady()) return false;
                if (!checking) new SearchModal(this.app, this).open();
                return true;
            },
        });

        this.addCommand({
            id: "lilbee:chat",
            name: "Open chat",
            checkCallback: (checking) => {
                if (!this.isLilbeeReady()) return false;
                if (!checking) void this.activateChatView();
                return true;
            },
        });

        this.addCommand({
            id: "lilbee:open-memories",
            name: "Open memories",
            checkCallback: (checking) => {
                if (!this.isLilbeeReady()) return false;
                if (!checking) void this.activateMemoriesView();
                return true;
            },
        });

        this.addCommand({
            id: "lilbee:remember",
            name: "Remember…",
            checkCallback: (checking) => {
                if (!this.isLilbeeReady()) return false;
                if (!checking) new RememberModal(this.app, this).open();
                return true;
            },
        });

        this.addCommand({
            id: "lilbee:add-file",
            name: "Add current file to lilbee",
            checkCallback: (checking) => {
                if (!this.isLilbeeReady()) return false;
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
                if (!this.isLilbeeReady()) return false;
                const file = this.app.workspace.getActiveFile();
                const folder = file?.parent;
                if (!folder) return false;
                if (!checking) void this.addToLilbee(folder);
                return true;
            },
        });

        this.addCommand({
            id: "lilbee:sync",
            name: MESSAGES.COMMAND_SYNC,
            checkCallback: (checking) => {
                if (!this.isLilbeeReady()) return false;
                if (!checking) void this.triggerSync();
                return true;
            },
        });

        this.addCommand({
            id: "lilbee:sync-retry-skipped",
            name: MESSAGES.COMMAND_SYNC_RETRY_SKIPPED,
            checkCallback: (checking) => {
                if (!this.isLilbeeReady()) return false;
                if (!checking) void this.triggerSync({ retrySkipped: true });
                return true;
            },
        });

        this.addCommand({
            id: "lilbee:sync-rebuild",
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
            id: "lilbee:catalog",
            name: "Browse model catalog",
            checkCallback: (checking) => {
                if (!this.isLilbeeReady()) return false;
                if (!checking) new CatalogModal(this.app, this).open();
                return true;
            },
        });

        this.addCommand({
            id: "lilbee:model-picker-chat",
            name: MESSAGES.COMMAND_MODEL_PICKER_CHAT,
            checkCallback: (checking) => {
                if (!this.isLilbeeReady()) return false;
                if (!checking) new ModelPickerModal(this.app, this, "chat").open();
                return true;
            },
        });

        this.addCommand({
            id: "lilbee:model-picker-embedding",
            name: MESSAGES.COMMAND_MODEL_PICKER_EMBED,
            checkCallback: (checking) => {
                if (!this.isLilbeeReady()) return false;
                if (!checking) new ModelPickerModal(this.app, this, "embedding").open();
                return true;
            },
        });

        this.addCommand({
            id: "lilbee:model-info-active-chat",
            name: MESSAGES.COMMAND_MODEL_INFO_CHAT,
            checkCallback: (checking) => {
                if (!this.isLilbeeReady()) return false;
                if (!checking) void this.openModelInfoForActiveTask("chat");
                return true;
            },
        });

        this.addCommand({
            id: "lilbee:model-info-active-embedding",
            name: MESSAGES.COMMAND_MODEL_INFO_EMBED,
            checkCallback: (checking) => {
                if (!this.isLilbeeReady()) return false;
                if (!checking) void this.openModelInfoForActiveTask("embedding");
                return true;
            },
        });

        this.addCommand({
            id: "lilbee:crawl",
            name: "Crawl web page",
            checkCallback: (checking) => {
                if (!this.isLilbeeReady()) return false;
                if (!checking) new CrawlModal(this.app, this).open();
                return true;
            },
        });

        this.addCommand({
            id: "lilbee:documents",
            name: "Browse documents",
            checkCallback: (checking) => {
                if (!this.isLilbeeReady()) return false;
                if (!checking) new DocumentsModal(this.app, this).open();
                return true;
            },
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
            id: "lilbee:wiki-drafts",
            name: MESSAGES.COMMAND_REVIEW_DRAFTS,
            checkCallback: (checking) => {
                if (!this.wikiEnabled) return false;
                if (!checking) new DraftModal(this.app, this).open();
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

        this.addCommand({
            id: "lilbee:take-over",
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
        if (this.serverManager) {
            await this.serverManager.stop();
            this.serverManager = null;
        }
        if (this.settings.serverMode === SERVER_MODE.MANAGED) {
            await this.startManagedServer();
        }
    }

    onunload(): void {
        if (this.pendingHintTimeout) {
            clearTimeout(this.pendingHintTimeout);
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
        void this.serverManager?.stop();
        this.vaultRegistry?.releaseLock(this.vaultId);
    }

    async loadSettings(): Promise<void> {
        const raw = (await this.loadData()) as (LilbeeSettings & { taskHistory?: { history?: unknown[] } }) | null;
        this.settings = Object.assign({}, DEFAULT_SETTINGS, raw ?? {});
        this.previousServerMode = this.settings.serverMode;
        this.taskQueue.loadFromJSON(raw?.taskHistory as { history?: import("./types").TaskEntry[] } | undefined);
        this.vaultId = computeVaultId(this.getVaultBasePath());
        this.vaultRegistry = new VaultRegistry(resolveSharedRoot(this.settings.sharedRoot));
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
                void this.startManagedServer();
            }
        } else {
            if (previousMode === SERVER_MODE.MANAGED) {
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
        const handle = setInterval(() => void this.probeServerHealth(), HEALTH_PROBE_INTERVAL_MS) as unknown as number;
        this.registerInterval(handle);
        this.healthProbeHandle = handle;
    }

    private async probeServerHealth(): Promise<void> {
        if (this.taskQueue.activeAll.length > 0) return;
        if (this.startingServer) return;
        if (this.chatInFlight > 0) return;
        // Re-read the token before probing — the server writes a fresh one on
        // every restart, and this is the cheapest way to stay in sync.
        this.api.setToken(this.readCurrentToken());
        const ok = (await this.api.health().catch(() => null))?.isOk() ?? false;
        if (ok) {
            this.healthFailureStreak = 0;
            if (this.serverUnreachable) {
                this.serverUnreachable = false;
                void this.fetchActiveModel();
            }
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

    async openModelInfoForActiveTask(task: "chat" | "embedding"): Promise<void> {
        let cfg: Record<string, unknown>;
        try {
            cfg = await this.api.config();
        } catch {
            new Notice(MESSAGES.NOTICE_NO_ACTIVE_MODEL(task));
            return;
        }
        const key = task === "chat" ? "chat_model" : "embedding_model";
        const ref = typeof cfg[key] === "string" ? (cfg[key] as string) : "";
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
        // The vault root's name is the empty string and its path is "/", so
        // `?? file.path` doesn't fall back; both have to be checked.
        const name = file.name || file.path || MESSAGES.LABEL_VAULT_ROOT;

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
            const rawStream = this.api.addFiles(paths, true, controller.signal);
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
            this.app.workspace.revealLeaf(existing[0]);
            return;
        }
        const leaf = this.app.workspace.getRightLeaf(false);
        if (leaf) {
            await leaf.setViewState({ type: VIEW_TYPE_TASKS, active: true });
            this.app.workspace.revealLeaf(leaf);
        }
    }

    refreshOpenWikiViews(): void {
        for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_WIKI)) {
            (leaf.view as WikiView).refresh();
        }
    }

    async activateMemoriesView(): Promise<void> {
        const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_MEMORIES);
        if (existing.length > 0) {
            this.app.workspace.revealLeaf(existing[0]);
            return;
        }
        const leaf = this.app.workspace.getRightLeaf(false);
        if (leaf) {
            await leaf.setViewState({ type: VIEW_TYPE_MEMORIES, active: true });
            this.app.workspace.revealLeaf(leaf);
        }
    }

    refreshMemoryViews(): void {
        for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_MEMORIES)) {
            void (leaf.view as MemoriesView).reload();
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
            activeTab.display();
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

    /**
     * Open the chat view and the task center as adjacent leaves in the right
     * sidebar so a fresh-install user lands on a usable workspace without
     * having to discover the ribbon icon and the slash command. Idempotent —
     * if either view is already open, just reveal it; no duplicates.
     */
    async openCockpit(): Promise<void> {
        const workspace = this.app.workspace;
        const existingChat = workspace.getLeavesOfType(VIEW_TYPE_CHAT);
        const existingTasks = workspace.getLeavesOfType(VIEW_TYPE_TASKS);

        let chatLeaf = existingChat[0] ?? null;
        if (!chatLeaf) {
            const leaf = workspace.getRightLeaf(false);
            if (!leaf) return;
            chatLeaf = leaf;
            await chatLeaf.setViewState({ type: VIEW_TYPE_CHAT, active: true });
        }

        // Task center lives as a bottom panel under the editor — not a right
        // sidebar tab, because the right sidebar collapses sibling leaves into
        // tabs and only one would be visible at a time. getLeaf("split",
        // "horizontal") splits the active root leaf in the main editor area
        // along the horizontal axis (editor on top, task center beneath).
        let tasksLeaf = existingTasks[0] ?? null;
        if (!tasksLeaf) {
            const split = workspace.getLeaf("split", "horizontal");
            if (split) {
                tasksLeaf = split;
                await tasksLeaf.setViewState({ type: VIEW_TYPE_TASKS, active: true });
            }
        }

        workspace.revealLeaf(chatLeaf);
        if (tasksLeaf) workspace.revealLeaf(tasksLeaf);
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
            clearTimeout(this.pendingHintTimeout);
        }
        this.pendingHintTimeout = setTimeout(() => {
            this.pendingHintTimeout = null;
            // Bail if the plugin was unloaded between scheduling and firing.
            // The statusBarEl guard inside updatePendingSyncHint covers this,
            // but the explicit check here keeps the contract local.
            if (!this.statusBarEl) return;
            void this.updatePendingSyncHint();
        }, PENDING_SYNC_HINT_DEBOUNCE_MS);
    }

    private async countPendingSync(): Promise<number> {
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
            this.syncPillEl.style.display = "";
        } else {
            this.syncPillEl.style.display = "none";
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
