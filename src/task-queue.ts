import type { TaskEntry, TaskType } from "./types";
import { BACKGROUND_TASK_TYPES, TASK_QUEUE, TASK_STATUS } from "./types";

export type TaskChangeListener = () => void;

const RATE_SAMPLE_FLOOR_MS = 500;
export const FLASH_WINDOW_MS = 2000;

export class TaskQueue {
    private tasks: Map<string, TaskEntry> = new Map();
    private queues: Map<TaskType, string[]> = new Map();
    private activeIds: Map<TaskType, string | null> = new Map();
    private aborts: Map<string, AbortController> = new Map();
    private history: TaskEntry[] = [];
    private listeners: TaskChangeListener[] = [];
    private flashTimers: Set<ReturnType<typeof setTimeout>> = new Set();

    static readonly MAX_HISTORY = 50;

    /** Clear pending flash-clear timers — call from plugin unload to avoid zombie notifies. */
    dispose(): void {
        for (const handle of this.flashTimers) clearTimeout(handle);
        this.flashTimers.clear();
    }

    registerAbort(id: string, controller: AbortController): void {
        const task = this.tasks.get(id);
        if (!task) return;
        this.aborts.set(id, controller);
        task.canCancel = true;
        this.notify();
    }

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

    enqueue(name: string, type: TaskType): string | null {
        if (this.typeQueue(type).length >= TASK_QUEUE.MAX_QUEUED_PER_TYPE) {
            return null;
        }
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

    private backgroundActiveCount(): number {
        let count = 0;
        for (const [type, id] of this.activeIds) {
            if (id && BACKGROUND_TASK_TYPES.has(type)) count++;
        }
        return count;
    }

    private processType(type: TaskType): void {
        if (this.activeIds.get(type)) return;
        const q = this.queues.get(type);
        if (!q || q.length === 0) return;
        if (BACKGROUND_TASK_TYPES.has(type) && this.backgroundActiveCount() >= TASK_QUEUE.MAX_CONCURRENT_BACKGROUND) {
            return;
        }

        const nextId = q.shift()!;
        this.activate(nextId);
    }

    private processAll(): void {
        for (const type of this.queues.keys()) {
            this.processType(type);
        }
    }

    activate(id: string): void {
        const task = this.tasks.get(id);
        if (!task) return;
        if (task.status !== TASK_STATUS.QUEUED) return;

        task.status = TASK_STATUS.ACTIVE;
        task.canCancel = this.aborts.has(id);
        this.activeIds.set(task.type, id);
        this.notify();
    }

    update(id: string, progress: number, detail?: string, bytes?: { current?: number; total?: number }): void {
        const task = this.tasks.get(id);
        if (!task) return;
        task.progress = progress;
        if (detail !== undefined) task.detail = detail;
        if (bytes) {
            if (bytes.total !== undefined) task.bytesTotal = bytes.total;
            if (bytes.current !== undefined) {
                const now = Date.now();
                const prevBytes = task.bytesCurrent;
                const prevAt = task.lastRateAt;
                task.bytesCurrent = bytes.current;
                if (prevBytes !== undefined && prevAt !== undefined) {
                    const elapsedMs = now - prevAt;
                    if (elapsedMs >= RATE_SAMPLE_FLOOR_MS) {
                        const deltaBytes = bytes.current - prevBytes;
                        const rate = (deltaBytes / elapsedMs) * 1000;
                        task.rateBps = rate > 0 ? rate : 0;
                        task.lastRateAt = now;
                    }
                } else {
                    task.lastRateAt = now;
                }
            }
        }
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
            this.aborts.delete(id);
            this.notify();
            return;
        }

        if (task.status === TASK_STATUS.ACTIVE) {
            this.aborts.get(id)?.abort();
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

        this.aborts.delete(id);
        this.history.unshift(task);
        if (this.history.length > TaskQueue.MAX_HISTORY) {
            this.history.pop();
        }

        this.tasks.delete(id);
        this.notify();
        this.scheduleFlashClear();
        this.processAll();
    }

    private scheduleFlashClear(): void {
        const handle = setTimeout(() => {
            this.flashTimers.delete(handle);
            this.notify();
        }, FLASH_WINDOW_MS);
        this.flashTimers.add(handle);
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

    toJSON(): { history: TaskEntry[] } {
        return { history: [...this.history] };
    }

    loadFromJSON(data: { history?: TaskEntry[] } | undefined): void {
        if (!data || !Array.isArray(data.history)) return;
        this.history = data.history.slice(0, TaskQueue.MAX_HISTORY);
        this.notify();
    }
}
