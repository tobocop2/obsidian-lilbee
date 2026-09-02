import { Notice } from "obsidian";
import type { DocumentEntry, DocumentsResponse } from "../types";
import { MESSAGES } from "../locales/en";
import { relativeTimeFromIso } from "../utils";

export const DOCUMENT_PAGE_SIZE = 20;

export type DocumentPageFetcher = (limit: number, offset: number) => Promise<DocumentsResponse>;

export interface DocumentListOptions {
    /** Renders a checkbox per row and tracks the checked filenames. */
    selectable?: boolean;
    onSelectionChange?: () => void;
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

    get isFetching(): boolean {
        return this.fetching;
    }

    get selected(): string[] {
        return Array.from(this.selectedNames);
    }

    /** Drops the rendered rows and starts again from the first page. */
    reset(): void {
        this.offset = 0;
        this.totalCount = 0;
        this.more = true;
        this.selectedNames.clear();
        this.containerEl.empty();
    }

    /** Appends the next page. Returns false when the fetch fails. */
    async loadMore(): Promise<boolean> {
        if (this.fetching || !this.more) return true;
        this.fetching = true;
        try {
            const response = await this.fetchPage(DOCUMENT_PAGE_SIZE, this.offset);
            this.totalCount = response.total;
            this.offset += response.documents.length;
            this.more = response.has_more;
            for (const doc of response.documents) {
                this.renderRow(doc);
            }
            return true;
        } catch {
            new Notice(MESSAGES.ERROR_LOAD_DOCUMENTS);
            return false;
        } finally {
            this.fetching = false;
        }
    }

    private renderRow(doc: DocumentEntry): void {
        const row = this.containerEl.createDiv({ cls: "lilbee-documents-row" });
        if (this.options.selectable) this.renderCheckbox(row, doc);

        const nameEl = row.createDiv({ cls: "lilbee-documents-row-name", text: doc.filename });
        nameEl.setAttribute("title", doc.filename);
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
