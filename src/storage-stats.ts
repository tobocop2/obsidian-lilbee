/**
 * Read-only filesystem helpers used by the Settings storage report.
 * Walks are synchronous because the Settings UI already blocks while it renders.
 */
import { node } from "./binary-manager";
import { sharedBinDir, sharedModelsDir } from "./vault-registry";

export interface StorageReport {
    sharedRoot: string;
    binBytes: number;
    modelsBytes: number;
    vaultBytes: number;
    vaultDataDir: string;
    totalBytes: number;
}

export function dirSizeBytes(path: string): number {
    if (!node.existsSync(path)) return 0;
    let total = 0;
    let entries: string[];
    try {
        entries = node.readdirSync(path) as string[];
    } catch {
        return 0;
    }
    for (const name of entries) {
        const child = node.join(path, name);
        let stat: ReturnType<typeof node.statSync>;
        try {
            stat = node.statSync(child);
        } catch {
            continue;
        }
        total += stat.isDirectory() ? dirSizeBytes(child) : stat.size;
    }
    return total;
}

/**
 * Disk usage for the open vault only: the shared binary + shared models it
 * relies on, plus this vault's own data dir. The open Obsidian vault is the
 * only vault lilbee serves, so the report never enumerates other vaults.
 */
export function reportForVault(sharedRoot: string, vaultDataDir: string): StorageReport {
    const binBytes = dirSizeBytes(sharedBinDir(sharedRoot));
    const modelsBytes = dirSizeBytes(sharedModelsDir(sharedRoot));
    const vaultBytes = dirSizeBytes(vaultDataDir);
    const totalBytes = binBytes + modelsBytes + vaultBytes;
    return { sharedRoot, binBytes, modelsBytes, vaultBytes, vaultDataDir, totalBytes };
}

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

export function formatBytes(bytes: number): string {
    if (!bytes) return "0 B";
    const exp = Math.min(BYTE_UNITS.length - 1, Math.floor(Math.log10(bytes) / 3));
    const value = bytes / 10 ** (exp * 3);
    const precision = value >= 100 ? 0 : value >= 10 ? 1 : 2;
    return `${value.toFixed(precision)} ${BYTE_UNITS[exp]}`;
}
