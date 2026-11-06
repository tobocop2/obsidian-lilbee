/**
 * The analyze client methods, against bodies matching the stated server contract
 * (lilbee branch feat/analyze-surfaces, PR #960). No fixture dump exists yet for
 * this contract; a later refresh of tests/fixtures/*.json should add an
 * `analyze_state`, `analyze_dismiss` and `analyze_done` entry alongside it.
 */
import { vi, describe, it, expect, beforeEach } from "vitest";
import { LilbeeClient } from "../src/api";
import { PROFILE_FOLDER } from "../src/types";

const BASE_URL = "http://localhost:7433";

let fetchMock: ReturnType<typeof vi.fn>;
let client: LilbeeClient;

beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    client = new LilbeeClient(BASE_URL);
});

function jsonResponse(data: unknown, status = 200): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(data),
        text: () => Promise.resolve(JSON.stringify(data)),
        body: null,
    } as unknown as Response;
}

function sseResponse(chunks: string[]): Response {
    const encoder = new TextEncoder();
    let index = 0;
    const reader = {
        read: vi.fn(async () => {
            if (index < chunks.length) return { done: false, value: encoder.encode(chunks[index++]) };
            return { done: true, value: undefined };
        }),
        cancel: vi.fn(async () => undefined),
    };
    return { ok: true, text: () => Promise.resolve(""), body: { getReader: () => reader } } as unknown as Response;
}

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
    const items: T[] = [];
    for await (const item of gen) items.push(item);
    return items;
}

/** The one request the client made: its URL and method. */
function sent(): { url: string; method: string } {
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit | undefined];
    return { url, method: init?.method ?? "GET" };
}

describe("analyzeStream()", () => {
    it("POSTs to /api/analyze with an empty body by default", async () => {
        fetchMock.mockResolvedValue(sseResponse([]));

        await collect(client.analyzeStream());

        expect(fetchMock).toHaveBeenCalledWith(`${BASE_URL}/api/analyze`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
        });
    });

    it("sends the directory, apply, save and target when given", async () => {
        fetchMock.mockResolvedValue(sseResponse([]));

        await collect(
            client.analyzeStream("/vault/notes", { apply: true, save: "Notes", target: PROFILE_FOLDER.PROJECT }),
        );

        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body).toEqual({ directory: "/vault/notes", apply: true, save: "Notes", target: "project" });
    });

    it("omits apply, save and target when not set", async () => {
        fetchMock.mockResolvedValue(sseResponse([]));

        await collect(client.analyzeStream(null, {}));

        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body).toEqual({ directory: null });
    });

    it("yields analyze progress frames and the done report", async () => {
        fetchMock.mockResolvedValue(
            sseResponse([
                'event: analyze\ndata: {"done":1,"total":2,"file":"a.md"}\n\n',
                'event: done\ndata: {"files_total":2}\n\n',
            ]),
        );

        const events = await collect(client.analyzeStream());

        expect(events.map((e) => e.event)).toEqual(["analyze", "done"]);
        expect(events[0].data).toEqual({ done: 1, total: 2, file: "a.md" });
    });

    it("yields an error frame for a refused save", async () => {
        fetchMock.mockResolvedValue(sseResponse(['event: error\ndata: {"message":"Bad name"}\n\n']));

        const events = await collect(client.analyzeStream());

        expect(events).toEqual([{ event: "error", data: { message: "Bad name" } }]);
    });
});

describe("analyzeState()", () => {
    it("reads the tip state", async () => {
        fetchMock.mockResolvedValue(jsonResponse({ analyzed: false, tip_dismissed: false, tip_shows: true }));

        const state = await client.analyzeState();

        expect(sent()).toEqual({ url: `${BASE_URL}/api/analyze/state`, method: "GET" });
        expect(state).toEqual({ analyzed: false, tip_dismissed: false, tip_shows: true });
    });

    it("answers null against a server that predates analyze", async () => {
        fetchMock.mockResolvedValue(jsonResponse({ detail: "Not Found" }, 404));

        await expect(client.analyzeState()).resolves.toBeNull();
    });
});

describe("dismissAnalyzeTip()", () => {
    it("POSTs to the dismiss route and reads the new state", async () => {
        fetchMock.mockResolvedValue(jsonResponse({ analyzed: false, tip_dismissed: true, tip_shows: false }));

        const state = await client.dismissAnalyzeTip();

        expect(sent()).toEqual({ url: `${BASE_URL}/api/analyze/dismiss`, method: "POST" });
        expect(state).toEqual({ analyzed: false, tip_dismissed: true, tip_shows: false });
    });

    it("answers null against a server that predates analyze", async () => {
        fetchMock.mockResolvedValue(jsonResponse({ detail: "Not Found" }, 404));

        await expect(client.dismissAnalyzeTip()).resolves.toBeNull();
    });
});
