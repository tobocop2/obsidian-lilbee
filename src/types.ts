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
     * where the file is not accessible as a vault-relative path. Optional for
     * forward compatibility with servers that predate PR 4 of the vault-native
     * storage work.
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
}

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
}

export interface GenerationOptions {
    temperature?: number;
    top_p?: number;
    top_k?: number;
    repeat_penalty?: number;
    num_ctx?: number;
    seed?: number;
}

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

export type ServerMode = "managed" | "external";

export const SERVER_MODE = {
    MANAGED: "managed",
    EXTERNAL: "external",
} as const satisfies Record<string, ServerMode>;

export type SearchChunkType = "all" | "wiki" | "raw";

export interface LilbeeSettings {
    serverUrl: string;
    topK: number;
    maxDistance: number;
    adaptiveThreshold: boolean;
    syncMode: "manual" | "auto";
    syncDebounceMs: number;
    serverMode: ServerMode;
    serverPort: number | null;
    lilbeeVersion: string;
    systemPrompt: string;
    setupCompleted: boolean;
    wikiEnabled: boolean;
    wikiPruneRaw: boolean;
    wikiFaithfulnessThreshold: number;
    searchChunkType: SearchChunkType;
    wikiSyncToVault: boolean;
    wikiVaultFolder: string;
    hfToken: string;
    enableOcr: boolean | null;
    manualToken: string;
    /**
     * Store lilbee's managed content (crawls, imported files) inside the vault
     * instead of the server's data directory. Only honoured in managed mode —
     * external servers keep their own documents_dir.
     */
    storeContentInVault: boolean;
}

export const DEFAULT_SETTINGS: LilbeeSettings = {
    serverUrl: "http://127.0.0.1:7433",
    topK: 5,
    maxDistance: 0.9,
    adaptiveThreshold: false,
    syncMode: "manual",
    syncDebounceMs: 5000,
    serverMode: "managed",
    serverPort: null,
    lilbeeVersion: "",
    systemPrompt: "",
    setupCompleted: false,
    wikiEnabled: false,
    wikiPruneRaw: false,
    wikiFaithfulnessThreshold: 0.7,
    searchChunkType: "raw",
    wikiSyncToVault: false,
    wikiVaultFolder: "lilbee-wiki",
    hfToken: "",
    enableOcr: null,
    manualToken: "",
    storeContentInVault: true,
};

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

export const JSON_HEADERS = { "Content-Type": "application/json" } as const;

/** MIME content types referenced across click dispatch + preview rendering. */
export const CONTENT_TYPE = {
    PDF: "application/pdf",
    MARKDOWN: "text/markdown",
    HTML: "text/html",
} as const;

export interface CatalogEntry {
    name: string;
    display_name: string;
    size_gb: number;
    min_ram_gb: number;
    description: string;
    quality_tier: string;
    installed: boolean;
    source: string;
    hf_repo: string;
    tag: string;
    task: ModelTask;
    featured: boolean;
    downloads: number;
    param_count?: string;
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
}

export interface ConfigUpdateResponse {
    updated: string[];
    reindex_required: boolean;
}

export interface EmbeddingModelResponse {
    model: string;
}

export interface WikiPage {
    slug: string;
    title: string;
    page_type: "summary" | "synthesis";
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

export interface WikiDraft {
    slug: string;
    title: string;
    faithfulness_score: number;
    generated_at: string;
    failure_reason: string;
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

/** Obsidian's DataAdapter has these methods but the type declarations are incomplete. */
export interface VaultAdapter {
    getBasePath(): string;
}

export type TaskStatus = "queued" | "active" | "done" | "failed" | "cancelled";

export const TASK_STATUS = {
    QUEUED: "queued",
    ACTIVE: "active",
    DONE: "done",
    FAILED: "failed",
    CANCELLED: "cancelled",
} as const satisfies Record<string, TaskStatus>;

export type DotState = "primary" | "success" | "error";

export const DOT_STATE = {
    PRIMARY: "primary",
    SUCCESS: "success",
    ERROR: "error",
} as const satisfies Record<string, DotState>;

export type TaskType = "sync" | "add" | "pull" | "crawl" | "download" | "wiki" | "delete" | "setup";

export const TASK_TYPE = {
    SYNC: "sync",
    ADD: "add",
    PULL: "pull",
    CRAWL: "crawl",
    DOWNLOAD: "download",
    WIKI: "wiki",
    DELETE: "delete",
    SETUP: "setup",
} as const satisfies Record<string, TaskType>;

export type SyncMode = "manual" | "auto";

export const SYNC_MODE = {
    MANUAL: "manual",
    AUTO: "auto",
} as const satisfies Record<string, SyncMode>;

export type ModelTask = "chat" | "vision" | "embedding";

export const MODEL_TASK = {
    CHAT: "chat",
    VISION: "vision",
    EMBEDDING: "embedding",
} as const satisfies Record<string, ModelTask>;

export const MODEL_SOURCE = {
    NATIVE: "native",
} as const;

export const ERROR_NAME = {
    ABORT_ERROR: "AbortError",
    SESSION_TOKEN: "SessionTokenError",
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
    showActions?: boolean;
    isActive?: boolean;
}
