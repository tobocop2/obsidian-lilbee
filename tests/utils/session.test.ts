import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { Notice, type Vault } from "obsidian";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
    chunkTypeFromScope,
    deriveSessionTitle,
    exportChatFile,
    saveChatNote,
    scopeFromChunkType,
    SESSION_SCOPE,
    SESSION_TITLE_MAX_LEN,
} from "../../src/utils/session";
import { SEARCH_CHUNK_TYPE } from "../../src/types";
import { MESSAGES } from "../../src/locales/en";

describe("scopeFromChunkType", () => {
    it("maps the plugin's 'all' onto the server's 'both'", () => {
        expect(scopeFromChunkType(SEARCH_CHUNK_TYPE.ALL)).toBe(SESSION_SCOPE.BOTH);
    });

    it("passes the scopes that share a name straight through", () => {
        expect(scopeFromChunkType(SEARCH_CHUNK_TYPE.WIKI)).toBe(SESSION_SCOPE.WIKI);
        expect(scopeFromChunkType(SEARCH_CHUNK_TYPE.RAW)).toBe(SESSION_SCOPE.RAW);
    });
});

describe("chunkTypeFromScope", () => {
    it("inverts scopeFromChunkType for every chunk type", () => {
        for (const chunk of [SEARCH_CHUNK_TYPE.ALL, SEARCH_CHUNK_TYPE.WIKI, SEARCH_CHUNK_TYPE.RAW]) {
            expect(chunkTypeFromScope(scopeFromChunkType(chunk))).toBe(chunk);
        }
    });

    it("returns null for a scope this build doesn't know", () => {
        expect(chunkTypeFromScope("something-new")).toBeNull();
        expect(chunkTypeFromScope("")).toBeNull();
    });
});

describe("deriveSessionTitle", () => {
    it("uses the first line of the message", () => {
        expect(deriveSessionTitle("What is a bee?\nMore detail here")).toBe("What is a bee?");
    });

    it("splits CRLF and bare-CR line endings like the server's splitlines", () => {
        expect(deriveSessionTitle("What is a bee?\r\nMore detail")).toBe("What is a bee?");
        expect(deriveSessionTitle("What is a bee?\rMore detail")).toBe("What is a bee?");
    });

    it("trims surrounding whitespace", () => {
        expect(deriveSessionTitle("  spaced out  ")).toBe("spaced out");
    });

    it("falls back to the untitled label for a blank message", () => {
        expect(deriveSessionTitle("   \n  ")).toBe(MESSAGES.SESSIONS_UNTITLED);
        expect(deriveSessionTitle("")).toBe(MESSAGES.SESSIONS_UNTITLED);
    });

    it("truncates an over-long first line and marks it with an ellipsis", () => {
        const title = deriveSessionTitle("x".repeat(SESSION_TITLE_MAX_LEN + 10));
        expect(title).toBe("x".repeat(SESSION_TITLE_MAX_LEN) + "…");
        expect(title.length).toBe(SESSION_TITLE_MAX_LEN + 1);
    });

    it("leaves a line exactly at the limit alone", () => {
        const exact = "y".repeat(SESSION_TITLE_MAX_LEN);
        expect(deriveSessionTitle(exact)).toBe(exact);
    });
});

describe("saveChatNote", () => {
    beforeEach(() => {
        Notice.clear();
    });

    function makeVault(folderExists: boolean, create = vi.fn().mockResolvedValue(undefined)) {
        return {
            getAbstractFileByPath: vi.fn().mockReturnValue(folderExists ? { path: "lilbee" } : null),
            createFolder: vi.fn().mockResolvedValue(undefined),
            create,
        };
    }

    it("creates the lilbee folder and a timestamped note, then says where", async () => {
        const vault = makeVault(false);

        await saveChatNote(vault as unknown as Vault, "# body");

        expect(vault.createFolder).toHaveBeenCalledWith("lilbee");
        expect(vault.create).toHaveBeenCalledWith(
            expect.stringMatching(/^lilbee\/chat-\d{4}-\d{2}-\d{2}-\d{6}\.md$/),
            "# body",
        );
        const path = vault.create.mock.calls[0][0] as string;
        expect(Notice.instances.map((n) => n.message)).toContain(MESSAGES.NOTICE_SAVED(path));
    });

    it("reuses an existing lilbee folder", async () => {
        const vault = makeVault(true);

        await saveChatNote(vault as unknown as Vault, "# body");

        expect(vault.createFolder).not.toHaveBeenCalled();
        expect(vault.create).toHaveBeenCalled();
    });

    it("reports a failed write instead of throwing", async () => {
        const vault = makeVault(true, vi.fn().mockRejectedValue(new Error("exists")));

        await saveChatNote(vault as unknown as Vault, "# body");

        expect(Notice.instances.map((n) => n.message)).toEqual([MESSAGES.ERROR_SAVE_CHAT]);
    });
});

describe("exportChatFile", () => {
    const exportDirs: string[] = [];

    beforeEach(() => {
        Notice.clear();
    });

    afterEach(() => {
        for (const dir of exportDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    });

    function exportDir(): string {
        const dir = mkdtempSync(join(tmpdir(), "lilbee-export-"));
        exportDirs.push(dir);
        return dir;
    }

    const exported =
        (markdown: string, fileName: string | null = "bees-3f2a1b2c.md") =>
        () =>
            Promise.resolve({ markdown, fileName });

    it("offers the server's file name, writes the export where the user chose, and says where", async () => {
        const target = join(exportDir(), "bees.md");
        const choosePath = vi.fn().mockResolvedValue(target);

        await exportChatFile(choosePath, exported("# Bees\n"), "3f2a1b2c-9d8e");

        expect(choosePath).toHaveBeenCalledWith("bees-3f2a1b2c.md");
        expect(readFileSync(target, "utf8")).toBe("# Bees\n");
        expect(Notice.instances.map((n) => n.message)).toEqual([MESSAGES.NOTICE_CHAT_EXPORTED(target)]);
    });

    it.each([
        ["3f2a1b2c-9d8e", "chat-3f2a1b2c-9d8e.md"],
        [null, "chat.md"],
    ])("offers chat plus the id %j when the server names no file", async (sessionId, name) => {
        const choosePath = vi.fn().mockResolvedValue(null);

        await exportChatFile(choosePath, exported("# Bees", null), sessionId);

        expect(choosePath).toHaveBeenCalledWith(name);
    });

    it("writes nothing and says nothing when the user cancels the dialog", async () => {
        const choosePath = vi.fn().mockResolvedValue(null);

        await exportChatFile(choosePath, exported("# Bees"), null);

        expect(choosePath).toHaveBeenCalledTimes(1);
        expect(Notice.instances).toEqual([]);
    });

    it("asks for no path when there is no export", async () => {
        const choosePath = vi.fn();

        await exportChatFile(choosePath, () => Promise.resolve(null), null);

        expect(choosePath).not.toHaveBeenCalled();
        expect(Notice.instances).toEqual([]);
    });

    it("reports a failed write with its reason", async () => {
        const target = join(exportDir(), "missing", "bees.md");

        await exportChatFile(vi.fn().mockResolvedValue(target), exported("# Bees"), null);

        const [message] = Notice.instances.map((n) => n.message);
        expect(message).toMatch(/^Could not export chat: ENOENT/);
        expect(Notice.instances).toHaveLength(1);
    });

    it("reports a dialog that fails to open with its reason", async () => {
        await exportChatFile(vi.fn().mockRejectedValue(new Error("no dialog")), exported("# Bees"), null);

        expect(Notice.instances.map((n) => n.message)).toEqual([MESSAGES.ERROR_CHAT_EXPORT_FAILED("no dialog")]);
    });
});
