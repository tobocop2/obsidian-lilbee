import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { node } from "../src/node";
import {
    DownloadCanceledError,
    ServerBinary,
    checkForUpdate,
    getLatestRelease,
    isDevBuild,
    isDownloadCanceled,
    listReleases,
    migrateFlatBinary,
} from "../src/server-binary";

const { fetchStub, lilbee } = vi.hoisted(() => ({
    fetchStub: vi.fn(),
    lilbee: {
        detectHost: vi.fn(),
        ensureBinary: vi.fn(),
        installedBinary: vi.fn(),
        latestRelease: vi.fn(),
        listReleases: vi.fn(),
    },
}));

vi.mock("node-fetch", () => ({ default: fetchStub }));
vi.mock("lilbee", async (importOriginal) => ({
    ...(await importOriginal<typeof import("lilbee")>()),
    ...lilbee,
}));

const HOST = { platform: "linux", arch: "x64", variant: "cu124", amdGfxTargets: [] };
const RELEASE = {
    tag: "v0.6.97",
    dev: false,
    assetName: "lilbee-linux-x86_64-cu124",
    variant: "cu124",
    size: 400,
    digest: "abc",
    url: "https://example.com/asset",
};
const BIN_DIR = "/shared/bin";

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

beforeEach(() => {
    vi.clearAllMocks();
    lilbee.detectHost.mockResolvedValue(HOST);
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe("release queries", () => {
    it("lists releases for the detected host over node-fetch", async () => {
        lilbee.listReleases.mockResolvedValue([RELEASE]);

        const releases = await listReleases(true);

        expect(releases).toEqual([RELEASE]);
        expect(lilbee.listReleases).toHaveBeenCalledWith({ includeDev: true, host: HOST, fetch: fetchStub });
    });

    it("resolves the latest release for the detected host over node-fetch", async () => {
        lilbee.latestRelease.mockResolvedValue(RELEASE);

        const release = await getLatestRelease(false);

        expect(release).toBe(RELEASE);
        expect(lilbee.latestRelease).toHaveBeenCalledWith({ includeDev: false, host: HOST, fetch: fetchStub });
    });

    it("re-exports the package's dev-build and cancel helpers", () => {
        expect(isDevBuild("v0.6.90b420.dev711")).toBe(true);
        expect(isDevBuild("v0.6.90b420")).toBe(false);
        expect(isDownloadCanceled(new DownloadCanceledError())).toBe(true);
        expect(isDownloadCanceled(new Error("boom"))).toBe(false);
    });
});

describe("checkForUpdate", () => {
    it("reports an update only when the latest tag is known and differs", () => {
        expect(checkForUpdate("v1", "v2")).toBe(true);
        expect(checkForUpdate("v1", "v1")).toBe(false);
        expect(checkForUpdate("v1", "")).toBe(false);
    });
});

describe("ServerBinary.installed", () => {
    it("looks the bin dir up for this platform and arch without probing the GPU", () => {
        const restore = stubPlatform("linux", "x64");
        const installed = {
            path: `${BIN_DIR}/v1/lilbee-linux-x86_64`,
            release: "v1",
            assetName: "x",
            variant: "default",
        };
        lilbee.installedBinary.mockReturnValue(installed);

        const result = new ServerBinary(BIN_DIR).installed();

        expect(result).toBe(installed);
        expect(lilbee.installedBinary).toHaveBeenCalledWith({
            cacheDir: BIN_DIR,
            host: { platform: "linux", arch: "x64", variant: "default", amdGfxTargets: [] },
        });
        expect(lilbee.detectHost).not.toHaveBeenCalled();
        restore();
    });

    it("is null when nothing is installed", () => {
        lilbee.installedBinary.mockReturnValue(null);
        expect(new ServerBinary(BIN_DIR).installed()).toBeNull();
    });
});

describe("ServerBinary.ensure", () => {
    const cached = { path: `${BIN_DIR}/v1/lilbee-linux-x86_64`, release: "v1", assetName: "x", variant: "default" };

    it("passes the request through with the bin dir, the detected host, and node-fetch", async () => {
        lilbee.ensureBinary.mockResolvedValue({ ...cached, source: "cache" });
        const onProgress = vi.fn();
        const signal = new AbortController().signal;

        const result = await new ServerBinary(BIN_DIR).ensure({
            includeDev: true,
            release: "v1",
            force: true,
            onProgress,
            signal,
        });

        expect(result).toEqual({ ...cached, source: "cache" });
        expect(lilbee.ensureBinary).toHaveBeenCalledWith({
            includeDev: true,
            release: "v1",
            force: true,
            onProgress,
            signal,
            cacheDir: BIN_DIR,
            host: HOST,
            fetch: fetchStub,
        });
    });

    it("forwards download progress as the package reports it", async () => {
        lilbee.ensureBinary.mockImplementation(async ({ onProgress }: { onProgress: (p: unknown) => void }) => {
            onProgress({ done: 5, total: 10 });
            return { ...cached, source: "download" };
        });
        const onProgress = vi.fn();

        await new ServerBinary(BIN_DIR).ensure({ includeDev: false, onProgress });

        expect(onProgress).toHaveBeenCalledWith({ done: 5, total: 10 });
    });

    it("propagates the package's cancel error unchanged", async () => {
        lilbee.ensureBinary.mockRejectedValue(new DownloadCanceledError());

        await expect(new ServerBinary(BIN_DIR).ensure({ includeDev: false })).rejects.toSatisfy(isDownloadCanceled);
    });

    it("clears macOS quarantine after a fresh download", async () => {
        const restore = stubPlatform("darwin", "arm64");
        lilbee.ensureBinary.mockResolvedValue({ ...cached, source: "download" });
        const execFile = vi.spyOn(node, "execFile").mockResolvedValue({ stdout: "", stderr: "" });
        const onQuarantineFailed = vi.fn();

        await new ServerBinary(BIN_DIR).ensure({ includeDev: false, onQuarantineFailed });

        expect(execFile).toHaveBeenCalledWith("xattr", ["-cr", cached.path]);
        expect(onQuarantineFailed).not.toHaveBeenCalled();
        restore();
    });

    it("reports a quarantine that could not be cleared and still returns the binary", async () => {
        const restore = stubPlatform("darwin", "arm64");
        lilbee.ensureBinary.mockResolvedValue({ ...cached, source: "download" });
        vi.spyOn(node, "execFile").mockRejectedValue(new Error("xattr: not permitted"));
        const onQuarantineFailed = vi.fn();

        const result = await new ServerBinary(BIN_DIR).ensure({ includeDev: false, onQuarantineFailed });

        expect(result.path).toBe(cached.path);
        expect(onQuarantineFailed).toHaveBeenCalledTimes(1);
        restore();
    });

    it("leaves a cached macOS binary alone", async () => {
        const restore = stubPlatform("darwin", "arm64");
        lilbee.ensureBinary.mockResolvedValue({ ...cached, source: "cache" });
        const execFile = vi.spyOn(node, "execFile");

        await new ServerBinary(BIN_DIR).ensure({ includeDev: false });

        expect(execFile).not.toHaveBeenCalled();
        restore();
    });

    it("runs no quarantine step off macOS", async () => {
        const restore = stubPlatform("linux", "x64");
        lilbee.ensureBinary.mockResolvedValue({ ...cached, source: "download" });
        const execFile = vi.spyOn(node, "execFile");

        await new ServerBinary(BIN_DIR).ensure({ includeDev: false });

        expect(execFile).not.toHaveBeenCalled();
        restore();
    });
});

describe("migrateFlatBinary", () => {
    let existing: Set<string>;
    let unlinkSync: ReturnType<typeof vi.spyOn>;
    let mkdirSync: ReturnType<typeof vi.spyOn>;
    let renameSync: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        existing = new Set();
        vi.spyOn(node, "existsSync").mockImplementation((p) => existing.has(String(p)));
        unlinkSync = vi.spyOn(node, "unlinkSync").mockImplementation(() => {});
        mkdirSync = vi.spyOn(node, "mkdirSync").mockImplementation(() => undefined);
        renameSync = vi.spyOn(node, "renameSync").mockImplementation(() => {});
    });

    it("does nothing when the bin dir holds no flat binary", () => {
        migrateFlatBinary(BIN_DIR, "v1", "default");

        expect(unlinkSync).not.toHaveBeenCalled();
        expect(renameSync).not.toHaveBeenCalled();
    });

    it("moves a flat binary with a recorded version into the release dir under its asset name", () => {
        const restore = stubPlatform("linux", "x64");
        existing.add(`${BIN_DIR}/lilbee`);

        migrateFlatBinary(BIN_DIR, "v0.6.90b425", "cu124");

        expect(mkdirSync).toHaveBeenCalledWith(`${BIN_DIR}/v0.6.90b425`, { recursive: true });
        expect(renameSync).toHaveBeenCalledWith(
            `${BIN_DIR}/lilbee`,
            `${BIN_DIR}/v0.6.90b425/lilbee-linux-x86_64-cu124`,
        );
        expect(unlinkSync).not.toHaveBeenCalled();
        restore();
    });

    it("names the default build when the install predates build tracking", () => {
        const restore = stubPlatform("darwin", "arm64");
        existing.add(`${BIN_DIR}/lilbee`);

        migrateFlatBinary(BIN_DIR, "v0.6.80", "");

        expect(renameSync).toHaveBeenCalledWith(`${BIN_DIR}/lilbee`, `${BIN_DIR}/v0.6.80/lilbee-macos-arm64`);
        restore();
    });

    it("moves lilbee.exe on Windows", () => {
        const restore = stubPlatform("win32", "x64");
        existing.add(`${BIN_DIR}/lilbee.exe`);

        migrateFlatBinary(BIN_DIR, "v0.6.90", "cu125");

        expect(renameSync).toHaveBeenCalledWith(
            `${BIN_DIR}/lilbee.exe`,
            `${BIN_DIR}/v0.6.90/lilbee-windows-x86_64-cu125.exe`,
        );
        restore();
    });

    it("deletes a flat binary whose version was never recorded", () => {
        existing.add(`${BIN_DIR}/lilbee`);

        migrateFlatBinary(BIN_DIR, "", "default");

        expect(unlinkSync).toHaveBeenCalledWith(`${BIN_DIR}/lilbee`);
        expect(renameSync).not.toHaveBeenCalled();
    });

    it("removes a leftover partial download", () => {
        existing.add(`${BIN_DIR}/lilbee.part`);

        migrateFlatBinary(BIN_DIR, "v1", "default");

        expect(unlinkSync).toHaveBeenCalledWith(`${BIN_DIR}/lilbee.part`);
        expect(renameSync).not.toHaveBeenCalled();
    });
});
