// Real-process integration tests for orphan reaping. Unlike the unit tests,
// these spawn actual OS processes and exercise the real `ps` / `powershell` /
// `taskkill` / process-group code paths. Run on Linux, macOS, and Windows in CI
// via `npm run test:reap` (vitest.reap.config.ts).
import { afterEach, describe, expect, it } from "vitest";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import * as os from "node:os";
import * as path from "node:path";

import { killServerTree, reapOrphanServers } from "../src/server-manager";

const run = promisify(execFile);
const spawned: ChildProcess[] = [];

function isAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

async function waitDead(pid: number, timeoutMs = 10_000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (!isAlive(pid)) return true;
        await new Promise((r) => setTimeout(r, 100));
    }
    return !isAlive(pid);
}

function uniqueDataDir(): string {
    return path.join(os.tmpdir(), `lilbee-reap-it-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
}

/**
 * Spawn a long-lived process whose OS command line carries the
 * `lilbee serve --data-dir <dataDir>` marker so `reapOrphanServers(dataDir)`
 * matches it. Extra script runs after the marker args, which are inert argv.
 */
function spawnDecoy(dataDir: string, childScript = ""): ChildProcess {
    const script = `${childScript}setInterval(() => {}, 1 << 30);`;
    const child = spawn(process.execPath, ["-e", script, "lilbee", "serve", "--data-dir", dataDir], {
        detached: true,
        stdio: "ignore",
    });
    child.unref();
    spawned.push(child);
    return child;
}

/** Count live processes whose command line contains *marker* (cross-platform). */
async function countMatching(marker: string): Promise<number> {
    try {
        if (process.platform === "win32") {
            const { stdout } = await run("powershell", [
                "-NoProfile",
                "-Command",
                "Get-CimInstance Win32_Process | ForEach-Object { $_.CommandLine }",
            ]);
            return stdout.split("\n").filter((line) => line.includes(marker)).length;
        }
        const { stdout } = await run("ps", ["-A", "-ww", "-o", "command="]);
        return stdout.split("\n").filter((line) => line.includes(marker)).length;
    } catch {
        return 0;
    }
}

afterEach(() => {
    for (const child of spawned) {
        if (child.pid && isAlive(child.pid)) {
            try {
                process.kill(child.pid, "SIGKILL");
            } catch {
                // already gone
            }
        }
    }
    spawned.length = 0;
});

describe("orphan reaping against real processes", () => {
    it("reaps a lilbee serve process bound to the data dir", async () => {
        const dataDir = uniqueDataDir();
        const decoy = spawnDecoy(dataDir);
        expect(decoy.pid).toBeTruthy();
        await new Promise((r) => setTimeout(r, 400)); // let the OS register the command line

        const killed = await reapOrphanServers(dataDir);

        expect(killed).toContain(decoy.pid);
        expect(await waitDead(decoy.pid!)).toBe(true);
    }, 30_000);

    it("leaves a server bound to a different data dir untouched", async () => {
        const target = uniqueDataDir();
        const other = spawnDecoy(uniqueDataDir());
        await new Promise((r) => setTimeout(r, 400));

        const killed = await reapOrphanServers(target);

        expect(killed).not.toContain(other.pid);
        expect(isAlive(other.pid!)).toBe(true);
    }, 30_000);

    it("reaps the whole process tree, including worker children", async () => {
        const dataDir = uniqueDataDir();
        const childMarker = `lilbee-reap-worker-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
        // The parent matches the server pattern and spawns a child tagged with a
        // unique marker that does NOT match — so the child dies only as part of
        // the tree, proving worker reaping.
        const childScript =
            `require('child_process').spawn(process.execPath,` +
            `['-e','setInterval(()=>{},1<<30)','${childMarker}'],{stdio:'ignore'});`;
        const parent = spawnDecoy(dataDir, childScript);
        await new Promise((r) => setTimeout(r, 800)); // let the child spawn
        expect(await countMatching(childMarker)).toBeGreaterThan(0);

        await reapOrphanServers(dataDir);

        expect(await waitDead(parent.pid!)).toBe(true);
        // Poll for the child too: SIGKILL delivery to the tree is asynchronous.
        const start = Date.now();
        let remaining = await countMatching(childMarker);
        while (remaining > 0 && Date.now() - start < 10_000) {
            await new Promise((r) => setTimeout(r, 200));
            remaining = await countMatching(childMarker);
        }
        expect(remaining).toBe(0);
    }, 30_000);

    it("killServerTree terminates a running server by pid", async () => {
        const decoy = spawnDecoy(uniqueDataDir());
        await new Promise((r) => setTimeout(r, 300));

        await killServerTree(decoy.pid!);

        expect(await waitDead(decoy.pid!)).toBe(true);
    }, 30_000);
});
