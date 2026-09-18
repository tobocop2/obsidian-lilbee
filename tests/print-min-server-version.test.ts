import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MIN_SERVER_VERSION } from "../src/min-server-version";

const execFileAsync = promisify(execFile);
const SCRIPT_PATH = fileURLToPath(new URL("../scripts/print-min-server-version.mjs", import.meta.url));

// Run as a real subprocess: the script loads the actual "esbuild" package, and this
// suite's own setup stubs process.platform to "linux" for platform-branch tests,
// which would make esbuild look for a Linux binary if invoked in-process.
async function run(path?: string): Promise<{ stdout: string; stderr: string; code: number }> {
    const args = path ? [SCRIPT_PATH, path] : [SCRIPT_PATH];
    try {
        const { stdout, stderr } = await execFileAsync(process.execPath, args);
        return { stdout: stdout.trim(), stderr, code: 0 };
    } catch (err) {
        const e = err as { stdout?: string; stderr?: string; code?: number };
        return { stdout: (e.stdout ?? "").trim(), stderr: e.stderr ?? "", code: e.code ?? 1 };
    }
}

async function withFixture(source: string, fn: (path: string) => Promise<void>): Promise<void> {
    const dir = await mkdtemp(join(tmpdir(), "min-server-version-"));
    const path = join(dir, "fixture.ts");
    await writeFile(path, source, "utf8");
    try {
        await fn(path);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
}

describe("print-min-server-version", () => {
    it("prints the plugin's real floor, read from source, not a GitHub release lookup", async () => {
        const result = await run();
        expect(result.code).toBe(0);
        expect(result.stdout).toBe(MIN_SERVER_VERSION);
    });

    it("fails loudly instead of falling back when MIN_SERVER_VERSION is missing", async () => {
        await withFixture('export const NOT_IT = "0.9.9";', async (path) => {
            const result = await run(path);
            expect(result.code).not.toBe(0);
            expect(result.stdout).toBe("");
            expect(result.stderr).toContain("MIN_SERVER_VERSION did not resolve to a non-empty string");
        });
    });

    it("fails loudly when MIN_SERVER_VERSION is not a string", async () => {
        await withFixture("export const MIN_SERVER_VERSION = 420;", async (path) => {
            const result = await run(path);
            expect(result.code).not.toBe(0);
            expect(result.stderr).toContain("MIN_SERVER_VERSION did not resolve to a non-empty string");
        });
    });

    it("fails loudly when the source imports something, instead of silently resolving it", async () => {
        await withFixture(
            'import { hostname } from "node:os"; export const MIN_SERVER_VERSION = hostname();',
            async (path) => {
                const result = await run(path);
                expect(result.code).not.toBe(0);
                expect(result.stderr).toContain("min-server-version.ts must not import anything");
            },
        );
    });
});
