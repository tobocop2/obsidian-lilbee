import { requestUrl } from "obsidian";
import { execFile, spawn } from "child_process";
import { get as httpsGet } from "https";
import type { ClientRequest, IncomingMessage } from "http";
import {
    appendFileSync,
    createWriteStream,
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
import { formatDiskSize } from "./utils";

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
    createWriteStream,
    join,
    basename,
    resolve,
    dirname,
    createHash,
    processKill: process.kill.bind(process),
    requestUrl,
    // Node's https, not the renderer's fetch: GitHub's asset redirect fails CORS
    // in the renderer, which is why requestUrl was adopted for it originally.
    // Unlike requestUrl, this streams, so the download reports real progress.
    httpsGet,
    fetch: window.fetch.bind(window),
};

export const GITHUB_REPO = "tobocop2/lilbee";
export const LILBEE_GITHUB_REPO_URL = `https://github.com/${GITHUB_REPO}`;
const RELEASE_LIST_API = `https://api.github.com/repos/${GITHUB_REPO}/releases`;

/** How many recent releases the version picker offers. */
const RELEASE_HISTORY_LIMIT = 10;

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
function selectAsset(data: GitHubRelease, cudaTag: CudaTag | null): { variant: ServerVariant; asset: GitHubAsset } {
    if (cudaTag) {
        const cudaAsset = data.assets.find((a) => a.name === getPlatformAssetName(cudaTag));
        if (cudaAsset) return { variant: cudaTag, asset: cudaAsset };
    }
    const defaultName = getPlatformAssetName(null);
    const asset = data.assets.find((a) => a.name === defaultName);
    if (!asset) throw new Error(`No asset "${defaultName}" in release ${data.tag_name}`);
    return { variant: SERVER_VARIANT.DEFAULT, asset };
}

function toReleaseInfo(data: GitHubRelease, cudaTag: CudaTag | null): ReleaseInfo {
    const { variant, asset } = selectAsset(data, cudaTag);
    return {
        tag: data.tag_name,
        assetUrl: asset.browser_download_url,
        variant,
        sizeBytes: asset.size,
        digest: asset.digest,
    };
}

/** An in-development build, tagged with a trailing `.dev<n>` (e.g. v0.6.90b420.dev711). */
export function isDevBuild(tag: string): boolean {
    return /\.dev\d*$/i.test(tag);
}

/**
 * Recent published releases, newest first, that ship a build for this machine.
 * Drafts, prereleases, and releases without a matching asset are left out.
 */
async function fetchInstallableReleases(limit: number): Promise<ReleaseInfo[]> {
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
            releases.push(toReleaseInfo(data, cudaTag));
        } catch {
            // Release ships no build for this platform; it isn't installable here.
        }
    }
    return releases;
}

/** Installable releases for the version picker, newest first; dev builds left out unless includeDev. */
export async function listReleases(includeDev: boolean, limit = RELEASE_HISTORY_LIMIT): Promise<ReleaseInfo[]> {
    const all = await fetchInstallableReleases(limit);
    return includeDev ? all : all.filter((r) => !isDevBuild(r.tag));
}

/** Newest installable release, honouring the dev-build preference. */
export async function getLatestRelease(includeDev: boolean): Promise<ReleaseInfo> {
    const releases = await listReleases(includeDev);
    if (releases.length === 0) throw new Error("No installable lilbee release was found.");
    return releases[0];
}

export function checkForUpdate(currentVersion: string, latestTag: string): boolean {
    return currentVersion !== latestTag && latestTag !== "";
}

/** Slack over the asset size: the download streams straight to disk, so only the file itself lands. */
const DISK_SPACE_FACTOR = 1.1;

/** Redirects to follow before giving up (GitHub sends assets to objects.githubusercontent.com). */
const MAX_REDIRECTS = 5;

/** Give up when the asset host sends no bytes for this long, rather than hanging on a dead socket. */
const DOWNLOAD_IDLE_TIMEOUT_MS = 60_000;

const DOWNLOAD_STALLED = "The lilbee server download stalled. Check your connection and try again.";

export const DOWNLOAD_CANCELED = "The lilbee server download was cancelled.";

/** Thrown when the caller aborts the download; callers treat it as a no-op, not a failure. */
export class DownloadCanceledError extends Error {
    constructor() {
        super(DOWNLOAD_CANCELED);
        this.name = "DownloadCanceledError";
    }
}

/** Suffix of the partial download; renamed onto the real path only after the digest checks out. */
const PART_SUFFIX = ".part";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** Bytes received so far, and the total when the server reports a Content-Length. */
export interface DownloadProgress {
    receivedBytes: number;
    totalBytes: number | null;
}

/** Resolve *url* through redirects to the response that carries the body. */
function openStream(url: string, redirectsLeft = MAX_REDIRECTS): Promise<IncomingMessage> {
    return new Promise((resolve, reject) => {
        const req: ClientRequest = node.httpsGet(url, (res: IncomingMessage) => {
            req.setTimeout?.(0);
            const status = res.statusCode ?? 0;
            const location = res.headers.location;
            if (REDIRECT_STATUSES.has(status) && location) {
                res.resume();
                if (redirectsLeft === 0) {
                    reject(new Error("Download failed: too many redirects"));
                    return;
                }
                openStream(new URL(location, url).toString(), redirectsLeft - 1).then(resolve, reject);
                return;
            }
            // Anything but a 2xx body: a bare redirect, an error, or a response
            // with no status at all. None of them carry the asset.
            if (status < 200 || status >= 300) {
                res.resume();
                reject(new Error(`Download failed: ${status}`));
                return;
            }
            resolve(res);
        });
        req.on("error", reject);
        // Covers a connect/headers stall. Once the body starts, streamToFile owns the clock.
        req.setTimeout?.(DOWNLOAD_IDLE_TIMEOUT_MS, () => {
            req.destroy(new Error(DOWNLOAD_STALLED));
        });
    });
}

/** Best-effort removal during error cleanup: a failure here must not mask the real error. */
function discard(path: string): void {
    try {
        if (node.existsSync(path)) node.unlinkSync(path);
    } catch {
        // nothing else to do; the caller is already throwing
    }
}

function contentLength(res: IncomingMessage): number | null {
    const raw = res.headers["content-length"];
    const parsed = Number(raw);
    return raw !== undefined && Number.isFinite(parsed) ? parsed : null;
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
        includeDev: boolean,
        onProgress?: (msg: string, url?: string, progress?: DownloadProgress) => void,
        onQuarantineFailed?: () => void,
        signal?: AbortSignal,
    ): Promise<string> {
        if (this.binaryExists()) return this.binaryPath;
        onProgress?.("Fetching latest release info...");
        const release = await getLatestRelease(includeDev);
        await this.download(
            release.assetUrl,
            release.sizeBytes,
            release.digest,
            onProgress,
            onQuarantineFailed,
            signal,
        );
        return this.binaryPath;
    }

    /** Throw a user-facing error if the target filesystem can't hold the download. */
    private async assertEnoughSpace(sizeBytes: number): Promise<void> {
        const required = Math.ceil(sizeBytes * DISK_SPACE_FACTOR);
        const stats = await node.statfs(this.binDir);
        const free = stats.bavail * stats.bsize;
        if (free < required) {
            throw new Error(
                `Not enough disk space for the lilbee server: need about ${formatDiskSize(required)} free, ` +
                    `but only ${formatDiskSize(free)} is available. Free up some space and try again.`,
            );
        }
    }

    /** Reject the download unless its SHA256 matches the digest GitHub reports for the asset. */
    private assertDigest(actualHex: string, expectedDigest: string | null): void {
        if (`sha256:${actualHex}` !== (expectedDigest ?? "").toLowerCase()) {
            throw new Error(
                "The downloaded lilbee server could not be verified against its checksum and was discarded. Please try again.",
            );
        }
    }

    /** Stream *assetUrl* to *partPath*, hashing as it goes. Returns the SHA256 of what landed. */
    private async streamToFile(
        assetUrl: string,
        partPath: string,
        fallbackTotal: number | null,
        onBytes: (progress: DownloadProgress) => void,
        signal?: AbortSignal,
    ): Promise<string> {
        if (signal?.aborted) throw new DownloadCanceledError();
        const res = await openStream(assetUrl);
        // The release's reported asset size keeps progress determinate when the
        // response carries no content-length (e.g. chunked transfer).
        const totalBytes = contentLength(res) ?? fallbackTotal;
        const hash = node.createHash("sha256");
        const file = node.createWriteStream(partPath);
        let receivedBytes = 0;

        return new Promise<string>((resolve, reject) => {
            let idleTimer: number;
            const stopClock = (): void => window.clearTimeout(idleTimer);
            const restartClock = (): void => {
                stopClock();
                idleTimer = window.setTimeout(() => fail(new Error(DOWNLOAD_STALLED)), DOWNLOAD_IDLE_TIMEOUT_MS);
            };
            const fail = (err: Error): void => {
                stopClock();
                signal?.removeEventListener("abort", onAbort);
                res.destroy();
                file.destroy();
                reject(err);
            };
            const onAbort = (): void => fail(new DownloadCanceledError());
            signal?.addEventListener("abort", onAbort, { once: true });

            res.on("data", (chunk: Buffer) => {
                restartClock();
                hash.update(chunk);
                receivedBytes += chunk.length;
                onBytes({ receivedBytes, totalBytes });
            });
            res.on("error", fail);
            file.on("error", fail);
            res.pipe(file);
            file.on("finish", () => {
                stopClock();
                signal?.removeEventListener("abort", onAbort);
                resolve(hash.digest("hex"));
            });
            restartClock();
        });
    }

    async download(
        assetUrl: string,
        sizeBytes: number,
        expectedDigest: string | null,
        onProgress?: (msg: string, url?: string, progress?: DownloadProgress) => void,
        onQuarantineFailed?: () => void,
        signal?: AbortSignal,
    ): Promise<void> {
        if (!node.existsSync(this.binDir)) {
            node.mkdirSync(this.binDir, { recursive: true });
        }
        await this.assertEnoughSpace(sizeBytes);

        onProgress?.("Downloading...", assetUrl);
        const dest = this.binaryPath;
        const partPath = `${dest}${PART_SUFFIX}`;
        let renamed = false;
        try {
            const actualHex = await this.streamToFile(
                assetUrl,
                partPath,
                sizeBytes > 0 ? sizeBytes : null,
                (progress) => onProgress?.("Downloading...", assetUrl, progress),
                signal,
            );
            this.assertDigest(actualHex, expectedDigest);
            node.renameSync(partPath, dest);
            renamed = true;
            if (process.platform !== PLATFORM.WIN32) {
                node.chmodSync(dest, 0o755);
            }
        } catch (err) {
            // Discard the partial. A failure before the rename leaves any previously
            // installed binary alone; after it, dest is the new file and must go.
            discard(partPath);
            if (renamed) discard(dest);
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
