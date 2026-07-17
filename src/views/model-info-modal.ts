import { App, Modal } from "obsidian";
import type LilbeePlugin from "../main";
import type { CatalogEntry } from "../types";
import { MESSAGES } from "../locales/en";
import { renderModelDetail } from "../components/model-detail";
import { bindEscapeToClose, formatAbbreviatedCount } from "../utils";

interface ContextWindowField {
    context_window?: number;
}

interface QuantizationField {
    quantization?: string;
}

export class ModelInfoModal extends Modal {
    private entry: CatalogEntry;

    constructor(app: App, _plugin: LilbeePlugin, entry: CatalogEntry) {
        super(app);
        this.entry = entry;
        bindEscapeToClose(this);
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("lilbee-model-info-modal");

        contentEl.createEl("h2", { text: MESSAGES.MODEL_INFO_TITLE });
        const detailHost = contentEl.createDiv({ cls: "lilbee-model-info-detail" });
        renderModelDetail(this.entry, detailHost);

        this.renderMoreInfo(contentEl);
        this.renderHfLink(contentEl);
    }

    private renderMoreInfo(parent: HTMLElement): void {
        const section = parent.createDiv({ cls: "lilbee-model-info-section" });
        addRow(section, MESSAGES.MODEL_INFO_TASK, this.entry.task);
        if (this.entry.param_count) addRow(section, MESSAGES.MODEL_INFO_PARAMS, this.entry.param_count);
        const ctx = (this.entry as CatalogEntry & ContextWindowField).context_window;
        if (typeof ctx === "number" && ctx > 0) addRow(section, MESSAGES.MODEL_INFO_CONTEXT, String(ctx));
        if (this.entry.min_ram_gb > 0) addRow(section, MESSAGES.MODEL_INFO_RAM, `${this.entry.min_ram_gb} GB`);
        const quant = (this.entry as CatalogEntry & QuantizationField).quantization;
        if (typeof quant === "string" && quant.length > 0) addRow(section, MESSAGES.MODEL_INFO_QUANT, quant);
        if (this.entry.downloads > 0) {
            addRow(section, MESSAGES.MODEL_INFO_DOWNLOADS, formatAbbreviatedCount(this.entry.downloads));
        }
    }

    private renderHfLink(parent: HTMLElement): void {
        if (!this.entry.hf_repo) return;
        const linkRow = parent.createDiv({ cls: "lilbee-model-info-link-row" });
        const url = `https://huggingface.co/${this.entry.hf_repo}`;
        const link = linkRow.createEl("a", {
            cls: "lilbee-hf-link",
            text: MESSAGES.MODEL_INFO_HF_LINK_LABEL,
        });
        link.setAttribute("href", url);
        link.setAttribute("target", "_blank");
        link.setAttribute("rel", "noopener noreferrer");
        link.addEventListener("click", (e: Event) => {
            e.preventDefault();
            window.open(url, "_blank");
        });
    }
}

function addRow(parent: HTMLElement, label: string, value: string): void {
    const row = parent.createDiv({ cls: "lilbee-model-info-row" });
    row.createSpan({ cls: "lilbee-model-info-label", text: label });
    row.createSpan({ cls: "lilbee-model-info-value", text: value });
}
