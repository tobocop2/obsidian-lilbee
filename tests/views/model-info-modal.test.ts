import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { windowStub } from "../window-stub";
import { App } from "obsidian";
import { MockElement } from "../__mocks__/obsidian";
import { ModelInfoModal } from "../../src/views/model-info-modal";
import type { CatalogEntry } from "../../src/types";
import { MESSAGES } from "../../src/locales/en";

function makeEntry(overrides: Partial<CatalogEntry> = {}): CatalogEntry {
    return {
        hf_repo: "qwen/qwen3-8b",
        gguf_filename: "*Q4_K_M.gguf",
        display_name: "Qwen3 8B",
        size_gb: 5,
        min_ram_gb: 8,
        description: "Strong general purpose model",
        quality_tier: "balanced",
        installed: false,
        source: "native",
        task: "chat",
        featured: false,
        downloads: 12345,
        param_count: "8B",
        ...overrides,
    };
}

function content(modal: ModelInfoModal): MockElement {
    return (modal as unknown as { contentEl: MockElement }).contentEl;
}

describe("ModelInfoModal", () => {
    const fakePlugin = {} as never;

    beforeEach(() => {
        vi.unstubAllGlobals();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("renders the title and shared model-detail block on open", () => {
        const modal = new ModelInfoModal(new App() as never, fakePlugin, makeEntry());
        modal.open();
        const c = content(modal);
        expect(c.classList.contains("lilbee-model-info-modal")).toBe(true);
        const h2 = c.children.find((ch) => ch.tagName === "H2");
        expect(h2?.textContent).toBe(MESSAGES.MODEL_INFO_TITLE);
        // The shared detail block renders the display name as <h3>.
        expect(c.find("lilbee-detail-name")?.textContent).toBe("Qwen3 8B");
    });

    it("renders the More info section with task, params, RAM, downloads", () => {
        const modal = new ModelInfoModal(new App() as never, fakePlugin, makeEntry());
        modal.open();
        const section = content(modal).find("lilbee-model-info-section");
        expect(section).not.toBeNull();
        const labels = section!.findAll("lilbee-model-info-label").map((el) => el.textContent);
        expect(labels).toContain(MESSAGES.MODEL_INFO_TASK);
        expect(labels).toContain(MESSAGES.MODEL_INFO_PARAMS);
        expect(labels).toContain(MESSAGES.MODEL_INFO_RAM);
        expect(labels).toContain(MESSAGES.MODEL_INFO_DOWNLOADS);
    });

    it("includes context_window and quantization rows when those fields are present", () => {
        const entry = {
            ...makeEntry(),
            context_window: 32768,
            quantization: "Q4_K_M",
        } as CatalogEntry & { context_window: number; quantization: string };
        const modal = new ModelInfoModal(new App() as never, fakePlugin, entry);
        modal.open();
        const labels = content(modal)
            .findAll("lilbee-model-info-label")
            .map((el) => el.textContent);
        expect(labels).toContain(MESSAGES.MODEL_INFO_CONTEXT);
        expect(labels).toContain(MESSAGES.MODEL_INFO_QUANT);
    });

    it("omits optional rows when their data is missing", () => {
        const entry = makeEntry({ param_count: "", min_ram_gb: 0, downloads: 0 });
        const modal = new ModelInfoModal(new App() as never, fakePlugin, entry);
        modal.open();
        const labels = content(modal)
            .findAll("lilbee-model-info-label")
            .map((el) => el.textContent);
        expect(labels).not.toContain(MESSAGES.MODEL_INFO_PARAMS);
        expect(labels).not.toContain(MESSAGES.MODEL_INFO_RAM);
        expect(labels).not.toContain(MESSAGES.MODEL_INFO_DOWNLOADS);
    });

    it("renders the Hugging Face link with the correct href", () => {
        const modal = new ModelInfoModal(new App() as never, fakePlugin, makeEntry({ hf_repo: "qwen/qwen3-8b" }));
        modal.open();
        const link = content(modal).find("lilbee-hf-link");
        expect(link).not.toBeNull();
        expect(link!.getAttribute("href")).toBe("https://huggingface.co/qwen/qwen3-8b");
        expect(link!.getAttribute("target")).toBe("_blank");
        expect(link!.getAttribute("rel")).toBe("noopener noreferrer");
    });

    it("invokes window.open in a new tab when the HF link is clicked", () => {
        const openSpy = vi.fn();
        vi.stubGlobal("window", windowStub({ open: openSpy }));
        const modal = new ModelInfoModal(new App() as never, fakePlugin, makeEntry({ hf_repo: "qwen/qwen3-8b" }));
        modal.open();
        const link = content(modal).find("lilbee-hf-link")!;
        link.trigger("click", { preventDefault: vi.fn() });
        expect(openSpy).toHaveBeenCalledWith("https://huggingface.co/qwen/qwen3-8b", "_blank");
    });

    it("skips the HF link when hf_repo is empty", () => {
        const modal = new ModelInfoModal(new App() as never, fakePlugin, makeEntry({ hf_repo: "" }));
        modal.open();
        expect(content(modal).find("lilbee-hf-link")).toBeNull();
    });
});
