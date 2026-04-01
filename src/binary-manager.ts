import { requestUrl } from "obsidian";
import { execFile, spawn } from "child_process";
import { existsSync, mkdirSync, chmodSync, writeFileSync, readFileSync, unlinkSync } from "fs";
import { join } from "path";
import { promisify } from "util";
import { ARCH, PLATFORM } from "./types";

const execFileAsync = promisify(execFile);

/** Exported for test mocking. */
export const node = { spawn, execFile: execFileAsync, existsSync, mkdirSync, chmodSync, writeFileSync, readFileSync, unlinkSync, requestUrl, fetch: globalThis.fetch.bind(globalThis) as typeof globalThis.fetch };

const GITHUB_REPO = "tobocop2/lilbee";
const RELEASES_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

export function getPlatformAssetName(): string {
    const platform = process.platform;
    const arch = process.arch;
    if (platform === PLATFORM.DARWIN && arch === ARCH.ARM64) return "lilbee-macos-arm64";
    if (platform === PLATFORM.DARWIN && arch === ARCH.X64) return "lilbee-macos-x86_64";
    if (platform === PLATFORM.LINUX && arch === ARCH.X64) return "lilbee-linux-x86_64";
    if (platform === PLATFORM.WIN32 && arch === ARCH.X64) return "lilbee-windows-x86_64.exe";
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
        const name = process.platform === PLATFORM.WIN32 ? "lilbee.exe" : "lilbee";
        return join(this.binDir, name);
    }

    binaryExists(): boolean {
        return node.existsSync(this.binaryPath);
    }

    async ensureBinary(onProgress?: (msg: string, url?: string) => void): Promise<string> {
        if (this.binaryExists()) return this.binaryPath;
        onProgress?.("Fetching latest release info...");
        const release = await getLatestRelease();
        await this.download(release.assetUrl, onProgress);
        return this.binaryPath;
    }

    async download(assetUrl: string, onProgress?: (msg: string, url?: string) => void): Promise<void> {
        if (!node.existsSync(this.binDir)) {
            node.mkdirSync(this.binDir, { recursive: true });
        }

        onProgress?.("Downloading...", assetUrl);
        const res = await node.requestUrl({ url: assetUrl });
        if (res.status >= 400) throw new Error(`Download failed: ${res.status}`);

        const dest = this.binaryPath;
        node.writeFileSync(dest, Buffer.from(res.arrayBuffer));

        if (process.platform !== PLATFORM.WIN32) {
            node.chmodSync(dest, 0o755);
        }

        if (process.platform === PLATFORM.DARWIN) {
            try {
                await node.execFile("xattr", ["-cr", dest]);
            } catch {
                // xattr failure is non-fatal — user may need to allow in System Preferences
            }
        }

        onProgress?.("Download complete.", assetUrl);
    }
}
