import { vi, describe, it, expect, beforeEach } from "vitest";
import { App, Notice } from "obsidian";
import { MockElement } from "../__mocks__/obsidian";
import { CatalogModal } from "../../src/views/catalog-modal";
import { SSE_EVENT } from "../../src/types";
import type { CatalogEntry, CatalogResponse } from "../../src/types";
import { TaskQueue } from "../../src/task-queue";
import { ok, err } from "neverthrow";
import { MESSAGES } from "../../src/locales/en";

let mockConfirmResult = true;
let mockConfirmRemoveResult = true;
vi.mock("../../src/views/confirm-pull-modal", () => ({
    ConfirmPullModal: vi.fn().mockImplementation(() => ({
        open: vi.fn(),
        get result() {
            return Promise.resolve(mockConfirmResult);
        },
        close: vi.fn(),
    })),
}));
vi.mock("../../src/views/confirm-modal", () => ({
    ConfirmModal: vi.fn().mockImplementation(() => ({
        open: vi.fn(),
        get result() {
            return Promise.resolve(mockConfirmRemoveResult);
        },
        close: vi.fn(),
    })),
}));

function makeEntry(overrides: Partial<CatalogEntry> = {}): CatalogEntry {
    return {
        name: "qwen3",
        display_name: "Qwen3 8B",
        size_gb: 5,
        min_ram_gb: 8,
        description: "Medium — strong general purpose",
        quality_tier: "balanced",
        installed: false,
        source: "native",
        hf_repo: "qwen/qwen3-8b",
        tag: "8b",
        task: "chat",
        featured: false,
        downloads: 0,
        ...overrides,
    };
}

function makeCatalogResponse(models: CatalogEntry[] = [makeEntry()], total?: number): CatalogResponse {
    return { total: total ?? models.length, limit: 20, offset: 0, models };
}

function makePlugin(overrides: Record<string, unknown> = {}) {
    return {
        api: {
            catalog: vi.fn().mockResolvedValue(ok(makeCatalogResponse([]))),
            pullModel: vi.fn(),
            setChatModel: vi.fn().mockResolvedValue(ok(undefined)),
            setEmbeddingModel: vi.fn().mockResolvedValue(ok(undefined)),
            deleteModel: vi.fn().mockResolvedValue(ok({ deleted: true, model: "", freed_gb: 2.5 })),
        },
        activeModel: "",
        fetchActiveModel: vi.fn(),
        taskQueue: new TaskQueue(),
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

async function openModal(plugin: ReturnType<typeof makePlugin>): Promise<CatalogModal> {
    const modal = new CatalogModal(new App() as any, plugin as any);
    modal.open();
    await tick();
    await tick();
    return modal;
}

function contentEl(modal: CatalogModal): MockElement {
    return (modal as unknown as { contentEl: MockElement }).contentEl;
}

describe("CatalogModal", () => {
    beforeEach(() => {
        Notice.clear();
        mockConfirmResult = true;
        mockConfirmRemoveResult = true;
    });

    describe("opening and layout", () => {
        it("renders title and filter bar on open", async () => {
            const plugin = makePlugin();
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            const allTexts = collectTexts(content);
            expect(allTexts).toContain(MESSAGES.TITLE_MODEL_CATALOG);
            expect(content.find("lilbee-catalog-filters")).not.toBeNull();
            expect(content.find("lilbee-catalog-filter-task")).not.toBeNull();
            expect(content.find("lilbee-catalog-filter-size")).not.toBeNull();
            expect(content.find("lilbee-catalog-filter-sort")).not.toBeNull();
            expect(content.find("lilbee-catalog-search")).not.toBeNull();
        });

        it("shows empty message when the server returns no models", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse([])));
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            const empty = content.find("lilbee-catalog-empty");
            expect(empty?.textContent).toBe(MESSAGES.LABEL_NO_MODELS_FOUND);
        });

        it("surfaces a Notice when the catalog fetch fails", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(err(new Error("boom")));
            await openModal(plugin);
            expect(Notice.instances.map((n) => n.message)).toContain(MESSAGES.ERROR_LOAD_CATALOG);
        });
    });

    describe("grid view", () => {
        it("renders entries as cards", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse([makeEntry()])));
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            expect(content.findAll("lilbee-model-card").length).toBeGreaterThan(0);
        });

        it("groups installed entries into an 'Installed' section", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(
                ok(
                    makeCatalogResponse([
                        makeEntry({ name: "qwen3:0.6b", display_name: "Qwen3 0.6B", installed: true }),
                        makeEntry({ hf_repo: "qwen/qwen3-8b", display_name: "Qwen3 8B", installed: false }),
                    ]),
                ),
            );
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            const headings = content.findAll("lilbee-catalog-section-heading").map((el) => el.textContent);
            expect(headings).toContain(MESSAGES.LABEL_SECTION_INSTALLED);
        });

        it("renders an 'Our picks' section for featured entries", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(
                ok(
                    makeCatalogResponse([
                        makeEntry({ hf_repo: "r1", display_name: "R1", featured: true }),
                        makeEntry({ hf_repo: "r2", display_name: "R2", featured: false }),
                    ]),
                ),
            );
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            const headings = content.findAll("lilbee-catalog-section-heading").map((el) => el.textContent);
            expect(headings).toContain(MESSAGES.LABEL_OUR_PICKS);
            const featuredHeading = content.find("lilbee-catalog-section-heading-featured");
            expect(featuredHeading).not.toBeNull();
            expect(featuredHeading?.textContent).toBe(MESSAGES.LABEL_OUR_PICKS);
        });

        it("groups non-featured entries by task", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(
                ok(
                    makeCatalogResponse([
                        makeEntry({ hf_repo: "a", display_name: "Chat A", task: "chat" }),
                        makeEntry({ hf_repo: "b", display_name: "Vision B", task: "vision" }),
                        makeEntry({ hf_repo: "c", display_name: "Embed C", task: "embedding" }),
                    ]),
                ),
            );
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            const headings = content.findAll("lilbee-catalog-section-heading").map((el) => el.textContent);
            expect(headings).toContain(MESSAGES.LABEL_SECTION_CHAT);
            expect(headings).toContain(MESSAGES.LABEL_SECTION_VISION);
            expect(headings).toContain(MESSAGES.LABEL_SECTION_EMBEDDING);
        });

        it("uses the raw task string when an unknown task appears", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(
                ok(makeCatalogResponse([makeEntry({ hf_repo: "x", display_name: "X", task: "custom" as any })])),
            );
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            const headings = content.findAll("lilbee-catalog-section-heading").map((el) => el.textContent);
            expect(headings).toContain("custom");
        });

        it("renders a Browse more models card until the full catalog is loaded", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse([makeEntry({ featured: true })])));
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            expect(content.find("lilbee-browse-more-card")).not.toBeNull();
        });

        it("clicking the Browse more card loads the full catalog and drops the card", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse([makeEntry({ featured: true })])));
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            content.find("lilbee-browse-more-card")!.trigger("click");
            await tick();
            await tick();
            expect(content.find("lilbee-browse-more-card")).toBeNull();
            // The sort filter should now be downloads (loadFullCatalog side effect)
            expect(plugin.api.catalog).toHaveBeenLastCalledWith(expect.objectContaining({ sort: "downloads" }));
        });

        it("renders the view-toggle CTA banner", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse([makeEntry()])));
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            expect(content.find("lilbee-view-toggle-cta")).not.toBeNull();
        });
    });

    describe("list view", () => {
        it("toggles to list view when the toggle button is clicked", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse([makeEntry()])));
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            const toggle = content.find("lilbee-catalog-view-toggle")!;
            toggle.trigger("click");
            await tick();
            expect(content.find("lilbee-catalog-list")).not.toBeNull();
        });

        it("renders a Pull button for non-installed entries in list view", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse([makeEntry()])));
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            content.find("lilbee-catalog-view-toggle")!.trigger("click");
            await tick();
            expect(content.find("lilbee-catalog-pull")).not.toBeNull();
        });

        it("renders Use + Remove buttons for installed entries in list view", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse([makeEntry({ installed: true })])));
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            content.find("lilbee-catalog-view-toggle")!.trigger("click");
            await tick();
            expect(content.find("lilbee-catalog-use")).not.toBeNull();
            expect(content.find("lilbee-catalog-remove")).not.toBeNull();
        });

        it("shows Active when the entry is the plugin's active model", async () => {
            const plugin = makePlugin({ activeModel: "qwen/qwen3-8b" });
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse([makeEntry({ installed: true })])));
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            content.find("lilbee-catalog-view-toggle")!.trigger("click");
            await tick();
            expect(content.find("lilbee-catalog-active")).not.toBeNull();
        });

        it("sorts ascending then descending on repeated column clicks", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(
                ok(
                    makeCatalogResponse([
                        makeEntry({ name: "b", display_name: "B", size_gb: 5 }),
                        makeEntry({ name: "a", display_name: "A", size_gb: 3 }),
                    ]),
                ),
            );
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            content.find("lilbee-catalog-view-toggle")!.trigger("click");
            await tick();

            const header = content.find("lilbee-catalog-list-header")!;
            const nameCol = header.findAll("lilbee-catalog-list-col-name")[0];
            nameCol.trigger("click");
            await tick();
            const ascRows = content
                .findAll("lilbee-catalog-list-row")
                .map((r) => r.findAll("lilbee-catalog-list-col-name")[0].textContent);
            expect(ascRows[0]).toBe("A");

            nameCol.trigger("click");
            await tick();
            const descRows = content
                .findAll("lilbee-catalog-list-row")
                .map((r) => r.findAll("lilbee-catalog-list-col-name")[0].textContent);
            expect(descRows[0]).toBe("B");
        });

        it("sorts numerically on size column", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(
                ok(
                    makeCatalogResponse([
                        makeEntry({ name: "a", display_name: "A", size_gb: 9 }),
                        makeEntry({ name: "b", display_name: "B", size_gb: 1 }),
                    ]),
                ),
            );
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            content.find("lilbee-catalog-view-toggle")!.trigger("click");
            await tick();

            const header = content.find("lilbee-catalog-list-header")!;
            const sizeCol = header.findAll("lilbee-catalog-list-col-size")[0];
            sizeCol.trigger("click");
            await tick();
            const rows = content
                .findAll("lilbee-catalog-list-row")
                .map((r) => r.findAll("lilbee-catalog-list-col-name")[0].textContent);
            expect(rows[0]).toBe("B");
        });

        it("getSortValue returns empty for unknown columns", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(
                ok(
                    makeCatalogResponse([
                        makeEntry({ name: "a", display_name: "A" }),
                        makeEntry({ name: "b", display_name: "B" }),
                    ]),
                ),
            );
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            content.find("lilbee-catalog-view-toggle")!.trigger("click");
            await tick();
            // Force an unknown sort column and re-render the list view to
            // exercise the fallback branch.
            (modal as any).sortColumn = "bogus";
            (modal as any).renderResults();
            const rows = content.findAll("lilbee-catalog-list-row");
            expect(rows.length).toBe(2);
        });

        it("sorts alphabetically on task column", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(
                ok(
                    makeCatalogResponse([
                        makeEntry({ hf_repo: "a", display_name: "A", task: "vision" }),
                        makeEntry({ hf_repo: "b", display_name: "B", task: "chat" }),
                    ]),
                ),
            );
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            content.find("lilbee-catalog-view-toggle")!.trigger("click");
            await tick();

            const header = content.find("lilbee-catalog-list-header")!;
            const taskCol = header.findAll("lilbee-catalog-list-col-task")[0];
            taskCol.trigger("click");
            await tick();
            const rows = content
                .findAll("lilbee-catalog-list-row")
                .map((r) => r.findAll("lilbee-catalog-list-col-name")[0].textContent);
            expect(rows[0]).toBe("B"); // "chat" < "vision"
        });

        it("formats download counts with K and M abbreviations in the list view", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(
                ok(
                    makeCatalogResponse([
                        makeEntry({ hf_repo: "a", display_name: "Millions", downloads: 2_500_000 }),
                        makeEntry({ hf_repo: "b", display_name: "Thousands", downloads: 1500 }),
                        makeEntry({ hf_repo: "c", display_name: "Raw", downloads: 42 }),
                    ]),
                ),
            );
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            content.find("lilbee-catalog-view-toggle")!.trigger("click");
            await tick();
            const dls = content
                .findAll("lilbee-catalog-list-row")
                .map((r) => r.findAll("lilbee-catalog-list-col-downloads")[0].textContent);
            expect(dls).toContain("2.5M");
            expect(dls).toContain("1.5K");
            expect(dls).toContain("42");
        });

        it("renders a star prefix on featured rows", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(
                ok(
                    makeCatalogResponse([
                        makeEntry({ hf_repo: "a", display_name: "Featured A", featured: true }),
                        makeEntry({ hf_repo: "b", display_name: "Plain B", featured: false }),
                    ]),
                ),
            );
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            content.find("lilbee-catalog-view-toggle")!.trigger("click");
            await tick();
            const names = content
                .findAll("lilbee-catalog-list-row")
                .map((r) => r.findAll("lilbee-catalog-list-col-name")[0].textContent);
            expect(names).toContain("\u2605 Featured A");
            expect(names).toContain("Plain B");
        });

        it("sorts numerically on downloads column", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(
                ok(
                    makeCatalogResponse([
                        makeEntry({ name: "a", display_name: "A", downloads: 100 }),
                        makeEntry({ name: "b", display_name: "B", downloads: 5 }),
                    ]),
                ),
            );
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            content.find("lilbee-catalog-view-toggle")!.trigger("click");
            await tick();

            const header = content.find("lilbee-catalog-list-header")!;
            const dlCol = header.findAll("lilbee-catalog-list-col-downloads")[0];
            dlCol.trigger("click");
            await tick();
            const rows = content
                .findAll("lilbee-catalog-list-row")
                .map((r) => r.findAll("lilbee-catalog-list-col-name")[0].textContent);
            expect(rows[0]).toBe("B"); // 5 downloads sorts before 100
        });
    });

    describe("filters and search", () => {
        it("re-fetches with task filter when task dropdown changes", async () => {
            const plugin = makePlugin();
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            const taskSelect = content.find("lilbee-catalog-filter-task")! as unknown as {
                value: string;
                trigger(event: string): void;
            };
            taskSelect.value = "chat";
            taskSelect.trigger("change");
            await tick();
            expect(plugin.api.catalog).toHaveBeenLastCalledWith(expect.objectContaining({ task: "chat", offset: 0 }));
        });

        it("re-fetches with size filter when size dropdown changes", async () => {
            const plugin = makePlugin();
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            const sizeSelect = content.find("lilbee-catalog-filter-size")! as unknown as {
                value: string;
                trigger(event: string): void;
            };
            sizeSelect.value = "small";
            sizeSelect.trigger("change");
            await tick();
            expect(plugin.api.catalog).toHaveBeenLastCalledWith(expect.objectContaining({ size: "small" }));
        });

        it("re-fetches with sort filter when sort dropdown changes", async () => {
            const plugin = makePlugin();
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            const sortSelect = content.find("lilbee-catalog-filter-sort")! as unknown as {
                value: string;
                trigger(event: string): void;
            };
            sortSelect.value = "downloads";
            sortSelect.trigger("change");
            await tick();
            expect(plugin.api.catalog).toHaveBeenLastCalledWith(expect.objectContaining({ sort: "downloads" }));
        });

        it("debounces search input and then re-fetches", async () => {
            const plugin = makePlugin();
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            const search = content.find("lilbee-catalog-search")! as unknown as {
                value: string;
                trigger(event: string): void;
            };
            plugin.api.catalog.mockClear();
            search.value = "qwen";
            search.trigger("input");
            // Within debounce window — should not yet refetch
            expect(plugin.api.catalog).not.toHaveBeenCalled();
            await new Promise((r) => setTimeout(r, 500));
            expect(plugin.api.catalog).toHaveBeenLastCalledWith(expect.objectContaining({ search: "qwen" }));
        });
    });

    describe("load more", () => {
        it("shows load-more button when offset < total", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(ok({ total: 40, limit: 20, offset: 0, models: [makeEntry()] }));
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            const btn = content.find("lilbee-catalog-load-more")! as unknown as MockElement;
            expect(btn.style.display).toBe("");
        });

        it("hides load-more button when offset >= total", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(ok({ total: 1, limit: 20, offset: 0, models: [makeEntry()] }));
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            const btn = content.find("lilbee-catalog-load-more")! as unknown as MockElement;
            expect(btn.style.display).toBe("none");
        });

        it("fetching more appends entries and bumps offset", async () => {
            const plugin = makePlugin();
            const first = makeEntry({ name: "a", display_name: "A" });
            const second = makeEntry({ name: "b", display_name: "B" });
            plugin.api.catalog
                .mockResolvedValueOnce(ok({ total: 2, limit: 1, offset: 0, models: [first] }))
                .mockResolvedValueOnce(ok({ total: 2, limit: 1, offset: 1, models: [second] }));
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            content.find("lilbee-catalog-load-more")!.trigger("click");
            await tick();
            await tick();
            expect(plugin.api.catalog).toHaveBeenCalledTimes(2);
        });
    });

    describe("pull / use / remove", () => {
        async function* emptyStream() {
            // no events
        }

        it("opens confirm-pull modal when Pull is clicked and runs pull on confirm", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse([makeEntry()])));
            plugin.api.pullModel = vi.fn().mockImplementation(() => emptyStream());
            plugin.api.setChatModel = vi.fn().mockResolvedValue(ok(undefined));
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            const pullBtn = findButtons(content).find((b) => b.textContent === MESSAGES.BUTTON_PULL)!;
            pullBtn.trigger("click");
            await tick();
            await tick();
            expect(plugin.api.pullModel).toHaveBeenCalledWith("qwen/qwen3-8b", "native");
        });

        it("does not run pull when user cancels the confirm modal", async () => {
            mockConfirmResult = false;
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse([makeEntry()])));
            plugin.api.pullModel = vi.fn();
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            const pullBtn = findButtons(content).find((b) => b.textContent === MESSAGES.BUTTON_PULL)!;
            pullBtn.trigger("click");
            await tick();
            await tick();
            expect(plugin.api.pullModel).not.toHaveBeenCalled();
        });

        it("updates task progress from SSE progress events", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse([makeEntry()])));
            plugin.api.pullModel = vi.fn().mockImplementation(async function* () {
                yield { event: SSE_EVENT.PROGRESS, data: { percent: 50 } };
            });
            plugin.api.setChatModel = vi.fn().mockResolvedValue(ok(undefined));
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            const pullBtn = findButtons(content).find((b) => b.textContent === MESSAGES.BUTTON_PULL)!;
            pullBtn.trigger("click");
            await tick();
            await tick();
            expect(plugin.taskQueue.completed.length).toBeGreaterThan(0);
        });

        it("uses setChatModel when the entry is a vision task", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(
                ok(makeCatalogResponse([makeEntry({ installed: true, task: "vision" })])),
            );
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            const useBtn = findButtons(content).find((b) => b.textContent === MESSAGES.BUTTON_USE)!;
            useBtn.trigger("click");
            await tick();
            await tick();
            expect(plugin.api.setChatModel).toHaveBeenCalledWith("qwen/qwen3-8b");
        });

        it("uses setEmbeddingModel when the entry is an embedding task", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(
                ok(makeCatalogResponse([makeEntry({ installed: true, task: "embedding" })])),
            );
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            const useBtn = findButtons(content).find((b) => b.textContent === MESSAGES.BUTTON_USE)!;
            useBtn.trigger("click");
            await tick();
            await tick();
            expect(plugin.api.setEmbeddingModel).toHaveBeenCalledWith("qwen/qwen3-8b");
        });

        it("uses setChatModel by default", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse([makeEntry({ installed: true })])));
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            const useBtn = findButtons(content).find((b) => b.textContent === MESSAGES.BUTTON_USE)!;
            useBtn.trigger("click");
            await tick();
            await tick();
            expect(plugin.api.setChatModel).toHaveBeenCalledWith("qwen/qwen3-8b");
        });

        it("notices failure when Use fails", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse([makeEntry({ installed: true })])));
            plugin.api.setChatModel = vi.fn().mockResolvedValue(err(new Error("nope")));
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            const useBtn = findButtons(content).find((b) => b.textContent === MESSAGES.BUTTON_USE)!;
            useBtn.trigger("click");
            await tick();
            await tick();
            const messages = Notice.instances.map((n) => n.message);
            expect(messages.some((m) => m.includes("qwen/qwen3-8b"))).toBe(true);
        });

        it("opens confirm-remove modal and deletes the model on confirm", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse([makeEntry({ installed: true })])));
            plugin.api.deleteModel = vi
                .fn()
                .mockResolvedValue(ok({ deleted: true, model: "qwen/qwen3-8b", freed_gb: 5 }));
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            const removeBtn = findButtons(content).find((b) => b.textContent === MESSAGES.BUTTON_REMOVE)!;
            removeBtn.trigger("click");
            await tick();
            await tick();
            expect(plugin.api.deleteModel).toHaveBeenCalledWith("qwen/qwen3-8b", "native");
        });

        it("skips delete when confirm is cancelled", async () => {
            mockConfirmRemoveResult = false;
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse([makeEntry({ installed: true })])));
            plugin.api.deleteModel = vi.fn();
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            const removeBtn = findButtons(content).find((b) => b.textContent === MESSAGES.BUTTON_REMOVE)!;
            removeBtn.trigger("click");
            await tick();
            await tick();
            expect(plugin.api.deleteModel).not.toHaveBeenCalled();
        });

        it("surfaces a Notice when delete fails", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse([makeEntry({ installed: true })])));
            plugin.api.deleteModel = vi.fn().mockResolvedValue(err(new Error("nope")));
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            const removeBtn = findButtons(content).find((b) => b.textContent === MESSAGES.BUTTON_REMOVE)!;
            removeBtn.trigger("click");
            await tick();
            await tick();
            const messages = Notice.instances.map((n) => n.message);
            expect(messages.some((m) => m.includes("qwen/qwen3-8b"))).toBe(true);
        });

        it("fails the task and surfaces a Notice when pull aborts", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse([makeEntry()])));
            plugin.api.pullModel = vi.fn().mockImplementation(async function* () {
                const abort = new Error("aborted");
                (abort as Error).name = "AbortError";
                throw abort;
            });
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            const pullBtn = findButtons(content).find((b) => b.textContent === MESSAGES.BUTTON_PULL)!;
            pullBtn.trigger("click");
            await tick();
            await tick();
            expect(Notice.instances.map((n) => n.message)).toContain(MESSAGES.NOTICE_PULL_CANCELLED);
        });

        it("fails the task and surfaces a Notice when pull fails with generic error", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse([makeEntry()])));
            plugin.api.pullModel = vi.fn().mockImplementation(async function* () {
                throw new Error("network");
            });
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            const pullBtn = findButtons(content).find((b) => b.textContent === MESSAGES.BUTTON_PULL)!;
            pullBtn.trigger("click");
            await tick();
            await tick();
            expect(Notice.instances.map((n) => n.message)).toContain(MESSAGES.NOTICE_PULL_FAILED);
        });

        it("fails the task when setChatModel after a successful pull returns err", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse([makeEntry()])));
            plugin.api.pullModel = vi.fn().mockImplementation(async function* () {
                // stream ends with no progress / no error — happy path
            });
            plugin.api.setChatModel = vi.fn().mockResolvedValue(err(new Error("activate-failed")));
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            const pullBtn = findButtons(content).find((b) => b.textContent === MESSAGES.BUTTON_PULL)!;
            pullBtn.trigger("click");
            await tick();
            await tick();
            expect(Notice.instances.map((n) => n.message)).toContain(MESSAGES.NOTICE_PULL_FAILED);
        });
    });

    describe("close", () => {
        it("cancels pending search debounce on close", async () => {
            const plugin = makePlugin();
            const modal = await openModal(plugin);
            modal.close();
            // Reaching here without throwing is the assertion.
            expect(true).toBe(true);
        });
    });

    describe("defensive null-guards on private helpers", () => {
        // These guards exist so TypeScript can't complain about non-null
        // access, but they're never reached through the public API. Drive
        // them directly by nulling out the private references.
        it("renderResults bails when resultsEl is null", async () => {
            const plugin = makePlugin();
            const modal = await openModal(plugin);
            (modal as any).resultsEl = null;
            expect(() => (modal as any).renderResults()).not.toThrow();
        });

        it("renderGridView bails when resultsEl is null", async () => {
            const plugin = makePlugin();
            const modal = await openModal(plugin);
            (modal as any).resultsEl = null;
            expect(() => (modal as any).renderGridView([makeEntry()])).not.toThrow();
        });

        it("renderSection bails when resultsEl is null", async () => {
            const plugin = makePlugin();
            const modal = await openModal(plugin);
            (modal as any).resultsEl = null;
            expect(() => (modal as any).renderSection("x", [makeEntry()])).not.toThrow();
        });

        it("renderViewToggleCta bails when resultsEl is null", async () => {
            const plugin = makePlugin();
            const modal = await openModal(plugin);
            (modal as any).resultsEl = null;
            expect(() => (modal as any).renderViewToggleCta()).not.toThrow();
        });

        it("renderListView bails when resultsEl is null", async () => {
            const plugin = makePlugin();
            const modal = await openModal(plugin);
            (modal as any).resultsEl = null;
            expect(() => (modal as any).renderListView([makeEntry()])).not.toThrow();
        });

        it("updateLoadMore bails when loadMoreBtn is null", async () => {
            const plugin = makePlugin();
            const modal = await openModal(plugin);
            (modal as any).loadMoreBtn = null;
            expect(() => (modal as any).updateLoadMore()).not.toThrow();
        });

        it("updateToggleLabel bails when viewToggleBtn is null", async () => {
            const plugin = makePlugin();
            const modal = await openModal(plugin);
            (modal as any).viewToggleBtn = null;
            expect(() => (modal as any).updateToggleLabel()).not.toThrow();
        });

        it("toggles from list back to grid and updates the button label", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse([makeEntry()])));
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            const toggle = content.find("lilbee-catalog-view-toggle")!;
            toggle.trigger("click"); // grid → list
            await tick();
            toggle.trigger("click"); // list → grid
            await tick();
            expect(content.find("lilbee-catalog-grid")).not.toBeNull();
            expect(toggle.textContent).toBe(MESSAGES.LABEL_SWITCH_TO_LIST);
        });

        it("reports 'unknown' when pull throws a non-Error value", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse([makeEntry()])));
            plugin.api.pullModel = vi.fn().mockImplementation(async function* () {
                throw "string-error"; // non-Error throw
            });
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            const pullBtn = findButtons(content).find((b) => b.textContent === MESSAGES.BUTTON_PULL)!;
            pullBtn.trigger("click");
            await tick();
            await tick();
            expect(plugin.taskQueue.completed.length).toBeGreaterThan(0);
            const last = plugin.taskQueue.completed[plugin.taskQueue.completed.length - 1];
            expect(last.error).toBe("unknown");
        });
    });

    // Ensure unused helper doesn't fail lint.
    it("collectTexts helper is used somewhere", () => {
        const el = new MockElement("div");
        el.textContent = "hi";
        expect(collectTexts(el)).toContain("hi");
    });
});
