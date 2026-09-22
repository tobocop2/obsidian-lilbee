import type { LilbeeClient } from "./api";
import { NVIDIA_DEVICE_MARKER } from "./types";
import type { EngineBackend, GpuInfo, PlacementResponse } from "./types";

/** Ceiling on a device read. Both the diagnostics export and the launch cross-check
 *  must finish while the server is wedged. */
const READ_TIMEOUT_MS = 5_000;

/** The placement the running server reports; null when the server cannot say. */
async function readPlacement(api: LilbeeClient): Promise<PlacementResponse | null> {
    const placement = await api.placement({ signal: AbortSignal.timeout(READ_TIMEOUT_MS) });
    return placement.isOk() ? placement.value : null;
}

/** The devices the running server reports; null when the server cannot say. */
export async function readFleetDevices(api: LilbeeClient): Promise<readonly GpuInfo[] | null> {
    return (await readPlacement(api))?.gpus ?? null;
}

/** The backend the running server named, or null when the server cannot say and on
 *  servers too old to send the field. The devices carry their own upper-case backend
 *  token in the same payload; it names a different thing and cannot stand in here. */
export async function readEngineBackend(api: LilbeeClient): Promise<EngineBackend | null> {
    return (await readPlacement(api))?.engine_backend ?? null;
}

/** Whether the server's device report names an NVIDIA card. */
export function hasNvidiaDevice(gpus: readonly GpuInfo[]): boolean {
    return gpus.some((gpu) => gpu.name.toLowerCase().includes(NVIDIA_DEVICE_MARKER));
}
