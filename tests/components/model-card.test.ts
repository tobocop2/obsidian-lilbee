import { describe, it, expect, vi } from "vitest";
import { MockElement } from "../__mocks__/obsidian";
import { renderModelCard } from "../../src/components/model-card";
import { PILL_CLS } from "../../src/components/pill";
import type { CatalogEntry } from "../../src/types";
import { MESSAGES } from "../../src/locales/en";
import * as utils from "../../src/utils";

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
        hf_repo: "qwen/qwen3-8b",
        tag: "8b",
        task: "chat",
        featured: false,
        downloads: 0,
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
        expect(card.dataset.repo).toBe("qwen/qwen3-8b");
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

    it("shows a download count when not installed and downloads > 0", () => {
        const c = container();
        const card = renderModelCard(c, makeEntry({ downloads: 42 }), {}) as unknown as MockElement;
        const dl = card.find("lilbee-model-card-downloads");
        expect(dl?.textContent).toBe("42 downloads");
    });

    it("formats download counts in thousands", () => {
        const c = container();
        const card = renderModelCard(c, makeEntry({ downloads: 1500 }), {}) as unknown as MockElement;
        expect(card.find("lilbee-model-card-downloads")?.textContent).toBe("1.5K downloads");
    });

    it("formats download counts in millions", () => {
        const c = container();
        const card = renderModelCard(c, makeEntry({ downloads: 2_500_000 }), {}) as unknown as MockElement;
        expect(card.find("lilbee-model-card-downloads")?.textContent).toBe("2.5M downloads");
    });

    it("renders a task pill in the header", () => {
        const c = container();
        const card = renderModelCard(c, makeEntry({ task: "vision" }), {}) as unknown as MockElement;
        expect(card.find(PILL_CLS.TASK_VISION)).not.toBeNull();
    });

    it("renders a pick pill when the entry is featured", () => {
        const c = container();
        const card = renderModelCard(c, makeEntry({ featured: true }), {}) as unknown as MockElement;
        expect(card.find(PILL_CLS.PICK)).not.toBeNull();
    });

    it("omits the pick pill when the entry is not featured", () => {
        const c = container();
        const card = renderModelCard(c, makeEntry({ featured: false }), {}) as unknown as MockElement;
        expect(card.find(PILL_CLS.PICK)).toBeNull();
    });

    it("renders a provider pill for non-local sources (post-tui-quality-sweep, source is the discriminator)", () => {
        const c = container();
        const card = renderModelCard(c, makeEntry({ source: "frontier" }), {}) as unknown as MockElement;
        const pill = card.find(PILL_CLS.PROVIDER);
        expect(pill).not.toBeNull();
        expect(pill?.textContent).toBe("frontier");
    });

    it("omits the provider pill for local sources", () => {
        const c = container();
        const card = renderModelCard(c, makeEntry({ source: "local" }), {}) as unknown as MockElement;
        expect(card.find(PILL_CLS.PROVIDER)).toBeNull();
    });

    describe("hardware-fit chip", () => {
        it("renders the green fits chip when entry.fit is 'fits'", () => {
            const c = container();
            const card = renderModelCard(c, makeEntry({ fit: "fits" }), {}) as unknown as MockElement;
            const chip = card.find("lilbee-fit-fits");
            expect(chip).not.toBeNull();
            expect(chip?.textContent).toBe(MESSAGES.LABEL_FIT_FITS);
        });

        it("renders the amber tight chip when entry.fit is 'tight'", () => {
            const c = container();
            const card = renderModelCard(c, makeEntry({ fit: "tight" }), {}) as unknown as MockElement;
            const chip = card.find("lilbee-fit-tight");
            expect(chip).not.toBeNull();
            expect(chip?.textContent).toBe(MESSAGES.LABEL_FIT_TIGHT);
        });

        it("renders the red won't-run chip when entry.fit is 'wont_run'", () => {
            const c = container();
            const card = renderModelCard(c, makeEntry({ fit: "wont_run" }), {}) as unknown as MockElement;
            const chip = card.find("lilbee-fit-wont_run");
            expect(chip).not.toBeNull();
            expect(chip?.textContent).toBe(MESSAGES.LABEL_FIT_WONT_RUN);
        });

        it("computes fit client-side when entry.fit is missing and min_ram_gb is set", () => {
            const c = container();
            const card = renderModelCard(c, makeEntry({ min_ram_gb: 1 }), {}) as unknown as MockElement;
            // System memory probe returns the host's RAM; whichever bucket the
            // system lands in, exactly one of the three chips must render.
            const chips = ["lilbee-fit-fits", "lilbee-fit-tight", "lilbee-fit-wont_run"]
                .map((cls) => card.find(cls))
                .filter((el) => el !== null);
            expect(chips.length).toBe(1);
        });

        it("omits the chip for frontier rows", () => {
            const c = container();
            const card = renderModelCard(c, makeEntry({ source: "frontier" }), {}) as unknown as MockElement;
            expect(card.find("lilbee-fit-fits")).toBeNull();
            expect(card.find("lilbee-fit-tight")).toBeNull();
            expect(card.find("lilbee-fit-wont_run")).toBeNull();
        });

        it("omits the chip when min_ram_gb is missing or zero", () => {
            const c = container();
            const card = renderModelCard(c, makeEntry({ min_ram_gb: 0 }), {}) as unknown as MockElement;
            expect(card.find("lilbee-fit-fits")).toBeNull();
            expect(card.find("lilbee-fit-tight")).toBeNull();
            expect(card.find("lilbee-fit-wont_run")).toBeNull();
        });

        it("omits the chip when system memory cannot be probed", () => {
            const spy = vi.spyOn(utils, "getSystemMemoryGB").mockReturnValue(null);
            try {
                const c = container();
                const card = renderModelCard(c, makeEntry({ min_ram_gb: 4 }), {}) as unknown as MockElement;
                expect(card.find("lilbee-fit-fits")).toBeNull();
                expect(card.find("lilbee-fit-tight")).toBeNull();
                expect(card.find("lilbee-fit-wont_run")).toBeNull();
            } finally {
                spy.mockRestore();
            }
        });
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

        it("adds is-featured class when entry is featured", () => {
            const c = container();
            const card = renderModelCard(c, makeEntry({ featured: true }), {}) as unknown as MockElement;
            expect(card.classList.contains("is-featured")).toBe(true);
        });

        it("does not add is-featured class when entry is not featured", () => {
            const c = container();
            const card = renderModelCard(c, makeEntry({ featured: false }), {}) as unknown as MockElement;
            expect(card.classList.contains("is-featured")).toBe(false);
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
