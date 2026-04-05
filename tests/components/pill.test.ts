import { describe, it, expect } from "vitest";
import { MockElement } from "../__mocks__/obsidian";
import { renderPill, renderTaskPill, renderPickPill, PILL_CLS } from "../../src/components/pill";
import { MESSAGES } from "../../src/locales/en";

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

describe("renderTaskPill", () => {
    it("uses chat class for chat task", () => {
        const el = renderTaskPill(container(), "chat") as unknown as MockElement;
        expect(el.classList.contains(PILL_CLS.TASK_CHAT)).toBe(true);
        expect(el.textContent).toBe("chat");
    });

    it("uses embedding class for embedding task", () => {
        const el = renderTaskPill(container(), "embedding") as unknown as MockElement;
        expect(el.classList.contains(PILL_CLS.TASK_EMBEDDING)).toBe(true);
        expect(el.textContent).toBe("embedding");
    });

    it("uses vision class for vision task", () => {
        const el = renderTaskPill(container(), "vision") as unknown as MockElement;
        expect(el.classList.contains(PILL_CLS.TASK_VISION)).toBe(true);
        expect(el.textContent).toBe("vision");
    });

    it("falls back to chat class for unknown task", () => {
        const el = renderTaskPill(container(), "other") as unknown as MockElement;
        expect(el.classList.contains(PILL_CLS.TASK_CHAT)).toBe(true);
        expect(el.textContent).toBe("other");
    });
});

describe("renderPickPill", () => {
    it("creates pick pill with correct text and class", () => {
        const el = renderPickPill(container()) as unknown as MockElement;
        expect(el.classList.contains(PILL_CLS.PICK)).toBe(true);
        expect(el.textContent).toBe(MESSAGES.LABEL_PICK);
    });
});
