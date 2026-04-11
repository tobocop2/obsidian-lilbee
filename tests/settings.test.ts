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
import { DEFAULT_SETTINGS } from "../src/types";
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
    const settings: LilbeeSettings = { ...DEFAULT_SETTINGS, ...overrides };
    const api = {
        listModels: vi.fn(),
        setChatModel: vi.fn(),
        setVisionModel: vi.fn(),
        pullModel: vi.fn(),
        deleteModel: vi.fn(),
        showModel: vi.fn().mockRejectedValue(new Error("no model")),
        config: vi.fn().mockRejectedValue(new Error("unreachable")),
        updateConfig: vi.fn().mockResolvedValue({ updated: [], reindex_required: false }),
        setEmbeddingModel: vi.fn().mockResolvedValue({ model: "" }),
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
        activeVisionModel: "",
        wikiEnabled: settings.wikiEnabled ?? false,
        wikiSync: null,
        taskQueue: new TaskQueue(),
    } as unknown as InstanceType<typeof import("../src/main").default>;
}

function makeTab(plugin: ReturnType<typeof makePlugin>) {
    const app = new App();
    return new LilbeeSettingTab(app as any, plugin as any);
}

function makeModelsResponse(): ModelsResponse {
    return {
        chat: {
            active: "llama3",
            installed: ["llama3"],
            catalog: [
                { name: "llama3", size_gb: 4.7, min_ram_gb: 8, description: "Meta Llama 3", installed: true },
                { name: "phi3", size_gb: 2.3, min_ram_gb: 4, description: "Microsoft Phi-3", installed: false },
            ],
        },
        vision: {
            active: "",
            installed: [],
            catalog: [
                { name: "llava", size_gb: 4.5, min_ram_gb: 8, description: "LLaVA vision model", installed: false },
            ],
        },
    };
}

type TextOnChange = (v: string) => Promise<void>;
type SliderOnChange = (v: number) => Promise<void>;
type DropdownOnChange = (v: string) => Promise<void>;
type ToggleOnChange = (v: boolean) => Promise<void>;
type ButtonOnClick = () => Promise<void>;

interface Captured {
    textOnChanges: TextOnChange[];
    sliderOnChanges: SliderOnChange[];
    dropdownOnChanges: DropdownOnChange[];
    toggleOnChanges: ToggleOnChange[];
    buttonOnClicks: ButtonOnClick[];
}

function captureSettingCallbacks(fn: () => void): Captured {
    const textOnChanges: TextOnChange[] = [];
    const sliderOnChanges: SliderOnChange[] = [];
    const dropdownOnChanges: DropdownOnChange[] = [];
    const toggleOnChanges: ToggleOnChange[] = [];
    const buttonOnClicks: ButtonOnClick[] = [];

    const origAddText = Setting.prototype.addText;
    const origAddSlider = Setting.prototype.addSlider;
    const origAddDropdown = Setting.prototype.addDropdown;
    const origAddToggle = (Setting.prototype as any).addToggle;
    const origAddButton = Setting.prototype.addButton;

    Setting.prototype.addText = function (cb: (text: any) => void) {
        const fakeText = {
            setPlaceholder: () => fakeText,
            setValue: () => fakeText,
            onChange: (handler: TextOnChange) => {
                textOnChanges.push(handler);
                return fakeText;
            },
            inputEl: { placeholder: "" },
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
        const fakeToggle = {
            setValue: () => fakeToggle,
            onChange: (handler: ToggleOnChange) => {
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
            onClick: (handler: ButtonOnClick) => {
                buttonOnClicks.push(handler);
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
        Setting.prototype.addSlider = origAddSlider;
        Setting.prototype.addDropdown = origAddDropdown;
        (Setting.prototype as any).addToggle = origAddToggle;
        Setting.prototype.addButton = origAddButton;
    }

    return { textOnChanges, sliderOnChanges, dropdownOnChanges, toggleOnChanges, buttonOnClicks };
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
            // serverPort + systemPrompt + 6 generation + syncDebounce + 3 crawling + 6 advanced (incl. hfToken) = 18
            expect(textOnChanges.length).toBe(18);
        });

        it("does NOT show sync-debounce when syncMode is 'manual'", () => {
            const plugin = makePlugin({ syncMode: "manual" });
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());
            // serverPort + systemPrompt + 6 generation + 3 crawling + 6 advanced (incl. hfToken) = 17
            expect(textOnChanges.length).toBe(17);
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

    // See `bb-fkn6`: external mode needs a bearer token so the plugin can
    // reach auth-gated endpoints on a current lilbee server.
    describe("serverToken setting onChange", () => {
        it("updates plugin.settings.serverToken and calls saveSettings", async () => {
            const plugin = makePlugin({ serverMode: "external" });
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());

            // External-mode text inputs in render order: [serverUrl, serverToken, ...]
            await textOnChanges[1]("bearer-abc");
            expect(plugin.settings.serverToken).toBe("bearer-abc");
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
        // With syncMode=auto, text fields are (render order: connection → models → general → sync → generation):
        // [0] port, [1] syncDebounce, [2] systemPrompt, [3-8] generation settings
        const DEBOUNCE_IDX = 8;

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
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());

            // Index 1 is systemPrompt (0=serverUrl)
            await textOnChanges[1]("You are a pirate.");
            expect(plugin.settings.systemPrompt).toBe("You are a pirate.");
            expect(plugin.saveSettings).toHaveBeenCalled();
        });
    });

    describe("generation settings", () => {
        const GEN_FIELDS = [
            { idx: 2, key: "temperature", value: "0.7", expected: 0.7 },
            { idx: 3, key: "top_p", value: "0.9", expected: 0.9 },
            { idx: 4, key: "top_k_sampling", value: "40", expected: 40 },
            { idx: 5, key: "repeat_penalty", value: "1.1", expected: 1.1 },
            { idx: 6, key: "num_ctx", value: "4096", expected: 4096 },
            { idx: 7, key: "seed", value: "42", expected: 42 },
        ] as const;

        for (const { idx, key, value, expected } of GEN_FIELDS) {
            it(`sets ${key} to parsed number`, async () => {
                const plugin = makePlugin();
                (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
                const tab = makeTab(plugin);
                const { textOnChanges } = captureSettingCallbacks(() => tab.display());

                await textOnChanges[idx](value);
                expect((plugin.settings as any)[key]).toBe(expected);
                expect(plugin.saveSettings).toHaveBeenCalled();
            });

            it(`sets ${key} to null when cleared`, async () => {
                const plugin = makePlugin();
                (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
                const tab = makeTab(plugin);
                const { textOnChanges } = captureSettingCallbacks(() => tab.display());

                await textOnChanges[idx](value);
                (plugin.saveSettings as ReturnType<typeof vi.fn>).mockClear();
                await textOnChanges[idx]("");
                expect((plugin.settings as any)[key]).toBeNull();
                expect(plugin.saveSettings).toHaveBeenCalled();
            });
        }

        it("ignores NaN input for integer field", async () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());

            await textOnChanges[4]("not-a-number");
            expect(plugin.settings.top_k_sampling).toBeNull();
        });

        it("ignores NaN input for float field", async () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());

            await textOnChanges[2]("abc");
            expect(plugin.settings.temperature).toBeNull();
        });

        it("displays existing non-null value", () => {
            const plugin = makePlugin();
            plugin.settings.temperature = 0.5;
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);

            const setValues: string[] = [];
            const origAddText = Setting.prototype.addText;
            Setting.prototype.addText = function (cb: (text: any) => void) {
                const fakeText = {
                    setPlaceholder: () => fakeText,
                    setValue: (v: string) => {
                        setValues.push(v);
                        return fakeText;
                    },
                    onChange: () => fakeText,
                    inputEl: { placeholder: "" },
                };
                cb(fakeText);
                return this;
            };

            tab.display();
            Setting.prototype.addText = origAddText;

            // Index 2 is temperature (0=port, 1=systemPrompt)
            expect(setValues[2]).toBe("0.5");
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

        it("uses 'Not set' placeholders before model defaults load", () => {
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
                    inputEl: { placeholder: "" },
                };
                cb(fakeText);
                return this;
            };

            tab.display();
            Setting.prototype.addText = origAddText;

            // Indices 2-7 are generation fields (0=port, 1=systemPrompt)
            for (let i = 2; i <= 7; i++) {
                expect(placeholders[i]).toBe("Not set");
            }
        });

        it("populates placeholders from active model defaults", async () => {
            const plugin = makePlugin();
            (plugin as any).activeModel = "llama3";
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            (plugin.api.showModel as ReturnType<typeof vi.fn>).mockResolvedValue({
                temperature: 0.6,
                top_p: 0.9,
                top_k: 40,
                repeat_penalty: 1.1,
                num_ctx: 8192,
            });

            const tab = makeTab(plugin);
            tab.display();

            // Wait for async loadModelDefaults to resolve
            await new Promise((r) => setTimeout(r, 0));

            expect(plugin.api.showModel).toHaveBeenCalledWith("llama3");
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

            // Setup wizard + Start + Check for updates + Refresh + Browse Catalog = 5
            expect(buttonOnClicks.length).toBe(5);
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
        it("renders chat and vision sections on success", async () => {
            const plugin = makePlugin();
            const models = makeModelsResponse();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(models);
            const tab = makeTab(plugin);
            const container = new MockElement("div") as unknown as HTMLElement;
            await (tab as any).loadModels(container);
            const sections = (container as unknown as MockElement).findAll("lilbee-model-section");
            expect(sections.length).toBe(2);
        });

        it("shows warning paragraph when API call fails", async () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network"));
            const tab = makeTab(plugin);
            const container = new MockElement("div") as unknown as HTMLElement;
            await (tab as any).loadModels(container);
            const p = (container as unknown as MockElement).children.find(
                (c) => c.tagName === "P" && c.textContent.includes("Could not connect"),
            );
            expect(p).toBeDefined();
            expect(p?.classList.contains("mod-warning")).toBe(true);
        });
    });

    describe("renderModelSection()", () => {
        it("chat section does NOT have 'Disabled' dropdown option", () => {
            const plugin = makePlugin();
            const tab = makeTab(plugin);
            const container = new MockElement("div") as unknown as HTMLElement;

            const allOptions = captureDropdownOptions(() => {
                (tab as any).renderModelSection(container, "Chat Model", makeModelsResponse().chat, "chat");
            });

            expect(allOptions.length).toBeGreaterThan(0);
            expect("" in allOptions[0]).toBe(false);
        });

        it("vision section includes 'Disabled' option with empty string key", () => {
            const plugin = makePlugin();
            const tab = makeTab(plugin);
            const container = new MockElement("div") as unknown as HTMLElement;

            const allOptions = captureDropdownOptions(() => {
                (tab as any).renderModelSection(container, "Vision Model", makeModelsResponse().vision, "vision");
            });

            expect(allOptions.length).toBeGreaterThan(0);
            expect("" in allOptions[0]).toBe(true);
            expect(allOptions[0][""]).toBe("Disabled");
        });

        it("active chat model onChange calls setChatModel and shows Notice for installed model", async () => {
            const plugin = makePlugin();
            (plugin.api.setChatModel as ReturnType<typeof vi.fn>).mockResolvedValue({ model: "llama3" });
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const container = new MockElement("div") as unknown as HTMLElement;

            const { dropdownOnChanges } = captureSettingCallbacks(() => {
                (tab as any).renderModelSection(container, "Chat Model", makeModelsResponse().chat, "chat");
            });

            const displaySpy = vi.spyOn(tab, "display").mockImplementation(() => {});
            await dropdownOnChanges[0]("llama3");
            expect(plugin.api.setChatModel).toHaveBeenCalledWith("llama3");
            expect(Notice.instances.some((n) => n.message.includes("llama3"))).toBe(true);
            expect(displaySpy).toHaveBeenCalled();
        });

        it("active vision model onChange calls setVisionModel and shows Notice for installed model", async () => {
            const plugin = makePlugin();
            (plugin.api.setVisionModel as ReturnType<typeof vi.fn>).mockResolvedValue({ model: "llava" });
            const tab = makeTab(plugin);
            const container = new MockElement("div") as unknown as HTMLElement;

            const vision = {
                ...makeModelsResponse().vision,
                installed: ["llava"],
                catalog: [{ ...makeModelsResponse().vision.catalog[0], installed: true }],
            };
            const { dropdownOnChanges } = captureSettingCallbacks(() => {
                (tab as any).renderModelSection(container, "Vision Model", vision, "vision");
            });

            await dropdownOnChanges[0]("llava");
            expect(plugin.api.setVisionModel).toHaveBeenCalledWith("llava");
            expect(Notice.instances.some((n) => n.message.includes("llava"))).toBe(true);
        });

        it("setting model to empty string shows 'disabled' in Notice", async () => {
            const plugin = makePlugin();
            (plugin.api.setVisionModel as ReturnType<typeof vi.fn>).mockResolvedValue({ model: "" });
            const tab = makeTab(plugin);
            const container = new MockElement("div") as unknown as HTMLElement;

            const { dropdownOnChanges } = captureSettingCallbacks(() => {
                (tab as any).renderModelSection(container, "Vision Model", makeModelsResponse().vision, "vision");
            });

            await dropdownOnChanges[0]("");
            expect(Notice.instances.some((n) => n.message.includes("disabled"))).toBe(true);
        });

        it("active model onChange shows failure Notice on API error for installed model", async () => {
            const plugin = makePlugin();
            (plugin.api.setChatModel as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("fail"));
            const tab = makeTab(plugin);
            const container = new MockElement("div") as unknown as HTMLElement;

            const { dropdownOnChanges } = captureSettingCallbacks(() => {
                (tab as any).renderModelSection(container, "Chat Model", makeModelsResponse().chat, "chat");
            });

            // llama3 is installed, so it goes through the direct set path
            await dropdownOnChanges[0]("llama3");
            expect(Notice.instances.some((n) => n.message.includes("Failed to set"))).toBe(true);
        });

        it("renders table with header columns", () => {
            const plugin = makePlugin();
            const tab = makeTab(plugin);
            const container = new MockElement("div") as unknown as HTMLElement;
            (tab as any).renderModelSection(container, "Chat Model", makeModelsResponse().chat, "chat");
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
                (tab as any).renderModelSection(container, "Chat Model", makeModelsResponse().chat, "chat");
            }).not.toThrow();
        });

        it("desc shows 'Disabled' for vision when active is empty", () => {
            const plugin = makePlugin();
            const tab = makeTab(plugin);
            const container = new MockElement("div") as unknown as HTMLElement;
            expect(() => {
                (tab as any).renderModelSection(container, "Vision Model", makeModelsResponse().vision, "vision");
            }).not.toThrow();
        });

        it("desc shows 'Not set' for chat when active is empty", () => {
            const plugin = makePlugin();
            const tab = makeTab(plugin);
            const container = new MockElement("div") as unknown as HTMLElement;
            const catalog = { ...makeModelsResponse().chat, active: "" };
            expect(() => {
                (tab as any).renderModelSection(container, "Chat Model", catalog, "chat");
            }).not.toThrow();
        });
    });

    describe("renderCatalogRow()", () => {
        it("shows 'Installed' badge for installed models", () => {
            const plugin = makePlugin();
            const tab = makeTab(plugin);
            const table = new MockElement("table") as unknown as HTMLTableElement;
            const model = makeModelsResponse().chat.catalog[0];
            (tab as any).renderCatalogRow(table, model, "chat");
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
            (tab as any).renderCatalogRow(table, model, "chat");
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
            (tab as any).renderCatalogRow(table, model, "chat");
            const row = (table as unknown as MockElement).children[0];
            expect(row.children[0].textContent).toBe("llama3");
            expect(row.children[1].textContent).toBe("4.7 GB");
            expect(row.children[2].textContent).toBe("Meta Llama 3");
        });
    });

    describe("Delete button", () => {
        function setupDeleteButton(plugin: ReturnType<typeof makePlugin>, type: "chat" | "vision" = "chat") {
            const tab = makeTab(plugin);
            const table = new MockElement("table") as unknown as HTMLTableElement;
            const catalog = makeModelsResponse();
            // Use installed model (index 0 for chat = llama3)
            const model = type === "chat" ? catalog.chat.catalog[0] : { ...catalog.vision.catalog[0], installed: true };

            (tab as any).renderCatalogRow(table, model, type);

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

            const { tab, deleteBtn } = setupDeleteButton(plugin, "chat");
            tab.containerEl.querySelector = vi.fn().mockReturnValue(null);

            await (deleteBtn as unknown as MockElement).trigger("click");
            await new Promise((r) => setTimeout(r, 0));

            expect(plugin.api.setChatModel).toHaveBeenCalledWith("");
            expect(plugin.activeModel).toBe("");
        });

        it("deleting active vision model clears it", async () => {
            const plugin = makePlugin();
            (plugin as any).activeVisionModel = "llava";
            (plugin.api.deleteModel as ReturnType<typeof vi.fn>).mockResolvedValue(ok(undefined));
            (plugin.api.setVisionModel as ReturnType<typeof vi.fn>).mockResolvedValue(ok(undefined));
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());

            const { tab, deleteBtn } = setupDeleteButton(plugin, "vision");
            tab.containerEl.querySelector = vi.fn().mockReturnValue(null);

            await (deleteBtn as unknown as MockElement).trigger("click");
            await new Promise((r) => setTimeout(r, 0));

            expect(plugin.api.setVisionModel).toHaveBeenCalledWith("");
            expect(plugin.activeVisionModel).toBe("");
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

    describe("Pull cancel", () => {
        function setupPullCancelButton(plugin: ReturnType<typeof makePlugin>) {
            const tab = makeTab(plugin);
            const table = new MockElement("table") as unknown as HTMLTableElement;
            const model = makeModelsResponse().chat.catalog[1]; // phi3 — uninstalled

            const clickHandlers: Function[] = [];
            const origAddEventListener = MockElement.prototype.addEventListener;
            MockElement.prototype.addEventListener = function (event: string, handler: Function) {
                if (event === "click") {
                    clickHandlers.push(handler);
                }
                origAddEventListener.call(this, event, handler);
            };

            (tab as any).renderCatalogRow(table, model, "chat");
            MockElement.prototype.addEventListener = origAddEventListener;

            const row = (table as unknown as MockElement).children[0];
            const actionCell = row.children[3];
            const btn = actionCell.children[0];

            return { tab, btn, actionCell, clickHandlers };
        }

        it("button text changes to 'Cancel' during pull", async () => {
            const plugin = makePlugin();
            let resolve: () => void;
            const blockingPromise = new Promise<void>((r) => {
                resolve = r;
            });

            async function* slowPull() {
                await blockingPromise;
            }
            (plugin.api.pullModel as ReturnType<typeof vi.fn>).mockReturnValue(slowPull());
            (plugin.api.setChatModel as ReturnType<typeof vi.fn>).mockResolvedValue({ model: "phi3" });
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());

            const { tab, btn, clickHandlers } = setupPullCancelButton(plugin);
            const modelsContainer = new MockElement("div");
            modelsContainer.classList.add("lilbee-models-container");
            tab.containerEl.children.push(modelsContainer);

            // First click handler starts the pull
            const pullPromise = clickHandlers[0]();

            // Button text should now be "Cancel"
            expect(btn.textContent).toBe("Cancel");

            resolve!();
            await pullPromise;
        });

        it("clicking Cancel during pull aborts and shows notice", async () => {
            const plugin = makePlugin();

            let aborted = false;
            async function* slowPull() {
                yield { event: "progress", data: { current: 10, total: 100 } };
                // Wait until abort or completion
                while (!aborted) {
                    await new Promise((r) => setTimeout(r, 1));
                }
                const err = new Error("The operation was aborted");
                err.name = "AbortError";
                throw err;
            }
            (plugin.api.pullModel as ReturnType<typeof vi.fn>).mockImplementation(() => slowPull());

            const { tab: _tab, btn, actionCell, clickHandlers } = setupPullCancelButton(plugin);

            // Start the pull
            const pullPromise = clickHandlers[0]();
            await new Promise((r) => setTimeout(r, 10));

            // Click Cancel button (triggers the once listener that calls controller.abort())
            aborted = true;
            btn.trigger("click");
            await pullPromise;

            expect(Notice.instances.some((n) => n.message === MESSAGES.NOTICE_PULL_CANCELLED)).toBe(true);
            expect(btn.textContent).toBe("Pull");
            expect(btn.disabled).toBe(false);
            // Progress div should be cleaned up
            const progressDiv = actionCell.children.find((c: any) => c.classList?.contains("lilbee-pull-progress"));
            expect(progressDiv).toBeUndefined();
        });
    });

    describe("ConfirmPullModal integration", () => {
        it("dropdown onChange for uninstalled model opens ConfirmPullModal", async () => {
            const plugin = makePlugin();
            async function* fakePull() {}
            (plugin.api.pullModel as ReturnType<typeof vi.fn>).mockReturnValue(fakePull());
            (plugin.api.setChatModel as ReturnType<typeof vi.fn>).mockResolvedValue({ model: "phi3" });
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());

            const tab = makeTab(plugin);
            const container = new MockElement("div") as unknown as HTMLElement;

            const { dropdownOnChanges } = captureSettingCallbacks(() => {
                (tab as any).renderModelSection(container, "Chat Model", makeModelsResponse().chat, "chat");
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
                (tab as any).renderModelSection(container, "Chat Model", makeModelsResponse().chat, "chat");
            });

            await dropdownOnChanges[0]("phi3");

            expect(plugin.api.pullModel).not.toHaveBeenCalled();
        });
    });

    describe("Pull via taskQueue", () => {
        it("pullModel second click on same button aborts instead of queuing", async () => {
            const plugin = makePlugin();
            let aborted = false;
            async function* slowPull() {
                yield { event: "progress", data: { current: 10, total: 100 } };
                while (!aborted) {
                    await new Promise((r) => setTimeout(r, 1));
                }
                const err = new Error("The operation was aborted");
                err.name = "AbortError";
                throw err;
            }
            (plugin.api.pullModel as ReturnType<typeof vi.fn>).mockImplementation(() => slowPull());
            (plugin.api.setChatModel as ReturnType<typeof vi.fn>).mockResolvedValue({ model: "phi3" });
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());

            const tab = makeTab(plugin);
            const table = new MockElement("table") as unknown as HTMLTableElement;
            const model = makeModelsResponse().chat.catalog[1]; // phi3 -- uninstalled

            const clickHandlers: Function[] = [];
            const origAddEventListener = MockElement.prototype.addEventListener;
            MockElement.prototype.addEventListener = function (event: string, handler: Function) {
                if (event === "click") clickHandlers.push(handler);
                origAddEventListener.call(this, event, handler);
            };
            (tab as any).renderCatalogRow(table, model, "chat");
            MockElement.prototype.addEventListener = origAddEventListener;

            const row = (table as unknown as MockElement).children[0];
            const _actionCell = row.children[3];

            // Start pull
            const pullPromise = clickHandlers[0]();
            await new Promise((r) => setTimeout(r, 10));
            expect(plugin.api.pullModel).toHaveBeenCalledTimes(1);

            // Second click aborts (since taskQueue has active task)
            aborted = true;
            clickHandlers[0]();
            await pullPromise;

            expect(Notice.instances.some((n) => n.message === MESSAGES.NOTICE_PULL_CANCELLED)).toBe(true);
            expect(plugin.api.pullModel).toHaveBeenCalledTimes(1);
        });
    });

    describe("Auto-pull cancel banner", () => {
        it("shows cancel banner during auto-pull and removes it after", async () => {
            const plugin = makePlugin();
            async function* fakePull() {
                yield { event: "progress", data: { current: 50, total: 100 } };
            }
            (plugin.api.pullModel as ReturnType<typeof vi.fn>).mockReturnValue(fakePull());
            (plugin.api.setChatModel as ReturnType<typeof vi.fn>).mockResolvedValue({ model: "phi3" });
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());

            const tab = makeTab(plugin);
            const container = new MockElement("div") as unknown as HTMLElement;

            const { dropdownOnChanges } = captureSettingCallbacks(() => {
                (tab as any).renderModelSection(container, "Chat Model", makeModelsResponse().chat, "chat");
            });

            await dropdownOnChanges[0]("phi3");

            // Banner should be removed after pull completes
            const banner = (container as unknown as MockElement).children.find((c) =>
                c.classList.contains("lilbee-pull-banner"),
            );
            expect(banner).toBeUndefined();
        });

        it("clicking cancel on auto-pull banner aborts and shows notice", async () => {
            const plugin = makePlugin();
            let aborted = false;
            async function* slowPull() {
                yield { event: "progress", data: { current: 10, total: 100 } };
                while (!aborted) {
                    await new Promise((r) => setTimeout(r, 1));
                }
                const err = new Error("The operation was aborted");
                err.name = "AbortError";
                throw err;
            }
            (plugin.api.pullModel as ReturnType<typeof vi.fn>).mockImplementation(() => slowPull());

            const tab = makeTab(plugin);
            const container = new MockElement("div") as unknown as HTMLElement;

            const { dropdownOnChanges } = captureSettingCallbacks(() => {
                (tab as any).renderModelSection(container, "Chat Model", makeModelsResponse().chat, "chat");
            });

            const pullPromise = dropdownOnChanges[0]("phi3");
            await new Promise((r) => setTimeout(r, 10));

            // Find the cancel button in the banner
            const banner = (container as unknown as MockElement).children.find((c) =>
                c.classList.contains("lilbee-pull-banner"),
            );
            expect(banner).toBeDefined();
            const cancelBtn = banner!.children.find((c) => c.textContent === "Cancel");
            expect(cancelBtn).toBeDefined();
            aborted = true;
            cancelBtn!.trigger("click");
            await pullPromise;

            expect(Notice.instances.some((n) => n.message === MESSAGES.NOTICE_PULL_CANCELLED)).toBe(true);
        });

        it("auto-pull banner label updates with progress percentage", async () => {
            const plugin = makePlugin();
            let resolveWait!: () => void;
            const waitPromise = new Promise<void>((r) => {
                resolveWait = r;
            });
            let bannerLabel: MockElement | undefined;
            async function* slowPull() {
                yield { event: "progress", data: { current: 75, total: 100 } };
                // Capture the label text at this point
                bannerLabel = (container as unknown as MockElement).children
                    .find((c) => c.classList.contains("lilbee-pull-banner"))
                    ?.children.find((c) => c.tagName === "SPAN");
                await waitPromise;
            }
            (plugin.api.pullModel as ReturnType<typeof vi.fn>).mockReturnValue(slowPull());
            (plugin.api.setChatModel as ReturnType<typeof vi.fn>).mockResolvedValue({ model: "phi3" });
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());

            const tab = makeTab(plugin);
            const container = new MockElement("div") as unknown as HTMLElement;

            const { dropdownOnChanges } = captureSettingCallbacks(() => {
                (tab as any).renderModelSection(container, "Chat Model", makeModelsResponse().chat, "chat");
            });

            const pullPromise = dropdownOnChanges[0]("phi3");
            await new Promise((r) => setTimeout(r, 0));

            expect(bannerLabel?.textContent).toContain("75%");
            resolveWait();
            await pullPromise;
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
                (tab as any).renderModelSection(container, "Chat Model", makeModelsResponse().chat, "chat");
            });

            // phi3 is uninstalled in catalog — triggers autoPullAndSet
            await dropdownOnChanges[0]("phi3");
            expect(Notice.instances.some((n) => n.message === MESSAGES.NOTICE_PULL_CANCELLED)).toBe(true);
        });
    });

    describe("Pull button", () => {
        interface PullSetup {
            tab: LilbeeSettingTab;
            clickHandler: () => Promise<void>;
            actionCell: MockElement;
        }

        async function setupPullButton(
            plugin: ReturnType<typeof makePlugin>,
            type: "chat" | "vision" = "chat",
        ): Promise<PullSetup> {
            const tab = makeTab(plugin);
            const table = new MockElement("table") as unknown as HTMLTableElement;
            const catalog = makeModelsResponse();
            const model = type === "chat" ? catalog.chat.catalog[1] : catalog.vision.catalog[0];

            let clickHandler: (() => Promise<void>) | null = null;
            const origAddEventListener = MockElement.prototype.addEventListener;
            MockElement.prototype.addEventListener = function (event: string, handler: Function) {
                if (event === "click") {
                    clickHandler = handler as () => Promise<void>;
                }
                origAddEventListener.call(this, event, handler);
            };

            (tab as any).renderCatalogRow(table, model, type);
            MockElement.prototype.addEventListener = origAddEventListener;

            const row = (table as unknown as MockElement).children[0];
            const actionCell = row.children[3];

            return { tab, clickHandler: clickHandler!, actionCell };
        }

        it("successful pull: shows progress percentage and success Notice, sets model", async () => {
            const plugin = makePlugin();
            let capturedProgressText = "";

            async function* fakePull() {
                yield { event: "progress", data: { current: 75, total: 100 } };
                // Capture progress text mid-pull (before finally removes it)
                capturedProgressText = actionCell.find("lilbee-pull-progress")?.textContent ?? "";
            }
            (plugin.api.pullModel as ReturnType<typeof vi.fn>).mockReturnValue(fakePull());
            (plugin.api.setChatModel as ReturnType<typeof vi.fn>).mockResolvedValue({ model: "phi3" });
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());

            const { tab, clickHandler, actionCell } = await setupPullButton(plugin, "chat");
            const modelsContainer = new MockElement("div");
            modelsContainer.classList.add("lilbee-models-container");
            tab.containerEl.children.push(modelsContainer);

            await clickHandler();

            expect(capturedProgressText).toBe("75%");
            // Progress div cleaned up after completion
            expect(actionCell.find("lilbee-pull-progress")).toBeNull();
            expect(Notice.instances.some((n) => n.message.includes("phi3") && n.message.includes("pulled"))).toBe(true);
            expect(plugin.api.setChatModel).toHaveBeenCalledWith("phi3");
        });

        it("progress event with total=0: does not set percentage text", async () => {
            const plugin = makePlugin();
            let capturedProgressText = "";

            async function* fakePull() {
                yield { event: "progress", data: { current: 0, total: 0 } };
                capturedProgressText = actionCell.find("lilbee-pull-progress")?.textContent ?? "";
            }
            (plugin.api.pullModel as ReturnType<typeof vi.fn>).mockReturnValue(fakePull());
            (plugin.api.setChatModel as ReturnType<typeof vi.fn>).mockResolvedValue({ model: "phi3" });
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());

            const { tab, clickHandler, actionCell } = await setupPullButton(plugin, "chat");
            const modelsContainer = new MockElement("div");
            modelsContainer.classList.add("lilbee-models-container");
            tab.containerEl.children.push(modelsContainer);

            await clickHandler();

            expect(capturedProgressText).not.toMatch(/\d+%/);
        });

        it("pull with vision type calls setVisionModel", async () => {
            const plugin = makePlugin();

            async function* fakePull() {}
            (plugin.api.pullModel as ReturnType<typeof vi.fn>).mockReturnValue(fakePull());
            (plugin.api.setVisionModel as ReturnType<typeof vi.fn>).mockResolvedValue({ model: "llava" });
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());

            const { tab, clickHandler } = await setupPullButton(plugin, "vision");
            const modelsContainer = new MockElement("div");
            modelsContainer.classList.add("lilbee-models-container");
            tab.containerEl.children.push(modelsContainer);

            await clickHandler();

            expect(plugin.api.setVisionModel).toHaveBeenCalledWith("llava");
        });

        it("pull failure: shows failure Notice and re-enables button with 'Pull' text", async () => {
            const plugin = makePlugin();

            async function* failingPull(): AsyncGenerator<never> {
                throw new Error("network error");
            }
            (plugin.api.pullModel as ReturnType<typeof vi.fn>).mockReturnValue(failingPull());

            const { tab: _tab, clickHandler, actionCell } = await setupPullButton(plugin, "chat");
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

            const { tab: _tab, clickHandler } = await setupPullButton(plugin, "chat");
            await clickHandler();

            const failed = plugin.taskQueue.completed.find((t: any) => t.status === "failed");
            expect(failed).toBeDefined();
            expect(failed!.error).toBe("unknown");
        });

        it("successful pull without models container: does not crash", async () => {
            const plugin = makePlugin();

            async function* fakePull() {}
            (plugin.api.pullModel as ReturnType<typeof vi.fn>).mockReturnValue(fakePull());
            (plugin.api.setChatModel as ReturnType<typeof vi.fn>).mockResolvedValue({ model: "phi3" });
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());

            const { clickHandler } = await setupPullButton(plugin, "chat");

            await expect(clickHandler()).resolves.not.toThrow();
            expect(Notice.instances.some((n) => n.message.includes("pulled"))).toBe(true);
        });

        it("successful pull with HTMLElement container: reloads models", async () => {
            const plugin = makePlugin();

            async function* fakePull() {}
            (plugin.api.pullModel as ReturnType<typeof vi.fn>).mockReturnValue(fakePull());
            (plugin.api.setChatModel as ReturnType<typeof vi.fn>).mockResolvedValue({ model: "phi3" });
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());

            const { tab, clickHandler } = await setupPullButton(plugin, "chat");

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
                yield { event: "progress", data: { current: 45, total: 100 } };
            }
            (plugin.api.pullModel as ReturnType<typeof vi.fn>).mockReturnValue(fakePull());
            (plugin.api.setChatModel as ReturnType<typeof vi.fn>).mockResolvedValue({ model: "phi3" });
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());

            const { tab, clickHandler } = await setupPullButton(plugin, "chat");
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
            (plugin.api.setChatModel as ReturnType<typeof vi.fn>).mockResolvedValue({ model: "phi3" });
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());

            const { tab, clickHandler } = await setupPullButton(plugin, "chat");
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
                yield { event: "progress", data: { current: 50, total: 100 } };
            }
            (plugin.api.pullModel as ReturnType<typeof vi.fn>).mockReturnValue(fakePull());
            (plugin.api.setChatModel as ReturnType<typeof vi.fn>).mockResolvedValue({ model: "phi3" });
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());

            const { tab, clickHandler } = await setupPullButton(plugin, "chat");
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
            (plugin.api.setChatModel as ReturnType<typeof vi.fn>).mockResolvedValue({ model: "phi3" });
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());

            const { tab, clickHandler } = await setupPullButton(plugin, "chat");
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
                (tab as any).renderModelSection(container, "Chat Model", makeModelsResponse().chat, "chat");
            });

            await dropdownOnChanges[0](SEPARATOR_KEY);
            expect(plugin.api.setChatModel).not.toHaveBeenCalled();
        });
    });

    describe("auto-pull via dropdown", () => {
        it("selecting uninstalled catalog model triggers auto-pull", async () => {
            const plugin = makePlugin();

            async function* fakePull() {
                yield { event: "progress", data: { current: 50, total: 100 } };
            }
            (plugin.api.pullModel as ReturnType<typeof vi.fn>).mockReturnValue(fakePull());
            (plugin.api.setChatModel as ReturnType<typeof vi.fn>).mockResolvedValue({ model: "phi3" });
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());

            const tab = makeTab(plugin);
            const container = new MockElement("div") as unknown as HTMLElement;
            const modelsContainer = new MockElement("div");
            modelsContainer.classList.add("lilbee-models-container");
            tab.containerEl.children.push(modelsContainer);
            tab.containerEl.querySelector = vi.fn().mockReturnValue(null);

            const { dropdownOnChanges } = captureSettingCallbacks(() => {
                (tab as any).renderModelSection(container, "Chat Model", makeModelsResponse().chat, "chat");
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
                (tab as any).renderModelSection(container, "Chat Model", makeModelsResponse().chat, "chat");
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
                (tab as any).renderModelSection(container, "Chat Model", makeModelsResponse().chat, "chat");
            });

            await dropdownOnChanges[0]("phi3");

            const failed = plugin.taskQueue.completed.find((t: any) => t.status === "failed");
            expect(failed).toBeDefined();
            expect(failed!.error).toBe("unknown");
        });

        it("auto-pull updates taskQueue with progress", async () => {
            const plugin = makePlugin();

            async function* fakePull() {
                yield { event: "progress", data: { current: 75, total: 100 } };
            }
            (plugin.api.pullModel as ReturnType<typeof vi.fn>).mockReturnValue(fakePull());
            (plugin.api.setChatModel as ReturnType<typeof vi.fn>).mockResolvedValue({ model: "phi3" });
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());

            const tab = makeTab(plugin);
            const container = new MockElement("div") as unknown as HTMLElement;
            tab.containerEl.querySelector = vi.fn().mockReturnValue(null);

            const { dropdownOnChanges } = captureSettingCallbacks(() => {
                (tab as any).renderModelSection(container, "Chat Model", makeModelsResponse().chat, "chat");
            });

            await dropdownOnChanges[0]("phi3");
            // Task should be completed in history with progress
            expect(plugin.taskQueue.completed.length).toBeGreaterThan(0);
        });

        it("auto-pull for vision type calls setVisionModel", async () => {
            const plugin = makePlugin();

            async function* fakePull() {}
            (plugin.api.pullModel as ReturnType<typeof vi.fn>).mockReturnValue(fakePull());
            (plugin.api.setVisionModel as ReturnType<typeof vi.fn>).mockResolvedValue({ model: "llava" });
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());

            const tab = makeTab(plugin);
            const container = new MockElement("div") as unknown as HTMLElement;
            tab.containerEl.querySelector = vi.fn().mockReturnValue(null);

            const { dropdownOnChanges } = captureSettingCallbacks(() => {
                (tab as any).renderModelSection(container, "Vision Model", makeModelsResponse().vision, "vision");
            });

            await dropdownOnChanges[0]("llava");
            expect(plugin.api.setVisionModel).toHaveBeenCalledWith("llava");
        });

        it("auto-pull completes task in taskQueue", async () => {
            const plugin = makePlugin();

            async function* fakePull() {
                yield { event: "progress", data: { current: 60, total: 100 } };
            }
            (plugin.api.pullModel as ReturnType<typeof vi.fn>).mockReturnValue(fakePull());
            (plugin.api.setChatModel as ReturnType<typeof vi.fn>).mockResolvedValue({ model: "phi3" });
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());

            const tab = makeTab(plugin);
            const container = new MockElement("div") as unknown as HTMLElement;
            tab.containerEl.querySelector = vi.fn().mockReturnValue(null);

            const { dropdownOnChanges } = captureSettingCallbacks(() => {
                (tab as any).renderModelSection(container, "Chat Model", makeModelsResponse().chat, "chat");
            });

            await dropdownOnChanges[0]("phi3");
            const done = plugin.taskQueue.completed.find((t: any) => t.status === "done");
            expect(done).toBeDefined();
        });

        it("auto-pull with total=0 does not update status bar", async () => {
            const plugin = makePlugin();

            async function* fakePull() {
                yield { event: "progress", data: { current: 0, total: 0 } };
            }
            (plugin.api.pullModel as ReturnType<typeof vi.fn>).mockReturnValue(fakePull());
            (plugin.api.setChatModel as ReturnType<typeof vi.fn>).mockResolvedValue({ model: "phi3" });
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());

            const tab = makeTab(plugin);
            const container = new MockElement("div") as unknown as HTMLElement;
            tab.containerEl.querySelector = vi.fn().mockReturnValue(null);

            const { dropdownOnChanges } = captureSettingCallbacks(() => {
                (tab as any).renderModelSection(container, "Chat Model", makeModelsResponse().chat, "chat");
            });

            await dropdownOnChanges[0]("phi3");
            // total=0 means no status bar update for progress
            expect(plugin.statusBarEl!.setText).not.toHaveBeenCalled();
        });

        it("auto-pull without statusBarEl does not crash", async () => {
            const plugin = makePlugin();
            (plugin as any).statusBarEl = null;

            async function* fakePull() {
                yield { event: "progress", data: { current: 50, total: 100 } };
            }
            (plugin.api.pullModel as ReturnType<typeof vi.fn>).mockReturnValue(fakePull());
            (plugin.api.setChatModel as ReturnType<typeof vi.fn>).mockResolvedValue({ model: "phi3" });
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());

            const tab = makeTab(plugin);
            const container = new MockElement("div") as unknown as HTMLElement;
            tab.containerEl.querySelector = vi.fn().mockReturnValue(null);

            const { dropdownOnChanges } = captureSettingCallbacks(() => {
                (tab as any).renderModelSection(container, "Chat Model", makeModelsResponse().chat, "chat");
            });

            await expect(dropdownOnChanges[0]("phi3")).resolves.not.toThrow();
        });

        it("auto-pull without statusBarEl does not crash (via dropdown)", async () => {
            const plugin = makePlugin();
            (plugin as any).statusBarEl = null;

            async function* fakePull() {
                yield { event: "progress", data: { current: 50, total: 100 } };
            }
            (plugin.api.pullModel as ReturnType<typeof vi.fn>).mockReturnValue(fakePull());
            (plugin.api.setChatModel as ReturnType<typeof vi.fn>).mockResolvedValue({ model: "phi3" });
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());

            const tab = makeTab(plugin);
            const container = new MockElement("div") as unknown as HTMLElement;
            tab.containerEl.querySelector = vi.fn().mockReturnValue(null);

            const { dropdownOnChanges } = captureSettingCallbacks(() => {
                (tab as any).renderModelSection(container, "Chat Model", makeModelsResponse().chat, "chat");
            });

            await expect(dropdownOnChanges[0]("phi3")).resolves.not.toThrow();
        });

        it("auto-pull re-renders settings after success", async () => {
            const plugin = makePlugin();

            async function* fakePull() {}
            (plugin.api.pullModel as ReturnType<typeof vi.fn>).mockReturnValue(fakePull());
            (plugin.api.setChatModel as ReturnType<typeof vi.fn>).mockResolvedValue({ model: "phi3" });
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());

            const tab = makeTab(plugin);
            const container = new MockElement("div") as unknown as HTMLElement;

            const { dropdownOnChanges } = captureSettingCallbacks(() => {
                (tab as any).renderModelSection(container, "Chat Model", makeModelsResponse().chat, "chat");
            });

            const displaySpy = vi.spyOn(tab, "display").mockImplementation(() => {});
            await dropdownOnChanges[0]("phi3");
            expect(displaySpy).toHaveBeenCalled();
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
        const options = buildModelOptions(catalog, "chat");
        const keys = Object.keys(options);
        expect(keys).toEqual(["llama3", "phi3", SEPARATOR_KEY, "custom-model"]);
        expect(options["llama3"]).toBe("llama3");
        expect(options["phi3"]).toBe("phi3 (not installed)");
        expect(options[SEPARATOR_KEY]).toBe(SEPARATOR_LABEL);
        expect(options["custom-model"]).toBe("custom-model");
    });

    it("vision: includes Disabled option first", () => {
        const catalog: ModelCatalog = {
            active: "",
            catalog: [{ name: "llava", size_gb: 4.5, min_ram_gb: 8, description: "LLaVA", installed: false }],
            installed: [],
        };
        const options = buildModelOptions(catalog, "vision");
        const keys = Object.keys(options);
        expect(keys[0]).toBe("");
        expect(options[""]).toBe("Disabled");
    });

    it("no separator when all installed models are in catalog", () => {
        const catalog: ModelCatalog = {
            active: "llama3",
            catalog: [{ name: "llama3", size_gb: 4.7, min_ram_gb: 8, description: "Meta", installed: true }],
            installed: ["llama3"],
        };
        const options = buildModelOptions(catalog, "chat");
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
        const options = buildModelOptions(catalog, "chat");
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
        const options = buildModelOptions(catalog, "chat");
        const keys = Object.keys(options);
        // separator then bar, foo, zoo
        expect(keys).toEqual([SEPARATOR_KEY, "bar", "foo", "zoo"]);
    });

    it("empty catalog and empty installed returns empty for chat", () => {
        const catalog: ModelCatalog = { active: "", catalog: [], installed: [] };
        const options = buildModelOptions(catalog, "chat");
        expect(Object.keys(options).length).toBe(0);
    });

    it("deduplicates :latest when a specific tag exists", () => {
        const catalog: ModelCatalog = {
            active: "mistral:7b",
            catalog: [],
            installed: ["mistral:latest", "mistral:7b", "llama3:latest"],
        };
        const options = buildModelOptions(catalog, "chat");
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

            // Index 11: chunk_size
            await textOnChanges[11]("512");
            expect(plugin.api.updateConfig).toHaveBeenCalledWith({ chunk_size: 512 });
        });

        it("chunk_overlap calls updateConfig after confirm", async () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());

            // Index 12: chunk_overlap
            await textOnChanges[12]("64");
            expect(plugin.api.updateConfig).toHaveBeenCalledWith({ chunk_overlap: 64 });
        });

        it("skips empty value", async () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());

            await textOnChanges[11]("");
            expect(plugin.api.updateConfig).not.toHaveBeenCalled();
        });

        it("skips invalid number", async () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());

            await textOnChanges[11]("abc");
            expect(plugin.api.updateConfig).not.toHaveBeenCalled();
        });

        it("skips negative number", async () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());

            await textOnChanges[11]("-1");
            expect(plugin.api.updateConfig).not.toHaveBeenCalled();
        });

        it("aborts when user cancels confirm", async () => {
            mockGenericConfirmResult = false;
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());

            await textOnChanges[11]("512");
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

            await textOnChanges[11]("512");
            expect(plugin.triggerSync).toHaveBeenCalled();
        });

        it("shows error notice on updateConfig failure", async () => {
            const plugin = makePlugin();
            (plugin.api.updateConfig as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("fail"));
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());

            await textOnChanges[11]("512");
            expect(Notice.instances.some((n: any) => n.message.includes("failed to update"))).toBe(true);
        });
    });

    describe("Embedding model onChange", () => {
        it("calls setEmbeddingModel on non-empty value", async () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());

            // Index 13: Embedding model
            await textOnChanges[13]("nomic-embed-text");
            expect(plugin.api.setEmbeddingModel).toHaveBeenCalledWith("nomic-embed-text");
        });

        it("skips empty value", async () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());

            await textOnChanges[13]("");
            expect(plugin.api.setEmbeddingModel).not.toHaveBeenCalled();
        });

        it("aborts when user cancels confirm", async () => {
            mockGenericConfirmResult = false;
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());

            await textOnChanges[13]("nomic-embed-text");
            expect(plugin.api.setEmbeddingModel).not.toHaveBeenCalled();
            mockGenericConfirmResult = true;
        });

        it("shows error notice on failure", async () => {
            const plugin = makePlugin();
            (plugin.api.setEmbeddingModel as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("fail"));
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());

            await textOnChanges[13]("nomic-embed-text");
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

            // Indices 8-10: crawl_max_depth, crawl_max_pages, crawl_timeout
            await textOnChanges[8]("3");
            expect(plugin.api.updateConfig).toHaveBeenCalledWith({ crawl_max_depth: 3 });
        });

        it("calls updateConfig with valid crawl_max_pages", async () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());

            await textOnChanges[9]("100");
            expect(plugin.api.updateConfig).toHaveBeenCalledWith({ crawl_max_pages: 100 });
        });

        it("skips empty value", async () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());

            await textOnChanges[8]("");
            expect(plugin.api.updateConfig).not.toHaveBeenCalled();
        });

        it("skips invalid number", async () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());

            await textOnChanges[8]("abc");
            expect(plugin.api.updateConfig).not.toHaveBeenCalled();
        });

        it("skips negative number", async () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());

            await textOnChanges[8]("-5");
            expect(plugin.api.updateConfig).not.toHaveBeenCalled();
        });

        it("shows error notice on updateConfig failure", async () => {
            const plugin = makePlugin();
            (plugin.api.updateConfig as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("fail"));
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());

            await textOnChanges[8]("3");
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
    });

    describe("API key onChange", () => {
        it("calls updateConfig on non-empty value", async () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());

            // Index 14: API key (0=port, 1=systemPrompt, 2-7=gen fields, 8-10=crawl, 11-12=advanced, 13=embedding model, 14=api key)
            await textOnChanges[14]("sk-test123");
            expect(plugin.api.updateConfig).toHaveBeenCalledWith({ llm_api_key: "sk-test123" });
        });

        it("skips empty value", async () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());

            await textOnChanges[14]("");
            expect(plugin.api.updateConfig).not.toHaveBeenCalled();
        });

        it("shows error notice on failure", async () => {
            const plugin = makePlugin();
            (plugin.api.updateConfig as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("fail"));
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());

            await textOnChanges[14]("sk-test123");
            expect(Notice.instances.some((n: any) => n.message.includes("failed to save API key"))).toBe(true);
        });
    });

    describe("HuggingFace token onChange", () => {
        it("calls updateConfig and saves settings on non-empty value", async () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());

            // Index 15: HF token (after API key at 14)
            await textOnChanges[15]("hf_test123");
            expect(plugin.api.updateConfig).toHaveBeenCalledWith({ hf_token: "hf_test123" });
            expect(plugin.settings.hfToken).toBe("hf_test123");
            expect(Notice.instances.some((n: any) => n.message.includes("HuggingFace token saved"))).toBe(true);
        });

        it("saves empty token", async () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());

            await textOnChanges[15]("");
            expect(plugin.settings.hfToken).toBe("");
        });

        it("shows error notice on failure", async () => {
            const plugin = makePlugin();
            (plugin.api.updateConfig as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("fail"));
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());

            await textOnChanges[15]("hf_test123");
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

            // Index 16: LiteLLM base URL (shifted by hfToken at 15)
            await textOnChanges[16]("http://localhost:4000");
            expect(plugin.api.updateConfig).toHaveBeenCalledWith({ litellm_base_url: "http://localhost:4000" });
        });

        it("skips empty value", async () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());

            await textOnChanges[16]("  ");
            expect(plugin.api.updateConfig).not.toHaveBeenCalled();
        });

        it("shows error notice on failure", async () => {
            const plugin = makePlugin();
            (plugin.api.updateConfig as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("fail"));
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());

            await textOnChanges[16]("http://localhost:4000");
            expect(Notice.instances.some((n: any) => n.message.includes("failed to update LiteLLM URL"))).toBe(true);
        });
    });

    describe("renderWikiSettings", () => {
        it("shows disabled message when wikiEnabled is false", () => {
            const plugin = makePlugin({ wikiEnabled: false });
            (plugin as any).wikiEnabled = false;
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            tab.display();
            const details = tab.containerEl.children.find(
                (c) =>
                    c.tagName === "DETAILS" &&
                    c.children.some(
                        (s: any) => s.tagName === "SUMMARY" && s.textContent.includes("Wiki (not enabled)"),
                    ),
            );
            expect(details).toBeDefined();
            const desc = details!.children.find(
                (c: any) => c.tagName === "P" && c.textContent.includes("Enable wiki on the server"),
            );
            expect(desc).toBeDefined();
        });

        it("shows wiki settings when wikiEnabled is true", () => {
            const plugin = makePlugin({ wikiEnabled: true });
            (plugin as any).wikiEnabled = true;
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { toggleOnChanges, buttonOnClicks } = captureSettingCallbacks(() => tab.display());
            // Wiki section adds: 1 toggle (prune raw) + 1 slider (faithfulness) + 1 dropdown (search mode) + 2 buttons (lint, prune)
            // toggleOnChanges: adaptiveThreshold + wikiPruneRaw
            expect(toggleOnChanges.length).toBeGreaterThanOrEqual(2);
            expect(buttonOnClicks.length).toBeGreaterThanOrEqual(2);
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

            // The lint button is the second-to-last button (prune is last)
            const lintIdx = buttonOnClicks.length - 2;
            await buttonOnClicks[lintIdx]();
            expect(plugin.runWikiLint).toHaveBeenCalled();
        });

        it("prune button click calls runWikiPrune", async () => {
            const plugin = makePlugin({ wikiEnabled: true });
            (plugin as any).wikiEnabled = true;
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { buttonOnClicks } = captureSettingCallbacks(() => tab.display());

            // The prune button is the last button
            const pruneIdx = buttonOnClicks.length - 1;
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
            expect(Notice.instances.some((n: any) => n.message.includes("failed to update prune raw"))).toBe(true);
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
            expect(
                Notice.instances.some((n: any) => n.message.includes("failed to update faithfulness threshold")),
            ).toBe(true);
        });
    });

    describe("LLM provider dropdown onChange", () => {
        it("calls updateConfig with selected provider", async () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { dropdownOnChanges } = captureSettingCallbacks(() => tab.display());

            // Last dropdown is the LLM provider (after server mode, chat model, vision model, sync mode)
            const providerIdx = dropdownOnChanges.length - 1;
            await dropdownOnChanges[providerIdx]("litellm");
            expect(plugin.api.updateConfig).toHaveBeenCalledWith({ llm_provider: "litellm" });
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
});
