import { App, Modal, Notice } from "obsidian";
import type LilbeePlugin from "../main";
import { MESSAGES } from "../locales/en";

export class CrawlModal extends Modal {
    private plugin: LilbeePlugin;

    constructor(app: App, plugin: LilbeePlugin) {
        super(app);
        this.plugin = plugin;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("lilbee-crawl-modal");

        contentEl.createEl("h2", { text: MESSAGES.TITLE_CRAWL_WEB_PAGE });

        const urlInput = contentEl.createEl("input", {
            cls: "lilbee-crawl-url",
            placeholder: MESSAGES.PLACEHOLDER_URL,
            attr: { type: "text" },
        });

        const options = contentEl.createDiv({ cls: "lilbee-crawl-options" });

        const depthLabel = options.createEl("label", { text: MESSAGES.LABEL_DEPTH });
        const depthInput = depthLabel.createEl("input", {
            cls: "lilbee-crawl-depth",
            attr: { type: "number" },
        });
        (depthInput as unknown as HTMLInputElement).value = "0";

        const maxLabel = options.createEl("label", { text: MESSAGES.LABEL_MAX_PAGES });
        const maxInput = maxLabel.createEl("input", {
            cls: "lilbee-crawl-max-pages",
            attr: { type: "number" },
        });
        (maxInput as unknown as HTMLInputElement).value = "50";

        const actions = contentEl.createDiv({ cls: "lilbee-crawl-actions" });
        const crawlBtn = actions.createEl("button", { text: MESSAGES.BUTTON_CRAWL, cls: "mod-cta" });
        crawlBtn.addEventListener("click", () => {
            const url = (urlInput as unknown as HTMLInputElement).value.trim();
            if (!url) {
                new Notice(MESSAGES.NOTICE_ENTER_URL);
                return;
            }
            const depth = parseInt((depthInput as unknown as HTMLInputElement).value, 10) || 0;
            const maxPages = parseInt((maxInput as unknown as HTMLInputElement).value, 10) || 50;
            this.plugin.runCrawl(url, depth, maxPages);
            this.close();
        });

        const cancelBtn = actions.createEl("button", { text: MESSAGES.BUTTON_CANCEL });
        cancelBtn.addEventListener("click", () => this.close());
    }
}
