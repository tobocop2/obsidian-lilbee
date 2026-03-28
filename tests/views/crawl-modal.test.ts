import { vi, describe, it, expect, beforeEach } from "vitest";
import { App, Notice } from "obsidian";
import { MockElement } from "../__mocks__/obsidian";
import { CrawlModal } from "../../src/views/crawl-modal";
import { SSE_EVENT } from "../../src/types";

function makePlugin() {
    return {
        api: {
            crawl: vi.fn(),
        },
    };
}

function collectTexts(el: MockElement): string[] {
    const texts: string[] = [];
    if (el.textContent) texts.push(el.textContent);
    for (const child of el.children) {
        texts.push(...collectTexts(child));
    }
    return texts;
}

function findButtons(el: MockElement): MockElement[] {
    const buttons: MockElement[] = [];
    if (el.tagName === "BUTTON") buttons.push(el);
    for (const child of el.children) {
        buttons.push(...findButtons(child));
    }
    return buttons;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("CrawlModal", () => {
    beforeEach(() => {
        Notice.clear();
    });

    it("renders title, URL input, and buttons on open", () => {
        const app = new App();
        const plugin = makePlugin();
        const modal = new CrawlModal(app as any, plugin as any);
        modal.onOpen();

        const el = modal.contentEl as unknown as MockElement;
        const texts = collectTexts(el);
        expect(texts.some(t => t.includes("Crawl web page"))).toBe(true);
        expect(el.find("lilbee-crawl-url")).not.toBeNull();
        const buttons = findButtons(el);
        expect(buttons.some(b => b.textContent === "Crawl")).toBe(true);
        expect(buttons.some(b => b.textContent === "Cancel")).toBe(true);
    });

    it("renders depth and max pages inputs with defaults", () => {
        const app = new App();
        const plugin = makePlugin();
        const modal = new CrawlModal(app as any, plugin as any);
        modal.onOpen();

        const el = modal.contentEl as unknown as MockElement;
        const depth = el.find("lilbee-crawl-depth");
        const maxPages = el.find("lilbee-crawl-max-pages");
        expect(depth).not.toBeNull();
        expect(maxPages).not.toBeNull();
        expect((depth as any).value).toBe("0");
        expect((maxPages as any).value).toBe("50");
    });

    it("Cancel resolves result to false", async () => {
        const app = new App();
        const plugin = makePlugin();
        const modal = new CrawlModal(app as any, plugin as any);
        modal.onOpen();

        const el = modal.contentEl as unknown as MockElement;
        const cancelBtn = findButtons(el).find(b => b.textContent === "Cancel")!;
        cancelBtn.trigger("click");

        const result = await modal.result;
        expect(result).toBe(false);
    });

    it("onClose resolves result to false", async () => {
        const app = new App();
        const plugin = makePlugin();
        const modal = new CrawlModal(app as any, plugin as any);
        modal.onOpen();
        modal.onClose();

        const result = await modal.result;
        expect(result).toBe(false);
    });

    it("shows notice when URL is empty", async () => {
        const app = new App();
        const plugin = makePlugin();
        const modal = new CrawlModal(app as any, plugin as any);
        modal.onOpen();

        const el = modal.contentEl as unknown as MockElement;
        const urlInput = el.find("lilbee-crawl-url")!;
        (urlInput as any).value = "";
        const crawlBtn = findButtons(el).find(b => b.textContent === "Crawl")!;
        crawlBtn.trigger("click");

        expect(Notice.instances.some(n => n.message.includes("please enter a URL"))).toBe(true);
        expect(plugin.api.crawl).not.toHaveBeenCalled();
    });

    it("executes crawl and resolves true on CRAWL_DONE", async () => {
        const app = new App();
        const plugin = makePlugin();
        plugin.api.crawl.mockReturnValue((async function* () {
            yield { event: SSE_EVENT.CRAWL_START, data: {} };
            yield { event: SSE_EVENT.CRAWL_PAGE, data: { url: "https://example.com" } };
            yield { event: SSE_EVENT.CRAWL_DONE, data: { pages_crawled: 1 } };
        })());
        const modal = new CrawlModal(app as any, plugin as any);
        modal.onOpen();

        const el = modal.contentEl as unknown as MockElement;
        const urlInput = el.find("lilbee-crawl-url")!;
        (urlInput as any).value = "https://example.com";
        const crawlBtn = findButtons(el).find(b => b.textContent === "Crawl")!;
        crawlBtn.trigger("click");
        await tick();

        const result = await modal.result;
        expect(result).toBe(true);
        expect(plugin.api.crawl).toHaveBeenCalledWith("https://example.com", 0, 50, expect.any(AbortSignal));
        expect(Notice.instances.some(n => n.message.includes("crawl done"))).toBe(true);
    });

    it("handles CRAWL_ERROR event", async () => {
        const app = new App();
        const plugin = makePlugin();
        plugin.api.crawl.mockReturnValue((async function* () {
            yield { event: SSE_EVENT.CRAWL_ERROR, data: { message: "bad url" } };
        })());
        const modal = new CrawlModal(app as any, plugin as any);
        modal.onOpen();

        const el = modal.contentEl as unknown as MockElement;
        const urlInput = el.find("lilbee-crawl-url")!;
        (urlInput as any).value = "https://bad.com";
        const crawlBtn = findButtons(el).find(b => b.textContent === "Crawl")!;
        crawlBtn.trigger("click");
        await tick();

        const result = await modal.result;
        expect(result).toBe(false);
        expect(Notice.instances.some(n => n.message.includes("crawl error"))).toBe(true);
    });

    it("handles crawl failure (network error)", async () => {
        const app = new App();
        const plugin = makePlugin();
        plugin.api.crawl.mockReturnValue((async function* () {
            throw new Error("network error");
        })());
        const modal = new CrawlModal(app as any, plugin as any);
        modal.onOpen();

        const el = modal.contentEl as unknown as MockElement;
        const urlInput = el.find("lilbee-crawl-url")!;
        (urlInput as any).value = "https://example.com";
        const crawlBtn = findButtons(el).find(b => b.textContent === "Crawl")!;
        crawlBtn.trigger("click");
        await tick();

        const result = await modal.result;
        expect(result).toBe(false);
        expect(Notice.instances.some(n => n.message.includes("crawl failed"))).toBe(true);
    });

    it("resolves true when stream ends without explicit DONE", async () => {
        const app = new App();
        const plugin = makePlugin();
        plugin.api.crawl.mockReturnValue((async function* () {
            yield { event: SSE_EVENT.CRAWL_START, data: {} };
        })());
        const modal = new CrawlModal(app as any, plugin as any);
        modal.onOpen();

        const el = modal.contentEl as unknown as MockElement;
        const urlInput = el.find("lilbee-crawl-url")!;
        (urlInput as any).value = "https://example.com";
        const crawlBtn = findButtons(el).find(b => b.textContent === "Crawl")!;
        crawlBtn.trigger("click");
        await tick();

        const result = await modal.result;
        expect(result).toBe(true);
    });

    it("decide is idempotent", async () => {
        const app = new App();
        const plugin = makePlugin();
        const modal = new CrawlModal(app as any, plugin as any);
        modal.onOpen();

        const el = modal.contentEl as unknown as MockElement;
        const cancelBtn = findButtons(el).find(b => b.textContent === "Cancel")!;
        cancelBtn.trigger("click");
        const result = await modal.result;
        expect(result).toBe(false);

        // Second close should not throw
        modal.onClose();
    });

    it("updates progress text on CRAWL_PAGE", async () => {
        const app = new App();
        const plugin = makePlugin();
        plugin.api.crawl.mockReturnValue((async function* () {
            yield { event: SSE_EVENT.CRAWL_PAGE, data: { url: "https://example.com/page1" } };
            yield { event: SSE_EVENT.CRAWL_DONE, data: { pages_crawled: 1 } };
        })());
        const modal = new CrawlModal(app as any, plugin as any);
        modal.onOpen();

        const el = modal.contentEl as unknown as MockElement;
        const urlInput = el.find("lilbee-crawl-url")!;
        (urlInput as any).value = "https://example.com";
        const crawlBtn = findButtons(el).find(b => b.textContent === "Crawl")!;
        crawlBtn.trigger("click");
        await tick();

        await modal.result;
    });

    it("CRAWL_DONE without pages_crawled uses local pageCount", async () => {
        const app = new App();
        const plugin = makePlugin();
        plugin.api.crawl.mockReturnValue((async function* () {
            yield { event: SSE_EVENT.CRAWL_PAGE, data: { url: "https://example.com/p1" } };
            yield { event: SSE_EVENT.CRAWL_DONE, data: {} };
        })());
        const modal = new CrawlModal(app as any, plugin as any);
        modal.onOpen();

        const el = modal.contentEl as unknown as MockElement;
        const urlInput = el.find("lilbee-crawl-url")!;
        (urlInput as any).value = "https://example.com";
        const crawlBtn = findButtons(el).find(b => b.textContent === "Crawl")!;
        crawlBtn.trigger("click");
        await tick();

        const result = await modal.result;
        expect(result).toBe(true);
        expect(Notice.instances.some(n => n.message.includes("1 pages"))).toBe(true);
    });

    it("CRAWL_ERROR without message shows unknown", async () => {
        const app = new App();
        const plugin = makePlugin();
        plugin.api.crawl.mockReturnValue((async function* () {
            yield { event: SSE_EVENT.CRAWL_ERROR, data: {} };
        })());
        const modal = new CrawlModal(app as any, plugin as any);
        modal.onOpen();

        const el = modal.contentEl as unknown as MockElement;
        const urlInput = el.find("lilbee-crawl-url")!;
        (urlInput as any).value = "https://example.com";
        const crawlBtn = findButtons(el).find(b => b.textContent === "Crawl")!;
        crawlBtn.trigger("click");
        await tick();

        const result = await modal.result;
        expect(result).toBe(false);
        expect(Notice.instances.some(n => n.message.includes("unknown"))).toBe(true);
    });

    it("handles non-Error throw in executeCrawl", async () => {
        const app = new App();
        const plugin = makePlugin();
        plugin.api.crawl.mockReturnValue((async function* () {
            throw "string error";
        })());
        const modal = new CrawlModal(app as any, plugin as any);
        modal.onOpen();

        const el = modal.contentEl as unknown as MockElement;
        const urlInput = el.find("lilbee-crawl-url")!;
        (urlInput as any).value = "https://example.com";
        const crawlBtn = findButtons(el).find(b => b.textContent === "Crawl")!;
        crawlBtn.trigger("click");
        await tick();

        const result = await modal.result;
        expect(result).toBe(false);
        expect(Notice.instances.some(n => n.message.includes("unknown error"))).toBe(true);
    });

    it("CRAWL_PAGE with missing url uses empty string fallback", async () => {
        const app = new App();
        const plugin = makePlugin();
        plugin.api.crawl.mockReturnValue((async function* () {
            yield { event: SSE_EVENT.CRAWL_PAGE, data: {} };
            yield { event: SSE_EVENT.CRAWL_DONE, data: { pages_crawled: 1 } };
        })());
        const modal = new CrawlModal(app as any, plugin as any);
        modal.onOpen();

        const el = modal.contentEl as unknown as MockElement;
        const urlInput = el.find("lilbee-crawl-url")!;
        (urlInput as any).value = "https://example.com";
        const crawlBtn = findButtons(el).find(b => b.textContent === "Crawl")!;
        crawlBtn.trigger("click");
        await tick();

        await modal.result;
    });

    it("uses default maxPages when input is invalid", async () => {
        const app = new App();
        const plugin = makePlugin();
        plugin.api.crawl.mockReturnValue((async function* () {
            yield { event: SSE_EVENT.CRAWL_DONE, data: { pages_crawled: 0 } };
        })());
        const modal = new CrawlModal(app as any, plugin as any);
        modal.onOpen();

        const el = modal.contentEl as unknown as MockElement;
        const urlInput = el.find("lilbee-crawl-url")!;
        (urlInput as any).value = "https://example.com";
        const depthInput = el.find("lilbee-crawl-depth")!;
        (depthInput as any).value = "abc";
        const maxPagesInput = el.find("lilbee-crawl-max-pages")!;
        (maxPagesInput as any).value = "xyz";

        const crawlBtn = findButtons(el).find(b => b.textContent === "Crawl")!;
        crawlBtn.trigger("click");
        await tick();

        expect(plugin.api.crawl).toHaveBeenCalledWith("https://example.com", 0, 50, expect.any(AbortSignal));
        await modal.result;
    });

    it("passes custom depth and maxPages", async () => {
        const app = new App();
        const plugin = makePlugin();
        plugin.api.crawl.mockReturnValue((async function* () {
            yield { event: SSE_EVENT.CRAWL_DONE, data: { pages_crawled: 0 } };
        })());
        const modal = new CrawlModal(app as any, plugin as any);
        modal.onOpen();

        const el = modal.contentEl as unknown as MockElement;
        const urlInput = el.find("lilbee-crawl-url")!;
        (urlInput as any).value = "https://example.com";
        const depthInput = el.find("lilbee-crawl-depth")!;
        (depthInput as any).value = "2";
        const maxPagesInput = el.find("lilbee-crawl-max-pages")!;
        (maxPagesInput as any).value = "10";

        const crawlBtn = findButtons(el).find(b => b.textContent === "Crawl")!;
        crawlBtn.trigger("click");
        await tick();

        expect(plugin.api.crawl).toHaveBeenCalledWith("https://example.com", 2, 10, expect.any(AbortSignal));
        await modal.result;
    });
});
