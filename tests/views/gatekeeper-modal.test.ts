import { describe, it, expect, vi } from "vitest";
import { App } from "obsidian";
import { MockElement } from "../__mocks__/obsidian";
import { GatekeeperModal } from "../../src/views/gatekeeper-modal";
import { MESSAGES } from "../../src/locales/en";
import { LILBEE_REPO_URL } from "../../src/types";

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

function findLinks(el: MockElement): MockElement[] {
    const links: MockElement[] = [];
    if (el.tagName === "A") links.push(el);
    for (const child of el.children) {
        links.push(...findLinks(child));
    }
    return links;
}

describe("GatekeeperModal", () => {
    it("renders the title, mitigation steps, and a button on open", () => {
        const app = new App();
        const modal = new GatekeeperModal(app as unknown as App);
        modal.onOpen();

        const texts = collectTexts(modal.contentEl as unknown as MockElement);
        expect(texts.some((t) => t.includes(MESSAGES.GATEKEEPER_TITLE))).toBe(true);
        expect(texts.some((t) => t.includes(MESSAGES.GATEKEEPER_INTRO))).toBe(true);
        expect(texts.some((t) => t === MESSAGES.GATEKEEPER_STEP_1)).toBe(true);
        expect(texts.some((t) => t === MESSAGES.GATEKEEPER_STEP_2)).toBe(true);
        expect(texts.some((t) => t === MESSAGES.GATEKEEPER_STEP_3)).toBe(true);
        expect(texts.some((t) => t.includes(MESSAGES.GATEKEEPER_RETRY))).toBe(true);
        expect(texts.some((t) => t.includes(MESSAGES.GATEKEEPER_SOURCE))).toBe(true);

        const buttons = findButtons(modal.contentEl as unknown as MockElement);
        expect(buttons.some((b) => b.textContent === MESSAGES.BUTTON_GOT_IT)).toBe(true);
    });

    it("links the lilbee source repo", () => {
        const app = new App();
        const modal = new GatekeeperModal(app as unknown as App);
        modal.onOpen();

        const links = findLinks(modal.contentEl as unknown as MockElement);
        const repoLink = links.find((a) => a.textContent === MESSAGES.LINK_LILBEE_REPO);
        expect(repoLink).toBeDefined();
        expect(repoLink!.getAttribute("href")).toBe(LILBEE_REPO_URL);
    });

    it("closes when the Got it button is clicked", () => {
        const app = new App();
        const modal = new GatekeeperModal(app as unknown as App);
        const closeSpy = vi.spyOn(modal, "close").mockImplementation(() => {});
        modal.onOpen();

        const buttons = findButtons(modal.contentEl as unknown as MockElement);
        const gotItBtn = buttons.find((b) => b.textContent === MESSAGES.BUTTON_GOT_IT)!;
        gotItBtn.trigger("click");

        expect(closeSpy).toHaveBeenCalled();
    });
});
