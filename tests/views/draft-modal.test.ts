import { vi, describe, it, expect, beforeEach } from "vitest";
import { App } from "obsidian";
import { MockElement } from "../__mocks__/obsidian";
import { DraftModal } from "../../src/views/draft-modal";
import type { WikiDraft } from "../../src/types";

const tick = () => new Promise((r) => setTimeout(r, 0));

function makePlugin() {
    return {
        api: {
            wikiDrafts: vi.fn(),
            wikiPage: vi.fn(),
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

const DRAFT: WikiDraft = {
    slug: "test-page",
    title: "Test Page",
    faithfulness_score: 0.85,
    generated_at: "2026-01-15T10:30:00Z",
    failure_reason: "low coverage",
};

describe("DraftModal", () => {
    let app: App;
    let plugin: ReturnType<typeof makePlugin>;

    beforeEach(() => {
        app = new App();
        plugin = makePlugin();
    });

    it("renders title and loading on open", () => {
        const modal = new DraftModal(app as any, plugin as any);
        modal.onOpen();

        const el = modal.contentEl as unknown as MockElement;
        const texts = collectTexts(el);
        expect(texts.some((t) => t.includes("Draft pages"))).toBe(true);
        expect(el.find("lilbee-loading")).not.toBeNull();
    });

    it("loads and renders drafts on success", async () => {
        plugin.api.wikiDrafts.mockResolvedValue([DRAFT]);
        const modal = new DraftModal(app as any, plugin as any);
        modal.onOpen();
        await tick();

        const el = modal.contentEl as unknown as MockElement;
        expect(el.find("lilbee-loading")).toBeNull();
        expect(el.find("lilbee-draft-item")).not.toBeNull();
    });

    it("shows empty state when no drafts", async () => {
        plugin.api.wikiDrafts.mockResolvedValue([]);
        const modal = new DraftModal(app as any, plugin as any);
        modal.onOpen();
        await tick();

        const el = modal.contentEl as unknown as MockElement;
        const texts = collectTexts(el);
        expect(texts.some((t) => t.includes("No draft pages"))).toBe(true);
        expect(el.find("lilbee-empty-state")).not.toBeNull();
    });

    it("shows error state on loadDrafts failure", async () => {
        plugin.api.wikiDrafts.mockRejectedValue(new Error("network"));
        const modal = new DraftModal(app as any, plugin as any);
        modal.onOpen();
        await tick();

        const el = modal.contentEl as unknown as MockElement;
        const texts = collectTexts(el);
        expect(texts.some((t) => t.includes("Failed to load drafts."))).toBe(true);
        expect(el.find("lilbee-loading")).toBeNull();
    });

    it("empties content on close", () => {
        const modal = new DraftModal(app as any, plugin as any);
        modal.onOpen();
        modal.onClose();

        const el = modal.contentEl as unknown as MockElement;
        expect(el.children.length).toBe(0);
    });

    it("renders draft with title, score, reason, and timestamp", async () => {
        plugin.api.wikiDrafts.mockResolvedValue([DRAFT]);
        const modal = new DraftModal(app as any, plugin as any);
        modal.onOpen();
        await tick();

        const el = modal.contentEl as unknown as MockElement;
        const texts = collectTexts(el);

        expect(texts.some((t) => t === "Test Page")).toBe(true);
        expect(texts.some((t) => t.includes("Score") && t.includes("85%"))).toBe(true);
        expect(texts.some((t) => t.includes("Reason") && t.includes("low coverage"))).toBe(true);

        const timeStr = new Date("2026-01-15T10:30:00Z").toLocaleString();
        expect(texts.some((t) => t === timeStr)).toBe(true);

        expect(el.find("lilbee-draft-score")).not.toBeNull();
        expect(el.find("lilbee-draft-reason")).not.toBeNull();
        expect(el.find("lilbee-task-time")).not.toBeNull();
    });

    it("expand button click triggers loadDraftContent", async () => {
        plugin.api.wikiDrafts.mockResolvedValue([DRAFT]);
        plugin.api.wikiPage.mockResolvedValue({ content: "page body" });
        const modal = new DraftModal(app as any, plugin as any);
        modal.onOpen();
        await tick();

        const el = modal.contentEl as unknown as MockElement;
        const expandBtn = findButtons(el).find((b) => b.textContent === "Show content");
        expect(expandBtn).not.toBeUndefined();

        expandBtn!.trigger("click");
        await tick();

        expect(plugin.api.wikiPage).toHaveBeenCalledWith("test-page");
    });

    it("loadDraftContent success renders pre with content", async () => {
        plugin.api.wikiDrafts.mockResolvedValue([DRAFT]);
        plugin.api.wikiPage.mockResolvedValue({ content: "wiki content here" });
        const modal = new DraftModal(app as any, plugin as any);
        modal.onOpen();
        await tick();

        const el = modal.contentEl as unknown as MockElement;
        const expandBtn = findButtons(el).find((b) => b.textContent === "Show content");
        expandBtn!.trigger("click");
        await tick();

        const texts = collectTexts(el);
        expect(texts.some((t) => t === "wiki content here")).toBe(true);
        expect(el.find("lilbee-wiki-content")).not.toBeNull();
        // Button should be removed
        expect(findButtons(el).find((b) => b.textContent === "Show content")).toBeUndefined();
    });

    it("loadDraftContent failure shows error message", async () => {
        plugin.api.wikiDrafts.mockResolvedValue([DRAFT]);
        plugin.api.wikiPage.mockRejectedValue(new Error("not found"));
        const modal = new DraftModal(app as any, plugin as any);
        modal.onOpen();
        await tick();

        const el = modal.contentEl as unknown as MockElement;
        const expandBtn = findButtons(el).find((b) => b.textContent === "Show content");
        expandBtn!.trigger("click");
        await tick();

        const texts = collectTexts(el);
        expect(texts.some((t) => t.includes("Failed to load content."))).toBe(true);
        expect(el.find("lilbee-loading")).toBeNull();
    });
});
