import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { node } from "../src/binary-manager";
import {
    findLocalLilbeeRoot,
    getDefaultLilbeeDataRoot,
    readSessionToken,
    resolveExternalDataRoot,
} from "../src/session-token";

describe("session-token", () => {
    const originalEnv = { ...process.env };
    const originalPlatform = process.platform;

    beforeEach(() => {
        vi.restoreAllMocks();
    });

    afterEach(() => {
        process.env = { ...originalEnv };
        Object.defineProperty(process, "platform", { value: originalPlatform });
    });

    function setPlatform(p: NodeJS.Platform): void {
        Object.defineProperty(process, "platform", { value: p });
    }

    describe("getDefaultLilbeeDataRoot()", () => {
        it("returns macOS path when platform is darwin", () => {
            setPlatform("darwin");
            process.env.HOME = "/Users/alice";
            expect(getDefaultLilbeeDataRoot()).toBe("/Users/alice/Library/Application Support/lilbee");
        });

        it("returns null when no HOME or USERPROFILE is set", () => {
            setPlatform("darwin");
            delete process.env.HOME;
            delete process.env.USERPROFILE;
            expect(getDefaultLilbeeDataRoot()).toBeNull();
        });

        it("uses USERPROFILE as fallback when HOME is missing", () => {
            setPlatform("win32");
            delete process.env.HOME;
            process.env.USERPROFILE = "C:\\Users\\alice";
            delete process.env.LOCALAPPDATA;
            expect(getDefaultLilbeeDataRoot()).toBe("C:\\Users\\alice/AppData/Local/lilbee");
        });

        it("uses LOCALAPPDATA on windows when set", () => {
            setPlatform("win32");
            process.env.HOME = "C:\\Users\\alice";
            process.env.LOCALAPPDATA = "C:\\Users\\alice\\AppData\\Local";
            expect(getDefaultLilbeeDataRoot()).toBe("C:\\Users\\alice\\AppData\\Local/lilbee");
        });

        it("uses XDG_DATA_HOME on linux when set", () => {
            setPlatform("linux");
            process.env.HOME = "/home/alice";
            process.env.XDG_DATA_HOME = "/home/alice/xdg";
            expect(getDefaultLilbeeDataRoot()).toBe("/home/alice/xdg/lilbee");
        });

        it("falls back to ~/.local/share on linux when XDG is unset", () => {
            setPlatform("linux");
            process.env.HOME = "/home/alice";
            delete process.env.XDG_DATA_HOME;
            expect(getDefaultLilbeeDataRoot()).toBe("/home/alice/.local/share/lilbee");
        });
    });

    describe("findLocalLilbeeRoot()", () => {
        it("returns the nearest .lilbee directory walking up from startDir", () => {
            vi.spyOn(node, "existsSync").mockImplementation((p: unknown) => p === "/projects/notes/.lilbee");
            expect(findLocalLilbeeRoot("/projects/notes/daily")).toBe("/projects/notes/.lilbee");
        });

        it("returns null when walking reaches the filesystem root", () => {
            vi.spyOn(node, "existsSync").mockReturnValue(false);
            expect(findLocalLilbeeRoot("/some/deep/path")).toBeNull();
        });
    });

    describe("resolveExternalDataRoot()", () => {
        it("returns LILBEE_DATA when set", () => {
            process.env.LILBEE_DATA = "/custom/lilbee";
            expect(resolveExternalDataRoot("/vault")).toBe("/custom/lilbee");
        });

        it("returns the local .lilbee root when discovered", () => {
            delete process.env.LILBEE_DATA;
            vi.spyOn(node, "existsSync").mockImplementation((p: unknown) => p === "/vault/.lilbee");
            expect(resolveExternalDataRoot("/vault")).toBe("/vault/.lilbee");
        });

        it("falls back to the platform default when nothing else matches", () => {
            delete process.env.LILBEE_DATA;
            setPlatform("darwin");
            process.env.HOME = "/Users/alice";
            vi.spyOn(node, "existsSync").mockReturnValue(false);
            expect(resolveExternalDataRoot("/vault")).toBe("/Users/alice/Library/Application Support/lilbee");
        });

        it("skips local discovery when vaultPath is null", () => {
            delete process.env.LILBEE_DATA;
            setPlatform("darwin");
            process.env.HOME = "/Users/alice";
            const spy = vi.spyOn(node, "existsSync").mockReturnValue(false);
            expect(resolveExternalDataRoot(null)).toBe("/Users/alice/Library/Application Support/lilbee");
            expect(spy).not.toHaveBeenCalled();
        });
    });

    describe("readSessionToken()", () => {
        it("returns null when dataRoot is null", () => {
            expect(readSessionToken(null)).toBeNull();
        });

        it("reads and parses the token from {dataRoot}/data/server.json", () => {
            vi.spyOn(node, "existsSync").mockImplementation((p: unknown) => p === "/root/data/server.json");
            vi.spyOn(node, "readFileSync").mockImplementation((p: unknown) =>
                p === "/root/data/server.json" ? JSON.stringify({ token: "abc-123" }) : "",
            );
            expect(readSessionToken("/root")).toBe("abc-123");
        });

        it("returns null when the file does not exist", () => {
            vi.spyOn(node, "existsSync").mockReturnValue(false);
            expect(readSessionToken("/root")).toBeNull();
        });

        it("returns null when the file contents are not valid JSON", () => {
            vi.spyOn(node, "existsSync").mockReturnValue(true);
            vi.spyOn(node, "readFileSync").mockReturnValue("not json");
            expect(readSessionToken("/root")).toBeNull();
        });

        it("returns null when the JSON has no string token field", () => {
            vi.spyOn(node, "existsSync").mockReturnValue(true);
            vi.spyOn(node, "readFileSync").mockReturnValue(JSON.stringify({ other: "field" }));
            expect(readSessionToken("/root")).toBeNull();
        });

        it("returns null when readFileSync throws", () => {
            vi.spyOn(node, "existsSync").mockReturnValue(true);
            vi.spyOn(node, "readFileSync").mockImplementation(() => {
                throw new Error("EPERM");
            });
            expect(readSessionToken("/root")).toBeNull();
        });
    });
});
