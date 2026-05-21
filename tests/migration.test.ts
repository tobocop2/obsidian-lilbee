import { vi, describe, it, expect, beforeEach } from "vitest";
import { node } from "../src/binary-manager";
import { migrateIfNeeded, type MigrationContext } from "../src/migration";
import { MIGRATION_RESULT } from "../src/types";

/* ------------------------------------------------------------------ */
/*  In-memory filesystem with dev numbers for same/cross-fs simulation */
/* ------------------------------------------------------------------ */

function makeFs() {
    const files = new Map<string, { content: string; dev: number; size: number }>();
    const dirs = new Map<string, { dev: number; children: Set<string> }>();
    const setDir = (p: string, dev: number) => {
        if (!dirs.has(p)) dirs.set(p, { dev, children: new Set() });
    };
    return {
        files,
        dirs,
        setDir,
        addFile: (p: string, dev: number, content = "x") => {
            files.set(p, { content, dev, size: content.length });
            const parent = parentOf(p);
            setDir(parent, dev);
            dirs.get(parent)!.children.add(basenameOf(p));
        },
        addDir: (p: string, dev: number) => {
            setDir(p, dev);
            const parent = parentOf(p);
            if (parent !== p) {
                setDir(parent, dev);
                dirs.get(parent)!.children.add(basenameOf(p));
            }
        },
    };
}

function parentOf(p: string): string {
    const i = p.lastIndexOf("/");
    return i <= 0 ? "/" : p.slice(0, i);
}

function basenameOf(p: string): string {
    return p.slice(p.lastIndexOf("/") + 1);
}

function mountFs(fs: ReturnType<typeof makeFs>) {
    vi.spyOn(node, "existsSync").mockImplementation((p) => fs.files.has(p as string) || fs.dirs.has(p as string));
    vi.spyOn(node, "readdirSync").mockImplementation(
        (p) => Array.from(fs.dirs.get(p as string)?.children ?? []) as unknown as ReturnType<typeof node.readdirSync>,
    );
    vi.spyOn(node, "statSync").mockImplementation((p) => {
        const path = p as string;
        const f = fs.files.get(path);
        if (f) {
            return {
                dev: f.dev,
                size: f.size,
                isDirectory: () => false,
            } as unknown as ReturnType<typeof node.statSync>;
        }
        const d = fs.dirs.get(path);
        if (d) {
            return {
                dev: d.dev,
                size: 0,
                isDirectory: () => true,
            } as unknown as ReturnType<typeof node.statSync>;
        }
        throw new Error(`ENOENT stat: ${path}`);
    });
    vi.spyOn(node, "mkdirSync").mockImplementation((p) => {
        // Inherit dev from parent when creating new directories under shared root.
        const path = p as string;
        const parent = fs.dirs.get(parentOf(path));
        fs.setDir(path, parent?.dev ?? 1);
        return undefined;
    });
    vi.spyOn(node, "renameSync").mockImplementation((from, to) => {
        const src = from as string;
        const dst = to as string;
        const dir = fs.dirs.get(src);
        if (dir) {
            fs.dirs.set(dst, dir);
            fs.dirs.delete(src);
            return;
        }
        const f = fs.files.get(src);
        if (f) {
            fs.files.set(dst, f);
            fs.files.delete(src);
            return;
        }
        throw new Error(`ENOENT rename: ${src}`);
    });
    vi.spyOn(node, "cpSync").mockImplementation((from, to) => {
        const src = from as string;
        const dst = to as string;
        const dir = fs.dirs.get(src);
        if (dir) {
            fs.dirs.set(dst, { dev: dir.dev, children: new Set(dir.children) });
        }
    });
    vi.spyOn(node, "rmSync").mockImplementation((p) => {
        fs.dirs.delete(p as string);
        fs.files.delete(p as string);
    });
    vi.spyOn(node, "writeFileSync").mockImplementation((p, c) => {
        fs.addFile(p as string, fs.dirs.get(parentOf(p as string))?.dev ?? 1, String(c));
    });
    vi.spyOn(node, "readFileSync").mockImplementation((p) => {
        const f = fs.files.get(p as string);
        if (!f) throw new Error(`ENOENT read: ${p}`);
        return f.content;
    });
    vi.spyOn(node, "unlinkSync").mockImplementation((p) => {
        fs.files.delete(p as string);
    });
}

/* ------------------------------------------------------------------ */
/*  Fixtures                                                          */
/* ------------------------------------------------------------------ */

function baseCtx(overrides: Partial<MigrationContext> = {}): MigrationContext {
    return {
        pluginDir: "/vault/.obsidian/plugins/lilbee",
        sharedRoot: "/shared",
        vaultId: "abc123def456",
        displayName: "vault",
        obsidianVaultPath: "/vault",
        legacy: { lilbeeVersion: "v0.5.0", hfToken: "hf_x" },
        confirmCrossFs: () => Promise.resolve(true),
        ...overrides,
    };
}

beforeEach(() => vi.restoreAllMocks());

/* ------------------------------------------------------------------ */
/*  No-op paths                                                       */
/* ------------------------------------------------------------------ */

describe("migrateIfNeeded — skip conditions", () => {
    it("returns NONE when no legacy server-data exists", async () => {
        mountFs(makeFs());
        expect(await migrateIfNeeded(baseCtx())).toBe(MIGRATION_RESULT.NONE);
    });

    it("returns NONE when the registry already has this vault", async () => {
        const fs = makeFs();
        fs.addDir("/vault/.obsidian/plugins/lilbee/server-data", 1);
        fs.addFile(
            "/shared/registry.json",
            1,
            JSON.stringify([
                {
                    id: "abc123def456",
                    displayName: "vault",
                    dataDir: "/shared/vaults/abc123def456",
                    obsidianVaultPath: "/vault",
                    addedAt: 1,
                    lastActiveAt: 1,
                },
            ]),
        );
        mountFs(fs);
        expect(await migrateIfNeeded(baseCtx())).toBe(MIGRATION_RESULT.NONE);
    });

    it("returns NONE when the target data-dir already exists", async () => {
        const fs = makeFs();
        fs.addDir("/vault/.obsidian/plugins/lilbee/server-data", 1);
        fs.addDir("/shared/vaults/abc123def456", 1);
        mountFs(fs);
        expect(await migrateIfNeeded(baseCtx())).toBe(MIGRATION_RESULT.NONE);
    });
});

/* ------------------------------------------------------------------ */
/*  Same-filesystem rename                                            */
/* ------------------------------------------------------------------ */

describe("migrateIfNeeded — same filesystem", () => {
    it("renames server-data into shared vaults/<id>/", async () => {
        const fs = makeFs();
        fs.addDir("/vault/.obsidian/plugins/lilbee/server-data", 1);
        fs.addDir("/shared", 1);
        mountFs(fs);
        const result = await migrateIfNeeded(baseCtx());
        expect(result).toBe(MIGRATION_RESULT.MIGRATED);
        expect(fs.dirs.has("/shared/vaults/abc123def456")).toBe(true);
        expect(fs.dirs.has("/vault/.obsidian/plugins/lilbee/server-data")).toBe(false);
    });

    it("relocates the per-vault binary directory when present", async () => {
        const fs = makeFs();
        fs.addDir("/vault/.obsidian/plugins/lilbee/server-data", 1);
        fs.addDir("/vault/.obsidian/plugins/lilbee/bin", 1);
        fs.addDir("/shared", 1);
        mountFs(fs);
        await migrateIfNeeded(baseCtx());
        expect(fs.dirs.has("/shared/bin")).toBe(true);
        expect(fs.dirs.has("/vault/.obsidian/plugins/lilbee/bin")).toBe(false);
    });

    it("removes the per-vault binary when shared bin already exists", async () => {
        const fs = makeFs();
        fs.addDir("/vault/.obsidian/plugins/lilbee/server-data", 1);
        fs.addDir("/vault/.obsidian/plugins/lilbee/bin", 1);
        fs.addDir("/shared/bin", 1);
        fs.addDir("/shared", 1);
        mountFs(fs);
        await migrateIfNeeded(baseCtx());
        expect(fs.dirs.has("/vault/.obsidian/plugins/lilbee/bin")).toBe(false);
        expect(fs.dirs.has("/shared/bin")).toBe(true);
    });

    it("promotes lilbeeVersion + hfToken into shared config.json", async () => {
        const fs = makeFs();
        fs.addDir("/vault/.obsidian/plugins/lilbee/server-data", 1);
        fs.addDir("/shared", 1);
        mountFs(fs);
        await migrateIfNeeded(baseCtx());
        const cfg = JSON.parse(fs.files.get("/shared/config.json")!.content);
        expect(cfg).toEqual({ lilbeeVersion: "v0.5.0", hfToken: "hf_x" });
    });

    it("preserves shared config that was already set", async () => {
        const fs = makeFs();
        fs.addDir("/vault/.obsidian/plugins/lilbee/server-data", 1);
        fs.addFile("/shared/config.json", 1, JSON.stringify({ lilbeeVersion: "v0.6.0", hfToken: "shared_tok" }));
        fs.addDir("/shared", 1);
        mountFs(fs);
        await migrateIfNeeded(baseCtx());
        const cfg = JSON.parse(fs.files.get("/shared/config.json")!.content);
        expect(cfg).toEqual({ lilbeeVersion: "v0.6.0", hfToken: "shared_tok" });
    });

    it("handles missing legacy version/token fields", async () => {
        const fs = makeFs();
        fs.addDir("/vault/.obsidian/plugins/lilbee/server-data", 1);
        fs.addDir("/shared", 1);
        mountFs(fs);
        await migrateIfNeeded(baseCtx({ legacy: {} }));
        const cfg = JSON.parse(fs.files.get("/shared/config.json")!.content);
        expect(cfg).toEqual({ lilbeeVersion: "", hfToken: "" });
    });

    it("registers the vault in registry.json", async () => {
        const fs = makeFs();
        fs.addDir("/vault/.obsidian/plugins/lilbee/server-data", 1);
        fs.addDir("/shared", 1);
        mountFs(fs);
        await migrateIfNeeded(baseCtx());
        const registry = JSON.parse(fs.files.get("/shared/registry.json")!.content);
        expect(registry).toHaveLength(1);
        expect(registry[0].id).toBe("abc123def456");
        expect(registry[0].displayName).toBe("vault");
        expect(registry[0].dataDir).toBe("/shared/vaults/abc123def456");
    });
});

/* ------------------------------------------------------------------ */
/*  Cross-filesystem paths                                            */
/* ------------------------------------------------------------------ */

describe("migrateIfNeeded — cross filesystem", () => {
    it("asks for confirmation when source and shared root are on different devices", async () => {
        const fs = makeFs();
        fs.addDir("/vault/.obsidian/plugins/lilbee/server-data", 7);
        fs.addFile("/vault/.obsidian/plugins/lilbee/server-data/db.lance", 7, "x".repeat(100));
        fs.addDir("/shared", 1);
        mountFs(fs);
        const confirm = vi.fn().mockResolvedValue(true);
        await migrateIfNeeded(baseCtx({ confirmCrossFs: confirm }));
        expect(confirm).toHaveBeenCalledWith(100);
    });

    it("returns CROSS_FS_DECLINED when the user declines", async () => {
        const fs = makeFs();
        fs.addDir("/vault/.obsidian/plugins/lilbee/server-data", 7);
        fs.addDir("/shared", 1);
        mountFs(fs);
        const result = await migrateIfNeeded(baseCtx({ confirmCrossFs: () => Promise.resolve(false) }));
        expect(result).toBe(MIGRATION_RESULT.CROSS_FS_DECLINED);
        expect(fs.dirs.has("/shared/vaults/abc123def456")).toBe(false);
    });

    it("copies + removes when user confirms cross-fs migration", async () => {
        const fs = makeFs();
        fs.addDir("/vault/.obsidian/plugins/lilbee/server-data", 7);
        fs.addDir("/shared", 1);
        mountFs(fs);
        await migrateIfNeeded(baseCtx({ confirmCrossFs: () => Promise.resolve(true) }));
        expect(fs.dirs.has("/shared/vaults/abc123def456")).toBe(true);
        expect(fs.dirs.has("/vault/.obsidian/plugins/lilbee/server-data")).toBe(false);
    });

    it("uses cp+rm fallback when rename throws on the binary directory", async () => {
        const fs = makeFs();
        fs.addDir("/vault/.obsidian/plugins/lilbee/server-data", 1);
        fs.addDir("/vault/.obsidian/plugins/lilbee/bin", 7);
        fs.addDir("/shared", 1);
        mountFs(fs);
        const inMemoryRename = (from: string, to: string) => {
            const dir = fs.dirs.get(from);
            if (dir) {
                fs.dirs.set(to, dir);
                fs.dirs.delete(from);
            }
        };
        vi.spyOn(node, "renameSync").mockImplementation((from, to) => {
            if ((from as string).endsWith("/bin")) throw new Error("EXDEV");
            inMemoryRename(from as string, to as string);
        });
        await migrateIfNeeded(baseCtx());
        expect(fs.dirs.has("/shared/bin")).toBe(true);
        expect(fs.dirs.has("/vault/.obsidian/plugins/lilbee/bin")).toBe(false);
    });
});

/* ------------------------------------------------------------------ */
/*  Directory sizing                                                  */
/* ------------------------------------------------------------------ */

describe("directorySize via cross-fs confirm payload", () => {
    it("walks recursively summing file sizes", async () => {
        const fs = makeFs();
        fs.addDir("/vault/.obsidian/plugins/lilbee/server-data", 7);
        fs.addFile("/vault/.obsidian/plugins/lilbee/server-data/a.bin", 7, "x".repeat(50));
        fs.addDir("/vault/.obsidian/plugins/lilbee/server-data/sub", 7);
        fs.addFile("/vault/.obsidian/plugins/lilbee/server-data/sub/b.bin", 7, "x".repeat(70));
        fs.addDir("/shared", 1);
        mountFs(fs);
        const confirm = vi.fn().mockResolvedValue(true);
        await migrateIfNeeded(baseCtx({ confirmCrossFs: confirm }));
        expect(confirm).toHaveBeenCalledWith(120);
    });
});

/* ------------------------------------------------------------------ */
/*  Ancestor walk for fresh shared roots                              */
/* ------------------------------------------------------------------ */

describe("migrateIfNeeded — fresh shared root", () => {
    it("walks up to an existing ancestor when shared root is new", async () => {
        const fs = makeFs();
        fs.addDir("/vault/.obsidian/plugins/lilbee/server-data", 1);
        fs.addDir("/", 1);
        mountFs(fs);
        const result = await migrateIfNeeded(baseCtx({ sharedRoot: "/deep/new/path" }));
        expect(result).toBe(MIGRATION_RESULT.MIGRATED);
    });

    it("uses the dirname terminal when no ancestor exists at all", async () => {
        const fs = makeFs();
        fs.addDir("/vault/.obsidian/plugins/lilbee/server-data", 1);
        // No "/" entry — forces ensureExistingAncestor to hit `parent === current`.
        // statSync on "/" then needs to succeed; we install a final fallback dev.
        mountFs(fs);
        vi.spyOn(node, "statSync").mockImplementation((p) => {
            const path = p as string;
            const f = fs.files.get(path);
            if (f)
                return { dev: f.dev, size: f.size, isDirectory: () => false } as unknown as ReturnType<
                    typeof node.statSync
                >;
            const d = fs.dirs.get(path);
            if (d)
                return { dev: d.dev, size: 0, isDirectory: () => true } as unknown as ReturnType<typeof node.statSync>;
            if (path === "/")
                return { dev: 1, size: 0, isDirectory: () => true } as unknown as ReturnType<typeof node.statSync>;
            throw new Error(`ENOENT stat: ${path}`);
        });
        const result = await migrateIfNeeded(baseCtx({ sharedRoot: "/deep/new/path" }));
        expect(result).toBe(MIGRATION_RESULT.MIGRATED);
    });
});
