import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { node } from "../src/node";
import { MESSAGES } from "../src/locales/en";
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
const cached = { path: `${BIN_DIR}/v1/lilbee-linux-x86_64`, release: "v1", assetName: "x", variant: "default" };

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

/** An error shaped like the package's LauncherError. */
function launcherError(code: string, fields: Record<string, unknown> = {}): Error {
    return Object.assign(new Error(`launcher said: ${code}`), { name: "LauncherError", code, ...fields });
}

beforeEach(() => {
    vi.clearAllMocks();
    lilbee.detectHost.mockResolvedValue(HOST);
    lilbee.installedBinary.mockReturnValue(null);
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

describe("host detection", () => {
    it.each([
        ["rocm", "default"],
        ["compat-rocm", "compat"],
    ])("falls back from %s to %s when the AMD gfx targets are unknown", async (variant, baseline) => {
        lilbee.detectHost.mockResolvedValue({ ...HOST, variant, amdGfxTargets: [] });
        lilbee.latestRelease.mockResolvedValue(RELEASE);

        await getLatestRelease(false);

        expect(lilbee.latestRelease).toHaveBeenCalledWith(
            expect.objectContaining({ host: expect.objectContaining({ variant: baseline }) }),
        );
    });

    it("keeps the ROCm build when the gfx targets are known", async () => {
        const host = { ...HOST, variant: "rocm", amdGfxTargets: ["gfx1100"] };
        lilbee.detectHost.mockResolvedValue(host);
        lilbee.listReleases.mockResolvedValue([]);

        await listReleases(false);

        expect(lilbee.listReleases).toHaveBeenCalledWith(expect.objectContaining({ host }));
    });
});

describe("error wording", () => {
    it("words a missing-space failure the way the old plugin did", async () => {
        lilbee.latestRelease.mockResolvedValue(RELEASE);
        lilbee.ensureBinary.mockRejectedValue(
            launcherError("no-space", { neededBytes: 440_000_000, freeBytes: 12_000_000 }),
        );

        await expect(new ServerBinary(BIN_DIR).ensure({ includeDev: false })).rejects.toThrow(
            MESSAGES.ERROR_DOWNLOAD_NO_SPACE("440 MB", "12.0 MB"),
        );
    });

    it.each([
        ["stalled", MESSAGES.ERROR_DOWNLOAD_STALLED],
        ["no-digest", MESSAGES.ERROR_DOWNLOAD_UNVERIFIED],
        ["digest-mismatch", MESSAGES.ERROR_DOWNLOAD_UNVERIFIED],
    ])("words a %s failure the way the old plugin did", async (code, message) => {
        lilbee.ensureBinary.mockRejectedValue(launcherError(code));

        await expect(new ServerBinary(BIN_DIR).ensure({ includeDev: false })).rejects.toThrow(message);
    });

    it("names the GitHub status of an http failure from every query", async () => {
        lilbee.listReleases.mockRejectedValue(launcherError("http", { status: 502 }));
        lilbee.latestRelease.mockRejectedValue(launcherError("http", { status: 503 }));

        await expect(listReleases(false)).rejects.toThrow(MESSAGES.ERROR_GITHUB_STATUS(502));
        await expect(getLatestRelease(false)).rejects.toThrow(MESSAGES.ERROR_GITHUB_STATUS(503));
    });

    it.each(["rate-limited", "no-release"])("passes a %s failure through with the package's text", async (code) => {
        const err = launcherError(code);
        lilbee.latestRelease.mockRejectedValue(err);

        await expect(getLatestRelease(false)).rejects.toBe(err);
    });

    it("passes a cancel and any other error through untouched", async () => {
        const cancel = new DownloadCanceledError();
        lilbee.ensureBinary.mockRejectedValueOnce(cancel);
        await expect(new ServerBinary(BIN_DIR).ensure({ includeDev: false })).rejects.toBe(cancel);

        const plain = new Error("ENOENT");
        lilbee.ensureBinary.mockRejectedValueOnce(plain);
        await expect(new ServerBinary(BIN_DIR).ensure({ includeDev: false })).rejects.toBe(plain);
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
    it("looks the bin dir up without probing the host", () => {
        lilbee.installedBinary.mockReturnValue(cached);

        const result = new ServerBinary(BIN_DIR).installed();

        expect(result).toBe(cached);
        expect(lilbee.installedBinary).toHaveBeenCalledWith({ cacheDir: BIN_DIR });
        expect(lilbee.detectHost).not.toHaveBeenCalled();
    });

    it("is null when nothing is installed", () => {
        expect(new ServerBinary(BIN_DIR).installed()).toBeNull();
    });
});

describe("ServerBinary.ensure", () => {
    it("returns the installed binary without probing the host or the network", async () => {
        lilbee.installedBinary.mockReturnValue(cached);

        const result = await new ServerBinary(BIN_DIR).ensure({ includeDev: true });

        expect(result).toEqual({ ...cached, source: "cache", detection: null });
        expect(lilbee.detectHost).not.toHaveBeenCalled();
        expect(lilbee.ensureBinary).not.toHaveBeenCalled();
    });

    it.each([{ release: "v1" }, { force: true }])(
        "goes through the package even when a binary is installed for %o",
        async (extra) => {
            lilbee.installedBinary.mockReturnValue(cached);
            lilbee.ensureBinary.mockResolvedValue({ ...cached, source: "download" });

            await new ServerBinary(BIN_DIR).ensure({ includeDev: false, ...extra });

            expect(lilbee.ensureBinary).toHaveBeenCalledWith(expect.objectContaining(extra));
        },
    );

    it("passes the request through with the bin dir, the detected host, node-fetch, and a digest requirement", async () => {
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

        expect(result).toEqual({ ...cached, source: "cache", detection: null });
        expect(lilbee.ensureBinary).toHaveBeenCalledWith({
            includeDev: true,
            release: "v1",
            force: true,
            onProgress,
            signal,
            cacheDir: BIN_DIR,
            host: HOST,
            fetch: fetchStub,
            requireDigest: true,
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

        await new ServerBinary(BIN_DIR).ensure({ includeDev: false, force: true });

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

describe("ServerBinary.ensure detection report", () => {
    const DETECTION = {
        nvidia: { status: "detected", cudaCeiling: 1204 },
        amd: { status: "unsupported", gfxTargets: ["gfx1100"], reason: "missing-kernels" },
        cpu: { status: "detected", avx2: true },
        detectedAt: "2026-01-01T00:00:00.000Z",
    };

    it("records the probe that chose a downloaded build, without the CPU probe", async () => {
        lilbee.ensureBinary.mockResolvedValue({ ...cached, source: "download", detection: DETECTION });

        const result = await new ServerBinary(BIN_DIR).ensure({ includeDev: false });

        expect(result.detection).toEqual({
            nvidia: DETECTION.nvidia,
            amd: DETECTION.amd,
            detectedAt: DETECTION.detectedAt,
        });
    });

    it("records null when the package resolved nothing", async () => {
        lilbee.ensureBinary.mockResolvedValue({ ...cached, source: "cache" });

        const result = await new ServerBinary(BIN_DIR).ensure({ includeDev: false, force: true });

        expect(result).toEqual({ ...cached, source: "cache", detection: null });
    });

    it("records null for the installed-binary short circuit, where nothing is probed", async () => {
        lilbee.installedBinary.mockReturnValue(cached);

        const result = await new ServerBinary(BIN_DIR).ensure({ includeDev: false });

        expect(result.detection).toBeNull();
        expect(lilbee.detectHost).not.toHaveBeenCalled();
    });
});

describe("migrateFlatBinary", () => {
    let existing: Set<string>;
    let unlinkSync: ReturnType<typeof vi.spyOn>;
    let mkdirSync: ReturnType<typeof vi.spyOn>;
    let renameSync: ReturnType<typeof vi.spyOn>;
    let execFile: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        existing = new Set();
        vi.spyOn(node, "existsSync").mockImplementation((p) => existing.has(String(p)));
        unlinkSync = vi.spyOn(node, "unlinkSync").mockImplementation(() => {});
        mkdirSync = vi.spyOn(node, "mkdirSync").mockImplementation(() => undefined);
        renameSync = vi.spyOn(node, "renameSync").mockImplementation(() => {});
        execFile = vi.spyOn(node, "execFile").mockRejectedValue(new Error("not run"));
    });

    it("does nothing when the bin dir holds no flat binary", async () => {
        expect(await migrateFlatBinary(BIN_DIR, "v1", "default")).toBeNull();

        expect(unlinkSync).not.toHaveBeenCalled();
        expect(renameSync).not.toHaveBeenCalled();
        expect(execFile).not.toHaveBeenCalled();
    });

    it("moves a flat binary with a recorded version into the release dir under its asset name", async () => {
        const restore = stubPlatform("linux", "x64");
        existing.add(`${BIN_DIR}/lilbee`);

        const moved = await migrateFlatBinary(BIN_DIR, "v0.6.90b425", "cu124");

        expect(moved).toEqual({ release: "v0.6.90b425", variant: "cu124" });
        expect(mkdirSync).toHaveBeenCalledWith(`${BIN_DIR}/v0.6.90b425`, { recursive: true });
        expect(renameSync).toHaveBeenCalledWith(
            `${BIN_DIR}/lilbee`,
            `${BIN_DIR}/v0.6.90b425/lilbee-linux-x86_64-cu124`,
        );
        expect(unlinkSync).not.toHaveBeenCalled();
        expect(execFile).not.toHaveBeenCalled();
        restore();
    });

    it("names the default build when the install predates build tracking", async () => {
        const restore = stubPlatform("darwin", "arm64");
        existing.add(`${BIN_DIR}/lilbee`);

        const moved = await migrateFlatBinary(BIN_DIR, "v0.6.80", "");

        expect(moved).toEqual({ release: "v0.6.80", variant: "default" });
        expect(renameSync).toHaveBeenCalledWith(`${BIN_DIR}/lilbee`, `${BIN_DIR}/v0.6.80/lilbee-macos-arm64`);
        restore();
    });

    it("files a recorded build this host cannot name under the default build", async () => {
        const restore = stubPlatform("darwin", "arm64");
        existing.add(`${BIN_DIR}/lilbee`);

        const moved = await migrateFlatBinary(BIN_DIR, "v0.6.80", "cu124");

        expect(moved).toEqual({ release: "v0.6.80", variant: "default" });
        expect(renameSync).toHaveBeenCalledWith(`${BIN_DIR}/lilbee`, `${BIN_DIR}/v0.6.80/lilbee-macos-arm64`);
        expect(unlinkSync).not.toHaveBeenCalled();
        restore();
    });

    it("moves lilbee.exe on Windows", async () => {
        const restore = stubPlatform("win32", "x64");
        existing.add(`${BIN_DIR}/lilbee.exe`);

        await migrateFlatBinary(BIN_DIR, "v0.6.90", "cu125");

        expect(renameSync).toHaveBeenCalledWith(
            `${BIN_DIR}/lilbee.exe`,
            `${BIN_DIR}/v0.6.90/lilbee-windows-x86_64-cu125.exe`,
        );
        restore();
    });

    it("asks an unrecorded binary for its version and keeps it under that release", async () => {
        const restore = stubPlatform("linux", "x64");
        existing.add(`${BIN_DIR}/lilbee`);
        execFile.mockResolvedValue({ stdout: "lilbee 0.6.90b432\n", stderr: "" });

        const moved = await migrateFlatBinary(BIN_DIR, "", "");

        expect(execFile).toHaveBeenCalledWith(`${BIN_DIR}/lilbee`, ["--version"]);
        expect(moved).toEqual({ release: "v0.6.90b432", variant: "default" });
        expect(renameSync).toHaveBeenCalledWith(`${BIN_DIR}/lilbee`, `${BIN_DIR}/v0.6.90b432/lilbee-linux-x86_64`);
        expect(unlinkSync).not.toHaveBeenCalled();
        restore();
    });

    it("deletes an unrecorded binary only when it cannot say what it is", async () => {
        existing.add(`${BIN_DIR}/lilbee`);

        expect(await migrateFlatBinary(BIN_DIR, "", "default")).toBeNull();

        expect(unlinkSync).toHaveBeenCalledWith(`${BIN_DIR}/lilbee`);
        expect(renameSync).not.toHaveBeenCalled();
    });

    it("deletes an unrecorded binary whose version output is empty", async () => {
        existing.add(`${BIN_DIR}/lilbee`);
        execFile.mockResolvedValue({ stdout: "lilbee\n", stderr: "" });

        expect(await migrateFlatBinary(BIN_DIR, "", "")).toBeNull();

        expect(unlinkSync).toHaveBeenCalledWith(`${BIN_DIR}/lilbee`);
    });

    it("removes a leftover partial download", async () => {
        existing.add(`${BIN_DIR}/lilbee.part`);

        await migrateFlatBinary(BIN_DIR, "v1", "default");

        expect(unlinkSync).toHaveBeenCalledWith(`${BIN_DIR}/lilbee.part`);
        expect(renameSync).not.toHaveBeenCalled();
    });
});
