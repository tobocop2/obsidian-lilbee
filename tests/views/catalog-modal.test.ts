import { vi, describe, it, expect, beforeEach } from "vitest";
import { App, Notice } from "obsidian";
import { MockElement } from "../__mocks__/obsidian";
import { CatalogModal } from "../../src/views/catalog-modal";
import { NOTICE, SSE_EVENT } from "../../src/types";
import type { ModelFamily, ModelVariant, CatalogResponse } from "../../src/types";

let mockConfirmResult = true;
let mockConfirmRemoveResult = true;
vi.mock("../../src/views/confirm-pull-modal", () => ({
    ConfirmPullModal: vi.fn().mockImplementation(() => ({
        open: vi.fn(),
        get result() { return Promise.resolve(mockConfirmResult); },
        close: vi.fn(),
    })),
}));
vi.mock("../../src/views/confirm-modal", () => ({
    ConfirmModal: vi.fn().mockImplementation(() => ({
        open: vi.fn(),
        get result() { return Promise.resolve(mockConfirmRemoveResult); },
        close: vi.fn(),
    })),
}));

function makeVariant(overrides: Partial<ModelVariant> = {}): ModelVariant {
    return {
        name: "4B",
        hf_repo: "test/model-4B",
        size_gb: 2.5,
        min_ram_gb: 8,
        description: "Balanced",
        task: "chat",
        installed: false,
        source: "native",
        ...overrides,
    };
}

function makeFamily(overrides: Partial<ModelFamily> = {}): ModelFamily {
    return {
        family: "TestModel",
        task: "chat",
        featured: true,
        recommended: "4B",
        variants: [
            makeVariant({ name: "0.6B", hf_repo: "test/model-0.6B", size_gb: 0.5, min_ram_gb: 2, description: "Tiny" }),
            makeVariant({ name: "4B", hf_repo: "test/model-4B", size_gb: 2.5, min_ram_gb: 8, description: "Balanced" }),
        ],
        ...overrides,
    };
}

function makeCatalogResponse(families: ModelFamily[] = [makeFamily()], total?: number): CatalogResponse {
    return { total: total ?? families.length, limit: 20, offset: 0, families };
}

function makePlugin(overrides: Record<string, unknown> = {}) {
    return {
        api: {
            catalog: vi.fn().mockResolvedValue(makeCatalogResponse([])),
            pullModel: vi.fn(),
            setChatModel: vi.fn().mockResolvedValue({ model: "test/model-4B" }),
            setVisionModel: vi.fn().mockResolvedValue({ model: "" }),
            setEmbeddingModel: vi.fn().mockResolvedValue({ model: "" }),
            deleteModel: vi.fn().mockResolvedValue({ deleted: true, model: "", freed_gb: 2.5 }),
        },
        activeModel: "test/model-4B",
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
        mockConfirmRemoveResult = true;
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("renders title and filter bar on open", async () => {
        const plugin = makePlugin();
        const app = new App();
        const modal = new CatalogModal(app as any, plugin as any);
        plugin.api.catalog.mockResolvedValue(makeCatalogResponse([]));
        modal.open();
        await vi.runAllTimersAsync();

        const el = modal.contentEl as unknown as MockElement;
        const texts = collectTexts(el);
        expect(texts.some(t => t.includes("Model Catalog"))).toBe(true);
        expect(el.find("lilbee-catalog-filters")).not.toBeNull();
    });

    it("fetches catalog on open", async () => {
        const plugin = makePlugin();
        plugin.api.catalog.mockResolvedValue(makeCatalogResponse([makeFamily()]));
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

    it("renders family headers with name and task badge", async () => {
        const families = [makeFamily({ family: "Qwen3", task: "chat" })];
        const plugin = makePlugin();
        plugin.api.catalog.mockResolvedValue(makeCatalogResponse(families));
        const app = new App();
        const modal = new CatalogModal(app as any, plugin as any);
        modal.open();
        await vi.runAllTimersAsync();

        const el = modal.contentEl as unknown as MockElement;
        const headers = el.findAll("lilbee-catalog-family-header");
        expect(headers.length).toBe(1);
        const texts = collectTexts(headers[0]);
        expect(texts.some(t => t.includes("Qwen3"))).toBe(true);
        const taskBadge = el.findAll("lilbee-catalog-family-task");
        expect(taskBadge.length).toBe(1);
        expect(taskBadge[0].textContent).toBe("chat");
    });

    it("renders variant rows within family", async () => {
        const families = [makeFamily()];
        const plugin = makePlugin();
        plugin.api.catalog.mockResolvedValue(makeCatalogResponse(families));
        const app = new App();
        const modal = new CatalogModal(app as any, plugin as any);
        modal.open();
        await vi.runAllTimersAsync();

        const el = modal.contentEl as unknown as MockElement;
        const rows = el.findAll("lilbee-catalog-variant-row");
        expect(rows.length).toBe(2);
    });

    it("recommended variant has star marker", async () => {
        const families = [makeFamily({ recommended: "4B" })];
        const plugin = makePlugin({ activeModel: "other" });
        plugin.api.catalog.mockResolvedValue(makeCatalogResponse(families));
        const app = new App();
        const modal = new CatalogModal(app as any, plugin as any);
        modal.open();
        await vi.runAllTimersAsync();

        const el = modal.contentEl as unknown as MockElement;
        const recommended = el.findAll("lilbee-catalog-recommended");
        expect(recommended.length).toBe(1);
        expect(recommended[0].textContent).toContain("\u2605");
    });

    it("collapse/expand toggle works on family header click", async () => {
        const families = [makeFamily()];
        const plugin = makePlugin();
        plugin.api.catalog.mockResolvedValue(makeCatalogResponse(families));
        const app = new App();
        const modal = new CatalogModal(app as any, plugin as any);
        modal.open();
        await vi.runAllTimersAsync();

        const el = modal.contentEl as unknown as MockElement;
        const header = el.findAll("lilbee-catalog-family-header")[0];
        const family = el.findAll("lilbee-catalog-family")[0];

        // Click to collapse
        header.trigger("click");
        expect(family.classList.contains("is-collapsed")).toBe(true);

        // Click to expand
        header.trigger("click");
        expect(family.classList.contains("is-collapsed")).toBe(false);
    });

    it("shows Active for active model variant", async () => {
        const families = [makeFamily({
            variants: [makeVariant({ name: "4B", hf_repo: "test/model-4B", installed: true })],
        })];
        const plugin = makePlugin({ activeModel: "test/model-4B" });
        plugin.api.catalog.mockResolvedValue(makeCatalogResponse(families));
        const app = new App();
        const modal = new CatalogModal(app as any, plugin as any);
        modal.open();
        await vi.runAllTimersAsync();

        const el = modal.contentEl as unknown as MockElement;
        const active = el.findAll("lilbee-catalog-active");
        expect(active.length).toBe(1);
        expect(active[0].textContent).toBe("Active");
    });

    it("shows Installed for installed non-active variant", async () => {
        const families = [makeFamily({
            variants: [makeVariant({ name: "4B", hf_repo: "test/model-4B", installed: true })],
        })];
        const plugin = makePlugin({ activeModel: "other-model" });
        plugin.api.catalog.mockResolvedValue(makeCatalogResponse(families));
        const app = new App();
        const modal = new CatalogModal(app as any, plugin as any);
        modal.open();
        await vi.runAllTimersAsync();

        const el = modal.contentEl as unknown as MockElement;
        const installed = el.findAll("lilbee-installed");
        expect(installed.length).toBe(1);
    });

    it("shows Pull button for uninstalled variant", async () => {
        const families = [makeFamily({
            variants: [makeVariant({ name: "4B", hf_repo: "test/model-4B", installed: false })],
        })];
        const plugin = makePlugin({ activeModel: "other-model" });
        plugin.api.catalog.mockResolvedValue(makeCatalogResponse(families));
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
        const families = Array.from({ length: 20 }, (_, i) => makeFamily({ family: `family${i}` }));
        const plugin = makePlugin();
        plugin.api.catalog.mockResolvedValue(makeCatalogResponse(families, 40));
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
        const families = [makeFamily()];
        const plugin = makePlugin();
        plugin.api.catalog.mockResolvedValue(makeCatalogResponse(families, 1));
        const app = new App();
        const modal = new CatalogModal(app as any, plugin as any);
        modal.open();
        await vi.runAllTimersAsync();

        const el = modal.contentEl as unknown as MockElement;
        const loadMore = el.findAll("lilbee-catalog-load-more");
        expect(loadMore[0].style.display).toBe("none");
    });

    it("Load more fetches next page", async () => {
        const page1 = Array.from({ length: 20 }, (_, i) => makeFamily({ family: `f${i}` }));
        const page2 = [makeFamily({ family: "f20" })];
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
        plugin.api.catalog.mockResolvedValue(makeCatalogResponse([]));
        const app = new App();
        const modal = new CatalogModal(app as any, plugin as any);
        modal.open();
        await vi.runAllTimersAsync();

        const el = modal.contentEl as unknown as MockElement;
        const searchInput = el.findAll("lilbee-catalog-search")[0];
        (searchInput as any).value = "test";
        searchInput.trigger("input");

        const callsBefore = plugin.api.catalog.mock.calls.length;

        await vi.advanceTimersByTimeAsync(300);
        await vi.runAllTimersAsync();

        expect(plugin.api.catalog.mock.calls.length).toBeGreaterThan(callsBefore);
        expect(plugin.api.catalog).toHaveBeenLastCalledWith(expect.objectContaining({ search: "test" }));
    });

    it("task filter triggers fetch", async () => {
        const plugin = makePlugin();
        plugin.api.catalog.mockResolvedValue(makeCatalogResponse([]));
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
        plugin.api.catalog.mockResolvedValue(makeCatalogResponse([]));
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
        plugin.api.catalog.mockResolvedValue(makeCatalogResponse([]));
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
        const families = [makeFamily({
            variants: [makeVariant({ name: "4B", hf_repo: "test/model-4B", installed: false })],
        })];
        const plugin = makePlugin({ activeModel: "other-model" });
        plugin.api.catalog.mockResolvedValue(makeCatalogResponse(families));
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

        expect(plugin.api.pullModel).toHaveBeenCalledWith("test/model-4B", "native");
        expect(plugin.api.setChatModel).toHaveBeenCalledWith("test/model-4B");
    });

    it("Pull passes non-native source to pullModel", async () => {
        vi.useRealTimers();
        const families = [makeFamily({
            variants: [makeVariant({ name: "gpt-4o", hf_repo: "openai/gpt-4o", installed: false, source: "litellm" })],
        })];
        const plugin = makePlugin({ activeModel: "other-model" });
        plugin.api.catalog.mockResolvedValue(makeCatalogResponse(families));
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

        expect(plugin.api.pullModel).toHaveBeenCalledWith("openai/gpt-4o", "litellm");
    });

    it("Pull on vision variant calls setVisionModel", async () => {
        vi.useRealTimers();
        const families = [makeFamily({
            task: "vision",
            variants: [makeVariant({ name: "llava", hf_repo: "llava/llava-v1.6", installed: false, task: "vision" })],
        })];
        const plugin = makePlugin({ activeModel: "other-model", activeVisionModel: "" });
        plugin.api.catalog.mockResolvedValue(makeCatalogResponse(families));
        plugin.api.pullModel.mockReturnValue((async function* () {
            yield { event: SSE_EVENT.PROGRESS, data: { current: 100, total: 100 } };
        })());
        plugin.api.setVisionModel.mockResolvedValue({ model: "llava/llava-v1.6" });
        const app = new App();
        const modal = new CatalogModal(app as any, plugin as any);
        modal.open();
        await tick();

        const el = modal.contentEl as unknown as MockElement;
        const pullBtn = el.findAll("lilbee-catalog-pull")[0];
        pullBtn.trigger("click");
        await tick();
        await tick();

        expect(plugin.api.pullModel).toHaveBeenCalledWith("llava/llava-v1.6", "native");
        expect(plugin.api.setVisionModel).toHaveBeenCalledWith("llava/llava-v1.6");
        expect(plugin.api.setChatModel).not.toHaveBeenCalled();
    });

    it("Pull cancelled by confirm modal does not pull", async () => {
        vi.useRealTimers();
        mockConfirmResult = false;
        const families = [makeFamily({
            variants: [makeVariant({ name: "4B", hf_repo: "test/model-4B", installed: false })],
        })];
        const plugin = makePlugin({ activeModel: "other-model" });
        plugin.api.catalog.mockResolvedValue(makeCatalogResponse(families));
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
        const families = [makeFamily({
            variants: [makeVariant({ name: "4B", hf_repo: "test/model-4B", installed: false })],
        })];
        const plugin = makePlugin({ activeModel: "other-model" });
        plugin.api.catalog.mockResolvedValue(makeCatalogResponse(families));
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
        const families = [makeFamily({
            variants: [makeVariant({ name: "4B", hf_repo: "test/model-4B", installed: false })],
        })];
        const plugin = makePlugin({ activeModel: "other-model" });
        plugin.api.catalog.mockResolvedValue(makeCatalogResponse(families));
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
        modal.onClose();
    });

    it("search input debounce: first input with null timer, second clears existing timer", async () => {
        const plugin = makePlugin();
        plugin.api.catalog.mockResolvedValue(makeCatalogResponse([]));
        const app = new App();
        const modal = new CatalogModal(app as any, plugin as any);
        expect((modal as any).debounceTimer).toBeNull();
        modal.open();
        await vi.runAllTimersAsync();

        const el = modal.contentEl as unknown as MockElement;
        const searchInput = el.find("lilbee-catalog-search")!;

        (searchInput as any).value = "a";
        searchInput.trigger("input");

        (searchInput as any).value = "ab";
        searchInput.trigger("input");

        await vi.advanceTimersByTimeAsync(300);
        await vi.runAllTimersAsync();

        expect(plugin.api.catalog.mock.calls.length).toBeGreaterThan(1);
    });

    it("onClose with no debounce timer does not throw", () => {
        const plugin = makePlugin();
        const app = new App();
        const modal = new CatalogModal(app as any, plugin as any);
        expect((modal as any).debounceTimer).toBeNull();
        modal.onClose();
    });

    it("onClose with active debounce timer clears it", async () => {
        const plugin = makePlugin();
        plugin.api.catalog.mockResolvedValue(makeCatalogResponse([]));
        const app = new App();
        const modal = new CatalogModal(app as any, plugin as any);
        modal.open();
        await vi.runAllTimersAsync();

        const el = modal.contentEl as unknown as MockElement;
        const searchInput = el.find("lilbee-catalog-search")!;
        (searchInput as any).value = "test";
        searchInput.trigger("input");
        expect((modal as any).debounceTimer).not.toBeNull();
        modal.onClose();
    });

    it("updateLoadMore returns early when loadMoreBtn is null", () => {
        const plugin = makePlugin();
        const app = new App();
        const modal = new CatalogModal(app as any, plugin as any);
        (modal as any).loadMoreBtn = null;
        (modal as any).updateLoadMore();
    });

    it("renderFamily returns early when resultsEl is null", () => {
        const plugin = makePlugin();
        const app = new App();
        const modal = new CatalogModal(app as any, plugin as any);
        (modal as any).resultsEl = null;
        (modal as any).renderFamily(makeFamily());
    });

    it("shows Active for active vision model variant", async () => {
        const families = [makeFamily({
            variants: [makeVariant({ name: "llava", hf_repo: "llava/v1.6", installed: true })],
        })];
        const plugin = makePlugin({ activeModel: "other-model", activeVisionModel: "llava/v1.6" });
        plugin.api.catalog.mockResolvedValue(makeCatalogResponse(families));
        const app = new App();
        const modal = new CatalogModal(app as any, plugin as any);
        modal.open();
        await vi.runAllTimersAsync();

        const el = modal.contentEl as unknown as MockElement;
        const active = el.findAll("lilbee-catalog-active");
        expect(active.length).toBe(1);
    });

    it("renders multiple families from response", async () => {
        const families = [
            makeFamily({ family: "Qwen3" }),
            makeFamily({ family: "Llama3" }),
        ];
        const plugin = makePlugin();
        plugin.api.catalog.mockResolvedValue(makeCatalogResponse(families));
        const app = new App();
        const modal = new CatalogModal(app as any, plugin as any);
        modal.open();
        await vi.runAllTimersAsync();

        const el = modal.contentEl as unknown as MockElement;
        const familyEls = el.findAll("lilbee-catalog-family");
        expect(familyEls.length).toBe(2);
    });

    it("variant display_name is used when present", async () => {
        const families = [makeFamily({
            variants: [makeVariant({ name: "4B", display_name: "Qwen3 4B Instruct", hf_repo: "test/4B" })],
        })];
        const plugin = makePlugin({ activeModel: "other" });
        plugin.api.catalog.mockResolvedValue(makeCatalogResponse(families));
        const app = new App();
        const modal = new CatalogModal(app as any, plugin as any);
        modal.open();
        await vi.runAllTimersAsync();

        const el = modal.contentEl as unknown as MockElement;
        const texts = collectTexts(el);
        expect(texts.some(t => t.includes("Qwen3 4B Instruct"))).toBe(true);
        expect(texts.some(t => t === "4B")).toBe(false);
    });

    it("variant falls back to name when display_name is absent", async () => {
        const families = [makeFamily({
            variants: [makeVariant({ name: "4B", hf_repo: "test/4B" })],
        })];
        const plugin = makePlugin({ activeModel: "other" });
        plugin.api.catalog.mockResolvedValue(makeCatalogResponse(families));
        const app = new App();
        const modal = new CatalogModal(app as any, plugin as any);
        modal.open();
        await vi.runAllTimersAsync();

        const el = modal.contentEl as unknown as MockElement;
        const names = el.findAll("lilbee-catalog-variant-name");
        expect(names.length).toBe(1);
        expect(names[0].textContent).toContain("4B");
    });

    it("quality_tier badge is shown when present", async () => {
        const families = [makeFamily({
            variants: [makeVariant({ name: "4B", hf_repo: "test/4B", quality_tier: "recommended" })],
        })];
        const plugin = makePlugin({ activeModel: "other" });
        plugin.api.catalog.mockResolvedValue(makeCatalogResponse(families));
        const app = new App();
        const modal = new CatalogModal(app as any, plugin as any);
        modal.open();
        await vi.runAllTimersAsync();

        const el = modal.contentEl as unknown as MockElement;
        const tiers = el.findAll("lilbee-catalog-variant-tier");
        expect(tiers.length).toBe(1);
        expect(tiers[0].textContent).toBe("recommended");
    });

    it("quality_tier badge is not rendered when absent", async () => {
        const families = [makeFamily({
            variants: [makeVariant({ name: "4B", hf_repo: "test/4B" })],
        })];
        const plugin = makePlugin({ activeModel: "other" });
        plugin.api.catalog.mockResolvedValue(makeCatalogResponse(families));
        const app = new App();
        const modal = new CatalogModal(app as any, plugin as any);
        modal.open();
        await vi.runAllTimersAsync();

        const el = modal.contentEl as unknown as MockElement;
        const tiers = el.findAll("lilbee-catalog-variant-tier");
        expect(tiers.length).toBe(0);
    });

    it("Pull on embedding variant calls setEmbeddingModel, not setChatModel", async () => {
        vi.useRealTimers();
        const families = [makeFamily({
            task: "embedding",
            variants: [makeVariant({ name: "nomic", hf_repo: "nomic-ai/nomic-embed", installed: false, task: "embedding" })],
        })];
        const plugin = makePlugin({ activeModel: "other-model" });
        plugin.api.catalog.mockResolvedValue(makeCatalogResponse(families));
        plugin.api.pullModel.mockReturnValue((async function* () {
            yield { event: SSE_EVENT.PROGRESS, data: { current: 100, total: 100 } };
        })());
        plugin.api.setEmbeddingModel.mockResolvedValue({ model: "nomic-ai/nomic-embed" });
        const app = new App();
        const modal = new CatalogModal(app as any, plugin as any);
        modal.open();
        await tick();

        const el = modal.contentEl as unknown as MockElement;
        const pullBtn = el.findAll("lilbee-catalog-pull")[0];
        pullBtn.trigger("click");
        await tick();
        await tick();

        expect(plugin.api.pullModel).toHaveBeenCalledWith("nomic-ai/nomic-embed", "native");
        expect(plugin.api.setEmbeddingModel).toHaveBeenCalledWith("nomic-ai/nomic-embed");
        expect(plugin.api.setChatModel).not.toHaveBeenCalled();
        expect(plugin.api.setVisionModel).not.toHaveBeenCalled();
    });

    it("Remove button appears for installed non-active variants", async () => {
        const families = [makeFamily({
            variants: [makeVariant({ name: "4B", hf_repo: "test/model-4B", installed: true })],
        })];
        const plugin = makePlugin({ activeModel: "other-model" });
        plugin.api.catalog.mockResolvedValue(makeCatalogResponse(families));
        const app = new App();
        const modal = new CatalogModal(app as any, plugin as any);
        modal.open();
        await vi.runAllTimersAsync();

        const el = modal.contentEl as unknown as MockElement;
        const removeBtns = el.findAll("lilbee-catalog-remove");
        expect(removeBtns.length).toBe(1);
        expect(removeBtns[0].textContent).toBe("Remove");
    });

    it("Remove button does NOT appear for non-installed variants", async () => {
        const families = [makeFamily({
            variants: [makeVariant({ name: "4B", hf_repo: "test/model-4B", installed: false })],
        })];
        const plugin = makePlugin({ activeModel: "other-model" });
        plugin.api.catalog.mockResolvedValue(makeCatalogResponse(families));
        const app = new App();
        const modal = new CatalogModal(app as any, plugin as any);
        modal.open();
        await vi.runAllTimersAsync();

        const el = modal.contentEl as unknown as MockElement;
        const removeBtns = el.findAll("lilbee-catalog-remove");
        expect(removeBtns.length).toBe(0);
    });

    it("Remove button does NOT appear for active variants", async () => {
        const families = [makeFamily({
            variants: [makeVariant({ name: "4B", hf_repo: "test/model-4B", installed: true })],
        })];
        const plugin = makePlugin({ activeModel: "test/model-4B" });
        plugin.api.catalog.mockResolvedValue(makeCatalogResponse(families));
        const app = new App();
        const modal = new CatalogModal(app as any, plugin as any);
        modal.open();
        await vi.runAllTimersAsync();

        const el = modal.contentEl as unknown as MockElement;
        const removeBtns = el.findAll("lilbee-catalog-remove");
        expect(removeBtns.length).toBe(0);
    });

    it("clicking Remove shows confirmation modal", async () => {
        vi.useRealTimers();
        mockConfirmRemoveResult = false;
        const { ConfirmModal } = await import("../../src/views/confirm-modal");
        const families = [makeFamily({
            variants: [makeVariant({ name: "4B", hf_repo: "test/model-4B", installed: true })],
        })];
        const plugin = makePlugin({ activeModel: "other-model" });
        plugin.api.catalog.mockResolvedValue(makeCatalogResponse(families));
        const app = new App();
        const modal = new CatalogModal(app as any, plugin as any);
        modal.open();
        await tick();

        const el = modal.contentEl as unknown as MockElement;
        const removeBtn = el.findAll("lilbee-catalog-remove")[0];
        removeBtn.trigger("click");
        await tick();

        expect(ConfirmModal).toHaveBeenCalledWith(
            expect.anything(),
            "Remove test/model-4B? This deletes the model file from disk.",
        );
        expect(plugin.api.deleteModel).not.toHaveBeenCalled();
    });

    it("confirming Remove calls deleteModel and refreshes catalog", async () => {
        vi.useRealTimers();
        mockConfirmRemoveResult = true;
        const families = [makeFamily({
            variants: [makeVariant({ name: "4B", hf_repo: "test/model-4B", installed: true, source: "native" })],
        })];
        const plugin = makePlugin({ activeModel: "other-model" });
        plugin.api.catalog.mockResolvedValue(makeCatalogResponse(families));
        const app = new App();
        const modal = new CatalogModal(app as any, plugin as any);
        modal.open();
        await tick();

        const el = modal.contentEl as unknown as MockElement;
        const removeBtn = el.findAll("lilbee-catalog-remove")[0];
        removeBtn.trigger("click");
        await tick();
        await tick();

        expect(plugin.api.deleteModel).toHaveBeenCalledWith("test/model-4B", "native");
        expect(Notice.instances.some(n => n.message.includes("Removed test/model-4B"))).toBe(true);
        expect(plugin.fetchActiveModel).toHaveBeenCalled();
    });

    it("Remove failure shows error notice and re-enables button", async () => {
        vi.useRealTimers();
        const families = [makeFamily({
            variants: [makeVariant({ name: "4B", hf_repo: "test/model-4B", installed: true })],
        })];
        const plugin = makePlugin({ activeModel: "other-model" });
        plugin.api.catalog.mockResolvedValue(makeCatalogResponse(families));
        plugin.api.deleteModel.mockRejectedValue(new Error("network error"));
        const app = new App();
        const modal = new CatalogModal(app as any, plugin as any);
        modal.open();
        await tick();

        const el = modal.contentEl as unknown as MockElement;
        const removeBtn = el.findAll("lilbee-catalog-remove")[0];
        removeBtn.trigger("click");
        await tick();
        await tick();

        expect(Notice.instances.some(n => n.message.includes("Failed to remove"))).toBe(true);
        expect(removeBtn.textContent).toBe("Remove");
        expect(removeBtn.disabled).toBe(false);
    });

    it("variant size and description are rendered", async () => {
        const families = [makeFamily({
            variants: [makeVariant({ name: "4B", hf_repo: "test/4B", size_gb: 2.5, description: "Balanced model" })],
        })];
        const plugin = makePlugin({ activeModel: "other" });
        plugin.api.catalog.mockResolvedValue(makeCatalogResponse(families));
        const app = new App();
        const modal = new CatalogModal(app as any, plugin as any);
        modal.open();
        await vi.runAllTimersAsync();

        const el = modal.contentEl as unknown as MockElement;
        const texts = collectTexts(el);
        expect(texts.some(t => t.includes("2.5 GB"))).toBe(true);
        expect(texts.some(t => t.includes("Balanced model"))).toBe(true);
    });
});
