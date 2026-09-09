import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

const { rmSync, existsSync, readdirSync, statSync, execFile, installed } = vi.hoisted(() => ({
    rmSync: vi.fn(),
    existsSync: vi.fn(),
    readdirSync: vi.fn(),
    statSync: vi.fn(),
    execFile: vi.fn(),
    installed: vi.fn(),
}));

vi.mock("../src/node", () => ({
    node: {
        rmSync,
        existsSync,
        readdirSync,
        statSync,
        execFile,
        join: (...parts: string[]) => parts.join("/"),
        homedir: () => "/home/u",
    },
}));

vi.mock("../src/server-binary", () => ({
    ServerBinary: vi.fn().mockImplementation(function () {
        return { installed };
    }),
}));

import { ServerBinary } from "../src/server-binary";
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

function stubPlatform(platform: string): () => void {
    const original = Object.getOwnPropertyDescriptor(process, "platform")!;
    Object.defineProperty(process, "platform", { value: platform, configurable: true });
    return () => Object.defineProperty(process, "platform", original);
}

let restorePlatform: () => void = () => {};

beforeEach(() => {
    vi.clearAllMocks();
    restorePlatform = stubPlatform("linux");
    installed.mockReturnValue({ path: "/root/bin/v0.6.90/lilbee" });
    execFile.mockResolvedValue({ stdout: "", stderr: "" });
    rmSync.mockImplementation(() => {});
});

afterEach(() => {
    restorePlatform();
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
            { kind: UNINSTALL_TARGET.CACHE, path: "/home/u/.cache/lilbee", bytes: 0 },
        ]);
        expect(plan.totalBytes).toBe(1500);
    });

    it.each([
        ["linux", "/home/u/.cache/lilbee"],
        ["darwin", "/home/u/Library/Caches/lilbee"],
    ])("targets the server's unpack cache on %s", (platform, cachePath) => {
        restorePlatform();
        restorePlatform = stubPlatform(platform);
        mountFiles({ [`${cachePath}/0.6.90/lilbee.bin`]: 300 });

        const plan = planUninstall("/root", "/root/vaults/abc");

        expect(plan.targets).toContainEqual({ kind: UNINSTALL_TARGET.CACHE, path: cachePath, bytes: 300 });
    });

    it("targets only the unpack directories beside bin and models on Windows", () => {
        restorePlatform();
        restorePlatform = stubPlatform("win32");
        mountFiles({
            "/root/bin/lilbee.exe": 400,
            "/root/0.6.90.432-windows-x86_64/.lilbee-bootstrap-manifest": 1,
            "/root/0.6.90.432-windows-x86_64/lilbee.dll": 500,
            "/root/models/a.gguf": 10,
        });

        const plan = planUninstall("/root", "/root/vaults/abc");

        const cache = plan.targets.filter((t) => t.kind === UNINSTALL_TARGET.CACHE);
        expect(cache).toEqual([{ kind: UNINSTALL_TARGET.CACHE, path: "/root/0.6.90.432-windows-x86_64", bytes: 501 }]);
    });

    it("plans no unpack directory when the shared root is missing on Windows", () => {
        restorePlatform();
        restorePlatform = stubPlatform("win32");
        mountFiles({});

        expect(planUninstall("/root", "/root/vaults/abc").targets.map((t) => t.kind)).not.toContain(
            UNINSTALL_TARGET.CACHE,
        );
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
    const DELETED = ["/root/bin", "/root/models", "/root/vaults/abc", "/home/u/.cache/lilbee"];

    it("removes every planned path recursively and tolerates missing ones", async () => {
        mountFiles({});
        const plan = planUninstall("/root", "/root/vaults/abc");

        await executeUninstall(plan, "/root", "/root/vaults/abc");

        expect(rmSync.mock.calls).toEqual([
            ["/root/bin", { recursive: true, force: true }],
            ["/root/models", { recursive: true, force: true }],
            ["/root/vaults/abc", { recursive: true, force: true }],
            ["/home/u/.cache/lilbee", { recursive: true, force: true }],
        ]);
    });

    it("stops the shared engine and waits for it before deleting anything", async () => {
        mountFiles({});
        const order: string[] = [];
        let finishStop!: () => void;
        execFile.mockImplementation(() => {
            order.push("engine stop");
            return new Promise((resolve) => {
                finishStop = () => resolve({ stdout: "", stderr: "" });
            });
        });
        rmSync.mockImplementation((path: string) => {
            order.push(`rm ${path}`);
        });
        const plan = planUninstall("/root", "/root/vaults/abc");

        const uninstall = executeUninstall(plan, "/root", "/root/vaults/abc");
        await Promise.resolve();

        // The engine holds the model files open, so nothing may be deleted while it runs.
        expect(order).toEqual(["engine stop"]);

        finishStop();
        await uninstall;

        expect(order).toEqual(["engine stop", ...DELETED.map((path) => `rm ${path}`)]);
    });

    it("asks the installed binary to stop the machine engine and this vault's own", async () => {
        mountFiles({});

        await executeUninstall(planUninstall("/root", "/root/vaults/abc"), "/root", "/root/vaults/abc");

        expect(ServerBinary).toHaveBeenCalledWith("/root/bin");
        expect(execFile).toHaveBeenCalledWith(
            "/root/bin/v0.6.90/lilbee",
            ["--data-dir", "/root/vaults/abc", "engine", "stop"],
            { timeout: 15_000 },
        );
    });

    it("deletes anyway when an older binary refuses the command", async () => {
        mountFiles({});
        execFile.mockRejectedValue(Object.assign(new Error("No such command 'engine'."), { code: 2 }));

        await executeUninstall(planUninstall("/root", "/root/vaults/abc"), "/root", "/root/vaults/abc");

        expect(rmSync.mock.calls.map(([path]) => path)).toEqual(DELETED);
    });

    it("deletes anyway when the stop hangs past its bound", async () => {
        mountFiles({});
        execFile.mockRejectedValue(Object.assign(new Error("Command failed"), { killed: true, signal: "SIGTERM" }));

        await executeUninstall(planUninstall("/root", "/root/vaults/abc"), "/root", "/root/vaults/abc");

        expect(rmSync.mock.calls.map(([path]) => path)).toEqual(DELETED);
    });

    it("runs nothing when no binary is installed", async () => {
        mountFiles({});
        installed.mockReturnValue(null);

        await executeUninstall(planUninstall("/root", "/root/vaults/abc"), "/root", "/root/vaults/abc");

        expect(execFile).not.toHaveBeenCalled();
        expect(rmSync.mock.calls.map(([path]) => path)).toEqual(DELETED);
    });
});
