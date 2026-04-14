import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { LilbeeClient } from "../src/api";
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

describe("ask()", () => {
    it("POSTs to /api/ask with question and default top_k 0", async () => {
        const data = { answer: "42", sources: [] };
        fetchMock.mockResolvedValue(jsonResponse(data));

        const result = await client.ask("What is the answer?");

        expect(fetchMock).toHaveBeenCalledWith(
            `${BASE_URL}/api/ask`,
            expect.objectContaining({
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ question: "What is the answer?", top_k: 0 }),
            }),
        );
        expect(result).toEqual(data);
    });

    it("uses provided topK", async () => {
        fetchMock.mockResolvedValue(jsonResponse({ answer: "x", sources: [] }));

        await client.ask("q", 7);

        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.top_k).toBe(7);
    });
});

describe("askStream()", () => {
    it("POSTs to /api/ask/stream and yields SSE events", async () => {
        fetchMock.mockResolvedValue(
            sseResponse(['event: token\ndata: {"text":"hello"}\n\n', 'event: done\ndata: {"answer":"hi"}\n\n']),
        );

        const events = await collect(client.askStream("What?"));

        expect(fetchMock).toHaveBeenCalledWith(
            `${BASE_URL}/api/ask/stream`,
            expect.objectContaining({
                method: "POST",
            }),
        );
        expect(events).toHaveLength(2);
        expect(events[0]).toEqual({ event: "token", data: { text: "hello" } });
        expect(events[1]).toEqual({ event: "done", data: { answer: "hi" } });
    });

    it("uses provided topK in request body", async () => {
        fetchMock.mockResolvedValue(sseResponse([]));

        await collect(client.askStream("q", 3));

        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.top_k).toBe(3);
    });

    it("defaults top_k to 0 when topK omitted", async () => {
        fetchMock.mockResolvedValue(sseResponse([]));

        await collect(client.askStream("q"));

        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.top_k).toBe(0);
    });

    it("includes options in request body when provided", async () => {
        fetchMock.mockResolvedValue(sseResponse([]));

        await collect(client.askStream("q", 5, undefined, { temperature: 0.5 }));

        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.options).toEqual({ temperature: 0.5 });
    });

    it("omits options when empty object provided", async () => {
        fetchMock.mockResolvedValue(sseResponse([]));

        await collect(client.askStream("q", 5, undefined, {}));

        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.options).toBeUndefined();
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
            fetchMock.mockResolvedValue(jsonResponse({ total: 0, limit: 10, offset: 0, models: [] }));

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
    it("calls GET /api/wiki/drafts and returns parsed response", async () => {
        const data = [{ slug: "draft-1", score: 0.8 }];
        fetchMock.mockResolvedValue(jsonResponse(data));

        const result = await client.wikiDrafts();

        expect(fetchMock).toHaveBeenCalledWith(`${BASE_URL}/api/wiki/drafts`, expect.objectContaining({}));
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
