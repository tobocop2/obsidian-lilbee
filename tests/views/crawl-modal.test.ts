import { vi, describe, it, expect, beforeEach } from "vitest";
import { App, Notice } from "obsidian";
import { MockElement } from "../__mocks__/obsidian";
import { CrawlModal } from "../../src/views/crawl-modal";

function makePlugin() {
    return {
        runCrawl: vi.fn(),
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
        expect(texts.some((t) => t.includes("Crawl web page"))).toBe(true);
        expect(el.find("lilbee-crawl-url")).not.toBeNull();
        const buttons = findButtons(el);
        expect(buttons.some((b) => b.textContent === "Crawl")).toBe(true);
        expect(buttons.some((b) => b.textContent === "Cancel")).toBe(true);
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

    it("Cancel closes the modal", () => {
        const app = new App();
        const plugin = makePlugin();
        const modal = new CrawlModal(app as any, plugin as any);
        const closeSpy = vi.spyOn(modal, "close");
        modal.onOpen();

        const el = modal.contentEl as unknown as MockElement;
        const cancelBtn = findButtons(el).find((b) => b.textContent === "Cancel")!;
        cancelBtn.trigger("click");

        expect(closeSpy).toHaveBeenCalled();
    });

    it("shows notice when URL is empty", () => {
        const app = new App();
        const plugin = makePlugin();
        const modal = new CrawlModal(app as any, plugin as any);
        modal.onOpen();

        const el = modal.contentEl as unknown as MockElement;
        const urlInput = el.find("lilbee-crawl-url")!;
        (urlInput as any).value = "";
        const crawlBtn = findButtons(el).find((b) => b.textContent === "Crawl")!;
        crawlBtn.trigger("click");

        expect(Notice.instances.some((n) => n.message.includes("please enter a URL"))).toBe(true);
        expect(plugin.runCrawl).not.toHaveBeenCalled();
    });

    it("calls plugin.runCrawl and closes modal on submit", () => {
        const app = new App();
        const plugin = makePlugin();
        const modal = new CrawlModal(app as any, plugin as any);
        const closeSpy = vi.spyOn(modal, "close");
        modal.onOpen();

        const el = modal.contentEl as unknown as MockElement;
        const urlInput = el.find("lilbee-crawl-url")!;
        (urlInput as any).value = "https://example.com";
        const crawlBtn = findButtons(el).find((b) => b.textContent === "Crawl")!;
        crawlBtn.trigger("click");

        expect(plugin.runCrawl).toHaveBeenCalledWith("https://example.com", 0, 50);
        expect(closeSpy).toHaveBeenCalled();
    });

    it("uses default maxPages when input is invalid", () => {
        const app = new App();
        const plugin = makePlugin();
        const modal = new CrawlModal(app as any, plugin as any);
        modal.onOpen();

        const el = modal.contentEl as unknown as MockElement;
        const urlInput = el.find("lilbee-crawl-url")!;
        (urlInput as any).value = "https://example.com";
        const depthInput = el.find("lilbee-crawl-depth")!;
        (depthInput as any).value = "abc";
        const maxPagesInput = el.find("lilbee-crawl-max-pages")!;
        (maxPagesInput as any).value = "xyz";

        const crawlBtn = findButtons(el).find((b) => b.textContent === "Crawl")!;
        crawlBtn.trigger("click");

        expect(plugin.runCrawl).toHaveBeenCalledWith("https://example.com", 0, 50);
    });

    it("passes custom depth and maxPages", () => {
        const app = new App();
        const plugin = makePlugin();
        const modal = new CrawlModal(app as any, plugin as any);
        modal.onOpen();

        const el = modal.contentEl as unknown as MockElement;
        const urlInput = el.find("lilbee-crawl-url")!;
        (urlInput as any).value = "https://example.com";
        const depthInput = el.find("lilbee-crawl-depth")!;
        (depthInput as any).value = "2";
        const maxPagesInput = el.find("lilbee-crawl-max-pages")!;
        (maxPagesInput as any).value = "10";

        const crawlBtn = findButtons(el).find((b) => b.textContent === "Crawl")!;
        crawlBtn.trigger("click");

        expect(plugin.runCrawl).toHaveBeenCalledWith("https://example.com", 2, 10);
    });
});
