import { node } from "./binary-manager";
import { LOG_FILE, type JournalEntry } from "./types";
import { appendCapped } from "./utils/capped-log";

export const JOURNAL_MAX_ENTRIES = 200;
export const PLUGIN_LOG_MAX_BYTES = 262_144;

/** One journal entry as a log line (no trailing newline). */
export function formatJournalEntry(entry: JournalEntry): string {
    return `${entry.timestamp} [${entry.label}] ${entry.message}${entry.stack ? `\n${entry.stack}` : ""}`;
}

/** In-memory ring buffer of plugin errors and lifecycle events, mirrored best-effort to logs/plugin.log. */
export class ErrorJournal {
    private _entries: JournalEntry[] = [];
    private logPath: string | null = null;

    get entries(): readonly JournalEntry[] {
        return this._entries;
    }

    /** Point persistence at `<dataDir>/logs`. */
    setLogDir(dir: string): void {
        this.logPath = node.join(dir, LOG_FILE.PLUGIN);
    }

    /** Record a server-lifecycle decision (start, stop, adopt, update, take-over). */
    lifecycle(message: string): void {
        this.record("lifecycle", message);
    }

    record(label: string, message: string, stack?: string): void {
        const entry: JournalEntry = {
            timestamp: new Date().toISOString(),
            label,
            message,
            stack: stack ?? null,
        };
        this._entries.push(entry);
        if (this._entries.length > JOURNAL_MAX_ENTRIES) this._entries.shift();
        this.append(entry);
    }

    private append(entry: JournalEntry): void {
        if (!this.logPath) return;
        appendCapped(this.logPath, `${formatJournalEntry(entry)}\n`, PLUGIN_LOG_MAX_BYTES);
    }
}
