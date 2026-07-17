/**
 * Shared-root layout + per-vault registry + cross-process lock.
 * One lilbee binary, one HF cache, many vault data-dirs, one active vault at a time.
 */
import { node } from "./binary-manager";
import { getDefaultLilbeeDataRoot } from "./session-token";
import { DEFAULT_SHARED_CONFIG, SHARED_PATH, type SharedConfig, type VaultRegistryEntry } from "./types";

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

/**
 * Manages `<shared-root>/{config.json, registry.json}`. Which server owns the
 * shared root is the server's own business: it holds an OS scope lock and
 * names itself in a sidecar (see server-manager's readScopeOwner).
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
}
