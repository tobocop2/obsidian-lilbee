import { zipSync } from "fflate";
import { node } from "./binary-manager";
import { formatJournalEntry } from "./error-journal";
import { MESSAGES } from "./locales/en";
import { redactSecrets, redactSettings } from "./redact";
import { LOG_FILE, LOGS_DIR } from "./types";
import type { CollectedFile, DiagnosticsBundle, DiagnosticsContext } from "./types";

export const LOG_TAIL_MAX_BYTES = 1_048_576;
const textEncoder = new TextEncoder();
const NOTE_NOT_FOUND = "not found";
const NOTE_TRUNCATED = "truncated to last 1 MiB";
const EXPECTED_LOGS = Object.values(LOG_FILE);

/** Reads a file, keeping only the last LOG_TAIL_MAX_BYTES when oversized. */
function readTailCapped(path: string): { text: string; note: string | null } {
    const size = node.statSync(path).size;
    const text = node.readFileSync(path, "utf-8");
    if (size <= LOG_TAIL_MAX_BYTES) return { text, note: null };
    return { text: text.slice(-LOG_TAIL_MAX_BYTES), note: NOTE_TRUNCATED };
}

/** Collects one file as redacted bytes, or a miss with the reason noted. */
function collectFile(zipName: string, path: string): CollectedFile {
    try {
        if (!node.existsSync(path)) return { name: zipName, data: null, note: NOTE_NOT_FOUND };
        const { text, note } = readTailCapped(path);
        return { name: zipName, data: textEncoder.encode(redactSecrets(text)), note };
    } catch (e) {
        return { name: zipName, data: null, note: e instanceof Error ? e.message : String(e) };
    }
}

/** Lists .log file names under <dataDir>/logs, or [] when unreadable. */
function listLogFiles(dataDir: string): string[] {
    try {
        const dir = node.join(dataDir, LOGS_DIR);
        if (!node.existsSync(dir)) return [];
        return node
            .readdirSync(dir)
            .filter((f) => String(f).endsWith(".log"))
            .map(String);
    } catch {
        return [];
    }
}

/** Collects every log under the data dir, recording misses for expected names. */
function collectLogFiles(dataDir: string | null): CollectedFile[] {
    if (dataDir === null) return [];
    const found = listLogFiles(dataDir).map((name) =>
        collectFile(`${LOGS_DIR}/${name}`, node.join(dataDir, LOGS_DIR, name)),
    );
    const haveNames = new Set(found.map((f) => f.name));
    for (const name of EXPECTED_LOGS) {
        const zipName = `${LOGS_DIR}/${name}`;
        if (!haveNames.has(zipName)) found.push({ name: zipName, data: null, note: NOTE_NOT_FOUND });
    }
    return found;
}

/** Renders the journal entries as plain log lines. */
function journalText(ctx: DiagnosticsContext): string {
    return ctx.journalEntries.map(formatJournalEntry).join("\n");
}

/** Renders the human-readable summary.md for the bundle. */
export function renderSummary(ctx: DiagnosticsContext, files: CollectedFile[]): string {
    const lines: string[] = [
        MESSAGES.DIAG_REVIEW_WARNING,
        "",
        "# lilbee diagnostics",
        "",
        "## Environment",
        `- Plugin version: ${ctx.pluginVersion}`,
        `- Server version: ${ctx.serverVersion || "(unknown)"}`,
        `- Platform: ${process.platform} ${process.arch}`,
        `- Server state: ${ctx.serverState}`,
        `- Server URL: ${ctx.serverUrl || "(none)"}`,
        `- Data dir: ${ctx.dataDir ?? `(not local) ${MESSAGES.DIAG_REMOTE_SERVER_NOTE}`}`,
        `- Shared root: ${ctx.sharedRoot ?? "(none)"}`,
        "",
        "## Last server output",
        "```",
        redactSecrets(ctx.lastOutput) || "(empty)",
        "```",
        "",
        "## Collected files",
        ...files.map((f) => `- ${f.name}: ${f.data === null ? (f.note ?? "missing") : (f.note ?? "ok")}`),
        "",
        "## Recent plugin errors",
        "```",
        redactSecrets(journalText(ctx)) || "(none)",
        "```",
    ];
    return lines.join("\n");
}

/** Gathers logs, config, settings, and the journal into a redacted bundle. */
export function collectDiagnostics(ctx: DiagnosticsContext): DiagnosticsBundle {
    const files: CollectedFile[] = collectLogFiles(ctx.dataDir);
    if (ctx.dataDir !== null) {
        files.push(collectFile("config.toml", node.join(ctx.dataDir, "config.toml")));
    }
    files.push({
        name: "settings.json",
        data: textEncoder.encode(JSON.stringify(redactSettings(ctx.settings), null, 2)),
        note: null,
    });
    files.push({ name: "journal.log", data: textEncoder.encode(redactSecrets(journalText(ctx))), note: null });
    const summaryMarkdown = renderSummary(ctx, files);
    return { files, summaryMarkdown };
}

/** Zips the summary plus every collected file, skipping misses. */
export function buildZip(bundle: DiagnosticsBundle): Uint8Array {
    const entries: Record<string, Uint8Array> = { "summary.md": textEncoder.encode(bundle.summaryMarkdown) };
    for (const file of bundle.files) {
        if (file.data !== null) entries[file.name] = file.data;
    }
    // The store scanner lints without fflate's types; unknown keeps both linters satisfied.
    const zipped: unknown = zipSync(entries);
    return zipped as Uint8Array;
}

/** Returns ~/Downloads when present, otherwise the given fallback dir. */
export function resolveOutputDir(fallbackDir: string): string {
    const home = process.env.HOME ?? process.env.USERPROFILE;
    if (home) {
        const downloads = node.join(home, "Downloads");
        try {
            if (node.existsSync(downloads)) return downloads;
        } catch {
            // fall through to fallbackDir
        }
    }
    return fallbackDir;
}
