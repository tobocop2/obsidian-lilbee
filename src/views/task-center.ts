import { ItemView, WorkspaceLeaf } from "obsidian";
import type LilbeePlugin from "../main";
import { TASK_STATUS, type TaskEntry, type TaskType } from "../types";
import { MESSAGES } from "../locales/en";
import { relativeTime, TIME_REFRESH_INTERVAL_MS } from "../utils";

export const VIEW_TYPE_TASKS = "lilbee-tasks";

const TYPE_COLORS: Record<TaskType, string> = {
    sync: "#3b82f6",
    add: "#f97316",
    pull: "#a855f7",
    crawl: "#22c55e",
    download: "#06b6d4",
    wiki: "#10b981",
};

export class TaskCenterView extends ItemView {
    private plugin: LilbeePlugin;
    private unsubscribe: (() => void) | null = null;
    private activeSection: HTMLElement | null = null;
    private queuedSection: HTMLElement | null = null;
    private completedSection: HTMLElement | null = null;
    private timeRefreshInterval: number | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: LilbeePlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return VIEW_TYPE_TASKS;
    }

    getDisplayText(): string {
        return MESSAGES.LABEL_TASKS_VIEW;
    }

    getIcon(): string {
        return "list-checks";
    }

    async onOpen(): Promise<void> {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("lilbee-tasks-container");

        const header = contentEl.createDiv({ cls: "lilbee-tasks-header" });
        header.createEl("h2", { text: MESSAGES.LABEL_TASK_CENTER });

        const clearBtn = header.createEl("button", { cls: "lilbee-tasks-clear" });
        clearBtn.textContent = MESSAGES.BUTTON_CLEAR_TASKS;
        clearBtn.addEventListener("click", () => {
            this.plugin.taskQueue.clearHistory();
            this.render();
        });

        this.activeSection = contentEl.createDiv({ cls: "lilbee-tasks-section" });
        this.activeSection.createDiv({ cls: "lilbee-tasks-section-header" }).textContent = MESSAGES.LABEL_ACTIVE_TASKS;

        this.queuedSection = contentEl.createDiv({ cls: "lilbee-tasks-section" });
        this.queuedSection.createDiv({ cls: "lilbee-tasks-section-header" }).textContent = MESSAGES.LABEL_QUEUED_TASKS;

        this.completedSection = contentEl.createDiv({ cls: "lilbee-tasks-section" });
        this.completedSection.createDiv({ cls: "lilbee-tasks-section-header" }).textContent =
            MESSAGES.LABEL_COMPLETED_TASKS;

        this.unsubscribe = this.plugin.taskQueue.onChange(() => this.render());
        this.timeRefreshInterval = setInterval(() => this.render(), TIME_REFRESH_INTERVAL_MS) as unknown as number;

        this.render();
    }

    async onClose(): Promise<void> {
        this.unsubscribe?.();
        if (this.timeRefreshInterval) {
            clearInterval(this.timeRefreshInterval);
        }
    }

    private render(): void {
        if (!this.activeSection || !this.queuedSection || !this.completedSection) return;

        this.renderActive();
        this.renderQueued();
        this.renderCompleted();
    }

    private renderActive(): void {
        if (!this.activeSection) return;
        const container = this.activeSection;
        const existingRows = container.querySelectorAll(".lilbee-task-row");
        existingRows.forEach((el) => el.remove());

        const allActive = this.plugin.taskQueue.activeAll;

        if (allActive.length === 0) {
            const empty = container.createDiv({ cls: "lilbee-tasks-empty" });
            empty.textContent = MESSAGES.LABEL_NO_ACTIVE_TASKS;
            return;
        }

        const existingEmpty = container.querySelector(".lilbee-tasks-empty");
        if (existingEmpty) existingEmpty.remove();

        for (const task of allActive) {
            this.renderTaskRow(container, task, true);
        }
    }

    private renderQueued(): void {
        if (!this.queuedSection) return;
        const container = this.queuedSection;
        const existingRows = container.querySelectorAll(".lilbee-task-row");
        existingRows.forEach((el) => el.remove());

        const queued = this.plugin.taskQueue.queued;

        if (queued.length === 0) {
            const empty = container.createDiv({ cls: "lilbee-tasks-empty" });
            empty.textContent = MESSAGES.LABEL_NO_QUEUED_TASKS;
            return;
        }

        const existingEmpty = container.querySelector(".lilbee-tasks-empty");
        if (existingEmpty) existingEmpty.remove();

        for (const task of queued) {
            this.renderTaskRow(container, task, false);
        }
    }

    private renderCompleted(): void {
        if (!this.completedSection) return;
        const container = this.completedSection;
        const existingRows = container.querySelectorAll(".lilbee-task-row");
        existingRows.forEach((el) => el.remove());

        const completed = this.plugin.taskQueue.completed;

        if (completed.length === 0) {
            const empty = container.createDiv({ cls: "lilbee-tasks-empty" });
            empty.textContent = MESSAGES.LABEL_NO_COMPLETED_TASKS;
            return;
        }

        const existingEmpty = container.querySelector(".lilbee-tasks-empty");
        if (existingEmpty) existingEmpty.remove();

        for (const task of completed) {
            this.renderCompletedRow(container, task);
        }
    }

    private renderTaskRow(container: HTMLElement, task: TaskEntry, isActive: boolean): void {
        const row = container.createDiv({ cls: "lilbee-task-row" });

        if (isActive) {
            const progressContainer = row.createDiv({ cls: "lilbee-task-progress-bar" });
            const progressFill = progressContainer.createDiv({ cls: "lilbee-task-progress-fill" });
            progressFill.style.width = `${task.progress}%`;
        }

        const info = row.createDiv({ cls: "lilbee-task-info" });

        const typeBadge = info.createSpan({ cls: "lilbee-task-type-badge" });
        typeBadge.textContent = task.type.toUpperCase();
        typeBadge.style.backgroundColor = TYPE_COLORS[task.type];

        const name = info.createSpan({ cls: "lilbee-task-name" });
        name.textContent = task.name;

        if (isActive && task.detail) {
            const detail = row.createDiv({ cls: "lilbee-task-detail" });
            detail.textContent = task.detail;
        }

        if (isActive) {
            const progressText = row.createSpan({ cls: "lilbee-task-progress-text" });
            progressText.textContent = `${task.progress}%`;
        }

        if (isActive && task.canCancel) {
            const cancelBtn = row.createEl("button", { cls: "lilbee-task-cancel" });
            cancelBtn.textContent = "×";
            cancelBtn.title = MESSAGES.LABEL_CANCEL_TASK;
            cancelBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                this.handleCancel(task);
            });
        }
    }

    private renderCompletedRow(container: HTMLElement, task: TaskEntry): void {
        const row = container.createDiv({ cls: "lilbee-task-row" });

        const statusIcon = row.createSpan({ cls: "lilbee-task-status-icon" });
        if (task.status === TASK_STATUS.DONE) {
            statusIcon.textContent = "✓";
            statusIcon.classList.add("lilbee-task-status-done");
        } else if (task.status === TASK_STATUS.FAILED) {
            statusIcon.textContent = "✗";
            statusIcon.classList.add("lilbee-task-status-failed");
        } else {
            statusIcon.textContent = "○";
            statusIcon.classList.add("lilbee-task-status-cancelled");
        }

        const info = row.createDiv({ cls: "lilbee-task-info" });

        const typeBadge = info.createSpan({ cls: "lilbee-task-type-badge" });
        typeBadge.textContent = task.type.toUpperCase();
        typeBadge.style.backgroundColor = TYPE_COLORS[task.type];

        const name = info.createSpan({ cls: "lilbee-task-name" });
        name.textContent = task.name;

        const time = row.createSpan({ cls: "lilbee-task-time" });
        if (task.completedAt) {
            time.textContent = relativeTime(task.completedAt);
        }

        if (task.error && task.status === TASK_STATUS.FAILED) {
            row.title = task.error;
        }
    }

    private handleCancel(task: TaskEntry): void {
        if (task.canCancel) {
            this.plugin.taskQueue.cancel(task.id);
            return;
        }

        const confirmed = confirm(MESSAGES.NOTICE_CONFIRM_CANCEL);

        if (confirmed) {
            this.plugin.taskQueue.cancel(task.id);
        }
    }
}
