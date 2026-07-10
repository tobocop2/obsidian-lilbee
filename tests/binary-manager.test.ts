import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import type { StatsFs } from "fs";
import { createHash } from "crypto";
import { Readable, Writable } from "stream";
import {
    DownloadCanceledError,
    node,
    getPlatformAssetName,
    getLatestRelease,
    listReleases,
    isDevBuild,
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

/** The GitHub-style "sha256:<hex>" digest of some bytes. */
function sha256Digest(data: Uint8Array): string {
    return `sha256:${createHash("sha256").update(Buffer.from(data)).digest("hex")}`;
}

/** Serve `data` over a fake https.get, with a content-length header. */
function stubHttpsBody(data: Uint8Array) {
    return vi.spyOn(node, "httpsGet").mockImplementation(((_url: string, cb: (res: any) => void) => {
        const res: any = new Readable({ read() {} });
        res.statusCode = 200;
        res.headers = { "content-length": String(data.length) };
        queueMicrotask(() => {
            cb(res);
            res.push(Buffer.from(data));
            res.push(null);
        });
        return { on: () => {} } as any;
    }) as any);
}

/** A write stream that swallows everything piped into it. */
function stubSinkStream() {
    return vi.spyOn(node, "createWriteStream").mockImplementation(
        (() =>
            new Writable({
                write(_c, _e, cb) {
                    cb();
                },
            })) as any,
    );
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

describe("isDevBuild", () => {
    it("matches a trailing .dev<n> tag", () => {
        expect(isDevBuild("v0.6.90b420.dev711")).toBe(true);
        expect(isDevBuild("v0.6.90b420.dev")).toBe(true);
    });

    it("treats stable release tags as non-dev", () => {
        expect(isDevBuild("v0.6.66b507")).toBe(false);
        expect(isDevBuild("v1.0.0")).toBe(false);
    });
});

describe("getLatestRelease", () => {
    let restore: () => void;
    afterEach(() => restore?.());

    /** One GitHub release entry carrying the default linux asset. */
    function linuxRelease(tag: string) {
        return {
            tag_name: tag,
            assets: [
                {
                    name: "lilbee-linux-x86_64",
                    browser_download_url: `https://e/${tag}`,
                    size: 1234,
                    digest: "sha256:aaa",
                },
            ],
        };
    }

    it("returns the default build with size when no GPU is detected", async () => {
        restore = stubPlatform("linux", "x64");
        stubNoNvidia();
        vi.spyOn(node, "requestUrl").mockResolvedValue(releaseResponse([linuxRelease("v1.0.0")]));

        expect(await getLatestRelease(false)).toEqual({
            tag: "v1.0.0",
            assetUrl: "https://e/v1.0.0",
            variant: "default",
            sizeBytes: 1234,
            digest: "sha256:aaa",
        });
    });

    it("prefers the CUDA build when a matching GPU is detected", async () => {
        restore = stubPlatform("linux", "x64");
        vi.spyOn(node, "execFile").mockResolvedValue({ stdout: "CUDA Version: 12.5", stderr: "" });
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        vi.spyOn(node, "requestUrl").mockResolvedValue(
            releaseResponse([
                {
                    tag_name: "v1.0.0",
                    assets: [
                        {
                            name: "lilbee-linux-x86_64",
                            browser_download_url: "https://e/cpu",
                            size: 10,
                            digest: "sha256:cpu",
                        },
                        {
                            name: "lilbee-linux-x86_64-cu125",
                            browser_download_url: "https://e/cu125",
                            size: 20,
                            digest: "sha256:cu125",
                        },
                    ],
                },
            ]),
        );

        expect(await getLatestRelease(false)).toEqual({
            tag: "v1.0.0",
            assetUrl: "https://e/cu125",
            variant: "cu125",
            sizeBytes: 20,
            digest: "sha256:cu125",
        });
        expect(warn).not.toHaveBeenCalled();
    });

    it("falls back to the default build when the CUDA asset is missing from the release", async () => {
        restore = stubPlatform("linux", "x64");
        vi.spyOn(node, "execFile").mockResolvedValue({ stdout: "CUDA Version: 12.5", stderr: "" });
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        vi.spyOn(node, "requestUrl").mockResolvedValue(
            releaseResponse([
                {
                    tag_name: "v1.0.0",
                    assets: [
                        {
                            name: "lilbee-linux-x86_64",
                            browser_download_url: "https://e/cpu",
                            size: 10,
                            digest: "sha256:cpu",
                        },
                    ],
                },
            ]),
        );

        expect(await getLatestRelease(false)).toEqual({
            tag: "v1.0.0",
            assetUrl: "https://e/cpu",
            variant: "default",
            sizeBytes: 10,
            digest: "sha256:cpu",
        });
        // listReleases suppresses the per-release CUDA-fallback warning.
        expect(warn).not.toHaveBeenCalled();
    });

    it("returns the latest stable build, skipping a newer dev build, by default", async () => {
        restore = stubPlatform("linux", "x64");
        stubNoNvidia();
        vi.spyOn(node, "requestUrl").mockResolvedValue(
            releaseResponse([linuxRelease("v1.1.0.dev5"), linuxRelease("v1.0.0")]),
        );

        expect((await getLatestRelease(false)).tag).toBe("v1.0.0");
    });

    it("returns the newest dev build when dev builds are included", async () => {
        restore = stubPlatform("linux", "x64");
        stubNoNvidia();
        vi.spyOn(node, "requestUrl").mockResolvedValue(
            releaseResponse([linuxRelease("v1.1.0.dev5"), linuxRelease("v1.0.0")]),
        );

        expect((await getLatestRelease(true)).tag).toBe("v1.1.0.dev5");
    });

    it("throws when GitHub API returns error status", async () => {
        vi.spyOn(node, "requestUrl").mockResolvedValue({
            status: 403,
            json: [],
            arrayBuffer: new ArrayBuffer(0),
            headers: {},
        });

        await expect(getLatestRelease(false)).rejects.toThrow("GitHub API responded 403");
    });

    it("throws when no release ships a build for this platform", async () => {
        restore = stubPlatform("darwin", "arm64");
        vi.spyOn(node, "requestUrl").mockResolvedValue(
            releaseResponse([
                {
                    tag_name: "v2.0.0",
                    assets: [{ name: "some-other-asset", browser_download_url: "https://e/other", size: 1 }],
                },
            ]),
        );

        await expect(getLatestRelease(false)).rejects.toThrow("No installable lilbee release was found.");
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
            // binaryPath joins with the host separator; compare on the logical path.
            expect(mgr.binaryPath.replace(/\\/g, "/")).toBe("/plugins/lilbee/bin/lilbee");
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
            const path = await mgr.ensureBinary(false);
            expect(path).toBe(mgr.binaryPath);
        });

        it("downloads binary when it does not exist", async () => {
            restore = stubPlatform("darwin", "arm64");
            const mgr = new BinaryManager("/plugins/lilbee/bin");
            const data = new Uint8Array([1, 2, 3]);

            // existsSync: first call (binaryExists) => false, second call (binDir check in download) => true
            vi.spyOn(node, "existsSync").mockReturnValueOnce(false).mockReturnValueOnce(true);
            stubEnoughSpace();
            vi.spyOn(node, "requestUrl").mockResolvedValue(
                releaseResponse([
                    {
                        tag_name: "v1.0.0",
                        assets: [
                            {
                                name: "lilbee-macos-arm64",
                                browser_download_url: "https://example.com/dl",
                                size: 3,
                                digest: sha256Digest(data),
                            },
                        ],
                    },
                ]),
            );
            stubHttpsBody(data);
            stubSinkStream();
            vi.spyOn(node, "renameSync").mockImplementation(() => {});
            vi.spyOn(node, "chmodSync").mockImplementation(() => {});
            vi.spyOn(node, "execFile").mockResolvedValue({ stdout: "", stderr: "" });

            const onProgress = vi.fn();
            const path = await mgr.ensureBinary(false, onProgress);

            expect(path).toBe(mgr.binaryPath);
            expect(onProgress).toHaveBeenCalledWith("Fetching latest release info...");
            expect(onProgress).toHaveBeenCalledWith("Downloading...", expect.any(String));
            expect(onProgress).toHaveBeenCalledWith("Download complete.", expect.any(String));
        });
    });

    describe("download", () => {
        /** Chunks the fake https response yields, plus optional redirect hops. */
        function stubHttps(
            chunks: Uint8Array[],
            opts: { status?: number; headers?: Record<string, string>; hops?: number } = {},
        ) {
            let hop = 0;
            const hops = opts.hops ?? 0;
            return vi.spyOn(node, "httpsGet").mockImplementation(((url: string, cb: (res: any) => void) => {
                const res: any = new Readable({ read() {} });
                if (hop < hops) {
                    hop += 1;
                    res.statusCode = 302;
                    res.headers = { location: `https://cdn.example.com/hop${hop}` };
                } else {
                    res.statusCode = opts.status ?? 200;
                    res.headers = {
                        "content-length": String(chunks.reduce((n, c) => n + c.length, 0)),
                        ...(opts.headers ?? {}),
                    };
                }
                queueMicrotask(() => {
                    cb(res);
                    if ((res.statusCode ?? 200) < 300) {
                        for (const c of chunks) res.push(Buffer.from(c));
                        res.push(null);
                    }
                });
                return { on: () => {} } as any;
            }) as any);
        }

        /** Collects everything piped into the destination file. */
        function stubWriteStream(sink: number[][]) {
            return vi.spyOn(node, "createWriteStream").mockImplementation(
                (() =>
                    new Writable({
                        write(chunk, _enc, cb) {
                            sink.push([...Buffer.from(chunk)]);
                            cb();
                        },
                    })) as any,
            );
        }

        it("creates binDir when it does not exist", async () => {
            restore = stubPlatform("linux", "x64");
            const data = new Uint8Array([10, 20]);
            vi.spyOn(node, "existsSync").mockReturnValue(false);
            vi.spyOn(node, "mkdirSync").mockImplementation(() => undefined as never);
            stubEnoughSpace();
            stubHttps([data]);
            stubWriteStream([]);
            vi.spyOn(node, "renameSync").mockImplementation(() => {});
            vi.spyOn(node, "chmodSync").mockImplementation(() => {});

            const mgr = new BinaryManager("/plugins/lilbee/bin");
            await mgr.download("https://example.com/dl", 2, sha256Digest(data));

            expect(node.mkdirSync).toHaveBeenCalledWith(expect.stringContaining("bin"), { recursive: true });
        });

        it("streams the asset to a .part file and renames it once the digest clears", async () => {
            restore = stubPlatform("linux", "x64");
            const data = new Uint8Array([1, 2, 3, 4]);
            const written: number[][] = [];
            vi.spyOn(node, "existsSync").mockReturnValue(true);
            stubEnoughSpace();
            stubHttps([data.slice(0, 2), data.slice(2)]);
            const createStream = stubWriteStream(written);
            const rename = vi.spyOn(node, "renameSync").mockImplementation(() => {});
            vi.spyOn(node, "chmodSync").mockImplementation(() => {});

            const mgr = new BinaryManager("/plugins/lilbee/bin");
            await mgr.download("https://example.com/dl", 4, sha256Digest(data));

            expect(createStream).toHaveBeenCalledWith(`${mgr.binaryPath}.part`);
            expect(written.flat()).toEqual([1, 2, 3, 4]);
            expect(rename).toHaveBeenCalledWith(`${mgr.binaryPath}.part`, mgr.binaryPath);
            expect(node.chmodSync).toHaveBeenCalledWith(mgr.binaryPath, 0o755);
        });

        it("reports bytes received against the content length", async () => {
            restore = stubPlatform("linux", "x64");
            const data = new Uint8Array([1, 2, 3, 4]);
            vi.spyOn(node, "existsSync").mockReturnValue(true);
            stubEnoughSpace();
            stubHttps([data.slice(0, 3), data.slice(3)]);
            stubWriteStream([]);
            vi.spyOn(node, "renameSync").mockImplementation(() => {});
            vi.spyOn(node, "chmodSync").mockImplementation(() => {});

            const seen: Array<{ receivedBytes: number; totalBytes: number | null }> = [];
            const mgr = new BinaryManager("/plugins/lilbee/bin");
            await mgr.download("https://example.com/dl", 4, sha256Digest(data), (_m, _u, p) => {
                if (p) seen.push(p);
            });

            expect(seen).toEqual([
                { receivedBytes: 3, totalBytes: 4 },
                { receivedBytes: 4, totalBytes: 4 },
            ]);
        });

        it("reports a null total when the server sends no content length", async () => {
            restore = stubPlatform("linux", "x64");
            const data = new Uint8Array([7]);
            vi.spyOn(node, "existsSync").mockReturnValue(true);
            stubEnoughSpace();
            vi.spyOn(node, "httpsGet").mockImplementation(((_url: string, cb: (res: any) => void) => {
                const res: any = new Readable({ read() {} });
                res.statusCode = 200;
                res.headers = {};
                queueMicrotask(() => {
                    cb(res);
                    res.push(Buffer.from(data));
                    res.push(null);
                });
                return { on: () => {} } as any;
            }) as any);
            stubWriteStream([]);
            vi.spyOn(node, "renameSync").mockImplementation(() => {});
            vi.spyOn(node, "chmodSync").mockImplementation(() => {});

            const seen: Array<{ receivedBytes: number; totalBytes: number | null }> = [];
            const mgr = new BinaryManager("/plugins/lilbee/bin");
            await mgr.download("https://example.com/dl", 1, sha256Digest(data), (_m, _u, p) => {
                if (p) seen.push(p);
            });

            expect(seen).toEqual([{ receivedBytes: 1, totalBytes: null }]);
        });

        it("follows redirects to the asset host", async () => {
            restore = stubPlatform("linux", "x64");
            const data = new Uint8Array([9]);
            vi.spyOn(node, "existsSync").mockReturnValue(true);
            stubEnoughSpace();
            const get = stubHttps([data], { hops: 1 });
            stubWriteStream([]);
            vi.spyOn(node, "renameSync").mockImplementation(() => {});
            vi.spyOn(node, "chmodSync").mockImplementation(() => {});

            const mgr = new BinaryManager("/plugins/lilbee/bin");
            await mgr.download("https://example.com/dl", 1, sha256Digest(data));

            expect(get).toHaveBeenCalledTimes(2);
            expect(get.mock.calls[1][0]).toBe("https://cdn.example.com/hop1");
        });

        it("gives up after too many redirects", async () => {
            restore = stubPlatform("linux", "x64");
            vi.spyOn(node, "existsSync").mockReturnValue(true);
            stubEnoughSpace();
            stubHttps([new Uint8Array([1])], { hops: 99 });
            stubWriteStream([]);

            const mgr = new BinaryManager("/plugins/lilbee/bin");
            await expect(mgr.download("https://example.com/dl", 1, null)).rejects.toThrow("too many redirects");
        });

        it("throws and skips the download when there isn't enough disk space", async () => {
            restore = stubPlatform("linux", "x64");
            vi.spyOn(node, "existsSync").mockReturnValue(true);
            vi.spyOn(node, "statfs").mockResolvedValue(fakeStatfs(1));
            const get = vi.spyOn(node, "httpsGet");

            const mgr = new BinaryManager("/plugins/lilbee/bin");
            await expect(mgr.download("https://example.com/dl", 1_000_000, null)).rejects.toThrow(
                "Not enough disk space",
            );
            expect(get).not.toHaveBeenCalled();
        });

        it("discards the partial file and keeps the installed binary when the digest is wrong", async () => {
            restore = stubPlatform("linux", "x64");
            vi.spyOn(node, "existsSync").mockReturnValue(true);
            stubEnoughSpace();
            stubHttps([new Uint8Array([1, 2])]);
            stubWriteStream([]);
            const rename = vi.spyOn(node, "renameSync").mockImplementation(() => {});
            const unlink = vi.spyOn(node, "unlinkSync").mockImplementation(() => {});

            const mgr = new BinaryManager("/plugins/lilbee/bin");
            await expect(mgr.download("https://example.com/dl", 2, "sha256:deadbeef")).rejects.toThrow(
                "could not be verified",
            );

            expect(rename).not.toHaveBeenCalled();
            expect(unlink).toHaveBeenCalledWith(`${mgr.binaryPath}.part`);
            expect(unlink).not.toHaveBeenCalledWith(mgr.binaryPath);
        });

        it("removes the renamed binary when chmod fails", async () => {
            restore = stubPlatform("linux", "x64");
            const data = new Uint8Array([1]);
            vi.spyOn(node, "existsSync").mockReturnValue(true);
            stubEnoughSpace();
            stubHttps([data]);
            stubWriteStream([]);
            vi.spyOn(node, "renameSync").mockImplementation(() => {});
            vi.spyOn(node, "chmodSync").mockImplementation(() => {
                throw new Error("chmod boom");
            });
            const unlink = vi.spyOn(node, "unlinkSync").mockImplementation(() => {});

            const mgr = new BinaryManager("/plugins/lilbee/bin");
            await expect(mgr.download("https://example.com/dl", 1, sha256Digest(data))).rejects.toThrow("chmod boom");

            expect(unlink).toHaveBeenCalledWith(mgr.binaryPath);
        });

        it("surfaces a transport error", async () => {
            restore = stubPlatform("linux", "x64");
            vi.spyOn(node, "existsSync").mockReturnValue(true);
            stubEnoughSpace();
            vi.spyOn(node, "httpsGet").mockImplementation(((_url: string, _cb: unknown) => {
                const req = {
                    on: (event: string, handler: (e: Error) => void) => {
                        if (event === "error") queueMicrotask(() => handler(new Error("socket hang up")));
                    },
                };
                return req as any;
            }) as any);

            const mgr = new BinaryManager("/plugins/lilbee/bin");
            await expect(mgr.download("https://example.com/dl", 1, null)).rejects.toThrow("socket hang up");
        });

        it("surfaces a mid-stream read error", async () => {
            restore = stubPlatform("linux", "x64");
            vi.spyOn(node, "existsSync").mockReturnValue(true);
            stubEnoughSpace();
            vi.spyOn(node, "httpsGet").mockImplementation(((_url: string, cb: (res: any) => void) => {
                const res: any = new Readable({ read() {} });
                res.statusCode = 200;
                res.headers = { "content-length": "4" };
                queueMicrotask(() => {
                    cb(res);
                    setTimeout(() => res.emit("error", new Error("connection reset")), 0);
                });
                return { on: () => {} } as any;
            }) as any);
            stubWriteStream([]);
            vi.spyOn(node, "unlinkSync").mockImplementation(() => {});

            const mgr = new BinaryManager("/plugins/lilbee/bin");
            await expect(mgr.download("https://example.com/dl", 4, null)).rejects.toThrow("connection reset");
        });

        it("aborts when the caller cancels mid-stream", async () => {
            restore = stubPlatform("linux", "x64");
            vi.spyOn(node, "existsSync").mockReturnValue(true);
            stubEnoughSpace();
            const controller = new AbortController();
            vi.spyOn(node, "httpsGet").mockImplementation(((_url: string, cb: (res: any) => void) => {
                const res: any = new Readable({ read() {} });
                res.statusCode = 200;
                res.headers = { "content-length": "99" };
                queueMicrotask(() => {
                    cb(res);
                    res.push(Buffer.from([1]));
                    setTimeout(() => controller.abort(), 0);
                });
                return { on: () => {}, setTimeout: () => {}, destroy: () => {} } as any;
            }) as any);
            stubSinkStream();
            const unlink = vi.spyOn(node, "unlinkSync").mockImplementation(() => {});

            const mgr = new BinaryManager("/plugins/lilbee/bin");
            await expect(
                mgr.download("https://example.com/dl", 99, null, undefined, undefined, controller.signal),
            ).rejects.toThrow(DownloadCanceledError);

            expect(unlink).toHaveBeenCalledWith(`${mgr.binaryPath}.part`);
            expect(unlink).not.toHaveBeenCalledWith(mgr.binaryPath);
        });

        it("does not start when the signal is already aborted", async () => {
            restore = stubPlatform("linux", "x64");
            vi.spyOn(node, "existsSync").mockReturnValue(true);
            stubEnoughSpace();
            const get = vi.spyOn(node, "httpsGet");
            vi.spyOn(node, "unlinkSync").mockImplementation(() => {});
            const controller = new AbortController();
            controller.abort();

            const mgr = new BinaryManager("/plugins/lilbee/bin");
            await expect(
                mgr.download("https://example.com/dl", 1, null, undefined, undefined, controller.signal),
            ).rejects.toThrow("was cancelled");
            expect(get).not.toHaveBeenCalled();
        });

        it("gives up when the asset host never answers", async () => {
            restore = stubPlatform("linux", "x64");
            vi.spyOn(node, "existsSync").mockReturnValue(true);
            stubEnoughSpace();
            // Mirrors Node: setTimeout arms a callback, destroy(err) surfaces on "error".
            vi.spyOn(node, "httpsGet").mockImplementation(((_url: string, _cb: unknown) => {
                let onError: ((e: Error) => void) | undefined;
                const req = {
                    on: (event: string, handler: (e: Error) => void) => {
                        if (event === "error") onError = handler;
                    },
                    destroy: (err: Error) => onError?.(err),
                    setTimeout: (_ms: number, cb: () => void) => queueMicrotask(cb),
                };
                return req as any;
            }) as any);

            const mgr = new BinaryManager("/plugins/lilbee/bin");
            await expect(mgr.download("https://example.com/dl", 1, null)).rejects.toThrow("download stalled");
        });

        it("gives up when the asset host goes quiet mid-stream", async () => {
            vi.useFakeTimers();
            restore = stubPlatform("linux", "x64");
            vi.spyOn(node, "existsSync").mockReturnValue(true);
            stubEnoughSpace();
            vi.spyOn(node, "httpsGet").mockImplementation(((_url: string, cb: (res: any) => void) => {
                const res: any = new Readable({ read() {} });
                res.statusCode = 200;
                res.headers = { "content-length": "999" };
                queueMicrotask(() => {
                    cb(res);
                    res.push(Buffer.from([1])); // one chunk, then silence forever
                });
                return { on: () => {}, setTimeout: () => {}, destroy: () => {} } as any;
            }) as any);
            stubSinkStream();
            const unlink = vi.spyOn(node, "unlinkSync").mockImplementation(() => {});

            const mgr = new BinaryManager("/plugins/lilbee/bin");
            const pending = mgr.download("https://example.com/dl", 999, null);
            const assertion = expect(pending).rejects.toThrow("download stalled");
            await vi.advanceTimersByTimeAsync(60_000);
            await assertion;

            expect(unlink).toHaveBeenCalledWith(`${mgr.binaryPath}.part`);
            expect(unlink).not.toHaveBeenCalledWith(mgr.binaryPath);
            vi.useRealTimers();
        });

        it("keeps waiting while bytes are still arriving", async () => {
            vi.useFakeTimers();
            restore = stubPlatform("linux", "x64");
            vi.spyOn(node, "existsSync").mockReturnValue(true);
            stubEnoughSpace();
            const data = new Uint8Array([1, 2]);
            let push!: (b: Buffer | null) => void;
            vi.spyOn(node, "httpsGet").mockImplementation(((_url: string, cb: (res: any) => void) => {
                const res: any = new Readable({ read() {} });
                res.statusCode = 200;
                res.headers = { "content-length": "2" };
                push = (b) => res.push(b);
                queueMicrotask(() => cb(res));
                return { on: () => {}, setTimeout: () => {}, destroy: () => {} } as any;
            }) as any);
            stubSinkStream();
            vi.spyOn(node, "renameSync").mockImplementation(() => {});
            vi.spyOn(node, "chmodSync").mockImplementation(() => {});

            const mgr = new BinaryManager("/plugins/lilbee/bin");
            const pending = mgr.download("https://example.com/dl", 2, sha256Digest(data));
            await vi.advanceTimersByTimeAsync(0);

            // Each chunk lands just under the idle limit, so the clock keeps resetting.
            push(Buffer.from([1]));
            await vi.advanceTimersByTimeAsync(50_000);
            push(Buffer.from([2]));
            await vi.advanceTimersByTimeAsync(50_000);
            push(null);
            await vi.advanceTimersByTimeAsync(0);

            await expect(pending).resolves.toBeUndefined();
            vi.useRealTimers();
        });

        it("surfaces a disk write error", async () => {
            restore = stubPlatform("linux", "x64");
            vi.spyOn(node, "existsSync").mockReturnValue(true);
            stubEnoughSpace();
            stubHttps([new Uint8Array([1])]);
            vi.spyOn(node, "createWriteStream").mockImplementation(
                (() =>
                    new Writable({
                        write(_c, _e, cb) {
                            cb(new Error("ENOSPC"));
                        },
                    })) as any,
            );
            vi.spyOn(node, "unlinkSync").mockImplementation(() => {});

            const mgr = new BinaryManager("/plugins/lilbee/bin");
            await expect(mgr.download("https://example.com/dl", 1, null)).rejects.toThrow("ENOSPC");
        });

        it("throws when the asset host answers with an error status", async () => {
            restore = stubPlatform("linux", "x64");
            vi.spyOn(node, "existsSync").mockReturnValue(true);
            stubEnoughSpace();
            stubHttps([], { status: 404 });
            stubWriteStream([]);

            const mgr = new BinaryManager("/plugins/lilbee/bin");
            await expect(mgr.download("https://example.com/dl", 1, null)).rejects.toThrow("Download failed: 404");
        });

        it("treats a response with no status code as an error", async () => {
            restore = stubPlatform("linux", "x64");
            vi.spyOn(node, "existsSync").mockReturnValue(true);
            stubEnoughSpace();
            vi.spyOn(node, "httpsGet").mockImplementation(((_url: string, cb: (res: any) => void) => {
                const res: any = new Readable({ read() {} });
                res.headers = {};
                queueMicrotask(() => cb(res));
                return { on: () => {} } as any;
            }) as any);
            stubSinkStream();
            vi.spyOn(node, "unlinkSync").mockImplementation(() => {});

            const mgr = new BinaryManager("/plugins/lilbee/bin");
            await expect(mgr.download("https://example.com/dl", 1, null)).rejects.toThrow("Download failed: 0");
        });

        it("leaves no partial behind when the download never created one", async () => {
            restore = stubPlatform("linux", "x64");
            // binDir exists, but the .part file never landed.
            vi.spyOn(node, "existsSync").mockReturnValueOnce(true).mockReturnValue(false);
            stubEnoughSpace();
            stubHttps([], { status: 500 });
            stubSinkStream();
            const unlink = vi.spyOn(node, "unlinkSync").mockImplementation(() => {});

            const mgr = new BinaryManager("/plugins/lilbee/bin");
            await expect(mgr.download("https://example.com/dl", 1, null)).rejects.toThrow("Download failed: 500");
            expect(unlink).not.toHaveBeenCalled();
        });

        it("names gigabyte-scale space requirements in GB", async () => {
            restore = stubPlatform("linux", "x64");
            vi.spyOn(node, "existsSync").mockReturnValue(true);
            vi.spyOn(node, "statfs").mockResolvedValue(fakeStatfs(1));

            const mgr = new BinaryManager("/plugins/lilbee/bin");
            // Disk figures render in decimal (SI) units: 4 GiB * 1.1 = 4.72e9 bytes.
            await expect(mgr.download("https://example.com/dl", 4 * 1024 ** 3, null)).rejects.toThrow(/4\.72 GB free/);
        });

        it("calls xattr on darwin", async () => {
            restore = stubPlatform("darwin", "arm64");
            const data = new Uint8Array([1]);
            vi.spyOn(node, "existsSync").mockReturnValue(true);
            stubEnoughSpace();
            stubHttps([data]);
            stubWriteStream([]);
            vi.spyOn(node, "renameSync").mockImplementation(() => {});
            vi.spyOn(node, "chmodSync").mockImplementation(() => {});
            const execSpy = vi.spyOn(node, "execFile").mockResolvedValue({ stdout: "", stderr: "" });

            const mgr = new BinaryManager("/plugins/lilbee/bin");
            await mgr.download("https://example.com/dl", 1, sha256Digest(data));

            expect(execSpy).toHaveBeenCalledWith("xattr", ["-cr", mgr.binaryPath]);
        });

        it("reports a quarantine failure without failing the download", async () => {
            restore = stubPlatform("darwin", "arm64");
            const data = new Uint8Array([1]);
            vi.spyOn(node, "existsSync").mockReturnValue(true);
            stubEnoughSpace();
            stubHttps([data]);
            stubWriteStream([]);
            vi.spyOn(node, "renameSync").mockImplementation(() => {});
            vi.spyOn(node, "chmodSync").mockImplementation(() => {});
            vi.spyOn(node, "execFile").mockRejectedValue(new Error("no xattr"));
            const onQuarantineFailed = vi.fn();

            const mgr = new BinaryManager("/plugins/lilbee/bin");
            await mgr.download("https://example.com/dl", 1, sha256Digest(data), undefined, onQuarantineFailed);

            expect(onQuarantineFailed).toHaveBeenCalled();
        });

        it("skips chmod on win32", async () => {
            restore = stubPlatform("win32", "x64");
            const data = new Uint8Array([1]);
            vi.spyOn(node, "existsSync").mockReturnValue(true);
            stubEnoughSpace();
            stubHttps([data]);
            stubWriteStream([]);
            vi.spyOn(node, "renameSync").mockImplementation(() => {});
            vi.spyOn(node, "chmodSync").mockImplementation(() => {});

            const mgr = new BinaryManager("/plugins/lilbee/bin");
            await mgr.download("https://example.com/dl", 1, sha256Digest(data));

            expect(node.chmodSync).not.toHaveBeenCalled();
        });

        it("does not call xattr on non-darwin platforms", async () => {
            restore = stubPlatform("linux", "x64");
            const data = new Uint8Array([1]);
            vi.spyOn(node, "existsSync").mockReturnValue(true);
            stubEnoughSpace();
            stubHttps([data]);
            stubWriteStream([]);
            vi.spyOn(node, "renameSync").mockImplementation(() => {});
            vi.spyOn(node, "chmodSync").mockImplementation(() => {});
            const execSpy = vi.spyOn(node, "execFile").mockResolvedValue({ stdout: "", stderr: "" });

            const mgr = new BinaryManager("/plugins/lilbee/bin");
            await mgr.download("https://example.com/dl", 1, sha256Digest(data));

            expect(execSpy).not.toHaveBeenCalled();
        });
    });
});

describe("BinaryManager.download digest verification", () => {
    let restore: () => void;
    afterEach(() => restore?.());

    function stubDownload(data: Uint8Array) {
        vi.spyOn(node, "existsSync").mockReturnValue(true);
        stubEnoughSpace();
        stubHttpsBody(data);
        stubSinkStream();
        vi.spyOn(node, "unlinkSync").mockImplementation(() => {});
        vi.spyOn(node, "chmodSync").mockImplementation(() => {});
    }

    it("installs the binary when the digest matches the downloaded bytes", async () => {
        restore = stubPlatform("linux", "x64");
        const data = new Uint8Array([1, 2, 3, 4]);
        stubDownload(data);
        const rename = vi.spyOn(node, "renameSync").mockImplementation(() => {});

        const mgr = new BinaryManager("/plugins/lilbee/bin");
        await mgr.download("https://example.com/dl", 4, sha256Digest(data));

        expect(rename).toHaveBeenCalledWith(`${mgr.binaryPath}.part`, mgr.binaryPath);
    });

    it("rejects and installs nothing when the digest does not match the bytes", async () => {
        restore = stubPlatform("linux", "x64");
        const data = new Uint8Array([1, 2, 3, 4]);
        stubDownload(data);
        const rename = vi.spyOn(node, "renameSync").mockImplementation(() => {});

        const mgr = new BinaryManager("/plugins/lilbee/bin");
        await expect(
            mgr.download("https://example.com/dl", 4, sha256Digest(new Uint8Array([9, 9, 9]))),
        ).rejects.toThrow(/checksum/i);
        expect(rename).not.toHaveBeenCalled();
    });

    it("rejects and installs nothing when the release provides no digest", async () => {
        restore = stubPlatform("linux", "x64");
        const data = new Uint8Array([1, 2, 3, 4]);
        stubDownload(data);
        const rename = vi.spyOn(node, "renameSync").mockImplementation(() => {});

        const mgr = new BinaryManager("/plugins/lilbee/bin");
        await expect(mgr.download("https://example.com/dl", 4, null)).rejects.toThrow(/checksum/i);
        expect(rename).not.toHaveBeenCalled();
    });

    it("keeps the real error when discarding the partial file fails", async () => {
        restore = stubPlatform("linux", "x64");
        const data = new Uint8Array([1, 2, 3, 4]);
        stubDownload(data);
        vi.spyOn(node, "renameSync").mockImplementation(() => {});
        vi.spyOn(node, "unlinkSync").mockImplementation(() => {
            throw new Error("ENOENT: no such file");
        });

        const mgr = new BinaryManager("/plugins/lilbee/bin");
        await expect(mgr.download("https://example.com/dl", 4, "sha256:bad")).rejects.toThrow(/checksum/i);
    });
});

describe("listReleases", () => {
    let restore: () => void;
    afterEach(() => restore?.());

    /** One GitHub release entry carrying the default linux asset. */
    function release(tag: string, extra: Record<string, unknown> = {}) {
        return {
            tag_name: tag,
            assets: [{ name: "lilbee-linux-x86_64", browser_download_url: `https://e/${tag}`, size: 10, digest: null }],
            ...extra,
        };
    }

    it("returns installable releases newest first", async () => {
        restore = stubPlatform("linux", "x64");
        stubNoNvidia();
        vi.spyOn(node, "requestUrl").mockResolvedValue(releaseResponse([release("v1.1.0"), release("v1.0.0")]));

        const releases = await listReleases(false);

        expect(releases.map((r) => r.tag)).toEqual(["v1.1.0", "v1.0.0"]);
        expect(releases[0]).toEqual({
            tag: "v1.1.0",
            assetUrl: "https://e/v1.1.0",
            variant: "default",
            sizeBytes: 10,
            digest: null,
        });
    });

    it("asks GitHub for the requested number of releases", async () => {
        restore = stubPlatform("linux", "x64");
        stubNoNvidia();
        const requestUrl = vi.spyOn(node, "requestUrl").mockResolvedValue(releaseResponse([]));

        await listReleases(false, 3);

        expect(requestUrl.mock.calls[0][0].url).toContain("per_page=3");
    });

    it("leaves out drafts and prereleases", async () => {
        restore = stubPlatform("linux", "x64");
        stubNoNvidia();
        vi.spyOn(node, "requestUrl").mockResolvedValue(
            releaseResponse([
                release("v2.0.0-rc1", { prerelease: true }),
                release("v2.0.0-draft", { draft: true }),
                release("v1.0.0"),
            ]),
        );

        expect((await listReleases(false)).map((r) => r.tag)).toEqual(["v1.0.0"]);
    });

    it("leaves out dev builds unless they are included", async () => {
        restore = stubPlatform("linux", "x64");
        stubNoNvidia();
        vi.spyOn(node, "requestUrl").mockResolvedValue(releaseResponse([release("v1.1.0.dev5"), release("v1.0.0")]));

        expect((await listReleases(false)).map((r) => r.tag)).toEqual(["v1.0.0"]);
        expect((await listReleases(true)).map((r) => r.tag)).toEqual(["v1.1.0.dev5", "v1.0.0"]);
    });

    it("leaves out releases that ship no build for this platform", async () => {
        restore = stubPlatform("linux", "x64");
        stubNoNvidia();
        vi.spyOn(node, "requestUrl").mockResolvedValue(
            releaseResponse([{ tag_name: "v1.0.0", assets: [] }, release("v0.9.0")]),
        );

        expect((await listReleases(false)).map((r) => r.tag)).toEqual(["v0.9.0"]);
    });

    it("falls back to the default build without warning when a CUDA asset is missing", async () => {
        restore = stubPlatform("linux", "x64");
        vi.spyOn(node, "execFile").mockResolvedValue({ stdout: "CUDA Version: 12.5", stderr: "" });
        vi.spyOn(node, "requestUrl").mockResolvedValue(releaseResponse([release("v1.0.0")]));
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

        const releases = await listReleases(false);

        expect(releases[0].variant).toBe("default");
        expect(warn).not.toHaveBeenCalled();
        warn.mockRestore();
    });

    it("throws when GitHub rejects the request", async () => {
        restore = stubPlatform("linux", "x64");
        stubNoNvidia();
        vi.spyOn(node, "requestUrl").mockResolvedValue({ status: 403, json: [], arrayBuffer: new ArrayBuffer(0) });

        await expect(listReleases(false)).rejects.toThrow("GitHub API responded 403");
    });
});
