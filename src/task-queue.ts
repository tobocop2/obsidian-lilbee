import type { TaskEntry, TaskStatus, TaskType } from "./types";
import { TASK_STATUS } from "./types";

export type TaskChangeListener = () => void;

export class TaskQueue {
    private tasks: Map<string, TaskEntry> = new Map();
    private queue: string[] = [];
    private activeId: string | null = null;
    private history: TaskEntry[] = [];
    private listeners: TaskChangeListener[] = [];

    static readonly MAX_HISTORY = 50;

    onChange(listener: TaskChangeListener): () => void {
        this.listeners.push(listener);
        return () => {
            const idx = this.listeners.indexOf(listener);
            if (idx >= 0) this.listeners.splice(idx, 1);
        };
    }

    private notify(): void {
        for (const listener of this.listeners) {
            listener();
        }
    }

    enqueue(name: string, type: TaskType): string {
        const id = `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        const task: TaskEntry = {
            id,
            name,
            type,
            status: TASK_STATUS.QUEUED,
            progress: 0,
            detail: "",
            startedAt: Date.now(),
            completedAt: null,
            error: null,
            canCancel: true,
        };
        this.tasks.set(id, task);
        this.queue.push(id);
        this.processQueue();
        return id;
    }

    private processQueue(): void {
        if (this.activeId) return;
        if (this.queue.length === 0) return;

        const nextId = this.queue.shift()!;
        this.activate(nextId);
    }

    activate(id: string): void {
        const task = this.tasks.get(id);
        if (!task) return;
        if (task.status !== TASK_STATUS.QUEUED) return;

        task.status = TASK_STATUS.ACTIVE;
        task.canCancel = false;
        this.activeId = id;
        this.notify();
    }

    update(id: string, progress: number, detail?: string): void {
        const task = this.tasks.get(id);
        if (!task) return;
        if (progress >= 0) task.progress = progress;
        if (detail !== undefined) task.detail = detail;
        this.notify();
    }

    complete(id: string): void {
        const task = this.tasks.get(id);
        if (!task) return;

        task.status = TASK_STATUS.DONE;
        task.progress = 100;
        task.completedAt = Date.now();
        this.moveToHistory(id);
    }

    fail(id: string, error?: string): void {
        const task = this.tasks.get(id);
        if (!task) return;

        task.status = TASK_STATUS.FAILED;
        task.error = error ?? null;
        task.completedAt = Date.now();
        this.moveToHistory(id);
    }

    cancel(id: string): void {
        const task = this.tasks.get(id);
        if (!task) return;

        if (task.status === TASK_STATUS.QUEUED) {
            this.queue = this.queue.filter((qid) => qid !== id);
            this.tasks.delete(id);
            this.notify();
            return;
        }

        if (task.status === TASK_STATUS.ACTIVE) {
            task.status = TASK_STATUS.CANCELLED;
            task.completedAt = Date.now();
            this.moveToHistory(id);
        }
    }

    private moveToHistory(id: string): void {
        const task = this.tasks.get(id);
        if (!task) return;

        if (this.activeId === id) {
            this.activeId = null;
        }

        this.history.unshift(task);
        if (this.history.length > TaskQueue.MAX_HISTORY) {
            this.history.pop();
        }

        this.tasks.delete(id);
        this.notify();
        this.processQueue();
    }

    get active(): TaskEntry | null {
        if (!this.activeId) return null;
        const task = this.tasks.get(this.activeId);
        return task !== undefined ? task : null;
    }

    get queued(): TaskEntry[] {
        return this.queue.map((id) => this.tasks.get(id)!).filter(Boolean);
    }

    get completed(): TaskEntry[] {
        return [...this.history];
    }

    clearHistory(): void {
        this.history = [];
        this.notify();
    }
}
