/**
 * One-shot migration from per-vault `<plugin>/server-data` to the shared-root layout.
 * Runs from `LilbeePlugin.onload` before the server is spawned, completes before
 * the user sees a UI, and never runs twice for the same vault.
 */
import { node } from "./binary-manager";
import { MIGRATION_RESULT, type LilbeeSettings, type MigrationResult, type SharedConfig } from "./types";
import { VaultRegistry, defaultDataDirFor, sharedBinDir } from "./vault-registry";

const LEGACY_SERVER_DATA = "server-data";
const LEGACY_BIN_DIR = "bin";

export interface MigrationContext {
    pluginDir: string;
    sharedRoot: string;
    vaultId: string;
    displayName: string;
    obsidianVaultPath: string;
    legacy: Partial<LilbeeSettings> & { lilbeeVersion?: string; hfToken?: string };
    confirmCrossFs: (sourceBytes: number) => Promise<boolean>;
}

export async function migrateIfNeeded(ctx: MigrationContext): Promise<MigrationResult> {
    const source = node.join(ctx.pluginDir, LEGACY_SERVER_DATA);
    if (!node.existsSync(source)) return MIGRATION_RESULT.NONE;

    const registry = new VaultRegistry(ctx.sharedRoot);
    if (registry.get(ctx.vaultId) !== null) return MIGRATION_RESULT.NONE;

    const target = defaultDataDirFor(ctx.sharedRoot, ctx.vaultId);
    if (node.existsSync(target)) return MIGRATION_RESULT.NONE;

    const targetParent = ensureExistingAncestor(node.dirname(target));
    const sameFs = node.statSync(source).dev === node.statSync(targetParent).dev;
    if (!sameFs) {
        const proceed = await ctx.confirmCrossFs(directorySize(source));
        if (!proceed) return MIGRATION_RESULT.CROSS_FS_DECLINED;
    }

    moveDirectory(source, target, sameFs);
    relocateBinaryIfPresent(ctx.pluginDir, ctx.sharedRoot);
    promoteSharedConfig(registry, ctx.legacy);
    registerVault(registry, ctx);
    return MIGRATION_RESULT.MIGRATED;
}

function ensureExistingAncestor(path: string): string {
    let current = path;
    while (!node.existsSync(current)) {
        const parent = node.dirname(current);
        if (parent === current) return current;
        current = parent;
    }
    return current;
}

function directorySize(dir: string): number {
    let total = 0;
    for (const name of node.readdirSync(dir)) {
        const child = node.join(dir, name);
        const stat = node.statSync(child);
        total += stat.isDirectory() ? directorySize(child) : stat.size;
    }
    return total;
}

function moveDirectory(source: string, target: string, sameFs: boolean): void {
    node.mkdirSync(node.dirname(target), { recursive: true });
    if (sameFs) {
        node.renameSync(source, target);
        return;
    }
    node.cpSync(source, target, { recursive: true });
    node.rmSync(source, { recursive: true, force: true });
}

function relocateBinaryIfPresent(pluginDir: string, sharedRoot: string): void {
    const sourceBin = node.join(pluginDir, LEGACY_BIN_DIR);
    if (!node.existsSync(sourceBin)) return;
    const destBin = sharedBinDir(sharedRoot);
    if (node.existsSync(destBin)) {
        node.rmSync(sourceBin, { recursive: true, force: true });
        return;
    }
    node.mkdirSync(node.dirname(destBin), { recursive: true });
    try {
        node.renameSync(sourceBin, destBin);
    } catch {
        node.cpSync(sourceBin, destBin, { recursive: true });
        node.rmSync(sourceBin, { recursive: true, force: true });
    }
}

function promoteSharedConfig(registry: VaultRegistry, legacy: MigrationContext["legacy"]): void {
    const existing = registry.loadConfig();
    const next: SharedConfig = {
        lilbeeVersion: existing.lilbeeVersion || (legacy.lilbeeVersion ?? ""),
        hfToken: existing.hfToken || (legacy.hfToken ?? ""),
    };
    registry.saveConfig(next);
}

function registerVault(registry: VaultRegistry, ctx: MigrationContext): void {
    const now = Date.now();
    registry.upsert({
        id: ctx.vaultId,
        displayName: ctx.displayName,
        dataDir: defaultDataDirFor(ctx.sharedRoot, ctx.vaultId),
        obsidianVaultPath: ctx.obsidianVaultPath,
        addedAt: now,
        lastActiveAt: now,
    });
}
