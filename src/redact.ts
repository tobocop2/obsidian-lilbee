import type { LilbeeSettings, SharedConfig } from "./types";

export const REDACTED = "[redacted]";

/** Key-value pairs whose key smells like a credential, in TOML/JSON/header shapes. */
const SECRET_LINE_PATTERNS: RegExp[] = [
    /\b((?:\w+[_-])?(?:token|api[_-]?key|apikey|secret)\s*[:=]\s*["']?)(?:bearer\s+)?[^"'\s]+/gi,
    /\b(authorization\s*[:=]\s*["']?)(?:bearer\s+)?[^"'\s]+/gi,
];

/** Blanks credential values in log/config text while keeping line shape. */
export function redactSecrets(text: string): string {
    let out = text;
    for (const pattern of SECRET_LINE_PATTERNS) {
        out = out.replace(pattern, `$1${REDACTED}`);
    }
    return out;
}

const SECRET_SETTING_KEYS = ["manualToken", "hfToken"] as const;

/**
 * Returns a copy of a settings or config object with credential fields blanked.
 * These keys carry no word boundary before "token", so redactSecrets does not
 * reach them; JSON files holding them must go through this instead.
 */
export function redactConfigKeys(config: Record<string, unknown>): Record<string, unknown> {
    const copy: Record<string, unknown> = { ...config };
    for (const key of SECRET_SETTING_KEYS) {
        if (typeof copy[key] === "string" && copy[key].length > 0) {
            copy[key] = REDACTED;
        }
    }
    return copy;
}

/** Returns a copy of the settings with credential fields blanked. */
export function redactSettings(settings: LilbeeSettings & Partial<SharedConfig>): Record<string, unknown> {
    return redactConfigKeys({ ...settings });
}
