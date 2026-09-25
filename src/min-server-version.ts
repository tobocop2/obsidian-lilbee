import { compare, valid } from "@renovatebot/pep440";

/**
 * The plugin's minimum lilbee server version. The release workflow reads the
 * same floor from min-server-version.json; a test asserts the two agree.
 */

/**
 * True when `current` orders strictly before `latest` under PEP 440 ordering
 * (`.devN` < `aN` < `bN` < `rcN` < a final release < `.postN`), which is the
 * scheme lilbee's own version strings follow. Release segments compare
 * numerically, zero-padded to the longer length, so `0.6.90` equals `0.6.90.0`.
 * A version PEP 440 cannot parse fails open: never "older", so an unknown or
 * unparseable version never blocks a feature.
 */
export function isVersionOlder(current: string, latest: string): boolean {
    if (!valid(current) || !valid(latest)) return false;
    return compare(current, latest) < 0;
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
 * Oldest server whose /api/sessions/{id}/markdown route names the file in a Content-Disposition
 * header: release 0.6.90b447, which ships lilbee #902. Kept out of MIN_SERVER_VERSION so older
 * servers keep every other feature.
 */
export const SESSION_EXPORT_MIN_SERVER_VERSION = "0.6.90b447";

/** The plugin's real floor: the later of the sessions and placement minimums; the fork and export floors stay out. */
export const MIN_SERVER_VERSION = higherVersion(SESSIONS_MIN_SERVER_VERSION, PLACEMENT_MIN_SERVER_VERSION);
