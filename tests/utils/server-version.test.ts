import { describe, it, expect } from "vitest";
import { versionActionFor, versionButtonLabel, versionDescription } from "../../src/utils/server-version";
import { VERSION_ACTION } from "../../src/types";

const TAGS = ["v0.3.0", "v0.2.0", "v0.1.0"];

describe("versionActionFor", () => {
    it("reads the installed tag as a reinstall", () => {
        expect(versionActionFor(TAGS, "v0.2.0", "v0.2.0")).toBe(VERSION_ACTION.REINSTALL);
    });

    it("reads a newer tag as an update", () => {
        expect(versionActionFor(TAGS, "v0.2.0", "v0.3.0")).toBe(VERSION_ACTION.UPDATE);
    });

    it("reads an older tag as a downgrade", () => {
        expect(versionActionFor(TAGS, "v0.2.0", "v0.1.0")).toBe(VERSION_ACTION.DOWNGRADE);
    });

    it("falls back to a plain install when the installed tag is not in the list", () => {
        expect(versionActionFor(TAGS, "v0.0.9", "v0.1.0")).toBe(VERSION_ACTION.INSTALL);
    });

    it("falls back to a plain install when the selected tag is not in the list", () => {
        expect(versionActionFor(TAGS, "v0.2.0", "v9.9.9")).toBe(VERSION_ACTION.INSTALL);
    });
});

describe("versionButtonLabel", () => {
    it("names the action for every variant", () => {
        expect(versionButtonLabel(VERSION_ACTION.REINSTALL, "v0.2.0")).toBe("Reinstall");
        expect(versionButtonLabel(VERSION_ACTION.UPDATE, "v0.3.0")).toBe("Update to v0.3.0");
        expect(versionButtonLabel(VERSION_ACTION.DOWNGRADE, "v0.1.0")).toBe("Downgrade to v0.1.0");
        expect(versionButtonLabel(VERSION_ACTION.INSTALL, "v0.1.0")).toBe("Install v0.1.0");
    });
});

describe("versionDescription", () => {
    it("says nothing is known when no version is installed", () => {
        expect(versionDescription(VERSION_ACTION.INSTALL, "", "v0.1.0", false)).toBe("Unknown");
    });

    it("calls the installed-and-newest case the latest release", () => {
        expect(versionDescription(VERSION_ACTION.REINSTALL, "v0.3.0", "v0.3.0", true)).toBe(
            "v0.3.0 installed. This is the latest release.",
        );
    });

    it("points out newer releases when reinstalling an older build", () => {
        expect(versionDescription(VERSION_ACTION.REINSTALL, "v0.2.0", "v0.2.0", false)).toBe(
            "v0.2.0 installed. Newer releases are available.",
        );
    });

    it("names the available release when updating", () => {
        expect(versionDescription(VERSION_ACTION.UPDATE, "v0.2.0", "v0.3.0", false)).toBe(
            "v0.2.0 installed. v0.3.0 is available.",
        );
    });

    it("warns that a downgrade replaces the build", () => {
        expect(versionDescription(VERSION_ACTION.DOWNGRADE, "v0.2.0", "v0.1.0", false)).toBe(
            "v0.2.0 installed. Downgrading replaces it with an older build.",
        );
    });

    it("states the installed tag plainly for an unordered install", () => {
        expect(versionDescription(VERSION_ACTION.INSTALL, "v0.0.9", "v0.1.0", false)).toBe("v0.0.9 installed.");
    });
});
