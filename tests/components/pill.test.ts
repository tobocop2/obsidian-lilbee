import { describe, it, expect } from "vitest";
import { MockElement } from "../__mocks__/obsidian";
import { renderPill } from "../../src/components/pill";

function container(): HTMLElement {
    return new MockElement() as unknown as HTMLElement;
}

describe("renderPill", () => {
    it("creates span with base class and custom class", () => {
        const el = renderPill(container(), "hello", "lilbee-pill-custom") as unknown as MockElement;
        expect(el.tagName).toBe("SPAN");
        expect(el.textContent).toBe("hello");
        expect(el.classList.contains("lilbee-pill")).toBe(true);
        expect(el.classList.contains("lilbee-pill-custom")).toBe(true);
    });

    it("is appended to the container", () => {
        const c = container();
        renderPill(c, "test", "cls");
        expect((c as unknown as MockElement).children.length).toBe(1);
    });
});
