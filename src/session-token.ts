/**
 * Auto-discovery of the lilbee session token.
 *
 * The lilbee server writes a freshly-generated bearer token to
 * `${data_root}/data/server.json` on every start. Rather than asking the user
 * to paste this token, the plugin locates the server's data root using the
 * same resolution order the server itself uses and reads the token directly.
 *
 * Resolution order (matches `_resolve_data_root` in `lilbee/config.py`):
 *   1. `LILBEE_DATA` environment variable
 *   2. walk up from the vault path looking for a `.lilbee/` directory
 *   3. platform-default directory
 *      - macOS:   ~/Library/Application Support/lilbee
 *      - Windows: %LOCALAPPDATA%/lilbee
 *      - Linux:   $XDG_DATA_HOME/lilbee (or ~/.local/share/lilbee)
 */
import { node } from "./binary-manager";
import { PLATFORM } from "./types";

const MAX_WALK_UP_DEPTH = 32;

export function getDefaultLilbeeDataRoot(): string | null {
    const home = process.env.HOME ?? process.env.USERPROFILE;
    if (!home) return null;

    if (process.platform === PLATFORM.DARWIN) {
        return `${home}/Library/Application Support/lilbee`;
    }
    if (process.platform === PLATFORM.WIN32) {
        const local = process.env.LOCALAPPDATA;
        return local ? `${local}/lilbee` : `${home}/AppData/Local/lilbee`;
    }
    const xdg = process.env.XDG_DATA_HOME;
    return xdg ? `${xdg}/lilbee` : `${home}/.local/share/lilbee`;
}

export function findLocalLilbeeRoot(startDir: string): string | null {
    let current = startDir;
    for (let i = 0; i < MAX_WALK_UP_DEPTH; i++) {
        const candidate = `${current}/.lilbee`;
        if (node.existsSync(candidate)) return candidate;
        const parent = current.replace(/[/\\][^/\\]+$/, "");
        if (!parent || parent === current) break;
        current = parent;
    }
    return null;
}

export function resolveExternalDataRoot(vaultPath: string | null): string | null {
    const envOverride = process.env.LILBEE_DATA;
    if (envOverride) return envOverride;
    if (vaultPath) {
        const local = findLocalLilbeeRoot(vaultPath);
        if (local) return local;
    }
    return getDefaultLilbeeDataRoot();
}

export function readSessionToken(dataRoot: string | null): string | null {
    if (!dataRoot) return null;
    const tokenPath = `${dataRoot}/data/server.json`;
    try {
        if (!node.existsSync(tokenPath)) return null;
        const content = node.readFileSync(tokenPath, "utf-8");
        const parsed = JSON.parse(content) as { token?: unknown };
        return typeof parsed.token === "string" ? parsed.token : null;
    } catch {
        return null;
    }
}
