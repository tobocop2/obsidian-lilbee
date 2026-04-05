import { App, Modal } from "obsidian";
import type { LintIssue } from "../types";
import { MESSAGES } from "../locales/en";

const STATUS_CLASSES: Record<LintIssue["status"], string> = {
    valid: "lilbee-lint-valid",
    stale_hash: "lilbee-lint-stale",
    source_deleted: "lilbee-lint-deleted",
    excerpt_missing: "lilbee-lint-missing",
    model_changed: "lilbee-lint-model",
};

const STATUS_LABELS: Record<LintIssue["status"], string> = {
    valid: MESSAGES.LABEL_LINT_STATUS_VALID,
    stale_hash: MESSAGES.LABEL_LINT_STATUS_STALE,
    source_deleted: MESSAGES.LABEL_LINT_STATUS_DELETED,
    excerpt_missing: MESSAGES.LABEL_LINT_STATUS_MISSING,
    model_changed: MESSAGES.LABEL_LINT_STATUS_MODEL,
};

export class LintModal extends Modal {
    private issues: LintIssue[];

    constructor(app: App, issues: LintIssue[]) {
        super(app);
        this.issues = issues;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("lilbee-modal");

        contentEl.createEl("h2", { text: MESSAGES.TITLE_LINT_RESULTS });

        // Group by wiki page
        const grouped = new Map<string, LintIssue[]>();
        for (const issue of this.issues) {
            const list = grouped.get(issue.wiki_page) ?? [];
            list.push(issue);
            grouped.set(issue.wiki_page, list);
        }

        // Summary line
        contentEl.createEl("p", {
            text: MESSAGES.LABEL_LINT_ISSUES(this.issues.length, grouped.size),
            cls: "lilbee-lint-summary",
        });

        if (this.issues.length === 0) {
            return;
        }

        for (const [page, issues] of grouped) {
            this.renderGroup(contentEl, page, issues);
        }
    }

    onClose(): void {
        this.contentEl.empty();
    }

    private renderGroup(container: HTMLElement, page: string, issues: LintIssue[]): void {
        const group = container.createDiv({ cls: "lilbee-lint-group" });
        group.createEl("h3", { text: page });

        for (const issue of issues) {
            const row = group.createDiv({ cls: "lilbee-lint-issue" });

            row.createEl("span", {
                text: issue.citation_key,
                cls: "lilbee-citation-key",
            });

            row.createEl("span", {
                text: STATUS_LABELS[issue.status],
                cls: `lilbee-lint-status ${STATUS_CLASSES[issue.status]}`,
            });

            row.createEl("span", {
                text: issue.detail,
                cls: "lilbee-lint-detail",
            });
        }
    }
}
