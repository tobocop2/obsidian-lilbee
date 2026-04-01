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

export const NOTICE = {
    NO_CHAT_MODEL: "lilbee: no chat model set — select one in settings",
    PULL_CANCELLED: "lilbee: pull cancelled",
    PULL_FAILED: "lilbee: failed to pull model",
    MODEL_ACTIVATED: "lilbee: model activated",
    ADD_FAILED: "lilbee: add failed",
    ADD_CANCELLED: "lilbee: add cancelled",
} as const;

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

export type TaskType = "sync" | "add" | "pull" | "crawl" | "download";

export const TASK_TYPE = {
    SYNC: "sync",
    ADD: "add",
    PULL: "pull",
    CRAWL: "crawl",
    DOWNLOAD: "download",
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
