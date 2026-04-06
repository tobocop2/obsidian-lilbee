import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { App, Notice } from "obsidian";
import { MockElement } from "../__mocks__/obsidian";
import { CatalogModal } from "../../src/views/catalog-modal";
import { SSE_EVENT } from "../../src/types";
import type { ModelFamily, ModelVariant, CatalogResponse } from "../../src/types";
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
            catalog: vi.fn().mockResolvedValue(ok(makeCatalogResponse([]))),
            pullModel: vi.fn(),
            setChatModel: vi.fn().mockResolvedValue(ok(undefined)),
            setVisionModel: vi.fn().mockResolvedValue(ok(undefined)),
            setEmbeddingModel: vi.fn().mockResolvedValue(ok(undefined)),
            deleteModel: vi.fn().mockResolvedValue(ok({ deleted: true, model: "", freed_gb: 2.5 })),
        },
        activeModel: "test/model-4B",
        activeVisionModel: "",
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

    describe("opening and layout", () => {
        it("renders title and filter bar on open", async () => {
            const plugin = makePlugin();
            const app = new App();
            const modal = new CatalogModal(app as any, plugin as any);
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse([])));
            modal.open();
            await vi.runAllTimersAsync();

            const el = modal.contentEl as unknown as MockElement;
            const texts = collectTexts(el);
            expect(texts.some((t) => t.includes("Model Catalog"))).toBe(true);
            expect(el.find("lilbee-catalog-filters")).not.toBeNull();
        });

        it("renders view toggle button", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse([])));
            const app = new App();
            const modal = new CatalogModal(app as any, plugin as any);
            modal.open();
            await vi.runAllTimersAsync();

            const el = modal.contentEl as unknown as MockElement;
            const toggleBtn = el.find("lilbee-catalog-view-toggle");
            expect(toggleBtn).not.toBeNull();
            expect(toggleBtn?.textContent).toBe(MESSAGES.LABEL_SWITCH_TO_LIST);
        });

        it("fetches catalog on open", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse([makeFamily()])));
            const app = new App();
            const modal = new CatalogModal(app as any, plugin as any);
            modal.open();
            await vi.runAllTimersAsync();

            expect(plugin.api.catalog).toHaveBeenCalledWith(
                expect.objectContaining({
                    limit: 20,
                    offset: 0,
                    sort: "featured",
                }),
            );
        });

        it("shows empty message when no models match", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse([])));
            const app = new App();
            const modal = new CatalogModal(app as any, plugin as any);
            modal.open();
            await vi.runAllTimersAsync();

            const el = modal.contentEl as unknown as MockElement;
            const empty = el.find("lilbee-catalog-empty");
            expect(empty).not.toBeNull();
            expect(empty?.textContent).toBe(MESSAGES.LABEL_NO_MODELS_FOUND);
        });
    });

    describe("grid view", () => {
        it("opens in grid view by default", async () => {
            const families = [makeFamily({ featured: true })];
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse(families)));
            const app = new App();
            const modal = new CatalogModal(app as any, plugin as any);
            modal.open();
            await vi.runAllTimersAsync();

            const el = modal.contentEl as unknown as MockElement;
            expect(el.find("lilbee-catalog-grid")).not.toBeNull();
        });

        it("renders 'Our picks' section heading for featured", async () => {
            const families = [makeFamily({ featured: true })];
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse(families)));
            const app = new App();
            const modal = new CatalogModal(app as any, plugin as any);
            modal.open();
            await vi.runAllTimersAsync();

            const el = modal.contentEl as unknown as MockElement;
            const headings = el.findAll("lilbee-catalog-section-heading");
            expect(headings.some((h) => h.textContent === MESSAGES.LABEL_OUR_PICKS)).toBe(true);
        });

        it("renders model cards in grid container", async () => {
            const families = [makeFamily({ featured: true })];
            const plugin = makePlugin({ activeModel: "other" });
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse(families)));
            const app = new App();
            const modal = new CatalogModal(app as any, plugin as any);
            modal.open();
            await vi.runAllTimersAsync();

            const el = modal.contentEl as unknown as MockElement;
            const cards = el.findAll("lilbee-model-card");
            expect(cards.length).toBe(2);
        });

        it("renders 'Browse more models' CTA card", async () => {
            const families = [makeFamily({ featured: true })];
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse(families)));
            const app = new App();
            const modal = new CatalogModal(app as any, plugin as any);
            modal.open();
            await vi.runAllTimersAsync();

            const el = modal.contentEl as unknown as MockElement;
            expect(el.find("lilbee-browse-more-card")).not.toBeNull();
        });

        it("renders view toggle CTA banner", async () => {
            const families = [makeFamily({ featured: true })];
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse(families)));
            const app = new App();
            const modal = new CatalogModal(app as any, plugin as any);
            modal.open();
            await vi.runAllTimersAsync();

            const el = modal.contentEl as unknown as MockElement;
            expect(el.find("lilbee-view-toggle-cta")).not.toBeNull();
        });

        it("renders 'Installed' section for installed non-featured models", async () => {
            const families = [
                makeFamily({
                    featured: false,
                    variants: [makeVariant({ installed: true, hf_repo: "installed/model" })],
                }),
            ];
            const plugin = makePlugin({ activeModel: "other" });
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse(families)));
            const app = new App();
            const modal = new CatalogModal(app as any, plugin as any);
            modal.open();
            await vi.runAllTimersAsync();

            const el = modal.contentEl as unknown as MockElement;
            const headings = el.findAll("lilbee-catalog-section-heading");
            expect(headings.some((h) => h.textContent === MESSAGES.LABEL_SECTION_INSTALLED)).toBe(true);
        });

        it("groups multiple non-featured models under same task section", async () => {
            const families = [
                makeFamily({
                    featured: false,
                    task: "chat",
                    variants: [
                        makeVariant({ installed: false, hf_repo: "test/a" }),
                        makeVariant({ installed: false, hf_repo: "test/b" }),
                    ],
                }),
            ];
            const plugin = makePlugin({ activeModel: "other" });
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse(families)));
            const app = new App();
            const modal = new CatalogModal(app as any, plugin as any);
            modal.open();
            await vi.runAllTimersAsync();

            const el = modal.contentEl as unknown as MockElement;
            const headings = el.findAll("lilbee-catalog-section-heading");
            const chatHeadings = headings.filter((h) => h.textContent === MESSAGES.LABEL_SECTION_CHAT);
            expect(chatHeadings.length).toBe(1);
            // Both cards should be in one grid
            const cards = el.findAll("lilbee-model-card");
            expect(cards.length).toBe(2);
        });

        it("renders task label for unknown task using raw task string", async () => {
            const families = [
                makeFamily({
                    featured: false,
                    task: "custom-task",
                    variants: [makeVariant({ installed: false, task: "custom-task" })],
                }),
            ];
            const plugin = makePlugin({ activeModel: "other" });
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse(families)));
            const app = new App();
            const modal = new CatalogModal(app as any, plugin as any);
            modal.open();
            await vi.runAllTimersAsync();

            const el = modal.contentEl as unknown as MockElement;
            const headings = el.findAll("lilbee-catalog-section-heading");
            expect(headings.some((h) => h.textContent === "custom-task")).toBe(true);
        });

        it("groupByTask falls back to family task when variant task empty", async () => {
            const families = [
                makeFamily({
                    featured: false,
                    task: "vision",
                    variants: [makeVariant({ installed: false, task: "" })],
                }),
            ];
            const plugin = makePlugin({ activeModel: "other" });
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse(families)));
            const app = new App();
            const modal = new CatalogModal(app as any, plugin as any);
            modal.open();
            await vi.runAllTimersAsync();

            const el = modal.contentEl as unknown as MockElement;
            const headings = el.findAll("lilbee-catalog-section-heading");
            expect(headings.some((h) => h.textContent === MESSAGES.LABEL_SECTION_VISION)).toBe(true);
        });

        it("renders task sections for non-featured non-installed models", async () => {
            const families = [
                makeFamily({
                    featured: false,
                    task: "chat",
                    variants: [makeVariant({ installed: false })],
                }),
            ];
            const plugin = makePlugin({ activeModel: "other" });
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse(families)));
            const app = new App();
            const modal = new CatalogModal(app as any, plugin as any);
            modal.open();
            await vi.runAllTimersAsync();

            const el = modal.contentEl as unknown as MockElement;
            const headings = el.findAll("lilbee-catalog-section-heading");
            expect(headings.some((h) => h.textContent === MESSAGES.LABEL_SECTION_CHAT)).toBe(true);
        });

        it("browse more CTA triggers full catalog reload", async () => {
            const families = [makeFamily({ featured: true })];
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse(families)));
            const app = new App();
            const modal = new CatalogModal(app as any, plugin as any);
            modal.open();
            await vi.runAllTimersAsync();

            const callsBefore = plugin.api.catalog.mock.calls.length;
            const el = modal.contentEl as unknown as MockElement;
            const browseMore = el.find("lilbee-browse-more-card")!;
            browseMore.trigger("click");
            await vi.runAllTimersAsync();

            expect(plugin.api.catalog.mock.calls.length).toBeGreaterThan(callsBefore);
        });

        it("browse more CTA disappears after loading full catalog", async () => {
            const families = [makeFamily({ featured: true })];
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse(families)));
            const app = new App();
            const modal = new CatalogModal(app as any, plugin as any);
            modal.open();
            await vi.runAllTimersAsync();

            const el = modal.contentEl as unknown as MockElement;
            el.find("lilbee-browse-more-card")!.trigger("click");
            await vi.runAllTimersAsync();

            expect(el.find("lilbee-browse-more-card")).toBeNull();
        });
    });

    describe("list view", () => {
        it("view toggle switches to list view", async () => {
            const families = [makeFamily({ featured: true })];
            const plugin = makePlugin({ activeModel: "other" });
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse(families)));
            const app = new App();
            const modal = new CatalogModal(app as any, plugin as any);
            modal.open();
            await vi.runAllTimersAsync();

            const el = modal.contentEl as unknown as MockElement;
            const toggleBtn = el.find("lilbee-catalog-view-toggle")!;
            toggleBtn.trigger("click");

            expect(el.find("lilbee-catalog-list")).not.toBeNull();
            expect(el.find("lilbee-catalog-grid")).toBeNull();
        });

        it("list view renders header row", async () => {
            const families = [makeFamily({ featured: true })];
            const plugin = makePlugin({ activeModel: "other" });
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse(families)));
            const app = new App();
            const modal = new CatalogModal(app as any, plugin as any);
            modal.open();
            await vi.runAllTimersAsync();

            const el = modal.contentEl as unknown as MockElement;
            el.find("lilbee-catalog-view-toggle")!.trigger("click");

            const header = el.find("lilbee-catalog-list-header");
            expect(header).not.toBeNull();
            expect(header?.find("lilbee-catalog-list-col-name")).not.toBeNull();
        });

        it("list view renders data rows", async () => {
            const families = [makeFamily({ featured: true })];
            const plugin = makePlugin({ activeModel: "other" });
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse(families)));
            const app = new App();
            const modal = new CatalogModal(app as any, plugin as any);
            modal.open();
            await vi.runAllTimersAsync();

            const el = modal.contentEl as unknown as MockElement;
            el.find("lilbee-catalog-view-toggle")!.trigger("click");

            const rows = el.findAll("lilbee-catalog-list-row");
            expect(rows.length).toBe(2);
        });

        it("featured rows show star prefix in list view", async () => {
            const families = [makeFamily({ featured: true })];
            const plugin = makePlugin({ activeModel: "other" });
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse(families)));
            const app = new App();
            const modal = new CatalogModal(app as any, plugin as any);
            modal.open();
            await vi.runAllTimersAsync();

            const el = modal.contentEl as unknown as MockElement;
            el.find("lilbee-catalog-view-toggle")!.trigger("click");

            const names = el.findAll("lilbee-catalog-list-col-name");
            // header + data rows
            const dataNames = names.filter((n) => n.textContent?.includes("\u2605"));
            expect(dataNames.length).toBeGreaterThan(0);
        });

        it("list view column sort works", async () => {
            const families = [
                makeFamily({
                    featured: true,
                    variants: [
                        makeVariant({ name: "A", hf_repo: "test/A", size_gb: 1, display_name: "Alpha" }),
                        makeVariant({ name: "Z", hf_repo: "test/Z", size_gb: 9, display_name: "Zeta" }),
                    ],
                }),
            ];
            const plugin = makePlugin({ activeModel: "other" });
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse(families)));
            const app = new App();
            const modal = new CatalogModal(app as any, plugin as any);
            modal.open();
            await vi.runAllTimersAsync();

            const el = modal.contentEl as unknown as MockElement;
            el.find("lilbee-catalog-view-toggle")!.trigger("click");

            // Click name column to sort
            const header = el.find("lilbee-catalog-list-header")!;
            const nameCol = header.find("lilbee-catalog-list-col-name")!;
            nameCol.trigger("click");

            const rows = el.findAll("lilbee-catalog-list-row");
            const firstRowName = rows[0].find("lilbee-catalog-list-col-name")?.textContent;
            expect(firstRowName).toContain("Alpha");
        });

        it("clicking same column toggles sort direction", async () => {
            const families = [
                makeFamily({
                    featured: true,
                    variants: [
                        makeVariant({ name: "A", hf_repo: "test/A", size_gb: 1, display_name: "Alpha" }),
                        makeVariant({ name: "Z", hf_repo: "test/Z", size_gb: 9, display_name: "Zeta" }),
                    ],
                }),
            ];
            const plugin = makePlugin({ activeModel: "other" });
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse(families)));
            const app = new App();
            const modal = new CatalogModal(app as any, plugin as any);
            modal.open();
            await vi.runAllTimersAsync();

            const el = modal.contentEl as unknown as MockElement;
            el.find("lilbee-catalog-view-toggle")!.trigger("click");

            const header = el.find("lilbee-catalog-list-header")!;
            const nameCol = header.find("lilbee-catalog-list-col-name")!;
            nameCol.trigger("click"); // ascending
            nameCol.trigger("click"); // descending

            const rows = el.findAll("lilbee-catalog-list-row");
            const firstRowName = rows[0].find("lilbee-catalog-list-col-name")?.textContent;
            expect(firstRowName).toContain("Zeta");
        });

        it("sort by size uses numeric comparison", async () => {
            const families = [
                makeFamily({
                    featured: true,
                    variants: [
                        makeVariant({ name: "big", hf_repo: "test/big", size_gb: 10, display_name: "Big" }),
                        makeVariant({ name: "small", hf_repo: "test/small", size_gb: 1, display_name: "Small" }),
                    ],
                }),
            ];
            const plugin = makePlugin({ activeModel: "other" });
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse(families)));
            const app = new App();
            const modal = new CatalogModal(app as any, plugin as any);
            modal.open();
            await vi.runAllTimersAsync();

            const el = modal.contentEl as unknown as MockElement;
            el.find("lilbee-catalog-view-toggle")!.trigger("click");

            const header = el.find("lilbee-catalog-list-header")!;
            const sizeCol = header.find("lilbee-catalog-list-col-size")!;
            sizeCol.trigger("click"); // ascending

            const rows = el.findAll("lilbee-catalog-list-row");
            const firstSize = rows[0].find("lilbee-catalog-list-col-size")?.textContent;
            expect(firstSize).toBe("1 GB");
        });

        it("toggle back to grid preserves data", async () => {
            const families = [makeFamily({ featured: true })];
            const plugin = makePlugin({ activeModel: "other" });
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse(families)));
            const app = new App();
            const modal = new CatalogModal(app as any, plugin as any);
            modal.open();
            await vi.runAllTimersAsync();

            const el = modal.contentEl as unknown as MockElement;
            const toggleBtn = el.find("lilbee-catalog-view-toggle")!;
            toggleBtn.trigger("click"); // to list
            toggleBtn.trigger("click"); // back to grid

            expect(el.find("lilbee-catalog-grid")).not.toBeNull();
            expect(toggleBtn.textContent).toBe(MESSAGES.LABEL_SWITCH_TO_LIST);
        });

        it("list view shows Active for active model", async () => {
            const families = [
                makeFamily({
                    featured: true,
                    variants: [makeVariant({ name: "4B", hf_repo: "test/model-4B", installed: true })],
                }),
            ];
            const plugin = makePlugin({ activeModel: "test/model-4B" });
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse(families)));
            const app = new App();
            const modal = new CatalogModal(app as any, plugin as any);
            modal.open();
            await vi.runAllTimersAsync();

            const el = modal.contentEl as unknown as MockElement;
            el.find("lilbee-catalog-view-toggle")!.trigger("click");

            expect(el.find("lilbee-catalog-active")).not.toBeNull();
        });

        it("list view shows Use/Remove for installed non-active variant", async () => {
            const families = [
                makeFamily({
                    featured: true,
                    variants: [makeVariant({ hf_repo: "test/other", installed: true })],
                }),
            ];
            const plugin = makePlugin({ activeModel: "different" });
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse(families)));
            const app = new App();
            const modal = new CatalogModal(app as any, plugin as any);
            modal.open();
            await vi.runAllTimersAsync();

            const el = modal.contentEl as unknown as MockElement;
            el.find("lilbee-catalog-view-toggle")!.trigger("click");

            expect(el.find("lilbee-catalog-use")).not.toBeNull();
            expect(el.find("lilbee-catalog-remove")).not.toBeNull();
        });

        it("list view shows Pull for non-installed variant", async () => {
            const families = [
                makeFamily({
                    featured: true,
                    variants: [makeVariant({ installed: false })],
                }),
            ];
            const plugin = makePlugin({ activeModel: "other" });
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse(families)));
            const app = new App();
            const modal = new CatalogModal(app as any, plugin as any);
            modal.open();
            await vi.runAllTimersAsync();

            const el = modal.contentEl as unknown as MockElement;
            el.find("lilbee-catalog-view-toggle")!.trigger("click");

            expect(el.find("lilbee-catalog-pull")).not.toBeNull();
        });

        it("list row shows quality_tier in quant column", async () => {
            const families = [
                makeFamily({
                    featured: true,
                    variants: [makeVariant({ quality_tier: "Q4_K_M" })],
                }),
            ];
            const plugin = makePlugin({ activeModel: "other" });
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse(families)));
            const app = new App();
            const modal = new CatalogModal(app as any, plugin as any);
            modal.open();
            await vi.runAllTimersAsync();

            const el = modal.contentEl as unknown as MockElement;
            el.find("lilbee-catalog-view-toggle")!.trigger("click");

            const quant = el.findAll("lilbee-catalog-list-col-quant").filter((e) => e.textContent === "Q4_K_M");
            expect(quant.length).toBe(1);
        });

        it("list row falls back to empty quant when quality_tier absent", async () => {
            const families = [
                makeFamily({
                    featured: true,
                    variants: [makeVariant({ quality_tier: undefined })],
                }),
            ];
            const plugin = makePlugin({ activeModel: "other" });
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse(families)));
            const app = new App();
            const modal = new CatalogModal(app as any, plugin as any);
            modal.open();
            await vi.runAllTimersAsync();

            const el = modal.contentEl as unknown as MockElement;
            el.find("lilbee-catalog-view-toggle")!.trigger("click");

            const quantCols = el.findAll("lilbee-catalog-list-col-quant");
            // header + 1 data row
            const dataQuants = quantCols.filter((e) => e.parentElement?.classList.contains("lilbee-catalog-list-row"));
            expect(dataQuants[0].textContent).toBe("");
        });

        it("non-featured row has no star prefix in list view", async () => {
            const families = [
                makeFamily({
                    featured: false,
                    variants: [makeVariant({ installed: false, featured: undefined })],
                }),
            ];
            const plugin = makePlugin({ activeModel: "other" });
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse(families)));
            const app = new App();
            const modal = new CatalogModal(app as any, plugin as any);
            modal.open();
            await vi.runAllTimersAsync();

            const el = modal.contentEl as unknown as MockElement;
            el.find("lilbee-catalog-view-toggle")!.trigger("click");

            const rows = el.findAll("lilbee-catalog-list-row");
            const nameText = rows[0].find("lilbee-catalog-list-col-name")?.textContent ?? "";
            expect(nameText.startsWith("\u2605")).toBe(false);
        });

        it("view toggle CTA banner switches to list view", async () => {
            const families = [makeFamily({ featured: true })];
            const plugin = makePlugin({ activeModel: "other" });
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse(families)));
            const app = new App();
            const modal = new CatalogModal(app as any, plugin as any);
            modal.open();
            await vi.runAllTimersAsync();

            const el = modal.contentEl as unknown as MockElement;
            const cta = el.find("lilbee-view-toggle-cta")!;
            const ctaBtns = findButtons(cta);
            ctaBtns[0].trigger("click");

            expect(el.find("lilbee-catalog-list")).not.toBeNull();
        });
    });

    describe("filters", () => {
        it("search input triggers debounced fetch", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse([])));
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
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse([])));
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
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse([])));
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
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse([])));
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

        it("search input debounce: multiple inputs batch correctly", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse([])));
            const app = new App();
            const modal = new CatalogModal(app as any, plugin as any);
            expect((modal as any).debouncedSearch).toBeDefined();
            modal.open();
            await vi.runAllTimersAsync();

            const el = modal.contentEl as unknown as MockElement;
            const searchInput = el.find("lilbee-catalog-search")!;

            const callsBeforeInput = plugin.api.catalog.mock.calls.length;

            (searchInput as any).value = "a";
            searchInput.trigger("input");

            (searchInput as any).value = "ab";
            searchInput.trigger("input");

            await vi.advanceTimersByTimeAsync(300);
            await vi.runAllTimersAsync();

            // Two rapid inputs should batch into a single debounced fetch
            expect(plugin.api.catalog.mock.calls.length).toBe(callsBeforeInput + 1);
            expect(plugin.api.catalog).toHaveBeenLastCalledWith(expect.objectContaining({ search: "ab" }));
        });
    });

    describe("pagination", () => {
        it("shows Load more button when total > loaded", async () => {
            const families = Array.from({ length: 20 }, (_, i) => makeFamily({ family: `family${i}` }));
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse(families, 40)));
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
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse(families, 1)));
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
                .mockResolvedValueOnce(ok(makeCatalogResponse(page1, 21)))
                .mockResolvedValueOnce(ok(makeCatalogResponse(page2, 21)));
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
    });

    describe("actions: Use", () => {
        it("clicking Use button sets model as active (chat)", async () => {
            const families = [
                makeFamily({
                    featured: true,
                    variants: [makeVariant({ name: "4B", hf_repo: "test/model-4B", installed: true, task: "chat" })],
                }),
            ];
            const plugin = makePlugin({ activeModel: "other-model" });
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse(families)));
            plugin.api.setChatModel.mockResolvedValue(ok(undefined));
            const app = new App();
            const modal = new CatalogModal(app as any, plugin as any);
            modal.open();
            await vi.runAllTimersAsync();

            const el = modal.contentEl as unknown as MockElement;
            const useBtn = el.find("lilbee-catalog-use");
            expect(useBtn).toBeDefined();
            useBtn?.trigger("click");
            await vi.runAllTimersAsync();

            expect(plugin.api.setChatModel).toHaveBeenCalledWith("test/model-4B");
        });

        it("handles vision model task type in Use", async () => {
            vi.clearAllMocks();
            const families = [
                makeFamily({
                    featured: true,
                    variants: [makeVariant({ name: "4B", hf_repo: "test/model-4B", installed: true, task: "vision" })],
                }),
            ];
            const plugin = makePlugin({ activeVisionModel: "other-model" });
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse(families)));
            const app = new App();
            const modal = new CatalogModal(app as any, plugin as any);
            modal.open();
            await vi.runAllTimersAsync();

            const variant = families[0].variants[0];
            const fakeBtn = { textContent: "", disabled: false };
            await (modal as any).handleUse(families[0], variant, fakeBtn as any);
            await vi.runAllTimersAsync();

            expect(plugin.api.setVisionModel).toHaveBeenCalled();
        });

        it("handles embedding model task type in Use", async () => {
            vi.clearAllMocks();
            const families = [
                makeFamily({
                    featured: true,
                    variants: [
                        makeVariant({ name: "4B", hf_repo: "test/model-4B", installed: true, task: "embedding" }),
                    ],
                }),
            ];
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse(families)));
            const app = new App();
            const modal = new CatalogModal(app as any, plugin as any);
            modal.open();
            await vi.runAllTimersAsync();

            const variant = families[0].variants[0];
            const fakeBtn = { textContent: "", disabled: false };
            await (modal as any).handleUse(families[0], variant, fakeBtn as any);
            await vi.runAllTimersAsync();

            expect(plugin.api.setEmbeddingModel).toHaveBeenCalled();
        });

        it("shows error notice when Use button fails", async () => {
            vi.clearAllMocks();
            const families = [
                makeFamily({
                    featured: true,
                    variants: [makeVariant({ name: "4B", hf_repo: "test/model-4B", installed: true, task: "chat" })],
                }),
            ];
            const plugin = makePlugin({ activeModel: "other-model" });
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse(families)));
            plugin.api.setChatModel = vi.fn().mockResolvedValue(err(new Error("API Error")));
            const app = new App();
            const modal = new CatalogModal(app as any, plugin as any);
            modal.open();
            await vi.runAllTimersAsync();

            const el = modal.contentEl as unknown as MockElement;
            const useBtn = el.find("lilbee-catalog-use");
            useBtn?.trigger("click");
            await vi.runAllTimersAsync();

            expect(plugin.api.setChatModel).toHaveBeenCalled();
            expect(Notice.instances.some((n) => n.message.includes("Failed to set"))).toBe(true);
        });

        it("Active shown for active model variant in grid", async () => {
            const families = [
                makeFamily({
                    featured: true,
                    variants: [makeVariant({ name: "4B", hf_repo: "test/model-4B", installed: true })],
                }),
            ];
            const plugin = makePlugin({ activeModel: "test/model-4B" });
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse(families)));
            const app = new App();
            const modal = new CatalogModal(app as any, plugin as any);
            modal.open();
            await vi.runAllTimersAsync();

            const el = modal.contentEl as unknown as MockElement;
            const active = el.findAll("lilbee-catalog-active");
            expect(active.length).toBe(1);
            expect(active[0].textContent).toBe("Active");
        });

        it("Active shown for active vision model variant", async () => {
            const families = [
                makeFamily({
                    featured: true,
                    variants: [makeVariant({ name: "llava", hf_repo: "llava/v1.6", installed: true })],
                }),
            ];
            const plugin = makePlugin({ activeModel: "other-model", activeVisionModel: "llava/v1.6" });
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse(families)));
            const app = new App();
            const modal = new CatalogModal(app as any, plugin as any);
            modal.open();
            await vi.runAllTimersAsync();

            const el = modal.contentEl as unknown as MockElement;
            const active = el.findAll("lilbee-catalog-active");
            expect(active.length).toBe(1);
        });
    });

    describe("actions: Pull", () => {
        it("Pull button opens confirm modal and pulls on confirm", async () => {
            vi.useRealTimers();
            const families = [
                makeFamily({
                    featured: true,
                    variants: [makeVariant({ name: "4B", hf_repo: "test/model-4B", installed: false })],
                }),
            ];
            const plugin = makePlugin({ activeModel: "other-model" });
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse(families)));
            plugin.api.pullModel.mockReturnValue(
                (async function* () {
                    yield { event: SSE_EVENT.PROGRESS, data: { current: 50, total: 100 } };
                })(),
            );
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
            const families = [
                makeFamily({
                    featured: true,
                    variants: [
                        makeVariant({ name: "gpt-4o", hf_repo: "openai/gpt-4o", installed: false, source: "litellm" }),
                    ],
                }),
            ];
            const plugin = makePlugin({ activeModel: "other-model" });
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse(families)));
            plugin.api.pullModel.mockReturnValue(
                (async function* () {
                    yield { event: SSE_EVENT.PROGRESS, data: { current: 100, total: 100 } };
                })(),
            );
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
            const families = [
                makeFamily({
                    featured: true,
                    task: "vision",
                    variants: [
                        makeVariant({ name: "llava", hf_repo: "llava/llava-v1.6", installed: false, task: "vision" }),
                    ],
                }),
            ];
            const plugin = makePlugin({ activeModel: "other-model", activeVisionModel: "" });
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse(families)));
            plugin.api.pullModel.mockReturnValue(
                (async function* () {
                    yield { event: SSE_EVENT.PROGRESS, data: { current: 100, total: 100 } };
                })(),
            );
            plugin.api.setVisionModel.mockResolvedValue(ok(undefined));
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

        it("Pull on embedding variant calls setEmbeddingModel", async () => {
            vi.useRealTimers();
            const families = [
                makeFamily({
                    featured: true,
                    task: "embedding",
                    variants: [
                        makeVariant({
                            name: "nomic",
                            hf_repo: "nomic-ai/nomic-embed",
                            installed: false,
                            task: "embedding",
                        }),
                    ],
                }),
            ];
            const plugin = makePlugin({ activeModel: "other-model" });
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse(families)));
            plugin.api.pullModel.mockReturnValue(
                (async function* () {
                    yield { event: SSE_EVENT.PROGRESS, data: { current: 100, total: 100 } };
                })(),
            );
            plugin.api.setEmbeddingModel.mockResolvedValue(ok(undefined));
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

        it("Pull cancelled by confirm modal does not pull", async () => {
            vi.useRealTimers();
            mockConfirmResult = false;
            const families = [
                makeFamily({
                    featured: true,
                    variants: [makeVariant({ name: "4B", hf_repo: "test/model-4B", installed: false })],
                }),
            ];
            const plugin = makePlugin({ activeModel: "other-model" });
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse(families)));
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
            const families = [
                makeFamily({
                    featured: true,
                    variants: [makeVariant({ name: "4B", hf_repo: "test/model-4B", installed: false })],
                }),
            ];
            const plugin = makePlugin({ activeModel: "other-model" });
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse(families)));
            plugin.api.pullModel.mockReturnValue(
                (async function* () {
                    throw new Error("network error");
                })(),
            );
            const app = new App();
            const modal = new CatalogModal(app as any, plugin as any);
            modal.open();
            await tick();

            const el = modal.contentEl as unknown as MockElement;
            const pullBtn = el.findAll("lilbee-catalog-pull")[0];
            pullBtn.trigger("click");
            await tick();
            await tick();

            expect(Notice.instances.some((n) => n.message.includes("failed to pull"))).toBe(true);
        });

        it("handles non-Error throw during pull", async () => {
            vi.useRealTimers();
            const families = [
                makeFamily({
                    featured: true,
                    variants: [makeVariant({ name: "4B", hf_repo: "test/model-4B", installed: false })],
                }),
            ];
            const plugin = makePlugin({ activeModel: "other-model" });
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse(families)));
            plugin.api.pullModel.mockReturnValue(
                (async function* () {
                    throw "string error";
                })(),
            );
            const app = new App();
            const modal = new CatalogModal(app as any, plugin as any);
            modal.open();
            await tick();

            const el = modal.contentEl as unknown as MockElement;
            const pullBtn = el.findAll("lilbee-catalog-pull")[0];
            pullBtn.trigger("click");
            await tick();
            await tick();

            const failed = plugin.taskQueue.completed.find((t: any) => t.status === "failed");
            expect(failed).toBeDefined();
            expect(failed!.error).toBe("unknown");
        });

        it("handles AbortError during pull", async () => {
            vi.useRealTimers();
            const families = [
                makeFamily({
                    featured: true,
                    variants: [makeVariant({ name: "4B", hf_repo: "test/model-4B", installed: false })],
                }),
            ];
            const plugin = makePlugin({ activeModel: "other-model" });
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse(families)));
            const abortErr = new Error("aborted");
            abortErr.name = "AbortError";
            plugin.api.pullModel.mockReturnValue(
                (async function* () {
                    throw abortErr;
                })(),
            );
            const app = new App();
            const modal = new CatalogModal(app as any, plugin as any);
            modal.open();
            await tick();

            const el = modal.contentEl as unknown as MockElement;
            const pullBtn = el.findAll("lilbee-catalog-pull")[0];
            pullBtn.trigger("click");
            await tick();
            await tick();

            expect(Notice.instances.some((n) => n.message.includes("cancelled"))).toBe(true);
        });

        it("handles setModel failure after successful pull", async () => {
            vi.useRealTimers();
            Notice.clear();
            const families = [
                makeFamily({
                    featured: true,
                    variants: [makeVariant({ name: "4B", hf_repo: "test/model-4B", installed: false })],
                }),
            ];
            const plugin = makePlugin({ activeModel: "other-model" });
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse(families)));
            plugin.api.pullModel.mockReturnValue(
                (async function* () {
                    yield { event: SSE_EVENT.PROGRESS, data: { current: 100, total: 100 } };
                })(),
            );
            plugin.api.setChatModel.mockResolvedValue(err(new Error("failed to set model")));
            const app = new App();
            const modal = new CatalogModal(app as any, plugin as any);
            modal.open();
            await tick();

            const el = modal.contentEl as unknown as MockElement;
            const pullBtn = el.findAll("lilbee-catalog-pull")[0];
            pullBtn.trigger("click");
            await tick();
            await tick();

            expect(plugin.api.pullModel).toHaveBeenCalled();
            expect(Notice.instances.some((n) => n.message.includes("failed"))).toBe(true);
            expect(pullBtn.textContent).toBe("Pull");
            expect(pullBtn.disabled).toBe(false);
        });
    });

    describe("actions: Remove", () => {
        it("clicking Remove shows confirmation modal", async () => {
            vi.useRealTimers();
            mockConfirmRemoveResult = false;
            const { ConfirmModal } = await import("../../src/views/confirm-modal");
            const families = [
                makeFamily({
                    featured: true,
                    variants: [makeVariant({ name: "4B", hf_repo: "test/model-4B", installed: true })],
                }),
            ];
            const plugin = makePlugin({ activeModel: "other-model" });
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse(families)));
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
            const families = [
                makeFamily({
                    featured: true,
                    variants: [
                        makeVariant({ name: "4B", hf_repo: "test/model-4B", installed: true, source: "native" }),
                    ],
                }),
            ];
            const plugin = makePlugin({ activeModel: "other-model" });
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse(families)));
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
            expect(Notice.instances.some((n) => n.message.includes("Deleted test/model-4B"))).toBe(true);
            expect(plugin.fetchActiveModel).toHaveBeenCalled();
        });

        it("Remove failure shows error notice and re-enables button", async () => {
            vi.useRealTimers();
            const families = [
                makeFamily({
                    featured: true,
                    variants: [makeVariant({ name: "4B", hf_repo: "test/model-4B", installed: true })],
                }),
            ];
            const plugin = makePlugin({ activeModel: "other-model" });
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse(families)));
            plugin.api.deleteModel.mockResolvedValue(err(new Error("network error")));
            const app = new App();
            const modal = new CatalogModal(app as any, plugin as any);
            modal.open();
            await tick();

            const el = modal.contentEl as unknown as MockElement;
            const removeBtn = el.findAll("lilbee-catalog-remove")[0];
            removeBtn.trigger("click");
            await tick();
            await tick();

            expect(Notice.instances.some((n) => n.message.includes("Failed to remove"))).toBe(true);
            expect(removeBtn.textContent).toBe("Remove");
            expect(removeBtn.disabled).toBe(false);
        });
    });

    describe("error handling and edge cases", () => {
        it("handles catalog fetch failure", async () => {
            vi.useRealTimers();
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(err(new Error("network")));
            const app = new App();
            const modal = new CatalogModal(app as any, plugin as any);
            modal.open();
            await tick();

            expect(Notice.instances.some((n) => n.message.includes("failed to load catalog"))).toBe(true);
        });

        it("onClose cleans up without throwing", () => {
            const plugin = makePlugin();
            const app = new App();
            const modal = new CatalogModal(app as any, plugin as any);
            expect((modal as any).debouncedSearch).toBeDefined();
            modal.onClose();
        });

        it("onClose with active debounce does not throw", async () => {
            const plugin = makePlugin();
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse([])));
            const app = new App();
            const modal = new CatalogModal(app as any, plugin as any);
            modal.open();
            await vi.runAllTimersAsync();

            const el = modal.contentEl as unknown as MockElement;
            const searchInput = el.find("lilbee-catalog-search")!;
            (searchInput as any).value = "test";
            searchInput.trigger("input");
            expect((modal as any).debouncedSearch).toBeDefined();
            modal.onClose();
        });

        it("updateLoadMore returns early when loadMoreBtn is null", () => {
            const plugin = makePlugin();
            const app = new App();
            const modal = new CatalogModal(app as any, plugin as any);
            (modal as any).loadMoreBtn = null;
            (modal as any).updateLoadMore();
        });

        it("renderResults returns early when resultsEl is null", () => {
            const plugin = makePlugin();
            const app = new App();
            const modal = new CatalogModal(app as any, plugin as any);
            (modal as any).resultsEl = null;
            (modal as any).renderResults();
        });

        it("renderGridView returns early when resultsEl is null", () => {
            const plugin = makePlugin();
            const app = new App();
            const modal = new CatalogModal(app as any, plugin as any);
            (modal as any).resultsEl = null;
            (modal as any).renderGridView([]);
        });

        it("renderListView returns early when resultsEl is null", () => {
            const plugin = makePlugin();
            const app = new App();
            const modal = new CatalogModal(app as any, plugin as any);
            (modal as any).resultsEl = null;
            (modal as any).renderListView([]);
        });

        it("renderSection returns early when resultsEl is null", () => {
            const plugin = makePlugin();
            const app = new App();
            const modal = new CatalogModal(app as any, plugin as any);
            (modal as any).resultsEl = null;
            (modal as any).renderSection("Test", []);
        });

        it("renderViewToggleCta returns early when resultsEl is null", () => {
            const plugin = makePlugin();
            const app = new App();
            const modal = new CatalogModal(app as any, plugin as any);
            (modal as any).resultsEl = null;
            (modal as any).renderViewToggleCta();
        });

        it("updateToggleLabel returns early when viewToggleBtn is null", () => {
            const plugin = makePlugin();
            const app = new App();
            const modal = new CatalogModal(app as any, plugin as any);
            (modal as any).viewToggleBtn = null;
            (modal as any).updateToggleLabel();
        });

        it("getSortValue returns empty string for unknown column", () => {
            const plugin = makePlugin();
            const app = new App();
            const modal = new CatalogModal(app as any, plugin as any);
            const item = { family: makeFamily(), variant: makeVariant() };
            expect((modal as any).getSortValue(item, "unknown")).toBe("");
        });

        it("getSortValue returns task from variant", () => {
            const plugin = makePlugin();
            const app = new App();
            const modal = new CatalogModal(app as any, plugin as any);
            const item = { family: makeFamily(), variant: makeVariant({ task: "vision" }) };
            expect((modal as any).getSortValue(item, "task")).toBe("vision");
        });

        it("getSortValue falls back to family task", () => {
            const plugin = makePlugin();
            const app = new App();
            const modal = new CatalogModal(app as any, plugin as any);
            const item = { family: makeFamily({ task: "embedding" }), variant: makeVariant({ task: "" }) };
            expect((modal as any).getSortValue(item, "task")).toBe("embedding");
        });

        it("getSortValue returns quant", () => {
            const plugin = makePlugin();
            const app = new App();
            const modal = new CatalogModal(app as any, plugin as any);
            const item = { family: makeFamily(), variant: makeVariant({ quality_tier: "Q5_K_M" }) };
            expect((modal as any).getSortValue(item, "quant")).toBe("Q5_K_M");
        });

        it("getSortValue returns variant name when display_name undefined", () => {
            const plugin = makePlugin();
            const app = new App();
            const modal = new CatalogModal(app as any, plugin as any);
            const item = { family: makeFamily(), variant: makeVariant({ display_name: undefined }) };
            expect((modal as any).getSortValue(item, "name")).toBe("4B");
        });

        it("getSortValue returns empty for quant when quality_tier undefined", () => {
            const plugin = makePlugin();
            const app = new App();
            const modal = new CatalogModal(app as any, plugin as any);
            const item = { family: makeFamily(), variant: makeVariant({ quality_tier: undefined }) };
            expect((modal as any).getSortValue(item, "quant")).toBe("");
        });

        it("list row falls back to family task when variant task is empty", async () => {
            const families = [
                makeFamily({
                    featured: true,
                    task: "embedding",
                    variants: [makeVariant({ task: "", hf_repo: "test/embed" })],
                }),
            ];
            const plugin = makePlugin({ activeModel: "other" });
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse(families)));
            const app = new App();
            const modal = new CatalogModal(app as any, plugin as any);
            modal.open();
            await vi.runAllTimersAsync();

            const el = modal.contentEl as unknown as MockElement;
            el.find("lilbee-catalog-view-toggle")!.trigger("click");

            const taskCols = el
                .findAll("lilbee-catalog-list-col-task")
                .filter((e) => e.parentElement?.classList.contains("lilbee-catalog-list-row"));
            expect(taskCols[0].textContent).toBe("embedding");
        });

        it("sortItems returns unsorted when no sortColumn set", () => {
            const plugin = makePlugin();
            const app = new App();
            const modal = new CatalogModal(app as any, plugin as any);
            const items = [
                { family: makeFamily(), variant: makeVariant({ display_name: "Z" }) },
                { family: makeFamily(), variant: makeVariant({ display_name: "A" }) },
            ];
            const result = (modal as any).sortItems(items);
            expect(result[0].variant.display_name).toBe("Z");
        });

        it("list view Use button calls handleUse", async () => {
            vi.useRealTimers();
            const families = [
                makeFamily({
                    featured: true,
                    variants: [makeVariant({ hf_repo: "test/use-me", installed: true })],
                }),
            ];
            const plugin = makePlugin({ activeModel: "different" });
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse(families)));
            const app = new App();
            const modal = new CatalogModal(app as any, plugin as any);
            modal.open();
            await tick();

            const el = modal.contentEl as unknown as MockElement;
            el.find("lilbee-catalog-view-toggle")!.trigger("click");
            const useBtn = el.find("lilbee-catalog-use")!;
            useBtn.trigger("click");
            await tick();

            expect(plugin.api.setChatModel).toHaveBeenCalledWith("test/use-me");
        });

        it("list view Remove button calls handleRemove", async () => {
            vi.useRealTimers();
            mockConfirmRemoveResult = true;
            const families = [
                makeFamily({
                    featured: true,
                    variants: [makeVariant({ hf_repo: "test/remove-me", installed: true })],
                }),
            ];
            const plugin = makePlugin({ activeModel: "different" });
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse(families)));
            const app = new App();
            const modal = new CatalogModal(app as any, plugin as any);
            modal.open();
            await tick();

            const el = modal.contentEl as unknown as MockElement;
            el.find("lilbee-catalog-view-toggle")!.trigger("click");
            const removeBtn = el.find("lilbee-catalog-remove")!;
            removeBtn.trigger("click");
            await tick();
            await tick();

            expect(plugin.api.deleteModel).toHaveBeenCalledWith("test/remove-me", "native");
        });

        it("list view Pull button calls handlePull", async () => {
            vi.useRealTimers();
            const families = [
                makeFamily({
                    featured: true,
                    variants: [makeVariant({ hf_repo: "test/pull-me", installed: false })],
                }),
            ];
            const plugin = makePlugin({ activeModel: "other" });
            plugin.api.catalog.mockResolvedValue(ok(makeCatalogResponse(families)));
            plugin.api.pullModel.mockReturnValue(
                (async function* () {
                    yield { event: SSE_EVENT.PROGRESS, data: { current: 100, total: 100 } };
                })(),
            );
            const app = new App();
            const modal = new CatalogModal(app as any, plugin as any);
            modal.open();
            await tick();

            const el = modal.contentEl as unknown as MockElement;
            el.find("lilbee-catalog-view-toggle")!.trigger("click");
            const pullBtn = el.find("lilbee-catalog-pull")!;
            pullBtn.trigger("click");
            await tick();
            await tick();

            expect(plugin.api.pullModel).toHaveBeenCalledWith("test/pull-me", "native");
        });
    });
});
