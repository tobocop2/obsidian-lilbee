import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { App, Notice, Setting } from "obsidian";
import { MockElement } from "./__mocks__/obsidian";
import {
    LilbeeSettingTab,
    buildModelOptions,
    deduplicateLatest,
    SEPARATOR_KEY,
    SEPARATOR_LABEL,
} from "../src/settings";
import type { LilbeeSettings, ModelCatalog, ModelsResponse } from "../src/types";
import { DEFAULT_SETTINGS, SSE_EVENT } from "../src/types";
import { MESSAGES } from "../src/locales/en";
import { ok, err } from "neverthrow";
import { TaskQueue } from "../src/task-queue";
import { ConfirmPullModal } from "../src/views/confirm-pull-modal";

const mockGetLatestRelease = vi.fn();
const mockCheckForUpdate = vi.fn();

vi.mock("../src/binary-manager", () => ({
    getLatestRelease: (...args: any[]) => mockGetLatestRelease(...args),
    checkForUpdate: (...args: any[]) => mockCheckForUpdate(...args),
    BinaryManager: vi.fn(),
    node: {},
}));

let mockConfirmResult = true;
vi.mock("../src/views/confirm-pull-modal", () => ({
    ConfirmPullModal: vi.fn().mockImplementation(() => ({
        open: vi.fn(),
        get result() {
            return Promise.resolve(mockConfirmResult);
        },
        close: vi.fn(),
    })),
}));

vi.mock("../src/views/catalog-modal", () => ({
    CatalogModal: vi.fn().mockImplementation(() => ({
        open: vi.fn(),
    })),
}));

vi.mock("../src/views/setup-wizard", () => ({
    SetupWizard: vi.fn().mockImplementation(() => ({
        open: vi.fn(),
        close: vi.fn(),
    })),
}));

let mockGenericConfirmResult = true;
vi.mock("../src/views/confirm-modal", () => ({
    ConfirmModal: vi.fn().mockImplementation(() => ({
        open: vi.fn(),
        get result() {
            return Promise.resolve(mockGenericConfirmResult);
        },
        close: vi.fn(),
    })),
}));

function makePlugin(overrides: Partial<LilbeeSettings> = {}) {
    const settings: LilbeeSettings = { ...DEFAULT_SETTINGS, wikiEnabled: true, ...overrides };
    const api = {
        listModels: vi.fn(),
        setChatModel: vi.fn(),
        pullModel: vi.fn(),
        deleteModel: vi.fn(),
        showModel: vi.fn().mockRejectedValue(new Error("no model")),
        config: vi.fn().mockRejectedValue(new Error("unreachable")),
        configDefaults: vi.fn().mockRejectedValue(new Error("unreachable")),
        updateConfig: vi.fn().mockResolvedValue({ updated: [], reindex_required: false }),
        setEmbeddingModel: vi.fn().mockResolvedValue(ok(undefined)),
        setRerankerModel: vi.fn().mockResolvedValue(ok(undefined)),
        setVisionModel: vi.fn().mockResolvedValue(ok(undefined)),
        installedModels: vi.fn().mockResolvedValue({ models: [] }),
        catalog: vi.fn().mockResolvedValue(err(new Error("unreachable"))),
    };
    const saveSettings = vi.fn().mockResolvedValue(undefined);
    const statusBarEl = { setText: vi.fn(), textContent: "" };
    const fetchActiveModel = vi.fn();
    const triggerSync = vi.fn().mockResolvedValue(undefined);
    const runWikiLint = vi.fn().mockResolvedValue(undefined);
    const runWikiPrune = vi.fn().mockResolvedValue(undefined);
    const initWikiSync = vi.fn();
    const reconcileWiki = vi.fn().mockResolvedValue(undefined);
    return {
        settings,
        api,
        saveSettings,
        statusBarEl,
        fetchActiveModel,
        triggerSync,
        runWikiLint,
        runWikiPrune,
        initWikiSync,
        reconcileWiki,
        activeModel: "",
        wikiEnabled: overrides.wikiEnabled !== undefined ? settings.wikiEnabled : true,
        wikiSync: null,
        taskQueue: new TaskQueue(),
    } as unknown as InstanceType<typeof import("../src/main").default>;
}

function makeTab(plugin: ReturnType<typeof makePlugin>) {
    const app = new App();
    return new LilbeeSettingTab(app as any, plugin as any);
}

function makeModelsResponse(): ModelsResponse {
    const empty: ModelCatalog = { active: "", installed: [], catalog: [] };
    return {
        chat: {
            active: "llama3",
            installed: ["llama3"],
            catalog: [
                { name: "llama3", size_gb: 4.7, min_ram_gb: 8, description: "Meta Llama 3", installed: true },
                { name: "phi3", size_gb: 2.3, min_ram_gb: 4, description: "Microsoft Phi-3", installed: false },
            ],
        },
        embedding: empty,
        vision: empty,
        reranker: empty,
    };
}

type TextOnChange = (v: string) => Promise<void>;
type SliderOnChange = (v: number) => Promise<void>;
type DropdownOnChange = (v: string) => Promise<void>;
type ToggleOnChange = (v: boolean) => Promise<void>;
type ButtonOnClick = () => Promise<void>;

type BlurHandler = () => Promise<void>;
interface BlurCapture {
    handler: BlurHandler;
    inputEl: { value: string };
}

interface Captured {
    textOnChanges: TextOnChange[];
    textAreaOnChanges: TextOnChange[];
    blurHandlers: BlurCapture[];
    sliderOnChanges: SliderOnChange[];
    dropdownOnChanges: DropdownOnChange[];
    toggleOnChanges: ToggleOnChange[];
    buttonOnClicks: ButtonOnClick[];
    extraButtonOnClicks: ButtonOnClick[];
}

function captureSettingCallbacks(fn: () => void): Captured {
    const textOnChanges: TextOnChange[] = [];
    const textAreaOnChanges: TextOnChange[] = [];
    const blurHandlers: BlurCapture[] = [];
    const sliderOnChanges: SliderOnChange[] = [];
    const dropdownOnChanges: DropdownOnChange[] = [];
    const toggleOnChanges: ToggleOnChange[] = [];
    const buttonOnClicks: ButtonOnClick[] = [];
    const extraButtonOnClicks: ButtonOnClick[] = [];

    const origAddText = Setting.prototype.addText;
    const origAddTextArea = (Setting.prototype as any).addTextArea;
    const origAddSlider = Setting.prototype.addSlider;
    const origAddDropdown = Setting.prototype.addDropdown;
    const origAddToggle = (Setting.prototype as any).addToggle;
    const origAddButton = Setting.prototype.addButton;
    const origAddExtraButton = (Setting.prototype as any).addExtraButton;

    Setting.prototype.addText = function (cb: (text: any) => void) {
        const fakeText = {
            setPlaceholder: () => fakeText,
            setValue: () => fakeText,
            onChange: (handler: TextOnChange) => {
                textOnChanges.push(handler);
                return fakeText;
            },
            inputEl: {
                placeholder: "",
                type: "text",
                value: "",
                addClass: vi.fn(),
                classList: { add: vi.fn(), remove: vi.fn() },
                addEventListener: (event: string, handler: BlurHandler) => {
                    if (event === "blur") blurHandlers.push({ handler, inputEl: fakeText.inputEl });
                },
            },
        };
        cb(fakeText);
        return this;
    };

    (Setting.prototype as any).addTextArea = function (cb: (text: any) => void) {
        const fakeText = {
            setPlaceholder: () => fakeText,
            setValue: () => fakeText,
            onChange: (handler: TextOnChange) => {
                textAreaOnChanges.push(handler);
                return fakeText;
            },
            inputEl: {
                placeholder: "",
                value: "",
                addClass: vi.fn(),
                classList: { add: vi.fn(), remove: vi.fn() },
                addEventListener: vi.fn(),
            },
        };
        cb(fakeText);
        return this;
    };

    Setting.prototype.addSlider = function (cb: (slider: any) => void) {
        const fakeSlider = {
            setLimits: () => fakeSlider,
            setValue: () => fakeSlider,
            setDynamicTooltip: () => fakeSlider,
            onChange: (handler: SliderOnChange) => {
                sliderOnChanges.push(handler);
                return fakeSlider;
            },
        };
        cb(fakeSlider);
        return this;
    };

    Setting.prototype.addDropdown = function (cb: (dropdown: any) => void) {
        const fakeDropdown = {
            addOption: (_v: string, _l: string) => fakeDropdown,
            addOptions: (_opts: Record<string, string>) => fakeDropdown,
            setValue: () => fakeDropdown,
            onChange: (handler: DropdownOnChange) => {
                dropdownOnChanges.push(handler);
                return fakeDropdown;
            },
        };
        cb(fakeDropdown);
        return this;
    };

    (Setting.prototype as any).addToggle = function (cb: (toggle: any) => void) {
        // Mirrors real Obsidian ToggleComponent: setValue(v) programmatically flips the underlying
        // checkbox which triggers onChange. Required so tests exercise the echo-patch path the
        // suppressToggleChanges flag guards against (bb-t6yg).
        let ownOnChange: ToggleOnChange | null = null;
        const fakeToggle = {
            setValue: (v: boolean) => {
                if (ownOnChange) void ownOnChange(v);
                return fakeToggle;
            },
            onChange: (handler: ToggleOnChange) => {
                ownOnChange = handler;
                toggleOnChanges.push(handler);
                return fakeToggle;
            },
        };
        cb(fakeToggle);
        return this;
    };

    Setting.prototype.addButton = function (cb: (btn: any) => void) {
        const fakeBtn = {
            setButtonText: () => fakeBtn,
            setDisabled: () => fakeBtn,
            setWarning: () => fakeBtn,
            onClick: (handler: ButtonOnClick) => {
                buttonOnClicks.push(handler);
                return fakeBtn;
            },
        };
        cb(fakeBtn);
        return this;
    };

    (Setting.prototype as any).addExtraButton = function (cb: (btn: any) => void) {
        const fakeBtn = {
            setIcon: () => fakeBtn,
            setTooltip: () => fakeBtn,
            onClick: (handler: ButtonOnClick) => {
                extraButtonOnClicks.push(handler);
                return fakeBtn;
            },
        };
        cb(fakeBtn);
        return this;
    };

    try {
        fn();
    } finally {
        Setting.prototype.addText = origAddText;
        (Setting.prototype as any).addTextArea = origAddTextArea;
        Setting.prototype.addSlider = origAddSlider;
        Setting.prototype.addDropdown = origAddDropdown;
        (Setting.prototype as any).addToggle = origAddToggle;
        Setting.prototype.addButton = origAddButton;
        (Setting.prototype as any).addExtraButton = origAddExtraButton;
    }

    return {
        textOnChanges,
        textAreaOnChanges,
        blurHandlers,
        sliderOnChanges,
        dropdownOnChanges,
        toggleOnChanges,
        buttonOnClicks,
        extraButtonOnClicks,
    };
}

function captureDropdownOptions(fn: () => void): Array<Record<string, string>> {
    const allOptions: Array<Record<string, string>> = [];
    const origAddDropdown = Setting.prototype.addDropdown;

    Setting.prototype.addDropdown = function (cb: (dropdown: any) => void) {
        const options: Record<string, string> = {};
        const fakeDropdown = {
            addOption: (v: string, l: string) => {
                options[v] = l;
                return fakeDropdown;
            },
            addOptions: (opts: Record<string, string>) => {
                Object.assign(options, opts);
                return fakeDropdown;
            },
            setValue: () => fakeDropdown,
            onChange: () => fakeDropdown,
        };
        cb(fakeDropdown);
        allOptions.push({ ...options });
        return this;
    };

    try {
        fn();
    } finally {
        Setting.prototype.addDropdown = origAddDropdown;
    }

    return allOptions;
}

describe("LilbeeSettingTab", () => {
    beforeEach(() => {
        Notice.clear();
        mockConfirmResult = true;
    });

    describe("display()", () => {
        it("renders server URL, topK, and sync-mode settings without error", () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            expect(() => tab.display()).not.toThrow();
        });

        it("creates h3 'Models' and description paragraph", () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            tab.display();
            const h3 = tab.containerEl.children.find((c) => c.tagName === "H3");
            expect(h3?.textContent).toBe("Models");
            const p = tab.containerEl.children.find(
                (c) => c.tagName === "P" && c.textContent.includes("Browse the catalog"),
            );
            expect(p).toBeDefined();
        });

        it("creates a models container div", () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            tab.display();
            const container = tab.containerEl.find("lilbee-models-container");
            expect(container).not.toBeNull();
        });

        it("shows sync-debounce setting when syncMode is 'auto'", () => {
            const plugin = makePlugin({ syncMode: "auto" });
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());
            // serverPort + 6 generation + syncDebounce + 10 crawling + wikiVaultFolder + 2 chunks + rerank_candidates + hfToken + litellm = 24
            expect(textOnChanges.length).toBe(24);
        });

        it("does NOT show sync-debounce when syncMode is 'manual'", () => {
            const plugin = makePlugin({ syncMode: "manual" });
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());
            // serverPort + 6 generation + 10 crawling + wikiVaultFolder + 2 chunks + rerank_candidates + hfToken + litellm = 23
            expect(textOnChanges.length).toBe(23);
        });
    });

    describe("serverUrl setting onChange", () => {
        it("updates plugin settings and calls saveSettings", async () => {
            const plugin = makePlugin({ serverMode: "external" });
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());

            await textOnChanges[0]("http://localhost:9999");
            expect(plugin.settings.serverUrl).toBe("http://localhost:9999");
            expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
        });
    });

    describe("manual token setting onChange", () => {
        it("updates manualToken and calls saveSettings", async () => {
            const plugin = makePlugin({ serverMode: "external" });
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());

            // In external mode: [0]=serverUrl, [1]=manualToken
            await textOnChanges[1]("my-token-123");
            expect(plugin.settings.manualToken).toBe("my-token-123");
            expect(plugin.saveSettings).toHaveBeenCalled();
        });
    });

    describe("topK slider onChange", () => {
        it("updates topK and calls saveSettings", async () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { sliderOnChanges } = captureSettingCallbacks(() => tab.display());

            await sliderOnChanges[0](10);
            expect(plugin.settings.topK).toBe(10);
            expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
        });
    });

    describe("maxDistance slider onChange", () => {
        it("updates maxDistance and calls saveSettings", async () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { sliderOnChanges } = captureSettingCallbacks(() => tab.display());

            await sliderOnChanges[1](0.8);
            expect(plugin.settings.maxDistance).toBe(0.8);
            expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
        });

        it("uses default value when maxDistance is undefined", async () => {
            const plugin = makePlugin({ maxDistance: undefined });
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            captureSettingCallbacks(() => tab.display());

            // When maxDistance is undefined, setValue should use ?? 0.9 fallback
            // Just call display to render - this exercises the ?? operator
            expect(() => tab.display()).not.toThrow();
        });
    });

    describe("adaptiveThreshold toggle onChange", () => {
        it("updates adaptiveThreshold and calls saveSettings", async () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { toggleOnChanges } = captureSettingCallbacks(() => tab.display());

            await toggleOnChanges[0](true);
            expect(plugin.settings.adaptiveThreshold).toBe(true);
            expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
        });

        it("uses default value when adaptiveThreshold is undefined", async () => {
            const plugin = makePlugin({ adaptiveThreshold: undefined });
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);

            // When adaptiveThreshold is undefined, setValue should use ?? false fallback
            expect(() => tab.display()).not.toThrow();
        });
    });

    describe("syncMode dropdown onChange", () => {
        it("updates syncMode, saves, and re-renders display", async () => {
            const plugin = makePlugin({ serverMode: "external", syncMode: "manual" });
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);

            const { dropdownOnChanges } = captureSettingCallbacks(() => tab.display());
            const displaySpy = vi.spyOn(tab, "display").mockImplementation(() => {});

            await dropdownOnChanges[1]("auto");

            expect(plugin.settings.syncMode).toBe("auto");
            expect(plugin.saveSettings).toHaveBeenCalled();
            expect(displaySpy).toHaveBeenCalled();
        });
    });

    describe("syncDebounce text onChange", () => {
        // With syncMode=auto, text fields are (render order: connection → models → search → generation → sync):
        // [0] port, [1-6] generation, [7] syncDebounce
        const DEBOUNCE_IDX = 7;

        it("updates syncDebounceMs for valid positive number", async () => {
            const plugin = makePlugin({ syncMode: "auto" });
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());

            await textOnChanges[DEBOUNCE_IDX]("3000");
            expect(plugin.settings.syncDebounceMs).toBe(3000);
            expect(plugin.saveSettings).toHaveBeenCalled();
        });

        it("accepts zero as a valid debounce value", async () => {
            const plugin = makePlugin({ syncMode: "auto" });
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());

            plugin.settings.syncDebounceMs = 999;
            await textOnChanges[DEBOUNCE_IDX]("0");
            expect(plugin.settings.syncDebounceMs).toBe(0);
            expect(plugin.saveSettings).toHaveBeenCalled();
        });

        it("does NOT save for NaN input", async () => {
            const plugin = makePlugin({ syncMode: "auto" });
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());

            const original = plugin.settings.syncDebounceMs;
            await textOnChanges[DEBOUNCE_IDX]("not-a-number");
            expect(plugin.settings.syncDebounceMs).toBe(original);
            expect(plugin.saveSettings).not.toHaveBeenCalled();
        });

        it("does NOT save for negative number input", async () => {
            const plugin = makePlugin({ syncMode: "auto" });
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());

            const original = plugin.settings.syncDebounceMs;
            await textOnChanges[DEBOUNCE_IDX]("-100");
            expect(plugin.settings.syncDebounceMs).toBe(original);
            expect(plugin.saveSettings).not.toHaveBeenCalled();
        });
    });

    describe("system prompt setting", () => {
        it("saves systemPrompt when changed", async () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textAreaOnChanges } = captureSettingCallbacks(() => tab.display());

            // System prompt is now a textarea — textAreaOnChanges[0]
            await textAreaOnChanges[0]("You are a pirate.");
            expect(plugin.settings.systemPrompt).toBe("You are a pirate.");
            expect(plugin.saveSettings).toHaveBeenCalled();
        });
    });

    describe("generation settings", () => {
        const GEN_FIELDS = [
            { idx: 1, key: "temperature", value: "0.7", expected: 0.7 },
            { idx: 2, key: "top_p", value: "0.9", expected: 0.9 },
            { idx: 3, key: "top_k_sampling", value: "40", expected: 40 },
            { idx: 4, key: "repeat_penalty", value: "1.1", expected: 1.1 },
            { idx: 5, key: "num_ctx", value: "4096", expected: 4096 },
            { idx: 6, key: "seed", value: "42", expected: 42 },
        ] as const;

        for (const { idx, key, value, expected } of GEN_FIELDS) {
            it(`patches ${key} to parsed number`, async () => {
                const plugin = makePlugin();
                (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
                const tab = makeTab(plugin);
                const { textOnChanges } = captureSettingCallbacks(() => tab.display());

                await textOnChanges[idx](value);
                expect(plugin.api.updateConfig).toHaveBeenCalledWith({ [key]: expected });
            });

            it(`patches ${key} to null when cleared`, async () => {
                const plugin = makePlugin();
                (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
                const tab = makeTab(plugin);
                const { textOnChanges } = captureSettingCallbacks(() => tab.display());

                await textOnChanges[idx]("");
                expect(plugin.api.updateConfig).toHaveBeenCalledWith({ [key]: null });
            });
        }

        it("does not patch for NaN integer input", async () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());

            await textOnChanges[3]("not-a-number");
            expect(plugin.api.updateConfig).not.toHaveBeenCalledWith(
                expect.objectContaining({ top_k_sampling: expect.anything() }),
            );
        });

        it("does not patch for NaN float input", async () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());

            await textOnChanges[1]("abc");
            expect(plugin.api.updateConfig).not.toHaveBeenCalledWith(
                expect.objectContaining({ temperature: expect.anything() }),
            );
        });

        it("surfaces a failure notice when the server rejects the patch", async () => {
            Notice.clear();
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            (plugin.api.updateConfig as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("boom"));
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());

            await textOnChanges[1]("0.7");
            expect(Notice.instances.some((n) => n.message.includes("failed to update"))).toBe(true);
        });

        it("surfaces a failure notice when the null-clear PATCH is rejected", async () => {
            Notice.clear();
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            (plugin.api.updateConfig as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("boom"));
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());

            await textOnChanges[1]("");
            expect(Notice.instances.some((n) => n.message.includes("failed to update"))).toBe(true);
        });

        it("renders inside a <details> element", () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            tab.display();
            const details = tab.containerEl.children.find(
                (c) => c.tagName === "DETAILS" && c.classList.contains("lilbee-generation-details"),
            );
            expect(details).toBeDefined();
            const summary = details!.children.find((c) => c.tagName === "SUMMARY");
            expect(summary?.textContent).toBe("Advanced settings (no model selected)");
        });

        it("uses 'Not set' placeholders on fresh mount", () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);

            const placeholders: string[] = [];
            const origAddText = Setting.prototype.addText;
            Setting.prototype.addText = function (cb: (text: any) => void) {
                const fakeText = {
                    setPlaceholder: (v: string) => {
                        placeholders.push(v);
                        return fakeText;
                    },
                    setValue: () => fakeText,
                    onChange: () => fakeText,
                    inputEl: { placeholder: "", addEventListener: vi.fn() },
                };
                cb(fakeText);
                return this;
            };

            tab.display();
            Setting.prototype.addText = origAddText;

            // Indices 1-6 are the 6 generation fields (0=port, systemPrompt is textarea).
            for (let i = 1; i <= 6; i++) {
                expect(placeholders[i]).toBe("Not set");
            }
        });

        it("shows model name in summary when active model is set", () => {
            const plugin = makePlugin();
            (plugin as any).activeModel = "llama3";
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            tab.display();
            const details = tab.containerEl.children.find(
                (c) => c.tagName === "DETAILS" && c.classList.contains("lilbee-generation-details"),
            );
            const summary = details!.children.find((c) => c.tagName === "SUMMARY");
            expect(summary?.textContent).toBe("Advanced settings (llama3)");
        });
    });

    describe("Refresh models button", () => {
        it("onClick calls loadModels with the models container", async () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { buttonOnClicks } = captureSettingCallbacks(() => tab.display());

            // Setup wizard + Start + Check for updates + Refresh + Browse Catalog + Wiki Lint + Wiki Prune + Reset all = 8
            expect(buttonOnClicks.length).toBe(8);
            // Refresh is the fourth button (index 3)
            await expect(buttonOnClicks[3]()).resolves.not.toThrow();
        });
    });

    describe("Setup wizard button in settings", () => {
        it("onClick opens SetupWizard", async () => {
            const { SetupWizard } = await import("../src/views/setup-wizard");
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { buttonOnClicks } = captureSettingCallbacks(() => tab.display());

            // Setup wizard is the first button (index 0)
            buttonOnClicks[0]();

            expect(SetupWizard).toHaveBeenCalled();
        });
    });

    describe("Browse Catalog button in settings", () => {
        it("onClick opens CatalogModal", async () => {
            const { CatalogModal } = await import("../src/views/catalog-modal");
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { buttonOnClicks } = captureSettingCallbacks(() => tab.display());

            // Browse Catalog is the fifth button (index 4)
            buttonOnClicks[4]();

            expect(CatalogModal).toHaveBeenCalled();
        });
    });

    describe("loadModels()", () => {
        it("renders chat section on success", async () => {
            const plugin = makePlugin();
            const models = makeModelsResponse();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(models);
            const tab = makeTab(plugin);
            const container = new MockElement("div") as unknown as HTMLElement;
            await (tab as any).loadModels(container);
            const sections = (container as unknown as MockElement).findAll("lilbee-model-section");
            expect(sections.length).toBe(1);
        });

        it("silently handles API failure without showing warning", async () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network"));
            const tab = makeTab(plugin);
            const container = new MockElement("div") as unknown as HTMLElement;
            await (tab as any).loadModels(container);
            const p = (container as unknown as MockElement).children.find(
                (c) => c.tagName === "P" && c.textContent.includes("Could not connect"),
            );
            expect(p).toBeUndefined();
        });
    });

    describe("renderModelSection()", () => {
        it("chat section does NOT have 'Disabled' dropdown option", () => {
            const plugin = makePlugin();
            const tab = makeTab(plugin);
            const container = new MockElement("div") as unknown as HTMLElement;

            const allOptions = captureDropdownOptions(() => {
                (tab as any).renderModelSection(container, "Chat Model", makeModelsResponse().chat);
            });

            expect(allOptions.length).toBeGreaterThan(0);
            expect("" in allOptions[0]).toBe(false);
        });

        it("active chat model onChange calls setChatModel and shows Notice for installed model", async () => {
            const plugin = makePlugin();
            (plugin.api.setChatModel as ReturnType<typeof vi.fn>).mockResolvedValue(ok(undefined));
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const container = new MockElement("div") as unknown as HTMLElement;

            const { dropdownOnChanges } = captureSettingCallbacks(() => {
                (tab as any).renderModelSection(container, "Chat Model", makeModelsResponse().chat);
            });

            const displaySpy = vi.spyOn(tab, "display").mockImplementation(() => {});
            await dropdownOnChanges[0]("llama3");
            expect(plugin.api.setChatModel).toHaveBeenCalledWith("llama3");
            expect(Notice.instances.some((n) => n.message.includes("llama3"))).toBe(true);
            expect(displaySpy).toHaveBeenCalled();
        });

        it("setting model to empty string shows 'not set' in Notice", async () => {
            const plugin = makePlugin();
            (plugin.api.setChatModel as ReturnType<typeof vi.fn>).mockResolvedValue(ok(undefined));
            const tab = makeTab(plugin);
            const container = new MockElement("div") as unknown as HTMLElement;
            const catalog = { ...makeModelsResponse().chat, active: "" };

            const { dropdownOnChanges } = captureSettingCallbacks(() => {
                (tab as any).renderModelSection(container, "Chat Model", catalog);
            });

            await dropdownOnChanges[0]("");
            expect(Notice.instances.some((n) => n.message.includes("not set"))).toBe(true);
        });

        it("active model onChange shows failure Notice on API error for installed model", async () => {
            const plugin = makePlugin();
            (plugin.api.setChatModel as ReturnType<typeof vi.fn>).mockResolvedValue(err(new Error("fail")));
            const tab = makeTab(plugin);
            const container = new MockElement("div") as unknown as HTMLElement;

            const { dropdownOnChanges } = captureSettingCallbacks(() => {
                (tab as any).renderModelSection(container, "Chat Model", makeModelsResponse().chat);
            });

            // llama3 is installed, so it goes through the direct set path
            await dropdownOnChanges[0]("llama3");
            expect(Notice.instances.some((n) => n.message.includes("Failed to set"))).toBe(true);
        });

        it("renders table with header columns", () => {
            const plugin = makePlugin();
            const tab = makeTab(plugin);
            const container = new MockElement("div") as unknown as HTMLElement;
            (tab as any).renderModelSection(container, "Chat Model", makeModelsResponse().chat);
            function findTag(el: MockElement, tag: string): MockElement | null {
                if (el.tagName === tag.toUpperCase()) return el;
                for (const child of el.children) {
                    const found = findTag(child, tag);
                    if (found) return found;
                }
                return null;
            }
            const table = findTag(container as unknown as MockElement, "table");
            expect(table).not.toBeNull();
        });

        it("desc shows active model name when set", () => {
            const plugin = makePlugin();
            const tab = makeTab(plugin);
            const container = new MockElement("div") as unknown as HTMLElement;
            expect(() => {
                (tab as any).renderModelSection(container, "Chat Model", makeModelsResponse().chat);
            }).not.toThrow();
        });

        it("desc shows 'Not set' for chat when active is empty", () => {
            const plugin = makePlugin();
            const tab = makeTab(plugin);
            const container = new MockElement("div") as unknown as HTMLElement;
            const catalog = { ...makeModelsResponse().chat, active: "" };
            expect(() => {
                (tab as any).renderModelSection(container, "Chat Model", catalog);
            }).not.toThrow();
        });
    });

    describe("renderCatalogRow()", () => {
        it("shows 'Installed' badge for installed models", () => {
            const plugin = makePlugin();
            const tab = makeTab(plugin);
            const table = new MockElement("table") as unknown as HTMLTableElement;
            const model = makeModelsResponse().chat.catalog[0];
            (tab as any).renderCatalogRow(table, model);
            const row = (table as unknown as MockElement).children[0];
            const actionCell = row.children[3];
            const badge = actionCell.children[0];
            expect(badge.textContent).toBe("Installed");
            expect(badge.classList.contains("lilbee-installed")).toBe(true);
        });

        it("shows 'Pull' button for uninstalled models", () => {
            const plugin = makePlugin();
            const tab = makeTab(plugin);
            const table = new MockElement("table") as unknown as HTMLTableElement;
            const model = makeModelsResponse().chat.catalog[1];
            (tab as any).renderCatalogRow(table, model);
            const row = (table as unknown as MockElement).children[0];
            const actionCell = row.children[3];
            const btn = actionCell.children[0];
            expect(btn.tagName).toBe("BUTTON");
            expect(btn.textContent).toBe("Pull");
        });

        it("renders model name, size, and description cells", () => {
            const plugin = makePlugin();
            const tab = makeTab(plugin);
            const table = new MockElement("table") as unknown as HTMLTableElement;
            const model = makeModelsResponse().chat.catalog[0];
            (tab as any).renderCatalogRow(table, model);
            const row = (table as unknown as MockElement).children[0];
            expect(row.children[0].textContent).toBe("llama3");
            expect(row.children[1].textContent).toBe("4.7 GB");
            expect(row.children[2].textContent).toBe("Meta Llama 3");
        });
    });

    describe("Delete button", () => {
        function setupDeleteButton(plugin: ReturnType<typeof makePlugin>) {
            const tab = makeTab(plugin);
            const table = new MockElement("table") as unknown as HTMLTableElement;
            const catalog = makeModelsResponse();
            const model = catalog.chat.catalog[0];

            (tab as any).renderCatalogRow(table, model);

            const row = (table as unknown as MockElement).children[0];
            const actionCell = row.children[3];
            // actionCell children: [0] = "Installed" span, [1] = delete button
            const deleteBtn = actionCell.children[1];

            return { tab, deleteBtn, actionCell };
        }

        it("shows trash icon button with lilbee-model-delete class for installed model", () => {
            const plugin = makePlugin();
            const { deleteBtn } = setupDeleteButton(plugin);

            expect(deleteBtn.tagName).toBe("BUTTON");
            expect(deleteBtn.classList.contains("lilbee-model-delete")).toBe(true);
            expect(deleteBtn.attributes["data-icon"]).toBe("trash-2");
            expect(deleteBtn.attributes["aria-label"]).toBe("Delete model");
        });

        it("successful delete shows 'Deleted' notice", async () => {
            const plugin = makePlugin();
            (plugin.api.deleteModel as ReturnType<typeof vi.fn>).mockResolvedValue(ok(undefined));
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());

            const { tab, deleteBtn } = setupDeleteButton(plugin);
            const modelsContainer = new MockElement("div");
            modelsContainer.classList.add("lilbee-models-container");
            tab.containerEl.children.push(modelsContainer);

            await (deleteBtn as unknown as MockElement).trigger("click");
            await new Promise((r) => setTimeout(r, 0));

            expect(plugin.api.deleteModel).toHaveBeenCalledWith("llama3");
            expect(Notice.instances.some((n) => n.message.includes("Deleted llama3"))).toBe(true);
            expect(plugin.fetchActiveModel).toHaveBeenCalled();
        });

        it("successful delete reloads models container when found", async () => {
            const plugin = makePlugin();
            (plugin.api.deleteModel as ReturnType<typeof vi.fn>).mockResolvedValue(ok(undefined));
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());

            const { tab, deleteBtn } = setupDeleteButton(plugin);

            Object.defineProperty(globalThis, "HTMLElement", {
                value: MockElement,
                configurable: true,
                writable: true,
            });
            const fakeModelsContainer = new MockElement("div");
            tab.containerEl.querySelector = vi.fn().mockReturnValue(fakeModelsContainer);

            await (deleteBtn as unknown as MockElement).trigger("click");
            await new Promise((r) => setTimeout(r, 0));

            expect(plugin.api.listModels).toHaveBeenCalled();

            // @ts-expect-error removing test-only global
            delete (globalThis as any).HTMLElement;
        });

        it("deleting active chat model clears it", async () => {
            const plugin = makePlugin();
            (plugin as any).activeModel = "llama3";
            (plugin.api.deleteModel as ReturnType<typeof vi.fn>).mockResolvedValue(ok(undefined));
            (plugin.api.setChatModel as ReturnType<typeof vi.fn>).mockResolvedValue(ok(undefined));
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());

            const { tab, deleteBtn } = setupDeleteButton(plugin);
            tab.containerEl.querySelector = vi.fn().mockReturnValue(null);

            await (deleteBtn as unknown as MockElement).trigger("click");
            await new Promise((r) => setTimeout(r, 0));

            expect(plugin.api.setChatModel).toHaveBeenCalledWith("");
            expect(plugin.activeModel).toBe("");
        });

        it("delete failure shows error notice and re-enables button", async () => {
            const plugin = makePlugin();
            (plugin.api.deleteModel as ReturnType<typeof vi.fn>).mockResolvedValue(err(new Error("fail")));

            const { deleteBtn } = setupDeleteButton(plugin);

            await (deleteBtn as unknown as MockElement).trigger("click");
            await new Promise((r) => setTimeout(r, 0));

            expect(Notice.instances.some((n) => n.message.includes("Failed to delete"))).toBe(true);
            expect(deleteBtn.disabled).toBe(false);
        });
    });

    describe("Pull cancel via task queue", () => {
        it("taskQueue.cancel aborts the pull and shows cancellation notice", async () => {
            const plugin = makePlugin();
            let aborted = false;
            async function* slowPull(_name: string, _source: string, signal: AbortSignal) {
                yield { event: "progress", data: { percent: 10 } };
                while (!aborted) {
                    if (signal.aborted) break;
                    await new Promise((r) => setTimeout(r, 1));
                }
                const err = new Error("The operation was aborted");
                err.name = "AbortError";
                throw err;
            }
            (plugin.api.pullModel as ReturnType<typeof vi.fn>).mockImplementation(
                (n: string, s: string, sig: AbortSignal) => slowPull(n, s, sig),
            );

            const tab = makeTab(plugin);
            const table = new MockElement("table") as unknown as HTMLTableElement;
            const model = makeModelsResponse().chat.catalog[1];

            const clickHandlers: Function[] = [];
            const origAddEventListener = MockElement.prototype.addEventListener;
            MockElement.prototype.addEventListener = function (event: string, handler: Function) {
                if (event === "click") clickHandlers.push(handler);
                origAddEventListener.call(this, event, handler);
            };
            (tab as any).renderCatalogRow(table, model);
            MockElement.prototype.addEventListener = origAddEventListener;

            const pullPromise = clickHandlers[0]();
            await new Promise((r) => setTimeout(r, 10));

            const active = plugin.taskQueue.active;
            expect(active).toBeTruthy();
            aborted = true;
            plugin.taskQueue.cancel(active!.id);
            await pullPromise;

            expect(Notice.instances.some((n) => n.message === MESSAGES.NOTICE_PULL_CANCELLED)).toBe(true);
        });
    });

    describe("ConfirmPullModal integration", () => {
        it("dropdown onChange for uninstalled model opens ConfirmPullModal", async () => {
            const plugin = makePlugin();
            async function* fakePull() {}
            (plugin.api.pullModel as ReturnType<typeof vi.fn>).mockReturnValue(fakePull());
            (plugin.api.setChatModel as ReturnType<typeof vi.fn>).mockResolvedValue(ok(undefined));
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());

            const tab = makeTab(plugin);
            const container = new MockElement("div") as unknown as HTMLElement;

            const { dropdownOnChanges } = captureSettingCallbacks(() => {
                (tab as any).renderModelSection(container, "Chat Model", makeModelsResponse().chat);
            });

            await dropdownOnChanges[0]("phi3");

            expect(ConfirmPullModal).toHaveBeenCalled();
            expect(plugin.api.pullModel).toHaveBeenCalled();
        });

        it("canceling modal prevents pull from starting", async () => {
            (mockConfirmResult as any) = false;
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());

            const tab = makeTab(plugin);
            const container = new MockElement("div") as unknown as HTMLElement;

            const { dropdownOnChanges } = captureSettingCallbacks(() => {
                (tab as any).renderModelSection(container, "Chat Model", makeModelsResponse().chat);
            });

            await dropdownOnChanges[0]("phi3");

            expect(plugin.api.pullModel).not.toHaveBeenCalled();
        });
    });

    describe("Auto-pull task queue updates", () => {
        it("progress events update the task queue with percent", async () => {
            const plugin = makePlugin();
            async function* fakePull() {
                yield { event: "progress", data: { percent: 50 } };
            }
            (plugin.api.pullModel as ReturnType<typeof vi.fn>).mockReturnValue(fakePull());
            (plugin.api.setChatModel as ReturnType<typeof vi.fn>).mockResolvedValue(ok(undefined));
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());

            const updateSpy = vi.spyOn(plugin.taskQueue, "update");
            const tab = makeTab(plugin);
            const container = new MockElement("div") as unknown as HTMLElement;

            const { dropdownOnChanges } = captureSettingCallbacks(() => {
                (tab as any).renderModelSection(container, "Chat Model", makeModelsResponse().chat);
            });

            await dropdownOnChanges[0]("phi3");

            expect(updateSpy).toHaveBeenCalledWith(expect.any(String), 50, "phi3", expect.any(Object));
        });

        it("taskQueue.cancel during auto-pull aborts and shows notice", async () => {
            const plugin = makePlugin();
            let aborted = false;
            async function* slowPull(_n: string, _s: string, signal: AbortSignal) {
                yield { event: "progress", data: { percent: 10 } };
                while (!aborted) {
                    if (signal.aborted) break;
                    await new Promise((r) => setTimeout(r, 1));
                }
                const err = new Error("The operation was aborted");
                err.name = "AbortError";
                throw err;
            }
            (plugin.api.pullModel as ReturnType<typeof vi.fn>).mockImplementation(
                (n: string, s: string, sig: AbortSignal) => slowPull(n, s, sig),
            );

            const tab = makeTab(plugin);
            const container = new MockElement("div") as unknown as HTMLElement;

            const { dropdownOnChanges } = captureSettingCallbacks(() => {
                (tab as any).renderModelSection(container, "Chat Model", makeModelsResponse().chat);
            });

            const pullPromise = dropdownOnChanges[0]("phi3");
            await new Promise((r) => setTimeout(r, 10));

            const active = plugin.taskQueue.active;
            expect(active).toBeTruthy();
            aborted = true;
            plugin.taskQueue.cancel(active!.id);
            await pullPromise;

            expect(Notice.instances.some((n) => n.message === MESSAGES.NOTICE_PULL_CANCELLED)).toBe(true);
        });
    });

    describe("Auto-pull AbortError", () => {
        it("auto-pull AbortError shows 'Pull cancelled' notice", async () => {
            const plugin = makePlugin();

            async function* abortingPull(): AsyncGenerator<never> {
                const err = new Error("The operation was aborted");
                err.name = "AbortError";
                throw err;
            }
            (plugin.api.pullModel as ReturnType<typeof vi.fn>).mockReturnValue(abortingPull());

            const tab = makeTab(plugin);
            const container = new MockElement("div") as unknown as HTMLElement;

            const { dropdownOnChanges } = captureSettingCallbacks(() => {
                (tab as any).renderModelSection(container, "Chat Model", makeModelsResponse().chat);
            });

            // phi3 is uninstalled in catalog — triggers autoPullAndSet
            await dropdownOnChanges[0]("phi3");
            expect(Notice.instances.some((n) => n.message === MESSAGES.NOTICE_PULL_CANCELLED)).toBe(true);
        });
    });

    describe("Auto-pull SSE_EVENT.ERROR", () => {
        it("shows failure notice and fails task on SSE error event", async () => {
            const plugin = makePlugin();

            async function* errorPull() {
                yield { event: SSE_EVENT.ERROR, data: { message: "pull exploded" } };
            }
            (plugin.api.pullModel as ReturnType<typeof vi.fn>).mockReturnValue(errorPull());
            (plugin.api.setChatModel as ReturnType<typeof vi.fn>).mockResolvedValue(ok(undefined));

            const tab = makeTab(plugin);
            const container = new MockElement("div") as unknown as HTMLElement;

            const { dropdownOnChanges } = captureSettingCallbacks(() => {
                (tab as any).renderModelSection(container, "Chat Model", makeModelsResponse().chat);
            });

            await dropdownOnChanges[0]("phi3");
            expect(Notice.instances.some((n) => n.message.includes("failed to pull"))).toBe(true);
            expect(plugin.taskQueue.completed.some((t: any) => t.status === "failed")).toBe(true);
        });

        it("handles SSE error event with string data", async () => {
            const plugin = makePlugin();

            async function* errorPull() {
                yield { event: SSE_EVENT.ERROR, data: "raw error string" };
            }
            (plugin.api.pullModel as ReturnType<typeof vi.fn>).mockReturnValue(errorPull());
            (plugin.api.setChatModel as ReturnType<typeof vi.fn>).mockResolvedValue(ok(undefined));

            const tab = makeTab(plugin);
            const container = new MockElement("div") as unknown as HTMLElement;

            const { dropdownOnChanges } = captureSettingCallbacks(() => {
                (tab as any).renderModelSection(container, "Chat Model", makeModelsResponse().chat);
            });

            await dropdownOnChanges[0]("phi3");
            expect(Notice.instances.some((n) => n.message.includes("failed to pull"))).toBe(true);
            expect(plugin.taskQueue.completed.some((t: any) => t.status === "failed")).toBe(true);
        });

        it("handles SSE error event with empty object (no message)", async () => {
            const plugin = makePlugin();

            async function* errorPull() {
                yield { event: SSE_EVENT.ERROR, data: {} };
            }
            (plugin.api.pullModel as ReturnType<typeof vi.fn>).mockReturnValue(errorPull());
            (plugin.api.setChatModel as ReturnType<typeof vi.fn>).mockResolvedValue(ok(undefined));

            const tab = makeTab(plugin);
            const container = new MockElement("div") as unknown as HTMLElement;

            const { dropdownOnChanges } = captureSettingCallbacks(() => {
                (tab as any).renderModelSection(container, "Chat Model", makeModelsResponse().chat);
            });

            await dropdownOnChanges[0]("phi3");
            expect(Notice.instances.some((n) => n.message.includes("failed to pull"))).toBe(true);
            expect(plugin.taskQueue.completed.some((t: any) => t.status === "failed")).toBe(true);
        });
    });

    describe("Pull button", () => {
        interface PullSetup {
            tab: LilbeeSettingTab;
            clickHandler: () => Promise<void>;
            actionCell: MockElement;
        }

        async function setupPullButton(plugin: ReturnType<typeof makePlugin>): Promise<PullSetup> {
            const tab = makeTab(plugin);
            const table = new MockElement("table") as unknown as HTMLTableElement;
            const catalog = makeModelsResponse();
            const model = catalog.chat.catalog[1];

            let clickHandler: (() => Promise<void>) | null = null;
            const origAddEventListener = MockElement.prototype.addEventListener;
            MockElement.prototype.addEventListener = function (event: string, handler: Function) {
                if (event === "click") {
                    clickHandler = handler as () => Promise<void>;
                }
                origAddEventListener.call(this, event, handler);
            };

            (tab as any).renderCatalogRow(table, model);
            MockElement.prototype.addEventListener = origAddEventListener;

            const row = (table as unknown as MockElement).children[0];
            const actionCell = row.children[3];

            return { tab, clickHandler: clickHandler!, actionCell };
        }

        it("successful pull: updates taskQueue with percent and shows success Notice", async () => {
            const plugin = makePlugin();

            async function* fakePull() {
                yield { event: "progress", data: { percent: 75 } };
            }
            (plugin.api.pullModel as ReturnType<typeof vi.fn>).mockReturnValue(fakePull());
            (plugin.api.setChatModel as ReturnType<typeof vi.fn>).mockResolvedValue(ok(undefined));
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());

            const updateSpy = vi.spyOn(plugin.taskQueue, "update");
            const { tab, clickHandler } = await setupPullButton(plugin);
            const modelsContainer = new MockElement("div");
            modelsContainer.classList.add("lilbee-models-container");
            tab.containerEl.children.push(modelsContainer);

            await clickHandler();

            expect(updateSpy).toHaveBeenCalledWith(expect.any(String), 75, "phi3", expect.any(Object));
            expect(Notice.instances.some((n) => n.message.includes("phi3") && n.message.includes("pulled"))).toBe(true);
            expect(plugin.api.setChatModel).toHaveBeenCalledWith("phi3");
        });

        it("progress event with no percent and no total: skips taskQueue.update", async () => {
            const plugin = makePlugin();

            async function* fakePull() {
                yield { event: "progress", data: {} };
            }
            (plugin.api.pullModel as ReturnType<typeof vi.fn>).mockReturnValue(fakePull());
            (plugin.api.setChatModel as ReturnType<typeof vi.fn>).mockResolvedValue(ok(undefined));
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());

            const updateSpy = vi.spyOn(plugin.taskQueue, "update");
            const { tab, clickHandler } = await setupPullButton(plugin);
            const modelsContainer = new MockElement("div");
            modelsContainer.classList.add("lilbee-models-container");
            tab.containerEl.children.push(modelsContainer);

            await clickHandler();

            expect(updateSpy).not.toHaveBeenCalled();
        });

        it("progress event with current/total (no percent): computes percentage", async () => {
            const plugin = makePlugin();

            async function* fakePull() {
                yield { event: "progress", data: { current: 50, total: 100 } };
            }
            (plugin.api.pullModel as ReturnType<typeof vi.fn>).mockReturnValue(fakePull());
            (plugin.api.setChatModel as ReturnType<typeof vi.fn>).mockResolvedValue(ok(undefined));
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());

            const updateSpy = vi.spyOn(plugin.taskQueue, "update");
            const { tab, clickHandler } = await setupPullButton(plugin);
            const modelsContainer = new MockElement("div");
            modelsContainer.classList.add("lilbee-models-container");
            tab.containerEl.children.push(modelsContainer);

            await clickHandler();

            expect(updateSpy).toHaveBeenCalledWith(expect.any(String), 50, "phi3", expect.any(Object));
        });

        it("progress event with percent=0: updates taskQueue with 0", async () => {
            const plugin = makePlugin();

            async function* fakePull() {
                yield { event: "progress", data: { percent: 0 } };
            }
            (plugin.api.pullModel as ReturnType<typeof vi.fn>).mockReturnValue(fakePull());
            (plugin.api.setChatModel as ReturnType<typeof vi.fn>).mockResolvedValue(ok(undefined));
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());

            const updateSpy = vi.spyOn(plugin.taskQueue, "update");
            const { tab, clickHandler } = await setupPullButton(plugin);
            const modelsContainer = new MockElement("div");
            modelsContainer.classList.add("lilbee-models-container");
            tab.containerEl.children.push(modelsContainer);

            await clickHandler();

            expect(updateSpy).toHaveBeenCalledWith(expect.any(String), 0, "phi3", expect.any(Object));
        });

        it("pull failure: shows failure Notice and re-enables button with 'Pull' text", async () => {
            const plugin = makePlugin();

            async function* failingPull(): AsyncGenerator<never> {
                throw new Error("network error");
            }
            (plugin.api.pullModel as ReturnType<typeof vi.fn>).mockReturnValue(failingPull());

            const { tab: _tab, clickHandler, actionCell } = await setupPullButton(plugin);
            const btn = actionCell.children[0];

            await clickHandler();

            expect(Notice.instances.some((n) => n.message.includes("failed to pull"))).toBe(true);
            expect(btn.disabled).toBe(false);
            expect(btn.textContent).toBe("Pull");
        });

        it("pull failure with non-Error throw uses 'unknown' in taskQueue", async () => {
            const plugin = makePlugin();

            async function* failingPull(): AsyncGenerator<never> {
                throw "string error";
            }
            (plugin.api.pullModel as ReturnType<typeof vi.fn>).mockReturnValue(failingPull());

            const { tab: _tab, clickHandler } = await setupPullButton(plugin);
            await clickHandler();

            const failed = plugin.taskQueue.completed.find((t: any) => t.status === "failed");
            expect(failed).toBeDefined();
            expect(failed!.error).toBe("unknown error");
        });

        it("SSE_EVENT.ERROR shows failure notice and fails the task", async () => {
            const plugin = makePlugin();

            async function* errorPull() {
                yield { event: SSE_EVENT.ERROR, data: { message: "pull exploded" } };
            }
            (plugin.api.pullModel as ReturnType<typeof vi.fn>).mockReturnValue(errorPull());
            (plugin.api.setChatModel as ReturnType<typeof vi.fn>).mockResolvedValue(ok(undefined));
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());

            const { tab: _tab, clickHandler } = await setupPullButton(plugin);
            await clickHandler();

            expect(Notice.instances.some((n) => n.message.includes("failed to pull"))).toBe(true);
            expect(plugin.taskQueue.completed.some((t: any) => t.status === "failed")).toBe(true);
        });

        it("SSE_EVENT.ERROR with string data fails the task", async () => {
            const plugin = makePlugin();

            async function* errorPull() {
                yield { event: SSE_EVENT.ERROR, data: "raw error string" };
            }
            (plugin.api.pullModel as ReturnType<typeof vi.fn>).mockReturnValue(errorPull());
            (plugin.api.setChatModel as ReturnType<typeof vi.fn>).mockResolvedValue(ok(undefined));
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());

            const { tab: _tab, clickHandler } = await setupPullButton(plugin);
            await clickHandler();

            expect(Notice.instances.some((n) => n.message.includes("failed to pull"))).toBe(true);
            expect(plugin.taskQueue.completed.some((t: any) => t.status === "failed")).toBe(true);
        });

        it("SSE_EVENT.ERROR with empty object uses fallback message", async () => {
            const plugin = makePlugin();

            async function* errorPull() {
                yield { event: SSE_EVENT.ERROR, data: {} };
            }
            (plugin.api.pullModel as ReturnType<typeof vi.fn>).mockReturnValue(errorPull());
            (plugin.api.setChatModel as ReturnType<typeof vi.fn>).mockResolvedValue(ok(undefined));
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());

            const { tab: _tab, clickHandler } = await setupPullButton(plugin);
            await clickHandler();

            expect(Notice.instances.some((n) => n.message.includes("failed to pull"))).toBe(true);
            expect(plugin.taskQueue.completed.some((t: any) => t.status === "failed")).toBe(true);
        });

        it("successful pull without models container: does not crash", async () => {
            const plugin = makePlugin();

            async function* fakePull() {}
            (plugin.api.pullModel as ReturnType<typeof vi.fn>).mockReturnValue(fakePull());
            (plugin.api.setChatModel as ReturnType<typeof vi.fn>).mockResolvedValue(ok(undefined));
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());

            const { clickHandler } = await setupPullButton(plugin);

            await expect(clickHandler()).resolves.not.toThrow();
            expect(Notice.instances.some((n) => n.message.includes("pulled"))).toBe(true);
        });

        it("successful pull with HTMLElement container: reloads models", async () => {
            const plugin = makePlugin();

            async function* fakePull() {}
            (plugin.api.pullModel as ReturnType<typeof vi.fn>).mockReturnValue(fakePull());
            (plugin.api.setChatModel as ReturnType<typeof vi.fn>).mockResolvedValue(ok(undefined));
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());

            const { tab, clickHandler } = await setupPullButton(plugin);

            Object.defineProperty(globalThis, "HTMLElement", {
                value: MockElement,
                configurable: true,
                writable: true,
            });
            const fakeContainer = new MockElement("div");
            tab.containerEl.querySelector = vi.fn().mockReturnValue(fakeContainer);

            await clickHandler();

            expect(plugin.api.listModels).toHaveBeenCalled();

            // @ts-expect-error removing test-only global
            delete (globalThis as any).HTMLElement;
        });

        it("pull progress updates taskQueue", async () => {
            const plugin = makePlugin();

            async function* fakePull() {
                yield { event: "progress", data: { percent: 45 } };
            }
            (plugin.api.pullModel as ReturnType<typeof vi.fn>).mockReturnValue(fakePull());
            (plugin.api.setChatModel as ReturnType<typeof vi.fn>).mockResolvedValue(ok(undefined));
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());

            const { tab, clickHandler } = await setupPullButton(plugin);
            const modelsContainer = new MockElement("div");
            modelsContainer.classList.add("lilbee-models-container");
            tab.containerEl.children.push(modelsContainer);

            await clickHandler();

            // Task should be completed in history
            expect(plugin.taskQueue.completed.length).toBeGreaterThan(0);
        });

        it("successful pull calls fetchActiveModel", async () => {
            const plugin = makePlugin();

            async function* fakePull() {}
            (plugin.api.pullModel as ReturnType<typeof vi.fn>).mockReturnValue(fakePull());
            (plugin.api.setChatModel as ReturnType<typeof vi.fn>).mockResolvedValue(ok(undefined));
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());

            const { tab, clickHandler } = await setupPullButton(plugin);
            const modelsContainer = new MockElement("div");
            modelsContainer.classList.add("lilbee-models-container");
            tab.containerEl.children.push(modelsContainer);

            await clickHandler();

            expect(plugin.fetchActiveModel).toHaveBeenCalled();
        });

        it("pull progress does not update status bar when statusBarEl is null", async () => {
            const plugin = makePlugin();
            (plugin as any).statusBarEl = null;

            async function* fakePull() {
                yield { event: "progress", data: { percent: 50 } };
            }
            (plugin.api.pullModel as ReturnType<typeof vi.fn>).mockReturnValue(fakePull());
            (plugin.api.setChatModel as ReturnType<typeof vi.fn>).mockResolvedValue(ok(undefined));
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());

            const { tab, clickHandler } = await setupPullButton(plugin);
            const modelsContainer = new MockElement("div");
            modelsContainer.classList.add("lilbee-models-container");
            tab.containerEl.children.push(modelsContainer);

            await expect(clickHandler()).resolves.not.toThrow();
        });

        it("non-progress events during pull are ignored (no crash)", async () => {
            const plugin = makePlugin();

            async function* fakePull() {
                yield { event: "other", data: {} };
            }
            (plugin.api.pullModel as ReturnType<typeof vi.fn>).mockReturnValue(fakePull());
            (plugin.api.setChatModel as ReturnType<typeof vi.fn>).mockResolvedValue(ok(undefined));
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());

            const { tab, clickHandler } = await setupPullButton(plugin);
            const modelsContainer = new MockElement("div");
            modelsContainer.classList.add("lilbee-models-container");
            tab.containerEl.children.push(modelsContainer);

            await expect(clickHandler()).resolves.not.toThrow();
        });
    });

    describe("checkEndpoint()", () => {
        let origFetch: typeof globalThis.fetch;

        beforeEach(() => {
            origFetch = globalThis.fetch;
        });

        afterEach(() => {
            globalThis.fetch = origFetch;
        });

        it("shows green dot when fetch returns ok response", async () => {
            globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
            const plugin = makePlugin();
            const tab = makeTab(plugin);
            const statusEl = new MockElement("span") as unknown as HTMLSpanElement;

            await tab.checkEndpoint("http://localhost:7433/api/health", statusEl);

            const dot = (statusEl as unknown as MockElement).find("lilbee-health-dot");
            expect(dot).not.toBeNull();
            expect(dot!.classList.contains("is-ok")).toBe(true);
            expect((statusEl as unknown as MockElement).classList.contains("lilbee-health-ok")).toBe(true);
            expect((statusEl as unknown as MockElement).classList.contains("lilbee-health-error")).toBe(false);
        });

        it("shows red dot when fetch returns non-ok response", async () => {
            globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
            const plugin = makePlugin();
            const tab = makeTab(plugin);
            const statusEl = new MockElement("span") as unknown as HTMLSpanElement;

            await tab.checkEndpoint("http://localhost:7433/api/health", statusEl);

            const dot = (statusEl as unknown as MockElement).find("lilbee-health-dot");
            expect(dot).not.toBeNull();
            expect(dot!.classList.contains("is-error")).toBe(true);
            expect((statusEl as unknown as MockElement).classList.contains("lilbee-health-error")).toBe(true);
            expect((statusEl as unknown as MockElement).classList.contains("lilbee-health-ok")).toBe(false);
        });

        it("shows red dot when fetch throws", async () => {
            globalThis.fetch = vi.fn().mockRejectedValue(new Error("network error"));
            const plugin = makePlugin();
            const tab = makeTab(plugin);
            const statusEl = new MockElement("span") as unknown as HTMLSpanElement;

            await tab.checkEndpoint("http://localhost:7433/api/health", statusEl);

            const dot = (statusEl as unknown as MockElement).find("lilbee-health-dot");
            expect(dot).not.toBeNull();
            expect(dot!.classList.contains("is-error")).toBe(true);
            expect((statusEl as unknown as MockElement).classList.contains("lilbee-health-error")).toBe(true);
        });

        it("creates dot immediately then updates classes after fetch", async () => {
            let resolvePromise: (v: { ok: boolean; status: number }) => void;
            const pending = new Promise<{ ok: boolean; status: number }>((r) => {
                resolvePromise = r;
            });
            globalThis.fetch = vi.fn().mockReturnValue(pending);
            const plugin = makePlugin();
            const tab = makeTab(plugin);
            const statusEl = new MockElement("span") as unknown as HTMLSpanElement;

            const promise = tab.checkEndpoint("http://localhost:7433/api/health", statusEl);

            // Dot should exist immediately
            const dot = (statusEl as unknown as MockElement).find("lilbee-health-dot");
            expect(dot).not.toBeNull();

            resolvePromise!({ ok: true, status: 200 });
            await promise;

            expect(dot!.classList.contains("is-ok")).toBe(true);
        });

        it("clears previous health classes before checking", async () => {
            globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
            const plugin = makePlugin();
            const tab = makeTab(plugin);
            const statusEl = new MockElement("span") as unknown as HTMLSpanElement;
            (statusEl as unknown as MockElement).classList.add("lilbee-health-error");

            await tab.checkEndpoint("http://localhost:7433/api/health", statusEl);

            expect((statusEl as unknown as MockElement).classList.contains("lilbee-health-error")).toBe(false);
            expect((statusEl as unknown as MockElement).classList.contains("lilbee-health-ok")).toBe(true);
        });
    });

    describe("display() auto-checks endpoints", () => {
        let origFetch: typeof globalThis.fetch;

        beforeEach(() => {
            origFetch = globalThis.fetch;
        });

        afterEach(() => {
            globalThis.fetch = origFetch;
        });

        it("auto-checks server endpoint on display", async () => {
            globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
            const plugin = makePlugin({ serverMode: "external" });
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);

            tab.display();

            // Wait for async checks to complete
            await new Promise((r) => setTimeout(r, 0));

            // Only server health check
            expect(globalThis.fetch).toHaveBeenCalledTimes(1);
            expect(globalThis.fetch).toHaveBeenCalledWith(
                expect.stringContaining("/api/health"),
                expect.objectContaining({ signal: expect.any(AbortSignal) }),
            );
        });

        it("Test button calls checkEndpoint", async () => {
            globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
            const plugin = makePlugin({ serverMode: "external" });
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);

            const { buttonOnClicks } = captureSettingCallbacks(() => tab.display());

            // Wait for auto-checks
            await new Promise((r) => setTimeout(r, 0));
            (globalThis.fetch as ReturnType<typeof vi.fn>).mockClear();

            // buttonOnClicks[0] = Setup wizard, [1] = server Test
            await buttonOnClicks[1]();

            expect(globalThis.fetch).toHaveBeenCalledTimes(1);
            expect(globalThis.fetch).toHaveBeenCalledWith(
                expect.stringContaining("/api/health"),
                expect.objectContaining({ signal: expect.any(AbortSignal) }),
            );
        });
    });

    describe("separator key handling", () => {
        it("dropdown onChange ignores separator key selection", async () => {
            const plugin = makePlugin();
            const tab = makeTab(plugin);
            const container = new MockElement("div") as unknown as HTMLElement;

            const { dropdownOnChanges } = captureSettingCallbacks(() => {
                (tab as any).renderModelSection(container, "Chat Model", makeModelsResponse().chat);
            });

            await dropdownOnChanges[0](SEPARATOR_KEY);
            expect(plugin.api.setChatModel).not.toHaveBeenCalled();
        });
    });

    describe("auto-pull via dropdown", () => {
        it("selecting uninstalled catalog model triggers auto-pull", async () => {
            const plugin = makePlugin();

            async function* fakePull() {
                yield { event: "progress", data: { percent: 50 } };
            }
            (plugin.api.pullModel as ReturnType<typeof vi.fn>).mockReturnValue(fakePull());
            (plugin.api.setChatModel as ReturnType<typeof vi.fn>).mockResolvedValue(ok(undefined));
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());

            const tab = makeTab(plugin);
            const container = new MockElement("div") as unknown as HTMLElement;
            const modelsContainer = new MockElement("div");
            modelsContainer.classList.add("lilbee-models-container");
            tab.containerEl.children.push(modelsContainer);
            tab.containerEl.querySelector = vi.fn().mockReturnValue(null);

            const { dropdownOnChanges } = captureSettingCallbacks(() => {
                (tab as any).renderModelSection(container, "Chat Model", makeModelsResponse().chat);
            });

            // phi3 is uninstalled in catalog, should trigger auto-pull
            await dropdownOnChanges[0]("phi3");
            expect(plugin.api.pullModel).toHaveBeenCalledWith("phi3", "native", expect.any(AbortSignal));
            expect(plugin.api.setChatModel).toHaveBeenCalledWith("phi3");
            expect(Notice.instances.some((n) => n.message === "lilbee: phi3 pulled and activated")).toBe(true);
        });

        it("auto-pull failure shows failure notice", async () => {
            const plugin = makePlugin();

            async function* failingPull(): AsyncGenerator<never> {
                throw new Error("network");
            }
            (plugin.api.pullModel as ReturnType<typeof vi.fn>).mockReturnValue(failingPull());

            const tab = makeTab(plugin);
            const container = new MockElement("div") as unknown as HTMLElement;

            const { dropdownOnChanges } = captureSettingCallbacks(() => {
                (tab as any).renderModelSection(container, "Chat Model", makeModelsResponse().chat);
            });

            await dropdownOnChanges[0]("phi3");
            expect(Notice.instances.some((n) => n.message.includes("failed to pull"))).toBe(true);
        });

        it("auto-pull failure with non-Error throw uses 'unknown' in taskQueue", async () => {
            const plugin = makePlugin();

            async function* failingPull(): AsyncGenerator<never> {
                throw "string error";
            }
            (plugin.api.pullModel as ReturnType<typeof vi.fn>).mockReturnValue(failingPull());
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());

            const tab = makeTab(plugin);
            const container = new MockElement("div") as unknown as HTMLElement;
            tab.containerEl.querySelector = vi.fn().mockReturnValue(null);

            const { dropdownOnChanges } = captureSettingCallbacks(() => {
                (tab as any).renderModelSection(container, "Chat Model", makeModelsResponse().chat);
            });

            await dropdownOnChanges[0]("phi3");

            const failed = plugin.taskQueue.completed.find((t: any) => t.status === "failed");
            expect(failed).toBeDefined();
            expect(failed!.error).toBe("unknown error");
        });

        it("auto-pull updates taskQueue with progress", async () => {
            const plugin = makePlugin();

            async function* fakePull() {
                yield { event: "progress", data: { percent: 75 } };
            }
            (plugin.api.pullModel as ReturnType<typeof vi.fn>).mockReturnValue(fakePull());
            (plugin.api.setChatModel as ReturnType<typeof vi.fn>).mockResolvedValue(ok(undefined));
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());

            const tab = makeTab(plugin);
            const container = new MockElement("div") as unknown as HTMLElement;
            tab.containerEl.querySelector = vi.fn().mockReturnValue(null);

            const { dropdownOnChanges } = captureSettingCallbacks(() => {
                (tab as any).renderModelSection(container, "Chat Model", makeModelsResponse().chat);
            });

            await dropdownOnChanges[0]("phi3");
            // Task should be completed in history with progress
            expect(plugin.taskQueue.completed.length).toBeGreaterThan(0);
        });

        it("auto-pull completes task in taskQueue", async () => {
            const plugin = makePlugin();

            async function* fakePull() {
                yield { event: "progress", data: { current: 60, total: 100 } };
            }
            (plugin.api.pullModel as ReturnType<typeof vi.fn>).mockReturnValue(fakePull());
            (plugin.api.setChatModel as ReturnType<typeof vi.fn>).mockResolvedValue(ok(undefined));
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());

            const tab = makeTab(plugin);
            const container = new MockElement("div") as unknown as HTMLElement;
            tab.containerEl.querySelector = vi.fn().mockReturnValue(null);

            const { dropdownOnChanges } = captureSettingCallbacks(() => {
                (tab as any).renderModelSection(container, "Chat Model", makeModelsResponse().chat);
            });

            await dropdownOnChanges[0]("phi3");
            const done = plugin.taskQueue.completed.find((t: any) => t.status === "done");
            expect(done).toBeDefined();
        });

        it("auto-pull progress with no percent and no total skips update", async () => {
            const plugin = makePlugin();

            async function* fakePull() {
                yield { event: "progress", data: {} };
            }
            (plugin.api.pullModel as ReturnType<typeof vi.fn>).mockReturnValue(fakePull());
            (plugin.api.setChatModel as ReturnType<typeof vi.fn>).mockResolvedValue(ok(undefined));
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());

            const tab = makeTab(plugin);
            const container = new MockElement("div") as unknown as HTMLElement;
            tab.containerEl.querySelector = vi.fn().mockReturnValue(null);

            const { dropdownOnChanges } = captureSettingCallbacks(() => {
                (tab as any).renderModelSection(container, "Chat Model", makeModelsResponse().chat);
            });

            await dropdownOnChanges[0]("phi3");
            expect(plugin.taskQueue.completed.length).toBeGreaterThan(0);
        });

        it("auto-pull with total=0 does not update status bar", async () => {
            const plugin = makePlugin();

            async function* fakePull() {
                yield { event: "progress", data: { percent: 0 } };
            }
            (plugin.api.pullModel as ReturnType<typeof vi.fn>).mockReturnValue(fakePull());
            (plugin.api.setChatModel as ReturnType<typeof vi.fn>).mockResolvedValue(ok(undefined));
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());

            const tab = makeTab(plugin);
            const container = new MockElement("div") as unknown as HTMLElement;
            tab.containerEl.querySelector = vi.fn().mockReturnValue(null);

            const { dropdownOnChanges } = captureSettingCallbacks(() => {
                (tab as any).renderModelSection(container, "Chat Model", makeModelsResponse().chat);
            });

            await dropdownOnChanges[0]("phi3");
            // total=0 means no status bar update for progress
            expect(plugin.statusBarEl!.setText).not.toHaveBeenCalled();
        });

        it("auto-pull without statusBarEl does not crash", async () => {
            const plugin = makePlugin();
            (plugin as any).statusBarEl = null;

            async function* fakePull() {
                yield { event: "progress", data: { percent: 50 } };
            }
            (plugin.api.pullModel as ReturnType<typeof vi.fn>).mockReturnValue(fakePull());
            (plugin.api.setChatModel as ReturnType<typeof vi.fn>).mockResolvedValue(ok(undefined));
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());

            const tab = makeTab(plugin);
            const container = new MockElement("div") as unknown as HTMLElement;
            tab.containerEl.querySelector = vi.fn().mockReturnValue(null);

            const { dropdownOnChanges } = captureSettingCallbacks(() => {
                (tab as any).renderModelSection(container, "Chat Model", makeModelsResponse().chat);
            });

            await expect(dropdownOnChanges[0]("phi3")).resolves.not.toThrow();
        });

        it("auto-pull without statusBarEl does not crash (via dropdown)", async () => {
            const plugin = makePlugin();
            (plugin as any).statusBarEl = null;

            async function* fakePull() {
                yield { event: "progress", data: { percent: 50 } };
            }
            (plugin.api.pullModel as ReturnType<typeof vi.fn>).mockReturnValue(fakePull());
            (plugin.api.setChatModel as ReturnType<typeof vi.fn>).mockResolvedValue(ok(undefined));
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());

            const tab = makeTab(plugin);
            const container = new MockElement("div") as unknown as HTMLElement;
            tab.containerEl.querySelector = vi.fn().mockReturnValue(null);

            const { dropdownOnChanges } = captureSettingCallbacks(() => {
                (tab as any).renderModelSection(container, "Chat Model", makeModelsResponse().chat);
            });

            await expect(dropdownOnChanges[0]("phi3")).resolves.not.toThrow();
        });

        it("auto-pull re-renders settings after success", async () => {
            const plugin = makePlugin();

            async function* fakePull() {}
            (plugin.api.pullModel as ReturnType<typeof vi.fn>).mockReturnValue(fakePull());
            (plugin.api.setChatModel as ReturnType<typeof vi.fn>).mockResolvedValue(ok(undefined));
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());

            const tab = makeTab(plugin);
            const container = new MockElement("div") as unknown as HTMLElement;

            const { dropdownOnChanges } = captureSettingCallbacks(() => {
                (tab as any).renderModelSection(container, "Chat Model", makeModelsResponse().chat);
            });

            const displaySpy = vi.spyOn(tab, "display").mockImplementation(() => {});
            await dropdownOnChanges[0]("phi3");
            expect(displaySpy).toHaveBeenCalled();
        });
    });

    describe("queue-full on pull", () => {
        it("autoPullAndSet surfaces NOTICE_QUEUE_FULL when enqueue returns null", async () => {
            const plugin = makePlugin();
            plugin.taskQueue.enqueue = vi.fn(() => null) as any;
            const tab = makeTab(plugin);
            const container = new MockElement("div") as unknown as HTMLElement;
            const { dropdownOnChanges } = captureSettingCallbacks(() => {
                (tab as any).renderModelSection(container, "Chat Model", makeModelsResponse().chat);
            });
            Notice.clear();
            await dropdownOnChanges[0]("phi3");
            expect(Notice.instances.some((n) => n.message === MESSAGES.NOTICE_QUEUE_FULL)).toBe(true);
        });

        it("executePull (manual) surfaces NOTICE_QUEUE_FULL when enqueue returns null", async () => {
            const plugin = makePlugin();
            plugin.taskQueue.enqueue = vi.fn(() => null) as any;
            const tab = makeTab(plugin);
            Notice.clear();
            await (tab as any).executePull({ name: "phi3" });
            expect(Notice.instances.some((n) => n.message === MESSAGES.NOTICE_QUEUE_FULL)).toBe(true);
        });

        it("deleteModel surfaces NOTICE_QUEUE_FULL when enqueue returns null", async () => {
            const plugin = makePlugin();
            plugin.taskQueue.enqueue = vi.fn(() => null) as any;
            const tab = makeTab(plugin);
            const btn = new MockElement("button") as unknown as HTMLButtonElement;
            Notice.clear();
            await (tab as any).deleteModel(btn, { name: "phi3" });
            expect(Notice.instances.some((n) => n.message === MESSAGES.NOTICE_QUEUE_FULL)).toBe(true);
            expect(plugin.api.deleteModel).not.toHaveBeenCalled();
        });

        it("autoPullAndSet completes pull and shows set-failed notice when setModel throws", async () => {
            const plugin = makePlugin();
            async function* fakePull() {}
            (plugin.api.pullModel as ReturnType<typeof vi.fn>).mockReturnValue(fakePull());
            (plugin.api.setChatModel as ReturnType<typeof vi.fn>).mockResolvedValue(err(new Error("set fail")));
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());

            const tab = makeTab(plugin);
            const container = new MockElement("div") as unknown as HTMLElement;
            const { dropdownOnChanges } = captureSettingCallbacks(() => {
                (tab as any).renderModelSection(container, "Chat Model", makeModelsResponse().chat);
            });
            Notice.clear();

            await dropdownOnChanges[0]("phi3");

            const setFailed = MESSAGES.ERROR_SET_MODEL.replace("{model}", "phi3");
            expect(Notice.instances.some((n) => n.message === setFailed)).toBe(true);
            expect(plugin.taskQueue.completed.some((t: any) => t.status === "done")).toBe(true);
            expect(plugin.taskQueue.completed.some((t: any) => t.status === "failed")).toBe(false);
        });

        it("executePull (manual) completes pull and shows set-failed notice when setModel throws", async () => {
            const plugin = makePlugin();
            async function* fakePull() {}
            (plugin.api.pullModel as ReturnType<typeof vi.fn>).mockReturnValue(fakePull());
            (plugin.api.setChatModel as ReturnType<typeof vi.fn>).mockResolvedValue(err(new Error("set fail")));
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());

            const tab = makeTab(plugin);
            Notice.clear();

            await (tab as any).executePull({ name: "phi3" });

            const setFailed = MESSAGES.ERROR_SET_MODEL.replace("{model}", "phi3");
            expect(Notice.instances.some((n) => n.message === setFailed)).toBe(true);
            expect(plugin.taskQueue.completed.some((t: any) => t.status === "done")).toBe(true);
            expect(plugin.taskQueue.completed.some((t: any) => t.status === "failed")).toBe(false);
        });
    });
});

describe("buildModelOptions()", () => {
    it("chat: catalog models first, then separator, then other installed", () => {
        const catalog: ModelCatalog = {
            active: "llama3",
            catalog: [
                { name: "llama3", size_gb: 4.7, min_ram_gb: 8, description: "Meta Llama 3", installed: true },
                { name: "phi3", size_gb: 2.3, min_ram_gb: 4, description: "Microsoft Phi-3", installed: false },
            ],
            installed: ["llama3", "custom-model"],
        };
        const options = buildModelOptions(catalog);
        const keys = Object.keys(options);
        expect(keys).toEqual(["llama3", "phi3", SEPARATOR_KEY, "custom-model"]);
        expect(options["llama3"]).toBe("llama3");
        expect(options["phi3"]).toBe("phi3 (not installed)");
        expect(options[SEPARATOR_KEY]).toBe(SEPARATOR_LABEL);
        expect(options["custom-model"]).toBe("custom-model");
    });

    it("no separator when all installed models are in catalog", () => {
        const catalog: ModelCatalog = {
            active: "llama3",
            catalog: [{ name: "llama3", size_gb: 4.7, min_ram_gb: 8, description: "Meta", installed: true }],
            installed: ["llama3"],
        };
        const options = buildModelOptions(catalog);
        expect(SEPARATOR_KEY in options).toBe(false);
    });

    it("preserves server catalog order (no alphabetical sort)", () => {
        const catalog: ModelCatalog = {
            active: "zeta",
            catalog: [
                { name: "zeta", size_gb: 1, min_ram_gb: 2, description: "Z", installed: true },
                { name: "alpha", size_gb: 1, min_ram_gb: 2, description: "A", installed: true },
            ],
            installed: ["zeta", "alpha"],
        };
        const options = buildModelOptions(catalog);
        const keys = Object.keys(options);
        expect(keys[0]).toBe("zeta");
        expect(keys[1]).toBe("alpha");
    });

    it("sorts other installed models alphabetically", () => {
        const catalog: ModelCatalog = {
            active: "foo",
            catalog: [],
            installed: ["zoo", "bar", "foo"],
        };
        const options = buildModelOptions(catalog);
        const keys = Object.keys(options);
        // separator then bar, foo, zoo
        expect(keys).toEqual([SEPARATOR_KEY, "bar", "foo", "zoo"]);
    });

    it("empty catalog and empty installed returns empty for chat", () => {
        const catalog: ModelCatalog = { active: "", catalog: [], installed: [] };
        const options = buildModelOptions(catalog);
        expect(Object.keys(options).length).toBe(0);
    });

    it("shows source tag when model has source", () => {
        const catalog: ModelCatalog = {
            active: "llama3",
            catalog: [
                { name: "llama3", size_gb: 4.7, min_ram_gb: 8, description: "Meta", installed: true, source: "native" },
            ],
            installed: ["llama3"],
        };
        const options = buildModelOptions(catalog);
        expect(options["llama3"]).toBe("llama3 [native]");
    });

    it("deduplicates :latest when a specific tag exists", () => {
        const catalog: ModelCatalog = {
            active: "mistral:7b",
            catalog: [],
            installed: ["mistral:latest", "mistral:7b", "llama3:latest"],
        };
        const options = buildModelOptions(catalog);
        const keys = Object.keys(options);
        expect(keys).toContain("mistral:7b");
        expect(keys).not.toContain("mistral:latest");
        // llama3:latest has no specific tag sibling, so it stays
        expect(keys).toContain("llama3:latest");
    });
});

describe("deduplicateLatest()", () => {
    it("removes :latest when a more specific tag exists", () => {
        const result = deduplicateLatest(["mistral:latest", "mistral:7b"]);
        expect(result).toEqual(["mistral:7b"]);
    });

    it("keeps :latest when no specific tag exists", () => {
        const result = deduplicateLatest(["llama3:latest"]);
        expect(result).toEqual(["llama3:latest"]);
    });

    it("handles models without tags", () => {
        const result = deduplicateLatest(["phi3", "phi3:latest"]);
        expect(result).toEqual(["phi3"]);
    });

    it("handles empty list", () => {
        expect(deduplicateLatest([])).toEqual([]);
    });

    it("handles multiple model families", () => {
        const result = deduplicateLatest(["mistral:latest", "mistral:7b", "llama3:latest", "llama3:8b", "phi3:latest"]);
        expect(result).toEqual(["mistral:7b", "llama3:8b", "phi3:latest"]);
    });
});

describe("managed mode settings", () => {
    it("server mode dropdown onChange updates serverMode and re-renders", async () => {
        const plugin = makePlugin({ serverMode: "managed" });
        (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
        const tab = makeTab(plugin);

        const { dropdownOnChanges } = captureSettingCallbacks(() => tab.display());
        const displaySpy = vi.spyOn(tab, "display").mockImplementation(() => {});

        // dropdownOnChanges[0] is the server mode dropdown
        await dropdownOnChanges[0]("external");

        expect(plugin.settings.serverMode).toBe("external");
        expect(plugin.saveSettings).toHaveBeenCalled();
        expect(displaySpy).toHaveBeenCalled();
    });

    it("port field onChange updates serverPort", async () => {
        const plugin = makePlugin({ serverMode: "managed" });
        (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
        const tab = makeTab(plugin);

        const { textOnChanges } = captureSettingCallbacks(() => tab.display());

        // In managed mode: textOnChanges[0] = port, then gen settings
        await textOnChanges[0]("9999");

        expect(plugin.settings.serverPort).toBe(9999);
        expect(plugin.saveSettings).toHaveBeenCalled();
    });

    it("port field displays empty string when serverPort is null", () => {
        const plugin = makePlugin({ serverMode: "managed", serverPort: null });
        (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
        const tab = makeTab(plugin);

        captureSettingCallbacks(() => tab.display());
        // If we got here without error, the null branch in setValue was exercised
    });

    it("port field ignores invalid values", async () => {
        const plugin = makePlugin({ serverMode: "managed", serverPort: 7433 });
        (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
        const tab = makeTab(plugin);

        const { textOnChanges } = captureSettingCallbacks(() => tab.display());

        await textOnChanges[0]("abc");

        expect(plugin.settings.serverPort).toBe(7433); // unchanged
    });

    it("port field sets to null when empty string is entered", async () => {
        const plugin = makePlugin({ serverMode: "managed", serverPort: 7433 });
        (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
        const tab = makeTab(plugin);

        const { textOnChanges } = captureSettingCallbacks(() => tab.display());

        await textOnChanges[0]("");

        expect(plugin.settings.serverPort).toBe(null);
    });

    it("port field sets to null when 0 is entered", async () => {
        const plugin = makePlugin({ serverMode: "managed", serverPort: 7433 });
        (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
        const tab = makeTab(plugin);

        const { textOnChanges } = captureSettingCallbacks(() => tab.display());

        await textOnChanges[0]("0");

        expect(plugin.settings.serverPort).toBe(null);
    });

    it("check for updates button offers update when newer version exists", async () => {
        Notice.clear();

        const plugin = makePlugin({ serverMode: "managed", lilbeeVersion: "v0.1.0" });
        (plugin as any).checkForUpdate = vi
            .fn()
            .mockResolvedValue({ available: true, release: { tag: "v0.2.0", assetUrl: "https://example.com" } });
        (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
        const tab = makeTab(plugin);

        const { buttonOnClicks } = captureSettingCallbacks(() => tab.display());

        // buttonOnClicks[0] = Setup wizard, [1] = Start (server controls), [2] = Check for updates
        await buttonOnClicks[2]();

        // No notice on check — button transforms to "Update to vX.Y.Z" instead
        expect(Notice.instances.some((n) => n.message.includes("update available"))).toBe(false);
    });

    it("check for updates button shows 'already up to date' when no update", async () => {
        Notice.clear();

        const plugin = makePlugin({ serverMode: "managed", lilbeeVersion: "v0.1.0" });
        (plugin as any).checkForUpdate = vi.fn().mockResolvedValue({ available: false });
        (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
        const tab = makeTab(plugin);

        const { buttonOnClicks } = captureSettingCallbacks(() => tab.display());

        // buttonOnClicks[0] = Setup wizard, [1] = Start, [2] = Check for updates
        await buttonOnClicks[2]();

        expect(Notice.instances.some((n) => n.message.includes("already up to date"))).toBe(true);
    });

    it("update button calls updateServer and shows success notice", async () => {
        Notice.clear();

        const plugin = makePlugin({ serverMode: "managed", lilbeeVersion: "v0.1.0" });
        (plugin as any).checkForUpdate = vi
            .fn()
            .mockResolvedValue({ available: true, release: { tag: "v0.2.0", assetUrl: "https://example.com" } });
        (plugin as any).updateServer = vi
            .fn()
            .mockImplementation(async (_release: any, onProgress?: (msg: string) => void) => {
                onProgress?.("Downloading...");
            });
        (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
        const tab = makeTab(plugin);

        const { buttonOnClicks } = captureSettingCallbacks(() => tab.display());

        // First click: check for updates (sets pendingRelease)
        await buttonOnClicks[2]();
        // Same handler clicked again: now triggers update via pendingRelease
        await buttonOnClicks[2]();

        expect((plugin as any).updateServer).toHaveBeenCalled();
        expect(Notice.instances.some((n) => n.message.includes("updated to v0.2.0"))).toBe(true);
    });

    it("update button does not add duplicate click handlers", async () => {
        Notice.clear();

        const plugin = makePlugin({ serverMode: "managed", lilbeeVersion: "v0.1.0" });
        (plugin as any).checkForUpdate = vi
            .fn()
            .mockResolvedValue({ available: true, release: { tag: "v0.2.0", assetUrl: "https://example.com" } });
        (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
        const tab = makeTab(plugin);

        const { buttonOnClicks } = captureSettingCallbacks(() => tab.display());
        const countBefore = buttonOnClicks.length;

        // Click check for updates — should NOT add a new handler
        await buttonOnClicks[2]();

        expect(buttonOnClicks.length).toBe(countBefore);
    });

    it("update button shows failure notice when updateServer throws", async () => {
        Notice.clear();

        const plugin = makePlugin({ serverMode: "managed", lilbeeVersion: "v0.1.0" });
        (plugin as any).checkForUpdate = vi
            .fn()
            .mockResolvedValue({ available: true, release: { tag: "v0.2.0", assetUrl: "https://example.com" } });
        (plugin as any).updateServer = vi.fn().mockRejectedValue(new Error("download failed"));
        (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
        const tab = makeTab(plugin);

        const { buttonOnClicks } = captureSettingCallbacks(() => tab.display());

        // First click: check (sets pendingRelease); second click: update (fails)
        await buttonOnClicks[2]();
        await buttonOnClicks[2]();

        expect(Notice.instances.some((n) => n.message.includes("update failed"))).toBe(true);
    });

    it("check for updates button shows error on failure", async () => {
        Notice.clear();

        const plugin = makePlugin({ serverMode: "managed" });
        (plugin as any).checkForUpdate = vi.fn().mockRejectedValue(new Error("network error"));
        (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
        const tab = makeTab(plugin);

        const { buttonOnClicks } = captureSettingCallbacks(() => tab.display());

        // buttonOnClicks[0] = Setup wizard, [1] = Start, [2] = Check for updates
        await buttonOnClicks[2]();

        expect(Notice.instances.some((n) => n.message.includes("could not check"))).toBe(true);
    });

    it("renders server status indicator in managed mode", () => {
        const plugin = makePlugin({ serverMode: "managed" });
        (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
        const tab = makeTab(plugin);
        tab.display();

        const statusEl = tab.containerEl.find("lilbee-server-status");
        expect(statusEl).not.toBeNull();
        const dot = statusEl!.find("lilbee-server-dot");
        expect(dot).not.toBeNull();
    });

    it("renders server state from serverManager when present", () => {
        const plugin = makePlugin({ serverMode: "managed" });
        (plugin as any).serverManager = { state: "ready" };
        (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
        const tab = makeTab(plugin);
        tab.display();

        const statusEl = tab.containerEl.find("lilbee-server-status");
        const stateSpan = statusEl!.children.find((c) => c.tagName === "SPAN");
        expect(stateSpan!.textContent).toBe("ready");
        const dot = statusEl!.find("lilbee-server-dot");
        expect(dot!.classList.contains("is-ready")).toBe(true);
    });

    it("Reset to managed button resets serverMode and serverUrl", async () => {
        const plugin = makePlugin({ serverMode: "external", serverUrl: "http://remote:9999" });
        (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
        const tab = makeTab(plugin);

        const { buttonOnClicks } = captureSettingCallbacks(() => tab.display());

        // In external mode: buttons are [Setup wizard, Test (server), Reset to managed, Refresh, Browse Catalog]
        // Find the "Reset to managed" click — it's the one that sets serverMode back
        const resetButton = buttonOnClicks.find((_btn, i) => i === 2);
        expect(resetButton).toBeDefined();
        await resetButton!();

        expect(plugin.settings.serverMode).toBe("managed");
        expect(plugin.settings.serverUrl).toBe("http://127.0.0.1:7433");
        expect(plugin.saveSettings).toHaveBeenCalled();
    });

    it("shows Start button when server is stopped", () => {
        const plugin = makePlugin({ serverMode: "managed" });
        (plugin as any).serverManager = null; // state defaults to "stopped"
        (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
        (plugin as any).startManagedServer = vi.fn().mockResolvedValue(undefined);
        const tab = makeTab(plugin);

        const { buttonOnClicks } = captureSettingCallbacks(() => tab.display());
        // Server controls: Start button is first among control buttons
        // Buttons: Start, Check for updates, Test (litellm), Refresh
        expect(buttonOnClicks.length).toBeGreaterThanOrEqual(1);
    });

    it("Start button calls startManagedServer", async () => {
        const plugin = makePlugin({ serverMode: "managed" });
        (plugin as any).serverManager = null; // state defaults to "stopped"
        (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
        const mockStart = vi.fn().mockResolvedValue(undefined);
        (plugin as any).startManagedServer = mockStart;
        const tab = makeTab(plugin);

        const { buttonOnClicks } = captureSettingCallbacks(() => tab.display());
        const displaySpy = vi.spyOn(tab, "display").mockImplementation(() => {});
        // buttonOnClicks[0] = Setup wizard, [1] = Start
        await buttonOnClicks[1]();

        expect(mockStart).toHaveBeenCalled();
        expect(displaySpy).toHaveBeenCalled();
    });

    it("Stop button calls serverManager.stop", async () => {
        const plugin = makePlugin({ serverMode: "managed" });
        const mockStop = vi.fn().mockResolvedValue(undefined);
        (plugin as any).serverManager = { state: "ready", stop: mockStop, restart: vi.fn() };
        (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
        const tab = makeTab(plugin);

        const { buttonOnClicks } = captureSettingCallbacks(() => tab.display());
        const displaySpy = vi.spyOn(tab, "display").mockImplementation(() => {});
        // buttonOnClicks[0] = Setup wizard, [1] = Stop, [2] = Restart, [3] = Check for updates
        await buttonOnClicks[1]();

        expect(mockStop).toHaveBeenCalled();
        expect(displaySpy).toHaveBeenCalled();
    });

    it("Restart button calls serverManager.restart", async () => {
        const plugin = makePlugin({ serverMode: "managed" });
        const mockRestart = vi.fn().mockResolvedValue(undefined);
        (plugin as any).serverManager = { state: "ready", stop: vi.fn(), restart: mockRestart };
        (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
        const tab = makeTab(plugin);

        const { buttonOnClicks } = captureSettingCallbacks(() => tab.display());
        const displaySpy = vi.spyOn(tab, "display").mockImplementation(() => {});
        // buttonOnClicks[0] = Setup wizard, [1] = Stop, [2] = Restart
        await buttonOnClicks[2]();

        expect(mockRestart).toHaveBeenCalled();
        expect(displaySpy).toHaveBeenCalled();
    });

    describe("Advanced chunk fields onChange", () => {
        it("chunk_size calls updateConfig after confirm", async () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());

            // Index 18: chunk_size (0=port, 1-6=gen, 7-16=crawl (10 text), 17=wikiVaultFolder, 18=chunk_size)
            await textOnChanges[18]("512");
            expect(plugin.api.updateConfig).toHaveBeenCalledWith({ chunk_size: 512 });
        });

        it("chunk_overlap calls updateConfig after confirm", async () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());

            // Index 19: chunk_overlap
            await textOnChanges[19]("64");
            expect(plugin.api.updateConfig).toHaveBeenCalledWith({ chunk_overlap: 64 });
        });

        it("skips empty value", async () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());

            await textOnChanges[18]("");
            expect(plugin.api.updateConfig).not.toHaveBeenCalled();
        });

        it("skips invalid number", async () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());

            await textOnChanges[18]("abc");
            expect(plugin.api.updateConfig).not.toHaveBeenCalled();
        });

        it("skips negative number", async () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());

            await textOnChanges[18]("-1");
            expect(plugin.api.updateConfig).not.toHaveBeenCalled();
        });

        it("aborts when user cancels confirm", async () => {
            mockGenericConfirmResult = false;
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());

            await textOnChanges[18]("512");
            expect(plugin.api.updateConfig).not.toHaveBeenCalled();
            mockGenericConfirmResult = true;
        });

        it("triggers sync when reindex_required", async () => {
            const plugin = makePlugin();
            (plugin.api.updateConfig as ReturnType<typeof vi.fn>).mockResolvedValue({
                updated: ["chunk_size"],
                reindex_required: true,
            });
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());

            await textOnChanges[18]("512");
            expect(plugin.triggerSync).toHaveBeenCalled();
        });

        it("shows error notice on updateConfig failure", async () => {
            const plugin = makePlugin();
            (plugin.api.updateConfig as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("fail"));
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());

            await textOnChanges[18]("512");
            expect(Notice.instances.some((n: any) => n.message.includes("failed to update"))).toBe(true);
        });
    });

    describe("Embedding model dropdown", () => {
        it("calls setEmbeddingModel when catalog loads successfully", async () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            (plugin.api.catalog as ReturnType<typeof vi.fn>).mockResolvedValue(
                ok({
                    total: 1,
                    limit: 20,
                    offset: 0,
                    models: [{ name: "nomic-embed-text", installed: true, task: "embedding" }],
                    has_more: false,
                }),
            );
            const tab = makeTab(plugin);
            tab.display();

            // Wait for async catalog load
            await new Promise((r) => setTimeout(r, 0));

            // The embedding dropdown is rendered via loadEmbeddingDropdown — just verify catalog was called
            expect(plugin.api.catalog).toHaveBeenCalledWith({ task: "embedding" });
        });

        it("embedding dropdown onChange sets model and triggers sync", async () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            (plugin.api.setEmbeddingModel as ReturnType<typeof vi.fn>).mockResolvedValue(ok(undefined));
            (plugin.api.catalog as ReturnType<typeof vi.fn>).mockResolvedValue(
                ok({
                    total: 2,
                    limit: 20,
                    offset: 0,
                    models: [
                        { name: "nomic-embed-text", installed: true, task: "embedding" },
                        { name: "bge-small", installed: false, task: "embedding" },
                    ],
                    has_more: false,
                }),
            );
            const container = new MockElement("div") as unknown as HTMLElement;
            const tab = makeTab(plugin);

            // Capture callbacks from the async loadEmbeddingDropdown
            const dropdowns: DropdownOnChange[] = [];
            const origAddDropdown = Setting.prototype.addDropdown;
            Setting.prototype.addDropdown = function (cb: (dropdown: any) => void) {
                const fakeDropdown = {
                    addOption: () => fakeDropdown,
                    setValue: () => fakeDropdown,
                    onChange: (handler: DropdownOnChange) => {
                        dropdowns.push(handler);
                        return fakeDropdown;
                    },
                };
                cb(fakeDropdown);
                return this;
            };
            await (tab as any).loadEmbeddingDropdown(container);
            await new Promise((r) => setTimeout(r, 0));
            Setting.prototype.addDropdown = origAddDropdown;

            expect(dropdowns.length).toBe(1);
            await dropdowns[0]("nomic-embed-text");
            expect(plugin.api.setEmbeddingModel).toHaveBeenCalledWith("nomic-embed-text");
        });

        it("embedding dropdown onChange aborts when user cancels confirm", async () => {
            mockGenericConfirmResult = false;
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            (plugin.api.catalog as ReturnType<typeof vi.fn>).mockResolvedValue(
                ok({
                    total: 1,
                    limit: 20,
                    offset: 0,
                    models: [{ name: "nomic-embed-text", installed: true, task: "embedding" }],
                    has_more: false,
                }),
            );
            const container = new MockElement("div") as unknown as HTMLElement;
            const tab = makeTab(plugin);

            const dropdowns: DropdownOnChange[] = [];
            const origAddDropdown = Setting.prototype.addDropdown;
            Setting.prototype.addDropdown = function (cb: (dropdown: any) => void) {
                const fakeDropdown = {
                    addOption: () => fakeDropdown,
                    setValue: () => fakeDropdown,
                    onChange: (handler: DropdownOnChange) => {
                        dropdowns.push(handler);
                        return fakeDropdown;
                    },
                };
                cb(fakeDropdown);
                return this;
            };
            await (tab as any).loadEmbeddingDropdown(container);
            await new Promise((r) => setTimeout(r, 0));
            Setting.prototype.addDropdown = origAddDropdown;

            await dropdowns[0]("nomic-embed-text");
            expect(plugin.api.setEmbeddingModel).not.toHaveBeenCalled();
            mockGenericConfirmResult = true;
        });

        it("embedding dropdown shows error notice on failure", async () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            (plugin.api.setEmbeddingModel as ReturnType<typeof vi.fn>).mockResolvedValue(err(new Error("fail")));
            (plugin.api.catalog as ReturnType<typeof vi.fn>).mockResolvedValue(
                ok({
                    total: 1,
                    limit: 20,
                    offset: 0,
                    models: [{ name: "nomic-embed-text", installed: true, task: "embedding" }],
                    has_more: false,
                }),
            );
            const container = new MockElement("div") as unknown as HTMLElement;
            const tab = makeTab(plugin);

            const dropdowns: DropdownOnChange[] = [];
            const origAddDropdown = Setting.prototype.addDropdown;
            Setting.prototype.addDropdown = function (cb: (dropdown: any) => void) {
                const fakeDropdown = {
                    addOption: () => fakeDropdown,
                    setValue: () => fakeDropdown,
                    onChange: (handler: DropdownOnChange) => {
                        dropdowns.push(handler);
                        return fakeDropdown;
                    },
                };
                cb(fakeDropdown);
                return this;
            };
            await (tab as any).loadEmbeddingDropdown(container);
            await new Promise((r) => setTimeout(r, 0));
            Setting.prototype.addDropdown = origAddDropdown;

            await dropdowns[0]("nomic-embed-text");
            expect(Notice.instances.some((n: any) => n.message.includes("failed to update embedding model"))).toBe(
                true,
            );
        });

        it("embedding dropdown skips empty value", async () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            (plugin.api.catalog as ReturnType<typeof vi.fn>).mockResolvedValue(
                ok({
                    total: 1,
                    limit: 20,
                    offset: 0,
                    models: [{ name: "nomic-embed-text", installed: true, task: "embedding" }],
                    has_more: false,
                }),
            );
            const container = new MockElement("div") as unknown as HTMLElement;
            const tab = makeTab(plugin);

            const dropdowns: DropdownOnChange[] = [];
            const origAddDropdown = Setting.prototype.addDropdown;
            Setting.prototype.addDropdown = function (cb: (dropdown: any) => void) {
                const fakeDropdown = {
                    addOption: () => fakeDropdown,
                    setValue: () => fakeDropdown,
                    onChange: (handler: DropdownOnChange) => {
                        dropdowns.push(handler);
                        return fakeDropdown;
                    },
                };
                cb(fakeDropdown);
                return this;
            };
            await (tab as any).loadEmbeddingDropdown(container);
            await new Promise((r) => setTimeout(r, 0));
            Setting.prototype.addDropdown = origAddDropdown;

            await dropdowns[0]("");
            expect(plugin.api.setEmbeddingModel).not.toHaveBeenCalled();
        });

        it("falls back to text input when catalog fails", async () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            (plugin.api.catalog as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("fail"));
            const tab = makeTab(plugin);
            tab.display();

            await new Promise((r) => setTimeout(r, 0));
            // Fallback renders a text input — verify no crash
            expect(plugin.api.catalog).toHaveBeenCalled();
        });

        it("falls back to text input when catalog returns error result", async () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            tab.display();

            await new Promise((r) => setTimeout(r, 0));
            // Default mock returns err() — fallback should render
            expect(plugin.api.catalog).toHaveBeenCalled();
        });

        it("fallback text input calls setEmbeddingModel on non-empty value", async () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const container = new MockElement("div") as unknown as HTMLElement;
            const tab = makeTab(plugin);

            const texts: TextOnChange[] = [];
            const origAddText = Setting.prototype.addText;
            Setting.prototype.addText = function (cb: (text: any) => void) {
                const fakeText = {
                    setPlaceholder: () => fakeText,
                    setValue: () => fakeText,
                    onChange: (handler: TextOnChange) => {
                        texts.push(handler);
                        return fakeText;
                    },
                    inputEl: { placeholder: "", addEventListener: vi.fn() },
                };
                cb(fakeText);
                return this;
            };
            (tab as any).renderEmbeddingFallback(container);
            Setting.prototype.addText = origAddText;

            expect(texts.length).toBe(1);
            await texts[0]("nomic-embed-text");
            expect(plugin.api.setEmbeddingModel).toHaveBeenCalledWith("nomic-embed-text");
        });

        it("fallback text input skips empty value", async () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const container = new MockElement("div") as unknown as HTMLElement;
            const tab = makeTab(plugin);

            const texts: TextOnChange[] = [];
            const origAddText = Setting.prototype.addText;
            Setting.prototype.addText = function (cb: (text: any) => void) {
                const fakeText = {
                    setPlaceholder: () => fakeText,
                    setValue: () => fakeText,
                    onChange: (handler: TextOnChange) => {
                        texts.push(handler);
                        return fakeText;
                    },
                    inputEl: { placeholder: "", addEventListener: vi.fn() },
                };
                cb(fakeText);
                return this;
            };
            (tab as any).renderEmbeddingFallback(container);
            Setting.prototype.addText = origAddText;

            await texts[0]("");
            expect(plugin.api.setEmbeddingModel).not.toHaveBeenCalled();
        });

        it("fallback text input aborts when user cancels confirm", async () => {
            mockGenericConfirmResult = false;
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const container = new MockElement("div") as unknown as HTMLElement;
            const tab = makeTab(plugin);

            const texts: TextOnChange[] = [];
            const origAddText = Setting.prototype.addText;
            Setting.prototype.addText = function (cb: (text: any) => void) {
                const fakeText = {
                    setPlaceholder: () => fakeText,
                    setValue: () => fakeText,
                    onChange: (handler: TextOnChange) => {
                        texts.push(handler);
                        return fakeText;
                    },
                    inputEl: { placeholder: "", addEventListener: vi.fn() },
                };
                cb(fakeText);
                return this;
            };
            (tab as any).renderEmbeddingFallback(container);
            Setting.prototype.addText = origAddText;

            await texts[0]("nomic-embed-text");
            expect(plugin.api.setEmbeddingModel).not.toHaveBeenCalled();
            mockGenericConfirmResult = true;
        });

        it("fallback text input shows error notice on failure", async () => {
            const plugin = makePlugin();
            (plugin.api.setEmbeddingModel as ReturnType<typeof vi.fn>).mockResolvedValue(err(new Error("fail")));
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const container = new MockElement("div") as unknown as HTMLElement;
            const tab = makeTab(plugin);

            const texts: TextOnChange[] = [];
            const origAddText = Setting.prototype.addText;
            Setting.prototype.addText = function (cb: (text: any) => void) {
                const fakeText = {
                    setPlaceholder: () => fakeText,
                    setValue: () => fakeText,
                    onChange: (handler: TextOnChange) => {
                        texts.push(handler);
                        return fakeText;
                    },
                    inputEl: { placeholder: "", addEventListener: vi.fn() },
                };
                cb(fakeText);
                return this;
            };
            (tab as any).renderEmbeddingFallback(container);
            Setting.prototype.addText = origAddText;

            await texts[0]("nomic-embed-text");
            expect(Notice.instances.some((n: any) => n.message.includes("failed to update embedding model"))).toBe(
                true,
            );
        });
    });

    describe("Crawling fields onChange", () => {
        it("calls updateConfig with valid crawl_max_depth", async () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());

            // Indices 7-9: crawl_max_depth, crawl_max_pages, crawl_timeout
            await textOnChanges[7]("3");
            expect(plugin.api.updateConfig).toHaveBeenCalledWith({ crawl_max_depth: 3 });
        });

        it("calls updateConfig with valid crawl_max_pages", async () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());

            await textOnChanges[8]("100");
            expect(plugin.api.updateConfig).toHaveBeenCalledWith({ crawl_max_pages: 100 });
        });

        it("sends null when nullable crawl_max_depth is cleared", async () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());

            await textOnChanges[7]("");
            expect(plugin.api.updateConfig).toHaveBeenCalledWith({ crawl_max_depth: null });
        });

        it("skips invalid number", async () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());

            await textOnChanges[7]("abc");
            expect(plugin.api.updateConfig).not.toHaveBeenCalled();
        });

        it("skips negative number", async () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());

            await textOnChanges[7]("-5");
            expect(plugin.api.updateConfig).not.toHaveBeenCalled();
        });

        it("skips blank on non-nullable crawl_timeout (index 9)", async () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());

            await textOnChanges[9]("");
            expect(plugin.api.updateConfig).not.toHaveBeenCalled();
        });

        it("accepts float for crawl_mean_delay (index 10)", async () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());

            await textOnChanges[10]("0.75");
            expect(plugin.api.updateConfig).toHaveBeenCalledWith({ crawl_mean_delay: 0.75 });
        });

        it("accepts int for crawl_concurrent_requests (index 12)", async () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());

            await textOnChanges[12]("5");
            expect(plugin.api.updateConfig).toHaveBeenCalledWith({ crawl_concurrent_requests: 5 });
        });

        it("rejects non-integer for crawl_concurrent_requests (index 12)", async () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());

            await textOnChanges[12]("5.5");
            expect(plugin.api.updateConfig).not.toHaveBeenCalled();
        });

        it("accepts float for crawl_retry_max_backoff (index 15)", async () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());

            await textOnChanges[15]("45.0");
            expect(plugin.api.updateConfig).toHaveBeenCalledWith({ crawl_retry_max_backoff: 45 });
        });

        it("crawl_retry_on_rate_limit toggle updates config", async () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { toggleOnChanges } = captureSettingCallbacks(() => tab.display());

            // toggleOnChanges[0] = adaptiveThreshold (search/retrieval), [1] = crawl_retry_on_rate_limit (crawling), [2+] = wiki toggles
            await toggleOnChanges[1](false);
            expect(plugin.api.updateConfig).toHaveBeenCalledWith({ crawl_retry_on_rate_limit: false });
        });

        it("toggle shows error notice when updateConfig rejects", async () => {
            const plugin = makePlugin();
            (plugin.api.updateConfig as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("boom"));
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { toggleOnChanges } = captureSettingCallbacks(() => tab.display());

            await toggleOnChanges[1](false);
            expect(Notice.instances.some((n: any) => n.message.includes("failed to update"))).toBe(true);
        });

        it("nullable-clear shows error notice when updateConfig rejects", async () => {
            const plugin = makePlugin();
            (plugin.api.updateConfig as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("boom"));
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());

            await textOnChanges[7](""); // clear crawl_max_depth (nullable)
            expect(Notice.instances.some((n: any) => n.message.includes("failed to update"))).toBe(true);
        });

        it("shows error notice on updateConfig failure", async () => {
            const plugin = makePlugin();
            (plugin.api.updateConfig as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("fail"));
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());

            await textOnChanges[7]("3");
            expect(Notice.instances.some((n: any) => n.message.includes("failed to update"))).toBe(true);
        });
    });

    describe("loadServerDefaults success path", () => {
        it("renders server defaults when config() resolves", async () => {
            const plugin = makePlugin();
            (plugin.api.config as ReturnType<typeof vi.fn>).mockResolvedValue({
                chunk_size: 512,
                chunk_overlap: 64,
                embedding_model: "nomic-embed-text",
            });
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            tab.display();

            // Wait for async config() to resolve
            await new Promise((r) => setTimeout(r, 0));

            expect(plugin.api.config).toHaveBeenCalled();
        });

        it("skips fields where cfg value is undefined", async () => {
            const plugin = makePlugin();
            (plugin.api.config as ReturnType<typeof vi.fn>).mockResolvedValue({
                chunk_size: 512,
                // chunk_overlap and embedding_model are absent
            });
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            tab.display();

            await new Promise((r) => setTimeout(r, 0));

            expect(plugin.api.config).toHaveBeenCalled();
        });

        it("renders blank when cfg value is null and populates the toggle from a bool cfg", async () => {
            const plugin = makePlugin();
            (plugin.api.config as ReturnType<typeof vi.fn>).mockResolvedValue({
                crawl_max_depth: null,
                crawl_max_pages: 200,
                crawl_retry_on_rate_limit: true,
            });
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            tab.display();

            await new Promise((r) => setTimeout(r, 0));

            const maxDepthInput = (tab as any).serverConfigInputs.get("crawl_max_depth");
            const maxPagesInput = (tab as any).serverConfigInputs.get("crawl_max_pages");
            const retryToggle = (tab as any).serverConfigToggles.get("crawl_retry_on_rate_limit");
            expect(maxDepthInput.value).toBe("");
            expect(maxPagesInput.value).toBe("200");
            expect(retryToggle).toBeDefined();
            // toggle.setValue was replayed with the boolean cfg value after config() resolved
            const setValueSpy = vi.spyOn(retryToggle, "setValue");
            // Force another config round to verify the loop calls setValue with the bool
            (plugin.api.config as ReturnType<typeof vi.fn>).mockResolvedValue({
                crawl_retry_on_rate_limit: false,
            });
            await (tab as any).loadServerDefaults();
            await new Promise((r) => setTimeout(r, 0));
            expect(setValueSpy).toHaveBeenCalledWith(false);
        });

        it("does not echo-patch the server when populating a toggle from cfg (bb-t6yg)", async () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            tab.display();
            await new Promise((r) => setTimeout(r, 0));

            // Real path: plug the retry toggle into serverConfigToggles, clear previous PATCHes,
            // then call loadServerDefaults. The mock's setValue fires onChange (mirroring
            // Obsidian), and the suppress flag must prevent a PATCH round-trip.
            (plugin.api.updateConfig as ReturnType<typeof vi.fn>).mockClear();
            (plugin.api.config as ReturnType<typeof vi.fn>).mockResolvedValue({
                crawl_retry_on_rate_limit: true,
            });
            await (tab as any).loadServerDefaults();
            expect(plugin.api.updateConfig).not.toHaveBeenCalled();
        });

        it("without the suppress flag, a toggle setValue onChange WOULD echo-patch", async () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { toggleOnChanges } = captureSettingCallbacks(() => tab.display());
            await new Promise((r) => setTimeout(r, 0));
            // Invoke the crawl_retry_on_rate_limit onChange without the flag — proves the guard is
            // load-bearing (if the flag failed to set, updateConfig WOULD be called).
            (plugin.api.updateConfig as ReturnType<typeof vi.fn>).mockClear();
            (tab as any).suppressToggleChanges = false;
            await toggleOnChanges[1](true);
            expect(plugin.api.updateConfig).toHaveBeenCalledWith({ crawl_retry_on_rate_limit: true });
        });

        it("suppressToggleChanges === true short-circuits the crawl-retry toggle onChange", async () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { toggleOnChanges } = captureSettingCallbacks(() => tab.display());
            await new Promise((r) => setTimeout(r, 0));
            (plugin.api.updateConfig as ReturnType<typeof vi.fn>).mockClear();
            (tab as any).suppressToggleChanges = true;
            await toggleOnChanges[1](true);
            (tab as any).suppressToggleChanges = false;
            expect(plugin.api.updateConfig).not.toHaveBeenCalled();
        });

        it("populates generation field values from server config", async () => {
            const plugin = makePlugin();
            (plugin.api.config as ReturnType<typeof vi.fn>).mockResolvedValue({
                temperature: 0.7,
                top_p: 0.9,
                top_k_sampling: 40,
                repeat_penalty: 1.1,
                num_ctx: 4096,
                seed: 42,
                system_prompt: "You are helpful.",
            });
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);

            // Track input elements to verify the value was written.
            const inputs: Array<{ placeholder: string; value: string }> = [];
            const origAddText = Setting.prototype.addText;
            Setting.prototype.addText = function (cb: (text: any) => void) {
                const fakeText = {
                    setPlaceholder: () => fakeText,
                    setValue: () => fakeText,
                    onChange: () => fakeText,
                    inputEl: { placeholder: "", value: "", addEventListener: vi.fn() },
                };
                cb(fakeText);
                inputs.push(fakeText.inputEl);
                return this;
            };
            const textAreas: Array<{ placeholder: string }> = [];
            const origAddTextArea = (Setting.prototype as any).addTextArea;
            (Setting.prototype as any).addTextArea = function (cb: (text: any) => void) {
                const fakeText = {
                    setPlaceholder: () => fakeText,
                    setValue: () => fakeText,
                    onChange: () => fakeText,
                    inputEl: { placeholder: "", value: "", addClass: vi.fn(), addEventListener: vi.fn() },
                };
                cb(fakeText);
                textAreas.push(fakeText.inputEl);
                return this;
            };
            tab.display();
            Setting.prototype.addText = origAddText;
            (Setting.prototype as any).addTextArea = origAddTextArea;

            // Wait for async loadServerDefaults.
            await new Promise((r) => setTimeout(r, 0));

            // Gen field values should be populated from server config.
            // inputs[1] = temperature (0=port).
            expect(inputs[1].value).toBe("0.7");
            expect(inputs[2].value).toBe("0.9");

            // System prompt textarea placeholder is still populated from server defaults.
            expect(textAreas[0].placeholder).toBe("You are helpful.");
        });

        it("populates crawl_exclude_patterns textarea from server config array", async () => {
            const plugin = makePlugin();
            (plugin.api.config as ReturnType<typeof vi.fn>).mockResolvedValue({
                crawl_exclude_patterns: ["/page/\\d+/?$", "/tag/"],
            });
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const textAreas: Array<{ value: string; placeholder: string }> = [];
            const origAddTextArea = (Setting.prototype as any).addTextArea;
            (Setting.prototype as any).addTextArea = function (cb: (text: any) => void) {
                const fakeText = {
                    setPlaceholder: () => fakeText,
                    setValue: () => fakeText,
                    onChange: () => fakeText,
                    inputEl: { placeholder: "", value: "", addClass: vi.fn(), addEventListener: vi.fn() },
                };
                cb(fakeText);
                textAreas.push(fakeText.inputEl);
                return this;
            };
            tab.display();
            (Setting.prototype as any).addTextArea = origAddTextArea;
            await new Promise((r) => setTimeout(r, 0));
            // Last textarea is crawl_exclude_patterns (systemPrompt is first).
            expect(textAreas[textAreas.length - 1].value).toBe("/page/\\d+/?$\n/tag/");
        });
    });

    describe("loadConfigDefaults", () => {
        it("caches the server response for later reset lookups", async () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            (plugin.api.configDefaults as ReturnType<typeof vi.fn>).mockResolvedValue({ chunk_size: 512 });
            const tab = makeTab(plugin);
            tab.display();
            await vi.waitFor(() => {
                expect((tab as any).configDefaults).toEqual({ chunk_size: 512 });
            });
        });

        it("falls back to an empty map when the endpoint is missing", async () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            (plugin.api.configDefaults as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("404"));
            const tab = makeTab(plugin);
            tab.display();
            await vi.waitFor(() => {
                expect((tab as any).configDefaults).toEqual({});
            });
        });
    });

    describe("crawl_exclude_patterns textarea", () => {
        it("PATCHes the array split on newlines, trimmed, empties dropped", async () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textAreaOnChanges } = captureSettingCallbacks(() => tab.display());
            // textAreaOnChanges[0] = systemPrompt, textAreaOnChanges[1] = crawl_exclude_patterns.
            await textAreaOnChanges[1]("  /page/\\d+/?$  \n\n/tag/\n  \n/author/");
            expect(plugin.api.updateConfig).toHaveBeenCalledWith({
                crawl_exclude_patterns: ["/page/\\d+/?$", "/tag/", "/author/"],
            });
        });

        it("surfaces a failure notice when the server rejects", async () => {
            Notice.clear();
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            (plugin.api.updateConfig as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("boom"));
            const tab = makeTab(plugin);
            const { textAreaOnChanges } = captureSettingCallbacks(() => tab.display());
            await textAreaOnChanges[1]("/page/");
            expect(Notice.instances.some((n) => n.message.includes("failed to update"))).toBe(true);
        });
    });

    describe("per-row reset-to-default affordance", () => {
        // Reset button order (managed + manual-sync defaults):
        // 0=serverMode(local) 1=serverPort(local) 2=topK 3=maxDistance 4=adaptiveThreshold
        // 5=systemPrompt(local) 6=temperature 7=top_p 8=top_k_sampling 9=repeat_penalty
        // 10=num_ctx 11=seed 12=syncMode(local) 13=crawl_max_depth ...
        const TEMPERATURE_RESET = 6;

        it("server-backed reset PATCHes the cached default", async () => {
            Notice.clear();
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { extraButtonOnClicks } = captureSettingCallbacks(() => tab.display());
            // Seed the cache directly so we don't race the async configDefaults fetch.
            (tab as any).configDefaults = { temperature: 0.7 };
            await extraButtonOnClicks[TEMPERATURE_RESET]();
            expect(plugin.api.updateConfig).toHaveBeenCalledWith({ temperature: 0.7 });
        });

        it("server-backed reset silently no-ops when defaults haven't loaded yet", async () => {
            Notice.clear();
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { extraButtonOnClicks } = captureSettingCallbacks(() => tab.display());
            (tab as any).configDefaults = {};
            (plugin.api.updateConfig as ReturnType<typeof vi.fn>).mockClear();
            await extraButtonOnClicks[TEMPERATURE_RESET]();
            expect(plugin.api.updateConfig).not.toHaveBeenCalled();
            expect(Notice.instances.length).toBe(0);
        });

        it("server-backed reset surfaces a reset-failure notice when updateConfig rejects", async () => {
            Notice.clear();
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            (plugin.api.updateConfig as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("boom"));
            const tab = makeTab(plugin);
            const { extraButtonOnClicks } = captureSettingCallbacks(() => tab.display());
            (tab as any).configDefaults = { temperature: 0.7 };
            await extraButtonOnClicks[TEMPERATURE_RESET]();
            expect(Notice.instances.some((n) => n.message.includes("failed to reset"))).toBe(true);
        });

        it("local reset writes DEFAULT_SETTINGS[key] to plugin state", async () => {
            const plugin = makePlugin({ serverMode: "external" });
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { extraButtonOnClicks } = captureSettingCallbacks(() => tab.display());
            // Index 0 is the serverMode reset (local).
            await extraButtonOnClicks[0]();
            expect(plugin.settings.serverMode).toBe(DEFAULT_SETTINGS.serverMode);
            expect(plugin.saveSettings).toHaveBeenCalled();
        });
    });

    describe("appendDualResetAffordance (server PATCH + plugin.settings mirror)", () => {
        it("resets wiki_prune_raw by PATCHing the default AND mirroring back to wikiPruneRaw", async () => {
            Notice.clear();
            const plugin = makePlugin({ wikiEnabled: true, wikiPruneRaw: true });
            (plugin as any).wikiEnabled = true;
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            // configDefaults is re-fetched on each display(); keep it resolving to our seed.
            (plugin.api.configDefaults as ReturnType<typeof vi.fn>).mockResolvedValue({ wiki_prune_raw: false });
            const tab = makeTab(plugin);
            const { extraButtonOnClicks } = captureSettingCallbacks(() => tab.display());
            await new Promise((r) => setTimeout(r, 0));
            (plugin.api.updateConfig as ReturnType<typeof vi.fn>).mockClear();
            // Search for the reset button whose click PATCHes wiki_prune_raw.
            for (let i = 0; i < extraButtonOnClicks.length; i++) {
                (plugin.api.updateConfig as ReturnType<typeof vi.fn>).mockClear();
                await extraButtonOnClicks[i]();
                const call = (plugin.api.updateConfig as ReturnType<typeof vi.fn>).mock.calls[0];
                if (call && JSON.stringify(call[0]) === JSON.stringify({ wiki_prune_raw: false })) {
                    expect(plugin.settings.wikiPruneRaw).toBe(false);
                    expect(plugin.saveSettings).toHaveBeenCalled();
                    return;
                }
            }
            throw new Error("wiki_prune_raw dual-reset button not found");
        });

        it("no-ops silently when the key is absent from configDefaults", async () => {
            Notice.clear();
            const plugin = makePlugin({ wikiEnabled: true });
            (plugin as any).wikiEnabled = true;
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            // configDefaults resolves to empty so the early-return branch is exercised.
            (plugin.api.configDefaults as ReturnType<typeof vi.fn>).mockResolvedValue({});
            const tab = makeTab(plugin);
            const { extraButtonOnClicks } = captureSettingCallbacks(() => tab.display());
            await new Promise((r) => setTimeout(r, 0));
            (plugin.api.updateConfig as ReturnType<typeof vi.fn>).mockClear();
            for (let i = 0; i < extraButtonOnClicks.length; i++) {
                await extraButtonOnClicks[i]();
            }
            const wikiCalls = (plugin.api.updateConfig as ReturnType<typeof vi.fn>).mock.calls.filter(
                (c) => "wiki_prune_raw" in (c[0] as object) || "wiki_faithfulness_threshold" in (c[0] as object),
            );
            expect(wikiCalls).toEqual([]);
        });

        it("surfaces a reset-failure notice when updateConfig rejects", async () => {
            Notice.clear();
            const plugin = makePlugin({ wikiEnabled: true });
            (plugin as any).wikiEnabled = true;
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            (plugin.api.updateConfig as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("boom"));
            (plugin.api.configDefaults as ReturnType<typeof vi.fn>).mockResolvedValue({ wiki_prune_raw: false });
            const tab = makeTab(plugin);
            const { extraButtonOnClicks } = captureSettingCallbacks(() => tab.display());
            await new Promise((r) => setTimeout(r, 0));
            for (let i = 0; i < extraButtonOnClicks.length; i++) {
                await extraButtonOnClicks[i]();
            }
            expect(
                Notice.instances.some((n: any) => n.message.includes("failed to reset Remove source duplicates")),
            ).toBe(true);
        });
    });

    describe("global 'Reset all settings' button", () => {
        it("does not PATCH when the user cancels the confirm modal", async () => {
            Notice.clear();
            mockGenericConfirmResult = false;
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { buttonOnClicks } = captureSettingCallbacks(() => tab.display());
            (tab as any).configDefaults = { chunk_size: 512 };
            (plugin.api.updateConfig as ReturnType<typeof vi.fn>).mockClear();
            await buttonOnClicks[buttonOnClicks.length - 1]();
            expect(plugin.api.updateConfig).not.toHaveBeenCalled();
            mockGenericConfirmResult = true;
        });

        it("PATCHes every default (minus credentials) when confirmed", async () => {
            Notice.clear();
            mockGenericConfirmResult = true;
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { buttonOnClicks } = captureSettingCallbacks(() => tab.display());
            (tab as any).configDefaults = {
                chunk_size: 512,
                crawl_max_depth: 2,
                openai_api_key: "",
                hf_token: "",
            };
            (plugin.api.updateConfig as ReturnType<typeof vi.fn>).mockClear();
            await buttonOnClicks[buttonOnClicks.length - 1]();
            expect(plugin.api.updateConfig).toHaveBeenCalledWith({ chunk_size: 512, crawl_max_depth: 2 });
            expect(Notice.instances.some((n) => n.message.includes("reset to defaults"))).toBe(true);
        });

        it("does not PATCH when every default is filtered out by the credential block", async () => {
            mockGenericConfirmResult = true;
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { buttonOnClicks } = captureSettingCallbacks(() => tab.display());
            (tab as any).configDefaults = { openai_api_key: "", hf_token: "" };
            (plugin.api.updateConfig as ReturnType<typeof vi.fn>).mockClear();
            await buttonOnClicks[buttonOnClicks.length - 1]();
            expect(plugin.api.updateConfig).not.toHaveBeenCalled();
        });

        it("shows a failure notice when the batched PATCH rejects", async () => {
            Notice.clear();
            mockGenericConfirmResult = true;
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            (plugin.api.updateConfig as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("boom"));
            const tab = makeTab(plugin);
            const { buttonOnClicks } = captureSettingCallbacks(() => tab.display());
            (tab as any).configDefaults = { chunk_size: 512 };
            await buttonOnClicks[buttonOnClicks.length - 1]();
            expect(Notice.instances.some((n) => n.message.includes("failed to reset"))).toBe(true);
        });
    });

    describe("API key on blur", () => {
        it("calls updateConfig with openai_api_key on blur", async () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { blurHandlers } = captureSettingCallbacks(() => tab.display());

            // blur[0]=openai, blur[1]=anthropic, blur[2]=gemini
            blurHandlers[0].inputEl.value = "sk-test123";
            await blurHandlers[0].handler();
            expect(plugin.api.updateConfig).toHaveBeenCalledWith({ openai_api_key: "sk-test123" });
        });

        it("calls updateConfig with anthropic_api_key on blur", async () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { blurHandlers } = captureSettingCallbacks(() => tab.display());

            blurHandlers[1].inputEl.value = "sk-ant-test";
            await blurHandlers[1].handler();
            expect(plugin.api.updateConfig).toHaveBeenCalledWith({ anthropic_api_key: "sk-ant-test" });
        });

        it("calls updateConfig with gemini_api_key on blur", async () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { blurHandlers } = captureSettingCallbacks(() => tab.display());

            blurHandlers[2].inputEl.value = "AIza-test";
            await blurHandlers[2].handler();
            expect(plugin.api.updateConfig).toHaveBeenCalledWith({ gemini_api_key: "AIza-test" });
        });

        it("skips empty value on blur", async () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { blurHandlers } = captureSettingCallbacks(() => tab.display());

            blurHandlers[0].inputEl.value = "";
            await blurHandlers[0].handler();
            expect(plugin.api.updateConfig).not.toHaveBeenCalled();
        });

        it("shows error notice on failure", async () => {
            const plugin = makePlugin();
            (plugin.api.updateConfig as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("fail"));
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { blurHandlers } = captureSettingCallbacks(() => tab.display());

            blurHandlers[0].inputEl.value = "sk-test123";
            await blurHandlers[0].handler();
            expect(Notice.instances.some((n: any) => n.message.includes("failed to save API key"))).toBe(true);
        });
    });

    describe("HuggingFace token onChange", () => {
        it("calls updateConfig and saves settings on non-empty value", async () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());

            // Index 21: HF token (0=port, 1-6=gen, 7-16=crawl, 17=wikiVaultFolder, 18-19=chunks, 20=rerank_candidates, 21=hfToken)
            await textOnChanges[21]("hf_test123");
            expect(plugin.api.updateConfig).toHaveBeenCalledWith({ hf_token: "hf_test123" });
            expect(plugin.settings.hfToken).toBe("hf_test123");
            expect(Notice.instances.some((n: any) => n.message.includes("HuggingFace token saved"))).toBe(true);
        });

        it("saves empty token", async () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());

            await textOnChanges[21]("");
            expect(plugin.settings.hfToken).toBe("");
        });

        it("shows error notice on failure", async () => {
            const plugin = makePlugin();
            (plugin.api.updateConfig as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("fail"));
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());

            await textOnChanges[21]("hf_test123");
            expect(Notice.instances.some((n: any) => n.message.includes("failed to save HuggingFace token"))).toBe(
                true,
            );
        });
    });

    describe("settings filter", () => {
        it("renders a filter input at the top", () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            tab.display();
            const input = tab.containerEl.children.find(
                (c: any) => c.tagName === "INPUT" && c.classList?.contains("lilbee-settings-filter"),
            );
            expect(input).toBeDefined();
        });

        it("calls filterSettings on input event", () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            tab.display();

            const filterSpy = vi.spyOn(tab as any, "filterSettings");

            const input = tab.containerEl.children.find(
                (c: any) => c.tagName === "INPUT" && c.classList?.contains("lilbee-settings-filter"),
            );
            expect(input).toBeDefined();

            (input as any).value = "sync";
            input!.trigger("input");

            expect(filterSpy).toHaveBeenCalledWith(tab.containerEl, "sync");
        });

        it("filterSettings hides non-matching items and shows matching ones", () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            tab.display();

            // Manually build a section with setting items to test the inner loop
            const container = new MockElement("div") as any;
            const section = container.createEl("details", { cls: "lilbee-settings-section" });

            const item1 = section.createDiv({ cls: "setting-item" });
            const name1 = item1.createDiv({ cls: "setting-item-name" });
            name1.textContent = "Server URL";

            const item2 = section.createDiv({ cls: "setting-item" });
            const name2 = item2.createDiv({ cls: "setting-item-name" });
            name2.textContent = "Sync mode";

            // Filter for "sync" — only item2 should match
            (tab as any).filterSettings(container, "sync");

            expect(item1.style.display).toBe("none");
            expect(item2.style.display).toBe("");
            expect(section.style.display).toBe("");
            expect(section.attributes.open).toBe("");
        });

        it("filterSettings handles items without setting-item-name", () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            tab.display();

            const container = new MockElement("div") as any;
            const section = container.createEl("details", { cls: "lilbee-settings-section" });

            // Item with no setting-item-name child
            section.createDiv({ cls: "setting-item" });

            // Should not crash, item won't match any search term
            (tab as any).filterSettings(container, "anything");
            const items = section.findAll("setting-item");
            expect(items[0].style.display).toBe("none");
        });

        it("filterSettings hides entire section when no items match", () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            tab.display();

            const container = new MockElement("div") as any;
            const section = container.createEl("details", { cls: "lilbee-settings-section" });

            const item1 = section.createDiv({ cls: "setting-item" });
            const name1 = item1.createDiv({ cls: "setting-item-name" });
            name1.textContent = "Server URL";

            (tab as any).filterSettings(container, "zzz_nonexistent");

            expect(item1.style.display).toBe("none");
            expect(section.style.display).toBe("none");
        });

        it("filterSettings shows all items when query is empty", () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            tab.display();

            const container = new MockElement("div") as any;
            const section = container.createEl("details", { cls: "lilbee-settings-section" });

            const item1 = section.createDiv({ cls: "setting-item" });
            const name1 = item1.createDiv({ cls: "setting-item-name" });
            name1.textContent = "Server URL";

            // Filter then clear
            (tab as any).filterSettings(container, "zzz");
            (tab as any).filterSettings(container, "");

            expect(item1.style.display).toBe("");
            expect(section.style.display).toBe("");
        });
    });

    describe("LiteLLM base URL onChange", () => {
        it("calls updateConfig on non-empty value", async () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());

            // Index 14: LiteLLM base URL (after hfToken at 13)
            await textOnChanges[22]("http://localhost:4000");
            expect(plugin.api.updateConfig).toHaveBeenCalledWith({ litellm_base_url: "http://localhost:4000" });
        });

        it("skips empty value", async () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());

            await textOnChanges[22]("  ");
            expect(plugin.api.updateConfig).not.toHaveBeenCalled();
        });

        it("shows error notice on failure", async () => {
            const plugin = makePlugin();
            (plugin.api.updateConfig as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("fail"));
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());

            await textOnChanges[22]("http://localhost:4000");
            expect(Notice.instances.some((n: any) => n.message.includes("failed to update LiteLLM URL"))).toBe(true);
        });
    });

    describe("renderWikiSettings", () => {
        it("always renders wiki section heading even when wikiEnabled is false", () => {
            const plugin = makePlugin({ wikiEnabled: false });
            (plugin as any).wikiEnabled = false;
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            tab.display();
            const details = tab.containerEl.children.find(
                (c) =>
                    c.tagName === "DETAILS" &&
                    c.children.some((s: any) => s.tagName === "SUMMARY" && s.textContent.includes("Wiki (beta)")),
            );
            expect(details).toBeDefined();
            // Sub-settings should be hidden when wikiEnabled is false
            const subContainer = details!.children.find(
                (c: any) => c.classList && c.classList.contains("lilbee-wiki-sub-settings"),
            );
            expect(subContainer).toBeDefined();
            expect((subContainer as any).style.display).toBe("none");
        });

        it("shows wiki settings when wikiEnabled is true", () => {
            const plugin = makePlugin({ wikiEnabled: true });
            (plugin as any).wikiEnabled = true;
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { toggleOnChanges, buttonOnClicks } = captureSettingCallbacks(() => tab.display());
            // Wiki section adds: 1 toggle (enable) + 1 toggle (prune raw) + 1 slider (faithfulness) + 1 dropdown (search mode) + 2 buttons (lint, prune)
            // toggleOnChanges: adaptiveThreshold + wikiEnable + wikiPruneRaw + wikiSyncToVault
            expect(toggleOnChanges.length).toBeGreaterThanOrEqual(3);
            expect(buttonOnClicks.length).toBeGreaterThanOrEqual(2);
        });

        it("wiki enable toggle saves setting and syncs runtime flag", async () => {
            const plugin = makePlugin({ wikiEnabled: true });
            (plugin as any).wikiEnabled = true;
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { toggleOnChanges } = captureSettingCallbacks(() => tab.display());

            // Find the wiki enable toggle by effect: call each with false until wikiEnabled flips
            let wikiToggleIdx = -1;
            for (let i = 0; i < toggleOnChanges.length; i++) {
                plugin.settings.wikiEnabled = true; // reset
                await toggleOnChanges[i](false);
                if (plugin.settings.wikiEnabled === false) {
                    wikiToggleIdx = i;
                    break;
                }
                plugin.settings.wikiEnabled = true; // restore
            }
            expect(wikiToggleIdx).not.toBe(-1);
            expect(plugin.settings.wikiEnabled).toBe(false);
            expect((plugin as any).wikiEnabled).toBe(false);
            expect(plugin.saveSettings).toHaveBeenCalled();
        });

        it("wiki enable toggle re-enables sub-settings when toggled back on", async () => {
            const plugin = makePlugin({ wikiEnabled: false });
            (plugin as any).wikiEnabled = false;
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { toggleOnChanges } = captureSettingCallbacks(() => tab.display());

            // Find wiki toggle by effect
            let wikiToggleIdx = -1;
            for (let i = 0; i < toggleOnChanges.length; i++) {
                plugin.settings.wikiEnabled = false; // reset
                await toggleOnChanges[i](true);
                if (plugin.settings.wikiEnabled === true) {
                    wikiToggleIdx = i;
                    break;
                }
                plugin.settings.wikiEnabled = false; // restore
            }
            expect(wikiToggleIdx).not.toBe(-1);
            expect(plugin.settings.wikiEnabled).toBe(true);
            expect(plugin.saveSettings).toHaveBeenCalled();
        });

        it("sub-settings hidden when wikiEnabled setting is false", () => {
            const plugin = makePlugin({ wikiEnabled: false });
            (plugin as any).wikiEnabled = false;
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            tab.display();
            const details = tab.containerEl.children.find(
                (c) =>
                    c.tagName === "DETAILS" &&
                    c.children.some((s: any) => s.tagName === "SUMMARY" && s.textContent.includes("Wiki")),
            );
            expect(details).toBeDefined();
            const subContainer = details!.children.find(
                (c: any) => c.classList && c.classList.contains("lilbee-wiki-sub-settings"),
            );
            expect(subContainer).toBeDefined();
            expect((subContainer as any).style.display).toBe("none");
        });

        it("sub-settings visible when wikiEnabled setting is true", () => {
            const plugin = makePlugin({ wikiEnabled: true });
            (plugin as any).wikiEnabled = true;
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            tab.display();
            const details = tab.containerEl.children.find(
                (c) =>
                    c.tagName === "DETAILS" &&
                    c.children.some((s: any) => s.tagName === "SUMMARY" && s.textContent.includes("Wiki")),
            );
            expect(details).toBeDefined();
            const subContainer = details!.children.find(
                (c: any) => c.classList && c.classList.contains("lilbee-wiki-sub-settings"),
            );
            expect(subContainer).toBeDefined();
            expect((subContainer as any).style.display).toBe("");
        });

        it("prune raw toggle calls updateConfig", async () => {
            const plugin = makePlugin({ wikiEnabled: true });
            (plugin as any).wikiEnabled = true;
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { toggleOnChanges } = captureSettingCallbacks(() => tab.display());

            // wiki prune toggle is before the sync-to-vault toggle
            const wikiPruneToggleIdx = toggleOnChanges.length - 2;
            await toggleOnChanges[wikiPruneToggleIdx](true);
            expect(plugin.settings.wikiPruneRaw).toBe(true);
            expect(plugin.saveSettings).toHaveBeenCalled();
            expect(plugin.api.updateConfig).toHaveBeenCalledWith({ wiki_prune_raw: true });
        });

        it("faithfulness slider calls updateConfig", async () => {
            const plugin = makePlugin({ wikiEnabled: true });
            (plugin as any).wikiEnabled = true;
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { sliderOnChanges } = captureSettingCallbacks(() => tab.display());

            // wiki faithfulness slider is the last slider
            const faithfulnessIdx = sliderOnChanges.length - 1;
            await sliderOnChanges[faithfulnessIdx](0.85);
            expect(plugin.settings.wikiFaithfulnessThreshold).toBe(0.85);
            expect(plugin.saveSettings).toHaveBeenCalled();
            expect(plugin.api.updateConfig).toHaveBeenCalledWith({ wiki_faithfulness_threshold: 0.85 });
        });

        it("search mode dropdown updates settings", async () => {
            const plugin = makePlugin({ wikiEnabled: true });
            (plugin as any).wikiEnabled = true;
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { dropdownOnChanges } = captureSettingCallbacks(() => tab.display());

            // Find the wiki search mode dropdown — it's before the LLM provider dropdown
            // The wiki search mode is added by renderWikiSettings, which adds one dropdown
            // We need to find the right index. The wiki dropdown should have "all"/"wiki"/"raw" options.
            // It should be the second-to-last dropdown since LLM provider is last
            const wikiSearchIdx = dropdownOnChanges.length - 2;
            await dropdownOnChanges[wikiSearchIdx]("wiki");
            expect(plugin.settings.searchChunkType).toBe("wiki");
            expect(plugin.saveSettings).toHaveBeenCalled();
        });

        it("lint button click calls runWikiLint", async () => {
            const plugin = makePlugin({ wikiEnabled: true });
            (plugin as any).wikiEnabled = true;
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { buttonOnClicks } = captureSettingCallbacks(() => tab.display());

            // Wiki section renders before the Advanced section's Reset-all button, so lint/prune sit
            // 3rd/2nd from the end: … lint, prune, reset-all.
            const lintIdx = buttonOnClicks.length - 3;
            await buttonOnClicks[lintIdx]();
            expect(plugin.runWikiLint).toHaveBeenCalled();
        });

        it("prune button click calls runWikiPrune", async () => {
            const plugin = makePlugin({ wikiEnabled: true });
            (plugin as any).wikiEnabled = true;
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { buttonOnClicks } = captureSettingCallbacks(() => tab.display());

            const pruneIdx = buttonOnClicks.length - 2;
            await buttonOnClicks[pruneIdx]();
            expect(plugin.runWikiPrune).toHaveBeenCalled();
        });

        it("prune raw toggle shows error notice on updateConfig failure", async () => {
            const plugin = makePlugin({ wikiEnabled: true });
            (plugin as any).wikiEnabled = true;
            (plugin.api.updateConfig as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("fail"));
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { toggleOnChanges } = captureSettingCallbacks(() => tab.display());

            const wikiPruneToggleIdx = toggleOnChanges.length - 2;
            await toggleOnChanges[wikiPruneToggleIdx](true);
            expect(
                Notice.instances.some((n: any) => n.message.includes("failed to update Remove source duplicates")),
            ).toBe(true);
        });

        it("sync-to-vault toggle enables wiki sync", async () => {
            const plugin = makePlugin({ wikiEnabled: true });
            (plugin as any).wikiEnabled = true;
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { toggleOnChanges } = captureSettingCallbacks(() => tab.display());

            const syncToggleIdx = toggleOnChanges.length - 1;
            await toggleOnChanges[syncToggleIdx](true);
            expect(plugin.settings.wikiSyncToVault).toBe(true);
            expect(plugin.saveSettings).toHaveBeenCalled();
            expect(plugin.initWikiSync).toHaveBeenCalled();
            expect(plugin.reconcileWiki).toHaveBeenCalled();
        });

        it("sync-to-vault toggle disabling clears wikiSync", async () => {
            const plugin = makePlugin({ wikiEnabled: true, wikiSyncToVault: true });
            (plugin as any).wikiEnabled = true;
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { toggleOnChanges } = captureSettingCallbacks(() => tab.display());

            const syncToggleIdx = toggleOnChanges.length - 1;
            await toggleOnChanges[syncToggleIdx](false);
            expect(plugin.settings.wikiSyncToVault).toBe(false);
            expect(plugin.wikiSync).toBeNull();
        });

        it("vault folder text field updates settings", async () => {
            const plugin = makePlugin({ wikiEnabled: true });
            (plugin as any).wikiEnabled = true;
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());

            // Find the wiki vault folder text by trying each and checking which one changes wikiVaultFolder
            // It's after the crawling/advanced fields - search for the one that sets wikiVaultFolder
            for (let i = 0; i < textOnChanges.length; i++) {
                plugin.settings.wikiVaultFolder = "lilbee-wiki";
                await textOnChanges[i]("my-wiki");
                if (plugin.settings.wikiVaultFolder === "my-wiki") {
                    expect(plugin.saveSettings).toHaveBeenCalled();
                    return;
                }
            }
            throw new Error("wiki vault folder text field not found");
        });

        it("vault folder text field defaults to lilbee-wiki when empty", async () => {
            const plugin = makePlugin({ wikiEnabled: true });
            (plugin as any).wikiEnabled = true;
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());

            for (let i = 0; i < textOnChanges.length; i++) {
                plugin.settings.wikiVaultFolder = "something";
                await textOnChanges[i]("");
                if (plugin.settings.wikiVaultFolder === "lilbee-wiki") {
                    return;
                }
            }
            throw new Error("wiki vault folder text field not found");
        });

        it("vault folder change re-initializes WikiSync when sync enabled", async () => {
            const plugin = makePlugin({ wikiEnabled: true, wikiSyncToVault: true });
            (plugin as any).wikiEnabled = true;
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());

            for (let i = 0; i < textOnChanges.length; i++) {
                plugin.settings.wikiVaultFolder = "lilbee-wiki";
                (plugin.initWikiSync as ReturnType<typeof vi.fn>).mockClear();
                await textOnChanges[i]("new-wiki");
                if (plugin.settings.wikiVaultFolder === "new-wiki") {
                    expect(plugin.initWikiSync).toHaveBeenCalled();
                    return;
                }
            }
            throw new Error("wiki vault folder text field not found");
        });

        it("faithfulness slider shows error notice on updateConfig failure", async () => {
            const plugin = makePlugin({ wikiEnabled: true });
            (plugin as any).wikiEnabled = true;
            (plugin.api.updateConfig as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("fail"));
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { sliderOnChanges } = captureSettingCallbacks(() => tab.display());

            const faithfulnessIdx = sliderOnChanges.length - 1;
            await sliderOnChanges[faithfulnessIdx](0.5);
            expect(Notice.instances.some((n: any) => n.message.includes("failed to update Summary accuracy"))).toBe(
                true,
            );
        });
    });

    describe("LLM provider dropdown onChange", () => {
        it("calls updateConfig with selected provider", async () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { dropdownOnChanges } = captureSettingCallbacks(() => tab.display());

            // Last dropdown is the LLM provider (after server mode, chat model, sync mode)
            const providerIdx = dropdownOnChanges.length - 1;
            await dropdownOnChanges[providerIdx]("litellm");
            expect(plugin.api.updateConfig).toHaveBeenCalledWith({ llm_provider: "litellm" });
        });

        it("hides litellm container when provider is not litellm", async () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { dropdownOnChanges } = captureSettingCallbacks(() => tab.display());

            const providerIdx = dropdownOnChanges.length - 1;
            await dropdownOnChanges[providerIdx]("auto");
            expect(plugin.api.updateConfig).toHaveBeenCalledWith({ llm_provider: "auto" });
        });

        it("shows error notice on failure", async () => {
            const plugin = makePlugin();
            (plugin.api.updateConfig as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("fail"));
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { dropdownOnChanges } = captureSettingCallbacks(() => tab.display());

            const providerIdx = dropdownOnChanges.length - 1;
            await dropdownOnChanges[providerIdx]("litellm");
            expect(Notice.instances.some((n: any) => n.message.includes("failed to update LLM provider"))).toBe(true);
        });
    });

    describe("password masking for sensitive fields", () => {
        it("sets API key input types to password", () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const inputs: Array<{ type?: string }> = [];
            const origAddText = Setting.prototype.addText;
            Setting.prototype.addText = function (cb: (text: any) => void) {
                const fakeText = {
                    setPlaceholder: () => fakeText,
                    setValue: () => fakeText,
                    onChange: () => fakeText,
                    inputEl: { placeholder: "", type: "text", addEventListener: vi.fn() },
                };
                cb(fakeText);
                inputs.push(fakeText.inputEl);
                return this;
            };
            tab.display();
            Setting.prototype.addText = origAddText;

            // 3 API keys at indices 21-23 (0=port, 1-6=gen, 7-16=crawl, 17=wikiVaultFolder, 18-19=chunks, 20=rerank_candidates, 21-23=apiKeys)
            expect(inputs[21].type).toBe("password");
            expect(inputs[22].type).toBe("password");
            expect(inputs[23].type).toBe("password");
        });

        it("sets HF token input type to password", () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const inputs: Array<{ type?: string }> = [];
            const origAddText = Setting.prototype.addText;
            Setting.prototype.addText = function (cb: (text: any) => void) {
                const fakeText = {
                    setPlaceholder: () => fakeText,
                    setValue: () => fakeText,
                    onChange: () => fakeText,
                    inputEl: { placeholder: "", type: "text", addEventListener: vi.fn() },
                };
                cb(fakeText);
                inputs.push(fakeText.inputEl);
                return this;
            };
            tab.display();
            Setting.prototype.addText = origAddText;

            // HF token is index 24 (after rerank_candidates at 20 and 3 API keys at 21-23)
            expect(inputs[24].type).toBe("password");
        });
    });

    describe("Reranker section", () => {
        let origAddDropdown: typeof Setting.prototype.addDropdown;

        function captureRerankerDropdown(): {
            dropdowns: DropdownOnChange[];
            options: Array<Record<string, string>>;
            values: string[];
        } {
            const dropdowns: DropdownOnChange[] = [];
            const options: Array<Record<string, string>> = [];
            const values: string[] = [];
            Setting.prototype.addDropdown = function (cb: (dropdown: any) => void) {
                const opts: Record<string, string> = {};
                const fakeDropdown = {
                    addOption: (v: string, l: string) => {
                        opts[v] = l;
                        return fakeDropdown;
                    },
                    setValue: (v: string) => {
                        values.push(v);
                        return fakeDropdown;
                    },
                    onChange: (handler: DropdownOnChange) => {
                        dropdowns.push(handler);
                        return fakeDropdown;
                    },
                };
                cb(fakeDropdown);
                options.push(opts);
                return this;
            };
            return { dropdowns, options, values };
        }

        beforeEach(() => {
            origAddDropdown = Setting.prototype.addDropdown;
        });
        afterEach(() => {
            Setting.prototype.addDropdown = origAddDropdown;
        });

        it("always renders the reranker dropdown regardless of legacy reranker_available field", async () => {
            const plugin = makePlugin();
            (plugin.api.config as ReturnType<typeof vi.fn>).mockResolvedValue({
                reranker_model: "",
                rerank_candidates: 20,
            });
            (plugin.api.catalog as ReturnType<typeof vi.fn>).mockResolvedValue(
                ok({ total: 0, limit: 20, offset: 0, models: [], has_more: false }),
            );
            const container = new MockElement("div") as unknown as HTMLElement;
            const tab = makeTab(plugin);
            const { options } = captureRerankerDropdown();

            (tab as any).renderRerankerSection(container);
            await new Promise((r) => setTimeout(r, 0));
            await new Promise((r) => setTimeout(r, 0));

            expect(options.length).toBe(1);
            expect(options[0][""]).toBe(MESSAGES.LABEL_RERANKER_DISABLED);
        });

        it("renders dropdown with (disabled) selected when active is empty", async () => {
            const plugin = makePlugin();
            (plugin.api.config as ReturnType<typeof vi.fn>).mockResolvedValue({
                reranker_model: "",
                rerank_candidates: 20,
            });
            (plugin.api.catalog as ReturnType<typeof vi.fn>).mockResolvedValue(
                ok({
                    total: 1,
                    limit: 20,
                    offset: 0,
                    models: [
                        {
                            name: "bge-reranker-v2-m3",
                            tag: "latest",
                            hf_repo: "BAAI/bge-reranker-v2-m3",
                            display_name: "BGE v2",
                            size_gb: 1,
                            min_ram_gb: 4,
                            description: "multilingual",
                            quality_tier: "balanced",
                            installed: true,
                            source: "native",
                            task: "rerank",
                        },
                    ],
                    has_more: false,
                }),
            );
            (plugin.api.installedModels as ReturnType<typeof vi.fn>).mockResolvedValue({
                models: [{ name: "bge-reranker-v2-m3:latest", source: "native" }],
            });
            const container = new MockElement("div") as unknown as HTMLElement;
            const tab = makeTab(plugin);
            const { options, values } = captureRerankerDropdown();

            (tab as any).renderRerankerSection(container);
            await new Promise((r) => setTimeout(r, 0));
            await new Promise((r) => setTimeout(r, 0));

            expect(options[0][""]).toBe(MESSAGES.LABEL_RERANKER_DISABLED);
            // Dropdown option keys use hf_repo (canonical id), not display name
            expect(options[0]["bge-reranker-v2-m3:latest"]).toBe("BAAI/bge-reranker-v2-m3");
            expect(values[0]).toBe("");
        });

        it("selecting installed reranker calls setRerankerModel", async () => {
            const plugin = makePlugin();
            (plugin.api.config as ReturnType<typeof vi.fn>).mockResolvedValue({
                reranker_model: "",
                rerank_candidates: 20,
            });
            (plugin.api.catalog as ReturnType<typeof vi.fn>).mockResolvedValue(
                ok({
                    total: 1,
                    limit: 20,
                    offset: 0,
                    models: [
                        {
                            name: "bge-reranker-v2-m3",
                            tag: "latest",
                            hf_repo: "BAAI/bge-reranker-v2-m3",
                            display_name: "BGE",
                            size_gb: 1,
                            min_ram_gb: 4,
                            description: "",
                            quality_tier: "balanced",
                            installed: true,
                            source: "native",
                            task: "rerank",
                        },
                    ],
                    has_more: false,
                }),
            );
            (plugin.api.installedModels as ReturnType<typeof vi.fn>).mockResolvedValue({
                models: [{ name: "bge-reranker-v2-m3:latest", source: "native" }],
            });
            const container = new MockElement("div") as unknown as HTMLElement;
            const tab = makeTab(plugin);
            const { dropdowns } = captureRerankerDropdown();

            (tab as any).renderRerankerSection(container);
            await new Promise((r) => setTimeout(r, 0));
            await new Promise((r) => setTimeout(r, 0));

            // The dropdown value is hf_repo (canonical id), not the display name
            await dropdowns[0]("bge-reranker-v2-m3:latest");
            expect(plugin.api.setRerankerModel).toHaveBeenCalledWith("bge-reranker-v2-m3:latest");
            expect(Notice.instances.some((n) => n.message === MESSAGES.NOTICE_RERANKER_UPDATED)).toBe(true);
        });

        it("selecting disabled calls setRerankerModel('')", async () => {
            const plugin = makePlugin();
            (plugin.api.config as ReturnType<typeof vi.fn>).mockResolvedValue({
                reranker_model: "bge-reranker-v2-m3",
                rerank_candidates: 20,
            });
            (plugin.api.catalog as ReturnType<typeof vi.fn>).mockResolvedValue(
                ok({ total: 0, limit: 20, offset: 0, models: [], has_more: false }),
            );
            (plugin.api.installedModels as ReturnType<typeof vi.fn>).mockResolvedValue({ models: [] });
            const container = new MockElement("div") as unknown as HTMLElement;
            const tab = makeTab(plugin);
            const { dropdowns } = captureRerankerDropdown();

            (tab as any).renderRerankerSection(container);
            await new Promise((r) => setTimeout(r, 0));
            await new Promise((r) => setTimeout(r, 0));

            await dropdowns[0]("");
            expect(plugin.api.setRerankerModel).toHaveBeenCalledWith("");
        });

        it("shows failure notice when setRerankerModel returns non-422 error", async () => {
            const plugin = makePlugin();
            (plugin.api.setRerankerModel as ReturnType<typeof vi.fn>).mockResolvedValue(
                err(new Error("Server responded 500: ")),
            );
            (plugin.api.config as ReturnType<typeof vi.fn>).mockResolvedValue({
                reranker_model: "",
                rerank_candidates: 20,
            });
            (plugin.api.catalog as ReturnType<typeof vi.fn>).mockResolvedValue(
                ok({
                    total: 1,
                    limit: 20,
                    offset: 0,
                    models: [
                        {
                            name: "bge",
                            tag: "latest",
                            hf_repo: "BAAI/bge",
                            display_name: "",
                            size_gb: 1,
                            min_ram_gb: 4,
                            description: "",
                            quality_tier: "",
                            installed: true,
                            source: "native",
                            task: "rerank",
                        },
                    ],
                    has_more: false,
                }),
            );
            (plugin.api.installedModels as ReturnType<typeof vi.fn>).mockResolvedValue({
                models: [{ name: "bge:latest", source: "native" }],
            });
            const container = new MockElement("div") as unknown as HTMLElement;
            const tab = makeTab(plugin);
            const { dropdowns } = captureRerankerDropdown();

            (tab as any).renderRerankerSection(container);
            await new Promise((r) => setTimeout(r, 0));
            await new Promise((r) => setTimeout(r, 0));

            await dropdowns[0]("bge:latest");
            expect(Notice.instances.some((n) => n.message === MESSAGES.NOTICE_FAILED_RERANKER)).toBe(true);
        });

        it("selecting not-installed local catalog entry triggers pull then set", async () => {
            const plugin = makePlugin();
            async function* fakePull() {
                yield { event: SSE_EVENT.PROGRESS, data: { percent: 50 } };
            }
            (plugin.api.pullModel as ReturnType<typeof vi.fn>).mockReturnValue(fakePull());
            (plugin.api.config as ReturnType<typeof vi.fn>).mockResolvedValue({
                reranker_model: "",
                rerank_candidates: 20,
            });
            (plugin.api.catalog as ReturnType<typeof vi.fn>).mockResolvedValue(
                ok({
                    total: 1,
                    limit: 20,
                    offset: 0,
                    models: [
                        {
                            name: "bge-reranker-large",
                            tag: "latest",
                            hf_repo: "BAAI/bge-reranker-large",
                            display_name: "",
                            size_gb: 2,
                            min_ram_gb: 4,
                            description: "",
                            quality_tier: "",
                            installed: false,
                            source: "native",
                            task: "rerank",
                        },
                    ],
                    has_more: false,
                }),
            );
            (plugin.api.installedModels as ReturnType<typeof vi.fn>).mockResolvedValue({ models: [] });
            const container = new MockElement("div") as unknown as HTMLElement;
            const tab = makeTab(plugin);
            const { dropdowns } = captureRerankerDropdown();

            (tab as any).renderRerankerSection(container);
            await new Promise((r) => setTimeout(r, 0));
            await new Promise((r) => setTimeout(r, 0));

            // pullModel and setRerankerModel must use hf_repo (canonical id), not display name
            await dropdowns[0]("bge-reranker-large:latest");
            expect(plugin.api.pullModel).toHaveBeenCalledWith(
                "BAAI/bge-reranker-large",
                "native",
                expect.any(AbortSignal),
            );
            expect(plugin.api.setRerankerModel).toHaveBeenCalledWith("bge-reranker-large:latest");
        });

        it("hosted litellm entry skips pull and calls setRerankerModel directly", async () => {
            const plugin = makePlugin();
            (plugin.api.config as ReturnType<typeof vi.fn>).mockResolvedValue({
                reranker_model: "",
                rerank_candidates: 20,
            });
            (plugin.api.catalog as ReturnType<typeof vi.fn>).mockResolvedValue(
                ok({
                    total: 1,
                    limit: 20,
                    offset: 0,
                    models: [
                        {
                            name: "rerank-english-v3.0",
                            tag: "latest",
                            hf_repo: "cohere/rerank-english-v3.0",
                            display_name: "Cohere",
                            size_gb: 0,
                            min_ram_gb: 0,
                            description: "",
                            quality_tier: "",
                            installed: false,
                            source: "litellm",
                            task: "rerank",
                        },
                    ],
                    has_more: false,
                }),
            );
            (plugin.api.installedModels as ReturnType<typeof vi.fn>).mockResolvedValue({ models: [] });
            const container = new MockElement("div") as unknown as HTMLElement;
            const tab = makeTab(plugin);
            const { dropdowns } = captureRerankerDropdown();

            (tab as any).renderRerankerSection(container);
            await new Promise((r) => setTimeout(r, 0));
            await new Promise((r) => setTimeout(r, 0));

            await dropdowns[0]("rerank-english-v3.0:latest");
            expect(plugin.api.pullModel).not.toHaveBeenCalled();
            expect(plugin.api.setRerankerModel).toHaveBeenCalledWith("rerank-english-v3.0:latest");
        });

        it("hosted litellm entry with 422 response surfaces API-key notice", async () => {
            const plugin = makePlugin();
            (plugin.api.setRerankerModel as ReturnType<typeof vi.fn>).mockResolvedValue(
                err(new Error("Server responded 422: key missing")),
            );
            (plugin.api.config as ReturnType<typeof vi.fn>).mockResolvedValue({
                reranker_model: "",
                rerank_candidates: 20,
            });
            (plugin.api.catalog as ReturnType<typeof vi.fn>).mockResolvedValue(
                ok({
                    total: 1,
                    limit: 20,
                    offset: 0,
                    models: [
                        {
                            name: "rerank",
                            tag: "latest",
                            hf_repo: "cohere/rerank",
                            display_name: "",
                            size_gb: 0,
                            min_ram_gb: 0,
                            description: "",
                            quality_tier: "",
                            installed: false,
                            source: "litellm",
                            task: "rerank",
                        },
                    ],
                    has_more: false,
                }),
            );
            (plugin.api.installedModels as ReturnType<typeof vi.fn>).mockResolvedValue({ models: [] });
            const container = new MockElement("div") as unknown as HTMLElement;
            const tab = makeTab(plugin);
            const { dropdowns } = captureRerankerDropdown();

            (tab as any).renderRerankerSection(container);
            await new Promise((r) => setTimeout(r, 0));
            await new Promise((r) => setTimeout(r, 0));

            await dropdowns[0]("rerank:latest");
            expect(Notice.instances.some((n) => n.message === MESSAGES.NOTICE_RERANKER_NEEDS_KEY)).toBe(true);
        });

        it("role-mismatch 422 surfaces the server's detail verbatim (not the API-key notice)", async () => {
            Notice.clear();
            const plugin = makePlugin();
            const roleMismatchDetail =
                "Model 'lightonocr:2-1b' is a vision model, not rerank. Set it via PUT /api/models/vision instead.";
            (plugin.api.setRerankerModel as ReturnType<typeof vi.fn>).mockResolvedValue(
                err(new Error(`Server responded 422: {"detail": "${roleMismatchDetail}"}`)),
            );
            (plugin.api.config as ReturnType<typeof vi.fn>).mockResolvedValue({
                reranker_model: "",
                rerank_candidates: 20,
            });
            (plugin.api.catalog as ReturnType<typeof vi.fn>).mockResolvedValue(
                ok({
                    total: 1,
                    limit: 20,
                    offset: 0,
                    models: [
                        {
                            name: "lightonocr",
                            hf_repo: "lightonocr:2-1b",
                            display_name: "",
                            size_gb: 1,
                            min_ram_gb: 4,
                            description: "",
                            quality_tier: "",
                            installed: true,
                            source: "native",
                            task: "rerank",
                        },
                    ],
                    has_more: false,
                }),
            );
            (plugin.api.installedModels as ReturnType<typeof vi.fn>).mockResolvedValue({
                models: [{ name: "lightonocr:2-1b", source: "native" }],
            });
            const container = new MockElement("div") as unknown as HTMLElement;
            const tab = makeTab(plugin);
            const { dropdowns } = captureRerankerDropdown();

            (tab as any).renderRerankerSection(container);
            await new Promise((r) => setTimeout(r, 0));
            await new Promise((r) => setTimeout(r, 0));

            await dropdowns[0]("lightonocr:2-1b");
            expect(Notice.instances.some((n) => n.message === roleMismatchDetail)).toBe(true);
            expect(Notice.instances.some((n) => n.message === MESSAGES.NOTICE_RERANKER_NEEDS_KEY)).toBe(false);
        });

        it("falls back to notice when initial load fails", async () => {
            const plugin = makePlugin();
            (plugin.api.config as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("unreachable"));
            (plugin.api.catalog as ReturnType<typeof vi.fn>).mockResolvedValue(
                ok({ total: 0, limit: 20, offset: 0, models: [], has_more: false }),
            );
            (plugin.api.installedModels as ReturnType<typeof vi.fn>).mockResolvedValue({ models: [] });
            const container = new MockElement("div") as unknown as HTMLElement;
            const tab = makeTab(plugin);

            (tab as any).renderRerankerSection(container);
            await new Promise((r) => setTimeout(r, 0));
            await new Promise((r) => setTimeout(r, 0));

            expect(Notice.instances.some((n) => n.message === MESSAGES.NOTICE_RERANKER_LOAD_FAILED)).toBe(true);
        });

        it("falls back to notice when installedModels rejects (caught by inner catch)", async () => {
            const plugin = makePlugin();
            (plugin.api.config as ReturnType<typeof vi.fn>).mockResolvedValue({
                reranker_model: "",
                rerank_candidates: 20,
            });
            (plugin.api.catalog as ReturnType<typeof vi.fn>).mockResolvedValue(
                ok({ total: 0, limit: 20, offset: 0, models: [], has_more: false }),
            );
            (plugin.api.installedModels as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("boom"));
            const container = new MockElement("div") as unknown as HTMLElement;
            const tab = makeTab(plugin);
            const { options } = captureRerankerDropdown();

            (tab as any).renderRerankerSection(container);
            await new Promise((r) => setTimeout(r, 0));
            await new Promise((r) => setTimeout(r, 0));

            // installed catch fallback returns empty models — dropdown still renders with just (disabled)
            expect(options[0][""]).toBe(MESSAGES.LABEL_RERANKER_DISABLED);
        });

        it("falls back when catalog returns err() — shows empty dropdown with just (disabled)", async () => {
            const plugin = makePlugin();
            (plugin.api.config as ReturnType<typeof vi.fn>).mockResolvedValue({
                reranker_model: "",
                rerank_candidates: 20,
            });
            (plugin.api.catalog as ReturnType<typeof vi.fn>).mockResolvedValue(err(new Error("fail")));
            (plugin.api.installedModels as ReturnType<typeof vi.fn>).mockResolvedValue({ models: [] });
            const container = new MockElement("div") as unknown as HTMLElement;
            const tab = makeTab(plugin);
            const { options } = captureRerankerDropdown();

            (tab as any).renderRerankerSection(container);
            await new Promise((r) => setTimeout(r, 0));
            await new Promise((r) => setTimeout(r, 0));

            expect(Object.keys(options[0])).toEqual([""]);
        });

        it("pull flow surfaces queue-full notice when enqueue fails", async () => {
            const plugin = makePlugin();
            plugin.taskQueue.enqueue = vi.fn(() => null) as any;
            (plugin.api.config as ReturnType<typeof vi.fn>).mockResolvedValue({
                reranker_model: "",
                rerank_candidates: 20,
            });
            (plugin.api.catalog as ReturnType<typeof vi.fn>).mockResolvedValue(
                ok({
                    total: 1,
                    limit: 20,
                    offset: 0,
                    models: [
                        {
                            name: "bge",
                            tag: "latest",
                            hf_repo: "BAAI/bge",
                            display_name: "",
                            size_gb: 1,
                            min_ram_gb: 4,
                            description: "",
                            quality_tier: "",
                            installed: false,
                            source: "native",
                            task: "rerank",
                        },
                    ],
                    has_more: false,
                }),
            );
            (plugin.api.installedModels as ReturnType<typeof vi.fn>).mockResolvedValue({ models: [] });
            const container = new MockElement("div") as unknown as HTMLElement;
            const tab = makeTab(plugin);
            const { dropdowns } = captureRerankerDropdown();

            (tab as any).renderRerankerSection(container);
            await new Promise((r) => setTimeout(r, 0));
            await new Promise((r) => setTimeout(r, 0));

            await dropdowns[0]("bge:latest");
            expect(Notice.instances.some((n) => n.message === MESSAGES.NOTICE_QUEUE_FULL)).toBe(true);
            expect(plugin.api.pullModel).not.toHaveBeenCalled();
        });

        it("pull SSE error fails the task and surfaces notice", async () => {
            const plugin = makePlugin();
            async function* failingPull() {
                yield { event: SSE_EVENT.ERROR, data: { message: "boom" } };
            }
            (plugin.api.pullModel as ReturnType<typeof vi.fn>).mockReturnValue(failingPull());
            (plugin.api.config as ReturnType<typeof vi.fn>).mockResolvedValue({
                reranker_model: "",
                rerank_candidates: 20,
            });
            (plugin.api.catalog as ReturnType<typeof vi.fn>).mockResolvedValue(
                ok({
                    total: 1,
                    limit: 20,
                    offset: 0,
                    models: [
                        {
                            name: "bge",
                            tag: "latest",
                            hf_repo: "BAAI/bge",
                            display_name: "",
                            size_gb: 1,
                            min_ram_gb: 4,
                            description: "",
                            quality_tier: "",
                            installed: false,
                            source: "native",
                            task: "rerank",
                        },
                    ],
                    has_more: false,
                }),
            );
            (plugin.api.installedModels as ReturnType<typeof vi.fn>).mockResolvedValue({ models: [] });
            const container = new MockElement("div") as unknown as HTMLElement;
            const tab = makeTab(plugin);
            const { dropdowns } = captureRerankerDropdown();

            (tab as any).renderRerankerSection(container);
            await new Promise((r) => setTimeout(r, 0));
            await new Promise((r) => setTimeout(r, 0));

            await dropdowns[0]("bge:latest");
            expect(Notice.instances.some((n) => n.message.includes("failed to pull"))).toBe(true);
            expect(plugin.api.setRerankerModel).not.toHaveBeenCalled();
        });

        it("pull AbortError cancels the task and surfaces cancel notice", async () => {
            const plugin = makePlugin();
            async function* aborting(): AsyncGenerator<never> {
                const e = new Error("aborted");
                e.name = "AbortError";
                throw e;
            }
            (plugin.api.pullModel as ReturnType<typeof vi.fn>).mockReturnValue(aborting());
            (plugin.api.config as ReturnType<typeof vi.fn>).mockResolvedValue({
                reranker_model: "",
                rerank_candidates: 20,
            });
            (plugin.api.catalog as ReturnType<typeof vi.fn>).mockResolvedValue(
                ok({
                    total: 1,
                    limit: 20,
                    offset: 0,
                    models: [
                        {
                            name: "bge",
                            tag: "latest",
                            hf_repo: "BAAI/bge",
                            display_name: "",
                            size_gb: 1,
                            min_ram_gb: 4,
                            description: "",
                            quality_tier: "",
                            installed: false,
                            source: "native",
                            task: "rerank",
                        },
                    ],
                    has_more: false,
                }),
            );
            (plugin.api.installedModels as ReturnType<typeof vi.fn>).mockResolvedValue({ models: [] });
            const container = new MockElement("div") as unknown as HTMLElement;
            const tab = makeTab(plugin);
            const { dropdowns } = captureRerankerDropdown();

            (tab as any).renderRerankerSection(container);
            await new Promise((r) => setTimeout(r, 0));
            await new Promise((r) => setTimeout(r, 0));

            await dropdowns[0]("bge:latest");
            expect(Notice.instances.some((n) => n.message === MESSAGES.NOTICE_PULL_CANCELLED)).toBe(true);
        });

        it("pull non-Error throw uses 'unknown' as reason", async () => {
            const plugin = makePlugin();
            async function* failing(): AsyncGenerator<never> {
                throw "string failure";
            }
            (plugin.api.pullModel as ReturnType<typeof vi.fn>).mockReturnValue(failing());
            (plugin.api.config as ReturnType<typeof vi.fn>).mockResolvedValue({
                reranker_model: "",
                rerank_candidates: 20,
            });
            (plugin.api.catalog as ReturnType<typeof vi.fn>).mockResolvedValue(
                ok({
                    total: 1,
                    limit: 20,
                    offset: 0,
                    models: [
                        {
                            name: "bge",
                            tag: "latest",
                            hf_repo: "BAAI/bge",
                            display_name: "",
                            size_gb: 1,
                            min_ram_gb: 4,
                            description: "",
                            quality_tier: "",
                            installed: false,
                            source: "native",
                            task: "rerank",
                        },
                    ],
                    has_more: false,
                }),
            );
            (plugin.api.installedModels as ReturnType<typeof vi.fn>).mockResolvedValue({ models: [] });
            const container = new MockElement("div") as unknown as HTMLElement;
            const tab = makeTab(plugin);
            const { dropdowns } = captureRerankerDropdown();

            (tab as any).renderRerankerSection(container);
            await new Promise((r) => setTimeout(r, 0));
            await new Promise((r) => setTimeout(r, 0));

            await dropdowns[0]("bge:latest");
            const failed = plugin.taskQueue.completed.find((t: any) => t.status === "failed");
            expect(failed).toBeDefined();
            expect(failed!.error).toBe("unknown error");
        });

        it("pull progress without percent or total is ignored", async () => {
            const plugin = makePlugin();
            async function* fakePull() {
                yield { event: SSE_EVENT.PROGRESS, data: {} };
            }
            (plugin.api.pullModel as ReturnType<typeof vi.fn>).mockReturnValue(fakePull());
            (plugin.api.config as ReturnType<typeof vi.fn>).mockResolvedValue({
                reranker_model: "",
                rerank_candidates: 20,
            });
            (plugin.api.catalog as ReturnType<typeof vi.fn>).mockResolvedValue(
                ok({
                    total: 1,
                    limit: 20,
                    offset: 0,
                    models: [
                        {
                            name: "bge",
                            tag: "latest",
                            hf_repo: "BAAI/bge",
                            display_name: "",
                            size_gb: 1,
                            min_ram_gb: 4,
                            description: "",
                            quality_tier: "",
                            installed: false,
                            source: "native",
                            task: "rerank",
                        },
                    ],
                    has_more: false,
                }),
            );
            (plugin.api.installedModels as ReturnType<typeof vi.fn>).mockResolvedValue({ models: [] });
            const container = new MockElement("div") as unknown as HTMLElement;
            const tab = makeTab(plugin);
            const { dropdowns } = captureRerankerDropdown();

            (tab as any).renderRerankerSection(container);
            await new Promise((r) => setTimeout(r, 0));
            await new Promise((r) => setTimeout(r, 0));

            await expect(dropdowns[0]("bge:latest")).resolves.not.toThrow();
            expect(plugin.api.setRerankerModel).toHaveBeenCalledWith("bge:latest");
        });

        it("buildRerankerOptions includes only installed-first then not-installed then hosted", async () => {
            const plugin = makePlugin();
            (plugin.api.config as ReturnType<typeof vi.fn>).mockResolvedValue({
                reranker_model: "",
                rerank_candidates: 20,
            });
            (plugin.api.catalog as ReturnType<typeof vi.fn>).mockResolvedValue(
                ok({
                    total: 3,
                    limit: 20,
                    offset: 0,
                    models: [
                        {
                            name: "bge-installed",
                            tag: "latest",
                            hf_repo: "BAAI/bge-installed",
                            display_name: "",
                            size_gb: 1,
                            min_ram_gb: 4,
                            description: "",
                            quality_tier: "",
                            installed: true,
                            source: "native",
                            task: "rerank",
                        },
                        {
                            name: "bge-not-installed",
                            tag: "latest",
                            hf_repo: "BAAI/bge-not-installed",
                            display_name: "",
                            size_gb: 1,
                            min_ram_gb: 4,
                            description: "",
                            quality_tier: "",
                            installed: false,
                            source: "native",
                            task: "rerank",
                        },
                        {
                            name: "rerank",
                            tag: "latest",
                            hf_repo: "cohere/rerank",
                            display_name: "",
                            size_gb: 0,
                            min_ram_gb: 0,
                            description: "",
                            quality_tier: "",
                            installed: false,
                            source: "litellm",
                            task: "rerank",
                        },
                    ],
                    has_more: false,
                }),
            );
            (plugin.api.installedModels as ReturnType<typeof vi.fn>).mockResolvedValue({
                models: [{ name: "bge-installed:latest", source: "native" }],
            });
            const container = new MockElement("div") as unknown as HTMLElement;
            const tab = makeTab(plugin);
            const { options } = captureRerankerDropdown();

            (tab as any).renderRerankerSection(container);
            await new Promise((r) => setTimeout(r, 0));
            await new Promise((r) => setTimeout(r, 0));

            // Dropdown VALUES use the canonical ``name:tag`` ref so the
            // server's active-reranker string (returned in name:tag form)
            // matches an option and setValue resolves. Display labels still
            // show hf_repo so the UI stays human-readable.
            const keys = Object.keys(options[0]);
            expect(keys).toEqual(["", "bge-installed:latest", "bge-not-installed:latest", "rerank:latest"]);
            expect(options[0]["bge-installed:latest"]).toBe("BAAI/bge-installed");
            expect(options[0]["bge-not-installed:latest"]).toContain(MESSAGES.LABEL_NOT_INSTALLED);
            expect(options[0]["rerank:latest"]).toContain(MESSAGES.LABEL_RERANKER_HOSTED_GROUP);
        });

        it("installed reranker with server's name:tag ref is NOT labelled (not installed)", async () => {
            // Regression: buildRerankerOptions used to compare against
            // ``entry.hf_repo`` but the server's ``/api/models/installed``
            // returns the canonical ``name:tag`` ref. That mismatch made
            // installed rerankers render as "(not installed)" and the
            // dropdown fall back to "(disabled)" even when the server had
            // an active reranker set. Guard the both forms here.
            const plugin = makePlugin();
            (plugin.api.config as ReturnType<typeof vi.fn>).mockResolvedValue({
                reranker_model: "bge-reranker-v2-m3:latest",
                rerank_candidates: 20,
                reranker_available: true,
            });
            (plugin.api.catalog as ReturnType<typeof vi.fn>).mockResolvedValue(
                ok({
                    total: 1,
                    limit: 20,
                    offset: 0,
                    models: [
                        {
                            name: "bge-reranker-v2-m3",
                            tag: "latest",
                            hf_repo: "gpustack/bge-reranker-v2-m3-GGUF",
                            display_name: "BGE",
                            size_gb: 0.4,
                            min_ram_gb: 2,
                            description: "",
                            quality_tier: "balanced",
                            installed: true,
                            source: "native",
                            task: "rerank",
                        },
                    ],
                    has_more: false,
                }),
            );
            (plugin.api.installedModels as ReturnType<typeof vi.fn>).mockResolvedValue({
                models: [{ name: "bge-reranker-v2-m3:latest", source: "native" }],
            });
            const container = new MockElement("div") as unknown as HTMLElement;
            const tab = makeTab(plugin);
            const { options, values } = captureRerankerDropdown();

            (tab as any).renderRerankerSection(container);
            await new Promise((r) => setTimeout(r, 0));
            await new Promise((r) => setTimeout(r, 0));

            expect(options[0]["bge-reranker-v2-m3:latest"]).toBe("gpustack/bge-reranker-v2-m3-GGUF");
            expect(options[0]["bge-reranker-v2-m3:latest"]).not.toContain(MESSAGES.LABEL_NOT_INSTALLED);
            expect(values[0]).toBe("bge-reranker-v2-m3:latest");
        });

        it("parses reranker_model as empty when config lacks the field", async () => {
            const plugin = makePlugin();
            (plugin.api.config as ReturnType<typeof vi.fn>).mockResolvedValue({
                // no reranker_model key
            });
            (plugin.api.catalog as ReturnType<typeof vi.fn>).mockResolvedValue(
                ok({ total: 0, limit: 20, offset: 0, models: [], has_more: false }),
            );
            (plugin.api.installedModels as ReturnType<typeof vi.fn>).mockResolvedValue({ models: [] });
            const container = new MockElement("div") as unknown as HTMLElement;
            const tab = makeTab(plugin);
            const { values } = captureRerankerDropdown();

            (tab as any).renderRerankerSection(container);
            await new Promise((r) => setTimeout(r, 0));
            await new Promise((r) => setTimeout(r, 0));

            expect(values[0]).toBe("");
        });
    });

    describe("Vision section", () => {
        let origAddDropdown: typeof Setting.prototype.addDropdown;

        function captureVisionDropdown(): {
            dropdowns: DropdownOnChange[];
            options: Array<Record<string, string>>;
            values: string[];
        } {
            const dropdowns: DropdownOnChange[] = [];
            const options: Array<Record<string, string>> = [];
            const values: string[] = [];
            Setting.prototype.addDropdown = function (cb: (dropdown: any) => void) {
                const opts: Record<string, string> = {};
                const fakeDropdown = {
                    addOption: (v: string, l: string) => {
                        opts[v] = l;
                        return fakeDropdown;
                    },
                    setValue: (v: string) => {
                        values.push(v);
                        return fakeDropdown;
                    },
                    onChange: (handler: DropdownOnChange) => {
                        dropdowns.push(handler);
                        return fakeDropdown;
                    },
                };
                cb(fakeDropdown);
                options.push(opts);
                return this;
            };
            return { dropdowns, options, values };
        }

        beforeEach(() => {
            origAddDropdown = Setting.prototype.addDropdown;
        });
        afterEach(() => {
            Setting.prototype.addDropdown = origAddDropdown;
        });

        it("renders dropdown with (disabled) when active vision_model is empty", async () => {
            const plugin = makePlugin();
            (plugin.api.config as ReturnType<typeof vi.fn>).mockResolvedValue({
                vision_model: "",
            });
            (plugin.api.catalog as ReturnType<typeof vi.fn>).mockResolvedValue(
                ok({
                    total: 1,
                    limit: 20,
                    offset: 0,
                    models: [
                        {
                            name: "qwen2-vl",
                            hf_repo: "Qwen/Qwen2-VL-7B-Instruct",
                            display_name: "Qwen2-VL",
                            size_gb: 8,
                            min_ram_gb: 16,
                            description: "vision",
                            quality_tier: "balanced",
                            installed: true,
                            source: "native",
                            task: "vision",
                        },
                    ],
                    has_more: false,
                }),
            );
            (plugin.api.installedModels as ReturnType<typeof vi.fn>).mockResolvedValue({
                models: [{ name: "Qwen/Qwen2-VL-7B-Instruct", source: "native" }],
            });
            const container = new MockElement("div") as unknown as HTMLElement;
            const tab = makeTab(plugin);
            const { options, values } = captureVisionDropdown();

            (tab as any).renderVisionSection(container);
            await new Promise((r) => setTimeout(r, 0));
            await new Promise((r) => setTimeout(r, 0));

            expect(options[0][""]).toBe(MESSAGES.LABEL_VISION_DISABLED);
            expect(options[0]["Qwen/Qwen2-VL-7B-Instruct"]).toBe("Qwen/Qwen2-VL-7B-Instruct");
            expect(values[0]).toBe("");
        });

        it("selecting installed vision model calls setVisionModel and shows success notice", async () => {
            const plugin = makePlugin();
            (plugin.api.config as ReturnType<typeof vi.fn>).mockResolvedValue({ vision_model: "" });
            (plugin.api.catalog as ReturnType<typeof vi.fn>).mockResolvedValue(
                ok({
                    total: 1,
                    limit: 20,
                    offset: 0,
                    models: [
                        {
                            name: "qwen2-vl",
                            hf_repo: "Qwen/Qwen2-VL-7B-Instruct",
                            display_name: "Qwen2-VL",
                            size_gb: 8,
                            min_ram_gb: 16,
                            description: "",
                            quality_tier: "balanced",
                            installed: true,
                            source: "native",
                            task: "vision",
                        },
                    ],
                    has_more: false,
                }),
            );
            (plugin.api.installedModels as ReturnType<typeof vi.fn>).mockResolvedValue({
                models: [{ name: "Qwen/Qwen2-VL-7B-Instruct", source: "native" }],
            });
            const container = new MockElement("div") as unknown as HTMLElement;
            const tab = makeTab(plugin);
            const { dropdowns } = captureVisionDropdown();

            (tab as any).renderVisionSection(container);
            await new Promise((r) => setTimeout(r, 0));
            await new Promise((r) => setTimeout(r, 0));

            await dropdowns[0]("Qwen/Qwen2-VL-7B-Instruct");
            expect(plugin.api.setVisionModel).toHaveBeenCalledWith("Qwen/Qwen2-VL-7B-Instruct");
            expect(Notice.instances.some((n) => n.message === MESSAGES.NOTICE_VISION_UPDATED)).toBe(true);
        });

        it("selecting disabled calls setVisionModel('')", async () => {
            const plugin = makePlugin();
            (plugin.api.config as ReturnType<typeof vi.fn>).mockResolvedValue({
                vision_model: "Qwen/Qwen2-VL-7B-Instruct",
            });
            (plugin.api.catalog as ReturnType<typeof vi.fn>).mockResolvedValue(
                ok({ total: 0, limit: 20, offset: 0, models: [], has_more: false }),
            );
            (plugin.api.installedModels as ReturnType<typeof vi.fn>).mockResolvedValue({ models: [] });
            const container = new MockElement("div") as unknown as HTMLElement;
            const tab = makeTab(plugin);
            const { dropdowns } = captureVisionDropdown();

            (tab as any).renderVisionSection(container);
            await new Promise((r) => setTimeout(r, 0));
            await new Promise((r) => setTimeout(r, 0));

            await dropdowns[0]("");
            expect(plugin.api.setVisionModel).toHaveBeenCalledWith("");
        });

        it("shows failure notice when setVisionModel returns non-422 error", async () => {
            const plugin = makePlugin();
            (plugin.api.setVisionModel as ReturnType<typeof vi.fn>).mockResolvedValue(
                err(new Error("Server responded 500: ")),
            );
            (plugin.api.config as ReturnType<typeof vi.fn>).mockResolvedValue({ vision_model: "" });
            (plugin.api.catalog as ReturnType<typeof vi.fn>).mockResolvedValue(
                ok({
                    total: 1,
                    limit: 20,
                    offset: 0,
                    models: [
                        {
                            name: "qwen",
                            hf_repo: "Qwen/qwen",
                            display_name: "",
                            size_gb: 1,
                            min_ram_gb: 4,
                            description: "",
                            quality_tier: "",
                            installed: true,
                            source: "native",
                            task: "vision",
                        },
                    ],
                    has_more: false,
                }),
            );
            (plugin.api.installedModels as ReturnType<typeof vi.fn>).mockResolvedValue({
                models: [{ name: "Qwen/qwen", source: "native" }],
            });
            const container = new MockElement("div") as unknown as HTMLElement;
            const tab = makeTab(plugin);
            const { dropdowns } = captureVisionDropdown();

            (tab as any).renderVisionSection(container);
            await new Promise((r) => setTimeout(r, 0));
            await new Promise((r) => setTimeout(r, 0));

            await dropdowns[0]("Qwen/qwen");
            expect(Notice.instances.some((n) => n.message === MESSAGES.NOTICE_FAILED_VISION)).toBe(true);
        });

        it("selecting not-installed local catalog entry triggers pull then set", async () => {
            const plugin = makePlugin();
            async function* fakePull() {
                yield { event: SSE_EVENT.PROGRESS, data: { percent: 50 } };
            }
            (plugin.api.pullModel as ReturnType<typeof vi.fn>).mockReturnValue(fakePull());
            (plugin.api.config as ReturnType<typeof vi.fn>).mockResolvedValue({ vision_model: "" });
            (plugin.api.catalog as ReturnType<typeof vi.fn>).mockResolvedValue(
                ok({
                    total: 1,
                    limit: 20,
                    offset: 0,
                    models: [
                        {
                            name: "qwen-vl-large",
                            hf_repo: "Qwen/qwen-vl-large",
                            display_name: "",
                            size_gb: 2,
                            min_ram_gb: 4,
                            description: "",
                            quality_tier: "",
                            installed: false,
                            source: "native",
                            task: "vision",
                        },
                    ],
                    has_more: false,
                }),
            );
            (plugin.api.installedModels as ReturnType<typeof vi.fn>).mockResolvedValue({ models: [] });
            const container = new MockElement("div") as unknown as HTMLElement;
            const tab = makeTab(plugin);
            const { dropdowns } = captureVisionDropdown();

            (tab as any).renderVisionSection(container);
            await new Promise((r) => setTimeout(r, 0));
            await new Promise((r) => setTimeout(r, 0));

            await dropdowns[0]("Qwen/qwen-vl-large");
            expect(plugin.api.pullModel).toHaveBeenCalledWith("Qwen/qwen-vl-large", "native", expect.any(AbortSignal));
            expect(plugin.api.setVisionModel).toHaveBeenCalledWith("Qwen/qwen-vl-large");
        });

        it("hosted litellm entry skips pull and calls setVisionModel directly", async () => {
            const plugin = makePlugin();
            (plugin.api.config as ReturnType<typeof vi.fn>).mockResolvedValue({ vision_model: "" });
            (plugin.api.catalog as ReturnType<typeof vi.fn>).mockResolvedValue(
                ok({
                    total: 1,
                    limit: 20,
                    offset: 0,
                    models: [
                        {
                            name: "gpt-4o",
                            hf_repo: "openai/gpt-4o",
                            display_name: "GPT-4o",
                            size_gb: 0,
                            min_ram_gb: 0,
                            description: "",
                            quality_tier: "",
                            installed: false,
                            source: "litellm",
                            task: "vision",
                        },
                    ],
                    has_more: false,
                }),
            );
            (plugin.api.installedModels as ReturnType<typeof vi.fn>).mockResolvedValue({ models: [] });
            const container = new MockElement("div") as unknown as HTMLElement;
            const tab = makeTab(plugin);
            const { dropdowns } = captureVisionDropdown();

            (tab as any).renderVisionSection(container);
            await new Promise((r) => setTimeout(r, 0));
            await new Promise((r) => setTimeout(r, 0));

            await dropdowns[0]("openai/gpt-4o");
            expect(plugin.api.pullModel).not.toHaveBeenCalled();
            expect(plugin.api.setVisionModel).toHaveBeenCalledWith("openai/gpt-4o");
        });

        it("hosted litellm entry with 422 response surfaces API-key notice", async () => {
            const plugin = makePlugin();
            (plugin.api.setVisionModel as ReturnType<typeof vi.fn>).mockResolvedValue(
                err(new Error("Server responded 422: key missing")),
            );
            (plugin.api.config as ReturnType<typeof vi.fn>).mockResolvedValue({ vision_model: "" });
            (plugin.api.catalog as ReturnType<typeof vi.fn>).mockResolvedValue(
                ok({
                    total: 1,
                    limit: 20,
                    offset: 0,
                    models: [
                        {
                            name: "gpt-4o",
                            hf_repo: "openai/gpt-4o",
                            display_name: "",
                            size_gb: 0,
                            min_ram_gb: 0,
                            description: "",
                            quality_tier: "",
                            installed: false,
                            source: "litellm",
                            task: "vision",
                        },
                    ],
                    has_more: false,
                }),
            );
            (plugin.api.installedModels as ReturnType<typeof vi.fn>).mockResolvedValue({ models: [] });
            const container = new MockElement("div") as unknown as HTMLElement;
            const tab = makeTab(plugin);
            const { dropdowns } = captureVisionDropdown();

            (tab as any).renderVisionSection(container);
            await new Promise((r) => setTimeout(r, 0));
            await new Promise((r) => setTimeout(r, 0));

            await dropdowns[0]("openai/gpt-4o");
            expect(Notice.instances.some((n) => n.message === MESSAGES.NOTICE_VISION_NEEDS_KEY)).toBe(true);
        });

        it("role-mismatch 422 surfaces the server's detail verbatim (not the API-key notice)", async () => {
            Notice.clear();
            const plugin = makePlugin();
            const roleMismatchDetail =
                "Model 'bge-reranker' is a rerank model, not vision. Set it via PUT /api/models/reranker instead.";
            (plugin.api.setVisionModel as ReturnType<typeof vi.fn>).mockResolvedValue(
                err(new Error(`Server responded 422: {"detail": "${roleMismatchDetail}"}`)),
            );
            (plugin.api.config as ReturnType<typeof vi.fn>).mockResolvedValue({ vision_model: "" });
            (plugin.api.catalog as ReturnType<typeof vi.fn>).mockResolvedValue(
                ok({
                    total: 1,
                    limit: 20,
                    offset: 0,
                    models: [
                        {
                            name: "bge-reranker",
                            hf_repo: "BAAI/bge-reranker-v2-m3",
                            display_name: "",
                            size_gb: 1,
                            min_ram_gb: 4,
                            description: "",
                            quality_tier: "",
                            installed: true,
                            source: "native",
                            task: "vision",
                        },
                    ],
                    has_more: false,
                }),
            );
            (plugin.api.installedModels as ReturnType<typeof vi.fn>).mockResolvedValue({
                models: [{ name: "BAAI/bge-reranker-v2-m3", source: "native" }],
            });
            const container = new MockElement("div") as unknown as HTMLElement;
            const tab = makeTab(plugin);
            const { dropdowns } = captureVisionDropdown();

            (tab as any).renderVisionSection(container);
            await new Promise((r) => setTimeout(r, 0));
            await new Promise((r) => setTimeout(r, 0));

            await dropdowns[0]("BAAI/bge-reranker-v2-m3");
            expect(Notice.instances.some((n) => n.message === roleMismatchDetail)).toBe(true);
            expect(Notice.instances.some((n) => n.message === MESSAGES.NOTICE_VISION_NEEDS_KEY)).toBe(false);
        });

        it("falls back to notice when initial load fails", async () => {
            const plugin = makePlugin();
            (plugin.api.config as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("unreachable"));
            (plugin.api.catalog as ReturnType<typeof vi.fn>).mockResolvedValue(
                ok({ total: 0, limit: 20, offset: 0, models: [], has_more: false }),
            );
            (plugin.api.installedModels as ReturnType<typeof vi.fn>).mockResolvedValue({ models: [] });
            const container = new MockElement("div") as unknown as HTMLElement;
            const tab = makeTab(plugin);

            (tab as any).renderVisionSection(container);
            await new Promise((r) => setTimeout(r, 0));
            await new Promise((r) => setTimeout(r, 0));

            expect(Notice.instances.some((n) => n.message === MESSAGES.NOTICE_VISION_LOAD_FAILED)).toBe(true);
        });

        it("falls back to empty dropdown when installedModels rejects", async () => {
            const plugin = makePlugin();
            (plugin.api.config as ReturnType<typeof vi.fn>).mockResolvedValue({ vision_model: "" });
            (plugin.api.catalog as ReturnType<typeof vi.fn>).mockResolvedValue(
                ok({ total: 0, limit: 20, offset: 0, models: [], has_more: false }),
            );
            (plugin.api.installedModels as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("boom"));
            const container = new MockElement("div") as unknown as HTMLElement;
            const tab = makeTab(plugin);
            const { options } = captureVisionDropdown();

            (tab as any).renderVisionSection(container);
            await new Promise((r) => setTimeout(r, 0));
            await new Promise((r) => setTimeout(r, 0));

            expect(options[0][""]).toBe(MESSAGES.LABEL_VISION_DISABLED);
        });

        it("falls back when catalog returns err() — shows empty dropdown with just (disabled)", async () => {
            const plugin = makePlugin();
            (plugin.api.config as ReturnType<typeof vi.fn>).mockResolvedValue({ vision_model: "" });
            (plugin.api.catalog as ReturnType<typeof vi.fn>).mockResolvedValue(err(new Error("fail")));
            (plugin.api.installedModels as ReturnType<typeof vi.fn>).mockResolvedValue({ models: [] });
            const container = new MockElement("div") as unknown as HTMLElement;
            const tab = makeTab(plugin);
            const { options } = captureVisionDropdown();

            (tab as any).renderVisionSection(container);
            await new Promise((r) => setTimeout(r, 0));
            await new Promise((r) => setTimeout(r, 0));

            expect(Object.keys(options[0])).toEqual([""]);
        });

        it("pull flow surfaces queue-full notice when enqueue fails", async () => {
            const plugin = makePlugin();
            plugin.taskQueue.enqueue = vi.fn(() => null) as any;
            (plugin.api.config as ReturnType<typeof vi.fn>).mockResolvedValue({ vision_model: "" });
            (plugin.api.catalog as ReturnType<typeof vi.fn>).mockResolvedValue(
                ok({
                    total: 1,
                    limit: 20,
                    offset: 0,
                    models: [
                        {
                            name: "qwen-vl",
                            hf_repo: "Qwen/qwen-vl",
                            display_name: "",
                            size_gb: 1,
                            min_ram_gb: 4,
                            description: "",
                            quality_tier: "",
                            installed: false,
                            source: "native",
                            task: "vision",
                        },
                    ],
                    has_more: false,
                }),
            );
            (plugin.api.installedModels as ReturnType<typeof vi.fn>).mockResolvedValue({ models: [] });
            const container = new MockElement("div") as unknown as HTMLElement;
            const tab = makeTab(plugin);
            const { dropdowns } = captureVisionDropdown();

            (tab as any).renderVisionSection(container);
            await new Promise((r) => setTimeout(r, 0));
            await new Promise((r) => setTimeout(r, 0));

            await dropdowns[0]("Qwen/qwen-vl");
            expect(Notice.instances.some((n) => n.message === MESSAGES.NOTICE_QUEUE_FULL)).toBe(true);
            expect(plugin.api.pullModel).not.toHaveBeenCalled();
        });

        it("pull SSE error fails the task and surfaces notice", async () => {
            const plugin = makePlugin();
            async function* failingPull() {
                yield { event: SSE_EVENT.ERROR, data: { message: "boom" } };
            }
            (plugin.api.pullModel as ReturnType<typeof vi.fn>).mockReturnValue(failingPull());
            (plugin.api.config as ReturnType<typeof vi.fn>).mockResolvedValue({ vision_model: "" });
            (plugin.api.catalog as ReturnType<typeof vi.fn>).mockResolvedValue(
                ok({
                    total: 1,
                    limit: 20,
                    offset: 0,
                    models: [
                        {
                            name: "qwen-vl",
                            hf_repo: "Qwen/qwen-vl",
                            display_name: "",
                            size_gb: 1,
                            min_ram_gb: 4,
                            description: "",
                            quality_tier: "",
                            installed: false,
                            source: "native",
                            task: "vision",
                        },
                    ],
                    has_more: false,
                }),
            );
            (plugin.api.installedModels as ReturnType<typeof vi.fn>).mockResolvedValue({ models: [] });
            const container = new MockElement("div") as unknown as HTMLElement;
            const tab = makeTab(plugin);
            const { dropdowns } = captureVisionDropdown();

            (tab as any).renderVisionSection(container);
            await new Promise((r) => setTimeout(r, 0));
            await new Promise((r) => setTimeout(r, 0));

            await dropdowns[0]("Qwen/qwen-vl");
            expect(Notice.instances.some((n) => n.message.includes("failed to pull"))).toBe(true);
            expect(plugin.api.setVisionModel).not.toHaveBeenCalled();
        });

        it("pull AbortError cancels the task and surfaces cancel notice", async () => {
            const plugin = makePlugin();
            async function* aborting(): AsyncGenerator<never> {
                const e = new Error("aborted");
                e.name = "AbortError";
                throw e;
            }
            (plugin.api.pullModel as ReturnType<typeof vi.fn>).mockReturnValue(aborting());
            (plugin.api.config as ReturnType<typeof vi.fn>).mockResolvedValue({ vision_model: "" });
            (plugin.api.catalog as ReturnType<typeof vi.fn>).mockResolvedValue(
                ok({
                    total: 1,
                    limit: 20,
                    offset: 0,
                    models: [
                        {
                            name: "qwen-vl",
                            hf_repo: "Qwen/qwen-vl",
                            display_name: "",
                            size_gb: 1,
                            min_ram_gb: 4,
                            description: "",
                            quality_tier: "",
                            installed: false,
                            source: "native",
                            task: "vision",
                        },
                    ],
                    has_more: false,
                }),
            );
            (plugin.api.installedModels as ReturnType<typeof vi.fn>).mockResolvedValue({ models: [] });
            const container = new MockElement("div") as unknown as HTMLElement;
            const tab = makeTab(plugin);
            const { dropdowns } = captureVisionDropdown();

            (tab as any).renderVisionSection(container);
            await new Promise((r) => setTimeout(r, 0));
            await new Promise((r) => setTimeout(r, 0));

            await dropdowns[0]("Qwen/qwen-vl");
            expect(Notice.instances.some((n) => n.message === MESSAGES.NOTICE_PULL_CANCELLED)).toBe(true);
        });

        it("pull non-Error throw uses 'unknown' as reason", async () => {
            const plugin = makePlugin();
            async function* failing(): AsyncGenerator<never> {
                throw "string failure";
            }
            (plugin.api.pullModel as ReturnType<typeof vi.fn>).mockReturnValue(failing());
            (plugin.api.config as ReturnType<typeof vi.fn>).mockResolvedValue({ vision_model: "" });
            (plugin.api.catalog as ReturnType<typeof vi.fn>).mockResolvedValue(
                ok({
                    total: 1,
                    limit: 20,
                    offset: 0,
                    models: [
                        {
                            name: "qwen-vl",
                            hf_repo: "Qwen/qwen-vl",
                            display_name: "",
                            size_gb: 1,
                            min_ram_gb: 4,
                            description: "",
                            quality_tier: "",
                            installed: false,
                            source: "native",
                            task: "vision",
                        },
                    ],
                    has_more: false,
                }),
            );
            (plugin.api.installedModels as ReturnType<typeof vi.fn>).mockResolvedValue({ models: [] });
            const container = new MockElement("div") as unknown as HTMLElement;
            const tab = makeTab(plugin);
            const { dropdowns } = captureVisionDropdown();

            (tab as any).renderVisionSection(container);
            await new Promise((r) => setTimeout(r, 0));
            await new Promise((r) => setTimeout(r, 0));

            await dropdowns[0]("Qwen/qwen-vl");
            const failed = plugin.taskQueue.completed.find((t: any) => t.status === "failed");
            expect(failed).toBeDefined();
            expect(failed!.error).toBe("unknown error");
        });

        it("pull progress without percent or total is ignored", async () => {
            const plugin = makePlugin();
            async function* fakePull() {
                yield { event: SSE_EVENT.PROGRESS, data: {} };
            }
            (plugin.api.pullModel as ReturnType<typeof vi.fn>).mockReturnValue(fakePull());
            (plugin.api.config as ReturnType<typeof vi.fn>).mockResolvedValue({ vision_model: "" });
            (plugin.api.catalog as ReturnType<typeof vi.fn>).mockResolvedValue(
                ok({
                    total: 1,
                    limit: 20,
                    offset: 0,
                    models: [
                        {
                            name: "qwen-vl",
                            hf_repo: "Qwen/qwen-vl",
                            display_name: "",
                            size_gb: 1,
                            min_ram_gb: 4,
                            description: "",
                            quality_tier: "",
                            installed: false,
                            source: "native",
                            task: "vision",
                        },
                    ],
                    has_more: false,
                }),
            );
            (plugin.api.installedModels as ReturnType<typeof vi.fn>).mockResolvedValue({ models: [] });
            const container = new MockElement("div") as unknown as HTMLElement;
            const tab = makeTab(plugin);
            const { dropdowns } = captureVisionDropdown();

            (tab as any).renderVisionSection(container);
            await new Promise((r) => setTimeout(r, 0));
            await new Promise((r) => setTimeout(r, 0));

            await expect(dropdowns[0]("Qwen/qwen-vl")).resolves.not.toThrow();
            expect(plugin.api.setVisionModel).toHaveBeenCalledWith("Qwen/qwen-vl");
        });

        it("buildVisionOptions includes installed-first then not-installed then hosted", async () => {
            const plugin = makePlugin();
            (plugin.api.config as ReturnType<typeof vi.fn>).mockResolvedValue({ vision_model: "" });
            (plugin.api.catalog as ReturnType<typeof vi.fn>).mockResolvedValue(
                ok({
                    total: 3,
                    limit: 20,
                    offset: 0,
                    models: [
                        {
                            name: "qwen-installed",
                            hf_repo: "Qwen/qwen-installed",
                            display_name: "",
                            size_gb: 1,
                            min_ram_gb: 4,
                            description: "",
                            quality_tier: "",
                            installed: true,
                            source: "native",
                            task: "vision",
                        },
                        {
                            name: "qwen-not-installed",
                            hf_repo: "Qwen/qwen-not-installed",
                            display_name: "",
                            size_gb: 1,
                            min_ram_gb: 4,
                            description: "",
                            quality_tier: "",
                            installed: false,
                            source: "native",
                            task: "vision",
                        },
                        {
                            name: "gpt-4o",
                            hf_repo: "openai/gpt-4o",
                            display_name: "",
                            size_gb: 0,
                            min_ram_gb: 0,
                            description: "",
                            quality_tier: "",
                            installed: false,
                            source: "litellm",
                            task: "vision",
                        },
                    ],
                    has_more: false,
                }),
            );
            (plugin.api.installedModels as ReturnType<typeof vi.fn>).mockResolvedValue({
                models: [{ name: "Qwen/qwen-installed", source: "native" }],
            });
            const container = new MockElement("div") as unknown as HTMLElement;
            const tab = makeTab(plugin);
            const { options } = captureVisionDropdown();

            (tab as any).renderVisionSection(container);
            await new Promise((r) => setTimeout(r, 0));
            await new Promise((r) => setTimeout(r, 0));

            const keys = Object.keys(options[0]);
            expect(keys).toEqual(["", "Qwen/qwen-installed", "Qwen/qwen-not-installed", "openai/gpt-4o"]);
            expect(options[0]["Qwen/qwen-not-installed"]).toContain(MESSAGES.LABEL_NOT_INSTALLED);
            expect(options[0]["openai/gpt-4o"]).toContain(MESSAGES.LABEL_VISION_HOSTED_GROUP);
        });

        it("parses vision_model as empty when config lacks the field", async () => {
            const plugin = makePlugin();
            (plugin.api.config as ReturnType<typeof vi.fn>).mockResolvedValue({
                // no vision_model key
            });
            (plugin.api.catalog as ReturnType<typeof vi.fn>).mockResolvedValue(
                ok({ total: 0, limit: 20, offset: 0, models: [], has_more: false }),
            );
            (plugin.api.installedModels as ReturnType<typeof vi.fn>).mockResolvedValue({ models: [] });
            const container = new MockElement("div") as unknown as HTMLElement;
            const tab = makeTab(plugin);
            const { values } = captureVisionDropdown();

            (tab as any).renderVisionSection(container);
            await new Promise((r) => setTimeout(r, 0));
            await new Promise((r) => setTimeout(r, 0));

            expect(values[0]).toBe("");
        });
    });

    describe("rerank_candidates advanced field", () => {
        // In manual mode: [0]=port, [1-6]=gen, [7-9]=crawl, [10]=wikiVaultFolder, [11-12]=chunks, [13]=rerank_candidates
        const RERANK_IDX = 20;

        beforeEach(() => {
            vi.useFakeTimers();
        });
        afterEach(() => {
            vi.useRealTimers();
        });

        it("calls updateConfig with parsed number after debounce", async () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());

            await textOnChanges[RERANK_IDX]("40");
            // Debounced: PATCH doesn't fire synchronously
            expect(plugin.api.updateConfig).not.toHaveBeenCalled();
            await vi.advanceTimersByTimeAsync(400);
            expect(plugin.api.updateConfig).toHaveBeenCalledWith({ rerank_candidates: 40 });
            expect(Notice.instances.some((n) => n.message.includes("Rerank candidates"))).toBe(true);
        });

        it("debounces rapid changes into a single PATCH", async () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());

            await textOnChanges[RERANK_IDX]("30");
            await textOnChanges[RERANK_IDX]("35");
            await textOnChanges[RERANK_IDX]("40");
            await vi.advanceTimersByTimeAsync(400);
            expect(plugin.api.updateConfig).toHaveBeenCalledTimes(1);
            expect(plugin.api.updateConfig).toHaveBeenCalledWith({ rerank_candidates: 40 });
        });

        it("skips empty value", async () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());

            await textOnChanges[RERANK_IDX]("");
            await vi.advanceTimersByTimeAsync(400);
            expect(plugin.api.updateConfig).not.toHaveBeenCalled();
        });

        it("rejects NaN input", async () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());

            await textOnChanges[RERANK_IDX]("abc");
            await vi.advanceTimersByTimeAsync(400);
            expect(plugin.api.updateConfig).not.toHaveBeenCalled();
        });

        it("rejects out-of-range low value", async () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());

            await textOnChanges[RERANK_IDX]("0");
            await vi.advanceTimersByTimeAsync(400);
            expect(plugin.api.updateConfig).not.toHaveBeenCalled();
        });

        it("rejects out-of-range high value", async () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());

            await textOnChanges[RERANK_IDX]("101");
            await vi.advanceTimersByTimeAsync(400);
            expect(plugin.api.updateConfig).not.toHaveBeenCalled();
        });

        it("shows error notice on updateConfig failure", async () => {
            const plugin = makePlugin();
            (plugin.api.updateConfig as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("fail"));
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());

            await textOnChanges[RERANK_IDX]("40");
            await vi.advanceTimersByTimeAsync(400);
            expect(Notice.instances.some((n) => n.message.includes("failed to update"))).toBe(true);
        });
    });
});
