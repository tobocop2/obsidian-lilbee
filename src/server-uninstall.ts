/**
 * Removal of everything managed mode put on disk: the server binary, the
 * shared model cache, and one vault's index. Never touches the Obsidian vault.
 */
import { node } from "./binary-manager";
import { dirSizeBytes } from "./storage-stats";
import { sharedBinDir, sharedModelsDir } from "./vault-registry";
import { UNINSTALL_TARGET, type UninstallPlan, type UninstallTarget, type UninstallTargetKind } from "./types";

function target(kind: UninstallTargetKind, path: string): UninstallTarget {
    return { kind, path, bytes: dirSizeBytes(path) };
}

/** Size every removable path so the confirmation can name what it deletes. */
export function planUninstall(sharedRoot: string, vaultDataDir: string): UninstallPlan {
    const targets = [
        target(UNINSTALL_TARGET.BINARY, sharedBinDir(sharedRoot)),
        target(UNINSTALL_TARGET.MODELS, sharedModelsDir(sharedRoot)),
        target(UNINSTALL_TARGET.INDEX, vaultDataDir),
    ];
    return { targets, totalBytes: targets.reduce((sum, t) => sum + t.bytes, 0) };
}

/** Delete every planned path. Missing paths are not an error. */
export function executeUninstall(plan: UninstallPlan): void {
    for (const t of plan.targets) {
        node.rmSync(t.path, { recursive: true, force: true });
    }
}
