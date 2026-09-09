/**
 * The 1.13 render path: getSettingDefinitions() replaces display(), so these tests check that
 * every setting display() draws also has a definition, that the dynamic sections still render,
 * and that the pre-1.13 path is untouched.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { App, MockElement, Setting, setApiVersion } from "./__mocks__/obsidian";
import { LilbeeSettingTab } from "../src/settings";
import { DEFAULT_SETTINGS, CAPABILITY, MEMORY_CONFIG_KEY, SERVER_MODE, type LilbeeSettings } from "../src/types";
import { MESSAGES } from "../src/locales/en";
import { err } from "../src/result";
import { TaskQueue } from "../src/task-queue";
import { ErrorJournal } from "../src/error-journal";
import type LilbeePlugin from "../src/main";

const DEFINITIONS_VERSION = "1.13.0";
const LEGACY_VERSION = "1.12.0";

vi.mock("../src/server-binary", () => ({
    listReleases: vi.fn(async () => []),
    isDevBuild: (tag: string) => /\.dev\d*$/i.test(tag),
    isDownloadCanceled: () => false,
    DownloadCanceledError: class extends Error {},
    ServerBinary: vi.fn(),
    migrateFlatBinary: vi.fn(),
    getLatestRelease: vi.fn(),
    checkForUpdate: vi.fn(),
}));

vi.mock("../src/storage-stats", () => ({
    reportForVault: () => ({ binBytes: 1, modelsBytes: 2, vaultBytes: 3, totalBytes: 6, vaultDataDir: "/d" }),
}));

vi.mock("../src/views/catalog-modal", () => ({
    CatalogModal: vi.fn().mockImplementation(function () {
        return { open: vi.fn() };
    }),
}));
vi.mock("../src/views/setup-wizard", () => ({
    SetupWizard: vi.fn().mockImplementation(function () {
        return { open: vi.fn() };
    }),
}));
vi.mock("../src/views/confirm-modal", () => ({
    ConfirmModal: vi.fn().mockImplementation(function () {
        return { open: vi.fn(), result: Promise.resolve(true) };
    }),
}));
vi.mock("../src/views/confirm-pull-modal", () => ({
    ConfirmPullModal: vi.fn().mockImplementation(function () {
        return { open: vi.fn(), result: Promise.resolve(true) };
    }),
}));
vi.mock("../src/views/model-picker-modal", () => ({
    ModelPickerModal: vi.fn().mockImplementation(function () {
        return { open: vi.fn() };
    }),
}));
vi.mock("../src/views/uninstall-modal", () => ({
    UninstallModal: vi.fn().mockImplementation(function () {
        return { open: vi.fn(), result: Promise.resolve(false) };
    }),
}));

function makePlugin(settings: Partial<LilbeeSettings> = {}, overrides: Record<string, unknown> = {}) {
    const merged: LilbeeSettings = { ...DEFAULT_SETTINGS, ...settings };
    return {
        settings: merged,
        journal: new ErrorJournal(),
        api: {
            config: vi.fn().mockResolvedValue({ memory_enabled: true, memory_auto_extract: false }),
            configDefaults: vi.fn().mockRejectedValue(new Error("offline")),
            updateConfig: vi.fn().mockResolvedValue({}),
            catalog: vi.fn().mockRejectedValue(new Error("offline")),
            installedModels: vi.fn().mockResolvedValue({ models: [] }),
            listModels: vi.fn().mockResolvedValue({ models: [] }),
            getCapability: vi.fn().mockResolvedValue(true),
            invalidateCapability: vi.fn(),
            getAgentConfigIndex: vi.fn().mockResolvedValue(err(new Error("offline"))),
            getAgentConfig: vi.fn(),
            health: vi.fn().mockResolvedValue(err(new Error("offline"))),
            setChatModel: vi.fn(),
            setEmbeddingModel: vi.fn(),
            setRerankerModel: vi.fn(),
            setVisionModel: vi.fn(),
        },
        saveSettings: vi.fn().mockResolvedValue(undefined),
        startManagedServer: vi.fn().mockResolvedValue(undefined),
        serverManager: { state: "stopped", restart: vi.fn(), stop: vi.fn() },
        vaultId: "abc",
        vaultRegistry: { sharedRoot: "/shared", resolveDataDir: (id: string) => `/shared/vaults/${id}` },
        getSharedLilbeeVersion: () => "1.0.0",
        getSharedLilbeeVariant: () => null,
        getSharedGpuDetection: () => null,
        setSharedLilbeeVersion: vi.fn(),
        isServerAutoUpdateEnabled: () => true,
        setServerAutoUpdate: vi.fn(),
        isServerUpdateReminderEnabled: () => true,
        setServerUpdateReminder: vi.fn(),
        isServerInstalled: () => true,
        isServerUninstalled: () => false,
        isDownloadingServer: () => false,
        isUnloaded: () => false,
        cancelServerDownload: vi.fn(),
        planServerUninstall: () => ({ targets: [], totalBytes: 0 }),
        uninstallServer: vi.fn().mockResolvedValue(0),
        installServer: vi.fn().mockResolvedValue(undefined),
        installCrawlerBrowser: vi.fn().mockResolvedValue(true),
        configureManagedStorage: vi.fn(),
        initWikiSync: vi.fn(),
        reconcileWiki: vi.fn().mockResolvedValue(undefined),
        runWikiLint: vi.fn().mockResolvedValue(undefined),
        runWikiPrune: vi.fn().mockResolvedValue(undefined),
        persistAgentIntegration: vi.fn().mockResolvedValue(undefined),
        applyAgentWiring: vi.fn().mockResolvedValue(undefined),
        diagnosticsContext: () => ({}),
        triggerSync: vi.fn(),
        fetchActiveModel: vi.fn(),
        enqueuePull: vi.fn(() => "task"),
        readCurrentToken: () => "token",
        getSharedHfToken: () => "",
        setSharedHfToken: vi.fn(),
        activeModel: "",
        wikiEnabled: true,
        wikiPageCount: 2,
        wikiDraftCount: 1,
        wikiSync: null,
        lastAgentWrite: null,
        taskQueue: new TaskQueue(),
        ...overrides,
    } as unknown as LilbeePlugin;
}

type Definition = {
    type?: string;
    heading?: string;
    name?: string;
    items?: Definition[];
    visible?: () => boolean;
    render?: (setting: Setting, group: { listEl: MockElement }) => void;
};

/** Walk the definitions the way Obsidian does: skip hidden items, run every render callback. */
function renderDefinitions(items: Definition[], container: MockElement): string[] {
    const names: string[] = [];
    for (const item of items) {
        if (item.visible !== undefined && !item.visible()) continue;
        if (item.type === "group" || item.type === "list") {
            if (item.heading !== undefined) names.push(item.heading);
            names.push(...renderDefinitions(item.items ?? [], container));
            continue;
        }
        if (item.name !== undefined && item.name !== "") names.push(item.name);
        if (item.render) {
            const setting = new Setting(container);
            item.render(setting, { listEl: container });
        }
    }
    return names;
}

/** Every name in the tree, whether or not the row is visible right now. */
function collectNames(items: Definition[]): string[] {
    const names: string[] = [];
    for (const item of items) {
        if (item.heading !== undefined) names.push(item.heading);
        if (item.name !== undefined && item.name !== "") names.push(item.name);
        names.push(...collectNames(item.items ?? []));
    }
    return names;
}

/** Every summary element display() draws, which is how collapsible sections are titled. */
function summaries(el: MockElement): string[] {
    const found: string[] = [];
    if (el.tagName === "SUMMARY") found.push(el.textContent);
    for (const child of el.children) found.push(...summaries(child));
    return found;
}

/**
 * The model pickers and the coding-agent body rebuild themselves from server data, so the
 * definitions name the section rather than each row inside it.
 */
const SECTION_OWNED_CONTAINERS = ["lilbee-models-container", "lilbee-agent-body"];

function insideOwnSection(el: MockElement | null): boolean {
    for (let node = el; node; node = node.parentElement) {
        if (SECTION_OWNED_CONTAINERS.some((cls) => node.classList.contains(cls))) return true;
    }
    return false;
}

/**
 * Every label display() puts on screen: the name of each row, plus the summary of each
 * collapsible section. Async rows land after the pending work settles, so callers await it.
 */
async function namesFromDisplay(tab: LilbeeSettingTab): Promise<string[]> {
    const seen: Array<{ name: string; el: MockElement }> = [];
    const original = Setting.prototype.setName;
    Setting.prototype.setName = function (name: string) {
        seen.push({ name, el: this.settingEl });
        return original.call(this, name);
    };
    try {
        tab.display();
        await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
        Setting.prototype.setName = original;
    }
    const rows = seen.filter((row) => !insideOwnSection(row.el)).map((row) => row.name);
    return [...rows, ...summaries(tab.containerEl as unknown as MockElement)];
}

function makeTab(settings: Partial<LilbeeSettings> = {}, overrides: Record<string, unknown> = {}) {
    return new LilbeeSettingTab(new App() as never, makePlugin(settings, overrides));
}

describe("declarative setting definitions", () => {
    beforeEach(() => {
        setApiVersion(DEFINITIONS_VERSION);
    });

    afterEach(() => {
        setApiVersion(LEGACY_VERSION);
        vi.restoreAllMocks();
    });

    it("covers every setting display() renders, so nothing drops out of 1.13 search", async () => {
        // The legacy path names every row it draws; the definitions must account for all of them.
        setApiVersion(LEGACY_VERSION);
        const legacyTab = makeTab();
        const displayed = await namesFromDisplay(legacyTab);
        await Promise.resolve();

        setApiVersion(DEFINITIONS_VERSION);
        const tab = makeTab();
        const declared = new Set(collectNames(tab.getSettingDefinitions() as Definition[]));

        expect(displayed.length).toBeGreaterThan(50);
        const missing = displayed.filter((name) => name !== "" && !declared.has(name));
        expect(missing).toEqual([]);

        // And nothing is declared that no row backs, so search never lands on a setting that is not there.
        // The coding-agent entry is the exception: it stands for a body that rebuilds itself.
        const shown = new Set([...displayed, MESSAGES.LABEL_AGENT_CHOICE]);
        const phantom = [...declared].filter((name) => name !== "" && !shown.has(name));
        expect(phantom).toEqual([]);
    });

    it("names the same rows in external mode", async () => {
        setApiVersion(LEGACY_VERSION);
        const displayed = await namesFromDisplay(makeTab({ serverMode: SERVER_MODE.EXTERNAL }));

        setApiVersion(DEFINITIONS_VERSION);
        const tab = makeTab({ serverMode: SERVER_MODE.EXTERNAL });
        const declared = new Set(collectNames(tab.getSettingDefinitions() as Definition[]));
        expect(displayed.filter((name) => name !== "" && !declared.has(name))).toEqual([]);
    });

    it("names the install rows when the server is not installed", async () => {
        const overrides = { isServerInstalled: () => false };
        setApiVersion(LEGACY_VERSION);
        const displayed = await namesFromDisplay(makeTab({}, overrides));

        setApiVersion(DEFINITIONS_VERSION);
        const tab = makeTab({}, overrides);
        const declared = new Set(collectNames(tab.getSettingDefinitions() as Definition[]));
        expect(declared.has(MESSAGES.LABEL_INSTALL_SERVER)).toBe(true);
        expect(displayed.filter((name) => name !== "" && !declared.has(name))).toEqual([]);
    });

    it("offers to cancel a download that is already running", () => {
        const tab = makeTab({}, { isServerInstalled: () => false, isDownloadingServer: () => true });
        const declared = renderDefinitions(tab.getSettingDefinitions() as Definition[], new MockElement("div"));
        expect(declared).toContain(MESSAGES.LABEL_SERVER_STATUS);
        expect(declared).not.toContain(MESSAGES.LABEL_INSTALL_SERVER);
    });

    it("drops the uninstall section when the server is not managed", () => {
        const tab = makeTab({ serverMode: SERVER_MODE.EXTERNAL });
        const declared = renderDefinitions(tab.getSettingDefinitions() as Definition[], new MockElement("div"));
        expect(declared).not.toContain(MESSAGES.LABEL_UNINSTALL_SERVER);
    });

    it("renders the model pickers into the group, not into a row", () => {
        const tab = makeTab();
        const container = new MockElement("div");
        renderDefinitions(tab.getSettingDefinitions() as Definition[], container);
        expect(container.find("lilbee-models-container")).toBeTruthy();
    });

    it("renders the coding-agent body into the group", () => {
        const tab = makeTab();
        const container = new MockElement("div");
        renderDefinitions(tab.getSettingDefinitions() as Definition[], container);
        expect(container.find("lilbee-agent-body")).toBeTruthy();
    });

    it("renders the storage report and the uninstall callout", () => {
        const tab = makeTab();
        const container = new MockElement("div");
        renderDefinitions(tab.getSettingDefinitions() as Definition[], container);
        expect(container.find("lilbee-storage-report")).toBeTruthy();
        expect(container.find("lilbee-uninstall-callout")).toBeTruthy();
    });

    it("renders the update progress panel beside the version row", () => {
        const tab = makeTab();
        const container = new MockElement("div");
        renderDefinitions(tab.getSettingDefinitions() as Definition[], container);
        expect(container.find("lilbee-update-progress")).toBeTruthy();
    });

    it("renders the bug feedback links", () => {
        const tab = makeTab();
        const container = new MockElement("div");
        renderDefinitions(tab.getSettingDefinitions() as Definition[], container);
        expect(container.find("lilbee-bug-feedback")).toBeTruthy();
    });

    it("starts the memory toggles from the config the tab already holds", () => {
        const tab = makeTab();
        const container = new MockElement("div");
        const applied = vi.spyOn(tab as any, "applyMemoryToggle");

        // No config yet: the row still builds, it just starts off.
        (tab as any).rowsMemory()[0].apply(new Setting(container));
        expect(applied.mock.calls[0][2]).toBe(false);

        (tab as any).serverConfig = { [MEMORY_CONFIG_KEY.ENABLED]: true, [MEMORY_CONFIG_KEY.AUTO_EXTRACT]: true };
        for (const row of (tab as any).rowsMemory()) row.apply(new Setting(container));
        expect(applied.mock.calls[1][2]).toBe(true);
        expect(applied.mock.calls[2][2]).toBe(true);
    });

    it("names the shared root even before the vault registry exists", () => {
        for (const installed of [true, false]) {
            const tab = makeTab({}, { vaultRegistry: null, isServerInstalled: () => installed });
            const declared = collectNames(tab.getSettingDefinitions() as Definition[]);
            expect(declared).toContain(MESSAGES.LABEL_SHARED_ROOT);
        }
    });

    it("does not touch the server when Obsidian only indexes the tab for search", () => {
        const tab = makeTab();
        tab.getSettingDefinitions();
        expect(tab.plugin.api.config).not.toHaveBeenCalled();
        expect(tab.plugin.api.configDefaults).not.toHaveBeenCalled();
        expect(tab.plugin.api.getCapability).not.toHaveBeenCalled();
    });

    it("loads the server state once the tab actually renders", () => {
        const tab = makeTab();
        renderDefinitions(tab.getSettingDefinitions() as Definition[], new MockElement("div"));
        expect(tab.plugin.api.config).toHaveBeenCalled();
        expect(tab.plugin.api.configDefaults).toHaveBeenCalled();
        expect(tab.plugin.api.getCapability).toHaveBeenCalled();
    });

    it("draws nothing from a render callback below 1.13", () => {
        const tab = makeTab();
        const items = tab.getSettingDefinitions() as Definition[];
        setApiVersion(LEGACY_VERSION);
        const container = new MockElement("div");
        renderDefinitions(items, container);
        expect(container.find("lilbee-models-container")).toBeNull();
        expect(container.find("lilbee-agent-body")).toBeNull();
        expect(container.find("lilbee-uninstall-callout")).toBeNull();
    });
});

describe("visibility predicates", () => {
    beforeEach(() => {
        setApiVersion(DEFINITIONS_VERSION);
    });
    afterEach(() => {
        setApiVersion(LEGACY_VERSION);
    });

    function findRow(items: Definition[], name: string): Definition | undefined {
        for (const item of items) {
            if (item.name === name) return item;
            const nested = findRow(item.items ?? [], name);
            if (nested) return nested;
        }
        return undefined;
    }

    function findGroup(items: Definition[], heading: string): Definition | undefined {
        return items.find((item) => item.heading === heading);
    }

    it("keeps a server-config row searchable before the config loads, then hides it if unsupported", () => {
        const tab = makeTab();
        const row = findRow(tab.getSettingDefinitions() as Definition[], MESSAGES.LABEL_FLASH_ATTENTION);

        // Obsidian indexes the definitions once when the tab is added, before any
        // config has loaded. A row hidden then is excluded from search, which is
        // the defect this path exists to fix.
        expect(row?.visible?.()).toBe(true);

        (tab as any).serverConfig = { something_else: true };
        expect(row?.visible?.()).toBe(false);

        (tab as any).serverConfig = { flash_attention: true };
        expect(row?.visible?.()).toBe(true);
    });

    it("shows a row the server has no key for when the row does not need one", () => {
        const tab = makeTab();
        const row = findRow(tab.getSettingDefinitions() as Definition[], MESSAGES.LABEL_OCR_LANGUAGE);
        expect(row?.visible).toBeUndefined();
    });

    it("hides the wiki rows while the wiki is off, and needs the key as well", () => {
        const tab = makeTab({ wikiEnabled: false });
        const items = tab.getSettingDefinitions() as Definition[];
        const row = findRow(items, MESSAGES.LABEL_WIKI_PRUNE_RAW);
        (tab as any).serverConfig = { wiki_prune_raw: true };
        expect(row?.visible?.()).toBe(false);
        tab.plugin.settings.wikiEnabled = true;
        expect(row?.visible?.()).toBe(true);
    });

    it("keeps a capability-gated group until the probe says the server lacks it", () => {
        const tab = makeTab();
        const group = findGroup(tab.getSettingDefinitions() as Definition[], MESSAGES.LABEL_CRAWLING);
        expect(group?.visible?.()).toBe(true);
        (tab as any).capabilities = { [CAPABILITY.CRAWLING]: false };
        expect(group?.visible?.()).toBe(false);
    });

    it("hides the API-key rows when the server cannot store keys", () => {
        const tab = makeTab();
        const row = findRow(tab.getSettingDefinitions() as Definition[], MESSAGES.LABEL_OPENAI_API_KEY);
        expect(row?.visible?.()).toBe(true);
        (tab as any).capabilities = { [CAPABILITY.API_KEYS]: false };
        expect(row?.visible?.()).toBe(false);
    });

    it("offers the browser install only once the probe says the browser is missing", () => {
        const tab = makeTab();
        const row = findRow(tab.getSettingDefinitions() as Definition[], MESSAGES.LABEL_CRAWL_BROWSER_SETUP);
        expect(row?.visible?.()).toBe(false);
        (tab as any).crawlerBrowserReady = false;
        expect(row?.visible?.()).toBe(true);
    });
});

describe("refreshing the tab", () => {
    afterEach(() => {
        setApiVersion(LEGACY_VERSION);
    });

    it("rebuilds through update() on 1.13", () => {
        setApiVersion(DEFINITIONS_VERSION);
        const tab = makeTab();
        const update = vi.spyOn(tab, "update" as never).mockImplementation(() => undefined);
        const render = vi.spyOn(tab, "render").mockImplementation(() => undefined);
        tab.refresh();
        expect(update).toHaveBeenCalledTimes(1);
        expect(render).not.toHaveBeenCalled();
    });

    it("stores the definitions Obsidian searches when it rebuilds", () => {
        setApiVersion(DEFINITIONS_VERSION);
        const tab = makeTab();
        tab.refresh();
        expect(tab.settingItems.length).toBeGreaterThan(10);
    });

    it("re-renders through display() below 1.13", () => {
        setApiVersion(LEGACY_VERSION);
        const tab = makeTab();
        const render = vi.spyOn(tab, "render").mockImplementation(() => undefined);
        tab.refresh();
        expect(render).toHaveBeenCalledTimes(1);
    });

    it("rebuilds once when the first server config lands, then only re-evaluates visibility", async () => {
        setApiVersion(DEFINITIONS_VERSION);
        const tab = makeTab();
        (tab.plugin.api.config as any).mockResolvedValue({ flash_attention: true });
        const refresh = vi.spyOn(tab, "refresh").mockImplementation(() => undefined);
        const domState = vi.spyOn(tab, "refreshDomState" as never).mockImplementation(() => undefined);

        (tab as any).loadServerDefaults();
        await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
        expect(domState).not.toHaveBeenCalled();

        (tab as any).loadServerDefaults();
        await vi.waitFor(() => expect(domState).toHaveBeenCalledTimes(1));
        expect(refresh).toHaveBeenCalledTimes(1);
    });

    it("re-evaluates visibility when the capability probe lands", async () => {
        setApiVersion(DEFINITIONS_VERSION);
        const tab = makeTab();
        const domState = vi.spyOn(tab, "refreshDomState" as never).mockImplementation(() => undefined);
        await (tab as any).applyCapabilityGating();
        expect(domState).toHaveBeenCalledTimes(1);
    });

    it("re-evaluates visibility when the wiki toggle flips", () => {
        setApiVersion(DEFINITIONS_VERSION);
        const tab = makeTab();
        const domState = vi.spyOn(tab, "refreshDomState" as never).mockImplementation(() => undefined);
        (tab as any).showWikiSubSettings(true);
        expect(domState).toHaveBeenCalledTimes(1);
    });

    it("re-evaluates visibility once the crawler browser is installed", () => {
        setApiVersion(DEFINITIONS_VERSION);
        const tab = makeTab();
        const domState = vi.spyOn(tab, "refreshDomState" as never).mockImplementation(() => undefined);
        (tab as any).hideCrawlBrowserSetup();
        expect(domState).toHaveBeenCalledTimes(1);
    });

    it("leaves the row elements alone on 1.13, because the definitions own visibility", () => {
        setApiVersion(DEFINITIONS_VERSION);
        const tab = makeTab();
        const el = new MockElement("div") as never;
        (tab as any).setRowVisible(el, false);
        (tab as any).hideUntilServerReports(el, "flash_attention");
        expect((tab as any).serverConfigHideableEls.size).toBe(0);
    });

    it("does not reach for the 1.13 refresh below 1.13", () => {
        setApiVersion(LEGACY_VERSION);
        const tab = makeTab();
        const domState = vi.spyOn(tab, "refreshDomState" as never).mockImplementation(() => undefined);
        (tab as any).refreshVisibility();
        expect(domState).not.toHaveBeenCalled();
    });

    it("does nothing when the wiki rows have not been drawn yet", () => {
        setApiVersion(LEGACY_VERSION);
        const tab = makeTab();
        expect(() => (tab as any).showWikiSubSettings(true)).not.toThrow();
    });

    it("does nothing when Refresh is pressed before the pickers exist", async () => {
        setApiVersion(DEFINITIONS_VERSION);
        const tab = makeTab();
        const load = vi.spyOn(tab as any, "loadModels");
        const setting = new Setting(new MockElement("div"));
        const clicks: Array<() => Promise<void>> = [];
        const original = Setting.prototype.addButton;
        Setting.prototype.addButton = function (cb: any) {
            const btn = {
                setButtonText: () => btn,
                onClick: (handler: () => Promise<void>) => {
                    clicks.push(handler);
                    return btn;
                },
                buttonEl: new MockElement("button"),
            };
            cb(btn);
            return this;
        } as never;
        try {
            (tab as any).applyRefreshModelsRow(setting);
        } finally {
            Setting.prototype.addButton = original;
        }
        await clicks[0]();
        expect(load).not.toHaveBeenCalled();
    });

    it("does nothing when there is no row to show or hide", () => {
        setApiVersion(LEGACY_VERSION);
        const tab = makeTab();
        expect(() => (tab as any).setRowVisible(null, true)).not.toThrow();
    });
});
