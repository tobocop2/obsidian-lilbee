import { describe, expect, it, vi } from "vitest";
import { LilbeeClient } from "../src/api";
import { hasNvidiaDevice, readEngineBackend, readFleetDevices } from "../src/engine-backend";
import { err, ok } from "../src/result";
import { ENGINE_BACKEND } from "../src/types";
import type { EngineBackend, GpuInfo, PlacementResponse } from "../src/types";

function gpu(overrides: Partial<GpuInfo> = {}): GpuInfo {
    return {
        index: 0,
        backend: "CUDA",
        label: "CUDA0",
        name: "NVIDIA GeForce RTX 4080 SUPER",
        total_bytes: 17_179_869_184,
        free_bytes: 16_000_000_000,
        ...overrides,
    };
}

/** The device a Metal host reports beside `engine_backend: "metal"`, measured on
 *  the build that shipped as lilbee 0.6.90b443. The upper-case `backend` token is
 *  the trap: it names the same host in a different vocabulary. */
const APPLE_GPU: GpuInfo = {
    index: 0,
    backend: "MTL",
    label: "MTL0",
    name: "Apple M1 Pro",
    total_bytes: 22_906_142_720,
    free_bytes: 22_905_094_144,
};

/** The measured shape of `GET /api/placement`. Omit `engine_backend` for a server
 *  older than 0.6.90b443, which does not send the field. */
function placement(gpus: GpuInfo[], engine_backend?: EngineBackend): PlacementResponse {
    return {
        gpus,
        engine_backend,
        roles: [],
        unplaceable: [],
        manual: false,
        spec_json: null,
        rejected_spec_json: null,
    };
}

function clientReturning(result: Awaited<ReturnType<LilbeeClient["placement"]>>) {
    const call = vi.fn().mockResolvedValue(result);
    return { api: { placement: call } as unknown as LilbeeClient, call };
}

describe("readEngineBackend", () => {
    it("reports the backend the server names, not the token its devices carry", async () => {
        const { api } = clientReturning(ok(placement([APPLE_GPU], ENGINE_BACKEND.METAL)));
        const backend = await readEngineBackend(api);
        expect(backend).toBe(ENGINE_BACKEND.METAL);
        expect(backend).not.toBe(APPLE_GPU.backend);
    });

    it("tells a CPU host apart from a probe that never answered", async () => {
        const cpuHost = clientReturning(ok(placement([], ENGINE_BACKEND.CPU)));
        const failedProbe = clientReturning(ok(placement([], ENGINE_BACKEND.UNKNOWN)));
        const onCpuHost = await readEngineBackend(cpuHost.api);
        const onFailedProbe = await readEngineBackend(failedProbe.api);
        expect(onCpuHost).toBe(ENGINE_BACKEND.CPU);
        expect(onFailedProbe).toBe(ENGINE_BACKEND.UNKNOWN);
        expect(onFailedProbe).not.toBe(onCpuHost);
    });

    it("keeps the unknown answer when the host lists a device the engine never loaded", async () => {
        const loaderDevice = gpu({ backend: "VK", label: "VK0", name: "AMD Radeon RX 7900 XTX" });
        const { api } = clientReturning(ok(placement([loaderDevice], ENGINE_BACKEND.UNKNOWN)));
        await expect(readEngineBackend(api)).resolves.toBe(ENGINE_BACKEND.UNKNOWN);
    });

    it("reports no backend from a server too old to send the field", async () => {
        const { api } = clientReturning(ok(placement([APPLE_GPU])));
        await expect(readEngineBackend(api)).resolves.toBeNull();
    });

    it("returns null when the server cannot report a placement", async () => {
        const { api } = clientReturning(err(new Error("connection refused")));
        await expect(readEngineBackend(api)).resolves.toBeNull();
    });

    // The reader's deadline is 5 s. This window admits a loaded machine and the 250 ms
    // poll granularity of the client's host wait, and no raised ceiling can land in it:
    // the read ends when the deadline fires, so the elapsed time IS the constant.
    const DEADLINE_FLOOR_MS = 4_000;
    const DEADLINE_CEILING_MS = 9_000;

    it("ends the read on its own deadline when the server accepts and never answers", async () => {
        // A wedged server: the request never settles by itself, so only the
        // reader's deadline can end it. Real timers; AbortSignal.timeout ignores
        // vitest's fake ones.
        const wedged = vi.fn(
            (_url: string, init?: RequestInit) =>
                new Promise<Response>((_resolve, reject) => {
                    init?.signal?.addEventListener("abort", () =>
                        reject(new DOMException("The operation was aborted", "AbortError")),
                    );
                }),
        );
        vi.stubGlobal("fetch", wedged);
        try {
            const api = new LilbeeClient("http://127.0.0.1:7433");
            const startedAt = Date.now();
            const backend = await readEngineBackend(api);
            const elapsed = Date.now() - startedAt;
            expect(backend).toBeNull();
            expect(wedged).toHaveBeenCalledTimes(1);
            expect(elapsed).toBeGreaterThanOrEqual(DEADLINE_FLOOR_MS);
            expect(elapsed).toBeLessThan(DEADLINE_CEILING_MS);
        } finally {
            vi.unstubAllGlobals();
        }
    }, 15_000);
});

describe("readFleetDevices", () => {
    it("returns the devices the server reports", async () => {
        const { api } = clientReturning(ok(placement([gpu(), gpu({ index: 1 })])));
        await expect(readFleetDevices(api)).resolves.toHaveLength(2);
    });

    it("returns null when the server cannot report a placement", async () => {
        const { api } = clientReturning(err(new Error("connection refused")));
        await expect(readFleetDevices(api)).resolves.toBeNull();
    });
});

describe("hasNvidiaDevice", () => {
    it("names an NVIDIA device whatever case the server reports it in", () => {
        expect(hasNvidiaDevice([gpu({ name: "nvidia geforce rtx 4080 super" })])).toBe(true);
    });

    it("is false when no device name mentions NVIDIA", () => {
        expect(hasNvidiaDevice([gpu({ name: "AMD Radeon RX 7900 XTX" })])).toBe(false);
    });

    it("is false when the server reports no device", () => {
        expect(hasNvidiaDevice([])).toBe(false);
    });
});
