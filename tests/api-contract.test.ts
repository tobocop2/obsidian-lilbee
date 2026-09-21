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
 * It checks three things the drifts actually turned on: the path/method exists,
 * the client streams exactly those routes the server streams, and the client's
 * declared response type agrees with the server's response model. The stream
 * check matters because a route can flip from a JSON body to SSE without
 * changing its path at all -- which is precisely how `PATCH /api/wiki/update`
 * broke. The shape check matters because a path can stay put while a field
 * changes type -- `removeDocuments` declared `removed` a count for as long as
 * the server had been answering with a list of names.
 */
import { vi, describe, it, expect, beforeEach, beforeAll } from "vitest";
import ts from "typescript";
import { fileURLToPath } from "node:url";
import { LilbeeClient } from "../src/api";
import contract from "./fixtures/server-contract.json";

const BASE_URL = "http://localhost:7433";

/** The JSON shape a response field lands in: only `array` is asserted across languages. */
type FieldKind = string;
type Operation = { streams: boolean; fields?: Record<string, FieldKind> };
const OPERATIONS = contract.operations as Record<string, Record<string, Operation>>;
const API_PATH = fileURLToPath(new URL("../src/api.ts", import.meta.url));
const TSCONFIG_PATH = fileURLToPath(new URL("../tsconfig.json", import.meta.url));

/**
 * Every field of a client method's declared response type, and whether it is an
 * array. `null` for a method whose response type is not a plain object, so the
 * shape check has nothing to compare and skips it.
 */
type DeclaredShape = Map<string, boolean> | null;

/** Wrappers between the declared return type and the response body it carries. */
const RETURN_WRAPPERS = new Set(["Promise", "Result", "AsyncGenerator"]);

/** True when a type prints as an array, ignoring an optional `undefined` arm. */
function isArrayText(text: string): boolean {
    const arms = text.split(" | ").filter((arm) => arm !== "undefined" && arm !== "null");
    return arms.length === 1 && (/\[\]$/.test(arms[0]) || /^(Readonly)?Array</.test(arms[0]));
}

/** Read `src/api.ts` with the compiler and record what each method says it returns. */
function declaredShapes(): Map<string, DeclaredShape> {
    const config = ts.readConfigFile(TSCONFIG_PATH, ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, fileURLToPath(new URL("..", import.meta.url)));
    const program = ts.createProgram([API_PATH], { ...parsed.options, noEmit: true });
    const checker = program.getTypeChecker();
    const source = program.getSourceFile(API_PATH);
    if (source === undefined) throw new Error(`the compiler did not load ${API_PATH}`);

    const shapes = new Map<string, DeclaredShape>();
    for (const statement of source.statements) {
        if (!ts.isClassDeclaration(statement) || statement.name?.text !== "LilbeeClient") continue;
        for (const member of statement.members) {
            if (!ts.isMethodDeclaration(member) || !ts.isIdentifier(member.name)) continue;
            const signature = checker.getSignatureFromDeclaration(member);
            if (signature === undefined) continue;
            shapes.set(member.name.text, bodyShape(checker, signature.getReturnType()));
        }
    }
    return shapes;
}

/** Unwrap the promise, result and generator layers, then list the body's fields. */
function bodyShape(checker: ts.TypeChecker, type: ts.Type): DeclaredShape {
    let body = type;
    while (RETURN_WRAPPERS.has(body.getSymbol()?.getName() ?? "")) {
        const args = checker.getTypeArguments(body as ts.TypeReference);
        if (args.length === 0) return null;
        body = args[0];
    }
    if (isArrayText(checker.typeToString(body))) return null;
    const properties = body.getProperties();
    if (properties.length === 0) return null;
    return new Map(
        properties.map((property) => [
            property.getName(),
            isArrayText(checker.typeToString(checker.getTypeOfSymbol(property))),
        ]),
    );
}

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
        body: {
            getReader: () => ({
                read: async () => ({ done: true, value: undefined }),
                cancel: async () => undefined,
            }),
        },
    } as unknown as Response;
}

/**
 * Every client method that reaches the network, with arguments good enough to
 * get it there. Values are placeholders -- only the resulting URL is asserted.
 */
const INVOCATIONS: Record<string, unknown[]> = {
    health: [],
    status: [],
    getAgentConfigIndex: [],
    getAgentConfig: ["opencode"],
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
    setupCrawler: [],
    config: [],
    configDefaults: [],
    configSchema: [],
    updateConfig: [{}],
    gpuStatsStream: [],
    warmStream: [],
    placement: [],
    placementPreview: [null],
    applyPlacement: [{ roles: {} }],
    clearPlacement: [],
    getSource: ["a.md"],
    getSourceRaw: ["a.md"],
    wikiList: [],
    wikiStatus: [],
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
let SHAPES: Map<string, DeclaredShape>;

beforeAll(() => {
    SHAPES = declaredShapes();
});

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

    // Without this the shape check degrades silently: a reader that resolves nothing
    // skips every method and the suite still reports green.
    it("reads the declared response shape out of the client source", () => {
        expect(SHAPES.get("removeDocuments")).toEqual(
            new Map([
                ["removed", true],
                ["not_found", true],
            ]),
        );
    });

    it.each(Object.entries(INVOCATIONS))("%s declares the shape the server answers with", async (name, args) => {
        const declared = SHAPES.get(name);
        if (declared === null || declared === undefined) return; // no object response to compare
        const calls = await record(name, args);
        for (const call of calls) {
            const route = matchRoute(call.path);
            if (route === null) continue; // reported by the route test above
            const fields = OPERATIONS[route]?.[call.method]?.fields;
            if (fields === undefined) continue; // an open-ended body the server does not model
            for (const [field, isArray] of declared) {
                const served = fields[field];
                if (served === undefined) continue; // the client reads a subset, which is fine
                expect(
                    isArray,
                    `${name}: ${call.method} ${route} answers with ${field} as ${served === "array" ? "a list" : "a single value"}`,
                ).toBe(served === "array");
            }
        }
    });

    it("probes capabilities against routes the server serves", async () => {
        for (const capability of ["api_keys", "crawling", "crawling_browser", "wiki"]) {
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
