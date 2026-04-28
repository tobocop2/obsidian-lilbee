import { JSON_HEADERS, SEARCH_CHUNK_TYPE, SSE_EVENT, ERROR_NAME } from "./types";
import { ok, err, Result } from "neverthrow";

import type {
    AskResponse,
    CatalogResponse,
    ConfigResponse,
    ConfigUpdateResponse,
    DocumentResult,
    DocumentsResponse,
    GenerationOptions,
    InstalledResponse,
    Message,
    ModelShowResponse,
    ModelsResponse,
    ModelTask,
    SearchChunkType,
    SourceContent,
    SSEEvent,
    StatusResponse,
    LintResult,
    DraftAcceptResponse,
    DraftInfoResponse,
    DraftRejectResponse,
    WikiBuildResult,
    WikiCitationChain,
    WikiPage,
    WikiPageDetail,
    WikiStatusResult,
    WikiSynthesizeResult,
} from "./types";
const DEFAULT_TIMEOUT_MS = 15_000;
const RETRY_COUNT = 2;
const RETRY_BACKOFF_MS = 500;

/**
 * Thrown when the server rejects a request with 401 / 403 after the plugin's
 * auto-retry + token-refresh has failed. Signals that the stored session token
 * (manualToken or auto-discovered) is stale and the user needs to paste a new
 * one in Settings → Session token. Catchers should surface a targeted notice.
 */
export class SessionTokenError extends Error {
    readonly status: number;
    constructor(status: number, body: string) {
        super(`Session token invalid (HTTP ${status}): ${body}`);
        this.name = ERROR_NAME.SESSION_TOKEN;
        this.status = status;
    }
}

/**
 * Thrown when a request is attempted before the managed server has reported
 * its random listen port. Lets callers (settings UI, status bar) render a
 * "starting…" state instead of firing requests at the default port.
 */
export class ServerStartingError extends Error {
    constructor() {
        super("Server is still starting up");
        this.name = ERROR_NAME.SERVER_STARTING;
    }
}

export class LilbeeClient {
    private token: string | null = null;
    private tokenProvider: (() => string | null) | null = null;

    constructor(
        private baseUrl: string,
        token?: string,
    ) {
        if (token) this.token = token;
    }

    setToken(token: string | null): void {
        this.token = token;
    }

    setTokenProvider(provider: (() => string | null) | null): void {
        this.tokenProvider = provider;
    }

    /** Repoint the client at a new base URL in place — lets the wizard update
     * the target server without tearing down the existing client instance. */
    setBaseUrl(url: string): void {
        this.baseUrl = url;
    }

    private authHeaders(): Record<string, string> {
        if (!this.token) return {};
        return { Authorization: `Bearer ${this.token}` };
    }

    private refreshTokenFromProvider(): boolean {
        if (!this.tokenProvider) return false;
        const next = this.tokenProvider();
        if (next === null || next === this.token) return false;
        this.token = next;
        return true;
    }

    private applyRefreshedToken(init: RequestInit | undefined): RequestInit {
        const base = { ...init };
        const existing = (base.headers ?? {}) as Record<string, string>;
        if (existing.Authorization) {
            base.headers = { ...existing, Authorization: `Bearer ${this.token}` };
        }
        return base;
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
        if (!this.baseUrl) throw new ServerStartingError();
        const maxAttempts = RETRY_COUNT + 1;
        let lastError: unknown;
        let authRetried = false;
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
                    const res = await globalThis.fetch(url, fetchInit);
                    if ((res.status === 401 || res.status === 403) && !authRetried && this.refreshTokenFromProvider()) {
                        authRetried = true;
                        init = this.applyRefreshedToken(init);
                        continue;
                    }
                    if (res.status === 401 || res.status === 403) {
                        // Either no provider, provider returned the same token, or refreshed
                        // token still failed. The stored session token is stale — surface a
                        // typed error so the UI can tell the user what to do.
                        const text = await res.text().catch(() => "");
                        throw new SessionTokenError(res.status, text);
                    }
                    return await this.assertOk(res);
                } finally {
                    if (timer !== undefined) clearTimeout(timer);
                }
            } catch (err) {
                lastError = err;
                if (err instanceof SessionTokenError) {
                    throw err;
                }
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
        if (chunkType && chunkType !== SEARCH_CHUNK_TYPE.ALL) params.set("chunk_type", chunkType);
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/search?${params}`);
        return res.json();
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
        chunkType?: SearchChunkType,
    ): AsyncGenerator<SSEEvent> {
        const body: Record<string, unknown> = { question, history, top_k: topK ?? 0 };
        if (options && Object.keys(options).length > 0) body.options = options;
        // "all" is the UI-side label for no filter; the field is omitted on the wire.
        if (chunkType && chunkType !== SEARCH_CHUNK_TYPE.ALL) body.chunk_type = chunkType;
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
        enableOcr?: boolean | null,
        signal?: AbortSignal,
        ocrTimeout?: number | null,
    ): AsyncGenerator<SSEEvent> {
        const body: Record<string, unknown> = { paths, force };
        if (enableOcr !== undefined && enableOcr !== null) body.enable_ocr = enableOcr;
        if (ocrTimeout !== undefined && ocrTimeout !== null) body.ocr_timeout = ocrTimeout;
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

    async *syncStream(enableOcr?: boolean | null, signal?: AbortSignal): AsyncGenerator<SSEEvent> {
        const body: Record<string, unknown> = {};
        if (enableOcr !== undefined && enableOcr !== null) body.enable_ocr = enableOcr;
        const res = await this.fetchWithRetry(
            `${this.baseUrl}/api/sync`,
            {
                method: "POST",
                headers: { ...JSON_HEADERS, ...this.authHeaders() },
                body: JSON.stringify(body),
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

    async catalog(params?: {
        task?: ModelTask;
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
        return this.fetchResult<CatalogResponse>(`${this.baseUrl}/api/models/catalog${suffix}`);
    }

    async installedModels(params?: { task?: ModelTask }): Promise<InstalledResponse> {
        const qs = new URLSearchParams();
        if (params?.task) qs.set("task", params.task);
        const suffix = qs.toString() ? `?${qs}` : "";
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/models/installed${suffix}`);
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
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/documents${suffix}`, {
            headers: this.authHeaders(),
        });
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

    async *crawl(
        url: string,
        depth?: number | null,
        maxPages?: number | null,
        signal?: AbortSignal,
    ): AsyncGenerator<SSEEvent> {
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

    async config(): Promise<ConfigResponse> {
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/config`);
        return res.json();
    }

    async configDefaults(): Promise<Record<string, unknown>> {
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/config/defaults`);
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

    async setRerankerModel(model: string): Promise<Result<void, Error>> {
        return this.fetchResult<void>(`${this.baseUrl}/api/models/reranker`, {
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

    async wikiLint(): Promise<LintResult> {
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/wiki/lint`, {
            method: "POST",
            headers: this.authHeaders(),
        });
        return res.json();
    }

    async wikiBuild(): Promise<WikiBuildResult> {
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/wiki/build`, {
            method: "POST",
            headers: this.authHeaders(),
        });
        return res.json();
    }

    async wikiUpdate(): Promise<WikiBuildResult> {
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/wiki/update`, {
            method: "PATCH",
            headers: this.authHeaders(),
        });
        return res.json();
    }

    async wikiStatus(): Promise<WikiStatusResult> {
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/wiki/status`, {
            headers: this.authHeaders(),
        });
        return res.json();
    }

    async wikiSynthesize(): Promise<WikiSynthesizeResult> {
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/wiki/synthesize`, {
            method: "POST",
            headers: this.authHeaders(),
        });
        return res.json();
    }

    /**
     * Fetch the rendered text of a source file (markdown / html / plaintext)
     * as JSON. Used by the preview modal when the file is not in the vault.
     */
    async getSource(source: string): Promise<SourceContent> {
        const params = new URLSearchParams({ source });
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/source?${params}`, {
            headers: this.authHeaders(),
        });
        return res.json();
    }

    /**
     * Fetch the raw bytes of a source file with its original Content-Type.
     * Returns the raw Response so callers can read `arrayBuffer()` or stream
     * it into an `<object>` tag (e.g. PDFs in the preview modal).
     */
    async getSourceRaw(source: string): Promise<Response> {
        const params = new URLSearchParams({ source, raw: "1" });
        return this.fetchWithRetry(`${this.baseUrl}/api/source?${params}`, {
            headers: this.authHeaders(),
        });
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

    async wikiDrafts(): Promise<DraftInfoResponse[]> {
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/wiki/drafts`, { headers: this.authHeaders() });
        return res.json();
    }

    async wikiDraftDiff(slug: string): Promise<string> {
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/wiki/drafts/${encodeURIComponent(slug)}/diff`, {
            headers: this.authHeaders(),
        });
        return res.text();
    }

    async wikiDraftAccept(slug: string): Promise<DraftAcceptResponse> {
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/wiki/drafts/${encodeURIComponent(slug)}/accept`, {
            method: "POST",
            headers: this.authHeaders(),
        });
        return res.json();
    }

    async wikiDraftReject(slug: string): Promise<DraftRejectResponse> {
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/wiki/drafts/${encodeURIComponent(slug)}`, {
            method: "DELETE",
            headers: this.authHeaders(),
        });
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
