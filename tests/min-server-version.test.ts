import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
    MIN_SERVER_VERSION,
    PLACEMENT_MIN_SERVER_VERSION,
    SESSION_EXPORT_MIN_SERVER_VERSION,
    SESSION_FORK_MIN_SERVER_VERSION,
    SESSIONS_MIN_SERVER_VERSION,
    higherVersion,
    isVersionOlder,
} from "../src/min-server-version";

const DECLARED_FLOOR_PATH = fileURLToPath(new URL("../min-server-version.json", import.meta.url));

describe("higherVersion", () => {
    it("returns the later version when a is older", () => {
        expect(higherVersion("0.6.66", "0.6.90b420")).toBe("0.6.90b420");
    });

    it("returns a when a is not older than b", () => {
        expect(higherVersion("0.6.90b420", "0.6.66")).toBe("0.6.90b420");
    });

    it("returns a on a tie", () => {
        expect(higherVersion("0.6.90b420", "0.6.90b420")).toBe("0.6.90b420");
    });
});

describe("MIN_SERVER_VERSION", () => {
    it("pins the later of the two per-feature floors", () => {
        expect(MIN_SERVER_VERSION).toBe(higherVersion(SESSIONS_MIN_SERVER_VERSION, PLACEMENT_MIN_SERVER_VERSION));
    });

    it("stays below the fork floor, so an older server keeps every other feature", () => {
        expect(isVersionOlder(MIN_SERVER_VERSION, SESSION_FORK_MIN_SERVER_VERSION)).toBe(true);
    });

    it("stays below the export floor, so an older server keeps every other feature", () => {
        expect(isVersionOlder(MIN_SERVER_VERSION, SESSION_EXPORT_MIN_SERVER_VERSION)).toBe(true);
    });

    // The release notes quote min-server-version.json. Nothing else keeps that file in
    // step with the per-feature constants above.
    it("matches the floor the store release workflow reads from min-server-version.json", () => {
        const declared = JSON.parse(readFileSync(DECLARED_FLOOR_PATH, "utf8")) as { minServerVersion: string };
        expect(declared.minServerVersion).toBe(MIN_SERVER_VERSION);
    });
});

describe("isVersionOlder: PEP 440 ordering (dev < a < b < rc < final < post)", () => {
    it.each([
        // [current, latest, current is older than latest]
        ["0.6.90b447", "0.6.90", true], // a final release ranks above its own betas
        ["0.6.90", "0.6.90b447", false],
        ["0.6.90rc1", "0.6.90b446", false], // rc ranks above beta
        ["0.6.90b446", "0.6.90rc1", true],
        ["0.6.91b1", "0.6.90", false], // a later release line ranks above an earlier final
        ["0.6.90", "0.6.91b1", true],
        ["0.6.90", "0.6.90.post1", true], // post ranks above final
        ["0.6.90.post1", "0.6.90", false],
        ["0.6.90b447.dev1", "0.6.90b447", true], // a dev preview has not shipped its own tag yet
        ["0.6.90b447", "0.6.90b447.dev1", false],
        ["0.6.90", "0.6.90", false], // ties are not older
        // A final release is never older than any of the plugin's beta floors.
        ["0.6.90", SESSIONS_MIN_SERVER_VERSION, false],
        ["0.6.90", PLACEMENT_MIN_SERVER_VERSION, false],
        ["0.6.90", SESSION_FORK_MIN_SERVER_VERSION, false],
        ["0.6.90", SESSION_EXPORT_MIN_SERVER_VERSION, false],
    ])("isVersionOlder(%s, %s) === %s", (current, latest, expected) => {
        expect(isVersionOlder(current, latest)).toBe(expected);
    });

    it("fails open (not older) for a version PEP 440 cannot parse", () => {
        expect(isVersionOlder("garbage", "0.6.90")).toBe(false);
        expect(isVersionOlder("0.6.90", "garbage")).toBe(false);
        expect(isVersionOlder("", "0.6.90")).toBe(false);
    });
});
