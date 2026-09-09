import { describe, it, expect } from "vitest";
import { MockElement, Setting } from "./__mocks__/obsidian";

describe("Setting text components", () => {
    it("addText writes setValue through to the input and reads it back with getValue", () => {
        const setting = new Setting(new MockElement());
        let getValue = (): string => "";
        let inputEl = { value: "" };
        setting.addText((text) => {
            text.setValue("hf_stored");
            getValue = () => text.getValue();
            inputEl = text.inputEl;
        });
        expect(inputEl.value).toBe("hf_stored");
        expect(getValue()).toBe("hf_stored");
    });

    it("addTextArea writes setValue through to the textarea and reads it back with getValue", () => {
        const setting = new Setting(new MockElement());
        let getValue = (): string => "";
        let inputEl = { value: "" };
        setting.addTextArea((text) => {
            text.setValue("line one\nline two");
            getValue = () => text.getValue();
            inputEl = text.inputEl;
        });
        expect(inputEl.value).toBe("line one\nline two");
        expect(getValue()).toBe("line one\nline two");
    });
});
