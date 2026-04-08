import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { Notice } from "obsidian";
import { App, WorkspaceLeaf } from "./__mocks__/obsidian";
import { SSE_EVENT } from "../src/types";
import { MESSAGES } from "../src/locales/en";
vi.mock("../src/api", () => ({
    LilbeeClient: vi.fn().mockImplementation(() => ({
        status: vi.fn(),
        syncStream: vi.fn(),
        search: vi.fn(),
        ask: vi.fn(),
        chatStream: vi.fn(),
        listModels: vi.fn().mockRejectedValue(new Error("offline")),
        pullModel: vi.fn(),
        setChatModel: vi.fn(),
        setVisionModel: vi.fn(),
        health: vi.fn(),
        addFiles: vi.fn(),
        wikiLint: vi.fn(),
        wikiGenerate: vi.fn(),
        wikiPrune: vi.fn(),
    })),
}));

// We also need to mock the views to avoid loading heavy deps
vi.mock("../src/views/chat-view", () => ({
    VIEW_TYPE_CHAT: "lilbee-chat",
    ChatView: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("../src/views/search-modal", () => ({
    SearchModal: vi.fn().mockImplementation(() => ({ open: vi.fn() })),
}));

vi.mock("../src/views/catalog-modal", () => ({
    CatalogModal: vi.fn().mockImplementation(() => ({ open: vi.fn() })),
}));

vi.mock("../src/views/crawl-modal", () => ({
    CrawlModal: vi.fn().mockImplementation(() => ({ open: vi.fn() })),
}));

vi.mock("../src/views/documents-modal", () => ({
    DocumentsModal: vi.fn().mockImplementation(() => ({ open: vi.fn() })),
}));

vi.mock("../src/views/status-modal", () => ({
    StatusModal: vi.fn().mockImplementation(() => ({ open: vi.fn() })),
}));

vi.mock("../src/views/setup-wizard", () => ({
    SetupWizard: vi.fn().mockImplementation(() => ({ open: vi.fn(), close: vi.fn() })),
}));

vi.mock("../src/views/wiki-view", () => ({
    VIEW_TYPE_WIKI: "lilbee-wiki",
    WikiView: vi.fn().mockImplementation(() => ({ refresh: vi.fn() })),
}));

const mockLintModalOpen = vi.fn();
vi.mock("../src/views/lint-modal", () => ({
    LintModal: vi.fn().mockImplementation(() => ({ open: mockLintModalOpen })),
}));

let mockConfirmModalResult = true;
vi.mock("../src/views/confirm-modal", () => ({
    ConfirmModal: vi.fn().mockImplementation(() => ({
        open: vi.fn(),
        get result() {
            return Promise.resolve(mockConfirmModalResult);
        },
    })),
}));

const mockEnsureBinary = vi.fn().mockResolvedValue("/fake/bin/lilbee");
const mockBinaryExists = vi.fn().mockReturnValue(true);
const mockDownload = vi.fn().mockResolvedValue(undefined);
const mockServerStart = vi.fn().mockResolvedValue(undefined);
const mockServerStop = vi.fn().mockResolvedValue(undefined);
const mockUpdatePort = vi.fn();
let mockServerOpts: any = null;

vi.mock("../src/binary-manager", () => ({
    BinaryManager: vi.fn().mockImplementation(() => ({
        ensureBinary: mockEnsureBinary,
        binaryPath: "/fake/bin/lilbee",
        binaryExists: mockBinaryExists,
        download: mockDownload,
    })),
    getLatestRelease: vi.fn(),
    checkForUpdate: vi.fn(),
    node: {
        spawn: vi.fn(),
        execFile: vi.fn(),
        existsSync: vi.fn(),
        mkdirSync: vi.fn(),
        chmodSync: vi.fn(),
        writeFileSync: vi.fn(),
        requestUrl: vi.fn(),
    },
}));

let mockLastStderr = "";
vi.mock("../src/server-manager", () => ({
    ServerManager: vi.fn().mockImplementation((opts: any) => {
        mockServerOpts = opts;
        return {
            start: mockServerStart,
            stop: mockServerStop,
            restart: vi.fn(),
            updatePort: mockUpdatePort,
            get serverUrl() {
                return `http://127.0.0.1:${opts.port}`;
            },
            get state() {
                return "ready";
            },
            get lastStderr() {
                return mockLastStderr;
            },
            opts,
        };
    }),
}));

/** Flush the microtask queue so fire-and-forget promises settle. */
const flush = () => new Promise((r) => setTimeout(r, 0));

async function createPlugin(overrideData?: Record<string, unknown>) {
    const { default: LilbeePlugin } = await import("../src/main");
    const app = new App();
    const plugin = new LilbeePlugin(
        app as any,
        {
            id: "lilbee",
            name: "lilbee",
            version: "0.1.0",
            minAppVersion: "1.0.0",
            author: "test",
            description: "test",
        } as any,
    );
    // Default to external mode so tests don't attempt to download/spawn a binary
    if (overrideData) {
        plugin.loadData = vi.fn().mockResolvedValue(overrideData);
    } else {
        plugin.loadData = vi.fn().mockResolvedValue({ serverMode: "external" });
    }
    return plugin;
}

describe("LilbeePlugin", () => {
    beforeEach(() => {
        Notice.clear();
        vi.clearAllMocks();
        mockLastStderr = "";
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe("onload()", () => {
        it("loads settings, creates API client, sets up status bar", async () => {
            const plugin = await createPlugin();
            await plugin.onload();

            expect(plugin.addStatusBarItem).toHaveBeenCalled();
            expect(plugin.addSettingTab).toHaveBeenCalled();
            expect(plugin.registerView).toHaveBeenCalled();
        });

        it("adds all fifteen commands", async () => {
            const plugin = await createPlugin();
            await plugin.onload();

            expect(plugin.addCommand).toHaveBeenCalledTimes(15);
            const ids = (plugin.addCommand as ReturnType<typeof vi.fn>).mock.calls.map((c: any[]) => c[0].id);
            expect(ids).toContain("lilbee:search");
            expect(ids).toContain("lilbee:ask");
            expect(ids).toContain("lilbee:chat");
            expect(ids).toContain("lilbee:add-file");
            expect(ids).toContain("lilbee:add-folder");
            expect(ids).toContain("lilbee:sync");
            expect(ids).toContain("lilbee:catalog");
            expect(ids).toContain("lilbee:crawl");
            expect(ids).toContain("lilbee:documents");
            expect(ids).toContain("lilbee:setup");
            expect(ids).toContain("lilbee:status");
            expect(ids).toContain("lilbee:tasks");
            expect(ids).toContain("lilbee:wiki");
            expect(ids).toContain("lilbee:wiki-lint");
            expect(ids).toContain("lilbee:wiki-generate");
        });

        it("add-file command returns false when no active file", async () => {
            const plugin = await createPlugin();
            await plugin.onload();
            const cmd = (plugin.addCommand as ReturnType<typeof vi.fn>).mock.calls.find(
                (c: any[]) => c[0].id === "lilbee:add-file",
            )![0];
            expect(cmd.checkCallback(true)).toBe(false);
        });

        it("add-file command returns true when active file exists", async () => {
            const plugin = await createPlugin();
            plugin.app.workspace.getActiveFile = vi.fn().mockReturnValue({ path: "test.md", name: "test.md" });
            await plugin.onload();
            const cmd = (plugin.addCommand as ReturnType<typeof vi.fn>).mock.calls.find(
                (c: any[]) => c[0].id === "lilbee:add-file",
            )![0];
            expect(cmd.checkCallback(true)).toBe(true);
        });

        it("add-file command calls addToLilbee when not checking", async () => {
            const plugin = await createPlugin();
            const file = { path: "test.md", name: "test.md" };
            plugin.app.workspace.getActiveFile = vi.fn().mockReturnValue(file);
            await plugin.onload();
            const addSpy = vi.spyOn(plugin as any, "addToLilbee").mockResolvedValue(undefined);
            const cmd = (plugin.addCommand as ReturnType<typeof vi.fn>).mock.calls.find(
                (c: any[]) => c[0].id === "lilbee:add-file",
            )![0];
            cmd.checkCallback(false);
            expect(addSpy).toHaveBeenCalledWith(file);
        });

        it("add-folder command returns false when no active file", async () => {
            const plugin = await createPlugin();
            await plugin.onload();
            const cmd = (plugin.addCommand as ReturnType<typeof vi.fn>).mock.calls.find(
                (c: any[]) => c[0].id === "lilbee:add-folder",
            )![0];
            expect(cmd.checkCallback(true)).toBe(false);
        });

        it("add-folder command returns false when file has no parent", async () => {
            const plugin = await createPlugin();
            plugin.app.workspace.getActiveFile = vi.fn().mockReturnValue({ path: "test.md", parent: null });
            await plugin.onload();
            const cmd = (plugin.addCommand as ReturnType<typeof vi.fn>).mock.calls.find(
                (c: any[]) => c[0].id === "lilbee:add-folder",
            )![0];
            expect(cmd.checkCallback(true)).toBe(false);
        });

        it("add-folder command calls addToLilbee with parent folder when not checking", async () => {
            const plugin = await createPlugin();
            const folder = { path: "notes", name: "notes" };
            const file = { path: "notes/test.md", parent: folder };
            plugin.app.workspace.getActiveFile = vi.fn().mockReturnValue(file);
            await plugin.onload();
            const addSpy = vi.spyOn(plugin as any, "addToLilbee").mockResolvedValue(undefined);
            const cmd = (plugin.addCommand as ReturnType<typeof vi.fn>).mock.calls.find(
                (c: any[]) => c[0].id === "lilbee:add-folder",
            )![0];
            cmd.checkCallback(false);
            expect(addSpy).toHaveBeenCalledWith(folder);
        });

        it("sets status bar text to 'lilbee: ready [external]' in external mode", async () => {
            const plugin = await createPlugin();
            await plugin.onload();
            expect((plugin as any).statusBarEl?.textContent).toBe("lilbee: ready [external]");
        });

        it("with manual sync mode: registers only file-menu event (no vault events)", async () => {
            const plugin = await createPlugin();
            plugin.loadData = vi.fn().mockResolvedValue({ serverMode: "external", syncMode: "manual" });
            await plugin.onload();
            // 1 for file-menu
            expect(plugin.registerEvent).toHaveBeenCalledTimes(1);
        });

        it("with auto sync mode: registers vault events + file-menu", async () => {
            const plugin = await createPlugin();
            plugin.loadData = vi.fn().mockResolvedValue({ serverMode: "external", syncMode: "auto" });
            await plugin.onload();
            // 4 vault events + 1 file-menu = 5
            expect(plugin.registerEvent).toHaveBeenCalledTimes(5);
        });

        it("recreates API client with loaded serverUrl", async () => {
            const { LilbeeClient } = await import("../src/api");
            const plugin = await createPlugin();
            plugin.loadData = vi.fn().mockResolvedValue({ serverMode: "external", serverUrl: "http://custom:9999" });
            await plugin.onload();
            expect(LilbeeClient).toHaveBeenCalledWith("http://custom:9999");
        });

        it("auto-opens setup wizard when setupCompleted is false", async () => {
            const { SetupWizard } = await import("../src/views/setup-wizard");
            const plugin = await createPlugin({ serverMode: "external", setupCompleted: false });
            await plugin.onload();
            expect(SetupWizard).toHaveBeenCalled();
        });

        it("does not auto-open setup wizard when setupCompleted is true", async () => {
            const { SetupWizard } = await import("../src/views/setup-wizard");
            (SetupWizard as ReturnType<typeof vi.fn>).mockClear();
            const plugin = await createPlugin({ serverMode: "external", setupCompleted: true });
            await plugin.onload();
            expect(SetupWizard).not.toHaveBeenCalled();
        });

        it("setup command opens SetupWizard", async () => {
            const plugin = await createPlugin({ serverMode: "external", setupCompleted: true });
            await plugin.onload();
            const cmd = (plugin.addCommand as ReturnType<typeof vi.fn>).mock.calls.find(
                (c: any[]) => c[0].id === "lilbee:setup",
            )![0];
            expect(cmd.name).toBe("Run setup wizard");
            cmd.callback();
            const { SetupWizard } = await import("../src/views/setup-wizard");
            expect(SetupWizard).toHaveBeenCalled();
        });
    });

    describe("onunload()", () => {
        it("clears sync timeout if one is active", async () => {
            vi.useFakeTimers();
            const plugin = await createPlugin();
            await plugin.onload();
            (plugin as any).debouncedSync();
            expect((plugin as any).syncTimeout).not.toBeNull();
            const clearSpy = vi.spyOn(globalThis, "clearTimeout");
            plugin.onunload();
            expect(clearSpy).toHaveBeenCalled();
        });

        it("does not throw when no timeout is active", async () => {
            const plugin = await createPlugin();
            await plugin.onload();
            expect(() => plugin.onunload()).not.toThrow();
        });
    });

    describe("loadSettings()", () => {
        it("merges saved data over defaults", async () => {
            const plugin = await createPlugin();
            plugin.loadData = vi.fn().mockResolvedValue({ serverMode: "external", topK: 15, syncMode: "auto" });
            await plugin.loadSettings();
            expect(plugin.settings.topK).toBe(15);
            expect(plugin.settings.syncMode).toBe("auto");
            expect(plugin.settings.serverUrl).toBe("http://127.0.0.1:7433");
        });

        it("uses defaults when loadData returns null/empty", async () => {
            const plugin = await createPlugin({ serverMode: "external" });
            plugin.loadData = vi.fn().mockResolvedValue(null);
            await plugin.loadSettings();
            expect(plugin.settings.topK).toBe(5);
            expect(plugin.settings.syncMode).toBe("manual");
        });
    });

    describe("saveSettings()", () => {
        it("calls saveData and recreates the API client", async () => {
            const { LilbeeClient } = await import("../src/api");
            const plugin = await createPlugin();
            await plugin.onload();
            const callsBefore = (LilbeeClient as ReturnType<typeof vi.fn>).mock.calls.length;

            plugin.settings.serverUrl = "http://newserver:8080";
            await plugin.saveSettings();

            expect(plugin.saveData).toHaveBeenCalledWith(plugin.settings);
            const callsAfter = (LilbeeClient as ReturnType<typeof vi.fn>).mock.calls.length;
            expect(callsAfter).toBeGreaterThan(callsBefore);
        });

        it("calls updateAutoSync after saving", async () => {
            const plugin = await createPlugin();
            await plugin.onload();

            const updateSpy = vi.spyOn(plugin as any, "updateAutoSync");
            await plugin.saveSettings();

            expect(updateSpy).toHaveBeenCalled();
        });
    });

    describe("updateAutoSync()", () => {
        it("registers vault events when switching from manual to auto", async () => {
            const plugin = await createPlugin();
            plugin.loadData = vi.fn().mockResolvedValue({ serverMode: "external", syncMode: "manual" });
            await plugin.onload();

            expect(plugin.registerEvent).toHaveBeenCalledTimes(1);

            plugin.settings.syncMode = "auto";
            await plugin.saveSettings();

            // 1 file-menu + 4 vault events = 5
            expect(plugin.registerEvent).toHaveBeenCalledTimes(5);
        });

        it("clears autoSyncRefs and calls offref when switching from auto to manual", async () => {
            const plugin = await createPlugin();
            plugin.loadData = vi.fn().mockResolvedValue({ serverMode: "external", syncMode: "auto" });
            await plugin.onload();

            expect((plugin as any).autoSyncRefs.length).toBe(4);

            plugin.settings.syncMode = "manual";
            await plugin.saveSettings();

            expect((plugin as any).autoSyncRefs.length).toBe(0);
            expect(plugin.app.vault.offref).toHaveBeenCalledTimes(4);
        });

        it("does not re-register events when already in auto mode", async () => {
            const plugin = await createPlugin();
            plugin.loadData = vi.fn().mockResolvedValue({ serverMode: "external", syncMode: "auto" });
            await plugin.onload();

            const callsBefore = (plugin.registerEvent as ReturnType<typeof vi.fn>).mock.calls.length;

            await plugin.saveSettings();

            expect((plugin.registerEvent as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBefore);
        });
    });

    describe("settings initialisation", () => {
        it("settings is a separate object from DEFAULT_SETTINGS", async () => {
            const { default: LilbeePlugin } = await import("../src/main");
            const { DEFAULT_SETTINGS } = await import("../src/types");
            const app = new App();
            const plugin = new LilbeePlugin(
                app as any,
                {
                    id: "lilbee",
                    name: "lilbee",
                    version: "0.1.0",
                    minAppVersion: "1.0.0",
                    author: "test",
                    description: "test",
                } as any,
            );

            expect(plugin.settings).not.toBe(DEFAULT_SETTINGS);
        });
    });

    describe("activateChatView()", () => {
        it("reveals existing leaf when chat view is already open", async () => {
            const plugin = await createPlugin();
            await plugin.onload();

            const leaf = new WorkspaceLeaf(plugin.app as any);
            plugin.app.workspace.getLeavesOfType = vi.fn().mockReturnValue([leaf]);

            await (plugin as any).activateChatView();

            expect(plugin.app.workspace.revealLeaf).toHaveBeenCalledWith(leaf);
            expect(plugin.app.workspace.getRightLeaf).not.toHaveBeenCalled();
        });

        it("sets view state on right leaf when no chat view exists", async () => {
            const plugin = await createPlugin();
            await plugin.onload();

            plugin.app.workspace.getLeavesOfType = vi.fn().mockReturnValue([]);
            const leaf = new WorkspaceLeaf(plugin.app as any);
            plugin.app.workspace.getRightLeaf = vi.fn().mockReturnValue(leaf);

            await (plugin as any).activateChatView();

            expect(leaf.setViewState).toHaveBeenCalledWith({ type: "lilbee-chat", active: true });
            expect(plugin.app.workspace.revealLeaf).toHaveBeenCalledWith(leaf);
        });

        it("does not crash when getRightLeaf returns null", async () => {
            const plugin = await createPlugin();
            await plugin.onload();

            plugin.app.workspace.getLeavesOfType = vi.fn().mockReturnValue([]);
            plugin.app.workspace.getRightLeaf = vi.fn().mockReturnValue(null);

            await expect((plugin as any).activateChatView()).resolves.not.toThrow();
        });
    });

    describe("activateTaskView()", () => {
        it("reveals existing leaf when task view is already open", async () => {
            const plugin = await createPlugin();
            await plugin.onload();

            const leaf = new WorkspaceLeaf(plugin.app as any);
            plugin.app.workspace.getLeavesOfType = vi.fn().mockReturnValue([leaf]);

            await (plugin as any).activateTaskView();

            expect(plugin.app.workspace.revealLeaf).toHaveBeenCalledWith(leaf);
            expect(plugin.app.workspace.getRightLeaf).not.toHaveBeenCalled();
        });

        it("sets view state on right leaf when no task view exists", async () => {
            const plugin = await createPlugin();
            await plugin.onload();

            plugin.app.workspace.getLeavesOfType = vi.fn().mockReturnValue([]);
            const leaf = new WorkspaceLeaf(plugin.app as any);
            plugin.app.workspace.getRightLeaf = vi.fn().mockReturnValue(leaf);

            await (plugin as any).activateTaskView();

            expect(leaf.setViewState).toHaveBeenCalledWith({ type: "lilbee-tasks", active: true });
            expect(plugin.app.workspace.revealLeaf).toHaveBeenCalledWith(leaf);
        });

        it("does not crash when getRightLeaf returns null", async () => {
            const plugin = await createPlugin();
            await plugin.onload();

            plugin.app.workspace.getLeavesOfType = vi.fn().mockReturnValue([]);
            plugin.app.workspace.getRightLeaf = vi.fn().mockReturnValue(null);

            await expect((plugin as any).activateTaskView()).resolves.not.toThrow();
        });
    });

    describe("debouncedSync()", () => {
        it("schedules triggerSync after debounce delay", async () => {
            vi.useFakeTimers();
            const plugin = await createPlugin();
            plugin.loadData = vi.fn().mockResolvedValue({ serverMode: "external", syncDebounceMs: 1000 });
            await plugin.onload();

            const triggerSpy = vi.spyOn(plugin, "triggerSync").mockResolvedValue(undefined);
            (plugin as any).debouncedSync();

            expect(triggerSpy).not.toHaveBeenCalled();
            vi.advanceTimersByTime(1000);
            expect(triggerSpy).toHaveBeenCalledTimes(1);
        });

        it("cancels previous timer when called again", async () => {
            vi.useFakeTimers();
            const plugin = await createPlugin();
            plugin.loadData = vi.fn().mockResolvedValue({ serverMode: "external", syncDebounceMs: 500 });
            await plugin.onload();

            const triggerSpy = vi.spyOn(plugin, "triggerSync").mockResolvedValue(undefined);
            (plugin as any).debouncedSync();
            vi.advanceTimersByTime(200);
            (plugin as any).debouncedSync();
            vi.advanceTimersByTime(500);

            expect(triggerSpy).toHaveBeenCalledTimes(1);
        });
    });

    describe("triggerSync()", () => {
        it("updates status bar during sync and resets to ready", async () => {
            const plugin = await createPlugin();
            await plugin.onload();

            async function* noEvents() {}
            plugin.api.syncStream = vi.fn().mockReturnValue(noEvents());

            await plugin.triggerSync();

            expect((plugin as any).statusBarEl?.textContent).toBe("lilbee: ready [external]");
        });

        it("shows Notice with all stats when done event has populated arrays", async () => {
            const plugin = await createPlugin();
            await plugin.onload();

            async function* withDone() {
                yield {
                    event: SSE_EVENT.DONE,
                    data: {
                        added: ["a.md"],
                        updated: ["b.md"],
                        removed: ["c.md"],
                        failed: ["d.md"],
                        unchanged: 0,
                    },
                };
            }
            plugin.api.syncStream = vi.fn().mockReturnValue(withDone());

            await plugin.triggerSync();

            const msg = Notice.instances[0]?.message ?? "";
            expect(msg).toContain("1 added");
            expect(msg).toContain("1 updated");
            expect(msg).toContain("1 removed");
            expect(msg).toContain("1 failed");
        });

        it("does NOT show Notice when done event has all empty arrays", async () => {
            const plugin = await createPlugin();
            await plugin.onload();

            async function* withEmptyDone() {
                yield {
                    event: SSE_EVENT.DONE,
                    data: { added: [], updated: [], removed: [], failed: [], unchanged: 10 },
                };
            }
            plugin.api.syncStream = vi.fn().mockReturnValue(withEmptyDone());

            await plugin.triggerSync();

            expect(Notice.instances.length).toBe(0);
        });

        it("does NOT show Notice when last event is not 'done'", async () => {
            const plugin = await createPlugin();
            await plugin.onload();

            async function* withProgress() {
                yield { event: SSE_EVENT.PROGRESS, data: { file: "x.md", current: 1, total: 1 } };
            }
            plugin.api.syncStream = vi.fn().mockReturnValue(withProgress());

            await plugin.triggerSync();

            expect(Notice.instances.length).toBe(0);
        });

        it("shows error Notice on API error", async () => {
            const plugin = await createPlugin();
            await plugin.onload();

            plugin.api.syncStream = vi.fn().mockImplementation(() => {
                throw new Error("connection refused");
            });

            await plugin.triggerSync();

            expect(Notice.instances.some((n) => n.message.includes("sync failed"))).toBe(true);
        });

        it("returns early when statusBarEl is null", async () => {
            const plugin = await createPlugin();
            await plugin.onload();
            (plugin as any).statusBarEl = null;

            const syncStreamSpy = vi.spyOn(plugin.api, "syncStream");
            await plugin.triggerSync();

            expect(syncStreamSpy).not.toHaveBeenCalled();
        });
    });

    describe("commands", () => {
        async function getCommandCallback(plugin: Awaited<ReturnType<typeof createPlugin>>, id: string) {
            const calls = (plugin.addCommand as ReturnType<typeof vi.fn>).mock.calls as Array<
                [{ id: string; callback: () => void | Promise<void> }]
            >;
            const call = calls.find((c) => c[0].id === id);
            return call?.[0].callback;
        }

        it("lilbee:search opens SearchModal", async () => {
            const { SearchModal } = await import("../src/views/search-modal");
            const plugin = await createPlugin();
            await plugin.onload();

            const cb = await getCommandCallback(plugin, "lilbee:search");
            cb?.();

            expect(SearchModal).toHaveBeenCalled();
            const instance = (SearchModal as ReturnType<typeof vi.fn>).mock.results[0].value;
            expect(instance.open).toHaveBeenCalled();
        });

        it("lilbee:ask opens SearchModal in 'ask' mode", async () => {
            const { SearchModal } = await import("../src/views/search-modal");
            const plugin = await createPlugin();
            await plugin.onload();

            const cb = await getCommandCallback(plugin, "lilbee:ask");
            cb?.();

            const calls = (SearchModal as ReturnType<typeof vi.fn>).mock.calls;
            const askCall = calls.find((c: any[]) => c[2] === "ask");
            expect(askCall).toBeDefined();
        });

        it("lilbee:chat calls activateChatView", async () => {
            const plugin = await createPlugin();
            await plugin.onload();

            const activateSpy = vi.spyOn(plugin as any, "activateChatView").mockResolvedValue(undefined);
            const cb = await getCommandCallback(plugin, "lilbee:chat");
            cb?.();

            expect(activateSpy).toHaveBeenCalled();
        });

        it("lilbee:sync calls triggerSync", async () => {
            const plugin = await createPlugin();
            await plugin.onload();

            const syncSpy = vi.spyOn(plugin, "triggerSync").mockResolvedValue(undefined);
            const cb = await getCommandCallback(plugin, "lilbee:sync");
            cb?.();

            expect(syncSpy).toHaveBeenCalled();
        });

        it("lilbee:status opens StatusModal", async () => {
            const { StatusModal } = await import("../src/views/status-modal");
            const plugin = await createPlugin();
            await plugin.onload();

            const cb = await getCommandCallback(plugin, "lilbee:status");
            cb?.();

            expect(StatusModal).toHaveBeenCalled();
        });

        it("lilbee:catalog opens CatalogModal", async () => {
            const { CatalogModal } = await import("../src/views/catalog-modal");
            const plugin = await createPlugin();
            await plugin.onload();

            const cb = await getCommandCallback(plugin, "lilbee:catalog");
            cb?.();

            expect(CatalogModal).toHaveBeenCalled();
            const instance = (CatalogModal as ReturnType<typeof vi.fn>).mock.results[0].value;
            expect(instance.open).toHaveBeenCalled();
        });

        it("lilbee:tasks calls activateTaskView", async () => {
            const plugin = await createPlugin();
            await plugin.onload();

            const activateSpy = vi.spyOn(plugin as any, "activateTaskView").mockResolvedValue(undefined);
            const cb = await getCommandCallback(plugin, "lilbee:tasks");
            cb?.();

            expect(activateSpy).toHaveBeenCalled();
        });

        it("lilbee:crawl opens CrawlModal", async () => {
            const { CrawlModal } = await import("../src/views/crawl-modal");
            const plugin = await createPlugin();
            await plugin.onload();

            const cb = await getCommandCallback(plugin, "lilbee:crawl");
            cb?.();

            expect(CrawlModal).toHaveBeenCalled();
            const instance = (CrawlModal as ReturnType<typeof vi.fn>).mock.results[0].value;
            expect(instance.open).toHaveBeenCalled();
        });

        it("lilbee:documents opens DocumentsModal", async () => {
            const { DocumentsModal } = await import("../src/views/documents-modal");
            const plugin = await createPlugin();
            await plugin.onload();

            const cb = await getCommandCallback(plugin, "lilbee:documents");
            cb?.();

            expect(DocumentsModal).toHaveBeenCalled();
            const instance = (DocumentsModal as ReturnType<typeof vi.fn>).mock.results[0].value;
            expect(instance.open).toHaveBeenCalled();
        });
    });

    describe("registerAutoSync()", () => {
        it("vault event callbacks call debouncedSync", async () => {
            const plugin = await createPlugin();
            plugin.loadData = vi.fn().mockResolvedValue({ serverMode: "external", syncMode: "auto" });

            const debouncedSpy = vi.spyOn(plugin as any, "debouncedSync").mockImplementation(() => {});

            await plugin.onload();

            const vaultOnCalls = (plugin.app.vault.on as ReturnType<typeof vi.fn>).mock.calls as Array<
                [string, () => void]
            >;
            expect(vaultOnCalls.length).toBe(4);

            vaultOnCalls[0][1]();
            expect(debouncedSpy).toHaveBeenCalledTimes(1);
        });
    });

    describe("file-menu integration", () => {
        it("registers file-menu event on load", async () => {
            const plugin = await createPlugin();
            await plugin.onload();

            const workspaceOnCalls = (plugin.app.workspace.on as ReturnType<typeof vi.fn>).mock.calls as Array<
                [string, ...unknown[]]
            >;
            const fileMenuCall = workspaceOnCalls.find((c) => c[0] === "file-menu");
            expect(fileMenuCall).toBeDefined();
        });

        it("file-menu callback invokes addToLilbee", async () => {
            const plugin = await createPlugin();
            const addSpy = vi.spyOn(plugin as any, "addToLilbee").mockResolvedValue(undefined);
            await plugin.onload();

            const workspaceOnCalls = (plugin.app.workspace.on as ReturnType<typeof vi.fn>).mock.calls as Array<
                [string, ...unknown[]]
            >;
            const fileMenuCall = workspaceOnCalls.find((c) => c[0] === "file-menu");
            const callback = fileMenuCall![1] as (menu: any, file: any) => void;

            let menuItemCallback: (() => void) | null = null;
            const fakeMenu = {
                addItem: (cb: (item: any) => void) => {
                    const fakeItem = {
                        setTitle: () => fakeItem,
                        setIcon: () => fakeItem,
                        onClick: (fn: () => void) => {
                            menuItemCallback = fn;
                            return fakeItem;
                        },
                    };
                    cb(fakeItem);
                },
            };
            const fakeFile = { path: "notes/test.md", name: "test.md" };
            callback(fakeMenu, fakeFile);

            expect(menuItemCallback).not.toBeNull();
            menuItemCallback!();
            expect(addSpy).toHaveBeenCalledWith(fakeFile);
        });

        it("addToLilbee shows Notice and returns when no chat model is set", async () => {
            const plugin = await createPlugin();
            await plugin.onload();
            plugin.activeModel = "";

            await (plugin as any).addToLilbee({ path: "test.md", name: "test.md" });

            expect(Notice.instances.some((n) => n.message === MESSAGES.NOTICE_NO_CHAT_MODEL)).toBe(true);
            expect(plugin.api.addFiles).not.toHaveBeenCalled();
        });

        it("addToLilbee calls api.addFiles with absolute path", async () => {
            const plugin = await createPlugin();
            await plugin.onload();
            plugin.activeModel = "llama3";

            async function* noEvents() {}
            plugin.api.addFiles = vi.fn().mockReturnValue(noEvents());

            await (plugin as any).addToLilbee({ path: "notes/test.md", name: "test.md" });

            expect(plugin.api.addFiles).toHaveBeenCalledWith(
                ["/test/vault/notes/test.md"],
                false,
                undefined,
                expect.any(AbortSignal),
            );
        });

        it("addToLilbee shows summary Notice on done event", async () => {
            const plugin = await createPlugin();
            await plugin.onload();
            plugin.activeModel = "llama3";

            async function* withDone() {
                yield {
                    event: SSE_EVENT.DONE,
                    data: { added: ["test.md"], updated: [], removed: [], failed: [], unchanged: 0 },
                };
            }
            plugin.api.addFiles = vi.fn().mockReturnValue(withDone());

            await (plugin as any).addToLilbee({ path: "test.md", name: "test.md" });

            expect(Notice.instances.some((n) => n.message.includes("1 added"))).toBe(true);
        });

        it("addToLilbee shows error Notice on API failure", async () => {
            const plugin = await createPlugin();
            await plugin.onload();
            plugin.activeModel = "llama3";

            plugin.api.addFiles = vi.fn().mockImplementation(() => {
                throw new Error("connection refused");
            });

            await (plugin as any).addToLilbee({ path: "test.md", name: "test.md" });

            expect(Notice.instances.some((n) => n.message.includes("add failed"))).toBe(true);
        });

        it("addToLilbee returns early when statusBarEl is null", async () => {
            const plugin = await createPlugin();
            await plugin.onload();
            plugin.activeModel = "llama3";
            (plugin as any).statusBarEl = null;

            const addFilesSpy = vi.spyOn(plugin.api, "addFiles");
            await (plugin as any).addToLilbee({ path: "test.md", name: "test.md" });

            expect(addFilesSpy).not.toHaveBeenCalled();
        });

        it("addToLilbee shows 'nothing new' Notice when done has empty arrays", async () => {
            const plugin = await createPlugin();
            await plugin.onload();
            plugin.activeModel = "llama3";

            async function* emptyDone() {
                yield {
                    event: SSE_EVENT.DONE,
                    data: { added: [], updated: [], removed: [], failed: [], unchanged: 1 },
                };
            }
            plugin.api.addFiles = vi.fn().mockReturnValue(emptyDone());

            await (plugin as any).addToLilbee({ path: "test.md", name: "test.md" });

            expect(Notice.instances.some((n) => n.message.includes("adding test.md"))).toBe(true);
            expect(Notice.instances.some((n) => n.message.includes("nothing new to add"))).toBe(true);
        });

        it("addToLilbee falls back to path when name is undefined", async () => {
            const plugin = await createPlugin();
            await plugin.onload();
            plugin.activeModel = "llama3";

            async function* noEvents() {}
            plugin.api.addFiles = vi.fn().mockReturnValue(noEvents());

            await (plugin as any).addToLilbee({ path: "deep/test.md" });

            expect(Notice.instances.some((n) => n.message.includes("adding deep/test.md"))).toBe(true);
        });

        it("runAdd shows error message from Error instance", async () => {
            const plugin = await createPlugin();
            await plugin.onload();
            plugin.activeModel = "llama3";

            plugin.api.addFiles = vi.fn().mockImplementation(() => {
                throw new Error("server returned 500");
            });

            await (plugin as any).addToLilbee({ path: "test.md", name: "test.md" });

            expect(Notice.instances.some((n) => n.message.includes("server returned 500"))).toBe(true);
        });

        it("runAdd shows fallback message for non-Error throw", async () => {
            const plugin = await createPlugin();
            await plugin.onload();
            plugin.activeModel = "llama3";

            plugin.api.addFiles = vi.fn().mockImplementation(() => {
                throw "string error";
            });

            await (plugin as any).addToLilbee({ path: "test.md", name: "test.md" });

            expect(Notice.instances.some((n) => n.message.includes("cannot connect to server"))).toBe(true);
        });

        it("addToLilbee shows failed count in Notice", async () => {
            const plugin = await createPlugin();
            await plugin.onload();
            plugin.activeModel = "llama3";
            plugin.activeModel = "llama3";

            async function* withFailed() {
                yield {
                    event: SSE_EVENT.DONE,
                    data: { added: [], updated: [], removed: [], failed: ["bad.pdf"], unchanged: 0 },
                };
            }
            plugin.api.addFiles = vi.fn().mockReturnValue(withFailed());

            await (plugin as any).addToLilbee({ path: "bad.pdf", name: "bad.pdf" });

            expect(Notice.instances.some((n) => n.message.includes("1 failed"))).toBe(true);
        });
    });

    describe("addExternalFiles()", () => {
        it("shows Notice and returns when no chat model is set", async () => {
            const plugin = await createPlugin();
            await plugin.onload();
            plugin.activeModel = "";

            await plugin.addExternalFiles(["/home/user/doc.pdf"]);

            expect(Notice.instances.some((n) => n.message === MESSAGES.NOTICE_NO_CHAT_MODEL)).toBe(true);
            expect(plugin.api.addFiles).not.toHaveBeenCalled();
        });

        it("calls api.addFiles with the given absolute paths", async () => {
            const plugin = await createPlugin();
            await plugin.onload();
            plugin.activeModel = "llama3";

            async function* noEvents() {}
            plugin.api.addFiles = vi.fn().mockReturnValue(noEvents());

            await plugin.addExternalFiles(["/home/user/doc.pdf", "/tmp/notes.md"]);

            expect(plugin.api.addFiles).toHaveBeenCalledWith(
                ["/home/user/doc.pdf", "/tmp/notes.md"],
                false,
                undefined,
                expect.any(AbortSignal),
            );
        });

        it("passes vision model when activeVisionModel is set", async () => {
            const plugin = await createPlugin();
            await plugin.onload();
            plugin.activeModel = "llama3";
            plugin.activeVisionModel = "minicpm-v:latest";

            async function* noEvents() {}
            plugin.api.addFiles = vi.fn().mockReturnValue(noEvents());

            await plugin.addExternalFiles(["/home/user/scan.pdf"]);

            expect(plugin.api.addFiles).toHaveBeenCalledWith(
                ["/home/user/scan.pdf"],
                false,
                "minicpm-v:latest",
                expect.any(AbortSignal),
            );
        });

        it("returns early when paths array is empty", async () => {
            const plugin = await createPlugin();
            await plugin.onload();
            plugin.api.addFiles = vi.fn();

            await plugin.addExternalFiles([]);

            expect(plugin.api.addFiles).not.toHaveBeenCalled();
        });

        it("handles path with trailing slash gracefully", async () => {
            const plugin = await createPlugin();
            await plugin.onload();
            plugin.activeModel = "llama3";
            plugin.api.addFiles = vi.fn().mockImplementation(async function* () {
                yield {
                    event: SSE_EVENT.DONE,
                    data: { added: [], updated: [], removed: [], unchanged: 0, failed: [] },
                };
            });

            await plugin.addExternalFiles(["/some/dir/"]);
            expect(plugin.api.addFiles).toHaveBeenCalled();
        });

        it("returns early when statusBarEl is null", async () => {
            const plugin = await createPlugin();
            await plugin.onload();
            plugin.activeModel = "llama3";
            (plugin as any).statusBarEl = null;
            plugin.api.addFiles = vi.fn();

            await plugin.addExternalFiles(["/some/file.pdf"]);

            expect(plugin.api.addFiles).not.toHaveBeenCalled();
        });

        it("shows summary Notice on done event", async () => {
            const plugin = await createPlugin();
            await plugin.onload();
            plugin.activeModel = "llama3";

            async function* withDone() {
                yield {
                    event: SSE_EVENT.DONE,
                    data: { added: ["doc.pdf"], updated: [], removed: [], failed: [], unchanged: 0 },
                };
            }
            plugin.api.addFiles = vi.fn().mockReturnValue(withDone());

            await plugin.addExternalFiles(["/home/user/doc.pdf"]);

            expect(Notice.instances.some((n) => n.message.includes("1 added"))).toBe(true);
        });

        it("updates status bar on FILE_START during addExternalFiles", async () => {
            const plugin = await createPlugin();
            await plugin.onload();
            plugin.activeModel = "llama3";

            async function* withFileStart() {
                yield { event: SSE_EVENT.FILE_START, data: { file: "doc.pdf", current_file: 2, total_files: 5 } };
            }
            plugin.api.addFiles = vi.fn().mockReturnValue(withFileStart());

            await plugin.addExternalFiles(["/home/user/doc.pdf"]);

            expect((plugin as any).statusBarEl?.textContent).toContain("ready");
        });

        it("shows error Notice on API failure", async () => {
            const plugin = await createPlugin();
            await plugin.onload();
            plugin.activeModel = "llama3";

            plugin.api.addFiles = vi.fn().mockImplementation(() => {
                throw new Error("connection refused");
            });

            await plugin.addExternalFiles(["/some/file.pdf"]);

            expect(Notice.instances.some((n) => n.message.includes("add failed"))).toBe(true);
        });

        it("shows failed count in Notice", async () => {
            const plugin = await createPlugin();
            await plugin.onload();
            plugin.activeModel = "llama3";

            async function* withFailed() {
                yield {
                    event: SSE_EVENT.DONE,
                    data: { added: [], updated: [], removed: [], failed: ["bad.pdf"], unchanged: 0 },
                };
            }
            plugin.api.addFiles = vi.fn().mockReturnValue(withFailed());

            await plugin.addExternalFiles(["/home/user/bad.pdf"]);

            expect(Notice.instances.some((n) => n.message.includes("1 failed"))).toBe(true);
        });
    });

    describe("triggerSync event handling", () => {
        it("handles EXTRACT events by updating taskQueue", async () => {
            const plugin = await createPlugin();
            await plugin.onload();

            async function* withExtract() {
                yield { event: SSE_EVENT.EXTRACT, data: { file: "paper.pdf", page: 5, total_pages: 50 } };
            }
            plugin.api.syncStream = vi.fn().mockReturnValue(withExtract());

            await plugin.triggerSync();

            expect(plugin.taskQueue.completed.length).toBeGreaterThan(0);
        });

        it("handles EMBED events by updating taskQueue", async () => {
            const plugin = await createPlugin();
            await plugin.onload();

            async function* withEmbed() {
                yield { event: SSE_EVENT.EMBED, data: { file: "paper.pdf", chunk: 30, total_chunks: 100 } };
            }
            plugin.api.syncStream = vi.fn().mockReturnValue(withEmbed());

            await plugin.triggerSync();

            expect(plugin.taskQueue.completed.length).toBeGreaterThan(0);
        });
    });

    describe("runAdd event handling", () => {
        it("handles EXTRACT events by updating taskQueue", async () => {
            const plugin = await createPlugin();
            await plugin.onload();
            plugin.activeModel = "llama3";

            async function* withExtract() {
                yield { event: SSE_EVENT.EXTRACT, data: { file: "paper.pdf", page: 3, total_pages: 10 } };
            }
            plugin.api.addFiles = vi.fn().mockReturnValue(withExtract());

            await (plugin as any).addToLilbee({ path: "paper.pdf", name: "paper.pdf" });

            expect(plugin.taskQueue.completed.length).toBeGreaterThan(0);
        });

        it("handles EMBED events by updating taskQueue", async () => {
            const plugin = await createPlugin();
            await plugin.onload();
            plugin.activeModel = "llama3";

            async function* withEmbed() {
                yield { event: SSE_EVENT.EMBED, data: { chunk: 5, total_chunks: 20 } };
            }
            plugin.api.addFiles = vi.fn().mockReturnValue(withEmbed());

            await (plugin as any).addToLilbee({ path: "test.md", name: "test.md" });

            expect(plugin.taskQueue.completed.length).toBeGreaterThan(0);
        });
    });

    describe("taskQueue integration", () => {
        it("sync updates taskQueue with progress", async () => {
            const plugin = await createPlugin();
            await plugin.onload();

            async function* withFileStart() {
                yield { event: SSE_EVENT.FILE_START, data: { file: "paper.pdf", current_file: 3, total_files: 10 } };
            }
            plugin.api.syncStream = vi.fn().mockReturnValue(withFileStart());

            await plugin.triggerSync();

            // Task should be completed in history
            expect(plugin.taskQueue.completed.length).toBeGreaterThan(0);
            expect(plugin.taskQueue.completed[0]!.name).toBe("Sync vault");
        });

        it("add updates taskQueue with progress", async () => {
            const plugin = await createPlugin();
            await plugin.onload();
            plugin.activeModel = "llama3";

            async function* withDone() {
                yield {
                    event: SSE_EVENT.DONE,
                    data: { added: ["a.md"], updated: [], removed: [], failed: [], unchanged: 0 },
                };
            }
            plugin.api.addFiles = vi.fn().mockReturnValue(withDone());

            await (plugin as any).addToLilbee({ path: "test.md", name: "test.md" });

            expect(plugin.taskQueue.completed.length).toBeGreaterThan(0);
            expect(plugin.taskQueue.completed[0]!.name).toBe("Adding files");
        });
    });

    describe("active model in status bar", () => {
        it("fetchActiveModel sets activeModel and updates status bar", async () => {
            const plugin = await createPlugin();
            await plugin.onload();

            plugin.api.listModels = vi.fn().mockResolvedValue({
                chat: { active: "qwen3:8b", installed: ["qwen3:8b"], catalog: [] },
                vision: { active: "", installed: [], catalog: [] },
            });

            plugin.fetchActiveModel();
            await new Promise((r) => setTimeout(r, 0));

            expect(plugin.activeModel).toBe("qwen3:8b");
            expect((plugin as any).statusBarEl?.textContent).toBe("lilbee: ready [external] (qwen3:8b)");
        });

        it("fetchActiveModel silently fails on API error", async () => {
            const plugin = await createPlugin();
            await plugin.onload();

            plugin.api.listModels = vi.fn().mockRejectedValue(new Error("offline"));

            plugin.fetchActiveModel();
            await new Promise((r) => setTimeout(r, 0));

            expect(plugin.activeModel).toBe("");
            expect((plugin as any).statusBarEl?.textContent).toBe("lilbee: ready [external]");
        });

        it("status bar shows task name during sync", async () => {
            const plugin = await createPlugin();
            await plugin.onload();
            plugin.activeModel = "llama3";

            async function* withFileStart() {
                yield { event: SSE_EVENT.FILE_START, data: { file: "a.md", current_file: 1, total_files: 2 } };
            }
            plugin.api.syncStream = vi.fn().mockReturnValue(withFileStart());

            await plugin.triggerSync();

            // After sync completes, status bar should be ready
            expect((plugin as any).statusBarEl?.textContent).toContain("ready");
        });

        it("taskQueue updates status bar when task is active", async () => {
            const plugin = await createPlugin();
            await plugin.onload();
            plugin.activeModel = "";

            const id = plugin.taskQueue.enqueue("Sync vault", "sync");
            expect((plugin as any).statusBarEl?.textContent).toContain("Sync vault");

            plugin.taskQueue.complete(id);
            expect((plugin as any).statusBarEl?.textContent).toContain("ready");
        });

        it("taskQueue status bar shows queued count suffix on update", async () => {
            const plugin = await createPlugin();
            await plugin.onload();
            plugin.activeModel = "";

            const statusTexts: string[] = [];
            const origSetText = (plugin as any).statusBarEl!.setText.bind((plugin as any).statusBarEl);
            (plugin as any).statusBarEl!.setText = (text: string) => {
                statusTexts.push(text);
                origSetText(text);
            };

            const id1 = plugin.taskQueue.enqueue("Sync vault", "sync");
            plugin.taskQueue.enqueue("Sync again", "sync");
            // Update the active task to trigger a re-render with queued count
            plugin.taskQueue.update(id1, 50);

            expect(statusTexts.some((t) => t.includes("+1"))).toBe(true);
        });

        it("taskQueue status bar shows progress percentage", async () => {
            const plugin = await createPlugin();
            await plugin.onload();
            plugin.activeModel = "";

            const id = plugin.taskQueue.enqueue("Sync vault", "sync");
            plugin.taskQueue.update(id, 42);

            expect((plugin as any).statusBarEl?.textContent).toContain("42%");
        });

        it("updateStatusBar no-ops when statusBarEl is null", async () => {
            const plugin = await createPlugin();
            await plugin.onload();
            (plugin as any).statusBarEl = null;

            expect(() => {
                (plugin as any).updateStatusBar("test");
            }).not.toThrow();
        });

        it("setStatusClass no-ops when statusBarEl is null", async () => {
            const plugin = await createPlugin();
            await plugin.onload();
            (plugin as any).statusBarEl = null;

            expect(() => {
                (plugin as any).setStatusClass("lilbee-status-ready");
            }).not.toThrow();
        });
    });

    describe("managed server mode", () => {
        it("onload in managed mode creates binaryManager and serverManager", async () => {
            const plugin = await createPlugin({ serverMode: "managed" });
            await plugin.onload();
            await flush();

            expect(plugin.binaryManager).not.toBeNull();
            expect(plugin.serverManager).not.toBeNull();
            expect(mockEnsureBinary).toHaveBeenCalled();
            expect(mockServerStart).toHaveBeenCalled();
        });

        it("managed mode shows download error Notice when ensureBinary fails", async () => {
            mockEnsureBinary.mockRejectedValueOnce(new Error("network timeout"));

            const plugin = await createPlugin({ serverMode: "managed" });
            await plugin.onload();
            await flush();

            expect(Notice.instances.some((n) => n.message.includes("failed to download server"))).toBe(true);
            expect(Notice.instances.some((n) => n.message.includes("network timeout"))).toBe(true);
        });

        it("managed mode shows stringified error when ensureBinary throws non-Error", async () => {
            mockEnsureBinary.mockRejectedValueOnce("string error");

            const plugin = await createPlugin({ serverMode: "managed" });
            await plugin.onload();
            await flush();

            expect(Notice.instances.some((n) => n.message.includes("failed to download server"))).toBe(true);
            expect(Notice.instances.some((n) => n.message.includes("string error"))).toBe(true);
        });

        it("managed mode shows start error Notice when serverManager.start fails", async () => {
            mockServerStart.mockRejectedValueOnce(new Error("port in use"));

            const plugin = await createPlugin({ serverMode: "managed" });
            await plugin.onload();
            await flush();

            expect(Notice.instances.some((n) => n.message.includes("failed to start server"))).toBe(true);
            expect(Notice.instances.some((n) => n.message.includes("port in use"))).toBe(true);
        });

        it("managed mode shows stringified error when serverManager.start throws non-Error", async () => {
            mockServerStart.mockRejectedValueOnce(42);

            const plugin = await createPlugin({ serverMode: "managed" });
            await plugin.onload();
            await flush();

            expect(Notice.instances.some((n) => n.message.includes("failed to start server"))).toBe(true);
            expect(Notice.instances.some((n) => n.message.includes("42"))).toBe(true);
        });

        it("handleServerStateChange updates status bar for all states", async () => {
            const plugin = await createPlugin({ serverMode: "managed" });
            await plugin.onload();
            await flush();

            const stateChange = mockServerOpts?.onStateChange;
            expect(stateChange).toBeDefined();

            stateChange("ready");
            expect((plugin as any).statusBarEl?.textContent).toContain("ready");

            stateChange("starting");
            expect((plugin as any).statusBarEl?.textContent).toContain("starting");

            stateChange("error");
            expect((plugin as any).statusBarEl?.textContent).toContain("error");

            stateChange("stopped");
            expect((plugin as any).statusBarEl?.textContent).toContain("stopped");
        });

        it("handleServerStateChange sets correct CSS classes", async () => {
            const plugin = await createPlugin({ serverMode: "managed" });
            await plugin.onload();
            await flush();

            const el = (plugin as any).statusBarEl!;
            const stateChange = mockServerOpts?.onStateChange;

            stateChange("starting");
            expect(el.classList.contains("lilbee-status-starting")).toBe(true);
            expect(el.classList.contains("lilbee-status-ready")).toBe(false);

            stateChange("ready");
            expect(el.classList.contains("lilbee-status-ready")).toBe(true);
            expect(el.classList.contains("lilbee-status-starting")).toBe(false);

            stateChange("error");
            expect(el.classList.contains("lilbee-status-ready")).toBe(false);
            expect(el.classList.contains("lilbee-status-starting")).toBe(false);
            expect(el.classList.contains("lilbee-status-downloading")).toBe(false);

            stateChange("stopped");
            expect(el.classList.contains("lilbee-status-ready")).toBe(false);
            expect(el.classList.contains("lilbee-status-starting")).toBe(false);
        });

        it("setStatusReady adds lilbee-status-ready class", async () => {
            const plugin = await createPlugin({ serverMode: "external" });
            await plugin.onload();

            const el = (plugin as any).statusBarEl!;
            expect(el.classList.contains("lilbee-status-ready")).toBe(true);
        });

        it("downloading state sets lilbee-status-downloading class", async () => {
            mockBinaryExists.mockReturnValueOnce(false);
            mockEnsureBinary.mockImplementationOnce(async () => "/fake/bin/lilbee");

            const plugin = await createPlugin({ serverMode: "managed" });
            await plugin.onload();
            await flush();

            // After ensureBinary completes, the downloading class should be cleared
            const el = (plugin as any).statusBarEl!;
            expect(el.classList.contains("lilbee-status-downloading")).toBe(false);
        });

        it("starting state sets lilbee-status-starting class during start", async () => {
            let resolveStart!: () => void;
            mockServerStart.mockImplementationOnce(
                () =>
                    new Promise<void>((r) => {
                        resolveStart = r;
                    }),
            );

            const plugin = await createPlugin({ serverMode: "managed" });
            plugin.onload();
            await flush();

            // During start, status bar should have starting class
            const el = (plugin as any).statusBarEl!;
            expect(el.classList.contains("lilbee-status-starting")).toBe(true);

            resolveStart();
            await flush();
        });

        it("onRestartsExhausted shows persistent error Notice with stderr", async () => {
            const plugin = await createPlugin({ serverMode: "managed" });
            await plugin.onload();
            await flush();

            const onExhausted = mockServerOpts?.onRestartsExhausted;
            expect(onExhausted).toBeDefined();

            onExhausted("bind: address already in use");

            expect(Notice.instances.some((n) => n.message.includes("crashed after multiple restarts"))).toBe(true);
            const notice = Notice.instances.find((n) => n.message.includes("crashed after multiple restarts"));
            expect(notice!.duration).toBe(0);
            expect(notice!.message).toContain("address already in use");
        });

        it("onRestartsExhausted shows notice without stderr detail when stderr is empty", async () => {
            const plugin = await createPlugin({ serverMode: "managed" });
            await plugin.onload();
            await flush();

            const onExhausted = mockServerOpts?.onRestartsExhausted;
            onExhausted("");

            const notice = Notice.instances.find((n) => n.message.includes("crashed after multiple restarts"));
            expect(notice).toBeDefined();
            expect(notice!.message).toBe("lilbee: server crashed after multiple restarts");
        });

        it("onRestartsExhausted is suppressed when showError already fired", async () => {
            mockServerStart.mockRejectedValueOnce(new Error("port in use"));

            const plugin = await createPlugin({ serverMode: "managed" });
            await plugin.onload();
            await flush();

            // showError already fired and set serverStartFailed
            const beforeCount = Notice.instances.length;

            const onExhausted = mockServerOpts?.onRestartsExhausted;
            onExhausted("bind: address already in use");

            // No additional notice created
            expect(Notice.instances.length).toBe(beforeCount);
        });

        it("showError includes lastStderr in the notice", async () => {
            mockLastStderr = "fatal: database locked";
            mockServerStart.mockRejectedValueOnce(new Error("startup failed"));

            const plugin = await createPlugin({ serverMode: "managed" });
            await plugin.onload();
            await flush();

            const notice = Notice.instances.find((n) => n.message.includes("startup failed"));
            expect(notice).toBeDefined();
            expect(notice!.message).toContain("database locked");
            mockLastStderr = "";
        });

        it("ensureBinary progress callback updates status bar", async () => {
            mockEnsureBinary.mockImplementationOnce(async (cb: any) => {
                cb?.("Downloading 50%");
                return "/fake/bin/lilbee";
            });

            const plugin = await createPlugin({ serverMode: "managed" });
            await plugin.onload();
            await flush();

            expect(mockEnsureBinary).toHaveBeenCalled();
        });

        it("shows download Notice with URL when binary is missing", async () => {
            mockBinaryExists.mockReturnValueOnce(false);
            mockEnsureBinary.mockImplementationOnce(async (cb: any) => {
                cb?.("Downloading...", "https://example.com/dl");
                cb?.("Download complete.", "https://example.com/dl");
                return "/fake/bin/lilbee";
            });

            const plugin = await createPlugin({ serverMode: "managed" });
            await plugin.onload();
            await flush();

            const downloadNotice = Notice.instances.find((n) => n.duration === 0);
            expect(downloadNotice).toBeDefined();
            expect(downloadNotice!.message).toContain("Download complete.");
            expect(downloadNotice!.message).toContain("https://example.com/dl");
            expect(downloadNotice!.hidden).toBe(true);
        });

        it("shows download Notice without URL when url is not provided", async () => {
            mockBinaryExists.mockReturnValueOnce(false);
            mockEnsureBinary.mockImplementationOnce(async (cb: any) => {
                cb?.("Fetching latest release info...");
                cb?.("Still going...");
                return "/fake/bin/lilbee";
            });

            const plugin = await createPlugin({ serverMode: "managed" });
            await plugin.onload();
            await flush();

            const downloadNotice = Notice.instances.find((n) => n.duration === 0);
            expect(downloadNotice).toBeDefined();
            expect(downloadNotice!.message).toBe("lilbee: Still going...");
        });

        it("does not show download Notice when binary already exists", async () => {
            mockBinaryExists.mockReturnValueOnce(true);

            const plugin = await createPlugin({ serverMode: "managed" });
            await plugin.onload();
            await flush();

            const downloadNotice = Notice.instances.find((n) => n.duration === 0);
            expect(downloadNotice).toBeUndefined();
        });

        it("hides download Notice on ensureBinary failure", async () => {
            mockBinaryExists.mockReturnValueOnce(false);
            mockEnsureBinary.mockImplementationOnce(async (cb: any) => {
                cb?.("Downloading...", "https://example.com/dl");
                throw new Error("network error");
            });

            const plugin = await createPlugin({ serverMode: "managed" });
            await plugin.onload();
            await flush();

            const downloadNotice = Notice.instances.find((n) => n.duration === 0);
            expect(downloadNotice).toBeDefined();
            expect(downloadNotice!.hidden).toBe(true);
        });

        it("startManagedServer no-ops when already starting", async () => {
            let resolveEnsure!: (v: string) => void;
            mockEnsureBinary.mockImplementationOnce(
                () =>
                    new Promise((r) => {
                        resolveEnsure = r;
                    }),
            );

            const plugin = await createPlugin({ serverMode: "managed" });
            await plugin.onload();
            // First call is in progress (blocked on ensureBinary)

            // Second call should no-op
            mockEnsureBinary.mockResolvedValueOnce("/fake/bin/lilbee");
            await plugin.startManagedServer();

            // Unblock the first call
            resolveEnsure("/fake/bin/lilbee");
            await flush();

            // ensureBinary was only called once (the first time)
            expect(mockEnsureBinary).toHaveBeenCalledTimes(1);
        });

        it("handleServerStateChange ready updates api with current server URL", async () => {
            const { LilbeeClient } = await import("../src/api");

            const plugin = await createPlugin({ serverMode: "managed" });
            await plugin.onload();
            await flush();

            const stateChange = mockServerOpts?.onStateChange;
            expect(stateChange).toBeDefined();

            const callsBefore = (LilbeeClient as ReturnType<typeof vi.fn>).mock.calls.length;
            stateChange("ready");
            const callsAfter = (LilbeeClient as ReturnType<typeof vi.fn>).mock.calls.length;

            expect(callsAfter).toBeGreaterThan(callsBefore);
        });

        it("sets status bar to downloading only when binary is missing", async () => {
            const plugin = await createPlugin({ serverMode: "external" });
            await plugin.onload();

            const statusTexts: string[] = [];
            const origSetText = (plugin as any).statusBarEl!.setText.bind((plugin as any).statusBarEl);
            (plugin as any).statusBarEl!.setText = (text: string) => {
                statusTexts.push(text);
                origSetText(text);
            };

            mockBinaryExists.mockReturnValueOnce(false);
            await (plugin as any).startManagedServer();

            expect(statusTexts.some((t) => t.includes("downloading"))).toBe(true);
        });

        it("does not set status bar to downloading when binary exists", async () => {
            const plugin = await createPlugin({ serverMode: "external" });
            await plugin.onload();

            const statusTexts: string[] = [];
            const origSetText = (plugin as any).statusBarEl!.setText.bind((plugin as any).statusBarEl);
            (plugin as any).statusBarEl!.setText = (text: string) => {
                statusTexts.push(text);
                origSetText(text);
            };

            await (plugin as any).startManagedServer();

            expect(statusTexts.some((t) => t.includes("downloading"))).toBe(false);
        });

        it("saves version on fresh download when lilbeeVersion is empty", async () => {
            mockBinaryExists.mockReturnValueOnce(false);
            const { getLatestRelease } = await import("../src/binary-manager");
            (getLatestRelease as ReturnType<typeof vi.fn>).mockResolvedValue({
                tag: "v0.5.1",
                assetUrl: "https://example.com",
            });

            const plugin = await createPlugin({ serverMode: "managed", lilbeeVersion: "" });
            await plugin.onload();
            await flush();

            expect(plugin.settings.lilbeeVersion).toBe("v0.5.1");
        });

        it("does not overwrite existing lilbeeVersion on fresh download", async () => {
            mockBinaryExists.mockReturnValueOnce(false);

            const plugin = await createPlugin({ serverMode: "managed", lilbeeVersion: "v0.4.0" });
            await plugin.onload();
            await flush();

            expect(plugin.settings.lilbeeVersion).toBe("v0.4.0");
        });

        it("does not create serverManager when ensureBinary fails", async () => {
            const plugin = await createPlugin({ serverMode: "managed" });
            mockEnsureBinary.mockRejectedValueOnce(new Error("fail"));
            await plugin.onload();
            await flush();

            expect(plugin.serverManager).toBeNull();
            expect(mockServerStart).not.toHaveBeenCalled();
        });

        it("sets status bar to error when ensureBinary fails", async () => {
            mockEnsureBinary.mockRejectedValueOnce(new Error("fail"));

            const plugin = await createPlugin({ serverMode: "managed" });
            await plugin.onload();
            await flush();

            expect((plugin as any).statusBarEl?.textContent).toContain("error");
        });

        it("sets status bar to error and clears status classes when serverManager.start fails", async () => {
            mockServerStart.mockRejectedValueOnce(new Error("crash"));

            const plugin = await createPlugin({ serverMode: "managed" });
            await plugin.onload();
            await flush();

            const el = (plugin as any).statusBarEl!;
            expect(el.textContent).toContain("error");
            expect(el.classList.contains("lilbee-status-starting")).toBe(false);
            expect(el.classList.contains("lilbee-status-ready")).toBe(false);
            expect(el.classList.contains("lilbee-status-downloading")).toBe(false);
        });
    });

    describe("saveSettings mode switching", () => {
        it("managed → external: stops server and nulls managers", async () => {
            const plugin = await createPlugin({ serverMode: "managed" });
            await plugin.onload();
            await flush();

            expect(plugin.serverManager).not.toBeNull();

            plugin.settings.serverMode = "external";
            await plugin.saveSettings();

            expect(mockServerStop).toHaveBeenCalled();
            expect(plugin.serverManager).toBeNull();
            expect(plugin.binaryManager).toBeNull();
        });

        it("external → managed: starts managed server", async () => {
            const plugin = await createPlugin({ serverMode: "external" });
            await plugin.onload();

            expect(plugin.serverManager).toBeNull();

            plugin.settings.serverMode = "managed";
            await plugin.saveSettings();

            // startManagedServer is called via void (fire-and-forget)
            await new Promise((r) => setTimeout(r, 0));

            expect(plugin.binaryManager).not.toBeNull();
        });

        it("managed → managed with serverManager: updates port", async () => {
            const plugin = await createPlugin({ serverMode: "managed" });
            await plugin.onload();
            await flush();

            plugin.settings.serverPort = 9999;
            await plugin.saveSettings();

            expect(mockUpdatePort).toHaveBeenCalledWith(9999);
        });
    });

    describe("cancelSync()", () => {
        it("aborts the sync controller and nulls it", async () => {
            const plugin = await createPlugin();
            await plugin.onload();

            plugin.syncController = new AbortController();
            const abortSpy = vi.spyOn(plugin.syncController, "abort");

            plugin.cancelSync();

            expect(abortSpy).toHaveBeenCalled();
            expect(plugin.syncController).toBeNull();
        });

        it("no-ops when syncController is null", async () => {
            const plugin = await createPlugin();
            await plugin.onload();
            plugin.syncController = null;

            expect(() => plugin.cancelSync()).not.toThrow();
        });
    });

    describe("AbortError handling", () => {
        it("runAdd shows 'add cancelled' on AbortError", async () => {
            const plugin = await createPlugin();
            await plugin.onload();
            plugin.activeModel = "llama3";

            const abortError = new Error("Aborted");
            abortError.name = "AbortError";
            plugin.api.addFiles = vi.fn().mockImplementation(async function* () {
                throw abortError;
            });

            await (plugin as any).addToLilbee({ path: "test.md", name: "test.md" });

            expect(Notice.instances.some((n) => n.message === MESSAGES.STATUS_ADD_CANCELLED)).toBe(true);
        });

        it("triggerSync shows 'sync cancelled' on AbortError", async () => {
            const plugin = await createPlugin();
            await plugin.onload();

            const abortError = new Error("Aborted");
            abortError.name = "AbortError";
            plugin.api.syncStream = vi.fn().mockImplementation(async function* () {
                throw abortError;
            });

            await plugin.triggerSync();

            expect(Notice.instances.some((n) => n.message.includes("sync cancelled"))).toBe(true);
        });

        it("runAdd cancels task in queue on AbortError", async () => {
            const plugin = await createPlugin();
            await plugin.onload();
            plugin.activeModel = "llama3";

            const abortError = new Error("Aborted");
            abortError.name = "AbortError";
            plugin.api.addFiles = vi.fn().mockImplementation(async function* () {
                throw abortError;
            });

            await (plugin as any).addToLilbee({ path: "test.md", name: "test.md" });

            const cancelled = plugin.taskQueue.completed.find((t) => t.status === "cancelled");
            expect(cancelled).toBeDefined();
        });

        it("triggerSync cancels task in queue on AbortError", async () => {
            const plugin = await createPlugin();
            await plugin.onload();

            const abortError = new Error("Aborted");
            abortError.name = "AbortError";
            plugin.api.syncStream = vi.fn().mockImplementation(async function* () {
                throw abortError;
            });

            await plugin.triggerSync();

            const cancelled = plugin.taskQueue.completed.find((t) => t.status === "cancelled");
            expect(cancelled).toBeDefined();
        });
    });

    describe("onunload with serverManager", () => {
        it("calls serverManager.stop on unload", async () => {
            const plugin = await createPlugin({ serverMode: "managed" });
            await plugin.onload();
            await flush();

            mockServerStop.mockClear();
            plugin.onunload();

            expect(mockServerStop).toHaveBeenCalled();
        });
    });

    describe("external mode status bar label", () => {
        it("shows [external] in external mode", async () => {
            const plugin = await createPlugin({ serverMode: "external" });
            await plugin.onload();
            expect((plugin as any).statusBarEl?.textContent).toBe("lilbee: ready [external]");
        });

        it("does not show [external] in managed mode", async () => {
            const plugin = await createPlugin({ serverMode: "managed" });
            await plugin.onload();
            await flush();
            expect((plugin as any).statusBarEl?.textContent).not.toContain("[external]");
        });
    });

    describe("checkForUpdate", () => {
        it("returns available: true when update exists", async () => {
            const { getLatestRelease, checkForUpdate } = await import("../src/binary-manager");
            (getLatestRelease as ReturnType<typeof vi.fn>).mockResolvedValue({
                tag: "v0.2.0",
                assetUrl: "https://example.com",
            });
            (checkForUpdate as ReturnType<typeof vi.fn>).mockReturnValue(true);

            const plugin = await createPlugin({ serverMode: "managed", lilbeeVersion: "v0.1.0" });
            await plugin.onload();
            await flush();

            const result = await plugin.checkForUpdate();
            expect(result.available).toBe(true);
            expect(result.release?.tag).toBe("v0.2.0");
        });

        it("returns available: false when up to date", async () => {
            const { getLatestRelease, checkForUpdate } = await import("../src/binary-manager");
            (getLatestRelease as ReturnType<typeof vi.fn>).mockResolvedValue({
                tag: "v0.1.0",
                assetUrl: "https://example.com",
            });
            (checkForUpdate as ReturnType<typeof vi.fn>).mockReturnValue(false);

            const plugin = await createPlugin({ serverMode: "managed", lilbeeVersion: "v0.1.0" });
            await plugin.onload();
            await flush();

            const result = await plugin.checkForUpdate();
            expect(result.available).toBe(false);
        });
    });

    describe("runWikiLint", () => {
        it("success path: collects issues, completes task, shows notice, opens modal", async () => {
            const plugin = await createPlugin();
            await plugin.onload();

            async function* lintStream() {
                yield { event: SSE_EVENT.WIKI_LINT_PROGRESS, data: { checked: 1, total: 2 } };
                yield { event: SSE_EVENT.WIKI_LINT_DONE, data: { issues: [{ slug: "a", status: "stale" }] } };
            }
            plugin.api.wikiLint = vi.fn().mockReturnValue(lintStream());

            await plugin.runWikiLint();

            expect(plugin.taskQueue.completed.length).toBeGreaterThan(0);
            expect(Notice.instances.some((n) => n.message.includes("lint complete"))).toBe(true);
            expect(mockLintModalOpen).toHaveBeenCalled();
        });

        it("error path: fails the task on exception", async () => {
            const plugin = await createPlugin();
            await plugin.onload();

            async function* failStream() {
                throw new Error("lint failed");
                yield; // unreachable, makes it a generator
            }
            plugin.api.wikiLint = vi.fn().mockReturnValue(failStream());

            await plugin.runWikiLint();

            expect(plugin.taskQueue.completed.some((t) => t.status === "failed")).toBe(true);
        });

        it("error path: handles non-Error thrown value", async () => {
            const plugin = await createPlugin();
            await plugin.onload();

            async function* throwStream() {
                throw "string error";
                yield;
            }
            plugin.api.wikiLint = vi.fn().mockReturnValue(throwStream());

            await plugin.runWikiLint();

            expect(plugin.taskQueue.completed.some((t) => t.status === "failed")).toBe(true);
        });
    });

    describe("runWikiGenerate", () => {
        it("success path: completes task, shows notice, and refreshes wiki views", async () => {
            const plugin = await createPlugin();
            await plugin.onload();

            const mockRefresh = vi.fn();
            plugin.app.workspace.getLeavesOfType = vi.fn().mockReturnValue([{ view: { refresh: mockRefresh } }]);

            async function* genStream() {
                yield { event: SSE_EVENT.WIKI_GENERATE_DONE, data: { slug: "test" } };
            }
            plugin.api.wikiGenerate = vi.fn().mockReturnValue(genStream());

            await plugin.runWikiGenerate("notes/foo.md");

            expect(plugin.taskQueue.completed.length).toBeGreaterThan(0);
            expect(Notice.instances.some((n) => n.message.includes("wiki generated for notes/foo.md"))).toBe(true);
            expect(mockRefresh).toHaveBeenCalled();
        });

        it("error path: fails task on WIKI_GENERATE_ERROR event", async () => {
            const plugin = await createPlugin();
            await plugin.onload();

            async function* errStream() {
                yield { event: SSE_EVENT.WIKI_GENERATE_ERROR, data: { message: "bad source" } };
            }
            plugin.api.wikiGenerate = vi.fn().mockReturnValue(errStream());

            await plugin.runWikiGenerate("notes/bad.md");

            expect(plugin.taskQueue.completed.some((t) => t.status === "failed")).toBe(true);
        });

        it("error path: uses fallback message when WIKI_GENERATE_ERROR has no message", async () => {
            const plugin = await createPlugin();
            await plugin.onload();

            async function* errStream() {
                yield { event: SSE_EVENT.WIKI_GENERATE_ERROR, data: {} };
            }
            plugin.api.wikiGenerate = vi.fn().mockReturnValue(errStream());

            await plugin.runWikiGenerate("notes/bad.md");

            expect(plugin.taskQueue.completed.some((t) => t.status === "failed")).toBe(true);
        });

        it("error path: handles non-Error thrown value", async () => {
            const plugin = await createPlugin();
            await plugin.onload();

            async function* throwStream() {
                throw "string error";
                yield;
            }
            plugin.api.wikiGenerate = vi.fn().mockReturnValue(throwStream());

            await plugin.runWikiGenerate("notes/bad.md");

            expect(plugin.taskQueue.completed.some((t) => t.status === "failed")).toBe(true);
        });
    });

    describe("runWikiPrune", () => {
        it("returns early when confirm modal is rejected", async () => {
            mockConfirmModalResult = false;
            const plugin = await createPlugin();
            await plugin.onload();

            plugin.api.wikiPrune = vi.fn();

            await plugin.runWikiPrune();

            expect(plugin.api.wikiPrune).not.toHaveBeenCalled();
            mockConfirmModalResult = true;
        });

        it("success path: completes task, shows notice, and refreshes wiki views", async () => {
            mockConfirmModalResult = true;
            const plugin = await createPlugin();
            await plugin.onload();

            const mockRefresh = vi.fn();
            plugin.app.workspace.getLeavesOfType = vi.fn().mockReturnValue([{ view: { refresh: mockRefresh } }]);

            async function* pruneStream() {
                yield { event: SSE_EVENT.WIKI_PRUNE_DONE, data: { archived: 5 } };
            }
            plugin.api.wikiPrune = vi.fn().mockReturnValue(pruneStream());

            await plugin.runWikiPrune();

            expect(plugin.taskQueue.completed.length).toBeGreaterThan(0);
            expect(Notice.instances.some((n) => n.message.includes("pruned 5 pages"))).toBe(true);
            expect(mockRefresh).toHaveBeenCalled();
        });

        it("error path: fails the task on exception", async () => {
            mockConfirmModalResult = true;
            const plugin = await createPlugin();
            await plugin.onload();

            async function* failStream() {
                throw new Error("prune failed");
                yield;
            }
            plugin.api.wikiPrune = vi.fn().mockReturnValue(failStream());

            await plugin.runWikiPrune();

            expect(plugin.taskQueue.completed.some((t) => t.status === "failed")).toBe(true);
        });

        it("error path: handles non-Error thrown value", async () => {
            mockConfirmModalResult = true;
            const plugin = await createPlugin();
            await plugin.onload();

            async function* throwStream() {
                throw 42;
                yield;
            }
            plugin.api.wikiPrune = vi.fn().mockReturnValue(throwStream());

            await plugin.runWikiPrune();

            expect(plugin.taskQueue.completed.some((t) => t.status === "failed")).toBe(true);
        });

        it("handles prune done event with no archived field", async () => {
            mockConfirmModalResult = true;
            const plugin = await createPlugin();
            await plugin.onload();

            async function* pruneStream() {
                yield { event: SSE_EVENT.WIKI_PRUNE_DONE, data: {} };
            }
            plugin.api.wikiPrune = vi.fn().mockReturnValue(pruneStream());

            await plugin.runWikiPrune();

            expect(Notice.instances.some((n) => n.message.includes("pruned 0 pages"))).toBe(true);
        });
    });

    describe("activateWikiView", () => {
        it("reveals existing wiki leaf when one exists", async () => {
            const plugin = await createPlugin();
            await plugin.onload();

            const existingLeaf = { view: { refresh: vi.fn() } };
            plugin.app.workspace.getLeavesOfType = vi.fn().mockReturnValue([existingLeaf]);

            await plugin.activateWikiView();

            expect(plugin.app.workspace.revealLeaf).toHaveBeenCalledWith(existingLeaf);
        });

        it("creates a new leaf when none exists", async () => {
            const plugin = await createPlugin();
            await plugin.onload();

            plugin.app.workspace.getLeavesOfType = vi.fn().mockReturnValue([]);
            const mockLeaf = new WorkspaceLeaf();
            plugin.app.workspace.getRightLeaf = vi.fn().mockReturnValue(mockLeaf);

            await plugin.activateWikiView();

            expect(mockLeaf.setViewState).toHaveBeenCalledWith({ type: "lilbee-wiki", active: true });
            expect(plugin.app.workspace.revealLeaf).toHaveBeenCalledWith(mockLeaf);
        });
    });

    describe("wiki commands", () => {
        it("wiki command returns false when wikiEnabled is false", async () => {
            const plugin = await createPlugin();
            await plugin.onload();
            (plugin as any).wikiEnabled = false;

            const cmd = (plugin.addCommand as ReturnType<typeof vi.fn>).mock.calls.find(
                (c: any[]) => c[0].id === "lilbee:wiki",
            )![0];
            expect(cmd.checkCallback(true)).toBe(false);
        });

        it("wiki command returns true when wikiEnabled is true", async () => {
            const plugin = await createPlugin();
            await plugin.onload();
            (plugin as any).wikiEnabled = true;

            const cmd = (plugin.addCommand as ReturnType<typeof vi.fn>).mock.calls.find(
                (c: any[]) => c[0].id === "lilbee:wiki",
            )![0];
            expect(cmd.checkCallback(true)).toBe(true);
        });

        it("wiki-lint command returns false when wikiEnabled is false", async () => {
            const plugin = await createPlugin();
            await plugin.onload();
            (plugin as any).wikiEnabled = false;

            const cmd = (plugin.addCommand as ReturnType<typeof vi.fn>).mock.calls.find(
                (c: any[]) => c[0].id === "lilbee:wiki-lint",
            )![0];
            expect(cmd.checkCallback(true)).toBe(false);
        });

        it("wiki-lint command returns true when wikiEnabled is true", async () => {
            const plugin = await createPlugin();
            await plugin.onload();
            (plugin as any).wikiEnabled = true;

            const cmd = (plugin.addCommand as ReturnType<typeof vi.fn>).mock.calls.find(
                (c: any[]) => c[0].id === "lilbee:wiki-lint",
            )![0];
            expect(cmd.checkCallback(true)).toBe(true);
        });

        it("wiki-generate command returns false when wikiEnabled is false", async () => {
            const plugin = await createPlugin();
            await plugin.onload();
            (plugin as any).wikiEnabled = false;

            const cmd = (plugin.addCommand as ReturnType<typeof vi.fn>).mock.calls.find(
                (c: any[]) => c[0].id === "lilbee:wiki-generate",
            )![0];
            expect(cmd.checkCallback(true)).toBe(false);
        });

        it("wiki-generate command returns false when no active file", async () => {
            const plugin = await createPlugin();
            await plugin.onload();
            (plugin as any).wikiEnabled = true;
            plugin.app.workspace.getActiveFile = vi.fn().mockReturnValue(null);

            const cmd = (plugin.addCommand as ReturnType<typeof vi.fn>).mock.calls.find(
                (c: any[]) => c[0].id === "lilbee:wiki-generate",
            )![0];
            expect(cmd.checkCallback(true)).toBe(false);
        });

        it("wiki-generate command returns true when wikiEnabled and active file exists", async () => {
            const plugin = await createPlugin();
            await plugin.onload();
            (plugin as any).wikiEnabled = true;
            plugin.app.workspace.getActiveFile = vi.fn().mockReturnValue({ path: "test.md" });

            const cmd = (plugin.addCommand as ReturnType<typeof vi.fn>).mock.calls.find(
                (c: any[]) => c[0].id === "lilbee:wiki-generate",
            )![0];
            expect(cmd.checkCallback(true)).toBe(true);
        });

        it("wiki command calls activateWikiView when not checking", async () => {
            const plugin = await createPlugin();
            await plugin.onload();
            (plugin as any).wikiEnabled = true;
            const spy = vi.spyOn(plugin, "activateWikiView").mockResolvedValue(undefined);

            const cmd = (plugin.addCommand as ReturnType<typeof vi.fn>).mock.calls.find(
                (c: any[]) => c[0].id === "lilbee:wiki",
            )![0];
            cmd.checkCallback(false);
            expect(spy).toHaveBeenCalled();
        });

        it("wiki-lint command calls runWikiLint when not checking", async () => {
            const plugin = await createPlugin();
            await plugin.onload();
            (plugin as any).wikiEnabled = true;
            const spy = vi.spyOn(plugin, "runWikiLint").mockResolvedValue(undefined);

            const cmd = (plugin.addCommand as ReturnType<typeof vi.fn>).mock.calls.find(
                (c: any[]) => c[0].id === "lilbee:wiki-lint",
            )![0];
            cmd.checkCallback(false);
            expect(spy).toHaveBeenCalled();
        });

        it("wiki-generate command calls runWikiGenerate when not checking", async () => {
            const plugin = await createPlugin();
            await plugin.onload();
            (plugin as any).wikiEnabled = true;
            plugin.app.workspace.getActiveFile = vi.fn().mockReturnValue({ path: "test.md" });
            const spy = vi.spyOn(plugin, "runWikiGenerate").mockResolvedValue(undefined);

            const cmd = (plugin.addCommand as ReturnType<typeof vi.fn>).mock.calls.find(
                (c: any[]) => c[0].id === "lilbee:wiki-generate",
            )![0];
            cmd.checkCallback(false);
            expect(spy).toHaveBeenCalledWith("test.md");
        });
    });

    describe("fetchActiveModel — wiki detection", () => {
        it("sets wikiEnabled from status response", async () => {
            const plugin = await createPlugin();
            await plugin.onload();

            plugin.api.listModels = vi.fn().mockResolvedValue({
                chat: { active: "llama3", installed: ["llama3"], catalog: [] },
                vision: { active: "", installed: [], catalog: [] },
            });
            plugin.api.status = vi.fn().mockResolvedValue({
                isOk: () => true,
                value: { sources: [], total_chunks: 0, wiki: { enabled: true } },
            });

            plugin.fetchActiveModel();
            await new Promise((r) => setTimeout(r, 0));

            expect((plugin as any).wikiEnabled).toBe(true);
            expect(plugin.settings.wikiEnabled).toBe(true);
        });

        it("wikiEnabled stays false when wiki is not in status", async () => {
            const plugin = await createPlugin();
            await plugin.onload();

            plugin.api.listModels = vi.fn().mockResolvedValue({
                chat: { active: "llama3", installed: ["llama3"], catalog: [] },
                vision: { active: "", installed: [], catalog: [] },
            });
            plugin.api.status = vi.fn().mockResolvedValue({
                isOk: () => true,
                value: { sources: [], total_chunks: 0 },
            });

            plugin.fetchActiveModel();
            await new Promise((r) => setTimeout(r, 0));

            expect((plugin as any).wikiEnabled).toBe(false);
        });

        it("wiki detection is best-effort and does not fail on status error", async () => {
            const plugin = await createPlugin();
            await plugin.onload();

            plugin.api.listModels = vi.fn().mockResolvedValue({
                chat: { active: "llama3", installed: ["llama3"], catalog: [] },
                vision: { active: "", installed: [], catalog: [] },
            });
            plugin.api.status = vi.fn().mockRejectedValue(new Error("offline"));

            plugin.fetchActiveModel();
            await new Promise((r) => setTimeout(r, 0));

            // Should not throw, wikiEnabled stays false
            expect((plugin as any).wikiEnabled).toBe(false);
        });
    });

    describe("wiki vault sync", () => {
        it("fetchActiveModel initializes WikiSync when wikiSyncToVault is true", async () => {
            const plugin = await createPlugin({
                serverMode: "external",
                wikiSyncToVault: true,
                wikiVaultFolder: "lilbee-wiki",
            });
            await plugin.onload();

            plugin.api.listModels = vi.fn().mockResolvedValue({
                chat: { active: "llama3", installed: ["llama3"], catalog: [] },
                vision: { active: "", installed: [], catalog: [] },
            });
            plugin.api.status = vi.fn().mockResolvedValue({
                isOk: () => true,
                value: { sources: [], total_chunks: 0, wiki: { enabled: true } },
            });
            plugin.api.wikiList = vi.fn().mockResolvedValue([]);

            // Spy on initWikiSync to avoid adapter cast issues in test env
            const initSpy = vi.spyOn(plugin, "initWikiSync").mockImplementation(() => {
                plugin.wikiSync = { reconcile: vi.fn().mockResolvedValue({ written: 0, removed: 0 }) } as any;
            });

            await plugin.fetchActiveModel();

            expect(initSpy).toHaveBeenCalled();
            expect(plugin.wikiSync).not.toBeNull();
        });

        it("fetchActiveModel skips WikiSync when wikiSyncToVault is false", async () => {
            const plugin = await createPlugin({ serverMode: "external", wikiSyncToVault: false });
            await plugin.onload();

            plugin.api.listModels = vi.fn().mockResolvedValue({
                chat: { active: "llama3", installed: ["llama3"], catalog: [] },
                vision: { active: "", installed: [], catalog: [] },
            });
            plugin.api.status = vi.fn().mockResolvedValue({
                isOk: () => true,
                value: { sources: [], total_chunks: 0, wiki: { enabled: true } },
            });

            plugin.fetchActiveModel();
            await new Promise((r) => setTimeout(r, 0));

            expect(plugin.wikiSync).toBeNull();
        });

        it("reconcileWiki shows notice when pages were written", async () => {
            const plugin = await createPlugin({
                serverMode: "external",
                wikiSyncToVault: true,
                wikiVaultFolder: "lilbee-wiki",
            });
            await plugin.onload();
            Notice.clear();

            plugin.initWikiSync();
            plugin.wikiSync!.reconcile = vi.fn().mockResolvedValue({ written: 3, removed: 1 });

            await plugin.reconcileWiki();

            expect(
                Notice.instances.some(
                    (n: { message: string }) => n.message.includes("3 written") && n.message.includes("1 removed"),
                ),
            ).toBe(true);
        });

        it("reconcileWiki skips notice when nothing changed", async () => {
            const plugin = await createPlugin({
                serverMode: "external",
                wikiSyncToVault: true,
                wikiVaultFolder: "lilbee-wiki",
            });
            await plugin.onload();
            Notice.clear();

            plugin.initWikiSync();
            plugin.wikiSync!.reconcile = vi.fn().mockResolvedValue({ written: 0, removed: 0 });

            await plugin.reconcileWiki();

            expect(Notice.instances).toHaveLength(0);
        });

        it("reconcileWiki is best-effort on error", async () => {
            const plugin = await createPlugin({
                serverMode: "external",
                wikiSyncToVault: true,
                wikiVaultFolder: "lilbee-wiki",
            });
            await plugin.onload();

            plugin.initWikiSync();
            plugin.wikiSync!.reconcile = vi.fn().mockRejectedValue(new Error("fail"));

            await expect(plugin.reconcileWiki()).resolves.not.toThrow();
        });

        it("reconcileWiki no-ops when wikiSync is null", async () => {
            const plugin = await createPlugin();
            await plugin.onload();
            plugin.wikiSync = null;

            await expect(plugin.reconcileWiki()).resolves.not.toThrow();
        });

        it("runWikiGenerate calls reconcileWiki when wikiSync is set", async () => {
            const plugin = await createPlugin({
                serverMode: "external",
                wikiSyncToVault: true,
                wikiVaultFolder: "lilbee-wiki",
            });
            await plugin.onload();

            plugin.initWikiSync();
            const reconcileSpy = vi.spyOn(plugin, "reconcileWiki").mockResolvedValue();

            plugin.api.wikiGenerate = vi.fn().mockImplementation(async function* () {
                yield { event: "wiki_generate_done", data: {} };
            });

            await plugin.runWikiGenerate("test.md");
            expect(reconcileSpy).toHaveBeenCalled();
        });

        it("runWikiGenerate reconcile is fire-and-forget", async () => {
            const plugin = await createPlugin({
                serverMode: "external",
                wikiSyncToVault: true,
                wikiVaultFolder: "lilbee-wiki",
            });
            await plugin.onload();

            plugin.wikiSync = { reconcile: vi.fn(), isWikiPath: vi.fn() } as any;
            const reconcileSpy = vi.spyOn(plugin, "reconcileWiki").mockResolvedValue();

            plugin.api.wikiGenerate = vi.fn().mockImplementation(async function* () {
                yield { event: SSE_EVENT.WIKI_GENERATE_DONE, data: {} };
            });

            await plugin.runWikiGenerate("test.md");
            await new Promise((r) => setTimeout(r, 0));
            expect(reconcileSpy).toHaveBeenCalled();
        });

        it("initWikiSync creates a WikiSync instance", async () => {
            const plugin = await createPlugin({
                serverMode: "external",
                wikiSyncToVault: true,
                wikiVaultFolder: "test-wiki",
            });
            await plugin.onload();

            plugin.initWikiSync();
            expect(plugin.wikiSync).not.toBeNull();
        });

        it("runWikiPrune triggers vault reconcile when wikiSync is set", async () => {
            mockConfirmModalResult = true;
            const plugin = await createPlugin({
                serverMode: "external",
                wikiSyncToVault: true,
                wikiVaultFolder: "lilbee-wiki",
            });
            await plugin.onload();

            plugin.wikiSync = {
                reconcile: vi.fn().mockResolvedValue({ written: 0, removed: 0 }),
                isWikiPath: vi.fn(),
            } as any;

            async function* pruneStream() {
                yield { event: SSE_EVENT.WIKI_PRUNE_DONE, data: { archived: 1 } };
            }
            plugin.api.wikiPrune = vi.fn().mockReturnValue(pruneStream());

            await plugin.runWikiPrune();
            // void reconcileWiki() is fire-and-forget; flush microtasks
            await new Promise((r) => setTimeout(r, 0));

            expect(plugin.wikiSync!.reconcile as ReturnType<typeof vi.fn>).toHaveBeenCalled();
        });

        it("auto-sync excludes wiki folder paths", async () => {
            vi.useFakeTimers();
            const plugin = await createPlugin({
                serverMode: "external",
                syncMode: "auto",
                syncDebounceMs: 100,
                wikiSyncToVault: true,
                wikiVaultFolder: "lilbee-wiki",
            });
            await plugin.onload();
            await vi.runAllTimersAsync();

            plugin.wikiSync = { isWikiPath: (p: string) => p.startsWith("lilbee-wiki/"), reconcile: vi.fn() } as any;
            const syncSpy = vi.spyOn(plugin, "triggerSync").mockResolvedValue();

            // Simulate a vault event for a wiki file
            const vaultHandlers = (plugin.app.vault.on as ReturnType<typeof vi.fn>).mock.calls;
            const createHandler = vaultHandlers.find((c: unknown[]) => c[0] === "create");
            expect(createHandler).toBeDefined();

            createHandler![1]({ path: "lilbee-wiki/summaries/test.md" });
            await vi.advanceTimersByTimeAsync(200);
            expect(syncSpy).not.toHaveBeenCalled();

            // Simulate a vault event for a normal file
            createHandler![1]({ path: "notes/my-note.md" });
            await vi.advanceTimersByTimeAsync(200);
            expect(syncSpy).toHaveBeenCalled();

            vi.useRealTimers();
        });
    });

    describe("updateServer", () => {
        it("stops server, downloads binary, saves version, and restarts", async () => {
            const plugin = await createPlugin({ serverMode: "managed" });
            await plugin.onload();
            await flush();

            const progress: string[] = [];
            await plugin.updateServer({ tag: "v0.3.0", assetUrl: "https://example.com/v0.3.0" }, (msg) =>
                progress.push(msg),
            );

            expect(mockServerStop).toHaveBeenCalled();
            expect(mockDownload).toHaveBeenCalledWith("https://example.com/v0.3.0", expect.any(Function));
            expect(plugin.settings.lilbeeVersion).toBe("v0.3.0");
            expect(progress).toContain("Stopping server...");
            expect(progress).toContain("Downloading...");
            expect(progress).toContain("Starting server...");
            expect(progress).toContain("Update complete.");
        });

        it("creates binaryManager if not present", async () => {
            const plugin = await createPlugin({ serverMode: "external" });
            await plugin.onload();
            await flush();

            expect(plugin.binaryManager).toBeNull();

            await plugin.updateServer({ tag: "v0.3.0", assetUrl: "https://example.com" });

            expect(plugin.binaryManager).not.toBeNull();
            expect(mockDownload).toHaveBeenCalled();
        });

        it("skips restart in external mode", async () => {
            const plugin = await createPlugin({ serverMode: "external" });
            await plugin.onload();
            await flush();

            mockServerStart.mockClear();
            await plugin.updateServer({ tag: "v0.3.0", assetUrl: "https://example.com" });

            expect(mockServerStart).not.toHaveBeenCalled();
            expect(plugin.settings.lilbeeVersion).toBe("v0.3.0");
        });
    });
});
