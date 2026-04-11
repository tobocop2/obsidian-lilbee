import { JSON_HEADERS, SSE_EVENT, ERROR_NAME } from "./types";
import { ok, err, Result } from "neverthrow";

import type {
    AskResponse,
    CatalogResponse,
    CatalogServerEntry,
    CatalogServerResponse,
    ConfigUpdateResponse,
    DocumentResult,
    DocumentsResponse,
    GenerationOptions,
    InstalledResponse,
    Message,
    ModelFamily,
    ModelShowResponse,
    ModelsResponse,
    ModelVariant,
    SearchChunkType,
    SSEEvent,
    StatusResponse,
    WikiCitationChain,
    WikiDraft,
    WikiPage,
    WikiPageDetail,
} from "./types";
const DEFAULT_TIMEOUT_MS = 15_000;
const RETRY_COUNT = 2;
const RETRY_BACKOFF_MS = 500;

/**
 * Adapt a server catalog response to the plugin's expected {families} shape.
 * Older servers return `{models: CatalogServerEntry[]}` (flat list); newer
 * servers will return `{families: ModelFamily[]}` directly. This function lets
 * the plugin work with both. See `bb-jffs`.
 *
 * When adapting the flat shape, entries are grouped by `name` into synthetic
 * families. `task` and `featured` are inferred from the request params where
 * possible (passed via the fallback arg). `hf_repo` falls back to the entry's
 * own field when the server emits it; otherwise it's disambiguated via
 * `synthesizeRef()` so sibling variants (e.g. qwen3 0.6B vs qwen3 8B) do NOT
 * collide on a single identifier. The server's `pull` / `set` / `delete`
 * endpoints parse the ref back into a canonical name, so even with a best-
 * effort ref the downstream request is unambiguous about which variant the
 * user picked. Once the server starts emitting per-variant `hf_repo` / `tag`
 * directly, the fallback goes unused.
 */
export function adaptCatalogResponse(
    response: CatalogServerResponse,
    fallback?: { task?: string; featured?: boolean },
): CatalogResponse {
    if (response.families) {
        return {
            total: response.total,
            limit: response.limit,
            offset: response.offset,
            families: response.families,
        };
    }
    const entries = response.models ?? [];
    const familyMap = new Map<string, ModelFamily>();
    for (const e of entries) {
        const task = e.task ?? fallback?.task ?? "";
        const featured = e.featured ?? fallback?.featured ?? false;
        const variant: ModelVariant = {
            name: e.name,
            hf_repo: e.hf_repo ?? synthesizeRef(e),
            size_gb: e.size_gb,
            min_ram_gb: e.min_ram_gb,
            description: e.description,
            task,
            installed: e.installed,
            source: e.source === "litellm" ? "litellm" : "native",
            display_name: e.display_name,
            quality_tier: e.quality_tier,
            downloads: e.downloads,
            featured: e.featured,
        };
        const existing = familyMap.get(e.name);
        if (existing) {
            existing.variants.push(variant);
            if (featured) existing.featured = true;
        } else {
            familyMap.set(e.name, {
                family: e.name,
                task,
                featured,
                recommended: variant.hf_repo,
                variants: [variant],
            });
        }
    }
    return {
        total: response.total,
        limit: response.limit,
        offset: response.offset,
        families: Array.from(familyMap.values()),
    };
}

/**
 * Construct a best-effort `name:tag` identifier for a flat catalog entry
 * that lacks an explicit `hf_repo` or `tag`. Strategy:
 *  1. If the entry has an explicit tag, use `{name}:{tag}`.
 *  2. Otherwise derive a tag from `display_name` by stripping the family
 *     prefix (e.g. "Qwen3 8B" → "8b"). This gives sibling variants
 *     distinct refs so `pull`/`set`/`delete` can route to the correct one.
 *  3. As a last resort — no display_name disambiguator — fall back to
 *     `latest`, which collapses variants but at least resolves to
 *     *something* the server understands.
 */
function synthesizeRef(e: CatalogServerEntry): string {
    if (e.tag) return `${e.name}:${e.tag}`;
    const display = e.display_name?.trim() ?? "";
    const familyPrefix = e.name.replace(/-/g, " ").toLowerCase();
    const displayLower = display.toLowerCase();
    let suffix = displayLower.startsWith(familyPrefix) ? displayLower.slice(familyPrefix.length).trim() : displayLower;
    suffix = suffix.replace(/\s+/g, "-");
    if (!suffix || suffix === e.name.toLowerCase()) return `${e.name}:latest`;
    return `${e.name}:${suffix}`;
}

export class LilbeeClient {
    private token: string | null = null;

    constructor(
        private baseUrl: string,
        token?: string,
    ) {
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

    private async fetchResult<T>(
        url: string,
        init?: RequestInit,
        opts?: { stream?: boolean; signal?: AbortSignal },
    ): Promise<Result<T, Error>> {
        try {
            const res = await this.fetchWithRetry(url, init, opts);
            const value = (await res.json()) as T;
            return ok(value);
        } catch (e) {
            return err(e instanceof Error ? e : new Error(String(e)));
        }
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
                if (err instanceof Error && err.name === ERROR_NAME.ABORT_ERROR) {
                    throw err;
                }
            }
        }
        throw lastError;
    }

    async health(): Promise<Result<{ status: string; version: string }, Error>> {
        return this.fetchResult(`${this.baseUrl}/api/health`);
    }

    async status(): Promise<Result<StatusResponse, Error>> {
        return this.fetchResult(`${this.baseUrl}/api/status`);
    }

    async search(query: string, topK?: number, chunkType?: SearchChunkType): Promise<DocumentResult[]> {
        const params = new URLSearchParams({ q: query });
        if (topK !== undefined) params.set("top_k", String(topK));
        if (chunkType && chunkType !== "all") params.set("chunk_type", chunkType);
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

    async setChatModel(model: string): Promise<Result<void, Error>> {
        return this.fetchResult<void>(`${this.baseUrl}/api/models/chat`, {
            method: "PUT",
            headers: { ...JSON_HEADERS, ...this.authHeaders() },
            body: JSON.stringify({ model }),
        });
    }

    async setVisionModel(model: string): Promise<Result<void, Error>> {
        return this.fetchResult<void>(`${this.baseUrl}/api/models/vision`, {
            method: "PUT",
            headers: { ...JSON_HEADERS, ...this.authHeaders() },
            body: JSON.stringify({ model }),
        });
    }

    async catalog(params?: {
        task?: "chat" | "embedding" | "vision";
        search?: string;
        size?: "small" | "medium" | "large";
        sort?: "featured" | "downloads" | "name" | "size_asc" | "size_desc";
        featured?: boolean;
        limit?: number;
        offset?: number;
    }): Promise<Result<CatalogResponse, Error>> {
        const qs = new URLSearchParams();
        if (params?.task) qs.set("task", params.task);
        if (params?.search) qs.set("search", params.search);
        if (params?.size) qs.set("size", params.size);
        if (params?.sort) qs.set("sort", params.sort);
        if (params?.featured !== undefined) qs.set("featured", String(params.featured));
        if (params?.limit !== undefined) qs.set("limit", String(params.limit));
        if (params?.offset !== undefined) qs.set("offset", String(params.offset));
        const suffix = qs.toString() ? `?${qs}` : "";
        const raw = await this.fetchResult<CatalogServerResponse>(`${this.baseUrl}/api/models/catalog${suffix}`);
        if (raw.isErr()) return err(raw.error);
        return ok(
            adaptCatalogResponse(raw.value, {
                task: params?.task,
                featured: params?.featured,
            }),
        );
    }

    async installedModels(): Promise<InstalledResponse> {
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/models/installed`);
        return res.json();
    }

    async showModel(model: string): Promise<ModelShowResponse> {
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/models/show`, {
            method: "POST",
            headers: { ...JSON_HEADERS, ...this.authHeaders() },
            body: JSON.stringify({ model }),
        });
        return res.json();
    }

    async deleteModel(
        model: string,
        source = "native",
    ): Promise<Result<{ deleted: boolean; model: string; freed_gb: number }, Error>> {
        return this.fetchResult(`${this.baseUrl}/api/models/${encodeURIComponent(model)}?source=${source}`, {
            method: "DELETE",
            headers: this.authHeaders(),
        });
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

    async setEmbeddingModel(model: string): Promise<Result<void, Error>> {
        return this.fetchResult<void>(`${this.baseUrl}/api/models/embedding`, {
            method: "PUT",
            headers: { ...JSON_HEADERS, ...this.authHeaders() },
            body: JSON.stringify({ model }),
        });
    }

    async wikiList(): Promise<WikiPage[]> {
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/wiki`, { headers: this.authHeaders() });
        return res.json();
    }

    async wikiPage(slug: string): Promise<WikiPageDetail> {
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/wiki/${encodeURIComponent(slug)}`, {
            headers: this.authHeaders(),
        });
        return res.json();
    }

    async wikiCitations(slug: string): Promise<WikiCitationChain> {
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/wiki/${encodeURIComponent(slug)}/citations`, {
            headers: this.authHeaders(),
        });
        return res.json();
    }

    async wikiCitationsForSource(filename: string): Promise<WikiCitationChain[]> {
        const params = new URLSearchParams({ source: filename });
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/wiki/citations?${params}`, {
            headers: this.authHeaders(),
        });
        return res.json();
    }

    async *wikiLint(signal?: AbortSignal): AsyncGenerator<SSEEvent> {
        const res = await this.fetchWithRetry(
            `${this.baseUrl}/api/wiki/lint`,
            {
                method: "POST",
                headers: this.authHeaders(),
            },
            { stream: true, signal },
        );
        yield* this.parseSSE(res);
    }

    async *wikiGenerate(source: string, signal?: AbortSignal): AsyncGenerator<SSEEvent> {
        const res = await this.fetchWithRetry(
            `${this.baseUrl}/api/wiki/generate`,
            {
                method: "POST",
                headers: { ...JSON_HEADERS, ...this.authHeaders() },
                body: JSON.stringify({ source }),
            },
            { stream: true, signal },
        );
        yield* this.parseSSE(res);
    }

    async wikiDrafts(): Promise<WikiDraft[]> {
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/wiki/drafts`, { headers: this.authHeaders() });
        return res.json();
    }

    async *wikiPrune(signal?: AbortSignal): AsyncGenerator<SSEEvent> {
        const res = await this.fetchWithRetry(
            `${this.baseUrl}/api/wiki/prune`,
            {
                method: "POST",
                headers: this.authHeaders(),
            },
            { stream: true, signal },
        );
        yield* this.parseSSE(res);
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
