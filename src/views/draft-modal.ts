import { App, Modal } from "obsidian";
import type LilbeePlugin from "../main";
import type { WikiDraft } from "../types";
import { MESSAGES } from "../locales/en";

export class DraftModal extends Modal {
    private plugin: LilbeePlugin;

    constructor(app: App, plugin: LilbeePlugin) {
        super(app);
        this.plugin = plugin;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("lilbee-modal");

        contentEl.createEl("h2", { text: MESSAGES.TITLE_DRAFTS });

        const loading = contentEl.createDiv({ cls: "lilbee-loading" });
        void this.loadDrafts(contentEl, loading);
    }

    onClose(): void {
        this.contentEl.empty();
    }

    private async loadDrafts(contentEl: HTMLElement, loading: HTMLElement): Promise<void> {
        try {
            const drafts = await this.plugin.api.wikiDrafts();
            loading.remove();

            if (drafts.length === 0) {
                contentEl.createEl("p", {
                    text: MESSAGES.LABEL_NO_DRAFTS,
                    cls: "lilbee-empty-state",
                });
                return;
            }

            for (const draft of drafts) {
                this.renderDraft(contentEl, draft);
            }
        } catch {
            loading.remove();
            contentEl.createEl("p", {
                text: MESSAGES.ERROR_LOAD_DRAFTS,
                cls: "lilbee-empty-state",
            });
        }
    }

    private renderDraft(container: HTMLElement, draft: WikiDraft): void {
        const item = container.createDiv({ cls: "lilbee-draft-item" });

        const header = item.createDiv({ cls: "lilbee-document-card-header" });
        header.createEl("strong", { text: draft.title });

        const meta = item.createDiv({ cls: "lilbee-wiki-meta" });
        meta.createEl("span", {
            text: `${MESSAGES.LABEL_DRAFT_SCORE}: ${(draft.faithfulness_score * 100).toFixed(0)}%`,
            cls: "lilbee-draft-score",
        });
        meta.createEl("span", {
            text: `${MESSAGES.LABEL_DRAFT_REASON}: ${draft.failure_reason}`,
            cls: "lilbee-draft-reason",
        });

        const timeStr = new Date(draft.generated_at).toLocaleString();
        meta.createEl("span", { text: timeStr, cls: "lilbee-task-time" });

        // Expandable content (loaded on demand)
        const expandBtn = item.createEl("button", {
            text: MESSAGES.LABEL_SHOW_CONTENT,
            cls: "lilbee-draft-expand",
        });
        expandBtn.addEventListener("click", () => {
            void this.loadDraftContent(item, draft.slug, expandBtn);
        });
    }

    private async loadDraftContent(container: HTMLElement, slug: string, btn: HTMLElement): Promise<void> {
        btn.remove();
        const loading = container.createDiv({ cls: "lilbee-loading" });
        try {
            const page = await this.plugin.api.wikiPage(slug);
            loading.remove();
            const content = container.createDiv({ cls: "lilbee-wiki-content" });
            content.createEl("pre", { text: page.content });
        } catch {
            loading.remove();
            container.createEl("p", {
                text: MESSAGES.ERROR_LOAD_CONTENT,
                cls: "lilbee-empty-state",
            });
        }
    }
}
