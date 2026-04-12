import { ItemView, MarkdownRenderer, setIcon, WorkspaceLeaf } from "obsidian";
import type LilbeePlugin from "../main";
import type { WikiPage, WikiPageDetail } from "../types";
import { MESSAGES } from "../locales/en";
import { relativeTime } from "../utils";
import { CitationModal } from "./citation-modal";

export const VIEW_TYPE_WIKI = "lilbee-wiki";

export class WikiView extends ItemView {
    private plugin: LilbeePlugin;
    private pages: WikiPage[] = [];
    private selectedSlug: string | null = null;
    private listEl: HTMLElement | null = null;
    private detailEl: HTMLElement | null = null;
    private filterInput: HTMLInputElement | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: LilbeePlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return VIEW_TYPE_WIKI;
    }

    getDisplayText(): string {
        return MESSAGES.LABEL_WIKI_VIEW;
    }

    getIcon(): string {
        return "book-open";
    }

    async onOpen(): Promise<void> {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("lilbee-wiki-container");

        // Header
        const header = contentEl.createDiv({ cls: "lilbee-wiki-header" });
        header.createEl("h2", { text: MESSAGES.LABEL_WIKI });

        const actions = header.createDiv({ cls: "lilbee-toolbar-group" });

        const refreshBtn = actions.createEl("button", { cls: "lilbee-tasks-clear" });
        setIcon(refreshBtn, "refresh-cw");
        refreshBtn.setAttribute("aria-label", MESSAGES.BUTTON_REFRESH);
        refreshBtn.addEventListener("click", () => this.refresh());

        const lintBtn = actions.createEl("button", { cls: "lilbee-tasks-clear" });
        setIcon(lintBtn, "check-circle");
        lintBtn.setAttribute("aria-label", MESSAGES.LABEL_WIKI_RUN_LINT);
        lintBtn.addEventListener("click", () => {
            void this.plugin.runWikiLint();
        });

        // Filter
        this.filterInput = contentEl.createEl("input", {
            type: "text",
            cls: "lilbee-wiki-search",
            placeholder: MESSAGES.PLACEHOLDER_TYPE_SEARCH,
        }) as HTMLInputElement;
        this.filterInput.addEventListener("input", () => this.renderList());

        // Page list
        this.listEl = contentEl.createDiv({ cls: "lilbee-wiki-list" });

        // Detail area
        this.detailEl = contentEl.createDiv({ cls: "lilbee-wiki-detail" });

        void this.refresh();
    }

    async refresh(): Promise<void> {
        try {
            this.pages = await this.plugin.api.wikiList();
        } catch {
            this.pages = [];
        }
        this.renderList();
        if (this.selectedSlug) {
            void this.showPage(this.selectedSlug);
        }
    }

    private renderList(): void {
        if (!this.listEl) return;
        this.listEl.empty();

        const filter = this.filterInput?.value.toLowerCase() ?? "";
        const filtered = filter ? this.pages.filter((p) => p.title.toLowerCase().includes(filter)) : this.pages;

        if (filtered.length === 0) {
            this.listEl.createEl("p", {
                text: MESSAGES.LABEL_WIKI_NO_PAGES,
                cls: "lilbee-empty-state",
            });
            return;
        }

        // Group by type
        const summaries = filtered.filter((p) => p.page_type === "summary");
        const concepts = filtered.filter((p) => p.page_type === "synthesis");

        if (summaries.length > 0) {
            this.renderGroup(this.listEl, MESSAGES.LABEL_WIKI_SUMMARIES, summaries);
        }
        if (concepts.length > 0) {
            this.renderGroup(this.listEl, MESSAGES.LABEL_WIKI_CONCEPTS, concepts);
        }
    }

    private renderGroup(container: HTMLElement, label: string, pages: WikiPage[]): void {
        container.createEl("h3", { text: label, cls: "lilbee-tasks-section-header" });
        for (const page of pages) {
            this.renderPageItem(container, page);
        }
    }

    private renderPageItem(container: HTMLElement, page: WikiPage): void {
        const item = container.createDiv({
            cls: `lilbee-wiki-page-item${page.slug === this.selectedSlug ? " active" : ""}`,
        });

        const info = item.createDiv({ cls: "lilbee-task-info" });

        const typeBadge = info.createSpan({ cls: "lilbee-wiki-type-badge" });
        typeBadge.textContent = page.page_type;

        info.createSpan({ cls: "lilbee-task-name", text: page.title });

        const meta = item.createDiv({ cls: "lilbee-wiki-meta" });
        meta.createSpan({ text: MESSAGES.LABEL_WIKI_SOURCES_COUNT(page.source_count) });

        const ts = new Date(page.created_at).getTime();
        meta.createSpan({ text: relativeTime(ts), cls: "lilbee-task-time" });

        item.addEventListener("click", () => {
            this.selectedSlug = page.slug;
            this.renderList();
            void this.showPage(page.slug);
        });
    }

    private async showPage(slug: string): Promise<void> {
        if (!this.detailEl) return;
        this.detailEl.empty();

        const loading = this.detailEl.createDiv({ cls: "lilbee-loading" });

        try {
            const page = await this.plugin.api.wikiPage(slug);
            loading.remove();
            this.renderDetail(page);
        } catch {
            loading.remove();
            this.detailEl.createEl("p", {
                text: MESSAGES.ERROR_LOAD_PAGE,
                cls: "lilbee-empty-state",
            });
        }
    }

    private renderDetail(page: WikiPageDetail): void {
        if (!this.detailEl) return;

        // Metadata header
        const meta = this.detailEl.createDiv({ cls: "lilbee-wiki-meta" });
        meta.createEl("strong", { text: page.title });
        meta.createSpan({ text: new Date(page.created_at).toLocaleString() });

        // Markdown body
        const content = this.detailEl.createDiv({ cls: "lilbee-wiki-content" });
        void MarkdownRenderer.render(this.app, page.content, content, "", this);

        // Handle wikilink clicks within rendered content
        content.addEventListener("click", (e) => {
            const target = e.target as HTMLElement;
            const link = target.closest("a.internal-link");
            if (link) {
                e.preventDefault();
                const href = link.getAttribute("data-href") ?? link.textContent ?? "";
                // Check if it's a wiki page slug
                const matchingPage = this.pages.find((p) => p.slug === href || p.title === href);
                if (matchingPage) {
                    this.selectedSlug = matchingPage.slug;
                    this.renderList();
                    void this.showPage(matchingPage.slug);
                } else {
                    // Fall back to opening as a vault file
                    this.app.workspace.openLinkText(href, "");
                }
            }

            // Handle citation footnote clicks
            const footnoteRef = target.closest("a[href^='#^src'], a[href^='#fn']");
            if (footnoteRef && this.selectedSlug) {
                e.preventDefault();
                new CitationModal(this.app, this.plugin, this.selectedSlug).open();
            }
        });
    }
}
