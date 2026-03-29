import { vi, describe, it, expect, beforeEach } from "vitest";
import { App, Notice } from "obsidian";
import { MockElement } from "../__mocks__/obsidian";
import { CatalogModal } from "../../src/views/catalog-modal";
import { NOTICE, SSE_EVENT } from "../../src/types";
import type { CatalogModel, CatalogResponse } from "../../src/types";

let mockConfirmResult = true;
vi.mock("../../src/views/confirm-pull-modal", () => ({
    ConfirmPullModal: vi.fn().mockImplementation(() => ({
        open: vi.fn(),
        get result() { return Promise.resolve(mockConfirmResult); },
        close: vi.fn(),
    })),
}));

function makeCatalogModel(overrides: Partial<CatalogModel> = {}): CatalogModel {
    return {
        name: "llama3",
        size_gb: 4.7,
        min_ram_gb: 8,
        description: "Meta Llama 3",
        installed: false,
        source: "native",
        ...overrides,
    };
}

function makeCatalogResponse(models: CatalogModel[] = [], total?: number): CatalogResponse {
    return {
        total: total ?? models.length,
        limit: 20,
        offset: 0,
        models,
    };
}

function makePlugin(overrides: Record<string, unknown> = {}) {
    return {
        api: {
            catalog: vi.fn().mockResolvedValue(makeCatalogResponse()),
            pullModel: vi.fn(),
            setChatModel: vi.fn().mockResolvedValue({ model: "llama3" }),
            setVisionModel: vi.fn().mockResolvedValue({ model: "" }),
        },
        activeModel: "llama3",
        activeVisionModel: "",
        fetchActiveModel: vi.fn(),
        ...overrides,
    };
}

function collectTexts(el: MockElement): string[] {
    const texts: string[] = [];
    if (el.textContent) texts.push(el.textContent);
    for (const child of el.children) {
        texts.push(...collectTexts(child));
    }
    return texts;
}

function findButtons(el: MockElement): MockElement[] {
    const buttons: MockElement[] = [];
    if (el.tagName === "BUTTON") buttons.push(el);
    for (const child of el.children) {
        buttons.push(...findButtons(child));
    }
    return buttons;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("CatalogModal", () => {
    beforeEach(() => {
        Notice.clear();
        mockConfirmResult = true;
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("renders title and filter bar on open", async () => {
        const plugin = makePlugin();
        const app = new App();
        const modal = new CatalogModal(app as any, plugin as any);
        plugin.api.catalog.mockResolvedValue(makeCatalogResponse());
        modal.open();
        await vi.runAllTimersAsync();

        const el = modal.contentEl as unknown as MockElement;
        const texts = collectTexts(el);
        expect(texts.some(t => t.includes("Model Catalog"))).toBe(true);
        expect(el.find("lilbee-catalog-filters")).not.toBeNull();
    });

    it("fetches catalog on open", async () => {
        const plugin = makePlugin();
        plugin.api.catalog.mockResolvedValue(makeCatalogResponse([makeCatalogModel()]));
        const app = new App();
        const modal = new CatalogModal(app as any, plugin as any);
        modal.open();
        await vi.runAllTimersAsync();

        expect(plugin.api.catalog).toHaveBeenCalledWith(expect.objectContaining({
            limit: 20,
            offset: 0,
            sort: "featured",
        }));
    });

    it("renders model rows from catalog response", async () => {
        const models = [
            makeCatalogModel({ name: "llama3", installed: true }),
            makeCatalogModel({ name: "phi3", installed: false }),
        ];
        const plugin = makePlugin();
        plugin.api.catalog.mockResolvedValue(makeCatalogResponse(models));
        const app = new App();
        const modal = new CatalogModal(app as any, plugin as any);
        modal.open();
        await vi.runAllTimersAsync();

        const el = modal.contentEl as unknown as MockElement;
        const rows = el.findAll("lilbee-catalog-row");
        expect(rows.length).toBe(2);
    });

    it("shows Active for active model", async () => {
        const models = [makeCatalogModel({ name: "llama3", installed: true })];
        const plugin = makePlugin({ activeModel: "llama3" });
        plugin.api.catalog.mockResolvedValue(makeCatalogResponse(models));
        const app = new App();
        const modal = new CatalogModal(app as any, plugin as any);
        modal.open();
        await vi.runAllTimersAsync();

        const el = modal.contentEl as unknown as MockElement;
        const active = el.findAll("lilbee-catalog-active");
        expect(active.length).toBe(1);
        expect(active[0].textContent).toBe("Active");
    });

    it("shows Installed for installed non-active model", async () => {
        const models = [makeCatalogModel({ name: "phi3", installed: true })];
        const plugin = makePlugin({ activeModel: "llama3" });
        plugin.api.catalog.mockResolvedValue(makeCatalogResponse(models));
        const app = new App();
        const modal = new CatalogModal(app as any, plugin as any);
        modal.open();
        await vi.runAllTimersAsync();

        const el = modal.contentEl as unknown as MockElement;
        const installed = el.findAll("lilbee-installed");
        expect(installed.length).toBe(1);
    });

    it("shows Pull button for uninstalled model", async () => {
        const models = [makeCatalogModel({ name: "phi3", installed: false })];
        const plugin = makePlugin({ activeModel: "llama3" });
        plugin.api.catalog.mockResolvedValue(makeCatalogResponse(models));
        const app = new App();
        const modal = new CatalogModal(app as any, plugin as any);
        modal.open();
        await vi.runAllTimersAsync();

        const el = modal.contentEl as unknown as MockElement;
        const pullBtns = el.findAll("lilbee-catalog-pull");
        expect(pullBtns.length).toBe(1);
        expect(pullBtns[0].textContent).toBe("Pull");
    });

    it("shows Load more button when total > loaded", async () => {
        const models = Array.from({ length: 20 }, (_, i) => makeCatalogModel({ name: `model${i}` }));
        const plugin = makePlugin();
        plugin.api.catalog.mockResolvedValue(makeCatalogResponse(models, 40));
        const app = new App();
        const modal = new CatalogModal(app as any, plugin as any);
        modal.open();
        await vi.runAllTimersAsync();

        const el = modal.contentEl as unknown as MockElement;
        const loadMore = el.findAll("lilbee-catalog-load-more");
        expect(loadMore.length).toBe(1);
        expect(loadMore[0].style.display).toBe("");
    });

    it("hides Load more button when all loaded", async () => {
        const models = [makeCatalogModel()];
        const plugin = makePlugin();
        plugin.api.catalog.mockResolvedValue(makeCatalogResponse(models, 1));
        const app = new App();
        const modal = new CatalogModal(app as any, plugin as any);
        modal.open();
        await vi.runAllTimersAsync();

        const el = modal.contentEl as unknown as MockElement;
        const loadMore = el.findAll("lilbee-catalog-load-more");
        expect(loadMore[0].style.display).toBe("none");
    });

    it("Load more fetches next page", async () => {
        const page1 = Array.from({ length: 20 }, (_, i) => makeCatalogModel({ name: `m${i}` }));
        const page2 = [makeCatalogModel({ name: "m20" })];
        const plugin = makePlugin();
        plugin.api.catalog
            .mockResolvedValueOnce(makeCatalogResponse(page1, 21))
            .mockResolvedValueOnce(makeCatalogResponse(page2, 21));
        const app = new App();
        const modal = new CatalogModal(app as any, plugin as any);
        modal.open();
        await vi.runAllTimersAsync();

        const el = modal.contentEl as unknown as MockElement;
        const loadMore = el.findAll("lilbee-catalog-load-more")[0];
        loadMore.trigger("click");
        await vi.runAllTimersAsync();

        expect(plugin.api.catalog).toHaveBeenCalledTimes(2);
        expect(plugin.api.catalog).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 20 }));
    });

    it("search input triggers debounced fetch", async () => {
        const plugin = makePlugin();
        plugin.api.catalog.mockResolvedValue(makeCatalogResponse());
        const app = new App();
        const modal = new CatalogModal(app as any, plugin as any);
        modal.open();
        await vi.runAllTimersAsync();

        const el = modal.contentEl as unknown as MockElement;
        const searchInput = el.findAll("lilbee-catalog-search")[0];
        (searchInput as any).value = "test";
        searchInput.trigger("input");

        // Should not have fetched yet (debounce)
        const callsBefore = plugin.api.catalog.mock.calls.length;

        await vi.advanceTimersByTimeAsync(300);
        await vi.runAllTimersAsync();

        expect(plugin.api.catalog.mock.calls.length).toBeGreaterThan(callsBefore);
        expect(plugin.api.catalog).toHaveBeenLastCalledWith(expect.objectContaining({ search: "test" }));
    });

    it("task filter triggers fetch", async () => {
        const plugin = makePlugin();
        plugin.api.catalog.mockResolvedValue(makeCatalogResponse());
        const app = new App();
        const modal = new CatalogModal(app as any, plugin as any);
        modal.open();
        await vi.runAllTimersAsync();

        const el = modal.contentEl as unknown as MockElement;
        const taskSelect = el.findAll("lilbee-catalog-filter-task")[0];
        (taskSelect as any).value = "chat";
        taskSelect.trigger("change");
        await vi.runAllTimersAsync();

        expect(plugin.api.catalog).toHaveBeenLastCalledWith(expect.objectContaining({ task: "chat" }));
    });

    it("size filter triggers fetch", async () => {
        const plugin = makePlugin();
        plugin.api.catalog.mockResolvedValue(makeCatalogResponse());
        const app = new App();
        const modal = new CatalogModal(app as any, plugin as any);
        modal.open();
        await vi.runAllTimersAsync();

        const el = modal.contentEl as unknown as MockElement;
        const sizeSelect = el.findAll("lilbee-catalog-filter-size")[0];
        (sizeSelect as any).value = "small";
        sizeSelect.trigger("change");
        await vi.runAllTimersAsync();

        expect(plugin.api.catalog).toHaveBeenLastCalledWith(expect.objectContaining({ size: "small" }));
    });

    it("sort filter triggers fetch", async () => {
        const plugin = makePlugin();
        plugin.api.catalog.mockResolvedValue(makeCatalogResponse());
        const app = new App();
        const modal = new CatalogModal(app as any, plugin as any);
        modal.open();
        await vi.runAllTimersAsync();

        const el = modal.contentEl as unknown as MockElement;
        const sortSelect = el.findAll("lilbee-catalog-filter-sort")[0];
        (sortSelect as any).value = "name";
        sortSelect.trigger("change");
        await vi.runAllTimersAsync();

        expect(plugin.api.catalog).toHaveBeenLastCalledWith(expect.objectContaining({ sort: "name" }));
    });

    it("Pull button opens confirm modal and pulls on confirm", async () => {
        vi.useRealTimers();
        const models = [makeCatalogModel({ name: "phi3", installed: false })];
        const plugin = makePlugin({ activeModel: "llama3" });
        plugin.api.catalog.mockResolvedValue(makeCatalogResponse(models));
        plugin.api.pullModel.mockReturnValue((async function* () {
            yield { event: SSE_EVENT.PROGRESS, data: { current: 50, total: 100 } };
        })());
        const app = new App();
        const modal = new CatalogModal(app as any, plugin as any);
        modal.open();
        await tick();

        const el = modal.contentEl as unknown as MockElement;
        const pullBtn = el.findAll("lilbee-catalog-pull")[0];
        pullBtn.trigger("click");
        await tick();
        await tick();

        expect(plugin.api.pullModel).toHaveBeenCalledWith("phi3", "native");
        expect(plugin.api.setChatModel).toHaveBeenCalledWith("phi3");
    });

    it("Pull passes non-native source to pullModel", async () => {
        vi.useRealTimers();
        const models = [makeCatalogModel({ name: "gpt-4o-mini", installed: false, source: "litellm" })];
        const plugin = makePlugin({ activeModel: "llama3" });
        plugin.api.catalog.mockResolvedValue(makeCatalogResponse(models));
        plugin.api.pullModel.mockReturnValue((async function* () {
            yield { event: SSE_EVENT.PROGRESS, data: { current: 100, total: 100 } };
        })());
        const app = new App();
        const modal = new CatalogModal(app as any, plugin as any);
        modal.open();
        await tick();

        const el = modal.contentEl as unknown as MockElement;
        const pullBtn = el.findAll("lilbee-catalog-pull")[0];
        pullBtn.trigger("click");
        await tick();
        await tick();

        expect(plugin.api.pullModel).toHaveBeenCalledWith("gpt-4o-mini", "litellm");
    });

    it("Pull cancelled by confirm modal does not pull", async () => {
        vi.useRealTimers();
        mockConfirmResult = false;
        const models = [makeCatalogModel({ name: "phi3", installed: false })];
        const plugin = makePlugin({ activeModel: "llama3" });
        plugin.api.catalog.mockResolvedValue(makeCatalogResponse(models));
        const app = new App();
        const modal = new CatalogModal(app as any, plugin as any);
        modal.open();
        await tick();

        const el = modal.contentEl as unknown as MockElement;
        const pullBtn = el.findAll("lilbee-catalog-pull")[0];
        pullBtn.trigger("click");
        await tick();

        expect(plugin.api.pullModel).not.toHaveBeenCalled();
    });

    it("handles pull failure with notice", async () => {
        vi.useRealTimers();
        const models = [makeCatalogModel({ name: "phi3", installed: false })];
        const plugin = makePlugin({ activeModel: "llama3" });
        plugin.api.catalog.mockResolvedValue(makeCatalogResponse(models));
        plugin.api.pullModel.mockReturnValue((async function* () {
            throw new Error("network error");
        })());
        const app = new App();
        const modal = new CatalogModal(app as any, plugin as any);
        modal.open();
        await tick();

        const el = modal.contentEl as unknown as MockElement;
        const pullBtn = el.findAll("lilbee-catalog-pull")[0];
        pullBtn.trigger("click");
        await tick();
        await tick();

        expect(Notice.instances.some(n => n.message.includes("failed to pull"))).toBe(true);
    });

    it("handles AbortError during pull", async () => {
        vi.useRealTimers();
        const models = [makeCatalogModel({ name: "phi3", installed: false })];
        const plugin = makePlugin({ activeModel: "llama3" });
        plugin.api.catalog.mockResolvedValue(makeCatalogResponse(models));
        const abortErr = new Error("aborted");
        abortErr.name = "AbortError";
        plugin.api.pullModel.mockReturnValue((async function* () {
            throw abortErr;
        })());
        const app = new App();
        const modal = new CatalogModal(app as any, plugin as any);
        modal.open();
        await tick();

        const el = modal.contentEl as unknown as MockElement;
        const pullBtn = el.findAll("lilbee-catalog-pull")[0];
        pullBtn.trigger("click");
        await tick();
        await tick();

        expect(Notice.instances.some(n => n.message.includes("cancelled"))).toBe(true);
    });

    it("handles catalog fetch failure", async () => {
        vi.useRealTimers();
        const plugin = makePlugin();
        plugin.api.catalog.mockRejectedValue(new Error("network"));
        const app = new App();
        const modal = new CatalogModal(app as any, plugin as any);
        modal.open();
        await tick();

        expect(Notice.instances.some(n => n.message.includes("failed to load catalog"))).toBe(true);
    });

    it("onClose cleans up debounce timer", () => {
        const plugin = makePlugin();
        const app = new App();
        const modal = new CatalogModal(app as any, plugin as any);
        // Should not throw
        modal.onClose();
    });

    it("search input debounce: first input with null timer, second clears existing timer", async () => {
        const plugin = makePlugin();
        plugin.api.catalog.mockResolvedValue(makeCatalogResponse());
        const app = new App();
        const modal = new CatalogModal(app as any, plugin as any);
        // Ensure debounceTimer is null before open
        expect((modal as any).debounceTimer).toBeNull();
        modal.open();
        await vi.runAllTimersAsync();

        const el = modal.contentEl as unknown as MockElement;
        const searchInput = el.find("lilbee-catalog-search")!;

        // First input: debounceTimer is null (false branch at line 79)
        (searchInput as any).value = "a";
        searchInput.trigger("input");

        // Second input before debounce fires: debounceTimer is set (true branch at line 79)
        (searchInput as any).value = "ab";
        searchInput.trigger("input");

        await vi.advanceTimersByTimeAsync(300);
        await vi.runAllTimersAsync();

        expect(plugin.api.catalog.mock.calls.length).toBeGreaterThan(1);
    });

    it("onClose with no debounce timer does not throw (false branch at line 99)", () => {
        const plugin = makePlugin();
        const app = new App();
        const modal = new CatalogModal(app as any, plugin as any);
        expect((modal as any).debounceTimer).toBeNull();
        // onClose before onOpen — debounceTimer is null
        modal.onClose();
    });

    it("onClose with active debounce timer clears it", async () => {
        const plugin = makePlugin();
        plugin.api.catalog.mockResolvedValue(makeCatalogResponse());
        const app = new App();
        const modal = new CatalogModal(app as any, plugin as any);
        modal.open();
        await vi.runAllTimersAsync();

        const el = modal.contentEl as unknown as MockElement;
        const searchInput = el.find("lilbee-catalog-search")!;
        (searchInput as any).value = "test";
        searchInput.trigger("input");
        // debounceTimer is now set
        expect((modal as any).debounceTimer).not.toBeNull();
        modal.onClose();
    });

    it("updateLoadMore returns early when loadMoreBtn is null", async () => {
        const plugin = makePlugin();
        plugin.api.catalog.mockResolvedValue(makeCatalogResponse([makeCatalogModel()]));
        const app = new App();
        const modal = new CatalogModal(app as any, plugin as any);
        // Set loadMoreBtn to null before calling the private method
        (modal as any).loadMoreBtn = null;
        (modal as any).updateLoadMore();
        // Should not throw
    });

    it("renderRow returns early when resultsEl is null", () => {
        const plugin = makePlugin();
        const app = new App();
        const modal = new CatalogModal(app as any, plugin as any);
        (modal as any).resultsEl = null;
        (modal as any).renderRow(makeCatalogModel());
        // Should not throw
    });

    it("Pull with vision filter sets vision model instead of chat model", async () => {
        vi.useRealTimers();
        const models = [makeCatalogModel({ name: "llava", installed: false })];
        const plugin = makePlugin({ activeModel: "llama3", activeVisionModel: "" });
        plugin.api.catalog.mockResolvedValue(makeCatalogResponse(models));
        plugin.api.pullModel.mockReturnValue((async function* () {
            yield { event: SSE_EVENT.PROGRESS, data: { current: 100, total: 100 } };
        })());
        plugin.api.setVisionModel.mockResolvedValue({ model: "llava" });
        const app = new App();
        const modal = new CatalogModal(app as any, plugin as any);
        (modal as any).filterTask = "vision";
        modal.open();
        await tick();

        const el = modal.contentEl as unknown as MockElement;
        const pullBtn = el.findAll("lilbee-catalog-pull")[0];
        pullBtn.trigger("click");
        await tick();
        await tick();

        expect(plugin.api.pullModel).toHaveBeenCalledWith("llava", "native");
        expect(plugin.api.setVisionModel).toHaveBeenCalledWith("llava");
        expect(plugin.api.setChatModel).not.toHaveBeenCalled();
    });

    it("shows Active for active vision model", async () => {
        const models = [makeCatalogModel({ name: "llava", installed: true })];
        const plugin = makePlugin({ activeModel: "llama3", activeVisionModel: "llava" });
        plugin.api.catalog.mockResolvedValue(makeCatalogResponse(models));
        const app = new App();
        const modal = new CatalogModal(app as any, plugin as any);
        modal.open();
        await vi.runAllTimersAsync();

        const el = modal.contentEl as unknown as MockElement;
        const active = el.findAll("lilbee-catalog-active");
        expect(active.length).toBe(1);
    });
});
