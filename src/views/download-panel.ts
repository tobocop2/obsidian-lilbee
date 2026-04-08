import type LilbeePlugin from "../main";
import { DOWNLOAD_PANEL, TASK_STATUS, TASK_TYPE, type TaskEntry } from "../types";
import { MESSAGES } from "../locales/en";

const SPINNER_FRAMES = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
const SPINNER_INTERVAL_MS = 100;
const ICON_DONE = "✓";
const ICON_FAILED = "✗";

export class DownloadPanel {
    private plugin: LilbeePlugin;
    private parentEl: HTMLElement | null;
    private containerEl: HTMLElement | null = null;
    private panelsEl: HTMLElement | null = null;
    private queuedEl: HTMLElement | null = null;
    private panelMap: Map<string, HTMLElement> = new Map();
    private trackedIds: Set<string> = new Set();
    private dismissTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
    private unsubscribe: (() => void) | null = null;
    private spinnerIndex = 0;
    private spinnerInterval: ReturnType<typeof setInterval> | null = null;

    constructor(plugin: LilbeePlugin, parentEl?: HTMLElement) {
        this.plugin = plugin;
        this.parentEl = parentEl ?? null;
    }

    attach(): void {
        const parent = this.parentEl ?? document.body;
        this.containerEl = parent.createDiv({ cls: "lilbee-dp-container" });
        this.panelsEl = this.containerEl.createDiv({ cls: "lilbee-dp-panels" });
        this.queuedEl = this.containerEl.createDiv({ cls: "lilbee-dp-queued" });
        this.unsubscribe = this.plugin.taskQueue.onChange(() => this.render());
        this.spinnerInterval = setInterval(() => {
            this.spinnerIndex = (this.spinnerIndex + 1) % SPINNER_FRAMES.length;
            this.updateSpinners();
        }, SPINNER_INTERVAL_MS);
        this.render();
    }

    detach(): void {
        this.unsubscribe?.();
        this.unsubscribe = null;
        if (this.spinnerInterval) {
            clearInterval(this.spinnerInterval);
            this.spinnerInterval = null;
        }
        for (const timer of this.dismissTimers.values()) {
            clearTimeout(timer);
        }
        this.dismissTimers.clear();
        this.panelMap.clear();
        this.trackedIds.clear();
        this.containerEl?.remove();
        this.containerEl = null;
        this.panelsEl = null;
        this.queuedEl = null;
    }

    private render(): void {
        if (!this.containerEl) return;

        const activeTasks = this.plugin.taskQueue.activeAll.filter((t) => this.isDownloadTask(t));
        const queuedTasks = this.plugin.taskQueue.queued.filter((t) => this.isDownloadTask(t));
        const activeIds = new Set(activeTasks.map((t) => t.id));

        const visibleTasks = activeTasks.slice(0, DOWNLOAD_PANEL.MAX_VISIBLE);
        for (const task of visibleTasks) {
            if (!this.panelMap.has(task.id)) {
                this.createPanel(task);
            } else {
                this.updatePanel(this.panelMap.get(task.id)!, task);
            }
            this.trackedIds.add(task.id);
        }

        // Detect completed/failed tasks that were tracked
        for (const id of this.trackedIds) {
            if (activeIds.has(id)) continue;
            if (this.dismissTimers.has(id)) continue;

            const completed = this.plugin.taskQueue.completed.find((t) => t.id === id);
            if (completed && completed.status !== TASK_STATUS.CANCELLED) {
                this.handleCompletion(id, completed);
            } else {
                this.dismissPanel(id);
            }
        }

        // Update queued overflow text
        const overflowCount = Math.max(0, activeTasks.length - DOWNLOAD_PANEL.MAX_VISIBLE) + queuedTasks.length;
        if (this.queuedEl) {
            if (overflowCount > 0) {
                this.queuedEl.textContent = MESSAGES.LABEL_DOWNLOAD_QUEUED.replace("{count}", String(overflowCount));
                this.queuedEl.style.display = "";
            } else {
                this.queuedEl.textContent = "";
                this.queuedEl.style.display = "none";
            }
        }

        this.containerEl.style.display = this.panelMap.size > 0 || overflowCount > 0 ? "" : "none";
    }

    private createPanel(task: TaskEntry): void {
        if (!this.panelsEl) return;

        const panel = this.panelsEl.createDiv({ cls: "lilbee-dp-panel" });

        const info = panel.createDiv({ cls: "lilbee-dp-info" });
        info.createSpan({ cls: "lilbee-dp-icon", text: SPINNER_FRAMES[this.spinnerIndex] });
        info.createSpan({ cls: "lilbee-dp-name", text: task.name });
        info.createSpan({ cls: "lilbee-dp-pct", text: `${task.progress}%` });

        const cancelBtn = info.createEl("button", { cls: "lilbee-dp-cancel", text: "×" });
        cancelBtn.addEventListener("click", () => {
            this.plugin.taskQueue.cancel(task.id);
            this.dismissPanel(task.id);
        });

        const barContainer = panel.createDiv({ cls: "lilbee-dp-bar-container" });
        barContainer.createDiv({ cls: "lilbee-dp-bar-fill" }).style.width = `${task.progress}%`;

        this.panelMap.set(task.id, panel);
    }

    private updatePanel(panel: HTMLElement, task: TaskEntry): void {
        const pct = panel.querySelector(".lilbee-dp-pct") as HTMLElement | null;
        if (pct) pct.textContent = `${task.progress}%`;

        const barFill = panel.querySelector(".lilbee-dp-bar-fill") as HTMLElement | null;
        if (barFill) barFill.style.width = `${task.progress}%`;
    }

    private handleCompletion(taskId: string, task: TaskEntry): void {
        const panel = this.panelMap.get(taskId);
        if (!panel) return;

        const icon = panel.querySelector(".lilbee-dp-icon") as HTMLElement | null;

        if (task.status === TASK_STATUS.DONE) {
            panel.classList.add("lilbee-dp-done");
            if (icon) icon.textContent = ICON_DONE;
            const pct = panel.querySelector(".lilbee-dp-pct") as HTMLElement | null;
            if (pct) pct.textContent = "100%";
            const barFill = panel.querySelector(".lilbee-dp-bar-fill") as HTMLElement | null;
            if (barFill) barFill.style.width = "100%";
        } else if (task.status === TASK_STATUS.FAILED) {
            panel.classList.add("lilbee-dp-failed");
            if (icon) icon.textContent = ICON_FAILED;
            const name = panel.querySelector(".lilbee-dp-name") as HTMLElement | null;
            if (name && task.error) name.textContent = task.error;
        }

        const cancelBtn = panel.querySelector(".lilbee-dp-cancel") as HTMLElement | null;
        if (cancelBtn) cancelBtn.style.display = "none";

        this.scheduleDismiss(taskId);
    }

    private scheduleDismiss(taskId: string): void {
        if (this.dismissTimers.has(taskId)) return;
        const timer = setTimeout(() => {
            this.dismissPanel(taskId);
        }, DOWNLOAD_PANEL.DISMISS_DELAY_MS);
        this.dismissTimers.set(taskId, timer);
    }

    private dismissPanel(taskId: string): void {
        const timer = this.dismissTimers.get(taskId);
        if (timer) clearTimeout(timer);
        this.dismissTimers.delete(taskId);

        const panel = this.panelMap.get(taskId);
        if (panel) panel.remove();
        this.panelMap.delete(taskId);
        this.trackedIds.delete(taskId);

        this.render();
    }

    private updateSpinners(): void {
        for (const [id, panel] of this.panelMap) {
            if (this.dismissTimers.has(id)) continue;
            const icon = panel.querySelector(".lilbee-dp-icon") as HTMLElement | null;
            if (icon) icon.textContent = SPINNER_FRAMES[this.spinnerIndex];
        }
    }

    private isDownloadTask(task: TaskEntry): boolean {
        return task.type === TASK_TYPE.PULL || task.type === TASK_TYPE.DOWNLOAD;
    }
}
