import { App, Modal } from "obsidian";
import type LilbeePlugin from "../main";
import type { CatalogEntry, ModelInfoSource, ModelShowResponse, ModelTask } from "../types";
import { MODEL_INFO_SOURCE } from "../types";
import { MESSAGES } from "../locales/en";
import { renderModelDetail } from "../components/model-detail";
import { bindEscapeToClose, formatAbbreviatedCount } from "../utils";
import { modelShowRows } from "../utils/model-show-rows";

interface ContextWindowField {
    context_window?: number;
}

interface QuantizationField {
    quantization?: string;
}

export class ModelInfoModal extends Modal {
    private source: ModelInfoSource;

    constructor(app: App, _plugin: LilbeePlugin, source: ModelInfoSource) {
        super(app);
        this.source = source;
        bindEscapeToClose(this);
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("lilbee-model-info-modal");

        contentEl.createEl("h2", { text: MESSAGES.MODEL_INFO_TITLE });
        if (this.source.kind === MODEL_INFO_SOURCE.CATALOG) {
            this.renderCatalogEntry(contentEl, this.source.entry);
            return;
        }
        this.renderServerAnswer(contentEl, this.source.ref, this.source.task, this.source.details);
    }

    private renderCatalogEntry(parent: HTMLElement, entry: CatalogEntry): void {
        const detailHost = parent.createDiv({ cls: "lilbee-model-info-detail" });
        renderModelDetail(entry, detailHost);
        this.renderMoreInfo(parent, entry);
        this.renderHfLink(parent, entry.hf_repo);
    }

    /** No Hugging Face link here: a ref the catalog does not carry need not be a Hugging Face repo. */
    private renderServerAnswer(parent: HTMLElement, ref: string, task: ModelTask, details: ModelShowResponse): void {
        const detailHost = parent.createDiv({ cls: "lilbee-model-info-detail" });
        detailHost.createEl("h3", { cls: "lilbee-detail-name", text: ref });
        const section = parent.createDiv({ cls: "lilbee-model-info-section" });
        addRow(section, MESSAGES.MODEL_INFO_TASK, task);
        for (const row of modelShowRows(details)) addRow(section, row.label, row.value);
    }

    private renderMoreInfo(parent: HTMLElement, entry: CatalogEntry): void {
        const section = parent.createDiv({ cls: "lilbee-model-info-section" });
        addRow(section, MESSAGES.MODEL_INFO_TASK, entry.task);
        if (entry.param_count) addRow(section, MESSAGES.MODEL_INFO_PARAMS, entry.param_count);
        const ctx = (entry as CatalogEntry & ContextWindowField).context_window;
        if (typeof ctx === "number" && ctx > 0) addRow(section, MESSAGES.MODEL_INFO_CONTEXT, String(ctx));
        if (entry.min_ram_gb > 0) addRow(section, MESSAGES.MODEL_INFO_RAM, `${entry.min_ram_gb} GB`);
        const quant = (entry as CatalogEntry & QuantizationField).quantization;
        if (typeof quant === "string" && quant.length > 0) addRow(section, MESSAGES.MODEL_INFO_QUANT, quant);
        if (entry.downloads > 0) {
            addRow(section, MESSAGES.MODEL_INFO_DOWNLOADS, formatAbbreviatedCount(entry.downloads));
        }
    }

    private renderHfLink(parent: HTMLElement, hfRepo: string): void {
        if (!hfRepo) return;
        const linkRow = parent.createDiv({ cls: "lilbee-model-info-link-row" });
        const url = `https://huggingface.co/${hfRepo}`;
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
