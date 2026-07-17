export const PILL_CLS = {
    INSTALLED: "lilbee-pill-installed",
} as const;

export function renderPill(container: HTMLElement, text: string, cls: string): HTMLElement {
    return container.createSpan({
        text,
        cls: `lilbee-pill ${cls}`,
    });
}
