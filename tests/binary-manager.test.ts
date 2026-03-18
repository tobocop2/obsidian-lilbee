import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { node, getPlatformAssetName, getLatestRelease, checkForUpdate, BinaryManager } from "../src/binary-manager";

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/** Stub process.platform and process.arch, returning a restore function. */
function stubPlatform(platform: string, arch: string) {
    const origPlatform = Object.getOwnPropertyDescriptor(process, "platform")!;
    const origArch = Object.getOwnPropertyDescriptor(process, "arch")!;
    Object.defineProperty(process, "platform", { value: platform, configurable: true });
    Object.defineProperty(process, "arch", { value: arch, configurable: true });
    return () => {
        Object.defineProperty(process, "platform", origPlatform);
        Object.defineProperty(process, "arch", origArch);
    };
}

/** Build a fake requestUrl response for release API calls. */
function releaseResponse(json: unknown) {
    return { status: 200, json, arrayBuffer: new ArrayBuffer(0), headers: {} };
}

/** Build a fake requestUrl response for binary download. */
function downloadResponse(data: Uint8Array) {
    return { status: 200, json: {}, arrayBuffer: data.buffer, headers: {} };
}

/* ------------------------------------------------------------------ */
/*  Setup / Teardown                                                  */
/* ------------------------------------------------------------------ */

beforeEach(() => {
    vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ */
/*  getPlatformAssetName                                              */
/* ------------------------------------------------------------------ */

describe("getPlatformAssetName", () => {
    let restore: () => void;
    afterEach(() => restore?.());

    it("returns arm64 macOS asset name", () => {
        restore = stubPlatform("darwin", "arm64");
        expect(getPlatformAssetName()).toBe("lilbee-macos-arm64");
    });

    it("returns x64 macOS asset name", () => {
        restore = stubPlatform("darwin", "x64");
        expect(getPlatformAssetName()).toBe("lilbee-macos-x86_64");
    });

    it("returns linux x64 asset name", () => {
        restore = stubPlatform("linux", "x64");
        expect(getPlatformAssetName()).toBe("lilbee-linux-x86_64");
    });

    it("returns windows x64 asset name", () => {
        restore = stubPlatform("win32", "x64");
        expect(getPlatformAssetName()).toBe("lilbee-windows-x86_64.exe");
    });

    it("throws for unsupported platform", () => {
        restore = stubPlatform("freebsd", "arm");
        expect(() => getPlatformAssetName()).toThrow("Unsupported platform: freebsd/arm");
    });
});

/* ------------------------------------------------------------------ */
/*  getLatestRelease                                                  */
/* ------------------------------------------------------------------ */

describe("getLatestRelease", () => {
    let restore: () => void;
    afterEach(() => restore?.());

    it("returns tag and assetUrl on success", async () => {
        restore = stubPlatform("darwin", "arm64");
        vi.spyOn(node, "requestUrl").mockResolvedValue(releaseResponse({
            tag_name: "v1.0.0",
            assets: [{ name: "lilbee-macos-arm64", browser_download_url: "https://example.com/download" }],
        }));

        const release = await getLatestRelease();
        expect(release).toEqual({ tag: "v1.0.0", assetUrl: "https://example.com/download" });
    });

    it("throws when GitHub API returns error status", async () => {
        vi.spyOn(node, "requestUrl").mockResolvedValue({
            status: 403, json: {}, arrayBuffer: new ArrayBuffer(0), headers: {},
        });

        await expect(getLatestRelease()).rejects.toThrow("GitHub API responded 403");
    });

    it("throws when asset is not found in release", async () => {
        restore = stubPlatform("darwin", "arm64");
        vi.spyOn(node, "requestUrl").mockResolvedValue(releaseResponse({
            tag_name: "v2.0.0",
            assets: [{ name: "some-other-asset", browser_download_url: "https://example.com/other" }],
        }));

        await expect(getLatestRelease()).rejects.toThrow('No asset "lilbee-macos-arm64" in release v2.0.0');
    });
});

/* ------------------------------------------------------------------ */
/*  checkForUpdate                                                    */
/* ------------------------------------------------------------------ */

describe("checkForUpdate", () => {
    it("returns true when versions differ", () => {
        expect(checkForUpdate("v1.0.0", "v2.0.0")).toBe(true);
    });

    it("returns false when versions are the same", () => {
        expect(checkForUpdate("v1.0.0", "v1.0.0")).toBe(false);
    });

    it("returns false when latest tag is empty", () => {
        expect(checkForUpdate("v1.0.0", "")).toBe(false);
    });
});

/* ------------------------------------------------------------------ */
/*  BinaryManager                                                     */
/* ------------------------------------------------------------------ */

describe("BinaryManager", () => {
    let restore: () => void;
    afterEach(() => restore?.());

    describe("binaryPath", () => {
        it("returns unix binary path on non-win32", () => {
            restore = stubPlatform("darwin", "arm64");
            const mgr = new BinaryManager("/plugins/lilbee");
            expect(mgr.binaryPath).toContain("lilbee");
            expect(mgr.binaryPath).not.toContain(".exe");
            expect(mgr.binaryPath).toBe("/plugins/lilbee/bin/lilbee");
        });

        it("returns .exe binary path on win32", () => {
            restore = stubPlatform("win32", "x64");
            const mgr = new BinaryManager("/plugins/lilbee");
            expect(mgr.binaryPath).toContain("lilbee.exe");
        });
    });

    describe("binaryExists", () => {
        it("returns true when binary file exists", () => {
            restore = stubPlatform("darwin", "arm64");
            vi.spyOn(node, "existsSync").mockReturnValue(true);
            const mgr = new BinaryManager("/plugins/lilbee");
            expect(mgr.binaryExists()).toBe(true);
        });

        it("returns false when binary file does not exist", () => {
            restore = stubPlatform("darwin", "arm64");
            vi.spyOn(node, "existsSync").mockReturnValue(false);
            const mgr = new BinaryManager("/plugins/lilbee");
            expect(mgr.binaryExists()).toBe(false);
        });
    });

    describe("ensureBinary", () => {
        it("returns path immediately when binary already exists", async () => {
            restore = stubPlatform("darwin", "arm64");
            vi.spyOn(node, "existsSync").mockReturnValue(true);
            const mgr = new BinaryManager("/plugins/lilbee");
            const path = await mgr.ensureBinary();
            expect(path).toBe(mgr.binaryPath);
        });

        it("downloads binary when it does not exist", async () => {
            restore = stubPlatform("darwin", "arm64");
            const mgr = new BinaryManager("/plugins/lilbee");
            const data = new Uint8Array([1, 2, 3]);

            // existsSync: first call (binaryExists) => false, second call (binDir check in download) => true
            vi.spyOn(node, "existsSync").mockReturnValueOnce(false).mockReturnValueOnce(true);
            vi.spyOn(node, "requestUrl")
                .mockResolvedValueOnce(releaseResponse({
                    tag_name: "v1.0.0",
                    assets: [{ name: "lilbee-macos-arm64", browser_download_url: "https://example.com/dl" }],
                }))
                .mockResolvedValueOnce(downloadResponse(data));
            vi.spyOn(node, "writeFileSync").mockImplementation(() => {});
            vi.spyOn(node, "chmodSync").mockImplementation(() => {});
            vi.spyOn(node, "execFile").mockResolvedValue({ stdout: "", stderr: "" });

            const onProgress = vi.fn();
            const path = await mgr.ensureBinary(onProgress);

            expect(path).toBe(mgr.binaryPath);
            expect(onProgress).toHaveBeenCalledWith("Fetching latest release info...");
            expect(onProgress).toHaveBeenCalledWith("Downloading...", expect.any(String));
            expect(onProgress).toHaveBeenCalledWith("Download complete.", expect.any(String));
        });
    });

    describe("download", () => {
        it("creates binDir when it does not exist", async () => {
            restore = stubPlatform("linux", "x64");
            const data = new Uint8Array([10, 20]);

            vi.spyOn(node, "existsSync").mockReturnValue(false);
            vi.spyOn(node, "mkdirSync").mockImplementation(() => undefined as any);
            vi.spyOn(node, "requestUrl").mockResolvedValue(downloadResponse(data));
            vi.spyOn(node, "writeFileSync").mockImplementation(() => {});
            vi.spyOn(node, "chmodSync").mockImplementation(() => {});

            const mgr = new BinaryManager("/plugins/lilbee");
            await mgr.download("https://example.com/dl");

            expect(node.mkdirSync).toHaveBeenCalledWith(expect.stringContaining("bin"), { recursive: true });
        });

        it("skips mkdir when binDir already exists", async () => {
            restore = stubPlatform("linux", "x64");
            const data = new Uint8Array([10, 20]);

            vi.spyOn(node, "existsSync").mockReturnValue(true);
            vi.spyOn(node, "mkdirSync").mockImplementation(() => undefined as any);
            vi.spyOn(node, "requestUrl").mockResolvedValue(downloadResponse(data));
            vi.spyOn(node, "writeFileSync").mockImplementation(() => {});
            vi.spyOn(node, "chmodSync").mockImplementation(() => {});

            const mgr = new BinaryManager("/plugins/lilbee");
            await mgr.download("https://example.com/dl");

            expect(node.mkdirSync).not.toHaveBeenCalled();
        });

        it("writes binary data and calls chmod on non-win32", async () => {
            restore = stubPlatform("linux", "x64");
            const data = new Uint8Array([1, 2, 3, 4, 5, 6]);

            vi.spyOn(node, "existsSync").mockReturnValue(true);
            vi.spyOn(node, "requestUrl").mockResolvedValue(downloadResponse(data));
            vi.spyOn(node, "writeFileSync").mockImplementation(() => {});
            vi.spyOn(node, "chmodSync").mockImplementation(() => {});

            const onProgress = vi.fn();
            const mgr = new BinaryManager("/plugins/lilbee");
            await mgr.download("https://example.com/dl", onProgress);

            expect(node.writeFileSync).toHaveBeenCalledWith(mgr.binaryPath, expect.any(Buffer));
            const writtenBuffer = (node.writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0][1] as Buffer;
            expect([...writtenBuffer]).toEqual([1, 2, 3, 4, 5, 6]);
            expect(node.chmodSync).toHaveBeenCalledWith(mgr.binaryPath, 0o755);
            expect(onProgress).toHaveBeenCalledWith("Downloading...", expect.any(String));
            expect(onProgress).toHaveBeenCalledWith("Download complete.", expect.any(String));
        });

        it("calls xattr on darwin", async () => {
            restore = stubPlatform("darwin", "arm64");
            const data = new Uint8Array([1]);

            vi.spyOn(node, "existsSync").mockReturnValue(true);
            vi.spyOn(node, "requestUrl").mockResolvedValue(downloadResponse(data));
            vi.spyOn(node, "writeFileSync").mockImplementation(() => {});
            vi.spyOn(node, "chmodSync").mockImplementation(() => {});
            const execSpy = vi.spyOn(node, "execFile").mockResolvedValue({ stdout: "", stderr: "" });

            const mgr = new BinaryManager("/plugins/lilbee");
            await mgr.download("https://example.com/dl");

            expect(execSpy).toHaveBeenCalledWith("xattr", ["-cr", mgr.binaryPath]);
        });

        it("treats xattr failure as non-fatal on darwin", async () => {
            restore = stubPlatform("darwin", "arm64");
            const data = new Uint8Array([1]);

            vi.spyOn(node, "existsSync").mockReturnValue(true);
            vi.spyOn(node, "requestUrl").mockResolvedValue(downloadResponse(data));
            vi.spyOn(node, "writeFileSync").mockImplementation(() => {});
            vi.spyOn(node, "chmodSync").mockImplementation(() => {});
            vi.spyOn(node, "execFile").mockRejectedValue(new Error("xattr not found"));

            const mgr = new BinaryManager("/plugins/lilbee");
            // Should not throw
            await expect(mgr.download("https://example.com/dl")).resolves.toBeUndefined();
        });

        it("skips chmod on win32", async () => {
            restore = stubPlatform("win32", "x64");
            const data = new Uint8Array([1]);

            vi.spyOn(node, "existsSync").mockReturnValue(true);
            vi.spyOn(node, "requestUrl").mockResolvedValue(downloadResponse(data));
            vi.spyOn(node, "writeFileSync").mockImplementation(() => {});
            vi.spyOn(node, "chmodSync").mockImplementation(() => {});

            const mgr = new BinaryManager("/plugins/lilbee");
            await mgr.download("https://example.com/dl");

            expect(node.chmodSync).not.toHaveBeenCalled();
        });

        it("does not call xattr on non-darwin platforms", async () => {
            restore = stubPlatform("linux", "x64");
            const data = new Uint8Array([1]);

            vi.spyOn(node, "existsSync").mockReturnValue(true);
            vi.spyOn(node, "requestUrl").mockResolvedValue(downloadResponse(data));
            vi.spyOn(node, "writeFileSync").mockImplementation(() => {});
            vi.spyOn(node, "chmodSync").mockImplementation(() => {});
            const execSpy = vi.spyOn(node, "execFile").mockResolvedValue({ stdout: "", stderr: "" });

            const mgr = new BinaryManager("/plugins/lilbee");
            await mgr.download("https://example.com/dl");

            expect(execSpy).not.toHaveBeenCalled();
        });

        it("throws when download response has error status", async () => {
            restore = stubPlatform("linux", "x64");
            vi.spyOn(node, "existsSync").mockReturnValue(true);
            vi.spyOn(node, "requestUrl").mockResolvedValue({
                status: 404, json: {}, arrayBuffer: new ArrayBuffer(0), headers: {},
            });

            const mgr = new BinaryManager("/plugins/lilbee");
            await expect(mgr.download("https://example.com/dl")).rejects.toThrow("Download failed: 404");
        });

        it("works without onProgress callback", async () => {
            restore = stubPlatform("linux", "x64");
            const data = new Uint8Array([1]);

            vi.spyOn(node, "existsSync").mockReturnValue(true);
            vi.spyOn(node, "requestUrl").mockResolvedValue(downloadResponse(data));
            vi.spyOn(node, "writeFileSync").mockImplementation(() => {});
            vi.spyOn(node, "chmodSync").mockImplementation(() => {});

            const mgr = new BinaryManager("/plugins/lilbee");
            // No onProgress — should not throw
            await expect(mgr.download("https://example.com/dl")).resolves.toBeUndefined();
        });
    });
});
