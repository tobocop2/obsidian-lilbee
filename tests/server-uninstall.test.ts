import { vi, describe, it, expect, beforeEach } from "vitest";

const { rmSync, existsSync, readdirSync, statSync } = vi.hoisted(() => ({
    rmSync: vi.fn(),
    existsSync: vi.fn(),
    readdirSync: vi.fn(),
    statSync: vi.fn(),
}));

vi.mock("../src/binary-manager", () => ({
    node: {
        rmSync,
        existsSync,
        readdirSync,
        statSync,
        join: (...parts: string[]) => parts.join("/"),
    },
}));

import { executeUninstall, planUninstall } from "../src/server-uninstall";
import { UNINSTALL_TARGET } from "../src/types";

/** Mount a flat {path: sizeBytes} filesystem of files, plus the dirs holding them. */
function mountFiles(files: Record<string, number>): void {
    const dirs = new Set<string>();
    for (const path of Object.keys(files)) {
        const parts = path.split("/");
        for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
    }
    existsSync.mockImplementation((p: string) => dirs.has(p) || p in files);
    readdirSync.mockImplementation((p: string) => {
        const names = new Set<string>();
        for (const path of [...Object.keys(files), ...dirs]) {
            if (path.startsWith(`${p}/`)) names.add(path.slice(p.length + 1).split("/")[0]);
        }
        return [...names];
    });
    statSync.mockImplementation((p: string) => ({
        isDirectory: () => dirs.has(p),
        size: files[p] ?? 0,
    }));
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe("planUninstall", () => {
    it("sizes the binary, the models, and this vault's index", () => {
        mountFiles({
            "/root/bin/lilbee": 400,
            "/root/models/a.gguf": 1000,
            "/root/models/nested/b.gguf": 24,
            "/root/vaults/abc/index.db": 76,
        });

        const plan = planUninstall("/root", "/root/vaults/abc");

        expect(plan.targets).toEqual([
            { kind: UNINSTALL_TARGET.BINARY, path: "/root/bin", bytes: 400 },
            { kind: UNINSTALL_TARGET.MODELS, path: "/root/models", bytes: 1024 },
            { kind: UNINSTALL_TARGET.INDEX, path: "/root/vaults/abc", bytes: 76 },
        ]);
        expect(plan.totalBytes).toBe(1500);
    });

    it("sizes a missing path as zero rather than failing", () => {
        mountFiles({});

        const plan = planUninstall("/root", "/root/vaults/abc");

        expect(plan.totalBytes).toBe(0);
    });

    it("never targets the Obsidian vault itself", () => {
        mountFiles({ "/root/bin/lilbee": 1 });

        const plan = planUninstall("/root", "/root/vaults/abc");

        expect(plan.targets.map((t) => t.path)).not.toContain("/vault");
    });
});

describe("executeUninstall", () => {
    it("removes every planned path recursively and tolerates missing ones", () => {
        mountFiles({});
        const plan = planUninstall("/root", "/root/vaults/abc");

        executeUninstall(plan);

        expect(rmSync.mock.calls).toEqual([
            ["/root/bin", { recursive: true, force: true }],
            ["/root/models", { recursive: true, force: true }],
            ["/root/vaults/abc", { recursive: true, force: true }],
        ]);
    });
});
