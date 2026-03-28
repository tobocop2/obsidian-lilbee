import { describe, it, expect, beforeEach } from "vitest";
import { App, Notice } from "obsidian";
import { MockElement } from "../__mocks__/obsidian";
import { ConfirmModal } from "../../src/views/confirm-modal";

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

describe("ConfirmModal", () => {
    beforeEach(() => {
        Notice.clear();
    });

    it("renders message and buttons on open", () => {
        const app = new App();
        const modal = new ConfirmModal(app as any, "Are you sure?");
        modal.onOpen();

        const el = modal.contentEl as unknown as MockElement;
        const texts = collectTexts(el);
        expect(texts.some(t => t.includes("Are you sure?"))).toBe(true);

        const buttons = findButtons(el);
        expect(buttons.some(b => b.textContent === "Continue")).toBe(true);
        expect(buttons.some(b => b.textContent === "Cancel")).toBe(true);
    });

    it("clicking Continue resolves result to true", async () => {
        const app = new App();
        const modal = new ConfirmModal(app as any, "Confirm?");
        modal.onOpen();

        const buttons = findButtons(modal.contentEl as unknown as MockElement);
        const continueBtn = buttons.find(b => b.textContent === "Continue")!;
        continueBtn.trigger("click");

        expect(await modal.result).toBe(true);
    });

    it("clicking Cancel resolves result to false", async () => {
        const app = new App();
        const modal = new ConfirmModal(app as any, "Confirm?");
        modal.onOpen();

        const buttons = findButtons(modal.contentEl as unknown as MockElement);
        const cancelBtn = buttons.find(b => b.textContent === "Cancel")!;
        cancelBtn.trigger("click");

        expect(await modal.result).toBe(false);
    });

    it("onClose resolves result to false", async () => {
        const app = new App();
        const modal = new ConfirmModal(app as any, "Confirm?");
        modal.onOpen();
        modal.onClose();

        expect(await modal.result).toBe(false);
    });

    it("decide is idempotent", async () => {
        const app = new App();
        const modal = new ConfirmModal(app as any, "Confirm?");
        modal.onOpen();

        const buttons = findButtons(modal.contentEl as unknown as MockElement);
        const continueBtn = buttons.find(b => b.textContent === "Continue")!;
        continueBtn.trigger("click");
        expect(await modal.result).toBe(true);

        // Second call should not throw
        modal.onClose();
    });
});
