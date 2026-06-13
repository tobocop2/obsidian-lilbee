/**
 * Shared-root layout + per-vault registry + cross-process lock.
 * One lilbee binary, one HF cache, many vault data-dirs, one active vault at a time.
 */
import { node } from "./binary-manager";
import { getDefaultPluginDataRoot } from "./session-token";
import {
    DEFAULT_SHARED_CONFIG,
    LOCK_STATE,
    MIGRATION_RESULT,
    SHARED_PATH,
    type ActiveLock,
    type LockState,
    type MigrationResult,
    type SharedConfig,
    type VaultRegistryEntry,
} from "./types";

const VAULT_ID_BYTES = 6;
const FALLBACK_SHARED_ROOT = "/tmp/obsidian-lilbee";

export function resolveSharedRoot(setting: string): string {
    if (setting && setting.length > 0) return setting;
    return getDefaultPluginDataRoot() ?? FALLBACK_SHARED_ROOT;
}

export function computeVaultId(vaultPath: string): string {
    const canonical = node.resolve(vaultPath);
    return node
        .createHash("sha256")
        .update(canonical)
        .digest("hex")
        .slice(0, VAULT_ID_BYTES * 2);
}

export function sharedBinDir(sharedRoot: string): string {
    return node.join(sharedRoot, SHARED_PATH.BIN);
}

export function sharedModelsDir(sharedRoot: string): string {
    return node.join(sharedRoot, SHARED_PATH.MODELS);
}

export function vaultsRootDir(sharedRoot: string): string {
    return node.join(sharedRoot, SHARED_PATH.VAULTS);
}

export function defaultDataDirFor(sharedRoot: string, vaultId: string): string {
    return node.join(vaultsRootDir(sharedRoot), vaultId);
}

function configPath(sharedRoot: string): string {
    return node.join(sharedRoot, SHARED_PATH.CONFIG);
}

function registryPath(sharedRoot: string): string {
    return node.join(sharedRoot, SHARED_PATH.REGISTRY);
}

function lockPath(sharedRoot: string): string {
    return node.join(sharedRoot, SHARED_PATH.LOCK);
}

function ensureDir(path: string): void {
    if (!node.existsSync(path)) node.mkdirSync(path, { recursive: true });
}

function writeJsonAtomic(path: string, value: unknown): void {
    ensureDir(node.dirname(path));
    const tmp = `${path}.tmp`;
    node.writeFileSync(tmp, JSON.stringify(value, null, 2));
    node.renameSync(tmp, path);
}

function readJson<T>(path: string): T | null {
    if (!node.existsSync(path)) return null;
    try {
        return JSON.parse(node.readFileSync(path, "utf-8")) as T;
    } catch {
        return null;
    }
}

function isProcessAlive(pid: number): boolean {
    try {
        node.processKill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

/** Everything moved off the legacy root; the lock is stale by definition and is deleted instead. */
const MIGRATABLE_ENTRIES = [
    SHARED_PATH.BIN,
    SHARED_PATH.MODELS,
    SHARED_PATH.VAULTS,
    SHARED_PATH.CONFIG,
    SHARED_PATH.REGISTRY,
] as const;

/** Entries only the plugin writes; the CLI may create models/ or config files of its own. */
const PLUGIN_MARKERS = [SHARED_PATH.BIN, SHARED_PATH.REGISTRY] as const;

function hasPluginEntries(root: string): boolean {
    return Object.values(SHARED_PATH).some((entry) => node.existsSync(node.join(root, entry)));
}

function moveEntry(from: string, to: string): void {
    try {
        node.renameSync(from, to);
    } catch {
        // cross-device rename; copy then remove
        node.cpSync(from, to, { recursive: true });
        node.rmSync(from, { recursive: true, force: true });
    }
}

/** Registry entries carry absolute data-dir paths; repoint the ones under the legacy root. */
function rewriteDataDirPrefixes(newRoot: string, legacyRoot: string): void {
    const path = node.join(newRoot, SHARED_PATH.REGISTRY);
    const entries = readJson<VaultRegistryEntry[]>(path);
    if (entries === null) return;
    const prefix = `${legacyRoot}/`;
    const rewritten = entries.map((e) =>
        e.dataDir.startsWith(prefix) ? { ...e, dataDir: node.join(newRoot, e.dataDir.slice(prefix.length)) } : e,
    );
    writeJsonAtomic(path, rewritten);
}

/**
 * One-time move of plugin-created entries from the legacy CLI-shared data root
 * into the plugin-owned root. Anything else in the legacy root (e.g. an
 * external `lilbee serve` install) stays untouched. Returns DEFERRED while a
 * live process still serves from the legacy root; the next plugin load retries.
 */
export function migrateLegacySharedRoot(legacyRoot: string | null, newRoot: string): MigrationResult {
    if (!legacyRoot || hasPluginEntries(newRoot)) return MIGRATION_RESULT.NONE;
    if (!PLUGIN_MARKERS.some((e) => node.existsSync(node.join(legacyRoot, e)))) return MIGRATION_RESULT.NONE;

    const lock = readJson<ActiveLock>(node.join(legacyRoot, SHARED_PATH.LOCK));
    if (lock !== null && isProcessAlive(lock.pid)) return MIGRATION_RESULT.DEFERRED;

    ensureDir(newRoot);
    for (const entry of MIGRATABLE_ENTRIES) {
        const from = node.join(legacyRoot, entry);
        if (!node.existsSync(from)) continue;
        try {
            moveEntry(from, node.join(newRoot, entry));
        } catch (err) {
            console.warn(`[lilbee] could not migrate ${from}; it will be recreated`, err);
        }
    }
    try {
        node.unlinkSync(node.join(legacyRoot, SHARED_PATH.LOCK));
    } catch {
        // no stale lock to clean up
    }
    rewriteDataDirPrefixes(newRoot, legacyRoot);
    return MIGRATION_RESULT.MIGRATED;
}

/**
 * Delete the managed install. The plugin-owned default root is removed
 * wholesale; a user-overridden root may hold files the plugin never wrote,
 * so only the entries the plugin creates are removed there.
 */
export function deleteManagedInstall(sharedRoot: string): void {
    const defaultRoot = getDefaultPluginDataRoot() ?? FALLBACK_SHARED_ROOT;
    if (node.resolve(sharedRoot) === node.resolve(defaultRoot)) {
        node.rmSync(sharedRoot, { recursive: true, force: true });
        return;
    }
    for (const entry of Object.values(SHARED_PATH)) {
        node.rmSync(node.join(sharedRoot, entry), { recursive: true, force: true });
    }
}

/**
 * Manages `<shared-root>/{config.json, registry.json, active.lock}`.
 * All file I/O is synchronous because the call sites are plugin lifecycle
 * events that already block on disk.
 */
export class VaultRegistry {
    constructor(public readonly sharedRoot: string) {}

    loadConfig(): SharedConfig {
        const parsed = readJson<Partial<SharedConfig>>(configPath(this.sharedRoot));
        return { ...DEFAULT_SHARED_CONFIG, ...(parsed ?? {}) };
    }

    saveConfig(config: SharedConfig): void {
        writeJsonAtomic(configPath(this.sharedRoot), config);
    }

    list(): VaultRegistryEntry[] {
        return readJson<VaultRegistryEntry[]>(registryPath(this.sharedRoot)) ?? [];
    }

    get(id: string): VaultRegistryEntry | null {
        return this.list().find((e) => e.id === id) ?? null;
    }

    upsert(entry: VaultRegistryEntry): void {
        const entries = this.list().filter((e) => e.id !== entry.id);
        entries.push(entry);
        writeJsonAtomic(registryPath(this.sharedRoot), entries);
    }

    /** Return the registered data-dir or the default location for this id. */
    resolveDataDir(id: string): string {
        return this.get(id)?.dataDir ?? defaultDataDirFor(this.sharedRoot, id);
    }

    readLock(): ActiveLock | null {
        return readJson<ActiveLock>(lockPath(this.sharedRoot));
    }

    /**
     * Classify the current lock against our vault id. STALE means a lock file
     * exists but the owning PID is gone — safe to take.
     */
    lockState(vaultId: string): LockState {
        const lock = this.readLock();
        if (lock === null) return LOCK_STATE.NONE;
        if (!isProcessAlive(lock.pid)) return LOCK_STATE.STALE;
        return lock.vaultId === vaultId ? LOCK_STATE.OURS : LOCK_STATE.LIVE_OTHER;
    }

    /**
     * Atomically write a lock claiming the shared root for *vaultId*.
     * Caller must already have decided the existing lock (if any) is takeable
     * (STALE, OURS, or LIVE_OTHER after the user authorized take-over).
     */
    writeLock(lock: ActiveLock): void {
        ensureDir(this.sharedRoot);
        node.writeFileSync(lockPath(this.sharedRoot), JSON.stringify(lock, null, 2));
    }

    releaseLock(vaultId: string): void {
        const lock = this.readLock();
        if (lock === null) return;
        if (lock.vaultId !== vaultId) return;
        try {
            node.unlinkSync(lockPath(this.sharedRoot));
        } catch {
            // already gone — fine
        }
    }
}
