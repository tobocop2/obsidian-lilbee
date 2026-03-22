import { JSON_HEADERS, SSE_EVENT } from "./types";
import type {
    AskResponse,
    DocumentListResponse,
    DocumentResult,
    GenerationOptions,
    Message,
    ModelDefaults,
    ModelsResponse,
    SSEEvent,
    StatusResponse,
} from "./types";

const DEFAULT_TIMEOUT_MS = 15_000;
const RETRY_COUNT = 2;
const RETRY_BACKOFF_MS = 500;

export class LilbeeClient {
    constructor(private baseUrl: string) {}

    private async assertOk(res: Response): Promise<Response> {
        if (!res.ok) {
            const text = await res.text().catch(() => "");
            throw new Error(`Server responded ${res.status}: ${text}`);
        }
        return res;
    }

    /**
     * Fetch with automatic retry on network errors and a default timeout.
     * Does NOT retry on HTTP error responses (4xx/5xx) — only on fetch failures
     * (e.g. connection refused, DNS failure, timeout).
     * SSE streams should pass `stream: true` to skip the timeout.
     */
    async fetchWithRetry(
        url: string,
        init?: RequestInit,
        opts?: { stream?: boolean; signal?: AbortSignal },
    ): Promise<Response> {
        const maxAttempts = RETRY_COUNT + 1;
        let lastError: unknown;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            if (attempt > 0) {
                await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS * attempt));
            }
            try {
                const fetchInit = { ...init };
                let timer: ReturnType<typeof setTimeout> | undefined;
                if (opts?.signal) {
                    fetchInit.signal = opts.signal;
                } else if (!opts?.stream) {
                    const controller = new AbortController();
                    fetchInit.signal = controller.signal;
                    timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
                }
                try {
                    return await this.assertOk(await globalThis.fetch(url, fetchInit));
                } finally {
                    if (timer !== undefined) clearTimeout(timer);
                }
            } catch (err) {
                lastError = err;
                if (err instanceof Error && err.message.startsWith("Server responded")) {
                    throw err;
                }
                if (err instanceof Error && err.name === "AbortError") {
                    throw err;
                }
            }
        }
        throw lastError;
    }

    async getConfig(): Promise<Record<string, unknown>> {
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/config`);
        return res.json();
    }

    async health(): Promise<{ status: string; version: string }> {
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/health`);
        return res.json();
    }

    async status(): Promise<StatusResponse> {
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/status`);
        return res.json();
    }

    async search(query: string, topK?: number): Promise<DocumentResult[]> {
        const params = new URLSearchParams({ q: query });
        if (topK !== undefined) params.set("top_k", String(topK));
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/search?${params}`);
        return res.json();
    }

    async ask(question: string, topK?: number): Promise<AskResponse> {
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/ask`, {
            method: "POST",
            headers: JSON_HEADERS,
            body: JSON.stringify({ question, top_k: topK ?? 0 }),
        });
        return res.json();
    }

    async *askStream(
        question: string,
        topK?: number,
        signal?: AbortSignal,
        options?: GenerationOptions,
    ): AsyncGenerator<SSEEvent> {
        const body: Record<string, unknown> = { question, top_k: topK ?? 0 };
        if (options && Object.keys(options).length > 0) body.options = options;
        const res = await this.fetchWithRetry(
            `${this.baseUrl}/api/ask/stream`,
            {
                method: "POST",
                headers: JSON_HEADERS,
                body: JSON.stringify(body),
            },
            { stream: true, signal },
        );
        yield* this.parseSSE(res);
    }

    async chat(question: string, history: Message[], topK?: number): Promise<AskResponse> {
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/chat`, {
            method: "POST",
            headers: JSON_HEADERS,
            body: JSON.stringify({ question, history, top_k: topK ?? 0 }),
        });
        return res.json();
    }

    async *chatStream(
        question: string,
        history: Message[],
        topK?: number,
        signal?: AbortSignal,
        options?: GenerationOptions,
    ): AsyncGenerator<SSEEvent> {
        const body: Record<string, unknown> = { question, history, top_k: topK ?? 0 };
        if (options && Object.keys(options).length > 0) body.options = options;
        const res = await this.fetchWithRetry(
            `${this.baseUrl}/api/chat/stream`,
            {
                method: "POST",
                headers: JSON_HEADERS,
                body: JSON.stringify(body),
            },
            { stream: true, signal },
        );
        yield* this.parseSSE(res);
    }

    async *addFiles(
        paths: string[],
        force = false,
        visionModel?: string,
        signal?: AbortSignal,
    ): AsyncGenerator<SSEEvent> {
        const body: Record<string, unknown> = { paths, force };
        if (visionModel) body.vision_model = visionModel;
        const res = await this.fetchWithRetry(
            `${this.baseUrl}/api/add`,
            {
                method: "POST",
                headers: JSON_HEADERS,
                body: JSON.stringify(body),
            },
            { stream: true, signal },
        );
        yield* this.parseSSE(res);
    }

    async *syncStream(forceVision = false, signal?: AbortSignal): AsyncGenerator<SSEEvent> {
        const res = await this.fetchWithRetry(
            `${this.baseUrl}/api/sync`,
            {
                method: "POST",
                headers: JSON_HEADERS,
                body: JSON.stringify({ force_vision: forceVision }),
            },
            { stream: true, signal },
        );
        yield* this.parseSSE(res);
    }

    async getCatalog<T = Record<string, unknown>>(
        task: "chat" | "vision",
        options?: { search?: string; featured?: boolean; limit?: number; offset?: number },
    ): Promise<{ total: number; limit: number; offset: number; models: T[] }> {
        const params = new URLSearchParams({ task });
        const entries: Record<string, string | undefined> = {
            search: options?.search,
            featured: options?.featured !== undefined ? String(options.featured) : undefined,
            limit: options?.limit !== undefined ? String(options.limit) : undefined,
            offset: options?.offset !== undefined ? String(options.offset) : undefined,
        };
        for (const [key, val] of Object.entries(entries)) {
            if (val !== undefined) params.set(key, val);
        }
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/models/catalog?${params}`);
        return res.json();
    }

    async listModels(): Promise<ModelsResponse> {
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/models`);
        return res.json();
    }

    async *pullModel(model: string, signal?: AbortSignal): AsyncGenerator<SSEEvent> {
        const res = await this.fetchWithRetry(
            `${this.baseUrl}/api/models/pull`,
            {
                method: "POST",
                headers: JSON_HEADERS,
                body: JSON.stringify({ model }),
            },
            { stream: true, signal },
        );
        yield* this.parseSSE(res);
    }

    async setChatModel(model: string): Promise<{ model: string }> {
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/models/chat`, {
            method: "PUT",
            headers: JSON_HEADERS,
            body: JSON.stringify({ model }),
        });
        return res.json();
    }

    async setVisionModel(model: string): Promise<{ model: string }> {
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/models/vision`, {
            method: "PUT",
            headers: JSON_HEADERS,
            body: JSON.stringify({ model }),
        });
        return res.json();
    }

    async showModel(model: string): Promise<ModelDefaults> {
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/models/show`, {
            method: "POST",
            headers: JSON_HEADERS,
            body: JSON.stringify({ model }),
        });
        const data = await res.json();
        return parseModelParameters(data.parameters ?? "", data);
    }

    async deleteModel(model: string): Promise<{ deleted: boolean }> {
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/models/${encodeURIComponent(model)}`, {
            method: "DELETE",
        });
        return res.json();
    }

    async listDocuments(
        search = "",
        limit = 50,
        offset = 0,
    ): Promise<DocumentListResponse> {
        const params = new URLSearchParams();
        if (search) params.set("search", search);
        params.set("limit", String(limit));
        params.set("offset", String(offset));
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/documents?${params}`);
        return res.json();
    }

    async removeDocuments(
        names: string[],
        deleteFiles = false,
    ): Promise<{ removed: string[]; not_found: string[] }> {
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/documents/remove`, {
            method: "POST",
            headers: JSON_HEADERS,
            body: JSON.stringify({ names, delete_files: deleteFiles }),
        });
        return res.json();
    }

    private async *parseSSE(response: Response): AsyncGenerator<SSEEvent> {
        if (!response.body) {
            throw new Error("Response body is null");
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let currentEvent: string = SSE_EVENT.MESSAGE;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            const lines = buffer.split("\n");
            // split() always returns at least one element, so pop() is never undefined
            buffer = lines.pop()!;

            for (const line of lines) {
                if (line.startsWith("event:")) {
                    currentEvent = (line.startsWith("event: ") ? line.slice(7) : line.slice(6)).trim();
                } else if (line.startsWith("data:")) {
                    const raw = line.startsWith("data: ") ? line.slice(6) : line.slice(5);
                    try {
                        yield { event: currentEvent, data: JSON.parse(raw) };
                    } catch {
                        yield { event: currentEvent, data: raw };
                    }
                    currentEvent = SSE_EVENT.MESSAGE;
                }
            }
        }
    }
}

const PARAM_KEY_MAP: Record<string, keyof ModelDefaults> = {
    temperature: "temperature",
    top_p: "top_p",
    top_k: "top_k",
    repeat_penalty: "repeat_penalty",
    num_ctx: "num_ctx",
    seed: "seed",
};

export function parseModelParameters(
    parameters: string,
    modelInfo: Record<string, unknown>,
): ModelDefaults {
    const defaults: ModelDefaults = {};
    for (const line of parameters.split("\n")) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 2) continue;
        const key = PARAM_KEY_MAP[parts[0]];
        if (key) {
            const num = Number(parts[1]);
            if (!isNaN(num)) defaults[key] = num;
        }
    }
    const ctxKey = Object.keys(modelInfo).find((k) => k.endsWith(".context_length"));
    if (ctxKey && !defaults.num_ctx) {
        const val = Number(modelInfo[ctxKey]);
        if (!isNaN(val) && val > 0) defaults.num_ctx = val;
    }
    return defaults;
}

