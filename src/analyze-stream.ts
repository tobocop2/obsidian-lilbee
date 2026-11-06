import type LilbeePlugin from "./main";
import { MESSAGES } from "./locales/en";
import { ERROR_NAME, HTTP_STATUS, SSE_EVENT } from "./types";
import type { AnalyzeOptions, AnalyzeProgress, AnalyzeResponse } from "./types";
import { isHttpStatus, SessionTokenError } from "./api";
import {
    extractServerErrorDetail,
    extractSseErrorMessage,
    sessionTokenInvalidMessage,
    STREAM_IDLE_TIMEOUT_MS,
} from "./utils";
import { StreamIdleError, withIdleTimeout } from "./utils/idle";

/** How an analyze run (the preview or a follow-up apply/save) ended. */
export type AnalyzeOutcome =
    | { kind: "report"; report: AnalyzeResponse }
    | { kind: "error"; message: string }
    | { kind: "cancelled" }
    | { kind: "unsupported" };

/** Run one analyze call to completion, reporting progress as it streams. */
export async function drainAnalyze(
    plugin: LilbeePlugin,
    directory: string | null,
    options: AnalyzeOptions | undefined,
    controller: AbortController,
    onProgress: (progress: AnalyzeProgress) => void,
): Promise<AnalyzeOutcome> {
    try {
        const rawStream = plugin.api.analyzeStream(directory, options, controller.signal);
        let report: AnalyzeResponse | null = null;
        for await (const event of withIdleTimeout(rawStream, STREAM_IDLE_TIMEOUT_MS, () => controller.abort())) {
            if (event.event === SSE_EVENT.ANALYZE) {
                onProgress(event.data as AnalyzeProgress);
            } else if (event.event === SSE_EVENT.DONE) {
                report = event.data as AnalyzeResponse;
            } else if (event.event === SSE_EVENT.ERROR) {
                const d = event.data as { message?: string } | string;
                return { kind: "error", message: extractSseErrorMessage(d, MESSAGES.ERROR_UNKNOWN) };
            }
        }
        return report ? { kind: "report", report } : { kind: "error", message: MESSAGES.ERROR_UNKNOWN };
    } catch (err) {
        if (err instanceof StreamIdleError) return { kind: "error", message: MESSAGES.ERROR_STREAM_IDLE };
        if (err instanceof Error && err.name === ERROR_NAME.ABORT_ERROR) return { kind: "cancelled" };
        if (err instanceof SessionTokenError) {
            return { kind: "error", message: sessionTokenInvalidMessage(plugin.settings.serverMode) };
        }
        if (err instanceof Error && isHttpStatus(err, HTTP_STATUS.NOT_FOUND)) return { kind: "unsupported" };
        const message = err instanceof Error ? (extractServerErrorDetail(err.message) ?? err.message) : String(err);
        return { kind: "error", message };
    }
}
