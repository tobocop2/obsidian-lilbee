import { describe, it, expect, vi, beforeEach } from "vitest";
import { node } from "../src/binary-manager";
import { ErrorJournal, JOURNAL_MAX_ENTRIES, PLUGIN_LOG_MAX_BYTES } from "../src/error-journal";

vi.mock("../src/binary-manager", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../src/binary-manager")>();
    return {
        ...actual,
        node: {
            ...actual.node,
            existsSync: vi.fn().mockReturnValue(true),
            mkdirSync: vi.fn(),
            appendFileSync: vi.fn(),
            readFileSync: vi.fn().mockReturnValue(""),
            writeFileSync: vi.fn(),
            statSync: vi.fn().mockReturnValue({ size: 0 }),
            dirname: (p: string) => p.split("/").slice(0, -1).join("/"),
        },
    };
});

const mocked = node as unknown as {
    existsSync: ReturnType<typeof vi.fn>;
    appendFileSync: ReturnType<typeof vi.fn>;
    readFileSync: ReturnType<typeof vi.fn>;
    writeFileSync: ReturnType<typeof vi.fn>;
    statSync: ReturnType<typeof vi.fn>;
};

describe("ErrorJournal", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocked.existsSync.mockReturnValue(true);
        mocked.readFileSync.mockReturnValue("");
        mocked.statSync.mockReturnValue({ size: 0 });
    });

    it("records entries with ISO timestamp, label, message, and stack", () => {
        const journal = new ErrorJournal();
        journal.record("sync", "boom", "stacktrace");
        expect(journal.entries).toHaveLength(1);
        const entry = journal.entries[0];
        expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
        expect(entry.label).toBe("sync");
        expect(entry.message).toBe("boom");
        expect(entry.stack).toBe("stacktrace");
    });

    it("defaults stack to null", () => {
        const journal = new ErrorJournal();
        journal.record("sync", "boom");
        expect(journal.entries[0].stack).toBeNull();
    });

    it("evicts the oldest entries beyond JOURNAL_MAX_ENTRIES", () => {
        const journal = new ErrorJournal();
        for (let i = 0; i < JOURNAL_MAX_ENTRIES + 5; i++) {
            journal.record("label", `m${i}`);
        }
        expect(journal.entries).toHaveLength(JOURNAL_MAX_ENTRIES);
        expect(journal.entries[0].message).toBe("m5");
    });

    it("does not write to disk before setLogDir", () => {
        const journal = new ErrorJournal();
        journal.record("sync", "boom");
        expect(mocked.appendFileSync).not.toHaveBeenCalled();
    });

    it("appends to <dir>/plugin.log after setLogDir", () => {
        const journal = new ErrorJournal();
        journal.setLogDir("/data/logs");
        journal.record("sync", "boom", "trace");
        expect(mocked.appendFileSync).toHaveBeenCalledTimes(1);
        const [path, line] = mocked.appendFileSync.mock.calls[0] as [string, string];
        expect(path).toContain("plugin.log");
        expect(line).toContain("boom");
        expect(line).toContain("[sync]");
        expect(line).toContain("\ntrace\n");
    });

    it("trims an oversized plugin.log before appending", () => {
        const oversized = "x".repeat(PLUGIN_LOG_MAX_BYTES + 100);
        mocked.statSync.mockReturnValue({ size: oversized.length });
        mocked.readFileSync.mockReturnValue(oversized);
        const journal = new ErrorJournal();
        journal.setLogDir("/data/logs");
        journal.record("sync", "boom");
        expect(mocked.writeFileSync).toHaveBeenCalledTimes(1);
        const written = mocked.writeFileSync.mock.calls[0][1] as string;
        expect(written.length).toBeLessThanOrEqual(PLUGIN_LOG_MAX_BYTES);
        expect(mocked.appendFileSync).toHaveBeenCalled();
    });

    it("survives disk failures silently and keeps the entry in memory", () => {
        mocked.appendFileSync.mockImplementation(() => {
            throw new Error("ENOSPC");
        });
        const journal = new ErrorJournal();
        journal.setLogDir("/data/logs");
        expect(() => journal.record("sync", "boom")).not.toThrow();
        expect(journal.entries).toHaveLength(1);
        expect(journal.entries[0].message).toBe("boom");
    });
});
