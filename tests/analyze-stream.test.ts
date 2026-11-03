import { vi, describe, it, expect, beforeEach } from "vitest";
import { drainAnalyze } from "../src/analyze-stream";
import { SessionTokenError } from "../src/api";
import { StreamIdleError } from "../src/utils/idle";
import { sessionTokenInvalidMessage } from "../src/utils";
import { MESSAGES } from "../src/locales/en";
import { SERVER_MODE } from "../src/types";
import type { AnalyzeResponse } from "../src/types";

const REPORT: AnalyzeResponse = {
    files_total: 4,
    documents_total: 1,
    files_read: 1,
    files_counted: 3,
    cap: 500,
    failed: [],
    file_types: { ".md": 1 },
    code_share: 0,
    pdf: {
        files: 0,
        pages: 0,
        scanned_pages: 0,
        scanned_share: 0,
        files_with_tables: 0,
        tables: 0,
        median_pages: null,
    },
    median_chars: 120,
    languages: [],
    recommendation: { builtin: "Default", name: null, values: {}, changes: [], kept: [], reasons: [], notes: [] },
    saved: null,
};

/** A plugin double narrow enough for drainAnalyze: api.analyzeStream and settings.serverMode. */
function makePlugin(events: { event: string; data: unknown }[]): {
    api: { analyzeStream: ReturnType<typeof vi.fn> };
    settings: { serverMode: string };
} {
    return {
        api: {
            analyzeStream: vi.fn(async function* () {
                for (const event of events) yield event;
            }),
        },
        settings: { serverMode: SERVER_MODE.MANAGED },
    };
}

function throwingPlugin(error: unknown): {
    api: { analyzeStream: ReturnType<typeof vi.fn> };
    settings: { serverMode: string };
} {
    return {
        api: {
            analyzeStream: vi.fn(() => {
                throw error;
            }),
        },
        settings: { serverMode: SERVER_MODE.MANAGED },
    };
}

describe("drainAnalyze()", () => {
    let controller: AbortController;

    beforeEach(() => {
        controller = new AbortController();
    });

    it("reports progress and returns the report on done", async () => {
        const progress: unknown[] = [];
        const plugin = makePlugin([
            { event: "analyze", data: { done: 1, total: 2, file: "a.md" } },
            { event: "done", data: REPORT },
        ]);

        const outcome = await drainAnalyze(plugin as any, null, undefined, controller, (p) => progress.push(p));

        expect(outcome).toEqual({ kind: "report", report: REPORT });
        expect(progress).toEqual([{ done: 1, total: 2, file: "a.md" }]);
    });

    it("returns an error outcome for an error event, with the string form", async () => {
        const plugin = makePlugin([{ event: "error", data: "Bad name" }]);

        const outcome = await drainAnalyze(plugin as any, null, undefined, controller, () => {});

        expect(outcome).toEqual({ kind: "error", message: "Bad name" });
    });

    it("returns an error outcome for an error event, with the object form", async () => {
        const plugin = makePlugin([{ event: "error", data: { message: "Could not save the change: disk full" } }]);

        const outcome = await drainAnalyze(plugin as any, null, undefined, controller, () => {});

        expect(outcome).toEqual({ kind: "error", message: "Could not save the change: disk full" });
    });

    it("returns an error outcome when the stream ends with no done and no error", async () => {
        const plugin = makePlugin([]);

        const outcome = await drainAnalyze(plugin as any, null, undefined, controller, () => {});

        expect(outcome).toEqual({ kind: "error", message: MESSAGES.ERROR_UNKNOWN });
    });

    it("ignores a heartbeat event and still returns the report", async () => {
        const plugin = makePlugin([
            { event: "heartbeat", data: { ts: 1 } },
            { event: "done", data: REPORT },
        ]);

        const outcome = await drainAnalyze(plugin as any, null, undefined, controller, () => {});

        expect(outcome).toEqual({ kind: "report", report: REPORT });
    });

    it("returns cancelled when the controller's own signal aborts the fetch", async () => {
        const abortError = Object.assign(new Error("aborted"), { name: "AbortError" });
        const plugin = throwingPlugin(abortError);

        const outcome = await drainAnalyze(plugin as any, null, undefined, controller, () => {});

        expect(outcome).toEqual({ kind: "cancelled" });
    });

    it("returns unsupported for a 404, an old server with no analyze route", async () => {
        const notFound = new Error("Server responded 404: {}");
        const plugin = throwingPlugin(notFound);

        const outcome = await drainAnalyze(plugin as any, null, undefined, controller, () => {});

        expect(outcome).toEqual({ kind: "unsupported" });
    });

    it("returns the server's detail for a validation refusal (400)", async () => {
        const refused = new Error('Server responded 400: {"detail": "not a folder"}');
        const plugin = throwingPlugin(refused);

        const outcome = await drainAnalyze(plugin as any, null, undefined, controller, () => {});

        expect(outcome).toEqual({ kind: "error", message: "not a folder" });
    });

    it("falls back to the raw message when a thrown error has no server detail", async () => {
        const plugin = throwingPlugin(new Error("network down"));

        const outcome = await drainAnalyze(plugin as any, null, undefined, controller, () => {});

        expect(outcome).toEqual({ kind: "error", message: "network down" });
    });

    it("falls back to String(err) for a thrown non-Error", async () => {
        const plugin = throwingPlugin("boom");

        const outcome = await drainAnalyze(plugin as any, null, undefined, controller, () => {});

        expect(outcome).toEqual({ kind: "error", message: "boom" });
    });

    it("returns the session-token message for a stale token", async () => {
        const plugin = throwingPlugin(new SessionTokenError(401, "expired"));

        const outcome = await drainAnalyze(plugin as any, null, undefined, controller, () => {});

        expect(outcome).toEqual({ kind: "error", message: sessionTokenInvalidMessage(SERVER_MODE.MANAGED) });
    });

    it("returns the idle-stream message when the read stalls", async () => {
        const plugin = throwingPlugin(new StreamIdleError(120_000));

        const outcome = await drainAnalyze(plugin as any, null, undefined, controller, () => {});

        expect(outcome).toEqual({ kind: "error", message: MESSAGES.ERROR_STREAM_IDLE });
    });

    it("aborts the controller and reports the idle message when the source stalls", async () => {
        vi.useFakeTimers();
        const plugin = {
            api: {
                analyzeStream: vi.fn(async function* () {
                    yield { event: "analyze", data: { done: 0, total: 1, file: "a.md" } };
                    await new Promise<never>(() => {});
                }),
            },
            settings: { serverMode: SERVER_MODE.MANAGED },
        };

        const outcomePromise = drainAnalyze(plugin as any, null, undefined, controller, () => {});
        await vi.advanceTimersByTimeAsync(120_000);
        const outcome = await outcomePromise;

        expect(controller.signal.aborted).toBe(true);
        expect(outcome).toEqual({ kind: "error", message: MESSAGES.ERROR_STREAM_IDLE });
        vi.useRealTimers();
    });

    it("passes directory and options through to the client", async () => {
        const plugin = makePlugin([{ event: "done", data: REPORT }]);

        await drainAnalyze(plugin as any, "/vault", { apply: true }, controller, () => {});

        expect(plugin.api.analyzeStream).toHaveBeenCalledWith("/vault", { apply: true }, controller.signal);
    });
});
