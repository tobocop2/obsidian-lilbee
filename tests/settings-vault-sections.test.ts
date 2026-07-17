/**
 * Tests for the shared-root, adopt-data-dir, and storage-report sections
 * inside the managed-mode Settings panel.
 */
import { vi, describe, it, expect, beforeEach } from "vitest";
import { App, MockElement, Setting, Notice } from "./__mocks__/obsidian";
import { LilbeeSettingTab } from "../src/settings";
import { DEFAULT_SETTINGS, type LilbeeSettings } from "../src/types";
import { TaskQueue } from "../src/task-queue";

const mockEnsureBinary = vi.fn();
const mockBinaryExists = vi.fn();
const mockDownload = vi.fn();
const mockGetLatestRelease = vi.fn();
const mockCheckForUpdate = vi.fn();

vi.mock("../src/binary-manager", () => ({
    listReleases: vi.fn(async () => []),
    isDevBuild: (tag: string) => /\.dev\d*$/i.test(tag),
    LILBEE_GITHUB_REPO_URL: "https://github.com/tobocop2/lilbee",
    DownloadCanceledError: class extends Error {},
    BinaryManager: vi.fn().mockImplementation(function () {
        return {
            ensureBinary: mockEnsureBinary,
            binaryExists: mockBinaryExists,
            binaryPath: "/fake/bin/lilbee",
            download: mockDownload,
        };
    }),
    getLatestRelease: (...args: any[]) => mockGetLatestRelease(...args),
    checkForUpdate: (...args: any[]) => mockCheckForUpdate(...args),
    node: {
        existsSync: vi.fn(() => false),
        readFileSync: vi.fn(),
        writeFileSync: vi.fn(),
        renameSync: vi.fn(),
        unlinkSync: vi.fn(),
        mkdirSync: vi.fn(),
        statSync: vi.fn(() => ({ isDirectory: () => false, dev: 1, size: 0 })),
        readdirSync: vi.fn(() => [] as string[]),
        rmSync: vi.fn(),
        cpSync: vi.fn(),
        join: (...parts: string[]) => parts.join("/").replace(/\/+/g, "/"),
        basename: (p: string) => p.replace(/\\/g, "/").split("/").pop() ?? "",
        resolve: (p: string) => p.replace(/\/+/g, "/"),
        dirname: (p: string) => {
            const normalized = p.replace(/\/+/g, "/");
            const i = normalized.lastIndexOf("/");
            return i <= 0 ? "/" : normalized.slice(0, i);
        },
        createHash: () => ({ update: () => ({ digest: () => "a".repeat(48) }) }),
        processKill: vi.fn(),
        requestUrl: vi.fn(),
    },
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

function makePlugin(settings: Partial<LilbeeSettings> = {}, registry: any = null) {
    const merged: LilbeeSettings = { ...DEFAULT_SETTINGS, ...settings };
    return {
        settings: merged,
        api: {
            listModels: vi.fn(),
            config: vi.fn().mockRejectedValue(new Error("offline")),
            configDefaults: vi.fn().mockRejectedValue(new Error("offline")),
            updateConfig: vi.fn(),
            catalog: vi.fn().mockRejectedValue(new Error("offline")),
            installedModels: vi.fn().mockResolvedValue({ models: [] }),
            getCapability: vi.fn().mockResolvedValue(true),
            invalidateCapability: vi.fn(),
            setChatModel: vi.fn(),
            setEmbeddingModel: vi.fn(),
            setRerankerModel: vi.fn(),
            setVisionModel: vi.fn(),
            showModel: vi.fn().mockRejectedValue(new Error("no model")),
        },
        saveSettings: vi.fn().mockResolvedValue(undefined),
        startManagedServer: vi.fn().mockResolvedValue(undefined),
        serverManager: { state: "stopped", restart: vi.fn(), stop: vi.fn() },
        vaultId: "abc",
        vaultRegistry: registry,
        getSharedLilbeeVersion: () => "",
        setSharedLilbeeVersion: vi.fn(),
        isServerAutoUpdateEnabled: () => true,
        setServerAutoUpdate: vi.fn(),
        isServerInstalled: () => true,
        isServerUninstalled: () => false,
        isDownloadingServer: () => false,
        cancelServerDownload: vi.fn(),
        planServerUninstall: () => ({ targets: [], totalBytes: 0 }),
        uninstallServer: vi.fn().mockResolvedValue(0),
        installServer: vi.fn().mockResolvedValue(undefined),
        getSharedHfToken: () => "",
        setSharedHfToken: vi.fn(),
        activeModel: "",
        wikiEnabled: true,
        wikiSync: null,
        taskQueue: new TaskQueue(),
    } as unknown as InstanceType<typeof import("../src/main").default>;
}

function makeRegistry() {
    return {
        sharedRoot: "/shared",
        resolveDataDir: (id: string) => `/shared/vaults/${id}`,
    };
}

function captureSettingCallbacks(fn: () => void) {
    const textOnChanges: Array<(value: string) => void | Promise<void>> = [];
    const buttonLabels: string[] = [];
    const buttonOnClicks: Array<() => void | Promise<void>> = [];

    const origAddText = Setting.prototype.addText;
    Setting.prototype.addText = function (cb: (text: any) => void) {
        const fakeText = {
            setPlaceholder: () => fakeText,
            setValue: () => fakeText,
            onChange: (handler: (value: string) => void | Promise<void>) => {
                textOnChanges.push(handler);
                return fakeText;
            },
            inputEl: { placeholder: "", type: "text", value: "", addEventListener: vi.fn() },
        };
        cb(fakeText);
        return this;
    };
    // Capture button labels + onClick handlers without replacing the mock —
    // settings.ts calls .setWarning(), .setTooltip(), .setIcon() on buttons
    // that the test panel doesn't directly own, and the mock implements them.
    const origAddButton = Setting.prototype.addButton;
    Setting.prototype.addButton = function (cb: (btn: any) => void) {
        let label = "";
        return origAddButton.call(this, (btn: any) => {
            const origSetText = btn.setButtonText.bind(btn);
            btn.setButtonText = (text: string) => {
                label = text;
                return origSetText(text);
            };
            const origOnClick = btn.onClick.bind(btn);
            btn.onClick = (handler: () => void | Promise<void>) => {
                buttonLabels.push(label);
                buttonOnClicks.push(handler);
                return origOnClick(handler);
            };
            cb(btn);
        });
    };

    try {
        fn();
    } finally {
        Setting.prototype.addText = origAddText;
        Setting.prototype.addButton = origAddButton;
    }
    return { textOnChanges, buttonLabels, buttonOnClicks };
}

beforeEach(() => {
    vi.clearAllMocks();
    Notice.clear?.();
});

describe("Shared root setting onChange", () => {
    it("trims and saves the new path", async () => {
        const registry = makeRegistry();
        const plugin = makePlugin({ sharedRoot: "" }, registry);
        const tab = new LilbeeSettingTab(new App() as any, plugin as any);
        const { textOnChanges } = captureSettingCallbacks(() => tab.display());
        // Shared root is the first text input in managed mode.
        await textOnChanges[0]("  /custom/lilbee  ");
        expect(plugin.settings.sharedRoot).toBe("/custom/lilbee");
        expect(plugin.saveSettings).toHaveBeenCalled();
    });
});

describe("Adopt data dir affordance", () => {
    it("calls plugin.adoptDataDir with the trimmed staged value", async () => {
        const registry = makeRegistry();
        const plugin = makePlugin({}, registry);
        const adopt = vi.fn().mockResolvedValue(undefined);
        (plugin as any).adoptDataDir = adopt;
        const tab = new LilbeeSettingTab(new App() as any, plugin as any);
        const { textOnChanges, buttonLabels, buttonOnClicks } = captureSettingCallbacks(() => tab.display());
        // textOnChanges[0] = shared-root, [1] = adopt path.
        await textOnChanges[1]("  /external/lilbee-data  ");
        const adoptIdx = buttonLabels.findIndex((l) => l === "Use this folder");
        expect(adoptIdx).toBeGreaterThanOrEqual(0);
        await buttonOnClicks[adoptIdx]();
        expect(adopt).toHaveBeenCalledWith("/external/lilbee-data");
    });

    it("surfaces a Notice when the path is blank and does not call adoptDataDir", async () => {
        const registry = makeRegistry();
        const plugin = makePlugin({}, registry);
        const adopt = vi.fn().mockResolvedValue(undefined);
        (plugin as any).adoptDataDir = adopt;
        const tab = new LilbeeSettingTab(new App() as any, plugin as any);
        const { buttonLabels, buttonOnClicks } = captureSettingCallbacks(() => tab.display());
        const adoptIdx = buttonLabels.findIndex((l) => l === "Use this folder");
        await buttonOnClicks[adoptIdx]();
        expect(adopt).not.toHaveBeenCalled();
        expect(Notice.instances.some((n) => n.message.includes("Enter a path"))).toBe(true);
    });
});

describe("Storage report section", () => {
    it("renders rows for binary, models, the current vault, and the total", () => {
        const registry = makeRegistry();
        const plugin = makePlugin({}, registry);
        const tab = new LilbeeSettingTab(new App() as any, plugin as any);
        tab.display();
        const containerEl = (tab as any).containerEl as MockElement;
        const report = containerEl.find("lilbee-storage-report");
        expect(report).not.toBeNull();
        const labels = report?.findAll("lilbee-storage-row-label").map((e) => e.textContent) ?? [];
        expect(labels).toContain("Binary");
        expect(labels).toContain("Models cache");
        expect(labels).toContain("This vault");
        expect(labels).toContain("Total");
    });

    it("formats each row as bytes with a size", () => {
        const registry = makeRegistry();
        const plugin = makePlugin({}, registry);
        const tab = new LilbeeSettingTab(new App() as any, plugin as any);
        tab.display();
        const containerEl = (tab as any).containerEl as MockElement;
        const report = containerEl.find("lilbee-storage-report");
        const bytes = report?.findAll("lilbee-storage-row-bytes").map((e) => e.textContent) ?? [];
        expect(bytes.every((b) => /^\d/.test(b))).toBe(true);
    });
});

describe("Sections skipped without a vault registry", () => {
    it("does not crash when vaultRegistry is null", () => {
        const plugin = makePlugin({}, null);
        const tab = new LilbeeSettingTab(new App() as any, plugin as any);
        expect(() => tab.display()).not.toThrow();
    });
});
