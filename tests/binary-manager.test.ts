import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import type { StatsFs } from "fs";
import {
    node,
    getPlatformAssetName,
    getLatestRelease,
    checkForUpdate,
    detectCudaTag,
    BinaryManager,
} from "../src/binary-manager";

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

/** A statfs result with `freeBytes` available (block size 1 keeps the math simple). */
function fakeStatfs(freeBytes: number): StatsFs {
    return { bavail: freeBytes, bsize: 1 } as unknown as StatsFs;
}

/** Mock statfs to report plenty of free space. */
function stubEnoughSpace() {
    return vi.spyOn(node, "statfs").mockResolvedValue(fakeStatfs(10 ** 12));
}

/** Mock nvidia-smi as absent (no NVIDIA driver). */
function stubNoNvidia() {
    return vi.spyOn(node, "execFile").mockRejectedValue(new Error("nvidia-smi not found"));
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

    it("ignores a CUDA tag on macOS (no CUDA build exists)", () => {
        restore = stubPlatform("darwin", "arm64");
        expect(getPlatformAssetName("cu125")).toBe("lilbee-macos-arm64");
    });

    it("throws for Intel macOS (no published build)", () => {
        restore = stubPlatform("darwin", "x64");
        expect(() => getPlatformAssetName()).toThrow("Unsupported platform: darwin/x64");
    });

    it("returns the default linux x64 asset name", () => {
        restore = stubPlatform("linux", "x64");
        expect(getPlatformAssetName()).toBe("lilbee-linux-x86_64");
    });

    it("appends the CUDA tag on linux", () => {
        restore = stubPlatform("linux", "x64");
        expect(getPlatformAssetName("cu124")).toBe("lilbee-linux-x86_64-cu124");
    });

    it("returns the default windows x64 asset name", () => {
        restore = stubPlatform("win32", "x64");
        expect(getPlatformAssetName()).toBe("lilbee-windows-x86_64.exe");
    });

    it("appends the CUDA tag on windows before .exe", () => {
        restore = stubPlatform("win32", "x64");
        expect(getPlatformAssetName("cu125")).toBe("lilbee-windows-x86_64-cu125.exe");
    });

    it("throws for unsupported platform", () => {
        restore = stubPlatform("freebsd", "arm");
        expect(() => getPlatformAssetName()).toThrow("Unsupported platform: freebsd/arm");
    });
});

/* ------------------------------------------------------------------ */
/*  detectCudaTag                                                     */
/* ------------------------------------------------------------------ */

describe("detectCudaTag", () => {
    let restore: () => void;
    afterEach(() => restore?.());

    it("returns null on macOS without probing for a GPU", async () => {
        restore = stubPlatform("darwin", "arm64");
        const exec = vi.spyOn(node, "execFile");
        expect(await detectCudaTag()).toBeNull();
        expect(exec).not.toHaveBeenCalled();
    });

    it("returns null when nvidia-smi is absent", async () => {
        restore = stubPlatform("linux", "x64");
        stubNoNvidia();
        expect(await detectCudaTag()).toBeNull();
    });

    it("returns null when the CUDA version can't be parsed", async () => {
        restore = stubPlatform("linux", "x64");
        vi.spyOn(node, "execFile").mockResolvedValue({ stdout: "no version line here", stderr: "" });
        expect(await detectCudaTag()).toBeNull();
    });

    it.each([
        ["CUDA Version: 12.6", "cu125"],
        ["CUDA Version: 12.5", "cu125"],
        ["CUDA Version: 12.4", "cu124"],
        ["CUDA Version: 12.1", "cu121"],
    ])("maps driver line %s to %s", async (line, tag) => {
        restore = stubPlatform("linux", "x64");
        vi.spyOn(node, "execFile").mockResolvedValue({ stdout: `header | ${line} | rest`, stderr: "" });
        expect(await detectCudaTag()).toBe(tag);
    });

    it("returns null when the driver is too old for any shipped CUDA build", async () => {
        restore = stubPlatform("win32", "x64");
        vi.spyOn(node, "execFile").mockResolvedValue({ stdout: "CUDA Version: 11.8", stderr: "" });
        expect(await detectCudaTag()).toBeNull();
    });
});

/* ------------------------------------------------------------------ */
/*  getLatestRelease                                                  */
/* ------------------------------------------------------------------ */

describe("getLatestRelease", () => {
    let restore: () => void;
    afterEach(() => restore?.());

    it("returns the default build with size when no GPU is detected", async () => {
        restore = stubPlatform("linux", "x64");
        stubNoNvidia();
        vi.spyOn(node, "requestUrl").mockResolvedValue(
            releaseResponse({
                tag_name: "v1.0.0",
                assets: [{ name: "lilbee-linux-x86_64", browser_download_url: "https://e/dl", size: 1234 }],
            }),
        );

        expect(await getLatestRelease()).toEqual({
            tag: "v1.0.0",
            assetUrl: "https://e/dl",
            variant: "default",
            sizeBytes: 1234,
        });
    });

    it("prefers the CUDA build when a matching GPU is detected", async () => {
        restore = stubPlatform("linux", "x64");
        vi.spyOn(node, "execFile").mockResolvedValue({ stdout: "CUDA Version: 12.5", stderr: "" });
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        vi.spyOn(node, "requestUrl").mockResolvedValue(
            releaseResponse({
                tag_name: "v1.0.0",
                assets: [
                    { name: "lilbee-linux-x86_64", browser_download_url: "https://e/cpu", size: 10 },
                    { name: "lilbee-linux-x86_64-cu125", browser_download_url: "https://e/cu125", size: 20 },
                ],
            }),
        );

        expect(await getLatestRelease()).toEqual({
            tag: "v1.0.0",
            assetUrl: "https://e/cu125",
            variant: "cu125",
            sizeBytes: 20,
        });
        expect(warn).not.toHaveBeenCalled();
    });

    it("falls back to the default build (and warns) when the CUDA asset is missing from the release", async () => {
        restore = stubPlatform("linux", "x64");
        vi.spyOn(node, "execFile").mockResolvedValue({ stdout: "CUDA Version: 12.5", stderr: "" });
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        vi.spyOn(node, "requestUrl").mockResolvedValue(
            releaseResponse({
                tag_name: "v1.0.0",
                assets: [{ name: "lilbee-linux-x86_64", browser_download_url: "https://e/cpu", size: 10 }],
            }),
        );

        expect(await getLatestRelease()).toEqual({
            tag: "v1.0.0",
            assetUrl: "https://e/cpu",
            variant: "default",
            sizeBytes: 10,
        });
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("GPU detected (cu125)"));
    });

    it("throws when GitHub API returns error status", async () => {
        vi.spyOn(node, "requestUrl").mockResolvedValue({
            status: 403,
            json: {},
            arrayBuffer: new ArrayBuffer(0),
            headers: {},
        });

        await expect(getLatestRelease()).rejects.toThrow("GitHub API responded 403");
    });

    it("throws when the default asset is not in the release", async () => {
        restore = stubPlatform("darwin", "arm64");
        vi.spyOn(node, "requestUrl").mockResolvedValue(
            releaseResponse({
                tag_name: "v2.0.0",
                assets: [{ name: "some-other-asset", browser_download_url: "https://e/other", size: 1 }],
            }),
        );

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
            const mgr = new BinaryManager("/plugins/lilbee/bin");
            expect(mgr.binaryPath).toContain("lilbee");
            expect(mgr.binaryPath).not.toContain(".exe");
            expect(mgr.binaryPath).toBe("/plugins/lilbee/bin/lilbee");
        });

        it("returns .exe binary path on win32", () => {
            restore = stubPlatform("win32", "x64");
            const mgr = new BinaryManager("/plugins/lilbee/bin");
            expect(mgr.binaryPath).toContain("lilbee.exe");
        });
    });

    describe("binaryExists", () => {
        it("returns true when binary file exists", () => {
            restore = stubPlatform("darwin", "arm64");
            vi.spyOn(node, "existsSync").mockReturnValue(true);
            const mgr = new BinaryManager("/plugins/lilbee/bin");
            expect(mgr.binaryExists()).toBe(true);
        });

        it("returns false when binary file does not exist", () => {
            restore = stubPlatform("darwin", "arm64");
            vi.spyOn(node, "existsSync").mockReturnValue(false);
            const mgr = new BinaryManager("/plugins/lilbee/bin");
            expect(mgr.binaryExists()).toBe(false);
        });
    });

    describe("ensureBinary", () => {
        it("returns path immediately when binary already exists", async () => {
            restore = stubPlatform("darwin", "arm64");
            vi.spyOn(node, "existsSync").mockReturnValue(true);
            const mgr = new BinaryManager("/plugins/lilbee/bin");
            const path = await mgr.ensureBinary();
            expect(path).toBe(mgr.binaryPath);
        });

        it("downloads binary when it does not exist", async () => {
            restore = stubPlatform("darwin", "arm64");
            const mgr = new BinaryManager("/plugins/lilbee/bin");
            const data = new Uint8Array([1, 2, 3]);

            // existsSync: first call (binaryExists) => false, second call (binDir check in download) => true
            vi.spyOn(node, "existsSync").mockReturnValueOnce(false).mockReturnValueOnce(true);
            stubEnoughSpace();
            vi.spyOn(node, "requestUrl")
                .mockResolvedValueOnce(
                    releaseResponse({
                        tag_name: "v1.0.0",
                        assets: [
                            {
                                name: "lilbee-macos-arm64",
                                browser_download_url: "https://example.com/dl",
                                size: 3,
                            },
                        ],
                    }),
                )
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
            vi.spyOn(node, "mkdirSync").mockImplementation(() => undefined as never);
            stubEnoughSpace();
            vi.spyOn(node, "requestUrl").mockResolvedValue(downloadResponse(data));
            vi.spyOn(node, "writeFileSync").mockImplementation(() => {});
            vi.spyOn(node, "chmodSync").mockImplementation(() => {});

            const mgr = new BinaryManager("/plugins/lilbee/bin");
            await mgr.download("https://example.com/dl", 2);

            expect(node.mkdirSync).toHaveBeenCalledWith(expect.stringContaining("bin"), { recursive: true });
        });

        it("skips mkdir when binDir already exists", async () => {
            restore = stubPlatform("linux", "x64");
            const data = new Uint8Array([10, 20]);

            vi.spyOn(node, "existsSync").mockReturnValue(true);
            vi.spyOn(node, "mkdirSync").mockImplementation(() => undefined as never);
            stubEnoughSpace();
            vi.spyOn(node, "requestUrl").mockResolvedValue(downloadResponse(data));
            vi.spyOn(node, "writeFileSync").mockImplementation(() => {});
            vi.spyOn(node, "chmodSync").mockImplementation(() => {});

            const mgr = new BinaryManager("/plugins/lilbee/bin");
            await mgr.download("https://example.com/dl", 2);

            expect(node.mkdirSync).not.toHaveBeenCalled();
        });

        it("throws and skips the fetch when there isn't enough disk space", async () => {
            restore = stubPlatform("linux", "x64");
            vi.spyOn(node, "existsSync").mockReturnValue(true);
            vi.spyOn(node, "statfs").mockResolvedValue(fakeStatfs(500 * 1024 ** 2)); // 500 MB free
            const reqSpy = vi.spyOn(node, "requestUrl");
            const writeSpy = vi.spyOn(node, "writeFileSync").mockImplementation(() => {});

            const mgr = new BinaryManager("/plugins/lilbee/bin");
            // A 1 GB asset needs ~1.5 GB; the message reports GB for the requirement and MB for the free space.
            await expect(mgr.download("https://example.com/dl", 1024 ** 3)).rejects.toThrow(
                /need about 1\.5 GB free, but only 500 MB is available/,
            );
            expect(reqSpy).not.toHaveBeenCalled();
            expect(writeSpy).not.toHaveBeenCalled();
        });

        it("writes binary data and calls chmod on non-win32", async () => {
            restore = stubPlatform("linux", "x64");
            const data = new Uint8Array([1, 2, 3, 4, 5, 6]);

            vi.spyOn(node, "existsSync").mockReturnValue(true);
            stubEnoughSpace();
            vi.spyOn(node, "requestUrl").mockResolvedValue(downloadResponse(data));
            vi.spyOn(node, "writeFileSync").mockImplementation(() => {});
            vi.spyOn(node, "chmodSync").mockImplementation(() => {});

            const onProgress = vi.fn();
            const mgr = new BinaryManager("/plugins/lilbee/bin");
            await mgr.download("https://example.com/dl", 6, onProgress);

            expect(node.writeFileSync).toHaveBeenCalledWith(mgr.binaryPath, expect.any(Buffer));
            const writtenBuffer = (node.writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0][1] as Buffer;
            expect([...writtenBuffer]).toEqual([1, 2, 3, 4, 5, 6]);
            expect(node.chmodSync).toHaveBeenCalledWith(mgr.binaryPath, 0o755);
            expect(onProgress).toHaveBeenCalledWith("Downloading...", expect.any(String));
            expect(onProgress).toHaveBeenCalledWith("Download complete.", expect.any(String));
        });

        it("removes a half-written binary when the write fails", async () => {
            restore = stubPlatform("linux", "x64");
            vi.spyOn(node, "existsSync").mockReturnValue(true);
            stubEnoughSpace();
            vi.spyOn(node, "requestUrl").mockResolvedValue(downloadResponse(new Uint8Array([1, 2])));
            vi.spyOn(node, "writeFileSync").mockImplementation(() => {
                throw new Error("ENOSPC");
            });
            const unlinkSpy = vi.spyOn(node, "unlinkSync").mockImplementation(() => {});

            const mgr = new BinaryManager("/plugins/lilbee/bin");
            await expect(mgr.download("https://example.com/dl", 2)).rejects.toThrow("ENOSPC");
            expect(unlinkSpy).toHaveBeenCalledWith(mgr.binaryPath);
        });

        it("rethrows a write failure without unlinking when nothing was written", async () => {
            restore = stubPlatform("linux", "x64");
            // binDir exists (1st existsSync), dest missing in the catch (2nd existsSync)
            vi.spyOn(node, "existsSync").mockReturnValueOnce(true).mockReturnValueOnce(false);
            stubEnoughSpace();
            vi.spyOn(node, "requestUrl").mockResolvedValue(downloadResponse(new Uint8Array([1])));
            vi.spyOn(node, "writeFileSync").mockImplementation(() => {
                throw new Error("boom");
            });
            const unlinkSpy = vi.spyOn(node, "unlinkSync").mockImplementation(() => {});

            const mgr = new BinaryManager("/plugins/lilbee/bin");
            await expect(mgr.download("https://example.com/dl", 1)).rejects.toThrow("boom");
            expect(unlinkSpy).not.toHaveBeenCalled();
        });

        it("calls xattr on darwin", async () => {
            restore = stubPlatform("darwin", "arm64");
            const data = new Uint8Array([1]);

            vi.spyOn(node, "existsSync").mockReturnValue(true);
            stubEnoughSpace();
            vi.spyOn(node, "requestUrl").mockResolvedValue(downloadResponse(data));
            vi.spyOn(node, "writeFileSync").mockImplementation(() => {});
            vi.spyOn(node, "chmodSync").mockImplementation(() => {});
            const execSpy = vi.spyOn(node, "execFile").mockResolvedValue({ stdout: "", stderr: "" });

            const mgr = new BinaryManager("/plugins/lilbee/bin");
            await mgr.download("https://example.com/dl", 1);

            expect(execSpy).toHaveBeenCalledWith("xattr", ["-cr", mgr.binaryPath]);
        });

        it("treats xattr failure as non-fatal on darwin", async () => {
            restore = stubPlatform("darwin", "arm64");
            const data = new Uint8Array([1]);

            vi.spyOn(node, "existsSync").mockReturnValue(true);
            stubEnoughSpace();
            vi.spyOn(node, "requestUrl").mockResolvedValue(downloadResponse(data));
            vi.spyOn(node, "writeFileSync").mockImplementation(() => {});
            vi.spyOn(node, "chmodSync").mockImplementation(() => {});
            vi.spyOn(node, "execFile").mockRejectedValue(new Error("xattr not found"));

            const mgr = new BinaryManager("/plugins/lilbee/bin");
            await expect(mgr.download("https://example.com/dl", 1)).resolves.toBeUndefined();
        });

        it("skips chmod on win32", async () => {
            restore = stubPlatform("win32", "x64");
            const data = new Uint8Array([1]);

            vi.spyOn(node, "existsSync").mockReturnValue(true);
            stubEnoughSpace();
            vi.spyOn(node, "requestUrl").mockResolvedValue(downloadResponse(data));
            vi.spyOn(node, "writeFileSync").mockImplementation(() => {});
            vi.spyOn(node, "chmodSync").mockImplementation(() => {});

            const mgr = new BinaryManager("/plugins/lilbee/bin");
            await mgr.download("https://example.com/dl", 1);

            expect(node.chmodSync).not.toHaveBeenCalled();
        });

        it("does not call xattr on non-darwin platforms", async () => {
            restore = stubPlatform("linux", "x64");
            const data = new Uint8Array([1]);

            vi.spyOn(node, "existsSync").mockReturnValue(true);
            stubEnoughSpace();
            vi.spyOn(node, "requestUrl").mockResolvedValue(downloadResponse(data));
            vi.spyOn(node, "writeFileSync").mockImplementation(() => {});
            vi.spyOn(node, "chmodSync").mockImplementation(() => {});
            const execSpy = vi.spyOn(node, "execFile").mockResolvedValue({ stdout: "", stderr: "" });

            const mgr = new BinaryManager("/plugins/lilbee/bin");
            await mgr.download("https://example.com/dl", 1);

            expect(execSpy).not.toHaveBeenCalled();
        });

        it("throws when download response has error status", async () => {
            restore = stubPlatform("linux", "x64");
            vi.spyOn(node, "existsSync").mockReturnValue(true);
            stubEnoughSpace();
            vi.spyOn(node, "requestUrl").mockResolvedValue({
                status: 404,
                json: {},
                arrayBuffer: new ArrayBuffer(0),
                headers: {},
            });

            const mgr = new BinaryManager("/plugins/lilbee/bin");
            await expect(mgr.download("https://example.com/dl", 1)).rejects.toThrow("Download failed: 404");
        });

        it("works without onProgress callback", async () => {
            restore = stubPlatform("linux", "x64");
            const data = new Uint8Array([1]);

            vi.spyOn(node, "existsSync").mockReturnValue(true);
            stubEnoughSpace();
            vi.spyOn(node, "requestUrl").mockResolvedValue(downloadResponse(data));
            vi.spyOn(node, "writeFileSync").mockImplementation(() => {});
            vi.spyOn(node, "chmodSync").mockImplementation(() => {});

            const mgr = new BinaryManager("/plugins/lilbee/bin");
            await expect(mgr.download("https://example.com/dl", 1)).resolves.toBeUndefined();
        });
    });
});
