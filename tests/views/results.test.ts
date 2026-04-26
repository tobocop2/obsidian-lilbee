import { vi, describe, it, expect } from "vitest";
import { App, MockElement } from "../__mocks__/obsidian";
import type { DocumentResult, Source } from "../../src/types";
import type { LilbeeClient } from "../../src/api";

// Capture SourcePreviewModal opens so we can assert preview dispatch without
// depending on the real modal's DOM structure.
const previewOpens: Array<{ source: Source }> = [];
vi.mock("../../src/views/source-preview-modal", () => ({
    SourcePreviewModal: vi.fn().mockImplementation((_app: unknown, _api: unknown, source: Source) => ({
        open: () => {
            previewOpens.push({ source });
        },
    })),
}));

import { renderDocumentResult, renderSourceChip } from "../../src/views/results";

function makeContainer(): MockElement {
    return new MockElement("div");
}

function makeApp(): App {
    return new App();
}

function makeApi(): LilbeeClient {
    return { getSource: vi.fn(), getSourceRaw: vi.fn() } as unknown as LilbeeClient;
}

function makeDocumentResult(overrides: Partial<DocumentResult> = {}): DocumentResult {
    return {
        source: "notes/foo.md",
        content_type: "markdown",
        excerpts: [],
        best_relevance: 0.75,
        ...overrides,
    };
}

function makeExcerpt(
    content: string,
    page_start: number | null = null,
    page_end: number | null = null,
    line_start: number | null = null,
    line_end: number | null = null,
) {
    return { content, page_start, page_end, line_start, line_end, relevance: 0.8 };
}

describe("renderDocumentResult — card structure", () => {
    it("creates a card div with the correct class", () => {
        const container = makeContainer();
        renderDocumentResult(container as unknown as HTMLElement, makeDocumentResult(), makeApp(), makeApi());
        const card = container.find("lilbee-document-card");
        expect(card).not.toBeNull();
    });

    it("creates a header div inside the card", () => {
        const container = makeContainer();
        renderDocumentResult(container as unknown as HTMLElement, makeDocumentResult(), makeApp(), makeApi());
        const header = container.find("lilbee-document-card-header");
        expect(header).not.toBeNull();
    });

    it("renders the source link with correct text and class", () => {
        const container = makeContainer();
        renderDocumentResult(
            container as unknown as HTMLElement,
            makeDocumentResult({ source: "vault/my-note.md" }),
            makeApp(),
            makeApi(),
        );
        const link = container.find("lilbee-document-source");
        expect(link).not.toBeNull();
        expect(link!.textContent).toBe("vault/my-note.md");
        expect(link!.tagName).toBe("A");
    });

    it("renders the content-type badge with correct text", () => {
        const container = makeContainer();
        renderDocumentResult(
            container as unknown as HTMLElement,
            makeDocumentResult({ content_type: "pdf" }),
            makeApp(),
            makeApi(),
        );
        const badge = container.find("lilbee-content-badge");
        expect(badge).not.toBeNull();
        expect(badge!.textContent).toBe("pdf");
    });

    it("renders a relevance bar container and bar", () => {
        const container = makeContainer();
        renderDocumentResult(container as unknown as HTMLElement, makeDocumentResult(), makeApp(), makeApi());
        expect(container.find("lilbee-relevance-bar-container")).not.toBeNull();
        expect(container.find("lilbee-relevance-bar")).not.toBeNull();
    });
});

describe("renderDocumentResult — relevance bar width", () => {
    it("sets bar width to rounded percentage of best_relevance", () => {
        const container = makeContainer();
        renderDocumentResult(
            container as unknown as HTMLElement,
            makeDocumentResult({ best_relevance: 0.756 }),
            makeApp(),
            makeApi(),
        );
        const bar = container.find("lilbee-relevance-bar")!;
        expect(bar.style["width"]).toBe("76%");
    });

    it("clamps best_relevance > 1 to 100%", () => {
        const container = makeContainer();
        renderDocumentResult(
            container as unknown as HTMLElement,
            makeDocumentResult({ best_relevance: 1.5 }),
            makeApp(),
            makeApi(),
        );
        const bar = container.find("lilbee-relevance-bar")!;
        expect(bar.style["width"]).toBe("100%");
    });

    it("clamps best_relevance < 0 to 0%", () => {
        const container = makeContainer();
        renderDocumentResult(
            container as unknown as HTMLElement,
            makeDocumentResult({ best_relevance: -0.3 }),
            makeApp(),
            makeApi(),
        );
        const bar = container.find("lilbee-relevance-bar")!;
        expect(bar.style["width"]).toBe("0%");
    });

    it("handles best_relevance of exactly 1 → 100%", () => {
        const container = makeContainer();
        renderDocumentResult(
            container as unknown as HTMLElement,
            makeDocumentResult({ best_relevance: 1 }),
            makeApp(),
            makeApi(),
        );
        const bar = container.find("lilbee-relevance-bar")!;
        expect(bar.style["width"]).toBe("100%");
    });

    it("handles best_relevance of exactly 0 → 0%", () => {
        const container = makeContainer();
        renderDocumentResult(
            container as unknown as HTMLElement,
            makeDocumentResult({ best_relevance: 0 }),
            makeApp(),
            makeApi(),
        );
        const bar = container.find("lilbee-relevance-bar")!;
        expect(bar.style["width"]).toBe("0%");
    });
});

describe("renderDocumentResult — source link click", () => {
    it("opens the SourcePreviewModal when result has no vault_path", () => {
        previewOpens.length = 0;
        const container = makeContainer();
        const app = makeApp();
        renderDocumentResult(
            container as unknown as HTMLElement,
            makeDocumentResult({ source: "remote/foo.md" }),
            app,
            makeApi(),
        );
        const link = container.find("lilbee-document-source")!;
        const mockEvent = { preventDefault: vi.fn() };
        link.trigger("click", mockEvent);
        expect(mockEvent.preventDefault).toHaveBeenCalled();
        expect(app.workspace.openLinkText).not.toHaveBeenCalled();
        expect(previewOpens).toHaveLength(1);
        expect(previewOpens[0].source.source).toBe("remote/foo.md");
    });

    it("forwards excerpt location info to the preview source when excerpts are present", () => {
        previewOpens.length = 0;
        const container = makeContainer();
        const app = makeApp();
        renderDocumentResult(
            container as unknown as HTMLElement,
            makeDocumentResult({
                source: "remote/foo.pdf",
                content_type: "application/pdf",
                excerpts: [makeExcerpt("text", 3, 5, 10, 20)],
            }),
            app,
            makeApi(),
        );
        container.find("lilbee-document-source")!.trigger("click", { preventDefault: vi.fn() });
        expect(previewOpens).toHaveLength(1);
        expect(previewOpens[0].source.page_start).toBe(3);
        expect(previewOpens[0].source.page_end).toBe(5);
        expect(previewOpens[0].source.line_start).toBe(10);
        expect(previewOpens[0].source.line_end).toBe(20);
        expect(previewOpens[0].source.chunk).toBe("text");
    });
});

describe("renderDocumentResult — excerpts", () => {
    it("renders no excerpt elements when excerpts array is empty", () => {
        const container = makeContainer();
        renderDocumentResult(
            container as unknown as HTMLElement,
            makeDocumentResult({ excerpts: [] }),
            makeApp(),
            makeApi(),
        );
        expect(container.findAll("lilbee-excerpt")).toHaveLength(0);
    });

    it("renders up to 3 excerpts even when 5 are provided", () => {
        const container = makeContainer();
        const excerpts = [1, 2, 3, 4, 5].map((i) => makeExcerpt(`Excerpt ${i}`));
        renderDocumentResult(
            container as unknown as HTMLElement,
            makeDocumentResult({ excerpts }),
            makeApp(),
            makeApi(),
        );
        expect(container.findAll("lilbee-excerpt")).toHaveLength(3);
    });

    it("renders exactly 3 excerpts when exactly 3 are provided", () => {
        const container = makeContainer();
        const excerpts = [1, 2, 3].map((i) => makeExcerpt(`Excerpt ${i}`));
        renderDocumentResult(
            container as unknown as HTMLElement,
            makeDocumentResult({ excerpts }),
            makeApp(),
            makeApi(),
        );
        expect(container.findAll("lilbee-excerpt")).toHaveLength(3);
    });

    it("renders fewer than 3 excerpts when fewer are provided", () => {
        const container = makeContainer();
        const excerpts = [makeExcerpt("Only one")];
        renderDocumentResult(
            container as unknown as HTMLElement,
            makeDocumentResult({ excerpts }),
            makeApp(),
            makeApi(),
        );
        expect(container.findAll("lilbee-excerpt")).toHaveLength(1);
    });

    it("renders excerpt content as a <p> element", () => {
        const container = makeContainer();
        renderDocumentResult(
            container as unknown as HTMLElement,
            makeDocumentResult({ excerpts: [makeExcerpt("Hello world")] }),
            makeApp(),
            makeApi(),
        );
        const excerptEl = container.find("lilbee-excerpt")!;
        const p = excerptEl.children.find((c) => c.tagName === "P");
        expect(p).toBeDefined();
        expect(p!.textContent).toBe("Hello world");
    });

    it("does NOT render a location span when all location fields are null", () => {
        const container = makeContainer();
        renderDocumentResult(
            container as unknown as HTMLElement,
            makeDocumentResult({ excerpts: [makeExcerpt("No location")] }),
            makeApp(),
            makeApi(),
        );
        const excerptEl = container.find("lilbee-excerpt")!;
        const loc = excerptEl.find("lilbee-location");
        expect(loc).toBeNull();
    });

    it("renders a location span when page_start is set", () => {
        const container = makeContainer();
        renderDocumentResult(
            container as unknown as HTMLElement,
            makeDocumentResult({ excerpts: [makeExcerpt("Has page", 3)] }),
            makeApp(),
            makeApi(),
        );
        const excerptEl = container.find("lilbee-excerpt")!;
        const loc = excerptEl.find("lilbee-location");
        expect(loc).not.toBeNull();
        expect(loc!.textContent).toBe("p. 3");
    });

    it("renders a location span when line_start is set", () => {
        const container = makeContainer();
        renderDocumentResult(
            container as unknown as HTMLElement,
            makeDocumentResult({
                excerpts: [makeExcerpt("Has line", null, null, 10)],
            }),
            makeApp(),
            makeApi(),
        );
        const excerptEl = container.find("lilbee-excerpt")!;
        const loc = excerptEl.find("lilbee-location");
        expect(loc).not.toBeNull();
        expect(loc!.textContent).toBe("line 10");
    });
});

describe("renderDocumentResult — truncate", () => {
    const shortText = "Short text";
    const longText = "x".repeat(201);

    it("does not truncate text at or below 200 chars", () => {
        const container = makeContainer();
        renderDocumentResult(
            container as unknown as HTMLElement,
            makeDocumentResult({ excerpts: [makeExcerpt(shortText)] }),
            makeApp(),
            makeApi(),
        );
        const p = container.find("lilbee-excerpt")!.children.find((c) => c.tagName === "P")!;
        expect(p.textContent).toBe(shortText);
    });

    it("does not truncate text exactly 200 chars long", () => {
        const exactly200 = "a".repeat(200);
        const container = makeContainer();
        renderDocumentResult(
            container as unknown as HTMLElement,
            makeDocumentResult({ excerpts: [makeExcerpt(exactly200)] }),
            makeApp(),
            makeApi(),
        );
        const p = container.find("lilbee-excerpt")!.children.find((c) => c.tagName === "P")!;
        expect(p.textContent).toBe(exactly200);
    });

    it("truncates text over 200 chars and appends '...'", () => {
        const container = makeContainer();
        renderDocumentResult(
            container as unknown as HTMLElement,
            makeDocumentResult({ excerpts: [makeExcerpt(longText)] }),
            makeApp(),
            makeApi(),
        );
        const p = container.find("lilbee-excerpt")!.children.find((c) => c.tagName === "P")!;
        expect(p.textContent).toBe("x".repeat(200) + "...");
    });
});

describe("formatLocation — page branches", () => {
    it("page_start only → 'p. X'", () => {
        const container = makeContainer();
        renderDocumentResult(
            container as unknown as HTMLElement,
            makeDocumentResult({ excerpts: [makeExcerpt("text", 5, null)] }),
            makeApp(),
            makeApi(),
        );
        expect(container.find("lilbee-location")!.textContent).toBe("p. 5");
    });

    it("page_start === page_end → 'p. X' (same page)", () => {
        const container = makeContainer();
        renderDocumentResult(
            container as unknown as HTMLElement,
            makeDocumentResult({ excerpts: [makeExcerpt("text", 7, 7)] }),
            makeApp(),
            makeApi(),
        );
        expect(container.find("lilbee-location")!.textContent).toBe("p. 7");
    });

    it("page_start !== page_end → 'pp. X–Y'", () => {
        const container = makeContainer();
        renderDocumentResult(
            container as unknown as HTMLElement,
            makeDocumentResult({ excerpts: [makeExcerpt("text", 2, 4)] }),
            makeApp(),
            makeApi(),
        );
        expect(container.find("lilbee-location")!.textContent).toBe("pp. 2\u20134");
    });
});

describe("formatLocation — line branches", () => {
    it("line_start only → 'line X'", () => {
        const container = makeContainer();
        renderDocumentResult(
            container as unknown as HTMLElement,
            makeDocumentResult({ excerpts: [makeExcerpt("text", null, null, 10, null)] }),
            makeApp(),
            makeApi(),
        );
        expect(container.find("lilbee-location")!.textContent).toBe("line 10");
    });

    it("line_start === line_end → 'line X'", () => {
        const container = makeContainer();
        renderDocumentResult(
            container as unknown as HTMLElement,
            makeDocumentResult({ excerpts: [makeExcerpt("text", null, null, 10, 10)] }),
            makeApp(),
            makeApi(),
        );
        expect(container.find("lilbee-location")!.textContent).toBe("line 10");
    });

    it("line_start !== line_end → 'lines X–Y'", () => {
        const container = makeContainer();
        renderDocumentResult(
            container as unknown as HTMLElement,
            makeDocumentResult({ excerpts: [makeExcerpt("text", null, null, 10, 20)] }),
            makeApp(),
            makeApi(),
        );
        expect(container.find("lilbee-location")!.textContent).toBe("lines 10\u201320");
    });

    it("all null → no location element rendered", () => {
        const container = makeContainer();
        renderDocumentResult(
            container as unknown as HTMLElement,
            makeDocumentResult({ excerpts: [makeExcerpt("text", null, null, null, null)] }),
            makeApp(),
            makeApi(),
        );
        expect(container.find("lilbee-location")).toBeNull();
    });
});

describe("renderSourceChip — basic", () => {
    it("creates a span with class lilbee-source-chip", () => {
        const container = makeContainer();
        const source: Source = {
            source: "docs/readme.md",
            content_type: "markdown",
            distance: 0.1,
            chunk: "some text",
            page_start: null,
            page_end: null,
            line_start: null,
            line_end: null,
        };
        renderSourceChip(container as unknown as HTMLElement, source, makeApp(), makeApi());
        const chip = container.find("lilbee-source-chip");
        expect(chip).not.toBeNull();
        expect(chip!.tagName).toBe("SPAN");
    });

    it("sets chip text to source name when no location fields", () => {
        const container = makeContainer();
        const source: Source = {
            source: "docs/readme.md",
            content_type: "markdown",
            distance: 0.1,
            chunk: "some text",
            page_start: null,
            page_end: null,
            line_start: null,
            line_end: null,
        };
        renderSourceChip(container as unknown as HTMLElement, source, makeApp(), makeApi());
        expect(container.find("lilbee-source-chip")!.textContent).toBe("docs/readme.md");
    });

    it("appends page location when page_start is provided (only)", () => {
        const container = makeContainer();
        const source: Source = {
            source: "book.pdf",
            content_type: "pdf",
            distance: 0.2,
            chunk: "...",
            page_start: 42,
            page_end: null,
            line_start: null,
            line_end: null,
        };
        renderSourceChip(container as unknown as HTMLElement, source, makeApp(), makeApi());
        expect(container.find("lilbee-source-chip")!.textContent).toBe("book.pdf (p. 42)");
    });

    it("appends page range when page_start and different page_end provided", () => {
        const container = makeContainer();
        const source: Source = {
            source: "book.pdf",
            content_type: "pdf",
            distance: 0.2,
            chunk: "...",
            page_start: 10,
            page_end: 12,
            line_start: null,
            line_end: null,
        };
        renderSourceChip(container as unknown as HTMLElement, source, makeApp(), makeApi());
        expect(container.find("lilbee-source-chip")!.textContent).toBe("book.pdf (pp. 10\u201312)");
    });

    it("appends 'p. X' when page_start === page_end", () => {
        const container = makeContainer();
        const source: Source = {
            source: "book.pdf",
            content_type: "pdf",
            distance: 0.2,
            chunk: "...",
            page_start: 5,
            page_end: 5,
            line_start: null,
            line_end: null,
        };
        renderSourceChip(container as unknown as HTMLElement, source, makeApp(), makeApi());
        expect(container.find("lilbee-source-chip")!.textContent).toBe("book.pdf (p. 5)");
    });

    it("appends line location when line_start is provided (only)", () => {
        const container = makeContainer();
        const source: Source = {
            source: "main.py",
            content_type: "code",
            distance: 0.05,
            chunk: "def foo():",
            page_start: null,
            page_end: null,
            line_start: 99,
            line_end: null,
        };
        renderSourceChip(container as unknown as HTMLElement, source, makeApp(), makeApi());
        expect(container.find("lilbee-source-chip")!.textContent).toBe("main.py (line 99)");
    });

    it("appends line range when line_start and different line_end provided", () => {
        const container = makeContainer();
        const source: Source = {
            source: "main.py",
            content_type: "code",
            distance: 0.05,
            chunk: "def foo():",
            page_start: null,
            page_end: null,
            line_start: 10,
            line_end: 20,
        };
        renderSourceChip(container as unknown as HTMLElement, source, makeApp(), makeApi());
        expect(container.find("lilbee-source-chip")!.textContent).toBe("main.py (lines 10\u201320)");
    });

    it("appends 'line X' when line_start === line_end", () => {
        const container = makeContainer();
        const source: Source = {
            source: "main.py",
            content_type: "code",
            distance: 0.05,
            chunk: "def foo():",
            page_start: null,
            page_end: null,
            line_start: 15,
            line_end: 15,
        };
        renderSourceChip(container as unknown as HTMLElement, source, makeApp(), makeApi());
        expect(container.find("lilbee-source-chip")!.textContent).toBe("main.py (line 15)");
    });

    it("shows no location suffix when all location fields are null", () => {
        const container = makeContainer();
        const source: Source = {
            source: "notes/plain.md",
            content_type: "markdown",
            distance: 0.3,
            chunk: "body text",
            page_start: null,
            page_end: null,
            line_start: null,
            line_end: null,
        };
        renderSourceChip(container as unknown as HTMLElement, source, makeApp(), makeApi());
        expect(container.find("lilbee-source-chip")!.textContent).toBe("notes/plain.md");
    });
});

describe("renderSourceChip — wiki chunk_type", () => {
    it("adds wiki class and creates W badge when chunk_type='wiki'", () => {
        const container = makeContainer();
        const source: Source = {
            source: "wiki/concept.md",
            content_type: "markdown",
            distance: 0.1,
            chunk: "wiki content",
            page_start: null,
            page_end: null,
            line_start: null,
            line_end: null,
            chunk_type: "wiki",
        };
        renderSourceChip(container as unknown as HTMLElement, source, makeApp(), makeApi());
        const chip = container.find("lilbee-source-chip")!;
        expect(chip.classList.contains("lilbee-source-chip-wiki")).toBe(true);
        const badge = chip.children.find((c: any) => c.classList.contains("lilbee-wiki-type-badge"));
        expect(badge).toBeDefined();
        expect(badge!.textContent).toBe("W");
    });

    it("does not add wiki class when chunk_type is not 'wiki'", () => {
        const container = makeContainer();
        const source: Source = {
            source: "notes/plain.md",
            content_type: "markdown",
            distance: 0.1,
            chunk: "text",
            page_start: null,
            page_end: null,
            line_start: null,
            line_end: null,
        };
        renderSourceChip(container as unknown as HTMLElement, source, makeApp(), makeApi());
        const chip = container.find("lilbee-source-chip")!;
        expect(chip.classList.contains("lilbee-source-chip-wiki")).toBe(false);
    });

    it("adds fact class when claim_type='fact'", () => {
        const container = makeContainer();
        const source: Source = {
            source: "wiki/page.md",
            content_type: "markdown",
            distance: 0.1,
            chunk: "fact",
            page_start: null,
            page_end: null,
            line_start: null,
            line_end: null,
            chunk_type: "wiki",
            claim_type: "fact",
        };
        renderSourceChip(container as unknown as HTMLElement, source, makeApp(), makeApi());
        const chip = container.find("lilbee-source-chip")!;
        expect(chip.classList.contains("lilbee-claim-fact")).toBe(true);
    });

    it("adds inference class when claim_type='inference'", () => {
        const container = makeContainer();
        const source: Source = {
            source: "wiki/page.md",
            content_type: "markdown",
            distance: 0.1,
            chunk: "inference",
            page_start: null,
            page_end: null,
            line_start: null,
            line_end: null,
            chunk_type: "wiki",
            claim_type: "inference",
        };
        renderSourceChip(container as unknown as HTMLElement, source, makeApp(), makeApi());
        const chip = container.find("lilbee-source-chip")!;
        expect(chip.classList.contains("lilbee-claim-inference")).toBe(true);
    });

    it("sets cursor to pointer and triggers onWikiClick when wiki chip is clicked", () => {
        const container = makeContainer();
        const onWikiClick = vi.fn();
        const source: Source = {
            source: "wiki/concept.md",
            content_type: "markdown",
            distance: 0.1,
            chunk: "wiki",
            page_start: null,
            page_end: null,
            line_start: null,
            line_end: null,
            chunk_type: "wiki",
        };
        renderSourceChip(container as unknown as HTMLElement, source, makeApp(), makeApi(), onWikiClick);
        const chip = container.find("lilbee-source-chip")!;
        expect(chip.style["cursor"]).toBe("pointer");
        chip.trigger("click");
        expect(onWikiClick).toHaveBeenCalledWith("wiki/concept.md");
    });

    it("ignores onWikiClick for non-wiki chips and dispatches through executeSourceClick instead", () => {
        previewOpens.length = 0;
        const container = makeContainer();
        const onWikiClick = vi.fn();
        const source: Source = {
            source: "notes/plain.md",
            content_type: "markdown",
            distance: 0.1,
            chunk: "text",
            page_start: null,
            page_end: null,
            line_start: null,
            line_end: null,
        };
        const app = makeApp();
        renderSourceChip(container as unknown as HTMLElement, source, app, makeApi(), onWikiClick);
        const chip = container.find("lilbee-source-chip")!;
        expect(chip.style["cursor"]).toBe("pointer");
        chip.trigger("click");
        expect(onWikiClick).not.toHaveBeenCalled();
        // No vault_path → preview path
        expect(previewOpens).toHaveLength(1);
    });

    it("non-wiki chip with vault_path that hits a vault file opens via openLinkText", () => {
        previewOpens.length = 0;
        const container = makeContainer();
        const source: Source = {
            source: "remote-path.md",
            vault_path: "lilbee/imported/readme.md",
            content_type: "text/markdown",
            distance: 0.1,
            chunk: "text",
            page_start: null,
            page_end: null,
            line_start: null,
            line_end: null,
        };
        const app = makeApp();
        app.vault.getAbstractFileByPath = vi.fn(() => ({ path: "lilbee/imported/readme.md" }) as unknown as null);
        renderSourceChip(container as unknown as HTMLElement, source, app, makeApi());
        const chip = container.find("lilbee-source-chip")!;
        expect(chip.style["cursor"]).toBe("pointer");
        chip.trigger("click");
        expect(app.workspace.openLinkText).toHaveBeenCalledWith("lilbee/imported/readme.md", "");
        expect(previewOpens).toHaveLength(0);
    });

    it("non-wiki PDF chip with vault_path hits a vault file and opens with #page=N", () => {
        previewOpens.length = 0;
        const container = makeContainer();
        const source: Source = {
            source: "book.pdf",
            vault_path: "lilbee/imported/book.pdf",
            content_type: "application/pdf",
            distance: 0.1,
            chunk: "chunk",
            page_start: 5,
            page_end: 5,
            line_start: null,
            line_end: null,
        };
        const app = makeApp();
        app.vault.getAbstractFileByPath = vi.fn(() => ({ path: "lilbee/imported/book.pdf" }) as unknown as null);
        renderSourceChip(container as unknown as HTMLElement, source, app, makeApi());
        container.find("lilbee-source-chip")!.trigger("click");
        expect(app.workspace.openLinkText).toHaveBeenCalledWith("lilbee/imported/book.pdf#page=5", "");
    });
});
