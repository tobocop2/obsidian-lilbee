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
