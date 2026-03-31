import { App, Modal, Notice } from "obsidian";
import type LilbeePlugin from "../main";
import { SSE_EVENT, TASK_TYPE } from "../types";

export class CrawlModal extends Modal {
    private plugin: LilbeePlugin;
    private _resolve: ((value: boolean) => void) | null = null;
    private decided = false;
    readonly result: Promise<boolean>;
    private progressEl: HTMLElement | null = null;
    private crawlController: AbortController | null = null;

    constructor(app: App, plugin: LilbeePlugin) {
        super(app);
        this.plugin = plugin;
        this.result = new Promise<boolean>((resolve) => {
            this._resolve = resolve;
        });
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("lilbee-crawl-modal");

        contentEl.createEl("h2", { text: "Crawl web page" });

        const urlInput = contentEl.createEl("input", {
            cls: "lilbee-crawl-url",
            placeholder: "https://example.com",
            attr: { type: "text" },
        });

        const options = contentEl.createDiv({ cls: "lilbee-crawl-options" });

        const depthLabel = options.createEl("label", { text: "Depth: " });
        const depthInput = depthLabel.createEl("input", {
            cls: "lilbee-crawl-depth",
            attr: { type: "number" },
        });
        (depthInput as unknown as HTMLInputElement).value = "0";

        const maxLabel = options.createEl("label", { text: "Max pages: " });
        const maxInput = maxLabel.createEl("input", {
            cls: "lilbee-crawl-max-pages",
            attr: { type: "number" },
        });
        (maxInput as unknown as HTMLInputElement).value = "50";

        this.progressEl = contentEl.createDiv({ cls: "lilbee-crawl-progress" });

        const actions = contentEl.createDiv({ cls: "lilbee-crawl-actions" });
        const crawlBtn = actions.createEl("button", { text: "Crawl", cls: "mod-cta" });
        crawlBtn.addEventListener("click", () => {
            const url = (urlInput as unknown as HTMLInputElement).value.trim();
            if (!url) {
                new Notice("lilbee: please enter a URL");
                return;
            }
            const depth = parseInt((depthInput as unknown as HTMLInputElement).value, 10) || 0;
            const maxPages = parseInt((maxInput as unknown as HTMLInputElement).value, 10) || 50;
            (crawlBtn as HTMLButtonElement).disabled = true;
            void this.executeCrawl(url, depth, maxPages, crawlBtn);
        });

        const cancelBtn = actions.createEl("button", { text: "Cancel" });
        cancelBtn.addEventListener("click", () => this.decide(false));
    }

    onClose(): void {
        if (this.crawlController) this.crawlController.abort();
        this.decide(false);
    }

    private decide(value: boolean): void {
        if (this.decided) return;
        this.decided = true;
        if (this._resolve) {
            const resolve = this._resolve;
            this._resolve = null;
            resolve(value);
        }
        this.close();
    }

    private async executeCrawl(url: string, depth: number, maxPages: number, crawlBtn?: HTMLElement): Promise<void> {
        if (this.progressEl) this.progressEl.textContent = "Crawling...";
        this.crawlController = new AbortController();
        const taskId = this.plugin.taskQueue.enqueue(`Crawl ${url}`, TASK_TYPE.CRAWL);
        try {
            let pageCount = 0;
            for await (const event of this.plugin.api.crawl(url, depth, maxPages, this.crawlController.signal)) {
                switch (event.event) {
                    case SSE_EVENT.CRAWL_START:
                        if (this.progressEl) this.progressEl.textContent = "Crawl started...";
                        break;
                    case SSE_EVENT.CRAWL_PAGE: {
                        pageCount++;
                        const d = event.data as { url?: string };
                        if (this.progressEl) this.progressEl.textContent = `Crawled ${pageCount} pages — ${d.url ?? ""}`;
                        this.plugin.taskQueue.update(taskId, -1, `${pageCount} pages`);
                        break;
                    }
                    case SSE_EVENT.CRAWL_DONE: {
                        const d = event.data as { pages_crawled?: number };
                        this.plugin.taskQueue.complete(taskId);
                        new Notice(`lilbee: crawl done — ${d.pages_crawled ?? pageCount} pages`);
                        this.decide(true);
                        return;
                    }
                    case SSE_EVENT.CRAWL_ERROR: {
                        const d = event.data as { message?: string };
                        this.plugin.taskQueue.fail(taskId, d.message ?? "unknown");
                        new Notice(`lilbee: crawl error — ${d.message ?? "unknown"}`);
                        if (this.progressEl) this.progressEl.textContent = `Error: ${d.message ?? "unknown"}`;
                        if (crawlBtn) (crawlBtn as HTMLButtonElement).disabled = false;
                        this.decide(false);
                        return;
                    }
                }
            }
            // Stream ended without DONE/ERROR
            this.plugin.taskQueue.complete(taskId);
            this.decide(true);
        } catch (err) {
            const msg = err instanceof Error ? err.message : "unknown error";
            this.plugin.taskQueue.fail(taskId, msg);
            new Notice(`lilbee: crawl failed — ${msg}`);
            if (this.progressEl) this.progressEl.textContent = `Failed: ${msg}`;
            if (crawlBtn) (crawlBtn as HTMLButtonElement).disabled = false;
            this.decide(false);
        } finally {
            this.crawlController = null;
        }
    }
}
