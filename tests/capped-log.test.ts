import { describe, it, expect, vi, beforeEach } from "vitest";
import { node } from "../src/binary-manager";
import { appendCapped } from "../src/utils/capped-log";

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
    mkdirSync: ReturnType<typeof vi.fn>;
    appendFileSync: ReturnType<typeof vi.fn>;
    readFileSync: ReturnType<typeof vi.fn>;
    writeFileSync: ReturnType<typeof vi.fn>;
    statSync: ReturnType<typeof vi.fn>;
};

describe("appendCapped", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocked.existsSync.mockReturnValue(true);
        mocked.readFileSync.mockReturnValue("");
        mocked.statSync.mockReturnValue({ size: 0 });
    });

    it("creates the parent dir when missing", () => {
        mocked.existsSync.mockReturnValue(false);
        appendCapped("/data/logs/plugin.log", "line\n", 100);
        expect(mocked.mkdirSync).toHaveBeenCalledWith("/data/logs", { recursive: true });
        expect(mocked.appendFileSync).toHaveBeenCalledWith("/data/logs/plugin.log", "line\n");
    });

    it("does not create the parent dir when it exists", () => {
        appendCapped("/data/logs/plugin.log", "line\n", 100);
        expect(mocked.mkdirSync).not.toHaveBeenCalled();
    });

    it("trims an oversized file to its newest tail before appending", () => {
        const oversized = "a".repeat(50) + "b".repeat(60);
        mocked.statSync.mockReturnValue({ size: oversized.length });
        mocked.readFileSync.mockReturnValue(oversized);
        appendCapped("/data/logs/plugin.log", "new\n", 100);
        expect(mocked.writeFileSync).toHaveBeenCalledWith("/data/logs/plugin.log", oversized.slice(-100));
        const writeOrder = mocked.writeFileSync.mock.invocationCallOrder[0];
        const appendOrder = mocked.appendFileSync.mock.invocationCallOrder[0];
        expect(writeOrder).toBeLessThan(appendOrder);
    });

    it("leaves a file at or under the cap untrimmed", () => {
        mocked.statSync.mockReturnValue({ size: 100 });
        appendCapped("/data/logs/plugin.log", "new\n", 100);
        expect(mocked.writeFileSync).not.toHaveBeenCalled();
        expect(mocked.appendFileSync).toHaveBeenCalledWith("/data/logs/plugin.log", "new\n");
    });

    it("swallows existsSync errors", () => {
        mocked.existsSync.mockImplementation(() => {
            throw new Error("EACCES");
        });
        expect(() => appendCapped("/data/logs/plugin.log", "line\n", 100)).not.toThrow();
    });

    it("swallows appendFileSync errors", () => {
        mocked.appendFileSync.mockImplementation(() => {
            throw new Error("ENOSPC");
        });
        expect(() => appendCapped("/data/logs/plugin.log", "line\n", 100)).not.toThrow();
    });
});
