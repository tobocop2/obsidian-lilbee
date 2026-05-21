/**
 * Shared-root layout + per-vault registry + cross-process lock.
 * One lilbee binary, one HF cache, many vault data-dirs, one active vault at a time.
 */
import { node } from "./binary-manager";
import { getDefaultLilbeeDataRoot } from "./session-token";
import {
    DEFAULT_SHARED_CONFIG,
    LOCK_STATE,
    SHARED_PATH,
    type ActiveLock,
    type LockState,
    type SharedConfig,
    type VaultRegistryEntry,
} from "./types";

const VAULT_ID_BYTES = 6;
const FALLBACK_SHARED_ROOT = "/tmp/lilbee";

export function resolveSharedRoot(setting: string): string {
    if (setting && setting.length > 0) return setting;
    return getDefaultLilbeeDataRoot() ?? FALLBACK_SHARED_ROOT;
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

    markActive(id: string, when: number = Date.now()): void {
        const entry = this.get(id);
        if (!entry) return;
        this.upsert({ ...entry, lastActiveAt: when });
    }

    remove(id: string): void {
        const entries = this.list().filter((e) => e.id !== id);
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
