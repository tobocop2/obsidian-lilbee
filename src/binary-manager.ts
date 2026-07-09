import { requestUrl } from "obsidian";
import { execFile, spawn } from "child_process";
import {
    appendFileSync,
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
    appendFileSync,
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
    fetch: window.fetch.bind(window),
};

export const GITHUB_REPO = "tobocop2/lilbee";
export const LILBEE_GITHUB_REPO_URL = `https://github.com/${GITHUB_REPO}`;
const RELEASES_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
const RELEASE_LIST_API = `https://api.github.com/repos/${GITHUB_REPO}/releases`;

/** How many recent releases the version picker offers. */
export const RELEASE_HISTORY_LIMIT = 10;

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
    /** GitHub-computed "sha256:<hex>" of the uploaded asset, or null on older releases. */
    digest: string | null;
}

interface GitHubRelease {
    tag_name: string;
    assets: GitHubAsset[];
    draft?: boolean;
    prerelease?: boolean;
}

export interface ReleaseInfo {
    tag: string;
    assetUrl: string;
    variant: ServerVariant;
    sizeBytes: number;
    /** GitHub-reported "sha256:<hex>" of the asset, verified against the download bytes. */
    digest: string | null;
}

/** Choose the CUDA asset when detected and shipped; otherwise the default build. */
function selectAsset(
    data: GitHubRelease,
    cudaTag: CudaTag | null,
    warnOnFallback = true,
): { variant: ServerVariant; asset: GitHubAsset } {
    if (cudaTag) {
        const cudaAsset = data.assets.find((a) => a.name === getPlatformAssetName(cudaTag));
        if (cudaAsset) return { variant: cudaTag, asset: cudaAsset };
        if (warnOnFallback) {
            console.warn(
                `[lilbee] GPU detected (${cudaTag}) but ${data.tag_name} ships no matching build; using the default build instead.`,
            );
        }
    }
    const defaultName = getPlatformAssetName(null);
    const asset = data.assets.find((a) => a.name === defaultName);
    if (!asset) throw new Error(`No asset "${defaultName}" in release ${data.tag_name}`);
    return { variant: SERVER_VARIANT.DEFAULT, asset };
}

function toReleaseInfo(data: GitHubRelease, cudaTag: CudaTag | null, warnOnFallback = true): ReleaseInfo {
    const { variant, asset } = selectAsset(data, cudaTag, warnOnFallback);
    return {
        tag: data.tag_name,
        assetUrl: asset.browser_download_url,
        variant,
        sizeBytes: asset.size,
        digest: asset.digest,
    };
}

export async function getLatestRelease(): Promise<ReleaseInfo> {
    const res = await node.requestUrl({
        url: RELEASES_API,
        headers: { Accept: "application/vnd.github.v3+json" },
    });
    if (res.status >= 400) throw new Error(`GitHub API responded ${res.status}`);
    return toReleaseInfo(res.json as GitHubRelease, await detectCudaTag());
}

/**
 * Recent published releases, newest first, that ship a build for this machine.
 * Drafts, prereleases, and releases without a matching asset are left out.
 */
export async function listReleases(limit = RELEASE_HISTORY_LIMIT): Promise<ReleaseInfo[]> {
    const res = await node.requestUrl({
        url: `${RELEASE_LIST_API}?per_page=${limit}`,
        headers: { Accept: "application/vnd.github.v3+json" },
    });
    if (res.status >= 400) throw new Error(`GitHub API responded ${res.status}`);
    const cudaTag = await detectCudaTag();
    const releases: ReleaseInfo[] = [];
    for (const data of res.json as GitHubRelease[]) {
        if (data.draft || data.prerelease) continue;
        try {
            releases.push(toReleaseInfo(data, cudaTag, false));
        } catch {
            // Release ships no build for this platform; it isn't installable here.
        }
    }
    return releases;
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

    async ensureBinary(
        onProgress?: (msg: string, url?: string) => void,
        onQuarantineFailed?: () => void,
    ): Promise<string> {
        if (this.binaryExists()) return this.binaryPath;
        onProgress?.("Fetching latest release info...");
        const release = await getLatestRelease();
        await this.download(release.assetUrl, release.sizeBytes, release.digest, onProgress, onQuarantineFailed);
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

    /** Reject the download unless its SHA256 matches the digest GitHub reports for the asset. */
    private verifyDigest(data: Buffer, expectedDigest: string | null): void {
        const actual = `sha256:${node.createHash("sha256").update(data).digest("hex")}`;
        if (actual !== (expectedDigest ?? "").toLowerCase()) {
            throw new Error(
                "The downloaded lilbee server could not be verified against its checksum and was discarded. Please try again.",
            );
        }
    }

    async download(
        assetUrl: string,
        sizeBytes: number,
        expectedDigest: string | null,
        onProgress?: (msg: string, url?: string) => void,
        onQuarantineFailed?: () => void,
    ): Promise<void> {
        if (!node.existsSync(this.binDir)) {
            node.mkdirSync(this.binDir, { recursive: true });
        }
        await this.assertEnoughSpace(sizeBytes);

        onProgress?.("Downloading...", assetUrl);
        const res = await node.requestUrl({ url: assetUrl });
        if (res.status >= 400) throw new Error(`Download failed: ${res.status}`);

        const data = Buffer.from(res.arrayBuffer);
        this.verifyDigest(data, expectedDigest);

        const dest = this.binaryPath;
        try {
            node.writeFileSync(dest, data);
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
                // Couldn't clear quarantine, so Gatekeeper will likely block this unsigned
                // binary. Let the caller surface how to allow it; the download itself is fine.
                onQuarantineFailed?.();
            }
        }

        onProgress?.("Download complete.", assetUrl);
    }
}
