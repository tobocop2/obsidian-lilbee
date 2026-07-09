export interface Excerpt {
    content: string;
    page_start: number | null;
    page_end: number | null;
    line_start: number | null;
    line_end: number | null;
    relevance: number;
}

export interface DocumentResult {
    source: string;
    content_type: string;
    excerpts: Excerpt[];
    best_relevance: number;
}

export interface AskResponse {
    answer: string;
    sources: Source[];
}

export interface Source {
    source: string;
    content_type: string;
    distance: number;
    chunk: string;
    page_start: number | null;
    page_end: number | null;
    line_start: number | null;
    line_end: number | null;
    chunk_type?: "raw" | "wiki";
    claim_type?: "fact" | "inference";
    /**
     * Relative path within the vault when the server is managed and
     * `documents_dir` is inside the user's vault. `null` for external servers
     * where the file is not accessible as a vault-relative path.
     */
    vault_path?: string | null;
}

/**
 * Returned by `GET /api/source?source=...`. When `raw=1` the server streams
 * bytes with the original `Content-Type`; this shape is used for the JSON
 * response only.
 */
export interface SourceContent {
    markdown: string;
    content_type: string;
    crawled_at?: string;
    title?: string;
}

export interface ModelInfo {
    name: string;
    size_gb: number;
    min_ram_gb: number;
    description: string;
    installed: boolean;
    source?: string;
}

export interface ModelCatalog {
    active: string;
    catalog: ModelInfo[];
    installed: string[];
}

export interface ModelsResponse {
    chat: ModelCatalog;
    embedding?: ModelCatalog;
    vision?: ModelCatalog;
    reranker?: ModelCatalog;
}

export interface ConfigResponse {
    reranker_model: string | null;
    rerank_candidates: number;
    vision_model: string | null;
    rag_system_prompt?: string;
    general_system_prompt?: string;
    chat_mode?: ChatMode;
    embedding_model?: string;
    wiki?: boolean;
    worker_pool_call_timeout_s?: number;
    worker_pool_eager_start?: boolean;
    worker_pool_max_idle_s?: number;
    vision_load_budget_s?: number;
    chunk_size?: number;
    chunk_overlap?: number;
    tesseract_timeout?: number;
    max_tokens?: number;
    show_reasoning?: boolean;
    max_reasoning_chars?: number;
    model_keep_alive?: string;
    gpu_memory_fraction?: number;
    candidate_multiplier?: number;
    max_distance?: number;
    min_relevance_score?: number;
    max_context_sources?: number;
    diversity_max_per_source?: number;
    mmr_lambda?: number;
    crawl_render_mode?: CrawlRenderMode;
    [key: string]: unknown;
}

export type CrawlRenderMode = "http" | "browser";

export const CRAWL_RENDER_MODE = {
    HTTP: "http",
    BROWSER: "browser",
} as const satisfies Record<string, CrawlRenderMode>;

export const CONFIG_KEY = {
    RAG_SYSTEM_PROMPT: "rag_system_prompt",
    GENERAL_SYSTEM_PROMPT: "general_system_prompt",
    CHAT_MODE: "chat_mode",
    SHOW_REASONING: "show_reasoning",
    CRAWL_RENDER_MODE: "crawl_render_mode",
} as const;

export type ChatMode = "search" | "chat";

export const CHAT_MODE = {
    SEARCH: "search",
    CHAT: "chat",
} as const satisfies Record<string, ChatMode>;

export type CatalogSource = "native" | "frontier" | "ollama" | "lm_studio";

export const CATALOG_SOURCE = {
    NATIVE: "native",
    FRONTIER: "frontier",
    OLLAMA: "ollama",
    LM_STUDIO: "lm_studio",
} as const satisfies Record<string, CatalogSource>;

/** Sources rendered in the shared "hosted" area: selectable, no download.
 * Frontier (cloud API key) plus the local servers (Ollama, LM Studio). */
export const HOSTED_SOURCES: ReadonlySet<CatalogSource> = new Set<CatalogSource>([
    CATALOG_SOURCE.FRONTIER,
    CATALOG_SOURCE.OLLAMA,
    CATALOG_SOURCE.LM_STUDIO,
]);

export type KeyStatus = "ready" | "missing_key";

export const KEY_STATUS = {
    READY: "ready",
    MISSING_KEY: "missing_key",
} as const satisfies Record<string, KeyStatus>;

export type Capability = "api_keys" | "crawling" | "wiki";

export const CAPABILITY = {
    API_KEYS: "api_keys",
    CRAWLING: "crawling",
    WIKI: "wiki",
} as const satisfies Record<string, Capability>;

export type CatalogTab = "discover" | "chat" | "embed" | "vision" | "rerank" | "library";

export const CATALOG_TAB = {
    DISCOVER: "discover",
    CHAT: "chat",
    EMBED: "embed",
    VISION: "vision",
    RERANK: "rerank",
    LIBRARY: "library",
} as const satisfies Record<string, CatalogTab>;

export type HardwareFit = "fits" | "tight" | "wont_run";

export const HARDWARE_FIT = {
    FITS: "fits",
    TIGHT: "tight",
    WONT_RUN: "wont_run",
} as const satisfies Record<string, HardwareFit>;

/**
 * Whether the connected lilbee server can run a catalog model, derived from its
 * architecture. `supported` is the common case (no badge); `unsupported` means
 * the server's runtime can't load it (gate the download); `unknown` means the
 * server couldn't classify the architecture (surface it, but don't block).
 */
export type ModelCompat = "supported" | "unsupported" | "unknown";

export const MODEL_COMPAT = {
    SUPPORTED: "supported",
    UNSUPPORTED: "unsupported",
    UNKNOWN: "unknown",
} as const satisfies Record<string, ModelCompat>;

export type DiscoverRail = "for_you" | "your_collection" | "fresh";

export const DISCOVER_RAIL = {
    FOR_YOU: "for_you",
    YOUR_COLLECTION: "your_collection",
    FRESH: "fresh",
} as const satisfies Record<string, DiscoverRail>;

export interface StatusResponse {
    config: Record<string, string>;
    sources: { filename: string; chunk_count: number }[];
    total_chunks: number;
    wiki?: {
        enabled: boolean;
        page_count: number;
        draft_count: number;
        last_lint: string | null;
    };
}

export interface SyncDone {
    added: string[];
    updated: string[];
    removed: string[];
    unchanged: number;
    failed: string[];
    skipped: string[];
}

/** Recovery options for a sync. Both default off (a plain incremental sync). */
export interface SyncOptions {
    /** Drop the whole index and re-embed every document from scratch. */
    forceRebuild?: boolean;
    /** Clear skip markers so files skipped on a previous sync are retried. */
    retrySkipped?: boolean;
}

export interface GenerationOptions {
    temperature?: number;
    top_p?: number;
    top_k?: number;
    repeat_penalty?: number;
    num_ctx?: number;
    seed?: number;
}

/** Object-shaped `data` may carry an optional `banner` string the chat view renders above the answer bubble. */
export interface SSEEvent {
    event: string;
    data: unknown;
}

export interface Message {
    role: "user" | "assistant" | "system";
    content: string;
}

export type ServerState = "stopped" | "downloading" | "starting" | "ready" | "error";

export const SERVER_STATE = {
    STOPPED: "stopped",
    DOWNLOADING: "downloading",
    STARTING: "starting",
    READY: "ready",
    ERROR: "error",
} as const satisfies Record<string, ServerState>;

/**
 * Progress phases emitted by the managed-server start flow to any observer that
 * passes an `onProgress` handler — currently the setup wizard, which shows
 * binary-download and server-startup state inline while the user waits on the
 * Server step. Lives here (not in main.ts) so leaf views can import the
 * constant without pulling in the plugin entry point and risking a circular
 * value import.
 */
export type ManagedServerProgressPhase = "downloading" | "starting" | "ready" | "error";

export const MANAGED_PHASE = {
    DOWNLOADING: "downloading",
    STARTING: "starting",
    READY: "ready",
    ERROR: "error",
} as const satisfies Record<string, ManagedServerProgressPhase>;

export interface ManagedServerProgress {
    phase: ManagedServerProgressPhase;
    message: string;
    url?: string;
}

export type ManagedServerProgressHandler = (event: ManagedServerProgress) => void;

export type ServerMode = "managed" | "external";

export const SERVER_MODE = {
    MANAGED: "managed",
    EXTERNAL: "external",
} as const satisfies Record<string, ServerMode>;

/** Three-way result of the managed-mode consent modal. */
export type ManagedConsentResultKind = "download" | "external" | "cancel";

export type ManagedConsentResult = { kind: "download" } | { kind: "external" } | { kind: "cancel" };

export const MANAGED_CONSENT_RESULT = {
    DOWNLOAD: "download",
    EXTERNAL: "external",
    CANCEL: "cancel",
} as const satisfies Record<string, ManagedConsentResultKind>;

/** Outcome of the consent-then-start gate the plugin runs before a managed binary download. */
export type SetupOutcomeKind = "started" | "switched-to-external" | "canceled";

export type SetupOutcome =
    { kind: "started"; mode: ServerMode } | { kind: "switched-to-external" } | { kind: "canceled" };

export const SETUP_OUTCOME = {
    STARTED: "started",
    SWITCHED_TO_EXTERNAL: "switched-to-external",
    CANCELED: "canceled",
} as const satisfies Record<string, SetupOutcomeKind>;

export type SearchChunkType = "all" | "wiki" | "raw";

export const SEARCH_CHUNK_TYPE = {
    ALL: "all",
    WIKI: "wiki",
    RAW: "raw",
} as const satisfies Record<string, SearchChunkType>;

export type MemoryKind = "fact" | "preference";

export const MEMORY_KIND = {
    FACT: "fact",
    PREFERENCE: "preference",
} as const satisfies Record<string, MemoryKind>;

export interface MemoryItem {
    id: string;
    kind: MemoryKind;
    shared: boolean;
    text: string;
}

export interface MemoryListResponse {
    memories: MemoryItem[];
}

export interface RememberResponse {
    id: string;
    kind: MemoryKind;
}

export interface MemoryFlagsResponse {
    id: string;
    updated: boolean;
}

export interface MemoryRemoveResponse {
    removed: string;
}

export interface MemoryExtractedItem {
    id: string;
    kind: MemoryKind;
    text: string;
}

/** Payload of the `memory_extracted` SSE event the server emits after an auto-extract chat turn. */
export interface MemoryExtractedData {
    count: number;
    items: MemoryExtractedItem[];
}

/** Server config keys for the memory subsystem (read/written via /api/config). */
export const MEMORY_CONFIG_KEY = {
    ENABLED: "memory_enabled",
    AUTO_EXTRACT: "memory_auto_extract",
} as const;

export interface LilbeeSettings {
    serverUrl: string;
    topK: number;
    maxDistance: number;
    adaptiveThreshold: boolean;
    serverMode: ServerMode;
    ragSystemPrompt: string;
    generalSystemPrompt: string;
    setupCompleted: boolean;
    wikiEnabled: boolean;
    wikiPruneRaw: boolean;
    wikiFaithfulnessThreshold: number;
    searchChunkType: SearchChunkType;
    wikiSyncToVault: boolean;
    wikiVaultFolder: string;
    manualToken: string;
    /**
     * Store lilbee's managed content (crawls, imported files) inside the vault
     * instead of the server's data directory. Only honoured in managed mode —
     * external servers keep their own documents_dir.
     */
    storeContentInVault: boolean;
    lastCatalogTab: CatalogTab;
    /**
     * When true (default), the chat view and task center auto-open in the
     * right sidebar on plugin load and right after the setup wizard finishes.
     * Users who keep their right sidebar busy with other plugins can disable
     * this in Settings → Connection.
     */
    autoOpenCockpit: boolean;
    /**
     * Filesystem root that holds the shared lilbee binary, models cache, and
     * per-vault data directories. Empty string means "use platform default"
     * (resolved via getDefaultLilbeeDataRoot). Set explicitly to point the
     * plugin at a different location (e.g. an external SSD).
     */
    sharedRoot: string;
    /** Set once the plugin has applied its one-time `show_reasoning` on-by-default. */
    reasoningDefaulted: boolean;
}

export const DEFAULT_SETTINGS: LilbeeSettings = {
    serverUrl: "http://127.0.0.1:7433",
    // Match the server's default retrieval depth (core config top_k = 12) so the
    // plugin and a bare `lilbee serve` behave identically out of the box.
    topK: 12,
    maxDistance: 0.9,
    adaptiveThreshold: false,
    serverMode: "managed",
    ragSystemPrompt: "",
    generalSystemPrompt: "",
    setupCompleted: false,
    wikiEnabled: false,
    wikiPruneRaw: false,
    wikiFaithfulnessThreshold: 0.7,
    searchChunkType: "raw",
    wikiSyncToVault: false,
    wikiVaultFolder: "lilbee-wiki",
    manualToken: "",
    storeContentInVault: true,
    lastCatalogTab: "discover",
    autoOpenCockpit: true,
    sharedRoot: "",
    reasoningDefaulted: false,
};

/**
 * Cross-vault state that lives in `<shared-root>/config.json`. These fields
 * used to be per-vault but the binary and the HuggingFace cache they describe
 * are shared, so they must agree across all vaults using this shared root.
 */
export interface SharedConfig {
    lilbeeVersion: string;
    /** Which server build is installed. Empty when unknown (e.g. installed before variant tracking). */
    lilbeeVariant: ServerVariant | "";
    hfToken: string;
    /** Plugin version that last ran the automatic server-update check. */
    lastUpdateCheckPluginVersion: string;
    /** The user removed the managed server; never download it again until they ask. */
    serverUninstalled: boolean;
}

export const DEFAULT_SHARED_CONFIG: SharedConfig = {
    lilbeeVersion: "",
    lilbeeVariant: "",
    hfToken: "",
    lastUpdateCheckPluginVersion: "",
    serverUninstalled: false,
};

/** What a managed-mode uninstall deletes. Documents in the vault are never a target. */
export type UninstallTargetKind = "binary" | "models" | "index";

export const UNINSTALL_TARGET = {
    BINARY: "binary",
    MODELS: "models",
    INDEX: "index",
} as const satisfies Record<string, UninstallTargetKind>;

export interface UninstallTarget {
    kind: UninstallTargetKind;
    path: string;
    bytes: number;
}

export interface UninstallPlan {
    targets: UninstallTarget[];
    totalBytes: number;
}

/** How the selected server version relates to the installed one. */
export type VersionAction = "install" | "reinstall" | "update" | "downgrade";

export const VERSION_ACTION = {
    INSTALL: "install",
    REINSTALL: "reinstall",
    UPDATE: "update",
    DOWNGRADE: "downgrade",
} as const satisfies Record<string, VersionAction>;

/** One row in `<shared-root>/registry.json` — one per Obsidian vault. */
export interface VaultRegistryEntry {
    id: string;
    displayName: string;
    dataDir: string;
    obsidianVaultPath: string;
    addedAt: number;
    lastActiveAt: number;
}

/** Contents of `<shared-root>/active.lock` — only one vault holds it. */
export interface ActiveLock {
    vaultId: string;
    pid: number;
    port: number;
    startedAt: number;
}

export type LockState = "none" | "ours" | "stale" | "live_other";

export const LOCK_STATE = {
    NONE: "none",
    OURS: "ours",
    STALE: "stale",
    LIVE_OTHER: "live_other",
} as const satisfies Record<string, LockState>;

/** Names of files/dirs the plugin writes inside the shared root. */
export const SHARED_PATH = {
    BIN: "bin",
    MODELS: "models",
    VAULTS: "vaults",
    CONFIG: "config.json",
    REGISTRY: "registry.json",
    LOCK: "active.lock",
} as const;

/** Subdirectory of a vault data dir where all log files land. */
export const LOGS_DIR = "logs";

/** Log file names the diagnostics bundle knows about. */
export const LOG_FILE = {
    SERVER: "server.log",
    FAULT: "server-fault.log",
    SPAWN_CRASH: "spawn-crash.log",
    PLUGIN: "plugin.log",
} as const;

/** One captured plugin-side error. */
export interface JournalEntry {
    timestamp: string;
    label: string;
    message: string;
    stack: string | null;
}

/** One file gathered (or missed) by the diagnostics collector. */
export interface CollectedFile {
    /** Path inside the zip, e.g. "logs/worker-chat.log". */
    name: string;
    /** File bytes after tail-capping and redaction; null when the file was missed. */
    data: Uint8Array | null;
    /** Manifest note, e.g. "not found" or "truncated to last 1 MiB". Null when collected whole. */
    note: string | null;
}

/** Everything the collector gathered, ready to zip. */
export interface DiagnosticsBundle {
    files: CollectedFile[];
    summaryMarkdown: string;
}

/** Inputs the collector reads from the live plugin. */
export interface DiagnosticsContext {
    dataDir: string | null;
    sharedRoot: string | null;
    settings: LilbeeSettings;
    journalEntries: readonly JournalEntry[];
    pluginVersion: string;
    serverVersion: string;
    serverState: ServerState;
    serverUrl: string;
    lastOutput: string;
}

/** SSE event type constants — shared across chat, sync, and model pull streams. */
export const SSE_EVENT = {
    TOKEN: "token",
    REASONING: "reasoning",
    SOURCES: "sources",
    DONE: "done",
    ERROR: "error",
    PROGRESS: "progress",
    MESSAGE: "message",
    FILE_START: "file_start",
    EXTRACT: "extract",
    EMBED: "embed",
    FILE_DONE: "file_done",
    PULL: "pull",
    CRAWL_START: "crawl_start",
    CRAWL_PAGE: "crawl_page",
    CRAWL_DONE: "crawl_done",
    CRAWL_ERROR: "crawl_error",
    WIKI_GENERATE_START: "wiki_generate_start",
    WIKI_GENERATE_DONE: "wiki_generate_done",
    WIKI_GENERATE_ERROR: "wiki_generate_error",
    WIKI_PRUNE_DONE: "wiki_prune_done",
    SETUP_START: "setup_start",
    SETUP_PROGRESS: "setup_progress",
    SETUP_DONE: "setup_done",
    ALREADY_INGESTING: "already_ingesting",
    BATCH_PROGRESS: "batch_progress",
    MEMORY_EXTRACTED: "memory_extracted",
} as const;

export interface SetupStartPayload {
    component: string;
    size_estimate_bytes: number | null;
}

export interface SetupProgressPayload {
    component: string;
    downloaded_bytes: number;
    total_bytes: number | null;
    detail: string;
}

export interface SetupDonePayload {
    component: string;
    success: boolean;
    error: string | null;
}

export interface BatchProgressPayload {
    file: string;
    status: string;
    current: number;
    total: number;
}

export const JSON_HEADERS = { "Content-Type": "application/json" } as const;
export const OCTET_STREAM_HEADERS = { "Content-Type": "application/octet-stream" } as const;

/** MIME content types referenced across click dispatch + preview rendering. */
export const CONTENT_TYPE = {
    PDF: "application/pdf",
    PDF_SHORT: "pdf",
    MARKDOWN: "text/markdown",
    HTML: "text/html",
} as const;

export function isPdfContentType(value: string | null | undefined): boolean {
    return value === CONTENT_TYPE.PDF || value === CONTENT_TYPE.PDF_SHORT;
}

export interface SizeVariant {
    size_label: string;
    params: string;
    size_gb: number;
    ref: string;
}

export interface CatalogEntry {
    hf_repo: string;
    gguf_filename: string;
    display_name: string;
    size_gb: number;
    min_ram_gb: number;
    description: string;
    quality_tier: string;
    installed: boolean;
    source: CatalogSource;
    task: ModelTask;
    featured: boolean;
    downloads: number;
    param_count: string;
    fit?: HardwareFit | null;
    compat?: ModelCompat | null;
    architecture?: string | null;
    size_variants?: SizeVariant[] | null;
    /** Hosted rows (frontier + local servers) carry their serving provider. */
    provider?: string;
    /** Set on frontier rows; `null` for local servers (no API key), absent on older servers. */
    key_status?: KeyStatus | null;
}

export interface CatalogResponse {
    total: number;
    limit: number;
    offset: number;
    models: CatalogEntry[];
    has_more: boolean;
}

export interface InstalledModel {
    name: string;
    source: string;
}

export interface InstalledResponse {
    models: InstalledModel[];
}

export interface DocumentEntry {
    filename: string;
    chunk_count: number;
    ingested_at: string;
}

export interface DocumentsResponse {
    documents: DocumentEntry[];
    total: number;
    limit: number;
    offset: number;
    has_more: boolean;
}

export type DatasetFormat = "parquet" | "jsonl";

export const DATASET_FORMAT = {
    PARQUET: "parquet",
    JSONL: "jsonl",
} as const satisfies Record<string, DatasetFormat>;

export interface DatasetImportResponse {
    sources: string[];
    pages: number;
    chunks: number;
}

export interface ConfigUpdateResponse {
    updated: string[];
    reindex_required: boolean;
}

export interface EmbeddingModelResponse {
    model: string;
}

export const WIKI_PAGE_TYPE = {
    SUMMARY: "summary",
    SYNTHESIS: "synthesis",
    CONCEPT: "concept",
    ENTITY: "entity",
    DRAFT: "draft",
    ARCHIVE: "archive",
} as const;

export type WikiPageType = (typeof WIKI_PAGE_TYPE)[keyof typeof WIKI_PAGE_TYPE];

/** Wiki pages that count as "published" — sidebar lists them, vault sync writes them. */
export const PUBLISHED_WIKI_PAGE_TYPES: ReadonlySet<WikiPageType> = new Set([
    WIKI_PAGE_TYPE.SUMMARY,
    WIKI_PAGE_TYPE.SYNTHESIS,
    WIKI_PAGE_TYPE.CONCEPT,
    WIKI_PAGE_TYPE.ENTITY,
]);

/** Subset of published types grouped under "Concepts" in the sidebar. */
export const CONCEPT_WIKI_PAGE_TYPES: ReadonlySet<WikiPageType> = new Set([
    WIKI_PAGE_TYPE.SYNTHESIS,
    WIKI_PAGE_TYPE.CONCEPT,
    WIKI_PAGE_TYPE.ENTITY,
]);

export interface WikiPage {
    slug: string;
    title: string;
    page_type: WikiPageType;
    source_count: number;
    created_at: string | null;
}

export interface WikiPageDetail extends WikiPage {
    content: string;
}

export interface WikiCitation {
    citation_key: string;
    claim_type: "fact" | "inference";
    source_filename: string;
    source_hash: string;
    page_start: number | null;
    page_end: number | null;
    line_start: number | null;
    line_end: number | null;
    excerpt: string;
    created_at: string;
}

export interface WikiCitationChain {
    wiki_page: string;
    citations: WikiCitation[];
}

export type DraftPendingKind = "drift" | "parse" | "collision" | "low_faithfulness" | "bad_title";
export const DRAFT_PENDING_KIND = {
    DRIFT: "drift",
    PARSE: "parse",
    COLLISION: "collision",
    LOW_FAITHFULNESS: "low_faithfulness",
    BAD_TITLE: "bad_title",
} as const satisfies Record<string, DraftPendingKind>;

export interface DraftInfoResponse {
    slug: string;
    path: string;
    drift_ratio: number | null;
    faithfulness_score: number | null;
    bad_title: boolean;
    published_path: string | null;
    published_exists: boolean;
    pending_kind: DraftPendingKind | null;
    mtime: number;
}

export interface DraftAcceptResponse {
    slug: string;
    moved_to: string;
    reindexed_chunks: number;
}

export interface DraftRejectResponse {
    slug: string;
}

export interface LintIssue {
    wiki_page: string;
    citation_key: string;
    status: "valid" | "stale_hash" | "source_deleted" | "excerpt_missing" | "model_changed";
    detail: string;
}

export interface LintResult {
    task_id: string;
    status: "running" | "done" | "failed";
    issues: LintIssue[];
    checked_at: string | null;
}

/** Result of a full wiki build/update. Mirrors `WikiBuildResult` on the server. */
export interface WikiBuildResult {
    paths: string[];
    entities: number;
    count: number;
}

/** Wiki layer status: page counts and recent lint counters. */
export interface WikiStatusResult {
    wiki_enabled: boolean;
    summaries: number;
    drafts: number;
    pages: number;
    lint_errors: number;
    lint_warnings: number;
}

/** Result of generating synthesis pages for cross-source clusters. */
export interface WikiSynthesizeResult {
    paths: string[];
    count: number;
}

/** Obsidian's DataAdapter has these methods but the type declarations are incomplete. */
export interface VaultAdapter {
    getBasePath(): string;
}

export type TaskStatus = "queued" | "active" | "done" | "failed" | "cancelled" | "waiting";

export const TASK_STATUS = {
    QUEUED: "queued",
    ACTIVE: "active",
    DONE: "done",
    FAILED: "failed",
    CANCELLED: "cancelled",
    WAITING: "waiting",
} as const satisfies Record<string, TaskStatus>;

export type DotState = "primary" | "success" | "error" | "muted";

export const DOT_STATE = {
    PRIMARY: "primary",
    SUCCESS: "success",
    ERROR: "error",
    MUTED: "muted",
} as const satisfies Record<string, DotState>;

export type TaskType = "sync" | "add" | "pull" | "crawl" | "download" | "wiki" | "delete" | "setup" | "import";

export const TASK_TYPE = {
    SYNC: "sync",
    ADD: "add",
    PULL: "pull",
    CRAWL: "crawl",
    DOWNLOAD: "download",
    WIKI: "wiki",
    DELETE: "delete",
    SETUP: "setup",
    IMPORT: "import",
} as const satisfies Record<string, TaskType>;

export type ModelTask = "chat" | "vision" | "embedding" | "rerank";

export const MODEL_TASK = {
    CHAT: "chat",
    VISION: "vision",
    EMBEDDING: "embedding",
    RERANK: "rerank",
} as const satisfies Record<string, ModelTask>;

export const ERROR_NAME = {
    ABORT_ERROR: "AbortError",
    SESSION_TOKEN: "SessionTokenError",
    SERVER_STARTING: "ServerStartingError",
    RATE_LIMITED: "RateLimitedError",
} as const;

export const WIZARD_STEP = {
    WELCOME: 0,
    SERVER_MODE: 1,
    MODEL_PICKER: 2,
    EMBEDDING_PICKER: 3,
    SYNC: 4,
    WIKI: 5,
    DONE: 6,
} as const satisfies Record<string, number>;

export const DOWNLOAD_PANEL = {
    MAX_VISIBLE: 5,
    DISMISS_DELAY_MS: 1500,
} as const;

export const TASK_QUEUE = {
    MAX_CONCURRENT_BACKGROUND: 2,
    MAX_QUEUED_PER_TYPE: 5,
} as const;

export const BACKGROUND_TASK_TYPES: ReadonlySet<TaskType> = new Set<TaskType>([
    TASK_TYPE.SYNC,
    TASK_TYPE.ADD,
    TASK_TYPE.PULL,
    TASK_TYPE.CRAWL,
    TASK_TYPE.DOWNLOAD,
    TASK_TYPE.WIKI,
    TASK_TYPE.DELETE,
    TASK_TYPE.IMPORT,
]);

export const PLATFORM = {
    DARWIN: "darwin",
    LINUX: "linux",
    WIN32: "win32",
} as const;

export const ARCH = {
    ARM64: "arm64",
    X64: "x64",
} as const;

/** The CUDA build tags lilbee ships, newest first. */
export type CudaTag = "cu121" | "cu124" | "cu125";
/** Which lilbee server build is installed: the default (Vulkan/CPU) build or a CUDA build. */
export type ServerVariant = "default" | CudaTag;
export const SERVER_VARIANT = {
    DEFAULT: "default",
    CU121: "cu121",
    CU124: "cu124",
    CU125: "cu125",
} as const satisfies Record<string, ServerVariant>;

/** Source of the lilbee server binary; surfaced wherever the unsigned download is explained. */
export const LILBEE_REPO_URL = "https://github.com/tobocop2/lilbee";

export interface TaskEntry {
    id: string;
    name: string;
    type: TaskType;
    status: TaskStatus;
    progress: number;
    detail: string;
    startedAt: number;
    completedAt: number | null;
    error: string | null;
    canCancel: boolean;
    bytesCurrent?: number;
    bytesTotal?: number;
    rateBps?: number;
    lastRateAt?: number;
    retry?: () => void | Promise<void>;
}

export type ModelSize = "small" | "medium" | "large";
export type ModelSort = "featured" | "downloads" | "name" | "size_asc" | "size_desc";

export type CatalogViewMode = "grid" | "list";

export const CATALOG_VIEW_MODE = {
    GRID: "grid",
    LIST: "list",
} as const satisfies Record<string, CatalogViewMode>;

export interface ModelShowResponse {
    architecture?: string;
    context_length?: string;
    embedding_length?: string;
    chat_template?: string;
    file_type?: string;
    parameters?: string;
    [key: string]: string | undefined;
}

export interface ModelCardOptions {
    onClick?: (entry: CatalogEntry) => void;
    onPull?: (entry: CatalogEntry, btn: HTMLElement) => void;
    onUse?: (entry: CatalogEntry, btn: HTMLElement) => void;
    onRemove?: (entry: CatalogEntry, btn: HTMLElement) => void;
    onInfo?: (entry: CatalogEntry) => void;
    showActions?: boolean;
    isActive?: boolean;
}
