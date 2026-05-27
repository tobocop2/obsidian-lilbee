import { requestUrl } from "obsidian";
import { execFile, spawn } from "child_process";
import {
    existsSync,
    mkdirSync,
    chmodSync,
    writeFileSync,
    readFileSync,
    unlinkSync,
    copyFileSync,
    cpSync,
    statSync,
    statfs,
    renameSync,
    readdirSync,
    rmSync,
} from "fs";
import { basename, join, resolve, dirname } from "path";
import { createHash } from "crypto";
import { promisify } from "util";
import { ARCH, PLATFORM, SERVER_VARIANT, type CudaTag, type ServerVariant } from "./types";

const execFileAsync = promisify(execFile);
const statfsAsync = promisify(statfs);

/** Exported for test mocking. */
export const node = {
    spawn,
    execFile: execFileAsync,
    existsSync,
    mkdirSync,
    chmodSync,
    writeFileSync,
    readFileSync,
    unlinkSync,
    copyFileSync,
    cpSync,
    statSync,
    statfs: statfsAsync,
    renameSync,
    readdirSync,
    rmSync,
    join,
    basename,
    resolve,
    dirname,
    createHash,
    processKill: process.kill.bind(process),
    requestUrl,
    fetch: globalThis.fetch.bind(globalThis) as typeof globalThis.fetch,
};

const GITHUB_REPO = "tobocop2/lilbee";
const RELEASES_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

/** Run `nvidia-smi` and return its stdout, or null if it is absent or fails. */
async function runNvidiaSmi(): Promise<string | null> {
    try {
        const { stdout } = await node.execFile("nvidia-smi", []);
        return stdout;
    } catch {
        return null;
    }
}

/** Parse the driver's max CUDA version from `nvidia-smi` output as major*100+minor (12.5 -> 1205). */
function parseCudaCeiling(stdout: string): number | null {
    const match = stdout.match(/CUDA Version:\s*(\d+)\.(\d+)/);
    if (!match) return null;
    return Number(match[1]) * 100 + Number(match[2]);
}

/** Pick the newest CUDA build the driver supports, or null when it supports none we ship. */
function pickCudaTag(ceiling: number): CudaTag | null {
    if (ceiling >= 1205) return SERVER_VARIANT.CU125;
    if (ceiling >= 1204) return SERVER_VARIANT.CU124;
    if (ceiling >= 1201) return SERVER_VARIANT.CU121;
    return null;
}

/**
 * Detect the best CUDA build for this machine, or null to use the default build.
 * Returns null on macOS, when no NVIDIA driver is present, or on any detection failure.
 */
export async function detectCudaTag(): Promise<CudaTag | null> {
    if (process.platform === PLATFORM.DARWIN) return null;
    const stdout = await runNvidiaSmi();
    if (stdout === null) return null;
    const ceiling = parseCudaCeiling(stdout);
    if (ceiling === null) return null;
    return pickCudaTag(ceiling);
}

export function getPlatformAssetName(cudaTag?: CudaTag | null): string {
    const platform = process.platform;
    const arch = process.arch;
    const cuda = cudaTag ? `-${cudaTag}` : "";
    if (platform === PLATFORM.DARWIN && arch === ARCH.ARM64) return "lilbee-macos-arm64";
    if (platform === PLATFORM.LINUX && arch === ARCH.X64) return `lilbee-linux-x86_64${cuda}`;
    if (platform === PLATFORM.WIN32 && arch === ARCH.X64) return `lilbee-windows-x86_64${cuda}.exe`;
    throw new Error(`Unsupported platform: ${platform}/${arch}`);
}

interface GitHubAsset {
    name: string;
    browser_download_url: string;
    size: number;
}

interface GitHubRelease {
    tag_name: string;
    assets: GitHubAsset[];
}

export interface ReleaseInfo {
    tag: string;
    assetUrl: string;
    variant: ServerVariant;
    sizeBytes: number;
}

/** Choose the CUDA asset when detected and shipped; otherwise the default build. */
function selectAsset(data: GitHubRelease, cudaTag: CudaTag | null): { variant: ServerVariant; asset: GitHubAsset } {
    if (cudaTag) {
        const cudaAsset = data.assets.find((a) => a.name === getPlatformAssetName(cudaTag));
        if (cudaAsset) return { variant: cudaTag, asset: cudaAsset };
        console.warn(
            `[lilbee] GPU detected (${cudaTag}) but ${data.tag_name} ships no matching build; using the default build instead.`,
        );
    }
    const defaultName = getPlatformAssetName(null);
    const asset = data.assets.find((a) => a.name === defaultName);
    if (!asset) throw new Error(`No asset "${defaultName}" in release ${data.tag_name}`);
    return { variant: SERVER_VARIANT.DEFAULT, asset };
}

export async function getLatestRelease(): Promise<ReleaseInfo> {
    const res = await node.requestUrl({
        url: RELEASES_API,
        headers: { Accept: "application/vnd.github.v3+json" },
    });
    if (res.status >= 400) throw new Error(`GitHub API responded ${res.status}`);
    const data = res.json as GitHubRelease;
    const { variant, asset } = selectAsset(data, await detectCudaTag());
    return { tag: data.tag_name, assetUrl: asset.browser_download_url, variant, sizeBytes: asset.size };
}

export function checkForUpdate(currentVersion: string, latestTag: string): boolean {
    return currentVersion !== latestTag && latestTag !== "";
}

/** Headroom over the asset size: the whole file is buffered in memory before the write. */
const DISK_SPACE_FACTOR = 1.5;

function formatBytes(bytes: number): string {
    const gb = bytes / 1024 ** 3;
    if (gb >= 1) return `${gb.toFixed(1)} GB`;
    return `${Math.round(bytes / 1024 ** 2)} MB`;
}

export class BinaryManager {
    constructor(private binDir: string) {}

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
        await this.download(release.assetUrl, release.sizeBytes, onProgress);
        return this.binaryPath;
    }

    /** Throw a user-facing error if the target filesystem can't hold the download. */
    private async assertEnoughSpace(sizeBytes: number): Promise<void> {
        const required = Math.ceil(sizeBytes * DISK_SPACE_FACTOR);
        const stats = await node.statfs(this.binDir);
        const free = stats.bavail * stats.bsize;
        if (free < required) {
            throw new Error(
                `Not enough disk space for the lilbee server: need about ${formatBytes(required)} free, ` +
                    `but only ${formatBytes(free)} is available. Free up some space and try again.`,
            );
        }
    }

    async download(
        assetUrl: string,
        sizeBytes: number,
        onProgress?: (msg: string, url?: string) => void,
    ): Promise<void> {
        if (!node.existsSync(this.binDir)) {
            node.mkdirSync(this.binDir, { recursive: true });
        }
        await this.assertEnoughSpace(sizeBytes);

        onProgress?.("Downloading...", assetUrl);
        const res = await node.requestUrl({ url: assetUrl });
        if (res.status >= 400) throw new Error(`Download failed: ${res.status}`);

        const dest = this.binaryPath;
        try {
            node.writeFileSync(dest, Buffer.from(res.arrayBuffer));
            if (process.platform !== PLATFORM.WIN32) {
                node.chmodSync(dest, 0o755);
            }
        } catch (err) {
            // Leave no half-written binary behind; binaryExists() would treat it as good.
            if (node.existsSync(dest)) node.unlinkSync(dest);
            throw err;
        }

        if (process.platform === PLATFORM.DARWIN) {
            try {
                await node.execFile("xattr", ["-cr", dest]);
            } catch {
                // xattr failure is non-fatal; the user may need to allow it in System Settings.
            }
        }

        onProgress?.("Download complete.", assetUrl);
    }
}
