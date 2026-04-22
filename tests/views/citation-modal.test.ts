import { vi, describe, it, expect } from "vitest";
import { App } from "obsidian";
import { MockElement } from "../__mocks__/obsidian";
import type { Source } from "../../src/types";

const previewOpens: Array<{ source: Source }> = [];
vi.mock("../../src/views/source-preview-modal", () => ({
    SourcePreviewModal: vi.fn().mockImplementation((_app: unknown, _api: unknown, source: Source) => ({
        open: () => {
            previewOpens.push({ source });
        },
    })),
}));

import { CitationModal } from "../../src/views/citation-modal";

function makePlugin() {
    return {
        api: {
            wikiCitations: vi.fn(),
        },
        app: {
            workspace: {
                openLinkText: vi.fn(),
            },
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

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("CitationModal", () => {
    it("renders title and loading state on open", () => {
        const app = new App();
        const plugin = makePlugin();
        const modal = new CitationModal(app as any, plugin as any, "test-slug");
        modal.onOpen();

        const el = modal.contentEl as unknown as MockElement;
        const texts = collectTexts(el);
        expect(texts.some((t) => t.includes("Citation provenance"))).toBe(true);
        expect(el.find("lilbee-loading")).not.toBeNull();
    });

    it("loads and renders citations on success", async () => {
        const app = new App();
        const plugin = makePlugin();
        plugin.api.wikiCitations.mockResolvedValue({
            wiki_page: "Test Page",
            citations: [
                {
                    citation_key: "key1",
                    claim_type: "fact",
                    source_filename: "source.md",
                    source_hash: "abc123",
                    page_start: null,
                    page_end: null,
                    line_start: null,
                    line_end: null,
                    excerpt: "Some excerpt",
                    created_at: "2025-01-01",
                },
            ],
        });
        const modal = new CitationModal(app as any, plugin as any, "test-slug");
        modal.onOpen();
        await tick();

        const el = modal.contentEl as unknown as MockElement;
        expect(el.find("lilbee-loading")).toBeNull();
        const texts = collectTexts(el);
        expect(texts.some((t) => t.includes("Test Page"))).toBe(true);
        expect(texts.some((t) => t.includes("key1"))).toBe(true);
        expect(texts.some((t) => t.includes("fact"))).toBe(true);
        expect(texts.some((t) => t.includes("Some excerpt"))).toBe(true);
        expect(texts.some((t) => t.includes("current"))).toBe(true);
    });

    it("renders empty state when citations array is empty", async () => {
        const app = new App();
        const plugin = makePlugin();
        plugin.api.wikiCitations.mockResolvedValue({
            wiki_page: "Empty Page",
            citations: [],
        });
        const modal = new CitationModal(app as any, plugin as any, "test-slug");
        modal.onOpen();
        await tick();

        const el = modal.contentEl as unknown as MockElement;
        const texts = collectTexts(el);
        expect(texts.some((t) => t.includes("No citations found."))).toBe(true);
    });

    it("renders error state when api throws", async () => {
        const app = new App();
        const plugin = makePlugin();
        plugin.api.wikiCitations.mockRejectedValue(new Error("network error"));
        const modal = new CitationModal(app as any, plugin as any, "test-slug");
        modal.onOpen();
        await tick();

        const el = modal.contentEl as unknown as MockElement;
        expect(el.find("lilbee-loading")).toBeNull();
        const texts = collectTexts(el);
        expect(texts.some((t) => t.includes("Failed to load citations."))).toBe(true);
    });

    it("empties content on close", () => {
        const app = new App();
        const plugin = makePlugin();
        const modal = new CitationModal(app as any, plugin as any, "test-slug");
        modal.onOpen();
        modal.onClose();

        const el = modal.contentEl as unknown as MockElement;
        expect(el.children.length).toBe(0);
    });

    it("renders inference badge for claim_type inference", async () => {
        const app = new App();
        const plugin = makePlugin();
        plugin.api.wikiCitations.mockResolvedValue({
            wiki_page: "Page",
            citations: [
                {
                    citation_key: "inf1",
                    claim_type: "inference",
                    source_filename: "source.md",
                    source_hash: "abc",
                    page_start: null,
                    page_end: null,
                    line_start: null,
                    line_end: null,
                    excerpt: "",
                    created_at: "2025-01-01",
                },
            ],
        });
        const modal = new CitationModal(app as any, plugin as any, "slug");
        modal.onOpen();
        await tick();

        const el = modal.contentEl as unknown as MockElement;
        const badge = el.find("lilbee-claim-inference");
        expect(badge).not.toBeNull();
        expect(badge!.textContent).toBe("inference");
    });

    it("renders page range when page_start and page_end differ", async () => {
        const app = new App();
        const plugin = makePlugin();
        plugin.api.wikiCitations.mockResolvedValue({
            wiki_page: "Page",
            citations: [
                {
                    citation_key: "k",
                    claim_type: "fact",
                    source_filename: "s.md",
                    source_hash: "h",
                    page_start: 1,
                    page_end: 3,
                    line_start: null,
                    line_end: null,
                    excerpt: "",
                    created_at: "2025-01-01",
                },
            ],
        });
        const modal = new CitationModal(app as any, plugin as any, "slug");
        modal.onOpen();
        await tick();

        const el = modal.contentEl as unknown as MockElement;
        const loc = el.find("lilbee-location");
        expect(loc).not.toBeNull();
        expect(loc!.textContent).toBe("pp. 1\u20133");
    });

    it("renders single page when page_start equals page_end", async () => {
        const app = new App();
        const plugin = makePlugin();
        plugin.api.wikiCitations.mockResolvedValue({
            wiki_page: "Page",
            citations: [
                {
                    citation_key: "k",
                    claim_type: "fact",
                    source_filename: "s.md",
                    source_hash: "h",
                    page_start: 5,
                    page_end: 5,
                    line_start: null,
                    line_end: null,
                    excerpt: "",
                    created_at: "2025-01-01",
                },
            ],
        });
        const modal = new CitationModal(app as any, plugin as any, "slug");
        modal.onOpen();
        await tick();

        const el = modal.contentEl as unknown as MockElement;
        const loc = el.find("lilbee-location");
        expect(loc).not.toBeNull();
        expect(loc!.textContent).toBe("p. 5");
    });

    it("renders line range when line_start and line_end differ", async () => {
        const app = new App();
        const plugin = makePlugin();
        plugin.api.wikiCitations.mockResolvedValue({
            wiki_page: "Page",
            citations: [
                {
                    citation_key: "k",
                    claim_type: "fact",
                    source_filename: "s.md",
                    source_hash: "h",
                    page_start: null,
                    page_end: null,
                    line_start: 10,
                    line_end: 20,
                    excerpt: "",
                    created_at: "2025-01-01",
                },
            ],
        });
        const modal = new CitationModal(app as any, plugin as any, "slug");
        modal.onOpen();
        await tick();

        const el = modal.contentEl as unknown as MockElement;
        const loc = el.find("lilbee-location");
        expect(loc).not.toBeNull();
        expect(loc!.textContent).toBe("lines 10\u201320");
    });

    it("renders single line when line_start equals line_end", async () => {
        const app = new App();
        const plugin = makePlugin();
        plugin.api.wikiCitations.mockResolvedValue({
            wiki_page: "Page",
            citations: [
                {
                    citation_key: "k",
                    claim_type: "fact",
                    source_filename: "s.md",
                    source_hash: "h",
                    page_start: null,
                    page_end: null,
                    line_start: 7,
                    line_end: 7,
                    excerpt: "",
                    created_at: "2025-01-01",
                },
            ],
        });
        const modal = new CitationModal(app as any, plugin as any, "slug");
        modal.onOpen();
        await tick();

        const el = modal.contentEl as unknown as MockElement;
        const loc = el.find("lilbee-location");
        expect(loc).not.toBeNull();
        expect(loc!.textContent).toBe("line 7");
    });

    it("does not render location when both page_start and line_start are null", async () => {
        const app = new App();
        const plugin = makePlugin();
        plugin.api.wikiCitations.mockResolvedValue({
            wiki_page: "Page",
            citations: [
                {
                    citation_key: "k",
                    claim_type: "fact",
                    source_filename: "s.md",
                    source_hash: "h",
                    page_start: null,
                    page_end: null,
                    line_start: null,
                    line_end: null,
                    excerpt: "",
                    created_at: "2025-01-01",
                },
            ],
        });
        const modal = new CitationModal(app as any, plugin as any, "slug");
        modal.onOpen();
        await tick();

        const el = modal.contentEl as unknown as MockElement;
        expect(el.find("lilbee-location")).toBeNull();
    });

    it("renders excerpt blockquote when excerpt is present", async () => {
        const app = new App();
        const plugin = makePlugin();
        plugin.api.wikiCitations.mockResolvedValue({
            wiki_page: "Page",
            citations: [
                {
                    citation_key: "k",
                    claim_type: "fact",
                    source_filename: "s.md",
                    source_hash: "h",
                    page_start: null,
                    page_end: null,
                    line_start: null,
                    line_end: null,
                    excerpt: "Important text here",
                    created_at: "2025-01-01",
                },
            ],
        });
        const modal = new CitationModal(app as any, plugin as any, "slug");
        modal.onOpen();
        await tick();

        const el = modal.contentEl as unknown as MockElement;
        const excerpt = el.find("lilbee-citation-excerpt");
        expect(excerpt).not.toBeNull();
        expect(excerpt!.textContent).toBe("Important text here");
    });

    it("does not render excerpt when excerpt is empty", async () => {
        const app = new App();
        const plugin = makePlugin();
        plugin.api.wikiCitations.mockResolvedValue({
            wiki_page: "Page",
            citations: [
                {
                    citation_key: "k",
                    claim_type: "fact",
                    source_filename: "s.md",
                    source_hash: "h",
                    page_start: null,
                    page_end: null,
                    line_start: null,
                    line_end: null,
                    excerpt: "",
                    created_at: "2025-01-01",
                },
            ],
        });
        const modal = new CitationModal(app as any, plugin as any, "slug");
        modal.onOpen();
        await tick();

        const el = modal.contentEl as unknown as MockElement;
        expect(el.find("lilbee-citation-excerpt")).toBeNull();
    });

    it("renders stale status when source_hash is falsy", async () => {
        const app = new App();
        const plugin = makePlugin();
        plugin.api.wikiCitations.mockResolvedValue({
            wiki_page: "Page",
            citations: [
                {
                    citation_key: "k",
                    claim_type: "fact",
                    source_filename: "s.md",
                    source_hash: "",
                    page_start: null,
                    page_end: null,
                    line_start: null,
                    line_end: null,
                    excerpt: "",
                    created_at: "2025-01-01",
                },
            ],
        });
        const modal = new CitationModal(app as any, plugin as any, "slug");
        modal.onOpen();
        await tick();

        const el = modal.contentEl as unknown as MockElement;
        const status = el.find("lilbee-hash-stale");
        expect(status).not.toBeNull();
        expect(status!.textContent).toBe("stale");
        expect(el.find("lilbee-hash-current")).toBeNull();
    });

    it("renders current status when source_hash is truthy", async () => {
        const app = new App();
        const plugin = makePlugin();
        plugin.api.wikiCitations.mockResolvedValue({
            wiki_page: "Page",
            citations: [
                {
                    citation_key: "k",
                    claim_type: "fact",
                    source_filename: "s.md",
                    source_hash: "abc123",
                    page_start: null,
                    page_end: null,
                    line_start: null,
                    line_end: null,
                    excerpt: "",
                    created_at: "2025-01-01",
                },
            ],
        });
        const modal = new CitationModal(app as any, plugin as any, "slug");
        modal.onOpen();
        await tick();

        const el = modal.contentEl as unknown as MockElement;
        const status = el.find("lilbee-hash-current");
        expect(status).not.toBeNull();
        expect(status!.textContent).toBe("current");
    });

    it("source link click dispatches through executeSourceClick — preview for non-vault source", async () => {
        previewOpens.length = 0;
        const app = new App();
        const plugin = makePlugin();
        plugin.api.wikiCitations.mockResolvedValue({
            wiki_page: "Page",
            citations: [
                {
                    citation_key: "k",
                    claim_type: "fact",
                    source_filename: "notes/source.md",
                    source_hash: "h",
                    page_start: null,
                    page_end: null,
                    line_start: null,
                    line_end: null,
                    excerpt: "",
                    created_at: "2025-01-01",
                },
            ],
        });
        const modal = new CitationModal(app as any, plugin as any, "slug");
        modal.onOpen();
        await tick();

        const el = modal.contentEl as unknown as MockElement;
        const link = el.find("lilbee-document-source");
        expect(link).not.toBeNull();
        expect(link!.textContent).toBe("notes/source.md");

        const preventDefault = vi.fn();
        link!.trigger("click", { preventDefault });

        expect(preventDefault).toHaveBeenCalled();
        // No vault_path on citations yet → preview modal path.
        expect(app.workspace.openLinkText).not.toHaveBeenCalled();
        expect(previewOpens).toHaveLength(1);
        expect(previewOpens[0].source.source).toBe("notes/source.md");
    });
});
