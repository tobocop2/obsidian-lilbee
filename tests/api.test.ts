import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { LilbeeClient, OllamaClient, parseModelParameters } from "../src/api";
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

        expect(fetchMock).toHaveBeenCalledWith(
            `${BASE_URL}/api/health`,
            expect.objectContaining({}),
        );
        expect(result).toEqual(data);
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

        expect(fetchMock).toHaveBeenCalledWith(
            `${BASE_URL}/api/status`,
            expect.objectContaining({}),
        );
        expect(result).toEqual(data);
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
            sseResponse([
                'event: token\ndata: {"text":"hello"}\n\n',
                'event: done\ndata: {"answer":"hi"}\n\n',
            ]),
        );

        const events = await collect(client.askStream("What?"));

        expect(fetchMock).toHaveBeenCalledWith(`${BASE_URL}/api/ask/stream`, expect.objectContaining({
            method: "POST",
        }));
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
        fetchMock.mockResolvedValue(
            sseResponse(['event: token\ndata: "chunk"\n\n']),
        );

        const history: Message[] = [{ role: "user", content: "hey" }];
        const events = await collect(client.chatStream("next", history));

        expect(fetchMock).toHaveBeenCalledWith(`${BASE_URL}/api/chat/stream`, expect.objectContaining({
            method: "POST",
        }));
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
            sseResponse(['event: done\ndata: {"added":["a.md"],"updated":[],"removed":[],"failed":[],"unchanged":0}\n\n']),
        );

        const events = await collect(client.addFiles(["/vault/a.md"]));

        expect(fetchMock).toHaveBeenCalledWith(`${BASE_URL}/api/add`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ paths: ["/vault/a.md"], force: false }),
        });
        expect(events[0].event).toBe("done");
    });

    it("includes vision_model when provided", async () => {
        fetchMock.mockResolvedValue(sseResponse([]));

        await collect(client.addFiles(["/vault/doc.pdf"], true, "llava"));

        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.force).toBe(true);
        expect(body.vision_model).toBe("llava");
    });

    it("omits vision_model when not provided", async () => {
        fetchMock.mockResolvedValue(sseResponse([]));

        await collect(client.addFiles(["/vault/a.md"]));

        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.vision_model).toBeUndefined();
    });
});

describe("syncStream()", () => {
    it("POSTs to /api/sync with force_vision false by default", async () => {
        fetchMock.mockResolvedValue(
            sseResponse(['event: progress\ndata: {"file":"a.md","status":"ingested","current":1,"total":1}\n\n']),
        );

        const events = await collect(client.syncStream());

        expect(fetchMock).toHaveBeenCalledWith(`${BASE_URL}/api/sync`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ force_vision: false }),
        });
        expect(events[0].event).toBe("progress");
    });

    it("sends force_vision true when requested", async () => {
        fetchMock.mockResolvedValue(sseResponse([]));

        await collect(client.syncStream(true));

        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.force_vision).toBe(true);
    });
});

describe("listModels()", () => {
    it("calls GET /api/models and returns the parsed response", async () => {
        const catalog = { active: "llama3", catalog: [], installed: [] };
        const data = { chat: catalog, vision: catalog };
        fetchMock.mockResolvedValue(jsonResponse(data));

        const result = await client.listModels();

        expect(fetchMock).toHaveBeenCalledWith(
            `${BASE_URL}/api/models`,
            expect.objectContaining({}),
        );
        expect(result).toEqual(data);
    });
});

describe("pullModel()", () => {
    it("POSTs to /api/models/pull and yields SSE events", async () => {
        fetchMock.mockResolvedValue(
            sseResponse(['event: progress\ndata: {"model":"llama3","status":"downloading","completed":10,"total":100}\n\n']),
        );

        const events = await collect(client.pullModel("llama3"));

        expect(fetchMock).toHaveBeenCalledWith(`${BASE_URL}/api/models/pull`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: "llama3" }),
        });
        expect(events[0].event).toBe("progress");
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
        expect(result).toEqual({ model: "mistral" });
    });
});

describe("setVisionModel()", () => {
    it("PUTs to /api/models/vision and returns the result", async () => {
        fetchMock.mockResolvedValue(jsonResponse({ model: "llava" }));

        const result = await client.setVisionModel("llava");

        expect(fetchMock).toHaveBeenCalledWith(
            `${BASE_URL}/api/models/vision`,
            expect.objectContaining({
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ model: "llava" }),
            }),
        );
        expect(result).toEqual({ model: "llava" });
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
        fetchMock.mockResolvedValue(
            sseResponse([
                'event: custom\ndata: {"a":1}\n\ndata: {"b":2}\n\n',
            ]),
        );

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
                if (call === 0) { call++; return { done: false, value: encoder.encode(part1) }; }
                if (call === 1) { call++; return { done: false, value: encoder.encode(part2) }; }
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
        fetchMock.mockResolvedValue(
            sseResponse([": this is a comment\nid: 42\ndata: {}\n\n"]),
        );

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
        fetchMock.mockResolvedValue(
            sseResponse([
                'event: a\ndata: 1\n\nevent: b\ndata: 2\n\n',
            ]),
        );

        const events = await collect(client.syncStream());

        expect(events).toHaveLength(2);
        expect(events[0]).toEqual({ event: "a", data: 1 });
        expect(events[1]).toEqual({ event: "b", data: 2 });
    });

    it("handles trailing partial line left in buffer without final newline", async () => {
        // The buffer remainder logic: last element of split("\n") goes back into buffer.
        // If there's no trailing \n the last partial line stays in buffer and is dropped
        // at stream end (done). Verify no crash and no spurious events.
        fetchMock.mockResolvedValue(
            sseResponse(["data: {}\n\ndata: incomplete"]),
        );

        const events = await collect(client.syncStream());

        // Only the complete line should produce an event; the partial is silently dropped
        expect(events).toHaveLength(1);
        expect(events[0].data).toEqual({});
    });

    it("trims whitespace from event name", async () => {
        fetchMock.mockResolvedValue(
            sseResponse(["event:  spaced \ndata: null\n\n"]),
        );

        const events = await collect(client.syncStream());

        expect(events[0].event).toBe("spaced");
    });

    it("handles event:X (no space after colon)", async () => {
        fetchMock.mockResolvedValue(
            sseResponse(['event:token\ndata: {"text":"hi"}\n\n']),
        );

        const events = await collect(client.syncStream());

        expect(events).toHaveLength(1);
        expect(events[0].event).toBe("token");
    });

    it("handles data:{...} (no space after colon)", async () => {
        fetchMock.mockResolvedValue(
            sseResponse(['event: token\ndata:{"key":"val"}\n\n']),
        );

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
        fetchMock
            .mockRejectedValueOnce(new Error("connection refused"))
            .mockResolvedValueOnce(jsonResponse(data));

        const result = await client.health();

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(result).toEqual(data);
    });

    it("throws after all retries exhausted on network error", async () => {
        fetchMock.mockRejectedValue(new Error("connection refused"));

        await expect(client.health()).rejects.toThrow("connection refused");
        expect(fetchMock).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
    });

    it("does NOT retry on HTTP error (4xx/5xx)", async () => {
        fetchMock.mockResolvedValue({
            ok: false,
            status: 422,
            text: () => Promise.resolve("Validation error"),
        } as unknown as Response);

        await expect(client.health()).rejects.toThrow("Server responded 422");
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

        await expect(client.status()).rejects.toThrow("Server responded 500: Internal Server Error");
    });

    it("throws with empty string when res.text() itself throws", async () => {
        fetchMock.mockResolvedValue({
            ok: false,
            status: 503,
            text: () => Promise.reject(new Error("network failure")),
        } as unknown as Response);

        await expect(client.status()).rejects.toThrow("Server responded 503: ");
    });
});

/** Build a fake fetch response whose body is a ReadableStream emitting NDJSON lines. */
function ndjsonResponse(lines: string[]): Response {
    const encoder = new TextEncoder();
    let index = 0;
    const reader = {
        read: vi.fn(async () => {
            if (index < lines.length) {
                return { done: false, value: encoder.encode(lines[index++]) };
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

describe("OllamaClient", () => {
    const OLLAMA_URL = "http://localhost:11434";
    let ollama: OllamaClient;

    beforeEach(() => {
        ollama = new OllamaClient(OLLAMA_URL);
    });

    describe("pull()", () => {
        it("POSTs to {baseUrl}/api/pull with model name and stream: true", async () => {
            fetchMock.mockResolvedValue(ndjsonResponse([
                '{"status":"pulling manifest"}\n',
            ]));

            await collect(ollama.pull("llama3"));

            expect(fetchMock).toHaveBeenCalledWith(
                `${OLLAMA_URL}/api/pull`,
                expect.objectContaining({
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ name: "llama3", stream: true }),
                }),
            );
        });

        it("yields OllamaPullProgress objects from NDJSON response", async () => {
            fetchMock.mockResolvedValue(ndjsonResponse([
                '{"status":"pulling manifest"}\n{"status":"downloading","completed":50,"total":100}\n',
                '{"status":"success"}\n',
            ]));

            const results = await collect(ollama.pull("llama3"));

            expect(results).toEqual([
                { status: "pulling manifest" },
                { status: "downloading", completed: 50, total: 100 },
                { status: "success" },
            ]);
        });

        it("throws on non-ok response", async () => {
            fetchMock.mockResolvedValue({
                ok: false,
                status: 404,
                text: () => Promise.resolve("model not found"),
            } as unknown as Response);

            await expect(collect(ollama.pull("nonexistent"))).rejects.toThrow(
                "Ollama responded 404: model not found",
            );
        });

        it("passes signal to fetch", async () => {
            fetchMock.mockResolvedValue(ndjsonResponse([]));
            const controller = new AbortController();

            await collect(ollama.pull("llama3", controller.signal));

            const init = fetchMock.mock.calls[0][1] as RequestInit;
            expect(init.signal).toBe(controller.signal);
        });

        it("throws when response.body is null", async () => {
            fetchMock.mockResolvedValue({
                ok: true,
                text: () => Promise.resolve(""),
                body: null,
            } as unknown as Response);

            await expect(collect(ollama.pull("llama3"))).rejects.toThrow("Response body is null");
        });

        it("skips malformed JSON lines", async () => {
            fetchMock.mockResolvedValue(ndjsonResponse([
                '{"status":"ok"}\nnot-valid-json\n{"status":"done"}\n',
            ]));

            const results = await collect(ollama.pull("llama3"));

            expect(results).toEqual([
                { status: "ok" },
                { status: "done" },
            ]);
        });

        it("skips blank lines between NDJSON entries", async () => {
            fetchMock.mockResolvedValue(ndjsonResponse([
                '{"status":"ok"}\n\n\n{"status":"done"}\n',
            ]));

            const results = await collect(ollama.pull("llama3"));

            expect(results).toEqual([
                { status: "ok" },
                { status: "done" },
            ]);
        });

        it("handles trailing NDJSON line without newline", async () => {
            fetchMock.mockResolvedValue(ndjsonResponse([
                '{"status":"success"}',
            ]));

            const results = await collect(ollama.pull("llama3"));

            expect(results).toEqual([{ status: "success" }]);
        });

        it("skips malformed trailing buffer", async () => {
            fetchMock.mockResolvedValue(ndjsonResponse([
                '{"status":"ok"}\nnot-json',
            ]));

            const results = await collect(ollama.pull("llama3"));

            expect(results).toEqual([{ status: "ok" }]);
        });
    });

    describe("delete()", () => {
        it("DELETEs to {baseUrl}/api/delete with model name", async () => {
            fetchMock.mockResolvedValue({
                ok: true,
                text: () => Promise.resolve(""),
            } as unknown as Response);

            await ollama.delete("llama3");

            expect(fetchMock).toHaveBeenCalledWith(
                `${OLLAMA_URL}/api/delete`,
                expect.objectContaining({
                    method: "DELETE",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ name: "llama3" }),
                }),
            );
        });

        it("throws on non-ok response", async () => {
            fetchMock.mockResolvedValue({
                ok: false,
                status: 404,
                text: () => Promise.resolve("model not found"),
            } as unknown as Response);

            await expect(ollama.delete("nonexistent")).rejects.toThrow(
                "Ollama responded 404: model not found",
            );
        });

        it("succeeds without returning anything on ok response", async () => {
            fetchMock.mockResolvedValue({
                ok: true,
                text: () => Promise.resolve(""),
            } as unknown as Response);

            const result = await ollama.delete("llama3");

            expect(result).toBeUndefined();
        });
    });

    describe("show()", () => {
        it("POSTs to {baseUrl}/api/show and returns parsed model defaults", async () => {
            fetchMock.mockResolvedValue(jsonResponse({
                parameters: "temperature 0.6\ntop_p 0.9\ntop_k 40\nrepeat_penalty 1.1\nnum_ctx 4096\nseed 42",
                model_info: {},
            }));

            const defaults = await ollama.show("llama3");

            expect(fetchMock).toHaveBeenCalledWith(
                `${OLLAMA_URL}/api/show`,
                expect.objectContaining({
                    method: "POST",
                    body: JSON.stringify({ name: "llama3" }),
                }),
            );
            expect(defaults).toEqual({
                temperature: 0.6,
                top_p: 0.9,
                top_k: 40,
                repeat_penalty: 1.1,
                num_ctx: 4096,
                seed: 42,
            });
        });

        it("throws on non-ok response", async () => {
            fetchMock.mockResolvedValue({
                ok: false,
                status: 404,
                text: () => Promise.resolve("model not found"),
            } as unknown as Response);

            await expect(ollama.show("nonexistent")).rejects.toThrow(
                "Ollama responded 404: model not found",
            );
        });

        it("falls back to model_info for context_length when parameters lacks num_ctx", async () => {
            fetchMock.mockResolvedValue(jsonResponse({
                parameters: "temperature 0.7",
                model_info: { "llama3.context_length": 8192 },
            }));

            const defaults = await ollama.show("llama3");
            expect(defaults.num_ctx).toBe(8192);
            expect(defaults.temperature).toBe(0.7);
        });

        it("handles missing parameters field", async () => {
            fetchMock.mockResolvedValue(jsonResponse({
                model_info: { "llama3.context_length": 4096 },
            }));

            const defaults = await ollama.show("llama3");
            expect(defaults.num_ctx).toBe(4096);
        });

        it("handles missing both parameters and model_info fields", async () => {
            fetchMock.mockResolvedValue(jsonResponse({}));

            const defaults = await ollama.show("llama3");
            expect(defaults).toEqual({});
        });
    });
});

describe("parseModelParameters()", () => {
    it("parses multiline parameter string", () => {
        const result = parseModelParameters(
            "temperature 0.8\ntop_p 0.95\nnum_ctx 2048",
            {},
        );
        expect(result).toEqual({
            temperature: 0.8,
            top_p: 0.95,
            num_ctx: 2048,
        });
    });

    it("ignores unknown parameter keys", () => {
        const result = parseModelParameters("mirostat 2\ntemperature 0.5", {});
        expect(result).toEqual({ temperature: 0.5 });
    });

    it("ignores lines with missing values", () => {
        const result = parseModelParameters("temperature\ntop_p 0.9", {});
        expect(result).toEqual({ top_p: 0.9 });
    });

    it("ignores non-numeric values", () => {
        const result = parseModelParameters("temperature abc", {});
        expect(result).toEqual({});
    });

    it("uses model_info context_length when num_ctx not in parameters", () => {
        const result = parseModelParameters("", {
            "model.context_length": 131072,
        });
        expect(result).toEqual({ num_ctx: 131072 });
    });

    it("prefers parameters num_ctx over model_info context_length", () => {
        const result = parseModelParameters("num_ctx 4096", {
            "model.context_length": 131072,
        });
        expect(result).toEqual({ num_ctx: 4096 });
    });

    it("returns empty object for empty inputs", () => {
        expect(parseModelParameters("", {})).toEqual({});
    });
});

describe("fetchWithRetry() — signal and AbortError", () => {
    it("sets caller-provided signal on fetch init", async () => {
        fetchMock.mockResolvedValue(jsonResponse({ status: "ok" }));
        const controller = new AbortController();

        await client.fetchWithRetry(
            `${BASE_URL}/api/health`,
            {},
            { signal: controller.signal },
        );

        const init = fetchMock.mock.calls[0][1] as RequestInit;
        expect(init.signal).toBe(controller.signal);
    });

    it("AbortError is thrown immediately without retrying", async () => {
        const abortError = new Error("The operation was aborted");
        abortError.name = "AbortError";
        fetchMock.mockRejectedValue(abortError);

        await expect(client.health()).rejects.toThrow("The operation was aborted");
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});
