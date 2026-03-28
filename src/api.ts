import { JSON_HEADERS, SSE_EVENT } from "./types";
import type {
    AskResponse,
    CatalogResponse,
    ConfigUpdateResponse,
    DocumentResult,
    DocumentsResponse,
    EmbeddingModelResponse,
    GenerationOptions,
    InstalledResponse,
    Message,
    ModelsResponse,
    SSEEvent,
    StatusResponse,
} from "./types";

const DEFAULT_TIMEOUT_MS = 15_000;
const RETRY_COUNT = 2;
const RETRY_BACKOFF_MS = 500;

export class LilbeeClient {
    private token: string | null = null;

    constructor(private baseUrl: string, token?: string) {
        if (token) this.token = token;
    }

    setToken(token: string | null): void {
        this.token = token;
    }

    private authHeaders(): Record<string, string> {
        if (!this.token) return {};
        return { Authorization: `Bearer ${this.token}` };
    }

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
            headers: { ...JSON_HEADERS, ...this.authHeaders() },
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
                headers: { ...JSON_HEADERS, ...this.authHeaders() },
                body: JSON.stringify(body),
            },
            { stream: true, signal },
        );
        yield* this.parseSSE(res);
    }

    async chat(question: string, history: Message[], topK?: number): Promise<AskResponse> {
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/chat`, {
            method: "POST",
            headers: { ...JSON_HEADERS, ...this.authHeaders() },
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
                headers: { ...JSON_HEADERS, ...this.authHeaders() },
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
                headers: { ...JSON_HEADERS, ...this.authHeaders() },
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
                headers: { ...JSON_HEADERS, ...this.authHeaders() },
                body: JSON.stringify({ force_vision: forceVision }),
            },
            { stream: true, signal },
        );
        yield* this.parseSSE(res);
    }

    async listModels(): Promise<ModelsResponse> {
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/models`);
        return res.json();
    }

    async *pullModel(model: string, source = "native", signal?: AbortSignal): AsyncGenerator<SSEEvent> {
        const res = await this.fetchWithRetry(
            `${this.baseUrl}/api/models/pull`,
            {
                method: "POST",
                headers: { ...JSON_HEADERS, ...this.authHeaders() },
                body: JSON.stringify({ model, source }),
                signal,
            },
            { stream: true },
        );
        yield* this.parseSSE(res);
    }

    async setChatModel(model: string): Promise<{ model: string }> {
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/models/chat`, {
            method: "PUT",
            headers: { ...JSON_HEADERS, ...this.authHeaders() },
            body: JSON.stringify({ model }),
        });
        return res.json();
    }

    async setVisionModel(model: string): Promise<{ model: string }> {
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/models/vision`, {
            method: "PUT",
            headers: { ...JSON_HEADERS, ...this.authHeaders() },
            body: JSON.stringify({ model }),
        });
        return res.json();
    }

    async catalog(params?: {
        task?: "chat" | "embedding" | "vision";
        search?: string;
        size?: "small" | "medium" | "large";
        sort?: "featured" | "downloads" | "name" | "size_asc" | "size_desc";
        featured?: boolean;
        limit?: number;
        offset?: number;
    }): Promise<CatalogResponse> {
        const qs = new URLSearchParams();
        if (params?.task) qs.set("task", params.task);
        if (params?.search) qs.set("search", params.search);
        if (params?.size) qs.set("size", params.size);
        if (params?.sort) qs.set("sort", params.sort);
        if (params?.featured !== undefined) qs.set("featured", String(params.featured));
        if (params?.limit !== undefined) qs.set("limit", String(params.limit));
        if (params?.offset !== undefined) qs.set("offset", String(params.offset));
        const suffix = qs.toString() ? `?${qs}` : "";
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/models/catalog${suffix}`);
        return res.json();
    }

    async installedModels(): Promise<InstalledResponse> {
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/models/installed`);
        return res.json();
    }

    async showModel(model: string): Promise<Record<string, unknown>> {
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/models/show`, {
            method: "POST",
            headers: { ...JSON_HEADERS, ...this.authHeaders() },
            body: JSON.stringify({ model }),
        });
        return res.json();
    }

    async deleteModel(model: string, source = "native"): Promise<{ deleted: boolean; model: string; freed_gb: number }> {
        const res = await this.fetchWithRetry(
            `${this.baseUrl}/api/models/${encodeURIComponent(model)}?source=${source}`,
            {
                method: "DELETE",
                headers: this.authHeaders(),
            },
        );
        return res.json();
    }

    async listDocuments(search?: string, limit?: number, offset?: number): Promise<DocumentsResponse> {
        const qs = new URLSearchParams();
        if (search) qs.set("search", search);
        if (limit !== undefined) qs.set("limit", String(limit));
        if (offset !== undefined) qs.set("offset", String(offset));
        const suffix = qs.toString() ? `?${qs}` : "";
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/documents${suffix}`);
        return res.json();
    }

    async removeDocuments(names: string[], deleteFiles = false): Promise<{ removed: number; not_found: string[] }> {
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/documents/remove`, {
            method: "POST",
            headers: { ...JSON_HEADERS, ...this.authHeaders() },
            body: JSON.stringify({ names, delete_files: deleteFiles }),
        });
        return res.json();
    }

    async *crawl(url: string, depth?: number, maxPages?: number, signal?: AbortSignal): AsyncGenerator<SSEEvent> {
        const body: Record<string, unknown> = { url };
        if (depth !== undefined) body.depth = depth;
        if (maxPages !== undefined) body.max_pages = maxPages;
        const res = await this.fetchWithRetry(
            `${this.baseUrl}/api/crawl`,
            {
                method: "POST",
                headers: { ...JSON_HEADERS, ...this.authHeaders() },
                body: JSON.stringify(body),
                signal,
            },
            { stream: true },
        );
        yield* this.parseSSE(res);
    }

    async config(): Promise<Record<string, unknown>> {
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/config`);
        return res.json();
    }

    async updateConfig(updates: Record<string, unknown>): Promise<ConfigUpdateResponse> {
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/config`, {
            method: "PATCH",
            headers: { ...JSON_HEADERS, ...this.authHeaders() },
            body: JSON.stringify(updates),
        });
        return res.json();
    }

    async setEmbeddingModel(model: string): Promise<EmbeddingModelResponse> {
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/models/embedding`, {
            method: "PUT",
            headers: { ...JSON_HEADERS, ...this.authHeaders() },
            body: JSON.stringify({ model }),
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
