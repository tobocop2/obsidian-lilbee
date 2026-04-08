import { describe, it, expect, vi } from "vitest";
import { MockElement } from "../__mocks__/obsidian";
import { renderModelCard, renderBrowseMoreCard } from "../../src/components/model-card";
import { PILL_CLS } from "../../src/components/pill";
import type { ModelFamily, ModelVariant } from "../../src/types";
import { MESSAGES } from "../../src/locales/en";

function makeVariant(overrides: Partial<ModelVariant> = {}): ModelVariant {
    return {
        name: "test-model:q4",
        hf_repo: "org/test-model-q4",
        size_gb: 4.2,
        min_ram_gb: 8,
        description: "A test model",
        task: "chat",
        installed: false,
        source: "native",
        ...overrides,
    };
}

function makeFamily(overrides: Partial<ModelFamily> = {}): ModelFamily {
    return {
        family: "test-model",
        task: "chat",
        featured: false,
        recommended: "test-model:q4",
        variants: [makeVariant()],
        ...overrides,
    };
}

function container(): HTMLElement {
    return new MockElement() as unknown as HTMLElement;
}

describe("renderModelCard", () => {
    it("creates card with correct structure", () => {
        const c = container();
        const family = makeFamily();
        const variant = makeVariant();
        const card = renderModelCard(c, family, variant, {}) as unknown as MockElement;

        expect(card.classList.contains("lilbee-model-card")).toBe(true);
        expect(card.dataset.repo).toBe("org/test-model-q4");
        expect(card.find("lilbee-model-card-header")).not.toBeNull();
        expect(card.find("lilbee-model-card-specs")).not.toBeNull();
        expect(card.find("lilbee-model-card-status")).not.toBeNull();
    });

    it("shows display_name when present", () => {
        const c = container();
        const variant = makeVariant({ display_name: "Test Model Q4" });
        const card = renderModelCard(c, makeFamily(), variant, {}) as unknown as MockElement;
        const name = card.find("lilbee-model-card-name");
        expect(name?.textContent).toBe("Test Model Q4");
    });

    it("falls back to name when display_name absent", () => {
        const c = container();
        const variant = makeVariant({ display_name: undefined });
        const card = renderModelCard(c, makeFamily(), variant, {}) as unknown as MockElement;
        const name = card.find("lilbee-model-card-name");
        expect(name?.textContent).toBe("test-model:q4");
    });

    it("shows task pill", () => {
        const c = container();
        const card = renderModelCard(c, makeFamily(), makeVariant(), {}) as unknown as MockElement;
        const pill = card.find(PILL_CLS.TASK_CHAT);
        expect(pill).not.toBeNull();
        expect(pill?.textContent).toBe("chat");
    });

    it("falls back to family task when variant task is empty", () => {
        const c = container();
        const family = makeFamily({ task: "vision" });
        const variant = makeVariant({ task: "" });
        const card = renderModelCard(c, family, variant, {}) as unknown as MockElement;
        const pill = card.find(PILL_CLS.TASK_VISION);
        expect(pill).not.toBeNull();
        expect(pill?.textContent).toBe("vision");
    });

    it("shows pick pill when family is featured", () => {
        const c = container();
        const family = makeFamily({ featured: true });
        const card = renderModelCard(c, family, makeVariant(), {}) as unknown as MockElement;
        expect(card.find(PILL_CLS.PICK)).not.toBeNull();
    });

    it("shows pick pill when variant has featured flag", () => {
        const c = container();
        const variant = makeVariant({ featured: true });
        const card = renderModelCard(c, makeFamily(), variant, {}) as unknown as MockElement;
        expect(card.find(PILL_CLS.PICK)).not.toBeNull();
    });

    it("does not show pick pill when not featured", () => {
        const c = container();
        const card = renderModelCard(c, makeFamily(), makeVariant(), {}) as unknown as MockElement;
        expect(card.find(PILL_CLS.PICK)).toBeNull();
    });

    it("renders specs with quality_tier and size", () => {
        const c = container();
        const variant = makeVariant({ quality_tier: "Q4_K_M", size_gb: 4.2 });
        const card = renderModelCard(c, makeFamily(), variant, {}) as unknown as MockElement;
        const specs = card.find("lilbee-model-card-specs");
        expect(specs?.textContent).toBe("Q4_K_M \u00B7 4.2 GB");
    });

    it("renders specs without quality_tier", () => {
        const c = container();
        const variant = makeVariant({ quality_tier: undefined });
        const card = renderModelCard(c, makeFamily(), variant, {}) as unknown as MockElement;
        const specs = card.find("lilbee-model-card-specs");
        expect(specs?.textContent).toBe("4.2 GB");
    });

    it("shows installed pill when variant is installed", () => {
        const c = container();
        const variant = makeVariant({ installed: true });
        const card = renderModelCard(c, makeFamily(), variant, {}) as unknown as MockElement;
        expect(card.find(PILL_CLS.INSTALLED)).not.toBeNull();
    });

    it("shows download count when not installed and has downloads", () => {
        const c = container();
        const variant = makeVariant({ downloads: 1500 });
        const card = renderModelCard(c, makeFamily(), variant, {}) as unknown as MockElement;
        const dl = card.find("lilbee-model-card-downloads");
        expect(dl?.textContent).toBe("1.5K downloads");
    });

    it("formats downloads in millions", () => {
        const c = container();
        const variant = makeVariant({ downloads: 2_500_000 });
        const card = renderModelCard(c, makeFamily(), variant, {}) as unknown as MockElement;
        const dl = card.find("lilbee-model-card-downloads");
        expect(dl?.textContent).toBe("2.5M downloads");
    });

    it("formats small download counts", () => {
        const c = container();
        const variant = makeVariant({ downloads: 42 });
        const card = renderModelCard(c, makeFamily(), variant, {}) as unknown as MockElement;
        const dl = card.find("lilbee-model-card-downloads");
        expect(dl?.textContent).toBe("42 downloads");
    });

    it("does not show downloads when installed", () => {
        const c = container();
        const variant = makeVariant({ installed: true, downloads: 5000 });
        const card = renderModelCard(c, makeFamily(), variant, {}) as unknown as MockElement;
        expect(card.find("lilbee-model-card-downloads")).toBeNull();
        expect(card.find(PILL_CLS.INSTALLED)).not.toBeNull();
    });

    describe("actions", () => {
        it("does not render actions when showActions is false", () => {
            const c = container();
            const card = renderModelCard(c, makeFamily(), makeVariant(), {
                showActions: false,
            }) as unknown as MockElement;
            expect(card.find("lilbee-model-card-actions")).toBeNull();
        });

        it("does not render actions when showActions is undefined", () => {
            const c = container();
            const card = renderModelCard(c, makeFamily(), makeVariant(), {}) as unknown as MockElement;
            expect(card.find("lilbee-model-card-actions")).toBeNull();
        });

        it("shows Pull button for non-installed variant", () => {
            const c = container();
            const card = renderModelCard(c, makeFamily(), makeVariant(), {
                showActions: true,
            }) as unknown as MockElement;
            const pullBtn = card.find("lilbee-catalog-pull");
            expect(pullBtn).not.toBeNull();
            expect(pullBtn?.textContent).toBe(MESSAGES.BUTTON_PULL);
        });

        it("shows Use and Remove buttons for installed variant", () => {
            const c = container();
            const variant = makeVariant({ installed: true });
            const card = renderModelCard(c, makeFamily(), variant, {
                showActions: true,
            }) as unknown as MockElement;
            expect(card.find("lilbee-catalog-use")).not.toBeNull();
            expect(card.find("lilbee-catalog-remove")).not.toBeNull();
        });

        it("shows Active label when isActive", () => {
            const c = container();
            const variant = makeVariant({ installed: true });
            const card = renderModelCard(c, makeFamily(), variant, {
                showActions: true,
                isActive: true,
            }) as unknown as MockElement;
            expect(card.find("lilbee-catalog-active")).not.toBeNull();
            expect(card.find("lilbee-catalog-use")).toBeNull();
        });

        it("adds is-selected class when isActive", () => {
            const c = container();
            const card = renderModelCard(c, makeFamily(), makeVariant(), {
                isActive: true,
            }) as unknown as MockElement;
            expect(card.classList.contains("is-selected")).toBe(true);
        });

        it("calls onPull when Pull button clicked", () => {
            const c = container();
            const family = makeFamily();
            const variant = makeVariant();
            const onPull = vi.fn();
            const card = renderModelCard(c, family, variant, {
                showActions: true,
                onPull,
            }) as unknown as MockElement;
            const btn = card.find("lilbee-catalog-pull")!;
            btn.trigger("click");
            expect(onPull).toHaveBeenCalledWith(family, variant, btn);
        });

        it("calls onUse when Use button clicked", () => {
            const c = container();
            const family = makeFamily();
            const variant = makeVariant({ installed: true });
            const onUse = vi.fn();
            const card = renderModelCard(c, family, variant, {
                showActions: true,
                onUse,
            }) as unknown as MockElement;
            const btn = card.find("lilbee-catalog-use")!;
            btn.trigger("click");
            expect(onUse).toHaveBeenCalledWith(family, variant, btn);
        });

        it("calls onRemove when Remove button clicked", () => {
            const c = container();
            const variant = makeVariant({ installed: true });
            const onRemove = vi.fn();
            const card = renderModelCard(c, makeFamily(), variant, {
                showActions: true,
                onRemove,
            }) as unknown as MockElement;
            const btn = card.find("lilbee-catalog-remove")!;
            btn.trigger("click");
            expect(onRemove).toHaveBeenCalledWith(variant, btn);
        });
    });

    describe("onClick", () => {
        it("calls onClick when card is clicked", () => {
            const c = container();
            const family = makeFamily();
            const variant = makeVariant();
            const onClick = vi.fn();
            const card = renderModelCard(c, family, variant, { onClick }) as unknown as MockElement;
            card.trigger("click", { target: { tagName: "DIV" } });
            expect(onClick).toHaveBeenCalledWith(family, variant);
        });

        it("does not call onClick when button is clicked", () => {
            const c = container();
            const onClick = vi.fn();
            const card = renderModelCard(c, makeFamily(), makeVariant(), {
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
