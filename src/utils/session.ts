import { MESSAGES } from "../locales/en";
import { SEARCH_CHUNK_TYPE, type SearchChunkType } from "../types";

/** The server's `SearchScope` vocabulary. It says "both" where the plugin says "all". */
export type SessionScope = "raw" | "wiki" | "both";

export const SESSION_SCOPE = {
    RAW: "raw",
    WIKI: "wiki",
    BOTH: "both",
} as const satisfies Record<string, SessionScope>;

/** Longest auto-derived title before it gets an ellipsis. Matches the server's TITLE_MAX_LEN. */
export const SESSION_TITLE_MAX_LEN = 60;

const TITLE_ELLIPSIS = "…";

/** Translate the plugin's chunk-type selection into a scope the server can parse. */
export function scopeFromChunkType(chunk: SearchChunkType): SessionScope {
    return chunk === SEARCH_CHUNK_TYPE.ALL ? SESSION_SCOPE.BOTH : chunk;
}

/** Inverse of `scopeFromChunkType`. Null for a scope this build doesn't know. */
export function chunkTypeFromScope(scope: string): SearchChunkType | null {
    switch (scope) {
        case SESSION_SCOPE.BOTH:
            return SEARCH_CHUNK_TYPE.ALL;
        case SESSION_SCOPE.WIKI:
            return SEARCH_CHUNK_TYPE.WIKI;
        case SESSION_SCOPE.RAW:
            return SEARCH_CHUNK_TYPE.RAW;
        default:
            return null;
    }
}

/** Title a session from its first user message: first line, truncated. Mirrors `derive_title`. */
export function deriveSessionTitle(text: string): string {
    const stripped = text.trim();
    if (!stripped) return MESSAGES.SESSIONS_UNTITLED;
    const first = stripped.split(/\r\n|[\r\n]/)[0];
    if (first.length > SESSION_TITLE_MAX_LEN) return first.slice(0, SESSION_TITLE_MAX_LEN) + TITLE_ELLIPSIS;
    return first;
}
