import { App, MarkdownRenderer, Modal, Notice } from "obsidian";
import type { LilbeeClient } from "../api";
import type { Source, SourceContent } from "../types";
import { CONTENT_TYPE } from "../types";
import { MESSAGES } from "../locales/en";
import { errorMessage } from "../utils";
import { formatLocation } from "./results";

// Text/* mime types that should NOT render inline through MarkdownRenderer
// even though they pass the broad text/* category. Keep narrow and explicit;
// broadening this set requires a security review.
const TEXT_INLINE_RENDER_DENY = new Set([
    "text/html",
    "text/javascript",
    "application/javascript",
    "application/xhtml+xml",
    "text/css",
]);

/**
 * Read-only preview for sources that aren't in the local vault (external
 * server mode, or a vault-bound source whose file was removed). Fetches
 * content via `/api/source` and renders markdown inline. For PDFs the modal
 * embeds an `<object type="application/pdf">` pointing at the `raw=1`
 * endpoint with a `#page=N` fragment — Chromium's built-in PDFium viewer
 * honours that fragment, which lets the preview jump directly to the
 * chunk's page. The type-locked `<object>` tag narrows the rendering
 * surface for any non-PDF bytes the server might return.
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
        const { contentEl, modalEl } = this;
        contentEl.empty();
        contentEl.addClass("lilbee-modal");
        contentEl.addClass("lilbee-preview-modal");
        // Apply resize handling to the outer modal frame that Obsidian creates;
        // CSS ``resize: both`` on the inner content element is clipped by the
        // frame's default ``overflow: hidden``. Setting dimensions inline
        // beats Obsidian's default ``width: fit-content`` without relying on
        // CSS specificity escalations.
        modalEl.addClass("lilbee-preview-modal-frame");
        modalEl.style.width = "min(880px, 92vw)";
        modalEl.style.height = "min(640px, 85vh)";
        modalEl.style.resize = "both";
        modalEl.style.overflow = "hidden";
        modalEl.style.position = "relative";

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
        const loc = formatLocation(this.source, this.source.content_type);
        if (loc) {
            container.createEl("span", { text: loc, cls: "lilbee-preview-meta" });
        }
    }

    private renderFooter(container: HTMLElement): void {
        const footer = container.createDiv({ cls: "lilbee-preview-footer" });
        // When the source resolves to a vault file, swap the disabled
        // "Save to vault" stub for an "Open in vault" affordance — clicking
        // it dismisses the preview and opens the original file in the main
        // pane via Obsidian's standard link routing.
        const inVaultPath = this.resolveVaultPath();
        if (inVaultPath !== null) {
            const openBtn = footer.createEl("button", {
                text: MESSAGES.LABEL_PREVIEW_OPEN_IN_VAULT,
                cls: "lilbee-preview-open-vault",
            });
            openBtn.addEventListener("click", () => {
                this.app.workspace.openLinkText(inVaultPath, "");
                this.close();
            });
        } else {
            const save = footer.createEl("button", {
                text: MESSAGES.LABEL_PREVIEW_SAVE_TO_VAULT,
                cls: "lilbee-preview-save",
            }) as HTMLButtonElement;
            save.disabled = true;
            save.setAttribute("title", MESSAGES.TOOLTIP_PREVIEW_SAVE_SOON);
        }

        const close = footer.createEl("button", {
            text: MESSAGES.LABEL_PREVIEW_CLOSE,
            cls: "lilbee-preview-close mod-cta",
        });
        close.addEventListener("click", () => this.close());
    }

    private resolveVaultPath(): string | null {
        const vault = this.app.vault;
        const vaultPath = this.source.vault_path;
        if (vaultPath && vault.getAbstractFileByPath(vaultPath)) {
            return vaultPath;
        }
        if (this.source.source && vault.getAbstractFileByPath(this.source.source)) {
            return this.source.source;
        }
        return null;
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
        const ct = content.content_type;
        const isPdf = this.source.content_type === CONTENT_TYPE.PDF || ct === CONTENT_TYPE.PDF;
        if (isPdf) {
            this.renderPdf(host);
            return;
        }
        // Mirror the server's raw-content allowlist: any text/* may render through
        // MarkdownRenderer, except formats that can carry script (text/html,
        // text/javascript, application/xhtml+xml) or styling (text/css). The
        // <object> tag protects the PDF path; this gate protects the JSON path.
        const textBlocked = TEXT_INLINE_RENDER_DENY.has(ct);
        if (!textBlocked && ct.startsWith("text/")) {
            const body = host.createDiv({ cls: "lilbee-preview-body" });
            void MarkdownRenderer.render(this.app, content.markdown, body, "", this);
            return;
        }
        host.createEl("p", {
            text: MESSAGES.ERROR_PREVIEW_UNSUPPORTED(ct),
            cls: "lilbee-preview-error",
        });
    }

    private renderPdf(host: HTMLElement): void {
        const body = host.createDiv({ cls: "lilbee-preview-body" });
        const frame = body.createEl("object", { cls: "lilbee-preview-pdf-frame" });
        frame.setAttribute("type", "application/pdf");
        frame.setAttribute("data", this.rawSourceUrl(this.source.page_start));
    }

    private rawSourceUrl(page: number | null): string {
        // Direct URL to the raw PDF bytes for the embedded viewer to fetch.
        // Appending `#page=N` makes Chromium's PDFium viewer open at that page.
        const params = new URLSearchParams({ source: this.source.source, raw: "1" });
        const base = (this.api as unknown as { baseUrl?: string }).baseUrl ?? "";
        const fragment = page && page > 0 ? `#page=${page}` : "";
        return `${base}/api/source?${params.toString()}${fragment}`;
    }
}
