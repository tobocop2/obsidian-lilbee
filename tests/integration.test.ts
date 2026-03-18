import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, existsSync, statSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { node, BinaryManager } from "../src/binary-manager";
import { ServerManager } from "../src/server-manager";

const tempDir = mkdtempSync(join(tmpdir(), "lilbee-integration-"));

afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
});

// Auth header avoids GitHub API rate limits (60/hr unauthenticated vs 5000/hr)
const authHeaders: Record<string, string> = process.env.GITHUB_TOKEN
    ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
    : {};

// Polyfill node.requestUrl with native fetch (Obsidian API is not available in Node)
async function requestUrlPolyfill(req: { url: string; headers?: Record<string, string> }) {
    const res = await fetch(req.url, { headers: { ...authHeaders, ...req.headers }, redirect: "follow" });
    const arrayBuffer = await res.arrayBuffer();
    let json: unknown = {};
    try { json = JSON.parse(new TextDecoder().decode(arrayBuffer)); } catch {}
    return { status: res.status, json, arrayBuffer, headers: Object.fromEntries(res.headers) };
}

node.requestUrl = requestUrlPolyfill as typeof node.requestUrl;

describe("integration: binary download", () => {
    let bm: BinaryManager;

    it("downloads the binary from GitHub releases", async () => {
        bm = new BinaryManager(tempDir);
        const path = await bm.ensureBinary();

        expect(existsSync(path)).toBe(true);

        const size = statSync(path).size;
        expect(size).toBeGreaterThan(1_000_000);

        if (process.platform !== "win32") {
            const mode = statSync(path).mode;
            expect(mode & 0o111).toBeGreaterThan(0); // executable
        }
    }, 180_000);
});

describe("integration: server start", () => {
    it("starts the server and reaches ready state", async () => {
        const bm = new BinaryManager(tempDir);
        if (!bm.binaryExists()) return; // skip if download failed

        const sm = new ServerManager({
            binaryPath: bm.binaryPath,
            dataDir: tempDir,
            port: null,
            ollamaUrl: "http://127.0.0.1:11434",
            systemPrompt: "",
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
