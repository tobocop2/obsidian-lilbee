import { ItemView, MarkdownRenderer, Notice, setIcon, WorkspaceLeaf } from "obsidian";
import type LilbeePlugin from "../main";
import type { WikiPage, WikiPageDetail, WikiStub } from "../types";
import { CONCEPT_ONLY_WIKI_PAGE_TYPES, WIKI_PAGE_TYPE } from "../types";
import { MESSAGES } from "../locales/en";
import { errorMessage, relativeTime } from "../utils";
import { CitationModal } from "./citation-modal";
import { ConfirmModal } from "./confirm-modal";

export const VIEW_TYPE_WIKI = "lilbee-wiki";

const NOTICE_DURATION_MS = 4000;

/** What to call an unwritten subject. The index carries a label for most, and
 * the slug is the fallback for the ones it does not. */
function stubName(stub: WikiStub): string {
    return stub.label || stub.slug;
}

export class WikiView extends ItemView {
    private plugin: LilbeePlugin;
    private pages: WikiPage[] = [];
    private stubs: WikiStub[] = [];
    private generating: string | null = null;
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
        refreshBtn.addEventListener("click", () => void this.refresh());

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
        });
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
        // Written pages and unwritten subjects are separate reads, and the
        // stubs one is the newer route. A server without it, or a failure on
        // it, must not blank the pages that did load.
        try {
            this.stubs = await this.plugin.api.wikiStubs();
        } catch {
            this.stubs = [];
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
        // Unwritten subjects answer the filter too. Searching for something the
        // wiki has not written yet is exactly how you find it.
        const unwritten = filter ? this.stubs.filter((s) => stubName(s).toLowerCase().includes(filter)) : this.stubs;

        if (filtered.length === 0 && unwritten.length === 0) {
            this.listEl.createEl("p", {
                text: MESSAGES.LABEL_WIKI_NO_PAGES,
                cls: "lilbee-empty-state",
            });
            return;
        }

        const summaries = filtered.filter((p) => p.page_type === WIKI_PAGE_TYPE.SUMMARY);
        // Entities used to be lumped in with concepts, so fifty proper nouns
        // rendered under a heading that said "Concepts". They are different
        // things and the server names them separately; so does this.
        const concepts = filtered.filter((p) => CONCEPT_ONLY_WIKI_PAGE_TYPES.has(p.page_type));
        const entities = filtered.filter((p) => p.page_type === WIKI_PAGE_TYPE.ENTITY);

        if (summaries.length > 0) {
            this.renderGroup(this.listEl, MESSAGES.LABEL_WIKI_SUMMARIES, summaries);
        }
        if (concepts.length > 0) {
            this.renderGroup(this.listEl, MESSAGES.LABEL_WIKI_CONCEPTS, concepts);
        }
        if (entities.length > 0) {
            this.renderGroup(this.listEl, MESSAGES.LABEL_WIKI_ENTITIES, entities);
        }
        if (unwritten.length > 0) {
            this.listEl.createEl("h3", {
                text: MESSAGES.LABEL_WIKI_UNWRITTEN(unwritten.length),
                cls: "lilbee-tasks-section-header",
            });
            for (const stub of unwritten) this.renderStubItem(this.listEl, stub);
        }
    }

    /**
     * Write one unwritten subject, on request.
     *
     * Confirmed first because it spends a model call on a GPU that may be busy,
     * and the page can take minutes. The list is repainted around the call so
     * the row reads as busy, and the finished page opens itself.
     */
    private async generateStub(stub: WikiStub): Promise<void> {
        if (this.generating) return;
        const modal = new ConfirmModal(this.app, MESSAGES.CONFIRM_WIKI_GENERATE(stubName(stub)));
        modal.open();
        if (!(await modal.result)) return;

        this.generating = stub.slug;
        this.renderList();
        try {
            const result = await this.plugin.api.wikiGenerate(stub.slug);
            new Notice(MESSAGES.NOTICE_WIKI_GENERATED(stubName(stub)), NOTICE_DURATION_MS);
            this.selectedSlug = result.slug;
            await this.refresh();
            void this.showPage(result.slug);
        } catch (err) {
            new Notice(errorMessage(err, MESSAGES.ERROR_UNKNOWN));
            this.generating = null;
            this.renderList();
            return;
        }
        this.generating = null;
    }

    /**
     * A subject the corpus names but nothing has written. Rendered dim and
     * marked, because it is an offer rather than a page: opening it asks
     * whether to spend a model call writing it.
     */
    private renderStubItem(container: HTMLElement, stub: WikiStub): void {
        const busy = this.generating === stub.slug;
        const item = container.createDiv({
            cls: `lilbee-wiki-page-item lilbee-wiki-stub${busy ? " generating" : ""}`,
        });

        const info = item.createDiv({ cls: "lilbee-task-info" });
        const badge = info.createSpan({ cls: "lilbee-wiki-type-badge" });
        badge.addClass(`lilbee-wiki-type-${stub.kind}`);
        badge.setText(stub.kind);
        info.createSpan({ cls: "lilbee-task-name", text: stubName(stub) });

        const meta = item.createDiv({ cls: "lilbee-wiki-meta" });
        meta.createSpan({ text: MESSAGES.LABEL_WIKI_SOURCES_COUNT(stub.sources.length) });
        meta.createSpan({
            cls: "lilbee-wiki-stub-hint",
            text: busy ? MESSAGES.LABEL_WIKI_WRITING : MESSAGES.LABEL_WIKI_NOT_WRITTEN,
        });

        item.addEventListener("click", () => void this.generateStub(stub));
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
        typeBadge.addClass(`lilbee-wiki-type-${page.page_type}`);
        typeBadge.setText(page.page_type);

        info.createSpan({ cls: "lilbee-task-name", text: page.title });

        const meta = item.createDiv({ cls: "lilbee-wiki-meta" });
        meta.createSpan({ text: MESSAGES.LABEL_WIKI_SOURCES_COUNT(page.source_count) });

        if (page.created_at) {
            const ts = new Date(page.created_at).getTime();
            meta.createSpan({ text: relativeTime(ts), cls: "lilbee-task-time" });
        }

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
        if (page.created_at) {
            meta.createSpan({ text: new Date(page.created_at).toLocaleString() });
        }

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
                    void this.app.workspace.openLinkText(href, "");
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
