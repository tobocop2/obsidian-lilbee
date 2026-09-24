import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { App, Notice } from "obsidian";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { MockElement } from "../__mocks__/obsidian";
import { EXPORT_ICON } from "../../src/utils/session";
import { SessionsModal, type SessionsModalHooks } from "../../src/views/sessions-modal";
import type { SessionMeta } from "../../src/types";
import { MESSAGES } from "../../src/locales/en";

let mockConfirmResult = true;
vi.mock("../../src/views/confirm-modal", () => ({
    ConfirmModal: vi.fn().mockImplementation(function () {
        return {
            open: vi.fn(),
            get result() {
                return Promise.resolve(mockConfirmResult);
            },
            close: vi.fn(),
        };
    }),
}));

function makeSession(overrides: Partial<SessionMeta> = {}): SessionMeta {
    return {
        id: "s1",
        title: "What is a bee?",
        created_at: "2026-07-16T00:00:00Z",
        updated_at: "2026-07-16T01:00:00Z",
        model_ref: "llama3",
        scope: "both",
        message_count: 4,
        origin: "http",
        ...overrides,
    };
}

function makePlugin(sessions: SessionMeta[] = []) {
    return {
        api: {
            listSessions: vi.fn().mockResolvedValue(sessions),
            renameSession: vi.fn().mockResolvedValue({ id: "s1", title: "Renamed" }),
            deleteSession: vi.fn().mockResolvedValue({ id: "s1", deleted: true }),
            updateConfig: vi.fn().mockResolvedValue({}),
            getSessionMarkdown: vi.fn().mockResolvedValue("# exported"),
        },
        settings: { serverMode: "managed" },
        serverSupportsSessionFork: vi.fn().mockReturnValue(true),
        serverSupportsSessionExport: vi.fn().mockReturnValue(true),
        chooseChatExportPath: vi.fn().mockResolvedValue(null as string | null),
    };
}

function makeHooks(overrides: Partial<SessionsModalHooks> = {}): SessionsModalHooks {
    return {
        activeId: null,
        resume: vi.fn(),
        startNew: vi.fn(),
        fork: vi.fn(),
        saveActive: vi.fn(),
        exportActive: vi.fn(),
        renamed: vi.fn(),
        ...overrides,
    };
}

function collectTexts(el: MockElement): string[] {
    const texts: string[] = [];
    if (el.textContent) texts.push(el.textContent);
    for (const child of el.children) texts.push(...collectTexts(child));
    return texts;
}

async function openModal(plugin: ReturnType<typeof makePlugin>, hooks: SessionsModalHooks) {
    const app = new App();
    const modal = new SessionsModal(app as any, plugin as any, hooks);
    modal.open();
    await vi.runAllTimersAsync();
    return { modal, el: modal.contentEl as unknown as MockElement };
}

describe("SessionsModal", () => {
    beforeEach(() => {
        Notice.clear();
        mockConfirmResult = true;
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("lists saved sessions with their title, meta line and count", async () => {
        const plugin = makePlugin([makeSession()]);
        const { el } = await openModal(plugin, makeHooks());

        const texts = collectTexts(el);
        expect(texts).toContain(MESSAGES.TITLE_SESSIONS);
        expect(texts).toContain("What is a bee?");
        expect(texts.some((t) => t.includes("4 msgs"))).toBe(true);
        expect(texts).toContain(MESSAGES.SESSIONS_COUNT(1));
    });

    it("shows the empty state when nothing is saved", async () => {
        const { el } = await openModal(makePlugin([]), makeHooks());

        expect(collectTexts(el)).toContain(MESSAGES.SESSIONS_EMPTY);
    });

    it("marks the conversation the chat view currently has open", async () => {
        const plugin = makePlugin([makeSession({ id: "s1" }), makeSession({ id: "s2", title: "Other" })]);
        const { el } = await openModal(plugin, makeHooks({ activeId: "s2" }));

        const rows = el.findAll("lilbee-session-row");
        expect(rows[0].classList.contains("is-active")).toBe(false);
        expect(rows[1].classList.contains("is-active")).toBe(true);
    });

    it("shows the relative time with the absolute timestamp as a hover title", async () => {
        const plugin = makePlugin([makeSession({ updated_at: "2026-07-16T01:00:00Z" })]);
        const { el } = await openModal(plugin, makeHooks());

        const date = el.find("lilbee-session-date") as MockElement;
        expect(date.getAttribute("title")).toBe("2026-07-16T01:00:00Z");
    });

    it("omits the hover title when a session has no timestamp", async () => {
        const plugin = makePlugin([makeSession({ updated_at: "" })]);
        const { el } = await openModal(plugin, makeHooks());

        const date = el.find("lilbee-session-date") as MockElement;
        expect(date.getAttribute("title")).toBeNull();
    });

    it("focuses the filter input on open", async () => {
        const plugin = makePlugin([makeSession()]);
        const app = new App();
        const modal = new SessionsModal(app as any, plugin as any, makeHooks());
        const focus = vi.spyOn(MockElement.prototype, "focus");
        modal.open();
        await vi.runAllTimersAsync();

        expect(focus).toHaveBeenCalled();
        focus.mockRestore();
    });

    it("filters on a case-insensitive substring of the title", async () => {
        const plugin = makePlugin([makeSession({ title: "Bees" }), makeSession({ id: "s2", title: "Wasps" })]);
        const { el } = await openModal(plugin, makeHooks());

        const filter = el.find("lilbee-sessions-filter") as MockElement;
        (filter as any).value = "BEE";
        filter.trigger("input");

        const texts = collectTexts(el);
        expect(texts).toContain("Bees");
        expect(texts).not.toContain("Wasps");
        expect(texts).toContain(MESSAGES.SESSIONS_COUNT(1));
    });

    it("distinguishes a filter with no matches from having no sessions at all", async () => {
        const plugin = makePlugin([makeSession({ title: "Bees" })]);
        const { el } = await openModal(plugin, makeHooks());

        const filter = el.find("lilbee-sessions-filter") as MockElement;
        (filter as any).value = "zzz";
        filter.trigger("input");

        const texts = collectTexts(el);
        expect(texts).toContain(MESSAGES.SESSIONS_NO_MATCH);
        expect(texts).not.toContain(MESSAGES.SESSIONS_EMPTY);
    });

    it("forks the row's session through the hook and closes", async () => {
        const fork = vi.fn();
        const resume = vi.fn();
        const plugin = makePlugin([makeSession({ id: "s7" })]);
        const { modal, el } = await openModal(plugin, makeHooks({ fork, resume }));
        const closeSpy = vi.spyOn(modal, "close");
        const forkBtn = el.find("lilbee-session-fork")!;

        forkBtn.trigger("click");

        expect(forkBtn.getAttribute("aria-label")).toBe(MESSAGES.LABEL_FORK_SESSION);
        expect(forkBtn.getAttribute("data-icon")).toBe("git-fork");
        expect(fork).toHaveBeenCalledWith("s7");
        expect(resume).not.toHaveBeenCalled();
        expect(closeSpy).toHaveBeenCalled();
    });

    it("offers no fork action on a server without the fork route", async () => {
        const plugin = makePlugin([makeSession()]);
        plugin.serverSupportsSessionFork.mockReturnValue(false);
        const { el } = await openModal(plugin, makeHooks());

        expect(el.find("lilbee-session-fork")).toBeNull();
        expect(el.find("lilbee-session-delete")).not.toBeNull();
    });

    it("saves the row's session to the vault from the server's export and stays open", async () => {
        const plugin = makePlugin([makeSession({ id: "s7" })]);
        const { modal, el } = await openModal(plugin, makeHooks());
        const closeSpy = vi.spyOn(modal, "close");
        const create = (modal.app as any).vault.create as ReturnType<typeof vi.fn>;
        const saveBtn = el.find("lilbee-session-save")!;

        saveBtn.trigger("click");
        await vi.runAllTimersAsync();

        expect(saveBtn.getAttribute("aria-label")).toBe(MESSAGES.LABEL_SAVE_VAULT);
        expect(saveBtn.getAttribute("data-icon")).toBe("save");
        expect(plugin.api.getSessionMarkdown).toHaveBeenCalledWith("s7");
        expect(create).toHaveBeenCalledWith(expect.stringMatching(/^lilbee\/chat-.*\.md$/), "# exported");
        expect(Notice.instances.some((n) => n.message.startsWith("Saved to lilbee/"))).toBe(true);
        expect(closeSpy).not.toHaveBeenCalled();
    });

    it("hands the open chat's save to the chat view instead of exporting it", async () => {
        const saveActive = vi.fn();
        const plugin = makePlugin([makeSession({ id: "s7" }), makeSession({ id: "s8" })]);
        const { el } = await openModal(plugin, makeHooks({ activeId: "s7", saveActive }));
        const [openRow, otherRow] = el.findAll("lilbee-session-save");

        openRow.trigger("click");
        await vi.runAllTimersAsync();
        expect(saveActive).toHaveBeenCalledTimes(1);
        expect(plugin.api.getSessionMarkdown).not.toHaveBeenCalled();

        otherRow.trigger("click");
        await vi.runAllTimersAsync();
        expect(saveActive).toHaveBeenCalledTimes(1);
        expect(plugin.api.getSessionMarkdown).toHaveBeenCalledWith("s8");
    });

    it("says the server has no such conversation when the export answers 404", async () => {
        const plugin = makePlugin([makeSession()]);
        plugin.api.getSessionMarkdown.mockRejectedValue(new Error('Server responded 404: {"detail":"no"}'));
        const { modal, el } = await openModal(plugin, makeHooks());

        el.find("lilbee-session-save")!.trigger("click");
        await vi.runAllTimersAsync();

        expect(Notice.instances.map((n) => n.message)).toEqual([MESSAGES.ERROR_SESSION_EXPORT_NOT_FOUND]);
        expect((modal.app as any).vault.create).not.toHaveBeenCalled();
    });

    it("reports any other export failure with its reason", async () => {
        const plugin = makePlugin([makeSession()]);
        plugin.api.getSessionMarkdown.mockRejectedValue(new Error("disk on fire"));
        const { modal, el } = await openModal(plugin, makeHooks());

        el.find("lilbee-session-save")!.trigger("click");
        await vi.runAllTimersAsync();

        expect(Notice.instances.map((n) => n.message)).toEqual([MESSAGES.ERROR_SESSION_EXPORT_FAILED("disk on fire")]);
        expect((modal.app as any).vault.create).not.toHaveBeenCalled();
    });

    it("offers no save action on a server without the export route", async () => {
        const plugin = makePlugin([makeSession()]);
        plugin.serverSupportsSessionExport.mockReturnValue(false);
        const { el } = await openModal(plugin, makeHooks());

        expect(el.find("lilbee-session-save")).toBeNull();
        expect(el.find("lilbee-session-export")).toBeNull();
        expect(el.find("lilbee-session-delete")).not.toBeNull();
    });

    describe("export to a file", () => {
        const exportDirs: string[] = [];

        afterEach(() => {
            for (const dir of exportDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
        });

        function exportTarget(): string {
            const dir = mkdtempSync(join(tmpdir(), "lilbee-session-export-"));
            exportDirs.push(dir);
            return join(dir, "chat.md");
        }

        it("writes the row's session from the server's export to the chosen file and stays open", async () => {
            const plugin = makePlugin([makeSession({ id: "3f2a1b2c-9d8e", title: "What is a bee?" })]);
            const target = exportTarget();
            plugin.chooseChatExportPath.mockResolvedValue(target);
            const { modal, el } = await openModal(plugin, makeHooks());
            const closeSpy = vi.spyOn(modal, "close");
            const exportBtn = el.find("lilbee-session-export")!;

            exportBtn.trigger("click");
            await vi.runAllTimersAsync();

            expect(exportBtn.getAttribute("aria-label")).toBe(MESSAGES.LABEL_EXPORT_CHAT);
            expect(exportBtn.getAttribute("data-icon")).toBe(EXPORT_ICON);
            expect(plugin.chooseChatExportPath).toHaveBeenCalledWith("what-is-a-bee-3f2a1b2c.md");
            expect(readFileSync(target, "utf8")).toBe("# exported");
            expect(Notice.instances.map((n) => n.message)).toEqual([MESSAGES.NOTICE_CHAT_EXPORTED(target)]);
            expect(closeSpy).not.toHaveBeenCalled();
        });

        it("asks the server for nothing when the dialog is cancelled", async () => {
            const plugin = makePlugin([makeSession()]);
            const { el } = await openModal(plugin, makeHooks());

            el.find("lilbee-session-export")!.trigger("click");
            await vi.runAllTimersAsync();

            expect(plugin.api.getSessionMarkdown).not.toHaveBeenCalled();
            expect(Notice.instances).toEqual([]);
        });

        it("hands the open chat's export to the chat view", async () => {
            const exportActive = vi.fn();
            const plugin = makePlugin([makeSession({ id: "s7" })]);
            const { el } = await openModal(plugin, makeHooks({ activeId: "s7", exportActive }));

            el.find("lilbee-session-export")!.trigger("click");
            await vi.runAllTimersAsync();

            expect(exportActive).toHaveBeenCalledTimes(1);
            expect(plugin.chooseChatExportPath).not.toHaveBeenCalled();
        });

        it("says the server has no such conversation when the export answers 404", async () => {
            const plugin = makePlugin([makeSession()]);
            plugin.api.getSessionMarkdown.mockRejectedValue(new Error('Server responded 404: {"detail":"no"}'));
            const target = exportTarget();
            plugin.chooseChatExportPath.mockResolvedValue(target);
            const { el } = await openModal(plugin, makeHooks());

            el.find("lilbee-session-export")!.trigger("click");
            await vi.runAllTimersAsync();

            expect(Notice.instances.map((n) => n.message)).toEqual([MESSAGES.ERROR_SESSION_EXPORT_NOT_FOUND]);
            expect(() => readFileSync(target)).toThrow();
        });
    });

    it("resumes the clicked session and closes", async () => {
        const resume = vi.fn();
        const plugin = makePlugin([makeSession({ id: "s7" })]);
        const { modal, el } = await openModal(plugin, makeHooks({ resume }));
        const closeSpy = vi.spyOn(modal, "close");

        el.find("lilbee-session-main")!.trigger("click");

        expect(resume).toHaveBeenCalledWith("s7");
        expect(closeSpy).toHaveBeenCalled();
    });

    it("starts a new chat and closes", async () => {
        const startNew = vi.fn();
        const { modal, el } = await openModal(makePlugin([makeSession()]), makeHooks({ startNew }));
        const closeSpy = vi.spyOn(modal, "close");

        el.find("lilbee-sessions-new")!.trigger("click");

        expect(startNew).toHaveBeenCalled();
        expect(closeSpy).toHaveBeenCalled();
    });

    it("surfaces a load failure as a notice and renders no rows", async () => {
        const plugin = makePlugin();
        plugin.api.listSessions = vi.fn().mockRejectedValue(new Error("boom"));
        const { el } = await openModal(plugin, makeHooks());

        expect(Notice.instances.some((n) => n.message.includes("Could not load conversations"))).toBe(true);
        expect(el.findAll("lilbee-session-row")).toHaveLength(0);
        expect(collectTexts(el)).not.toContain(MESSAGES.SESSIONS_EMPTY);
    });

    describe("sessions turned off on the server", () => {
        const disabledError = new Error('Server responded 404: {"detail":"Sessions are off."}');

        it("offers to turn sessions on instead of an error when the list route 404s", async () => {
            const plugin = makePlugin();
            plugin.api.listSessions = vi.fn().mockRejectedValue(disabledError);
            const { el } = await openModal(plugin, makeHooks());

            expect(collectTexts(el)).toContain(MESSAGES.SESSIONS_DISABLED);
            expect(el.find("lilbee-sessions-enable")).not.toBeNull();
            expect(el.findAll("lilbee-session-row")).toHaveLength(0);
            expect(Notice.instances).toHaveLength(0);
        });

        it("turning sessions on writes the config flag and loads the list", async () => {
            const plugin = makePlugin();
            plugin.api.listSessions = vi.fn().mockRejectedValueOnce(disabledError).mockResolvedValue([makeSession()]);
            const { el } = await openModal(plugin, makeHooks());

            el.find("lilbee-sessions-enable")!.trigger("click");
            await vi.runAllTimersAsync();

            expect(plugin.api.updateConfig).toHaveBeenCalledWith({ sessions_enabled: true });
            expect(el.find("lilbee-sessions-enable")).toBeNull();
            expect(el.findAll("lilbee-session-row")).toHaveLength(1);
        });

        it("keeps the turn-on offer and notices when the config write fails", async () => {
            const plugin = makePlugin();
            plugin.api.listSessions = vi.fn().mockRejectedValue(disabledError);
            plugin.api.updateConfig = vi.fn().mockRejectedValue(new Error("boom"));
            const { el } = await openModal(plugin, makeHooks());

            el.find("lilbee-sessions-enable")!.trigger("click");
            await vi.runAllTimersAsync();

            expect(Notice.instances.some((n) => n.message.includes("Could not turn on saved conversations"))).toBe(
                true,
            );
            expect(el.find("lilbee-sessions-enable")).not.toBeNull();
        });
    });

    describe("rename", () => {
        async function startRename(plugin: ReturnType<typeof makePlugin>, hooks = makeHooks()) {
            const opened = await openModal(plugin, hooks);
            opened.el.find("lilbee-session-rename")!.trigger("click");
            return opened;
        }

        it("commits a new title on enter and tells the chat view", async () => {
            const plugin = makePlugin([makeSession()]);
            const hooks = makeHooks();
            const { el } = await startRename(plugin, hooks);

            const input = el.find("lilbee-session-rename-input") as MockElement;
            expect((input as any).value).toBe("What is a bee?");
            (input as any).value = "Renamed";
            input.trigger("keydown", { key: "Enter" });
            await vi.runAllTimersAsync();

            expect(plugin.api.renameSession).toHaveBeenCalledWith("s1", "Renamed");
            expect(collectTexts(el)).toContain("Renamed");
            expect(hooks.renamed).toHaveBeenCalledExactlyOnceWith("s1", "Renamed");
        });

        it("discards an empty title without writing", async () => {
            const plugin = makePlugin([makeSession()]);
            const { el } = await startRename(plugin);

            const input = el.find("lilbee-session-rename-input") as MockElement;
            (input as any).value = "   ";
            input.trigger("keydown", { key: "Enter" });
            await vi.runAllTimersAsync();

            expect(plugin.api.renameSession).not.toHaveBeenCalled();
            expect(collectTexts(el)).toContain("What is a bee?");
        });

        it("skips the write when the title is unchanged", async () => {
            const plugin = makePlugin([makeSession()]);
            const { el } = await startRename(plugin);

            const input = el.find("lilbee-session-rename-input") as MockElement;
            input.trigger("keydown", { key: "Enter" });
            await vi.runAllTimersAsync();

            expect(plugin.api.renameSession).not.toHaveBeenCalled();
        });

        it("escape cancels the rename and keeps the modal open", async () => {
            const plugin = makePlugin([makeSession()]);
            const { modal, el } = await startRename(plugin);
            const closeSpy = vi.spyOn(modal, "close");

            const input = el.find("lilbee-session-rename-input") as MockElement;
            input.trigger("keydown", { key: "Escape", stopPropagation: vi.fn() });
            await vi.runAllTimersAsync();

            expect(plugin.api.renameSession).not.toHaveBeenCalled();
            expect(el.find("lilbee-session-rename-input")).toBeNull();
            expect(closeSpy).not.toHaveBeenCalled();
        });

        it("ignores other keys while renaming", async () => {
            const plugin = makePlugin([makeSession()]);
            const { el } = await startRename(plugin);

            const input = el.find("lilbee-session-rename-input") as MockElement;
            input.trigger("keydown", { key: "a" });
            await vi.runAllTimersAsync();

            expect(plugin.api.renameSession).not.toHaveBeenCalled();
            expect(el.find("lilbee-session-rename-input")).not.toBeNull();
        });

        it("keeps the old title and warns when the rename fails", async () => {
            const plugin = makePlugin([makeSession()]);
            plugin.api.renameSession = vi.fn().mockRejectedValue(new Error("nope"));
            const hooks = makeHooks();
            const { el } = await startRename(plugin, hooks);

            const input = el.find("lilbee-session-rename-input") as MockElement;
            (input as any).value = "Renamed";
            input.trigger("keydown", { key: "Enter" });
            await vi.runAllTimersAsync();

            expect(Notice.instances.some((n) => n.message.includes("Could not rename"))).toBe(true);
            expect(collectTexts(el)).toContain("What is a bee?");
            expect(hooks.renamed).not.toHaveBeenCalled();
        });
    });

    describe("delete", () => {
        it("removes the row and notices after confirmation", async () => {
            mockConfirmResult = true;
            const plugin = makePlugin([makeSession()]);
            const { el } = await openModal(plugin, makeHooks());

            el.find("lilbee-session-delete")!.trigger("click");
            await vi.runAllTimersAsync();

            expect(plugin.api.deleteSession).toHaveBeenCalledWith("s1");
            expect(Notice.instances.some((n) => n.message === MESSAGES.NOTICE_SESSION_DELETED("What is a bee?"))).toBe(
                true,
            );
            expect(collectTexts(el)).toContain(MESSAGES.SESSIONS_EMPTY);
        });

        it("does nothing when the confirmation is declined", async () => {
            mockConfirmResult = false;
            const plugin = makePlugin([makeSession()]);
            const { el } = await openModal(plugin, makeHooks());

            el.find("lilbee-session-delete")!.trigger("click");
            await vi.runAllTimersAsync();

            expect(plugin.api.deleteSession).not.toHaveBeenCalled();
            expect(collectTexts(el)).toContain("What is a bee?");
        });

        it("keeps the row and warns when the delete fails", async () => {
            mockConfirmResult = true;
            const plugin = makePlugin([makeSession()]);
            plugin.api.deleteSession = vi.fn().mockRejectedValue(new Error("nope"));
            const { el } = await openModal(plugin, makeHooks());

            el.find("lilbee-session-delete")!.trigger("click");
            await vi.runAllTimersAsync();

            expect(Notice.instances.some((n) => n.message.includes("Could not delete"))).toBe(true);
            expect(collectTexts(el)).toContain("What is a bee?");
        });
    });
});

describe("SessionsModal — guards", () => {
    it("renderList no-ops before the list container exists", () => {
        const modal = new SessionsModal(new App() as any, makePlugin() as any, makeHooks());

        expect(() => (modal as any).renderList()).not.toThrow();
    });
});
