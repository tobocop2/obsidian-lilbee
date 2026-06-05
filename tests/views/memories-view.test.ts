import { vi, describe, it, expect, beforeEach } from "vitest";
import { WorkspaceLeaf, MockElement, Notice } from "../__mocks__/obsidian";

let confirmResult = true;
vi.mock("../../src/views/confirm-modal", () => ({
    ConfirmModal: vi.fn().mockImplementation(function () {
        return {
            open: vi.fn(),
            close: vi.fn(),
            get result() {
                return Promise.resolve(confirmResult);
            },
        };
    }),
}));

const rememberOpen = vi.fn();
vi.mock("../../src/views/remember-modal", () => ({
    RememberModal: vi.fn().mockImplementation(function () {
        return { open: rememberOpen };
    }),
}));

import { MemoriesView, VIEW_TYPE_MEMORIES } from "../../src/views/memories-view";
import type LilbeePlugin from "../../src/main";
import type { MemoryItem } from "../../src/types";

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

interface ApiOverrides {
    config?: ReturnType<typeof vi.fn>;
    listMemories?: ReturnType<typeof vi.fn>;
    setMemoryShared?: ReturnType<typeof vi.fn>;
    forgetMemory?: ReturnType<typeof vi.fn>;
}

function makeApi(overrides: ApiOverrides = {}) {
    return {
        config: vi.fn().mockResolvedValue({ memory_enabled: true }),
        listMemories: vi.fn().mockResolvedValue([]),
        setMemoryShared: vi.fn().mockResolvedValue({ id: "x", updated: true }),
        forgetMemory: vi.fn().mockResolvedValue({ removed: "x" }),
        ...overrides,
    };
}

function makePlugin(api: ReturnType<typeof makeApi>): LilbeePlugin {
    return { api, settings: { serverMode: "managed" } } as unknown as LilbeePlugin;
}

async function openView(plugin: LilbeePlugin): Promise<{ view: MemoriesView; contentEl: MockElement }> {
    const view = new MemoriesView(new WorkspaceLeaf(), plugin);
    await view.onOpen();
    await flush();
    return { view, contentEl: (view as unknown as { contentEl: MockElement }).contentEl };
}

const FACT: MemoryItem = { id: "a1", kind: "fact", shared: false, text: "likes rust" };
const PREF: MemoryItem = { id: "b2", kind: "preference", shared: true, text: "use british english" };

beforeEach(() => {
    Notice.clear();
    confirmResult = true;
    rememberOpen.mockClear();
});

describe("VIEW_TYPE_MEMORIES", () => {
    it("equals 'lilbee-memories'", () => {
        expect(VIEW_TYPE_MEMORIES).toBe("lilbee-memories");
    });
});

describe("MemoriesView metadata", () => {
    const view = new MemoriesView(new WorkspaceLeaf(), makePlugin(makeApi()));
    it("exposes view type, title, and icon", () => {
        expect(view.getViewType()).toBe("lilbee-memories");
        expect(view.getDisplayText()).toBe("lilbee Memories");
        expect(view.getIcon()).toBe("brain");
    });
});

describe("MemoriesView.onOpen", () => {
    it("renders header, add button, search input, and list", async () => {
        const { contentEl } = await openView(makePlugin(makeApi()));
        expect(contentEl.classList.contains("lilbee-memories-container")).toBe(true);
        expect(contentEl.find("lilbee-memories-header")).not.toBeNull();
        expect(contentEl.find("lilbee-memories-add")).not.toBeNull();
        expect(contentEl.find("lilbee-memories-search")).not.toBeNull();
        expect(contentEl.find("lilbee-memories-list")).not.toBeNull();
    });

    it("shows the empty state when no memories are stored", async () => {
        const { contentEl } = await openView(makePlugin(makeApi()));
        expect(contentEl.find("lilbee-memories-empty")!.textContent).toBe(
            "No memories stored. Use the Remember command to add one.",
        );
    });

    it("renders a row per memory with kind, shared flag, and text", async () => {
        const api = makeApi({ listMemories: vi.fn().mockResolvedValue([FACT, PREF]) });
        const { contentEl } = await openView(makePlugin(api));

        const rows = contentEl.findAll("lilbee-memory-row");
        expect(rows.length).toBe(2);
        expect(contentEl.findAll("lilbee-memory-text").map((e) => e.textContent)).toEqual([
            "likes rust",
            "use british english",
        ]);
        const shares = contentEl.findAll("lilbee-memory-share");
        expect(shares.map((e) => e.textContent)).toEqual(["no", "yes"]);
        const kinds = contentEl.findAll("lilbee-memory-kind");
        expect(kinds.map((e) => e.textContent)).toEqual(["Fact", "Preference"]);
    });

    it("shows the disabled state when memory is off", async () => {
        const api = makeApi({ config: vi.fn().mockResolvedValue({ memory_enabled: false }) });
        const { contentEl } = await openView(makePlugin(api));
        expect(contentEl.find("lilbee-memories-empty")!.textContent).toBe(
            "Memory is off. Enable it in Settings → lilbee → Memory.",
        );
    });

    it("shows a load-failed message when config fails", async () => {
        const api = makeApi({ config: vi.fn().mockRejectedValue(new Error("boom")) });
        const { contentEl } = await openView(makePlugin(api));
        expect(contentEl.find("lilbee-memories-empty")!.textContent).toContain("Failed to load memories: boom");
    });

    it("shows a load-failed message when listing fails", async () => {
        const api = makeApi({ listMemories: vi.fn().mockRejectedValue(new Error("nope")) });
        const { contentEl } = await openView(makePlugin(api));
        expect(contentEl.find("lilbee-memories-empty")!.textContent).toContain("Failed to load memories: nope");
    });
});

describe("MemoriesView search filter", () => {
    it("filters rows by text and shows empty state on no match", async () => {
        const api = makeApi({ listMemories: vi.fn().mockResolvedValue([FACT, PREF]) });
        const { contentEl } = await openView(makePlugin(api));
        const search = contentEl.find("lilbee-memories-search")!;

        search.value = "rust";
        search.trigger("input");
        expect(contentEl.findAll("lilbee-memory-row").length).toBe(1);

        search.value = "nothing-here";
        search.trigger("input");
        expect(contentEl.findAll("lilbee-memory-row").length).toBe(0);
        expect(contentEl.find("lilbee-memories-empty")).not.toBeNull();
    });

    it("ignores search input while memory is disabled", async () => {
        const api = makeApi({ config: vi.fn().mockResolvedValue({ memory_enabled: false }) });
        const { contentEl } = await openView(makePlugin(api));
        const search = contentEl.find("lilbee-memories-search")!;
        search.value = "x";
        expect(() => search.trigger("input")).not.toThrow();
    });
});

describe("MemoriesView actions", () => {
    it("opens the Remember modal from the add button", async () => {
        const { contentEl } = await openView(makePlugin(makeApi()));
        contentEl.find("lilbee-memories-add")!.trigger("click");
        expect(rememberOpen).toHaveBeenCalled();
    });

    it("toggles sharing on and reloads", async () => {
        const api = makeApi({ listMemories: vi.fn().mockResolvedValue([FACT]) });
        const { contentEl } = await openView(makePlugin(api));
        contentEl.find("lilbee-memory-share")!.trigger("click");
        await flush();
        expect(api.setMemoryShared).toHaveBeenCalledWith("a1", true);
        expect(Notice.instances.map((n) => n.message)).toContain("Shared with agents");
    });

    it("toggles sharing off when already shared", async () => {
        const api = makeApi({ listMemories: vi.fn().mockResolvedValue([PREF]) });
        const { contentEl } = await openView(makePlugin(api));
        contentEl.find("lilbee-memory-share")!.trigger("click");
        await flush();
        expect(api.setMemoryShared).toHaveBeenCalledWith("b2", false);
        expect(Notice.instances.map((n) => n.message)).toContain("No longer shared with agents");
    });

    it("notifies on a toggle-shared failure", async () => {
        const api = makeApi({
            listMemories: vi.fn().mockResolvedValue([FACT]),
            setMemoryShared: vi.fn().mockRejectedValue(new Error("down")),
        });
        const { contentEl } = await openView(makePlugin(api));
        contentEl.find("lilbee-memory-share")!.trigger("click");
        await flush();
        expect(Notice.instances.map((n) => n.message)).toContain("Update failed: down");
    });

    it("deletes a memory after confirmation and reloads", async () => {
        confirmResult = true;
        const api = makeApi({ listMemories: vi.fn().mockResolvedValue([FACT]) });
        const { contentEl } = await openView(makePlugin(api));
        contentEl.find("lilbee-memory-delete")!.trigger("click");
        await flush();
        expect(api.forgetMemory).toHaveBeenCalledWith("a1");
        expect(Notice.instances.map((n) => n.message)).toContain("Deleted memory");
    });

    it("does not delete when the confirmation is declined", async () => {
        confirmResult = false;
        const api = makeApi({ listMemories: vi.fn().mockResolvedValue([FACT]) });
        const { contentEl } = await openView(makePlugin(api));
        contentEl.find("lilbee-memory-delete")!.trigger("click");
        await flush();
        expect(api.forgetMemory).not.toHaveBeenCalled();
    });

    it("notifies on a delete failure", async () => {
        confirmResult = true;
        const api = makeApi({
            listMemories: vi.fn().mockResolvedValue([FACT]),
            forgetMemory: vi.fn().mockRejectedValue(new Error("locked")),
        });
        const { contentEl } = await openView(makePlugin(api));
        contentEl.find("lilbee-memory-delete")!.trigger("click");
        await flush();
        expect(Notice.instances.map((n) => n.message)).toContain("Delete failed: locked");
    });
});

describe("MemoriesView load before onOpen", () => {
    it("reload() is a no-op render when the list element is absent", async () => {
        const view = new MemoriesView(new WorkspaceLeaf(), makePlugin(makeApi()));
        await view.reload();
        await flush();
        // No throw, and nothing rendered because onOpen never built the list.
        expect((view as unknown as { listEl: HTMLElement | null }).listEl).toBeNull();
    });

    it("renderMessage is a no-op when disabled before the list element exists", async () => {
        const api = makeApi({ config: vi.fn().mockResolvedValue({ memory_enabled: false }) });
        const view = new MemoriesView(new WorkspaceLeaf(), makePlugin(api));
        await view.reload();
        await flush();
        expect((view as unknown as { listEl: HTMLElement | null }).listEl).toBeNull();
    });
});
