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
}

export interface ModelInfo {
    name: string;
    size_gb: number;
    min_ram_gb: number;
    description: string;
    installed: boolean;
}

export interface ModelCatalog {
    active: string;
    catalog: ModelInfo[];
    installed: string[];
}

export interface ModelsResponse {
    chat: ModelCatalog;
    vision: ModelCatalog;
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

export type ModelType = "chat" | "vision";

export const MODEL_TYPE = {
    CHAT: "chat",
    VISION: "vision",
} as const satisfies Record<string, ModelType>;

export type SearchChunkType = "all" | "wiki" | "raw";

export interface LilbeeSettings {
    serverUrl: string;
    topK: number;
    maxDistance: number;
    adaptiveThreshold: boolean;
    syncMode: "manual" | "auto";
    syncDebounceMs: number;
    temperature: number | null;
    top_p: number | null;
    top_k_sampling: number | null;
    repeat_penalty: number | null;
    num_ctx: number | null;
    seed: number | null;
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
    /**
     * Bearer token for authenticating against an external lilbee server.
     * Ignored in managed mode (the plugin reads the token from the managed server's
     * `server.json` file on startup). Empty string means no token is sent.
     */
    serverToken: string;
}

export const DEFAULT_SETTINGS: LilbeeSettings = {
    serverUrl: "http://127.0.0.1:7433",
    topK: 5,
    maxDistance: 0.9,
    adaptiveThreshold: false,
    syncMode: "manual",
    syncDebounceMs: 5000,
    temperature: null,
    top_p: null,
    top_k_sampling: null,
    repeat_penalty: null,
    num_ctx: null,
    seed: null,
    serverMode: "managed",
    serverPort: null,
    lilbeeVersion: "",
    systemPrompt: "",
    setupCompleted: false,
    wikiEnabled: false,
    wikiPruneRaw: false,
    wikiFaithfulnessThreshold: 0.7,
    searchChunkType: "all",
    wikiSyncToVault: false,
    wikiVaultFolder: "lilbee-wiki",
    hfToken: "",
    serverToken: "",
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
    WIKI_LINT_PROGRESS: "wiki_lint_progress",
    WIKI_LINT_DONE: "wiki_lint_done",
    WIKI_PRUNE_DONE: "wiki_prune_done",
} as const;

export const JSON_HEADERS = { "Content-Type": "application/json" } as const;

export interface ModelVariant {
    name: string;
    hf_repo: string;
    size_gb: number;
    min_ram_gb: number;
    description: string;
    task: string;
    installed: boolean;
    source: "native" | "litellm";
    display_name?: string;
    quality_tier?: string;
    downloads?: number;
    param_count?: string;
    quant?: string;
    featured?: boolean;
}

export interface ModelFamily {
    family: string;
    task: string;
    featured: boolean;
    recommended: string;
    variants: ModelVariant[];
}

export interface CatalogResponse {
    total: number;
    limit: number;
    offset: number;
    families: ModelFamily[];
}

/**
 * Flat shape returned by `GET /api/models/catalog` on servers that haven't yet
 * been updated to emit grouped families. The plugin's `api.catalog()` adapts
 * this shape into `CatalogResponse` so the rest of the code only deals with
 * families/variants. See `bb-jffs` for the server-side follow-up.
 */
export interface CatalogServerEntry {
    name: string;
    display_name: string;
    size_gb: number;
    min_ram_gb: number;
    description: string;
    quality_tier: string;
    installed: boolean;
    source: string;
    /** Optional — newer servers emit this; older ones do not. */
    hf_repo?: string;
    /** Optional — newer servers emit this; older ones do not. */
    tag?: string;
    /** Optional — newer servers emit this; older ones do not. */
    task?: string;
    /** Optional — newer servers emit this; older ones do not. */
    featured?: boolean;
    /** Optional — newer servers emit this; older ones do not. */
    downloads?: number;
}

export interface CatalogServerResponse {
    total: number;
    limit: number;
    offset: number;
    models?: CatalogServerEntry[];
    families?: ModelFamily[];
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
    sources: string[];
    faithfulness_score: number;
    generated_by: string;
    generated_at: string;
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

export type TaskType = "sync" | "add" | "pull" | "crawl" | "download" | "wiki";

export const TASK_TYPE = {
    SYNC: "sync",
    ADD: "add",
    PULL: "pull",
    CRAWL: "crawl",
    DOWNLOAD: "download",
    WIKI: "wiki",
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

export const ERROR_NAME = {
    ABORT_ERROR: "AbortError",
} as const;

export const WIZARD_STEP = {
    WELCOME: 0,
    SERVER_MODE: 1,
    MODEL_PICKER: 2,
    SYNC: 3,
    DONE: 4,
} as const satisfies Record<string, number>;

export const DOWNLOAD_PANEL = {
    MAX_VISIBLE: 5,
    DISMISS_DELAY_MS: 1500,
} as const;

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
    onClick?: (family: ModelFamily, variant: ModelVariant) => void;
    onPull?: (family: ModelFamily, variant: ModelVariant, btn: HTMLElement) => void;
    onUse?: (family: ModelFamily, variant: ModelVariant, btn: HTMLElement) => void;
    onRemove?: (variant: ModelVariant, btn: HTMLElement) => void;
    showActions?: boolean;
    isActive?: boolean;
}
