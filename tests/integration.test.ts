import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, existsSync, statSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { ServerBinary } from "../src/server-binary";
import { ServerManager } from "../src/server-manager";

// CI passes a stable, version-keyed dir (LILBEE_TEST_BIN_DIR) so a cached
// binary is reused across runs; locally we download into a throwaway temp dir.
const providedBinDir = process.env.LILBEE_TEST_BIN_DIR;
const tempDir = providedBinDir ?? mkdtempSync(join(tmpdir(), "lilbee-integration-"));
const binDir = providedBinDir ?? join(tempDir, "bin");

afterAll(async () => {
    // A caller-provided bin dir is the CI cache: leave it for actions/cache to save.
    if (providedBinDir) return;
    // Windows can briefly hold a file lock on the just-stopped lilbee binary,
    // making rmdir bin/ throw ENOTEMPTY. Retry briefly, then give up; the CI
    // runner reclaims the temp dir on job exit either way.
    for (let attempt = 0; attempt < 5; attempt++) {
        try {
            rmSync(tempDir, { recursive: true, force: true });
            return;
        } catch {
            if (attempt < 4) await new Promise((r) => setTimeout(r, 200));
        }
    }
});

// The launcher sends GITHUB_TOKEN from process.env as a bearer, which lifts the API rate limit on CI.
describe("integration: binary download", () => {
    it("downloads the binary from GitHub releases", async () => {
        const result = await new ServerBinary(binDir).ensure({ includeDev: false });

        expect(existsSync(result.path)).toBe(true);
        expect(result.path.startsWith(join(binDir, result.release))).toBe(true);

        const size = statSync(result.path).size;
        expect(size).toBeGreaterThan(1_000_000);

        if (process.platform !== "win32") {
            const mode = statSync(result.path).mode;
            expect(mode & 0o111).toBeGreaterThan(0); // executable
        }
    }, 180_000);
});

describe("integration: server start", () => {
    it("starts the server and reaches ready state", async () => {
        const installed = new ServerBinary(binDir).installed();
        if (!installed) return; // skip if download failed

        const sm = new ServerManager({
            binaryPath: installed.path,
            dataDir: tempDir,
            sharedRoot: tempDir,
            modelsDir: `${tempDir}/models`,
            ragSystemPrompt: "",
            generalSystemPrompt: "",
            installedVersion: "",
        });

        try {
            await sm.start();
            expect(sm.state).toBe("ready");
        } finally {
            await sm.stop();
            expect(sm.state).toBe("stopped");
        }
    }, 180_000);
});
