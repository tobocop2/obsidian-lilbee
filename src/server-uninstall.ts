/**
 * Removal of everything managed mode put on disk: the server binary, the
 * shared model cache, and one vault's index. Never touches the Obsidian vault.
 */
import { node } from "./node";
import { dirSizeBytes } from "./storage-stats";
import { sharedBinDir, sharedModelsDir } from "./vault-registry";
import {
    PLATFORM,
    UNINSTALL_TARGET,
    type UninstallPlan,
    type UninstallTarget,
    type UninstallTargetKind,
} from "./types";

/** Written by the server into every directory it unpacks itself into. */
const BOOTSTRAP_MANIFEST = ".lilbee-bootstrap-manifest";

function target(kind: UninstallTargetKind, path: string): UninstallTarget {
    return { kind, path, bytes: dirSizeBytes(path) };
}

/** Where the server unpacks itself. On Windows that is the shared root, so its payload directories are listed by their manifest. */
function unpackCachePaths(sharedRoot: string): string[] {
    if (process.platform === PLATFORM.WIN32) {
        if (!node.existsSync(sharedRoot)) return [];
        return node
            .readdirSync(sharedRoot)
            .map((name) => node.join(sharedRoot, name))
            .filter((path) => node.existsSync(node.join(path, BOOTSTRAP_MANIFEST)));
    }
    const home = node.homedir();
    if (process.platform === PLATFORM.DARWIN) return [node.join(home, "Library", "Caches", "lilbee")];
    return [node.join(home, ".cache", "lilbee")];
}

/** Size every removable path so the confirmation can name what it deletes. */
export function planUninstall(sharedRoot: string, vaultDataDir: string): UninstallPlan {
    const targets = [
        target(UNINSTALL_TARGET.BINARY, sharedBinDir(sharedRoot)),
        target(UNINSTALL_TARGET.MODELS, sharedModelsDir(sharedRoot)),
        target(UNINSTALL_TARGET.INDEX, vaultDataDir),
        ...unpackCachePaths(sharedRoot).map((path) => target(UNINSTALL_TARGET.CACHE, path)),
    ];
    return { targets, totalBytes: targets.reduce((sum, t) => sum + t.bytes, 0) };
}

/** Delete every planned path. Missing paths are not an error. */
export function executeUninstall(plan: UninstallPlan): void {
    for (const t of plan.targets) {
        node.rmSync(t.path, { recursive: true, force: true });
    }
}
