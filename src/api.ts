import {
    CAPABILITY,
    JSON_HEADERS,
    OCTET_STREAM_HEADERS,
    REQUEST_OUTCOME,
    SEARCH_CHUNK_TYPE,
    SSE_EVENT,
    ERROR_NAME,
} from "./types";
import { ok, err, Result } from "./result";

import type {
    AskResponse,
    Capability,
    CatalogResponse,
    ConfigResponse,
    ConfigUpdateResponse,
    ConversationState,
    CrawlRenderMode,
    DatasetFormat,
    DocumentResult,
    DocumentsResponse,
    GenerationOptions,
    GpuInfo,
    HealthResponse,
    InstalledResponse,
    PlacementResponse,
    PlacementSpec,
    MemoryFlagsResponse,
    MemoryItem,
    MemoryKind,
    MemoryListResponse,
    MemoryRemoveResponse,
    Message,
    ModelShowResponse,
    SessionDeleteResponse,
    SessionDetail,
    SessionListResponse,
    SessionMeta,
    SessionRenameResponse,
    SessionRole,
    RememberResponse,
    ModelsResponse,
    ModelTask,
    RequestOutcome,
    SearchChunkType,
    SourceContent,
    SSEEvent,
    StatusResponse,
    SyncOptions,
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
// In managed mode, the plugin's onload doesn't configure the API until
// startManagedServer finishes (binary download + server boot). A caller
// firing a chat or catalog request in that window would otherwise see
// "Server is still starting up" with no recovery. Poll for the URL
// instead of bailing immediately; if it never lands, the throw still
// happens, just deferred.
const STARTUP_WAIT_MS = 12_000;
const STARTUP_POLL_INTERVAL_MS = 250;

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

/**
 * Thrown when the server returns HTTP 429 (e.g. a streaming endpoint already
 * has a stream in flight from another client). Carries the optional Retry-After
 * value in seconds so callers can include it in user copy. Never auto-retried —
 * the bead contract is "surface gracefully, do not silently retry-loop".
 */
export class RateLimitedError extends Error {
    readonly retryAfterSeconds: number | null;
    constructor(retryAfterSeconds: number | null = null) {
        super("lilbee is busy with another request");
        this.name = ERROR_NAME.RATE_LIMITED;
        this.retryAfterSeconds = retryAfterSeconds;
    }
}

/**
 * True when a `fetchResult` error came from a specific HTTP status. `assertOk`
 * formats non-ok responses as `Server responded <status>: <body>`, so callers
 * (e.g. the placement view distinguishing a 409 "apply not enabled" from a real
 * failure) can branch on the status without a bespoke error type per route.
 */
export function isHttpStatus(error: Error, status: number): boolean {
    return error.message.startsWith(`Server responded ${status}`);
}

export class LilbeeClient {
    private token: string | null = null;
    private tokenProvider: (() => string | null) | null = null;
    private outcomeCb: ((o: RequestOutcome) => void) | null = null;
    private capabilityCache: Map<Capability, boolean> = new Map();

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

    /** Subscribe to the outcome of every ``fetchWithRetry`` call. */
    setOutcomeCallback(cb: ((o: RequestOutcome) => void) | null): void {
        this.outcomeCb = cb;
    }

    private recordOutcome(outcome: RequestOutcome): void {
        this.outcomeCb?.(outcome);
    }

    /** Repoint the client at a new base URL in place — lets the wizard update
     * the target server without tearing down the existing client instance. */
    setBaseUrl(url: string): void {
        this.baseUrl = url;
    }

    /** Reachability probe for an arbitrary URL. True on an ok response, false on
     * any error or timeout. Keeps browser fetch inside this module. */
    static async probe(url: string, timeoutMs: number): Promise<boolean> {
        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), timeoutMs);
        try {
            const res = await window.fetch(url, { signal: controller.signal });
            return res.ok;
        } catch {
            return false;
        } finally {
            window.clearTimeout(timer);
        }
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
        if (res.status === 429) {
            const header = res.headers.get("Retry-After");
            const seconds = header ? parseInt(header, 10) : NaN;
            throw new RateLimitedError(Number.isFinite(seconds) ? seconds : null);
        }
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
        // Detect a URL that was pre-interpolated with an empty baseUrl
        // (callers do `${this.baseUrl}/api/...` — when baseUrl is "" the
        // result starts with "/api/..."). After the startup wait below
        // we rebuild it with the real host.
        const isRelative = !/^https?:\/\//i.test(url);
        const path = isRelative ? (url.startsWith("/") ? url : `/${url}`) : null;
        if (!this.baseUrl) {
            const deadline = Date.now() + STARTUP_WAIT_MS;
            while (!this.baseUrl && Date.now() < deadline) {
                await new Promise((r) => window.setTimeout(r, STARTUP_POLL_INTERVAL_MS));
            }
            if (!this.baseUrl) {
                this.recordOutcome(REQUEST_OUTCOME.STARTING);
                throw new ServerStartingError();
            }
        }
        if (path !== null) {
            url = `${this.baseUrl}${path}`;
        }
        const maxAttempts = RETRY_COUNT + 1;
        let lastError: unknown;
        let authRetried = false;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            if (attempt > 0) {
                await new Promise((r) => window.setTimeout(r, RETRY_BACKOFF_MS * attempt));
            }
            try {
                const fetchInit = { ...init };
                let timer: number | undefined;
                if (opts?.signal) {
                    fetchInit.signal = opts.signal;
                } else if (!opts?.stream) {
                    const controller = new AbortController();
                    fetchInit.signal = controller.signal;
                    timer = window.setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
                }
                try {
                    const res = await window.fetch(url, fetchInit);
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
                        this.recordOutcome(REQUEST_OUTCOME.AUTH_ERROR);
                        throw new SessionTokenError(res.status, text);
                    }
                    const okRes = await this.assertOk(res);
                    this.recordOutcome(REQUEST_OUTCOME.OK);
                    return okRes;
                } finally {
                    if (timer !== undefined) window.clearTimeout(timer);
                }
            } catch (err) {
                lastError = err;
                if (err instanceof SessionTokenError) {
                    throw err;
                }
                if (err instanceof RateLimitedError) {
                    this.recordOutcome(REQUEST_OUTCOME.SERVER_ERROR);
                    throw err;
                }
                if (err instanceof Error && err.message.startsWith("Server responded")) {
                    // A 4xx is a reachable server rejecting this request (validation,
                    // not-found, conflict) that the caller handles — don't flag a
                    // global server error. Only 5xx flips the status to error.
                    const status = parseInt(err.message.slice("Server responded ".length), 10);
                    this.recordOutcome(status >= 500 ? REQUEST_OUTCOME.SERVER_ERROR : REQUEST_OUTCOME.OK);
                    throw err;
                }
                if (err instanceof Error && err.name === ERROR_NAME.ABORT_ERROR) {
                    throw err;
                }
            }
        }
        this.recordOutcome(REQUEST_OUTCOME.UNREACHABLE);
        throw lastError;
    }

    async health(): Promise<Result<HealthResponse, Error>> {
        return this.fetchResult(`${this.baseUrl}/api/health`);
    }

    async status(): Promise<Result<StatusResponse, Error>> {
        return this.fetchResult(`${this.baseUrl}/api/status`);
    }

    /** Cached per session; fail-open on probe error (showing a section that won't work degrades better than hiding one the user needs). */
    async getCapability(cap: Capability): Promise<boolean> {
        const cached = this.capabilityCache.get(cap);
        if (cached !== undefined) return cached;
        let value: boolean;
        try {
            value = await this.probeCapability(cap);
        } catch {
            value = true;
        }
        this.capabilityCache.set(cap, value);
        return value;
    }

    invalidateCapability(cap?: Capability): void {
        if (cap === undefined) {
            this.capabilityCache.clear();
            return;
        }
        this.capabilityCache.delete(cap);
    }

    private async probeCapability(cap: Capability): Promise<boolean> {
        switch (cap) {
            case CAPABILITY.API_KEYS:
                return this.probeLitellmInstalled();
            case CAPABILITY.CRAWLING:
                return this.probeCrawlerInstalled();
            case CAPABILITY.WIKI:
                return this.probeWikiEnabled();
        }
    }

    private async probeLitellmInstalled(): Promise<boolean> {
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/models/external`);
        const body = (await res.json()) as { models?: unknown; error?: unknown };
        return body.error === null || body.error === undefined;
    }

    private async probeCrawlerInstalled(): Promise<boolean> {
        const res = await this.fetchWithRetry(`${this.baseUrl}/setup/crawler/status`);
        const body = (await res.json()) as { package_installed?: boolean };
        return body.package_installed === true;
    }

    private async probeWikiEnabled(): Promise<boolean> {
        const cfg = await this.config();
        return cfg.wiki === true;
    }

    async search(query: string, topK?: number, chunkType?: SearchChunkType): Promise<DocumentResult[]> {
        const params = new URLSearchParams({ q: query });
        if (topK !== undefined) params.set("top_k", String(topK));
        if (chunkType && chunkType !== SEARCH_CHUNK_TYPE.ALL) params.set("chunk_type", chunkType);
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/search?${params}`);
        return (await res.json()) as DocumentResult[];
    }

    async chat(question: string, history: Message[], topK?: number): Promise<AskResponse> {
        // Omitted top_k uses the server's configured default; an explicit 0 disables retrieval.
        const body: Record<string, unknown> = { question, history };
        if (topK !== undefined) body.top_k = topK;
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/chat`, {
            method: "POST",
            headers: { ...JSON_HEADERS, ...this.authHeaders() },
            body: JSON.stringify(body),
        });
        return (await res.json()) as AskResponse;
    }

    async listSessions(): Promise<SessionMeta[]> {
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/sessions`);
        const data = (await res.json()) as SessionListResponse;
        return data.sessions;
    }

    async getSession(sessionId: string): Promise<SessionDetail> {
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}`);
        return (await res.json()) as SessionDetail;
    }

    /** The server takes no title here; `renameSession` is the only HTTP title write. */
    async createSession(modelRef: string, scope: string): Promise<SessionDetail> {
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/sessions`, {
            method: "POST",
            headers: { ...JSON_HEADERS, ...this.authHeaders() },
            body: JSON.stringify({ model_ref: modelRef, scope }),
        });
        return (await res.json()) as SessionDetail;
    }

    async appendSessionMessage(
        sessionId: string,
        role: SessionRole,
        content: string,
        sources: string[] = [],
    ): Promise<SessionDetail> {
        const res = await this.fetchWithRetry(
            `${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/messages`,
            {
                method: "POST",
                headers: { ...JSON_HEADERS, ...this.authHeaders() },
                body: JSON.stringify({ role, content, sources }),
            },
        );
        return (await res.json()) as SessionDetail;
    }

    async renameSession(sessionId: string, title: string): Promise<SessionRenameResponse> {
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}`, {
            method: "PATCH",
            headers: { ...JSON_HEADERS, ...this.authHeaders() },
            body: JSON.stringify({ title }),
        });
        return (await res.json()) as SessionRenameResponse;
    }

    async deleteSession(sessionId: string): Promise<SessionDeleteResponse> {
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}`, {
            method: "DELETE",
            headers: { ...JSON_HEADERS, ...this.authHeaders() },
        });
        return (await res.json()) as SessionDeleteResponse;
    }

    async listMemories(): Promise<MemoryItem[]> {
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/memories`);
        const data = (await res.json()) as MemoryListResponse;
        return data.memories;
    }

    async remember(text: string, kind: MemoryKind, shared = false): Promise<RememberResponse> {
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/memories`, {
            method: "POST",
            headers: { ...JSON_HEADERS, ...this.authHeaders() },
            body: JSON.stringify({ text, kind, shared }),
        });
        return (await res.json()) as RememberResponse;
    }

    async setMemoryShared(id: string, shared: boolean): Promise<MemoryFlagsResponse> {
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/memories/${encodeURIComponent(id)}`, {
            method: "PATCH",
            headers: { ...JSON_HEADERS, ...this.authHeaders() },
            body: JSON.stringify({ shared }),
        });
        return (await res.json()) as MemoryFlagsResponse;
    }

    async forgetMemory(id: string): Promise<MemoryRemoveResponse> {
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/memories/${encodeURIComponent(id)}`, {
            method: "DELETE",
            headers: { ...this.authHeaders() },
        });
        return (await res.json()) as MemoryRemoveResponse;
    }

    async *chatStream(
        question: string,
        history: Message[],
        topK?: number,
        signal?: AbortSignal,
        options?: GenerationOptions,
        chunkType?: SearchChunkType,
        conversation?: ConversationState,
    ): AsyncGenerator<SSEEvent, void> {
        // Omitted top_k uses the server's configured default; an explicit 0 disables retrieval.
        const body: Record<string, unknown> = { question, history };
        if (topK !== undefined) body.top_k = topK;
        if (options && Object.keys(options).length > 0) body.options = options;
        // "all" is the UI-side label for no filter; the field is omitted on the wire.
        if (chunkType && chunkType !== SEARCH_CHUNK_TYPE.ALL) body.chunk_type = chunkType;
        if (conversation?.summary) body.summary = conversation.summary;
        if (conversation?.sessionId) body.session_id = conversation.sessionId;
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
        signal?: AbortSignal,
        ocrTimeout?: number | null,
    ): AsyncGenerator<SSEEvent, void> {
        const body: Record<string, unknown> = { paths, force };
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

    /**
     * Upload file CONTENT to /api/add/upload and stream ingest progress. Used
     * when the server is remote (external mode): the plugin can't hand it a
     * server-readable path, so it sends the bytes straight from the vault.
     * FormData sets its own multipart Content-Type, so no JSON header here.
     */
    async *uploadFiles(
        files: { name: string; data: ArrayBuffer }[],
        signal?: AbortSignal,
    ): AsyncGenerator<SSEEvent, void> {
        const form = new FormData();
        for (const file of files) form.append("data", new Blob([file.data]), file.name);
        const res = await this.fetchWithRetry(
            `${this.baseUrl}/api/add/upload`,
            {
                method: "POST",
                headers: { ...this.authHeaders() },
                body: form,
            },
            { stream: true, signal },
        );
        yield* this.parseSSE(res);
    }

    async *syncStream(signal?: AbortSignal, options?: SyncOptions): AsyncGenerator<SSEEvent, void> {
        const body: Record<string, unknown> = {};
        if (options?.forceRebuild) body.force_rebuild = true;
        if (options?.retrySkipped) body.retry_skipped = true;
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
        return (await res.json()) as ModelsResponse;
    }

    async *pullModel(model: string, source = "native", signal?: AbortSignal): AsyncGenerator<SSEEvent, void> {
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
        installed?: boolean;
        limit?: number;
        offset?: number;
    }): Promise<Result<CatalogResponse, Error>> {
        const qs = new URLSearchParams();
        if (params?.task) qs.set("task", params.task);
        if (params?.search) qs.set("search", params.search);
        if (params?.size) qs.set("size", params.size);
        if (params?.sort) qs.set("sort", params.sort);
        if (params?.featured !== undefined) qs.set("featured", String(params.featured));
        if (params?.installed !== undefined) qs.set("installed", String(params.installed));
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
        return (await res.json()) as InstalledResponse;
    }

    async showModel(model: string): Promise<ModelShowResponse> {
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/models/show`, {
            method: "POST",
            headers: { ...JSON_HEADERS, ...this.authHeaders() },
            body: JSON.stringify({ model }),
        });
        return (await res.json()) as ModelShowResponse;
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
        return (await res.json()) as DocumentsResponse;
    }

    async removeDocuments(names: string[], deleteFiles = false): Promise<{ removed: number; not_found: string[] }> {
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/documents/remove`, {
            method: "POST",
            headers: { ...JSON_HEADERS, ...this.authHeaders() },
            body: JSON.stringify({ names, delete_files: deleteFiles }),
        });
        return (await res.json()) as { removed: number; not_found: string[] };
    }

    /** Download the per-page text dataset as raw bytes (parquet or jsonl). */
    async exportDataset(format: DatasetFormat, source?: string): Promise<ArrayBuffer> {
        const qs = new URLSearchParams({ format });
        if (source) qs.set("source", source);
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/export?${qs}`, {
            headers: this.authHeaders(),
        });
        return res.arrayBuffer();
    }

    /** Upload a per-page text dataset; the server re-embeds it and streams SSE progress. */
    async *importDataset(data: ArrayBuffer | Uint8Array, format: DatasetFormat): AsyncGenerator<SSEEvent, void> {
        const qs = new URLSearchParams({ format });
        const res = await this.fetchWithRetry(
            `${this.baseUrl}/api/import?${qs}`,
            {
                method: "POST",
                headers: { ...OCTET_STREAM_HEADERS, ...this.authHeaders() },
                // Raw bytes — an ArrayBufferView is a valid fetch body at this serialization boundary.
                body: data as BodyInit,
            },
            { stream: true },
        );
        yield* this.parseSSE(res);
    }

    async *crawl(
        url: string,
        depth?: number | null,
        maxPages?: number | null,
        signal?: AbortSignal,
        renderMode?: CrawlRenderMode,
        includeSubdomains?: boolean,
    ): AsyncGenerator<SSEEvent, void> {
        const body: Record<string, unknown> = { url };
        if (depth !== undefined) body.depth = depth;
        // max_pages of 0 means "unlimited" on the server, so pass it through.
        if (maxPages !== undefined) body.max_pages = maxPages;
        if (renderMode !== undefined) body.render_mode = renderMode;
        if (includeSubdomains !== undefined) body.include_subdomains = includeSubdomains;
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
        return (await res.json()) as ConfigResponse;
    }

    async configDefaults(): Promise<Record<string, unknown>> {
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/config/defaults`);
        return (await res.json()) as Record<string, unknown>;
    }

    async updateConfig(updates: Record<string, unknown>): Promise<ConfigUpdateResponse> {
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/config`, {
            method: "PATCH",
            headers: { ...JSON_HEADERS, ...this.authHeaders() },
            body: JSON.stringify(updates),
        });
        return (await res.json()) as ConfigUpdateResponse;
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

    /** Detected GPUs with current free/total VRAM. Cheaper than placement() for
     * polling live memory usage (no plan re-resolve of roles). */
    async gpus(): Promise<Result<GpuInfo[], Error>> {
        return this.fetchResult<GpuInfo[]>(`${this.baseUrl}/api/gpus`, { headers: this.authHeaders() });
    }

    /** Live per-GPU utilization + free memory, streamed as SSE until aborted. */
    async *gpuStatsStream(signal?: AbortSignal): AsyncGenerator<SSEEvent, void> {
        const res = await this.fetchWithRetry(
            `${this.baseUrl}/api/gpus/stream`,
            { headers: this.authHeaders() },
            { stream: true, signal },
        );
        yield* this.parseSSE(res);
    }

    /** The current effective placement (auto plan or active manual spec). */
    async placement(): Promise<Result<PlacementResponse, Error>> {
        return this.fetchResult<PlacementResponse>(`${this.baseUrl}/api/placement`, { headers: this.authHeaders() });
    }

    /** Dry-run a candidate spec (or auto when null); reports fit without persisting. */
    async placementPreview(spec: PlacementSpec | null): Promise<Result<PlacementResponse, Error>> {
        return this.fetchResult<PlacementResponse>(`${this.baseUrl}/api/placement/preview`, {
            method: "POST",
            headers: { ...JSON_HEADERS, ...this.authHeaders() },
            body: JSON.stringify({ spec }),
        });
    }

    /** Apply a manual spec: persists it and rebuilds the fleet. Returns 409 when
     * the server has not enabled HTTP placement (older or shared deployments). */
    async applyPlacement(spec: PlacementSpec): Promise<Result<PlacementResponse, Error>> {
        return this.fetchResult<PlacementResponse>(`${this.baseUrl}/api/placement`, {
            method: "PUT",
            headers: { ...JSON_HEADERS, ...this.authHeaders() },
            body: JSON.stringify({ spec }),
        });
    }

    /** Clear the manual spec, returning to auto placement (rebuilds the fleet). */
    async clearPlacement(): Promise<Result<PlacementResponse, Error>> {
        return this.fetchResult<PlacementResponse>(`${this.baseUrl}/api/placement`, {
            method: "DELETE",
            headers: this.authHeaders(),
        });
    }

    async wikiList(): Promise<WikiPage[]> {
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/wiki`, { headers: this.authHeaders() });
        return (await res.json()) as WikiPage[];
    }

    async wikiPage(slug: string): Promise<WikiPageDetail> {
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/wiki/${encodeURIComponent(slug)}`, {
            headers: this.authHeaders(),
        });
        return (await res.json()) as WikiPageDetail;
    }

    async wikiCitations(slug: string): Promise<WikiCitationChain> {
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/wiki/${encodeURIComponent(slug)}/citations`, {
            headers: this.authHeaders(),
        });
        return (await res.json()) as WikiCitationChain;
    }

    async wikiCitationsForSource(filename: string): Promise<WikiCitationChain[]> {
        const params = new URLSearchParams({ source: filename });
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/wiki/citations?${params}`, {
            headers: this.authHeaders(),
        });
        return (await res.json()) as WikiCitationChain[];
    }

    async wikiLint(): Promise<LintResult> {
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/wiki/lint`, {
            method: "POST",
            headers: this.authHeaders(),
        });
        return (await res.json()) as LintResult;
    }

    async wikiBuild(): Promise<WikiBuildResult> {
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/wiki/build`, {
            method: "POST",
            headers: this.authHeaders(),
        });
        return (await res.json()) as WikiBuildResult;
    }

    async wikiUpdate(): Promise<WikiBuildResult> {
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/wiki/update`, {
            method: "PATCH",
            headers: this.authHeaders(),
        });
        return (await res.json()) as WikiBuildResult;
    }

    async wikiStatus(): Promise<WikiStatusResult> {
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/wiki/status`, {
            headers: this.authHeaders(),
        });
        return (await res.json()) as WikiStatusResult;
    }

    async wikiSynthesize(): Promise<WikiSynthesizeResult> {
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/wiki/synthesize`, {
            method: "POST",
            headers: this.authHeaders(),
        });
        return (await res.json()) as WikiSynthesizeResult;
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
        return (await res.json()) as SourceContent;
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

    async *wikiGenerate(source: string, signal?: AbortSignal): AsyncGenerator<SSEEvent, void> {
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
        return (await res.json()) as DraftInfoResponse[];
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
        return (await res.json()) as DraftAcceptResponse;
    }

    async wikiDraftReject(slug: string): Promise<DraftRejectResponse> {
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/wiki/drafts/${encodeURIComponent(slug)}`, {
            method: "DELETE",
            headers: this.authHeaders(),
        });
        return (await res.json()) as DraftRejectResponse;
    }

    async *wikiPrune(signal?: AbortSignal): AsyncGenerator<SSEEvent, void> {
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

    private async *parseSSE(response: Response): AsyncGenerator<SSEEvent, void> {
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
