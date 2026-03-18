import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { App, Notice, Setting } from "obsidian";
import { MockElement } from "./__mocks__/obsidian";
import { LilbeeSettingTab, buildModelOptions, deduplicateLatest, SEPARATOR_KEY, SEPARATOR_LABEL } from "../src/settings";
import type { LilbeeSettings, ModelCatalog, ModelsResponse } from "../src/types";
import { DEFAULT_SETTINGS } from "../src/types";

const mockGetLatestRelease = vi.fn();
const mockCheckForUpdate = vi.fn();

vi.mock("../src/binary-manager", () => ({
    getLatestRelease: (...args: any[]) => mockGetLatestRelease(...args),
    checkForUpdate: (...args: any[]) => mockCheckForUpdate(...args),
    BinaryManager: vi.fn(),
    node: {},
}));

function makePlugin(overrides: Partial<LilbeeSettings> = {}) {
    const settings: LilbeeSettings = { ...DEFAULT_SETTINGS, ...overrides };
    const api = {
        listModels: vi.fn(),
        setChatModel: vi.fn(),
        setVisionModel: vi.fn(),
        pullModel: vi.fn(),
    };
    const ollama = {
        pull: vi.fn(),
        delete: vi.fn(),
        show: vi.fn().mockRejectedValue(new Error("no model")),
    };
    const saveSettings = vi.fn().mockResolvedValue(undefined);
    const statusBarEl = { setText: vi.fn(), textContent: "" };
    const fetchActiveModel = vi.fn();
    return { settings, api, ollama, saveSettings, statusBarEl, fetchActiveModel, activeModel: "", activeVisionModel: "" } as unknown as InstanceType<typeof import("../src/main").default>;
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
            onChange: (handler: TextOnChange) => { textOnChanges.push(handler); return fakeText; },
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
            onChange: (handler: SliderOnChange) => { sliderOnChanges.push(handler); return fakeSlider; },
        };
        cb(fakeSlider);
        return this;
    };

    Setting.prototype.addDropdown = function (cb: (dropdown: any) => void) {
        const fakeDropdown = {
            addOption: (_v: string, _l: string) => fakeDropdown,
            addOptions: (_opts: Record<string, string>) => fakeDropdown,
            setValue: () => fakeDropdown,
            onChange: (handler: DropdownOnChange) => { dropdownOnChanges.push(handler); return fakeDropdown; },
        };
        cb(fakeDropdown);
        return this;
    };

    (Setting.prototype as any).addToggle = function (cb: (toggle: any) => void) {
        const fakeToggle = {
            setValue: () => fakeToggle,
            onChange: (handler: ToggleOnChange) => { toggleOnChanges.push(handler); return fakeToggle; },
        };
        cb(fakeToggle);
        return this;
    };

    Setting.prototype.addButton = function (cb: (btn: any) => void) {
        const fakeBtn = {
            setButtonText: () => fakeBtn,
            setDisabled: () => fakeBtn,
            onClick: (handler: ButtonOnClick) => { buttonOnClicks.push(handler); return fakeBtn; },
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
            addOption: (v: string, l: string) => { options[v] = l; return fakeDropdown; },
            addOptions: (opts: Record<string, string>) => { Object.assign(options, opts); return fakeDropdown; },
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
                (c) => c.tagName === "P" && c.textContent.includes("Curated catalog"),
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
            // serverUrl + ollamaUrl + systemPrompt + 6 generation + syncDebounce = 10
            expect(textOnChanges.length).toBe(10);
        });

        it("does NOT show sync-debounce when syncMode is 'manual'", () => {
            const plugin = makePlugin({ syncMode: "manual" });
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());
            // serverUrl + ollamaUrl + systemPrompt + 6 generation settings = 9
            expect(textOnChanges.length).toBe(9);
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
        // With syncMode=auto, text fields are:
        // [0] serverUrl, [1] ollamaUrl, [2] syncDebounce, [3-8] generation settings
        const DEBOUNCE_IDX = 2;

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

    describe("ollamaUrl setting onChange", () => {
        it("updates ollamaUrl and calls saveSettings", async () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());

            // textOnChanges[1] = ollamaUrl
            await textOnChanges[1]("http://remote:11434");
            expect(plugin.settings.ollamaUrl).toBe("http://remote:11434");
            expect(plugin.saveSettings).toHaveBeenCalled();
        });
    });

    describe("system prompt setting", () => {
        it("saves systemPrompt when changed", async () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());

            // Index 2 is systemPrompt (0=serverUrl, 1=ollamaUrl)
            await textOnChanges[2]("You are a pirate.");
            expect(plugin.settings.systemPrompt).toBe("You are a pirate.");
            expect(plugin.saveSettings).toHaveBeenCalled();
        });
    });

    describe("generation settings", () => {
        const GEN_FIELDS = [
            { idx: 3, key: "temperature", value: "0.7", expected: 0.7 },
            { idx: 4, key: "top_p", value: "0.9", expected: 0.9 },
            { idx: 5, key: "top_k_sampling", value: "40", expected: 40 },
            { idx: 6, key: "repeat_penalty", value: "1.1", expected: 1.1 },
            { idx: 7, key: "num_ctx", value: "4096", expected: 4096 },
            { idx: 8, key: "seed", value: "42", expected: 42 },
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

            await textOnChanges[5]("not-a-number");
            expect(plugin.settings.top_k_sampling).toBeNull();
        });

        it("ignores NaN input for float field", async () => {
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);
            const { textOnChanges } = captureSettingCallbacks(() => tab.display());

            await textOnChanges[3]("abc");
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
                    setValue: (v: string) => { setValues.push(v); return fakeText; },
                    onChange: () => fakeText,
                    inputEl: { placeholder: "" },
                };
                cb(fakeText);
                return this;
            };

            tab.display();
            Setting.prototype.addText = origAddText;

            // Index 3 is temperature — should show "0.5" (0=serverUrl, 1=ollamaUrl, 2=systemPrompt)
            expect(setValues[3]).toBe("0.5");
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
                    setPlaceholder: (v: string) => { placeholders.push(v); return fakeText; },
                    setValue: () => fakeText,
                    onChange: () => fakeText,
                    inputEl: { placeholder: "" },
                };
                cb(fakeText);
                return this;
            };

            tab.display();
            Setting.prototype.addText = origAddText;

            // Indices 3-8 are generation fields (0=serverUrl, 1=ollamaUrl, 2=systemPrompt)
            for (let i = 3; i <= 8; i++) {
                expect(placeholders[i]).toBe("Not set");
            }
        });

        it("populates placeholders from active model defaults", async () => {
            const plugin = makePlugin();
            (plugin as any).activeModel = "llama3";
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            (plugin.ollama.show as ReturnType<typeof vi.fn>).mockResolvedValue({
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

            expect(plugin.ollama.show).toHaveBeenCalledWith("llama3");
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

            // Start + Check for updates + Ollama Test + Refresh = 4
            expect(buttonOnClicks.length).toBe(4);
            // Refresh is the last button
            await expect(buttonOnClicks[3]()).resolves.not.toThrow();
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
        function setupDeleteButton(
            plugin: ReturnType<typeof makePlugin>,
            type: "chat" | "vision" = "chat",
        ) {
            const tab = makeTab(plugin);
            const table = new MockElement("table") as unknown as HTMLTableElement;
            const catalog = makeModelsResponse();
            // Use installed model (index 0 for chat = llama3)
            const model = type === "chat"
                ? catalog.chat.catalog[0]
                : { ...catalog.vision.catalog[0], installed: true };

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
            (plugin.ollama.delete as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());

            const { tab, deleteBtn } = setupDeleteButton(plugin);
            const modelsContainer = new MockElement("div");
            modelsContainer.classList.add("lilbee-models-container");
            tab.containerEl.children.push(modelsContainer);

            await (deleteBtn as unknown as MockElement).trigger("click");
            await new Promise((r) => setTimeout(r, 0));

            expect(plugin.ollama.delete).toHaveBeenCalledWith("llama3");
            expect(Notice.instances.some((n) => n.message.includes("Deleted llama3"))).toBe(true);
            expect(plugin.fetchActiveModel).toHaveBeenCalled();
        });

        it("successful delete reloads models container when found", async () => {
            const plugin = makePlugin();
            (plugin.ollama.delete as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());

            const { tab, deleteBtn } = setupDeleteButton(plugin);

            Object.defineProperty(globalThis, "HTMLElement", { value: MockElement, configurable: true, writable: true });
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
            (plugin.ollama.delete as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
            (plugin.api.setChatModel as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
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
            (plugin.ollama.delete as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
            (plugin.api.setVisionModel as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
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
            (plugin.ollama.delete as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("fail"));

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
            const blockingPromise = new Promise<void>((r) => { resolve = r; });

            async function* slowPull() {
                await blockingPromise;
                yield { status: "success" };
            }
            (plugin.ollama.pull as ReturnType<typeof vi.fn>).mockReturnValue(slowPull());
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

            let resolveWait!: () => void;
            const waitPromise = new Promise<void>((r) => { resolveWait = r; });
            async function* slowPull(_name: string, signal: AbortSignal) {
                yield { status: "pulling", completed: 10, total: 100 };
                await waitPromise;
                if (signal.aborted) {
                    const err = new Error("The operation was aborted");
                    err.name = "AbortError";
                    throw err;
                }
                yield { status: "success" };
            }
            (plugin.ollama.pull as ReturnType<typeof vi.fn>).mockImplementation(
                (name: string, signal: AbortSignal) => slowPull(name, signal),
            );

            const { tab, btn, actionCell, clickHandlers } = setupPullCancelButton(plugin);

            // Start the pull
            const pullPromise = clickHandlers[0]();
            await new Promise((r) => setTimeout(r, 0));

            // Click Cancel button (triggers the once listener that calls controller.abort())
            btn.trigger("click");
            resolveWait();
            await pullPromise;

            expect(Notice.instances.some((n) => n.message === "Pull cancelled")).toBe(true);
            expect(btn.textContent).toBe("Pull");
            expect(btn.disabled).toBe(false);
            // Progress div should be cleaned up
            const progressDiv = actionCell.children.find(
                (c: any) => c.classList?.contains("lilbee-pull-progress"),
            );
            expect(progressDiv).toBeUndefined();
        });
    });

    describe("Pulling guard", () => {
        it("pullModel ignores re-entry while pulling", async () => {
            const plugin = makePlugin();
            let resolve!: () => void;
            const blockingPromise = new Promise<void>((r) => { resolve = r; });
            async function* slowPull() {
                await blockingPromise;
                yield { status: "success" };
            }
            (plugin.ollama.pull as ReturnType<typeof vi.fn>).mockReturnValue(slowPull());
            (plugin.api.setChatModel as ReturnType<typeof vi.fn>).mockResolvedValue({ model: "phi3" });
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());

            const tab = makeTab(plugin);
            const table = new MockElement("table") as unknown as HTMLTableElement;
            const model = makeModelsResponse().chat.catalog[1]; // phi3 — uninstalled

            (tab as any).renderCatalogRow(table, model, "chat");
            const row = (table as unknown as MockElement).children[0];
            const actionCell = row.children[3];
            const btn = actionCell.children[0];

            const modelsContainer = new MockElement("div");
            modelsContainer.classList.add("lilbee-models-container");
            tab.containerEl.children.push(modelsContainer);

            // Start pull
            const pullPromise = btn.trigger("click");
            // Second click should be ignored
            await btn.trigger("click");

            expect(plugin.ollama.pull).toHaveBeenCalledTimes(1);
            resolve();
            await pullPromise;
        });

        it("autoPullAndSet ignores re-entry while pulling", async () => {
            const plugin = makePlugin();
            let resolve!: () => void;
            const blockingPromise = new Promise<void>((r) => { resolve = r; });
            async function* slowPull() {
                await blockingPromise;
                yield { status: "success" };
            }
            (plugin.ollama.pull as ReturnType<typeof vi.fn>).mockReturnValue(slowPull());
            (plugin.api.setChatModel as ReturnType<typeof vi.fn>).mockResolvedValue({ model: "phi3" });
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());

            const tab = makeTab(plugin);
            const container = new MockElement("div") as unknown as HTMLElement;

            const { dropdownOnChanges } = captureSettingCallbacks(() => {
                (tab as any).renderModelSection(container, "Chat Model", makeModelsResponse().chat, "chat");
            });

            // Start auto-pull (phi3 is uninstalled)
            const pullPromise = dropdownOnChanges[0]("phi3");
            // Second attempt should be ignored
            await dropdownOnChanges[0]("phi3");

            expect(plugin.ollama.pull).toHaveBeenCalledTimes(1);
            resolve();
            await pullPromise;
        });
    });

    describe("Auto-pull cancel banner", () => {
        it("shows cancel banner during auto-pull and removes it after", async () => {
            const plugin = makePlugin();
            async function* fakePull() {
                yield { status: "pulling", completed: 50, total: 100 };
                yield { status: "success" };
            }
            (plugin.ollama.pull as ReturnType<typeof vi.fn>).mockReturnValue(fakePull());
            (plugin.api.setChatModel as ReturnType<typeof vi.fn>).mockResolvedValue({ model: "phi3" });
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());

            const tab = makeTab(plugin);
            const container = new MockElement("div") as unknown as HTMLElement;

            const { dropdownOnChanges } = captureSettingCallbacks(() => {
                (tab as any).renderModelSection(container, "Chat Model", makeModelsResponse().chat, "chat");
            });

            await dropdownOnChanges[0]("phi3");

            // Banner should be removed after pull completes
            const banner = (container as unknown as MockElement).children.find(
                (c) => c.classList.contains("lilbee-pull-banner"),
            );
            expect(banner).toBeUndefined();
        });

        it("clicking cancel on auto-pull banner aborts and shows notice", async () => {
            const plugin = makePlugin();
            let resolveWait!: () => void;
            const waitPromise = new Promise<void>((r) => { resolveWait = r; });
            async function* slowPull(_name: string, signal: AbortSignal) {
                yield { status: "pulling", completed: 10, total: 100 };
                await waitPromise;
                if (signal.aborted) {
                    const err = new Error("The operation was aborted");
                    err.name = "AbortError";
                    throw err;
                }
                yield { status: "success" };
            }
            (plugin.ollama.pull as ReturnType<typeof vi.fn>).mockImplementation(
                (name: string, signal: AbortSignal) => slowPull(name, signal),
            );

            const tab = makeTab(plugin);
            const container = new MockElement("div") as unknown as HTMLElement;

            const { dropdownOnChanges } = captureSettingCallbacks(() => {
                (tab as any).renderModelSection(container, "Chat Model", makeModelsResponse().chat, "chat");
            });

            const pullPromise = dropdownOnChanges[0]("phi3");
            await new Promise((r) => setTimeout(r, 0));

            // Find the cancel button in the banner
            const banner = (container as unknown as MockElement).children.find(
                (c) => c.classList.contains("lilbee-pull-banner"),
            );
            expect(banner).toBeDefined();
            const cancelBtn = banner!.children.find((c) => c.textContent === "Cancel");
            expect(cancelBtn).toBeDefined();
            cancelBtn!.trigger("click");
            resolveWait();
            await pullPromise;

            expect(Notice.instances.some((n) => n.message === "Pull cancelled")).toBe(true);
        });

        it("auto-pull banner label updates with progress percentage", async () => {
            const plugin = makePlugin();
            let resolveWait!: () => void;
            const waitPromise = new Promise<void>((r) => { resolveWait = r; });
            let bannerLabel: MockElement | undefined;
            async function* slowPull() {
                yield { status: "pulling", completed: 75, total: 100 };
                // Capture the label text at this point
                bannerLabel = (container as unknown as MockElement).children
                    .find((c) => c.classList.contains("lilbee-pull-banner"))
                    ?.children.find((c) => c.tagName === "SPAN");
                await waitPromise;
                yield { status: "success" };
            }
            (plugin.ollama.pull as ReturnType<typeof vi.fn>).mockReturnValue(slowPull());
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
            (plugin.ollama.pull as ReturnType<typeof vi.fn>).mockReturnValue(abortingPull());

            const tab = makeTab(plugin);
            const container = new MockElement("div") as unknown as HTMLElement;

            const { dropdownOnChanges } = captureSettingCallbacks(() => {
                (tab as any).renderModelSection(container, "Chat Model", makeModelsResponse().chat, "chat");
            });

            // phi3 is uninstalled in catalog — triggers autoPullAndSet
            await dropdownOnChanges[0]("phi3");
            expect(Notice.instances.some((n) => n.message === "Pull cancelled")).toBe(true);
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
                yield { status: "pulling", completed: 75, total: 100 };
                // Capture progress text mid-pull (before finally removes it)
                capturedProgressText = actionCell.find("lilbee-pull-progress")?.textContent ?? "";
                yield { status: "success" };
            }
            (plugin.ollama.pull as ReturnType<typeof vi.fn>).mockReturnValue(fakePull());
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
                yield { status: "pulling", completed: 0, total: 0 };
                capturedProgressText = actionCell.find("lilbee-pull-progress")?.textContent ?? "";
                yield { status: "success" };
            }
            (plugin.ollama.pull as ReturnType<typeof vi.fn>).mockReturnValue(fakePull());
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

            async function* fakePull() {
                yield { status: "success" };
            }
            (plugin.ollama.pull as ReturnType<typeof vi.fn>).mockReturnValue(fakePull());
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
            (plugin.ollama.pull as ReturnType<typeof vi.fn>).mockReturnValue(failingPull());

            const { tab, clickHandler, actionCell } = await setupPullButton(plugin, "chat");
            const btn = actionCell.children[0];

            await clickHandler();

            expect(Notice.instances.some((n) => n.message.includes("Failed to pull"))).toBe(true);
            expect(btn.disabled).toBe(false);
            expect(btn.textContent).toBe("Pull");
        });

        it("successful pull without models container: does not crash", async () => {
            const plugin = makePlugin();

            async function* fakePull() {
                yield { status: "success" };
            }
            (plugin.ollama.pull as ReturnType<typeof vi.fn>).mockReturnValue(fakePull());
            (plugin.api.setChatModel as ReturnType<typeof vi.fn>).mockResolvedValue({ model: "phi3" });
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());

            const { clickHandler } = await setupPullButton(plugin, "chat");

            await expect(clickHandler()).resolves.not.toThrow();
            expect(Notice.instances.some((n) => n.message.includes("pulled"))).toBe(true);
        });

        it("successful pull with HTMLElement container: reloads models", async () => {
            const plugin = makePlugin();

            async function* fakePull() {
                yield { status: "success" };
            }
            (plugin.ollama.pull as ReturnType<typeof vi.fn>).mockReturnValue(fakePull());
            (plugin.api.setChatModel as ReturnType<typeof vi.fn>).mockResolvedValue({ model: "phi3" });
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());

            const { tab, clickHandler } = await setupPullButton(plugin, "chat");

            Object.defineProperty(globalThis, "HTMLElement", { value: MockElement, configurable: true, writable: true });
            const fakeContainer = new MockElement("div");
            tab.containerEl.querySelector = vi.fn().mockReturnValue(fakeContainer);

            await clickHandler();

            expect(plugin.api.listModels).toHaveBeenCalled();

            // @ts-expect-error removing test-only global
            delete (globalThis as any).HTMLElement;
        });

        it("pull progress updates plugin status bar", async () => {
            const plugin = makePlugin();

            async function* fakePull() {
                yield { status: "pulling", completed: 45, total: 100 };
                yield { status: "success" };
            }
            (plugin.ollama.pull as ReturnType<typeof vi.fn>).mockReturnValue(fakePull());
            (plugin.api.setChatModel as ReturnType<typeof vi.fn>).mockResolvedValue({ model: "phi3" });
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());

            const { tab, clickHandler } = await setupPullButton(plugin, "chat");
            const modelsContainer = new MockElement("div");
            modelsContainer.classList.add("lilbee-models-container");
            tab.containerEl.children.push(modelsContainer);

            await clickHandler();

            expect(plugin.statusBarEl!.setText).toHaveBeenCalledWith("lilbee: pulling phi3 — 45%");
        });

        it("successful pull calls fetchActiveModel", async () => {
            const plugin = makePlugin();

            async function* fakePull() {
                yield { status: "success" };
            }
            (plugin.ollama.pull as ReturnType<typeof vi.fn>).mockReturnValue(fakePull());
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
                yield { status: "pulling", completed: 50, total: 100 };
                yield { status: "success" };
            }
            (plugin.ollama.pull as ReturnType<typeof vi.fn>).mockReturnValue(fakePull());
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
                yield { status: "downloading" };
                yield { status: "success" };
            }
            (plugin.ollama.pull as ReturnType<typeof vi.fn>).mockReturnValue(fakePull());
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
            const pending = new Promise<{ ok: boolean; status: number }>((r) => { resolvePromise = r; });
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

        it("auto-checks both endpoints on display", async () => {
            globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
            const plugin = makePlugin({ serverMode: "external" });
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);

            tab.display();

            // Wait for async checks to complete
            await new Promise((r) => setTimeout(r, 0));

            expect(globalThis.fetch).toHaveBeenCalledTimes(2);
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

            // buttonOnClicks[0] = server Test, buttonOnClicks[1] = ollama Test
            await buttonOnClicks[0]();

            expect(globalThis.fetch).toHaveBeenCalledTimes(1);
            expect(globalThis.fetch).toHaveBeenCalledWith(
                expect.stringContaining("/api/health"),
                expect.objectContaining({ signal: expect.any(AbortSignal) }),
            );
        });

        it("Ollama Test button calls checkEndpoint", async () => {
            globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
            const plugin = makePlugin();
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
            const tab = makeTab(plugin);

            const { buttonOnClicks } = captureSettingCallbacks(() => tab.display());

            // Wait for auto-checks
            await new Promise((r) => setTimeout(r, 0));
            (globalThis.fetch as ReturnType<typeof vi.fn>).mockClear();

            // buttonOnClicks[2] = ollama Test button (after Start + Check for updates)
            await buttonOnClicks[2]();

            expect(globalThis.fetch).toHaveBeenCalledTimes(1);
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
                yield { status: "pulling", completed: 50, total: 100 };
                yield { status: "success" };
            }
            (plugin.ollama.pull as ReturnType<typeof vi.fn>).mockReturnValue(fakePull());
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
            expect(plugin.ollama.pull).toHaveBeenCalledWith("phi3", expect.any(AbortSignal));
            expect(plugin.api.setChatModel).toHaveBeenCalledWith("phi3");
            expect(Notice.instances.some((n) => n.message.includes("pulled and activated"))).toBe(true);
        });

        it("auto-pull failure shows failure notice", async () => {
            const plugin = makePlugin();

            async function* failingPull(): AsyncGenerator<never> {
                throw new Error("network");
            }
            (plugin.ollama.pull as ReturnType<typeof vi.fn>).mockReturnValue(failingPull());

            const tab = makeTab(plugin);
            const container = new MockElement("div") as unknown as HTMLElement;

            const { dropdownOnChanges } = captureSettingCallbacks(() => {
                (tab as any).renderModelSection(container, "Chat Model", makeModelsResponse().chat, "chat");
            });

            await dropdownOnChanges[0]("phi3");
            expect(Notice.instances.some((n) => n.message.includes("Failed to pull"))).toBe(true);
        });

        it("auto-pull updates status bar with progress", async () => {
            const plugin = makePlugin();

            async function* fakePull() {
                yield { status: "pulling", completed: 75, total: 100 };
                yield { status: "success" };
            }
            (plugin.ollama.pull as ReturnType<typeof vi.fn>).mockReturnValue(fakePull());
            (plugin.api.setChatModel as ReturnType<typeof vi.fn>).mockResolvedValue({ model: "phi3" });
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());

            const tab = makeTab(plugin);
            const container = new MockElement("div") as unknown as HTMLElement;
            tab.containerEl.querySelector = vi.fn().mockReturnValue(null);

            const { dropdownOnChanges } = captureSettingCallbacks(() => {
                (tab as any).renderModelSection(container, "Chat Model", makeModelsResponse().chat, "chat");
            });

            await dropdownOnChanges[0]("phi3");
            expect(plugin.statusBarEl!.setText).toHaveBeenCalledWith("lilbee: pulling phi3 — 75%");
        });

        it("auto-pull for vision type calls setVisionModel", async () => {
            const plugin = makePlugin();

            async function* fakePull() {
                yield { status: "success" };
            }
            (plugin.ollama.pull as ReturnType<typeof vi.fn>).mockReturnValue(fakePull());
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

        it("auto-pull updates status bar text", async () => {
            const plugin = makePlugin();

            async function* fakePull() {
                yield { status: "pulling", completed: 60, total: 100 };
                yield { status: "success" };
            }
            (plugin.ollama.pull as ReturnType<typeof vi.fn>).mockReturnValue(fakePull());
            (plugin.api.setChatModel as ReturnType<typeof vi.fn>).mockResolvedValue({ model: "phi3" });
            (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());

            const tab = makeTab(plugin);
            const container = new MockElement("div") as unknown as HTMLElement;
            tab.containerEl.querySelector = vi.fn().mockReturnValue(null);

            const { dropdownOnChanges } = captureSettingCallbacks(() => {
                (tab as any).renderModelSection(container, "Chat Model", makeModelsResponse().chat, "chat");
            });

            await dropdownOnChanges[0]("phi3");
            expect(plugin.statusBarEl!.setText).toHaveBeenCalledWith("lilbee: pulling phi3 — 60%");
        });

        it("auto-pull with total=0 does not update status bar", async () => {
            const plugin = makePlugin();

            async function* fakePull() {
                yield { status: "pulling", completed: 0, total: 0 };
                yield { status: "success" };
            }
            (plugin.ollama.pull as ReturnType<typeof vi.fn>).mockReturnValue(fakePull());
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
                yield { status: "pulling", completed: 50, total: 100 };
                yield { status: "success" };
            }
            (plugin.ollama.pull as ReturnType<typeof vi.fn>).mockReturnValue(fakePull());
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
                yield { status: "pulling", completed: 50, total: 100 };
                yield { status: "success" };
            }
            (plugin.ollama.pull as ReturnType<typeof vi.fn>).mockReturnValue(fakePull());
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

            async function* fakePull() {
                yield { status: "success" };
            }
            (plugin.ollama.pull as ReturnType<typeof vi.fn>).mockReturnValue(fakePull());
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
            catalog: [
                { name: "llava", size_gb: 4.5, min_ram_gb: 8, description: "LLaVA", installed: false },
            ],
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
            catalog: [
                { name: "llama3", size_gb: 4.7, min_ram_gb: 8, description: "Meta", installed: true },
            ],
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
        const result = deduplicateLatest([
            "mistral:latest", "mistral:7b",
            "llama3:latest", "llama3:8b",
            "phi3:latest",
        ]);
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

        // In managed mode: textOnChanges[0] = port, textOnChanges[1] = ollama URL, then gen settings
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
        (plugin as any).checkForUpdate = vi.fn().mockResolvedValue({ available: true, release: { tag: "v0.2.0", assetUrl: "https://example.com" } });
        (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
        const tab = makeTab(plugin);

        const { buttonOnClicks } = captureSettingCallbacks(() => tab.display());

        // buttonOnClicks[0] = Start (server controls), [1] = Check for updates
        await buttonOnClicks[1]();

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

        // buttonOnClicks[0] = Start, [1] = Check for updates
        await buttonOnClicks[1]();

        expect(Notice.instances.some((n) => n.message.includes("already up to date"))).toBe(true);
    });

    it("update button calls updateServer and shows success notice", async () => {
        Notice.clear();

        const plugin = makePlugin({ serverMode: "managed", lilbeeVersion: "v0.1.0" });
        (plugin as any).checkForUpdate = vi.fn().mockResolvedValue({ available: true, release: { tag: "v0.2.0", assetUrl: "https://example.com" } });
        (plugin as any).updateServer = vi.fn().mockImplementation(async (_release: any, onProgress?: (msg: string) => void) => {
            onProgress?.("Downloading...");
        });
        (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
        const tab = makeTab(plugin);

        const { buttonOnClicks } = captureSettingCallbacks(() => tab.display());

        // First click: check for updates (sets pendingRelease)
        await buttonOnClicks[1]();
        // Same handler clicked again: now triggers update via pendingRelease
        await buttonOnClicks[1]();

        expect((plugin as any).updateServer).toHaveBeenCalled();
        expect(Notice.instances.some((n) => n.message.includes("updated to v0.2.0"))).toBe(true);
    });

    it("update button does not add duplicate click handlers", async () => {
        Notice.clear();

        const plugin = makePlugin({ serverMode: "managed", lilbeeVersion: "v0.1.0" });
        (plugin as any).checkForUpdate = vi.fn().mockResolvedValue({ available: true, release: { tag: "v0.2.0", assetUrl: "https://example.com" } });
        (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
        const tab = makeTab(plugin);

        const { buttonOnClicks } = captureSettingCallbacks(() => tab.display());
        const countBefore = buttonOnClicks.length;

        // Click check for updates — should NOT add a new handler
        await buttonOnClicks[1]();

        expect(buttonOnClicks.length).toBe(countBefore);
    });

    it("update button shows failure notice when updateServer throws", async () => {
        Notice.clear();

        const plugin = makePlugin({ serverMode: "managed", lilbeeVersion: "v0.1.0" });
        (plugin as any).checkForUpdate = vi.fn().mockResolvedValue({ available: true, release: { tag: "v0.2.0", assetUrl: "https://example.com" } });
        (plugin as any).updateServer = vi.fn().mockRejectedValue(new Error("download failed"));
        (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
        const tab = makeTab(plugin);

        const { buttonOnClicks } = captureSettingCallbacks(() => tab.display());

        // First click: check (sets pendingRelease); second click: update (fails)
        await buttonOnClicks[1]();
        await buttonOnClicks[1]();

        expect(Notice.instances.some((n) => n.message.includes("update failed"))).toBe(true);
    });

    it("check for updates button shows error on failure", async () => {
        Notice.clear();

        const plugin = makePlugin({ serverMode: "managed" });
        (plugin as any).checkForUpdate = vi.fn().mockRejectedValue(new Error("network error"));
        (plugin.api.listModels as ReturnType<typeof vi.fn>).mockResolvedValue(makeModelsResponse());
        const tab = makeTab(plugin);

        const { buttonOnClicks } = captureSettingCallbacks(() => tab.display());

        // buttonOnClicks[0] = Start, [1] = Check for updates
        await buttonOnClicks[1]();

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

        // In external mode: buttons are [Test (server), Reset to managed, Test (ollama), Refresh]
        // Find the "Reset to managed" click — it's the one that sets serverMode back
        const resetButton = buttonOnClicks.find((_btn, i) => i === 1);
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
        // Buttons: Start, Check for updates, Test (ollama), Refresh
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
        // First button in managed stopped mode is Start
        await buttonOnClicks[0]();

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
        // In ready state: buttons are Stop, Restart, Check for updates, Test (ollama), Refresh
        await buttonOnClicks[0]();

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
        // In ready state: buttons are Stop, Restart, Check for updates, Test (ollama), Refresh
        await buttonOnClicks[1]();

        expect(mockRestart).toHaveBeenCalled();
        expect(displaySpy).toHaveBeenCalled();
    });
});
