import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { App, Notice } from "obsidian";
import { MockElement } from "../__mocks__/obsidian";
import { DocumentsModal } from "../../src/views/documents-modal";
import type { DocumentEntry, DocumentsResponse } from "../../src/types";

let mockConfirmResult = true;
vi.mock("../../src/views/confirm-modal", () => ({
    ConfirmModal: vi.fn().mockImplementation(() => ({
        open: vi.fn(),
        get result() { return Promise.resolve(mockConfirmResult); },
        close: vi.fn(),
    })),
}));

function makeDoc(overrides: Partial<DocumentEntry> = {}): DocumentEntry {
    return {
        filename: "test.md",
        chunk_count: 5,
        ingested_at: "2024-01-01T00:00:00Z",
        ...overrides,
    };
}

function makeDocsResponse(docs: DocumentEntry[] = [], total?: number): DocumentsResponse {
    return {
        documents: docs,
        total: total ?? docs.length,
        limit: 20,
        offset: 0,
    };
}

function makePlugin() {
    return {
        api: {
            listDocuments: vi.fn().mockResolvedValue(makeDocsResponse()),
            removeDocuments: vi.fn().mockResolvedValue({ removed: 0, not_found: [] }),
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

function findInputs(el: MockElement): MockElement[] {
    const inputs: MockElement[] = [];
    if (el.tagName === "INPUT") inputs.push(el);
    for (const child of el.children) {
        inputs.push(...findInputs(child));
    }
    return inputs;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("DocumentsModal", () => {
    beforeEach(() => {
        Notice.clear();
        mockConfirmResult = true;
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("renders title and search on open", async () => {
        const plugin = makePlugin();
        const app = new App();
        const modal = new DocumentsModal(app as any, plugin as any);
        modal.open();
        await vi.runAllTimersAsync();

        const el = modal.contentEl as unknown as MockElement;
        const texts = collectTexts(el);
        expect(texts.some(t => t.includes("Documents"))).toBe(true);
        expect(el.find("lilbee-documents-search")).not.toBeNull();
    });

    it("fetches documents on open", async () => {
        const docs = [makeDoc({ filename: "a.md" }), makeDoc({ filename: "b.md" })];
        const plugin = makePlugin();
        plugin.api.listDocuments.mockResolvedValue(makeDocsResponse(docs));
        const app = new App();
        const modal = new DocumentsModal(app as any, plugin as any);
        modal.open();
        await vi.runAllTimersAsync();

        expect(plugin.api.listDocuments).toHaveBeenCalledWith(undefined, 20, 0);
        const el = modal.contentEl as unknown as MockElement;
        const rows = el.findAll("lilbee-documents-row");
        expect(rows.length).toBe(2);
    });

    it("renders filename, chunks, and date in each row", async () => {
        const docs = [makeDoc({ filename: "notes.md", chunk_count: 10, ingested_at: "2024-06-15" })];
        const plugin = makePlugin();
        plugin.api.listDocuments.mockResolvedValue(makeDocsResponse(docs));
        const app = new App();
        const modal = new DocumentsModal(app as any, plugin as any);
        modal.open();
        await vi.runAllTimersAsync();

        const el = modal.contentEl as unknown as MockElement;
        const texts = collectTexts(el);
        expect(texts.some(t => t.includes("notes.md"))).toBe(true);
        expect(texts.some(t => t.includes("10 chunks"))).toBe(true);
        expect(texts.some(t => t.includes("2024-06-15"))).toBe(true);
    });

    it("renders checkboxes in each row", async () => {
        const docs = [makeDoc()];
        const plugin = makePlugin();
        plugin.api.listDocuments.mockResolvedValue(makeDocsResponse(docs));
        const app = new App();
        const modal = new DocumentsModal(app as any, plugin as any);
        modal.open();
        await vi.runAllTimersAsync();

        const el = modal.contentEl as unknown as MockElement;
        const checkboxes = el.findAll("lilbee-documents-checkbox");
        expect(checkboxes.length).toBe(1);
    });

    it("Remove selected button is disabled when nothing selected", async () => {
        const plugin = makePlugin();
        plugin.api.listDocuments.mockResolvedValue(makeDocsResponse([makeDoc()]));
        const app = new App();
        const modal = new DocumentsModal(app as any, plugin as any);
        modal.open();
        await vi.runAllTimersAsync();

        const el = modal.contentEl as unknown as MockElement;
        const removeBtn = el.find("lilbee-documents-remove")!;
        expect(removeBtn.disabled).toBe(true);
    });

    it("selecting a checkbox enables Remove button", async () => {
        const plugin = makePlugin();
        plugin.api.listDocuments.mockResolvedValue(makeDocsResponse([makeDoc({ filename: "a.md" })]));
        const app = new App();
        const modal = new DocumentsModal(app as any, plugin as any);
        modal.open();
        await vi.runAllTimersAsync();

        const el = modal.contentEl as unknown as MockElement;
        const checkbox = el.findAll("lilbee-documents-checkbox")[0];
        (checkbox as any).checked = true;
        checkbox.trigger("change");

        const removeBtn = el.find("lilbee-documents-remove")!;
        expect(removeBtn.disabled).toBe(false);
    });

    it("unchecking deselects and disables Remove button", async () => {
        const plugin = makePlugin();
        plugin.api.listDocuments.mockResolvedValue(makeDocsResponse([makeDoc({ filename: "a.md" })]));
        const app = new App();
        const modal = new DocumentsModal(app as any, plugin as any);
        modal.open();
        await vi.runAllTimersAsync();

        const el = modal.contentEl as unknown as MockElement;
        const checkbox = el.findAll("lilbee-documents-checkbox")[0];
        (checkbox as any).checked = true;
        checkbox.trigger("change");
        (checkbox as any).checked = false;
        checkbox.trigger("change");

        const removeBtn = el.find("lilbee-documents-remove")!;
        expect(removeBtn.disabled).toBe(true);
    });

    it("Remove selected calls removeDocuments and refreshes", async () => {
        vi.useRealTimers();
        const plugin = makePlugin();
        plugin.api.listDocuments.mockResolvedValue(makeDocsResponse([makeDoc({ filename: "a.md" })]));
        plugin.api.removeDocuments.mockResolvedValue({ removed: 1, not_found: [] });
        const app = new App();
        const modal = new DocumentsModal(app as any, plugin as any);
        modal.open();
        await tick();

        const el = modal.contentEl as unknown as MockElement;
        const checkbox = el.findAll("lilbee-documents-checkbox")[0];
        (checkbox as any).checked = true;
        checkbox.trigger("change");

        const removeBtn = el.find("lilbee-documents-remove")!;
        removeBtn.trigger("click");
        await tick();
        await tick();

        expect(plugin.api.removeDocuments).toHaveBeenCalledWith(["a.md"], true);
        expect(Notice.instances.some(n => n.message.includes("deleted 1"))).toBe(true);
    });

    it("handles remove failure", async () => {
        vi.useRealTimers();
        const plugin = makePlugin();
        plugin.api.listDocuments.mockResolvedValue(makeDocsResponse([makeDoc({ filename: "a.md" })]));
        plugin.api.removeDocuments.mockRejectedValue(new Error("fail"));
        const app = new App();
        const modal = new DocumentsModal(app as any, plugin as any);
        modal.open();
        await tick();

        const el = modal.contentEl as unknown as MockElement;
        const checkbox = el.findAll("lilbee-documents-checkbox")[0];
        (checkbox as any).checked = true;
        checkbox.trigger("change");

        const removeBtn = el.find("lilbee-documents-remove")!;
        removeBtn.trigger("click");
        await tick();
        await tick();

        expect(Notice.instances.some(n => n.message.includes("failed to delete"))).toBe(true);
    });

    it("does not call removeDocuments when confirm modal is cancelled", async () => {
        vi.useRealTimers();
        mockConfirmResult = false;
        const plugin = makePlugin();
        plugin.api.listDocuments.mockResolvedValue(makeDocsResponse([makeDoc({ filename: "a.md" })]));
        const app = new App();
        const modal = new DocumentsModal(app as any, plugin as any);
        modal.open();
        await tick();

        const el = modal.contentEl as unknown as MockElement;
        const checkbox = el.findAll("lilbee-documents-checkbox")[0];
        (checkbox as any).checked = true;
        checkbox.trigger("change");

        const removeBtn = el.find("lilbee-documents-remove")!;
        removeBtn.trigger("click");
        await tick();
        await tick();

        expect(plugin.api.removeDocuments).not.toHaveBeenCalled();
    });

    it("shows Load more when total > loaded", async () => {
        const docs = Array.from({ length: 20 }, (_, i) => makeDoc({ filename: `f${i}.md` }));
        const plugin = makePlugin();
        plugin.api.listDocuments.mockResolvedValue(makeDocsResponse(docs, 40));
        const app = new App();
        const modal = new DocumentsModal(app as any, plugin as any);
        modal.open();
        await vi.runAllTimersAsync();

        const el = modal.contentEl as unknown as MockElement;
        const loadMore = el.find("lilbee-documents-load-more")!;
        expect(loadMore.style.display).toBe("");
    });

    it("hides Load more when all loaded", async () => {
        const plugin = makePlugin();
        plugin.api.listDocuments.mockResolvedValue(makeDocsResponse([makeDoc()], 1));
        const app = new App();
        const modal = new DocumentsModal(app as any, plugin as any);
        modal.open();
        await vi.runAllTimersAsync();

        const el = modal.contentEl as unknown as MockElement;
        const loadMore = el.find("lilbee-documents-load-more")!;
        expect(loadMore.style.display).toBe("none");
    });

    it("Load more fetches next page", async () => {
        const page1 = Array.from({ length: 20 }, (_, i) => makeDoc({ filename: `f${i}.md` }));
        const page2 = [makeDoc({ filename: "f20.md" })];
        const plugin = makePlugin();
        plugin.api.listDocuments
            .mockResolvedValueOnce(makeDocsResponse(page1, 21))
            .mockResolvedValueOnce(makeDocsResponse(page2, 21));
        const app = new App();
        const modal = new DocumentsModal(app as any, plugin as any);
        modal.open();
        await vi.runAllTimersAsync();

        const el = modal.contentEl as unknown as MockElement;
        const loadMore = el.find("lilbee-documents-load-more")!;
        loadMore.trigger("click");
        await vi.runAllTimersAsync();

        expect(plugin.api.listDocuments).toHaveBeenCalledTimes(2);
        expect(plugin.api.listDocuments).toHaveBeenLastCalledWith(undefined, 20, 20);
    });

    it("search input triggers debounced fetch", async () => {
        const plugin = makePlugin();
        plugin.api.listDocuments.mockResolvedValue(makeDocsResponse());
        const app = new App();
        const modal = new DocumentsModal(app as any, plugin as any);
        modal.open();
        await vi.runAllTimersAsync();

        const el = modal.contentEl as unknown as MockElement;
        const searchInput = el.find("lilbee-documents-search")!;
        (searchInput as any).value = "test";
        searchInput.trigger("input");

        const callsBefore = plugin.api.listDocuments.mock.calls.length;
        await vi.advanceTimersByTimeAsync(300);
        await vi.runAllTimersAsync();

        expect(plugin.api.listDocuments.mock.calls.length).toBeGreaterThan(callsBefore);
        expect(plugin.api.listDocuments).toHaveBeenLastCalledWith("test", 20, 0);
    });

    it("handles fetch failure", async () => {
        vi.useRealTimers();
        const plugin = makePlugin();
        plugin.api.listDocuments.mockRejectedValue(new Error("network"));
        const app = new App();
        const modal = new DocumentsModal(app as any, plugin as any);
        modal.open();
        await tick();

        expect(Notice.instances.some(n => n.message.includes("failed to load documents"))).toBe(true);
    });

    it("onClose cleans up debounce timer", () => {
        const plugin = makePlugin();
        const app = new App();
        const modal = new DocumentsModal(app as any, plugin as any);
        modal.onClose();
        // Should not throw
    });

    it("search input debounce: first input with null timer, second clears existing", async () => {
        const plugin = makePlugin();
        plugin.api.listDocuments.mockResolvedValue(makeDocsResponse());
        const app = new App();
        const modal = new DocumentsModal(app as any, plugin as any);
        expect((modal as any).debounceTimer).toBeNull();
        modal.open();
        await vi.runAllTimersAsync();

        const el = modal.contentEl as unknown as MockElement;
        const searchInput = el.find("lilbee-documents-search")!;

        // First input: debounceTimer is null (false branch at line 38)
        (searchInput as any).value = "a";
        searchInput.trigger("input");

        // Second input before debounce fires: debounceTimer is set (true branch at line 38)
        (searchInput as any).value = "ab";
        searchInput.trigger("input");

        await vi.advanceTimersByTimeAsync(300);
        await vi.runAllTimersAsync();

        expect(plugin.api.listDocuments.mock.calls.length).toBeGreaterThan(1);
    });

    it("onClose with no debounce timer does not throw (false branch at line 65)", () => {
        const plugin = makePlugin();
        const app = new App();
        const modal = new DocumentsModal(app as any, plugin as any);
        expect((modal as any).debounceTimer).toBeNull();
        modal.onClose();
    });

    it("onClose with active debounce timer clears it", async () => {
        const plugin = makePlugin();
        plugin.api.listDocuments.mockResolvedValue(makeDocsResponse());
        const app = new App();
        const modal = new DocumentsModal(app as any, plugin as any);
        modal.open();
        await vi.runAllTimersAsync();

        const el = modal.contentEl as unknown as MockElement;
        const searchInput = el.find("lilbee-documents-search")!;
        (searchInput as any).value = "test";
        searchInput.trigger("input");
        expect((modal as any).debounceTimer).not.toBeNull();
        modal.onClose();
    });

    it("updateLoadMore returns early when loadMoreBtn is null", () => {
        const plugin = makePlugin();
        const app = new App();
        const modal = new DocumentsModal(app as any, plugin as any);
        (modal as any).loadMoreBtn = null;
        (modal as any).updateLoadMore();
        // Should not throw
    });

    it("updateRemoveBtn returns early when removeBtn is null", () => {
        const plugin = makePlugin();
        const app = new App();
        const modal = new DocumentsModal(app as any, plugin as any);
        (modal as any).removeBtn = null;
        (modal as any).updateRemoveBtn();
        // Should not throw
    });

    it("renderRow returns early when resultsEl is null", () => {
        const plugin = makePlugin();
        const app = new App();
        const modal = new DocumentsModal(app as any, plugin as any);
        (modal as any).resultsEl = null;
        (modal as any).renderRow(makeDoc());
        // Should not throw
    });

    it("does not call removeDocuments when nothing selected", async () => {
        vi.useRealTimers();
        const plugin = makePlugin();
        plugin.api.listDocuments.mockResolvedValue(makeDocsResponse([makeDoc()]));
        const app = new App();
        const modal = new DocumentsModal(app as any, plugin as any);
        modal.open();
        await tick();

        const el = modal.contentEl as unknown as MockElement;
        const removeBtn = el.find("lilbee-documents-remove")!;
        removeBtn.trigger("click");
        await tick();

        expect(plugin.api.removeDocuments).not.toHaveBeenCalled();
    });
});
