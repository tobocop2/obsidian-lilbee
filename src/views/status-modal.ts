import { App, Modal, Notice } from "obsidian";
import type LilbeePlugin from "../main";
import type { ModelShowResponse, StatusResponse } from "../types";
import { MESSAGES } from "../locales/en";

export class StatusModal extends Modal {
    private plugin: LilbeePlugin;

    constructor(app: App, plugin: LilbeePlugin) {
        super(app);
        this.plugin = plugin;
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
                new Notice(MESSAGES.ERROR_COULD_NOT_CONNECT);
                this.close();
                return;
            }
            const status = statusResult.value;
            this.renderDocuments(contentEl, status);
            await this.renderModels(contentEl, status);
            this.renderWiki(contentEl, status);
        } catch {
            new Notice(MESSAGES.ERROR_COULD_NOT_CONNECT);
            this.close();
        }
    }

    private renderDocuments(container: HTMLElement, status: StatusResponse): void {
        const section = container.createEl("details", { attr: { open: "" } });
        section.createEl("summary", { text: MESSAGES.LABEL_STATUS_DOCUMENTS });

        const table = section.createEl("table", { cls: "lilbee-status-table" });
        this.addRow(table, MESSAGES.LABEL_STATUS_DOCUMENTS, String(status.sources.length));
        this.addRow(table, MESSAGES.LABEL_STATUS_CHUNKS, String(status.total_chunks));
    }

    private async renderModels(container: HTMLElement, status: StatusResponse): Promise<void> {
        const section = container.createEl("details", { attr: { open: "" } });
        section.createEl("summary", { text: MESSAGES.LABEL_MODELS });

        const table = section.createEl("table", { cls: "lilbee-status-table" });

        const chatModel = status.config.chat_model || MESSAGES.LABEL_STATUS_NONE;
        this.addRow(table, MESSAGES.LABEL_STATUS_CHAT_MODEL, chatModel);

        if (status.config.chat_model) {
            await this.renderModelDetails(table, status.config.chat_model);
        }

        const ocrValue = status.config.enable_ocr;
        const ocrLabel =
            ocrValue === "true"
                ? MESSAGES.LABEL_OCR_ON
                : ocrValue === "false"
                  ? MESSAGES.LABEL_OCR_OFF
                  : MESSAGES.LABEL_OCR_AUTO;
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
            if (info.file_type) {
                this.addRow(table, MESSAGES.LABEL_STATUS_FILE_TYPE, info.file_type);
            }
        } catch {
            // Model details not available — not critical
        }
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
}
