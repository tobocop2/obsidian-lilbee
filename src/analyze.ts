import { Notice } from "obsidian";
import type LilbeePlugin from "./main";
import { MESSAGES } from "./locales/en";
import type { AnalyzeStateResponse } from "./types";
import { AnalyzeModal } from "./views/analyze-modal";

/** Open the analyze report modal; *onDone* fires once it closes, however the run ended. */
export function runAnalyze(plugin: LilbeePlugin, directory: string | null = null, onDone?: () => void): void {
    new AnalyzeModal(plugin.app, plugin, directory, onDone).open();
}

/** True when the server answers `GET /api/analyze/state` at all. */
export async function analyzeSupported(plugin: LilbeePlugin): Promise<boolean> {
    try {
        return (await plugin.api.analyzeState()) !== null;
    } catch {
        return false;
    }
}

/** Show the analyze tip before an add or a sync starts, only when the server says it should. */
export async function maybeShowAnalyzeTip(plugin: LilbeePlugin): Promise<void> {
    let state: AnalyzeStateResponse | null;
    try {
        state = await plugin.api.analyzeState();
    } catch {
        return;
    }
    if (state?.tip_shows) new Notice(MESSAGES.NOTICE_ANALYZE_TIP);
}

/** Hide the analyze tip for this project; a notice either way, including on a server that predates it. */
export async function dismissAnalyzeTip(plugin: LilbeePlugin): Promise<void> {
    let state: AnalyzeStateResponse | null;
    try {
        state = await plugin.api.dismissAnalyzeTip();
    } catch (error) {
        new Notice(MESSAGES.ERROR_ANALYZE_ACTION(error instanceof Error ? error.message : String(error)));
        return;
    }
    new Notice(state === null ? MESSAGES.NOTICE_ANALYZE_UNSUPPORTED : MESSAGES.NOTICE_ANALYZE_TIP_DISMISSED);
}
