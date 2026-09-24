/**
 * The plugin's minimum lilbee server version. The release workflow reads the
 * same floor from min-server-version.json; a test asserts the two agree.
 */

/**
 * True when `current` orders strictly before `latest` under the release scheme
 * ("0.6.66b507", "0.6.90b420.dev722"): every numeric run compares in sequence,
 * missing runs count as zero. A dev build ahead of the newest release is not older.
 */
export function isVersionOlder(current: string, latest: string): boolean {
    const runs = (v: string): number[] => (v.match(/\d+/g) ?? []).map(Number);
    const a = runs(current);
    const b = runs(latest);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const x = a[i] ?? 0;
        const y = b[i] ?? 0;
        if (x !== y) return x < y;
    }
    return false;
}

/** Whichever of the two versions orders later; ties keep `a`. */
export function higherVersion(a: string, b: string): string {
    return isVersionOlder(a, b) ? b : a;
}

/** Oldest server with the /api/sessions routes; the 0.6.66 stable line predates them. */
export const SESSIONS_MIN_SERVER_VERSION = "0.6.90b420";

/** Oldest server with the /api/placement routes; also new in the 0.6.90 line. */
export const PLACEMENT_MIN_SERVER_VERSION = "0.6.90b420";

/**
 * Oldest server with the /api/sessions/{id}/fork route: release 0.6.90b446, which ships
 * lilbee #890. Kept out of MIN_SERVER_VERSION so older servers keep every other feature.
 */
export const SESSION_FORK_MIN_SERVER_VERSION = "0.6.90b446";

/**
 * Oldest server with the /api/sessions/{id}/markdown route: release 0.6.90b446, which ships
 * lilbee #894. Kept out of MIN_SERVER_VERSION so older servers keep every other feature.
 */
export const SESSION_EXPORT_MIN_SERVER_VERSION = "0.6.90b446";

/** The plugin's real floor: the later of the sessions and placement minimums; the fork and export floors stay out. */
export const MIN_SERVER_VERSION = higherVersion(SESSIONS_MIN_SERVER_VERSION, PLACEMENT_MIN_SERVER_VERSION);
