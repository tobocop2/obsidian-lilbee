export const PILL_CLS = {
    INSTALLED: "lilbee-pill-installed",
    CONTEXT: "lilbee-pill-context",
    SOURCE: "lilbee-pill-source",
    SOURCE_USER: "lilbee-pill-source-user",
    SOURCE_ENV: "lilbee-pill-source-env",
    REINDEX: "lilbee-pill-reindex",
    PROFILE_FOLDER: "lilbee-pill-profile-folder",
    PROFILE_ACTIVE: "lilbee-pill-profile-active",
} as const;

export function renderPill(container: HTMLElement, text: string, cls: string): HTMLElement {
    return container.createSpan({
        text,
        cls: `lilbee-pill ${cls}`,
    });
}
