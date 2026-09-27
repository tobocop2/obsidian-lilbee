import { describe, it, expect } from "vitest";
import { profileValueText } from "../../src/views/profile-parts";
import { MESSAGES } from "../../src/locales/en";

describe("profileValueText", () => {
    it.each([
        [true, MESSAGES.PROFILE_VALUE_ON],
        [false, MESSAGES.PROFILE_VALUE_OFF],
        [null, MESSAGES.PROFILE_VALUE_NONE],
        [undefined, MESSAGES.PROFILE_VALUE_NONE],
        [[], MESSAGES.PROFILE_VALUE_NONE],
        [["eng", "deu"], "eng, deu"],
        ["scanned_pages", "scanned_pages"],
        [768, "768"],
        [{ a: 1 }, '{"a":1}'],
    ])("shows %j as %s", (value, text) => {
        expect(profileValueText(value)).toBe(text);
    });
});
