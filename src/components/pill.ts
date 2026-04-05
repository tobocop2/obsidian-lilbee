import { MESSAGES } from "../locales/en";

export const PILL_CLS = {
    PICK: "lilbee-pill-pick",
    TASK_CHAT: "lilbee-pill-task-chat",
    TASK_EMBEDDING: "lilbee-pill-task-embedding",
    TASK_VISION: "lilbee-pill-task-vision",
    INSTALLED: "lilbee-pill-installed",
    ACTIVE: "lilbee-pill-active",
} as const;

const TASK_PILL_MAP: Record<string, string> = {
    chat: PILL_CLS.TASK_CHAT,
    embedding: PILL_CLS.TASK_EMBEDDING,
    vision: PILL_CLS.TASK_VISION,
};

export function renderPill(container: HTMLElement, text: string, cls: string): HTMLElement {
    return container.createEl("span", {
        text,
        cls: `lilbee-pill ${cls}`,
    });
}

export function renderTaskPill(container: HTMLElement, task: string): HTMLElement {
    const cls = TASK_PILL_MAP[task] ?? PILL_CLS.TASK_CHAT;
    return renderPill(container, task, cls);
}

export function renderPickPill(container: HTMLElement): HTMLElement {
    return renderPill(container, MESSAGES.LABEL_PICK, PILL_CLS.PICK);
}
