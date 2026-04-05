import { App, Modal, Notice } from "obsidian";
import type LilbeePlugin from "../main";
import type { DocumentEntry, DocumentsResponse } from "../types";
import { ConfirmModal } from "./confirm-modal";
import { MESSAGES } from "../locales/en";
import { debounce, DEBOUNCE_MS } from "../utils";

const PAGE_SIZE = 20;

export class DocumentsModal extends Modal {
    private plugin: LilbeePlugin;
    private offset = 0;
    private total = 0;
    private documents: DocumentEntry[] = [];
    private selected = new Set<string>();
    private resultsEl: HTMLElement | null = null;
    private loadMoreBtn: HTMLElement | null = null;
    private removeBtn: HTMLElement | null = null;
    private searchQuery = "";
    private debouncedSearch: () => void;
    private cancelDebouncedSearch: () => void;

    constructor(app: App, plugin: LilbeePlugin) {
        super(app);
        this.plugin = plugin;
        const searchDebounced = debounce(() => this.resetAndFetch(), DEBOUNCE_MS);
        this.debouncedSearch = searchDebounced.run;
        this.cancelDebouncedSearch = searchDebounced.cancel;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("lilbee-documents-modal");

        contentEl.createEl("h2", { text: MESSAGES.TITLE_DOCUMENTS });

        const searchInput = contentEl.createEl("input", {
            cls: "lilbee-documents-search",
            placeholder: MESSAGES.PLACEHOLDER_SEARCH_DOCUMENTS,
            attr: { type: "text" },
        });
        searchInput.addEventListener("input", () => {
            this.searchQuery = (searchInput as unknown as HTMLInputElement).value;
            this.debouncedSearch();
        });

        this.removeBtn = contentEl.createEl("button", {
            text: MESSAGES.BUTTON_DELETE_SELECTED,
            cls: "lilbee-documents-remove",
        });
        (this.removeBtn as HTMLButtonElement).disabled = true;
        this.removeBtn.addEventListener("click", () => void this.removeSelected());

        this.resultsEl = contentEl.createDiv({ cls: "lilbee-documents-results" });

        this.loadMoreBtn = contentEl.createEl("button", {
            text: MESSAGES.BUTTON_LOAD_MORE,
            cls: "lilbee-documents-load-more",
        });
        this.loadMoreBtn.style.display = "none";
        this.loadMoreBtn.addEventListener("click", () => void this.fetchPage());

        this.resetAndFetch();
    }

    onClose(): void {
        this.cancelDebouncedSearch();
    }

    private resetAndFetch(): void {
        this.offset = 0;
        this.documents = [];
        this.selected.clear();
        if (this.resultsEl) this.resultsEl.empty();
        this.updateRemoveBtn();
        void this.fetchPage();
    }

    private async fetchPage(): Promise<void> {
        try {
            const response: DocumentsResponse = await this.plugin.api.listDocuments(
                this.searchQuery || undefined,
                PAGE_SIZE,
                this.offset,
            );
            this.total = response.total;
            this.documents.push(...response.documents);
            this.offset += response.documents.length;

            for (const doc of response.documents) {
                this.renderRow(doc);
            }

            this.updateLoadMore();
        } catch {
            new Notice(MESSAGES.ERROR_LOAD_DOCUMENTS);
        }
    }

    private updateLoadMore(): void {
        if (!this.loadMoreBtn) return;
        this.loadMoreBtn.style.display = this.offset < this.total ? "" : "none";
    }

    private updateRemoveBtn(): void {
        if (!this.removeBtn) return;
        (this.removeBtn as HTMLButtonElement).disabled = this.selected.size === 0;
    }

    private renderRow(doc: DocumentEntry): void {
        if (!this.resultsEl) return;
        const row = this.resultsEl.createDiv({ cls: "lilbee-documents-row" });

        const checkbox = row.createEl("input", {
            cls: "lilbee-documents-checkbox",
            attr: { type: "checkbox" },
        });
        checkbox.addEventListener("change", () => {
            const checked = (checkbox as unknown as HTMLInputElement).checked;
            if (checked) {
                this.selected.add(doc.filename);
            } else {
                this.selected.delete(doc.filename);
            }
            this.updateRemoveBtn();
        });

        row.createDiv({ cls: "lilbee-documents-row-name", text: doc.filename });
        row.createDiv({ cls: "lilbee-documents-row-chunks", text: `${doc.chunk_count} chunks` });
        row.createDiv({ cls: "lilbee-documents-row-date", text: doc.ingested_at });
    }

    private async removeSelected(): Promise<void> {
        if (this.selected.size === 0) return;
        const names = Array.from(this.selected);
        const confirm = new ConfirmModal(
            this.app,
            `Delete ${names.length} document(s) from index and disk? This cannot be undone.`,
        );
        confirm.open();
        const confirmed = await confirm.result;
        if (!confirmed) return;
        try {
            const result = await this.plugin.api.removeDocuments(names, true);
            new Notice(MESSAGES.NOTICE_DELETED(result.removed));
            this.resetAndFetch();
        } catch {
            new Notice(MESSAGES.ERROR_DELETE_DOCUMENTS);
        }
    }
}
