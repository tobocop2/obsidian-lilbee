import { describe, it, expect } from "vitest";
import { App } from "obsidian";
import { MockElement } from "../__mocks__/obsidian";
import { UninstallModal } from "../../src/views/uninstall-modal";
import { UNINSTALL_TARGET, type UninstallPlan } from "../../src/types";

function collectTexts(el: MockElement): string[] {
    const texts: string[] = [el.textContent];
    for (const child of el.children) texts.push(...collectTexts(child));
    return texts;
}

function findButtons(el: MockElement): MockElement[] {
    const buttons: MockElement[] = [];
    if (el.tagName === "BUTTON") buttons.push(el);
    for (const child of el.children) buttons.push(...findButtons(child));
    return buttons;
}

const PLAN: UninstallPlan = {
    targets: [
        { kind: UNINSTALL_TARGET.BINARY, path: "/root/bin", bytes: 412_000_000 },
        { kind: UNINSTALL_TARGET.MODELS, path: "/root/models", bytes: 12_400_000_000 },
        { kind: UNINSTALL_TARGET.INDEX, path: "/root/vaults/abc", bytes: 820_000_000 },
    ],
    totalBytes: 13_632_000_000,
};

function open(plan: UninstallPlan = PLAN) {
    const modal = new UninstallModal(new App() as any, plan);
    modal.onOpen();
    return modal;
}

describe("UninstallModal", () => {
    it("names and sizes every path it will delete", () => {
        const texts = collectTexts(open().contentEl as unknown as MockElement);

        expect(texts).toContain("Server executable");
        expect(texts).toContain("412 MB");
        expect(texts).toContain("Downloaded models");
        expect(texts).toContain("12.4 GB");
        expect(texts).toContain("Search index for this vault");
        expect(texts).toContain("820 MB");
    });

    it("promises the vault is untouched", () => {
        const contentEl = open().contentEl as unknown as MockElement;

        expect(collectTexts(contentEl)).toContain("Your notes and attachments");
        expect(contentEl.findAll("is-keep")).toHaveLength(1);
    });

    it("resolves true when the user confirms", async () => {
        const modal = open();
        const buttons = findButtons(modal.contentEl as unknown as MockElement);

        buttons.find((b) => b.textContent === "Uninstall")!.trigger("click");

        await expect(modal.result).resolves.toBe(true);
    });

    it("resolves false when the user cancels", async () => {
        const modal = open();
        const buttons = findButtons(modal.contentEl as unknown as MockElement);

        buttons.find((b) => b.textContent === "Cancel")!.trigger("click");

        await expect(modal.result).resolves.toBe(false);
    });

    it("resolves false when the modal is dismissed", async () => {
        const modal = open();

        modal.onClose();

        await expect(modal.result).resolves.toBe(false);
    });

    it("ignores a second decision", async () => {
        const modal = open();
        const buttons = findButtons(modal.contentEl as unknown as MockElement);

        buttons.find((b) => b.textContent === "Uninstall")!.trigger("click");
        modal.onClose();

        await expect(modal.result).resolves.toBe(true);
    });
});
