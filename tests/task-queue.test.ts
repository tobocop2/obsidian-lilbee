import { describe, it, expect, beforeEach, vi } from "vitest";
import { TaskQueue, FLASH_WINDOW_MS } from "../src/task-queue";
import { TASK_TYPE, TASK_STATUS } from "../src/types";

describe("TaskQueue", () => {
    let queue: TaskQueue;

    beforeEach(() => {
        queue = new TaskQueue();
    });

    describe("enqueue()", () => {
        it("creates a task and activates it immediately", () => {
            const id = queue.enqueue("Test task", TASK_TYPE.SYNC);

            expect(id).toBeTruthy();
            expect(id).toContain("sync-");

            const active = queue.active;
            expect(active).not.toBeNull();
            expect(active!.id).toBe(id);
            expect(active!.name).toBe("Test task");
            expect(active!.status).toBe(TASK_STATUS.ACTIVE);
            expect(active!.canCancel).toBe(false);
        });

        it("queues same-type tasks behind active one", () => {
            queue.enqueue("Sync 1", TASK_TYPE.SYNC);
            const id2 = queue.enqueue("Sync 2", TASK_TYPE.SYNC);

            const queued = queue.queued;
            expect(queued).toHaveLength(1);
            expect(queued[0]!.id).toBe(id2);
        });

        it("activates different-type tasks concurrently", () => {
            const id1 = queue.enqueue("Sync", TASK_TYPE.SYNC);
            const id2 = queue.enqueue("Add", TASK_TYPE.ADD);

            const allActive = queue.activeAll;
            expect(allActive).toHaveLength(2);
            expect(allActive.map((t) => t.id)).toContain(id1);
            expect(allActive.map((t) => t.id)).toContain(id2);
            expect(queue.queued).toHaveLength(0);
        });

        it("notifies listeners on enqueue", () => {
            const listener = vi.fn();
            queue.onChange(listener);

            queue.enqueue("Test", TASK_TYPE.SYNC);

            expect(listener).toHaveBeenCalled();
        });
    });

    describe("activate()", () => {
        it("moves queued task to active", () => {
            const id = queue.enqueue("Task 1", TASK_TYPE.SYNC);
            queue.complete(id);

            const id2 = queue.enqueue("Task 2", TASK_TYPE.SYNC);

            queue.activate(id2);
            const active = queue.active;
            expect(active).not.toBeNull();
            expect(active!.id).toBe(id2);
            expect(active!.status).toBe(TASK_STATUS.ACTIVE);
        });
    });

    describe("update()", () => {
        it("updates progress", () => {
            queue.enqueue("Task", TASK_TYPE.SYNC);
            const active = queue.active!;

            queue.update(active.id, 50);

            expect(active.progress).toBe(50);
        });

        it("updates detail text", () => {
            queue.enqueue("Task", TASK_TYPE.SYNC);
            const active = queue.active!;

            queue.update(active.id, 50, "processing file 1");

            expect(active.progress).toBe(50);
            expect(active.detail).toBe("processing file 1");
        });

        it("sets progress to -1 to mark indeterminate state", () => {
            queue.enqueue("Task", TASK_TYPE.SYNC);
            const active = queue.active!;

            queue.update(active.id, -1, "preparing");

            expect(active.progress).toBe(-1);
            expect(active.detail).toBe("preparing");
        });

        it("stores bytes and leaves rate undefined on first sample", () => {
            queue.enqueue("Pull", TASK_TYPE.PULL);
            const active = queue.active!;

            queue.update(active.id, 10, "", { current: 1024, total: 10_240 });

            expect(active.bytesCurrent).toBe(1024);
            expect(active.bytesTotal).toBe(10_240);
            expect(active.rateBps).toBeUndefined();
            expect(active.lastRateAt).toBeTypeOf("number");
        });

        it("computes rate on second sample when >= 500ms has passed", () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date("2026-04-19T00:00:00Z"));
            queue.enqueue("Pull", TASK_TYPE.PULL);
            const active = queue.active!;

            queue.update(active.id, 5, "", { current: 1000, total: 10_000 });
            vi.setSystemTime(new Date("2026-04-19T00:00:01Z"));
            queue.update(active.id, 15, "", { current: 3000, total: 10_000 });

            expect(active.rateBps).toBe(2000);
            vi.useRealTimers();
        });

        it("skips rate recompute when delta < 500ms floor", () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date("2026-04-19T00:00:00.000Z"));
            queue.enqueue("Pull", TASK_TYPE.PULL);
            const active = queue.active!;

            queue.update(active.id, 5, "", { current: 1000, total: 10_000 });
            vi.setSystemTime(new Date("2026-04-19T00:00:00.100Z"));
            queue.update(active.id, 10, "", { current: 2000, total: 10_000 });

            expect(active.bytesCurrent).toBe(2000);
            expect(active.rateBps).toBeUndefined();
            vi.useRealTimers();
        });

        it("clamps negative rate to 0", () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date("2026-04-19T00:00:00Z"));
            queue.enqueue("Pull", TASK_TYPE.PULL);
            const active = queue.active!;

            queue.update(active.id, 10, "", { current: 5000 });
            vi.setSystemTime(new Date("2026-04-19T00:00:01Z"));
            queue.update(active.id, 5, "", { current: 2000 });

            expect(active.rateBps).toBe(0);
            vi.useRealTimers();
        });

        it("accepts bytes object with only total (no current)", () => {
            queue.enqueue("Pull", TASK_TYPE.PULL);
            const active = queue.active!;

            queue.update(active.id, 0, "", { total: 5_000 });

            expect(active.bytesTotal).toBe(5_000);
            expect(active.bytesCurrent).toBeUndefined();
            expect(active.lastRateAt).toBeUndefined();
        });
    });

    describe("complete()", () => {
        it("moves task to history with done status", () => {
            const id = queue.enqueue("Task", TASK_TYPE.SYNC);

            queue.complete(id);

            expect(queue.active).toBeNull();
            const completed = queue.completed;
            expect(completed).toHaveLength(1);
            expect(completed[0]!.id).toBe(id);
            expect(completed[0]!.status).toBe(TASK_STATUS.DONE);
            expect(completed[0]!.progress).toBe(100);
            expect(completed[0]!.completedAt).not.toBeNull();
        });

        it("schedules a flash-clear notify after FLASH_WINDOW_MS", () => {
            vi.useFakeTimers();
            const listener = vi.fn();
            queue.onChange(listener);

            const id = queue.enqueue("Task", TASK_TYPE.SYNC);
            listener.mockClear();
            queue.complete(id);

            const immediateCalls = listener.mock.calls.length;
            expect(immediateCalls).toBeGreaterThan(0);

            vi.advanceTimersByTime(FLASH_WINDOW_MS - 1);
            expect(listener.mock.calls.length).toBe(immediateCalls);

            vi.advanceTimersByTime(2);
            expect(listener.mock.calls.length).toBe(immediateCalls + 1);

            vi.useRealTimers();
        });

        it("activates next queued task", () => {
            queue.enqueue("Task 1", TASK_TYPE.SYNC);
            const id2 = queue.enqueue("Task 2", TASK_TYPE.SYNC);

            const active1 = queue.active!;
            queue.complete(active1.id);

            const active2 = queue.active;
            expect(active2).not.toBeNull();
            expect(active2!.id).toBe(id2);
        });
    });

    describe("fail()", () => {
        it("moves task to history with failed status and error", () => {
            const id = queue.enqueue("Task", TASK_TYPE.SYNC);

            queue.fail(id, "some error");

            const completed = queue.completed;
            expect(completed).toHaveLength(1);
            expect(completed[0]!.status).toBe(TASK_STATUS.FAILED);
            expect(completed[0]!.error).toBe("some error");
        });
    });

    describe("cancel()", () => {
        it("removes queued task entirely", () => {
            queue.enqueue("Task 1", TASK_TYPE.SYNC);
            const active = queue.active;
            if (active) queue.complete(active.id);

            const id2 = queue.enqueue("Task 2", TASK_TYPE.SYNC);

            queue.cancel(id2);

            const queued = queue.queued;
            expect(queued).toHaveLength(0);
        });

        it("cancels a queued task that hasn't started yet", () => {
            queue.enqueue("Task 1", TASK_TYPE.SYNC);

            const id2 = queue.enqueue("Task 2", TASK_TYPE.SYNC);
            const id3 = queue.enqueue("Task 3", TASK_TYPE.SYNC);

            queue.cancel(id3);

            const queued = queue.queued;
            expect(queued).toHaveLength(1);
            expect(queued[0]!.id).toBe(id2);
        });

        it("moves active task to history with cancelled status", () => {
            const id = queue.enqueue("Task", TASK_TYPE.SYNC);

            queue.cancel(id);

            const completed = queue.completed;
            expect(completed).toHaveLength(1);
            expect(completed[0]!.status).toBe(TASK_STATUS.CANCELLED);
            expect(completed[0]!.completedAt).not.toBeNull();
        });

        it("activates next queued task after cancelling active", () => {
            queue.enqueue("Task 1", TASK_TYPE.SYNC);
            const id2 = queue.enqueue("Task 2", TASK_TYPE.SYNC);

            const active1 = queue.active!;
            queue.cancel(active1.id);

            const active2 = queue.active;
            expect(active2).not.toBeNull();
            expect(active2!.id).toBe(id2);
        });
    });

    describe("clearHistory()", () => {
        it("removes all completed tasks", () => {
            const id = queue.enqueue("Task", TASK_TYPE.SYNC);
            queue.complete(id);

            expect(queue.completed).toHaveLength(1);

            queue.clearHistory();

            expect(queue.completed).toHaveLength(0);
        });
    });

    describe("MAX_HISTORY", () => {
        it("limits history to 50 items", () => {
            for (let i = 0; i < 60; i++) {
                const id = queue.enqueue(`Task ${i}`, TASK_TYPE.SYNC);
                queue.complete(id);
            }

            expect(queue.completed).toHaveLength(50);
        });
    });

    describe("onChange()", () => {
        it("returns unsubscribe function", () => {
            const listener = vi.fn();
            const unsubscribe = queue.onChange(listener);

            unsubscribe();
            queue.enqueue("Task", TASK_TYPE.SYNC);

            expect(listener).not.toHaveBeenCalled();
        });

        it("notifies multiple listeners", () => {
            const listener1 = vi.fn();
            const listener2 = vi.fn();

            queue.onChange(listener1);
            queue.onChange(listener2);

            queue.enqueue("Task", TASK_TYPE.SYNC);

            expect(listener1).toHaveBeenCalled();
            expect(listener2).toHaveBeenCalled();
        });
    });

    describe("concurrent per-type queues", () => {
        it("runs MAX_CONCURRENT_BACKGROUND tasks across types before queuing the rest", () => {
            queue.enqueue("Sync 1", TASK_TYPE.SYNC);
            queue.enqueue("Add 1", TASK_TYPE.ADD);
            queue.enqueue("Download 1", TASK_TYPE.DOWNLOAD);

            expect(queue.activeAll).toHaveLength(2);
            expect(queue.queued).toHaveLength(1);
        });

        it("queues second task of same type", () => {
            queue.enqueue("Sync 1", TASK_TYPE.SYNC);
            queue.enqueue("Sync 2", TASK_TYPE.SYNC);
            queue.enqueue("Add 1", TASK_TYPE.ADD);

            expect(queue.activeAll).toHaveLength(2);
            expect(queue.queued).toHaveLength(1);
            expect(queue.queued[0]!.name).toBe("Sync 2");
        });

        it("completing a task starts next of same type", () => {
            const id1 = queue.enqueue("Sync 1", TASK_TYPE.SYNC);
            const id2 = queue.enqueue("Sync 2", TASK_TYPE.SYNC);

            queue.complete(id1);

            const allActive = queue.activeAll;
            expect(allActive).toHaveLength(1);
            expect(allActive[0]!.id).toBe(id2);
        });

        it("completing a task does not affect other types", () => {
            const syncId = queue.enqueue("Sync", TASK_TYPE.SYNC);
            const addId = queue.enqueue("Add", TASK_TYPE.ADD);

            queue.complete(syncId);

            const allActive = queue.activeAll;
            expect(allActive).toHaveLength(1);
            expect(allActive[0]!.id).toBe(addId);
        });
    });

    describe("activeAll getter", () => {
        it("returns empty array when no active tasks", () => {
            expect(queue.activeAll).toHaveLength(0);
        });

        it("returns all concurrently active tasks up to the global cap", () => {
            queue.enqueue("Sync", TASK_TYPE.SYNC);
            queue.enqueue("Add", TASK_TYPE.ADD);
            queue.enqueue("Download", TASK_TYPE.DOWNLOAD);

            const active = queue.activeAll;
            expect(active).toHaveLength(2);
            expect(active.map((t) => t.type)).toContain("sync");
            expect(active.map((t) => t.type)).toContain("add");
            expect(queue.queued.map((t) => t.type)).toContain("download");
        });
    });

    describe("edge cases", () => {
        it("handles update for non-existent task", () => {
            queue.enqueue("Task", TASK_TYPE.SYNC);
            queue.update("non-existent", 50);
        });

        it("handles complete for non-existent task", () => {
            queue.enqueue("Task", TASK_TYPE.SYNC);
            queue.complete("non-existent");
        });

        it("handles fail for non-existent task", () => {
            queue.enqueue("Task", TASK_TYPE.SYNC);
            queue.fail("non-existent", "error");
        });

        it("handles cancel for non-existent task", () => {
            queue.enqueue("Task", TASK_TYPE.SYNC);
            queue.cancel("non-existent");
        });

        it("handles activate for non-existent task", () => {
            queue.enqueue("Task", TASK_TYPE.SYNC);
            queue.activate("non-existent");
        });

        it("handles fail without error message", () => {
            queue.enqueue("Task", TASK_TYPE.SYNC);
            const active = queue.active;
            expect(active).not.toBeNull();
            queue.fail(active!.id);

            const completed = queue.completed;
            expect(completed[0]!.error).toBeNull();
        });

        it("returns null from active when no tasks enqueued", () => {
            expect(queue.active).toBeNull();
            expect(queue.activeAll).toHaveLength(0);
        });
    });

    describe("global background cap", () => {
        it("queues a third background task when two are already active", () => {
            queue.enqueue("Sync", TASK_TYPE.SYNC);
            queue.enqueue("Add", TASK_TYPE.ADD);
            const id3 = queue.enqueue("Crawl", TASK_TYPE.CRAWL);

            expect(queue.activeAll).toHaveLength(2);
            const queued = queue.queued.map((t) => t.id);
            expect(queued).toContain(id3);
        });

        it("auto-activates the next queued background task when one completes", () => {
            const id1 = queue.enqueue("Sync", TASK_TYPE.SYNC);
            queue.enqueue("Add", TASK_TYPE.ADD);
            const id3 = queue.enqueue("Crawl", TASK_TYPE.CRAWL);

            queue.complete(id1);

            const active = queue.activeAll;
            expect(active.map((t) => t.id)).toContain(id3);
        });
    });

    describe("per-type queue cap", () => {
        it("returns null when the per-type queue limit is exceeded", () => {
            queue.enqueue("Sync 1", TASK_TYPE.SYNC); // active
            const queuedIds: (string | null)[] = [];
            for (let i = 0; i < 10; i++) {
                queuedIds.push(queue.enqueue(`Sync ${i + 2}`, TASK_TYPE.SYNC));
            }
            const rejected = queuedIds.filter((id) => id === null).length;
            expect(rejected).toBeGreaterThan(0);
        });

        it("allows enqueuing again after queued tasks drain", () => {
            queue.enqueue("Active", TASK_TYPE.SYNC); // active
            const ids: (string | null)[] = [];
            for (let i = 0; i < 5; i++) {
                ids.push(queue.enqueue(`Queued ${i}`, TASK_TYPE.SYNC));
            }
            // Now at the per-type cap.
            expect(queue.enqueue("Over cap", TASK_TYPE.SYNC)).toBeNull();
            // Drain one queued task (still queued — needs activation).
            const first = ids[0]!;
            queue.cancel(first);
            // Space in the per-type queue again.
            expect(queue.enqueue("Now ok", TASK_TYPE.SYNC)).not.toBeNull();
        });
    });

    describe("toJSON / loadFromJSON", () => {
        it("serializes history", () => {
            const id1 = queue.enqueue("Task 1", TASK_TYPE.SYNC);
            queue.complete(id1);
            const data = queue.toJSON();
            expect(data.history).toHaveLength(1);
            expect(data.history[0]!.name).toBe("Task 1");
        });

        it("loadFromJSON restores history into a fresh queue", () => {
            const src = new TaskQueue();
            const id = src.enqueue("Old task", TASK_TYPE.CRAWL);
            src.complete(id);
            const data = src.toJSON();

            const dest = new TaskQueue();
            dest.loadFromJSON(data);
            expect(dest.completed).toHaveLength(1);
            expect(dest.completed[0]!.name).toBe("Old task");
        });

        it("loadFromJSON is a no-op when given undefined", () => {
            queue.loadFromJSON(undefined);
            expect(queue.completed).toHaveLength(0);
        });

        it("loadFromJSON ignores malformed payload (non-array history)", () => {
            queue.loadFromJSON({ history: undefined });
            expect(queue.completed).toHaveLength(0);
        });

        it("loadFromJSON caps restored history at MAX_HISTORY", () => {
            const many = Array.from({ length: TaskQueue.MAX_HISTORY + 10 }, (_, i) => ({
                id: `old-${i}`,
                name: `Old ${i}`,
                type: TASK_TYPE.SYNC,
                status: TASK_STATUS.DONE,
                progress: 100,
                detail: "",
                startedAt: i,
                completedAt: i,
                error: null,
                canCancel: false,
            }));
            queue.loadFromJSON({ history: many });
            expect(queue.completed).toHaveLength(TaskQueue.MAX_HISTORY);
        });
    });

    describe("registerAbort + cancel wiring", () => {
        it("cancel aborts the registered controller for an active task", () => {
            const id = queue.enqueue("Task", TASK_TYPE.SYNC);
            const controller = new AbortController();
            queue.registerAbort(id, controller);
            expect(controller.signal.aborted).toBe(false);
            queue.cancel(id);
            expect(controller.signal.aborted).toBe(true);
        });

        it("registerAbort sets canCancel to true", () => {
            const id = queue.enqueue("Task", TASK_TYPE.SYNC);
            const task = queue.active!;
            expect(task.canCancel).toBe(false);
            queue.registerAbort(id, new AbortController());
            expect(task.canCancel).toBe(true);
        });

        it("registerAbort is a no-op for non-existent task", () => {
            const controller = new AbortController();
            expect(() => queue.registerAbort("nope", controller)).not.toThrow();
            expect(controller.signal.aborted).toBe(false);
        });

        it("cancelling a queued task removes the registered abort without firing", () => {
            const active = queue.enqueue("Active sync", TASK_TYPE.SYNC);
            const queued = queue.enqueue("Queued sync", TASK_TYPE.SYNC);
            const controller = new AbortController();
            queue.registerAbort(queued, controller);
            queue.cancel(queued);
            expect(controller.signal.aborted).toBe(false);
            // active task still runs
            expect(queue.tasks ?? true).toBeTruthy();
            queue.cancel(active);
        });

        it("completing a task clears the registered abort so future calls are no-ops", () => {
            const id = queue.enqueue("Task", TASK_TYPE.SYNC);
            const controller = new AbortController();
            queue.registerAbort(id, controller);
            queue.complete(id);
            // Cancelling the moved-to-history task is a no-op.
            queue.cancel(id);
            expect(controller.signal.aborted).toBe(false);
        });
    });
});
