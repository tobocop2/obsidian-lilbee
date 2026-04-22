import { App, MarkdownRenderer, Modal, Notice } from "obsidian";
import type { LilbeeClient } from "../api";
import type { Source, SourceContent } from "../types";
import { CONTENT_TYPE } from "../types";
import { MESSAGES } from "../locales/en";
import { errorMessage } from "../utils";
import { formatLocation } from "./results";

/**
 * Read-only preview for sources that aren't in the local vault (external
 * server mode, or a vault-bound source whose file was removed). Fetches
 * content via `/api/source` and renders markdown inline. For PDFs the modal
 * embeds an `<object>` pointing at the `raw=1` endpoint so Chromium's built-in
 * PDF viewer handles the bytes.
 *
 * A future "Save to vault" button will push the content into `<vault>/lilbee/`
 * once the server exposes the write path — disabled for now with a tooltip.
 */
export class SourcePreviewModal extends Modal {
    private api: LilbeeClient;
    private source: Source;

    constructor(app: App, api: LilbeeClient, source: Source) {
        super(app);
        this.api = api;
        this.source = source;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("lilbee-modal");
        contentEl.addClass("lilbee-preview-modal");

        contentEl.createEl("h2", { text: MESSAGES.TITLE_SOURCE_PREVIEW });

        this.renderHeader(contentEl);

        if (!this.source.source) {
            new Notice(MESSAGES.ERROR_PREVIEW_INVALID_SOURCE);
            contentEl.createEl("p", { text: MESSAGES.ERROR_PREVIEW_INVALID_SOURCE, cls: "lilbee-preview-error" });
            this.renderFooter(contentEl);
            return;
        }

        const bodyHost = contentEl.createDiv({ cls: "lilbee-preview-host" });
        bodyHost.createDiv({ cls: "lilbee-preview-loading" });
        this.renderFooter(contentEl);

        void this.loadContent(bodyHost);
    }

    onClose(): void {
        this.contentEl.empty();
    }

    private renderHeader(container: HTMLElement): void {
        const header = container.createDiv({ cls: "lilbee-preview-header" });
        header.createEl("span", {
            text: this.source.vault_path ?? this.source.source,
            cls: "lilbee-preview-path",
        });
        const loc = formatLocation(this.source);
        if (loc) {
            container.createEl("span", { text: loc, cls: "lilbee-preview-meta" });
        }
    }

    private renderFooter(container: HTMLElement): void {
        const footer = container.createDiv({ cls: "lilbee-preview-footer" });
        const save = footer.createEl("button", {
            text: MESSAGES.LABEL_PREVIEW_SAVE_TO_VAULT,
            cls: "lilbee-preview-save",
        }) as HTMLButtonElement;
        save.disabled = true;
        save.setAttribute("title", MESSAGES.TOOLTIP_PREVIEW_SAVE_SOON);

        const close = footer.createEl("button", {
            text: MESSAGES.LABEL_PREVIEW_CLOSE,
            cls: "lilbee-preview-close mod-cta",
        });
        close.addEventListener("click", () => this.close());
    }

    private async loadContent(host: HTMLElement): Promise<void> {
        try {
            const content = await this.api.getSource(this.source.source);
            host.empty();
            this.renderBody(host, content);
        } catch (err) {
            const reason = errorMessage(err, String(err));
            host.empty();
            host.createEl("p", { text: MESSAGES.ERROR_PREVIEW_LOAD(reason), cls: "lilbee-preview-error" });
            new Notice(MESSAGES.ERROR_PREVIEW_LOAD(reason));
        }
    }

    private renderBody(host: HTMLElement, content: SourceContent): void {
        if (this.source.content_type === CONTENT_TYPE.PDF || content.content_type === CONTENT_TYPE.PDF) {
            this.renderPdf(host);
            return;
        }
        const body = host.createDiv({ cls: "lilbee-preview-body" });
        void MarkdownRenderer.render(this.app, content.markdown, body, "", this);
    }

    private renderPdf(host: HTMLElement): void {
        const body = host.createDiv({ cls: "lilbee-preview-body" });
        const rawUrl = this.rawSourceUrl();
        const obj = body.createEl("object", { cls: "lilbee-preview-pdf-object" });
        obj.setAttribute("type", CONTENT_TYPE.PDF);
        obj.setAttribute("data", rawUrl);
    }

    private rawSourceUrl(): string {
        // Build a direct URL to the raw bytes; the modal hands this off to the
        // embedded PDF viewer. The api client is used by this class for the
        // JSON path, but for the <object data=...> attribute we need a raw URL
        // that the embedded viewer can fetch itself.
        const params = new URLSearchParams({ source: this.source.source, raw: "1" });
        // Access the base URL via the client; the client exposes it only as a
        // private. Fall back to a data URL if unavailable.
        const base = (this.api as unknown as { baseUrl?: string }).baseUrl ?? "";
        return `${base}/api/source?${params.toString()}`;
    }
}
