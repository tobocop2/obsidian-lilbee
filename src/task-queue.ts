import type { TaskEntry, TaskType } from "./types";
import { TASK_STATUS } from "./types";

export type TaskChangeListener = () => void;

export class TaskQueue {
    private tasks: Map<string, TaskEntry> = new Map();
    private queues: Map<TaskType, string[]> = new Map();
    private activeIds: Map<TaskType, string | null> = new Map();
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

    private typeQueue(type: TaskType): string[] {
        let q = this.queues.get(type);
        if (!q) {
            q = [];
            this.queues.set(type, q);
        }
        return q;
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
        this.typeQueue(type).push(id);
        this.processType(type);
        return id;
    }

    private processType(type: TaskType): void {
        if (this.activeIds.get(type)) return;
        const q = this.queues.get(type);
        if (!q || q.length === 0) return;

        const nextId = q.shift()!;
        this.activate(nextId);
    }

    activate(id: string): void {
        const task = this.tasks.get(id);
        if (!task) return;
        if (task.status !== TASK_STATUS.QUEUED) return;

        task.status = TASK_STATUS.ACTIVE;
        task.canCancel = false;
        this.activeIds.set(task.type, id);
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
            const q = this.queues.get(task.type);
            if (q) {
                const idx = q.indexOf(id);
                if (idx >= 0) q.splice(idx, 1);
            }
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
        const task = this.tasks.get(id)!;

        if (this.activeIds.get(task.type) === id) {
            this.activeIds.set(task.type, null);
        }

        this.history.unshift(task);
        if (this.history.length > TaskQueue.MAX_HISTORY) {
            this.history.pop();
        }

        this.tasks.delete(id);
        this.notify();
        this.processType(task.type);
    }

    /** Returns the first active task found (backward compat). */
    get active(): TaskEntry | null {
        for (const id of this.activeIds.values()) {
            if (id) {
                const task = this.tasks.get(id);
                if (task) return task;
            }
        }
        return null;
    }

    /** Returns all currently active tasks across all types. */
    get activeAll(): TaskEntry[] {
        const result: TaskEntry[] = [];
        for (const id of this.activeIds.values()) {
            if (id) {
                const task = this.tasks.get(id);
                if (task) result.push(task);
            }
        }
        return result;
    }

    get queued(): TaskEntry[] {
        const result: TaskEntry[] = [];
        for (const q of this.queues.values()) {
            for (const id of q) {
                const task = this.tasks.get(id);
                if (task) result.push(task);
            }
        }
        return result;
    }

    get completed(): TaskEntry[] {
        return [...this.history];
    }

    clearHistory(): void {
        this.history = [];
        this.notify();
    }
}
