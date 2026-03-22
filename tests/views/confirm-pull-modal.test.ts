import { describe, it, expect, beforeEach } from "vitest";
import { App, Notice } from "obsidian";
import { MockElement } from "../__mocks__/obsidian";
import { ConfirmPullModal } from "../../src/views/confirm-pull-modal";
import type { ModelInfo } from "../../src/types";

function makeModel(overrides: Partial<ModelInfo> = {}): ModelInfo {
    return {
        name: "phi3",
        size_gb: 2.3,
        min_ram_gb: 4,
        description: "Microsoft Phi-3",
        installed: false,
        ...overrides,
    };
}

function collectTexts(el: MockElement): string[] {
    const texts: string[] = [el.textContent];
    for (const child of el.children) {
        texts.push(...collectTexts(child));
    }
    return texts;
}

function findButtons(el: MockElement): MockElement[] {
    const buttons: MockElement[] = [];
    if (el.tagName === "BUTTON") buttons.push(el);
    for (const child of el.children) {
        buttons.push(...findButtons(child));
    }
    return buttons;
}

describe("ConfirmPullModal", () => {
    beforeEach(() => {
        Notice.clear();
    });

    it("renders model name in onOpen", () => {
        const app = new App();
        const model = makeModel({ name: "mistral" });
        const modal = new ConfirmPullModal(app as any, model);
        modal.onOpen();

        const texts = collectTexts(modal.contentEl as unknown as MockElement);
        expect(texts.some((t) => t.includes("mistral"))).toBe(true);
    });

    it("renders model size in onOpen", () => {
        const app = new App();
        const model = makeModel({ size_gb: 4.7 });
        const modal = new ConfirmPullModal(app as any, model);
        modal.onOpen();

        const texts = collectTexts(modal.contentEl as unknown as MockElement);
        expect(texts.some((t) => t.includes("4.7 GB"))).toBe(true);
    });

    it("renders minimum RAM in onOpen", () => {
        const app = new App();
        const model = makeModel({ min_ram_gb: 8 });
        const modal = new ConfirmPullModal(app as any, model);
        modal.onOpen();

        const texts = collectTexts(modal.contentEl as unknown as MockElement);
        expect(texts.some((t) => t.includes("8 GB"))).toBe(true);
    });

    it("renders Pull Model and Cancel buttons", () => {
        const app = new App();
        const modal = new ConfirmPullModal(app as any, makeModel());
        modal.onOpen();

        const buttons = findButtons(modal.contentEl as unknown as MockElement);
        const buttonTexts = buttons.map((b) => b.textContent);
        expect(buttonTexts).toContain("Pull Model");
        expect(buttonTexts).toContain("Cancel");
    });

    it("clicking Pull Model resolves result to true", async () => {
        const app = new App();
        const modal = new ConfirmPullModal(app as any, makeModel());
        modal.onOpen();

        const buttons = findButtons(modal.contentEl as unknown as MockElement);
        const pullBtn = buttons.find((b) => b.textContent === "Pull Model")!;
        pullBtn.trigger("click");

        const result = await modal.result;
        expect(result).toBe(true);
    });

    it("clicking Cancel resolves result to false", async () => {
        const app = new App();
        const modal = new ConfirmPullModal(app as any, makeModel());
        modal.onOpen();

        const buttons = findButtons(modal.contentEl as unknown as MockElement);
        const cancelBtn = buttons.find((b) => b.textContent === "Cancel")!;
        cancelBtn.trigger("click");

        const result = await modal.result;
        expect(result).toBe(false);
    });

    it("onClose resolves result to false", async () => {
        const app = new App();
        const modal = new ConfirmPullModal(app as any, makeModel());
        modal.onOpen();
        modal.onClose();

        const result = await modal.result;
        expect(result).toBe(false);
    });

    it("decide is idempotent — second call is a no-op", async () => {
        const app = new App();
        const modal = new ConfirmPullModal(app as any, makeModel());
        modal.onOpen();

        const buttons = findButtons(modal.contentEl as unknown as MockElement);
        const pullBtn = buttons.find((b) => b.textContent === "Pull Model")!;
        pullBtn.trigger("click");
        const result = await modal.result;
        expect(result).toBe(true);

        // Second decide call should be a no-op (no throw, no infinite recursion)
        modal.onClose();
    });
});
