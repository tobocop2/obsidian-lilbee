import { vi, describe, it, expect } from "vitest";
import { App } from "obsidian";
import { MockElement } from "../__mocks__/obsidian";
import { ProfileNameModal } from "../../src/views/profile-name-modal";
import type { ProfileNameOptions } from "../../src/views/profile-name-modal";
import { MESSAGES, PROFILE_FOLDER_LABELS } from "../../src/locales/en";
import { PROFILE_FOLDER } from "../../src/types";
import { button, byTag } from "../profile-fixtures";

function open(options: Partial<ProfileNameOptions> = {}) {
    const submit = vi.fn().mockResolvedValue(null);
    const modal = new ProfileNameModal(new App() as never, { title: "Save", askTarget: true, submit, ...options });
    const close = vi.spyOn(modal, "close");
    modal.open();
    const el = modal.contentEl as unknown as MockElement;
    const input = el.find("lilbee-profile-name")!;
    return { modal, el, input, submit: options.submit ?? submit, close };
}

/** Let the submit promise and the handler after it settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("ProfileNameModal", () => {
    it("offers all projects first and this vault second, all projects chosen", () => {
        const { el } = open();
        const select = el.find("lilbee-profile-target")!;
        expect(select.options.map((o) => [o.attributes.value, o.textContent])).toEqual([
            [PROFILE_FOLDER.GLOBAL, PROFILE_FOLDER_LABELS.global],
            [PROFILE_FOLDER.PROJECT, PROFILE_FOLDER_LABELS.project],
        ]);
        expect(select.value).toBe(PROFILE_FOLDER.GLOBAL);
    });

    it("sends the trimmed name and the folder the user picked, then closes", async () => {
        const { el, input, submit, close } = open();
        input.value = "  Court filings ";
        const select = el.find("lilbee-profile-target")!;
        select.value = PROFILE_FOLDER.PROJECT;
        select.trigger("change");
        button(el, MESSAGES.BUTTON_PROFILE_SAVE)!.trigger("click");
        await settle();
        expect(submit).toHaveBeenCalledWith("Court filings", PROFILE_FOLDER.PROJECT);
        expect(close).toHaveBeenCalled();
    });

    it("keeps all projects when the select reports a value it never offered", async () => {
        const { el, input, submit } = open();
        input.value = "Mine";
        const select = el.find("lilbee-profile-target")!;
        select.value = "elsewhere";
        select.trigger("change");
        input.trigger("keydown", { key: "Enter" });
        await settle();
        expect(submit).toHaveBeenCalledWith("Mine", PROFILE_FOLDER.GLOBAL);
    });

    it("keeps the server's refusal in the dialog and stays open", async () => {
        const submit = vi.fn().mockResolvedValue("Reserved name: active cannot name a profile");
        const { el, input, close } = open({ submit });
        input.value = "active";
        input.trigger("keydown", { key: "Enter" });
        await settle();
        expect(el.find("lilbee-profile-name-error")?.textContent).toBe("Reserved name: active cannot name a profile");
        expect(close).not.toHaveBeenCalled();
    });

    it("sends nothing for an empty name or a key other than Enter", async () => {
        const { el, input, submit } = open();
        input.value = "   ";
        button(el, MESSAGES.BUTTON_PROFILE_SAVE)!.trigger("click");
        input.value = "Mine";
        input.trigger("keydown", { key: "a" });
        await settle();
        expect(submit).not.toHaveBeenCalled();
    });

    it("sends one request while the first is still in flight", async () => {
        let finish: (value: string | null) => void = () => undefined;
        const submit = vi.fn(() => new Promise<string | null>((resolve) => (finish = resolve)));
        const { el, input } = open({ submit });
        input.value = "Mine";
        button(el, MESSAGES.BUTTON_PROFILE_SAVE)!.trigger("click");
        button(el, MESSAGES.BUTTON_PROFILE_SAVE)!.trigger("click");
        finish(null);
        await settle();
        expect(submit).toHaveBeenCalledTimes(1);
    });

    it("sends nothing before the dialog has drawn its field", async () => {
        const submit = vi.fn();
        const modal = new ProfileNameModal(new App() as never, { title: "Save", askTarget: true, submit });
        await (modal as unknown as { save: () => Promise<void> }).save();
        expect(submit).not.toHaveBeenCalled();
    });

    it("a rename asks for no folder and starts from the current name", () => {
        const { el, input } = open({ askTarget: false, initialName: "Scans" });
        expect(el.find("lilbee-profile-target")).toBeNull();
        expect(input.value).toBe("Scans");
    });

    it("shows the explanation when given one, and Cancel closes without sending", async () => {
        const { el, submit, close } = open({ explain: "Holds your changes." });
        expect(byTag(el, "p").map((p) => p.textContent)).toContain("Holds your changes.");
        button(el, MESSAGES.BUTTON_CANCEL)!.trigger("click");
        expect(close).toHaveBeenCalled();
        expect(submit).not.toHaveBeenCalled();
    });
});
