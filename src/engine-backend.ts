import type { LilbeeClient } from "./api";
import { ENGINE_BACKEND_CPU, NVIDIA_DEVICE_MARKER } from "./types";
import type { GpuInfo } from "./types";

/** Ceiling on the backend read. The export must finish while the server is wedged. */
const READ_TIMEOUT_MS = 5_000;

/** The one backend a fleet runs on. The server keeps a single backend's devices
 *  and plans onto those, so every device it reports shares a backend; an empty
 *  report is a fleet on the CPU. */
function engineBackendOf(gpus: readonly GpuInfo[]): string {
    return gpus[0]?.backend ?? ENGINE_BACKEND_CPU;
}

/** The devices the running server reports; null when the server cannot say. */
export async function readFleetDevices(api: LilbeeClient): Promise<readonly GpuInfo[] | null> {
    const placement = await api.placement({ signal: AbortSignal.timeout(READ_TIMEOUT_MS) });
    return placement.isOk() ? placement.value.gpus : null;
}

/** The backend the running server's fleet is on; null when the server cannot say. */
export async function readEngineBackend(api: LilbeeClient): Promise<string | null> {
    const gpus = await readFleetDevices(api);
    return gpus === null ? null : engineBackendOf(gpus);
}

/** Whether the server's device report names an NVIDIA card. */
export function hasNvidiaDevice(gpus: readonly GpuInfo[]): boolean {
    return gpus.some((gpu) => gpu.name.toLowerCase().includes(NVIDIA_DEVICE_MARKER));
}
