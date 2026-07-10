import { vi, describe, it, expect, beforeEach } from "vitest";
import { node } from "../src/binary-manager";
import {
    VaultRegistry,
    computeVaultId,
    defaultDataDirFor,
    resolveSharedRoot,
    sharedBinDir,
    sharedModelsDir,
    vaultsRootDir,
} from "../src/vault-registry";
import { LOCK_STATE, type ActiveLock, type VaultRegistryEntry } from "../src/types";

/* ------------------------------------------------------------------ */
/*  In-memory fs                                                      */
/* ------------------------------------------------------------------ */

function makeFs() {
    const files = new Map<string, string>();
    const dirs = new Set<string>();
    return {
        files,
        dirs,
        exists: (p: string) => files.has(p) || dirs.has(p),
        read: (p: string) => {
            const v = files.get(p);
            if (v === undefined) throw new Error(`ENOENT: ${p}`);
            return v;
        },
        write: (p: string, content: string) => {
            files.set(p, content);
        },
        rename: (from: string, to: string) => {
            const v = files.get(from);
            if (v === undefined) throw new Error(`ENOENT rename: ${from}`);
            files.delete(from);
            files.set(to, v);
        },
        unlink: (p: string) => {
            if (!files.has(p)) throw new Error(`ENOENT unlink: ${p}`);
            files.delete(p);
        },
        mkdir: (p: string) => {
            dirs.add(p);
        },
    };
}

function mountFs(fs: ReturnType<typeof makeFs>) {
    vi.spyOn(node, "existsSync").mockImplementation((p) => fs.exists(p as string));
    vi.spyOn(node, "readFileSync").mockImplementation((p) => fs.read(p as string));
    vi.spyOn(node, "writeFileSync").mockImplementation((p, c) => fs.write(p as string, String(c)));
    vi.spyOn(node, "renameSync").mockImplementation((f, t) => fs.rename(f as string, t as string));
    vi.spyOn(node, "unlinkSync").mockImplementation((p) => fs.unlink(p as string));
    vi.spyOn(node, "mkdirSync").mockImplementation((p) => {
        fs.mkdir(p as string);
        return undefined;
    });
}

/* ------------------------------------------------------------------ */
/*  resolveSharedRoot                                                  */
/* ------------------------------------------------------------------ */

describe("resolveSharedRoot", () => {
    it("returns the explicit setting when set", () => {
        expect(resolveSharedRoot("/custom/path")).toBe("/custom/path");
    });

    it("falls back to platform default when setting is empty", () => {
        const result = resolveSharedRoot("");
        // On any normal test host HOME/USERPROFILE is set so we get a real path.
        expect(result).toMatch(/lilbee/);
    });

    it("falls back to /tmp/lilbee when both HOME and USERPROFILE are missing", () => {
        const origHome = process.env.HOME;
        const origUser = process.env.USERPROFILE;
        delete process.env.HOME;
        delete process.env.USERPROFILE;
        try {
            expect(resolveSharedRoot("")).toBe("/tmp/lilbee");
        } finally {
            if (origHome !== undefined) process.env.HOME = origHome;
            if (origUser !== undefined) process.env.USERPROFILE = origUser;
        }
    });
});

/* ------------------------------------------------------------------ */
/*  computeVaultId                                                     */
/* ------------------------------------------------------------------ */

describe("computeVaultId", () => {
    it("returns a 12-hex-char id", () => {
        const id = computeVaultId("/Users/x/MyVault");
        expect(id).toMatch(/^[0-9a-f]{12}$/);
    });

    it("is deterministic for the same path", () => {
        expect(computeVaultId("/Users/x/MyVault")).toBe(computeVaultId("/Users/x/MyVault"));
    });

    it("differs for different paths", () => {
        expect(computeVaultId("/Users/x/A")).not.toBe(computeVaultId("/Users/x/B"));
    });

    it("canonicalises relative paths so trailing slashes don't matter", () => {
        // node.resolve collapses ./ and trailing slashes.
        expect(computeVaultId("/Users/x/./MyVault/")).toBe(computeVaultId("/Users/x/MyVault"));
    });
});

/* ------------------------------------------------------------------ */
/*  Path helpers                                                       */
/* ------------------------------------------------------------------ */

describe("path helpers", () => {
    it("sharedBinDir = <root>/bin", () => {
        expect(sharedBinDir("/r")).toBe("/r/bin");
    });

    it("sharedModelsDir = <root>/models", () => {
        expect(sharedModelsDir("/r")).toBe("/r/models");
    });

    it("vaultsRootDir = <root>/vaults", () => {
        expect(vaultsRootDir("/r")).toBe("/r/vaults");
    });

    it("defaultDataDirFor = <root>/vaults/<id>", () => {
        expect(defaultDataDirFor("/r", "abc123")).toBe("/r/vaults/abc123");
    });
});

/* ------------------------------------------------------------------ */
/*  VaultRegistry: config                                              */
/* ------------------------------------------------------------------ */

describe("VaultRegistry.loadConfig", () => {
    beforeEach(() => vi.restoreAllMocks());

    it("returns defaults when config file is missing", () => {
        mountFs(makeFs());
        const reg = new VaultRegistry("/r");
        expect(reg.loadConfig()).toEqual({
            lilbeeVersion: "",
            lilbeeVariant: "",
            hfToken: "",
            lastUpdateCheckPluginVersion: "",
            serverUninstalled: false,
        });
    });

    it("merges defaults with persisted partial config", () => {
        const fs = makeFs();
        fs.write("/r/config.json", JSON.stringify({ lilbeeVersion: "v0.5.0" }));
        mountFs(fs);
        expect(new VaultRegistry("/r").loadConfig()).toEqual({
            lilbeeVersion: "v0.5.0",
            lilbeeVariant: "",
            hfToken: "",
            lastUpdateCheckPluginVersion: "",
            serverUninstalled: false,
        });
    });

    it("returns defaults when config JSON is corrupt", () => {
        const fs = makeFs();
        fs.write("/r/config.json", "{not json");
        mountFs(fs);
        expect(new VaultRegistry("/r").loadConfig()).toEqual({
            lilbeeVersion: "",
            lilbeeVariant: "",
            hfToken: "",
            lastUpdateCheckPluginVersion: "",
            serverUninstalled: false,
        });
    });
});

describe("VaultRegistry.saveConfig", () => {
    beforeEach(() => vi.restoreAllMocks());

    it("writes via a temp file then renames", () => {
        const fs = makeFs();
        mountFs(fs);
        new VaultRegistry("/r").saveConfig({
            lilbeeVersion: "v1",
            lilbeeVariant: "cu125",
            hfToken: "tok",
            lastUpdateCheckPluginVersion: "",
            serverUninstalled: false,
        });
        expect(fs.exists("/r/config.json")).toBe(true);
        expect(fs.exists("/r/config.json.tmp")).toBe(false);
        expect(JSON.parse(fs.read("/r/config.json"))).toEqual({
            lilbeeVersion: "v1",
            lilbeeVariant: "cu125",
            hfToken: "tok",
            lastUpdateCheckPluginVersion: "",
            serverUninstalled: false,
        });
    });

    it("creates the shared root directory if missing", () => {
        const fs = makeFs();
        mountFs(fs);
        new VaultRegistry("/r").saveConfig({
            lilbeeVersion: "",
            lilbeeVariant: "",
            hfToken: "",
            lastUpdateCheckPluginVersion: "",
            serverUninstalled: false,
        });
        expect(fs.dirs.has("/r")).toBe(true);
    });
});

/* ------------------------------------------------------------------ */
/*  VaultRegistry: list / get / upsert / resolveDataDir                */
/* ------------------------------------------------------------------ */

function entry(id: string, overrides: Partial<VaultRegistryEntry> = {}): VaultRegistryEntry {
    return {
        id,
        displayName: `Vault ${id}`,
        dataDir: `/r/vaults/${id}`,
        obsidianVaultPath: `/Users/x/${id}`,
        addedAt: 1700000000000,
        lastActiveAt: 1700000000000,
        ...overrides,
    };
}

describe("VaultRegistry registry operations", () => {
    beforeEach(() => vi.restoreAllMocks());

    it("list returns [] when registry.json is missing", () => {
        mountFs(makeFs());
        expect(new VaultRegistry("/r").list()).toEqual([]);
    });

    it("get returns null when id is unknown", () => {
        mountFs(makeFs());
        expect(new VaultRegistry("/r").get("nope")).toBeNull();
    });

    it("upsert adds a new entry", () => {
        const fs = makeFs();
        mountFs(fs);
        const reg = new VaultRegistry("/r");
        reg.upsert(entry("a"));
        expect(reg.list()).toHaveLength(1);
        expect(reg.get("a")?.displayName).toBe("Vault a");
    });

    it("upsert replaces an existing entry instead of duplicating", () => {
        const fs = makeFs();
        mountFs(fs);
        const reg = new VaultRegistry("/r");
        reg.upsert(entry("a"));
        reg.upsert(entry("a", { displayName: "Renamed" }));
        expect(reg.list()).toHaveLength(1);
        expect(reg.get("a")?.displayName).toBe("Renamed");
    });

    it("resolveDataDir returns the registered path when present", () => {
        const fs = makeFs();
        mountFs(fs);
        const reg = new VaultRegistry("/r");
        reg.upsert(entry("a", { dataDir: "/custom/path" }));
        expect(reg.resolveDataDir("a")).toBe("/custom/path");
    });

    it("resolveDataDir falls back to <root>/vaults/<id> when unregistered", () => {
        mountFs(makeFs());
        expect(new VaultRegistry("/r").resolveDataDir("new-id")).toBe("/r/vaults/new-id");
    });
});

/* ------------------------------------------------------------------ */
/*  VaultRegistry: lock state machine                                  */
/* ------------------------------------------------------------------ */

function lock(overrides: Partial<ActiveLock> = {}): ActiveLock {
    return { vaultId: "a", pid: 4242, port: 5555, startedAt: 1, ...overrides };
}

describe("VaultRegistry.lockState", () => {
    beforeEach(() => vi.restoreAllMocks());

    it("NONE when no lock file exists", () => {
        mountFs(makeFs());
        expect(new VaultRegistry("/r").lockState("a")).toBe(LOCK_STATE.NONE);
    });

    it("OURS when lock matches our vault id and PID is alive", () => {
        const fs = makeFs();
        fs.write("/r/active.lock", JSON.stringify(lock({ vaultId: "a" })));
        mountFs(fs);
        vi.spyOn(node, "processKill").mockImplementation(() => true);
        expect(new VaultRegistry("/r").lockState("a")).toBe(LOCK_STATE.OURS);
    });

    it("LIVE_OTHER when lock belongs to a different vault with live PID", () => {
        const fs = makeFs();
        fs.write("/r/active.lock", JSON.stringify(lock({ vaultId: "other" })));
        mountFs(fs);
        vi.spyOn(node, "processKill").mockImplementation(() => true);
        expect(new VaultRegistry("/r").lockState("a")).toBe(LOCK_STATE.LIVE_OTHER);
    });

    it("STALE when the owning PID is no longer alive", () => {
        const fs = makeFs();
        fs.write("/r/active.lock", JSON.stringify(lock({ vaultId: "other" })));
        mountFs(fs);
        vi.spyOn(node, "processKill").mockImplementation(() => {
            throw new Error("ESRCH");
        });
        expect(new VaultRegistry("/r").lockState("a")).toBe(LOCK_STATE.STALE);
    });
});

describe("VaultRegistry write/release lock", () => {
    beforeEach(() => vi.restoreAllMocks());

    it("writeLock creates the lock file", () => {
        const fs = makeFs();
        mountFs(fs);
        new VaultRegistry("/r").writeLock(lock({ vaultId: "a", port: 7777 }));
        expect(JSON.parse(fs.read("/r/active.lock"))).toMatchObject({ vaultId: "a", port: 7777 });
    });

    it("writeLock creates the shared root directory if missing", () => {
        const fs = makeFs();
        mountFs(fs);
        new VaultRegistry("/r").writeLock(lock());
        expect(fs.dirs.has("/r")).toBe(true);
    });

    it("releaseLock removes the file when we own it", () => {
        const fs = makeFs();
        fs.write("/r/active.lock", JSON.stringify(lock({ vaultId: "a" })));
        mountFs(fs);
        new VaultRegistry("/r").releaseLock("a");
        expect(fs.exists("/r/active.lock")).toBe(false);
    });

    it("releaseLock leaves the file alone when another vault owns it", () => {
        const fs = makeFs();
        fs.write("/r/active.lock", JSON.stringify(lock({ vaultId: "other" })));
        mountFs(fs);
        new VaultRegistry("/r").releaseLock("a");
        expect(fs.exists("/r/active.lock")).toBe(true);
    });

    it("releaseLock is a no-op when no lock file exists", () => {
        mountFs(makeFs());
        expect(() => new VaultRegistry("/r").releaseLock("a")).not.toThrow();
    });

    it("releaseLock swallows unlink errors", () => {
        const fs = makeFs();
        fs.write("/r/active.lock", JSON.stringify(lock({ vaultId: "a" })));
        mountFs(fs);
        vi.spyOn(node, "unlinkSync").mockImplementation(() => {
            throw new Error("EACCES");
        });
        expect(() => new VaultRegistry("/r").releaseLock("a")).not.toThrow();
    });

    it("readLock returns null when missing and parses when present", () => {
        const fs = makeFs();
        mountFs(fs);
        const reg = new VaultRegistry("/r");
        expect(reg.readLock()).toBeNull();
        fs.write("/r/active.lock", JSON.stringify(lock({ pid: 99 })));
        expect(reg.readLock()?.pid).toBe(99);
    });
});
