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

/** A top-level key that names a credential (manualToken, hfToken, and any later apiKey or secret). */
const SECRET_KEY_PATTERN = /(token|api[_-]?key|apikey|secret|password)$/i;

/** Returns a copy of a settings or config object with credential fields blanked by key name. */
export function redactConfigKeys(config: Record<string, unknown>): Record<string, unknown> {
    const copy: Record<string, unknown> = { ...config };
    for (const [key, value] of Object.entries(copy)) {
        if (SECRET_KEY_PATTERN.test(key) && typeof value === "string" && value.length > 0) {
            copy[key] = REDACTED;
        }
    }
    return copy;
}

/** Returns a copy of the settings with credential fields blanked. */
export function redactSettings(settings: LilbeeSettings & Partial<SharedConfig>): Record<string, unknown> {
    return redactConfigKeys({ ...settings });
}
