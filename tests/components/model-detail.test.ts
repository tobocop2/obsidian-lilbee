import { describe, it, expect } from "vitest";
import { MockElement } from "../__mocks__/obsidian";
import { renderModelDetail } from "../../src/components/model-detail";
import type { CatalogEntry } from "../../src/types";
import { MESSAGES } from "../../src/locales/en";

function makeEntry(overrides: Partial<CatalogEntry> = {}): CatalogEntry {
    return {
        hf_repo: "qwen/qwen3-8b",
        gguf_filename: "*Q4_K_M.gguf",
        display_name: "Qwen3 8B",
        size_gb: 5,
        min_ram_gb: 8,
        description: "A general purpose chat model.",
        quality_tier: "balanced",
        installed: false,
        source: "native",
        task: "chat",
        featured: false,
        downloads: 1234,
        param_count: "8B",
        ...overrides,
    };
}

function container(): HTMLElement {
    return new MockElement() as unknown as HTMLElement;
}

describe("renderModelDetail", () => {
    it("renders the model name as an H3", () => {
        const c = container() as unknown as MockElement;
        renderModelDetail(makeEntry({ display_name: "Qwen3 8B" }), c as unknown as HTMLElement);
        const name = c.find("lilbee-detail-name");
        expect(name?.textContent).toBe("Qwen3 8B");
        expect(name?.tagName).toBe("H3");
    });

    it("clears the container before rendering", () => {
        const c = container() as unknown as MockElement;
        c.createDiv({ text: "stale" });
        renderModelDetail(makeEntry(), c as unknown as HTMLElement);
        // Stale node should be gone — the only top-level h3 is the name.
        const stale = c.children.find((ch) => ch.textContent === "stale");
        expect(stale).toBeUndefined();
    });

    it("renders the fit chip when entry.fit is a known value", () => {
        const c = container() as unknown as MockElement;
        renderModelDetail(makeEntry({ fit: "fits" }), c as unknown as HTMLElement);
        expect(c.find("lilbee-fit-chip")).not.toBeNull();
        expect(c.find("lilbee-fit-fits")).not.toBeNull();
    });

    it("renders the tight fit chip", () => {
        const c = container() as unknown as MockElement;
        renderModelDetail(makeEntry({ fit: "tight" }), c as unknown as HTMLElement);
        expect(c.find("lilbee-fit-tight")).not.toBeNull();
    });

    it("renders the wont_run fit chip", () => {
        const c = container() as unknown as MockElement;
        renderModelDetail(makeEntry({ fit: "wont_run" }), c as unknown as HTMLElement);
        expect(c.find("lilbee-fit-wont_run")).not.toBeNull();
    });

    it("omits the fit chip when fit is null/undefined", () => {
        const c = container() as unknown as MockElement;
        renderModelDetail(makeEntry({ fit: null }), c as unknown as HTMLElement);
        expect(c.find("lilbee-fit-chip")).toBeNull();
    });

    it("renders the size variants strip when present", () => {
        const c = container() as unknown as MockElement;
        renderModelDetail(
            makeEntry({
                size_variants: [
                    { size_label: "Q4", params: "8B", size_gb: 5, ref: "a" },
                    { size_label: "Q8", params: "8B", size_gb: 9, ref: "b" },
                ],
            }),
            c as unknown as HTMLElement,
        );
        expect(c.find("lilbee-detail-variants")).not.toBeNull();
        const variants = c.findAll("lilbee-detail-variant").map((el) => el.textContent);
        expect(variants).toEqual(["Q4", "Q8"]);
    });

    it("omits the variants strip when no variants are provided", () => {
        const c = container() as unknown as MockElement;
        renderModelDetail(makeEntry({ size_variants: [] }), c as unknown as HTMLElement);
        expect(c.find("lilbee-detail-variants")).toBeNull();
    });

    it("omits the variants strip when size_variants is null", () => {
        const c = container() as unknown as MockElement;
        renderModelDetail(makeEntry({ size_variants: null }), c as unknown as HTMLElement);
        expect(c.find("lilbee-detail-variants")).toBeNull();
    });

    it("truncates long descriptions to 200 characters", () => {
        const long = "x".repeat(250);
        const c = container() as unknown as MockElement;
        renderModelDetail(makeEntry({ description: long }), c as unknown as HTMLElement);
        const desc = c.find("lilbee-detail-description")!;
        expect(desc.textContent).toBe(`${"x".repeat(200)}…`);
    });

    it("keeps short descriptions intact", () => {
        const c = container() as unknown as MockElement;
        renderModelDetail(makeEntry({ description: "short" }), c as unknown as HTMLElement);
        expect(c.find("lilbee-detail-description")?.textContent).toBe("short");
    });

    it("omits the description section when description is empty", () => {
        const c = container() as unknown as MockElement;
        renderModelDetail(makeEntry({ description: "" }), c as unknown as HTMLElement);
        expect(c.find("lilbee-detail-description")).toBeNull();
    });

    it("renders the installed status label when entry.installed is true", () => {
        const c = container() as unknown as MockElement;
        renderModelDetail(makeEntry({ installed: true }), c as unknown as HTMLElement);
        expect(c.find("lilbee-detail-install-status")?.textContent).toBe(MESSAGES.LABEL_INSTALLED);
    });

    it("renders the not-installed status label otherwise", () => {
        const c = container() as unknown as MockElement;
        renderModelDetail(makeEntry({ installed: false }), c as unknown as HTMLElement);
        expect(c.find("lilbee-detail-install-status")?.textContent).toBe(MESSAGES.LABEL_NOT_INSTALLED.trim());
    });

    it("renders the downloads count when downloads > 0", () => {
        const c = container() as unknown as MockElement;
        renderModelDetail(makeEntry({ downloads: 1500 }), c as unknown as HTMLElement);
        expect(c.find("lilbee-detail-downloads-value")?.textContent).toBe("1.5K");
    });

    it("omits the downloads section when downloads is 0", () => {
        const c = container() as unknown as MockElement;
        renderModelDetail(makeEntry({ downloads: 0 }), c as unknown as HTMLElement);
        expect(c.find("lilbee-detail-downloads-value")).toBeNull();
    });
});
