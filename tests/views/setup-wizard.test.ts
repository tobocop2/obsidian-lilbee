import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { App, Notice } from "obsidian";
import { MockElement } from "../__mocks__/obsidian";
import { SetupWizard, pickNativeChatModels, recommendedIndex } from "../../src/views/setup-wizard";
import { getSystemMemoryGB } from "../../src/utils";
import * as utils from "../../src/utils";
import { LilbeeClient, SessionTokenError } from "../../src/api";
import { SSE_EVENT, WIZARD_STEP, LILBEE_REPO_URL } from "../../src/types";
import { ok, err } from "../../src/result";
import { MESSAGES } from "../../src/locales/en";
import type { CatalogEntry, CatalogResponse } from "../../src/types";

vi.mock("../../src/views/catalog-modal", () => ({
    CatalogModal: vi.fn().mockImplementation(function () {
        return {
            open: vi.fn(),
            close: vi.fn(),
        };
    }),
}));

function makeEntry(overrides: Partial<CatalogEntry> = {}): CatalogEntry {
    return {
        hf_repo: "Qwen/Qwen3-0.6B-GGUF",
        gguf_filename: "*Q4_K_M.gguf",
        display_name: "Qwen3 0.6B",
        size_gb: 0.5,
        min_ram_gb: 4,
        description: "Runs on anything",
        quality_tier: "balanced",
        installed: false,
        source: "native",
        task: "chat",
        featured: true,
        downloads: 0,
        param_count: "0.6B",
        // A live server reports fit and compat on every row; the picks filter requires both.
        fit: "fits",
        compat: "supported",
        ...overrides,
    };
}

function makeCatalogResponse(models: CatalogEntry[] = []): CatalogResponse {
    return {
        total: models.length,
        limit: 4,
        offset: 0,
        models,
        has_more: false,
    };
}

function makePlugin(overrides: Record<string, unknown> = {}) {
    const plugin: Record<string, unknown> = {
        app: new App(),
        settings: {
            serverUrl: "http://127.0.0.1:7433",
            serverMode: "managed",
            setupCompleted: false,
            wikiEnabled: false,
            enableOcr: null,
            ...((overrides.settings as Record<string, unknown>) || {}),
        },
        api: {
            catalog: vi.fn().mockResolvedValue(ok(makeCatalogResponse())),
            pullModel: vi.fn(),
            setChatModel: vi.fn((m: string) => Promise.resolve(ok({ model: m, reindex_required: false }))),
            health: vi.fn().mockResolvedValue(ok({ status: "ok", version: "1.0.0" })),
            syncStream: vi.fn(),
            listModels: vi.fn().mockResolvedValue({
                chat: { active: "", catalog: [], installed: [] },
            }),
            setEmbeddingModel: vi.fn((m: string) => Promise.resolve(ok({ model: m, reindex_required: false }))),
            setVisionModel: vi.fn((m: string) => Promise.resolve(ok({ model: m, reindex_required: false }))),
            setBaseUrl: vi.fn(),
            setToken: vi.fn(),
            setTokenProvider: vi.fn(),
            setOutcomeCallback: vi.fn(),
        },
        activeModel: "",
        fetchActiveModel: vi.fn(),
        serverManager: overrides.serverManager ?? null,
        startManagedServer: vi.fn().mockResolvedValue(undefined),
        saveSettings: vi.fn().mockResolvedValue(undefined),
        activateChatView: vi.fn().mockResolvedValue(undefined),
        resumeDeferredAgentPicker: vi.fn().mockResolvedValue(undefined),
        setupWizardOpen: false,
        ...overrides,
    };
    // Default consent gate: delegate to startManagedServer (so per-test
    // progress mocks still drive the wizard panel) and report a managed start.
    // Tests exercising the external / cancel branches override this.
    if (!("ensureManagedConsentThenStart" in overrides)) {
        plugin.ensureManagedConsentThenStart = vi.fn(async (onProgress?: unknown) => {
            await (plugin.startManagedServer as (p?: unknown) => Promise<void>)(onProgress);
            return { kind: "started", mode: "managed" };
        });
    }
    return plugin;
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

    describe("Step indicator", () => {
        // Indicator shows 6 slots (Server..Done = steps 1..6) with 5 connecting
        // lines between them. Welcome (step 0) is the intro splash and has no
        // active slot — all slots are muted until the user advances.
        it("renders 6 circles and 5 lines on welcome step", () => {
            const plugin = makePlugin();
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();

            const el = wizard.contentEl as unknown as MockElement;
            const indicator = el.find("lilbee-wizard-step-indicator");
            expect(indicator).not.toBeNull();
            const dots = indicator!.findAll("lilbee-wizard-step-circle");
            const lines = indicator!.findAll("lilbee-wizard-step-line");
            expect(dots.length).toBe(6);
            expect(lines.length).toBe(5);
        });

        it("marks no slot as active on welcome (step 0)", () => {
            const plugin = makePlugin();
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();

            const el = wizard.contentEl as unknown as MockElement;
            const dots = el.find("lilbee-wizard-step-indicator")!.findAll("lilbee-wizard-step-circle");
            for (const dot of dots) {
                expect(dot.classList.contains("is-active")).toBe(false);
                expect(dot.classList.contains("is-done")).toBe(false);
            }
        });

        it("marks previous slots as is-done and current as is-active on step 2 (Model)", async () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.catalog = vi.fn().mockResolvedValue(ok(makeCatalogResponse([])));
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).step = 2;
            (wizard as any).renderStep();
            await tick();

            const el = wizard.contentEl as unknown as MockElement;
            const indicator = el.find("lilbee-wizard-step-indicator")!;
            const dots = indicator.findAll("lilbee-wizard-step-circle");
            const lines = indicator.findAll("lilbee-wizard-step-line");
            // slot[0] = Server (step=1, done), slot[1] = Model (step=2, active)
            expect(dots[0].classList.contains("is-done")).toBe(true);
            expect(dots[1].classList.contains("is-active")).toBe(true);
            expect(dots[2].classList.contains("is-active")).toBe(false);
            expect(dots[2].classList.contains("is-done")).toBe(false);
            // slot[5] = Done (step=6) — untouched while we're on Model.
            expect(dots[5].classList.contains("is-active")).toBe(false);
            expect(dots[5].classList.contains("is-done")).toBe(false);
            // line[0] is between slot[0] (step=1) and slot[1] (step=2) — done.
            expect(lines[0].classList.contains("is-done")).toBe(true);
            expect(lines[1].classList.contains("is-done")).toBe(false);
            expect(lines[4].classList.contains("is-done")).toBe(false);
        });

        it("marks prior slots done and last slot active on done step (step 6)", () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).step = 6;
            (wizard as any).renderStep();

            const el = wizard.contentEl as unknown as MockElement;
            const dots = el.find("lilbee-wizard-step-indicator")!.findAll("lilbee-wizard-step-circle");
            const lines = el.find("lilbee-wizard-step-indicator")!.findAll("lilbee-wizard-step-line");
            // slots[0..4] correspond to steps 1..5 — all done. slot[5] = step 6 = active.
            for (let i = 0; i < 5; i++) {
                expect(dots[i].classList.contains("is-done")).toBe(true);
            }
            expect(dots[5].classList.contains("is-active")).toBe(true);
            for (const line of lines) {
                expect(line.classList.contains("is-done")).toBe(true);
            }
        });

        it("marks no lines as is-done when current step is Server (step 1)", () => {
            const plugin = makePlugin({ serverManager: null });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).step = 1;
            (wizard as any).renderStep();

            const el = wizard.contentEl as unknown as MockElement;
            const indicator = el.find("lilbee-wizard-step-indicator")!;
            const lines = indicator.findAll("lilbee-wizard-step-line");
            // All lines sit between indicator slots (Server..Done). No slot
            // before Server exists in the indicator, so no line can be done yet.
            for (const line of lines) {
                expect(line.classList.contains("is-done")).toBe(false);
            }
        });
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
            // Default is managed mode, so the locality hint mentions "this machine"
            expect(texts.some((t) => t.includes("this machine"))).toBe(true);
        });

        it("welcome locality hint reflects external mode when chosen", () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();

            const el = wizard.contentEl as unknown as MockElement;
            const texts = collectTexts(el);
            expect(texts.some((t) => t.includes("existing lilbee server"))).toBe(true);
            expect(texts.some((t) => t.includes("never leave your laptop"))).toBe(false);
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
                settings: { serverMode: "external", setupCompleted: true },
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

        it("shows the lilbee source link in the server-setup panel", () => {
            const plugin = makePlugin({
                settings: { serverMode: "managed" },
                serverManager: null,
            });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();

            const el = wizard.contentEl as unknown as MockElement;
            findButtons(el)
                .find((b) => b.textContent === "Get started")!
                .trigger("click");

            const source = el.find("lilbee-wizard-setup-source");
            expect(source).toBeTruthy();
            const link = source!.children.find((c) => c.tagName === "A");
            expect(link?.textContent).toBe(MESSAGES.LINK_LILBEE_REPO);
            expect(link?.getAttribute("href")).toBe(LILBEE_REPO_URL);
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
            const plugin = makePlugin({
                serverManager: null,
                settings: { serverMode: "external", setupCompleted: true },
            });
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

        it("managed mode: Next runs the consent gate, starts the server, and advances", async () => {
            const plugin = makePlugin({ serverManager: null });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            wizard.next();

            const el = wizard.contentEl as unknown as MockElement;
            const nextBtn = findButtons(el).find((b) => b.textContent === "Next")!;
            nextBtn.trigger("click");
            await tick();
            await tick();

            // The gate now owns persistence + the server start; the wizard no
            // longer calls saveSettings directly.
            expect(plugin.ensureManagedConsentThenStart).toHaveBeenCalled();
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

        it("managed mode: External chosen in the consent modal reveals the external fields without advancing", async () => {
            const plugin = makePlugin({
                serverManager: null,
                ensureManagedConsentThenStart: vi.fn().mockResolvedValue({ kind: "switched-to-external" }),
            });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            wizard.next();

            const el = wizard.contentEl as unknown as MockElement;
            const nextBtn = findButtons(el).find((b) => b.textContent === "Next")!;
            nextBtn.trigger("click");
            await tick();
            await tick();

            // External fields revealed; Next re-enabled; did not advance to Model.
            expect(el.find("lilbee-wizard-external-fields")!.style.display).toBe("");
            expect((nextBtn as unknown as { disabled: boolean }).disabled).toBe(false);
            const texts = collectTexts(el);
            expect(texts.some((t) => t.includes("Pick a chat model"))).toBe(false);
            expect(plugin.startManagedServer).not.toHaveBeenCalled();
        });

        it("managed mode: Cancel in the consent modal leaves the wizard on the server step with Next re-enabled", async () => {
            const plugin = makePlugin({
                serverManager: null,
                ensureManagedConsentThenStart: vi.fn().mockResolvedValue({ kind: "canceled" }),
            });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            wizard.next();

            const el = wizard.contentEl as unknown as MockElement;
            const nextBtn = findButtons(el).find((b) => b.textContent === "Next")!;
            nextBtn.trigger("click");
            await tick();
            await tick();

            expect((nextBtn as unknown as { disabled: boolean }).disabled).toBe(false);
            const texts = collectTexts(el);
            expect(texts.some((t) => t.includes("Pick a chat model"))).toBe(false);
            expect(plugin.startManagedServer).not.toHaveBeenCalled();
        });

        // The wizard passes a progress handler to startManagedServer so users
        // see Downloading → Starting → Ready as three phase rows that light up.
        // We simulate the plugin firing each phase and assert the rows reach the
        // ready state before the wizard advances.
        it("hands the download bar from indeterminate to a real width", () => {
            const plugin = makePlugin({ serverManager: null });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            const step = new MockElement() as unknown as HTMLElement;

            const { setPhase } = (wizard as any).renderServerSetupPanel(step);
            const fill = (step as unknown as MockElement).findAll("lilbee-wizard-progress-fill")[0];
            expect(fill.classList.contains("lilbee-progress-indeterminate")).toBe(true);

            setPhase("downloading", "Downloading... 40%", 40);

            expect(fill.style.width).toBe("40%");
            expect(fill.classList.contains("lilbee-progress-indeterminate")).toBe(false);
        });

        it("leaves the bar indeterminate when no percentage is reported", () => {
            const plugin = makePlugin({ serverManager: null });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            const step = new MockElement() as unknown as HTMLElement;

            const { setPhase } = (wizard as any).renderServerSetupPanel(step);
            setPhase("downloading", "Downloading...");

            const fill = (step as unknown as MockElement).findAll("lilbee-wizard-progress-fill")[0];
            expect(fill.classList.contains("lilbee-progress-indeterminate")).toBe(true);
        });

        it("shows the live download detail in the active row's hint", () => {
            const plugin = makePlugin({ serverManager: null });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            const step = new MockElement() as unknown as HTMLElement;

            const { setPhase } = (wizard as any).renderServerSetupPanel(step);
            const hints = (step as unknown as MockElement).findAll("lilbee-wizard-phase-hint");
            const staticHint = hints[0].textContent;

            setPhase("downloading", "Downloading... 45% (128 MB of 283 MB)", 45);
            expect(hints[0].textContent).toBe("Downloading... 45% (128 MB of 283 MB)");
            // Inactive rows keep their static hints.
            expect(hints[1].textContent).not.toBe("Downloading... 45% (128 MB of 283 MB)");

            // A phase event without a message falls back to the static hint.
            setPhase("downloading");
            expect(hints[0].textContent).toBe(staticHint);
        });

        it("managed mode: surfaces each progress phase in the setup panel", async () => {
            const plugin = makePlugin({ serverManager: null });
            plugin.startManagedServer = vi
                .fn()
                .mockImplementation(async (onProgress?: (e: { phase: string; message: string }) => void) => {
                    onProgress?.({ phase: "downloading", message: "Downloading…" });
                    onProgress?.({ phase: "starting", message: "Starting…" });
                    onProgress?.({ phase: "ready", message: "" });
                });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            wizard.next();

            const el = wizard.contentEl as unknown as MockElement;
            const nextBtn = findButtons(el).find((b) => b.textContent === "Next")!;
            nextBtn.trigger("click");
            await tick();
            await tick();

            // The wizard advanced to Model step after phase=ready. Prove the
            // handler was wired (startManagedServer was called with a function).
            expect(plugin.startManagedServer).toHaveBeenCalled();
            const callArgs = (plugin.startManagedServer as ReturnType<typeof vi.fn>).mock.calls[0];
            expect(typeof callArgs[0]).toBe("function");
            const texts = collectTexts(el);
            expect(texts.some((t) => t.includes("Pick a chat model"))).toBe(true);
        });

        it("managed mode: shows the active downloading phase and blocks Next", async () => {
            const plugin = makePlugin({ serverManager: null });
            // Hold the server-start promise open after the downloading event so
            // we can inspect the in-flight downloading state before it advances.
            let release: () => void = () => {};
            const held = new Promise<void>((r) => {
                release = r;
            });
            plugin.startManagedServer = vi
                .fn()
                .mockImplementation(async (onProgress?: (e: { phase: string; message: string }) => void) => {
                    onProgress?.({ phase: "downloading", message: "Downloading…" });
                    await held;
                });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            wizard.next();

            const el = wizard.contentEl as unknown as MockElement;
            const nextBtn = findButtons(el).find((b) => b.textContent === "Next")!;
            nextBtn.trigger("click");
            await tick();

            // Downloading phase active, the others still pending, and Next is
            // disabled — the step is hard-gated until the server is ready.
            const phases = el.findAll("lilbee-wizard-phase");
            const downloading = phases.find((p) => p.dataset.phase === "downloading")!;
            expect(downloading.classList.contains("is-active")).toBe(true);
            const texts = collectTexts(el);
            expect(texts.some((t) => t.includes("Downloading lilbee server"))).toBe(true);
            expect(texts.some((t) => t.includes("Start the server"))).toBe(true);
            // The live progress message replaces the row's static hint.
            expect(texts.some((t) => t.includes("Downloading…"))).toBe(true);
            expect(texts.some((t) => t.includes("can't continue until the server is ready"))).toBe(true);
            expect(nextBtn.disabled).toBe(true);

            release();
            await tick();
        });

        it("managed mode: error phase blocks advance and surfaces the failure", async () => {
            const plugin = makePlugin({ serverManager: null });
            // startManagedServer swallows download/start failures: it emits an
            // error phase and resolves rather than throwing. The wizard must not
            // mistake that resolve for a live server and advance.
            plugin.startManagedServer = vi
                .fn()
                .mockImplementation(async (onProgress?: (e: { phase: string; message: string }) => void) => {
                    onProgress?.({ phase: "downloading", message: "download failing" });
                    onProgress?.({ phase: "error", message: "binary download failed" });
                });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            wizard.next();

            const el = wizard.contentEl as unknown as MockElement;
            const nextBtn = findButtons(el).find((b) => b.textContent === "Next")!;
            nextBtn.trigger("click");
            await tick();
            await tick();

            const texts = collectTexts(el);
            // Stayed on the Server step (never reached the model picker) and
            // surfaced the failure; Next is re-enabled so the user can retry.
            expect(texts.some((t) => t.includes("Pick a chat model"))).toBe(false);
            expect(texts.some((t) => t.includes(MESSAGES.ERROR_START_SERVER))).toBe(true);
            expect(nextBtn.disabled).toBe(false);
        });

        it("managed mode: error phase with no message falls back to generic failure text", async () => {
            const plugin = makePlugin({ serverManager: null });
            plugin.startManagedServer = vi
                .fn()
                .mockImplementation(async (onProgress?: (e: { phase: string; message: string }) => void) => {
                    onProgress?.({ phase: "error", message: "" });
                });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            wizard.next();

            const el = wizard.contentEl as unknown as MockElement;
            const nextBtn = findButtons(el).find((b) => b.textContent === "Next")!;
            nextBtn.trigger("click");
            await tick();
            await tick();

            // An empty error message falls back to the generic failure text in
            // the setup-panel header rather than blanking it.
            const headText = el.find("lilbee-wizard-setup-head-text")!;
            expect(headText.textContent).toBe(MESSAGES.ERROR_START_SERVER);
            expect(nextBtn.disabled).toBe(false);
        });

        it("managed mode: retry after a failed start clears the stale error header and advances", async () => {
            const plugin = makePlugin({ serverManager: null });
            let call = 0;
            plugin.startManagedServer = vi
                .fn()
                .mockImplementation(async (onProgress?: (e: { phase: string; message: string }) => void) => {
                    call += 1;
                    if (call === 1) {
                        onProgress?.({ phase: "error", message: "boom" });
                    } else {
                        onProgress?.({ phase: "downloading", message: "" });
                        onProgress?.({ phase: "ready", message: "" });
                    }
                });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            wizard.next();
            const el = wizard.contentEl as unknown as MockElement;
            const nextBtn = findButtons(el).find((b) => b.textContent === "Next")!;

            // First attempt fails: stays on the Server step with an error header.
            nextBtn.trigger("click");
            await tick();
            await tick();
            expect(el.find("lilbee-wizard-setup-head-text")!.textContent).toBe("boom");
            expect(el.find("lilbee-wizard-setup-head")!.classList.contains("is-error")).toBe(true);
            expect(nextBtn.disabled).toBe(false);

            // Retry succeeds: the header reset and the wizard advanced.
            nextBtn.trigger("click");
            await tick();
            await tick();
            const texts = collectTexts(el);
            expect(texts.some((t) => t.includes("Pick a chat model"))).toBe(true);
        });

        it("external mode: Next checks the connection and advances", async () => {
            const probe = vi.spyOn(LilbeeClient, "probe").mockResolvedValue(true);
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

            expect(probe).toHaveBeenCalled();
            const texts = collectTexts(wizard.contentEl as unknown as MockElement);
            expect(texts.some((t) => t.includes("Pick a chat model"))).toBe(true);
            probe.mockRestore();
        });

        it("external mode: handles a server that does not answer", async () => {
            const probe = vi.spyOn(LilbeeClient, "probe").mockResolvedValue(false);
            const plugin = makePlugin({
                serverManager: null,
                settings: { serverMode: "managed" },
            });
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
            probe.mockRestore();
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
            const entries = [
                makeEntry({
                    name: "qwen/qwen3-0.6B",
                    hf_repo: "qwen/qwen3-0.6B",
                    size_gb: 0.5,
                    min_ram_gb: 4,
                    display_name: "Qwen3 0.6B",
                }),
                makeEntry({
                    name: "qwen/qwen3-4B",
                    hf_repo: "qwen/qwen3-4B",
                    size_gb: 2.5,
                    min_ram_gb: 8,
                    display_name: "Qwen3 4B",
                }),
            ];
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.catalog = vi.fn().mockResolvedValue(ok(makeCatalogResponse(entries)));
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
            const entries = [
                makeEntry({ name: "qwen/qwen3-0.6B", size_gb: 0.5, min_ram_gb: 4 }),
                makeEntry({ name: "qwen/qwen3-4B", size_gb: 2.5, min_ram_gb: 8 }),
            ];
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.catalog = vi.fn().mockResolvedValue(ok(makeCatalogResponse(entries)));
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
            const entries = [makeEntry({ name: "qwen/qwen3-0.6B" })];
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.catalog = vi.fn().mockResolvedValue(ok(makeCatalogResponse(entries)));
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            wizard.next();
            await tick();

            const el = wizard.contentEl as unknown as MockElement;
            const headings = el.findAll("lilbee-wizard-section-heading");
            expect(headings.some((h) => h.textContent === "Our picks")).toBe(true);
        });

        it("renders model cards in grid layout", async () => {
            const entries = [makeEntry({ name: "qwen/qwen3-0.6B" })];
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.catalog = vi.fn().mockResolvedValue(ok(makeCatalogResponse(entries)));
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            wizard.next();
            await tick();

            const el = wizard.contentEl as unknown as MockElement;
            expect(el.find("lilbee-catalog-grid")).not.toBeNull();
            expect(el.findAll("lilbee-model-card").length).toBe(1);
        });

        it("clicking a model card selects it", async () => {
            const entries = [
                makeEntry({ hf_repo: "qwen/qwen3-0.6B", size_gb: 0.5, min_ram_gb: 4 }),
                makeEntry({ hf_repo: "qwen/qwen3-4B", size_gb: 2.5, min_ram_gb: 8 }),
            ];
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.catalog = vi.fn().mockResolvedValue(ok(makeCatalogResponse(entries)));
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
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.catalog = vi.fn().mockRejectedValue(new Error("fail"));
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            wizard.next();
            await tick();

            const el = wizard.contentEl as unknown as MockElement;
            const texts = collectTexts(el);
            // The server's own reason, not a generic string, plus a way out.
            expect(texts.some((t) => t.includes("fail"))).toBe(true);
            expect(findButtons(el).some((b) => b.textContent === "Retry")).toBe(true);
        });

        it("sets empty featured models when catalog returns error result", async () => {
            const { err } = await import("../../src/result");
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.catalog = vi.fn().mockResolvedValue(err(new Error("server error")));
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            wizard.next();
            await tick();

            expect((wizard as any).featuredModels).toEqual([]);
        });

        it("falls back to first variant when recommended not found", async () => {
            const entries = [
                makeEntry({
                    name: "qwen/qwen3-0.6B",
                    size_gb: 0.5,
                    min_ram_gb: 4,
                    display_name: "Qwen3 0.6B",
                }),
            ];
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.catalog = vi.fn().mockResolvedValue(ok(makeCatalogResponse(entries)));
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
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
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

        it("pull progress with no percent and no total skips update", async () => {
            const entries = [makeEntry({ name: "qwen/qwen3-0.6B" })];
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.catalog = vi.fn().mockResolvedValue(ok(makeCatalogResponse(entries)));
            plugin.api.pullModel = vi.fn().mockReturnValue(
                (async function* () {
                    yield { event: SSE_EVENT.PROGRESS, data: {} };
                })(),
            );
            plugin.api.syncStream = vi.fn().mockReturnValue(
                (async function* () {
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

            expect(plugin.api.pullModel).toHaveBeenCalled();
        });

        it("an empty featured list says so instead of rendering nothing", async () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.catalog = vi.fn().mockResolvedValue(ok(makeCatalogResponse([])));
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            wizard.next();
            await tick();

            const el = wizard.contentEl as unknown as MockElement;
            expect(el.textContent ?? "").toContain("offered no models");

            plugin.api.catalog = vi
                .fn()
                .mockResolvedValue(ok(makeCatalogResponse([makeEntry({ hf_repo: "Qwen/Qwen3-0.6B-GGUF" })])));
            findButtons(el)
                .find((b) => b.textContent === "Retry")!
                .trigger("click");
            await tick();
            await tick();
            expect((wizard.contentEl as unknown as MockElement).textContent ?? "").toContain("Qwen3");
        });

        it("a thrown catalog error reports its reason and retries", async () => {
            const entries = [makeEntry({ hf_repo: "Qwen/Qwen3-0.6B-GGUF" })];
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.catalog = vi.fn().mockRejectedValue(new Error("socket hang up"));
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            wizard.next();
            await tick();

            const el = wizard.contentEl as unknown as MockElement;
            expect(el.textContent ?? "").toContain("socket hang up");

            plugin.api.catalog = vi.fn().mockResolvedValue(ok(makeCatalogResponse(entries)));
            findButtons(el)
                .find((b) => b.textContent === "Retry")!
                .trigger("click");
            await tick();
            await tick();
            expect((wizard.contentEl as unknown as MockElement).textContent ?? "").toContain("Qwen3");
        });

        it("a failed catalog load drops a selection made before it", async () => {
            const entries = [makeEntry({ hf_repo: "Qwen/Qwen3-0.6B-GGUF" })];
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.catalog = vi.fn().mockResolvedValue(ok(makeCatalogResponse(entries)));
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            wizard.next();
            await tick();
            expect((wizard as any).selectedModel).not.toBeNull();

            // Re-entering the step against a server that now fails must not keep
            // the earlier pick: the grid is empty and the model is unreachable.
            plugin.api.catalog = vi.fn().mockResolvedValue(err(new Error("connection refused")));
            (wizard as any).renderStep();
            await tick();
            await tick();

            expect((wizard as any).selectedModel).toBeNull();
            const el = wizard.contentEl as unknown as MockElement;
            const btn = findButtons(el).find((b) => b.textContent === "Download & continue");
            expect((btn as unknown as { disabled: boolean }).disabled).toBe(true);
        });

        it("disables the model step's action even when an embedding is selected", async () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.catalog = vi.fn().mockResolvedValue(err(new Error("offline")));
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            // A later step's selection must not enable this one's action.
            (wizard as any).selectedEmbedding = { hf_repo: "nomic", display_name: "nomic" };
            wizard.next();
            await tick();
            await tick();

            const el = wizard.contentEl as unknown as MockElement;
            const btn = findButtons(el).find((b) => b.textContent === "Download & continue");
            expect((btn as unknown as { disabled: boolean }).disabled).toBe(true);
        });

        it("a failed catalog load says so and offers a retry", async () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.catalog = vi.fn().mockResolvedValue(err(new Error("connection refused")));
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            wizard.next();
            await tick();

            const el = wizard.contentEl as unknown as MockElement;
            expect(el.textContent ?? "").toContain("connection refused");
            expect(findButtons(el).some((b) => b.textContent === "Retry")).toBe(true);
        });

        it("retrying a failed catalog load renders the models", async () => {
            const entries = [makeEntry({ hf_repo: "Qwen/Qwen3-0.6B-GGUF" })];
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.catalog = vi.fn().mockResolvedValue(err(new Error("connection refused")));
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            wizard.next();
            await tick();

            plugin.api.catalog = vi.fn().mockResolvedValue(ok(makeCatalogResponse(entries)));
            const el = wizard.contentEl as unknown as MockElement;
            findButtons(el)
                .find((b) => b.textContent === "Retry")!
                .trigger("click");
            await tick();
            await tick();

            const after = wizard.contentEl as unknown as MockElement;
            expect(after.textContent ?? "").toContain("Qwen3");
        });

        it("the download button is disabled while no model can be selected", async () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.catalog = vi.fn().mockResolvedValue(err(new Error("offline")));
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            wizard.next();
            await tick();

            const el = wizard.contentEl as unknown as MockElement;
            const btn = findButtons(el).find((b) => b.textContent === "Download & continue");
            expect((btn as unknown as { disabled: boolean }).disabled).toBe(true);
        });

        it("a failed download does not set the model or advance the step", async () => {
            const entries = [makeEntry({ hf_repo: "Qwen/Qwen3-0.6B-GGUF" })];
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.catalog = vi.fn().mockResolvedValue(ok(makeCatalogResponse(entries)));
            plugin.api.pullModel = vi.fn().mockReturnValue(
                (async function* () {
                    yield { event: SSE_EVENT.PROGRESS, data: { current: 10, total: 100 } };
                    yield { event: SSE_EVENT.ERROR, data: { message: "no space left on device" } };
                })(),
            );
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            wizard.next();
            await tick();

            const el = wizard.contentEl as unknown as MockElement;
            findButtons(el)
                .find((b) => b.textContent === "Download & continue")!
                .trigger("click");
            await tick();
            await tick();

            expect(plugin.api.setChatModel).not.toHaveBeenCalled();
            // Still on the model step, with the server's reason on screen.
            expect((wizard as any).step).toBe(WIZARD_STEP.MODEL_PICKER);
            const text = (wizard.contentEl as unknown as MockElement).textContent ?? "";
            expect(text).toContain("no space left on device");
        });

        it("a failed embedding download does not set the model or advance the step", async () => {
            const entries = [makeEntry({ hf_repo: "nomic-ai/nomic-embed-text-v1.5-GGUF" })];
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.catalog = vi.fn().mockResolvedValue(ok(makeCatalogResponse(entries)));
            plugin.api.pullModel = vi.fn().mockReturnValue(
                (async function* () {
                    yield { event: SSE_EVENT.ERROR, data: { message: "checksum mismatch" } };
                })(),
            );
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).step = WIZARD_STEP.EMBEDDING_PICKER;
            (wizard as any).renderStep();
            await tick();

            const el = wizard.contentEl as unknown as MockElement;
            const btn = findButtons(el).find((b) => b.textContent === "Download & continue");
            btn!.trigger("click");
            await tick();
            await tick();

            expect(plugin.api.setEmbeddingModel).not.toHaveBeenCalled();
            expect((wizard as any).step).toBe(WIZARD_STEP.EMBEDDING_PICKER);
        });

        it("pull progress with current/total computes percentage", async () => {
            const entries = [makeEntry({ name: "qwen/qwen3-0.6B" })];
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.catalog = vi.fn().mockResolvedValue(ok(makeCatalogResponse(entries)));
            plugin.api.pullModel = vi.fn().mockReturnValue(
                (async function* () {
                    yield { event: SSE_EVENT.PROGRESS, data: { current: 50, total: 100 } };
                })(),
            );
            plugin.api.syncStream = vi.fn().mockReturnValue(
                (async function* () {
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

            expect(plugin.api.pullModel).toHaveBeenCalled();
        });

        it("Download & continue uses hf_repo for both pull and setChatModel", async () => {
            const entries = [makeEntry({ hf_repo: "Qwen/Qwen3-0.6B-GGUF" })];
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.catalog = vi.fn().mockResolvedValue(ok(makeCatalogResponse(entries)));
            plugin.api.pullModel = vi.fn().mockReturnValue(
                (async function* () {
                    yield { event: SSE_EVENT.PROGRESS, data: { percent: 100 } };
                })(),
            );
            plugin.api.syncStream = vi.fn().mockReturnValue(
                (async function* () {
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

            // Post-PR-#183 the canonical model identity is the HF ref. Both pull
            // and set use it; cfg.chat_model and the Settings dropdown line up.
            expect(plugin.api.pullModel).toHaveBeenCalledWith(
                "Qwen/Qwen3-0.6B-GGUF",
                "native",
                expect.any(AbortSignal),
            );
            expect(plugin.api.setChatModel).toHaveBeenCalledWith("Qwen/Qwen3-0.6B-GGUF");
            expect(plugin.activeModel).toBe("Qwen/Qwen3-0.6B-GGUF");
        });

        it("Download & continue pulls model and advances to sync step", async () => {
            const entries = [makeEntry({ hf_repo: "Qwen/Qwen3-0.6B-GGUF" })];
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.catalog = vi.fn().mockResolvedValue(ok(makeCatalogResponse(entries)));
            plugin.api.pullModel = vi.fn().mockReturnValue(
                (async function* () {
                    yield { event: SSE_EVENT.PROGRESS, data: { percent: 50 } };
                    yield { event: SSE_EVENT.PROGRESS, data: { percent: 100 } };
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

            expect(plugin.api.pullModel).toHaveBeenCalledWith(
                "Qwen/Qwen3-0.6B-GGUF",
                "native",
                expect.any(AbortSignal),
            );
            expect(plugin.api.setChatModel).toHaveBeenCalledWith("Qwen/Qwen3-0.6B-GGUF");
            // After pull completes, it goes to step 3 (embedding picker)
            await tick();
            await tick();
            const texts = collectTexts(wizard.contentEl as unknown as MockElement);
            expect(
                texts.some(
                    (t) =>
                        t.includes("Pick an embedding model") ||
                        t.includes("Index your vault") ||
                        t.includes("Wiki (optional)"),
                ),
            ).toBe(true);
        });

        it("handles pull failure", async () => {
            const entries = [makeEntry({ name: "qwen/qwen3-0.6B" })];
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.catalog = vi.fn().mockResolvedValue(ok(makeCatalogResponse(entries)));
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

        it("pull surfaces token-stale message when stream throws SessionTokenError", async () => {
            const entries = [makeEntry({ name: "qwen/qwen3-0.6B" })];
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.catalog = vi.fn().mockResolvedValue(ok(makeCatalogResponse(entries)));
            plugin.api.pullModel = vi.fn().mockReturnValue(
                (async function* () {
                    throw new SessionTokenError(401, "stale");
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

            expect(Notice.instances.some((n) => n.message === MESSAGES.NOTICE_SESSION_TOKEN_INVALID)).toBe(true);
            const texts = collectTexts(wizard.contentEl as unknown as MockElement);
            expect(texts.some((t) => t.includes(MESSAGES.NOTICE_SESSION_TOKEN_INVALID))).toBe(true);
        });

        it("SSE_EVENT.ERROR during pull shows notice and updates status", async () => {
            const entries = [makeEntry({ name: "qwen/qwen3-0.6B" })];
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.catalog = vi.fn().mockResolvedValue(ok(makeCatalogResponse(entries)));
            plugin.api.pullModel = vi.fn().mockReturnValue(
                (async function* () {
                    yield { event: SSE_EVENT.ERROR, data: { message: "pull exploded" } };
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

            expect(Notice.instances.some((n) => n.message.includes("Download failed"))).toBe(true);
        });

        it("SSE_EVENT.ERROR with string data during pull updates status", async () => {
            const entries = [makeEntry({ name: "qwen/qwen3-0.6B" })];
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.catalog = vi.fn().mockResolvedValue(ok(makeCatalogResponse(entries)));
            plugin.api.pullModel = vi.fn().mockReturnValue(
                (async function* () {
                    yield { event: SSE_EVENT.ERROR, data: "raw error" };
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

            expect(Notice.instances.some((n) => n.message.includes("Download failed"))).toBe(true);
        });

        it("SSE_EVENT.ERROR with empty object during pull uses fallback message", async () => {
            const entries = [makeEntry({ name: "qwen/qwen3-0.6B" })];
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.catalog = vi.fn().mockResolvedValue(ok(makeCatalogResponse(entries)));
            plugin.api.pullModel = vi.fn().mockReturnValue(
                (async function* () {
                    yield { event: SSE_EVENT.ERROR, data: {} };
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

            expect(Notice.instances.some((n) => n.message.includes("Download failed"))).toBe(true);
        });

        it("handles pull abort", async () => {
            const entries = [makeEntry({ name: "qwen/qwen3-0.6B" })];
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.catalog = vi.fn().mockResolvedValue(ok(makeCatalogResponse(entries)));
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

        it("Back from model picker always returns to server mode (gives users a way to switch)", async () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.catalog = vi.fn().mockResolvedValue(makeCatalogResponse([]));
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            wizard.next();
            await tick();

            const el = wizard.contentEl as unknown as MockElement;
            const backBtn = findButtons(el).find((b) => b.textContent === "Back")!;
            backBtn.trigger("click");

            const texts = collectTexts(wizard.contentEl as unknown as MockElement);
            // Goes to server-mode step, not welcome — user can revisit choice.
            expect(texts.some((t) => t.includes("How do you want to run lilbee"))).toBe(true);
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
            const entries = [];
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.catalog = vi.fn().mockResolvedValue(ok(makeCatalogResponse(entries)));
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
            const entries = [makeEntry({ name: "qwen/qwen3-0.6B" })];
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.catalog = vi.fn().mockResolvedValue(ok(makeCatalogResponse(entries)));
            let abortSignal: AbortSignal | null = null;
            plugin.api.pullModel = vi
                .fn()
                .mockImplementation((_name: string, _source: string, signal?: AbortSignal) => {
                    abortSignal = signal ?? null;
                    return (async function* () {
                        yield { event: SSE_EVENT.PROGRESS, data: { percent: 50 } };
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
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.catalog = vi
                .fn()
                .mockResolvedValue(
                    ok(makeCatalogResponse([makeEntry({ name: "qwen3:0.6b", size_gb: 0.5, min_ram_gb: 4 })])),
                );
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

        it("pre-selects the server's active chat model over a larger installed one", async () => {
            const entries = [
                makeEntry({
                    hf_repo: "Qwen/Qwen3-4B-GGUF",
                    display_name: "Qwen3 4B",
                    installed: true,
                    min_ram_gb: 8,
                }),
                makeEntry({
                    hf_repo: "janhq/Jan-v3.5-4B-gguf/Jan-v3.5-4B-Q4_K_M.gguf",
                    display_name: "Jan v3.5 4B",
                    installed: true,
                    min_ram_gb: 4,
                }),
            ];
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.catalog = vi.fn().mockResolvedValue(ok(makeCatalogResponse(entries)));
            plugin.api.listModels = vi.fn().mockResolvedValue({
                chat: {
                    active: "janhq/Jan-v3.5-4B-gguf/Jan-v3.5-4B-Q4_K_M.gguf",
                    catalog: [],
                    installed: [],
                },
            });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).step = WIZARD_STEP.MODEL_PICKER;
            (wizard as any).renderStep();
            await tick();
            await tick();

            // recommendedIndex would pick Qwen3 (higher min_ram_gb), but the active model is Jan.
            expect((wizard as any).selectedModel?.hf_repo).toBe("janhq/Jan-v3.5-4B-gguf/Jan-v3.5-4B-Q4_K_M.gguf");
        });

        it("falls back to recommendedIndex when listModels throws during chat load", async () => {
            const entries = [makeEntry({ hf_repo: "bge/bge-small", display_name: "BGE Small", installed: true })];
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.catalog = vi.fn().mockResolvedValue(ok(makeCatalogResponse(entries)));
            plugin.api.listModels = vi.fn().mockRejectedValue(new Error("server down"));
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).step = WIZARD_STEP.MODEL_PICKER;
            (wizard as any).renderStep();
            await tick();
            await tick();

            expect((wizard as any).selectedModel?.hf_repo).toBe("bge/bge-small");
        });

        it("falls back to first pick when listModels throws during embedding load", async () => {
            const entries = [
                makeEntry({ hf_repo: "bge/bge-small", display_name: "BGE Small", task: "embedding" }),
                makeEntry({ hf_repo: "nomic/nomic-embed-text", display_name: "Nomic", task: "embedding" }),
            ];
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.catalog = vi.fn().mockResolvedValue(ok(makeCatalogResponse(entries)));
            plugin.api.listModels = vi.fn().mockRejectedValue(new Error("server down"));
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            const container = new MockElement("div") as unknown as HTMLElement;
            const statusEl = new MockElement("div") as unknown as HTMLElement;
            await (wizard as any).loadEmbeddingModels(container, statusEl);
            expect((wizard as any).selectedEmbedding?.hf_repo).toBe("bge/bge-small");
        });
    });

    describe("Step 3: Sync", () => {
        it("renders sync screen and starts syncing", async () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
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
            (wizard as any).step = 4;
            (wizard as any).renderStep();
            await tick();
            await tick();

            // Should have advanced to wiki step
            const texts = collectTexts(wizard.contentEl as unknown as MockElement);
            expect(texts.some((t) => t.includes("Wiki (optional)"))).toBe(true);
        });

        it("renders BATCH_PROGRESS percent and per-file status during initial sync", async () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            let labelAtBatch = "";
            plugin.api.syncStream = vi.fn().mockReturnValue(
                (async function* () {
                    yield { event: SSE_EVENT.FILE_START, data: { current_file: 1, total_files: 4 } };
                    yield {
                        event: SSE_EVENT.BATCH_PROGRESS,
                        data: { file: "a.md", status: "ingested", current: 2, total: 4 },
                    };
                    // Capture the label state before DONE advances to the wiki step.
                    const labelEl = (wizard.contentEl as unknown as MockElement).find("lilbee-wizard-progress-label");
                    labelAtBatch = labelEl?.textContent ?? "";
                    yield {
                        event: SSE_EVENT.DONE,
                        data: { added: ["a.md"], updated: [], removed: [], unchanged: 0, failed: [] },
                    };
                })(),
            );
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).step = 4;
            (wizard as any).renderStep();
            await tick();
            await tick();

            expect(labelAtBatch).toContain("ingested 2/4 a.md");
        });

        it("sync abort shows notice", async () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            const abortErr = new Error("aborted");
            abortErr.name = "AbortError";
            plugin.api.syncStream = vi.fn().mockReturnValue(
                (async function* () {
                    throw abortErr;
                })(),
            );
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).step = 4;
            (wizard as any).renderStep();
            await tick();
            await tick();

            expect(Notice.instances.some((n) => n.message.includes("indexing cancelled"))).toBe(true);
        });

        it("sync surfaces token-stale message when stream throws SessionTokenError", async () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.syncStream = vi.fn().mockReturnValue(
                (async function* () {
                    throw new SessionTokenError(401, "stale");
                })(),
            );
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).step = 4;
            (wizard as any).renderStep();
            await tick();
            await tick();

            expect(Notice.instances.some((n) => n.message === MESSAGES.NOTICE_SESSION_TOKEN_INVALID)).toBe(true);
            const texts = collectTexts(wizard.contentEl as unknown as MockElement);
            expect(texts.some((t) => t.includes(MESSAGES.NOTICE_SESSION_TOKEN_INVALID))).toBe(true);
        });

        it("sync failure shows error message", async () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.syncStream = vi.fn().mockReturnValue(
                (async function* () {
                    throw new Error("network");
                })(),
            );
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).step = 4;
            (wizard as any).renderStep();
            await tick();
            await tick();

            const texts = collectTexts(wizard.contentEl as unknown as MockElement);
            expect(texts.some((t) => t.includes("Indexing failed"))).toBe(true);
        });

        it("SSE_EVENT.ERROR during sync sets progress label and shows indexing failed", async () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.syncStream = vi.fn().mockReturnValue(
                (async function* () {
                    yield { event: SSE_EVENT.ERROR, data: { message: "sync exploded" } };
                })(),
            );
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).step = 4;
            (wizard as any).renderStep();
            await tick();
            await tick();

            const texts = collectTexts(wizard.contentEl as unknown as MockElement);
            expect(texts.some((t) => t.includes("Indexing failed"))).toBe(true);
        });

        it("SSE_EVENT.ERROR with string data during sync shows indexing failed", async () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.syncStream = vi.fn().mockReturnValue(
                (async function* () {
                    yield { event: SSE_EVENT.ERROR, data: "raw sync error" };
                })(),
            );
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).step = 4;
            (wizard as any).renderStep();
            await tick();
            await tick();

            const texts = collectTexts(wizard.contentEl as unknown as MockElement);
            expect(texts.some((t) => t.includes("Indexing failed"))).toBe(true);
        });

        it("SSE_EVENT.ERROR with empty object during sync uses fallback message", async () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.syncStream = vi.fn().mockReturnValue(
                (async function* () {
                    yield { event: SSE_EVENT.ERROR, data: {} };
                })(),
            );
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).step = 4;
            (wizard as any).renderStep();
            await tick();
            await tick();

            const texts = collectTexts(wizard.contentEl as unknown as MockElement);
            expect(texts.some((t) => t.includes("Indexing failed"))).toBe(true);
        });

        it("Back from sync cancels and returns to model picker", async () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            let abortSignal: AbortSignal | null = null;
            plugin.api.syncStream = vi.fn().mockImplementation((signal?: AbortSignal) => {
                abortSignal = signal ?? null;
                return (async function* () {
                    yield { event: SSE_EVENT.FILE_START, data: { current_file: 1, total_files: 100 } };
                    await new Promise(() => {});
                })();
            });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).step = 4;
            (wizard as any).renderStep();
            await tick();

            const el = wizard.contentEl as unknown as MockElement;
            const backBtn = findButtons(el).find((b) => b.textContent === "Back")!;
            backBtn.trigger("click");

            expect(abortSignal?.aborted).toBe(true);
        });

        it("Skip setup aborts sync and closes wizard", async () => {
            let _abortSignal: AbortSignal | null = null;
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.syncStream = vi.fn().mockImplementation((signal?: AbortSignal) => {
                _abortSignal = signal ?? null;
                return (async function* () {
                    yield { event: SSE_EVENT.FILE_START, data: { current_file: 1, total_files: 100 } };
                    await new Promise(() => {});
                })();
            });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            const closeSpy = vi.spyOn(wizard, "close");
            wizard.open();
            (wizard as any).step = 4;
            (wizard as any).renderStep();
            await tick();

            const el = wizard.contentEl as unknown as MockElement;
            const skipBtn = findButtons(el).find((b) => b.textContent === "Skip setup")!;
            skipBtn.trigger("click");
            expect(closeSpy).toHaveBeenCalled();
        });
    });

    describe("Step 4: Wiki", () => {
        it("renders wiki step with title, description, pros and cons", () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).step = 5;
            (wizard as any).renderStep();

            const el = wizard.contentEl as unknown as MockElement;
            const texts = collectTexts(el);
            expect(texts.some((t) => t.includes("Wiki (optional)"))).toBe(true);
            expect(texts.some((t) => t.includes("AI-written summaries"))).toBe(true);
            expect(texts.some((t) => t.includes("What it adds"))).toBe(true);
            expect(texts.some((t) => t.includes("Worth knowing"))).toBe(true);
            expect(texts.some((t) => t.includes("Summarized, structured overviews"))).toBe(true);
            expect(texts.some((t) => t.includes("cross-references"))).toBe(true);
            expect(texts.some((t) => t.includes("LLM compute / API tokens"))).toBe(true);
            expect(texts.some((t) => t.includes("hallucinate"))).toBe(true);
        });

        it("presents the wiki as optional rather than experimental", () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).step = 5;
            (wizard as any).renderStep();

            const joined = collectTexts(wizard.contentEl as unknown as MockElement).join(" ");
            expect(joined).not.toMatch(/experimental/i);
            expect(joined).not.toMatch(/proceed with caution/i);
        });

        it("says the build is GPU heavy and blocks chat, both on the page and in the tooltip", () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).step = 5;
            (wizard as any).renderStep();

            const el = wizard.contentEl as unknown as MockElement;
            const joined = collectTexts(el).join(" ");
            expect(joined).toContain("holds the GPU");
            expect(joined).toContain("chat is unavailable while it works");

            // The cost has to reach someone who skipped the prose and went
            // straight for the toggle, so it is on the enable card too.
            const enable = el.findAll("lilbee-wizard-model-option")[0];
            const tip = enable?.getAttribute("aria-label") ?? "";
            expect(tip).toMatch(/GPU heavy/i);
            expect(tip).toMatch(/drafts/i);
        });

        it("leaves the wiki off unless the enable card is chosen", () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).step = 5;
            (wizard as any).renderStep();

            const el = wizard.contentEl as unknown as MockElement;
            findButtons(el)
                .find((b) => b.textContent === "Next")!
                .trigger("click");

            expect(plugin.settings.wikiEnabled).toBe(false);
        });

        it("renders enable and disable option cards", () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).step = 5;
            (wizard as any).renderStep();

            const el = wizard.contentEl as unknown as MockElement;
            const options = el.findAll("lilbee-wizard-model-option");
            expect(options.length).toBe(2);
            const texts = collectTexts(el);
            expect(texts.some((t) => t.includes("Enable wiki"))).toBe(true);
            expect(texts.some((t) => t.includes("Skip for now"))).toBe(true);
        });

        it("defaults to disabled (matching wikiEnabled=false)", () => {
            const plugin = makePlugin({ settings: { serverMode: "external", wikiEnabled: false } });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).step = 5;
            (wizard as any).renderStep();

            const el = wizard.contentEl as unknown as MockElement;
            const options = el.findAll("lilbee-wizard-model-option");
            // Disable option (second) should be selected
            expect(options[1].classList.contains("selected")).toBe(true);
            expect(options[0].classList.contains("selected")).toBe(false);
        });

        it("pre-selects enable when wikiEnabled is true", () => {
            const plugin = makePlugin({ settings: { serverMode: "external", wikiEnabled: true } });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).step = 5;
            (wizard as any).renderStep();

            const el = wizard.contentEl as unknown as MockElement;
            const options = el.findAll("lilbee-wizard-model-option");
            // Enable option (first) should be selected
            expect(options[0].classList.contains("selected")).toBe(true);
            expect(options[1].classList.contains("selected")).toBe(false);
        });

        it("clicking enable selects it and deselects disable", () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).step = 5;
            (wizard as any).renderStep();

            const el = wizard.contentEl as unknown as MockElement;
            const options = el.findAll("lilbee-wizard-model-option");
            options[0].trigger("click");
            expect(options[0].classList.contains("selected")).toBe(true);
            expect(options[1].classList.contains("selected")).toBe(false);
        });

        it("clicking disable selects it and deselects enable", () => {
            const plugin = makePlugin({ settings: { serverMode: "external", wikiEnabled: true } });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).step = 5;
            (wizard as any).renderStep();

            const el = wizard.contentEl as unknown as MockElement;
            const options = el.findAll("lilbee-wizard-model-option");
            options[1].trigger("click");
            expect(options[1].classList.contains("selected")).toBe(true);
            expect(options[0].classList.contains("selected")).toBe(false);
        });

        it("Next saves wikiEnabled=true to settings when enabled", async () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).step = 5;
            (wizard as any).renderStep();

            const el = wizard.contentEl as unknown as MockElement;
            // Click enable
            const options = el.findAll("lilbee-wizard-model-option");
            options[0].trigger("click");

            const nextBtn = findButtons(el).find((b) => b.textContent === "Next")!;
            nextBtn.trigger("click");
            await tick();

            expect(plugin.settings.wikiEnabled).toBe(true);
            expect(plugin.saveSettings).toHaveBeenCalled();
            // Should advance to done
            const texts = collectTexts(wizard.contentEl as unknown as MockElement);
            expect(texts.some((t) => t.includes("You're all set!"))).toBe(true);
        });

        it("Next saves wikiEnabled=false to settings when disabled", async () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).step = 5;
            (wizard as any).renderStep();

            const el = wizard.contentEl as unknown as MockElement;
            const nextBtn = findButtons(el).find((b) => b.textContent === "Next")!;
            nextBtn.trigger("click");
            await tick();

            expect(plugin.settings.wikiEnabled).toBe(false);
            expect(plugin.saveSettings).toHaveBeenCalled();
        });

        it("Back returns to sync step", () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.syncStream = vi.fn().mockReturnValue(
                (async function* () {
                    await new Promise(() => {});
                })(),
            );
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).step = 5;
            (wizard as any).renderStep();

            const el = wizard.contentEl as unknown as MockElement;
            const backBtn = findButtons(el).find((b) => b.textContent === "Back")!;
            backBtn.trigger("click");

            const texts = collectTexts(wizard.contentEl as unknown as MockElement);
            expect(texts.some((t) => t.includes("Index your vault"))).toBe(true);
        });

        it("Skip setup closes the wizard", () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            const closeSpy = vi.spyOn(wizard, "close");
            wizard.open();
            (wizard as any).step = 5;
            (wizard as any).renderStep();

            const el = wizard.contentEl as unknown as MockElement;
            const skipBtn = findButtons(el).find((b) => b.textContent === "Skip setup")!;
            skipBtn.trigger("click");
            expect(closeSpy).toHaveBeenCalled();
        });

        it("renders step indicator on wiki step", () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).step = 5;
            (wizard as any).renderStep();

            const el = wizard.contentEl as unknown as MockElement;
            const indicator = el.find("lilbee-wizard-step-indicator");
            expect(indicator).not.toBeNull();
            const dots = indicator!.findAll("lilbee-wizard-step-circle");
            expect(dots.length).toBe(6);
        });

        it("renders pros list items", () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).step = 5;
            (wizard as any).renderStep();

            const el = wizard.contentEl as unknown as MockElement;
            const texts = collectTexts(el);
            expect(texts.some((t) => t.includes("coherent answers"))).toBe(true);
        });

        it("renders cons list items", () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).step = 5;
            (wizard as any).renderStep();

            const el = wizard.contentEl as unknown as MockElement;
            const texts = collectTexts(el);
            expect(texts.some((t) => t.includes("prioritise wiki chunks"))).toBe(true);
            expect(texts.some((t) => t.includes("second index shape"))).toBe(true);
        });
    });

    describe("Step 5: Done", () => {
        it("renders done screen with summary", () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
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
            (wizard as any).step = 6;
            (wizard as any).renderStep();

            const el = wizard.contentEl as unknown as MockElement;
            const texts = collectTexts(el);
            expect(texts.some((t) => t.includes("You're all set!"))).toBe(true);
            expect(texts.some((t) => t.includes("qwen3:8b"))).toBe(true);
            expect(texts.some((t) => t.includes("10 files indexed"))).toBe(true);
            expect(texts.some((t) => t.includes("Open chat"))).toBe(true);
        });

        it("renders done screen without model/sync info if skipped", () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).step = 6;
            (wizard as any).renderStep();

            const el = wizard.contentEl as unknown as MockElement;
            const texts = collectTexts(el);
            expect(texts.some((t) => t.includes("You're all set!"))).toBe(true);
        });

        it("Open chat marks setup complete and opens chat view", async () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            const closeSpy = vi.spyOn(wizard, "close");
            wizard.open();
            (wizard as any).step = 6;
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

        // The wizard can be launched from the settings tab, where Obsidian
        // stacks it on the settings surface. Leaving settings open hides the
        // chat view the button just opened.
        it("Open chat closes the settings surface", async () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            const app = plugin.app as unknown as App;
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).step = 6;
            (wizard as any).renderStep();

            const el = wizard.contentEl as unknown as MockElement;
            findButtons(el)
                .find((b) => b.textContent === "Open chat")!
                .trigger("click");
            await tick();

            expect(app.setting?.close).toHaveBeenCalled();
            expect(plugin.activateChatView).toHaveBeenCalled();
        });

        // Dismissing settings is best-effort on an undocumented API; opening chat is the promise the
        // button makes, so it must survive an Obsidian that no longer exposes the settings surface.
        it("Open chat still opens the chat view when the settings surface is gone", async () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            (plugin.app as unknown as App).setting = undefined;
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).step = 6;
            (wizard as any).renderStep();

            const el = wizard.contentEl as unknown as MockElement;
            findButtons(el)
                .find((b) => b.textContent === "Open chat")!
                .trigger("click");
            await tick();

            expect(plugin.activateChatView).toHaveBeenCalled();
            expect(plugin.settings.setupCompleted).toBe(true);
        });

        it("shows tips about what to try", () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).step = 6;
            (wizard as any).renderStep();

            const el = wizard.contentEl as unknown as MockElement;
            const texts = collectTexts(el);
            expect(texts.some((t) => t.includes("chat panel"))).toBe(true);
            expect(texts.some((t) => t.includes("search command"))).toBe(true);
        });

        it("renders 'Setup complete' section heading inside summary card", () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).step = 6;
            (wizard as any).renderStep();

            const el = wizard.contentEl as unknown as MockElement;
            const card = el.find("lilbee-wizard-summary-card");
            expect(card).not.toBeNull();
            const heading = card!.find("lilbee-wizard-section-heading");
            expect(heading).not.toBeNull();
            expect(heading!.textContent).toBe("Setup complete");
        });

        it("renders summary in summary-card div", () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).pulledModelName = "test-model";
            (wizard as any).step = 6;
            (wizard as any).renderStep();

            const el = wizard.contentEl as unknown as MockElement;
            const card = el.find("lilbee-wizard-summary-card");
            expect(card).not.toBeNull();
        });

        it("renders tips with icon spans", () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).step = 6;
            (wizard as any).renderStep();

            const el = wizard.contentEl as unknown as MockElement;
            const tipDivs = el.findAll("lilbee-wizard-tip");
            expect(tipDivs.length).toBe(3);
            const tipIcons = el.findAll("lilbee-wizard-tip-icon");
            expect(tipIcons.length).toBe(3);
            expect(tipIcons[0].textContent).toBe("\u{1F4AC}");
            expect(tipIcons[1].textContent).toBe("\u{1F50D}");
            expect(tipIcons[2].textContent).toBe("\u{1F4C4}");
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
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            wizard.back();

            const texts = collectTexts(wizard.contentEl as unknown as MockElement);
            expect(texts.some((t) => t.includes("Welcome to lilbee"))).toBe(true);
        });

        it("back() at step 4 (sync) goes to step 3 (embedding picker)", () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.catalog = vi.fn().mockResolvedValue(ok(makeCatalogResponse([])));
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).step = 4;
            wizard.back();

            const texts = collectTexts(wizard.contentEl as unknown as MockElement);
            expect(texts.some((t) => t.includes("Pick an embedding model"))).toBe(true);
        });

        it("back() at step 6 (done) goes to step 5 (wiki)", () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).step = 6;
            wizard.back();

            const texts = collectTexts(wizard.contentEl as unknown as MockElement);
            expect(texts.some((t) => t.includes("Wiki (optional)"))).toBe(true);
        });
    });

    describe("onClose cleanup", () => {
        it("aborts pull controller on close", async () => {
            const entries = [makeEntry({ name: "qwen/qwen3-0.6B" })];
            let capturedSignal: AbortSignal | null = null;
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.catalog = vi.fn().mockResolvedValue(ok(makeCatalogResponse(entries)));
            plugin.api.pullModel = vi
                .fn()
                .mockImplementation((_model: string, _source: string, signal: AbortSignal) => {
                    capturedSignal = signal;
                    return (async function* () {
                        yield { event: SSE_EVENT.PROGRESS, data: { percent: 50 } };
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

            wizard.close();
            expect(capturedSignal?.aborted).toBe(true);
        });

        it("aborts sync controller on close", async () => {
            let capturedSignal: AbortSignal | null = null;
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.syncStream = vi.fn().mockImplementation((signal?: AbortSignal) => {
                capturedSignal = signal ?? null;
                return (async function* () {
                    yield { event: SSE_EVENT.FILE_START, data: { current_file: 1, total_files: 100 } };
                    await new Promise(() => {});
                })();
            });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).step = 4;
            (wizard as any).renderStep();
            await tick();

            wizard.close();
            expect(capturedSignal?.aborted).toBe(true);
        });
    });

    describe("System memory detection", () => {
        it("handles missing os module gracefully", async () => {
            const entries = [
                makeEntry({ name: "qwen/qwen3-0.6B", min_ram_gb: 4 }),
                makeEntry({ name: "qwen/qwen3-4B", min_ram_gb: 8 }),
            ];
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.catalog = vi.fn().mockResolvedValue(ok(makeCatalogResponse(entries)));
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
        it("complete flow: welcome -> model -> embed -> sync -> wiki -> done", async () => {
            const entries = [makeEntry({ name: "qwen/qwen3-0.6B" })];
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.catalog = vi.fn().mockResolvedValue(ok(makeCatalogResponse(entries)));
            plugin.api.pullModel = vi.fn().mockReturnValue(
                (async function* () {
                    yield { event: SSE_EVENT.PROGRESS, data: { percent: 100 } };
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

            // Step 3: Embedding picker -> Download & continue (advances to sync when no selection)
            el = wizard.contentEl as unknown as MockElement;
            findButtons(el)
                .find((b) => b.textContent === "Download & continue")!
                .trigger("click");
            await tick();
            await tick();

            // Step 4: Sync (auto-starts, should auto-advance to wiki)
            await tick();
            await tick();

            // Step 5: Wiki -> Next (keep disabled)
            el = wizard.contentEl as unknown as MockElement;
            expect(collectTexts(el).some((t) => t.includes("Wiki (optional)"))).toBe(true);
            findButtons(el)
                .find((b) => b.textContent === "Next")!
                .trigger("click");
            await tick();

            // Step 6: Done -> Open chat
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

    describe("pickNativeChatModels", () => {
        // Regression test for the "buggy server" path: all featured models
        // come back labeled source="litellm". Previous behavior filtered
        // those out and emptied the wizard grid; new behavior keeps them.
        it("does not drop entries even when every model is labeled litellm", () => {
            const models = [
                makeEntry({ name: "qwen3-0.6b", hf_repo: "q/a", source: "litellm" }),
                makeEntry({ name: "gemma-3-4b", hf_repo: "g/b", source: "litellm" }),
                makeEntry({ name: "mistral-7b", hf_repo: "m/c", source: "litellm" }),
            ];
            const picks = pickNativeChatModels(models);
            expect(picks.length).toBe(3);
        });

        it("orders recognised families before others", () => {
            const models = [
                makeEntry({ hf_repo: "bartowski/SmolLM2-135M-Instruct-GGUF", display_name: "SmolLM2 135M" }),
                makeEntry({ hf_repo: "Qwen/Qwen3-0.6B-GGUF", display_name: "Qwen3 0.6B" }),
                makeEntry({ hf_repo: "ggml-org/gemma-3-1b-it-GGUF", display_name: "Gemma 3 1B" }),
            ];
            const picks = pickNativeChatModels(models);
            // Gemma family comes first in PREFERRED_FAMILIES order.
            expect(picks[0].display_name).toBe("Gemma 3 1B");
            expect(picks[1].display_name).toBe("Qwen3 0.6B");
            expect(picks[2].display_name).toBe("SmolLM2 135M");
        });

        it("dedupes entries sharing the same hf_repo", () => {
            const dup = makeEntry({ hf_repo: "Qwen/Qwen3-0.6B-GGUF" });
            const picks = pickNativeChatModels([dup, dup]);
            expect(picks.length).toBe(1);
        });

        it("caps at MAX_FEATURED_PICKS even after preferred-family and backfill rounds", () => {
            const models = Array.from({ length: 20 }, (_, i) =>
                makeEntry({ hf_repo: `org/other-${i}-GGUF`, display_name: `Other ${i}` }),
            );
            const picks = pickNativeChatModels(models);
            expect(picks.length).toBe(8);
        });

        it("caps MID-preferred-family iteration when max is reached", () => {
            // Exercise the early-return inside the preferred-families loop.
            const models = Array.from({ length: 10 }, (_, i) =>
                makeEntry({ hf_repo: `ggml-org/gemma-3-${i}b-it-GGUF`, display_name: `Gemma 3 ${i}B` }),
            );
            const picks = pickNativeChatModels(models);
            expect(picks.length).toBe(8);
        });

        it("applies a custom filter predicate when provided", () => {
            const models = [
                makeEntry({ hf_repo: "Qwen/Qwen3-0.6B-GGUF", source: "litellm" }),
                makeEntry({ hf_repo: "ggml-org/gemma-3-1b-it-GGUF", source: "native" }),
            ];
            const picks = pickNativeChatModels(models, (m) => m.source !== "litellm");
            expect(picks.length).toBe(1);
            expect(picks[0].source).toBe("native");
        });
    });

    describe("recommendedIndex", () => {
        it("returns 0 when memGB is null and no model is installed", () => {
            const models = [
                { name: "small", size_gb: 0.5, min_ram_gb: 4, description: "", source: "native" as const },
                { name: "large", size_gb: 5, min_ram_gb: 16, description: "", source: "native" as const },
            ];
            expect(recommendedIndex(models, null)).toBe(0);
        });

        it("returns 0 when models is empty", () => {
            expect(recommendedIndex([], 16)).toBe(0);
        });

        it("selects the largest model that fits in memory when none are installed", () => {
            const models = [
                { name: "small", size_gb: 0.5, min_ram_gb: 4, description: "", source: "native" as const },
                { name: "medium", size_gb: 2.5, min_ram_gb: 8, description: "", source: "native" as const },
                { name: "large", size_gb: 5, min_ram_gb: 16, description: "", source: "native" as const },
            ];
            expect(recommendedIndex(models, 10)).toBe(1);
            expect(recommendedIndex(models, 16)).toBe(2);
            expect(recommendedIndex(models, 3)).toBe(0);
        });

        it("prefers an already-installed model that fits over a larger uninstalled one", () => {
            const models = [
                {
                    name: "tiny-installed",
                    size_gb: 0.5,
                    min_ram_gb: 4,
                    description: "",
                    source: "native" as const,
                    installed: true,
                },
                {
                    name: "huge-uninstalled",
                    size_gb: 18,
                    min_ram_gb: 32,
                    description: "",
                    source: "native" as const,
                    installed: false,
                },
            ];
            expect(recommendedIndex(models, 32)).toBe(0);
        });

        it("picks the largest installed-and-fits when multiple are installed", () => {
            const models = [
                {
                    name: "small-installed",
                    size_gb: 0.5,
                    min_ram_gb: 4,
                    description: "",
                    source: "native" as const,
                    installed: true,
                },
                {
                    name: "medium-installed",
                    size_gb: 2,
                    min_ram_gb: 8,
                    description: "",
                    source: "native" as const,
                    installed: true,
                },
                {
                    name: "huge-uninstalled",
                    size_gb: 18,
                    min_ram_gb: 32,
                    description: "",
                    source: "native" as const,
                    installed: false,
                },
            ];
            expect(recommendedIndex(models, 32)).toBe(1);
        });

        it("falls through to largest-fit when no installed model fits", () => {
            const models = [
                {
                    name: "huge-installed",
                    size_gb: 18,
                    min_ram_gb: 32,
                    description: "",
                    source: "native" as const,
                    installed: true,
                },
                {
                    name: "medium-uninstalled",
                    size_gb: 2,
                    min_ram_gb: 8,
                    description: "",
                    source: "native" as const,
                    installed: false,
                },
            ];
            // Host has 16 GB so the 32 GB installed one doesn't fit; pick the
            // medium uninstalled one as the largest that does.
            expect(recommendedIndex(models, 16)).toBe(1);
        });

        it("keeps the larger installed model when a smaller installed one follows", () => {
            // Second installed model has a smaller RAM floor than the running
            // best, so the `>= bestRam` check is false and index 0 stays best.
            const models = [
                {
                    name: "big-installed",
                    size_gb: 5,
                    min_ram_gb: 8,
                    description: "",
                    source: "native" as const,
                    installed: true,
                },
                {
                    name: "small-installed",
                    size_gb: 0.5,
                    min_ram_gb: 4,
                    description: "",
                    source: "native" as const,
                    installed: true,
                },
            ];
            expect(recommendedIndex(models, 16)).toBe(0);
        });

        it("returns the first installed model when memGB is null", () => {
            const models = [
                {
                    name: "uninstalled",
                    size_gb: 0.5,
                    min_ram_gb: 4,
                    description: "",
                    source: "native" as const,
                    installed: false,
                },
                {
                    name: "installed",
                    size_gb: 2,
                    min_ram_gb: 8,
                    description: "",
                    source: "native" as const,
                    installed: true,
                },
            ];
            expect(recommendedIndex(models, null)).toBe(1);
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
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
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
            (wizard as any).step = 4;
            (wizard as any).renderStep();
            await tick();
            await tick();

            const texts = collectTexts(wizard.contentEl as unknown as MockElement);
            expect(texts.some((t) => t.includes("Wiki (optional)"))).toBe(true);
        });
    });

    describe("pullSelectedModel early return", () => {
        it("returns early when selectedModel is null", async () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            // Call pullSelectedModel directly with no selected model
            (wizard as any).selectedModel = null;
            const el = new MockElement("div");
            await (wizard as any).pullSelectedModel(el, el, el, el, el, el);
            // Should return without calling pullModel
            expect(plugin.api.pullModel).not.toHaveBeenCalled();
        });

        it("surfaces notice and keeps step when setChatModel returns err after successful pull", async () => {
            Notice.clear();
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.pullModel = vi.fn().mockReturnValue(
                (async function* () {
                    yield { event: SSE_EVENT.PROGRESS, data: { percent: 100 } };
                })(),
            );
            plugin.api.setChatModel = vi.fn().mockResolvedValue(err(new Error("activate fail")));
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).selectedModel = makeEntry({
                name: "qwen3-0.6b",
                hf_repo: "qwen/qwen3-0.6B",
                display_name: "Qwen3 0.6B",
                task: "chat",
                installed: false,
            });
            const el = new MockElement("div") as unknown as HTMLElement;
            const btn = new MockElement("button") as unknown as HTMLElement;
            await (wizard as any).pullSelectedModel(btn, el, el, el, el, el);
            const setFailed = MESSAGES.ERROR_SET_MODEL.replace("{model}", "Qwen3 0.6B");
            expect(Notice.instances.some((n: any) => n.message === setFailed)).toBe(true);
            expect((wizard as any).step).not.toBe(WIZARD_STEP.EMBEDDING_PICKER);
        });
    });

    describe("Step 3: Embedding Picker", () => {
        it("renders embedding picker step", async () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.catalog = vi.fn().mockResolvedValue(ok(makeCatalogResponse([])));
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).step = 3;
            (wizard as any).renderStep();
            await tick();

            const texts = collectTexts(wizard.contentEl as unknown as MockElement);
            expect(texts.some((t) => t.includes("Pick an embedding model"))).toBe(true);
        });

        it("back from embedding picker goes to model picker and aborts pull", async () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.catalog = vi.fn().mockResolvedValue(ok(makeCatalogResponse([])));
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).step = 3;
            (wizard as any).renderStep();
            await tick();

            // Set a pull controller so the ?.abort() branch is covered
            const mockAbort = vi.fn();
            (wizard as any).pullController = { abort: mockAbort };

            const el = wizard.contentEl as unknown as MockElement;
            const backBtn = findButtons(el).find((b) => b.textContent === "Back")!;
            backBtn.trigger("click");

            expect(mockAbort).toHaveBeenCalled();
            const texts = collectTexts(wizard.contentEl as unknown as MockElement);
            expect(texts.some((t) => t.includes("Pick a chat model"))).toBe(true);
        });

        it("skip button closes wizard and aborts pull if running", () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.catalog = vi.fn().mockResolvedValue(ok(makeCatalogResponse([])));
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            const closeSpy = vi.spyOn(wizard, "close");
            wizard.open();
            (wizard as any).step = 3;
            (wizard as any).renderStep();

            // Set a pull controller so the ?.abort() branch is covered
            const mockAbort = vi.fn();
            (wizard as any).pullController = { abort: mockAbort };

            const el = wizard.contentEl as unknown as MockElement;
            const skipBtn = findButtons(el).find((b) => b.textContent === "Skip setup")!;
            skipBtn.trigger("click");
            expect(closeSpy).toHaveBeenCalled();
            expect(mockAbort).toHaveBeenCalled();
        });

        it("download & continue with no selection advances to sync step", async () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.catalog = vi.fn().mockResolvedValue(ok(makeCatalogResponse([])));
            plugin.api.syncStream = vi.fn().mockReturnValue(
                (async function* () {
                    await new Promise(() => {});
                })(),
            );
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).step = 3;
            (wizard as any).renderStep();
            await tick();

            const el = wizard.contentEl as unknown as MockElement;
            findButtons(el)
                .find((b) => b.textContent === "Download & continue")!
                .trigger("click");
            await tick();

            const texts = collectTexts(wizard.contentEl as unknown as MockElement);
            expect(texts.some((t) => t.includes("Index your vault"))).toBe(true);
        });

        it("download & continue with installed model sets embedding and advances to sync step", async () => {
            const entries = [
                makeEntry({
                    hf_repo: "nomic-ai/nomic-embed-text-v1.5-GGUF",
                    display_name: "nomic-embed-text",
                    task: "embedding",
                    installed: true,
                }),
            ];
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.catalog = vi.fn().mockResolvedValue(ok(makeCatalogResponse(entries)));
            plugin.api.syncStream = vi.fn().mockReturnValue(
                (async function* () {
                    await new Promise(() => {});
                })(),
            );
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).step = 3;
            (wizard as any).renderStep();
            await tick();

            const el = wizard.contentEl as unknown as MockElement;
            findButtons(el)
                .find((b) => b.textContent === "Download & continue")!
                .trigger("click");
            await tick();

            expect(plugin.api.setEmbeddingModel).toHaveBeenCalledWith("nomic-ai/nomic-embed-text-v1.5-GGUF");
            const texts = collectTexts(wizard.contentEl as unknown as MockElement);
            expect(texts.some((t) => t.includes("Index your vault"))).toBe(true);
        });

        it("installed-embedding click surfaces notice when setEmbeddingModel returns err", async () => {
            Notice.clear();
            const entries = [
                makeEntry({
                    hf_repo: "nomic-ai/nomic-embed-text-v1.5-GGUF",
                    display_name: "nomic-embed-text",
                    task: "embedding",
                    installed: true,
                }),
            ];
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.catalog = vi.fn().mockResolvedValue(ok(makeCatalogResponse(entries)));
            plugin.api.setEmbeddingModel = vi.fn().mockResolvedValue(err(new Error("activate fail")));
            plugin.api.syncStream = vi.fn().mockReturnValue(
                (async function* () {
                    await new Promise(() => {});
                })(),
            );
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).step = 3;
            (wizard as any).renderStep();
            await tick();

            const el = wizard.contentEl as unknown as MockElement;
            findButtons(el)
                .find((b) => b.textContent === "Download & continue")!
                .trigger("click");
            await tick();
            await tick();

            const setFailed = MESSAGES.ERROR_SET_MODEL.replace("{model}", "nomic-embed-text");
            expect(Notice.instances.some((n: any) => n.message === setFailed)).toBe(true);
        });

        it("pullEmbeddingModel early return when selectedEmbedding is null", async () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).selectedEmbedding = null;
            const el = new MockElement("div");
            await (wizard as any).pullEmbeddingModel(el, el, el, el, el);
            expect(plugin.api.pullModel).not.toHaveBeenCalled();
        });

        it("pullEmbeddingModel handles pull failure", async () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.pullModel = vi.fn().mockReturnValue(
                (async function* () {
                    throw new Error("network error");
                })(),
            );
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).selectedEmbedding = makeEntry({
                name: "nomic-embed-text",
                hf_repo: "nomic/nomic-embed-text",
                task: "embedding",
                installed: false,
            });
            const el = new MockElement("div") as unknown as HTMLElement;
            const btn = new MockElement("button") as unknown as HTMLElement;
            await (wizard as any).pullEmbeddingModel(btn, el, el, el, el, el);
            expect((btn as unknown as MockElement).disabled).toBe(false);
        });

        it("pullEmbeddingModel surfaces token-stale message on SessionTokenError", async () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.pullModel = vi.fn().mockReturnValue(
                (async function* () {
                    throw new SessionTokenError(401, "stale");
                })(),
            );
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).selectedEmbedding = makeEntry({
                name: "nomic-embed-text",
                hf_repo: "nomic/nomic-embed-text",
                task: "embedding",
                installed: false,
            });
            const statusEl = new MockElement("div") as unknown as HTMLElement;
            const btn = new MockElement("button") as unknown as HTMLElement;
            const otherEl = new MockElement("div") as unknown as HTMLElement;
            await (wizard as any).pullEmbeddingModel(btn, otherEl, otherEl, otherEl, statusEl, otherEl);
            expect(Notice.instances.some((n) => n.message === MESSAGES.NOTICE_SESSION_TOKEN_INVALID)).toBe(true);
            expect((statusEl as unknown as MockElement).textContent).toBe(MESSAGES.NOTICE_SESSION_TOKEN_INVALID);
        });

        it("pullEmbeddingModel handles AbortError", async () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.pullModel = vi.fn().mockReturnValue(
                (async function* () {
                    const e = new Error("abort");
                    e.name = "AbortError";
                    throw e;
                })(),
            );
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).selectedEmbedding = makeEntry({
                name: "nomic-embed-text",
                hf_repo: "nomic/nomic-embed-text",
                task: "embedding",
                installed: false,
            });
            const el = new MockElement("div") as unknown as HTMLElement;
            const btn = new MockElement("button") as unknown as HTMLElement;
            await (wizard as any).pullEmbeddingModel(btn, el, el, el, el, el);
            expect(Notice.instances.some((n) => n.message.includes("download cancelled"))).toBe(true);
        });

        it("pullEmbeddingModel succeeds and sets embedding model", async () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.pullModel = vi.fn().mockReturnValue(
                (async function* () {
                    yield { event: SSE_EVENT.PROGRESS, data: { percent: 50 } };
                })(),
            );
            plugin.api.syncStream = vi.fn().mockReturnValue(
                (async function* () {
                    await new Promise(() => {});
                })(),
            );
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).selectedEmbedding = makeEntry({
                name: "nomic-embed-text",
                hf_repo: "nomic/nomic-embed-text",
                task: "embedding",
                installed: false,
            });
            const el = new MockElement("div") as unknown as HTMLElement;
            const btn = new MockElement("button") as unknown as HTMLElement;
            await (wizard as any).pullEmbeddingModel(btn, el, el, el, el, el);
            expect(plugin.api.setEmbeddingModel).toHaveBeenCalledWith("nomic/nomic-embed-text");
        });

        it("pullEmbeddingModel surfaces notice and keeps step when setEmbeddingModel returns err", async () => {
            Notice.clear();
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.pullModel = vi.fn().mockReturnValue(
                (async function* () {
                    yield { event: SSE_EVENT.PROGRESS, data: { percent: 100 } };
                })(),
            );
            plugin.api.setEmbeddingModel = vi.fn().mockResolvedValue(err(new Error("activate fail")));
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).selectedEmbedding = makeEntry({
                name: "nomic-embed-text",
                hf_repo: "nomic/nomic-embed-text",
                display_name: "Nomic Embed Text v1.5",
                task: "embedding",
                installed: false,
            });
            const el = new MockElement("div") as unknown as HTMLElement;
            const btn = new MockElement("button") as unknown as HTMLElement;
            await (wizard as any).pullEmbeddingModel(btn, el, el, el, el, el);
            const setFailed = MESSAGES.ERROR_SET_MODEL.replace("{model}", "Nomic Embed Text v1.5");
            expect(Notice.instances.some((n: any) => n.message === setFailed)).toBe(true);
            expect((wizard as any).step).not.toBe(WIZARD_STEP.SYNC);
        });

        it("pullEmbeddingModel handles progress with current/total", async () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.pullModel = vi.fn().mockReturnValue(
                (async function* () {
                    yield { event: SSE_EVENT.PROGRESS, data: { current: 50, total: 100 } };
                })(),
            );
            plugin.api.syncStream = vi.fn().mockReturnValue(
                (async function* () {
                    await new Promise(() => {});
                })(),
            );
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).selectedEmbedding = makeEntry({
                name: "nomic-embed-text",
                hf_repo: "nomic/nomic-embed-text",
                task: "embedding",
                installed: false,
            });
            const el = new MockElement("div") as unknown as HTMLElement;
            const btn = new MockElement("button") as unknown as HTMLElement;
            await (wizard as any).pullEmbeddingModel(btn, el, el, el, el, el);
            expect(plugin.api.setEmbeddingModel).toHaveBeenCalledWith("nomic/nomic-embed-text");
        });

        it("pullEmbeddingModel handles progress with no percent and no total", async () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.pullModel = vi.fn().mockReturnValue(
                (async function* () {
                    yield { event: SSE_EVENT.PROGRESS, data: {} };
                })(),
            );
            plugin.api.syncStream = vi.fn().mockReturnValue(
                (async function* () {
                    await new Promise(() => {});
                })(),
            );
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).selectedEmbedding = makeEntry({
                name: "nomic-embed-text",
                hf_repo: "nomic/nomic-embed-text",
                task: "embedding",
                installed: false,
            });
            const el = new MockElement("div") as unknown as HTMLElement;
            const btn = new MockElement("button") as unknown as HTMLElement;
            await (wizard as any).pullEmbeddingModel(btn, el, el, el, el, el);
            expect(plugin.api.setEmbeddingModel).toHaveBeenCalledWith("nomic/nomic-embed-text");
        });

        it("pullEmbeddingModel handles SSE error with string data", async () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.pullModel = vi.fn().mockReturnValue(
                (async function* () {
                    yield { event: SSE_EVENT.ERROR, data: "raw string error" };
                })(),
            );
            plugin.api.syncStream = vi.fn().mockReturnValue(
                (async function* () {
                    await new Promise(() => {});
                })(),
            );
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).selectedEmbedding = makeEntry({
                name: "nomic-embed-text",
                hf_repo: "nomic/nomic-embed-text",
                task: "embedding",
                installed: false,
            });
            const el = new MockElement("div") as unknown as HTMLElement;
            const btn = new MockElement("button") as unknown as HTMLElement;
            await (wizard as any).pullEmbeddingModel(btn, el, el, el, el, el);
            expect(Notice.instances.some((n) => n.message.includes("Download failed"))).toBe(true);
        });

        it("pullEmbeddingModel handles SSE error event", async () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.pullModel = vi.fn().mockReturnValue(
                (async function* () {
                    yield { event: SSE_EVENT.ERROR, data: { message: "pull failed" } };
                })(),
            );
            plugin.api.syncStream = vi.fn().mockReturnValue(
                (async function* () {
                    await new Promise(() => {});
                })(),
            );
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).selectedEmbedding = makeEntry({
                name: "nomic-embed-text",
                hf_repo: "nomic/nomic-embed-text",
                task: "embedding",
                installed: false,
            });
            const el = new MockElement("div") as unknown as HTMLElement;
            const btn = new MockElement("button") as unknown as HTMLElement;
            await (wizard as any).pullEmbeddingModel(btn, el, el, el, el, el);
            expect(Notice.instances.some((n) => n.message.includes("Download failed"))).toBe(true);
        });

        it("pullEmbeddingModel handles SSE error with empty object", async () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.pullModel = vi.fn().mockReturnValue(
                (async function* () {
                    yield { event: SSE_EVENT.ERROR, data: {} };
                })(),
            );
            plugin.api.syncStream = vi.fn().mockReturnValue(
                (async function* () {
                    await new Promise(() => {});
                })(),
            );
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).selectedEmbedding = makeEntry({
                name: "nomic-embed-text",
                hf_repo: "nomic/nomic-embed-text",
                task: "embedding",
                installed: false,
            });
            const el = new MockElement("div") as unknown as HTMLElement;
            const btn = new MockElement("button") as unknown as HTMLElement;
            await (wizard as any).pullEmbeddingModel(btn, el, el, el, el, el);
            expect(Notice.instances.some((n) => n.message.includes("Download failed"))).toBe(true);
        });

        it("selectEmbedding updates selection on grid", () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            const grid = new MockElement("div") as unknown as HTMLElement;
            const child = (grid as unknown as MockElement).createDiv();
            child.dataset.repo = "nomic/nomic-embed-text";
            const other = (grid as unknown as MockElement).createDiv();
            other.dataset.repo = "bge/bge-small";
            other.classList.add("is-selected");
            const model = makeEntry({ hf_repo: "nomic/nomic-embed-text", task: "embedding" });
            (wizard as any).selectEmbedding(grid, model);
            expect((wizard as any).selectedEmbedding).toBe(model);
            expect(child.classList.contains("is-selected")).toBe(true);
            expect(other.classList.contains("is-selected")).toBe(false);
        });

        it("loadEmbeddingModels reports an empty list and retries", async () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.catalog = vi.fn().mockResolvedValue(ok(makeCatalogResponse([])));
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            const container = new MockElement("div") as unknown as HTMLElement;
            const statusEl = new MockElement("div") as unknown as HTMLElement;
            await (wizard as any).loadEmbeddingModels(container, statusEl);
            expect((statusEl as unknown as MockElement).textContent).toContain("offered no models");

            const entries = [makeEntry({ hf_repo: "nomic-ai/nomic-embed-text-v1.5-GGUF" })];
            plugin.api.catalog = vi.fn().mockResolvedValue(ok(makeCatalogResponse(entries)));
            findButtons(container as unknown as MockElement)
                .find((b) => b.textContent === "Retry")!
                .trigger("click");
            await tick();
            await tick();
            expect((wizard as any).embeddingModels.length).toBe(1);
        });

        it("loadEmbeddingModels retries after an isErr result", async () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.catalog = vi.fn().mockResolvedValue(err(new Error("gateway timeout")));
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            const container = new MockElement("div") as unknown as HTMLElement;
            const statusEl = new MockElement("div") as unknown as HTMLElement;
            await (wizard as any).loadEmbeddingModels(container, statusEl);
            expect((statusEl as unknown as MockElement).textContent).toContain("gateway timeout");

            const entries = [makeEntry({ hf_repo: "nomic-ai/nomic-embed-text-v1.5-GGUF" })];
            plugin.api.catalog = vi.fn().mockResolvedValue(ok(makeCatalogResponse(entries)));
            findButtons(container as unknown as MockElement)
                .find((b) => b.textContent === "Retry")!
                .trigger("click");
            await tick();
            await tick();
            expect((wizard as any).embeddingModels.length).toBe(1);
        });

        it("loadEmbeddingModels handles catalog error", async () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.catalog = vi.fn().mockRejectedValue(new Error("fail"));
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            const container = new MockElement("div") as unknown as HTMLElement;
            const statusEl = new MockElement("div") as unknown as HTMLElement;
            await (wizard as any).loadEmbeddingModels(container, statusEl);
            expect((wizard as any).embeddingModels).toEqual([]);
            // The server's own reason reaches the step, not a generic string.
            expect((statusEl as unknown as MockElement).textContent).toContain("fail");

            const entries = [makeEntry({ hf_repo: "nomic-ai/nomic-embed-text-v1.5-GGUF" })];
            plugin.api.catalog = vi.fn().mockResolvedValue(ok(makeCatalogResponse(entries)));
            findButtons(container as unknown as MockElement)
                .find((b) => b.textContent === "Retry")!
                .trigger("click");
            await tick();
            await tick();
            expect((wizard as any).embeddingModels.length).toBe(1);
        });

        it("loadEmbeddingModels handles catalog isErr result", async () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.catalog = vi.fn().mockResolvedValue(err(new Error("fail")));
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            const container = new MockElement("div") as unknown as HTMLElement;
            const statusEl = new MockElement("div") as unknown as HTMLElement;
            await (wizard as any).loadEmbeddingModels(container, statusEl);
            expect((wizard as any).embeddingModels).toEqual([]);
        });

        it("loadEmbeddingModels renders model cards with onClick that calls selectEmbedding", async () => {
            const entries = [
                makeEntry({ name: "nomic-embed-text", hf_repo: "nomic/nomic-embed-text", task: "embedding" }),
                makeEntry({ name: "bge-small", hf_repo: "bge/bge-small", task: "embedding" }),
            ];
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.catalog = vi.fn().mockResolvedValue(ok(makeCatalogResponse(entries)));
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            const container = new MockElement("div") as unknown as HTMLElement;
            const statusEl = new MockElement("div") as unknown as HTMLElement;

            // Capture onClick callbacks
            const onClicks: Array<() => void> = [];
            const origRenderModelCard = (await import("../../src/components/model-card")).renderModelCard;
            vi.spyOn(await import("../../src/components/model-card"), "renderModelCard").mockImplementation(
                (container, entry, opts) => {
                    if (opts?.onClick) onClicks.push(() => opts.onClick!(entry));
                    return origRenderModelCard(container, entry, opts);
                },
            );
            await (wizard as any).loadEmbeddingModels(container, statusEl);

            // Exercise the onClick
            expect(onClicks.length).toBe(2);
            onClicks[1](); // Click second model
            expect((wizard as any).selectedEmbedding?.name).toBe("bge-small");
        });

        it("loadEmbeddingModels renders model cards and selects nomic default", async () => {
            const entries = [
                makeEntry({ name: "nomic-embed-text", hf_repo: "nomic/nomic-embed-text", task: "embedding" }),
                makeEntry({ name: "bge-small", hf_repo: "bge/bge-small", task: "embedding" }),
            ];
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.catalog = vi.fn().mockResolvedValue(ok(makeCatalogResponse(entries)));
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            const container = new MockElement("div") as unknown as HTMLElement;
            const statusEl = new MockElement("div") as unknown as HTMLElement;
            await (wizard as any).loadEmbeddingModels(container, statusEl);
            expect((wizard as any).selectedEmbedding?.name).toBe("nomic-embed-text");
            expect((wizard as any).embeddingModels.length).toBe(2);
        });

        it("loadEmbeddingModels pre-selects the server's active embedding model", async () => {
            const entries = [
                makeEntry({ hf_repo: "bge/bge-small", display_name: "BGE Small", task: "embedding" }),
                makeEntry({
                    hf_repo: "nomic/nomic-embed-text-v1.5",
                    display_name: "Nomic Embed v1.5",
                    task: "embedding",
                }),
            ];
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.catalog = vi.fn().mockResolvedValue(ok(makeCatalogResponse(entries)));
            plugin.api.listModels = vi.fn().mockResolvedValue({
                chat: { active: "", catalog: [], installed: [] },
                embedding: { active: "nomic/nomic-embed-text-v1.5", catalog: [], installed: [] },
            });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            const container = new MockElement("div") as unknown as HTMLElement;
            const statusEl = new MockElement("div") as unknown as HTMLElement;
            await (wizard as any).loadEmbeddingModels(container, statusEl);
            expect((wizard as any).selectedEmbedding?.hf_repo).toBe("nomic/nomic-embed-text-v1.5");
        });
    });

    describe("back from step 2", () => {
        it("always returns to the SERVER_MODE step so users can switch managed/external", () => {
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
            expect(texts.some((t) => t.includes("How do you want to run lilbee"))).toBe(true);
        });
    });

    describe("sync with FILE_START progress update", () => {
        it("updates progress bar during sync", async () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
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
            (wizard as any).step = 4;
            (wizard as any).renderStep();
            await tick();
            await tick();

            // Should reach wiki step
            const texts = collectTexts(wizard.contentEl as unknown as MockElement);
            expect(texts.some((t) => t.includes("Wiki (optional)"))).toBe(true);
        });
    });

    describe("done screen with processed files count", () => {
        it("shows files processed when sync result has additions", () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
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
            (wizard as any).step = 6;
            (wizard as any).renderStep();

            const el = wizard.contentEl as unknown as MockElement;
            const texts = collectTexts(el);
            expect(texts.some((t) => t.includes("10 files indexed"))).toBe(true);
            expect(texts.some((t) => t.includes("4 files processed"))).toBe(true);
        });

        it("does not show files processed when no additions or updates", () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).syncResult = {
                added: [],
                updated: [],
                removed: [],
                unchanged: 10,
                failed: [],
            };
            (wizard as any).step = 6;
            (wizard as any).renderStep();

            const el = wizard.contentEl as unknown as MockElement;
            const texts = collectTexts(el);
            expect(texts.some((t) => t.includes("10 files indexed"))).toBe(true);
            expect(texts.some((t) => t.includes("files processed"))).toBe(false);
        });
    });

    describe("Flight-deck refresh", () => {
        // The step container gets a semantic data-step attribute that drives
        // per-step CSS (rail color, badge color, progress accent).
        it("tags the step container with its semantic data-step key", async () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.catalog = vi.fn().mockResolvedValue(ok(makeCatalogResponse([])));
            plugin.api.syncStream = vi.fn().mockReturnValue(
                (async function* () {
                    await new Promise(() => {});
                })(),
            );
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();

            const cases: [number, string][] = [
                [0, "welcome"],
                [1, "server"],
                [2, "model"],
                [3, "embedding"],
                [4, "sync"],
                [5, "wiki"],
                [6, "done"],
            ];
            for (const [step, key] of cases) {
                (wizard as any).step = step;
                (wizard as any).renderStep();
                await tick();
                const el = wizard.contentEl as unknown as MockElement;
                const stepEl = el.find("lilbee-wizard-step");
                expect(stepEl).not.toBeNull();
                expect(stepEl!.dataset.step).toBe(key);
            }
        });

        it("renders a step header badge with tabular step number + uppercase label", () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).step = 2;
            (wizard as any).renderStep();

            const el = wizard.contentEl as unknown as MockElement;
            const badge = el.find("lilbee-wizard-step-badge");
            expect(badge).not.toBeNull();
            expect(badge!.textContent).toBe("Step 02 · MODEL");
        });

        it("does not render a step header badge on welcome (no indicator slot)", () => {
            const plugin = makePlugin();
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();

            const el = wizard.contentEl as unknown as MockElement;
            const badge = el.find("lilbee-wizard-step-badge");
            // Welcome IS mapped to an indicator slot? No — welcome isn't in INDICATOR_STEPS.
            // So no badge renders on welcome.
            expect(badge).toBeNull();
        });

        it("adds the hero rail to every rendered step", async () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.catalog = vi.fn().mockResolvedValue(ok(makeCatalogResponse([])));
            plugin.api.syncStream = vi.fn().mockReturnValue(
                (async function* () {
                    await new Promise(() => {});
                })(),
            );
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();

            for (const step of [0, 1, 2, 4, 5, 6]) {
                (wizard as any).step = step;
                (wizard as any).renderStep();
                await tick();
                const el = wizard.contentEl as unknown as MockElement;
                const rail = el.find("lilbee-wizard-rail");
                expect(rail).not.toBeNull();
            }
        });
    });

    describe("progress panel", () => {
        function setupModelPickerActive() {
            const entries = [makeEntry({ name: "qwen/qwen3-0.6B" })];
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.catalog = vi.fn().mockResolvedValue(ok(makeCatalogResponse(entries)));
            // pullModel returns a no-yield async iterator so the method resolves quickly.
            plugin.api.pullModel = vi.fn().mockReturnValue({
                async *[Symbol.asyncIterator]() {
                    /* no events */
                },
            });
            return plugin;
        }

        it("renders the background-processing helper line", async () => {
            const plugin = setupModelPickerActive();
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            wizard.next();
            await tick();

            const el = wizard.contentEl as unknown as MockElement;
            const hint = el.find("lilbee-wizard-progress-hint");
            expect(hint).not.toBeNull();
            expect(hint!.textContent).toBe(MESSAGES.WIZARD_PROGRESS_BACKGROUND);
        });

        it("does not offer a Task Center link inside the wizard", async () => {
            const plugin = setupModelPickerActive();
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            wizard.next();
            await tick();

            const el = wizard.contentEl as unknown as MockElement;
            expect(el.find("lilbee-wizard-task-center-cta")).toBeNull();
        });

        it("activates the hero rail when a pull begins", async () => {
            const plugin = setupModelPickerActive();
            // Block forever so the pull stays in-flight and the rail stays
            // on the currently-rendered step (no advance to the next step).
            plugin.api.pullModel = vi.fn().mockReturnValue({
                async *[Symbol.asyncIterator]() {
                    await new Promise(() => {});
                },
            });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            wizard.next();
            await tick();

            const el = wizard.contentEl as unknown as MockElement;
            const grid = el.find("lilbee-catalog-grid")!;
            const firstCard = grid.children[0];
            // Model-card click handler inspects event.target.tagName.
            firstCard.trigger("click", { target: { tagName: "DIV" } });
            const actions = el.find("lilbee-wizard-actions")!;
            const downloadBtn = actions.children.find(
                (b) => b.tagName === "BUTTON" && b.textContent === MESSAGES.BUTTON_DOWNLOAD_CONTINUE,
            );
            expect(downloadBtn).toBeDefined();
            downloadBtn!.trigger("click");
            // updateProgress runs synchronously before the first for-await
            // yield, so the rail class is set without requiring a tick.

            const rail = el.find("lilbee-wizard-rail");
            expect(rail!.classList.contains("is-active")).toBe(true);
        });

        it("sync step progress fill starts out indeterminate", () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            // Block forever so the sync step stays on screen.
            plugin.api.syncStream = vi.fn().mockReturnValue({
                async *[Symbol.asyncIterator]() {
                    await new Promise(() => {});
                },
            });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).step = 4;
            (wizard as any).renderStep();

            const el = wizard.contentEl as unknown as MockElement;
            const fill = el.find("lilbee-wizard-progress-fill");
            expect(fill).not.toBeNull();
            expect(fill!.classList.contains("lilbee-progress-indeterminate")).toBe(true);
        });

        it("410: managed-server start keeps the progress fill indeterminate until completion", async () => {
            const plugin = makePlugin({ serverManager: null });
            // Hold startManagedServer open so we can inspect the mid-flight state.
            plugin.startManagedServer = vi.fn().mockImplementation(async () => {
                await new Promise(() => {});
            });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            wizard.next();

            const el = wizard.contentEl as unknown as MockElement;
            const nextBtn = findButtons(el).find((b) => b.textContent === "Next")!;
            nextBtn.trigger("click");
            await tick();
            await tick();

            const fill = el.find("lilbee-wizard-progress-fill");
            expect(fill).not.toBeNull();
            expect(fill!.classList.contains("lilbee-progress-indeterminate")).toBe(true);
        });
    });

    describe("Wiki step disclosure", () => {
        it("nests pros and cons inside a <details> tradeoffs element", () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).step = 5;
            (wizard as any).renderStep();

            const el = wizard.contentEl as unknown as MockElement;
            const tradeoffs = el.find("lilbee-wizard-wiki-tradeoffs");
            expect(tradeoffs).not.toBeNull();
            // Both pros and cons sections live inside the disclosure now.
            const sections = tradeoffs!.findAll("lilbee-wizard-wiki-section");
            expect(sections.length).toBe(2);
        });

        it("uses the localised tradeoffs summary label", () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).step = 5;
            (wizard as any).renderStep();

            const el = wizard.contentEl as unknown as MockElement;
            const texts = collectTexts(el);
            expect(texts.some((t) => t === MESSAGES.WIZARD_WIKI_TRADEOFFS_LABEL)).toBe(true);
        });
    });

    describe("uncovered branch coverage", () => {
        it("model picker omits the RAM banner when system memory is unknown", async () => {
            const spy = vi.spyOn(utils, "getSystemMemoryGB").mockReturnValue(null);
            try {
                const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
                plugin.api.catalog = vi.fn().mockResolvedValue(ok(makeCatalogResponse([makeEntry()])));
                const wizard = new SetupWizard(plugin.app as any, plugin as any);
                wizard.open();
                (wizard as any).step = 2;
                (wizard as any).renderStep();
                await tick();
                const el = wizard.contentEl as unknown as MockElement;
                // memGB === null → the RAM info paragraph (656 false branch) is skipped.
                expect(el.find("lilbee-wizard-system-info")).toBeNull();
            } finally {
                spy.mockRestore();
            }
        });

        it("pullSelectedModel ignores SSE events that are neither progress nor error", async () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.pullModel = vi.fn().mockReturnValue(
                (async function* () {
                    yield { event: SSE_EVENT.DONE, data: {} };
                })(),
            );
            plugin.api.setChatModel = vi.fn((m: string) => Promise.resolve(ok({ model: m, reindex_required: false })));
            plugin.api.syncStream = vi.fn().mockReturnValue(
                (async function* () {
                    await new Promise(() => {});
                })(),
            );
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).selectedModel = makeEntry({ hf_repo: "acme/chat", installed: false });
            const el = new MockElement("div") as unknown as HTMLElement;
            const btn = new MockElement("button") as unknown as HTMLElement;
            await (wizard as any).pullSelectedModel(btn, el, el, el, el, el);
            // The non-progress/non-error event (786 false) is skipped; activation still runs.
            expect(plugin.api.setChatModel).toHaveBeenCalledWith("acme/chat");
        });

        it("pullEmbeddingModel ignores SSE events that are neither progress nor error", async () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.pullModel = vi.fn().mockReturnValue(
                (async function* () {
                    yield { event: SSE_EVENT.DONE, data: {} };
                })(),
            );
            plugin.api.setEmbeddingModel = vi.fn((m: string) =>
                Promise.resolve(ok({ model: m, reindex_required: false })),
            );
            plugin.api.syncStream = vi.fn().mockReturnValue(
                (async function* () {
                    await new Promise(() => {});
                })(),
            );
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).selectedEmbedding = makeEntry({
                hf_repo: "acme/embed",
                task: "embedding",
                installed: false,
            });
            const el = new MockElement("div") as unknown as HTMLElement;
            const btn = new MockElement("button") as unknown as HTMLElement;
            await (wizard as any).pullEmbeddingModel(btn, el, el, el, el, el);
            // 952 false branch skipped; activation still runs.
            expect(plugin.api.setEmbeddingModel).toHaveBeenCalledWith("acme/embed");
        });

        it("sync EMBED event without a file name leaves the label unchanged", async () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.syncStream = vi.fn().mockReturnValue(
                (async function* () {
                    yield { event: SSE_EVENT.EMBED, data: {} };
                    yield {
                        event: SSE_EVENT.DONE,
                        data: { added: [], updated: [], removed: [], unchanged: 0, failed: [] },
                    };
                })(),
            );
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).step = 4;
            (wizard as any).renderStep();
            await tick();
            await tick();
            // EMBED with no `file` (1033 false) is a no-op; sync still finishes to wiki.
            const texts = collectTexts(wizard.contentEl as unknown as MockElement);
            expect(texts.some((t) => t.includes("Wiki (optional)"))).toBe(true);
        });

        it("sync that ends without a DONE event still advances and leaves syncResult unset", async () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.syncStream = vi.fn().mockReturnValue(
                (async function* () {
                    yield { event: SSE_EVENT.FILE_START, data: { current_file: 1, total_files: 1 } };
                })(),
            );
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).step = 4;
            (wizard as any).renderStep();
            await tick();
            await tick();
            // lastEvent is FILE_START, not DONE (1045 false) → syncResult stays null.
            expect((wizard as any).syncResult ?? null).toBeNull();
            const texts = collectTexts(wizard.contentEl as unknown as MockElement);
            expect(texts.some((t) => t.includes("Wiki (optional)"))).toBe(true);
        });
    });

    describe("Setup is complete once a server answers", () => {
        it("managed: records setup as complete when the server reaches ready", async () => {
            const plugin = makePlugin({
                serverManager: null,
                settings: { serverMode: "managed", setupCompleted: false },
            });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            wizard.next();

            const el = wizard.contentEl as unknown as MockElement;
            findButtons(el)
                .find((b) => b.textContent === "Next")!
                .trigger("click");
            await tick();
            await tick();

            expect(plugin.settings.setupCompleted).toBe(true);
            expect(plugin.saveSettings).toHaveBeenCalled();
        });

        it("managed: leaves setup incomplete when the server never starts", async () => {
            const plugin = makePlugin({
                serverManager: null,
                settings: { serverMode: "managed", setupCompleted: false },
                ensureManagedConsentThenStart: vi.fn().mockResolvedValue({ kind: "canceled" }),
            });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            wizard.next();

            const el = wizard.contentEl as unknown as MockElement;
            findButtons(el)
                .find((b) => b.textContent === "Next")!
                .trigger("click");
            await tick();
            await tick();

            expect(plugin.settings.setupCompleted).toBe(false);
        });

        it("external: records setup as complete once the server answers", async () => {
            const probe = vi.spyOn(LilbeeClient, "probe").mockResolvedValue(true);
            const plugin = makePlugin({ serverManager: null, settings: { serverMode: "managed" } });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            wizard.next();

            const el = wizard.contentEl as unknown as MockElement;
            el.findAll("lilbee-wizard-model-option")[1].trigger("click");
            findButtons(el)
                .find((b) => b.textContent === "Next")!
                .trigger("click");
            await tick();
            await tick();

            expect(plugin.settings.setupCompleted).toBe(true);
            probe.mockRestore();
        });

        it("skipping after the server is up keeps the plugin configured", async () => {
            const plugin = makePlugin({ serverManager: null, settings: { serverMode: "managed" } });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            wizard.next();

            const el = wizard.contentEl as unknown as MockElement;
            findButtons(el)
                .find((b) => b.textContent === "Next")!
                .trigger("click");
            await tick();
            await tick();
            wizard.skip();

            expect(plugin.settings.setupCompleted).toBe(true);
            expect(Notice.instances.some((n) => n.message === MESSAGES.NOTICE_SETUP_INCOMPLETE)).toBe(false);
        });

        it("records setup when welcome skips the server step on a running managed server", () => {
            const plugin = makePlugin({
                serverManager: { state: "ready" },
                settings: { serverMode: "managed", setupCompleted: false },
            });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();

            wizard.next();

            expect(plugin.settings.setupCompleted).toBe(true);
        });

        it("sends a stored external preference to the server step, not past it", () => {
            const plugin = makePlugin({
                serverManager: null,
                settings: { serverMode: "external", setupCompleted: false },
            });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();

            wizard.next();

            // Until setup completes the plugin has not pointed its client at a
            // server, so the model step could not load anything.
            expect((wizard as any).step).toBe(WIZARD_STEP.SERVER_MODE);
            expect(plugin.settings.setupCompleted).toBe(false);
            expect(plugin.saveSettings).not.toHaveBeenCalled();
        });

        it("re-running setup on a configured vault does not rewrite the flag", async () => {
            const plugin = makePlugin({
                serverManager: null,
                settings: { serverMode: "managed", setupCompleted: true },
            });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            wizard.next();

            const el = wizard.contentEl as unknown as MockElement;
            findButtons(el)
                .find((b) => b.textContent === "Next")!
                .trigger("click");
            await tick();
            await tick();

            expect(plugin.saveSettings).not.toHaveBeenCalled();
            const texts = collectTexts(wizard.contentEl as unknown as MockElement);
            expect(texts.some((t) => t.includes("Pick a chat model"))).toBe(true);
        });

        it("says what an early exit costs when no server was ever chosen", () => {
            const plugin = makePlugin({
                serverManager: null,
                settings: { serverMode: "managed", setupCompleted: false },
            });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();

            wizard.skip();

            expect(plugin.settings.setupCompleted).toBe(false);
            expect(Notice.instances.some((n) => n.message === MESSAGES.NOTICE_SETUP_INCOMPLETE)).toBe(true);
        });
    });

    describe("External mode is checked before it is persisted", () => {
        it("keeps the working configuration when the external server does not answer", async () => {
            const probe = vi.spyOn(LilbeeClient, "probe").mockResolvedValue(false);
            const plugin = makePlugin({ serverManager: null, settings: { serverMode: "managed" } });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            wizard.next();

            const el = wizard.contentEl as unknown as MockElement;
            el.findAll("lilbee-wizard-model-option")[1].trigger("click");
            findButtons(el)
                .find((b) => b.textContent === "Next")!
                .trigger("click");
            await tick();
            await tick();

            expect(plugin.settings.serverMode).toBe("managed");
            expect(plugin.saveSettings).not.toHaveBeenCalled();
            expect(plugin.api.setBaseUrl).not.toHaveBeenCalled();
            const texts = collectTexts(wizard.contentEl as unknown as MockElement);
            expect(texts.some((t) => t.includes("Could not connect"))).toBe(true);
            probe.mockRestore();
        });

        it("probes the typed URL and token, not the stored ones", async () => {
            const probe = vi.spyOn(LilbeeClient, "probe").mockResolvedValue(true);
            const plugin = makePlugin({ serverManager: null, settings: { serverMode: "managed" } });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            wizard.next();

            const el = wizard.contentEl as unknown as MockElement;
            el.findAll("lilbee-wizard-model-option")[1].trigger("click");
            const inputs = el.findAll("lilbee-wizard-url-input");
            inputs[0].value = "http://10.0.0.4:9000";
            inputs[1].value = "tok-abc";
            findButtons(el)
                .find((b) => b.textContent === "Next")!
                .trigger("click");
            await tick();
            await tick();

            expect(probe).toHaveBeenCalledWith("http://10.0.0.4:9000/api/health", expect.any(Number), "tok-abc");
            expect(plugin.settings.serverUrl).toBe("http://10.0.0.4:9000");
            expect(plugin.settings.manualToken).toBe("tok-abc");
            expect(plugin.settings.serverMode).toBe("external");
            probe.mockRestore();
        });
    });

    describe("Retrying a failed catalog load", () => {
        it("gives the primary action back when the retry succeeds", async () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.catalog = vi
                .fn()
                .mockResolvedValueOnce(err(new Error("connection refused")))
                .mockResolvedValue(ok(makeCatalogResponse([makeEntry()])));
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).step = WIZARD_STEP.MODEL_PICKER;
            (wizard as any).renderStep();
            await tick();

            const el = wizard.contentEl as unknown as MockElement;
            const downloadBtn = findButtons(el).find((b) => b.textContent === MESSAGES.BUTTON_DOWNLOAD_CONTINUE)!;
            expect(downloadBtn.disabled).toBe(true);

            findButtons(el)
                .find((b) => b.textContent === MESSAGES.BUTTON_RETRY)!
                .trigger("click");
            await tick();

            expect(downloadBtn.disabled).toBe(false);
        });
    });

    describe("Our picks is curated", () => {
        it("keeps a model the host cannot run for the row to substitute", () => {
            const picks = pickNativeChatModels([
                makeEntry({ hf_repo: "a/huge", display_name: "Huge", fit: "wont_run" }),
                makeEntry({ hf_repo: "a/small", display_name: "Small", fit: "fits" }),
            ]);

            // Ranking does not drop rows. The row replaces them, and keeps them when nothing replaces them.
            expect(picks.map((m) => m.hf_repo)).toEqual(["a/huge", "a/small"]);
        });

        it("keeps a model the server says it cannot load for the row to substitute", () => {
            const picks = pickNativeChatModels([
                makeEntry({ hf_repo: "x/Weird-Arch", display_name: "Weird", compat: "unsupported" }),
                makeEntry({ hf_repo: "Qwen/Qwen3-4B-GGUF", display_name: "Qwen3 4B" }),
            ]);

            expect(picks.map((m) => m.hf_repo)).toEqual(["Qwen/Qwen3-4B-GGUF", "x/Weird-Arch"]);
        });

        it("keeps a model the picks row has no opinion about beyond fit", () => {
            const picks = pickNativeChatModels([
                makeEntry({ hf_repo: "x/Qwen3-27B-Uncensored", display_name: "Qwen3 27B Uncensored", fit: "fits" }),
            ]);

            // Fit is the only rule. Content is not judged by matching names.
            expect(picks.map((m) => m.hf_repo)).toEqual(["x/Qwen3-27B-Uncensored"]);
        });

        it("the row is never empty when the server returned models", async () => {
            // Every criterion fails and the wider catalog cannot answer: the row a substitute cannot replace stands.
            const refused = makeEntry({
                hf_repo: "org/Refused-A",
                display_name: "Refused A",
                fit: "wont_run",
                compat: "unsupported",
            });
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.catalog = vi
                .fn()
                .mockResolvedValueOnce(ok(makeCatalogResponse([refused])))
                .mockResolvedValue(err(new Error("backfill unavailable")));
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).step = WIZARD_STEP.MODEL_PICKER;
            (wizard as any).renderStep();
            await tick();
            await tick();

            expect((wizard as any).featuredModels.map((m: CatalogEntry) => m.hf_repo)).toEqual(["org/Refused-A"]);
            const texts = collectTexts(wizard.contentEl as unknown as MockElement);
            expect(texts.some((t) => t.includes(MESSAGES.WIZARD_NO_MODELS_OFFERED))).toBe(false);
        });

        it("keeps a model whose compat the server has not judged", () => {
            const unknown = makeEntry({ hf_repo: "org/Unjudged-7B", display_name: "Unjudged 7B", fit: "fits" });
            delete (unknown as { compat?: unknown }).compat;
            const unsupported = makeEntry({
                hf_repo: "org/Refused-7B",
                display_name: "Refused 7B",
                fit: "fits",
                compat: "unsupported",
            });

            const picks = pickNativeChatModels([unknown, unsupported]);

            // Ranking keeps every row it was given. What counts as refused is asserted where it is applied,
            // in "substitutes only the row the server refused".
            expect(picks.map((m) => m.hf_repo)).toEqual(["org/Unjudged-7B", "org/Refused-7B"]);
        });

        it("keeps a model whose fit the server did not report", () => {
            const known = makeEntry({ hf_repo: "Qwen/Qwen3-4B-GGUF", display_name: "Qwen3 4B", fit: "fits" });
            const unknown = makeEntry({ hf_repo: "org/Mystery-70B", display_name: "Mystery 70B" });
            delete (unknown as { fit?: unknown }).fit;

            const picks = pickNativeChatModels([unknown, known]);

            // Ranking keeps every row it was given, ordered by family preference. Whether an unreported
            // fit costs a row its place is asserted in "keeps a row whose fit the server did not report".
            expect(picks.map((m) => m.hf_repo)).toEqual(["Qwen/Qwen3-4B-GGUF", "org/Mystery-70B"]);
        });
    });

    describe("The picks row substitutes what will not run", () => {
        function catalogRow(i: number): CatalogEntry {
            return makeEntry({ hf_repo: `org/Other-${i}-GGUF`, display_name: `Other ${i}`, featured: false });
        }

        function splitCatalog(featured: CatalogEntry[], wider: CatalogEntry[] | Error) {
            return vi.fn((params?: { featured?: boolean }) => {
                if (params?.featured) return Promise.resolve(ok(makeCatalogResponse(featured)));
                if (wider instanceof Error) return Promise.resolve(err(wider));
                return Promise.resolve(ok(makeCatalogResponse(wider)));
            });
        }

        async function openPicksStep(catalog: ReturnType<typeof vi.fn>) {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.catalog = catalog;
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            wizard.next();
            await tick();
            return { plugin, el: wizard.contentEl as unknown as MockElement };
        }

        function renderedRepos(el: MockElement): (string | undefined)[] {
            return el.findAll("lilbee-model-card").map((c) => c.dataset.repo);
        }

        function featuredRow(size: number): CatalogEntry[] {
            return Array.from({ length: size }, (_, i) => makeEntry({ hf_repo: `f/${i}`, display_name: `F ${i}` }));
        }

        it("replaces the rows that will not run with the most popular ones that do", async () => {
            const featured = featuredRow(6).concat(
                makeEntry({ hf_repo: "f/huge", display_name: "Huge", fit: "wont_run" }),
                makeEntry({ hf_repo: "f/weird", display_name: "Weird", compat: "unsupported" }),
            );
            const wider = [
                ...featured,
                catalogRow(0),
                makeEntry({ hf_repo: "w/huge", display_name: "Wider huge", fit: "wont_run", featured: false }),
                catalogRow(1),
                catalogRow(2),
            ];

            const { plugin, el } = await openPicksStep(splitCatalog(featured, wider));

            const repos = renderedRepos(el);
            expect(repos.length).toBe(8);
            expect(new Set(repos).size).toBe(8);
            expect(repos).toEqual([...featuredRow(6).map((m) => m.hf_repo), "org/Other-0-GGUF", "org/Other-1-GGUF"]);
            expect(plugin.api.catalog).toHaveBeenCalledTimes(2);
        });

        it("asks only for the featured list when every row runs", async () => {
            const featured = featuredRow(8);

            const { plugin, el } = await openPicksStep(splitCatalog(featured, [catalogRow(0)]));

            expect(renderedRepos(el)).toEqual(featured.map((m) => m.hf_repo));
            expect(plugin.api.catalog).toHaveBeenCalledTimes(1);
        });

        it("asks only for the featured list when the server reported no fits", async () => {
            const featured = featuredRow(3).map((m) => {
                delete (m as { fit?: unknown }).fit;
                return m;
            });

            const { plugin, el } = await openPicksStep(splitCatalog(featured, [catalogRow(0)]));

            // An unknown fit is not a refusal, so there is nothing to replace and nothing to fetch.
            expect(renderedRepos(el)).toEqual(["f/0", "f/1", "f/2"]);
            expect(plugin.api.catalog).toHaveBeenCalledTimes(1);
        });

        it("substitutes only the row the server refused", async () => {
            const unjudged = makeEntry({ hf_repo: "f/unjudged", display_name: "Unjudged", fit: "fits" });
            delete (unjudged as { compat?: unknown }).compat;
            const refused = makeEntry({ hf_repo: "f/huge", display_name: "Huge", fit: "wont_run" });
            const candidate = makeEntry({ hf_repo: "w/unjudged", display_name: "Wider unjudged", featured: false });
            delete (candidate as { compat?: unknown }).compat;

            const { el } = await openPicksStep(splitCatalog([unjudged, refused], [candidate, catalogRow(0)]));

            // An unjudged compat costs a row nothing, on the row itself and on what may replace one.
            expect(renderedRepos(el)).toEqual(["f/unjudged", "w/unjudged"]);
        });

        it("keeps a row whose fit the server did not report", async () => {
            const unreported = makeEntry({ hf_repo: "f/unreported", display_name: "Unreported" });
            delete (unreported as { fit?: unknown }).fit;
            const refused = makeEntry({ hf_repo: "f/huge", display_name: "Huge", fit: "wont_run" });
            const candidate = makeEntry({ hf_repo: "w/unreported", display_name: "Wider unreported", featured: false });
            delete (candidate as { fit?: unknown }).fit;

            const { el } = await openPicksStep(splitCatalog([unreported, refused], [candidate, catalogRow(0)]));

            // An unreported fit costs a row nothing either. Only a reported wont_run is replaced.
            expect(renderedRepos(el)).toEqual(["f/unreported", "w/unreported"]);
        });

        it("does not substitute a frontier model whose key is missing", async () => {
            const featured = featuredRow(1).concat(
                makeEntry({ hf_repo: "f/huge", display_name: "Huge", fit: "wont_run" }),
            );
            const needsKey = makeEntry({
                hf_repo: "openai/gpt-5",
                display_name: "GPT-5",
                source: "frontier",
                provider: "openai",
                key_status: "missing_key",
                featured: false,
                installed: true,
            });
            delete (needsKey as { fit?: unknown }).fit;

            const { el } = await openPicksStep(splitCatalog(featured, [needsKey, catalogRow(0)]));

            // The user cannot use it without a key they have not set, so it is not offered in its place.
            expect(renderedRepos(el)).toEqual(["f/0", "org/Other-0-GGUF"]);
        });

        it("substitutes a hosted model the user can already use", async () => {
            const featured = featuredRow(1).concat(
                makeEntry({ hf_repo: "f/huge", display_name: "Huge", fit: "wont_run" }),
            );
            const ready = makeEntry({
                hf_repo: "ollama/qwen3:4b",
                display_name: "Qwen3 4B",
                source: "ollama",
                provider: "ollama",
                key_status: null,
                featured: false,
                installed: true,
            });
            delete (ready as { fit?: unknown }).fit;

            const { el } = await openPicksStep(splitCatalog(featured, [ready, catalogRow(0)]));

            // A local server needs no key, so hosted rows are not excluded as a class.
            expect(renderedRepos(el)).toEqual(["f/0", "ollama/qwen3:4b"]);
        });

        it("keeps a row it cannot replace when the wider catalog cannot be read", async () => {
            const featured = featuredRow(2).concat(
                makeEntry({ hf_repo: "f/huge", display_name: "Huge", fit: "wont_run" }),
            );

            const { el } = await openPicksStep(splitCatalog(featured, new Error("connection refused")));

            expect(renderedRepos(el)).toEqual(["f/0", "f/1", "f/huge"]);
            expect(findButtons(el).some((b) => b.textContent === MESSAGES.BUTTON_RETRY)).toBe(false);
        });

        it("keeps a row it cannot replace when the wider catalog offers nothing that runs", async () => {
            const featured = featuredRow(2).concat(
                makeEntry({ hf_repo: "f/huge", display_name: "Huge", fit: "wont_run" }),
            );
            const wider = [
                ...featured,
                makeEntry({ hf_repo: "w/huge", display_name: "Wider huge", fit: "wont_run", featured: false }),
            ];

            const { el } = await openPicksStep(splitCatalog(featured, wider));

            expect(renderedRepos(el)).toEqual(["f/0", "f/1", "f/huge"]);
        });
    });

    describe("recommendation skips hosted rows", () => {
        it("never recommends a frontier model with no key over a native installed model", () => {
            const native = makeEntry({
                hf_repo: "janhq/Jan-v3.5-4B-gguf/Jan-v3.5-4B-Q4_K_M.gguf",
                display_name: "Jan v3.5 4B",
                installed: true,
                source: "native",
                min_ram_gb: 6,
            });
            const gemini = makeEntry({
                hf_repo: "gemini-2.0-flash-001",
                display_name: "Gemini 2.0 Flash 001",
                installed: true,
                source: "frontier",
                min_ram_gb: 0,
                key_status: "missing_key",
            });
            const models = [gemini, native];

            const idx = recommendedIndex(models, 32);

            expect(models[idx].hf_repo).toBe("janhq/Jan-v3.5-4B-gguf/Jan-v3.5-4B-Q4_K_M.gguf");
        });

        it("picks the native installed model when a hosted row is the only installed one", () => {
            const native = makeEntry({
                hf_repo: "Qwen/Qwen3-4B-GGUF",
                display_name: "Qwen3 4B",
                installed: false,
                source: "native",
                min_ram_gb: 6,
            });
            const gemini = makeEntry({
                hf_repo: "gemini-2.0-flash-001",
                display_name: "Gemini 2.0 Flash 001",
                installed: true,
                source: "frontier",
                min_ram_gb: 0,
                key_status: "missing_key",
            });
            const models = [native, gemini];

            const idx = recommendedIndex(models, 32);

            // The hosted model must not be recommended; fall back to the largest native that fits.
            expect(models[idx].source).toBe("native");
        });
    });

    describe("An installed chat model is used, not re-downloaded", () => {
        it("sets the model and advances without pulling", async () => {
            const entry = makeEntry({
                hf_repo: "Liquid/LFM2.5-2.6B-GGUF",
                display_name: "LFM2.5 2.6B",
                installed: true,
            });
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.catalog = vi.fn().mockResolvedValue(ok(makeCatalogResponse([entry])));
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).step = WIZARD_STEP.MODEL_PICKER;
            (wizard as any).renderStep();
            await tick();

            const el = wizard.contentEl as unknown as MockElement;
            findButtons(el)
                .find((b) => b.textContent === MESSAGES.BUTTON_USE_CONTINUE)!
                .trigger("click");
            await tick();
            await tick();

            expect(plugin.api.pullModel).not.toHaveBeenCalled();
            expect(plugin.api.setChatModel).toHaveBeenCalledWith("Liquid/LFM2.5-2.6B-GGUF");
            const texts = collectTexts(wizard.contentEl as unknown as MockElement);
            expect(texts.some((t) => t.includes("embedding"))).toBe(true);
        });

        it("keeps the user on the step when the server refuses to set the installed model", async () => {
            const entry = makeEntry({
                hf_repo: "Liquid/LFM2.5-2.6B-GGUF",
                display_name: "LFM2.5 2.6B",
                installed: true,
            });
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.catalog = vi.fn().mockResolvedValue(ok(makeCatalogResponse([entry])));
            plugin.api.setChatModel = vi.fn().mockResolvedValue(err(new Error("model is not loadable")));
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).step = WIZARD_STEP.MODEL_PICKER;
            (wizard as any).renderStep();
            await tick();

            const el = wizard.contentEl as unknown as MockElement;
            const useBtn = findButtons(el).find((b) => b.textContent === MESSAGES.BUTTON_USE_CONTINUE)!;
            useBtn.trigger("click");
            await tick();
            await tick();

            expect(useBtn.disabled).toBe(false);
            const texts = collectTexts(wizard.contentEl as unknown as MockElement);
            expect(texts.some((t) => t.includes("model is not loadable"))).toBe(true);
            expect(Notice.instances.some((n) => n.message.includes("LFM2.5 2.6B"))).toBe(true);
        });

        it("labels the action Download & continue for a model that is not on disk", async () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.catalog = vi.fn().mockResolvedValue(ok(makeCatalogResponse([makeEntry()])));
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).step = WIZARD_STEP.MODEL_PICKER;
            (wizard as any).renderStep();
            await tick();

            const el = wizard.contentEl as unknown as MockElement;
            const labels = findButtons(el).map((b) => b.textContent);
            expect(labels).toContain(MESSAGES.BUTTON_DOWNLOAD_CONTINUE);
            expect(labels).not.toContain(MESSAGES.BUTTON_USE_CONTINUE);
        });

        it("does not paint the recommended card as the server's active model", async () => {
            const entry = makeEntry({
                hf_repo: "Liquid/LFM2.5-2.6B-GGUF",
                display_name: "LFM2.5 2.6B",
                installed: true,
            });
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            plugin.api.catalog = vi.fn().mockResolvedValue(ok(makeCatalogResponse([entry])));
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).step = WIZARD_STEP.MODEL_PICKER;
            (wizard as any).renderStep();
            await tick();

            const el = wizard.contentEl as unknown as MockElement;
            const label = el.find("lilbee-model-card-status-label");
            expect(label?.textContent).toBe(MESSAGES.LABEL_INSTALLED);
        });
    });

    describe("Wiki step", () => {
        it("turns the wiki on for the running plugin, not only on disk", () => {
            const plugin = makePlugin({ settings: { serverMode: "external", wikiEnabled: false } });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();
            (wizard as any).step = WIZARD_STEP.WIKI;
            (wizard as any).renderStep();

            const el = wizard.contentEl as unknown as MockElement;
            el.findAll("lilbee-wizard-model-option")[0].trigger("click");
            findButtons(el)
                .find((b) => b.textContent === "Next")!
                .trigger("click");

            expect(plugin.settings.wikiEnabled).toBe(true);
        });
    });

    describe("Agent picker never covers the wizard", () => {
        it("marks the plugin as showing setup while the wizard is open", () => {
            const plugin = makePlugin({ settings: { serverMode: "external", setupCompleted: true } });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);

            wizard.open();
            expect(plugin.setupWizardOpen).toBe(true);

            wizard.close();
            expect(plugin.setupWizardOpen).toBe(false);
        });

        it("re-offers the pairing it pushed aside once the wizard closes", () => {
            const plugin = makePlugin({
                settings: { serverMode: "external", setupCompleted: true },
                resumeDeferredAgentPicker: vi.fn().mockResolvedValue(undefined),
            });
            const wizard = new SetupWizard(plugin.app as any, plugin as any);
            wizard.open();

            wizard.close();

            expect(plugin.resumeDeferredAgentPicker).toHaveBeenCalled();
        });
    });
});
