import { App, Modal, Notice } from "obsidian";
import type LilbeePlugin from "../main";
import { MESSAGES } from "../locales/en";
import { PROFILE_EFFECT } from "../types";
import type { AnalyzeProgress, AnalyzeResponse, ProfileFolder } from "../types";
import { bindEscapeToClose } from "../utils";
import { startReindexSync } from "../utils/reindex";
import { drainAnalyze } from "../analyze-stream";
import type { AnalyzeOutcome } from "../analyze-stream";
import { ProfileNameModal } from "./profile-name-modal";
import { profileValueText, renderNote, renderProfileTable } from "./profile-parts";

/** Runs analyze, shows the report, and applies or saves the recommendation; cancellable throughout. */
export class AnalyzeModal extends Modal {
    private controller: AbortController | null = null;
    private report: AnalyzeResponse | null = null;
    private statusEl: HTMLElement | null = null;
    private closed = false;
    private doneCalled = false;

    constructor(
        app: App,
        private readonly plugin: LilbeePlugin,
        private readonly directory: string | null,
        private readonly onDone?: () => void,
    ) {
        super(app);
        bindEscapeToClose(this);
    }

    onOpen(): void {
        void this.startPreview();
    }

    onClose(): void {
        this.closed = true;
        this.controller?.abort();
        if (!this.doneCalled) {
            this.doneCalled = true;
            this.onDone?.();
        }
    }

    private async startPreview(): Promise<void> {
        this.renderRunning(MESSAGES.TITLE_ANALYZE_RUNNING, () => this.controller?.abort());
        this.controller = new AbortController();
        const outcome = await drainAnalyze(this.plugin, this.directory, undefined, this.controller, (progress) =>
            this.updateProgress(progress),
        );
        this.controller = null;
        if (this.closed) return;
        if (outcome.kind === "report") {
            this.report = outcome.report;
            this.renderReport();
        } else if (outcome.kind === "unsupported") {
            new Notice(MESSAGES.NOTICE_ANALYZE_UNSUPPORTED);
            this.close();
        } else if (outcome.kind === "error") {
            new Notice(MESSAGES.ERROR_ANALYZE_ACTION(outcome.message));
            this.close();
        } else {
            this.close();
        }
    }

    private renderRunning(title: string, onCancel: () => void): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("lilbee-analyze-modal");
        contentEl.createEl("h3", { text: title });
        this.statusEl = contentEl.createEl("p", { text: MESSAGES.STATUS_ANALYZE_STARTING });
        const actions = contentEl.createDiv({ cls: "modal-button-container" });
        const cancel = actions.createEl("button", { text: MESSAGES.BUTTON_CANCEL });
        cancel.addEventListener("click", onCancel);
    }

    private updateProgress(progress: AnalyzeProgress): void {
        this.statusEl?.setText(MESSAGES.STATUS_ANALYZE_PROGRESS(progress.done, progress.total, progress.file));
    }

    private renderReport(): void {
        const { contentEl, report } = this;
        if (!report) return;
        contentEl.empty();
        contentEl.addClass("lilbee-analyze-modal");
        contentEl.createEl("h3", { text: MESSAGES.TITLE_ANALYZE_REPORT });
        this.renderFindings(contentEl, report);
        this.renderFailures(contentEl, report);
        this.renderStats(contentEl, report);
        this.renderRecommendation(contentEl, report);
        this.renderReportActions(contentEl, report);
    }

    private renderFindings(container: HTMLElement, report: AnalyzeResponse): void {
        renderNote(
            container,
            MESSAGES.LABEL_ANALYZE_READING(report.files_read, report.documents_total, report.files_counted),
            "lilbee-analyze-reading",
        );
        const sampled = report.files_read + report.failed.length < report.documents_total;
        if (sampled) renderNote(container, MESSAGES.LABEL_ANALYZE_SAMPLED(report.cap), "lilbee-analyze-sampled");
    }

    private renderFailures(container: HTMLElement, report: AnalyzeResponse): void {
        if (report.failed.length === 0) return;
        container.createEl("h4", { text: MESSAGES.LABEL_ANALYZE_FAILURES_TITLE });
        const list = container.createEl("ul", { cls: "lilbee-analyze-failures" });
        for (const failure of report.failed) list.createEl("li", { text: `${failure.file}: ${failure.error}` });
    }

    private renderStats(container: HTMLElement, report: AnalyzeResponse): void {
        container.createEl("h4", { text: MESSAGES.LABEL_ANALYZE_STATS_TITLE });
        const list = container.createEl("ul", { cls: "lilbee-analyze-stats" });
        list.createEl("li", { text: MESSAGES.LABEL_ANALYZE_CODE_SHARE(Math.round(report.code_share * 100)) });
        if (report.pdf.files > 0) {
            list.createEl("li", {
                text: MESSAGES.LABEL_ANALYZE_PDF_SUMMARY(
                    report.pdf.files,
                    Math.round(report.pdf.scanned_share * 100),
                    report.pdf.tables,
                ),
            });
        }
        this.renderLanguages(container, report);
    }

    private renderLanguages(container: HTMLElement, report: AnalyzeResponse): void {
        if (report.languages.length === 0) return;
        container.createEl("h4", { text: MESSAGES.LABEL_ANALYZE_LANGUAGES_TITLE });
        renderProfileTable(
            container,
            [
                MESSAGES.LABEL_ANALYZE_LANG_COL_LANGUAGE,
                MESSAGES.LABEL_ANALYZE_LANG_COL_SHARE,
                MESSAGES.LABEL_ANALYZE_LANG_COL_STEMMER,
                MESSAGES.LABEL_ANALYZE_LANG_COL_OCR,
            ],
            report.languages.map((row) => ({
                cells: [
                    row.code,
                    `${Math.round(row.share * 100)}%`,
                    row.fts_language ?? MESSAGES.LABEL_ANALYZE_STEMMER_NONE,
                    row.ocr_supported ? MESSAGES.LABEL_ANALYZE_OCR_YES : MESSAGES.LABEL_ANALYZE_OCR_NO,
                ],
            })),
        );
    }

    private renderRecommendation(container: HTMLElement, report: AnalyzeResponse): void {
        const rec = report.recommendation;
        container.createEl("h4", { text: MESSAGES.LABEL_ANALYZE_RECOMMENDATION_TITLE(rec.builtin) });
        if (rec.changes.length === 0) {
            renderNote(container, MESSAGES.LABEL_ANALYZE_NOTHING_TO_CHANGE, "lilbee-analyze-nothing");
        } else {
            renderProfileTable(
                container,
                [MESSAGES.PROFILE_COL_SETTING, MESSAGES.PROFILE_COL_NOW, MESSAGES.PROFILE_COL_AFTER],
                rec.changes.map((row) => ({
                    cells: [row.key, profileValueText(row.current), profileValueText(row.new)],
                    effect: row.effect,
                })),
            );
        }
        if (rec.kept.length > 0) {
            renderNote(container, `${MESSAGES.LABEL_ANALYZE_KEPT}: ${rec.kept.join(", ")}`, "lilbee-analyze-kept");
        }
        this.renderList(
            container,
            MESSAGES.LABEL_ANALYZE_REASONS_TITLE,
            rec.reasons.map((reason) => reason.text),
        );
        this.renderList(container, MESSAGES.LABEL_ANALYZE_NOTES_TITLE, rec.notes);
    }

    private renderList(container: HTMLElement, title: string, items: string[]): void {
        if (items.length === 0) return;
        container.createEl("h4", { text: title });
        const list = container.createEl("ul");
        for (const item of items) list.createEl("li", { text: item });
    }

    private reindexCount(report: AnalyzeResponse): number {
        return report.recommendation.changes.filter((row) => row.effect === PROFILE_EFFECT.REINDEX).length;
    }

    private renderReportActions(container: HTMLElement, report: AnalyzeResponse): void {
        const actions = container.createDiv({ cls: "modal-button-container" });
        const reindex = this.reindexCount(report) > 0;
        if (reindex) {
            const applyReindex = actions.createEl("button", {
                text: MESSAGES.BUTTON_PROFILE_APPLY_REINDEX,
                cls: "mod-cta",
            });
            applyReindex.addEventListener("click", () => void this.apply(true));
        }
        const apply = actions.createEl("button", {
            text: MESSAGES.BUTTON_PROFILE_APPLY,
            cls: reindex ? "" : "mod-cta",
        });
        apply.addEventListener("click", () => void this.apply(false));
        const saveOnly = actions.createEl("button", { text: MESSAGES.BUTTON_ANALYZE_SAVE_ONLY });
        saveOnly.addEventListener("click", () => this.saveOnly());
        const close = actions.createEl("button", { text: MESSAGES.BUTTON_CLOSE });
        close.addEventListener("click", () => this.close());
    }

    private async apply(reindexNow: boolean): Promise<void> {
        this.renderRunning(MESSAGES.TITLE_ANALYZE_APPLYING, () => this.controller?.abort());
        this.controller = new AbortController();
        const outcome = await drainAnalyze(this.plugin, this.directory, { apply: true }, this.controller, (progress) =>
            this.updateProgress(progress),
        );
        this.controller = null;
        if (this.closed) return;
        this.finishApply(outcome, reindexNow);
    }

    private finishApply(outcome: AnalyzeOutcome, reindexNow: boolean): void {
        if (outcome.kind === "report") {
            if (outcome.report.saved) new Notice(MESSAGES.NOTICE_ANALYZE_APPLIED(outcome.report.saved.name));
            if (reindexNow) startReindexSync(this.plugin, true);
            this.close();
            return;
        }
        if (outcome.kind === "error") new Notice(MESSAGES.ERROR_ANALYZE_ACTION(outcome.message));
        if (outcome.kind === "unsupported") new Notice(MESSAGES.NOTICE_ANALYZE_UNSUPPORTED);
        this.renderReport();
    }

    private saveOnly(): void {
        if (!this.report) return;
        new ProfileNameModal(this.app, {
            title: MESSAGES.TITLE_ANALYZE_SAVING,
            askTarget: true,
            submit: (name, target) => this.submitSave(name, target),
        }).open();
    }

    /** Runs a save-only analyze call for the name dialog; a refusal stays in the dialog. */
    private async submitSave(name: string, target: ProfileFolder): Promise<string | null> {
        const controller = new AbortController();
        const outcome = await drainAnalyze(this.plugin, this.directory, { save: name, target }, controller, () => {});
        if (outcome.kind === "report" && outcome.report.saved) {
            new Notice(MESSAGES.NOTICE_ANALYZE_SAVED(outcome.report.saved.name, outcome.report.saved.path));
            this.close();
            return null;
        }
        if (outcome.kind === "error") return outcome.message;
        if (outcome.kind === "unsupported") return MESSAGES.NOTICE_ANALYZE_UNSUPPORTED;
        return MESSAGES.ERROR_UNKNOWN;
    }
}
