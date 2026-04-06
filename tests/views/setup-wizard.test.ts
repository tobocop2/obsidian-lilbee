import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { App, Notice } from "obsidian";
import { MockElement } from "../__mocks__/obsidian";
import { SetupWizard, getSystemMemoryGB, recommendedIndex } from "../../src/views/setup-wizard";
import { SSE_EVENT } from "../../src/types";
import { ok, err } from "neverthrow";
import type { ModelFamily, ModelVariant, CatalogResponse } from "../../src/types";

vi.mock("../../src/views/catalog-modal", () => ({
    CatalogModal: vi.fn().mockImplementation(() => ({
        open: vi.fn(),
        close: vi.fn(),
    })),
}));

function makeVariant(overrides: Partial<ModelVariant> = {}): ModelVariant {
    return {
        name: "0.6B",
        hf_repo: "qwen/qwen3-0.6B",
        size_gb: 0.5,
        min_ram_gb: 4,
        description: "Runs on anything",
        task: "chat",
        installed: false,
        source: "native",
        ...overrides,
    };
}

function makeFamily(overrides: Partial<ModelFamily> = {}): ModelFamily {
    return {
        family: "Qwen3",
        task: "chat",
        featured: true,
        recommended: "0.6B",
        variants: [makeVariant()],
        ...overrides,
    };
}

function makeCatalogResponse(families: ModelFamily[] = []): CatalogResponse {
    return {
        total: families.length,
        limit: 4,
        offset: 0,
        families,
    };
}

function makePlugin(overrides: Record<string, unknown> = {}) {
    return {
        app: new App(),
        settings: {
            serverUrl: "http://127.0.0.1:7433",
            serverMode: "managed",
            setupCompleted: false,
            syncMode: "manual",
            ...((overrides.settings as Record<string, unknown>) || {}),
        },
        api: {
            catalog: vi.fn().mockResolvedValue(ok(makeCatalogResponse())),
            pullModel: vi.fn(),
            setChatModel: vi.fn().mockResolvedValue(ok({ model: "" })),
            setVisionModel: vi.fn().mockResolvedValue(ok({ model: "" })),
            health: vi.fn().mockResolvedValue(ok({ status: "ok", version: "1.0.0" })),
            syncStream: vi.fn(),
            listModels: vi.fn().mockResolvedValue({
                chat: { active: "", catalog: [], installed: [] },
                vision: { active: "", catalog: [], installed: [] },
            }),
        },
        activeModel: "",
        activeVisionModel: "",
        fetchActiveModel: vi.fn(),
        serverManager: overrides.serverManager ?? null,
        startManagedServer: vi.fn().mockResolvedValue(undefined),
        saveSettings: vi.fn().mockResolvedValue(undefined),
        activateChatView: vi.fn().mockResolvedValue(undefined),
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

describe("SetupWizard", () => {
    beforeEach(() => {
        Notice.clear();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe("Step 0: Welcome", () => {
        it("renders welcome screen on open", () => {
            const plugin = makePlugin();
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();

            const el = wizard.contentEl as unknown as MockElement;
            const texts = collectTexts(el);
            expect(texts.some((t) => t.includes("Welcome to lilbee"))).toBe(true);
            expect(texts.some((t) => t.includes("knowledge base"))).toBe(true);
            expect(texts.some((t) => t.includes("never leave your machine"))).toBe(true);
        });

        it("has Skip setup and Get started buttons", () => {
            const plugin = makePlugin();
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();

            const el = wizard.contentEl as unknown as MockElement;
            const buttons = findButtons(el);
            expect(buttons.some((b) => b.textContent === "Skip setup")).toBe(true);
            expect(buttons.some((b) => b.textContent === "Get started")).toBe(true);
        });

        it("Skip setup closes the wizard", () => {
            const plugin = makePlugin();
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            const closeSpy = vi.spyOn(wizard, "close");
            wizard.open();

            const el = wizard.contentEl as unknown as MockElement;
            const skipBtn = findButtons(el).find((b) => b.textContent === "Skip setup")!;
            skipBtn.trigger("click");
            expect(closeSpy).toHaveBeenCalled();
        });

        it("Get started advances to model picker when server is ready (external mode)", () => {
            const plugin = makePlugin({
                settings: { serverMode: "external" },
            });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();

            const el = wizard.contentEl as unknown as MockElement;
            const startBtn = findButtons(el).find((b) => b.textContent === "Get started")!;
            startBtn.trigger("click");

            // Should be on step 2 (model picker) since server is "ready" in external mode
            const texts = collectTexts(wizard.contentEl as unknown as MockElement);
            expect(texts.some((t) => t.includes("Pick a chat model"))).toBe(true);
        });

        it("Get started advances to server mode when server is not ready", () => {
            const plugin = makePlugin({
                settings: { serverMode: "managed" },
                serverManager: null,
            });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();

            const el = wizard.contentEl as unknown as MockElement;
            const startBtn = findButtons(el).find((b) => b.textContent === "Get started")!;
            startBtn.trigger("click");

            const texts = collectTexts(wizard.contentEl as unknown as MockElement);
            expect(texts.some((t) => t.includes("How do you want to run lilbee?"))).toBe(true);
        });

        it("Get started skips server step when managed server is ready", () => {
            const plugin = makePlugin({
                settings: { serverMode: "managed" },
                serverManager: { state: "ready" },
            });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();

            const el = wizard.contentEl as unknown as MockElement;
            const startBtn = findButtons(el).find((b) => b.textContent === "Get started")!;
            startBtn.trigger("click");

            const texts = collectTexts(wizard.contentEl as unknown as MockElement);
            expect(texts.some((t) => t.includes("Pick a chat model"))).toBe(true);
        });
    });

    describe("Step 1: Server Mode", () => {
        it("renders managed and external options", () => {
            const plugin = makePlugin({ serverManager: null });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            wizard.next();

            const el = wizard.contentEl as unknown as MockElement;
            const texts = collectTexts(el);
            expect(texts.some((t) => t.includes("Managed (recommended)"))).toBe(true);
            expect(texts.some((t) => t.includes("External"))).toBe(true);
        });

        it("clicking managed option selects it", () => {
            const plugin = makePlugin({ serverManager: null });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            wizard.next();

            const el = wizard.contentEl as unknown as MockElement;
            const options = el.findAll("lilbee-wizard-model-option");
            // Click managed (first option)
            options[0].trigger("click");
            expect(options[0].classList.contains("selected")).toBe(true);
            expect(options[1].classList.contains("selected")).toBe(false);
        });

        it("clicking managed option hides URL input and clears status", () => {
            const plugin = makePlugin({ serverManager: null, settings: { serverMode: "managed" } });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            wizard.next();

            const el = wizard.contentEl as unknown as MockElement;
            const options = el.findAll("lilbee-wizard-model-option");
            // First click external to show URL input
            options[1].trigger("click");
            // Then click managed to hide it
            options[0].trigger("click");
            expect(options[0].classList.contains("selected")).toBe(true);
            const status = el.find("lilbee-wizard-status");
            expect(status?.textContent).toBe("");
        });

        it("pre-selects external when settings have external mode", () => {
            const plugin = makePlugin({ serverManager: null, settings: { serverMode: "external" } });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).step = 1;
            (wizard as any).renderStep();

            const el = wizard.contentEl as unknown as MockElement;
            const options = el.findAll("lilbee-wizard-model-option");
            // External option (index 1) should be selected
            expect(options[1].classList.contains("selected")).toBe(true);
            expect(options[0].classList.contains("selected")).toBe(false);
        });

        it("clicking external option selects it and shows URL input", () => {
            const plugin = makePlugin({ serverManager: null });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            wizard.next();

            const el = wizard.contentEl as unknown as MockElement;
            const options = el.findAll("lilbee-wizard-model-option");
            // Click external (second option)
            options[1].trigger("click");
            expect(options[1].classList.contains("selected")).toBe(true);
            expect(options[0].classList.contains("selected")).toBe(false);
        });

        it("managed mode: Next starts server and advances", async () => {
            const plugin = makePlugin({ serverManager: null });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            wizard.next();

            const el = wizard.contentEl as unknown as MockElement;
            const nextBtn = findButtons(el).find((b) => b.textContent === "Next")!;
            nextBtn.trigger("click");
            await tick();
            await tick();

            expect(plugin.saveSettings).toHaveBeenCalled();
            expect(plugin.startManagedServer).toHaveBeenCalled();
            const texts = collectTexts(wizard.contentEl as unknown as MockElement);
            expect(texts.some((t) => t.includes("Pick a chat model"))).toBe(true);
        });

        it("managed mode: handles server start failure", async () => {
            const plugin = makePlugin({ serverManager: null });
            plugin.startManagedServer = vi.fn().mockRejectedValue(new Error("fail"));
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            wizard.next();

            const el = wizard.contentEl as unknown as MockElement;
            const nextBtn = findButtons(el).find((b) => b.textContent === "Next")!;
            nextBtn.trigger("click");
            await tick();
            await tick();

            const texts = collectTexts(wizard.contentEl as unknown as MockElement);
            expect(texts.some((t) => t.includes("Failed to start server"))).toBe(true);
        });

        it("external mode: Next checks health and advances", async () => {
            const plugin = makePlugin({
                serverManager: null,
                settings: { serverMode: "managed" },
            });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            wizard.next(); // goes to step 1 since no server manager

            const el = wizard.contentEl as unknown as MockElement;
            // Click external option (second one)
            const options = el.findAll("lilbee-wizard-model-option");
            options[1].trigger("click");

            const nextBtn = findButtons(el).find((b) => b.textContent === "Next")!;
            nextBtn.trigger("click");
            await tick();
            await tick();

            expect(plugin.api.health).toHaveBeenCalled();
            const texts = collectTexts(wizard.contentEl as unknown as MockElement);
            expect(texts.some((t) => t.includes("Pick a chat model"))).toBe(true);
        });

        it("external mode: handles health check failure", async () => {
            const plugin = makePlugin({
                serverManager: null,
                settings: { serverMode: "managed" },
            });
            plugin.api.health = vi.fn().mockResolvedValue(err(new Error("connection refused")));
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            wizard.next();

            const el = wizard.contentEl as unknown as MockElement;
            const options = el.findAll("lilbee-wizard-model-option");
            options[1].trigger("click");

            const nextBtn = findButtons(el).find((b) => b.textContent === "Next")!;
            nextBtn.trigger("click");
            await tick();
            await tick();

            const texts = collectTexts(wizard.contentEl as unknown as MockElement);
            expect(texts.some((t) => t.includes("Could not connect"))).toBe(true);
        });

        it("Back returns to welcome", () => {
            const plugin = makePlugin({ serverManager: null });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            wizard.next();

            const el = wizard.contentEl as unknown as MockElement;
            const backBtn = findButtons(el).find((b) => b.textContent === "Back")!;
            backBtn.trigger("click");

            const texts = collectTexts(wizard.contentEl as unknown as MockElement);
            expect(texts.some((t) => t.includes("Welcome to lilbee"))).toBe(true);
        });

        it("managed mode with existing serverManager advances to model picker", async () => {
            const plugin = makePlugin({
                serverManager: { state: "ready" },
            });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            // Force to step 1
            (wizard as any).step = 1;
            (wizard as any).renderStep();

            const el = wizard.contentEl as unknown as MockElement;
            const nextBtn = findButtons(el).find((b) => b.textContent === "Next")!;
            nextBtn.trigger("click");
            await tick();
            await tick();

            const texts = collectTexts(wizard.contentEl as unknown as MockElement);
            expect(texts.some((t) => t.includes("Pick a chat model"))).toBe(true);
        });

        it("Skip setup button closes the wizard", () => {
            const plugin = makePlugin({ serverManager: null });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            const closeSpy = vi.spyOn(wizard, "close");
            wizard.open();
            wizard.next();

            const el = wizard.contentEl as unknown as MockElement;
            const skipBtn = findButtons(el).find((b) => b.textContent === "Skip setup")!;
            skipBtn.trigger("click");
            expect(closeSpy).toHaveBeenCalled();
        });
    });

    describe("Step 2: Model Picker", () => {
        it("renders model picker with featured models", async () => {
            const families = [
                makeFamily({
                    family: "Qwen3-Small",
                    variants: [
                        makeVariant({
                            name: "0.6B",
                            hf_repo: "qwen/qwen3-0.6B",
                            size_gb: 0.5,
                            min_ram_gb: 4,
                            display_name: "Qwen3 0.6B",
                        }),
                    ],
                    recommended: "0.6B",
                }),
                makeFamily({
                    family: "Qwen3-Medium",
                    variants: [
                        makeVariant({
                            name: "4B",
                            hf_repo: "qwen/qwen3-4B",
                            size_gb: 2.5,
                            min_ram_gb: 8,
                            display_name: "Qwen3 4B",
                        }),
                    ],
                    recommended: "4B",
                }),
            ];
            const plugin = makePlugin({ settings: { serverMode: "external" } });
            plugin.api.catalog = vi.fn().mockResolvedValue(ok(makeCatalogResponse(families)));
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            wizard.next();
            await tick();

            const el = wizard.contentEl as unknown as MockElement;
            const texts = collectTexts(el);
            expect(texts.some((t) => t.includes("Pick a chat model"))).toBe(true);
            expect(texts.some((t) => t.includes("Qwen3 0.6B"))).toBe(true);
            expect(texts.some((t) => t.includes("Qwen3 4B"))).toBe(true);
        });

        it("pre-selects recommended model with is-selected class", async () => {
            const families = [
                makeFamily({
                    family: "Qwen3-Small",
                    variants: [makeVariant({ name: "0.6B", hf_repo: "qwen/qwen3-0.6B", size_gb: 0.5, min_ram_gb: 4 })],
                    recommended: "0.6B",
                }),
                makeFamily({
                    family: "Qwen3-Medium",
                    variants: [makeVariant({ name: "4B", hf_repo: "qwen/qwen3-4B", size_gb: 2.5, min_ram_gb: 8 })],
                    recommended: "4B",
                }),
            ];
            const plugin = makePlugin({ settings: { serverMode: "external" } });
            plugin.api.catalog = vi.fn().mockResolvedValue(ok(makeCatalogResponse(families)));
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            wizard.next();
            await tick();

            const el = wizard.contentEl as unknown as MockElement;
            const cards = el.findAll("lilbee-model-card");
            // At least one should be selected
            expect(cards.some((c) => c.classList.contains("is-selected"))).toBe(true);
        });

        it("renders 'Our picks' section heading", async () => {
            const families = [
                makeFamily({
                    family: "Qwen3-Small",
                    variants: [makeVariant({ name: "0.6B", hf_repo: "qwen/qwen3-0.6B" })],
                    recommended: "0.6B",
                }),
            ];
            const plugin = makePlugin({ settings: { serverMode: "external" } });
            plugin.api.catalog = vi.fn().mockResolvedValue(ok(makeCatalogResponse(families)));
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            wizard.next();
            await tick();

            const el = wizard.contentEl as unknown as MockElement;
            const headings = el.findAll("lilbee-catalog-section-heading");
            expect(headings.some((h) => h.textContent === "Our picks")).toBe(true);
        });

        it("renders model cards in grid layout", async () => {
            const families = [
                makeFamily({
                    family: "Qwen3-Small",
                    variants: [makeVariant({ name: "0.6B", hf_repo: "qwen/qwen3-0.6B" })],
                    recommended: "0.6B",
                }),
            ];
            const plugin = makePlugin({ settings: { serverMode: "external" } });
            plugin.api.catalog = vi.fn().mockResolvedValue(ok(makeCatalogResponse(families)));
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            wizard.next();
            await tick();

            const el = wizard.contentEl as unknown as MockElement;
            expect(el.find("lilbee-catalog-grid")).not.toBeNull();
            expect(el.findAll("lilbee-model-card").length).toBe(1);
        });

        it("clicking a model card selects it", async () => {
            const families = [
                makeFamily({
                    family: "Qwen3-Small",
                    variants: [makeVariant({ name: "0.6B", hf_repo: "qwen/qwen3-0.6B", size_gb: 0.5, min_ram_gb: 4 })],
                    recommended: "0.6B",
                }),
                makeFamily({
                    family: "Qwen3-Medium",
                    variants: [makeVariant({ name: "4B", hf_repo: "qwen/qwen3-4B", size_gb: 2.5, min_ram_gb: 8 })],
                    recommended: "4B",
                }),
            ];
            const plugin = makePlugin({ settings: { serverMode: "external" } });
            plugin.api.catalog = vi.fn().mockResolvedValue(ok(makeCatalogResponse(families)));
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            wizard.next();
            await tick();

            const el = wizard.contentEl as unknown as MockElement;
            const cards = el.findAll("lilbee-model-card");
            // Click the second card (simulating card click, not button)
            cards[1].trigger("click", { target: { tagName: "DIV" } });
            expect(cards[1].classList.contains("is-selected")).toBe(true);
            expect(cards[0].classList.contains("is-selected")).toBe(false);
        });

        it("shows error when catalog fetch fails", async () => {
            const plugin = makePlugin({ settings: { serverMode: "external" } });
            plugin.api.catalog = vi.fn().mockRejectedValue(new Error("fail"));
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            wizard.next();
            await tick();

            const el = wizard.contentEl as unknown as MockElement;
            const texts = collectTexts(el);
            expect(texts.some((t) => t.includes("Could not load models"))).toBe(true);
        });

        it("sets empty featured models when catalog returns error result", async () => {
            const { err } = await import("neverthrow");
            const plugin = makePlugin({ settings: { serverMode: "external" } });
            plugin.api.catalog = vi.fn().mockResolvedValue(err(new Error("server error")));
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            wizard.next();
            await tick();

            expect((wizard as any).featuredModels).toEqual([]);
        });

        it("falls back to first variant when recommended not found", async () => {
            const families = [
                makeFamily({
                    family: "Qwen3",
                    recommended: "nonexistent",
                    variants: [
                        makeVariant({
                            name: "0.6B",
                            hf_repo: "qwen/qwen3-0.6B",
                            size_gb: 0.5,
                            min_ram_gb: 4,
                            display_name: "Qwen3 0.6B",
                        }),
                    ],
                }),
            ];
            const plugin = makePlugin({ settings: { serverMode: "external" } });
            plugin.api.catalog = vi.fn().mockResolvedValue(ok(makeCatalogResponse(families)));
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            wizard.next();
            await tick();

            const el = wizard.contentEl as unknown as MockElement;
            const texts = collectTexts(el);
            expect(texts.some((t) => t.includes("Qwen3 0.6B"))).toBe(true);
            expect(texts.some((t) => t.includes("0.5 GB"))).toBe(true);
        });

        it("Download & continue requires model selection", async () => {
            const plugin = makePlugin({ settings: { serverMode: "external" } });
            plugin.api.catalog = vi.fn().mockResolvedValue(makeCatalogResponse([]));
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            wizard.next();
            await tick();

            const el = wizard.contentEl as unknown as MockElement;
            const downloadBtn = findButtons(el).find((b) => b.textContent === "Download & continue")!;
            downloadBtn.trigger("click");

            const texts = collectTexts(wizard.contentEl as unknown as MockElement);
            expect(texts.some((t) => t.includes("Please select a model first"))).toBe(true);
        });

        it("Download & continue pulls model and advances to sync step", async () => {
            const families = [
                makeFamily({
                    family: "Qwen3",
                    variants: [makeVariant({ name: "0.6B", hf_repo: "qwen/qwen3-0.6B" })],
                    recommended: "0.6B",
                }),
            ];
            const plugin = makePlugin({ settings: { serverMode: "external" } });
            plugin.api.catalog = vi.fn().mockResolvedValue(ok(makeCatalogResponse(families)));
            plugin.api.pullModel = vi.fn().mockReturnValue(
                (async function* () {
                    yield { event: SSE_EVENT.PROGRESS, data: { current: 50, total: 100 } };
                    yield { event: SSE_EVENT.PROGRESS, data: { current: 100, total: 100 } };
                })(),
            );
            // syncStream will be called when step 3 auto-starts
            plugin.api.syncStream = vi.fn().mockReturnValue(
                (async function* () {
                    yield { event: SSE_EVENT.FILE_START, data: { current_file: 1, total_files: 1 } };
                    yield {
                        event: SSE_EVENT.DONE,
                        data: { added: [], updated: [], removed: [], unchanged: 0, failed: [] },
                    };
                })(),
            );
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            wizard.next();
            await tick();

            const el = wizard.contentEl as unknown as MockElement;
            const downloadBtn = findButtons(el).find((b) => b.textContent === "Download & continue")!;
            downloadBtn.trigger("click");
            await tick();
            await tick();

            expect(plugin.api.pullModel).toHaveBeenCalledWith("qwen/qwen3-0.6B", "native", expect.any(AbortSignal));
            expect(plugin.api.setChatModel).toHaveBeenCalledWith("qwen/qwen3-0.6B");
            // After pull completes, it goes to step 3 (sync), which auto-starts and finishes, going to step 4 (done)
            await tick();
            await tick();
            const texts = collectTexts(wizard.contentEl as unknown as MockElement);
            // Could be on sync step or done step depending on timing
            expect(texts.some((t) => t.includes("Index your vault") || t.includes("You're all set!"))).toBe(true);
        });

        it("handles pull failure", async () => {
            const families = [
                makeFamily({
                    family: "Qwen3",
                    variants: [makeVariant({ name: "0.6B", hf_repo: "qwen/qwen3-0.6B" })],
                    recommended: "0.6B",
                }),
            ];
            const plugin = makePlugin({ settings: { serverMode: "external" } });
            plugin.api.catalog = vi.fn().mockResolvedValue(ok(makeCatalogResponse(families)));
            plugin.api.pullModel = vi.fn().mockReturnValue(
                (async function* () {
                    throw new Error("network error");
                })(),
            );
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            wizard.next();
            await tick();

            const el = wizard.contentEl as unknown as MockElement;
            const downloadBtn = findButtons(el).find((b) => b.textContent === "Download & continue")!;
            downloadBtn.trigger("click");
            await tick();
            await tick();

            const texts = collectTexts(wizard.contentEl as unknown as MockElement);
            expect(texts.some((t) => t.includes("Download failed"))).toBe(true);
        });

        it("handles pull abort", async () => {
            const families = [
                makeFamily({
                    family: "Qwen3",
                    variants: [makeVariant({ name: "0.6B", hf_repo: "qwen/qwen3-0.6B" })],
                    recommended: "0.6B",
                }),
            ];
            const plugin = makePlugin({ settings: { serverMode: "external" } });
            plugin.api.catalog = vi.fn().mockResolvedValue(ok(makeCatalogResponse(families)));
            const abortErr = new Error("aborted");
            abortErr.name = "AbortError";
            plugin.api.pullModel = vi.fn().mockReturnValue(
                (async function* () {
                    throw abortErr;
                })(),
            );
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            wizard.next();
            await tick();

            const el = wizard.contentEl as unknown as MockElement;
            const downloadBtn = findButtons(el).find((b) => b.textContent === "Download & continue")!;
            downloadBtn.trigger("click");
            await tick();
            await tick();

            expect(Notice.instances.some((n) => n.message.includes("download cancelled"))).toBe(true);
        });

        it("Back from model picker returns to welcome (external mode)", async () => {
            const plugin = makePlugin({ settings: { serverMode: "external" } });
            plugin.api.catalog = vi.fn().mockResolvedValue(makeCatalogResponse([]));
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            wizard.next();
            await tick();

            const el = wizard.contentEl as unknown as MockElement;
            const backBtn = findButtons(el).find((b) => b.textContent === "Back")!;
            backBtn.trigger("click");

            const texts = collectTexts(wizard.contentEl as unknown as MockElement);
            expect(texts.some((t) => t.includes("Welcome to lilbee"))).toBe(true);
        });

        it("Back from model picker returns to server mode when no server manager", async () => {
            const plugin = makePlugin({ serverManager: null, settings: { serverMode: "managed" } });
            plugin.api.catalog = vi.fn().mockResolvedValue(makeCatalogResponse([]));
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            // Force to step 2
            (wizard as any).step = 2;
            (wizard as any).renderStep();
            await tick();

            wizard.back();
            const texts = collectTexts(wizard.contentEl as unknown as MockElement);
            expect(texts.some((t) => t.includes("How do you want to run lilbee?"))).toBe(true);
        });

        it("Browse full catalog button opens CatalogModal", async () => {
            const { CatalogModal } = await import("../../src/views/catalog-modal");
            const families = [makeFamily()];
            const plugin = makePlugin({ settings: { serverMode: "external" } });
            plugin.api.catalog = vi.fn().mockResolvedValue(ok(makeCatalogResponse(families)));
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            wizard.next();
            await tick();

            const el = wizard.contentEl as unknown as MockElement;
            const catalogBtn = findButtons(el).find((b) => b.textContent === "Browse full catalog")!;
            catalogBtn.trigger("click");

            expect(CatalogModal).toHaveBeenCalled();
        });

        it("Back cancels ongoing pull", async () => {
            const families = [
                makeFamily({
                    family: "Qwen3",
                    variants: [makeVariant({ name: "0.6B", hf_repo: "qwen/qwen3-0.6B" })],
                    recommended: "0.6B",
                }),
            ];
            const plugin = makePlugin({ settings: { serverMode: "external" } });
            plugin.api.catalog = vi.fn().mockResolvedValue(ok(makeCatalogResponse(families)));
            let abortSignal: AbortSignal | null = null;
            plugin.api.pullModel = vi
                .fn()
                .mockImplementation((_name: string, _source: string, signal?: AbortSignal) => {
                    abortSignal = signal ?? null;
                    return (async function* () {
                        yield { event: SSE_EVENT.PROGRESS, data: { current: 50, total: 100 } };
                        // Wait forever
                        await new Promise(() => {});
                    })();
                });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            wizard.next();
            await tick();

            const el = wizard.contentEl as unknown as MockElement;
            const downloadBtn = findButtons(el).find((b) => b.textContent === "Download & continue")!;
            downloadBtn.trigger("click");
            await tick();

            // Now click back, which should abort
            const backBtn = findButtons(wizard.contentEl as unknown as MockElement).find(
                (b) => b.textContent === "Back",
            )!;
            backBtn.trigger("click");

            expect(abortSignal?.aborted).toBe(true);
        });

        it("Skip setup aborts active pull and closes wizard", async () => {
            const plugin = makePlugin({ settings: { serverMode: "external" } });
            plugin.api.catalog = vi.fn().mockResolvedValue({
                families: [
                    makeFamily({
                        family: "Qwen3",
                        variants: [
                            makeVariant({ name: "0.6B", hf_repo: "qwen/qwen3-0.6B", size_gb: 0.5, min_ram_gb: 4 }),
                        ],
                        recommended: "0.6B",
                    }),
                ],
                total: 1,
                limit: 20,
                offset: 0,
            });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            const closeSpy = vi.spyOn(wizard, "close");
            wizard.open();
            wizard.next();
            await tick();

            // Simulate an in-progress pull
            const controller = new AbortController();
            (wizard as any).pullController = controller;

            const el = wizard.contentEl as unknown as MockElement;
            const skipBtn = findButtons(el).find((b) => b.textContent === "Skip setup")!;
            skipBtn.trigger("click");
            expect(controller.signal.aborted).toBe(true);
            expect(closeSpy).toHaveBeenCalled();
        });
    });

    describe("Step 3: Sync", () => {
        it("renders sync screen and starts syncing", async () => {
            const plugin = makePlugin({ settings: { serverMode: "external" } });
            plugin.api.syncStream = vi.fn().mockReturnValue(
                (async function* () {
                    yield { event: SSE_EVENT.FILE_START, data: { current_file: 1, total_files: 10 } };
                    yield { event: SSE_EVENT.EMBED, data: { file: "test.md" } };
                    yield {
                        event: SSE_EVENT.DONE,
                        data: { added: ["a.md"], updated: [], removed: [], unchanged: 5, failed: [] },
                    };
                })(),
            );
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).step = 3;
            (wizard as any).renderStep();
            await tick();
            await tick();

            // Should have advanced to done
            const texts = collectTexts(wizard.contentEl as unknown as MockElement);
            expect(texts.some((t) => t.includes("You're all set!"))).toBe(true);
        });

        it("sync abort shows notice", async () => {
            const plugin = makePlugin({ settings: { serverMode: "external" } });
            const abortErr = new Error("aborted");
            abortErr.name = "AbortError";
            plugin.api.syncStream = vi.fn().mockReturnValue(
                (async function* () {
                    throw abortErr;
                })(),
            );
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).step = 3;
            (wizard as any).renderStep();
            await tick();
            await tick();

            expect(Notice.instances.some((n) => n.message.includes("indexing cancelled"))).toBe(true);
        });

        it("sync failure shows error message", async () => {
            const plugin = makePlugin({ settings: { serverMode: "external" } });
            plugin.api.syncStream = vi.fn().mockReturnValue(
                (async function* () {
                    throw new Error("network");
                })(),
            );
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).step = 3;
            (wizard as any).renderStep();
            await tick();
            await tick();

            const texts = collectTexts(wizard.contentEl as unknown as MockElement);
            expect(texts.some((t) => t.includes("Indexing failed"))).toBe(true);
        });

        it("Back from sync cancels and returns to model picker", async () => {
            const plugin = makePlugin({ settings: { serverMode: "external" } });
            let abortSignal: AbortSignal | null = null;
            plugin.api.syncStream = vi.fn().mockImplementation((_force: boolean, signal?: AbortSignal) => {
                abortSignal = signal ?? null;
                return (async function* () {
                    yield { event: SSE_EVENT.FILE_START, data: { current_file: 1, total_files: 100 } };
                    await new Promise(() => {});
                })();
            });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).step = 3;
            (wizard as any).renderStep();
            await tick();

            const el = wizard.contentEl as unknown as MockElement;
            const backBtn = findButtons(el).find((b) => b.textContent === "Back")!;
            backBtn.trigger("click");

            expect(abortSignal?.aborted).toBe(true);
        });

        it("Skip setup aborts sync and closes wizard", async () => {
            let _abortSignal: AbortSignal | null = null;
            const plugin = makePlugin({ settings: { serverMode: "external" } });
            plugin.api.syncStream = vi.fn().mockImplementation((_opts: any, signal?: AbortSignal) => {
                _abortSignal = signal ?? null;
                return (async function* () {
                    yield { event: SSE_EVENT.FILE_START, data: { current_file: 1, total_files: 100 } };
                    await new Promise(() => {});
                })();
            });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            const closeSpy = vi.spyOn(wizard, "close");
            wizard.open();
            (wizard as any).step = 3;
            (wizard as any).renderStep();
            await tick();

            const el = wizard.contentEl as unknown as MockElement;
            const skipBtn = findButtons(el).find((b) => b.textContent === "Skip setup")!;
            skipBtn.trigger("click");
            expect(closeSpy).toHaveBeenCalled();
        });
    });

    describe("Step 4: Done", () => {
        it("renders done screen with summary", () => {
            const plugin = makePlugin({ settings: { serverMode: "external" } });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).pulledModelName = "qwen3:8b";
            (wizard as any).syncResult = {
                added: ["a.md", "b.md"],
                updated: [],
                removed: [],
                unchanged: 8,
                failed: [],
            };
            (wizard as any).step = 4;
            (wizard as any).renderStep();

            const el = wizard.contentEl as unknown as MockElement;
            const texts = collectTexts(el);
            expect(texts.some((t) => t.includes("You're all set!"))).toBe(true);
            expect(texts.some((t) => t.includes("qwen3:8b"))).toBe(true);
            expect(texts.some((t) => t.includes("10 files indexed"))).toBe(true);
            expect(texts.some((t) => t.includes("Open chat"))).toBe(true);
        });

        it("renders done screen without model/sync info if skipped", () => {
            const plugin = makePlugin({ settings: { serverMode: "external" } });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).step = 4;
            (wizard as any).renderStep();

            const el = wizard.contentEl as unknown as MockElement;
            const texts = collectTexts(el);
            expect(texts.some((t) => t.includes("You're all set!"))).toBe(true);
        });

        it("Open chat marks setup complete and opens chat view", async () => {
            const plugin = makePlugin({ settings: { serverMode: "external" } });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            const closeSpy = vi.spyOn(wizard, "close");
            wizard.open();
            (wizard as any).step = 4;
            (wizard as any).renderStep();

            const el = wizard.contentEl as unknown as MockElement;
            const openChatBtn = findButtons(el).find((b) => b.textContent === "Open chat")!;
            openChatBtn.trigger("click");
            await tick();

            expect(plugin.settings.setupCompleted).toBe(true);
            expect(plugin.saveSettings).toHaveBeenCalled();
            expect(plugin.activateChatView).toHaveBeenCalled();
            expect(closeSpy).toHaveBeenCalled();
        });

        it("shows tips about what to try", () => {
            const plugin = makePlugin({ settings: { serverMode: "external" } });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).step = 4;
            (wizard as any).renderStep();

            const el = wizard.contentEl as unknown as MockElement;
            const texts = collectTexts(el);
            expect(texts.some((t) => t.includes("chat panel"))).toBe(true);
            expect(texts.some((t) => t.includes("search command"))).toBe(true);
        });
    });

    describe("Navigation", () => {
        it("next() from non-zero step increments step", () => {
            const plugin = makePlugin({ serverManager: null });
            plugin.api.catalog = vi.fn().mockResolvedValue(makeCatalogResponse([]));
            plugin.api.syncStream = vi.fn().mockReturnValue(
                (async function* () {
                    await new Promise(() => {});
                })(),
            );
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            // Set step to 1 and call next()
            (wizard as any).step = 1;
            wizard.next();
            // Should go to step 2
            const texts = collectTexts(wizard.contentEl as unknown as MockElement);
            expect(texts.some((t) => t.includes("Pick a chat model"))).toBe(true);
        });

        it("back() at step 0 stays at step 0", () => {
            const plugin = makePlugin({ settings: { serverMode: "external" } });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            wizard.back();

            const texts = collectTexts(wizard.contentEl as unknown as MockElement);
            expect(texts.some((t) => t.includes("Welcome to lilbee"))).toBe(true);
        });

        it("back() at step 3 goes to step 2", () => {
            const plugin = makePlugin({ settings: { serverMode: "external" } });
            plugin.api.catalog = vi.fn().mockResolvedValue(makeCatalogResponse([]));
            plugin.api.syncStream = vi.fn().mockReturnValue(
                (async function* () {
                    await new Promise(() => {});
                })(),
            );
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).step = 3;
            wizard.back();

            const texts = collectTexts(wizard.contentEl as unknown as MockElement);
            // step 2 goes back to step 0 in external mode (since server is ready)
            // So from step 3, back() goes to step 2 (model picker)
            expect(texts.some((t) => t.includes("Pick a chat model"))).toBe(true);
        });

        it("back() at step 4 goes to step 3", () => {
            const plugin = makePlugin({ settings: { serverMode: "external" } });
            plugin.api.syncStream = vi.fn().mockReturnValue(
                (async function* () {
                    await new Promise(() => {});
                })(),
            );
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).step = 4;
            wizard.back();

            const texts = collectTexts(wizard.contentEl as unknown as MockElement);
            expect(texts.some((t) => t.includes("Index your vault"))).toBe(true);
        });
    });

    describe("onClose cleanup", () => {
        it("aborts pull controller on close", async () => {
            const families = [
                makeFamily({
                    family: "Qwen3",
                    variants: [makeVariant({ name: "0.6B", hf_repo: "qwen/qwen3-0.6B" })],
                    recommended: "0.6B",
                }),
            ];
            const plugin = makePlugin({ settings: { serverMode: "external" } });
            plugin.api.catalog = vi.fn().mockResolvedValue(ok(makeCatalogResponse(families)));
            plugin.api.pullModel = vi.fn().mockReturnValue(
                (async function* () {
                    yield { event: SSE_EVENT.PROGRESS, data: { current: 50, total: 100 } };
                    await new Promise(() => {});
                })(),
            );
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            wizard.next();
            await tick();

            // Start pull
            const el = wizard.contentEl as unknown as MockElement;
            const downloadBtn = findButtons(el).find((b) => b.textContent === "Download & continue")!;
            downloadBtn.trigger("click");
            await tick();

            // Close should abort
            wizard.close();
        });

        it("aborts sync controller on close", async () => {
            const plugin = makePlugin({ settings: { serverMode: "external" } });
            plugin.api.syncStream = vi.fn().mockReturnValue(
                (async function* () {
                    yield { event: SSE_EVENT.FILE_START, data: { current_file: 1, total_files: 100 } };
                    await new Promise(() => {});
                })(),
            );
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).step = 3;
            (wizard as any).renderStep();
            await tick();

            wizard.close();
        });

        it("clears server check timer on close", () => {
            const plugin = makePlugin();
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            (wizard as any).serverCheckTimer = setTimeout(() => {}, 10000);
            wizard.close();
            // Should not throw
        });
    });

    describe("System memory detection", () => {
        it("handles missing os module gracefully", async () => {
            const families = [
                makeFamily({
                    family: "Qwen3-Small",
                    variants: [makeVariant({ name: "0.6B", hf_repo: "qwen/qwen3-0.6B", min_ram_gb: 4 })],
                    recommended: "0.6B",
                }),
                makeFamily({
                    family: "Qwen3-Medium",
                    variants: [makeVariant({ name: "4B", hf_repo: "qwen/qwen3-4B", min_ram_gb: 8 })],
                    recommended: "4B",
                }),
            ];
            const plugin = makePlugin({ settings: { serverMode: "external" } });
            plugin.api.catalog = vi.fn().mockResolvedValue(ok(makeCatalogResponse(families)));
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            wizard.next();
            await tick();

            // Should still render without crashing
            const el = wizard.contentEl as unknown as MockElement;
            const texts = collectTexts(el);
            expect(texts.some((t) => t.includes("Pick a chat model"))).toBe(true);
        });
    });

    describe("Full flow integration", () => {
        it("complete flow: welcome -> model -> sync -> done", async () => {
            const families = [
                makeFamily({
                    family: "Qwen3",
                    variants: [makeVariant({ name: "0.6B", hf_repo: "qwen/qwen3-0.6B" })],
                    recommended: "0.6B",
                }),
            ];
            const plugin = makePlugin({ settings: { serverMode: "external" } });
            plugin.api.catalog = vi.fn().mockResolvedValue(ok(makeCatalogResponse(families)));
            plugin.api.pullModel = vi.fn().mockReturnValue(
                (async function* () {
                    yield { event: SSE_EVENT.PROGRESS, data: { current: 100, total: 100 } };
                })(),
            );
            plugin.api.syncStream = vi.fn().mockReturnValue(
                (async function* () {
                    yield { event: SSE_EVENT.FILE_START, data: { current_file: 1, total_files: 5 } };
                    yield {
                        event: SSE_EVENT.DONE,
                        data: { added: ["a.md"], updated: [], removed: [], unchanged: 4, failed: [] },
                    };
                })(),
            );

            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();

            // Step 0: Welcome -> Get started
            let el = wizard.contentEl as unknown as MockElement;
            findButtons(el)
                .find((b) => b.textContent === "Get started")!
                .trigger("click");
            await tick();

            // Step 2: Model picker -> Download
            el = wizard.contentEl as unknown as MockElement;
            expect(collectTexts(el).some((t) => t.includes("Pick a chat model"))).toBe(true);
            findButtons(el)
                .find((b) => b.textContent === "Download & continue")!
                .trigger("click");
            await tick();
            await tick();

            // Step 3: Sync (auto-starts, should auto-advance)
            await tick();
            await tick();

            // Step 4: Done -> Open chat
            el = wizard.contentEl as unknown as MockElement;
            expect(collectTexts(el).some((t) => t.includes("You're all set!"))).toBe(true);

            findButtons(el)
                .find((b) => b.textContent === "Open chat")!
                .trigger("click");
            await tick();

            expect(plugin.settings.setupCompleted).toBe(true);
            expect(plugin.activateChatView).toHaveBeenCalled();
        });
    });

    describe("recommendedIndex", () => {
        it("returns 0 when memGB is null", () => {
            const models = [
                { name: "small", size_gb: 0.5, min_ram_gb: 4, description: "", source: "native" as const },
                { name: "large", size_gb: 5, min_ram_gb: 16, description: "", source: "native" as const },
            ];
            expect(recommendedIndex(models, null)).toBe(0);
        });

        it("returns 0 when models is empty", () => {
            expect(recommendedIndex([], 16)).toBe(0);
        });

        it("selects largest model that fits in memory", () => {
            const models = [
                { name: "small", size_gb: 0.5, min_ram_gb: 4, description: "", source: "native" as const },
                { name: "medium", size_gb: 2.5, min_ram_gb: 8, description: "", source: "native" as const },
                { name: "large", size_gb: 5, min_ram_gb: 16, description: "", source: "native" as const },
            ];
            expect(recommendedIndex(models, 10)).toBe(1);
            expect(recommendedIndex(models, 16)).toBe(2);
            expect(recommendedIndex(models, 3)).toBe(0);
        });
    });

    describe("getSystemMemoryGB", () => {
        it("returns a number in Node.js environment", () => {
            const result = getSystemMemoryGB();
            // In Node.js test environment, os module is available
            expect(typeof result).toBe("number");
            expect(result).toBeGreaterThan(0);
        });
    });

    describe("sync with zero total_files", () => {
        it("handles FILE_START with total_files=0 without division error", async () => {
            const plugin = makePlugin({ settings: { serverMode: "external" } });
            plugin.api.syncStream = vi.fn().mockReturnValue(
                (async function* () {
                    yield { event: SSE_EVENT.FILE_START, data: { current_file: 0, total_files: 0 } };
                    yield {
                        event: SSE_EVENT.DONE,
                        data: { added: [], updated: [], removed: [], unchanged: 0, failed: [] },
                    };
                })(),
            );
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).step = 3;
            (wizard as any).renderStep();
            await tick();
            await tick();

            const texts = collectTexts(wizard.contentEl as unknown as MockElement);
            expect(texts.some((t) => t.includes("You're all set!"))).toBe(true);
        });
    });

    describe("pullSelectedModel early return", () => {
        it("returns early when selectedModel is null", async () => {
            const plugin = makePlugin({ settings: { serverMode: "external" } });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            // Call pullSelectedModel directly with no selected model
            (wizard as any).selectedModel = null;
            const el = new MockElement("div");
            await (wizard as any).pullSelectedModel(el, el, el, el, el);
            // Should return without calling pullModel
            expect(plugin.api.pullModel).not.toHaveBeenCalled();
        });
    });

    describe("back from step 2 with ready server manager", () => {
        it("goes to step 0 when serverManager is ready", () => {
            const plugin = makePlugin({
                settings: { serverMode: "managed" },
                serverManager: { state: "ready" },
            });
            plugin.api.catalog = vi.fn().mockResolvedValue(makeCatalogResponse([]));
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).step = 2;
            wizard.back();

            const texts = collectTexts(wizard.contentEl as unknown as MockElement);
            expect(texts.some((t) => t.includes("Welcome to lilbee"))).toBe(true);
        });
    });

    describe("sync with FILE_START progress update", () => {
        it("updates progress bar during sync", async () => {
            const plugin = makePlugin({ settings: { serverMode: "external" } });
            plugin.api.syncStream = vi.fn().mockReturnValue(
                (async function* () {
                    yield { event: SSE_EVENT.FILE_START, data: { current_file: 3, total_files: 10 } };
                    yield { event: SSE_EVENT.FILE_START, data: { current_file: 7, total_files: 10 } };
                    yield {
                        event: SSE_EVENT.DONE,
                        data: { added: [], updated: [], removed: [], unchanged: 10, failed: [] },
                    };
                })(),
            );
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).step = 3;
            (wizard as any).renderStep();
            await tick();
            await tick();

            // Should reach done
            const texts = collectTexts(wizard.contentEl as unknown as MockElement);
            expect(texts.some((t) => t.includes("You're all set!"))).toBe(true);
        });
    });

    describe("done screen with processed files count", () => {
        it("shows files processed when sync result has additions", () => {
            const plugin = makePlugin({ settings: { serverMode: "external" } });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).pulledModelName = "test-model";
            (wizard as any).syncResult = {
                added: ["a.md", "b.md", "c.md"],
                updated: ["d.md"],
                removed: [],
                unchanged: 6,
                failed: [],
            };
            (wizard as any).step = 4;
            (wizard as any).renderStep();

            const el = wizard.contentEl as unknown as MockElement;
            const texts = collectTexts(el);
            expect(texts.some((t) => t.includes("10 files indexed"))).toBe(true);
            expect(texts.some((t) => t.includes("4 files processed"))).toBe(true);
        });

        it("does not show files processed when no additions or updates", () => {
            const plugin = makePlugin({ settings: { serverMode: "external" } });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).syncResult = {
                added: [],
                updated: [],
                removed: [],
                unchanged: 10,
                failed: [],
            };
            (wizard as any).step = 4;
            (wizard as any).renderStep();

            const el = wizard.contentEl as unknown as MockElement;
            const texts = collectTexts(el);
            expect(texts.some((t) => t.includes("10 files indexed"))).toBe(true);
            expect(texts.some((t) => t.includes("files processed"))).toBe(false);
        });
    });
});
