import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { node, getPlatformAssetName, getLatestRelease, checkForUpdate, BinaryManager } from "../src/binary-manager";
import { EventEmitter } from "events";

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

/** Create a mock ReadableStream reader that yields the given Uint8Array chunks. */
function mockReader(chunks: Uint8Array[]) {
    let index = 0;
    return {
        read: vi.fn(async () => {
            if (index < chunks.length) {
                return { done: false, value: chunks[index++] };
            }
            return { done: true, value: undefined };
        }),
    };
}

/** Create a mock file stream (EventEmitter with write/end). Emits "finish" on end(). */
function mockFileStream() {
    const emitter = new EventEmitter();
    const stream = Object.assign(emitter, {
        write: vi.fn(),
        end: vi.fn(() => {
            // Emit finish asynchronously so the promise handler is registered first
            queueMicrotask(() => emitter.emit("finish"));
        }),
    });
    return stream;
}

/** Build a fake fetch Response for download tests. */
function downloadResponse(chunks: Uint8Array[], contentLength?: number): Response {
    const headers = new Headers();
    if (contentLength !== undefined) {
        headers.set("content-length", String(contentLength));
    }
    return {
        ok: true,
        status: 200,
        headers,
        body: { getReader: () => mockReader(chunks) },
    } as unknown as Response;
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
        vi.spyOn(node, "fetch").mockResolvedValue({
            ok: true,
            json: () =>
                Promise.resolve({
                    tag_name: "v1.0.0",
                    assets: [{ name: "lilbee-macos-arm64", browser_download_url: "https://example.com/download" }],
                }),
        } as unknown as Response);

        const release = await getLatestRelease();
        expect(release).toEqual({ tag: "v1.0.0", assetUrl: "https://example.com/download" });
    });

    it("throws when GitHub API returns non-ok response", async () => {
        vi.spyOn(node, "fetch").mockResolvedValue({
            ok: false,
            status: 403,
        } as unknown as Response);

        await expect(getLatestRelease()).rejects.toThrow("GitHub API responded 403");
    });

    it("throws when asset is not found in release", async () => {
        restore = stubPlatform("darwin", "arm64");
        vi.spyOn(node, "fetch").mockResolvedValue({
            ok: true,
            json: () =>
                Promise.resolve({
                    tag_name: "v2.0.0",
                    assets: [{ name: "some-other-asset", browser_download_url: "https://example.com/other" }],
                }),
        } as unknown as Response);

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
            const chunk = new Uint8Array([1, 2, 3]);
            const fStream = mockFileStream();

            // existsSync: first call (binaryExists) => false, second call (binDir check in download) => true
            vi.spyOn(node, "existsSync").mockReturnValueOnce(false).mockReturnValueOnce(true);
            vi.spyOn(node, "fetch")
                .mockResolvedValueOnce({
                    ok: true,
                    json: () =>
                        Promise.resolve({
                            tag_name: "v1.0.0",
                            assets: [{ name: "lilbee-macos-arm64", browser_download_url: "https://example.com/dl" }],
                        }),
                } as unknown as Response)
                .mockResolvedValueOnce(downloadResponse([chunk]));
            vi.spyOn(node, "createWriteStream").mockReturnValue(fStream as any);
            vi.spyOn(node, "chmodSync").mockImplementation(() => {});
            vi.spyOn(node, "execFile").mockResolvedValue({ stdout: "", stderr: "" });

            const onProgress = vi.fn();
            const path = await mgr.ensureBinary(onProgress);

            expect(path).toBe(mgr.binaryPath);
            expect(onProgress).toHaveBeenCalledWith("Fetching latest release info...");
            expect(onProgress).toHaveBeenCalledWith("Downloading lilbee binary...");
            expect(onProgress).toHaveBeenCalledWith("Download complete.");
        });
    });

    describe("download", () => {
        it("creates binDir when it does not exist", async () => {
            restore = stubPlatform("linux", "x64");
            const chunk = new Uint8Array([10, 20]);
            const fStream = mockFileStream();

            vi.spyOn(node, "existsSync").mockReturnValue(false);
            vi.spyOn(node, "mkdirSync").mockImplementation(() => undefined as any);
            vi.spyOn(node, "fetch").mockResolvedValue(downloadResponse([chunk]));
            vi.spyOn(node, "createWriteStream").mockReturnValue(fStream as any);
            vi.spyOn(node, "chmodSync").mockImplementation(() => {});

            const mgr = new BinaryManager("/plugins/lilbee");
            await mgr.download("https://example.com/dl");

            expect(node.mkdirSync).toHaveBeenCalledWith(expect.stringContaining("bin"), { recursive: true });
        });

        it("skips mkdir when binDir already exists", async () => {
            restore = stubPlatform("linux", "x64");
            const chunk = new Uint8Array([10, 20]);
            const fStream = mockFileStream();

            vi.spyOn(node, "existsSync").mockReturnValue(true);
            vi.spyOn(node, "mkdirSync").mockImplementation(() => undefined as any);
            vi.spyOn(node, "fetch").mockResolvedValue(downloadResponse([chunk]));
            vi.spyOn(node, "createWriteStream").mockReturnValue(fStream as any);
            vi.spyOn(node, "chmodSync").mockImplementation(() => {});

            const mgr = new BinaryManager("/plugins/lilbee");
            await mgr.download("https://example.com/dl");

            expect(node.mkdirSync).not.toHaveBeenCalled();
        });

        it("writes stream data and calls chmod on non-win32", async () => {
            restore = stubPlatform("linux", "x64");
            const chunk1 = new Uint8Array([1, 2, 3]);
            const chunk2 = new Uint8Array([4, 5, 6]);
            const fStream = mockFileStream();

            vi.spyOn(node, "existsSync").mockReturnValue(true);
            vi.spyOn(node, "fetch").mockResolvedValue(downloadResponse([chunk1, chunk2], 6));
            vi.spyOn(node, "createWriteStream").mockReturnValue(fStream as any);
            vi.spyOn(node, "chmodSync").mockImplementation(() => {});

            const onProgress = vi.fn();
            const mgr = new BinaryManager("/plugins/lilbee");
            await mgr.download("https://example.com/dl", onProgress);

            expect(fStream.write).toHaveBeenCalledTimes(2);
            expect(fStream.write).toHaveBeenCalledWith(chunk1);
            expect(fStream.write).toHaveBeenCalledWith(chunk2);
            expect(fStream.end).toHaveBeenCalled();
            expect(node.chmodSync).toHaveBeenCalledWith(mgr.binaryPath, 0o755);
            // Progress with percentages
            expect(onProgress).toHaveBeenCalledWith("Downloading lilbee binary... 50%");
            expect(onProgress).toHaveBeenCalledWith("Downloading lilbee binary... 100%");
            expect(onProgress).toHaveBeenCalledWith("Download complete.");
        });

        it("skips percentage progress when content-length is absent", async () => {
            restore = stubPlatform("linux", "x64");
            const chunk = new Uint8Array([1, 2, 3]);
            const fStream = mockFileStream();

            vi.spyOn(node, "existsSync").mockReturnValue(true);
            // No content-length header
            vi.spyOn(node, "fetch").mockResolvedValue(downloadResponse([chunk]));
            vi.spyOn(node, "createWriteStream").mockReturnValue(fStream as any);
            vi.spyOn(node, "chmodSync").mockImplementation(() => {});

            const onProgress = vi.fn();
            const mgr = new BinaryManager("/plugins/lilbee");
            await mgr.download("https://example.com/dl", onProgress);

            // Should not have any percentage-based progress calls
            const percentageCalls = onProgress.mock.calls.filter((c: string[]) => c[0].includes("%"));
            expect(percentageCalls).toHaveLength(0);
            expect(onProgress).toHaveBeenCalledWith("Downloading lilbee binary...");
            expect(onProgress).toHaveBeenCalledWith("Download complete.");
        });

        it("calls xattr on darwin", async () => {
            restore = stubPlatform("darwin", "arm64");
            const chunk = new Uint8Array([1]);
            const fStream = mockFileStream();

            vi.spyOn(node, "existsSync").mockReturnValue(true);
            vi.spyOn(node, "fetch").mockResolvedValue(downloadResponse([chunk]));
            vi.spyOn(node, "createWriteStream").mockReturnValue(fStream as any);
            vi.spyOn(node, "chmodSync").mockImplementation(() => {});
            const execSpy = vi.spyOn(node, "execFile").mockResolvedValue({ stdout: "", stderr: "" });

            const mgr = new BinaryManager("/plugins/lilbee");
            await mgr.download("https://example.com/dl");

            expect(execSpy).toHaveBeenCalledWith("xattr", ["-cr", mgr.binaryPath]);
        });

        it("treats xattr failure as non-fatal on darwin", async () => {
            restore = stubPlatform("darwin", "arm64");
            const chunk = new Uint8Array([1]);
            const fStream = mockFileStream();

            vi.spyOn(node, "existsSync").mockReturnValue(true);
            vi.spyOn(node, "fetch").mockResolvedValue(downloadResponse([chunk]));
            vi.spyOn(node, "createWriteStream").mockReturnValue(fStream as any);
            vi.spyOn(node, "chmodSync").mockImplementation(() => {});
            vi.spyOn(node, "execFile").mockRejectedValue(new Error("xattr not found"));

            const mgr = new BinaryManager("/plugins/lilbee");
            // Should not throw
            await expect(mgr.download("https://example.com/dl")).resolves.toBeUndefined();
        });

        it("skips chmod on win32", async () => {
            restore = stubPlatform("win32", "x64");
            const chunk = new Uint8Array([1]);
            const fStream = mockFileStream();

            vi.spyOn(node, "existsSync").mockReturnValue(true);
            vi.spyOn(node, "fetch").mockResolvedValue(downloadResponse([chunk]));
            vi.spyOn(node, "createWriteStream").mockReturnValue(fStream as any);
            vi.spyOn(node, "chmodSync").mockImplementation(() => {});

            const mgr = new BinaryManager("/plugins/lilbee");
            await mgr.download("https://example.com/dl");

            expect(node.chmodSync).not.toHaveBeenCalled();
        });

        it("does not call xattr on non-darwin platforms", async () => {
            restore = stubPlatform("linux", "x64");
            const chunk = new Uint8Array([1]);
            const fStream = mockFileStream();

            vi.spyOn(node, "existsSync").mockReturnValue(true);
            vi.spyOn(node, "fetch").mockResolvedValue(downloadResponse([chunk]));
            vi.spyOn(node, "createWriteStream").mockReturnValue(fStream as any);
            vi.spyOn(node, "chmodSync").mockImplementation(() => {});
            const execSpy = vi.spyOn(node, "execFile").mockResolvedValue({ stdout: "", stderr: "" });

            const mgr = new BinaryManager("/plugins/lilbee");
            await mgr.download("https://example.com/dl");

            expect(execSpy).not.toHaveBeenCalled();
        });

        it("throws when download response is not ok", async () => {
            restore = stubPlatform("linux", "x64");
            vi.spyOn(node, "existsSync").mockReturnValue(true);
            vi.spyOn(node, "fetch").mockResolvedValue({
                ok: false,
                status: 404,
            } as unknown as Response);

            const mgr = new BinaryManager("/plugins/lilbee");
            await expect(mgr.download("https://example.com/dl")).rejects.toThrow("Download failed: 404");
        });

        it("throws when download response has no body", async () => {
            restore = stubPlatform("linux", "x64");
            vi.spyOn(node, "existsSync").mockReturnValue(true);
            vi.spyOn(node, "fetch").mockResolvedValue({
                ok: true,
                status: 200,
                body: null,
                headers: new Headers(),
            } as unknown as Response);

            const mgr = new BinaryManager("/plugins/lilbee");
            await expect(mgr.download("https://example.com/dl")).rejects.toThrow("Download response has no body");
        });

        it("rejects when fileStream emits error", async () => {
            restore = stubPlatform("linux", "x64");
            const chunk = new Uint8Array([1]);
            const emitter = new EventEmitter();
            const fStream = Object.assign(emitter, {
                write: vi.fn(),
                end: vi.fn(() => {
                    queueMicrotask(() => emitter.emit("error", new Error("disk full")));
                }),
            });

            vi.spyOn(node, "existsSync").mockReturnValue(true);
            vi.spyOn(node, "fetch").mockResolvedValue(downloadResponse([chunk]));
            vi.spyOn(node, "createWriteStream").mockReturnValue(fStream as any);

            const mgr = new BinaryManager("/plugins/lilbee");
            await expect(mgr.download("https://example.com/dl")).rejects.toThrow("disk full");
        });

        it("works without onProgress callback", async () => {
            restore = stubPlatform("linux", "x64");
            const chunk = new Uint8Array([1]);
            const fStream = mockFileStream();

            vi.spyOn(node, "existsSync").mockReturnValue(true);
            vi.spyOn(node, "fetch").mockResolvedValue(downloadResponse([chunk], 1));
            vi.spyOn(node, "createWriteStream").mockReturnValue(fStream as any);
            vi.spyOn(node, "chmodSync").mockImplementation(() => {});

            const mgr = new BinaryManager("/plugins/lilbee");
            // No onProgress — should not throw
            await expect(mgr.download("https://example.com/dl")).resolves.toBeUndefined();
        });
    });
});
