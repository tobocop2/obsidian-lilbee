/**
 * Asserts every route `src/api.ts` calls against the server's real contract.
 *
 * The wiki client has drifted from the server twice (obl-tbq, then again after
 * the server's wiki rework). Both times CI stayed green, because every other
 * test in this suite mocks the client's own shape: if `wikiUpdate` calls the
 * wrong URL and the mock answers that wrong URL, the test passes.
 *
 * This test does not mock the contract. It drives the real client against a
 * recording fetch, then checks each recorded call against
 * `tests/fixtures/server-contract.json`, which is generated from the server's
 * own route table by `scripts/dump-server-contract.py`. Refresh it with:
 *
 *     python3 scripts/dump-server-contract.py --lilbee ~/projects/lilbee
 *
 * It checks two things the drifts actually turned on: the path/method exists,
 * and the client streams exactly those routes the server streams. The second
 * matters because a route can flip from a JSON body to SSE without changing its
 * path at all -- which is precisely how `PATCH /api/wiki/update` broke.
 */
import { vi, describe, it, expect, beforeEach } from "vitest";
import { LilbeeClient } from "../src/api";
import contract from "./fixtures/server-contract.json";

const BASE_URL = "http://localhost:7433";

type Operation = { streams: boolean };
const OPERATIONS = contract.operations as Record<string, Record<string, Operation>>;

/** A single outbound request the client made. */
interface Recorded {
    /** Client method that issued it, for failure messages. */
    caller: string;
    path: string;
    method: string;
    /** True when the client asked to consume the response as a stream. */
    stream: boolean;
}

/**
 * Turn a server route template into a matcher.
 *
 * Litestar paths carry typed params: `{slug:path}` swallows the remaining
 * segments, everything else matches exactly one.
 */
function templateToRegExp(template: string): RegExp {
    const pattern = template
        .split("/")
        .map((segment) => {
            const param = /^\{([^}]+)\}$/.exec(segment);
            if (!param) return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            return param[1].endsWith(":path") ? ".+" : "[^/]+";
        })
        .join("/");
    return new RegExp(`^${pattern}$`);
}

/**
 * Find the server route a concrete request path belongs to.
 *
 * A literal route always wins over a templated one, so `/api/wiki/drafts` binds
 * to itself rather than to `/api/wiki/{slug:path}`. Among templates, the one
 * with the most literal segments wins, so `/api/wiki/generate/{slug:path}` beats
 * the bare catch-all.
 */
function matchRoute(path: string): string | null {
    if (OPERATIONS[path]) return path;
    const candidates = Object.keys(OPERATIONS)
        .filter((template) => template.includes("{") && templateToRegExp(template).test(path))
        .sort((a, b) => literalSegments(b) - literalSegments(a));
    return candidates[0] ?? null;
}

function literalSegments(template: string): number {
    return template.split("/").filter((segment) => !segment.startsWith("{")).length;
}

/**
 * A response every consumer in the client can read: `.json()` for body callers,
 * a `body.getReader()` that reports done immediately for the SSE parser, and
 * `.arrayBuffer()` for the dataset export. The contract test cares about the
 * request, so the body only has to avoid throwing.
 */
function universalResponse(): Response {
    return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: () => Promise.resolve({}),
        text: () => Promise.resolve("{}"),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
        body: { getReader: () => ({ read: async () => ({ done: true, value: undefined }) }) },
    } as unknown as Response;
}

/**
 * Every client method that reaches the network, with arguments good enough to
 * get it there. Values are placeholders -- only the resulting URL is asserted.
 */
const INVOCATIONS: Record<string, unknown[]> = {
    health: [],
    status: [],
    search: ["query"],
    chatStream: ["question", []],
    listSessions: [],
    getSession: ["session-id"],
    createSession: ["model-ref", "scope"],
    appendSessionMessage: ["session-id", "user", "text"],
    renameSession: ["session-id", "title"],
    deleteSession: ["session-id"],
    listMemories: [],
    remember: ["text", "note"],
    setMemoryShared: ["memory-id", true],
    forgetMemory: ["memory-id"],
    addFiles: [["/tmp/a.md"]],
    uploadFiles: [[{ name: "a.md", data: new ArrayBuffer(4) }]],
    syncStream: [],
    listModels: [],
    pullModel: ["model"],
    setChatModel: ["model"],
    setEmbeddingModel: ["model"],
    setRerankerModel: ["model"],
    setVisionModel: ["model"],
    catalog: [],
    installedModels: [],
    showModel: ["model"],
    deleteModel: ["model"],
    listDocuments: [],
    removeDocuments: [["a.md"]],
    exportDataset: ["parquet"],
    importDataset: [new ArrayBuffer(8), "parquet"],
    crawl: ["https://example.com"],
    config: [],
    configDefaults: [],
    updateConfig: [{}],
    gpuStatsStream: [],
    placement: [],
    placementPreview: [null],
    applyPlacement: [{ roles: {} }],
    clearPlacement: [],
    getSource: ["a.md"],
    getSourceRaw: ["a.md"],
    wikiList: [],
    wikiPage: ["page"],
    wikiCitations: ["page"],
    wikiLint: [],
    wikiUpdate: [],
    wikiPrune: [],
    wikiStubs: [],
    wikiGenerate: ["titan"],
    wikiDrafts: [],
    wikiDraftDiff: ["page"],
    wikiDraftAccept: ["page"],
    wikiDraftReject: ["page"],
};

/**
 * Methods that deliberately never reach the network, so the coverage check
 * below can insist everything else is exercised. A new client method lands in
 * neither list and fails that check rather than slipping through untested.
 */
const NON_NETWORK = new Set([
    "constructor",
    "setToken",
    "setTokenProvider",
    "setOutcomeCallback",
    "setBaseUrl",
    "invalidateCapability",
    // Thin dispatch over methods already invoked above; covered by its own case.
    "getCapability",
    // Request plumbing rather than routes of their own. `private` is erased at
    // runtime, so the prototype still lists them; every request they make is
    // already recorded, because they all funnel through fetchWithRetry.
    "fetchWithRetry",
    "fetchResult",
    "parseSSE",
    "assertOk",
    "authHeaders",
    "recordOutcome",
    "refreshTokenFromProvider",
]);

let client: LilbeeClient;
let recorded: Recorded[];

/** Drive one client method and return the requests it made. */
async function record(name: string, args: unknown[]): Promise<Recorded[]> {
    recorded = [];
    current = name;
    const result = (client as unknown as Record<string, (...a: unknown[]) => unknown>)[name](...args);
    // Generators do not issue their request until first pulled.
    if (result && typeof (result as AsyncGenerator).next === "function") {
        await (result as AsyncGenerator).next();
    } else {
        await result;
    }
    return recorded;
}

let current = "";

beforeEach(() => {
    client = new LilbeeClient(BASE_URL);
    recorded = [];
    vi.stubGlobal(
        "fetch",
        vi.fn(() => Promise.resolve(universalResponse())),
    );
    const inner = client.fetchWithRetry.bind(client);
    client.fetchWithRetry = ((url: string, init?: RequestInit, opts?: { stream?: boolean }) => {
        recorded.push({
            caller: current,
            path: new URL(url, BASE_URL).pathname,
            method: (init?.method ?? "GET").toUpperCase(),
            stream: opts?.stream === true,
        });
        return inner(url, init, opts);
    }) as typeof client.fetchWithRetry;
});

describe("api.ts route contract", () => {
    it.each(Object.entries(INVOCATIONS))("%s calls a route the server serves", async (name, args) => {
        const calls = await record(name, args);
        expect(calls.length).toBeGreaterThan(0);
        for (const call of calls) {
            const route = matchRoute(call.path);
            expect(route, `${name}: server serves no route matching ${call.path}`).not.toBeNull();
            const methods = OPERATIONS[route!];
            expect(Object.keys(methods), `${name}: server does not serve ${call.method} ${route}`).toContain(
                call.method,
            );
        }
    });

    it.each(Object.entries(INVOCATIONS))("%s streams iff the server streams", async (name, args) => {
        const calls = await record(name, args);
        for (const call of calls) {
            const route = matchRoute(call.path);
            if (route === null) continue; // reported by the route test above
            const operation = OPERATIONS[route][call.method];
            if (operation === undefined) continue;
            expect(
                call.stream,
                operation.streams
                    ? `${name}: ${call.method} ${route} is an SSE stream, but the client reads it as a body`
                    : `${name}: ${call.method} ${route} returns a JSON body, but the client reads it as a stream`,
            ).toBe(operation.streams);
        }
    });

    it("probes capabilities against routes the server serves", async () => {
        for (const capability of ["api_keys", "crawling", "wiki"]) {
            client.invalidateCapability();
            const calls = await record("getCapability", [capability]);
            expect(calls.length).toBeGreaterThan(0);
            for (const call of calls) {
                expect(matchRoute(call.path), `${capability}: no route for ${call.path}`).not.toBeNull();
            }
        }
    });

    it("exercises every client method that reaches the network", () => {
        const declared = new Set([...Object.keys(INVOCATIONS), ...NON_NETWORK]);
        const missing = Object.getOwnPropertyNames(LilbeeClient.prototype)
            .filter((name) => !name.startsWith("probe") && !declared.has(name))
            .filter(
                (name) => typeof (LilbeeClient.prototype as unknown as Record<string, unknown>)[name] === "function",
            );
        expect(missing, "new client methods must be added to INVOCATIONS (or NON_NETWORK if they never fetch)").toEqual(
            [],
        );
    });
});
