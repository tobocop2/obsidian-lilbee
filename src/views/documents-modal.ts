import { App, Modal, Notice } from "obsidian";
import type LilbeePlugin from "../main";
import { ConfirmModal } from "./confirm-modal";
import { DocumentList } from "../components/document-list";
import { MESSAGES } from "../locales/en";
import { bindEscapeToClose, debounce, DEBOUNCE_MS } from "../utils";

export class DocumentsModal extends Modal {
    private plugin: LilbeePlugin;
    private list: DocumentList | null = null;
    private unbindScroll: (() => void) | null = null;
    private resultsEl: HTMLElement | null = null;
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
        bindEscapeToClose(this);
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
            this.searchQuery = searchInput.value;
            this.debouncedSearch();
        });

        this.removeBtn = contentEl.createEl("button", {
            text: MESSAGES.BUTTON_DELETE_SELECTED,
            cls: "lilbee-documents-remove",
        });
        (this.removeBtn as HTMLButtonElement).disabled = true;
        this.removeBtn.addEventListener("click", () => void this.removeSelected());

        this.resultsEl = contentEl.createDiv({ cls: "lilbee-documents-results" });
        this.list = new DocumentList(
            this.resultsEl,
            (limit, offset) => this.plugin.api.listDocuments(this.searchQuery || undefined, limit, offset),
            { selectable: true, onSelectionChange: () => this.updateRemoveBtn() },
        );
        this.unbindScroll = this.list.bindScroll(this.resultsEl);

        this.resetAndFetch();
    }

    onClose(): void {
        this.cancelDebouncedSearch();
        this.unbindScroll?.();
    }

    private resetAndFetch(): void {
        if (!this.list) return;
        this.list.reset();
        this.updateRemoveBtn();
        void this.list.loadMore();
    }

    private updateRemoveBtn(): void {
        if (!this.removeBtn || !this.list) return;
        (this.removeBtn as HTMLButtonElement).disabled = this.list.selected.length === 0;
    }

    private async removeSelected(): Promise<void> {
        const names = this.list?.selected ?? [];
        if (names.length === 0) return;
        const confirm = new ConfirmModal(this.app, MESSAGES.NOTICE_CONFIRM_DELETE_DOCS(names.length));
        confirm.open();
        const confirmed = await confirm.result;
        if (!confirmed) return;
        try {
            const result = await this.plugin.api.removeDocuments(names);
            new Notice(MESSAGES.NOTICE_DELETED(result.removed));
            this.resetAndFetch();
        } catch {
            new Notice(MESSAGES.ERROR_DELETE_DOCUMENTS);
        }
    }
}
