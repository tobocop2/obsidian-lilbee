import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { Notice } from "obsidian";
import { App, WorkspaceLeaf } from "./__mocks__/obsidian";
import { SSE_EVENT } from "../src/types";

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
    })),
    OllamaClient: vi.fn().mockImplementation(() => ({
        pull: vi.fn(),
        delete: vi.fn(),
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

const mockEnsureBinary = vi.fn().mockResolvedValue("/fake/bin/lilbee");
const mockBinaryExists = vi.fn().mockReturnValue(true);
const mockDownload = vi.fn().mockResolvedValue(undefined);
const mockServerStart = vi.fn().mockResolvedValue(undefined);
const mockServerStop = vi.fn().mockResolvedValue(undefined);
const mockUpdateOllamaUrl = vi.fn();
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
    node: { spawn: vi.fn(), execFile: vi.fn(), existsSync: vi.fn(), mkdirSync: vi.fn(), chmodSync: vi.fn(), writeFileSync: vi.fn(), requestUrl: vi.fn() },
}));

vi.mock("../src/server-manager", () => ({
    ServerManager: vi.fn().mockImplementation((opts: any) => {
        mockServerOpts = opts;
        return {
            start: mockServerStart,
            stop: mockServerStop,
            restart: vi.fn(),
            updateOllamaUrl: mockUpdateOllamaUrl,
            updatePort: mockUpdatePort,
            get serverUrl() { return `http://127.0.0.1:${opts.port}`; },
            get state() { return "ready"; },
            opts,
        };
    }),
}));

/** Flush the microtask queue so fire-and-forget promises settle. */
const flush = () => new Promise((r) => setTimeout(r, 0));

async function createPlugin(overrideData?: Record<string, unknown>) {
    const { default: LilbeePlugin } = await import("../src/main");
    const app = new App();
    const plugin = new LilbeePlugin(app as any, {
        id: "lilbee",
        name: "lilbee",
        version: "0.1.0",
        minAppVersion: "1.0.0",
        author: "test",
        description: "test",
    } as any);
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

        it("adds all seven commands", async () => {
            const plugin = await createPlugin();
            await plugin.onload();

            expect(plugin.addCommand).toHaveBeenCalledTimes(7);
            const ids = (plugin.addCommand as ReturnType<typeof vi.fn>).mock.calls.map(
                (c: any[]) => c[0].id,
            );
            expect(ids).toContain("lilbee:search");
            expect(ids).toContain("lilbee:ask");
            expect(ids).toContain("lilbee:chat");
            expect(ids).toContain("lilbee:add-file");
            expect(ids).toContain("lilbee:add-folder");
            expect(ids).toContain("lilbee:sync");
            expect(ids).toContain("lilbee:status");
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

        it("clears autoSyncRefs when switching from auto to manual", async () => {
            const plugin = await createPlugin();
            plugin.loadData = vi.fn().mockResolvedValue({ serverMode: "external", syncMode: "auto" });
            await plugin.onload();

            expect((plugin as any).autoSyncRefs.length).toBe(4);

            plugin.settings.syncMode = "manual";
            await plugin.saveSettings();

            expect((plugin as any).autoSyncRefs.length).toBe(0);
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
            const plugin = new LilbeePlugin(app as any, {
                id: "lilbee",
                name: "lilbee",
                version: "0.1.0",
                minAppVersion: "1.0.0",
                author: "test",
                description: "test",
            } as any);

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

        it("emits progress events to onProgress callback", async () => {
            const plugin = await createPlugin();
            await plugin.onload();

            const progressEvents: any[] = [];
            plugin.onProgress = (event) => progressEvents.push(event);

            async function* withProgress() {
                yield { event: SSE_EVENT.PROGRESS, data: { file: "notes.md", current: 1, total: 5 } };
            }
            plugin.api.syncStream = vi.fn().mockReturnValue(withProgress());

            await plugin.triggerSync();

            expect(progressEvents.some((e) => e.event === SSE_EVENT.PROGRESS)).toBe(true);
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
            const calls = (plugin.addCommand as ReturnType<typeof vi.fn>).mock.calls as Array<[{ id: string; callback: () => void | Promise<void> }]>;
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

            const activateSpy = vi
                .spyOn(plugin as any, "activateChatView")
                .mockResolvedValue(undefined);
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

        it("lilbee:status shows status Notice on success", async () => {
            const plugin = await createPlugin();
            await plugin.onload();

            plugin.api.status = vi.fn().mockResolvedValue({
                sources: [{ filename: "a.md", chunk_count: 3 }, { filename: "b.md", chunk_count: 2 }],
                total_chunks: 5,
                config: {},
            });

            const cb = await getCommandCallback(plugin, "lilbee:status");
            await cb?.();

            expect(Notice.instances.some((n) => n.message.includes("2 documents") && n.message.includes("5 chunks"))).toBe(true);
        });

        it("lilbee:status shows error Notice on API failure", async () => {
            const plugin = await createPlugin();
            await plugin.onload();

            plugin.api.status = vi.fn().mockRejectedValue(new Error("timeout"));

            const cb = await getCommandCallback(plugin, "lilbee:status");
            await cb?.();

            expect(Notice.instances.some((n) => n.message.includes("cannot connect"))).toBe(true);
        });
    });

    describe("registerAutoSync()", () => {
        it("vault event callbacks call debouncedSync", async () => {
            const plugin = await createPlugin();
            plugin.loadData = vi.fn().mockResolvedValue({ serverMode: "external", syncMode: "auto" });

            const debouncedSpy = vi.spyOn(plugin as any, "debouncedSync").mockImplementation(() => {});

            await plugin.onload();

            const vaultOnCalls = (plugin.app.vault.on as ReturnType<typeof vi.fn>).mock.calls as Array<[string, () => void]>;
            expect(vaultOnCalls.length).toBe(4);

            vaultOnCalls[0][1]();
            expect(debouncedSpy).toHaveBeenCalledTimes(1);
        });
    });

    describe("file-menu integration", () => {
        it("registers file-menu event on load", async () => {
            const plugin = await createPlugin();
            await plugin.onload();

            const workspaceOnCalls = (plugin.app.workspace.on as ReturnType<typeof vi.fn>).mock.calls as Array<[string, ...unknown[]]>;
            const fileMenuCall = workspaceOnCalls.find((c) => c[0] === "file-menu");
            expect(fileMenuCall).toBeDefined();
        });

        it("file-menu callback invokes addToLilbee", async () => {
            const plugin = await createPlugin();
            const addSpy = vi.spyOn(plugin as any, "addToLilbee").mockResolvedValue(undefined);
            await plugin.onload();

            const workspaceOnCalls = (plugin.app.workspace.on as ReturnType<typeof vi.fn>).mock.calls as Array<[string, ...unknown[]]>;
            const fileMenuCall = workspaceOnCalls.find((c) => c[0] === "file-menu");
            const callback = fileMenuCall![1] as (menu: any, file: any) => void;

            let menuItemCallback: (() => void) | null = null;
            const fakeMenu = {
                addItem: (cb: (item: any) => void) => {
                    const fakeItem = {
                        setTitle: () => fakeItem,
                        setIcon: () => fakeItem,
                        onClick: (fn: () => void) => { menuItemCallback = fn; return fakeItem; },
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

        it("addToLilbee calls api.addFiles with absolute path", async () => {
            const plugin = await createPlugin();
            await plugin.onload();

            async function* noEvents() {}
            plugin.api.addFiles = vi.fn().mockReturnValue(noEvents());

            await (plugin as any).addToLilbee({ path: "notes/test.md", name: "test.md" });

            expect(plugin.api.addFiles).toHaveBeenCalledWith(["/test/vault/notes/test.md"], false, undefined, expect.any(AbortSignal));
        });

        it("addToLilbee shows summary Notice on done event", async () => {
            const plugin = await createPlugin();
            await plugin.onload();

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

            plugin.api.addFiles = vi.fn().mockImplementation(() => {
                throw new Error("connection refused");
            });

            await (plugin as any).addToLilbee({ path: "test.md", name: "test.md" });

            expect(Notice.instances.some((n) => n.message.includes("add failed"))).toBe(true);
        });

        it("addToLilbee returns early when statusBarEl is null", async () => {
            const plugin = await createPlugin();
            await plugin.onload();
            (plugin as any).statusBarEl = null;

            const addFilesSpy = vi.spyOn(plugin.api, "addFiles");
            await (plugin as any).addToLilbee({ path: "test.md", name: "test.md" });

            expect(addFilesSpy).not.toHaveBeenCalled();
        });

        it("addToLilbee shows 'nothing new' Notice when done has empty arrays", async () => {
            const plugin = await createPlugin();
            await plugin.onload();

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

            async function* noEvents() {}
            plugin.api.addFiles = vi.fn().mockReturnValue(noEvents());

            await (plugin as any).addToLilbee({ path: "deep/test.md" });

            expect(Notice.instances.some((n) => n.message.includes("adding deep/test.md"))).toBe(true);
        });

        it("runAdd shows error message from Error instance", async () => {
            const plugin = await createPlugin();
            await plugin.onload();

            plugin.api.addFiles = vi.fn().mockImplementation(() => {
                throw new Error("server returned 500");
            });

            await (plugin as any).addToLilbee({ path: "test.md", name: "test.md" });

            expect(Notice.instances.some((n) => n.message.includes("server returned 500"))).toBe(true);
        });

        it("runAdd shows fallback message for non-Error throw", async () => {
            const plugin = await createPlugin();
            await plugin.onload();

            plugin.api.addFiles = vi.fn().mockImplementation(() => {
                throw "string error";
            });

            await (plugin as any).addToLilbee({ path: "test.md", name: "test.md" });

            expect(Notice.instances.some((n) => n.message.includes("cannot connect to server"))).toBe(true);
        });

        it("addToLilbee shows failed count in Notice", async () => {
            const plugin = await createPlugin();
            await plugin.onload();

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
        it("calls api.addFiles with the given absolute paths", async () => {
            const plugin = await createPlugin();
            await plugin.onload();

            async function* noEvents() {}
            plugin.api.addFiles = vi.fn().mockReturnValue(noEvents());

            await plugin.addExternalFiles(["/home/user/doc.pdf", "/tmp/notes.md"]);

            expect(plugin.api.addFiles).toHaveBeenCalledWith(["/home/user/doc.pdf", "/tmp/notes.md"], false, undefined, expect.any(AbortSignal));
        });

        it("passes vision model when activeVisionModel is set", async () => {
            const plugin = await createPlugin();
            await plugin.onload();
            plugin.activeVisionModel = "minicpm-v:latest";

            async function* noEvents() {}
            plugin.api.addFiles = vi.fn().mockReturnValue(noEvents());

            await plugin.addExternalFiles(["/home/user/scan.pdf"]);

            expect(plugin.api.addFiles).toHaveBeenCalledWith(
                ["/home/user/scan.pdf"], false, "minicpm-v:latest", expect.any(AbortSignal),
            );
        });

        it("returns early when paths array is empty", async () => {
            const plugin = await createPlugin();
            await plugin.onload();
            plugin.api.addFiles = vi.fn();

            await plugin.addExternalFiles([]);

            expect(plugin.api.addFiles).not.toHaveBeenCalled();
        });

        it("returns early when statusBarEl is null", async () => {
            const plugin = await createPlugin();
            await plugin.onload();
            (plugin as any).statusBarEl = null;
            plugin.api.addFiles = vi.fn();

            await plugin.addExternalFiles(["/some/file.pdf"]);

            expect(plugin.api.addFiles).not.toHaveBeenCalled();
        });

        it("shows summary Notice on done event", async () => {
            const plugin = await createPlugin();
            await plugin.onload();

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

            plugin.api.addFiles = vi.fn().mockImplementation(() => {
                throw new Error("connection refused");
            });

            await plugin.addExternalFiles(["/some/file.pdf"]);

            expect(Notice.instances.some((n) => n.message.includes("add failed"))).toBe(true);
        });

        it("shows failed count in Notice", async () => {
            const plugin = await createPlugin();
            await plugin.onload();

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

    describe("progress event forwarding", () => {
        it("file_start event is forwarded to onProgress callback", async () => {
            const plugin = await createPlugin();
            await plugin.onload();

            const events: any[] = [];
            plugin.onProgress = (e) => events.push(e);

            async function* withFileStart() {
                yield { event: SSE_EVENT.FILE_START, data: { file: "paper.pdf", current_file: 3, total_files: 10 } };
            }
            plugin.api.syncStream = vi.fn().mockReturnValue(withFileStart());

            await plugin.triggerSync();

            expect(events.some((e) => e.event === SSE_EVENT.FILE_START)).toBe(true);
        });

        it("extract event is forwarded to onProgress callback", async () => {
            const plugin = await createPlugin();
            await plugin.onload();

            const events: any[] = [];
            plugin.onProgress = (e) => events.push(e);

            async function* withExtract() {
                yield { event: SSE_EVENT.EXTRACT, data: { file: "paper.pdf", page: 5, total_pages: 50 } };
            }
            plugin.api.syncStream = vi.fn().mockReturnValue(withExtract());

            await plugin.triggerSync();

            expect(events.some((e) => e.event === SSE_EVENT.EXTRACT)).toBe(true);
        });

        it("embed event is forwarded to onProgress callback", async () => {
            const plugin = await createPlugin();
            await plugin.onload();

            const events: any[] = [];
            plugin.onProgress = (e) => events.push(e);

            async function* withEmbed() {
                yield { event: SSE_EVENT.EMBED, data: { file: "paper.pdf", chunk: 30, total_chunks: 100 } };
            }
            plugin.api.syncStream = vi.fn().mockReturnValue(withEmbed());

            await plugin.triggerSync();

            expect(events.some((e) => e.event === SSE_EVENT.EMBED)).toBe(true);
        });

        it("emitProgress no-ops when onProgress is null", async () => {
            const plugin = await createPlugin();
            await plugin.onload();
            plugin.onProgress = null;

            async function* withFileStart() {
                yield { event: SSE_EVENT.FILE_START, data: { file: "x", current_file: 1, total_files: 1 } };
            }
            plugin.api.syncStream = vi.fn().mockReturnValue(withFileStart());

            await expect(plugin.triggerSync()).resolves.not.toThrow();
        });

        it("done event is forwarded to onProgress from runAdd", async () => {
            const plugin = await createPlugin();
            await plugin.onload();

            const events: any[] = [];
            plugin.onProgress = (e) => events.push(e);

            async function* withDone() {
                yield {
                    event: SSE_EVENT.DONE,
                    data: { added: ["a.md"], updated: [], removed: [], failed: [], unchanged: 0 },
                };
            }
            plugin.api.addFiles = vi.fn().mockReturnValue(withDone());

            await (plugin as any).addToLilbee({ path: "test.md", name: "test.md" });

            expect(events.some((e) => e.event === SSE_EVENT.DONE)).toBe(true);
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

        it("status bar includes model name during sync", async () => {
            const plugin = await createPlugin();
            await plugin.onload();
            plugin.activeModel = "llama3";

            const statusTexts: string[] = [];
            const origSetText = (plugin as any).statusBarEl!.setText.bind((plugin as any).statusBarEl);
            (plugin as any).statusBarEl!.setText = (text: string) => {
                statusTexts.push(text);
                origSetText(text);
            };

            async function* noEvents() {}
            plugin.api.syncStream = vi.fn().mockReturnValue(noEvents());

            await plugin.triggerSync();

            expect(statusTexts.some((t) => t.includes("syncing") && t.includes("llama3"))).toBe(true);
        });

        it("updateStatusBar no-ops when statusBarEl is null", async () => {
            const plugin = await createPlugin();
            await plugin.onload();
            (plugin as any).statusBarEl = null;

            expect(() => {
                (plugin as any).updateStatusBar("test");
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

        it("managed mode shows 'unknown error' when ensureBinary throws non-Error", async () => {
            mockEnsureBinary.mockRejectedValueOnce("string error");

            const plugin = await createPlugin({ serverMode: "managed" });
            await plugin.onload();
            await flush();

            expect(Notice.instances.some((n) => n.message.includes("failed to download server"))).toBe(true);
            expect(Notice.instances.some((n) => n.message.includes("unknown error"))).toBe(true);
        });

        it("managed mode shows start error Notice when serverManager.start fails", async () => {
            mockServerStart.mockRejectedValueOnce(new Error("port in use"));

            const plugin = await createPlugin({ serverMode: "managed" });
            await plugin.onload();
            await flush();

            expect(Notice.instances.some((n) => n.message.includes("failed to start server"))).toBe(true);
            expect(Notice.instances.some((n) => n.message.includes("port in use"))).toBe(true);
        });

        it("managed mode shows 'unknown error' when serverManager.start throws non-Error", async () => {
            mockServerStart.mockRejectedValueOnce(42);

            const plugin = await createPlugin({ serverMode: "managed" });
            await plugin.onload();
            await flush();

            expect(Notice.instances.some((n) => n.message.includes("failed to start server"))).toBe(true);
            expect(Notice.instances.some((n) => n.message.includes("unknown error"))).toBe(true);
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

        it("does not show download Notice when binary already exists", async () => {
            mockBinaryExists.mockReturnValueOnce(true);

            const plugin = await createPlugin({ serverMode: "managed" });
            await plugin.onload();
            await flush();

            const downloadNotices = Notice.instances.filter(
                (n) => n.message.includes("fetching server binary") || n.message.includes("server binary ready"),
            );
            expect(downloadNotices.length).toBe(0);
        });

        it("shows persistent download Notice when binary is missing", async () => {
            mockBinaryExists.mockReturnValueOnce(false);

            const plugin = await createPlugin({ serverMode: "managed" });
            await plugin.onload();
            await flush();

            const fetchNotice = Notice.instances.find((n) => n.duration === 0);
            expect(fetchNotice).toBeDefined();
            expect(fetchNotice!.hidden).toBe(true); // hidden after completion
        });

        it("shows success Notice after download completes", async () => {
            mockBinaryExists.mockReturnValueOnce(false);

            const plugin = await createPlugin({ serverMode: "managed" });
            await plugin.onload();
            await flush();

            expect(Notice.instances.some((n) => n.message.includes("server binary ready"))).toBe(true);
        });

        it("progress callback updates both status bar and download Notice", async () => {
            mockBinaryExists.mockReturnValueOnce(false);
            mockEnsureBinary.mockImplementationOnce(async (cb: any) => {
                cb?.("Downloading 25%");
                cb?.("Downloading 75%");
                return "/fake/bin/lilbee";
            });

            const plugin = await createPlugin({ serverMode: "managed" });
            await plugin.onload();
            await flush();

            const persistentNotice = Notice.instances.find((n) => n.duration === 0);
            expect(persistentNotice).toBeDefined();
            expect(persistentNotice!.message).toBe("lilbee: Downloading 75%");
        });

        it("hides download Notice on ensureBinary failure", async () => {
            mockBinaryExists.mockReturnValueOnce(false);
            mockEnsureBinary.mockRejectedValueOnce(new Error("network error"));

            const plugin = await createPlugin({ serverMode: "managed" });
            await plugin.onload();
            await flush();

            const persistentNotice = Notice.instances.find((n) => n.duration === 0);
            expect(persistentNotice).toBeDefined();
            expect(persistentNotice!.hidden).toBe(true);
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
            (getLatestRelease as ReturnType<typeof vi.fn>).mockResolvedValue({ tag: "v0.5.1", assetUrl: "https://example.com" });

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

        it("sets status bar to error when serverManager.start fails", async () => {
            mockServerStart.mockRejectedValueOnce(new Error("crash"));

            const plugin = await createPlugin({ serverMode: "managed" });
            await plugin.onload();
            await flush();

            expect((plugin as any).statusBarEl?.textContent).toContain("error");
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

        it("managed → managed with serverManager: updates port and ollama url", async () => {
            const plugin = await createPlugin({ serverMode: "managed" });
            await plugin.onload();
            await flush();

            plugin.settings.ollamaUrl = "http://custom:11434";
            plugin.settings.serverPort = 9999;
            await plugin.saveSettings();

            expect(mockUpdateOllamaUrl).toHaveBeenCalledWith("http://custom:11434");
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

            const abortError = new Error("Aborted");
            abortError.name = "AbortError";
            plugin.api.addFiles = vi.fn().mockImplementation(async function* () {
                throw abortError;
            });

            await (plugin as any).addToLilbee({ path: "test.md", name: "test.md" });

            expect(Notice.instances.some((n) => n.message.includes("add cancelled"))).toBe(true);
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
            (getLatestRelease as ReturnType<typeof vi.fn>).mockResolvedValue({ tag: "v0.2.0", assetUrl: "https://example.com" });
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
            (getLatestRelease as ReturnType<typeof vi.fn>).mockResolvedValue({ tag: "v0.1.0", assetUrl: "https://example.com" });
            (checkForUpdate as ReturnType<typeof vi.fn>).mockReturnValue(false);

            const plugin = await createPlugin({ serverMode: "managed", lilbeeVersion: "v0.1.0" });
            await plugin.onload();
            await flush();

            const result = await plugin.checkForUpdate();
            expect(result.available).toBe(false);
        });
    });

    describe("updateServer", () => {
        it("stops server, downloads binary, saves version, and restarts", async () => {
            const plugin = await createPlugin({ serverMode: "managed" });
            await plugin.onload();
            await flush();

            const progress: string[] = [];
            await plugin.updateServer(
                { tag: "v0.3.0", assetUrl: "https://example.com/v0.3.0" },
                (msg) => progress.push(msg),
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
