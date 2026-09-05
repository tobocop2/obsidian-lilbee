import { describe, it, expect, vi } from "vitest";
import { App } from "obsidian";
import { MESSAGES } from "../../src/locales/en";
import { UpdateAvailableModal } from "../../src/views/update-available-modal";
import type { ReleaseInfo } from "../../src/server-binary";
import type { MockElement } from "../__mocks__/obsidian";

const release = { tag: "v9.9.9", variant: "default" } as ReleaseInfo;

function openModal(build: string | null = null) {
    const actions = { openSettings: vi.fn(), stopReminding: vi.fn() };
    const modal = new UpdateAvailableModal(new App(), release, build, actions);
    const close = vi.spyOn(modal, "close");
    modal.open();
    const content = modal.contentEl as unknown as MockElement;
    const buttons = content.querySelectorAll(".modal-button-container")[0].children;
    const button = (text: string) => buttons.find((b) => b.textContent === text)!;
    return { modal, actions, close, content, button };
}

describe("UpdateAvailableModal", () => {
    it("names the release, explains the setting that turns the reminder off, and lists three choices", () => {
        const { content, button } = openModal();
        const text = content.textContent;
        expect(text).toContain(MESSAGES.UPDATE_MODAL_TITLE);
        expect(text).toContain(MESSAGES.UPDATE_MODAL_BODY("v9.9.9", null));
        expect(text).toContain(MESSAGES.LABEL_SERVER_UPDATE_REMINDER);
        expect(text).toContain(MESSAGES.LABEL_SERVER_AUTO_UPDATE);
        expect(button(MESSAGES.BUTTON_OPEN_UPDATE_SETTINGS)).toBeDefined();
        expect(button(MESSAGES.BUTTON_NOT_NOW)).toBeDefined();
        expect(button(MESSAGES.BUTTON_STOP_REMINDING)).toBeDefined();
    });

    it("names the build when the detected build differs from the installed one", () => {
        const { content } = openModal("CUDA 12.5");
        expect(content.textContent).toContain(MESSAGES.UPDATE_MODAL_BODY("v9.9.9", "CUDA 12.5"));
    });

    it.each([
        [() => MESSAGES.BUTTON_OPEN_UPDATE_SETTINGS, "openSettings"],
        [() => MESSAGES.BUTTON_STOP_REMINDING, "stopReminding"],
    ] as const)("%s runs its action and closes", (label, action) => {
        const { actions, close, button } = openModal();
        button(label()).trigger("click");
        expect(actions[action]).toHaveBeenCalledTimes(1);
        expect(close).toHaveBeenCalledTimes(1);
    });

    it("not now closes without any action", () => {
        const { actions, close, button, content } = openModal();
        button(MESSAGES.BUTTON_NOT_NOW).trigger("click");
        expect(actions.openSettings).not.toHaveBeenCalled();
        expect(actions.stopReminding).not.toHaveBeenCalled();
        expect(close).toHaveBeenCalledTimes(1);
        expect(content.children.length).toBe(0);
    });
});
