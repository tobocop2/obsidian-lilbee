import { App, Modal, Notice } from "obsidian";
import type LilbeePlugin from "../main";
import type { ModelShowResponse, StatusResponse } from "../types";
import { DocumentList } from "../components/document-list";
import { MESSAGES } from "../locales/en";
import { bindEscapeToClose, noticeForResultError } from "../utils";

export class StatusModal extends Modal {
    private plugin: LilbeePlugin;

    constructor(app: App, plugin: LilbeePlugin) {
        super(app);
        this.plugin = plugin;
        bindEscapeToClose(this);
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("lilbee-status-modal");
        contentEl.createEl("h2", { text: MESSAGES.TITLE_STATUS });
        void this.loadStatus(contentEl);
    }

    private async loadStatus(contentEl: HTMLElement): Promise<void> {
        try {
            const statusResult = await this.plugin.api.status();
            if (statusResult.isErr()) {
                new Notice(noticeForResultError(statusResult.error, MESSAGES.ERROR_COULD_NOT_CONNECT));
                this.close();
                return;
            }
            const status = statusResult.value;
            this.renderDocuments(contentEl, status);
            this.renderHeldOut(contentEl, status);
            await this.renderModels(contentEl, status);
            this.renderWiki(contentEl, status);
        } catch {
            new Notice(MESSAGES.ERROR_COULD_NOT_CONNECT);
            this.close();
        }
    }

    /** The first document page loads in the background: a slow documents call must not delay the sections below. */
    private renderDocuments(container: HTMLElement, status: StatusResponse): void {
        const section = container.createEl("details", { attr: { open: "" } });
        section.createEl("summary", { text: MESSAGES.LABEL_STATUS_DOCUMENTS });

        const table = section.createEl("table", { cls: "lilbee-status-table" });
        this.addRow(table, MESSAGES.LABEL_STATUS_DOCUMENTS, String(status.document_count));
        this.addRow(table, MESSAGES.LABEL_STATUS_CHUNKS, String(status.total_chunks));

        const listEl = section.createDiv({ cls: "lilbee-status-documents" });
        const list = new DocumentList(listEl, (limit, offset) =>
            this.plugin.api.listDocuments(undefined, limit, offset),
        );

        const footer = section.createDiv({ cls: "lilbee-status-documents-footer" });
        const summary = footer.createDiv({ cls: "lilbee-status-documents-summary" });
        const button = footer.createEl("button", {
            text: MESSAGES.BUTTON_LOAD_MORE,
            cls: "lilbee-status-load-more",
        });
        button.hide();
        button.addEventListener("click", () => void loadDocumentPage(list, button, summary));

        void loadDocumentPage(list, button, summary);
    }

    private renderHeldOut(container: HTMLElement, status: StatusResponse): void {
        const skipped = status.skipped ?? [];
        if (skipped.length === 0) return;
        const section = container.createEl("details", { cls: "lilbee-status-held-out", attr: { open: "" } });
        section.createEl("summary", { text: MESSAGES.LABEL_STATUS_HELD_OUT });
        for (const source of skipped) {
            const row = section.createDiv({ cls: "lilbee-status-held-out-row" });
            const nameEl = row.createDiv({ cls: "lilbee-status-held-out-name", text: source.filename });
            nameEl.setAttribute("title", source.filename);
            row.createDiv({ cls: "lilbee-status-held-out-reason", text: source.reason });
        }
        const hidden = (status.skipped_total ?? skipped.length) - skipped.length;
        if (hidden > 0) {
            section.createDiv({
                cls: "lilbee-status-held-out-more",
                text: MESSAGES.LABEL_STATUS_HELD_OUT_MORE(hidden),
            });
        }
        section.createDiv({ cls: "lilbee-status-held-out-retry", text: MESSAGES.LABEL_STATUS_HELD_OUT_RETRY });
    }

    private async renderModels(container: HTMLElement, status: StatusResponse): Promise<void> {
        const section = container.createEl("details", { attr: { open: "" } });
        section.createEl("summary", { text: MESSAGES.LABEL_MODELS });

        const table = section.createEl("table", { cls: "lilbee-status-table" });

        const chatModel = status.config.chat_model;
        this.addModelRow(table, MESSAGES.LABEL_STATUS_CHAT_MODEL, chatModel);

        if (chatModel) {
            await this.renderModelDetails(table, chatModel);
        }
        await this.renderServedContext(table);

        const ocrValue = status.config.enable_ocr;
        const ocrLabel =
            ocrValue === "true"
                ? MESSAGES.STATUS_VALUE_OCR_ON
                : ocrValue === "false"
                  ? MESSAGES.STATUS_VALUE_OCR_OFF
                  : MESSAGES.STATUS_VALUE_OCR_AUTO;
        this.addRow(table, MESSAGES.LABEL_STATUS_OCR, ocrLabel);
    }

    private async renderModelDetails(table: HTMLTableElement, model: string): Promise<void> {
        try {
            const info: ModelShowResponse = await this.plugin.api.showModel(model);
            if (info.architecture) {
                this.addRow(table, MESSAGES.LABEL_STATUS_ARCHITECTURE, info.architecture);
            }
            if (info.context_length) {
                this.addRow(table, MESSAGES.LABEL_STATUS_CONTEXT_LENGTH, info.context_length);
            }
        } catch {
            // Model details not available — not critical
        }
    }

    /** Context window the chat fleet actually serves per slot; absent on older servers or while cold. */
    private async renderServedContext(table: HTMLTableElement): Promise<void> {
        const health = await this.plugin.api.health();
        if (health.isErr()) return;
        const ctx = health.value.chat_ctx;
        if (ctx === null || ctx === undefined) return;
        this.addRow(table, MESSAGES.LABEL_STATUS_SERVED_CONTEXT, String(ctx));
    }

    private renderWiki(container: HTMLElement, status: StatusResponse): void {
        if (!status.wiki) return;

        const section = container.createEl("details", { attr: { open: "" } });
        section.createEl("summary", { text: MESSAGES.LABEL_STATUS_WIKI });

        const table = section.createEl("table", { cls: "lilbee-status-table" });
        this.addRow(
            table,
            MESSAGES.LABEL_STATUS_WIKI,
            status.wiki.enabled ? MESSAGES.LABEL_STATUS_ENABLED : MESSAGES.LABEL_STATUS_DISABLED,
        );
        this.addRow(table, MESSAGES.LABEL_STATUS_WIKI_PAGES, String(status.wiki.page_count));
        this.addRow(table, MESSAGES.LABEL_STATUS_WIKI_DRAFTS, String(status.wiki.draft_count));
        this.addRow(
            table,
            MESSAGES.LABEL_STATUS_WIKI_LAST_LINT,
            status.wiki.last_lint ?? MESSAGES.LABEL_STATUS_NOT_AVAILABLE,
        );
    }

    private addRow(table: HTMLTableElement, label: string, value: string): void {
        const row = table.createEl("tr");
        row.createEl("td", { text: label, cls: "lilbee-status-label" });
        row.createEl("td", { text: value, cls: "lilbee-status-value" });
    }

    private addModelRow(table: HTMLTableElement, label: string, model: string): void {
        const row = table.createEl("tr");
        row.createEl("td", { text: label, cls: "lilbee-status-label" });
        const cell = row.createEl("td", { cls: "lilbee-status-value" });
        if (!model) {
            cell.setText(MESSAGES.LABEL_STATUS_NONE);
            return;
        }
        cell.setText(shortModelLabel(model));
        cell.setAttribute("title", model);
    }
}

async function loadDocumentPage(list: DocumentList, button: HTMLButtonElement, summary: HTMLElement): Promise<void> {
    const loaded = await list.loadMore();
    summary.setText(documentSummaryText(list, loaded));
    if (list.hasMore) button.show();
    else button.hide();
}

function documentSummaryText(list: DocumentList, loaded: boolean): string {
    if (!loaded) return MESSAGES.LABEL_STATUS_DOCUMENTS_FAILED;
    if (list.loaded === 0) return MESSAGES.LABEL_STATUS_DOCUMENTS_EMPTY;
    if (list.hasMore) return MESSAGES.LABEL_STATUS_DOCUMENTS_SHOWING(list.loaded, list.total);
    return MESSAGES.LABEL_STATUS_DOCUMENTS_COMPLETE(list.total);
}

function shortModelLabel(model: string): string {
    const slash = model.lastIndexOf("/");
    return slash === -1 ? model : model.slice(slash + 1);
}
