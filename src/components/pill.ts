export const PILL_CLS = {
    INSTALLED: "lilbee-pill-installed",
    CONTEXT: "lilbee-pill-context",
    SOURCE: "lilbee-pill-source",
    SOURCE_USER: "lilbee-pill-source-user",
    SOURCE_ENV: "lilbee-pill-source-env",
} as const;

export function renderPill(container: HTMLElement, text: string, cls: string): HTMLElement {
    return container.createSpan({
        text,
        cls: `lilbee-pill ${cls}`,
    });
}
