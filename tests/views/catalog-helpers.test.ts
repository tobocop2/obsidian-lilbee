import { describe, it, expect, vi } from "vitest";
import { App, MockElement } from "../__mocks__/obsidian";
import {
    deepLinkToApiKeySettings,
    frontierRowsOnly,
    groupByProvider,
    hasReadyFrontierRow,
    KEY_STATUS_PILL_CLASS,
    localRowsOnly,
    renderKeyStatusPill,
    renderProviderPill,
} from "../../src/views/catalog-helpers";
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
        source: "local",
        task: "chat",
        featured: false,
        downloads: 0,
        param_count: "",
        ...overrides,
    };
}

describe("catalog-helpers", () => {
    describe("hasReadyFrontierRow", () => {
        it("returns true when a frontier row has key_status=ready", () => {
            const rows = [
                row({ source: "local" }),
                row({
                    source: "frontier",
                    ...({ key_status: "ready" } as Partial<CatalogEntry>),
                }),
            ];
            expect(hasReadyFrontierRow(rows)).toBe(true);
        });

        it("returns false when no frontier row is ready", () => {
            const rows = [
                row({ source: "local" }),
                row({
                    source: "frontier",
                    ...({ key_status: "missing_key" } as Partial<CatalogEntry>),
                }),
            ];
            expect(hasReadyFrontierRow(rows)).toBe(false);
        });

        it("returns false on an empty list", () => {
            expect(hasReadyFrontierRow([])).toBe(false);
        });
    });

    describe("frontierRowsOnly / localRowsOnly", () => {
        it("partitions rows by source value", () => {
            const rows = [
                row({ source: "local", display_name: "L1" }),
                row({ source: "frontier", display_name: "F1" }),
                row({ source: "local", display_name: "L2" }),
            ];
            expect(frontierRowsOnly(rows).map((r) => r.display_name)).toEqual(["F1"]);
            expect(localRowsOnly(rows).map((r) => r.display_name)).toEqual(["L1", "L2"]);
        });
    });

    describe("groupByProvider", () => {
        it("groups by provider preserving first-seen ordering", () => {
            const rows = [
                row({
                    source: "frontier",
                    display_name: "a",
                    ...({ provider: "OpenAI" } as Partial<CatalogEntry>),
                }),
                row({
                    source: "frontier",
                    display_name: "b",
                    ...({ provider: "Anthropic" } as Partial<CatalogEntry>),
                }),
                row({
                    source: "frontier",
                    display_name: "c",
                    ...({ provider: "OpenAI" } as Partial<CatalogEntry>),
                }),
            ];
            const grouped = groupByProvider(rows);
            expect(grouped.map(([p]) => p)).toEqual(["OpenAI", "Anthropic"]);
            expect(grouped[0][1].map((r) => r.display_name)).toEqual(["a", "c"]);
            expect(grouped[1][1].map((r) => r.display_name)).toEqual(["b"]);
        });

        it("treats missing provider as empty-string group", () => {
            const rows = [row({ source: "frontier", display_name: "a" })];
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
            const originalDocument = (globalThis as any).document;
            (globalThis as any).document = docMock;
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

            (globalThis as any).document = originalDocument;
        });

        it("returns early without throwing when document is undefined at firing time (Node-only test envs)", async () => {
            const originalDocument = (globalThis as any).document;
            // Simulate the post-test cleanup: app.setting is wired but the DOM is gone.
            (globalThis as any).document = undefined;
            const app = new App();
            deepLinkToApiKeySettings(app as any, "OpenAI");
            // Let the inner setTimeout fire — must not throw.
            await new Promise((r) => setTimeout(r, 60));
            (globalThis as any).document = originalDocument;
        });

        it("safely handles a query that finds nothing", async () => {
            const docMock = {
                querySelector: vi.fn().mockReturnValue(null),
            };
            const originalDocument = (globalThis as any).document;
            (globalThis as any).document = docMock;

            const app = new App();
            deepLinkToApiKeySettings(app as any, "MysteryProvider");
            await new Promise((r) => setTimeout(r, 60));
            expect(docMock.querySelector).toHaveBeenCalled();

            (globalThis as any).document = originalDocument;
        });
    });
});
