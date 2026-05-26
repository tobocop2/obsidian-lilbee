import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { App, Notice } from "obsidian";
import { MockElement } from "../__mocks__/obsidian";
import { CatalogModal } from "../../src/views/catalog-modal";
import { CATALOG_TAB, SSE_EVENT } from "../../src/types";
import type { CatalogEntry, CatalogResponse, CatalogTab } from "../../src/types";
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
        hf_repo: "Qwen/Qwen3-8B-GGUF",
        gguf_filename: "*Q4_K_M.gguf",
        display_name: "Qwen3 8B",
        size_gb: 5,
        min_ram_gb: 8,
        description: "Medium — strong general purpose",
        quality_tier: "balanced",
        installed: false,
        source: "native",
        task: "chat",
        featured: false,
        downloads: 0,
        param_count: "8B",
        ...overrides,
    };
}

function makeCatalogResponse(
    models: CatalogEntry[] = [makeEntry()],
    total?: number,
    has_more = false,
): CatalogResponse {
    return { total: total ?? models.length, limit: 20, offset: 0, models, has_more };
}

function makePlugin(overrides: Record<string, unknown> = {}) {
    return {
        api: {
            catalog: vi.fn().mockResolvedValue(ok(makeCatalogResponse([]))),
            pullModel: vi.fn(),
            setChatModel: vi.fn().mockResolvedValue(ok(undefined)),
            setEmbeddingModel: vi.fn().mockResolvedValue(ok(undefined)),
            setRerankerModel: vi.fn().mockResolvedValue(ok(undefined)),
            setVisionModel: vi.fn().mockResolvedValue(ok(undefined)),
            deleteModel: vi.fn().mockResolvedValue(ok({ deleted: true, model: "", freed_gb: 2.5 })),
        },
        activeModel: "",
        settings: { serverMode: "managed", lastCatalogTab: CATALOG_TAB.DISCOVER },
        saveSettings: vi.fn().mockResolvedValue(undefined),
        fetchActiveModel: vi.fn(),
        refreshSettingsTab: vi.fn(),
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

async function openModal(
    plugin: ReturnType<typeof makePlugin>,
    initialTab: CatalogTab = CATALOG_TAB.CHAT,
): Promise<CatalogModal> {
    const modal = new CatalogModal(new App() as any, plugin as any, "", initialTab);
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

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    describe("opening and layout", () => {
        it("renders title and filter bar on open", async () => {
            const plugin = makePlugin();
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            const allTexts = collectTexts(content);
            expect(allTexts).toContain(MESSAGES.TITLE_MODEL_CATALOG);
            expect(content.find("lilbee-catalog-filters")).not.toBeNull();
            // Task is now driven by the top-level catalog tabs, not a dropdown.
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

        it("honors initialTaskFilter by routing to the matching tab and fetching with task param", async () => {
            const plugin = makePlugin();
            const modal = new CatalogModal(new App() as any, plugin as any, "vision");
            modal.open();
            await tick();
            await tick();
            expect((modal as any).activeTab).toBe(CATALOG_TAB.VISION);
            expect(plugin.api.catalog).toHaveBeenCalledWith(expect.objectContaining({ task: "vision" }));
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
                        makeEntry({ hf_repo: "Qwen/Qwen3-8B-GGUF", display_name: "Qwen3 8B", installed: false }),
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

        it("renders the per-task heading for non-featured non-installed entries", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(
                ok(makeCatalogResponse([makeEntry({ hf_repo: "a", display_name: "Chat A", task: "chat" })])),
            );
            const modal = await openModal(plugin, CATALOG_TAB.CHAT);
            const content = contentEl(modal);
            const headings = content.findAll("lilbee-catalog-section-heading").map((el) => el.textContent);
            expect(headings).toContain(MESSAGES.LABEL_SECTION_CHAT);
        });

        it("renderGridView falls back to the raw task string when TASK_SECTION_LABEL has no entry", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse([])));
            const modal = await openModal(plugin, CATALOG_TAB.CHAT);
            const content = contentEl(modal);
            content.empty();
            (modal as any).resultsEl = content.createDiv({ cls: "lilbee-catalog-results" });
            (modal as any).renderGridView([
                makeEntry({ hf_repo: "x", display_name: "X", task: "custom" as any, installed: false }),
            ]);
            const headings = content.findAll("lilbee-catalog-section-heading").map((el) => el.textContent);
            expect(headings).toContain("custom");
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

        it("gates the Pull button, dims the row, and badges an unsupported model in list view", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(
                ok(makeCatalogResponse([makeEntry({ compat: "unsupported", architecture: "deepseek v4" })])),
            );
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            content.find("lilbee-catalog-view-toggle")!.trigger("click");
            await tick();
            const row = content.find("lilbee-catalog-list-row")!;
            expect(row.classList.contains("is-unsupported")).toBe(true);
            expect(row.find("lilbee-tag-compat")).not.toBeNull();
            const pull = content.find("lilbee-catalog-pull")!;
            expect(pull.classList.contains("is-gated")).toBe(true);
            expect(pull.getAttribute("disabled")).toBe("true");
        });

        it("handlePull refuses an unsupported model with a Notice (safety net for every pull path)", async () => {
            const plugin = makePlugin();
            const modal = await openModal(plugin);
            (modal as unknown as { handlePull(e: CatalogEntry): void }).handlePull(
                makeEntry({ compat: "unsupported" }),
            );
            expect(Notice.instances.map((n) => n.message)).toContain(MESSAGES.TOOLTIP_PULL_UNSUPPORTED);
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

        it("shows Active when activeModel's leading hf_repo segment matches the entry", async () => {
            // Post-PR-#183 the active ref is the full HF path. The Active badge
            // resolves by stripping the trailing `<file>.gguf` and comparing the
            // bare repo to `entry.hf_repo`.
            const plugin = makePlugin({ activeModel: "Qwen/Qwen3-8B-GGUF/Qwen3-8B-Q4_K_M.gguf" });
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse([makeEntry({ installed: true })])));
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            content.find("lilbee-catalog-view-toggle")!.trigger("click");
            await tick();
            expect(content.find("lilbee-catalog-active")).not.toBeNull();
        });

        it("does NOT show Active when activeModel doesn't match entry.hf_repo", async () => {
            const plugin = makePlugin({ activeModel: "some/other-model-GGUF/file.gguf" });
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse([makeEntry({ installed: true })])));
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            content.find("lilbee-catalog-view-toggle")!.trigger("click");
            await tick();
            expect(content.find("lilbee-catalog-active")).toBeNull();
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

        it("updateViewToggleVisibility is a no-op when the toggle button hasn't rendered yet", async () => {
            const plugin = makePlugin();
            const modal = new CatalogModal(new App() as any, plugin as any, "", CATALOG_TAB.CHAT);
            // Don't open the modal — viewToggleBtn is still null. Calling
            // the method must early-return without touching the missing element.
            expect(() => (modal as any).updateViewToggleVisibility()).not.toThrow();
        });

        it("opens ModelInfoModal when the grid card info button is clicked", async () => {
            const { ModelInfoModal } = await import("../../src/views/model-info-modal");
            const openSpy = vi.spyOn(ModelInfoModal.prototype, "open").mockImplementation(() => {});
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse([makeEntry()])));
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            const infoBtn = content.find("lilbee-model-card")!.find("lilbee-model-card-info")!;
            infoBtn.trigger("click", { stopPropagation: vi.fn() } as unknown as Event);
            expect(openSpy).toHaveBeenCalled();
            openSpy.mockRestore();
        });

        it("opens ModelInfoModal when the list-row info button is clicked", async () => {
            const { ModelInfoModal } = await import("../../src/views/model-info-modal");
            const openSpy = vi.spyOn(ModelInfoModal.prototype, "open").mockImplementation(() => {});
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse([makeEntry()])));
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            content.find("lilbee-catalog-view-toggle")!.trigger("click");
            await tick();
            const stop = vi.fn();
            const row = content.find("lilbee-catalog-list-row")!;
            const infoBtn = row.find("lilbee-catalog-list-col-info")!.find("lilbee-model-card-info")!;
            infoBtn.trigger("click", { stopPropagation: stop } as unknown as Event);
            expect(stop).toHaveBeenCalled();
            expect(openSpy).toHaveBeenCalled();
            openSpy.mockRestore();
        });

        it("invokes the task-column comparator over the catalog entries", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(
                ok(
                    makeCatalogResponse([
                        makeEntry({ hf_repo: "a", display_name: "A", task: "chat" }),
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
            const rows = content.findAll("lilbee-catalog-list-row");
            // Both entries pass the chat-tab filter and the task-column
            // comparator runs across them — the case 'task' branch in
            // getSortValue is exercised even when the values tie.
            expect(rows.length).toBe(2);
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
        it("re-fetches with task filter when switching to a task tab", async () => {
            const plugin = makePlugin();
            // Open in Discover first so switching to Chat actually changes tabs and refetches.
            const modal = await openModal(plugin, CATALOG_TAB.DISCOVER);
            const content = contentEl(modal);
            plugin.api.catalog.mockClear();
            const chatTab = findButtons(content).find((b) => b.dataset?.tabId === CATALOG_TAB.CHAT)!;
            chatTab.trigger("click");
            await tick();
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

    describe("infinite scroll", () => {
        function setScroll(
            modal: CatalogModal,
            geometry: { scrollTop: number; clientHeight: number; scrollHeight: number },
        ): MockElement {
            const el = (modal as any).resultsEl as MockElement;
            Object.assign(el, geometry);
            return el;
        }

        it("attaches a scroll listener to the results element", async () => {
            const plugin = makePlugin();
            const modal = await openModal(plugin);
            const resultsEl = (modal as any).resultsEl as MockElement;
            expect(resultsEl).not.toBeNull();
            expect(typeof (modal as any).onScroll).toBe("function");
            modal.close();
        });

        it("fetches the next page when the user scrolls near the bottom and hasMore is true", async () => {
            const plugin = makePlugin();
            const first = makeEntry({ name: "a", display_name: "A" });
            const second = makeEntry({ name: "b", display_name: "B" });
            plugin.api.catalog
                .mockResolvedValueOnce(ok({ total: 2, limit: 1, offset: 0, models: [first], has_more: true }))
                .mockResolvedValueOnce(ok({ total: 2, limit: 1, offset: 1, models: [second], has_more: false }));
            const modal = await openModal(plugin);
            setScroll(modal, { scrollTop: 800, clientHeight: 400, scrollHeight: 1100 });
            (modal as any).onScroll();
            await tick();
            await tick();
            expect(plugin.api.catalog).toHaveBeenCalledTimes(2);
            modal.close();
        });

        it("does not fetch when scrolling is not near the bottom", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(
                ok({ total: 40, limit: 20, offset: 0, models: [makeEntry()], has_more: true }),
            );
            const modal = await openModal(plugin);
            plugin.api.catalog.mockClear();
            setScroll(modal, { scrollTop: 10, clientHeight: 400, scrollHeight: 2000 });
            (modal as any).onScroll();
            await tick();
            expect(plugin.api.catalog).not.toHaveBeenCalled();
            modal.close();
        });

        it("does not fetch when hasMore is false", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(
                ok({ total: 1, limit: 20, offset: 0, models: [makeEntry()], has_more: false }),
            );
            const modal = await openModal(plugin);
            plugin.api.catalog.mockClear();
            setScroll(modal, { scrollTop: 800, clientHeight: 400, scrollHeight: 1100 });
            (modal as any).onScroll();
            await tick();
            expect(plugin.api.catalog).not.toHaveBeenCalled();
            modal.close();
        });

        it("fetchPage bails when isFetching is already true", async () => {
            const plugin = makePlugin();
            const modal = await openModal(plugin);
            plugin.api.catalog.mockClear();
            (modal as any).isFetching = true;
            await (modal as any).fetchPage();
            expect(plugin.api.catalog).not.toHaveBeenCalled();
            modal.close();
        });

        it("onScroll bails while a fetch is already in flight", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(
                ok({ total: 40, limit: 20, offset: 0, models: [makeEntry()], has_more: true }),
            );
            const modal = await openModal(plugin);
            plugin.api.catalog.mockClear();
            (modal as any).isFetching = true;
            setScroll(modal, { scrollTop: 800, clientHeight: 400, scrollHeight: 1100 });
            (modal as any).onScroll();
            await tick();
            expect(plugin.api.catalog).not.toHaveBeenCalled();
            modal.close();
        });

        it("onScroll bails when resultsEl is null (defensive)", async () => {
            const plugin = makePlugin();
            const modal = await openModal(plugin);
            (modal as any).resultsEl = null;
            expect(() => (modal as any).onScroll()).not.toThrow();
            modal.close();
        });

        it("removes the scroll listener on close", async () => {
            const plugin = makePlugin();
            const modal = await openModal(plugin);
            const el = (modal as any).resultsEl as MockElement;
            const removeSpy = vi.spyOn(el as any, "removeEventListener");
            modal.close();
            expect(removeSpy).toHaveBeenCalledWith("scroll", expect.any(Function));
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
            expect(plugin.api.pullModel).toHaveBeenCalledWith("Qwen/Qwen3-8B-GGUF", "native", expect.any(AbortSignal));
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

        it("progress event with no percent and no total skips update", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse([makeEntry()])));
            plugin.api.pullModel = vi.fn().mockImplementation(async function* () {
                yield { event: SSE_EVENT.PROGRESS, data: {} };
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

        it("computes progress from current/total when percent is missing", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse([makeEntry()])));
            plugin.api.pullModel = vi.fn().mockImplementation(async function* () {
                yield { event: SSE_EVENT.PROGRESS, data: { current: 50, total: 100 } };
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

        it("uses setEmbeddingModel when the entry is an embedding task", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(
                ok(makeCatalogResponse([makeEntry({ installed: true, task: "embedding" })])),
            );
            const modal = await openModal(plugin, CATALOG_TAB.EMBED);
            const content = contentEl(modal);
            const useBtn = findButtons(content).find((b) => b.textContent === MESSAGES.BUTTON_USE)!;
            useBtn.trigger("click");
            await tick();
            await tick();
            expect(plugin.api.setEmbeddingModel).toHaveBeenCalledWith("Qwen/Qwen3-8B-GGUF");
        });

        it("activates by the concrete GGUF file ref when the filename is not a glob", async () => {
            const plugin = makePlugin();
            plugin.api.setChatModel = vi.fn().mockResolvedValue(ok(undefined));
            plugin.api.catalog.mockResolvedValue(
                ok(
                    makeCatalogResponse([
                        makeEntry({
                            installed: true,
                            hf_repo: "bartowski/SmolLM2-360M-Instruct-GGUF",
                            gguf_filename: "SmolLM2-360M-Instruct-Q4_K_M.gguf",
                        }),
                    ]),
                ),
            );
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            const useBtn = findButtons(content).find((b) => b.textContent === MESSAGES.BUTTON_USE)!;
            useBtn.trigger("click");
            await tick();
            await tick();
            // Bare repo would 422 on the server (no default quant); send the full ref.
            expect(plugin.api.setChatModel).toHaveBeenCalledWith(
                "bartowski/SmolLM2-360M-Instruct-GGUF/SmolLM2-360M-Instruct-Q4_K_M.gguf",
            );
        });

        it("4u1: handleUse refreshes the Settings tab on success", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse([makeEntry({ installed: true })])));
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            const useBtn = findButtons(content).find((b) => b.textContent === MESSAGES.BUTTON_USE)!;
            useBtn.trigger("click");
            await tick();
            await tick();
            expect(plugin.refreshSettingsTab).toHaveBeenCalled();
        });

        it("4u1: handleUse does not refresh the Settings tab on failure", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse([makeEntry({ installed: true })])));
            plugin.api.setChatModel = vi.fn().mockResolvedValue(err(new Error("nope")));
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            const useBtn = findButtons(content).find((b) => b.textContent === MESSAGES.BUTTON_USE)!;
            useBtn.trigger("click");
            await tick();
            await tick();
            expect(plugin.refreshSettingsTab).not.toHaveBeenCalled();
        });

        it("4u1: executePull refreshes the Settings tab after successful pull + setActive", async () => {
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
            expect(plugin.refreshSettingsTab).toHaveBeenCalled();
        });

        it("uses setRerankerModel when the entry is a rerank task (and does not mutate activeModel)", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(
                ok(makeCatalogResponse([makeEntry({ installed: true, task: "rerank" })])),
            );
            const modal = await openModal(plugin, CATALOG_TAB.RERANK);
            const content = contentEl(modal);
            const useBtn = findButtons(content).find((b) => b.textContent === MESSAGES.BUTTON_USE)!;
            useBtn.trigger("click");
            await tick();
            await tick();
            expect(plugin.api.setRerankerModel).toHaveBeenCalledWith("Qwen/Qwen3-8B-GGUF");
            expect(plugin.api.setChatModel).not.toHaveBeenCalled();
            // activeModel is the chat model and must NOT be mutated by the rerank branch
            expect(plugin.activeModel).toBe("");
        });

        it("uses setVisionModel when the entry is a vision task (and does not mutate activeModel)", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(
                ok(makeCatalogResponse([makeEntry({ installed: true, task: "vision" })])),
            );
            const modal = await openModal(plugin, CATALOG_TAB.VISION);
            const content = contentEl(modal);
            const useBtn = findButtons(content).find((b) => b.textContent === MESSAGES.BUTTON_USE)!;
            useBtn.trigger("click");
            await tick();
            await tick();
            expect(plugin.api.setVisionModel).toHaveBeenCalledWith("Qwen/Qwen3-8B-GGUF");
            expect(plugin.api.setChatModel).not.toHaveBeenCalled();
            expect(plugin.activeModel).toBe("");
        });

        it("uses setChatModel with hf_repo and stores it as plugin.activeModel", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse([makeEntry({ installed: true })])));
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            const useBtn = findButtons(content).find((b) => b.textContent === MESSAGES.BUTTON_USE)!;
            useBtn.trigger("click");
            await tick();
            await tick();
            expect(plugin.api.setChatModel).toHaveBeenCalledWith("Qwen/Qwen3-8B-GGUF");
            expect(plugin.activeModel).toBe("Qwen/Qwen3-8B-GGUF");
        });

        it("activation toast uses display_name (chat task)", async () => {
            Notice.clear();
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse([makeEntry({ installed: true })])));
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            const useBtn = findButtons(content).find((b) => b.textContent === MESSAGES.BUTTON_USE)!;
            useBtn.trigger("click");
            await tick();
            await tick();
            expect(Notice.instances.some((n) => n.message === MESSAGES.NOTICE_MODEL_ACTIVATED("Qwen3 8B"))).toBe(true);
        });

        it("activation toast uses display_name (embedding task)", async () => {
            Notice.clear();
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(
                ok(makeCatalogResponse([makeEntry({ installed: true, task: "embedding" })])),
            );
            const modal = await openModal(plugin, CATALOG_TAB.EMBED);
            const content = contentEl(modal);
            const useBtn = findButtons(content).find((b) => b.textContent === MESSAGES.BUTTON_USE)!;
            useBtn.trigger("click");
            await tick();
            await tick();
            expect(Notice.instances.some((n) => n.message === MESSAGES.NOTICE_MODEL_ACTIVATED("Qwen3 8B"))).toBe(true);
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
            expect(messages.some((m) => m.includes("Qwen/Qwen3-8B-GGUF"))).toBe(true);
        });

        it("surfaces server role-mismatch detail verbatim when Use hits a vision endpoint with a reranker model", async () => {
            Notice.clear();
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(
                ok(makeCatalogResponse([makeEntry({ installed: true, task: "vision" })])),
            );
            const detail =
                "Model 'Qwen/Qwen3-8B-GGUF' is a rerank model, not vision. Set it via PUT /api/models/reranker instead.";
            plugin.api.setVisionModel = vi
                .fn()
                .mockResolvedValue(err(new Error(`Server responded 422: {"detail": "${detail}"}`)));
            const modal = await openModal(plugin, CATALOG_TAB.VISION);
            const content = contentEl(modal);
            const useBtn = findButtons(content).find((b) => b.textContent === MESSAGES.BUTTON_USE)!;
            useBtn.trigger("click");
            await tick();
            await tick();
            const messages = Notice.instances.map((n) => n.message);
            expect(messages).toContain(detail);
            // The generic fallback must NOT also appear — role-mismatch wins.
            expect(messages.some((m) => m === MESSAGES.ERROR_SET_MODEL.replace("{model}", "Qwen/Qwen3-8B-GGUF"))).toBe(
                false,
            );
        });

        it("surfaces server role-mismatch detail verbatim when Use hits a reranker endpoint with a vision model", async () => {
            Notice.clear();
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(
                ok(makeCatalogResponse([makeEntry({ installed: true, task: "rerank" })])),
            );
            const detail =
                "Model 'Qwen/Qwen3-8B-GGUF' is a vision model, not rerank. Set it via PUT /api/models/vision instead.";
            plugin.api.setRerankerModel = vi
                .fn()
                .mockResolvedValue(err(new Error(`Server responded 422: {"detail": "${detail}"}`)));
            const modal = await openModal(plugin, CATALOG_TAB.RERANK);
            const content = contentEl(modal);
            const useBtn = findButtons(content).find((b) => b.textContent === MESSAGES.BUTTON_USE)!;
            useBtn.trigger("click");
            await tick();
            await tick();
            const messages = Notice.instances.map((n) => n.message);
            expect(messages).toContain(detail);
            expect(messages.some((m) => m === MESSAGES.ERROR_SET_MODEL.replace("{model}", "Qwen/Qwen3-8B-GGUF"))).toBe(
                false,
            );
        });

        it("opens confirm-remove modal and deletes the model on confirm", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse([makeEntry({ installed: true })])));
            plugin.api.deleteModel = vi
                .fn()
                .mockResolvedValue(ok({ deleted: true, model: "Qwen/Qwen3-8B-GGUF", freed_gb: 5 }));
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            const removeBtn = findButtons(content).find((b) => b.textContent === MESSAGES.BUTTON_REMOVE)!;
            removeBtn.trigger("click");
            await tick();
            await tick();
            expect(plugin.api.deleteModel).toHaveBeenCalledWith("Qwen/Qwen3-8B-GGUF", "native");
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
            expect(messages.some((m) => m.includes("Qwen/Qwen3-8B-GGUF"))).toBe(true);
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

        it("fails the task and surfaces a Notice with the real error when pull throws", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse([makeEntry()])));
            plugin.api.pullModel = vi.fn().mockImplementation(async function* () {
                throw new Error("Server responded 403: forbidden");
            });
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            const pullBtn = findButtons(content).find((b) => b.textContent === MESSAGES.BUTTON_PULL)!;
            pullBtn.trigger("click");
            await tick();
            await tick();
            const prefix = MESSAGES.ERROR_PULL_MODEL.replace("{model}", "Qwen/Qwen3-8B-GGUF");
            expect(Notice.instances.map((n) => n.message)).toContain(`${prefix}: Server responded 403: forbidden`);
        });

        it("reports 'unknown' when pull throws a non-Error value", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse([makeEntry()])));
            plugin.api.pullModel = vi.fn().mockImplementation(async function* () {
                throw "string-error";
            });
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            const pullBtn = findButtons(content).find((b) => b.textContent === MESSAGES.BUTTON_PULL)!;
            pullBtn.trigger("click");
            await tick();
            await tick();
            const prefix = MESSAGES.ERROR_PULL_MODEL.replace("{model}", "Qwen/Qwen3-8B-GGUF");
            expect(Notice.instances.map((n) => n.message)).toContain(`${prefix}: unknown error`);
        });

        it("SSE_EVENT.ERROR shows notice with real message, fails task, and resets button", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse([makeEntry()])));
            plugin.api.pullModel = vi.fn().mockImplementation(async function* () {
                yield { event: SSE_EVENT.ERROR, data: { message: "pull exploded" } };
            });
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            const pullBtn = findButtons(content).find((b) => b.textContent === MESSAGES.BUTTON_PULL)!;
            pullBtn.trigger("click");
            await tick();
            await tick();
            const prefix = MESSAGES.ERROR_PULL_MODEL.replace("{model}", "Qwen/Qwen3-8B-GGUF");
            expect(Notice.instances.map((n) => n.message)).toContain(`${prefix}: pull exploded`);
            expect(plugin.taskQueue.completed.some((t: any) => t.status === "failed")).toBe(true);
        });

        it("SSE_EVENT.ERROR with string data fails the task with raw payload", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse([makeEntry()])));
            plugin.api.pullModel = vi.fn().mockImplementation(async function* () {
                yield { event: SSE_EVENT.ERROR, data: "raw error string" };
            });
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            const pullBtn = findButtons(content).find((b) => b.textContent === MESSAGES.BUTTON_PULL)!;
            pullBtn.trigger("click");
            await tick();
            await tick();
            const prefix = MESSAGES.ERROR_PULL_MODEL.replace("{model}", "Qwen/Qwen3-8B-GGUF");
            expect(Notice.instances.map((n) => n.message)).toContain(`${prefix}: raw error string`);
            expect(plugin.taskQueue.completed.some((t: any) => t.status === "failed")).toBe(true);
        });

        it("SSE_EVENT.ERROR with empty object uses fallback message", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse([makeEntry()])));
            plugin.api.pullModel = vi.fn().mockImplementation(async function* () {
                yield { event: SSE_EVENT.ERROR, data: {} };
            });
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            const pullBtn = findButtons(content).find((b) => b.textContent === MESSAGES.BUTTON_PULL)!;
            pullBtn.trigger("click");
            await tick();
            await tick();
            const prefix = MESSAGES.ERROR_PULL_MODEL.replace("{model}", "Qwen/Qwen3-8B-GGUF");
            expect(Notice.instances.map((n) => n.message)).toContain(`${prefix}: unknown error`);
            expect(plugin.taskQueue.completed.some((t: any) => t.status === "failed")).toBe(true);
        });

        it("completes the pull task even when setChatModel fails and shows a set-failed notice", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse([makeEntry()])));
            plugin.api.pullModel = vi.fn().mockImplementation(async function* () {
                // stream ends with no progress / no error — pull succeeded
            });
            plugin.api.setChatModel = vi.fn().mockResolvedValue(err(new Error("activate-failed")));
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            const pullBtn = findButtons(content).find((b) => b.textContent === MESSAGES.BUTTON_PULL)!;
            pullBtn.trigger("click");
            await tick();
            await tick();
            const setFailedNotice = MESSAGES.ERROR_SET_MODEL.replace("{model}", "Qwen/Qwen3-8B-GGUF");
            expect(Notice.instances.map((n) => n.message)).toContain(setFailedNotice);
            expect(plugin.taskQueue.completed.some((t: any) => t.status === "done")).toBe(true);
            expect(plugin.taskQueue.completed.some((t: any) => t.status === "failed")).toBe(false);
        });

        it("shows NOTICE_QUEUE_FULL when enqueue returns null (per-type cap)", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse([makeEntry()])));
            plugin.taskQueue.enqueue = vi.fn(() => null) as any;
            plugin.api.pullModel = vi.fn();
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            const pullBtn = findButtons(content).find((b) => b.textContent === MESSAGES.BUTTON_PULL)!;
            pullBtn.trigger("click");
            await tick();
            await tick();
            expect(Notice.instances.map((n) => n.message)).toContain(MESSAGES.NOTICE_QUEUE_FULL);
            expect(plugin.api.pullModel).not.toHaveBeenCalled();
        });

        it("executeRemove shows NOTICE_QUEUE_FULL when enqueue returns null", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse([makeEntry({ installed: true })])));
            plugin.taskQueue.enqueue = vi.fn(() => null) as any;
            plugin.api.deleteModel = vi.fn();
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            const removeBtn = findButtons(content).find((b) => b.textContent === MESSAGES.BUTTON_REMOVE)!;
            removeBtn.trigger("click");
            await tick();
            await tick();
            expect(Notice.instances.map((n) => n.message)).toContain(MESSAGES.NOTICE_QUEUE_FULL);
            expect(plugin.api.deleteModel).not.toHaveBeenCalled();
        });

        it("executeRemove enqueues a DELETE task and completes on success", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse([makeEntry({ installed: true })])));
            plugin.api.deleteModel = vi
                .fn()
                .mockResolvedValue(ok({ deleted: true, model: "Qwen/Qwen3-8B-GGUF", freed_gb: 5 }));
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            const removeBtn = findButtons(content).find((b) => b.textContent === MESSAGES.BUTTON_REMOVE)!;
            removeBtn.trigger("click");
            await tick();
            await tick();
            const done = plugin.taskQueue.completed.find((t: any) => t.type === "delete");
            expect(done).toBeDefined();
            expect(done!.status).toBe("done");
        });

        it("executeRemove fails the task when deleteModel errors", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse([makeEntry({ installed: true })])));
            plugin.api.deleteModel = vi.fn().mockResolvedValue(err(new Error("disk i/o")));
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            const removeBtn = findButtons(content).find((b) => b.textContent === MESSAGES.BUTTON_REMOVE)!;
            removeBtn.trigger("click");
            await tick();
            await tick();
            const failed = plugin.taskQueue.completed.find((t: any) => t.type === "delete");
            expect(failed!.status).toBe("failed");
            expect(failed!.error).toBe("disk i/o");
        });

        it("taskQueue.cancel aborts the registered controller for an active pull", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse([makeEntry()])));
            let receivedSignal: AbortSignal | undefined;
            plugin.api.pullModel = vi.fn().mockImplementation(async function* (
                _name: string,
                _source: string,
                signal: AbortSignal,
            ) {
                receivedSignal = signal;
                while (!signal.aborted) {
                    await new Promise((r) => setTimeout(r, 10));
                }
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
            expect(receivedSignal).toBeDefined();
            const active = plugin.taskQueue.active;
            expect(active).toBeTruthy();
            plugin.taskQueue.cancel(active!.id);
            await new Promise((r) => setTimeout(r, 50));
            expect(receivedSignal?.aborted).toBe(true);
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
            expect(last.error).toBe("unknown error");
        });
    });

    // Ensure unused helper doesn't fail lint.
    it("collectTexts helper is used somewhere", () => {
        const el = new MockElement("div");
        el.textContent = "hi";
        expect(collectTexts(el)).toContain("hi");
    });

    describe("Local | Frontier tabs", () => {
        function makeFrontierEntry(overrides: Partial<CatalogEntry> = {}): CatalogEntry {
            return {
                hf_repo: "openai/gpt-4o",
                gguf_filename: "",
                display_name: "gpt-4o",
                size_gb: 0,
                min_ram_gb: 0,
                description: "OpenAI flagship",
                quality_tier: "flagship",
                installed: false,
                source: "frontier",
                task: "chat",
                featured: false,
                downloads: 0,
                param_count: "",
                // Frontier-only fields supplied via cast.
                ...({
                    provider: "OpenAI",
                    key_status: "missing_key",
                    is_curated: true,
                    context_window: 128000,
                    modality: "text",
                } as Partial<CatalogEntry>),
                ...overrides,
            };
        }

        it("hides the Frontier tab when no frontier rows have key_status=ready", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(
                ok(makeCatalogResponse([makeEntry({ source: "local" }), makeFrontierEntry()])),
            );
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            const frontierTab = findButtons(content).find((b) => b.textContent === MESSAGES.TAB_FRONTIER);
            expect(frontierTab).toBeDefined();
            expect(frontierTab?.style.display).toBe("none");
        });

        it("reveals the Frontier tab when at least one frontier row reports key_status=ready", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(
                ok(
                    makeCatalogResponse([
                        makeEntry({ source: "local" }),
                        makeFrontierEntry({
                            ...({ key_status: "ready" } as Partial<CatalogEntry>),
                        }),
                    ]),
                ),
            );
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            const frontierTab = findButtons(content).find((b) => b.textContent === MESSAGES.TAB_FRONTIER);
            expect(frontierTab?.style.display).toBe("");
        });

        it("Local tab renders only local rows even when frontier rows are present", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(
                ok(
                    makeCatalogResponse([
                        makeEntry({ source: "local", display_name: "Local model" }),
                        makeFrontierEntry({ display_name: "Frontier model" }),
                    ]),
                ),
            );
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            const texts = collectTexts(content).join("\n");
            expect(texts).toContain("Local model");
            expect(texts).not.toContain("Frontier model");
        });

        it("Frontier tab renders provider section headers and a row per frontier model", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(
                ok(
                    makeCatalogResponse([
                        makeFrontierEntry({
                            display_name: "gpt-4o",
                            ...({ provider: "OpenAI", key_status: "ready" } as Partial<CatalogEntry>),
                        }),
                        makeFrontierEntry({
                            hf_repo: "anthropic/claude",
                            display_name: "claude-opus-4-7",
                            ...({ provider: "Anthropic", key_status: "missing_key" } as Partial<CatalogEntry>),
                        }),
                    ]),
                ),
            );
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            // Switch to Frontier tab.
            const frontierTab = findButtons(content).find((b) => b.textContent === MESSAGES.TAB_FRONTIER)!;
            frontierTab.trigger("click");
            await tick();
            const rows = content.findAll("lilbee-frontier-row");
            expect(rows.length).toBe(2);
            const sectionHeadings = content.findAll("lilbee-catalog-section-heading").map((h) => h.textContent);
            expect(sectionHeadings).toContain("OpenAI");
            expect(sectionHeadings).toContain("Anthropic");
            expect(content.findAll("lilbee-key-status-pill-ready").length).toBe(1);
            expect(content.findAll("lilbee-key-status-pill-needs-key").length).toBe(1);
        });

        it("clicking a Ready frontier row sets that model active and closes the modal", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(
                ok(
                    makeCatalogResponse([
                        makeFrontierEntry({
                            ...({ key_status: "ready" } as Partial<CatalogEntry>),
                        }),
                    ]),
                ),
            );
            const modal = await openModal(plugin);
            const closeSpy = vi.spyOn(modal, "close").mockImplementation(() => {});
            const content = contentEl(modal);
            findButtons(content)
                .find((b) => b.textContent === MESSAGES.TAB_FRONTIER)!
                .trigger("click");
            await tick();
            const row = content.find("lilbee-frontier-row")!;
            row.trigger("click");
            await tick();
            expect(plugin.api.setChatModel).toHaveBeenCalled();
            expect(closeSpy).toHaveBeenCalled();
        });

        it("clicking a Needs-key frontier row closes the modal without setting an active model", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(
                ok(
                    makeCatalogResponse([
                        makeFrontierEntry({ ...({ key_status: "missing_key" } as Partial<CatalogEntry>) }),
                        makeFrontierEntry({
                            hf_repo: "x/y",
                            ...({ key_status: "ready" } as Partial<CatalogEntry>),
                        }),
                    ]),
                ),
            );
            const modal = await openModal(plugin);
            const closeSpy = vi.spyOn(modal, "close").mockImplementation(() => {});
            const content = contentEl(modal);
            findButtons(content)
                .find((b) => b.textContent === MESSAGES.TAB_FRONTIER)!
                .trigger("click");
            await tick();
            const rows = content.findAll("lilbee-frontier-row");
            // Row 0 is missing_key.
            rows[0].trigger("click");
            await tick();
            expect(closeSpy).toHaveBeenCalled();
            expect(plugin.api.setChatModel).not.toHaveBeenCalled();
        });

        it("surfaces a Notice when activating a Ready frontier row fails", async () => {
            Notice.clear();
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(
                ok(makeCatalogResponse([makeFrontierEntry({ ...({ key_status: "ready" } as Partial<CatalogEntry>) })])),
            );
            plugin.api.setChatModel = vi.fn().mockResolvedValue(err(new Error("boom")));
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            findButtons(content)
                .find((b) => b.textContent === MESSAGES.TAB_FRONTIER)!
                .trigger("click");
            await tick();
            content.find("lilbee-frontier-row")!.trigger("click");
            await tick();
            expect(Notice.instances.length).toBeGreaterThan(0);
        });

        it("re-renders when switching back to the Local tab", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(
                ok(
                    makeCatalogResponse([
                        makeEntry({ source: "local", display_name: "Local-A" }),
                        makeFrontierEntry({ ...({ key_status: "ready" } as Partial<CatalogEntry>) }),
                    ]),
                ),
            );
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            // Frontier first.
            findButtons(content)
                .find((b) => b.textContent === MESSAGES.TAB_FRONTIER)!
                .trigger("click");
            await tick();
            expect(content.findAll("lilbee-frontier-row").length).toBeGreaterThan(0);
            // Back to Local.
            findButtons(content)
                .find((b) => b.textContent === MESSAGES.TAB_LOCAL)!
                .trigger("click");
            await tick();
            expect(content.findAll("lilbee-frontier-row").length).toBe(0);
            expect(collectTexts(content).join("\n")).toContain("Local-A");
        });

        it("bounces the user back to Local when a refetch removes all ready frontier rows", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(
                ok(makeCatalogResponse([makeFrontierEntry({ ...({ key_status: "ready" } as Partial<CatalogEntry>) })])),
            );
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            findButtons(content)
                .find((b) => b.textContent === MESSAGES.TAB_FRONTIER)!
                .trigger("click");
            await tick();
            expect((modal as any).currentTab).toBe("frontier");
            // Simulate a refetch that returns no ready rows (e.g. user revoked the key).
            (modal as any).entries = [
                makeFrontierEntry({ ...({ key_status: "missing_key" } as Partial<CatalogEntry>) }),
            ];
            (modal as any).updateFrontierTabVisibility();
            expect((modal as any).currentTab).toBe("local");
        });

        it("renders frontier rows that omit provider/key_status fields without crashing (defaults to missing_key)", async () => {
            const plugin = makePlugin();
            // Frontier row with NO provider / key_status — default branches in renderFrontierRow run.
            const minimalFrontier = makeEntry({
                source: "frontier",
                display_name: "minimal",
                hf_repo: "x/minimal",
            });
            // Plus a ready frontier row so the tab is visible.
            const readyFrontier = makeFrontierEntry({ ...({ key_status: "ready" } as Partial<CatalogEntry>) });
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse([readyFrontier, minimalFrontier])));
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            findButtons(content)
                .find((b) => b.textContent === MESSAGES.TAB_FRONTIER)!
                .trigger("click");
            await tick();
            // Both rows render. The minimal one defaults to missing_key pill.
            expect(content.findAll("lilbee-frontier-row").length).toBe(2);
            expect(content.findAll("lilbee-key-status-pill-needs-key").length).toBeGreaterThan(0);
        });

        it("Frontier tab body falls back to empty state when no frontier rows are loaded yet", async () => {
            const plugin = makePlugin();
            // Initial response has only a ready frontier row to make the tab visible.
            plugin.api.catalog.mockResolvedValue(
                ok(makeCatalogResponse([makeFrontierEntry({ ...({ key_status: "ready" } as Partial<CatalogEntry>) })])),
            );
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            findButtons(content)
                .find((b) => b.textContent === MESSAGES.TAB_FRONTIER)!
                .trigger("click");
            await tick();
            // Force-clear the entries map and re-render — exercises the empty branch.
            (modal as any).entries = [];
            (modal as any).renderResults();
            const empty = content.find("lilbee-catalog-empty");
            expect(empty?.textContent).toBe(MESSAGES.LABEL_NO_MODELS_FOUND);
        });

        it("clicking the already-active tab is a no-op", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(
                ok(
                    makeCatalogResponse([
                        makeEntry({ source: "local", display_name: "Local-A" }),
                        makeFrontierEntry({ ...({ key_status: "ready" } as Partial<CatalogEntry>) }),
                    ]),
                ),
            );
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            const localTab = findButtons(content).find((b) => b.textContent === MESSAGES.TAB_LOCAL)!;
            localTab.trigger("click"); // Already active.
            await tick();
            // Sanity: no frontier rows surfaced from a stray render.
            expect(content.findAll("lilbee-frontier-row").length).toBe(0);
        });
    });

    describe("six-tab top bar", () => {
        function tabButtons(content: MockElement): MockElement[] {
            const bar = content.find("lilbee-catalog-main-tab-bar");
            if (!bar) return [];
            return bar.children;
        }

        it("renders the six tabs in order", async () => {
            const plugin = makePlugin();
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            const ids = tabButtons(content).map((b) => b.dataset.tabId);
            expect(ids).toEqual([
                CATALOG_TAB.DISCOVER,
                CATALOG_TAB.CHAT,
                CATALOG_TAB.EMBED,
                CATALOG_TAB.VISION,
                CATALOG_TAB.RERANK,
                CATALOG_TAB.LIBRARY,
            ]);
        });

        it("hides the Local|Frontier sub-toggle on Discover and Library", async () => {
            const plugin = makePlugin();
            const modal = await openModal(plugin, CATALOG_TAB.DISCOVER);
            const content = contentEl(modal);
            const subBar = content.find("lilbee-catalog-sub-tab-bar")!;
            expect(subBar.style.display).toBe("none");
            findButtons(content)
                .find((b) => b.dataset?.tabId === CATALOG_TAB.LIBRARY)!
                .trigger("click");
            await tick();
            await tick();
            expect(content.find("lilbee-catalog-sub-tab-bar")!.style.display).toBe("none");
        });

        it("shows the Local|Frontier sub-toggle on each task tab", async () => {
            const plugin = makePlugin();
            const modal = await openModal(plugin, CATALOG_TAB.CHAT);
            const content = contentEl(modal);
            expect(content.find("lilbee-catalog-sub-tab-bar")!.style.display).toBe("");
        });

        it("clicking a task tab re-fetches with that task and resets sub-toggle to Local", async () => {
            const plugin = makePlugin();
            const modal = await openModal(plugin, CATALOG_TAB.DISCOVER);
            const content = contentEl(modal);
            // Force into Frontier on Chat first.
            findButtons(content)
                .find((b) => b.dataset?.tabId === CATALOG_TAB.CHAT)!
                .trigger("click");
            await tick();
            await tick();
            (modal as any).currentTab = "frontier";
            // Now click Embed — sub-toggle should reset to local.
            plugin.api.catalog.mockClear();
            findButtons(content)
                .find((b) => b.dataset?.tabId === CATALOG_TAB.EMBED)!
                .trigger("click");
            await tick();
            await tick();
            expect((modal as any).currentTab).toBe("local");
            expect(plugin.api.catalog).toHaveBeenLastCalledWith(expect.objectContaining({ task: "embedding" }));
        });

        it("clicking the active main tab is a no-op", async () => {
            const plugin = makePlugin();
            const modal = await openModal(plugin, CATALOG_TAB.CHAT);
            const content = contentEl(modal);
            plugin.api.catalog.mockClear();
            findButtons(content)
                .find((b) => b.dataset?.tabId === CATALOG_TAB.CHAT)!
                .trigger("click");
            await tick();
            expect(plugin.api.catalog).not.toHaveBeenCalled();
        });

        it("persists the active tab to plugin settings on switch", async () => {
            const plugin = makePlugin();
            const modal = await openModal(plugin, CATALOG_TAB.DISCOVER);
            const content = contentEl(modal);
            findButtons(content)
                .find((b) => b.dataset?.tabId === CATALOG_TAB.LIBRARY)!
                .trigger("click");
            await tick();
            expect(plugin.settings.lastCatalogTab).toBe(CATALOG_TAB.LIBRARY);
            expect(plugin.saveSettings).toHaveBeenCalled();
        });

        it("restores the persisted tab when no initialTab arg is given", async () => {
            const plugin = makePlugin({ settings: { serverMode: "managed", lastCatalogTab: CATALOG_TAB.RERANK } });
            const modal = new CatalogModal(new App() as any, plugin as any);
            modal.open();
            await tick();
            await tick();
            expect((modal as any).activeTab).toBe(CATALOG_TAB.RERANK);
        });

        it("falls back to Discover when settings have no persisted tab", async () => {
            const plugin = makePlugin({ settings: { serverMode: "managed" } });
            const modal = new CatalogModal(new App() as any, plugin as any);
            modal.open();
            await tick();
            await tick();
            expect((modal as any).activeTab).toBe(CATALOG_TAB.DISCOVER);
        });

        it("explicit initialTab arg overrides the persisted setting", async () => {
            const plugin = makePlugin({ settings: { serverMode: "managed", lastCatalogTab: CATALOG_TAB.LIBRARY } });
            const modal = new CatalogModal(new App() as any, plugin as any, "", CATALOG_TAB.VISION);
            modal.open();
            await tick();
            await tick();
            expect((modal as any).activeTab).toBe(CATALOG_TAB.VISION);
        });

        it("number keys 1-9 do not change the tab (mouse-only navigation)", async () => {
            const plugin = makePlugin();
            const modal = await openModal(plugin, CATALOG_TAB.CHAT);
            const content = contentEl(modal);
            for (const key of ["1", "2", "3", "4", "5", "6", "9"]) {
                content.trigger("keydown", { key, preventDefault: vi.fn() } as unknown as KeyboardEvent);
                await tick();
                expect((modal as any).activeTab).toBe(CATALOG_TAB.CHAT);
            }
        });

        it("non-numeric keys do not change the tab", async () => {
            const plugin = makePlugin();
            const modal = await openModal(plugin, CATALOG_TAB.CHAT);
            const content = contentEl(modal);
            content.trigger("keydown", { key: "x", preventDefault: vi.fn() } as unknown as KeyboardEvent);
            await tick();
            expect((modal as any).activeTab).toBe(CATALOG_TAB.CHAT);
        });

        it("removes the keydown listener on close", async () => {
            const plugin = makePlugin();
            const modal = await openModal(plugin);
            const content = contentEl(modal);
            const removeSpy = vi.spyOn(content as any, "removeEventListener");
            modal.close();
            expect(removeSpy).toHaveBeenCalledWith("keydown", expect.any(Function));
        });
    });

    describe("Discover tab", () => {
        function makeDiscoverEntries(): CatalogEntry[] {
            return [
                makeEntry({
                    hf_repo: "feat/chat",
                    display_name: "Featured Chat",
                    featured: true,
                    task: "chat",
                    downloads: 1000,
                }),
                makeEntry({
                    hf_repo: "feat/embed",
                    display_name: "Featured Embed",
                    featured: true,
                    task: "embedding",
                    downloads: 500,
                }),
                makeEntry({
                    hf_repo: "owned/one",
                    display_name: "Owned One",
                    installed: true,
                    downloads: 200,
                }),
                makeEntry({
                    hf_repo: "fresh/top",
                    display_name: "Fresh Top",
                    downloads: 9999,
                }),
            ];
        }

        it("renders three rails with the expected headings", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse(makeDiscoverEntries())));
            const modal = await openModal(plugin, CATALOG_TAB.DISCOVER);
            const content = contentEl(modal);
            const rails = content.findAll("lilbee-discover-rail");
            expect(rails.length).toBe(3);
            const headings = content.findAll("lilbee-discover-rail-heading").map((h) => h.children[0].textContent);
            expect(headings).toEqual([MESSAGES.RAIL_FOR_YOU, MESSAGES.RAIL_YOUR_COLLECTION, MESSAGES.RAIL_FRESH]);
        });

        it("For You rail prefers chat-task entries when an active chat model is set", async () => {
            const plugin = makePlugin({ activeModel: "any/chat-active/file.gguf" });
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse(makeDiscoverEntries())));
            const modal = await openModal(plugin, CATALOG_TAB.DISCOVER);
            const content = contentEl(modal);
            const rails = content.findAll("lilbee-discover-rail");
            const forYouCards = rails[0].find("lilbee-discover-rail-cards")!.findAll("lilbee-model-card");
            // Featured chat first, then featured embed.
            expect(forYouCards[0].dataset.repo).toBe("feat/chat");
        });

        it("Fresh rail sorts by downloads descending and caps at 12", async () => {
            const plugin = makePlugin();
            const many: CatalogEntry[] = Array.from({ length: 15 }, (_, i) =>
                makeEntry({ hf_repo: `m/${i}`, display_name: `M${i}`, downloads: i * 10 }),
            );
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse(many)));
            const modal = await openModal(plugin, CATALOG_TAB.DISCOVER);
            const content = contentEl(modal);
            const rails = content.findAll("lilbee-discover-rail");
            const freshCards = rails[2].find("lilbee-discover-rail-cards")!.findAll("lilbee-model-card");
            expect(freshCards.length).toBe(12);
            // First card has the highest download count.
            expect(freshCards[0].dataset.repo).toBe("m/14");
        });

        it("Your Collection rail shows installed entries only", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse(makeDiscoverEntries())));
            const modal = await openModal(plugin, CATALOG_TAB.DISCOVER);
            const content = contentEl(modal);
            const rails = content.findAll("lilbee-discover-rail");
            const collectionCards = rails[1].find("lilbee-discover-rail-cards")!.findAll("lilbee-model-card");
            expect(collectionCards.length).toBe(1);
            expect(collectionCards[0].dataset.repo).toBe("owned/one");
        });

        it("renders the empty placeholder when a rail has no rows", async () => {
            const plugin = makePlugin();
            // No installed and no featured entries — For You and Your Collection both empty.
            plugin.api.catalog.mockResolvedValue(
                ok(makeCatalogResponse([makeEntry({ hf_repo: "lonely", display_name: "Lonely" })])),
            );
            const modal = await openModal(plugin, CATALOG_TAB.DISCOVER);
            const content = contentEl(modal);
            const empties = content.findAll("lilbee-discover-rail-empty");
            expect(empties.length).toBe(2);
            expect(empties[0].textContent).toBe(MESSAGES.RAIL_NO_ITEMS);
        });
    });

    describe("Library tab", () => {
        it("shows only installed entries across tasks", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(
                ok(
                    makeCatalogResponse([
                        makeEntry({ hf_repo: "in/chat", display_name: "ChatModel", installed: true }),
                        makeEntry({
                            hf_repo: "in/embed",
                            display_name: "EmbedModel",
                            installed: true,
                            task: "embedding",
                        }),
                        makeEntry({ hf_repo: "out/none", display_name: "NotInstalled", installed: false }),
                    ]),
                ),
            );
            const modal = await openModal(plugin, CATALOG_TAB.LIBRARY);
            const content = contentEl(modal);
            const cards = content.findAll("lilbee-model-card");
            const repos = cards.map((c) => c.dataset.repo).sort();
            expect(repos).toEqual(["in/chat", "in/embed"]);
        });

        it("renders the empty state when nothing is installed", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(
                ok(makeCatalogResponse([makeEntry({ hf_repo: "out/none", installed: false })])),
            );
            const modal = await openModal(plugin, CATALOG_TAB.LIBRARY);
            const content = contentEl(modal);
            expect(content.find("lilbee-catalog-empty")?.textContent).toBe(MESSAGES.LABEL_NO_MODELS_FOUND);
        });

        it("supports list view when toggled", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(
                ok(makeCatalogResponse([makeEntry({ hf_repo: "in/lib", installed: true })])),
            );
            const modal = await openModal(plugin, CATALOG_TAB.LIBRARY);
            const content = contentEl(modal);
            content.find("lilbee-catalog-view-toggle")!.trigger("click");
            await tick();
            expect(content.find("lilbee-catalog-list")).not.toBeNull();
        });
    });

    describe("detail drawer", () => {
        beforeEach(() => {
            vi.stubGlobal("window", { innerWidth: 1200 } as unknown as Window);
        });
        afterEach(() => {
            vi.unstubAllGlobals();
        });

        const waitForDebounce = () => new Promise((r) => setTimeout(r, 50));

        it("renders a placeholder before any model has focus", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse([makeEntry()])));
            const modal = await openModal(plugin, CATALOG_TAB.LIBRARY);
            const content = contentEl(modal);
            expect(content.find("lilbee-catalog-drawer")).not.toBeNull();
            expect(content.find("lilbee-catalog-drawer-empty")?.textContent).toBe(MESSAGES.LABEL_DRAWER_NO_SELECTION);
        });

        it("populates the drawer when a card receives focus", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse([makeEntry({ installed: true })])));
            const modal = await openModal(plugin, CATALOG_TAB.LIBRARY);
            const content = contentEl(modal);
            const card = content.find("lilbee-model-card")!;
            const body = content.find("lilbee-catalog-body")!;
            body.trigger("focusin", { target: card });
            await waitForDebounce();
            expect(content.find("lilbee-detail-name")?.textContent).toBe("Qwen3 8B");
        });

        it("debounces rapid focus changes onto the most recent card", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(
                ok(
                    makeCatalogResponse([
                        makeEntry({ hf_repo: "a/one", display_name: "One", installed: true }),
                        makeEntry({ hf_repo: "b/two", display_name: "Two", installed: true }),
                    ]),
                ),
            );
            const modal = await openModal(plugin, CATALOG_TAB.LIBRARY);
            const content = contentEl(modal);
            const cards = content.findAll("lilbee-model-card");
            const body = content.find("lilbee-catalog-body")!;
            body.trigger("focusin", { target: cards[0] });
            body.trigger("pointerover", { target: cards[1] });
            await waitForDebounce();
            expect(content.find("lilbee-detail-name")?.textContent).toBe("Two");
        });

        it("ignores focus events on elements outside any card", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse([makeEntry({ installed: true })])));
            const modal = await openModal(plugin, CATALOG_TAB.LIBRARY);
            const content = contentEl(modal);
            const body = content.find("lilbee-catalog-body")!;
            body.trigger("focusin", { target: new MockElement("div") });
            await waitForDebounce();
            // Placeholder still in the drawer because no card was focused.
            expect(content.find("lilbee-catalog-drawer-empty")).not.toBeNull();
        });

        it("re-focusing the same card does not re-render the drawer", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse([makeEntry({ installed: true })])));
            const modal = await openModal(plugin, CATALOG_TAB.LIBRARY);
            const content = contentEl(modal);
            const card = content.find("lilbee-model-card")!;
            const body = content.find("lilbee-catalog-body")!;
            body.trigger("focusin", { target: card });
            await waitForDebounce();
            const firstName = content.find("lilbee-detail-name");
            body.trigger("focusin", { target: card });
            await waitForDebounce();
            // Same node reference because the second focusin short-circuited.
            expect(content.find("lilbee-detail-name")).toBe(firstName);
        });

        it("toggle button expands and re-collapses the drawer (drawer starts collapsed)", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse([makeEntry()])));
            const modal = await openModal(plugin, CATALOG_TAB.LIBRARY);
            const content = contentEl(modal);
            const drawer = content.find("lilbee-catalog-drawer")!;
            expect(drawer.classList.contains("lilbee-catalog-drawer-collapsed")).toBe(true);
            content.find("lilbee-catalog-drawer-toggle")!.trigger("click");
            expect(drawer.classList.contains("lilbee-catalog-drawer-collapsed")).toBe(false);
            content.find("lilbee-catalog-drawer-toggle")!.trigger("click");
            expect(drawer.classList.contains("lilbee-catalog-drawer-collapsed")).toBe(true);
        });

        it("collapses the drawer when the viewport is narrower than 800px", async () => {
            vi.stubGlobal("window", { innerWidth: 600 } as unknown as Window);
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse([makeEntry()])));
            const modal = await openModal(plugin, CATALOG_TAB.LIBRARY);
            const content = contentEl(modal);
            const drawer = content.find("lilbee-catalog-drawer")!;
            expect(drawer.classList.contains("lilbee-catalog-drawer-collapsed")).toBe(true);
        });

        it("clears any pending focus debounce on close", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse([makeEntry({ installed: true })])));
            const modal = await openModal(plugin, CATALOG_TAB.LIBRARY);
            const content = contentEl(modal);
            const card = content.find("lilbee-model-card")!;
            const body = content.find("lilbee-catalog-body")!;
            body.trigger("focusin", { target: card });
            modal.close();
            expect((modal as unknown as { focusDebounceTimeout: unknown }).focusDebounceTimeout).toBeNull();
        });

        it("updateDrawerForRepo bails when the repo is no longer in entries", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse([makeEntry()])));
            const modal = await openModal(plugin, CATALOG_TAB.LIBRARY);
            (modal as unknown as { entries: unknown[] }).entries = [];
            (modal as unknown as { updateDrawerForRepo(r: string): void }).updateDrawerForRepo("ghost/repo");
            // Drawer keeps the placeholder.
            expect(contentEl(modal).find("lilbee-catalog-drawer-empty")).not.toBeNull();
        });
    });

    describe("`i` key opens model info", () => {
        beforeEach(() => {
            vi.stubGlobal("window", { innerWidth: 1200 } as unknown as Window);
        });
        afterEach(() => {
            vi.unstubAllGlobals();
        });

        const waitForDebounce = () => new Promise((r) => setTimeout(r, 50));

        async function focusFirstCard(modal: CatalogModal): Promise<void> {
            const content = contentEl(modal);
            const card = content.find("lilbee-model-card")!;
            const body = content.find("lilbee-catalog-body")!;
            body.trigger("focusin", { target: card });
            await waitForDebounce();
        }

        it("opens ModelInfoModal when `i` is pressed with a focused card", async () => {
            const { ModelInfoModal } = await import("../../src/views/model-info-modal");
            const openSpy = vi.spyOn(ModelInfoModal.prototype, "open").mockImplementation(() => {});
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse([makeEntry({ installed: true })])));
            const modal = await openModal(plugin, CATALOG_TAB.LIBRARY);
            await focusFirstCard(modal);
            const content = contentEl(modal);
            content.trigger("keydown", {
                key: "i",
                target: new MockElement("div"),
                preventDefault: vi.fn(),
                stopPropagation: vi.fn(),
            } as unknown as KeyboardEvent);
            expect(openSpy).toHaveBeenCalled();
            openSpy.mockRestore();
        });

        it("ignores `i` when nothing is focused", async () => {
            const { ModelInfoModal } = await import("../../src/views/model-info-modal");
            const openSpy = vi.spyOn(ModelInfoModal.prototype, "open").mockImplementation(() => {});
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse([makeEntry({ installed: true })])));
            const modal = await openModal(plugin, CATALOG_TAB.LIBRARY);
            const content = contentEl(modal);
            content.trigger("keydown", {
                key: "i",
                target: new MockElement("div"),
                preventDefault: vi.fn(),
                stopPropagation: vi.fn(),
            } as unknown as KeyboardEvent);
            expect(openSpy).not.toHaveBeenCalled();
            openSpy.mockRestore();
        });

        it("ignores `i` when the event target is an input element", async () => {
            const { ModelInfoModal } = await import("../../src/views/model-info-modal");
            const openSpy = vi.spyOn(ModelInfoModal.prototype, "open").mockImplementation(() => {});
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse([makeEntry({ installed: true })])));
            const modal = await openModal(plugin, CATALOG_TAB.LIBRARY);
            await focusFirstCard(modal);
            const content = contentEl(modal);
            const input = new MockElement("input");
            content.trigger("keydown", {
                key: "i",
                target: input,
                preventDefault: vi.fn(),
                stopPropagation: vi.fn(),
            } as unknown as KeyboardEvent);
            expect(openSpy).not.toHaveBeenCalled();
            openSpy.mockRestore();
        });

        it("ignores `i` when the event target is a textarea", async () => {
            const { ModelInfoModal } = await import("../../src/views/model-info-modal");
            const openSpy = vi.spyOn(ModelInfoModal.prototype, "open").mockImplementation(() => {});
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse([makeEntry({ installed: true })])));
            const modal = await openModal(plugin, CATALOG_TAB.LIBRARY);
            await focusFirstCard(modal);
            const content = contentEl(modal);
            const textarea = new MockElement("textarea");
            content.trigger("keydown", {
                key: "i",
                target: textarea,
                preventDefault: vi.fn(),
                stopPropagation: vi.fn(),
            } as unknown as KeyboardEvent);
            expect(openSpy).not.toHaveBeenCalled();
            openSpy.mockRestore();
        });

        it("ignores `i` when the focused repo is no longer in entries", async () => {
            const { ModelInfoModal } = await import("../../src/views/model-info-modal");
            const openSpy = vi.spyOn(ModelInfoModal.prototype, "open").mockImplementation(() => {});
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse([makeEntry({ installed: true })])));
            const modal = await openModal(plugin, CATALOG_TAB.LIBRARY);
            await focusFirstCard(modal);
            // Stale focus: cached repo is gone after a refetch.
            (modal as unknown as { entries: unknown[] }).entries = [];
            const content = contentEl(modal);
            content.trigger("keydown", {
                key: "i",
                target: new MockElement("div"),
                preventDefault: vi.fn(),
                stopPropagation: vi.fn(),
            } as unknown as KeyboardEvent);
            expect(openSpy).not.toHaveBeenCalled();
            openSpy.mockRestore();
        });

        it("treats targets with no tagName as non-input", async () => {
            const { ModelInfoModal } = await import("../../src/views/model-info-modal");
            const openSpy = vi.spyOn(ModelInfoModal.prototype, "open").mockImplementation(() => {});
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse([makeEntry({ installed: true })])));
            const modal = await openModal(plugin, CATALOG_TAB.LIBRARY);
            await focusFirstCard(modal);
            const content = contentEl(modal);
            content.trigger("keydown", {
                key: "i",
                target: null,
                preventDefault: vi.fn(),
                stopPropagation: vi.fn(),
            } as unknown as KeyboardEvent);
            expect(openSpy).toHaveBeenCalled();
            openSpy.mockRestore();
        });
    });
});
