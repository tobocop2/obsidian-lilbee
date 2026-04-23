import { App, Modal, Notice } from "obsidian";
import type LilbeePlugin from "../main";
import { DRAFT_PENDING_KIND, type DraftInfoResponse, type DraftPendingKind } from "../types";
import { MESSAGES } from "../locales/en";
import { ConfirmModal } from "./confirm-modal";

const NOTICE_DURATION_MS = 4000;

export class DraftModal extends Modal {
    private plugin: LilbeePlugin;
    private drafts: DraftInfoResponse[] = [];
    private selectedSlug: string | null = null;
    private selectedRow: HTMLElement | null = null;
    private titleEl!: HTMLElement;
    private listEl!: HTMLElement;
    private diffEl!: HTMLElement;
    private acceptBtn!: HTMLButtonElement;
    private rejectBtn!: HTMLButtonElement;
    private actionInFlight = false;

    constructor(app: App, plugin: LilbeePlugin) {
        super(app);
        this.plugin = plugin;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("lilbee-modal");
        contentEl.addClass("lilbee-drafts-modal");
        this.renderChrome(contentEl);
        void this.loadList();
    }

    onClose(): void {
        this.contentEl.empty();
    }

    private renderChrome(root: HTMLElement): void {
        const header = root.createDiv({ cls: "lilbee-drafts-header" });
        this.titleEl = header.createEl("h2", { text: MESSAGES.TITLE_DRAFTS(0) });
        const refreshBtn = header.createEl("button", {
            text: MESSAGES.LABEL_DRAFT_REFRESH,
            cls: "lilbee-drafts-refresh",
        });
        refreshBtn.addEventListener("click", () => void this.loadList());

        this.listEl = root.createDiv({ cls: "lilbee-drafts-list" });
        this.diffEl = root.createEl("pre", { cls: "lilbee-draft-diff" });
        this.diffEl.setText(MESSAGES.LABEL_DRAFT_NO_SELECTION);

        const actions = root.createDiv({ cls: "lilbee-drafts-actions" });
        this.acceptBtn = actions.createEl("button", {
            text: MESSAGES.LABEL_DRAFT_ACCEPT,
            cls: "mod-cta",
        }) as HTMLButtonElement;
        this.rejectBtn = actions.createEl("button", {
            text: MESSAGES.LABEL_DRAFT_REJECT,
        }) as HTMLButtonElement;
        this.acceptBtn.disabled = true;
        this.rejectBtn.disabled = true;
        this.acceptBtn.addEventListener("click", () => void this.accept());
        this.rejectBtn.addEventListener("click", () => void this.reject());
    }

    private async loadList(): Promise<void> {
        if (this.actionInFlight) return;
        this.selectedSlug = null;
        this.selectedRow = null;
        this.setActionsEnabled(false);
        this.diffEl.setText(MESSAGES.LABEL_DRAFT_NO_SELECTION);
        this.listEl.empty();
        const loading = this.listEl.createDiv({ cls: "lilbee-loading" });
        try {
            this.drafts = await this.plugin.api.wikiDrafts();
        } catch {
            loading.remove();
            this.titleEl.setText(MESSAGES.TITLE_DRAFTS(0));
            this.listEl.createEl("p", {
                text: MESSAGES.ERROR_LOAD_DRAFTS,
                cls: "lilbee-empty-state",
            });
            return;
        }
        loading.remove();
        this.renderRows();
    }

    private renderRows(): void {
        this.titleEl.setText(MESSAGES.TITLE_DRAFTS(this.drafts.length));
        this.listEl.empty();
        if (this.drafts.length === 0) {
            this.listEl.createEl("p", {
                text: MESSAGES.LABEL_NO_DRAFTS,
                cls: "lilbee-empty-state",
            });
            return;
        }
        for (const draft of this.drafts) {
            this.renderRow(draft);
        }
    }

    private renderRow(draft: DraftInfoResponse): void {
        const row = this.listEl.createDiv({ cls: "lilbee-draft-row" });
        row.createEl("strong", { text: draft.slug, cls: "lilbee-draft-slug" });

        const meta = row.createDiv({ cls: "lilbee-draft-meta" });
        const kindLabelText = kindChipLabel(draft);
        if (kindLabelText !== null) {
            meta.createEl("span", { text: kindLabelText, cls: "lilbee-draft-kind" });
        }
        if (draft.drift_ratio !== null) {
            meta.createEl("span", {
                text: MESSAGES.LABEL_DRAFT_DRIFT(Math.round(draft.drift_ratio * 100)),
                cls: "lilbee-draft-drift",
            });
        }
        const faithText =
            draft.faithfulness_score === null
                ? MESSAGES.LABEL_DRAFT_FAITH_NA
                : MESSAGES.LABEL_DRAFT_FAITH(draft.faithfulness_score);
        meta.createEl("span", { text: faithText, cls: "lilbee-draft-faith" });
        meta.createEl("span", {
            text: draft.published_exists ? MESSAGES.LABEL_DRAFT_PUBLISHED : MESSAGES.LABEL_DRAFT_NEW,
            cls: "lilbee-draft-pub",
        });

        row.addEventListener("click", () => void this.selectDraft(draft.slug, row));
    }

    private async selectDraft(slug: string, row: HTMLElement): Promise<void> {
        if (this.actionInFlight) return;
        this.selectedSlug = slug;
        if (this.selectedRow !== null && this.selectedRow !== row) {
            this.selectedRow.removeClass("is-selected");
        }
        this.selectedRow = row;
        row.addClass("is-selected");
        this.diffEl.empty();
        const loading = this.diffEl.createEl("span", { text: "…", cls: "lilbee-loading" });
        let diffText: string;
        try {
            diffText = await this.plugin.api.wikiDraftDiff(slug);
        } catch {
            if (this.selectedSlug !== slug) return;
            loading.remove();
            this.diffEl.setText(MESSAGES.ERROR_LOAD_DIFF);
            return;
        }
        if (this.selectedSlug !== slug) return;
        loading.remove();
        this.renderDiff(diffText);
        this.setActionsEnabled(true);
    }

    private renderDiff(text: string): void {
        this.diffEl.empty();
        if (text.trim() === "") {
            this.diffEl.setText(MESSAGES.LABEL_DRAFT_NO_DIFF);
            return;
        }
        for (const line of text.split("\n")) {
            this.diffEl.createEl("span", { text: `${line}\n`, cls: diffLineClass(line) });
        }
    }

    private async accept(): Promise<void> {
        const slug = this.selectedSlug;
        if (slug === null || this.actionInFlight) return;
        this.actionInFlight = true;
        this.setActionsEnabled(false);
        try {
            const confirm = new ConfirmModal(this.app, MESSAGES.NOTICE_CONFIRM_DRAFT_ACCEPT(slug));
            confirm.open();
            if (!(await confirm.result)) {
                this.setActionsEnabled(true);
                return;
            }
            const result = await this.plugin.api.wikiDraftAccept(slug);
            this.afterActionSuccess(slug, true);
            new Notice(MESSAGES.NOTICE_DRAFT_ACCEPTED(result.slug, result.reindexed_chunks), NOTICE_DURATION_MS);
        } catch {
            new Notice(MESSAGES.NOTICE_DRAFT_ACTION_FAILED, NOTICE_DURATION_MS);
            this.setActionsEnabled(true);
        } finally {
            this.actionInFlight = false;
        }
    }

    private async reject(): Promise<void> {
        const slug = this.selectedSlug;
        if (slug === null || this.actionInFlight) return;
        this.actionInFlight = true;
        this.setActionsEnabled(false);
        try {
            const confirm = new ConfirmModal(this.app, MESSAGES.NOTICE_CONFIRM_DRAFT_REJECT(slug));
            confirm.open();
            if (!(await confirm.result)) {
                this.setActionsEnabled(true);
                return;
            }
            await this.plugin.api.wikiDraftReject(slug);
            this.afterActionSuccess(slug, false);
            new Notice(MESSAGES.NOTICE_DRAFT_REJECTED(slug), NOTICE_DURATION_MS);
        } catch {
            new Notice(MESSAGES.NOTICE_DRAFT_ACTION_FAILED, NOTICE_DURATION_MS);
            this.setActionsEnabled(true);
        } finally {
            this.actionInFlight = false;
        }
    }

    private afterActionSuccess(slug: string, wasAccept: boolean): void {
        const removed = this.drafts.find((d) => d.slug === slug);
        this.drafts = this.drafts.filter((d) => d.slug !== slug);
        this.selectedSlug = null;
        this.selectedRow = null;
        this.diffEl.setText(MESSAGES.LABEL_DRAFT_NO_SELECTION);
        this.renderRows();
        if (this.plugin.wikiDraftCount > 0) this.plugin.wikiDraftCount -= 1;
        if (wasAccept && removed && !removed.published_exists) {
            this.plugin.wikiPageCount += 1;
        }
        if (wasAccept) {
            this.plugin.refreshOpenWikiViews();
            void this.plugin.reconcileWiki();
        }
    }

    private setActionsEnabled(enabled: boolean): void {
        this.acceptBtn.disabled = !enabled;
        this.rejectBtn.disabled = !enabled;
    }
}

// Exhaustive map: adding a new DraftPendingKind variant forces TS to demand a label here.
const KIND_LABELS: Record<DraftPendingKind, string> = {
    [DRAFT_PENDING_KIND.DRIFT]: MESSAGES.LABEL_DRAFT_KIND_DRIFT,
    [DRAFT_PENDING_KIND.PARSE]: MESSAGES.LABEL_DRAFT_KIND_PARSE,
    [DRAFT_PENDING_KIND.COLLISION]: MESSAGES.LABEL_DRAFT_KIND_COLLISION,
    [DRAFT_PENDING_KIND.LOW_FAITHFULNESS]: MESSAGES.LABEL_DRAFT_KIND_LOW_FAITH,
    [DRAFT_PENDING_KIND.BAD_TITLE]: MESSAGES.LABEL_DRAFT_KIND_BAD_TITLE,
};

function kindChipLabel(draft: DraftInfoResponse): string | null {
    if (draft.pending_kind !== null) {
        const label = KIND_LABELS[draft.pending_kind as DraftPendingKind];
        if (label !== undefined) return label;
    }
    if (draft.bad_title) return MESSAGES.LABEL_DRAFT_KIND_BAD_TITLE;
    return null;
}

function diffLineClass(line: string): string {
    if (line.startsWith("+++") || line.startsWith("---")) return "lilbee-draft-diff-meta";
    if (line.startsWith("@@")) return "lilbee-draft-diff-hunk";
    if (line.startsWith("+")) return "lilbee-draft-diff-add";
    if (line.startsWith("-")) return "lilbee-draft-diff-del";
    return "lilbee-draft-diff-ctx";
}
