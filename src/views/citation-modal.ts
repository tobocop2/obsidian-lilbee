import { App, Modal } from "obsidian";
import type LilbeePlugin from "../main";
import type { Source, WikiCitation, WikiCitationChain } from "../types";
import { MESSAGES } from "../locales/en";
import { formatLocation } from "./results";
import { executeSourceClick, sourceClickAction } from "../utils/source-click";

export class CitationModal extends Modal {
    private plugin: LilbeePlugin;
    private slug: string;

    constructor(app: App, plugin: LilbeePlugin, slug: string) {
        super(app);
        this.plugin = plugin;
        this.slug = slug;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("lilbee-modal");

        contentEl.createEl("h2", { text: MESSAGES.TITLE_CITATIONS });

        const loading = contentEl.createDiv({ cls: "lilbee-loading" });
        void this.loadCitations(contentEl, loading);
    }

    onClose(): void {
        this.contentEl.empty();
    }

    private async loadCitations(contentEl: HTMLElement, loading: HTMLElement): Promise<void> {
        try {
            const chain = await this.plugin.api.wikiCitations(this.slug);
            loading.remove();
            this.renderChain(contentEl, chain);
        } catch {
            loading.remove();
            contentEl.createEl("p", {
                text: MESSAGES.ERROR_LOAD_CITATIONS,
                cls: "lilbee-empty-state",
            });
        }
    }

    private renderChain(container: HTMLElement, chain: WikiCitationChain): void {
        const header = container.createDiv({ cls: "lilbee-wiki-meta" });
        header.createEl("strong", { text: chain.wiki_page });

        if (chain.citations.length === 0) {
            container.createEl("p", {
                text: MESSAGES.LABEL_NO_CITATIONS,
                cls: "lilbee-empty-state",
            });
            return;
        }

        for (const citation of chain.citations) {
            this.renderCitation(container, citation);
        }
    }

    private renderCitation(container: HTMLElement, citation: WikiCitation): void {
        const card = container.createDiv({ cls: "lilbee-citation-card" });

        const header = card.createDiv({ cls: "lilbee-document-card-header" });
        header.createEl("span", {
            text: citation.citation_key,
            cls: "lilbee-citation-key",
        });

        header.createEl("span", {
            text: citation.claim_type === "fact" ? MESSAGES.LABEL_CITATION_FACT : MESSAGES.LABEL_CITATION_INFERENCE,
            cls: `lilbee-citation-claim-badge lilbee-claim-${citation.claim_type}`,
        });

        const sourceLink = card.createEl("a", {
            text: citation.source_filename,
            cls: "lilbee-document-source",
        });
        sourceLink.addEventListener("click", (e) => {
            e.preventDefault();
            const source: Source = {
                source: citation.source_filename,
                content_type: "",
                distance: 0,
                chunk: citation.excerpt,
                page_start: citation.page_start,
                page_end: citation.page_end,
                line_start: citation.line_start,
                line_end: citation.line_end,
            };
            void executeSourceClick(this.app, this.plugin.api, sourceClickAction(source, this.app.vault));
        });

        // Location info
        const loc = formatLocation(citation);
        if (loc) {
            card.createEl("span", { text: loc, cls: "lilbee-location" });
        }

        // Excerpt for facts
        if (citation.excerpt) {
            card.createEl("blockquote", {
                text: citation.excerpt,
                cls: "lilbee-citation-excerpt",
            });
        }

        // Hash status
        card.createEl("span", {
            text: citation.source_hash ? MESSAGES.LABEL_CITATION_CURRENT : MESSAGES.LABEL_CITATION_STALE,
            cls: `lilbee-citation-hash-status ${citation.source_hash ? "lilbee-hash-current" : "lilbee-hash-stale"}`,
        });
    }
}
