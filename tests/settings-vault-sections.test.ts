/**
 * Tests for the shared-root, registered-vaults, and storage-report sections
 * inside the managed-mode Settings panel.
 */
import { vi, describe, it, expect, beforeEach } from "vitest";
import { App, MockElement, Setting, Notice } from "./__mocks__/obsidian";
import { LilbeeSettingTab } from "../src/settings";
import { DEFAULT_SETTINGS, type LilbeeSettings, type VaultRegistryEntry } from "../src/types";
import { TaskQueue } from "../src/task-queue";

const mockEnsureBinary = vi.fn();
const mockBinaryExists = vi.fn();
const mockDownload = vi.fn();
const mockGetLatestRelease = vi.fn();
const mockCheckForUpdate = vi.fn();

vi.mock("../src/binary-manager", () => ({
    BinaryManager: vi.fn().mockImplementation(() => ({
        ensureBinary: mockEnsureBinary,
        binaryExists: mockBinaryExists,
        binaryPath: "/fake/bin/lilbee",
        download: mockDownload,
    })),
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

vi.mock("../src/views/catalog-modal", () => ({ CatalogModal: vi.fn().mockImplementation(() => ({ open: vi.fn() })) }));
vi.mock("../src/views/setup-wizard", () => ({ SetupWizard: vi.fn().mockImplementation(() => ({ open: vi.fn() })) }));
vi.mock("../src/views/confirm-modal", () => ({
    ConfirmModal: vi.fn().mockImplementation(() => ({ open: vi.fn(), result: Promise.resolve(true) })),
}));
vi.mock("../src/views/confirm-pull-modal", () => ({
    ConfirmPullModal: vi.fn().mockImplementation(() => ({ open: vi.fn(), result: Promise.resolve(true) })),
}));

function entry(overrides: Partial<VaultRegistryEntry> = {}): VaultRegistryEntry {
    return {
        id: "abc",
        displayName: "Work",
        dataDir: "/shared/vaults/abc",
        obsidianVaultPath: "/Users/x/Work",
        addedAt: 1,
        lastActiveAt: 1,
        ...overrides,
    };
}

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
        getSharedHfToken: () => "",
        setSharedHfToken: vi.fn(),
        activeModel: "",
        wikiEnabled: true,
        wikiSync: null,
        taskQueue: new TaskQueue(),
    } as unknown as InstanceType<typeof import("../src/main").default>;
}

function makeRegistry(entries: VaultRegistryEntry[], onRemove: (id: string) => void = () => {}) {
    let current = [...entries];
    return {
        sharedRoot: "/shared",
        list: () => current.slice(),
        get: (id: string) => current.find((e) => e.id === id) ?? null,
        remove: (id: string) => {
            current = current.filter((e) => e.id !== id);
            onRemove(id);
        },
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
        const registry = makeRegistry([]);
        const plugin = makePlugin({ sharedRoot: "" }, registry);
        const tab = new LilbeeSettingTab(new App() as any, plugin as any);
        const { textOnChanges } = captureSettingCallbacks(() => tab.display());
        // Shared root is the first text input in managed mode.
        await textOnChanges[0]("  /custom/lilbee  ");
        expect(plugin.settings.sharedRoot).toBe("/custom/lilbee");
        expect(plugin.saveSettings).toHaveBeenCalled();
    });
});

describe("Registered vaults section", () => {
    it("renders an empty-state message when no vaults are registered", () => {
        const registry = makeRegistry([]);
        const plugin = makePlugin({}, registry);
        const tab = new LilbeeSettingTab(new App() as any, plugin as any);
        tab.display();
        const containerEl = (tab as any).containerEl as MockElement;
        const empty = containerEl.find("lilbee-vault-registry-empty");
        expect(empty?.textContent).toContain("No vaults registered");
    });

    it("renders a row per registered vault and marks the current one", () => {
        const registry = makeRegistry([
            entry({ id: "abc", displayName: "Work" }),
            entry({ id: "xyz", displayName: "Personal", obsidianVaultPath: "/Users/x/Personal" }),
        ]);
        const plugin = makePlugin({}, registry);
        const tab = new LilbeeSettingTab(new App() as any, plugin as any);
        const names: string[] = [];
        const origSetName = Setting.prototype.setName;
        Setting.prototype.setName = function (name: string) {
            names.push(name);
            return this;
        };
        try {
            tab.display();
        } finally {
            Setting.prototype.setName = origSetName;
        }
        expect(names).toContain("Work (this vault)");
        expect(names).toContain("Personal");
    });

    it("clicking Remove on a non-current vault drops the registry entry and re-renders", () => {
        const removed: string[] = [];
        const registry = makeRegistry(
            [
                entry({ id: "abc", displayName: "Work" }),
                entry({ id: "xyz", displayName: "Personal", obsidianVaultPath: "/Users/x/Personal" }),
            ],
            (id) => removed.push(id),
        );
        const plugin = makePlugin({}, registry);
        const tab = new LilbeeSettingTab(new App() as any, plugin as any);
        const displaySpy = vi.spyOn(tab, "display");
        const { buttonLabels, buttonOnClicks } = captureSettingCallbacks(() => tab.display());
        // Click only the "Remove" buttons. Re-rendering would change indices, so
        // collect handlers before iterating.
        const removeHandlers = buttonOnClicks.filter((_, i) => buttonLabels[i] === "Remove");
        expect(removeHandlers).toHaveLength(1);
        for (const handler of removeHandlers) void handler();
        expect(removed).toEqual(["xyz"]);
        expect(displaySpy).toHaveBeenCalled();
    });

    it("renders no Remove button for the current vault row", () => {
        const registry = makeRegistry([entry({ id: "abc", displayName: "Work" })]);
        const plugin = makePlugin({}, registry);
        const tab = new LilbeeSettingTab(new App() as any, plugin as any);
        const { buttonLabels } = captureSettingCallbacks(() => tab.display());
        expect(buttonLabels.filter((l) => l === "Remove")).toHaveLength(0);
    });
});

describe("Storage report section", () => {
    it("renders rows for binary, models, each vault, and the total", () => {
        const registry = makeRegistry([entry({ id: "abc", displayName: "Work" })]);
        const plugin = makePlugin({}, registry);
        const tab = new LilbeeSettingTab(new App() as any, plugin as any);
        tab.display();
        const containerEl = (tab as any).containerEl as MockElement;
        const report = containerEl.find("lilbee-storage-report");
        expect(report).not.toBeNull();
        const labels = report?.findAll("lilbee-storage-row-label").map((e) => e.textContent) ?? [];
        expect(labels).toContain("Binary");
        expect(labels).toContain("Models cache");
        expect(labels).toContain("Work");
        expect(labels).toContain("Total");
    });

    it("formats each row as bytes with a size", () => {
        const registry = makeRegistry([]);
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
