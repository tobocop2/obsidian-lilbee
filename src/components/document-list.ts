import { Notice } from "obsidian";
import type { DocumentEntry, DocumentsResponse } from "../types";
import { MESSAGES } from "../locales/en";
import { relativeTimeFromIso } from "../utils";

export const DOCUMENT_PAGE_SIZE = 200;
/** Distance from the bottom of the scroll box at which the next page loads. */
const SCROLL_BOTTOM_THRESHOLD_PX = 200;

export type DocumentPageFetcher = (limit: number, offset: number) => Promise<DocumentsResponse>;

export interface DocumentListOptions {
    /** Renders a checkbox per row and tracks the checked filenames. */
    selectable?: boolean;
    onSelectionChange?: () => void;
    /** Makes each filename a link that hands the document to the caller. */
    onOpen?: (doc: DocumentEntry) => void;
    /** Runs after every page attempt with whether the fetch succeeded. */
    onPage?: (loaded: boolean) => void;
}

/** Paged list of indexed documents, shared by the Documents modal and the Status modal. */
export class DocumentList {
    private readonly containerEl: HTMLElement;
    private readonly fetchPage: DocumentPageFetcher;
    private readonly options: DocumentListOptions;
    private offset = 0;
    private totalCount = 0;
    private more = true;
    private fetching = false;
    /** Bumped by reset() so a page that lands for an earlier query is dropped. */
    private generation = 0;
    private selectedNames = new Set<string>();

    constructor(containerEl: HTMLElement, fetchPage: DocumentPageFetcher, options: DocumentListOptions = {}) {
        this.containerEl = containerEl;
        this.fetchPage = fetchPage;
        this.options = options;
    }

    /** Documents the server reports for the current query. */
    get total(): number {
        return this.totalCount;
    }

    /** Documents rendered so far, which is also the offset of the next page. */
    get loaded(): number {
        return this.offset;
    }

    get hasMore(): boolean {
        return this.more;
    }

    get selected(): string[] {
        return Array.from(this.selectedNames);
    }

    /** Drops the rendered rows and starts again from the first page. */
    reset(): void {
        this.generation += 1;
        this.offset = 0;
        this.totalCount = 0;
        this.more = true;
        this.fetching = false;
        this.selectedNames.clear();
        this.containerEl.empty();
    }

    /** Loads the next page whenever *scrollEl* scrolls near its bottom. Returns the unbind function. */
    bindScroll(scrollEl: HTMLElement): () => void {
        const onScroll = (): void => {
            if (this.fetching || !this.more) return;
            const { scrollTop, clientHeight, scrollHeight } = scrollEl;
            if (scrollTop + clientHeight >= scrollHeight - SCROLL_BOTTOM_THRESHOLD_PX) void this.loadMore();
        };
        scrollEl.addEventListener("scroll", onScroll);
        return () => scrollEl.removeEventListener("scroll", onScroll);
    }

    /** Appends the next page. Returns false when the fetch fails. */
    async loadMore(): Promise<boolean> {
        if (this.fetching || !this.more) return true;
        const loaded = await this.fetchNextPage();
        this.options.onPage?.(loaded);
        return loaded;
    }

    private async fetchNextPage(): Promise<boolean> {
        this.fetching = true;
        const generation = this.generation;
        try {
            const response = await this.fetchPage(DOCUMENT_PAGE_SIZE, this.offset);
            if (generation !== this.generation) return true;
            this.totalCount = response.total;
            this.offset += response.documents.length;
            this.more = response.has_more;
            for (const doc of response.documents) {
                this.renderRow(doc);
            }
            return true;
        } catch {
            if (generation !== this.generation) return true;
            new Notice(MESSAGES.ERROR_LOAD_DOCUMENTS);
            return false;
        } finally {
            if (generation === this.generation) this.fetching = false;
        }
    }

    private renderRow(doc: DocumentEntry): void {
        const row = this.containerEl.createDiv({ cls: "lilbee-documents-row" });
        if (this.options.selectable) this.renderCheckbox(row, doc);

        const nameEl = row.createDiv({ cls: "lilbee-documents-row-name", text: doc.filename });
        nameEl.setAttribute("title", doc.filename);
        const { onOpen } = this.options;
        if (onOpen) {
            nameEl.addClass("lilbee-documents-row-link");
            nameEl.setAttribute("role", "link");
            nameEl.setAttribute("tabindex", "0");
            nameEl.addEventListener("click", () => onOpen(doc));
            nameEl.addEventListener("keydown", (event: KeyboardEvent) => {
                if (event.key === "Enter") onOpen(doc);
            });
        }
        row.createDiv({
            cls: "lilbee-documents-row-chunks",
            text: MESSAGES.LABEL_DOCUMENT_CHUNKS(doc.chunk_count),
        });
        const dateEl = row.createDiv({ cls: "lilbee-documents-row-date", text: relativeTimeFromIso(doc.ingested_at) });
        if (doc.ingested_at) dateEl.setAttribute("title", doc.ingested_at);
    }

    private renderCheckbox(row: HTMLElement, doc: DocumentEntry): void {
        const checkbox = row.createEl("input", {
            cls: "lilbee-documents-checkbox",
            attr: { type: "checkbox" },
        });
        checkbox.addEventListener("change", () => {
            if (checkbox.checked) {
                this.selectedNames.add(doc.filename);
            } else {
                this.selectedNames.delete(doc.filename);
            }
            this.options.onSelectionChange?.();
        });
    }
}
