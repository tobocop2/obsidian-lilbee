import { Notice } from "obsidian";
import { shell } from "electron";
import { node } from "./binary-manager";
import { buildZip, collectDiagnostics, resolveOutputDir } from "./diagnostics";
import { MESSAGES } from "./locales/en";
import type { DiagnosticsContext } from "./types";

const NOTICE_DURATION_MS = 15_000;

function timestampSlug(): string {
    return new Date().toISOString().replace(/[:.]/g, "-");
}

/** Collect, zip, write, reveal, copy summary. Never throws; reports via Notice. */
export async function exportDiagnostics(ctx: DiagnosticsContext): Promise<void> {
    const bundle = collectDiagnostics(ctx);
    const outDir = resolveOutputDir(ctx.dataDir ?? ".");
    const zipPath = node.join(outDir, `lilbee-diagnostics-${timestampSlug()}.zip`);

    let writtenPath = zipPath;
    try {
        node.writeFileSync(zipPath, buildZip(bundle));
        new Notice(MESSAGES.NOTICE_DIAGNOSTICS_EXPORTED(zipPath), NOTICE_DURATION_MS);
    } catch {
        const summaryPath = node.join(outDir, `lilbee-diagnostics-${timestampSlug()}.summary.md`);
        try {
            node.writeFileSync(summaryPath, bundle.summaryMarkdown);
            writtenPath = summaryPath;
            new Notice(MESSAGES.NOTICE_DIAGNOSTICS_SUMMARY_ONLY(summaryPath), NOTICE_DURATION_MS);
        } catch (e) {
            new Notice(MESSAGES.NOTICE_DIAGNOSTICS_FAILED(e instanceof Error ? e.message : String(e)));
            return;
        }
    }

    try {
        shell.showItemInFolder(writtenPath);
    } catch {
        // notice already carries the path
    }
    try {
        await navigator.clipboard.writeText(bundle.summaryMarkdown);
    } catch {
        // clipboard is best-effort
    }
}
