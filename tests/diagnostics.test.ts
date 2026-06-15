import { beforeEach, describe, expect, it, vi } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { buildZip, collectDiagnostics, LOG_TAIL_MAX_BYTES, renderSummary, resolveOutputDir } from "../src/diagnostics";
import { node } from "../src/binary-manager";
import { MESSAGES } from "../src/locales/en";
import { DEFAULT_SETTINGS, SERVER_STATE } from "../src/types";
import type { DiagnosticsContext } from "../src/types";

vi.mock("../src/binary-manager", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../src/binary-manager")>();
    return {
        ...actual,
        node: {
            ...actual.node,
            existsSync: vi.fn().mockReturnValue(false),
            readdirSync: vi.fn().mockReturnValue([]),
            readFileSync: vi.fn(),
            statSync: vi.fn().mockReturnValue({ size: 10 }),
            join: (...parts: string[]) => parts.join("/"),
        },
    };
});

function makeContext(overrides: Partial<DiagnosticsContext> = {}): DiagnosticsContext {
    return {
        dataDir: "/data",
        sharedRoot: "/shared",
        settings: { ...DEFAULT_SETTINGS },
        journalEntries: [],
        pluginVersion: "1.2.3",
        serverVersion: "v0.4.0",
        serverState: SERVER_STATE.ERROR,
        serverUrl: "http://127.0.0.1:1234",
        lastOutput: "Traceback: boom",
        ...overrides,
    };
}

function fileText(ctx: DiagnosticsContext, name: string): string {
    const bundle = collectDiagnostics(ctx);
    const file = bundle.files.find((f) => f.name === name);
    expect(file).toBeDefined();
    expect(file?.data).not.toBeNull();
    return strFromU8(file?.data as Uint8Array);
}

describe("collectDiagnostics", () => {
    beforeEach(() => {
        vi.mocked(node.existsSync).mockReturnValue(false);
        vi.mocked(node.readdirSync).mockReturnValue([]);
        vi.mocked(node.statSync).mockReturnValue({ size: 10 } as ReturnType<typeof node.statSync>);
        vi.mocked(node.readFileSync).mockReturnValue("");
    });

    it("records misses for absent log files instead of failing", () => {
        const bundle = collectDiagnostics(makeContext());
        const misses = bundle.files.filter((f) => f.data === null);
        expect(misses.length).toBeGreaterThan(0);
        for (const miss of misses) expect(miss.note).toBe("not found");
        expect(bundle.summaryMarkdown).toContain("not found");
    });

    it("collects existing logs with secrets redacted", () => {
        vi.mocked(node.existsSync).mockReturnValue(true);
        vi.mocked(node.readdirSync).mockReturnValue(["worker-chat.log"] as unknown as ReturnType<
            typeof node.readdirSync
        >);
        vi.mocked(node.readFileSync).mockReturnValue('api_key = "sk-123"\nINFO ready');
        const bundle = collectDiagnostics(makeContext());
        const file = bundle.files.find((f) => f.name === "logs/worker-chat.log");
        expect(file?.data).not.toBeNull();
        const text = strFromU8(file?.data as Uint8Array);
        expect(text).toContain("[redacted]");
        expect(text).not.toContain("sk-123");
    });

    it("tail-caps oversized logs and notes truncation", () => {
        vi.mocked(node.existsSync).mockReturnValue(true);
        vi.mocked(node.readdirSync).mockReturnValue(["worker-chat.log"] as unknown as ReturnType<
            typeof node.readdirSync
        >);
        vi.mocked(node.statSync).mockReturnValue({ size: LOG_TAIL_MAX_BYTES * 2 } as ReturnType<typeof node.statSync>);
        vi.mocked(node.readFileSync).mockReturnValue("y\n".repeat(LOG_TAIL_MAX_BYTES));
        const bundle = collectDiagnostics(makeContext());
        const file = bundle.files.find((f) => f.name === "logs/worker-chat.log");
        expect(file?.data?.length).toBeLessThanOrEqual(LOG_TAIL_MAX_BYTES);
        expect(file?.note).toContain("truncated");
    });

    it("turns unreadable files into misses with the error noted", () => {
        vi.mocked(node.existsSync).mockReturnValue(true);
        vi.mocked(node.readdirSync).mockReturnValue(["worker-chat.log"] as unknown as ReturnType<
            typeof node.readdirSync
        >);
        vi.mocked(node.readFileSync).mockImplementation(() => {
            throw new Error("EACCES");
        });
        const bundle = collectDiagnostics(makeContext());
        const file = bundle.files.find((f) => f.name === "logs/worker-chat.log");
        expect(file?.data).toBeNull();
        expect(file?.note).toContain("EACCES");
    });

    it("stringifies non-Error throws in the miss note", () => {
        vi.mocked(node.existsSync).mockReturnValue(true);
        vi.mocked(node.readdirSync).mockReturnValue(["worker-chat.log"] as unknown as ReturnType<
            typeof node.readdirSync
        >);
        vi.mocked(node.readFileSync).mockImplementation(() => {
            throw "nope";
        });
        const bundle = collectDiagnostics(makeContext());
        const file = bundle.files.find((f) => f.name === "logs/worker-chat.log");
        expect(file?.data).toBeNull();
        expect(file?.note).toContain("nope");
    });

    it("does not duplicate an expected log that was found", () => {
        vi.mocked(node.existsSync).mockReturnValue(true);
        vi.mocked(node.readdirSync).mockReturnValue(["server.log"] as unknown as ReturnType<typeof node.readdirSync>);
        vi.mocked(node.readFileSync).mockReturnValue("INFO ready");
        const bundle = collectDiagnostics(makeContext());
        expect(bundle.files.filter((f) => f.name === "logs/server.log")).toHaveLength(1);
    });

    it("notes the remote server when dataDir is null and still includes settings.json", () => {
        const bundle = collectDiagnostics(makeContext({ dataDir: null }));
        expect(bundle.summaryMarkdown).toContain(MESSAGES.DIAG_REMOTE_SERVER_NOTE);
        expect(bundle.files.some((f) => f.name === "settings.json")).toBe(true);
    });

    it("includes redacted settings and the journal", () => {
        const ctx = makeContext({
            settings: { ...DEFAULT_SETTINGS, manualToken: "tok" },
            journalEntries: [{ timestamp: "2026-06-11T00:00:00Z", label: "chat", message: "boom", stack: null }],
        });
        expect(fileText(ctx, "settings.json")).toContain("[redacted]");
        expect(fileText(ctx, "journal.log")).toContain("boom");
    });

    it("includes journal entry stacks", () => {
        const ctx = makeContext({
            journalEntries: [{ timestamp: "t", label: "l", message: "m", stack: "at deepFrame" }],
        });
        expect(fileText(ctx, "journal.log")).toContain("at deepFrame");
    });

    it("renders a summary with warning header, environment, and stderr", () => {
        const bundle = collectDiagnostics(makeContext());
        expect(bundle.summaryMarkdown.startsWith(MESSAGES.DIAG_REVIEW_WARNING)).toBe(true);
        expect(bundle.summaryMarkdown).toContain("1.2.3");
        expect(bundle.summaryMarkdown).toContain("- Server version: v0.4.0");
        expect(bundle.summaryMarkdown).toContain(process.platform);
        expect(bundle.summaryMarkdown).toContain("Traceback: boom");
    });

    it("renders placeholders for empty stderr, journal, url, shared root, and server version", () => {
        const bundle = collectDiagnostics(
            makeContext({ lastOutput: "", serverUrl: "", sharedRoot: null, serverVersion: "" }),
        );
        expect(bundle.summaryMarkdown).toContain("(empty)");
        expect(bundle.summaryMarkdown).toContain("(none)");
        expect(bundle.summaryMarkdown).toContain("- Server version: (unknown)");
    });

    it("marks a noteless miss as missing in the summary", () => {
        const summary = renderSummary(makeContext(), [{ name: "logs/server.log", data: null, note: null }]);
        expect(summary).toContain("- logs/server.log: missing");
    });

    it("ignores non-log files and readdir failures", () => {
        vi.mocked(node.existsSync).mockReturnValue(true);
        vi.mocked(node.readdirSync).mockReturnValue(["notes.txt"] as unknown as ReturnType<typeof node.readdirSync>);
        const bundle = collectDiagnostics(makeContext());
        expect(bundle.files.some((f) => f.name === "logs/notes.txt")).toBe(false);

        vi.mocked(node.readdirSync).mockImplementation(() => {
            throw new Error("EIO");
        });
        const fallback = collectDiagnostics(makeContext());
        expect(fallback.files.some((f) => f.name === "logs/server.log")).toBe(true);
    });
});

describe("buildZip", () => {
    beforeEach(() => {
        vi.mocked(node.existsSync).mockReturnValue(true);
        vi.mocked(node.readdirSync).mockReturnValue(["worker-chat.log"] as unknown as ReturnType<
            typeof node.readdirSync
        >);
        vi.mocked(node.statSync).mockReturnValue({ size: 10 } as ReturnType<typeof node.statSync>);
        vi.mocked(node.readFileSync).mockReturnValue("INFO ready");
    });

    it("zips the summary and collected files, skipping misses", () => {
        const bundle = collectDiagnostics(makeContext());
        const entries = unzipSync(buildZip(bundle));
        expect(Object.keys(entries)).toContain("summary.md");
        expect(Object.keys(entries)).toContain("logs/worker-chat.log");
        expect(Object.keys(entries)).not.toContain("logs/spawn-crash.log");
    });
});

describe("resolveOutputDir", () => {
    it("returns ~/Downloads when it exists", () => {
        vi.stubEnv("HOME", "/Users/alice");
        vi.mocked(node.existsSync).mockReturnValue(true);
        expect(resolveOutputDir("/fallback")).toBe("/Users/alice/Downloads");
    });

    it("falls back when Downloads is missing", () => {
        vi.stubEnv("HOME", "/Users/alice");
        vi.mocked(node.existsSync).mockReturnValue(false);
        expect(resolveOutputDir("/fallback")).toBe("/fallback");
    });

    it("falls back when existsSync throws", () => {
        vi.stubEnv("HOME", "/Users/alice");
        vi.mocked(node.existsSync).mockImplementation(() => {
            throw new Error("EPERM");
        });
        expect(resolveOutputDir("/fallback")).toBe("/fallback");
    });

    it("falls back when no home dir is set", () => {
        vi.stubEnv("HOME", "");
        vi.stubEnv("USERPROFILE", "");
        expect(resolveOutputDir("/fallback")).toBe("/fallback");
    });

    it("uses USERPROFILE when HOME is unset", () => {
        vi.stubEnv("HOME", undefined);
        vi.stubEnv("USERPROFILE", "C:/Users/alice");
        vi.mocked(node.existsSync).mockReturnValue(true);
        expect(resolveOutputDir("/fallback")).toBe("C:/Users/alice/Downloads");
    });
});
