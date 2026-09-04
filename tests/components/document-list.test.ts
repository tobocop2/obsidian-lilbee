import { describe, it, expect, beforeEach, vi } from "vitest";
import { Notice } from "obsidian";
import { MockElement } from "../__mocks__/obsidian";
import { DocumentList, DOCUMENT_PAGE_SIZE } from "../../src/components/document-list";
import type { DocumentEntry, DocumentsResponse } from "../../src/types";

function makeDoc(overrides: Partial<DocumentEntry> = {}): DocumentEntry {
    return {
        filename: "test.md",
        chunk_count: 5,
        ingested_at: "2024-01-01T00:00:00Z",
        ...overrides,
    };
}

function makeResponse(docs: DocumentEntry[] = [], total?: number, hasMore = false): DocumentsResponse {
    return {
        documents: docs,
        total: total ?? docs.length,
        limit: DOCUMENT_PAGE_SIZE,
        offset: 0,
        has_more: hasMore,
    };
}

function makeList(response: DocumentsResponse, selectable = false, onSelectionChange?: () => void) {
    const container = new MockElement();
    const fetchPage = vi.fn().mockResolvedValue(response);
    const list = new DocumentList(container as unknown as HTMLElement, fetchPage, { selectable, onSelectionChange });
    return { container, fetchPage, list };
}

describe("DocumentList", () => {
    beforeEach(() => {
        Notice.clear();
    });

    it("requests the first page with the shared page size", async () => {
        const { fetchPage, list } = makeList(makeResponse([makeDoc()]));
        await list.loadMore();

        expect(fetchPage).toHaveBeenCalledWith(DOCUMENT_PAGE_SIZE, 0);
    });

    it("renders filename, chunk count, and relative ingest time per row", async () => {
        const doc = makeDoc({
            filename: "notes.md",
            chunk_count: 10,
            ingested_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        });
        const { container, list } = makeList(makeResponse([doc]));
        await list.loadMore();

        expect(container.findAll("lilbee-documents-row").length).toBe(1);
        const nameEl = container.find("lilbee-documents-row-name")!;
        expect(nameEl.textContent).toBe("notes.md");
        expect(nameEl.attributes["title"]).toBe("notes.md");
        expect(container.find("lilbee-documents-row-chunks")!.textContent).toBe("10 chunks");
        const dateEl = container.find("lilbee-documents-row-date")!;
        expect(dateEl.textContent).toContain("m ago");
        expect(dateEl.attributes["title"]).toBe(doc.ingested_at);
    });

    it("omits the date tooltip when the document has no ingest time", async () => {
        const { container, list } = makeList(makeResponse([makeDoc({ ingested_at: "" })]));
        await list.loadMore();

        expect(container.find("lilbee-documents-row-date")!.attributes["title"]).toBeUndefined();
    });

    it("renders no checkboxes when the list is read-only", async () => {
        const { container, list } = makeList(makeResponse([makeDoc()]));
        await list.loadMore();

        expect(container.findAll("lilbee-documents-checkbox").length).toBe(0);
    });

    it("tracks checked filenames and reports selection changes when selectable", async () => {
        const onSelectionChange = vi.fn();
        const { container, list } = makeList(makeResponse([makeDoc({ filename: "a.md" })]), true, onSelectionChange);
        await list.loadMore();

        const checkbox = container.findAll("lilbee-documents-checkbox")[0];
        (checkbox as unknown as { checked: boolean }).checked = true;
        checkbox.trigger("change");
        expect(list.selected).toEqual(["a.md"]);

        (checkbox as unknown as { checked: boolean }).checked = false;
        checkbox.trigger("change");
        expect(list.selected).toEqual([]);
        expect(onSelectionChange).toHaveBeenCalledTimes(2);
    });

    it("tolerates a selectable list without a selection callback", async () => {
        const { container, list } = makeList(makeResponse([makeDoc({ filename: "a.md" })]), true);
        await list.loadMore();

        const checkbox = container.findAll("lilbee-documents-checkbox")[0];
        (checkbox as unknown as { checked: boolean }).checked = true;
        expect(() => checkbox.trigger("change")).not.toThrow();
        expect(list.selected).toEqual(["a.md"]);
    });

    it("advances the offset and reports totals across pages", async () => {
        const page1 = Array.from({ length: DOCUMENT_PAGE_SIZE }, (_, i) => makeDoc({ filename: `f${i}.md` }));
        const container = new MockElement();
        const fetchPage = vi
            .fn()
            .mockResolvedValueOnce(makeResponse(page1, DOCUMENT_PAGE_SIZE + 1, true))
            .mockResolvedValueOnce(makeResponse([makeDoc({ filename: "last.md" })], DOCUMENT_PAGE_SIZE + 1));
        const list = new DocumentList(container as unknown as HTMLElement, fetchPage);

        await list.loadMore();
        expect(list.loaded).toBe(DOCUMENT_PAGE_SIZE);
        expect(list.total).toBe(DOCUMENT_PAGE_SIZE + 1);
        expect(list.hasMore).toBe(true);

        await list.loadMore();
        expect(fetchPage).toHaveBeenLastCalledWith(DOCUMENT_PAGE_SIZE, DOCUMENT_PAGE_SIZE);
        expect(list.loaded).toBe(DOCUMENT_PAGE_SIZE + 1);
        expect(list.hasMore).toBe(false);
        expect(container.findAll("lilbee-documents-row").length).toBe(DOCUMENT_PAGE_SIZE + 1);
    });

    it("does not fetch again when the last page is loaded", async () => {
        const { fetchPage, list } = makeList(makeResponse([makeDoc()]));
        await list.loadMore();
        fetchPage.mockClear();

        await list.loadMore();
        expect(fetchPage).not.toHaveBeenCalled();
    });

    it("does not fetch while a page is in flight", async () => {
        const container = new MockElement();
        let release: (value: DocumentsResponse) => void = () => {};
        const pending = new Promise<DocumentsResponse>((resolve) => {
            release = resolve;
        });
        const fetchPage = vi.fn().mockReturnValue(pending);
        const list = new DocumentList(container as unknown as HTMLElement, fetchPage);

        const first = list.loadMore();
        await list.loadMore();
        expect(fetchPage).toHaveBeenCalledTimes(1);

        release(makeResponse([makeDoc()]));
        await first;
    });

    it("drops a page that lands after a reset and fetches the new query", async () => {
        const container = new MockElement();
        let release: (value: DocumentsResponse) => void = () => {};
        const pending = new Promise<DocumentsResponse>((resolve) => {
            release = resolve;
        });
        const fetchPage = vi
            .fn()
            .mockReturnValueOnce(pending)
            .mockResolvedValue(makeResponse([makeDoc({ filename: "new.md" })]));
        const list = new DocumentList(container as unknown as HTMLElement, fetchPage);

        const stale = list.loadMore();
        list.reset();
        await list.loadMore();
        release(makeResponse([makeDoc({ filename: "old.md" })], 5, true));
        await stale;

        expect(fetchPage).toHaveBeenCalledTimes(2);
        expect(container.findAll("lilbee-documents-row-name").map((el) => el.textContent)).toEqual(["new.md"]);
        expect(list.loaded).toBe(1);
        expect(list.total).toBe(1);
    });

    it("stays silent when a fetch that a reset abandoned rejects", async () => {
        const container = new MockElement();
        let fail: (reason: Error) => void = () => {};
        const pending = new Promise<DocumentsResponse>((_resolve, reject) => {
            fail = reject;
        });
        const fetchPage = vi.fn().mockReturnValueOnce(pending);
        const list = new DocumentList(container as unknown as HTMLElement, fetchPage);

        const stale = list.loadMore();
        list.reset();
        fail(new Error("boom"));

        expect(await stale).toBe(true);
        expect(Notice.instances).toHaveLength(0);
    });

    it("shows a notice and reports failure when the fetch rejects", async () => {
        const container = new MockElement();
        const fetchPage = vi.fn().mockRejectedValue(new Error("network"));
        const list = new DocumentList(container as unknown as HTMLElement, fetchPage);

        expect(await list.loadMore()).toBe(false);
        expect(Notice.instances.some((n) => n.message.includes("failed to load documents"))).toBe(true);
        expect(list.hasMore).toBe(true);
    });

    it("clears rows, selection, and paging state on reset", async () => {
        const { container, fetchPage, list } = makeList(makeResponse([makeDoc({ filename: "a.md" })]), true);
        await list.loadMore();

        const checkbox = container.findAll("lilbee-documents-checkbox")[0];
        (checkbox as unknown as { checked: boolean }).checked = true;
        checkbox.trigger("change");

        list.reset();
        expect(container.children.length).toBe(0);
        expect(list.selected).toEqual([]);
        expect(list.loaded).toBe(0);
        expect(list.total).toBe(0);
        expect(list.hasMore).toBe(true);

        await list.loadMore();
        expect(fetchPage).toHaveBeenLastCalledWith(DOCUMENT_PAGE_SIZE, 0);
    });

    it("loads the next page when the bound element scrolls near its bottom, until the last page", async () => {
        const container = new MockElement();
        const fetchPage = vi
            .fn()
            .mockResolvedValueOnce(makeResponse([makeDoc({ filename: "a.md" })], 2, true))
            .mockResolvedValueOnce(makeResponse([makeDoc({ filename: "b.md" })], 2, false));
        const list = new DocumentList(container as unknown as HTMLElement, fetchPage);
        await list.loadMore();
        const scrollEl = new MockElement();
        const unbind = list.bindScroll(scrollEl as unknown as HTMLElement);

        Object.assign(scrollEl, { scrollTop: 0, clientHeight: 400, scrollHeight: 2000 });
        scrollEl.trigger("scroll");
        expect(fetchPage).toHaveBeenCalledTimes(1);

        Object.assign(scrollEl, { scrollTop: 1500 });
        scrollEl.trigger("scroll");
        await vi.waitFor(() => expect(list.loaded).toBe(2));
        scrollEl.trigger("scroll");
        expect(fetchPage).toHaveBeenCalledTimes(2);

        unbind();
        Object.assign(scrollEl, { scrollTop: 1600 });
        scrollEl.trigger("scroll");
        expect(fetchPage).toHaveBeenCalledTimes(2);
    });

    it("hands a clicked filename to onOpen and reports every page to onPage", async () => {
        const container = new MockElement();
        const opened: string[] = [];
        const pages: boolean[] = [];
        const list = new DocumentList(
            container as unknown as HTMLElement,
            vi.fn().mockResolvedValue(makeResponse([makeDoc({ filename: "a.md" })])),
            { onOpen: (doc) => opened.push(doc.filename), onPage: (loaded) => pages.push(loaded) },
        );
        await list.loadMore();
        container.find("lilbee-documents-row-link")!.trigger("click");
        expect(opened).toEqual(["a.md"]);
        expect(pages).toEqual([true]);
    });
});
