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

function openModal() {
    const app = new App();
    const plugin = makePlugin();
    const modal = new CrawlModal(app as any, plugin as any);
    modal.onOpen();
    const el = modal.contentEl as unknown as MockElement;
    return { app, plugin, modal, el };
}

function setUrl(el: MockElement, value: string): void {
    (el.find("lilbee-crawl-url") as any).value = value;
}

function clickCrawl(el: MockElement): void {
    findButtons(el)
        .find((b) => b.textContent === "Crawl")!
        .trigger("click");
}

describe("CrawlModal", () => {
    beforeEach(() => {
        Notice.clear();
    });

    it("renders title, URL input, Recursive checkbox, info button, and buttons on open", () => {
        const { el } = openModal();
        const texts = collectTexts(el);
        expect(texts.some((t) => t.includes("Crawl web page"))).toBe(true);
        expect(el.find("lilbee-crawl-url")).not.toBeNull();
        const recursive = el.find("lilbee-crawl-recursive-input") as any;
        expect(recursive).not.toBeNull();
        expect(recursive.checked).toBe(true);
        const row = el.find("lilbee-crawl-recursive-row");
        expect(row).not.toBeNull();
        const info = el.find("lilbee-crawl-info-btn")!;
        expect(info).not.toBeNull();
        expect(info.attributes["aria-label"]).toBe("About whole-site crawl");
        expect(info.attributes["aria-expanded"]).toBe("false");
        const buttons = findButtons(el);
        expect(buttons.some((b) => b.textContent === "Crawl")).toBe(true);
        expect(buttons.some((b) => b.textContent === "Cancel")).toBe(true);
    });

    it("whole-site disclaimer notice is hidden by default", () => {
        const { el } = openModal();
        const notice = el.find("lilbee-crawl-notice")!;
        expect(notice).not.toBeNull();
        expect(notice.attributes["hidden"]).toBe("hidden");
        expect(notice.textContent).toContain("Whole-site crawl");
    });

    it("clicking the info button reveals the disclaimer and toggles aria-expanded", () => {
        const { el } = openModal();
        const info = el.find("lilbee-crawl-info-btn")!;
        const notice = el.find("lilbee-crawl-notice")!;
        expect(notice.attributes["hidden"]).toBe("hidden");
        info.trigger("click");
        expect(notice.attributes["hidden"]).toBeUndefined();
        expect(info.attributes["aria-expanded"]).toBe("true");
        info.trigger("click");
        expect(notice.attributes["hidden"]).toBe("hidden");
        expect(info.attributes["aria-expanded"]).toBe("false");
    });

    it("hides the info button and disclaimer when Recursive is off", () => {
        const { el } = openModal();
        const recursive = el.find("lilbee-crawl-recursive-input") as any;
        const info = el.find("lilbee-crawl-info-btn")!;
        const notice = el.find("lilbee-crawl-notice")!;

        info.trigger("click");
        expect(notice.attributes["hidden"]).toBeUndefined();

        recursive.checked = false;
        recursive.trigger("change");
        expect(info.style.display).toBe("none");
        expect(notice.attributes["hidden"]).toBe("hidden");

        recursive.checked = true;
        recursive.trigger("change");
        expect(info.style.display).toBe("");
    });

    it("defaults depth and max-pages inputs to blank", () => {
        const { el } = openModal();
        const depth = el.find("lilbee-crawl-depth");
        const maxPages = el.find("lilbee-crawl-max-pages");
        expect(depth).not.toBeNull();
        expect(maxPages).not.toBeNull();
        expect((depth as any).value).toBe("");
        expect((maxPages as any).value).toBe("");
    });

    it("hides depth/max inside a <details> Advanced disclosure", () => {
        const { el } = openModal();
        const advanced = el.find("lilbee-crawl-advanced");
        expect(advanced).not.toBeNull();
        expect((advanced as any).tagName).toBe("DETAILS");
        expect(advanced!.findAll("lilbee-crawl-depth")).toHaveLength(1);
        expect(advanced!.findAll("lilbee-crawl-max-pages")).toHaveLength(1);
    });

    it("disables depth and max-pages when Recursive is unchecked, re-enables when re-checked", () => {
        const { el } = openModal();
        const recursive = el.find("lilbee-crawl-recursive-input") as any;
        const depth = el.find("lilbee-crawl-depth") as any;
        const maxPages = el.find("lilbee-crawl-max-pages") as any;
        expect(depth.disabled).toBe(false);
        expect(maxPages.disabled).toBe(false);

        recursive.checked = false;
        recursive.trigger("change");
        expect(depth.disabled).toBe(true);
        expect(maxPages.disabled).toBe(true);

        recursive.checked = true;
        recursive.trigger("change");
        expect(depth.disabled).toBe(false);
        expect(maxPages.disabled).toBe(false);
    });

    it("Cancel closes the modal", () => {
        const { modal, el } = openModal();
        const closeSpy = vi.spyOn(modal, "close");
        const cancelBtn = findButtons(el).find((b) => b.textContent === "Cancel")!;
        cancelBtn.trigger("click");
        expect(closeSpy).toHaveBeenCalled();
    });

    it("shows notice when URL is empty", () => {
        const { plugin, el } = openModal();
        setUrl(el, "");
        clickCrawl(el);
        expect(Notice.instances.some((n) => n.message.includes("please enter a URL"))).toBe(true);
        expect(plugin.runCrawl).not.toHaveBeenCalled();
    });

    it("Recursive on + Advanced blank → sends (null, null)", () => {
        const { plugin, modal, el } = openModal();
        const closeSpy = vi.spyOn(modal, "close");
        setUrl(el, "https://example.com");
        clickCrawl(el);
        expect(plugin.runCrawl).toHaveBeenCalledWith("https://example.com", null, null);
        expect(closeSpy).toHaveBeenCalled();
    });

    it("Recursive off → sends (0, null) regardless of Advanced", () => {
        const { plugin, el } = openModal();
        const recursive = el.find("lilbee-crawl-recursive-input") as any;
        recursive.checked = false;
        recursive.trigger("change");
        setUrl(el, "https://example.com");
        clickCrawl(el);
        expect(plugin.runCrawl).toHaveBeenCalledWith("https://example.com", 0, null);
    });

    it("Recursive on + Advanced filled → sends the parsed numbers", () => {
        const { plugin, el } = openModal();
        setUrl(el, "https://example.com");
        (el.find("lilbee-crawl-depth") as any).value = "2";
        (el.find("lilbee-crawl-max-pages") as any).value = "20";
        clickCrawl(el);
        expect(plugin.runCrawl).toHaveBeenCalledWith("https://example.com", 2, 20);
    });

    it("Recursive on + depth only → sends (n, null)", () => {
        const { plugin, el } = openModal();
        setUrl(el, "https://example.com");
        (el.find("lilbee-crawl-depth") as any).value = "3";
        clickCrawl(el);
        expect(plugin.runCrawl).toHaveBeenCalledWith("https://example.com", 3, null);
    });

    it("Recursive on + max only → sends (null, n)", () => {
        const { plugin, el } = openModal();
        setUrl(el, "https://example.com");
        (el.find("lilbee-crawl-max-pages") as any).value = "100";
        clickCrawl(el);
        expect(plugin.runCrawl).toHaveBeenCalledWith("https://example.com", null, 100);
    });

    it("max_pages=0 blocks submit with inline error", () => {
        const { plugin, el } = openModal();
        setUrl(el, "https://example.com");
        (el.find("lilbee-crawl-max-pages") as any).value = "0";
        clickCrawl(el);
        expect(plugin.runCrawl).not.toHaveBeenCalled();
        const err = el.find("lilbee-crawl-error");
        expect(err).not.toBeNull();
        expect(err!.textContent).toContain("Max pages must be a positive integer");
    });

    it("negative depth blocks submit with inline error", () => {
        const { plugin, el } = openModal();
        setUrl(el, "https://example.com");
        (el.find("lilbee-crawl-depth") as any).value = "-5";
        clickCrawl(el);
        expect(plugin.runCrawl).not.toHaveBeenCalled();
        const err = el.find("lilbee-crawl-error");
        expect(err!.textContent).toContain("Depth cap must be a non-negative integer");
    });

    it("negative max_pages blocks submit with inline error", () => {
        const { plugin, el } = openModal();
        setUrl(el, "https://example.com");
        (el.find("lilbee-crawl-max-pages") as any).value = "-1";
        clickCrawl(el);
        expect(plugin.runCrawl).not.toHaveBeenCalled();
        const err = el.find("lilbee-crawl-error");
        expect(err!.textContent).toContain("Max pages must be a positive integer");
    });

    it("non-numeric max_pages blocks submit with inline error", () => {
        const { plugin, el } = openModal();
        setUrl(el, "https://example.com");
        (el.find("lilbee-crawl-max-pages") as any).value = "abc";
        clickCrawl(el);
        expect(plugin.runCrawl).not.toHaveBeenCalled();
        const err = el.find("lilbee-crawl-error");
        expect(err!.textContent).toContain("Max pages must be a positive integer");
    });

    it("non-numeric depth blocks submit with inline error", () => {
        const { plugin, el } = openModal();
        setUrl(el, "https://example.com");
        (el.find("lilbee-crawl-depth") as any).value = "abc";
        clickCrawl(el);
        expect(plugin.runCrawl).not.toHaveBeenCalled();
        const err = el.find("lilbee-crawl-error");
        expect(err!.textContent).toContain("Depth cap must be a non-negative integer");
    });

    it("renders error element outside the Advanced disclosure so it is visible when collapsed", () => {
        const { el } = openModal();
        const advanced = el.find("lilbee-crawl-advanced")!;
        const errorEl = el.find("lilbee-crawl-error")!;
        // errorEl must NOT be a descendant of <details> so it stays visible when the user closes Advanced.
        expect(advanced.findAll("lilbee-crawl-error")).toHaveLength(0);
        expect(errorEl).not.toBeNull();
    });

    it("force-opens Advanced when a validation error fires", () => {
        const { el } = openModal();
        const advanced = el.find("lilbee-crawl-advanced") as any;
        advanced.open = false;
        setUrl(el, "https://example.com");
        (el.find("lilbee-crawl-max-pages") as any).value = "0";
        clickCrawl(el);
        expect(advanced.open).toBe(true);
    });

    it("hides Advanced section when Recursive is unchecked, re-shows when re-checked", () => {
        const { el } = openModal();
        const recursive = el.find("lilbee-crawl-recursive-input") as any;
        const advanced = el.find("lilbee-crawl-advanced") as any;
        // default: recursive ON, advanced visible
        expect(advanced.style.display).toBe("");

        recursive.checked = false;
        recursive.trigger("change");
        expect(advanced.style.display).toBe("none");

        recursive.checked = true;
        recursive.trigger("change");
        expect(advanced.style.display).toBe("");
    });

    it("inline error clears after a successful submit", () => {
        const { plugin, el } = openModal();
        setUrl(el, "https://example.com");
        (el.find("lilbee-crawl-max-pages") as any).value = "0";
        clickCrawl(el);
        const err = el.find("lilbee-crawl-error")!;
        expect(err.textContent).not.toBe("");
        expect(plugin.runCrawl).not.toHaveBeenCalled();
        (el.find("lilbee-crawl-max-pages") as any).value = "5";
        clickCrawl(el);
        expect(plugin.runCrawl).toHaveBeenCalledWith("https://example.com", null, 5);
        expect(err.textContent).toBe("");
    });

    it("prepends https:// when URL has no scheme", () => {
        const { plugin, el } = openModal();
        setUrl(el, "example.com");
        clickCrawl(el);
        expect(plugin.runCrawl).toHaveBeenCalledWith("https://example.com", null, null);
    });

    it("preserves http:// when already present", () => {
        const { plugin, el } = openModal();
        setUrl(el, "http://example.com");
        clickCrawl(el);
        expect(plugin.runCrawl).toHaveBeenCalledWith("http://example.com", null, null);
    });

    it("Recursive on + depth=0 → sends (0, null) (seed-only with recursive on is still valid)", () => {
        const { plugin, el } = openModal();
        setUrl(el, "https://example.com");
        (el.find("lilbee-crawl-depth") as any).value = "0";
        clickCrawl(el);
        expect(plugin.runCrawl).toHaveBeenCalledWith("https://example.com", 0, null);
    });
});
