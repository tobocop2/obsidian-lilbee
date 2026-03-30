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
    PULL_QUEUED: "lilbee: download queued",
    ADD_QUEUED: "lilbee: add queued",
    MODEL_ACTIVATED: "lilbee: model activated",
    ADD_FAILED: "lilbee: add failed",
    ADD_CANCELLED: "lilbee: add cancelled",
} as const;

export interface LilbeeSettings {
    serverUrl: string;
    topK: number;
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
    hfToken: string;
}

export const DEFAULT_SETTINGS: LilbeeSettings = {
    serverUrl: "http://127.0.0.1:7433",
    topK: 5,
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
    hfToken: "",
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

export interface QueuedPull {
    run: () => Promise<void>;
    modelName: string;
}

export interface CatalogModel {
    name: string;
    display_name?: string;
    quality_tier?: string;
    size_gb: number;
    min_ram_gb: number;
    description: string;
    installed: boolean;
    source: "native" | "litellm";
    task?: string;
    hf_repo?: string;
    downloads?: number;
}

export interface CatalogResponse {
    total: number;
    limit: number;
    offset: number;
    models: CatalogModel[];
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
