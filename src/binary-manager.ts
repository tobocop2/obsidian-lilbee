import { requestUrl } from "obsidian";
import { execFile, spawn } from "child_process";
import { existsSync, mkdirSync, chmodSync, writeFileSync } from "fs";
import { join } from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/** Exported for test mocking. */
export const node = { spawn, execFile: execFileAsync, existsSync, mkdirSync, chmodSync, writeFileSync, requestUrl, fetch: globalThis.fetch.bind(globalThis) };

const GITHUB_REPO = "tobocop2/lilbee";
const RELEASES_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

export function getPlatformAssetName(): string {
    const platform = process.platform;
    const arch = process.arch;
    if (platform === "darwin" && arch === "arm64") return "lilbee-macos-arm64";
    if (platform === "darwin" && arch === "x64") return "lilbee-macos-x86_64";
    if (platform === "linux" && arch === "x64") return "lilbee-linux-x86_64";
    if (platform === "win32" && arch === "x64") return "lilbee-windows-x86_64.exe";
    throw new Error(`Unsupported platform: ${platform}/${arch}`);
}

interface GitHubAsset {
    name: string;
    browser_download_url: string;
}

interface GitHubRelease {
    tag_name: string;
    assets: GitHubAsset[];
}

export interface ReleaseInfo {
    tag: string;
    assetUrl: string;
}

export async function getLatestRelease(): Promise<ReleaseInfo> {
    const res = await node.requestUrl({
        url: RELEASES_API,
        headers: { Accept: "application/vnd.github.v3+json" },
    });
    if (res.status >= 400) throw new Error(`GitHub API responded ${res.status}`);
    const data = res.json as GitHubRelease;
    const assetName = getPlatformAssetName();
    const asset = data.assets.find((a) => a.name === assetName);
    if (!asset) throw new Error(`No asset "${assetName}" in release ${data.tag_name}`);
    return { tag: data.tag_name, assetUrl: asset.browser_download_url };
}

export function checkForUpdate(currentVersion: string, latestTag: string): boolean {
    return currentVersion !== latestTag && latestTag !== "";
}

export class BinaryManager {
    private binDir: string;

    constructor(pluginDir: string) {
        this.binDir = join(pluginDir, "bin");
    }

    get binaryPath(): string {
        const name = process.platform === "win32" ? "lilbee.exe" : "lilbee";
        return join(this.binDir, name);
    }

    binaryExists(): boolean {
        return node.existsSync(this.binaryPath);
    }

    async ensureBinary(onProgress?: (msg: string) => void): Promise<string> {
        if (this.binaryExists()) return this.binaryPath;
        onProgress?.("Fetching latest release info...");
        const release = await getLatestRelease();
        await this.download(release.assetUrl, onProgress);
        return this.binaryPath;
    }

    async download(assetUrl: string, onProgress?: (msg: string) => void): Promise<void> {
        if (!node.existsSync(this.binDir)) {
            node.mkdirSync(this.binDir, { recursive: true });
        }

        onProgress?.("Downloading lilbee binary...");
        const res = await node.requestUrl({ url: assetUrl });
        if (res.status >= 400) throw new Error(`Download failed: ${res.status}`);

        const dest = this.binaryPath;
        node.writeFileSync(dest, Buffer.from(res.arrayBuffer));

        if (process.platform !== "win32") {
            node.chmodSync(dest, 0o755);
        }

        if (process.platform === "darwin") {
            try {
                await node.execFile("xattr", ["-cr", dest]);
            } catch {
                // xattr failure is non-fatal — user may need to allow in System Preferences
            }
        }

        onProgress?.("Download complete.");
    }
}
