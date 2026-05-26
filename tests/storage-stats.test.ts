import { vi, describe, it, expect, beforeEach } from "vitest";
import { node } from "../src/binary-manager";
import { dirSizeBytes, formatBytes, reportForVault } from "../src/storage-stats";

function makeFs() {
    const files = new Map<string, number>(); // path → size
    const dirs = new Map<string, Set<string>>(); // path → child names
    return {
        files,
        dirs,
        addFile(p: string, bytes: number) {
            files.set(p, bytes);
            const parent = parentOf(p);
            const set = dirs.get(parent) ?? new Set<string>();
            set.add(basenameOf(p));
            dirs.set(parent, set);
        },
        addDir(p: string) {
            if (!dirs.has(p)) dirs.set(p, new Set());
            const parent = parentOf(p);
            if (parent !== p) {
                const set = dirs.get(parent) ?? new Set<string>();
                set.add(basenameOf(p));
                dirs.set(parent, set);
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
        (p) => Array.from(fs.dirs.get(p as string) ?? []) as unknown as ReturnType<typeof node.readdirSync>,
    );
    vi.spyOn(node, "statSync").mockImplementation((p) => {
        const path = p as string;
        const size = fs.files.get(path);
        if (size !== undefined) {
            return { isDirectory: () => false, size, dev: 1 } as unknown as ReturnType<typeof node.statSync>;
        }
        if (fs.dirs.has(path)) {
            return { isDirectory: () => true, size: 0, dev: 1 } as unknown as ReturnType<typeof node.statSync>;
        }
        throw new Error(`ENOENT stat: ${path}`);
    });
}

beforeEach(() => vi.restoreAllMocks());

describe("dirSizeBytes", () => {
    it("returns 0 for a path that does not exist", () => {
        mountFs(makeFs());
        expect(dirSizeBytes("/missing")).toBe(0);
    });

    it("sums file sizes recursively", () => {
        const fs = makeFs();
        fs.addDir("/root");
        fs.addFile("/root/a.txt", 100);
        fs.addDir("/root/sub");
        fs.addFile("/root/sub/b.txt", 250);
        fs.addFile("/root/sub/c.txt", 50);
        mountFs(fs);
        expect(dirSizeBytes("/root")).toBe(400);
    });

    it("returns 0 when readdir throws (permission denied etc.)", () => {
        const fs = makeFs();
        fs.addDir("/root");
        mountFs(fs);
        vi.spyOn(node, "readdirSync").mockImplementation(() => {
            throw new Error("EACCES");
        });
        expect(dirSizeBytes("/root")).toBe(0);
    });

    it("skips children whose stat throws", () => {
        const fs = makeFs();
        fs.addDir("/root");
        fs.addFile("/root/good.txt", 100);
        // Add a phantom name to the dir listing that doesn't exist as a real path.
        fs.dirs.get("/root")!.add("ghost.txt");
        mountFs(fs);
        expect(dirSizeBytes("/root")).toBe(100);
    });
});

describe("formatBytes", () => {
    it("renders 0 explicitly", () => {
        expect(formatBytes(0)).toBe("0 B");
    });

    it("renders bytes below a kilobyte", () => {
        expect(formatBytes(500)).toBe("500 B");
    });

    it("renders kilobytes", () => {
        expect(formatBytes(2_500)).toBe("2.50 KB");
    });

    it("renders megabytes", () => {
        expect(formatBytes(12_500_000)).toBe("12.5 MB");
    });

    it("renders gigabytes", () => {
        expect(formatBytes(2_500_000_000)).toBe("2.50 GB");
    });

    it("drops decimals once values exceed 100", () => {
        expect(formatBytes(123_000_000)).toBe("123 MB");
    });
});

describe("reportForVault", () => {
    it("returns zeros for an empty shared root", () => {
        mountFs(makeFs());
        const report = reportForVault("/shared", "/shared/vaults/a");
        expect(report).toEqual({
            sharedRoot: "/shared",
            binBytes: 0,
            modelsBytes: 0,
            vaultBytes: 0,
            vaultDataDir: "/shared/vaults/a",
            totalBytes: 0,
        });
    });

    it("aggregates bin, models, and the open vault's size only", () => {
        const fs = makeFs();
        fs.addDir("/shared/bin");
        fs.addFile("/shared/bin/lilbee", 1_000_000);
        fs.addDir("/shared/models");
        fs.addFile("/shared/models/embed.gguf", 500_000_000);
        fs.addDir("/shared/vaults/a");
        fs.addFile("/shared/vaults/a/db.lance", 200_000);
        // Another vault on disk must not be counted — only the open one.
        fs.addDir("/shared/vaults/b");
        fs.addFile("/shared/vaults/b/db.lance", 300_000);
        mountFs(fs);
        const report = reportForVault("/shared", "/shared/vaults/a");
        expect(report.binBytes).toBe(1_000_000);
        expect(report.modelsBytes).toBe(500_000_000);
        expect(report.vaultBytes).toBe(200_000);
        expect(report.totalBytes).toBe(501_200_000);
    });
});
