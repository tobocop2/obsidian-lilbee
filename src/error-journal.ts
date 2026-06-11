import { node } from "./binary-manager";
import type { JournalEntry } from "./types";
import { appendCapped } from "./utils/capped-log";

export const JOURNAL_MAX_ENTRIES = 200;
export const PLUGIN_LOG_MAX_BYTES = 262_144;
const PLUGIN_LOG_FILE = "plugin.log";

/** In-memory ring buffer of plugin errors, mirrored best-effort to logs/plugin.log. */
export class ErrorJournal {
    private _entries: JournalEntry[] = [];
    private logPath: string | null = null;

    get entries(): readonly JournalEntry[] {
        return this._entries;
    }

    /** Point persistence at `<dataDir>/logs`. */
    setLogDir(dir: string): void {
        this.logPath = node.join(dir, PLUGIN_LOG_FILE);
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
        const line = `${entry.timestamp} [${entry.label}] ${entry.message}${entry.stack ? `\n${entry.stack}` : ""}\n`;
        appendCapped(this.logPath, line, PLUGIN_LOG_MAX_BYTES);
    }
}
