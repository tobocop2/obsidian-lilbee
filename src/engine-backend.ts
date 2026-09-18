import type { LilbeeClient } from "./api";
import { ENGINE_BACKEND_CPU } from "./types";
import type { GpuInfo } from "./types";

/** Ceiling on the backend read. The export must finish while the server is wedged. */
const READ_TIMEOUT_MS = 5_000;

/** The one backend a fleet runs on. The server keeps a single backend's devices
 *  and plans onto those, so every device it reports shares a backend; an empty
 *  report is a fleet on the CPU. */
function engineBackendOf(gpus: readonly GpuInfo[]): string {
    return gpus[0]?.backend ?? ENGINE_BACKEND_CPU;
}

/** The backend the running server's fleet is on; null when the server cannot say. */
export async function readEngineBackend(api: LilbeeClient): Promise<string | null> {
    const placement = await api.placement({ signal: AbortSignal.timeout(READ_TIMEOUT_MS) });
    return placement.isOk() ? engineBackendOf(placement.value.gpus) : null;
}
