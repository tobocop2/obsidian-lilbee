import { beforeEach, describe, expect, it, vi } from "vitest";
import { Notice } from "obsidian";
import { shell } from "electron";
import { exportDiagnostics } from "../src/diagnostics-export";
import { node } from "../src/binary-manager";
import { DEFAULT_SETTINGS, SERVER_STATE } from "../src/types";
import type { DiagnosticsContext } from "../src/types";

vi.mock("../src/binary-manager", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../src/binary-manager")>();
    return {
        ...actual,
        node: {
            ...actual.node,
            existsSync: vi.fn().mockReturnValue(true),
            readdirSync: vi.fn().mockReturnValue([]),
            readFileSync: vi.fn().mockReturnValue(""),
            statSync: vi.fn().mockReturnValue({ size: 0 }),
            writeFileSync: vi.fn(),
            join: (...parts: string[]) => parts.join("/"),
        },
    };
});

function makeContext(): DiagnosticsContext {
    return {
        dataDir: "/data",
        sharedRoot: "/shared",
        settings: { ...DEFAULT_SETTINGS },
        journalEntries: [],
        pluginVersion: "1.2.3",
        serverVersion: "v0.4.0",
        serverState: SERVER_STATE.ERROR,
        serverUrl: "",
        lastOutput: "",
    };
}

describe("exportDiagnostics", () => {
    let writeText: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.clearAllMocks();
        Notice.clear();
        vi.stubEnv("HOME", "/Users/alice");
        writeText = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal("navigator", { clipboard: { writeText } });
        vi.mocked(node.writeFileSync).mockImplementation(() => undefined);
        vi.mocked(node.existsSync).mockReturnValue(true);
    });

    it("writes the zip to Downloads, reveals it, copies the summary, and notifies", async () => {
        await exportDiagnostics(makeContext());

        const write = vi.mocked(node.writeFileSync);
        expect(write).toHaveBeenCalledTimes(1);
        const [zipPath, body] = write.mock.calls[0] as [string, unknown];
        expect(zipPath).toMatch(/\/Users\/alice\/Downloads\/lilbee-diagnostics-.*\.zip$/);
        expect(body).toBeInstanceOf(Uint8Array);
        expect(vi.mocked(shell.showItemInFolder)).toHaveBeenCalledWith(zipPath);
        expect(writeText).toHaveBeenCalledTimes(1);
        expect(writeText.mock.calls[0][0]).toContain("Review this bundle before sharing");
        expect(Notice.instances.some((n) => n.message.includes("Review the contents before sharing"))).toBe(true);
    });

    it("falls back to summary.md when the zip write fails", async () => {
        vi.mocked(node.writeFileSync).mockImplementationOnce(() => {
            throw new Error("disk full");
        });

        await exportDiagnostics(makeContext());

        const write = vi.mocked(node.writeFileSync);
        expect(write).toHaveBeenCalledTimes(2);
        const [summaryPath, body] = write.mock.calls[1] as [string, unknown];
        expect(summaryPath).toMatch(/summary\.md$/);
        expect(typeof body).toBe("string");
        expect(Notice.instances.some((n) => n.message.includes("summary.md"))).toBe(true);
        expect(vi.mocked(shell.showItemInFolder)).toHaveBeenCalledWith(summaryPath);
    });

    it("reports failure and skips reveal when every write throws an Error", async () => {
        vi.mocked(node.writeFileSync).mockImplementation(() => {
            throw new Error("disk full");
        });

        await exportDiagnostics({ ...makeContext(), dataDir: null });

        expect(Notice.instances.some((n) => n.message.includes("Diagnostics export failed: disk full"))).toBe(true);
        expect(vi.mocked(shell.showItemInFolder)).not.toHaveBeenCalled();
    });

    it("stringifies non-Error throwables in the failure notice", async () => {
        vi.mocked(node.writeFileSync).mockImplementation(() => {
            throw "disk exploded";
        });

        await exportDiagnostics(makeContext());

        expect(Notice.instances.some((n) => n.message.includes("Diagnostics export failed: disk exploded"))).toBe(true);
        expect(vi.mocked(shell.showItemInFolder)).not.toHaveBeenCalled();
    });

    it("treats clipboard and reveal failures as non-fatal", async () => {
        writeText.mockRejectedValueOnce(new Error("no clipboard"));
        vi.mocked(shell.showItemInFolder).mockImplementationOnce(() => {
            throw new Error("no shell");
        });

        await exportDiagnostics(makeContext());

        expect(Notice.instances.some((n) => n.message.includes("Diagnostics saved to"))).toBe(true);
    });
});
