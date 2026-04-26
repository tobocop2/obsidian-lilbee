import { describe, it, expect, beforeEach } from "vitest";
import { App, Notice } from "obsidian";
import { MockElement } from "../__mocks__/obsidian";
import { ConfirmPullModal } from "../../src/views/confirm-pull-modal";
import type { ConfirmPullInfo } from "../../src/views/confirm-pull-modal";

function makeInfo(overrides: Partial<ConfirmPullInfo> = {}): ConfirmPullInfo {
    return {
        displayName: "Phi 3 Mini",
        sizeGb: 2.3,
        minRamGb: 4,
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

    it("renders display name in onOpen", () => {
        const app = new App();
        const modal = new ConfirmPullModal(app as any, makeInfo({ displayName: "Mistral 7B" }));
        modal.onOpen();

        const texts = collectTexts(modal.contentEl as unknown as MockElement);
        expect(texts.some((t) => t.includes("Mistral 7B"))).toBe(true);
    });

    it("renders model size in onOpen", () => {
        const app = new App();
        const modal = new ConfirmPullModal(app as any, makeInfo({ sizeGb: 4.7 }));
        modal.onOpen();

        const texts = collectTexts(modal.contentEl as unknown as MockElement);
        expect(texts.some((t) => t.includes("4.7 GB"))).toBe(true);
    });

    it("renders minimum RAM in onOpen", () => {
        const app = new App();
        const modal = new ConfirmPullModal(app as any, makeInfo({ minRamGb: 8 }));
        modal.onOpen();

        const texts = collectTexts(modal.contentEl as unknown as MockElement);
        expect(texts.some((t) => t.includes("8 GB"))).toBe(true);
    });

    it("renders Pull Model and Cancel buttons", () => {
        const app = new App();
        const modal = new ConfirmPullModal(app as any, makeInfo());
        modal.onOpen();

        const buttons = findButtons(modal.contentEl as unknown as MockElement);
        const buttonTexts = buttons.map((b) => b.textContent);
        expect(buttonTexts).toContain("Pull Model");
        expect(buttonTexts).toContain("Cancel");
    });

    it("clicking Pull Model resolves result to true", async () => {
        const app = new App();
        const modal = new ConfirmPullModal(app as any, makeInfo());
        modal.onOpen();

        const buttons = findButtons(modal.contentEl as unknown as MockElement);
        const pullBtn = buttons.find((b) => b.textContent === "Pull Model")!;
        pullBtn.trigger("click");

        const result = await modal.result;
        expect(result).toBe(true);
    });

    it("clicking Cancel resolves result to false", async () => {
        const app = new App();
        const modal = new ConfirmPullModal(app as any, makeInfo());
        modal.onOpen();

        const buttons = findButtons(modal.contentEl as unknown as MockElement);
        const cancelBtn = buttons.find((b) => b.textContent === "Cancel")!;
        cancelBtn.trigger("click");

        const result = await modal.result;
        expect(result).toBe(false);
    });

    it("onClose resolves result to false", async () => {
        const app = new App();
        const modal = new ConfirmPullModal(app as any, makeInfo());
        modal.onOpen();
        modal.onClose();

        const result = await modal.result;
        expect(result).toBe(false);
    });

    it("decide is idempotent — second call is a no-op", async () => {
        const app = new App();
        const modal = new ConfirmPullModal(app as any, makeInfo());
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
