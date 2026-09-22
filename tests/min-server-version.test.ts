import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
    MIN_SERVER_VERSION,
    PLACEMENT_MIN_SERVER_VERSION,
    SESSIONS_MIN_SERVER_VERSION,
    higherVersion,
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

    // The release notes quote min-server-version.json. Nothing else keeps that file in
    // step with the per-feature constants above.
    it("matches the floor the store release workflow reads from min-server-version.json", () => {
        const declared = JSON.parse(readFileSync(DECLARED_FLOOR_PATH, "utf8")) as { minServerVersion: string };
        expect(declared.minServerVersion).toBe(MIN_SERVER_VERSION);
    });
});
