import { Notice, type Modal } from "obsidian";
import { ServerStartingError, SessionTokenError } from "./api";
import { MESSAGES } from "./locales/en";
import { SERVER_MODE } from "./types";
import type { ServerMode } from "./types";

/**
 * Tag the modal's outer wrapper so the stylesheet keeps the close-X button
 * consistently visible. Call from every lilbee modal so users never have to
 * fall back to Escape to dismiss.
 */
export function tagModalChrome(modal: Modal): void {
    modal.modalEl.addClass("lilbee-modal-chrome");
}

/**
 * Bind Escape on the modal's own scope so dismissal works even when an inner
 * input (search box, textarea) holds focus, plus apply the chrome tag so the
 * close-X stays visible.
 */
export function bindEscapeToClose(modal: Modal): void {
    modal.scope.register([], "Escape", () => {
        modal.close();
        return false;
    });
    tagModalChrome(modal);
}

export function debounce<T extends (...args: unknown[]) => unknown>(
    fn: T,
    ms: number,
): { run: (...args: Parameters<T>) => void; cancel: () => void } {
    let timer: number | null = null;
    return {
        run: (...args: Parameters<T>) => {
            if (timer) window.clearTimeout(timer);
            timer = window.setTimeout(() => fn(...args), ms);
        },
        cancel: () => {
            if (timer) {
                window.clearTimeout(timer);
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
// Number of consecutive failed health probes required before flipping the
// status bar to error. One blip every 30s should not announce a problem.
export const HEALTH_FAILURE_STREAK_THRESHOLD = 2;
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
    gen: AsyncGenerator<T, void>,
    timeoutMs: number,
    abort: () => void,
): AsyncGenerator<T> {
    const iter = gen[Symbol.asyncIterator]();
    while (true) {
        let timer: number | null = null;
        const idle = new Promise<"idle">((resolve) => {
            timer = window.setTimeout(() => resolve("idle"), timeoutMs);
        });
        const race = await Promise.race([iter.next(), idle]);
        // Guard against vitest's fake-timer lifecycle leaving clearTimeout undefined
        // across test-file boundaries; in production both are always defined.
        if (timer !== null && typeof clearTimeout === "function") window.clearTimeout(timer);
        if (race === "idle") {
            abort();
            // Fire-and-forget: iter.return() lets the source generator exit its
            // try/finally blocks, but we don't await it — when the underlying
            // fetch is aborted mid-read, the current iter.next() may hang, and
            // awaiting return() would hang with it. abort() already propagates.
            void iter.return?.(undefined);
            throw new StreamIdleError(timeoutMs);
        }
        const { done, value } = race;
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

/**
 * True when `current` orders strictly before `latest` under the release scheme
 * ("0.6.66b507", "0.6.90b420.dev722"): every numeric run compares in sequence,
 * missing runs count as zero. A dev build ahead of the newest release is not older.
 */
export function isVersionOlder(current: string, latest: string): boolean {
    const runs = (v: string): number[] => (v.match(/\d+/g) ?? []).map(Number);
    const a = runs(current);
    const b = runs(latest);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const x = a[i] ?? 0;
        const y = b[i] ?? 0;
        if (x !== y) return x < y;
    }
    return false;
}

/**
 * Render the server's ISO-8601 timestamp ("2026-05-09T05:49:38.800771+00:00")
 * as a human "5m ago" / "3d ago" string. Returns the raw value when parsing
 * fails so callers never lose the data.
 */
export function relativeTimeFromIso(iso: string): string {
    if (!iso) return "";
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return iso;
    return relativeTime(t);
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

// Decimal (SI, 1000-based) sizing for disk figures, which the OS reports in
// decimal. formatBytes above is binary (1024) for in-flight transfer/progress.
export function formatDiskSize(bytes: number): string {
    if (!bytes) return "0 B";
    const exp = Math.min(BYTE_UNITS.length - 1, Math.floor(Math.log10(bytes) / 3));
    const value = bytes / 10 ** (exp * 3);
    const precision = value >= 100 ? 0 : value >= 10 ? 1 : 2;
    return `${value.toFixed(precision)} ${BYTE_UNITS[exp]}`;
}

/** Pick the right session-token-invalid notice for the active server mode. */
export function sessionTokenInvalidMessage(serverMode: ServerMode): string {
    return serverMode === SERVER_MODE.MANAGED
        ? MESSAGES.NOTICE_SESSION_TOKEN_INVALID_MANAGED
        : MESSAGES.NOTICE_SESSION_TOKEN_INVALID;
}

/** Chromium rejects a response stream that dies mid-read with this TypeError message. */
const STREAM_INTERRUPTED_MESSAGE = "network error";

export function isStreamInterruptedError(err: unknown): boolean {
    return err instanceof TypeError && err.message === STREAM_INTERRUPTED_MESSAGE;
}

export function streamInterruptedMessage(serverMode: ServerMode): string {
    return serverMode === SERVER_MODE.MANAGED
        ? MESSAGES.ERROR_STREAM_INTERRUPTED_MANAGED
        : MESSAGES.ERROR_STREAM_INTERRUPTED_EXTERNAL;
}

/**
 * Pull a human-readable message out of an unknown thrown value.
 * Centralizes the `err instanceof Error ? err.message : <fallback>` pattern.
 * Stale-session-token errors get a dedicated, actionable message so the user
 * knows exactly where to fix it (see SessionTokenError in api.ts).
 */
export function errorMessage(err: unknown, fallback: string, serverMode?: ServerMode): string {
    if (err instanceof SessionTokenError) {
        return sessionTokenInvalidMessage(serverMode ?? SERVER_MODE.EXTERNAL);
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
export function noticeForResultError(err: unknown, fallback: string, serverMode?: ServerMode): string {
    if (err instanceof SessionTokenError) {
        return sessionTokenInvalidMessage(serverMode ?? SERVER_MODE.EXTERNAL);
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
 * Distinguishes the role-mismatch 422 (e.g. setting a vision model as chat) from an
 * auth-shaped 422 by the `Set it via PUT /api/models/` remedy phrase. The full prefix
 * keeps unrelated 422s that just happen to mention the endpoint from being misclassified.
 */
export function isRoleMismatchDetail(detail: string): boolean {
    return detail.includes("Set it via PUT /api/models/");
}

// Server error codes meaning the model or its backend is unreachable or gone.
// `auth` is excluded: a missing API key is a settings issue, not a setup one.
const MODEL_UNAVAILABLE_CODES: ReadonlySet<string> = new Set(["connection", "server", "not_found"]);

// Substring the server includes when the optional litellm extra is missing.
const LITELLM_MISSING_MARKER = "lilbee[litellm]";

/** The structured `code` from an SSE error payload, or null. */
export function extractSseErrorCode(data: unknown): string | null {
    if (data && typeof data === "object" && "code" in data) {
        const code = (data as { code?: unknown }).code;
        if (typeof code === "string") return code;
    }
    return null;
}

/** Whether a chat error means the model/provider is unavailable, so the user is routed to setup. */
export function isModelUnavailableError(code: string | null, message: string): boolean {
    if (code !== null && MODEL_UNAVAILABLE_CODES.has(code)) return true;
    return message.includes(LITELLM_MISSING_MARKER);
}

/**
 * Compute a percent (0–100) from a server SSE progress payload.
 * Accepts `{percent, current, total}` shape and prefers `percent` if present;
 * otherwise derives from `current/total`. Returns undefined when neither is usable
 * (e.g. total is zero/missing, or current is missing).
 */
/** Hand a progress bar from its indeterminate animation to a real width. */
export function setDeterminateProgress(fill: HTMLElement, percent: number): void {
    fill.classList.remove("lilbee-wizard-progress-indeterminate");
    fill.style.width = `${percent}%`;
}

/** Whole-number percent of *received* against *total*, or undefined when the total is unknown. */
export function percentOfBytes(received: number, total: number | null): number | undefined {
    if (!total || total <= 0) return undefined;
    return Math.min(100, Math.round((received / total) * 100));
}

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
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- os exists only at runtime inside Electron; a static import would break the esbuild bundle
        const os = require("os") as { totalmem(): number };
        return Math.round(os.totalmem() / (1024 * 1024 * 1024));
    } catch {
        /* v8 ignore next -- os is always available in Node/Electron; the require failure is defensive */
        return null;
    }
}

/**
 * The local machine's RAM only constrains model loads in managed mode where
 * the server runs on this machine. In external mode the server lives on
 * another host whose RAM we don't know — return null and skip the warning.
 */
export function getRelevantSystemMemoryGB(serverMode: ServerMode): number | null {
    if (serverMode !== SERVER_MODE.MANAGED) return null;
    return getSystemMemoryGB();
}

const SERVER_UNREACHABLE_DEBOUNCE_MS = 5000;
let lastServerUnreachableAt = 0;

/** Reset the debounce timer (test-only). */
export function _resetServerUnreachableDebounce(): void {
    lastServerUnreachableAt = 0;
}

function looksLikeConnectionRefused(err: Error): boolean {
    const msg = err.message.toLowerCase();
    return msg.includes("econnrefused") || msg.includes("failed to fetch") || msg.includes("fetch failed");
}

/**
 * Inspect a thrown error and emit at most one "server unreachable" notice per
 * debounce window, swallowing the per-feature message in that case. Returns
 * ``true`` when the error was handled and the caller should skip its own
 * follow-up notice. ``ServerStartingError`` is treated as unreachable too —
 * the user can already see the "starting" UI elsewhere.
 */
export function noticeServerUnreachableIfApplicable(err: unknown): boolean {
    if (err instanceof ServerStartingError) return true;
    if (!(err instanceof Error)) return false;
    if (!looksLikeConnectionRefused(err)) return false;
    const now = Date.now();
    if (now - lastServerUnreachableAt > SERVER_UNREACHABLE_DEBOUNCE_MS) {
        lastServerUnreachableAt = now;
        new Notice(MESSAGES.NOTICE_SERVER_UNREACHABLE);
    }
    return true;
}

/** String value of a server-config key; non-string values read as "". */
export function configString(cfg: Record<string, unknown>, key: string): string {
    const v = cfg[key];
    return typeof v === "string" ? v : "";
}
