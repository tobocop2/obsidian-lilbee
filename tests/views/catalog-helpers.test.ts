import { describe, it, expect, vi } from "vitest";
import { App, MockElement } from "../__mocks__/obsidian";
import {
    deepLinkToApiKeySettings,
    forYouRail,
    freshRail,
    groupByProvider,
    hasReadyHostedRow,
    hostedOptions,
    hostedRowsOnly,
    KEY_STATUS_PILL_CLASS,
    localRowsOnly,
    renderKeyStatusPill,
    renderProviderPill,
    tabIdToTask,
    taskToTabId,
    yourCollectionRail,
} from "../../src/views/catalog-helpers";
import { CATALOG_SOURCE, CATALOG_TAB, KEY_STATUS } from "../../src/types";
import type { CatalogEntry } from "../../src/types";

function row(overrides: Partial<CatalogEntry> = {}): CatalogEntry {
    return {
        hf_repo: "h/r",
        gguf_filename: "",
        display_name: "x",
        size_gb: 0,
        min_ram_gb: 0,
        description: "",
        quality_tier: "",
        installed: false,
        source: "native",
        task: "chat",
        featured: false,
        downloads: 0,
        param_count: "",
        ...overrides,
    };
}

describe("catalog-helpers", () => {
    describe("hasReadyHostedRow", () => {
        it("returns true when a frontier row has key_status=ready", () => {
            const rows = [
                row({ source: CATALOG_SOURCE.NATIVE }),
                row({ source: CATALOG_SOURCE.FRONTIER, key_status: KEY_STATUS.READY }),
            ];
            expect(hasReadyHostedRow(rows)).toBe(true);
        });

        it("returns false when the only frontier row is missing its key", () => {
            const rows = [
                row({ source: CATALOG_SOURCE.NATIVE }),
                row({ source: CATALOG_SOURCE.FRONTIER, key_status: KEY_STATUS.MISSING_KEY }),
            ];
            expect(hasReadyHostedRow(rows)).toBe(false);
        });

        it("treats ollama rows as always ready (no key needed)", () => {
            expect(hasReadyHostedRow([row({ source: CATALOG_SOURCE.OLLAMA })])).toBe(true);
        });

        it("treats lm_studio rows as always ready (no key needed)", () => {
            expect(hasReadyHostedRow([row({ source: CATALOG_SOURCE.LM_STUDIO })])).toBe(true);
        });

        it("returns false on an empty list", () => {
            expect(hasReadyHostedRow([])).toBe(false);
        });
    });

    describe("hostedRowsOnly / localRowsOnly", () => {
        it("partitions rows by hosted vs native source", () => {
            const rows = [
                row({ source: CATALOG_SOURCE.NATIVE, display_name: "L1" }),
                row({ source: CATALOG_SOURCE.FRONTIER, display_name: "F1" }),
                row({ source: CATALOG_SOURCE.OLLAMA, display_name: "O1" }),
                row({ source: CATALOG_SOURCE.NATIVE, display_name: "L2" }),
            ];
            expect(hostedRowsOnly(rows).map((r) => r.display_name)).toEqual(["F1", "O1"]);
            expect(localRowsOnly(rows).map((r) => r.display_name)).toEqual(["L1", "L2"]);
        });
    });

    describe("hostedOptions", () => {
        it("includes ollama always and frontier only with a ready key, local server first", () => {
            const rows = [
                row({ source: CATALOG_SOURCE.NATIVE, hf_repo: "n/r", display_name: "N" }),
                row({
                    source: CATALOG_SOURCE.FRONTIER,
                    hf_repo: "gemini/g",
                    display_name: "Gemini Flash",
                    provider: "Gemini",
                    key_status: KEY_STATUS.READY,
                }),
                row({
                    source: CATALOG_SOURCE.FRONTIER,
                    hf_repo: "openai/x",
                    display_name: "GPT",
                    provider: "OpenAI",
                    key_status: KEY_STATUS.MISSING_KEY,
                }),
                row({ source: CATALOG_SOURCE.OLLAMA, hf_repo: "ollama/l", display_name: "Llama", provider: "Ollama" }),
            ];
            expect(hostedOptions(rows)).toEqual([
                ["ollama/l", "Llama [Ollama]"],
                ["gemini/g", "Gemini Flash [Gemini]"],
            ]);
        });

        it("orders local servers ahead of frontier, then by provider, then by name", () => {
            const rows = [
                row({
                    source: CATALOG_SOURCE.FRONTIER,
                    hf_repo: "openai/b",
                    display_name: "GPT-B",
                    provider: "OpenAI",
                    key_status: KEY_STATUS.READY,
                }),
                row({
                    source: CATALOG_SOURCE.FRONTIER,
                    hf_repo: "openai/a",
                    display_name: "GPT-A",
                    provider: "OpenAI",
                    key_status: KEY_STATUS.READY,
                }),
                row({
                    source: CATALOG_SOURCE.FRONTIER,
                    hf_repo: "gemini/g",
                    display_name: "Gemini",
                    provider: "Gemini",
                    key_status: KEY_STATUS.READY,
                }),
                row({ source: CATALOG_SOURCE.LM_STUDIO, hf_repo: "lm/q", display_name: "Qwen", provider: "LM Studio" }),
                row({ source: CATALOG_SOURCE.OLLAMA, hf_repo: "ollama/l", display_name: "Llama", provider: "Ollama" }),
            ];
            expect(hostedOptions(rows).map(([ref]) => ref)).toEqual([
                "lm/q", // local: "LM Studio" < "Ollama"
                "ollama/l",
                "gemini/g", // frontier: "Gemini" < "OpenAI"
                "openai/a", // same provider → by name "GPT-A" < "GPT-B"
                "openai/b",
            ]);
        });

        it("omits the provider suffix when a hosted row carries none", () => {
            const rows = [row({ source: CATALOG_SOURCE.OLLAMA, hf_repo: "ollama/l", display_name: "Llama" })];
            expect(hostedOptions(rows)).toEqual([["ollama/l", "Llama"]]);
        });

        it("falls back to name ordering when provider-less rows of the same source are compared", () => {
            const rows = [
                row({ source: CATALOG_SOURCE.OLLAMA, hf_repo: "ollama/z", display_name: "Zeta" }),
                row({ source: CATALOG_SOURCE.OLLAMA, hf_repo: "ollama/a", display_name: "Alpha" }),
            ];
            expect(hostedOptions(rows).map(([ref]) => ref)).toEqual(["ollama/a", "ollama/z"]);
        });

        it("lists lm_studio rows alongside ollama (both local servers, no key)", () => {
            const rows = [
                row({
                    source: CATALOG_SOURCE.LM_STUDIO,
                    hf_repo: "lm_studio/qwen",
                    display_name: "Qwen",
                    provider: "LM Studio",
                }),
            ];
            expect(hostedOptions(rows)).toEqual([["lm_studio/qwen", "Qwen [LM Studio]"]]);
        });
    });

    describe("groupByProvider", () => {
        it("groups by provider, alphabetical within the same source rank", () => {
            const rows = [
                row({ source: CATALOG_SOURCE.FRONTIER, display_name: "a", provider: "OpenAI" }),
                row({ source: CATALOG_SOURCE.FRONTIER, display_name: "b", provider: "Anthropic" }),
                row({ source: CATALOG_SOURCE.FRONTIER, display_name: "c", provider: "OpenAI" }),
            ];
            const grouped = groupByProvider(rows);
            expect(grouped.map(([p]) => p)).toEqual(["Anthropic", "OpenAI"]);
            expect(grouped[0][1].map((r) => r.display_name)).toEqual(["b"]);
            expect(grouped[1][1].map((r) => r.display_name)).toEqual(["a", "c"]);
        });

        it("ranks local-server groups (Ollama, LM Studio) ahead of frontier groups", () => {
            const rows = [
                row({ source: CATALOG_SOURCE.FRONTIER, display_name: "g", provider: "Gemini" }),
                row({ source: CATALOG_SOURCE.OLLAMA, display_name: "l", provider: "Ollama" }),
                row({ source: CATALOG_SOURCE.FRONTIER, display_name: "x", provider: "OpenAI" }),
                row({ source: CATALOG_SOURCE.LM_STUDIO, display_name: "q", provider: "LM Studio" }),
            ];
            expect(groupByProvider(rows).map(([p]) => p)).toEqual(["LM Studio", "Ollama", "Gemini", "OpenAI"]);
        });

        it("treats missing provider as empty-string group", () => {
            const rows = [row({ source: CATALOG_SOURCE.FRONTIER, display_name: "a" })];
            const grouped = groupByProvider(rows);
            expect(grouped[0][0]).toBe("");
        });
    });

    describe("renderProviderPill", () => {
        it("creates a span with the provider text", () => {
            const parent = new MockElement("div") as unknown as HTMLElement;
            renderProviderPill(parent, "OpenAI");
            const found = (parent as unknown as MockElement).find("lilbee-provider-pill")!;
            expect(found.textContent).toBe("OpenAI");
        });
    });

    describe("renderKeyStatusPill", () => {
        it("renders the Ready pill with the green class", () => {
            const parent = new MockElement("div") as unknown as HTMLElement;
            renderKeyStatusPill(parent, "ready");
            const found = (parent as unknown as MockElement).find(KEY_STATUS_PILL_CLASS.READY)!;
            expect(found.textContent).toBe("Ready");
        });

        it("renders the Needs-key pill with the amber class", () => {
            const parent = new MockElement("div") as unknown as HTMLElement;
            renderKeyStatusPill(parent, "missing_key");
            const found = (parent as unknown as MockElement).find(KEY_STATUS_PILL_CLASS.NEEDS_KEY)!;
            expect(found.textContent).toBe("Needs key");
        });
    });

    describe("deepLinkToApiKeySettings", () => {
        it("opens the lilbee settings tab via app.setting", () => {
            const app = new App();
            deepLinkToApiKeySettings(app as any, "OpenAI");
            expect(app.setting?.open).toHaveBeenCalled();
            expect(app.setting?.openTabById).toHaveBeenCalledWith("lilbee");
        });

        it("is a no-op when app.setting is unavailable (older Obsidian or test stub)", () => {
            const app = new App();
            (app as any).setting = undefined;
            // Should not throw.
            expect(() => deepLinkToApiKeySettings(app as any, "OpenAI")).not.toThrow();
        });

        it("scrolls to the matching API-key input when a data attribute exists", async () => {
            const target = {
                scrollIntoView: vi.fn(),
                focus: vi.fn(),
            };
            const docMock = {
                querySelector: vi.fn().mockReturnValue(target),
            };
            const originalDocument = (globalThis as any).activeDocument;
            (globalThis as any).activeDocument = docMock;
            (globalThis as any).HTMLElement = class {};
            // Force the instanceof check to pass.
            Object.setPrototypeOf(target, (globalThis as any).HTMLElement.prototype);

            const app = new App();
            deepLinkToApiKeySettings(app as any, "OpenAI");
            // setTimeout(50) inside the helper; flush.
            await new Promise((r) => setTimeout(r, 60));
            expect(docMock.querySelector).toHaveBeenCalledWith('[data-lilbee-api-key="openai"]');
            expect(target.scrollIntoView).toHaveBeenCalled();
            expect(target.focus).toHaveBeenCalled();

            (globalThis as any).activeDocument = originalDocument;
        });

        it("returns early without throwing when document is undefined at firing time (Node-only test envs)", async () => {
            const originalDocument = (globalThis as any).activeDocument;
            // Simulate the post-test cleanup: app.setting is wired but the DOM is gone.
            (globalThis as any).activeDocument = undefined;
            const app = new App();
            deepLinkToApiKeySettings(app as any, "OpenAI");
            // Let the inner setTimeout fire — must not throw.
            await new Promise((r) => setTimeout(r, 60));
            (globalThis as any).activeDocument = originalDocument;
        });

        it("Discover rail helpers cover task↔tab routing and ranking", () => {
            // taskToTabId / tabIdToTask round-trip.
            expect(taskToTabId("chat")).toBe(CATALOG_TAB.CHAT);
            expect(taskToTabId("embedding")).toBe(CATALOG_TAB.EMBED);
            expect(taskToTabId("vision")).toBe(CATALOG_TAB.VISION);
            expect(taskToTabId("rerank")).toBe(CATALOG_TAB.RERANK);
            expect(tabIdToTask(CATALOG_TAB.CHAT)).toBe("chat");
            expect(tabIdToTask(CATALOG_TAB.DISCOVER)).toBeNull();
            expect(tabIdToTask(CATALOG_TAB.LIBRARY)).toBeNull();
        });

        it("forYouRail prefers chat-task entries when active chat ref is set", () => {
            const rows = [
                row({ hf_repo: "f/embed", featured: true, task: "embedding", downloads: 100 }),
                row({ hf_repo: "f/chat", featured: true, task: "chat", downloads: 10 }),
                row({ hf_repo: "p/plain", featured: false }),
            ];
            const result = forYouRail(rows, "some/active/file.gguf");
            // Featured chat ranks above featured embed even though embed has more downloads.
            expect(result[0].hf_repo).toBe("f/chat");
            expect(result.length).toBe(2);
        });

        it("forYouRail keeps non-chat before chat when ordering swaps and ties on task", () => {
            // a=embedding (?:1), b=chat (?0) with preferChat active → chat floats up,
            // and the two embedding rows tie on task so the comparator falls through
            // to the downloads tiebreak (aChat === bChat branch).
            const rows = [
                row({ hf_repo: "f/embed-a", featured: true, task: "embedding", downloads: 5 }),
                row({ hf_repo: "f/chat", featured: true, task: "chat", downloads: 0 }),
                row({ hf_repo: "f/embed-b", featured: true, task: "embedding", downloads: 9 }),
                row({ hf_repo: "f/embed-c", featured: true, task: "embedding", downloads: 1 }),
            ];
            const result = forYouRail(rows, "active/ref");
            expect(result.map((r) => r.hf_repo)).toEqual(["f/chat", "f/embed-b", "f/embed-a", "f/embed-c"]);
        });

        it("forYouRail falls back to download order when no active chat ref", () => {
            const rows = [
                row({ hf_repo: "f/low", featured: true, task: "embedding", downloads: 5 }),
                row({ hf_repo: "f/high", featured: true, task: "chat", downloads: 500 }),
            ];
            const result = forYouRail(rows, "");
            expect(result[0].hf_repo).toBe("f/high");
        });

        it("forYouRail caps at 12 entries", () => {
            const rows = Array.from({ length: 20 }, (_, i) => row({ hf_repo: `f/${i}`, featured: true, downloads: i }));
            expect(forYouRail(rows, "").length).toBe(12);
        });

        it("yourCollectionRail returns only installed entries", () => {
            const rows = [row({ hf_repo: "y/in", installed: true }), row({ hf_repo: "y/out", installed: false })];
            expect(yourCollectionRail(rows).map((r) => r.hf_repo)).toEqual(["y/in"]);
        });

        it("freshRail sorts by downloads desc and caps at 12", () => {
            const rows = Array.from({ length: 15 }, (_, i) => row({ hf_repo: `n/${i}`, downloads: i }));
            const result = freshRail(rows);
            expect(result.length).toBe(12);
            expect(result[0].hf_repo).toBe("n/14");
            expect(result[11].hf_repo).toBe("n/3");
        });

        it("safely handles a query that finds nothing", async () => {
            const docMock = {
                querySelector: vi.fn().mockReturnValue(null),
            };
            const originalDocument = (globalThis as any).activeDocument;
            (globalThis as any).activeDocument = docMock;

            const app = new App();
            deepLinkToApiKeySettings(app as any, "MysteryProvider");
            await new Promise((r) => setTimeout(r, 60));
            expect(docMock.querySelector).toHaveBeenCalled();

            (globalThis as any).activeDocument = originalDocument;
        });
    });
});
