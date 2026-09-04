import nodeFetch from "node-fetch";
import {
    DownloadCanceledError,
    assetNameFor,
    detectHost,
    ensureBinary,
    installedBinary,
    isDevBuild,
    isDownloadCanceled,
    latestRelease,
    listReleases as listPackageReleases,
    type DownloadProgress,
    type EnsureResult,
    type FetchLike,
    type Host,
    type InstalledBinary,
    type LauncherError,
    type ResolvedRelease,
} from "lilbee";
import { MESSAGES } from "./locales/en";
import { node } from "./node";
import {
    ENSURE_SOURCE,
    LAUNCHER_ERROR_CODE,
    PLATFORM,
    SERVER_VARIANT,
    type EnsureRequest,
    type MigratedBinary,
    type ServerVariant,
} from "./types";
import { formatDiskSize } from "./utils";

export type ReleaseInfo = ResolvedRelease;
export type { DownloadProgress, EnsureResult, InstalledBinary };
export { DownloadCanceledError, isDevBuild, isDownloadCanceled };

// Node's https, not the renderer's fetch: GitHub's asset redirect fails CORS in the renderer.
const fetch: FetchLike = nodeFetch;

const FLAT_BINARY_NAME = "lilbee";
const WINDOWS_EXE_SUFFIX = ".exe";
const PART_SUFFIX = ".part";
const VERSION_FLAG = "--version";
const LAUNCHER_ERROR_NAME = "LauncherError";

/** The baseline build a ROCm-family variant falls back to. */
const ROCM_BASELINE: Partial<Record<ServerVariant, ServerVariant>> = {
    [SERVER_VARIANT.ROCM]: SERVER_VARIANT.DEFAULT,
    [SERVER_VARIANT.COMPAT_ROCM]: SERVER_VARIANT.COMPAT,
};

// Unknown gfx targets are not "supports everything": a ROCm build refuses cards it ships no kernels for.
function withKnownGpu(host: Host): Host {
    const baseline = ROCM_BASELINE[host.variant];
    if (baseline === undefined || host.amdGfxTargets.length > 0) return host;
    return { ...host, variant: baseline };
}

async function releaseHost(): Promise<Host> {
    return withKnownGpu(await detectHost());
}

function asLauncherError(err: unknown): LauncherError | null {
    return err instanceof Error && err.name === LAUNCHER_ERROR_NAME ? (err as LauncherError) : null;
}

/** The plugin's wording for a launcher failure; anything else passes through unchanged. */
function pluginError(err: unknown): unknown {
    const failure = asLauncherError(err);
    if (failure === null) return err;
    switch (failure.code) {
        case LAUNCHER_ERROR_CODE.NO_SPACE:
            return new Error(
                MESSAGES.ERROR_DOWNLOAD_NO_SPACE(
                    formatDiskSize(Number(failure.neededBytes)),
                    formatDiskSize(Number(failure.freeBytes)),
                ),
            );
        case LAUNCHER_ERROR_CODE.STALLED:
            return new Error(MESSAGES.ERROR_DOWNLOAD_STALLED);
        case LAUNCHER_ERROR_CODE.NO_DIGEST:
        case LAUNCHER_ERROR_CODE.DIGEST_MISMATCH:
            return new Error(MESSAGES.ERROR_DOWNLOAD_UNVERIFIED);
        case LAUNCHER_ERROR_CODE.HTTP:
            return new Error(MESSAGES.ERROR_GITHUB_STATUS(Number(failure.status)));
        default:
            return err;
    }
}

async function withPluginWording<T>(work: Promise<T>): Promise<T> {
    try {
        return await work;
    } catch (err) {
        throw pluginError(err);
    }
}

/** Recent installable releases for the version picker, newest first, dev builds included when asked. */
export async function listReleases(includeDev: boolean): Promise<ReleaseInfo[]> {
    return withPluginWording(listPackageReleases({ includeDev, host: await releaseHost(), fetch }));
}

/** The newest installable release, honouring the dev-build preference. */
export async function getLatestRelease(includeDev: boolean): Promise<ReleaseInfo> {
    return withPluginWording(latestRelease({ includeDev, host: await releaseHost(), fetch }));
}

export function checkForUpdate(currentVersion: string, latestTag: string): boolean {
    return currentVersion !== latestTag && latestTag !== "";
}

function flatBinaryName(): string {
    return process.platform === PLATFORM.WIN32 ? `${FLAT_BINARY_NAME}${WINDOWS_EXE_SUFFIX}` : FLAT_BINARY_NAME;
}

/** The tag a binary reports (`lilbee 0.6.90b432` reads as v0.6.90b432), or null when it cannot say. */
async function probeVersion(path: string): Promise<string | null> {
    try {
        const { stdout } = await node.execFile(path, [VERSION_FLAG]);
        const [, version] = stdout.trim().split(/\s+/);
        return version ? `v${version}` : null;
    } catch {
        return null;
    }
}

/**
 * Move a flat `<binDir>/lilbee` install into the package's `<binDir>/<release>/<asset>` layout
 * and return what it was filed under. An install with no recorded version is asked for its
 * version first and deleted only when it cannot answer.
 */
export async function migrateFlatBinary(
    binDir: string,
    version: string,
    variant: ServerVariant | "",
): Promise<MigratedBinary | null> {
    const flat = node.join(binDir, flatBinaryName());
    const part = `${flat}${PART_SUFFIX}`;
    if (node.existsSync(part)) node.unlinkSync(part);
    if (!node.existsSync(flat)) return null;
    const release = version || (await probeVersion(flat));
    if (release === null) {
        node.unlinkSync(flat);
        return null;
    }
    const { assetName, variant: filedAs } = hostAssetFor(variant || SERVER_VARIANT.DEFAULT);
    const releaseDir = node.join(binDir, release);
    node.mkdirSync(releaseDir, { recursive: true });
    node.renameSync(flat, node.join(releaseDir, assetName));
    return { release, variant: filedAs };
}

/** This host's asset name for a build; a build the host cannot name (a stale record) files as the default build. */
function hostAssetFor(variant: ServerVariant): { assetName: string; variant: ServerVariant } {
    try {
        return { assetName: assetNameFor(process.platform, process.arch, variant), variant };
    } catch {
        return {
            assetName: assetNameFor(process.platform, process.arch, SERVER_VARIANT.DEFAULT),
            variant: SERVER_VARIANT.DEFAULT,
        };
    }
}

async function clearQuarantine(path: string, onFailed?: () => void): Promise<void> {
    try {
        await node.execFile("xattr", ["-cr", path]);
    } catch {
        onFailed?.();
    }
}

export class ServerBinary {
    constructor(private binDir: string) {}

    /** The newest installed binary for this machine, or null when none is installed. */
    installed(): InstalledBinary | null {
        return installedBinary({ cacheDir: this.binDir });
    }

    /** Make a binary available, downloading when needed; a fresh macOS download has its quarantine cleared. */
    async ensure(request: EnsureRequest): Promise<EnsureResult> {
        const { onQuarantineFailed, ...options } = request;
        if (!options.release && !options.force) {
            const installed = this.installed();
            if (installed !== null) return { ...installed, source: ENSURE_SOURCE.CACHE };
        }
        const result = await withPluginWording(
            ensureBinary({ ...options, cacheDir: this.binDir, host: await releaseHost(), fetch, requireDigest: true }),
        );
        if (result.source === ENSURE_SOURCE.DOWNLOAD && process.platform === PLATFORM.DARWIN) {
            await clearQuarantine(result.path, onQuarantineFailed);
        }
        return result;
    }
}
