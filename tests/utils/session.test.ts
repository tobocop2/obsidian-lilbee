import { describe, expect, it } from "vitest";
import {
    chunkTypeFromScope,
    deriveSessionTitle,
    scopeFromChunkType,
    SESSION_SCOPE,
    SESSION_TITLE_MAX_LEN,
} from "../../src/utils/session";
import { SEARCH_CHUNK_TYPE } from "../../src/types";
import { MESSAGES } from "../../src/locales/en";

describe("scopeFromChunkType", () => {
    it("maps the plugin's 'all' onto the server's 'both'", () => {
        expect(scopeFromChunkType(SEARCH_CHUNK_TYPE.ALL)).toBe(SESSION_SCOPE.BOTH);
    });

    it("passes the scopes that share a name straight through", () => {
        expect(scopeFromChunkType(SEARCH_CHUNK_TYPE.WIKI)).toBe(SESSION_SCOPE.WIKI);
        expect(scopeFromChunkType(SEARCH_CHUNK_TYPE.RAW)).toBe(SESSION_SCOPE.RAW);
    });
});

describe("chunkTypeFromScope", () => {
    it("inverts scopeFromChunkType for every chunk type", () => {
        for (const chunk of [SEARCH_CHUNK_TYPE.ALL, SEARCH_CHUNK_TYPE.WIKI, SEARCH_CHUNK_TYPE.RAW]) {
            expect(chunkTypeFromScope(scopeFromChunkType(chunk))).toBe(chunk);
        }
    });

    it("returns null for a scope this build doesn't know", () => {
        expect(chunkTypeFromScope("something-new")).toBeNull();
        expect(chunkTypeFromScope("")).toBeNull();
    });
});

describe("deriveSessionTitle", () => {
    it("uses the first line of the message", () => {
        expect(deriveSessionTitle("What is a bee?\nMore detail here")).toBe("What is a bee?");
    });

    it("trims surrounding whitespace", () => {
        expect(deriveSessionTitle("  spaced out  ")).toBe("spaced out");
    });

    it("falls back to the untitled label for a blank message", () => {
        expect(deriveSessionTitle("   \n  ")).toBe(MESSAGES.SESSIONS_UNTITLED);
        expect(deriveSessionTitle("")).toBe(MESSAGES.SESSIONS_UNTITLED);
    });

    it("truncates an over-long first line and marks it with an ellipsis", () => {
        const title = deriveSessionTitle("x".repeat(SESSION_TITLE_MAX_LEN + 10));
        expect(title).toBe("x".repeat(SESSION_TITLE_MAX_LEN) + "…");
        expect(title.length).toBe(SESSION_TITLE_MAX_LEN + 1);
    });

    it("leaves a line exactly at the limit alone", () => {
        const exact = "y".repeat(SESSION_TITLE_MAX_LEN);
        expect(deriveSessionTitle(exact)).toBe(exact);
    });
});
