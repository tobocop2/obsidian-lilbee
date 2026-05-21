/**
 * Read-only filesystem helpers used by the Settings storage report.
 * Walks are synchronous because the Settings UI already blocks while it renders.
 */
import { node } from "./binary-manager";
import { sharedBinDir, sharedModelsDir, vaultsRootDir } from "./vault-registry";
import type { VaultRegistryEntry } from "./types";

export interface StorageReport {
    sharedRoot: string;
    binBytes: number;
    modelsBytes: number;
    vaults: VaultStorage[];
    totalBytes: number;
}

export interface VaultStorage {
    id: string;
    displayName: string;
    dataDir: string;
    bytes: number;
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

export function reportFor(sharedRoot: string, entries: VaultRegistryEntry[]): StorageReport {
    const binBytes = dirSizeBytes(sharedBinDir(sharedRoot));
    const modelsBytes = dirSizeBytes(sharedModelsDir(sharedRoot));
    const vaults: VaultStorage[] = entries.map((entry) => ({
        id: entry.id,
        displayName: entry.displayName,
        dataDir: entry.dataDir,
        bytes: dirSizeBytes(entry.dataDir),
    }));
    // Catch vault subfolders that exist on disk but aren't in the registry.
    const vaultsRoot = vaultsRootDir(sharedRoot);
    if (node.existsSync(vaultsRoot)) {
        const registeredDirs = new Set(entries.map((e) => e.dataDir));
        let names: string[];
        try {
            names = node.readdirSync(vaultsRoot) as string[];
        } catch {
            names = [];
        }
        for (const name of names) {
            const path = node.join(vaultsRoot, name);
            if (registeredDirs.has(path)) continue;
            vaults.push({
                id: name,
                displayName: name,
                dataDir: path,
                bytes: dirSizeBytes(path),
            });
        }
    }
    const totalBytes = binBytes + modelsBytes + vaults.reduce((sum, v) => sum + v.bytes, 0);
    return { sharedRoot, binBytes, modelsBytes, vaults, totalBytes };
}

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

export function formatBytes(bytes: number): string {
    if (!bytes) return "0 B";
    const exp = Math.min(BYTE_UNITS.length - 1, Math.floor(Math.log10(bytes) / 3));
    const value = bytes / 10 ** (exp * 3);
    const precision = value >= 100 ? 0 : value >= 10 ? 1 : 2;
    return `${value.toFixed(precision)} ${BYTE_UNITS[exp]}`;
}
