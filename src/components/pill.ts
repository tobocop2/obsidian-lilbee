import { MODEL_TASK, MODEL_SOURCE } from "../types";
import { MESSAGES } from "../locales/en";

export const PILL_CLS = {
    PICK: "lilbee-pill-pick",
    TASK_CHAT: "lilbee-pill-task-chat",
    TASK_EMBEDDING: "lilbee-pill-task-embedding",
    TASK_VISION: "lilbee-pill-task-vision",
    TASK_RERANK: "lilbee-pill-task-rerank",
    INSTALLED: "lilbee-pill-installed",
    ACTIVE: "lilbee-pill-active",
    PROVIDER: "lilbee-pill-provider",
} as const;

const TASK_PILL_MAP: Record<string, string> = {
    [MODEL_TASK.CHAT]: PILL_CLS.TASK_CHAT,
    [MODEL_TASK.EMBEDDING]: PILL_CLS.TASK_EMBEDDING,
    [MODEL_TASK.VISION]: PILL_CLS.TASK_VISION,
    [MODEL_TASK.RERANK]: PILL_CLS.TASK_RERANK,
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

export function renderProviderPill(container: HTMLElement, source: string): HTMLElement | null {
    if (source === MODEL_SOURCE.NATIVE) return null;
    return renderPill(container, source, PILL_CLS.PROVIDER);
}
