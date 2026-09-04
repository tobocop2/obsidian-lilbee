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
    type Arch,
    type DownloadProgress,
    type EnsureResult,
    type FetchLike,
    type Host,
    type InstalledBinary,
    type Platform,
    type ResolvedRelease,
} from "lilbee";
import { node } from "./node";
import { ENSURE_SOURCE, PLATFORM, SERVER_VARIANT, type EnsureRequest, type ServerVariant } from "./types";

export type ReleaseInfo = ResolvedRelease;
export type { DownloadProgress, EnsureResult, InstalledBinary };
export { DownloadCanceledError, isDevBuild, isDownloadCanceled };

// Node's https, not the renderer's fetch: GitHub's asset redirect fails CORS in the renderer.
const fetch: FetchLike = nodeFetch;

const FLAT_BINARY_NAME = "lilbee";
const WINDOWS_EXE_SUFFIX = ".exe";
const PART_SUFFIX = ".part";

/** Recent installable releases for the version picker, newest first, dev builds included when asked. */
export async function listReleases(includeDev: boolean): Promise<ReleaseInfo[]> {
    return listPackageReleases({ includeDev, host: await detectHost(), fetch });
}

/** The newest installable release, honouring the dev-build preference. */
export async function getLatestRelease(includeDev: boolean): Promise<ReleaseInfo> {
    return latestRelease({ includeDev, host: await detectHost(), fetch });
}

export function checkForUpdate(currentVersion: string, latestTag: string): boolean {
    return currentVersion !== latestTag && latestTag !== "";
}

function flatBinaryName(): string {
    return process.platform === PLATFORM.WIN32 ? `${FLAT_BINARY_NAME}${WINDOWS_EXE_SUFFIX}` : FLAT_BINARY_NAME;
}

// The variant preference is moot for lookups: the package keeps one build per release.
function cacheHost(): Host {
    return {
        platform: process.platform as Platform,
        arch: process.arch as Arch,
        variant: SERVER_VARIANT.DEFAULT,
        amdGfxTargets: [],
    };
}

/**
 * Move a flat `<binDir>/lilbee` install into the package's `<binDir>/<release>/<asset>` layout.
 * Without a recorded version the file is deleted: only a download can say what it is.
 */
export function migrateFlatBinary(binDir: string, version: string, variant: ServerVariant | ""): void {
    const flat = node.join(binDir, flatBinaryName());
    const part = `${flat}${PART_SUFFIX}`;
    if (node.existsSync(part)) node.unlinkSync(part);
    if (!node.existsSync(flat)) return;
    if (!version) {
        node.unlinkSync(flat);
        return;
    }
    const assetName = assetNameFor(process.platform, process.arch, variant || SERVER_VARIANT.DEFAULT);
    const releaseDir = node.join(binDir, version);
    node.mkdirSync(releaseDir, { recursive: true });
    node.renameSync(flat, node.join(releaseDir, assetName));
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
        return installedBinary({ cacheDir: this.binDir, host: cacheHost() });
    }

    /** Make a binary available, downloading when needed; a fresh macOS download has its quarantine cleared. */
    async ensure(request: EnsureRequest): Promise<EnsureResult> {
        const { onQuarantineFailed, ...options } = request;
        const result = await ensureBinary({ ...options, cacheDir: this.binDir, host: await detectHost(), fetch });
        if (result.source === ENSURE_SOURCE.DOWNLOAD && process.platform === PLATFORM.DARWIN) {
            await clearQuarantine(result.path, onQuarantineFailed);
        }
        return result;
    }
}
