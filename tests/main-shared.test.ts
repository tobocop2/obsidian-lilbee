/**
 * Focused tests for the new shared-config helpers, take-over flow, and
 * registry/lock orchestration on LilbeePlugin.
 * The main.test.ts factory stubs these out; this file exercises the real impls.
 */
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("obsidian", async () => {
    return await import("./__mocks__/obsidian");
});

// We use a real-ish in-memory fs so shared-root reads and writes round-trip.
const fsState = (() => {
    const files = new Map<string, string>();
    const dirs = new Set<string>();
    return {
        files,
        dirs,
        reset() {
            files.clear();
            dirs.clear();
        },
    };
})();

vi.mock("../src/binary-manager", () => {
    const nodeMock = {
        spawn: vi.fn(),
        execFile: vi.fn(),
        existsSync: vi.fn((p: string) => fsState.files.has(p) || fsState.dirs.has(p)),
        readFileSync: vi.fn((p: string) => {
            const v = fsState.files.get(p);
            if (v === undefined) throw new Error(`ENOENT: ${p}`);
            return v;
        }),
        writeFileSync: vi.fn((p: string, c: string) => {
            fsState.files.set(p, String(c));
        }),
        renameSync: vi.fn((f: string, t: string) => {
            const v = fsState.files.get(f);
            if (v !== undefined) {
                fsState.files.delete(f);
                fsState.files.set(t, v);
                return;
            }
            const d = fsState.dirs.has(f);
            if (d) {
                fsState.dirs.delete(f);
                fsState.dirs.add(t);
            }
        }),
        unlinkSync: vi.fn((p: string) => {
            fsState.files.delete(p);
        }),
        mkdirSync: vi.fn((p: string) => {
            fsState.dirs.add(p);
        }),
        chmodSync: vi.fn(),
        copyFileSync: vi.fn(),
        cpSync: vi.fn(),
        statSync: vi.fn(() => ({ isDirectory: () => false, dev: 1, size: 0 })),
        readdirSync: vi.fn(() => [] as string[]),
        rmSync: vi.fn((p: string) => {
            fsState.files.delete(p);
            fsState.dirs.delete(p);
        }),
        join: (...parts: string[]) => parts.join("/").replace(/\/+/g, "/"),
        basename: (p: string) => p.replace(/\\/g, "/").split("/").pop() ?? "",
        resolve: (p: string) => p.replace(/\/+/g, "/"),
        dirname: (p: string) => {
            const normalized = p.replace(/\/+/g, "/");
            const i = normalized.lastIndexOf("/");
            return i <= 0 ? "/" : normalized.slice(0, i);
        },
        createHash: () => ({
            update: () => ({ digest: () => "abcdef0123456789abcdef0123456789abcdef0123456789" }),
        }),
        processKill: vi.fn(),
        requestUrl: vi.fn(),
        fetch: vi.fn(),
    };
    return {
        node: nodeMock,
        BinaryManager: vi.fn().mockImplementation(function () {
            return {
                binaryExists: vi.fn().mockReturnValue(true),
                binaryPath: "/fake/bin/lilbee",
                ensureBinary: vi.fn().mockResolvedValue("/fake/bin/lilbee"),
                download: vi.fn().mockResolvedValue(undefined),
            };
        }),
        getLatestRelease: vi.fn().mockResolvedValue({ tag: "v0.5.1", assetUrl: "https://example.com" }),
        checkForUpdate: vi.fn(() => false),
    };
});

vi.mock("../src/server-manager", () => {
    return {
        ServerManager: vi.fn().mockImplementation(function (opts: any) {
            return {
                start: vi.fn().mockResolvedValue(undefined),
                stop: vi.fn().mockResolvedValue(undefined),
                restart: vi.fn(),
                get serverUrl() {
                    return "http://127.0.0.1:54321";
                },
                get dataDir() {
                    return opts.dataDir;
                },
                get state() {
                    return "ready";
                },
                get lastOutput() {
                    return "";
                },
            };
        }),
        killServerTree: vi.fn().mockResolvedValue(undefined),
    };
});

import LilbeePlugin from "../src/main";
import { App, Notice } from "obsidian";
import { node } from "../src/binary-manager";
import { SHARED_PATH } from "../src/types";

async function createPlugin() {
    const app = new App() as any;
    app.vault.adapter.getBasePath = () => "/Users/tester/MyVault";
    const plugin = new LilbeePlugin(app, { id: "lilbee" } as any);
    (plugin as any).loadData = vi.fn().mockResolvedValue(null);
    await plugin.loadSettings();
    return plugin;
}

beforeEach(() => {
    fsState.reset();
    vi.clearAllMocks();
    Notice.clear?.();
});

describe("Shared lilbee version round-trip", () => {
    it("getSharedLilbeeVersion returns empty when nothing is written", async () => {
        const plugin = await createPlugin();
        expect(plugin.getSharedLilbeeVersion()).toBe("");
    });

    it("setSharedLilbeeVersion persists and getSharedLilbeeVersion reads it back", async () => {
        const plugin = await createPlugin();
        plugin.setSharedLilbeeVersion("v0.5.1");
        expect(plugin.getSharedLilbeeVersion()).toBe("v0.5.1");
    });

    it("setSharedLilbeeVersion is a no-op when registry is not initialised", async () => {
        const plugin = await createPlugin();
        (plugin as any).vaultRegistry = null;
        plugin.setSharedLilbeeVersion("v0.5.1");
        expect(plugin.getSharedLilbeeVersion()).toBe("");
    });

    it("preserves hfToken when version changes (and vice versa)", async () => {
        const plugin = await createPlugin();
        plugin.setSharedHfToken("hf_x");
        plugin.setSharedLilbeeVersion("v0.5.1");
        expect(plugin.getSharedHfToken()).toBe("hf_x");
        expect(plugin.getSharedLilbeeVersion()).toBe("v0.5.1");
    });

    it("getSharedLilbeeVariant returns empty when nothing is written", async () => {
        const plugin = await createPlugin();
        expect(plugin.getSharedLilbeeVariant()).toBe("");
    });

    it("setSharedLilbeeVariant persists and getSharedLilbeeVariant reads it back", async () => {
        const plugin = await createPlugin();
        plugin.setSharedLilbeeVariant("cu125");
        expect(plugin.getSharedLilbeeVariant()).toBe("cu125");
    });

    it("setSharedLilbeeVariant is a no-op when registry is not initialised", async () => {
        const plugin = await createPlugin();
        (plugin as any).vaultRegistry = null;
        plugin.setSharedLilbeeVariant("cu125");
        expect(plugin.getSharedLilbeeVariant()).toBe("");
    });

    it("preserves version and variant alongside each other", async () => {
        const plugin = await createPlugin();
        plugin.setSharedLilbeeVersion("v0.5.1");
        plugin.setSharedLilbeeVariant("cu124");
        expect(plugin.getSharedLilbeeVersion()).toBe("v0.5.1");
        expect(plugin.getSharedLilbeeVariant()).toBe("cu124");
    });
});

describe("Shared HF token round-trip", () => {
    it("getSharedHfToken returns empty when nothing is written", async () => {
        const plugin = await createPlugin();
        expect(plugin.getSharedHfToken()).toBe("");
    });

    it("setSharedHfToken persists and getSharedHfToken reads it back", async () => {
        const plugin = await createPlugin();
        plugin.setSharedHfToken("hf_token");
        expect(plugin.getSharedHfToken()).toBe("hf_token");
    });

    it("setSharedHfToken is a no-op when registry is not initialised", async () => {
        const plugin = await createPlugin();
        (plugin as any).vaultRegistry = null;
        plugin.setSharedHfToken("hf_token");
        expect(plugin.getSharedHfToken()).toBe("");
    });
});

describe("getVaultDisplayName", () => {
    it("returns the trailing path segment", async () => {
        const plugin = await createPlugin();
        expect((plugin as any).getVaultDisplayName()).toBe("MyVault");
    });

    it("falls back to 'vault' when the path is just /", async () => {
        const plugin = await createPlugin();
        (plugin as any).getVaultBasePath = () => "/";
        expect((plugin as any).getVaultDisplayName()).toBe("vault");
    });
});

describe("recordReadyState", () => {
    it("writes the lock and upserts the vault entry", async () => {
        const plugin = await createPlugin();
        (plugin as any).serverManager = {
            serverUrl: "http://127.0.0.1:54321",
            dataDir: "/some/data/dir",
        };
        (plugin as any).recordReadyState();
        const registry = plugin.vaultRegistry!;
        expect(registry.readLock()?.port).toBe(54321);
        expect(registry.get(plugin.vaultId)?.dataDir).toBe("/some/data/dir");
    });

    it("preserves displayName and addedAt across re-upserts", async () => {
        const plugin = await createPlugin();
        const registry = plugin.vaultRegistry!;
        registry.upsert({
            id: plugin.vaultId,
            displayName: "Renamed",
            dataDir: "/old",
            obsidianVaultPath: "/Users/tester/MyVault",
            addedAt: 123,
            lastActiveAt: 123,
        });
        (plugin as any).serverManager = { serverUrl: "http://127.0.0.1:9999", dataDir: "/new" };
        (plugin as any).recordReadyState();
        expect(registry.get(plugin.vaultId)?.displayName).toBe("Renamed");
        expect(registry.get(plugin.vaultId)?.addedAt).toBe(123);
        expect(registry.get(plugin.vaultId)?.dataDir).toBe("/new");
    });

    it("is a no-op without serverManager or registry", async () => {
        const plugin = await createPlugin();
        (plugin as any).recordReadyState(); // no serverManager
        (plugin as any).serverManager = { serverUrl: "http://127.0.0.1:1", dataDir: "/x" };
        (plugin as any).vaultRegistry = null;
        expect(() => (plugin as any).recordReadyState()).not.toThrow();
    });
});

describe("managed server tracks the open vault's data dir", () => {
    it("builds the server against whichever vault is open — switching vaults switches the data dir", async () => {
        const plugin = await createPlugin();
        const registry = plugin.vaultRegistry!;
        registry.upsert({
            id: "vault-a",
            displayName: "A",
            dataDir: "/shared/vaults/a",
            obsidianVaultPath: "/Users/tester/A",
            addedAt: 1,
            lastActiveAt: 1,
        });
        registry.upsert({
            id: "vault-b",
            displayName: "B",
            dataDir: "/shared/vaults/b",
            obsidianVaultPath: "/Users/tester/B",
            addedAt: 1,
            lastActiveAt: 1,
        });

        // With vault A open, the server is wired to A's data dir.
        (plugin as any).vaultId = "vault-a";
        const smA = (plugin as any).buildServerManager("/fake/bin/lilbee", registry, registry.sharedRoot);
        expect(smA.dataDir).toBe("/shared/vaults/a");

        // Opening vault B (its own plugin instance loads with vault-b's id)
        // points the managed server at B's data dir instead — not A's.
        (plugin as any).vaultId = "vault-b";
        const smB = (plugin as any).buildServerManager("/fake/bin/lilbee", registry, registry.sharedRoot);
        expect(smB.dataDir).toBe("/shared/vaults/b");
    });

    it("falls back to the default per-vault dir when the open vault is unregistered", async () => {
        const plugin = await createPlugin();
        const registry = plugin.vaultRegistry!;
        (plugin as any).vaultId = "fresh-vault";
        const sm = (plugin as any).buildServerManager("/fake/bin/lilbee", registry, registry.sharedRoot);
        expect(sm.dataDir).toBe(registry.resolveDataDir("fresh-vault"));
        expect(sm.dataDir).toBe(`${registry.sharedRoot}/vaults/fresh-vault`);
    });
});

describe("acquireLockOrBail", () => {
    it("returns true when the lock is unowned", async () => {
        const plugin = await createPlugin();
        const result = await (plugin as any).acquireLockOrBail(plugin.vaultRegistry);
        expect(result).toBe(true);
    });

    it("returns true and proceeds when lock is ours", async () => {
        const plugin = await createPlugin();
        plugin.vaultRegistry!.writeLock({
            vaultId: plugin.vaultId,
            pid: process.pid,
            port: 1,
            startedAt: 1,
        });
        (node.processKill as any).mockImplementation(() => true);
        const result = await (plugin as any).acquireLockOrBail(plugin.vaultRegistry);
        expect(result).toBe(true);
    });

    it("bails when LIVE_OTHER and the user declines take-over", async () => {
        const plugin = await createPlugin();
        plugin.vaultRegistry!.writeLock({ vaultId: "other-id", pid: 99, port: 1, startedAt: 1 });
        (node.processKill as any).mockImplementation((pid: number, signal?: number) => {
            if (signal === 0) return true;
            return undefined;
        });
        vi.spyOn(plugin as any, "confirmTakeOver").mockResolvedValue(false);
        const result = await (plugin as any).acquireLockOrBail(plugin.vaultRegistry);
        expect(result).toBe(false);
        expect(Notice.instances.some((n) => n.message.includes("stays with"))).toBe(true);
    });

    it("takes over when LIVE_OTHER and the user accepts", async () => {
        const plugin = await createPlugin();
        plugin.vaultRegistry!.writeLock({ vaultId: "other-id", pid: 99, port: 1, startedAt: 1 });
        let pollCalls = 0;
        (node.processKill as any).mockImplementation((pid: number, signal?: number) => {
            if (signal === 0) {
                pollCalls += 1;
                if (pollCalls > 1) throw new Error("ESRCH"); // process is gone after one poll
                return true;
            }
            return undefined; // SIGTERM-like
        });
        vi.spyOn(plugin as any, "confirmTakeOver").mockResolvedValue(true);
        const result = await (plugin as any).acquireLockOrBail(plugin.vaultRegistry);
        expect(result).toBe(true);
        expect(Notice.instances.some((n) => n.message.includes("switched from"))).toBe(true);
    });

    it("returns false on take-over timeout when the process refuses to die", async () => {
        vi.useFakeTimers();
        try {
            const plugin = await createPlugin();
            plugin.vaultRegistry!.writeLock({ vaultId: "other-id", pid: 99, port: 1, startedAt: 1 });
            (node.processKill as any).mockImplementation(() => true);
            vi.spyOn(plugin as any, "confirmTakeOver").mockResolvedValue(true);
            const promise = (plugin as any).acquireLockOrBail(plugin.vaultRegistry);
            await vi.advanceTimersByTimeAsync(50 * 100);
            const result = await promise;
            expect(result).toBe(false);
            expect(Notice.instances.some((n) => n.message.includes("did not shut down"))).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });

    it("uses the registered display name when describing the owning vault", async () => {
        const plugin = await createPlugin();
        plugin.vaultRegistry!.upsert({
            id: "other-id",
            displayName: "Personal",
            dataDir: "/x",
            obsidianVaultPath: "/y",
            addedAt: 1,
            lastActiveAt: 1,
        });
        plugin.vaultRegistry!.writeLock({ vaultId: "other-id", pid: 99, port: 1, startedAt: 1 });
        (node.processKill as any).mockImplementation((pid: number, signal?: number) => {
            if (signal === 0) return true;
            return undefined;
        });
        vi.spyOn(plugin as any, "confirmTakeOver").mockResolvedValue(false);
        await (plugin as any).acquireLockOrBail(plugin.vaultRegistry);
        expect(Notice.instances.some((n) => n.message.includes("Personal"))).toBe(true);
    });
});

describe("confirmTakeOver", () => {
    it("opens a ConfirmModal showing the owning vault name", async () => {
        const plugin = await createPlugin();
        const { ConfirmModal } = await import("../src/views/confirm-modal");
        const openSpy = vi.spyOn(ConfirmModal.prototype, "open").mockImplementation(function (this: any) {
            this._resolve?.(true);
        });
        const result = await (plugin as any).confirmTakeOver("Personal");
        expect(openSpy).toHaveBeenCalled();
        expect(result).toBe(true);
    });
});

describe("terminateOwningProcess", () => {
    it("returns true immediately when there is no owner", async () => {
        const plugin = await createPlugin();
        const result = await (plugin as any).terminateOwningProcess(null);
        expect(result).toBe(true);
    });

    it("swallows errors from the initial SIGTERM and still polls", async () => {
        const plugin = await createPlugin();
        (node.processKill as any).mockImplementation((pid: number, signal?: number) => {
            if (signal === undefined) throw new Error("ESRCH on SIGTERM");
            throw new Error("ESRCH on poll");
        });
        const result = await (plugin as any).terminateOwningProcess({
            vaultId: "x",
            pid: 1,
            port: 1,
            startedAt: 1,
        });
        expect(result).toBe(true);
    });

    it("also tears down the owner's server tree when the lock records a server pid", async () => {
        const plugin = await createPlugin();
        const { killServerTree } = await import("../src/server-manager");
        (killServerTree as any).mockClear();
        (node.processKill as any).mockImplementation((pid: number, signal?: number) => {
            if (signal === 0) throw new Error("owner gone");
        });
        const result = await (plugin as any).terminateOwningProcess({
            vaultId: "x",
            pid: 1,
            serverPid: 4242,
            port: 1,
            startedAt: 1,
        });
        expect(result).toBe(true);
        expect(killServerTree).toHaveBeenCalledWith(4242);
    });
});

describe("acquireLockOrBail edge branches", () => {
    it("falls back to 'another vault' when readLock yields null mid-flow", async () => {
        const plugin = await createPlugin();
        // Force LIVE_OTHER but then null-out the lock before the owner readback.
        const reg = plugin.vaultRegistry!;
        vi.spyOn(reg, "lockState").mockReturnValue("live_other");
        vi.spyOn(reg, "readLock").mockReturnValue(null);
        vi.spyOn(plugin as any, "confirmTakeOver").mockResolvedValue(false);
        const result = await (plugin as any).acquireLockOrBail(reg);
        expect(result).toBe(false);
        expect(Notice.instances.some((n) => n.message.includes("another vault"))).toBe(true);
    });

    it("passes onProgress payloads through to the caller when declining take-over", async () => {
        const plugin = await createPlugin();
        plugin.vaultRegistry!.writeLock({ vaultId: "other-id", pid: 99, port: 1, startedAt: 1 });
        (node.processKill as any).mockImplementation(() => true);
        vi.spyOn(plugin as any, "confirmTakeOver").mockResolvedValue(false);
        const events: any[] = [];
        const result = await (plugin as any).acquireLockOrBail(plugin.vaultRegistry, (e: any) => events.push(e));
        expect(result).toBe(false);
        expect(events.find((e) => e.phase === "error")).toBeDefined();
    });
});

describe("ensureBinaryWithUi guards", () => {
    it("returns null when binaryManager is missing", async () => {
        const plugin = await createPlugin();
        (plugin as any).binaryManager = null;
        const result = await (plugin as any).ensureBinaryWithUi();
        expect(result).toBeNull();
    });

    it("returns null and surfaces an error when ensureBinary throws", async () => {
        const plugin = await createPlugin();
        (plugin as any).binaryManager = {
            binaryExists: () => true,
            ensureBinary: vi.fn().mockRejectedValue(new Error("download exploded")),
        };
        const events: any[] = [];
        const result = await (plugin as any).ensureBinaryWithUi((e: any) => events.push(e));
        expect(result).toBeNull();
        expect(events.find((e) => e.phase === "error")).toBeDefined();
    });

    it("hides the download notice when ensureBinary throws after firing progress", async () => {
        const plugin = await createPlugin();
        (plugin as any).binaryManager = {
            binaryExists: () => false,
            ensureBinary: vi.fn(async (cb: (m: string, u?: string) => void) => {
                cb("Downloading", "https://example.com");
                throw new Error("network gone");
            }),
        };
        const result = await (plugin as any).ensureBinaryWithUi();
        expect(result).toBeNull();
    });

    it("returns the path without creating a notice when the binary already exists", async () => {
        const plugin = await createPlugin();
        (plugin as any).binaryManager = {
            binaryExists: () => true,
            ensureBinary: vi.fn(async () => "/fake/bin/lilbee"),
        };
        const before = Notice.instances.length;
        const result = await (plugin as any).ensureBinaryWithUi();
        expect(result).toBe("/fake/bin/lilbee");
        expect(Notice.instances.length).toBe(before);
    });

    it("hides the download notice in the finally block", async () => {
        const plugin = await createPlugin();
        const fakeBm = {
            binaryExists: () => false,
            ensureBinary: vi.fn(async (cb: (m: string, u?: string) => void) => {
                cb("Downloading", "https://example.com");
                return "/fake/bin/lilbee";
            }),
        };
        (plugin as any).binaryManager = fakeBm;
        const result = await (plugin as any).ensureBinaryWithUi();
        expect(result).toBe("/fake/bin/lilbee");
        // The Notice was constructed (counts in instances).
        expect(Notice.instances.length).toBeGreaterThan(0);
    });
});

describe("recordReadyState port parsing fallback", () => {
    it("defaults port to 0 when serverUrl has no port segment", async () => {
        const plugin = await createPlugin();
        (plugin as any).serverManager = {
            serverUrl: "",
            dataDir: "/x",
        };
        (plugin as any).recordReadyState();
        expect(plugin.vaultRegistry!.readLock()?.port).toBe(0);
    });
});

describe("updateServer guards", () => {
    it("returns early when vaultRegistry is null", async () => {
        const plugin = await createPlugin();
        (plugin as any).vaultRegistry = null;
        await plugin.updateServer({ tag: "v1", assetUrl: "x" });
        expect(plugin.binaryManager).toBeNull();
    });
});

describe("startManagedServer guards", () => {
    it("returns early when vaultRegistry is null", async () => {
        const plugin = await createPlugin();
        (plugin as any).vaultRegistry = null;
        await plugin.startManagedServer();
        expect(plugin.serverManager).toBeNull();
    });

    it("returns early when already starting", async () => {
        const plugin = await createPlugin();
        (plugin as any).startingServer = true;
        await plugin.startManagedServer();
        expect(plugin.serverManager).toBeNull();
    });

    it("returns when acquireLockOrBail bails", async () => {
        const plugin = await createPlugin();
        vi.spyOn(plugin as any, "acquireLockOrBail").mockResolvedValue(false);
        await plugin.startManagedServer();
        expect(plugin.serverManager).toBeNull();
        expect((plugin as any).startingServer).toBe(false);
    });
});

describe("onunload releases the lock", () => {
    it("calls releaseLock with the current vault id", async () => {
        const plugin = await createPlugin();
        const releaseSpy = vi.spyOn(plugin.vaultRegistry!, "releaseLock");
        plugin.onunload();
        expect(releaseSpy).toHaveBeenCalledWith(plugin.vaultId);
    });
});

describe("Shared-root layout integration", () => {
    it("loadSettings initialises a vault registry at the resolved shared root", async () => {
        const plugin = await createPlugin();
        expect(plugin.vaultRegistry).not.toBeNull();
        expect(plugin.vaultRegistry!.sharedRoot).toMatch(/lilbee/);
        expect(plugin.vaultId).toMatch(/^[a-f0-9]{12}$/);
    });
});

describe("adoptDataDir", () => {
    it("rewrites the registry entry to point at the new data-dir", async () => {
        const plugin = await createPlugin();
        vi.spyOn(plugin, "startManagedServer").mockResolvedValue(undefined);
        await plugin.adoptDataDir("/external/lilbee-data");
        const stored = plugin.vaultRegistry!.get(plugin.vaultId);
        expect(stored?.dataDir).toBe("/external/lilbee-data");
    });

    it("preserves displayName and addedAt when adopting", async () => {
        const plugin = await createPlugin();
        plugin.vaultRegistry!.upsert({
            id: plugin.vaultId,
            displayName: "Renamed",
            dataDir: "/old",
            obsidianVaultPath: "/Users/tester/MyVault",
            addedAt: 42,
            lastActiveAt: 42,
        });
        vi.spyOn(plugin, "startManagedServer").mockResolvedValue(undefined);
        await plugin.adoptDataDir("/new");
        const stored = plugin.vaultRegistry!.get(plugin.vaultId);
        expect(stored?.displayName).toBe("Renamed");
        expect(stored?.addedAt).toBe(42);
        expect(stored?.dataDir).toBe("/new");
    });

    it("stops the running server before restarting it on the new data-dir", async () => {
        const plugin = await createPlugin();
        const stop = vi.fn().mockResolvedValue(undefined);
        (plugin as any).serverManager = { stop, dataDir: "/old", serverUrl: "" };
        const startSpy = vi.spyOn(plugin, "startManagedServer").mockResolvedValue(undefined);
        await plugin.adoptDataDir("/new");
        expect(stop).toHaveBeenCalled();
        expect(startSpy).toHaveBeenCalled();
    });

    it("does not restart in external mode", async () => {
        const plugin = await createPlugin();
        plugin.settings.serverMode = "external";
        const startSpy = vi.spyOn(plugin, "startManagedServer").mockResolvedValue(undefined);
        await plugin.adoptDataDir("/new");
        expect(startSpy).not.toHaveBeenCalled();
    });

    it("is a no-op when vaultRegistry is null", async () => {
        const plugin = await createPlugin();
        (plugin as any).vaultRegistry = null;
        const startSpy = vi.spyOn(plugin, "startManagedServer").mockResolvedValue(undefined);
        await plugin.adoptDataDir("/new");
        expect(startSpy).not.toHaveBeenCalled();
    });
});

describe("SHARED_PATH names used by the registry", () => {
    it("matches what we write to disk", async () => {
        const plugin = await createPlugin();
        plugin.setSharedLilbeeVersion("v0.5.1");
        const expected = `${plugin.vaultRegistry!.sharedRoot}/${SHARED_PATH.CONFIG}`;
        expect(fsState.files.has(expected)).toBe(true);
    });
});

describe("managed-server uninstall", () => {
    /** Seed the shared root with a binary, a model cache, and this vault's index. */
    function seedInstall(plugin: LilbeePlugin): string {
        const root = plugin.vaultRegistry!.sharedRoot;
        fsState.dirs.add(`${root}/bin`);
        fsState.dirs.add(`${root}/models`);
        fsState.dirs.add(`${root}/vaults/${plugin.vaultId}`);
        fsState.files.set(`${root}/bin/lilbee`, "x".repeat(10));
        fsState.files.set(`${root}/models/a.gguf`, "y".repeat(20));
        fsState.files.set(`${root}/vaults/${plugin.vaultId}/index.db`, "z".repeat(30));
        return root;
    }

    it("plans the binary, the models, and this vault's index", async () => {
        const plugin = await createPlugin();
        const root = seedInstall(plugin);

        const plan = plugin.planServerUninstall()!;

        expect(plan.targets.map((t) => t.path)).toEqual([
            `${root}/bin`,
            `${root}/models`,
            `${root}/vaults/${plugin.vaultId}`,
        ]);
    });

    it("has no plan without a vault registry", async () => {
        const plugin = await createPlugin();
        (plugin as any).vaultRegistry = null;

        expect(plugin.planServerUninstall()).toBeNull();
    });

    it("deletes the planned paths, forgets the version, and remembers the choice", async () => {
        const plugin = await createPlugin();
        const root = seedInstall(plugin);
        plugin.setSharedLilbeeVersion("v0.5.1");
        const plan = plugin.planServerUninstall()!;

        const freed = await plugin.uninstallServer(plan);

        expect(freed).toBe(plan.totalBytes);
        expect(fsState.dirs.has(`${root}/bin`)).toBe(false);
        expect(fsState.dirs.has(`${root}/models`)).toBe(false);
        expect(plugin.getSharedLilbeeVersion()).toBe("");
        expect(plugin.isServerUninstalled()).toBe(true);
        expect(plugin.vaultRegistry!.loadConfig().serverUninstalled).toBe(true);
    });

    it("stops the running server and releases the shared lock", async () => {
        const plugin = await createPlugin();
        seedInstall(plugin);
        const stop = vi.fn().mockResolvedValue(undefined);
        (plugin as any).serverManager = { stop };
        const releaseLock = vi.spyOn(plugin.vaultRegistry!, "releaseLock");

        await plugin.uninstallServer(plugin.planServerUninstall()!);

        expect(stop).toHaveBeenCalled();
        expect(releaseLock).toHaveBeenCalledWith(plugin.vaultId);
        expect(plugin.serverManager).toBeNull();
    });

    it("returns nothing to free without a vault registry", async () => {
        const plugin = await createPlugin();
        const plan = plugin.planServerUninstall()!;
        (plugin as any).vaultRegistry = null;

        expect(await plugin.uninstallServer(plan)).toBe(0);
    });

    it("never starts the managed server once uninstalled", async () => {
        const plugin = await createPlugin();
        seedInstall(plugin);
        await plugin.uninstallServer(plugin.planServerUninstall()!);

        await plugin.startManagedServer();

        expect(plugin.serverManager).toBeNull();
    });

    it("skips the automatic server update once uninstalled", async () => {
        const plugin = await createPlugin();
        seedInstall(plugin);
        await plugin.uninstallServer(plugin.planServerUninstall()!);
        const checkForUpdate = vi.spyOn(plugin, "checkForUpdate");

        await (plugin as any).autoUpdateServerBinary();

        expect(checkForUpdate).not.toHaveBeenCalled();
    });

    it("remembers the uninstall across a reload", async () => {
        const plugin = await createPlugin();
        seedInstall(plugin);
        await plugin.uninstallServer(plugin.planServerUninstall()!);

        const reloaded = await createPlugin();

        expect(reloaded.isServerUninstalled()).toBe(true);
    });

    it("refuses while another vault's server is running", async () => {
        const plugin = await createPlugin();
        seedInstall(plugin);
        const plan = plugin.planServerUninstall()!;
        plugin.vaultRegistry!.upsert({
            id: "other",
            displayName: "Notes",
            dataDir: "/d",
            obsidianVaultPath: "/p",
            addedAt: 1,
            lastActiveAt: 1,
        });
        plugin.vaultRegistry!.writeLock({ vaultId: "other", pid: process.pid, port: 1, startedAt: 1 });

        await expect(plugin.uninstallServer(plan)).rejects.toThrow("The lilbee server is running for Notes");
        expect(plugin.isServerUninstalled()).toBe(false);
    });

    it("reaps a server orphaned by a crashed Obsidian before deleting", async () => {
        const { killServerTree } = await import("../src/server-manager");
        (killServerTree as any).mockClear();
        const plugin = await createPlugin();
        seedInstall(plugin);
        plugin.vaultRegistry!.writeLock({
            vaultId: plugin.vaultId,
            pid: process.pid,
            port: 1,
            startedAt: 1,
            serverPid: 4242,
        });

        await plugin.uninstallServer(plugin.planServerUninstall()!);

        expect(killServerTree).toHaveBeenCalledWith(4242);
    });

    it("installing a release clears the uninstall and downloads it", async () => {
        const plugin = await createPlugin();
        seedInstall(plugin);
        await plugin.uninstallServer(plugin.planServerUninstall()!);
        const updateServer = vi.spyOn(plugin, "updateServer").mockResolvedValue(undefined);
        const release = { tag: "v0.5.1", assetUrl: "https://e/dl", variant: "default", sizeBytes: 1, digest: null };

        await plugin.installServer(release as any);

        expect(plugin.isServerUninstalled()).toBe(false);
        expect(plugin.vaultRegistry!.loadConfig().serverUninstalled).toBe(false);
        expect(updateServer).toHaveBeenCalledWith(release, undefined);
    });

    it("tracks whether a binary is on disk", async () => {
        const plugin = await createPlugin();

        expect(plugin.isServerInstalled()).toBe(true);

        (plugin as any).vaultRegistry = null;
        expect(plugin.isServerInstalled()).toBe(false);
    });

    it("keeps the uninstalled flag out of the shared config when there is no registry", async () => {
        const plugin = await createPlugin();
        (plugin as any).vaultRegistry = null;

        plugin.setServerUninstalled(true);

        expect(plugin.isServerUninstalled()).toBe(true);
    });
});

describe("status bar after an uninstall", () => {
    it("reads 'server not installed' instead of 'stopped'", async () => {
        const plugin = await createPlugin();
        plugin.settings.serverMode = "managed";
        const texts: string[] = [];
        (plugin as any).statusBarEl = null;
        const updateStatusBar = vi
            .spyOn(plugin as any, "updateStatusBar")
            .mockImplementation((text: unknown) => texts.push(String(text)));

        plugin.setServerUninstalled(true);
        (plugin as any).setStatusReady();

        expect(texts).toEqual(["lilbee: server not installed"]);
        updateStatusBar.mockRestore();
    });

    it("does not probe a server that is not installed", async () => {
        const plugin = await createPlugin();
        plugin.setServerUninstalled(true);
        const health = vi.spyOn(plugin.api, "health");

        await (plugin as any).probeServerHealth();

        expect(health).not.toHaveBeenCalled();
    });
});
