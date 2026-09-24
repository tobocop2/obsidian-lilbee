import { describe, expect, it, vi, beforeEach } from "vitest";
import { Notice, type Vault } from "obsidian";
import { mkdtempSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
    chatExportName,
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

describe("chatExportName", () => {
    const ID = "3f2a1b2c-9d8e-4f00-a1b2-c3d4e5f6a7b8";

    it("joins the title's slug and the session id's first eight characters", () => {
        expect(chatExportName("Brake specs!", ID)).toBe("brake-specs-3f2a1b2c.md");
    });

    it("folds whitespace runs to one hyphen and encodes a slash as two", () => {
        expect(chatExportName("  Torque \t specs / 2026  ", ID)).toBe("torque-specs----2026-3f2a1b2c.md");
    });

    it.each(["", "!!!", "\u{1F41D}"])("falls back to chat when the title %j has nothing to slug", (title) => {
        expect(chatExportName(title, ID)).toBe("chat-3f2a1b2c.md");
    });

    it("caps the slug at sixty characters and drops a hyphen the cap leaves at the end", () => {
        const name = chatExportName("a".repeat(59) + " bcdef".repeat(100), ID);
        expect(name).toBe("a".repeat(59) + "-3f2a1b2c.md");
    });

    it("names an unsaved chat from its title alone", () => {
        expect(chatExportName("Brake specs", null)).toBe("brake-specs.md");
    });
});

describe("exportChatFile", () => {
    beforeEach(() => {
        Notice.clear();
    });

    it("writes the content where the user chose and says where", async () => {
        const target = join(mkdtempSync(join(tmpdir(), "lilbee-export-")), "bees.md");
        const choosePath = vi.fn().mockResolvedValue(target);

        await exportChatFile(choosePath, "bees-3f2a1b2c.md", () => Promise.resolve("# Bees\n"));

        expect(choosePath).toHaveBeenCalledWith("bees-3f2a1b2c.md");
        expect(readFileSync(target, "utf8")).toBe("# Bees\n");
        expect(Notice.instances.map((n) => n.message)).toEqual([MESSAGES.NOTICE_CHAT_EXPORTED(target)]);
    });

    it("does nothing and says nothing when the user cancels the dialog", async () => {
        const content = vi.fn();

        await exportChatFile(vi.fn().mockResolvedValue(null), "bees.md", content);

        expect(content).not.toHaveBeenCalled();
        expect(Notice.instances).toEqual([]);
    });

    it("writes nothing when there is no content to export", async () => {
        const target = join(mkdtempSync(join(tmpdir(), "lilbee-export-")), "bees.md");

        await exportChatFile(vi.fn().mockResolvedValue(target), "bees.md", () => Promise.resolve(null));

        expect(() => readFileSync(target)).toThrow();
        expect(Notice.instances).toEqual([]);
    });

    it("reports a failed write with its reason", async () => {
        const target = join(mkdtempSync(join(tmpdir(), "lilbee-export-")), "missing", "bees.md");

        await exportChatFile(vi.fn().mockResolvedValue(target), "bees.md", () => Promise.resolve("# Bees"));

        const [message] = Notice.instances.map((n) => n.message);
        expect(message).toMatch(/^Could not export chat: ENOENT/);
        expect(Notice.instances).toHaveLength(1);
    });

    it("reports a dialog that fails to open with its reason", async () => {
        const content = vi.fn();

        await exportChatFile(vi.fn().mockRejectedValue(new Error("no dialog")), "bees.md", content);

        expect(content).not.toHaveBeenCalled();
        expect(Notice.instances.map((n) => n.message)).toEqual([MESSAGES.ERROR_CHAT_EXPORT_FAILED("no dialog")]);
    });
});
