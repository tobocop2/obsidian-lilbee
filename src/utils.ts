import { SessionTokenError } from "./api";
import { MESSAGES } from "./locales/en";

export function debounce<T extends (...args: unknown[]) => unknown>(
    fn: T,
    ms: number,
): { run: (...args: Parameters<T>) => void; cancel: () => void } {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return {
        run: (...args: Parameters<T>) => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => fn(...args), ms);
        },
        cancel: () => {
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
        },
    };
}

export const DEBOUNCE_MS = 300;
export const RETRY_INTERVAL_MS = 5000;
export const NOTICE_DURATION_MS = 3000;
export const NOTICE_ERROR_DURATION_MS = 8000;
export const NOTICE_PERMANENT = 0;
export const TIME_REFRESH_INTERVAL_MS = 30000;
export const HEALTH_PROBE_INTERVAL_MS = 30_000;
export const SPINNER_MIN_DISPLAY_MS = 800;
// 2 minutes without a single SSE event is long enough to mean "server is wedged" —
// legitimate OCR/embed pauses are shorter. Larger than this and users think the
// plugin hung; smaller and a slow page-OCR pass could trip it. Applies to sync /
// add / crawl streams; pull streams are excluded because long-download idleness
// is expected.
export const STREAM_IDLE_TIMEOUT_MS = 120_000;

export class StreamIdleError extends Error {
    constructor(timeoutMs: number) {
        super(`stream idle for ${Math.round(timeoutMs / 1000)}s`);
        this.name = "StreamIdleError";
    }
}

export async function* withIdleTimeout<T>(
    gen: AsyncGenerator<T>,
    timeoutMs: number,
    abort: () => void,
): AsyncGenerator<T> {
    const iter = gen[Symbol.asyncIterator]();
    while (true) {
        let timer: ReturnType<typeof setTimeout> | null = null;
        const idle = new Promise<"idle">((resolve) => {
            timer = setTimeout(() => resolve("idle"), timeoutMs);
        });
        const race = await Promise.race([iter.next(), idle]);
        // Guard against vitest's fake-timer lifecycle leaving clearTimeout undefined
        // across test-file boundaries; in production both are always defined.
        if (timer !== null && typeof clearTimeout === "function") clearTimeout(timer);
        if (race === "idle") {
            abort();
            // Fire-and-forget: iter.return() lets the source generator exit its
            // try/finally blocks, but we don't await it — when the underlying
            // fetch is aborted mid-read, the current iter.next() may hang, and
            // awaiting return() would hang with it. abort() already propagates.
            void iter.return?.(undefined);
            throw new StreamIdleError(timeoutMs);
        }
        const { done, value } = race as IteratorResult<T>;
        if (done) return;
        yield value;
    }
}

export function formatAbbreviatedCount(count: number): string {
    if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
    if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
    return String(count);
}

export function ensureUrlScheme(url: string): string {
    if (/^https?:\/\//i.test(url)) return url;
    return `https://${url}`;
}

export function relativeTime(timestamp: number): string {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return "just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

export function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
    if (bytes < 1024) return `${bytes} B`;
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
        value /= 1024;
        unit++;
    }
    const rounded = value >= 100 ? value.toFixed(0) : value.toFixed(1);
    return `${rounded} ${BYTE_UNITS[unit]}`;
}

export function formatRate(bytesPerSecond: number): string {
    if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return "";
    return `${formatBytes(bytesPerSecond)}/s`;
}

/**
 * Pull a human-readable message out of an unknown thrown value.
 * Centralizes the `err instanceof Error ? err.message : <fallback>` pattern.
 * Stale-session-token errors get a dedicated, actionable message so the user
 * knows exactly where to fix it (see SessionTokenError in api.ts).
 */
export function errorMessage(err: unknown, fallback: string): string {
    if (err instanceof SessionTokenError) {
        return MESSAGES.NOTICE_SESSION_TOKEN_INVALID;
    }
    return err instanceof Error ? err.message : fallback;
}

/**
 * Returns the most actionable message available for a Result error, falling back to the
 * supplied generic text. Priority:
 *   1. SessionTokenError → the stale-token notice (recovery action: paste a fresh token).
 *   2. Role-mismatch 422 → the server's `detail` string verbatim (tells the user which
 *      endpoint to use instead — see `isRoleMismatchDetail`).
 *   3. Everything else → the operation-specific fallback.
 *
 * Use at `.isErr()` call sites. Centralizing role-mismatch detection here means every
 * caller (Settings panels, CatalogModal, …) surfaces the same actionable diagnostic
 * without duplicating the parse logic.
 */
export function noticeForResultError(err: unknown, fallback: string): string {
    if (err instanceof SessionTokenError) {
        return MESSAGES.NOTICE_SESSION_TOKEN_INVALID;
    }
    if (err instanceof Error) {
        const detail = extractServerErrorDetail(err.message);
        if (detail !== null && isRoleMismatchDetail(detail)) {
            return detail;
        }
    }
    return fallback;
}

/**
 * Pull a human-readable error message out of an SSE `error` event payload.
 * Server may send either a raw string or `{message: string}`. Falls back to
 * the given `unknownFallback` if neither shape matches. Centralizes the
 * `typeof d === "string" ? d : (d.message ?? "unknown error")` pattern.
 */
export function extractSseErrorMessage(data: unknown, unknownFallback: string): string {
    if (typeof data === "string") return data;
    if (data && typeof data === "object" && "message" in data) {
        const msg = (data as { message?: unknown }).message;
        if (typeof msg === "string") return msg;
    }
    return unknownFallback;
}

/**
 * Extract the server's `detail` string from a `Server responded <status>: <body>`
 * error message when the body is JSON of shape `{"detail": "..."}`. Returns null
 * when the error is not in this shape, the body is not JSON, or `detail` is not
 * a string. Used to surface server-authored role-mismatch diagnostics verbatim.
 */
export function extractServerErrorDetail(message: string): string | null {
    const colonIdx = message.indexOf(":");
    if (colonIdx === -1) return null;
    const body = message.slice(colonIdx + 1).trim();
    if (!body) return null;
    try {
        const parsed = JSON.parse(body) as unknown;
        if (parsed && typeof parsed === "object" && "detail" in parsed) {
            const detail = (parsed as { detail?: unknown }).detail;
            if (typeof detail === "string") return detail;
        }
    } catch {
        return null;
    }
    return null;
}

/**
 * Detect the server's role-mismatch error shape. Server PR #156 returns 422 with
 * a detail like `"Model 'X' is a vision model, not chat. Set it via PUT /api/models/vision instead."`
 * when a task-validation check fails. Distinguished from an auth-shaped 422
 * (missing LiteLLM key) by the `Set it via PUT /api/models/` remedy phrase.
 * The exact remedy prefix — not a bare `PUT /api/models/` substring — is used so unrelated
 * 422s that happen to mention the endpoint (e.g. future docs-link errors) aren't misclassified.
 */
export function isRoleMismatchDetail(detail: string): boolean {
    return detail.includes("Set it via PUT /api/models/");
}

/**
 * Compute a percent (0–100) from a server SSE progress payload.
 * Accepts `{percent, current, total}` shape and prefers `percent` if present;
 * otherwise derives from `current/total`. Returns undefined when neither is usable
 * (e.g. total is zero/missing, or current is missing).
 */
export function percentFromSse(data: { percent?: number; current?: number; total?: number }): number | undefined {
    if (data.percent !== undefined) return data.percent;
    if (data.total && data.current !== undefined) {
        return Math.round((data.current / data.total) * 100);
    }
    return undefined;
}

export function formatElapsed(ms: number): string {
    if (!Number.isFinite(ms) || ms < 0) return "00:00";
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const mm = String(minutes).padStart(2, "0");
    const ss = String(seconds).padStart(2, "0");
    if (hours > 0) {
        return `${hours}:${mm}:${ss}`;
    }
    return `${mm}:${ss}`;
}

/** Total system RAM in GB, rounded; null when ``os`` is unavailable. */
export function getSystemMemoryGB(): number | null {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const os = require("os") as { totalmem(): number };
        return Math.round(os.totalmem() / (1024 * 1024 * 1024));
        /* v8 ignore next 3 */
    } catch {
        return null;
    }
}
