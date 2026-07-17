import { ItemView, WorkspaceLeaf } from "obsidian";
import type LilbeePlugin from "../main";
import { BACKGROUND_TASK_TYPES, TASK_QUEUE, TASK_STATUS, type TaskEntry, type TaskStatus } from "../types";
import { MESSAGES } from "../locales/en";
import { ConfirmModal } from "./confirm-modal";
import { FLASH_WINDOW_MS } from "../task-queue";
import { formatBytes, formatElapsed, formatRate, relativeTime, TIME_REFRESH_INTERVAL_MS } from "../utils";

const ACTIVE_PCT_CAP = 99;

export const VIEW_TYPE_TASKS = "lilbee-tasks";

const ACTIVE_REFRESH_INTERVAL_MS = 1000;

export class TaskCenterView extends ItemView {
    private plugin: LilbeePlugin;
    private unsubscribe: (() => void) | null = null;
    private countersEl: HTMLElement | null = null;
    private capPill: HTMLElement | null = null;
    private activeSection: HTMLElement | null = null;
    private queuedSection: HTMLElement | null = null;
    private completedSection: HTMLElement | null = null;
    private refreshInterval: number | null = null;
    private refreshIntervalMs = TIME_REFRESH_INTERVAL_MS;

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

        this.countersEl = header.createSpan({ cls: "lilbee-tasks-counters" });
        this.capPill = header.createSpan({ cls: "lilbee-tasks-cap-pill" });
        this.capPill.hide();

        const clearBtn = header.createEl("button", { cls: "lilbee-tasks-clear" });
        clearBtn.setText(MESSAGES.BUTTON_CLEAR_TASKS);
        clearBtn.addEventListener("click", () => {
            this.plugin.taskQueue.clearHistory();
            this.render();
        });

        this.activeSection = contentEl.createDiv({ cls: "lilbee-tasks-section" });
        this.activeSection.createDiv({ cls: "lilbee-tasks-section-header" }).setText(MESSAGES.LABEL_ACTIVE_TASKS);

        this.queuedSection = contentEl.createDiv({ cls: "lilbee-tasks-section" });
        this.queuedSection.createDiv({ cls: "lilbee-tasks-section-header" }).setText(MESSAGES.LABEL_QUEUED_TASKS);

        this.completedSection = contentEl.createDiv({ cls: "lilbee-tasks-section" });
        this.completedSection.createDiv({ cls: "lilbee-tasks-section-header" }).textContent =
            MESSAGES.LABEL_COMPLETED_TASKS;

        this.unsubscribe = this.plugin.taskQueue.onChange(() => this.render());
        this.retuneRefreshInterval();

        this.render();
    }

    async onClose(): Promise<void> {
        this.unsubscribe?.();
        if (this.refreshInterval !== null) {
            window.clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
    }

    private render(): void {
        if (!this.activeSection || !this.queuedSection || !this.completedSection) return;

        this.renderCounters();
        this.renderCapPill();
        this.renderActive();
        this.renderQueued();
        this.renderCompleted();
        this.retuneRefreshInterval();
    }

    private retuneRefreshInterval(): void {
        const hasActive = this.plugin.taskQueue.activeAll.length > 0;
        const targetMs = hasActive ? ACTIVE_REFRESH_INTERVAL_MS : TIME_REFRESH_INTERVAL_MS;
        if (targetMs === this.refreshIntervalMs && this.refreshInterval !== null) return;

        if (this.refreshInterval !== null) {
            window.clearInterval(this.refreshInterval);
        }
        this.refreshIntervalMs = targetMs;
        this.refreshInterval = window.setInterval(() => this.render(), targetMs);
    }

    private renderCounters(): void {
        if (!this.countersEl) return;
        const active = this.plugin.taskQueue.activeAll.length;
        const queued = this.plugin.taskQueue.queued.length;
        const done = this.plugin.taskQueue.completed.length;
        this.countersEl.setText(
            MESSAGES.LABEL_TASK_COUNTERS.replace("{active}", String(active))
                .replace("{queued}", String(queued))
                .replace("{done}", String(done)),
        );
    }

    private renderCapPill(): void {
        if (!this.capPill) return;
        const backgroundActive = this.plugin.taskQueue.activeAll.filter((t) =>
            BACKGROUND_TASK_TYPES.has(t.type),
        ).length;
        const cap = TASK_QUEUE.MAX_CONCURRENT_BACKGROUND;
        if (backgroundActive >= cap) {
            this.capPill.setText(
                MESSAGES.LABEL_TASK_CAP_PILL.replace("{active}", String(backgroundActive)).replace(
                    "{cap}",
                    String(cap),
                ),
            );
            this.capPill.show();
        } else {
            this.capPill.setText("");
            this.capPill.hide();
        }
    }

    private renderActive(): void {
        if (!this.activeSection) return;
        const container = this.activeSection;
        container.querySelectorAll(".lilbee-task-row").forEach((el) => el.remove());
        container.querySelectorAll(".lilbee-tasks-empty").forEach((el) => el.remove());

        const allActive = this.plugin.taskQueue.activeAll;

        if (allActive.length === 0) {
            const empty = container.createDiv({ cls: "lilbee-tasks-empty" });
            empty.setText(MESSAGES.LABEL_NO_ACTIVE_TASKS);
            return;
        }

        for (const task of allActive) {
            this.renderTaskRow(container, task, TASK_STATUS.ACTIVE);
        }
    }

    private renderQueued(): void {
        if (!this.queuedSection) return;
        const container = this.queuedSection;
        container.querySelectorAll(".lilbee-task-row").forEach((el) => el.remove());
        container.querySelectorAll(".lilbee-tasks-empty").forEach((el) => el.remove());

        const queued = this.plugin.taskQueue.queued;

        if (queued.length === 0) {
            const empty = container.createDiv({ cls: "lilbee-tasks-empty" });
            empty.setText(MESSAGES.LABEL_NO_QUEUED_TASKS);
            return;
        }

        for (const task of queued) {
            this.renderTaskRow(container, task, TASK_STATUS.QUEUED);
        }
    }

    private renderCompleted(): void {
        if (!this.completedSection) return;
        const container = this.completedSection;
        container.querySelectorAll(".lilbee-task-row").forEach((el) => el.remove());
        container.querySelectorAll(".lilbee-tasks-empty").forEach((el) => el.remove());

        const completed = this.plugin.taskQueue.completed;

        if (completed.length === 0) {
            const empty = container.createDiv({ cls: "lilbee-tasks-empty" });
            empty.setText(MESSAGES.LABEL_NO_COMPLETED_TASKS);
            return;
        }

        for (const task of completed) {
            this.renderTaskRow(container, task, task.status);
        }
    }

    private renderTaskRow(container: HTMLElement, task: TaskEntry, state: TaskStatus): void {
        const row = container.createDiv({ cls: "lilbee-task-row" });
        row.dataset.state = state;
        row.dataset.type = task.type;

        const isActive = state === TASK_STATUS.ACTIVE;
        const isTerminal =
            state === TASK_STATUS.DONE ||
            state === TASK_STATUS.FAILED ||
            state === TASK_STATUS.CANCELLED ||
            state === TASK_STATUS.WAITING;
        const isIndeterminate = isActive && task.progress < 0;
        const rawPct = Math.max(0, Math.min(100, task.progress));
        const pct = isIndeterminate ? 100 : isActive ? Math.min(rawPct, ACTIVE_PCT_CAP) : rawPct;

        if (isTerminal && isWithinFlashWindow(task)) {
            row.addClass("lilbee-task-flash");
        }

        row.createDiv({ cls: "lilbee-task-rail" });

        const body = row.createDiv({ cls: "lilbee-task-body" });

        const head = body.createDiv({ cls: "lilbee-task-head" });
        const typeBadge = head.createSpan({ cls: `lilbee-task-type-badge lilbee-task-badge-${task.type}` });
        typeBadge.setText(task.type.toUpperCase());
        head.createSpan({ cls: "lilbee-task-name", text: task.name });
        const meta = head.createSpan({ cls: "lilbee-task-meta" });
        meta.setText(metaForRow(task, state));

        const stats = body.createDiv({ cls: "lilbee-task-stats" });
        const statsLabel = stats.createSpan({ cls: "lilbee-task-stats-label" });
        statsLabel.setText(statsLine(task, state));
        const pctLabel = stats.createSpan({ cls: "lilbee-task-pct" });
        pctLabel.setText(isIndeterminate || !isActive ? "" : `${Math.round(pct)}%`);

        const barContainer = body.createDiv({ cls: "lilbee-task-progress-bar" });
        const barFill = barContainer.createDiv({ cls: "lilbee-task-progress-fill" });
        barFill.style.width = `${pct}%`;
        if (isIndeterminate) barFill.classList.add("lilbee-task-progress-indeterminate");

        if (isActive && task.canCancel) {
            const cancelBtn = row.createEl("button", { cls: "lilbee-task-cancel" });
            cancelBtn.setText(MESSAGES.LABEL_CLOSE_GLYPH);
            cancelBtn.title = MESSAGES.LABEL_CANCEL_TASK;
            cancelBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                void this.handleCancel(task);
            });
        }

        if ((state === TASK_STATUS.FAILED || state === TASK_STATUS.CANCELLED) && task.retry) {
            const retryBtn = row.createEl("button", { cls: "lilbee-task-retry" });
            retryBtn.setText(MESSAGES.LABEL_RETRY_TASK);
            retryBtn.title = MESSAGES.LABEL_RETRY_TASK;
            retryBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                void task.retry?.();
            });
        }

        if (task.error && state === TASK_STATUS.FAILED) {
            row.title = task.error;
        }
    }

    private async handleCancel(task: TaskEntry): Promise<void> {
        if (task.canCancel) {
            this.plugin.taskQueue.cancel(task.id);
            return;
        }

        const modal = new ConfirmModal(this.plugin.app, MESSAGES.NOTICE_CONFIRM_CANCEL);
        modal.open();
        const confirmed = await modal.result;

        if (confirmed) {
            this.plugin.taskQueue.cancel(task.id);
        }
    }
}

function metaForRow(task: TaskEntry, state: TaskStatus): string {
    if (state === TASK_STATUS.ACTIVE) {
        return formatElapsed(Date.now() - task.startedAt);
    }
    if (state === TASK_STATUS.QUEUED) {
        return MESSAGES.LABEL_TASK_STATE_QUEUED;
    }
    if (state === TASK_STATUS.DONE) {
        return task.completedAt !== null ? relativeTime(task.completedAt) : MESSAGES.LABEL_TASK_STATE_DONE;
    }
    if (state === TASK_STATUS.FAILED) {
        return task.completedAt !== null ? relativeTime(task.completedAt) : MESSAGES.LABEL_TASK_STATE_FAILED;
    }
    if (state === TASK_STATUS.WAITING) {
        return task.completedAt !== null ? relativeTime(task.completedAt) : MESSAGES.LABEL_TASK_STATE_WAITING;
    }
    return task.completedAt !== null ? relativeTime(task.completedAt) : MESSAGES.LABEL_TASK_STATE_CANCELLED;
}

function statsLine(task: TaskEntry, state: TaskStatus): string {
    if (state !== TASK_STATUS.ACTIVE) {
        if (task.detail) return task.detail;
        if (task.error) return task.error;
        return "";
    }
    const parts: string[] = [];
    if (task.bytesTotal && task.bytesCurrent !== undefined) {
        parts.push(`${formatBytes(task.bytesCurrent)} / ${formatBytes(task.bytesTotal)}`);
    } else if (task.bytesCurrent !== undefined) {
        parts.push(formatBytes(task.bytesCurrent));
    }
    if (task.rateBps && task.rateBps > 0) {
        parts.push(formatRate(task.rateBps));
    }
    if (parts.length === 0 && task.detail) return task.detail;
    return parts.join(" — ");
}

function isWithinFlashWindow(task: TaskEntry): boolean {
    if (task.completedAt === null) return false;
    return Date.now() - task.completedAt < FLASH_WINDOW_MS;
}
