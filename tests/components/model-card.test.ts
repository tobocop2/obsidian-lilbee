import { describe, it, expect, vi } from "vitest";
import { MockElement } from "../__mocks__/obsidian";
import { renderModelCard, renderBrowseMoreCard } from "../../src/components/model-card";
import { PILL_CLS } from "../../src/components/pill";
import type { CatalogEntry } from "../../src/types";
import { MESSAGES } from "../../src/locales/en";

function makeEntry(overrides: Partial<CatalogEntry> = {}): CatalogEntry {
    return {
        name: "qwen3:8b",
        display_name: "Qwen3 8B",
        size_gb: 5,
        min_ram_gb: 8,
        description: "Medium — strong general purpose",
        quality_tier: "balanced",
        installed: false,
        source: "native",
        ...overrides,
    };
}

function container(): HTMLElement {
    return new MockElement() as unknown as HTMLElement;
}

describe("renderModelCard", () => {
    it("creates card with correct structure", () => {
        const c = container();
        const card = renderModelCard(c, makeEntry(), {}) as unknown as MockElement;

        expect(card.classList.contains("lilbee-model-card")).toBe(true);
        expect(card.dataset.name).toBe("qwen3:8b");
        expect(card.find("lilbee-model-card-header")).not.toBeNull();
        expect(card.find("lilbee-model-card-specs")).not.toBeNull();
        expect(card.find("lilbee-model-card-status")).not.toBeNull();
    });

    it("shows display_name in the header", () => {
        const c = container();
        const card = renderModelCard(c, makeEntry({ display_name: "Qwen3 0.6B" }), {}) as unknown as MockElement;
        const name = card.find("lilbee-model-card-name");
        expect(name?.textContent).toBe("Qwen3 0.6B");
    });

    it("renders specs with quality_tier and size", () => {
        const c = container();
        const entry = makeEntry({ quality_tier: "balanced", size_gb: 4.2 });
        const card = renderModelCard(c, entry, {}) as unknown as MockElement;
        const specs = card.find("lilbee-model-card-specs");
        expect(specs?.textContent).toBe("balanced \u00B7 4.2 GB");
    });

    it("renders specs without quality_tier", () => {
        const c = container();
        const entry = makeEntry({ quality_tier: "" });
        const card = renderModelCard(c, entry, {}) as unknown as MockElement;
        const specs = card.find("lilbee-model-card-specs");
        expect(specs?.textContent).toBe("5 GB");
    });

    it("shows installed pill when entry is installed", () => {
        const c = container();
        const card = renderModelCard(c, makeEntry({ installed: true }), {}) as unknown as MockElement;
        expect(card.find(PILL_CLS.INSTALLED)).not.toBeNull();
    });

    it("does not show installed pill when not installed", () => {
        const c = container();
        const card = renderModelCard(c, makeEntry(), {}) as unknown as MockElement;
        expect(card.find(PILL_CLS.INSTALLED)).toBeNull();
    });

    describe("actions", () => {
        it("does not render actions when showActions is false", () => {
            const c = container();
            const card = renderModelCard(c, makeEntry(), { showActions: false }) as unknown as MockElement;
            expect(card.find("lilbee-model-card-actions")).toBeNull();
        });

        it("does not render actions when showActions is undefined", () => {
            const c = container();
            const card = renderModelCard(c, makeEntry(), {}) as unknown as MockElement;
            expect(card.find("lilbee-model-card-actions")).toBeNull();
        });

        it("shows Pull button for non-installed entry", () => {
            const c = container();
            const card = renderModelCard(c, makeEntry(), { showActions: true }) as unknown as MockElement;
            const pullBtn = card.find("lilbee-catalog-pull");
            expect(pullBtn).not.toBeNull();
            expect(pullBtn?.textContent).toBe(MESSAGES.BUTTON_PULL);
        });

        it("shows Use and Remove buttons for installed entry", () => {
            const c = container();
            const card = renderModelCard(c, makeEntry({ installed: true }), {
                showActions: true,
            }) as unknown as MockElement;
            expect(card.find("lilbee-catalog-use")).not.toBeNull();
            expect(card.find("lilbee-catalog-remove")).not.toBeNull();
        });

        it("shows Active label when isActive", () => {
            const c = container();
            const card = renderModelCard(c, makeEntry({ installed: true }), {
                showActions: true,
                isActive: true,
            }) as unknown as MockElement;
            expect(card.find("lilbee-catalog-active")).not.toBeNull();
            expect(card.find("lilbee-catalog-use")).toBeNull();
        });

        it("adds is-selected class when isActive", () => {
            const c = container();
            const card = renderModelCard(c, makeEntry(), { isActive: true }) as unknown as MockElement;
            expect(card.classList.contains("is-selected")).toBe(true);
        });

        it("calls onPull when Pull button clicked", () => {
            const c = container();
            const entry = makeEntry();
            const onPull = vi.fn();
            const card = renderModelCard(c, entry, { showActions: true, onPull }) as unknown as MockElement;
            const btn = card.find("lilbee-catalog-pull")!;
            btn.trigger("click");
            expect(onPull).toHaveBeenCalledWith(entry, btn);
        });

        it("does not throw when Pull button clicked without onPull", () => {
            const c = container();
            const card = renderModelCard(c, makeEntry(), { showActions: true }) as unknown as MockElement;
            const btn = card.find("lilbee-catalog-pull")!;
            expect(() => btn.trigger("click")).not.toThrow();
        });

        it("calls onUse when Use button clicked", () => {
            const c = container();
            const entry = makeEntry({ installed: true });
            const onUse = vi.fn();
            const card = renderModelCard(c, entry, { showActions: true, onUse }) as unknown as MockElement;
            const btn = card.find("lilbee-catalog-use")!;
            btn.trigger("click");
            expect(onUse).toHaveBeenCalledWith(entry, btn);
        });

        it("does not throw when Use button clicked without onUse", () => {
            const c = container();
            const entry = makeEntry({ installed: true });
            const card = renderModelCard(c, entry, { showActions: true }) as unknown as MockElement;
            const btn = card.find("lilbee-catalog-use")!;
            expect(() => btn.trigger("click")).not.toThrow();
        });

        it("calls onRemove when Remove button clicked", () => {
            const c = container();
            const entry = makeEntry({ installed: true });
            const onRemove = vi.fn();
            const card = renderModelCard(c, entry, { showActions: true, onRemove }) as unknown as MockElement;
            const btn = card.find("lilbee-catalog-remove")!;
            btn.trigger("click");
            expect(onRemove).toHaveBeenCalledWith(entry, btn);
        });

        it("does not throw when Remove button clicked without onRemove", () => {
            const c = container();
            const entry = makeEntry({ installed: true });
            const card = renderModelCard(c, entry, { showActions: true }) as unknown as MockElement;
            const btn = card.find("lilbee-catalog-remove")!;
            expect(() => btn.trigger("click")).not.toThrow();
        });
    });

    describe("onClick", () => {
        it("calls onClick when card is clicked", () => {
            const c = container();
            const entry = makeEntry();
            const onClick = vi.fn();
            const card = renderModelCard(c, entry, { onClick }) as unknown as MockElement;
            card.trigger("click", { target: { tagName: "DIV" } });
            expect(onClick).toHaveBeenCalledWith(entry);
        });

        it("does not call onClick when button is clicked", () => {
            const c = container();
            const onClick = vi.fn();
            const card = renderModelCard(c, makeEntry(), {
                onClick,
                showActions: true,
            }) as unknown as MockElement;
            card.trigger("click", { target: { tagName: "BUTTON" } });
            expect(onClick).not.toHaveBeenCalled();
        });
    });
});

describe("renderBrowseMoreCard", () => {
    it("creates card with correct text and class", () => {
        const c = container();
        const card = renderBrowseMoreCard(c, vi.fn()) as unknown as MockElement;
        expect(card.classList.contains("lilbee-browse-more-card")).toBe(true);
        expect(card.textContent).toBe(MESSAGES.LABEL_BROWSE_MORE);
    });

    it("calls onClick when clicked", () => {
        const c = container();
        const onClick = vi.fn();
        const card = renderBrowseMoreCard(c, onClick) as unknown as MockElement;
        card.trigger("click");
        expect(onClick).toHaveBeenCalled();
    });
});
