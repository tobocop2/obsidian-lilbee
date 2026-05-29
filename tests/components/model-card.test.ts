import { describe, it, expect, vi } from "vitest";
import { MockElement } from "../__mocks__/obsidian";
import { renderModelCard } from "../../src/components/model-card";
import type { CatalogEntry } from "../../src/types";
import { MESSAGES } from "../../src/locales/en";

function makeEntry(overrides: Partial<CatalogEntry> = {}): CatalogEntry {
    return {
        gguf_filename: "qwen3-8b.gguf",
        display_name: "Qwen3 8B",
        size_gb: 5,
        min_ram_gb: 8,
        description: "Medium — strong general purpose",
        quality_tier: "balanced",
        installed: false,
        source: "native",
        hf_repo: "qwen/qwen3-8b",
        task: "chat",
        featured: false,
        downloads: 0,
        param_count: "8B",
        ...overrides,
    };
}

function container(): HTMLElement {
    return new MockElement() as unknown as HTMLElement;
}

describe("renderModelCard", () => {
    it("creates card with the new editorial structure (head, tags, specs, status)", () => {
        const c = container();
        const card = renderModelCard(c, makeEntry(), {}) as unknown as MockElement;

        expect(card.classList.contains("lilbee-model-card")).toBe(true);
        expect(card.dataset.repo).toBe("qwen/qwen3-8b");
        expect(card.find("lilbee-model-card-head")).not.toBeNull();
        expect(card.find("lilbee-model-card-tags")).not.toBeNull();
        expect(card.find("lilbee-model-card-specs")).not.toBeNull();
        expect(card.find("lilbee-model-card-status")).not.toBeNull();
    });

    it("shows display_name in the head", () => {
        const c = container();
        const card = renderModelCard(c, makeEntry({ display_name: "Qwen3 0.6B" }), {}) as unknown as MockElement;
        const name = card.find("lilbee-model-card-name");
        expect(name?.textContent).toBe("Qwen3 0.6B");
    });

    describe("specs row", () => {
        it("leads with the size in bold and adds quality_tier and params with separators", () => {
            const c = container();
            const entry = makeEntry({ quality_tier: "balanced", size_gb: 4.2, param_count: "8B" });
            const card = renderModelCard(c, entry, {}) as unknown as MockElement;
            const specs = card.find("lilbee-model-card-specs")!;
            const seps = specs.findAll("lilbee-model-card-specs-sep");
            expect(seps.length).toBe(2);
            const text = specs.textContent;
            expect(text).toContain("4.2 GB");
            expect(text).toContain("balanced");
            expect(text).toContain("8B params");
        });

        it("omits separators for empty quality_tier and empty param_count", () => {
            const c = container();
            const entry = makeEntry({ quality_tier: "", param_count: "" });
            const card = renderModelCard(c, entry, {}) as unknown as MockElement;
            const specs = card.find("lilbee-model-card-specs")!;
            expect(specs.findAll("lilbee-model-card-specs-sep").length).toBe(0);
            expect(specs.textContent).toContain("5 GB");
        });
    });

    describe("status row", () => {
        it("renders an installed dot+label when installed and not active", () => {
            const c = container();
            const card = renderModelCard(c, makeEntry({ installed: true }), {}) as unknown as MockElement;
            expect(card.find("lilbee-model-card-status-dot")?.classList.contains("is-installed")).toBe(true);
            const label = card.find("lilbee-model-card-status-label");
            expect(label?.textContent).toBe(MESSAGES.LABEL_INSTALLED);
            expect(label?.classList.contains("is-installed")).toBe(true);
            expect(label?.getAttribute("title")).toBe(MESSAGES.TOOLTIP_MODEL_INSTALLED_SHARED);
        });

        it("omits the shared-installed tooltip when the model is not installed", () => {
            const c = container();
            const card = renderModelCard(c, makeEntry({ installed: false }), {}) as unknown as MockElement;
            const label = card.find("lilbee-model-card-status-label");
            expect(label?.getAttribute("title")).toBeNull();
        });

        it("renders an active dot+label when isActive is true", () => {
            const c = container();
            const card = renderModelCard(c, makeEntry({ installed: true }), {
                isActive: true,
            }) as unknown as MockElement;
            expect(card.find("lilbee-model-card-status-dot")?.classList.contains("is-active")).toBe(true);
            const label = card.find("lilbee-model-card-status-label");
            expect(label?.textContent).toBe(MESSAGES.LABEL_ACTIVE);
        });

        it("renders a download count when not installed and downloads > 0", () => {
            const c = container();
            const card = renderModelCard(c, makeEntry({ downloads: 42 }), {}) as unknown as MockElement;
            const label = card.find("lilbee-model-card-status-label")!;
            expect(label.textContent).toBe("42 downloads");
            expect(label.classList.contains("is-muted")).toBe(true);
        });

        it("formats download counts in thousands", () => {
            const c = container();
            const card = renderModelCard(c, makeEntry({ downloads: 1500 }), {}) as unknown as MockElement;
            expect(card.find("lilbee-model-card-status-label")?.textContent).toBe("1.5K downloads");
        });

        it("formats download counts in millions", () => {
            const c = container();
            const card = renderModelCard(c, makeEntry({ downloads: 2_500_000 }), {}) as unknown as MockElement;
            expect(card.find("lilbee-model-card-status-label")?.textContent).toBe("2.5M downloads");
        });

        it("renders a fit text on the right when fit is set", () => {
            const c = container();
            const card = renderModelCard(c, makeEntry({ fit: "fits" }), {}) as unknown as MockElement;
            const fitText = card.find("lilbee-model-card-fit-text");
            expect(fitText?.textContent).toBe(MESSAGES.LABEL_FIT_FITS);
        });

        it("omits the fit text when fit is null", () => {
            const c = container();
            const card = renderModelCard(c, makeEntry({ fit: null }), {}) as unknown as MockElement;
            expect(card.find("lilbee-model-card-fit-text")).toBeNull();
        });
    });

    describe("tags row", () => {
        it("renders a task tag with the task name and a task-tone class", () => {
            const c = container();
            const card = renderModelCard(c, makeEntry({ task: "vision" }), {}) as unknown as MockElement;
            const tag = card.find("lilbee-tag-task")!;
            expect(tag.textContent).toBe("vision");
            expect(tag.classList.contains("is-vision")).toBe(true);
        });

        it("renders a featured tag when entry is featured", () => {
            const c = container();
            const card = renderModelCard(c, makeEntry({ featured: true }), {}) as unknown as MockElement;
            expect(card.find("lilbee-tag-featured")).not.toBeNull();
        });

        it("omits the featured tag when entry is not featured", () => {
            const c = container();
            const card = renderModelCard(c, makeEntry({ featured: false }), {}) as unknown as MockElement;
            expect(card.find("lilbee-tag-featured")).toBeNull();
        });

        it("renders a provider tag for hosted sources, preferring the provider label", () => {
            const c = container();
            const card = renderModelCard(
                c,
                makeEntry({ source: "frontier", provider: "Gemini" }),
                {},
            ) as unknown as MockElement;
            const tag = card.find("lilbee-tag-provider");
            expect(tag).not.toBeNull();
            expect(tag?.textContent).toBe("Gemini");
        });

        it("renders a provider tag for ollama rows", () => {
            const c = container();
            const card = renderModelCard(
                c,
                makeEntry({ source: "ollama", provider: "Ollama" }),
                {},
            ) as unknown as MockElement;
            const tag = card.find("lilbee-tag-provider");
            expect(tag).not.toBeNull();
            expect(tag?.textContent).toBe("Ollama");
        });

        it("falls back to the source name when a hosted row carries no provider", () => {
            const c = container();
            const card = renderModelCard(c, makeEntry({ source: "frontier" }), {}) as unknown as MockElement;
            expect(card.find("lilbee-tag-provider")?.textContent).toBe("frontier");
        });

        it("omits the provider tag for native sources", () => {
            const c = container();
            const card = renderModelCard(c, makeEntry({ source: "native" }), {}) as unknown as MockElement;
            expect(card.find("lilbee-tag-provider")).toBeNull();
        });
    });

    describe("compatibility", () => {
        it("renders an Unsupported badge and dims the card for compat=unsupported", () => {
            const c = container();
            const card = renderModelCard(
                c,
                makeEntry({ compat: "unsupported", architecture: "deepseek v4" }),
                {},
            ) as unknown as MockElement;
            expect(card.classList.contains("is-unsupported")).toBe(true);
            const tag = card.find("lilbee-tag-compat")!;
            expect(tag.textContent).toBe(MESSAGES.LABEL_COMPAT_UNSUPPORTED);
            expect(tag.classList.contains("is-unsupported")).toBe(true);
            expect(tag.getAttribute("title")).toContain("deepseek v4");
        });

        it("renders no badge for compat=unknown (un-probed arch is not surfaced)", () => {
            const c = container();
            const card = renderModelCard(
                c,
                makeEntry({ compat: "unknown", architecture: "mamba" }),
                {},
            ) as unknown as MockElement;
            expect(card.classList.contains("is-unsupported")).toBe(false);
            expect(card.find("lilbee-tag-compat")).toBeNull();
        });

        it("falls back to a generic tooltip when architecture is absent", () => {
            const c = container();
            const unsupported = renderModelCard(
                c,
                makeEntry({ compat: "unsupported", architecture: null }),
                {},
            ) as unknown as MockElement;
            expect(unsupported.find("lilbee-tag-compat")!.getAttribute("title")).toBe(
                MESSAGES.TOOLTIP_COMPAT_UNSUPPORTED(""),
            );
        });

        it("renders no compat badge for supported or unset compat", () => {
            const c = container();
            expect(
                (renderModelCard(c, makeEntry({ compat: "supported" }), {}) as unknown as MockElement).find(
                    "lilbee-tag-compat",
                ),
            ).toBeNull();
            expect(
                (renderModelCard(container(), makeEntry(), {}) as unknown as MockElement).find("lilbee-tag-compat"),
            ).toBeNull();
        });
    });

    describe("fit rail", () => {
        it("adds the is-fits modifier when entry.fit is 'fits'", () => {
            const c = container();
            const card = renderModelCard(c, makeEntry({ fit: "fits" }), {}) as unknown as MockElement;
            expect(card.classList.contains("is-fits")).toBe(true);
        });

        it("adds the is-tight modifier when entry.fit is 'tight'", () => {
            const c = container();
            const card = renderModelCard(c, makeEntry({ fit: "tight" }), {}) as unknown as MockElement;
            expect(card.classList.contains("is-tight")).toBe(true);
        });

        it("adds the is-wont-run modifier when entry.fit is 'wont_run'", () => {
            const c = container();
            const card = renderModelCard(c, makeEntry({ fit: "wont_run" }), {}) as unknown as MockElement;
            expect(card.classList.contains("is-wont-run")).toBe(true);
        });

        it("does not add a fit modifier when entry.fit is null", () => {
            const c = container();
            const card = renderModelCard(c, makeEntry({ fit: null }), {}) as unknown as MockElement;
            expect(card.classList.contains("is-fits")).toBe(false);
            expect(card.classList.contains("is-tight")).toBe(false);
            expect(card.classList.contains("is-wont-run")).toBe(false);
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

        it("shows a disabled Active button when isActive is true", () => {
            const c = container();
            const card = renderModelCard(c, makeEntry({ installed: true }), {
                showActions: true,
                isActive: true,
            }) as unknown as MockElement;
            const activeBtn = card.find("lilbee-btn-active");
            expect(activeBtn).not.toBeNull();
            expect(activeBtn?.textContent).toBe(MESSAGES.LABEL_ACTIVE);
            expect(activeBtn?.attributes["disabled"]).toBe("true");
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

        it("gates the Pull button for unsupported models — disabled, no onPull", () => {
            const c = container();
            const entry = makeEntry({ compat: "unsupported" });
            const onPull = vi.fn();
            const card = renderModelCard(c, entry, { showActions: true, onPull }) as unknown as MockElement;
            const btn = card.find("lilbee-catalog-pull")!;
            expect(btn.classList.contains("is-gated")).toBe(true);
            expect(btn.getAttribute("disabled")).toBe("true");
            expect(btn.getAttribute("title")).toBe(MESSAGES.TOOLTIP_PULL_UNSUPPORTED);
            btn.trigger("click");
            expect(onPull).not.toHaveBeenCalled();
        });

        it("keeps the Pull button live for unknown compatibility", () => {
            const c = container();
            const entry = makeEntry({ compat: "unknown" });
            const onPull = vi.fn();
            const card = renderModelCard(c, entry, { showActions: true, onPull }) as unknown as MockElement;
            const btn = card.find("lilbee-catalog-pull")!;
            expect(btn.classList.contains("is-gated")).toBe(false);
            btn.trigger("click");
            expect(onPull).toHaveBeenCalledWith(entry, btn);
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

        it("invokes onUse for the disabled active button without throwing", () => {
            const c = container();
            const entry = makeEntry({ installed: true });
            const onUse = vi.fn();
            const card = renderModelCard(c, entry, {
                showActions: true,
                isActive: true,
                onUse,
            }) as unknown as MockElement;
            const btn = card.find("lilbee-btn-active")!;
            btn.trigger("click");
            expect(onUse).toHaveBeenCalledWith(entry, btn);
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

    describe("info button", () => {
        it("omits the info button when onInfo is not provided", () => {
            const c = container();
            const card = renderModelCard(c, makeEntry(), {}) as unknown as MockElement;
            expect(card.find("lilbee-model-card-info")).toBeNull();
        });

        it("renders an info button when onInfo is provided", () => {
            const c = container();
            const onInfo = vi.fn();
            const entry = makeEntry();
            const card = renderModelCard(c, entry, { onInfo }) as unknown as MockElement;
            const btn = card.find("lilbee-model-card-info");
            expect(btn).not.toBeNull();
            expect(btn!.attributes["aria-label"]).toBe(MESSAGES.LABEL_MODEL_INFO_BTN);
        });

        it("invokes onInfo and stops the click from bubbling to the card", () => {
            const c = container();
            const onInfo = vi.fn();
            const onClick = vi.fn();
            const entry = makeEntry();
            const card = renderModelCard(c, entry, { onInfo, onClick }) as unknown as MockElement;
            const btn = card.find("lilbee-model-card-info")!;
            const stopPropagation = vi.fn();
            btn.trigger("click", { stopPropagation, target: { tagName: "BUTTON" } });
            expect(onInfo).toHaveBeenCalledWith(entry);
            expect(stopPropagation).toHaveBeenCalled();
        });
    });
});
