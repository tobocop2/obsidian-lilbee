import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { LilbeeClient, ServerStartingError, SessionTokenError } from "../src/api";
import type { Message } from "../src/types";

const BASE_URL = "http://localhost:7433";

/** Build a fake fetch response with a JSON body. */
function jsonResponse(data: unknown): Response {
    return {
        ok: true,
        json: () => Promise.resolve(data),
        text: () => Promise.resolve(JSON.stringify(data)),
        body: null,
    } as unknown as Response;
}

/**
 * Build a fake fetch response whose body is a ReadableStream that emits
 * the provided text chunks sequentially, then signals done.
 */
function sseResponse(chunks: string[]): Response {
    const encoder = new TextEncoder();
    let index = 0;
    const reader = {
        read: vi.fn(async () => {
            if (index < chunks.length) {
                return { done: false, value: encoder.encode(chunks[index++]) };
            }
            return { done: true, value: undefined };
        }),
    };
    return {
        ok: true,
        text: () => Promise.resolve(""),
        body: { getReader: () => reader },
    } as unknown as Response;
}

/** Drain an async generator into an array. */
async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
    const results: T[] = [];
    for await (const item of gen) {
        results.push(item);
    }
    return results;
}

let client: LilbeeClient;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    client = new LilbeeClient(BASE_URL);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("health()", () => {
    it("calls GET /api/health and returns the parsed response", async () => {
        const data = { status: "ok", version: "1.0.0" };
        fetchMock.mockResolvedValue(jsonResponse(data));

        const result = await client.health();

        expect(fetchMock).toHaveBeenCalledWith(`${BASE_URL}/api/health`, expect.objectContaining({}));
        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toEqual(data);
    });
});

describe("status()", () => {
    it("calls GET /api/status and returns the parsed response", async () => {
        const data = {
            config: { model: "llama3" },
            sources: [{ filename: "a.md", chunk_count: 3 }],
            total_chunks: 3,
        };
        fetchMock.mockResolvedValue(jsonResponse(data));

        const result = await client.status();

        expect(fetchMock).toHaveBeenCalledWith(`${BASE_URL}/api/status`, expect.objectContaining({}));
        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toEqual(data);
    });
});

describe("search()", () => {
    it("calls GET /api/search with query param", async () => {
        fetchMock.mockResolvedValue(jsonResponse([]));

        await client.search("hello world");

        const url = new URL(fetchMock.mock.calls[0][0]);
        expect(url.pathname).toBe("/api/search");
        expect(url.searchParams.get("q")).toBe("hello world");
        expect(url.searchParams.has("top_k")).toBe(false);
    });

    it("appends top_k when provided", async () => {
        fetchMock.mockResolvedValue(jsonResponse([]));

        await client.search("test", 10);

        const url = new URL(fetchMock.mock.calls[0][0]);
        expect(url.searchParams.get("top_k")).toBe("10");
    });

    it("returns parsed document results", async () => {
        const data = [{ source: "doc.md", content_type: "text", excerpts: [], best_relevance: 0.9 }];
        fetchMock.mockResolvedValue(jsonResponse(data));

        const result = await client.search("query");
        expect(result).toEqual(data);
    });
});

describe("chat()", () => {
    it("POSTs to /api/chat with question, history, and top_k", async () => {
        const history: Message[] = [{ role: "user", content: "hi" }];
        const data = { answer: "hello", sources: [] };
        fetchMock.mockResolvedValue(jsonResponse(data));

        const result = await client.chat("follow-up", history, 5);

        expect(fetchMock).toHaveBeenCalledWith(
            `${BASE_URL}/api/chat`,
            expect.objectContaining({
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ question: "follow-up", history, top_k: 5 }),
            }),
        );
        expect(result).toEqual(data);
    });

    it("defaults top_k to 0 when omitted", async () => {
        fetchMock.mockResolvedValue(jsonResponse({ answer: "", sources: [] }));

        await client.chat("q", []);

        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.top_k).toBe(0);
    });
});

describe("chatStream()", () => {
    it("POSTs to /api/chat/stream and yields SSE events", async () => {
        fetchMock.mockResolvedValue(sseResponse(['event: token\ndata: "chunk"\n\n']));

        const history: Message[] = [{ role: "user", content: "hey" }];
        const events = await collect(client.chatStream("next", history));

        expect(fetchMock).toHaveBeenCalledWith(
            `${BASE_URL}/api/chat/stream`,
            expect.objectContaining({
                method: "POST",
            }),
        );
        expect(events).toHaveLength(1);
        expect(events[0]).toEqual({ event: "token", data: "chunk" });
    });

    it("includes topK in request body", async () => {
        fetchMock.mockResolvedValue(sseResponse([]));

        await collect(client.chatStream("q", [], 8));

        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.top_k).toBe(8);
    });

    it("defaults top_k to 0 when topK omitted", async () => {
        fetchMock.mockResolvedValue(sseResponse([]));

        await collect(client.chatStream("q", []));

        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.top_k).toBe(0);
    });

    it("includes options in request body when provided", async () => {
        fetchMock.mockResolvedValue(sseResponse([]));

        await collect(client.chatStream("q", [], 5, undefined, { temperature: 0.7, top_k: 40 }));

        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.options).toEqual({ temperature: 0.7, top_k: 40 });
    });

    it("omits options when empty object provided", async () => {
        fetchMock.mockResolvedValue(sseResponse([]));

        await collect(client.chatStream("q", [], 5, undefined, {}));

        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.options).toBeUndefined();
    });

    it("omits options when not provided", async () => {
        fetchMock.mockResolvedValue(sseResponse([]));

        await collect(client.chatStream("q", [], 5));

        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.options).toBeUndefined();
    });

    it("includes chunk_type when chunkType is 'wiki'", async () => {
        fetchMock.mockResolvedValue(sseResponse([]));

        await collect(client.chatStream("q", [], 0, undefined, undefined, "wiki"));

        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.chunk_type).toBe("wiki");
    });

    it("includes chunk_type when chunkType is 'raw'", async () => {
        fetchMock.mockResolvedValue(sseResponse([]));

        await collect(client.chatStream("q", [], 0, undefined, undefined, "raw"));

        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.chunk_type).toBe("raw");
    });

    it("omits chunk_type when chunkType is 'all'", async () => {
        fetchMock.mockResolvedValue(sseResponse([]));

        await collect(client.chatStream("q", [], 0, undefined, undefined, "all"));

        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.chunk_type).toBeUndefined();
    });

    it("omits chunk_type when chunkType is undefined", async () => {
        fetchMock.mockResolvedValue(sseResponse([]));

        await collect(client.chatStream("q", []));

        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.chunk_type).toBeUndefined();
    });
});

describe("addFiles()", () => {
    it("POSTs to /api/add with paths and yields SSE events", async () => {
        fetchMock.mockResolvedValue(
            sseResponse([
                'event: done\ndata: {"added":["a.md"],"updated":[],"removed":[],"failed":[],"unchanged":0}\n\n',
            ]),
        );

        const events = await collect(client.addFiles(["/vault/a.md"]));

        expect(fetchMock).toHaveBeenCalledWith(`${BASE_URL}/api/add`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ paths: ["/vault/a.md"], force: false }),
        });
        expect(events[0].event).toBe("done");
    });

    it("includes enable_ocr when provided", async () => {
        fetchMock.mockResolvedValue(sseResponse([]));

        await collect(client.addFiles(["/vault/doc.pdf"], true, true));

        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.force).toBe(true);
        expect(body.enable_ocr).toBe(true);
    });

    it("includes ocr_timeout when provided", async () => {
        fetchMock.mockResolvedValue(sseResponse([]));

        await collect(client.addFiles(["/vault/doc.pdf"], false, true, undefined, 30));

        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.enable_ocr).toBe(true);
        expect(body.ocr_timeout).toBe(30);
    });

    it("omits enable_ocr when null", async () => {
        fetchMock.mockResolvedValue(sseResponse([]));

        await collect(client.addFiles(["/vault/a.md"], false, null));

        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.enable_ocr).toBeUndefined();
    });

    it("omits enable_ocr when not provided", async () => {
        fetchMock.mockResolvedValue(sseResponse([]));

        await collect(client.addFiles(["/vault/a.md"]));

        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.enable_ocr).toBeUndefined();
    });
});

describe("syncStream()", () => {
    it("POSTs to /api/sync with empty body by default", async () => {
        fetchMock.mockResolvedValue(
            sseResponse(['event: progress\ndata: {"file":"a.md","status":"ingested","current":1,"total":1}\n\n']),
        );

        const events = await collect(client.syncStream());

        expect(fetchMock).toHaveBeenCalledWith(`${BASE_URL}/api/sync`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
        });
        expect(events[0].event).toBe("progress");
    });

    it("sends enable_ocr true when requested", async () => {
        fetchMock.mockResolvedValue(sseResponse([]));

        await collect(client.syncStream(true));

        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.enable_ocr).toBe(true);
    });

    it("omits enable_ocr when null", async () => {
        fetchMock.mockResolvedValue(sseResponse([]));

        await collect(client.syncStream(null));

        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.enable_ocr).toBeUndefined();
    });
});

describe("listModels()", () => {
    it("calls GET /api/models and returns the parsed response", async () => {
        const catalog = { active: "llama3", catalog: [], installed: [] };
        const data = { chat: catalog };
        fetchMock.mockResolvedValue(jsonResponse(data));

        const result = await client.listModels();

        expect(fetchMock).toHaveBeenCalledWith(`${BASE_URL}/api/models`, expect.objectContaining({}));
        expect(result).toEqual(data);
    });
});

describe("pullModel()", () => {
    it("POSTs to /api/models/pull and yields SSE events", async () => {
        fetchMock.mockResolvedValue(
            sseResponse([
                'event: progress\ndata: {"model":"llama3","status":"downloading","completed":10,"total":100}\n\n',
            ]),
        );

        const events = await collect(client.pullModel("llama3"));

        expect(fetchMock).toHaveBeenCalledWith(`${BASE_URL}/api/models/pull`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: "llama3", source: "native" }),
        });
        expect(events[0].event).toBe("progress");
    });

    it("passes custom source parameter", async () => {
        fetchMock.mockResolvedValue(
            sseResponse(['event: progress\ndata: {"model":"gpt-4","status":"downloading"}\n\n']),
        );

        await collect(client.pullModel("gpt-4", "litellm"));

        expect(fetchMock).toHaveBeenCalledWith(`${BASE_URL}/api/models/pull`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: "gpt-4", source: "litellm" }),
        });
    });

    describe("auth token", () => {
        it("includes Bearer header when token is set via constructor", async () => {
            const authedClient = new LilbeeClient(BASE_URL, "constructor-token");
            fetchMock.mockResolvedValue(jsonResponse({ model: "qwen3:8b" }));

            await authedClient.setChatModel("qwen3:8b");

            expect(fetchMock).toHaveBeenCalledWith(
                `${BASE_URL}/api/models/chat`,
                expect.objectContaining({
                    headers: { "Content-Type": "application/json", Authorization: "Bearer constructor-token" },
                }),
            );
        });

        it("includes Bearer header when token is set via setToken", async () => {
            client.setToken("test-token-123");
            fetchMock.mockResolvedValue(jsonResponse({ model: "qwen3:8b" }));

            await client.setChatModel("qwen3:8b");

            expect(fetchMock).toHaveBeenCalledWith(
                `${BASE_URL}/api/models/chat`,
                expect.objectContaining({
                    headers: { "Content-Type": "application/json", Authorization: "Bearer test-token-123" },
                }),
            );
        });

        it("omits Authorization header when token is not set", async () => {
            fetchMock.mockResolvedValue(jsonResponse({ model: "qwen3:8b" }));

            await client.setChatModel("qwen3:8b");

            const headers = fetchMock.mock.calls[0][1].headers;
            expect(headers).not.toHaveProperty("Authorization");
        });

        it("setBaseUrl repoints the client in place", async () => {
            client.setBaseUrl("http://other:7000");
            fetchMock.mockResolvedValue(jsonResponse({ model: "qwen3:8b" }));
            await client.setChatModel("qwen3:8b");
            expect(fetchMock).toHaveBeenCalledWith("http://other:7000/api/models/chat", expect.anything());
        });
    });

    describe("catalog()", () => {
        it("calls GET /api/models/catalog and returns the parsed response", async () => {
            const data = {
                total: 2,
                limit: 20,
                offset: 0,
                models: [
                    {
                        name: "qwen3:8b",
                        display_name: "Qwen3 8B",
                        size_gb: 5,
                        min_ram_gb: 8,
                        description: "medium",
                        quality_tier: "balanced",
                        installed: true,
                        source: "litellm",
                    },
                    {
                        name: "phi4:14b",
                        display_name: "Phi 4 14B",
                        size_gb: 9,
                        min_ram_gb: 16,
                        description: "large",
                        quality_tier: "balanced",
                        installed: false,
                        source: "native",
                    },
                ],
            };
            fetchMock.mockResolvedValue(jsonResponse(data));

            const result = await client.catalog();

            expect(fetchMock).toHaveBeenCalledWith(`${BASE_URL}/api/models/catalog`, expect.objectContaining({}));
            expect(result.isOk()).toBe(true);
            expect(result._unsafeUnwrap()).toEqual(data);
        });

        it("returns err(error) when the underlying HTTP call fails", async () => {
            fetchMock.mockResolvedValue(new Response("boom", { status: 503, statusText: "Service Unavailable" }));
            const result = await client.catalog();
            expect(result.isErr()).toBe(true);
        });

        it("appends query params when provided", async () => {
            fetchMock.mockResolvedValue(jsonResponse({ total: 0, limit: 10, offset: 0, models: [], has_more: false }));

            await client.catalog({
                task: "chat",
                search: "qwen",
                size: "small",
                sort: "featured",
                featured: false,
                limit: 10,
                offset: 20,
            });

            const url = new URL(fetchMock.mock.calls[0][0]);
            expect(url.searchParams.get("task")).toBe("chat");
            expect(url.searchParams.get("search")).toBe("qwen");
            expect(url.searchParams.get("size")).toBe("small");
            expect(url.searchParams.get("sort")).toBe("featured");
            expect(url.searchParams.get("featured")).toBe("false");
            expect(url.searchParams.get("limit")).toBe("10");
            expect(url.searchParams.get("offset")).toBe("20");
        });
    });

    describe("installedModels()", () => {
        it("calls GET /api/models/installed", async () => {
            const data = { models: [{ name: "qwen3:8b", source: "native" }] };
            fetchMock.mockResolvedValue(jsonResponse(data));

            const result = await client.installedModels();

            expect(fetchMock).toHaveBeenCalledWith(`${BASE_URL}/api/models/installed`, expect.objectContaining({}));
            expect(result).toEqual(data);
        });
    });

    describe("showModel()", () => {
        it("POSTs to /api/models/show", async () => {
            const data = { temperature: 0.7, num_ctx: 4096 };
            fetchMock.mockResolvedValue(jsonResponse(data));

            const result = await client.showModel("qwen3:8b");

            expect(fetchMock).toHaveBeenCalledWith(
                `${BASE_URL}/api/models/show`,
                expect.objectContaining({
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ model: "qwen3:8b" }),
                }),
            );
            expect(result).toEqual(data);
        });
    });

    describe("deleteModel()", () => {
        it("DELETEs to /api/models/{model}", async () => {
            fetchMock.mockResolvedValue(jsonResponse({ deleted: true, model: "qwen3:8b", freed_gb: 5.0 }));

            const result = await client.deleteModel("qwen3:8b");

            expect(fetchMock).toHaveBeenCalledWith(
                `${BASE_URL}/api/models/qwen3%3A8b?source=native`,
                expect.objectContaining({ method: "DELETE" }),
            );
            expect(result.isOk()).toBe(true);
            expect(result._unsafeUnwrap().deleted).toBe(true);
        });

        it("passes custom source parameter", async () => {
            fetchMock.mockResolvedValue(jsonResponse({ deleted: true, model: "gpt-4", freed_gb: 0 }));

            await client.deleteModel("gpt-4", "litellm");

            const url = new URL(fetchMock.mock.calls[0][0]);
            expect(url.searchParams.get("source")).toBe("litellm");
        });
    });

    describe("listDocuments()", () => {
        it("calls GET /api/documents", async () => {
            const data = { documents: [], total: 0, limit: 50, offset: 0 };
            fetchMock.mockResolvedValue(jsonResponse(data));

            const result = await client.listDocuments();

            expect(fetchMock).toHaveBeenCalledWith(`${BASE_URL}/api/documents`, expect.objectContaining({}));
            expect(result).toEqual(data);
        });

        it("appends search params", async () => {
            fetchMock.mockResolvedValue(jsonResponse({ documents: [], total: 0, limit: 10, offset: 5 }));

            await client.listDocuments("notes", 10, 5);

            const url = new URL(fetchMock.mock.calls[0][0]);
            expect(url.searchParams.get("search")).toBe("notes");
            expect(url.searchParams.get("limit")).toBe("10");
            expect(url.searchParams.get("offset")).toBe("5");
        });

        describe("contract", () => {
            it("round-trips has_more: true", async () => {
                const data = { documents: [], total: 50, limit: 20, offset: 0, has_more: true };
                fetchMock.mockResolvedValue(jsonResponse(data));
                const result = await client.listDocuments();
                expect(result.has_more).toBe(true);
                expect(result).toEqual(data);
            });

            it("round-trips has_more: false", async () => {
                const data = { documents: [], total: 50, limit: 20, offset: 40, has_more: false };
                fetchMock.mockResolvedValue(jsonResponse(data));
                const result = await client.listDocuments(undefined, 20, 40);
                expect(result.has_more).toBe(false);
                expect(result).toEqual(data);
            });

            it("legacy response without has_more leaves the field undefined", async () => {
                const data = { documents: [], total: 0, limit: 20, offset: 0 };
                fetchMock.mockResolvedValue(jsonResponse(data));
                const result = await client.listDocuments();
                expect(result.has_more).toBeUndefined();
            });
        });
    });

    describe("removeDocuments()", () => {
        it("POSTs to /api/documents/remove", async () => {
            fetchMock.mockResolvedValue(jsonResponse({ removed: 2, not_found: [] }));

            const result = await client.removeDocuments(["a.md", "b.md"], true);

            expect(fetchMock).toHaveBeenCalledWith(
                `${BASE_URL}/api/documents/remove`,
                expect.objectContaining({
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ names: ["a.md", "b.md"], delete_files: true }),
                }),
            );
            expect(result.removed).toBe(2);
        });
    });

    describe("crawl()", () => {
        it("POSTs to /api/crawl and yields SSE events", async () => {
            fetchMock.mockResolvedValue(
                sseResponse(['event: crawl_done\ndata: {"pages_crawled":5,"files_written":3}\n\n']),
            );

            const events = await collect(client.crawl("https://example.com", 1, 10));

            expect(fetchMock).toHaveBeenCalledWith(`${BASE_URL}/api/crawl`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url: "https://example.com", depth: 1, max_pages: 10 }),
            });
            expect(events[0].event).toBe("crawl_done");
        });

        it("sends null explicitly for unbounded depth and max_pages", async () => {
            fetchMock.mockResolvedValue(
                sseResponse(['event: crawl_done\ndata: {"pages_crawled":42,"files_written":40}\n\n']),
            );

            await collect(client.crawl("https://example.com", null, null));

            expect(fetchMock).toHaveBeenCalledWith(`${BASE_URL}/api/crawl`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url: "https://example.com", depth: null, max_pages: null }),
            });
        });

        it("mixes explicit number with null", async () => {
            fetchMock.mockResolvedValue(
                sseResponse(['event: crawl_done\ndata: {"pages_crawled":3,"files_written":3}\n\n']),
            );

            await collect(client.crawl("https://example.com", 0, null));

            expect(fetchMock).toHaveBeenCalledWith(`${BASE_URL}/api/crawl`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url: "https://example.com", depth: 0, max_pages: null }),
            });
        });
    });

    describe("config()", () => {
        it("calls GET /api/config", async () => {
            const data = { chat_model: "qwen3:8b", temperature: 0.7 };
            fetchMock.mockResolvedValue(jsonResponse(data));

            const result = await client.config();

            expect(fetchMock).toHaveBeenCalledWith(`${BASE_URL}/api/config`, expect.objectContaining({}));
            expect(result).toEqual(data);
        });
    });

    describe("configDefaults()", () => {
        it("calls GET /api/config/defaults", async () => {
            const data = { chunk_size: 512, crawl_max_depth: null, crawl_exclude_patterns: ["/page/"] };
            fetchMock.mockResolvedValue(jsonResponse(data));

            const result = await client.configDefaults();

            expect(fetchMock).toHaveBeenCalledWith(`${BASE_URL}/api/config/defaults`, expect.objectContaining({}));
            expect(result).toEqual(data);
        });
    });

    describe("updateConfig()", () => {
        it("PATCHes /api/config", async () => {
            fetchMock.mockResolvedValue(jsonResponse({ updated: ["temperature"], reindex_required: false }));

            const result = await client.updateConfig({ temperature: 0.5 });

            expect(fetchMock).toHaveBeenCalledWith(
                `${BASE_URL}/api/config`,
                expect.objectContaining({
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ temperature: 0.5 }),
                }),
            );
            expect(result.reindex_required).toBe(false);
        });

        it("returns reindex_required true when chunk_size changes", async () => {
            fetchMock.mockResolvedValue(jsonResponse({ updated: ["chunk_size"], reindex_required: true }));

            const result = await client.updateConfig({ chunk_size: 1024 });

            expect(result.reindex_required).toBe(true);
        });
    });

    describe("setRerankerModel()", () => {
        it("PUTs to /api/models/reranker", async () => {
            fetchMock.mockResolvedValue(jsonResponse({ model: "bge-reranker-v2-m3" }));

            const result = await client.setRerankerModel("bge-reranker-v2-m3");

            expect(fetchMock).toHaveBeenCalledWith(
                `${BASE_URL}/api/models/reranker`,
                expect.objectContaining({
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ model: "bge-reranker-v2-m3" }),
                }),
            );
            expect(result.isOk()).toBe(true);
        });

        it("accepts empty string to disable the reranker", async () => {
            fetchMock.mockResolvedValue(jsonResponse({ model: "" }));

            const result = await client.setRerankerModel("");

            expect(fetchMock).toHaveBeenCalledWith(
                `${BASE_URL}/api/models/reranker`,
                expect.objectContaining({
                    method: "PUT",
                    body: JSON.stringify({ model: "" }),
                }),
            );
            expect(result.isOk()).toBe(true);
        });

        it("returns error when server returns 422", async () => {
            fetchMock.mockResolvedValue({
                ok: false,
                status: 422,
                statusText: "Unprocessable",
                text: () => Promise.resolve("Unknown reranker model"),
            } as unknown as Response);

            const result = await client.setRerankerModel("not-a-model");
            expect(result.isErr()).toBe(true);
            expect(result._unsafeUnwrapErr().message).toContain("422");
        });

        // Contract pin: the error message shape produced by fetchResult must exactly match
        // what `extractServerErrorDetail` in utils.ts parses. If a future refactor changes
        // the `Server responded <status>: <body>` prefix, this test fails — without it, every
        // call site would silently revert to the generic fallback and no test would catch it.
        it("emits a 'Server responded <status>: <body>' error for 422 with a JSON body", async () => {
            const body =
                '{"detail": "Model \'x\' is a vision model, not rerank. Set it via PUT /api/models/vision instead."}';
            fetchMock.mockResolvedValue({
                ok: false,
                status: 422,
                statusText: "Unprocessable",
                text: () => Promise.resolve(body),
            } as unknown as Response);

            const result = await client.setRerankerModel("x");
            expect(result.isErr()).toBe(true);
            expect(result._unsafeUnwrapErr().message).toBe(`Server responded 422: ${body}`);
        });

        it("propagates AbortError as err()", async () => {
            fetchMock.mockImplementation(() => {
                const err = new Error("aborted");
                err.name = "AbortError";
                return Promise.reject(err);
            });

            const result = await client.setRerankerModel("bge-reranker-v2-m3");
            expect(result.isErr()).toBe(true);
            expect(result._unsafeUnwrapErr().name).toBe("AbortError");
        });
    });

    describe("setVisionModel()", () => {
        it("PUTs to /api/models/vision", async () => {
            fetchMock.mockResolvedValue(jsonResponse({ model: "Qwen/Qwen2-VL-7B-Instruct" }));

            const result = await client.setVisionModel("Qwen/Qwen2-VL-7B-Instruct");

            expect(fetchMock).toHaveBeenCalledWith(
                `${BASE_URL}/api/models/vision`,
                expect.objectContaining({
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ model: "Qwen/Qwen2-VL-7B-Instruct" }),
                }),
            );
            expect(result.isOk()).toBe(true);
        });

        it("accepts empty string to disable the vision model", async () => {
            fetchMock.mockResolvedValue(jsonResponse({ model: "" }));

            const result = await client.setVisionModel("");

            expect(fetchMock).toHaveBeenCalledWith(
                `${BASE_URL}/api/models/vision`,
                expect.objectContaining({
                    method: "PUT",
                    body: JSON.stringify({ model: "" }),
                }),
            );
            expect(result.isOk()).toBe(true);
        });

        it("returns error when server returns 422", async () => {
            fetchMock.mockResolvedValue({
                ok: false,
                status: 422,
                statusText: "Unprocessable",
                text: () => Promise.resolve("Unknown vision model"),
            } as unknown as Response);

            const result = await client.setVisionModel("not-a-model");
            expect(result.isErr()).toBe(true);
            expect(result._unsafeUnwrapErr().message).toContain("422");
        });
    });

    describe("catalog() with task=vision", () => {
        it("appends task=vision to the query string", async () => {
            fetchMock.mockResolvedValue(jsonResponse({ total: 0, limit: 20, offset: 0, models: [], has_more: false }));

            await client.catalog({ task: "vision" });

            const url = new URL(fetchMock.mock.calls[0][0]);
            expect(url.searchParams.get("task")).toBe("vision");
        });
    });

    describe("installedModels() with task=vision", () => {
        it("forwards task=vision when provided", async () => {
            fetchMock.mockResolvedValue(jsonResponse({ models: [] }));

            await client.installedModels({ task: "vision" });

            const url = new URL(fetchMock.mock.calls[0][0]);
            expect(url.pathname).toBe("/api/models/installed");
            expect(url.searchParams.get("task")).toBe("vision");
        });
    });

    describe("catalog() with task=rerank", () => {
        it("appends task=rerank to the query string", async () => {
            fetchMock.mockResolvedValue(jsonResponse({ total: 0, limit: 20, offset: 0, models: [], has_more: false }));

            await client.catalog({ task: "rerank" });

            const url = new URL(fetchMock.mock.calls[0][0]);
            expect(url.searchParams.get("task")).toBe("rerank");
        });
    });

    describe("installedModels() with task filter", () => {
        it("omits task query param when not provided", async () => {
            fetchMock.mockResolvedValue(jsonResponse({ models: [] }));

            await client.installedModels();

            expect(fetchMock).toHaveBeenCalledWith(`${BASE_URL}/api/models/installed`, expect.objectContaining({}));
        });

        it("forwards task=rerank when provided", async () => {
            fetchMock.mockResolvedValue(jsonResponse({ models: [] }));

            await client.installedModels({ task: "rerank" });

            const url = new URL(fetchMock.mock.calls[0][0]);
            expect(url.pathname).toBe("/api/models/installed");
            expect(url.searchParams.get("task")).toBe("rerank");
        });
    });

    describe("config() with reranker and vision fields", () => {
        it("parses reranker_model, rerank_candidates, and vision_model", async () => {
            const data = {
                reranker_model: "bge-reranker-v2-m3",
                rerank_candidates: 25,
                vision_model: "Qwen/Qwen2-VL-7B-Instruct",
                chat_model: "qwen3:8b",
            };
            fetchMock.mockResolvedValue(jsonResponse(data));

            const result = await client.config();

            expect(result.reranker_model).toBe("bge-reranker-v2-m3");
            expect(result.rerank_candidates).toBe(25);
            expect(result.vision_model).toBe("Qwen/Qwen2-VL-7B-Instruct");
        });
    });

    describe("setEmbeddingModel()", () => {
        it("PUTs to /api/models/embedding", async () => {
            fetchMock.mockResolvedValue(jsonResponse({ model: "nomic-embed-text-v1.5" }));

            const result = await client.setEmbeddingModel("nomic-embed-text-v1.5");

            expect(fetchMock).toHaveBeenCalledWith(
                `${BASE_URL}/api/models/embedding`,
                expect.objectContaining({
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ model: "nomic-embed-text-v1.5" }),
                }),
            );
            expect(result.isOk()).toBe(true);
        });

        it("returns error when response is not ok", async () => {
            fetchMock.mockResolvedValue({
                ok: false,
                status: 400,
                statusText: "Bad Request",
                text: () => Promise.resolve(""),
            } as unknown as Response);

            const result = await client.setEmbeddingModel("nomic-embed-text-v1.5");
            expect(result.isErr()).toBe(true);
            expect(result._unsafeUnwrapErr().message).toBe("Server responded 400: ");
        });
    });
});

describe("setChatModel()", () => {
    it("PUTs to /api/models/chat and returns the result", async () => {
        fetchMock.mockResolvedValue(jsonResponse({ model: "mistral" }));

        const result = await client.setChatModel("mistral");

        expect(fetchMock).toHaveBeenCalledWith(
            `${BASE_URL}/api/models/chat`,
            expect.objectContaining({
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ model: "mistral" }),
            }),
        );
        expect(result.isOk()).toBe(true);
    });

    it("returns error when response is not ok", async () => {
        fetchMock.mockResolvedValue({
            ok: false,
            status: 500,
            statusText: "Internal Server Error",
            text: () => Promise.resolve(""),
        } as unknown as Response);

        const result = await client.setChatModel("mistral");
        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr().message).toBe("Server responded 500: ");
    });
});

describe("parseSSE — edge cases", () => {
    it("yields plain string when JSON.parse fails on data field", async () => {
        fetchMock.mockResolvedValue(sseResponse(["data: not-valid-json\n\n"]));

        const events = await collect(client.syncStream());

        expect(events).toHaveLength(1);
        expect(events[0]).toEqual({ event: "message", data: "not-valid-json" });
    });

    it("defaults to event 'message' when no event line precedes data", async () => {
        fetchMock.mockResolvedValue(sseResponse(['data: {"x":1}\n\n']));

        const events = await collect(client.syncStream());

        expect(events[0].event).toBe("message");
    });

    it("resets currentEvent to 'message' after each data line", async () => {
        // First block: named event. Second block: no event line → should be "message".
        fetchMock.mockResolvedValue(sseResponse(['event: custom\ndata: {"a":1}\n\ndata: {"b":2}\n\n']));

        const events = await collect(client.syncStream());

        expect(events[0].event).toBe("custom");
        expect(events[1].event).toBe("message");
    });

    it("handles a chunk that is split across multiple reads", async () => {
        // Split 'event: token\ndata: {"v":1}\n\n' across two reads
        const encoder = new TextEncoder();
        const part1 = "event: token\n";
        const part2 = 'data: {"v":1}\n\n';
        let call = 0;
        const reader = {
            read: vi.fn(async () => {
                if (call === 0) {
                    call++;
                    return { done: false, value: encoder.encode(part1) };
                }
                if (call === 1) {
                    call++;
                    return { done: false, value: encoder.encode(part2) };
                }
                return { done: true, value: undefined };
            }),
        };
        fetchMock.mockResolvedValue({
            ok: true,
            text: () => Promise.resolve(""),
            body: { getReader: () => reader },
        } as unknown as Response);

        const events = await collect(client.syncStream());

        expect(events).toHaveLength(1);
        expect(events[0]).toEqual({ event: "token", data: { v: 1 } });
    });

    it("ignores lines that are not event: or data:", async () => {
        // Comment lines and blank lines should be ignored
        fetchMock.mockResolvedValue(sseResponse([": this is a comment\nid: 42\ndata: {}\n\n"]));

        const events = await collect(client.syncStream());

        expect(events).toHaveLength(1);
        expect(events[0].data).toEqual({});
    });

    it("handles empty stream (no chunks)", async () => {
        fetchMock.mockResolvedValue(sseResponse([]));

        const events = await collect(client.syncStream());

        expect(events).toHaveLength(0);
    });

    it("handles multiple events in a single chunk", async () => {
        fetchMock.mockResolvedValue(sseResponse(["event: a\ndata: 1\n\nevent: b\ndata: 2\n\n"]));

        const events = await collect(client.syncStream());

        expect(events).toHaveLength(2);
        expect(events[0]).toEqual({ event: "a", data: 1 });
        expect(events[1]).toEqual({ event: "b", data: 2 });
    });

    it("handles trailing partial line left in buffer without final newline", async () => {
        // The buffer remainder logic: last element of split("\n") goes back into buffer.
        // If there's no trailing \n the last partial line stays in buffer and is dropped
        // at stream end (done). Verify no crash and no spurious events.
        fetchMock.mockResolvedValue(sseResponse(["data: {}\n\ndata: incomplete"]));

        const events = await collect(client.syncStream());

        // Only the complete line should produce an event; the partial is silently dropped
        expect(events).toHaveLength(1);
        expect(events[0].data).toEqual({});
    });

    it("trims whitespace from event name", async () => {
        fetchMock.mockResolvedValue(sseResponse(["event:  spaced \ndata: null\n\n"]));

        const events = await collect(client.syncStream());

        expect(events[0].event).toBe("spaced");
    });

    it("handles event:X (no space after colon)", async () => {
        fetchMock.mockResolvedValue(sseResponse(['event:token\ndata: {"text":"hi"}\n\n']));

        const events = await collect(client.syncStream());

        expect(events).toHaveLength(1);
        expect(events[0].event).toBe("token");
    });

    it("handles data:{...} (no space after colon)", async () => {
        fetchMock.mockResolvedValue(sseResponse(['event: token\ndata:{"key":"val"}\n\n']));

        const events = await collect(client.syncStream());

        expect(events).toHaveLength(1);
        expect(events[0].data).toEqual({ key: "val" });
    });

    it("throws when response.body is null", async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            text: () => Promise.resolve(""),
            body: null,
        } as unknown as Response);

        await expect(collect(client.syncStream())).rejects.toThrow("Response body is null");
    });
});

describe("fetchWithRetry()", () => {
    it("retries on network error and succeeds on second attempt", async () => {
        const data = { status: "ok" };
        fetchMock.mockRejectedValueOnce(new Error("connection refused")).mockResolvedValueOnce(jsonResponse(data));

        const result = await client.health();

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toEqual(data);
    });

    it("throws after all retries exhausted on network error", async () => {
        fetchMock.mockRejectedValue(new Error("connection refused"));

        const result = await client.health();
        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr().message).toBe("connection refused");
        expect(fetchMock).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
    });

    it("wraps non-Error thrown value in Error", async () => {
        fetchMock.mockRejectedValue("string error");

        const result = await client.health();
        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr().message).toBe("string error");
    });

    it("does NOT retry on HTTP error (4xx/5xx)", async () => {
        fetchMock.mockResolvedValue({
            ok: false,
            status: 422,
            text: () => Promise.resolve("Validation error"),
        } as unknown as Response);

        const result = await client.health();
        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr().message).toBe("Server responded 422: Validation error");
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("skips timeout for SSE stream requests", async () => {
        fetchMock.mockResolvedValue(sseResponse(["event: done\ndata: {}\n\n"]));

        const events = await collect(client.syncStream());

        const init = fetchMock.mock.calls[0][1] as RequestInit;
        expect(init.signal).toBeUndefined();
        expect(events).toHaveLength(1);
    });

    it("includes AbortSignal for non-stream requests", async () => {
        fetchMock.mockResolvedValue(jsonResponse({ status: "ok" }));

        await client.health();

        const init = fetchMock.mock.calls[0][1] as RequestInit;
        expect(init.signal).toBeInstanceOf(AbortSignal);
    });
});

describe("fetchWithRetry() — token provider + 401/403 retry", () => {
    it("refreshes token and retries once on 401", async () => {
        const c = new LilbeeClient(BASE_URL);
        c.setToken("old-token");
        let currentToken = "old-token";
        c.setTokenProvider(() => currentToken);
        fetchMock
            .mockResolvedValueOnce({
                ok: false,
                status: 401,
                text: () => Promise.resolve("stale token"),
            } as unknown as Response)
            .mockImplementationOnce(() => {
                currentToken = "new-token";
                return Promise.resolve(jsonResponse({ status: "ok" }));
            });
        currentToken = "new-token";
        const result = await c.health();
        expect(result.isOk()).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("refreshes token and retries once on 403", async () => {
        const c = new LilbeeClient(BASE_URL);
        c.setToken("old");
        c.setTokenProvider(() => "new");
        fetchMock
            .mockResolvedValueOnce({
                ok: false,
                status: 403,
                text: () => Promise.resolve("forbidden"),
            } as unknown as Response)
            .mockResolvedValueOnce(jsonResponse({ status: "ok" }));
        const result = await c.health();
        expect(result.isOk()).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("does not retry twice — second 401 surfaces SessionTokenError", async () => {
        const c = new LilbeeClient(BASE_URL);
        c.setToken("old");
        c.setTokenProvider(() => "new");
        fetchMock.mockResolvedValue({
            ok: false,
            status: 401,
            text: () => Promise.resolve("still bad"),
        } as unknown as Response);
        const result = await c.health();
        expect(result.isErr()).toBe(true);
        const e = result._unsafeUnwrapErr();
        expect(e.name).toBe("SessionTokenError");
        expect((e as SessionTokenError).status).toBe(401);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("skips auth retry when no provider is registered — surfaces SessionTokenError", async () => {
        const c = new LilbeeClient(BASE_URL);
        c.setToken("old");
        fetchMock.mockResolvedValue({
            ok: false,
            status: 401,
            text: () => Promise.resolve("no provider"),
        } as unknown as Response);
        const result = await c.health();
        expect(result.isErr()).toBe(true);
        const e = result._unsafeUnwrapErr();
        expect(e).toBeInstanceOf(SessionTokenError);
        expect((e as SessionTokenError).status).toBe(401);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("skips auth retry when provider returns null — surfaces SessionTokenError", async () => {
        const c = new LilbeeClient(BASE_URL);
        c.setToken("old");
        c.setTokenProvider(() => null);
        fetchMock.mockResolvedValue({
            ok: false,
            status: 401,
            text: () => Promise.resolve("null token"),
        } as unknown as Response);
        const result = await c.health();
        expect(result.isErr()).toBe(true);
        const e = result._unsafeUnwrapErr();
        expect(e).toBeInstanceOf(SessionTokenError);
        expect((e as SessionTokenError).status).toBe(401);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("skips auth retry when provider returns the same token — surfaces SessionTokenError", async () => {
        const c = new LilbeeClient(BASE_URL);
        c.setToken("same");
        c.setTokenProvider(() => "same");
        fetchMock.mockResolvedValue({
            ok: false,
            status: 401,
            text: () => Promise.resolve("same token"),
        } as unknown as Response);
        const result = await c.health();
        expect(result.isErr()).toBe(true);
        const e = result._unsafeUnwrapErr();
        expect(e).toBeInstanceOf(SessionTokenError);
        expect((e as SessionTokenError).status).toBe(401);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("does not auth-retry on non-auth error statuses (500)", async () => {
        const c = new LilbeeClient(BASE_URL);
        c.setToken("t");
        c.setTokenProvider(() => "new");
        fetchMock.mockResolvedValue({
            ok: false,
            status: 500,
            text: () => Promise.resolve("boom"),
        } as unknown as Response);
        const result = await c.health();
        expect(result.isErr()).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("retry applies the refreshed token to the next request's Authorization header", async () => {
        const c = new LilbeeClient(BASE_URL);
        c.setToken("old");
        c.setTokenProvider(() => "fresh");
        fetchMock
            .mockResolvedValueOnce({
                ok: false,
                status: 401,
                text: () => Promise.resolve("stale"),
            } as unknown as Response)
            .mockResolvedValueOnce(jsonResponse({ ok: true }));
        // Use chat() since it sends Authorization header
        await c.chat("hi", []);
        const headers = (fetchMock.mock.calls[1][1] as RequestInit).headers as Record<string, string>;
        expect(headers.Authorization).toBe("Bearer fresh");
    });

    it("retry without prior Authorization header leaves headers untouched", async () => {
        const c = new LilbeeClient(BASE_URL);
        c.setToken("old");
        c.setTokenProvider(() => "new");
        // search() does not set Authorization, so the retry path exercises the
        // branch where existing.Authorization is undefined.
        fetchMock
            .mockResolvedValueOnce({
                ok: false,
                status: 401,
                text: () => Promise.resolve("stale"),
            } as unknown as Response)
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve([]),
                text: () => Promise.resolve("[]"),
                body: null,
            } as unknown as Response);
        await c.search("q");
        expect(fetchMock).toHaveBeenCalledTimes(2);
        const retryInit = fetchMock.mock.calls[1][1] as RequestInit;
        const headers = (retryInit.headers ?? {}) as Record<string, string>;
        expect(headers.Authorization).toBeUndefined();
    });

    it("setTokenProvider(null) clears the provider", async () => {
        const c = new LilbeeClient(BASE_URL);
        c.setToken("t");
        c.setTokenProvider(() => "new");
        c.setTokenProvider(null);
        fetchMock.mockResolvedValue({
            ok: false,
            status: 401,
            text: () => Promise.resolve("x"),
        } as unknown as Response);
        const result = await c.health();
        expect(result.isErr()).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});

describe("assertOk", () => {
    it("throws with response body text on non-ok response", async () => {
        fetchMock.mockResolvedValue({
            ok: false,
            status: 500,
            text: () => Promise.resolve("Internal Server Error"),
        } as unknown as Response);

        const result = await client.status();
        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr().message).toBe("Server responded 500: Internal Server Error");
    });

    it("throws with empty string when res.text() itself throws", async () => {
        fetchMock.mockResolvedValue({
            ok: false,
            status: 503,
            text: () => Promise.reject(new Error("network failure")),
        } as unknown as Response);

        const result = await client.status();
        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr().message).toBe("Server responded 503: ");
    });
});
describe("search() — chunkType parameter", () => {
    it("adds chunk_type param when chunkType is 'wiki'", async () => {
        fetchMock.mockResolvedValue(jsonResponse([]));

        await client.search("hello", 5, "wiki");

        const url = new URL(fetchMock.mock.calls[0][0]);
        expect(url.searchParams.get("chunk_type")).toBe("wiki");
    });

    it("adds chunk_type param when chunkType is 'raw'", async () => {
        fetchMock.mockResolvedValue(jsonResponse([]));

        await client.search("hello", 5, "raw");

        const url = new URL(fetchMock.mock.calls[0][0]);
        expect(url.searchParams.get("chunk_type")).toBe("raw");
    });

    it("does NOT add chunk_type param when chunkType is 'all'", async () => {
        fetchMock.mockResolvedValue(jsonResponse([]));

        await client.search("hello", 5, "all");

        const url = new URL(fetchMock.mock.calls[0][0]);
        expect(url.searchParams.has("chunk_type")).toBe(false);
    });

    it("does NOT add chunk_type param when chunkType is undefined", async () => {
        fetchMock.mockResolvedValue(jsonResponse([]));

        await client.search("hello", 5);

        const url = new URL(fetchMock.mock.calls[0][0]);
        expect(url.searchParams.has("chunk_type")).toBe(false);
    });
});

describe("wikiList()", () => {
    it("calls GET /api/wiki and returns parsed response", async () => {
        const data = [{ slug: "test-page", title: "Test Page" }];
        fetchMock.mockResolvedValue(jsonResponse(data));

        const result = await client.wikiList();

        expect(fetchMock).toHaveBeenCalledWith(`${BASE_URL}/api/wiki`, expect.objectContaining({}));
        expect(result).toEqual(data);
    });
});

describe("wikiPage()", () => {
    it("calls GET /api/wiki/{slug} and returns parsed response", async () => {
        const data = { slug: "test-page", title: "Test Page", content: "Hello" };
        fetchMock.mockResolvedValue(jsonResponse(data));

        const result = await client.wikiPage("test-page");

        expect(fetchMock).toHaveBeenCalledWith(`${BASE_URL}/api/wiki/test-page`, expect.objectContaining({}));
        expect(result).toEqual(data);
    });

    it("encodes slug with special characters", async () => {
        fetchMock.mockResolvedValue(jsonResponse({}));

        await client.wikiPage("hello world/foo");

        expect(fetchMock).toHaveBeenCalledWith(`${BASE_URL}/api/wiki/hello%20world%2Ffoo`, expect.objectContaining({}));
    });
});

describe("wikiCitations()", () => {
    it("calls GET /api/wiki/{slug}/citations", async () => {
        const data = { citations: [] };
        fetchMock.mockResolvedValue(jsonResponse(data));

        const result = await client.wikiCitations("my-page");

        expect(fetchMock).toHaveBeenCalledWith(`${BASE_URL}/api/wiki/my-page/citations`, expect.objectContaining({}));
        expect(result).toEqual(data);
    });

    it("encodes slug with special characters", async () => {
        fetchMock.mockResolvedValue(jsonResponse({}));

        await client.wikiCitations("page with spaces");

        expect(fetchMock).toHaveBeenCalledWith(
            `${BASE_URL}/api/wiki/page%20with%20spaces/citations`,
            expect.objectContaining({}),
        );
    });
});

describe("wikiCitationsForSource()", () => {
    it("calls GET /api/wiki/citations?source=filename", async () => {
        const data = [{ citations: [] }];
        fetchMock.mockResolvedValue(jsonResponse(data));

        const result = await client.wikiCitationsForSource("notes/foo.md");

        const url = new URL(fetchMock.mock.calls[0][0]);
        expect(url.pathname).toBe("/api/wiki/citations");
        expect(url.searchParams.get("source")).toBe("notes/foo.md");
        expect(result).toEqual(data);
    });
});

describe("wikiLint()", () => {
    it("POSTs to /api/wiki/lint and returns JSON result", async () => {
        const data = { task_id: "t1", status: "done", issues: [], checked_at: null };
        fetchMock.mockResolvedValue(jsonResponse(data));

        const result = await client.wikiLint();

        expect(fetchMock).toHaveBeenCalledWith(
            `${BASE_URL}/api/wiki/lint`,
            expect.objectContaining({ method: "POST" }),
        );
        expect(result).toEqual(data);
    });
});

describe("wikiBuild()", () => {
    it("POSTs to /api/wiki/build and returns the build summary", async () => {
        const data = { paths: ["wiki/concepts/brake-systems.md"], entities: 7, count: 1 };
        fetchMock.mockResolvedValue(jsonResponse(data));

        const result = await client.wikiBuild();

        expect(fetchMock).toHaveBeenCalledWith(
            `${BASE_URL}/api/wiki/build`,
            expect.objectContaining({ method: "POST" }),
        );
        expect(result).toEqual(data);
    });

    it("propagates server errors via fetchWithRetry", async () => {
        fetchMock.mockResolvedValue(new Response("boom", { status: 500 }));
        await expect(client.wikiBuild()).rejects.toThrow();
    });
});

describe("wikiUpdate()", () => {
    it("PATCHes /api/wiki/update and returns the build summary", async () => {
        const data = { paths: [], entities: 0, count: 0 };
        fetchMock.mockResolvedValue(jsonResponse(data));

        const result = await client.wikiUpdate();

        expect(fetchMock).toHaveBeenCalledWith(
            `${BASE_URL}/api/wiki/update`,
            expect.objectContaining({ method: "PATCH" }),
        );
        expect(result).toEqual(data);
    });
});

describe("wikiStatus()", () => {
    it("GETs /api/wiki/status and returns the status snapshot", async () => {
        const data = {
            wiki_enabled: true,
            summaries: 4,
            drafts: 2,
            pages: 6,
            lint_errors: 0,
            lint_warnings: 1,
        };
        fetchMock.mockResolvedValue(jsonResponse(data));

        const result = await client.wikiStatus();

        expect(fetchMock).toHaveBeenCalledWith(
            `${BASE_URL}/api/wiki/status`,
            expect.not.objectContaining({ method: "POST" }),
        );
        expect(result).toEqual(data);
    });

    it("returns the disabled-wiki shape when wiki is off on the server", async () => {
        const data = {
            wiki_enabled: false,
            summaries: 0,
            drafts: 0,
            pages: 0,
            lint_errors: 0,
            lint_warnings: 0,
        };
        fetchMock.mockResolvedValue(jsonResponse(data));
        const result = await client.wikiStatus();
        expect(result.wiki_enabled).toBe(false);
        expect(result.pages).toBe(0);
    });
});

describe("wikiSynthesize()", () => {
    it("POSTs to /api/wiki/synthesize and returns the synthesis summary", async () => {
        const data = { paths: ["wiki/synthesis/typing.md"], count: 1 };
        fetchMock.mockResolvedValue(jsonResponse(data));

        const result = await client.wikiSynthesize();

        expect(fetchMock).toHaveBeenCalledWith(
            `${BASE_URL}/api/wiki/synthesize`,
            expect.objectContaining({ method: "POST" }),
        );
        expect(result).toEqual(data);
    });

    it("returns the empty-cluster shape when no clusters meet the threshold", async () => {
        fetchMock.mockResolvedValue(jsonResponse({ paths: [], count: 0 }));
        const result = await client.wikiSynthesize();
        expect(result.count).toBe(0);
        expect(result.paths).toEqual([]);
    });
});

describe("wikiGenerate()", () => {
    it("POSTs to /api/wiki/generate with source and yields SSE events", async () => {
        fetchMock.mockResolvedValue(sseResponse(['event: wiki_generate_done\ndata: {"slug":"test"}\n\n']));

        const events = await collect(client.wikiGenerate("notes/foo.md"));

        expect(fetchMock).toHaveBeenCalledWith(
            `${BASE_URL}/api/wiki/generate`,
            expect.objectContaining({
                method: "POST",
                body: JSON.stringify({ source: "notes/foo.md" }),
            }),
        );
        expect(events).toHaveLength(1);
        expect(events[0].event).toBe("wiki_generate_done");
    });
});

describe("wikiDrafts()", () => {
    it("calls GET /api/wiki/drafts and returns parsed DraftInfoResponse list", async () => {
        const data = [
            {
                slug: "summaries/caprice-1951",
                path: "/data/wiki/drafts/summaries/caprice-1951.md",
                drift_ratio: 0.34,
                faithfulness_score: 0.42,
                bad_title: false,
                published_path: "/data/wiki/summaries/caprice-1951.md",
                published_exists: true,
                pending_kind: "drift",
                mtime: 1745452800,
            },
            {
                slug: "concepts/brake-systems",
                path: "/data/wiki/drafts/concepts/brake-systems.md",
                drift_ratio: null,
                faithfulness_score: null,
                bad_title: false,
                published_path: null,
                published_exists: false,
                pending_kind: "parse",
                mtime: 1745452900,
            },
        ];
        fetchMock.mockResolvedValue(jsonResponse(data));

        client.setToken("tok");
        const result = await client.wikiDrafts();

        expect(fetchMock).toHaveBeenCalledWith(
            `${BASE_URL}/api/wiki/drafts`,
            expect.objectContaining({
                headers: expect.objectContaining({ Authorization: "Bearer tok" }),
            }),
        );
        expect(result).toEqual(data);
        expect(result[0].pending_kind).toBe("drift");
        expect(result[1].drift_ratio).toBeNull();
    });
});

describe("wikiDraftDiff()", () => {
    it("GETs /api/wiki/drafts/<encoded>/diff and returns the raw body text", async () => {
        const diff = "--- a\n+++ b\n@@ -1 +1 @@\n-old\n+new\n";
        fetchMock.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(null),
            text: () => Promise.resolve(diff),
            body: null,
        } as unknown as Response);

        client.setToken("tok");
        const result = await client.wikiDraftDiff("summaries/caprice 1951");

        expect(fetchMock).toHaveBeenCalledWith(
            `${BASE_URL}/api/wiki/drafts/summaries%2Fcaprice%201951/diff`,
            expect.objectContaining({
                headers: expect.objectContaining({ Authorization: "Bearer tok" }),
            }),
        );
        expect(result).toBe(diff);
    });
});

describe("wikiDraftAccept()", () => {
    it("POSTs to /api/wiki/drafts/<encoded>/accept and returns parsed body", async () => {
        const data = {
            slug: "summaries/caprice-1951",
            moved_to: "/data/wiki/summaries/caprice-1951.md",
            reindexed_chunks: 12,
        };
        fetchMock.mockResolvedValue(jsonResponse(data));

        client.setToken("tok");
        const result = await client.wikiDraftAccept("summaries/caprice 1951");

        expect(fetchMock).toHaveBeenCalledWith(
            `${BASE_URL}/api/wiki/drafts/summaries%2Fcaprice%201951/accept`,
            expect.objectContaining({
                method: "POST",
                headers: expect.objectContaining({ Authorization: "Bearer tok" }),
            }),
        );
        expect(result).toEqual(data);
    });
});

describe("wikiDraftReject()", () => {
    it("DELETEs /api/wiki/drafts/<encoded> and returns parsed body", async () => {
        const data = { slug: "concepts/brake-systems" };
        fetchMock.mockResolvedValue(jsonResponse(data));

        client.setToken("tok");
        const result = await client.wikiDraftReject("concepts/brake systems");

        expect(fetchMock).toHaveBeenCalledWith(
            `${BASE_URL}/api/wiki/drafts/concepts%2Fbrake%20systems`,
            expect.objectContaining({
                method: "DELETE",
                headers: expect.objectContaining({ Authorization: "Bearer tok" }),
            }),
        );
        const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
        expect(headers["Content-Type"]).toBeUndefined();
        expect(result).toEqual(data);
    });
});

describe("wikiPrune()", () => {
    it("POSTs to /api/wiki/prune and yields SSE events", async () => {
        fetchMock.mockResolvedValue(sseResponse(['event: wiki_prune_done\ndata: {"archived":3}\n\n']));

        const events = await collect(client.wikiPrune());

        expect(fetchMock).toHaveBeenCalledWith(
            `${BASE_URL}/api/wiki/prune`,
            expect.objectContaining({ method: "POST" }),
        );
        expect(events).toHaveLength(1);
        expect(events[0].event).toBe("wiki_prune_done");
    });
});

describe("getSource()", () => {
    it("calls GET /api/source?source=<encoded> and returns parsed body", async () => {
        const data = { markdown: "# hello", content_type: "text/markdown" };
        fetchMock.mockResolvedValue(jsonResponse(data));

        const result = await client.getSource("crawled/example.com/index.md");

        const url = new URL(fetchMock.mock.calls[0][0]);
        expect(url.pathname).toBe("/api/source");
        expect(url.searchParams.get("source")).toBe("crawled/example.com/index.md");
        expect(url.searchParams.has("raw")).toBe(false);
        expect(result).toEqual(data);
    });

    it("encodes sources with special characters", async () => {
        fetchMock.mockResolvedValue(jsonResponse({ markdown: "", content_type: "text/plain" }));

        await client.getSource("folder with spaces/file#frag.md");

        // URLSearchParams round-trip: parsing the built URL must return the
        // original source string verbatim.
        const url = new URL(fetchMock.mock.calls[0][0]);
        expect(url.searchParams.get("source")).toBe("folder with spaces/file#frag.md");
    });

    it("sends Authorization header when a token is set", async () => {
        client.setToken("abc");
        fetchMock.mockResolvedValue(jsonResponse({ markdown: "", content_type: "text/markdown" }));

        await client.getSource("foo.md");

        const init = fetchMock.mock.calls[0][1] as RequestInit;
        expect((init.headers as Record<string, string>).Authorization).toBe("Bearer abc");
    });

    it("throws on 404 via assertOk", async () => {
        fetchMock.mockResolvedValue({
            ok: false,
            status: 404,
            text: () => Promise.resolve("not found"),
        } as unknown as Response);

        await expect(client.getSource("missing.md")).rejects.toThrow("Server responded 404: not found");
    });
});

describe("getSourceRaw()", () => {
    it("calls GET /api/source?source=<encoded>&raw=1 and returns the raw Response", async () => {
        const fakeRes = {
            ok: true,
            status: 200,
            text: () => Promise.resolve(""),
            arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)),
            headers: new Headers({ "content-type": "application/pdf" }),
        } as unknown as Response;
        fetchMock.mockResolvedValue(fakeRes);

        const result = await client.getSourceRaw("book.pdf");

        const url = new URL(fetchMock.mock.calls[0][0]);
        expect(url.pathname).toBe("/api/source");
        expect(url.searchParams.get("source")).toBe("book.pdf");
        expect(url.searchParams.get("raw")).toBe("1");
        expect(result).toBe(fakeRes);
    });

    it("throws on 404 via assertOk", async () => {
        fetchMock.mockResolvedValue({
            ok: false,
            status: 404,
            text: () => Promise.resolve("gone"),
        } as unknown as Response);

        await expect(client.getSourceRaw("missing.pdf")).rejects.toThrow("Server responded 404: gone");
    });
});

describe("fetchWithRetry() — signal and AbortError", () => {
    it("sets caller-provided signal on fetch init", async () => {
        fetchMock.mockResolvedValue(jsonResponse({ status: "ok" }));
        const controller = new AbortController();

        await client.fetchWithRetry(`${BASE_URL}/api/health`, {}, { signal: controller.signal });

        const init = fetchMock.mock.calls[0][1] as RequestInit;
        expect(init.signal).toBe(controller.signal);
    });

    it("AbortError is thrown immediately without retrying", async () => {
        const abortError = new Error("The operation was aborted");
        abortError.name = "AbortError";
        fetchMock.mockRejectedValue(abortError);

        const result = await client.health();
        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr().name).toBe("AbortError");
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});

describe("ServerStartingError", () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("carries the expected name and message", () => {
        const e = new ServerStartingError();
        expect(e.name).toBe("ServerStartingError");
        expect(e.message).toContain("starting");
    });

    it("is thrown by fetchWithRetry when baseUrl is empty (no fetch attempted)", async () => {
        const c = new LilbeeClient("");
        await expect(c.fetchWithRetry("/api/health")).rejects.toBeInstanceOf(ServerStartingError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("surfaces via Result-returning methods as a typed error", async () => {
        const c = new LilbeeClient("");
        const result = await c.health();
        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBeInstanceOf(ServerStartingError);
    });

    it("clears once setBaseUrl is called with a real URL", async () => {
        const c = new LilbeeClient("");
        fetchMock.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ status: "ok", version: "1" }),
        } as unknown as Response);
        c.setBaseUrl(BASE_URL);
        const result = await c.health();
        expect(result.isOk()).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});

describe("setOutcomeCallback", () => {
    let fetchMock: ReturnType<typeof vi.fn>;
    let outcomes: string[];
    let client: LilbeeClient;

    beforeEach(() => {
        fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);
        outcomes = [];
        client = new LilbeeClient(BASE_URL);
        client.setOutcomeCallback((o) => outcomes.push(o));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("fires 'starting' when baseUrl is empty", async () => {
        const c = new LilbeeClient("");
        c.setOutcomeCallback((o) => outcomes.push(o));
        await c.health();
        expect(outcomes).toContain("starting");
    });

    it("fires 'ok' on a successful request", async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ status: "ok", version: "1" }),
        } as unknown as Response);
        await client.health();
        expect(outcomes).toContain("ok");
    });

    it("fires 'auth_error' when 401 surfaces SessionTokenError", async () => {
        fetchMock.mockResolvedValue({
            ok: false,
            status: 401,
            text: () => Promise.resolve(""),
        } as unknown as Response);
        const result = await client.health();
        expect(result.isErr()).toBe(true);
        expect(outcomes).toContain("auth_error");
    });

    it("fires 'server_error' on a non-auth HTTP error", async () => {
        fetchMock.mockResolvedValue({
            ok: false,
            status: 500,
            text: () => Promise.resolve("boom"),
        } as unknown as Response);
        const result = await client.health();
        expect(result.isErr()).toBe(true);
        expect(outcomes).toContain("server_error");
    });

    it("fires 'unreachable' when fetch keeps rejecting", async () => {
        fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
        const result = await client.health();
        expect(result.isErr()).toBe(true);
        expect(outcomes).toContain("unreachable");
    });

    it("setOutcomeCallback(null) detaches the subscriber", async () => {
        client.setOutcomeCallback(null);
        fetchMock.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ status: "ok", version: "1" }),
        } as unknown as Response);
        await client.health();
        expect(outcomes).toEqual([]);
    });
});
