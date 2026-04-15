import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { App } from "../__mocks__/obsidian";
import type LilbeePlugin from "../../src/main";
import type { DocumentResult } from "../../src/types";

// Mock the results module before importing SearchModal
vi.mock("../../src/views/results", () => ({
    renderDocumentResult: vi.fn(),
}));

import { SearchModal } from "../../src/views/search-modal";
import { renderDocumentResult } from "../../src/views/results";

function makePlugin(): LilbeePlugin {
    return {
        api: {
            search: vi.fn(),
        },
        settings: {
            serverUrl: "http://localhost:7433",
            topK: 5,
            syncMode: "manual" as const,
            syncDebounceMs: 5000,
            searchChunkType: "all" as const,
            wikiEnabled: true,
        },
        saveSettings: vi.fn(),
    } as unknown as LilbeePlugin;
}

function makeResult(overrides: Partial<DocumentResult> = {}): DocumentResult {
    return {
        source: "doc.md",
        content_type: "text",
        excerpts: [],
        best_relevance: 0.9,
        ...overrides,
    };
}

describe("SearchModal", () => {
    let app: App;
    let plugin: LilbeePlugin;

    beforeEach(() => {
        vi.useFakeTimers();
        app = new App();
        plugin = makePlugin();
        vi.mocked(renderDocumentResult).mockReset();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe("constructor", () => {
        it("creates a search modal", () => {
            const modal = new SearchModal(app, plugin);
            expect(modal).toBeDefined();
        });
    });

    describe("onOpen", () => {
        let modal: SearchModal;

        beforeEach(() => {
            modal = new SearchModal(app, plugin);
            modal.open();
        });

        it("adds lilbee-modal class to contentEl", () => {
            expect(modal.contentEl.classList.contains("lilbee-modal")).toBe(true);
        });

        it("renders h2 with 'Search knowledge base'", () => {
            const headings = modal.contentEl.children.filter((c) => c.tagName === "H2");
            expect(headings.length).toBe(1);
            expect(headings[0].textContent).toBe("Search knowledge base");
        });

        it("creates input with correct placeholder", () => {
            const inputs = modal.contentEl.children.filter((c) => c.tagName === "INPUT");
            expect(inputs.length).toBe(1);
            expect(inputs[0].placeholder).toBe("Type to search...");
        });

        it("applies lilbee-search-input CSS class to input", () => {
            const input = modal.contentEl.children.find((c) => c.tagName === "INPUT")!;
            expect(input.classList.contains("lilbee-search-input")).toBe(true);
        });

        it("creates a results container div", () => {
            const container = modal.contentEl.find("lilbee-modal-results");
            expect(container).not.toBeNull();
        });

        it("renders empty state on open", () => {
            const emptyState = modal.contentEl.find("lilbee-empty-state");
            expect(emptyState).not.toBeNull();
            expect(emptyState!.textContent).toBe("Enter a query to begin.");
        });

        it("debounces search on input event", async () => {
            (plugin.api.search as ReturnType<typeof vi.fn>).mockResolvedValue([]);
            const input = modal.contentEl.children.find((c) => c.tagName === "INPUT")!;

            input.value = "hello";
            input.trigger("input");

            // Not yet called before debounce fires
            expect(plugin.api.search).not.toHaveBeenCalled();

            await vi.advanceTimersByTimeAsync(300);
            expect(plugin.api.search).toHaveBeenCalledWith("hello", 5, "all");
        });

        it("resets debounce timer on rapid input events", async () => {
            (plugin.api.search as ReturnType<typeof vi.fn>).mockResolvedValue([]);
            const input = modal.contentEl.children.find((c) => c.tagName === "INPUT")!;

            input.value = "h";
            input.trigger("input");
            await vi.advanceTimersByTimeAsync(100);

            input.value = "hello";
            input.trigger("input");
            await vi.advanceTimersByTimeAsync(300);

            // Only called once (second debounce)
            expect(plugin.api.search).toHaveBeenCalledTimes(1);
            expect(plugin.api.search).toHaveBeenCalledWith("hello", 5, "all");
        });

        it("does not trigger search for empty input value", async () => {
            (plugin.api.search as ReturnType<typeof vi.fn>).mockResolvedValue([]);
            const input = modal.contentEl.children.find((c) => c.tagName === "INPUT")!;

            input.value = "   "; // whitespace only
            input.trigger("input");
            await vi.advanceTimersByTimeAsync(300);

            // runSearch("") -> shows empty state, no API call
            expect(plugin.api.search).not.toHaveBeenCalled();
            const emptyState = modal.contentEl.find("lilbee-empty-state");
            expect(emptyState!.textContent).toBe("Enter a query to begin.");
        });

        it("focuses input after setTimeout(0)", () => {
            // Advancing timers lets the focus setTimeout fire without errors
            vi.advanceTimersByTime(0);
            // No crash = pass (focus is a no-op on MockElement)
        });
    });

    describe("onClose", () => {
        it("empties contentEl", () => {
            const modal = new SearchModal(app, plugin);
            modal.open();
            // contentEl has children after open
            expect(modal.contentEl.children.length).toBeGreaterThan(0);

            modal.close();
            expect(modal.contentEl.children.length).toBe(0);
        });

        it("clears debounce timer on close", async () => {
            (plugin.api.search as ReturnType<typeof vi.fn>).mockResolvedValue([]);
            const modal = new SearchModal(app, plugin);
            modal.open();

            const input = modal.contentEl.children.find((c) => c.tagName === "INPUT")!;
            input.value = "query";
            input.trigger("input");

            // Close before debounce fires
            modal.close();

            await vi.advanceTimersByTimeAsync(300);
            // Search should not have been called because timer was cleared
            expect(plugin.api.search).not.toHaveBeenCalled();
        });

        it("handles close with no active debounce timer gracefully", () => {
            const modal = new SearchModal(app, plugin);
            modal.open();
            // No input event, so no timer set
            expect(() => modal.close()).not.toThrow();
        });
    });

    describe("runSearch", () => {
        let modal: SearchModal;

        beforeEach(() => {
            modal = new SearchModal(app, plugin);
            modal.open();
        });

        it("shows loading then renders results", async () => {
            const result = makeResult();
            (plugin.api.search as ReturnType<typeof vi.fn>).mockResolvedValue([result]);

            await (modal as any).runSearch("query");

            expect(renderDocumentResult).toHaveBeenCalledWith((modal as any).resultsContainer, result, app);
        });

        it("shows 'No results found.' when results array is empty", async () => {
            (plugin.api.search as ReturnType<typeof vi.fn>).mockResolvedValue([]);

            await (modal as any).runSearch("query");

            const emptyState = modal.contentEl.find("lilbee-empty-state");
            expect(emptyState!.textContent).toBe("No results found.");
        });

        it("shows error message when API throws", async () => {
            (plugin.api.search as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("fail"));

            await (modal as any).runSearch("query");

            const emptyState = modal.contentEl.find("lilbee-empty-state");
            expect(emptyState!.textContent).toBe("Error: could not connect to lilbee server.");
        });

        it("shows empty state for empty query string", async () => {
            await (modal as any).runSearch("");

            expect(plugin.api.search).not.toHaveBeenCalled();
            const emptyState = modal.contentEl.find("lilbee-empty-state");
            expect(emptyState!.textContent).toBe("Enter a query to begin.");
        });

        it("renders multiple results", async () => {
            const results = [makeResult({ source: "a.md" }), makeResult({ source: "b.md" })];
            (plugin.api.search as ReturnType<typeof vi.fn>).mockResolvedValue(results);

            await (modal as any).runSearch("query");

            expect(renderDocumentResult).toHaveBeenCalledTimes(2);
        });

        it("guards against null resultsContainer after results arrive", async () => {
            (plugin.api.search as ReturnType<typeof vi.fn>).mockImplementation(async () => {
                // Null out the container while the API call is in-flight
                (modal as any).resultsContainer = null;
                return [makeResult()];
            });

            // Should not throw
            await expect((modal as any).runSearch("query")).resolves.toBeUndefined();
        });

        it("debounce skips search when lastSearchQuery is empty", async () => {
            const modal = new SearchModal(app, plugin);
            modal.open();
            (modal as any).lastSearchQuery = "";
            await (modal as any).debouncedSearch();
            expect(plugin.api.search).not.toHaveBeenCalled();
        });

        it("debounce executes search when lastSearchQuery is non-empty", async () => {
            (plugin.api.search as ReturnType<typeof vi.fn>).mockResolvedValue([]);
            const modal = new SearchModal(app, plugin);
            modal.open();
            (modal as any).lastSearchQuery = "test";
            await (modal as any).debouncedSearch();
            await vi.runAllTimersAsync();
            expect(plugin.api.search).toHaveBeenCalledWith("test", 5, "all");
        });
    });

    describe("renderEmptyState with null resultsContainer", () => {
        it("returns early without throwing when resultsContainer is null", () => {
            const modal = new SearchModal(app, plugin);
            modal.open();
            (modal as any).resultsContainer = null;
            expect(() => (modal as any).renderEmptyState("msg")).not.toThrow();
        });
    });

    describe("renderLoading with null resultsContainer", () => {
        it("returns early without throwing when resultsContainer is null", () => {
            const modal = new SearchModal(app, plugin);
            modal.open();
            (modal as any).resultsContainer = null;
            expect(() => (modal as any).renderLoading()).not.toThrow();
        });
    });

    describe("renderSearchModeToggle", () => {
        it("renders three search mode buttons", () => {
            const modal = new SearchModal(app, plugin);
            modal.open();
            const modeGroup = modal.contentEl.find("lilbee-search-mode");
            expect(modeGroup).not.toBeNull();
            const buttons = modeGroup!.children.filter((c: any) => c.tagName === "BUTTON");
            expect(buttons).toHaveLength(3);
            expect(buttons[0].textContent).toBe("All");
            expect(buttons[1].textContent).toBe("Wiki");
            expect(buttons[2].textContent).toBe("Raw");
        });

        it("marks the active mode button as active", () => {
            plugin.settings.searchChunkType = "wiki";
            const modal = new SearchModal(app, plugin);
            modal.open();
            const modeGroup = modal.contentEl.find("lilbee-search-mode")!;
            const buttons = modeGroup.children.filter((c: any) => c.tagName === "BUTTON");
            expect(buttons[1].classList.contains("active")).toBe(true);
            expect(buttons[0].classList.contains("active")).toBe(false);
        });

        it("clicking a mode button updates settings.searchChunkType and calls saveSettings", async () => {
            const modal = new SearchModal(app, plugin);
            modal.open();
            const modeGroup = modal.contentEl.find("lilbee-search-mode")!;
            const buttons = modeGroup.children.filter((c: any) => c.tagName === "BUTTON");

            // Click "Wiki" button
            buttons[1].trigger("click");
            expect(plugin.settings.searchChunkType).toBe("wiki");
            expect(plugin.saveSettings).toHaveBeenCalled();
        });

        it("hides wiki button when wikiEnabled is false", () => {
            plugin.settings.wikiEnabled = false;
            const modal = new SearchModal(app, plugin);
            modal.open();
            const modeGroup = modal.contentEl.find("lilbee-search-mode")!;
            const buttons = modeGroup.children.filter((c: any) => c.tagName === "BUTTON");
            expect(buttons).toHaveLength(2);
            expect(buttons[0].textContent).toBe("All");
            expect(buttons[1].textContent).toBe("Raw");
        });

        it("shows wiki button when wikiEnabled is true", () => {
            plugin.settings.wikiEnabled = true;
            const modal = new SearchModal(app, plugin);
            modal.open();
            const modeGroup = modal.contentEl.find("lilbee-search-mode")!;
            const buttons = modeGroup.children.filter((c: any) => c.tagName === "BUTTON");
            expect(buttons).toHaveLength(3);
            expect(buttons[1].textContent).toBe("Wiki");
        });

        it("falls back searchChunkType from wiki to all when wikiEnabled is false", () => {
            plugin.settings.wikiEnabled = false;
            plugin.settings.searchChunkType = "wiki";
            const modal = new SearchModal(app, plugin);
            modal.open();
            expect(plugin.settings.searchChunkType).toBe("all");
        });

        it("clicking a mode button with active query re-triggers search", async () => {
            (plugin.api.search as ReturnType<typeof vi.fn>).mockResolvedValue([]);
            const modal = new SearchModal(app, plugin);
            modal.open();

            // Set a query first
            (modal as any).lastSearchQuery = "test";

            const modeGroup = modal.contentEl.find("lilbee-search-mode")!;
            const buttons = modeGroup.children.filter((c: any) => c.tagName === "BUTTON");
            buttons[1].trigger("click");

            await vi.advanceTimersByTimeAsync(300);
            expect(plugin.api.search).toHaveBeenCalledWith("test", 5, "wiki");
        });
    });
});
