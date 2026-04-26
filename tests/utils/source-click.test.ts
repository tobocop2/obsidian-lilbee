import { vi, describe, it, expect, beforeEach } from "vitest";
import { App } from "../__mocks__/obsidian";
import { sourceClickAction, executeSourceClick, SOURCE_ACTION } from "../../src/utils/source-click";
import { CONTENT_TYPE } from "../../src/types";
import type { Source } from "../../src/types";
import type { LilbeeClient } from "../../src/api";

// Track SourcePreviewModal construction / open calls without pulling the real
// class (which needs the Modal base + app plumbing).
const previewInstances: Array<{ app: unknown; api: unknown; source: Source; open: ReturnType<typeof vi.fn> }> = [];
vi.mock("../../src/views/source-preview-modal", () => ({
    SourcePreviewModal: vi.fn().mockImplementation((app: unknown, api: unknown, source: Source) => {
        const inst = { app, api, source, open: vi.fn() };
        previewInstances.push(inst);
        return inst;
    }),
}));

function makeSource(overrides: Partial<Source> = {}): Source {
    return {
        source: "crawled/example.com/page.md",
        content_type: CONTENT_TYPE.MARKDOWN,
        distance: 0.1,
        chunk: "chunk",
        page_start: null,
        page_end: null,
        line_start: null,
        line_end: null,
        ...overrides,
    };
}

function makeVault(fileExists: boolean): App["vault"] {
    const app = new App();
    app.vault.getAbstractFileByPath = vi.fn((path: string) =>
        fileExists ? ({ path, name: path.split("/").pop() ?? path } as unknown as null) : null,
    ) as ReturnType<typeof vi.fn>;
    return app.vault;
}

function makeVaultWithPaths(existingPaths: string[]): App["vault"] {
    const app = new App();
    const set = new Set(existingPaths);
    app.vault.getAbstractFileByPath = vi.fn((path: string) =>
        set.has(path) ? ({ path, name: path.split("/").pop() ?? path } as unknown as null) : null,
    ) as ReturnType<typeof vi.fn>;
    return app.vault;
}

beforeEach(() => {
    previewInstances.length = 0;
});

describe("sourceClickAction — vault resolution", () => {
    it("returns vault-pdf when vault_path is set, file exists, and content_type is PDF", () => {
        const vault = makeVault(true);
        const source = makeSource({
            vault_path: "lilbee/imported/book.pdf",
            content_type: CONTENT_TYPE.PDF,
            page_start: 4,
        });
        const action = sourceClickAction(source, vault as never);
        expect(action).toEqual({
            kind: SOURCE_ACTION.VAULT_PDF,
            path: "lilbee/imported/book.pdf",
            page: 4,
        });
    });

    it("defaults vault-pdf page to 1 when page_start is null", () => {
        const vault = makeVault(true);
        const source = makeSource({
            vault_path: "lilbee/imported/book.pdf",
            content_type: CONTENT_TYPE.PDF,
            page_start: null,
        });
        const action = sourceClickAction(source, vault as never);
        expect(action).toEqual({
            kind: SOURCE_ACTION.VAULT_PDF,
            path: "lilbee/imported/book.pdf",
            page: 1,
        });
    });

    it("returns vault-markdown when vault_path hits a markdown file with line_start set", () => {
        const vault = makeVault(true);
        const source = makeSource({
            vault_path: "lilbee/crawled/example.com/page.md",
            content_type: CONTENT_TYPE.MARKDOWN,
            line_start: 42,
        });
        const action = sourceClickAction(source, vault as never);
        expect(action).toEqual({
            kind: SOURCE_ACTION.VAULT_MARKDOWN,
            path: "lilbee/crawled/example.com/page.md",
            line: 42,
        });
    });

    it("returns vault-markdown for text/html with a line_start", () => {
        const vault = makeVault(true);
        const source = makeSource({
            vault_path: "lilbee/crawled/example.com/page.html",
            content_type: CONTENT_TYPE.HTML,
            line_start: 7,
        });
        const action = sourceClickAction(source, vault as never);
        expect(action).toEqual({
            kind: SOURCE_ACTION.VAULT_MARKDOWN,
            path: "lilbee/crawled/example.com/page.html",
            line: 7,
        });
    });

    it("falls back to vault-note for markdown with no line_start", () => {
        const vault = makeVault(true);
        const source = makeSource({
            vault_path: "lilbee/imported/readme.md",
            content_type: CONTENT_TYPE.MARKDOWN,
            line_start: null,
        });
        const action = sourceClickAction(source, vault as never);
        expect(action).toEqual({
            kind: SOURCE_ACTION.VAULT_NOTE,
            path: "lilbee/imported/readme.md",
        });
    });

    it("falls back to vault-note for non-pdf/markdown content types", () => {
        const vault = makeVault(true);
        const source = makeSource({
            vault_path: "lilbee/imported/data.csv",
            content_type: "text/csv",
            line_start: 3,
        });
        const action = sourceClickAction(source, vault as never);
        expect(action).toEqual({
            kind: SOURCE_ACTION.VAULT_NOTE,
            path: "lilbee/imported/data.csv",
        });
    });
});

describe("sourceClickAction — source fallback", () => {
    it("falls back to source.source for PDFs when vault_path is null", () => {
        const vault = makeVaultWithPaths(["cv-manual.pdf"]);
        const source = makeSource({
            source: "cv-manual.pdf",
            vault_path: null,
            content_type: CONTENT_TYPE.PDF,
            page_start: 235,
        });
        const action = sourceClickAction(source, vault as never);
        expect(action).toEqual({ kind: SOURCE_ACTION.VAULT_PDF, path: "cv-manual.pdf", page: 235 });
    });

    it("falls back to source.source for markdown with line deep-link", () => {
        const vault = makeVaultWithPaths(["lilbee/crawled/example.com/page.md"]);
        const source = makeSource({
            source: "lilbee/crawled/example.com/page.md",
            vault_path: undefined,
            content_type: CONTENT_TYPE.MARKDOWN,
            line_start: 12,
        });
        const action = sourceClickAction(source, vault as never);
        expect(action).toEqual({
            kind: SOURCE_ACTION.VAULT_MARKDOWN,
            path: "lilbee/crawled/example.com/page.md",
            line: 12,
        });
    });

    it("falls back to source.source as vault-note for other content types", () => {
        const vault = makeVaultWithPaths(["lilbee/imported/data.csv"]);
        const source = makeSource({
            source: "lilbee/imported/data.csv",
            vault_path: null,
            content_type: "text/csv",
        });
        const action = sourceClickAction(source, vault as never);
        expect(action).toEqual({ kind: SOURCE_ACTION.VAULT_NOTE, path: "lilbee/imported/data.csv" });
    });

    it("uses vault_path in preference to source.source when both resolve", () => {
        const vault = makeVaultWithPaths(["lilbee/alias/book.pdf", "cv-manual.pdf"]);
        const source = makeSource({
            source: "cv-manual.pdf",
            vault_path: "lilbee/alias/book.pdf",
            content_type: CONTENT_TYPE.PDF,
            page_start: 3,
        });
        const action = sourceClickAction(source, vault as never);
        expect(action).toEqual({ kind: SOURCE_ACTION.VAULT_PDF, path: "lilbee/alias/book.pdf", page: 3 });
    });

    it("falls back to source.source when vault_path is set but file is missing", () => {
        const vault = makeVaultWithPaths(["cv-manual.pdf"]);
        const source = makeSource({
            source: "cv-manual.pdf",
            vault_path: "lilbee/stale/book.pdf",
            content_type: CONTENT_TYPE.PDF,
            page_start: 7,
        });
        const action = sourceClickAction(source, vault as never);
        expect(action).toEqual({ kind: SOURCE_ACTION.VAULT_PDF, path: "cv-manual.pdf", page: 7 });
    });
});

describe("sourceClickAction — preview fallback", () => {
    it("returns preview when vault_path is undefined and source.source does not match", () => {
        const vault = makeVault(false);
        const source = makeSource({ source: "external/only.md", vault_path: undefined });
        const action = sourceClickAction(source, vault as never);
        expect(action).toEqual({ kind: SOURCE_ACTION.PREVIEW, source });
    });

    it("returns preview when vault_path is null and source.source does not match", () => {
        const vault = makeVault(false);
        const source = makeSource({ source: "external/only.md", vault_path: null });
        const action = sourceClickAction(source, vault as never);
        expect(action).toEqual({ kind: SOURCE_ACTION.PREVIEW, source });
    });

    it("returns preview when both vault_path and source.source miss the vault", () => {
        const vault = makeVault(false);
        const source = makeSource({ source: "external/gone.md", vault_path: "lilbee/deleted.md" });
        const action = sourceClickAction(source, vault as never);
        expect(action).toEqual({ kind: SOURCE_ACTION.PREVIEW, source });
    });

    it("returns preview when source.source is an empty string", () => {
        const vault = makeVaultWithPaths([""]);
        const source = makeSource({ source: "", vault_path: null });
        const action = sourceClickAction(source, vault as never);
        expect(action).toEqual({ kind: SOURCE_ACTION.PREVIEW, source });
    });
});

describe("executeSourceClick — dispatch", () => {
    it("vault-pdf: opens with #page=N appended to the path", async () => {
        const app = new App();
        const api = {} as LilbeeClient;
        await executeSourceClick(app as never, api, {
            kind: SOURCE_ACTION.VAULT_PDF,
            path: "lilbee/imported/book.pdf",
            page: 4,
        });
        expect(app.workspace.openLinkText).toHaveBeenCalledWith("lilbee/imported/book.pdf#page=4", "");
    });

    it("vault-markdown: opens with eState.line ephemeral state", async () => {
        const app = new App();
        const api = {} as LilbeeClient;
        await executeSourceClick(app as never, api, {
            kind: SOURCE_ACTION.VAULT_MARKDOWN,
            path: "lilbee/crawled/example.com/page.md",
            line: 42,
        });
        expect(app.workspace.openLinkText).toHaveBeenCalledWith("lilbee/crawled/example.com/page.md", "", false, {
            eState: { line: 42 },
        });
    });

    it("vault-note: opens by path with empty source", async () => {
        const app = new App();
        const api = {} as LilbeeClient;
        await executeSourceClick(app as never, api, {
            kind: SOURCE_ACTION.VAULT_NOTE,
            path: "lilbee/imported/data.csv",
        });
        expect(app.workspace.openLinkText).toHaveBeenCalledWith("lilbee/imported/data.csv", "");
    });

    it("preview: constructs and opens a SourcePreviewModal", async () => {
        const app = new App();
        const api = {} as LilbeeClient;
        const source = makeSource({ vault_path: null });
        await executeSourceClick(app as never, api, { kind: SOURCE_ACTION.PREVIEW, source });
        expect(previewInstances).toHaveLength(1);
        expect(previewInstances[0].app).toBe(app);
        expect(previewInstances[0].api).toBe(api);
        expect(previewInstances[0].source).toBe(source);
        expect(previewInstances[0].open).toHaveBeenCalled();
    });
});
