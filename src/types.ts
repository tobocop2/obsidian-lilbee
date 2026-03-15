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

export interface PullProgress {
    model: string;
    status: string;
    completed: number;
    total: number;
}

export interface OllamaPullProgress {
    status: string;
    completed?: number;
    total?: number;
    digest?: string;
}

export interface OllamaModelDefaults {
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

export interface GenerationOptions {
    temperature?: number;
    top_p?: number;
    top_k?: number;
    repeat_penalty?: number;
    num_ctx?: number;
    seed?: number;
}

export interface LilbeeSettings {
    serverUrl: string;
    topK: number;
    syncMode: "manual" | "auto";
    syncDebounceMs: number;
    ollamaUrl: string;
    temperature: number | null;
    top_p: number | null;
    top_k_sampling: number | null;
    repeat_penalty: number | null;
    num_ctx: number | null;
    seed: number | null;
}

export const DEFAULT_SETTINGS: LilbeeSettings = {
    serverUrl: "http://127.0.0.1:7433",
    topK: 5,
    syncMode: "manual",
    syncDebounceMs: 5000,
    ollamaUrl: "http://127.0.0.1:11434",
    temperature: null,
    top_p: null,
    top_k_sampling: null,
    repeat_penalty: null,
    num_ctx: null,
    seed: null,
};

/** SSE event type constants — shared across chat, sync, and model pull streams. */
export const SSE_EVENT = {
    TOKEN: "token",
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
} as const;

export const JSON_HEADERS = { "Content-Type": "application/json" } as const;
