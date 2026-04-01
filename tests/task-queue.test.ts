import { describe, it, expect, beforeEach, vi } from "vitest";
import { TaskQueue } from "../src/task-queue";
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
            const id1 = queue.enqueue("Sync vault", TASK_TYPE.SYNC);
            const id2 = queue.enqueue("Adding files", TASK_TYPE.ADD);

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

    describe("concurrent per-type queues", () => {
        it("runs one task per type at a time", () => {
            queue.enqueue("Sync 1", TASK_TYPE.SYNC);
            queue.enqueue("Add 1", TASK_TYPE.ADD);
            queue.enqueue("Download 1", TASK_TYPE.DOWNLOAD);

            expect(queue.activeAll).toHaveLength(3);
            expect(queue.queued).toHaveLength(0);
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

        it("preserves progress when update called with -1", () => {
            queue.enqueue("Task", TASK_TYPE.SYNC);
            const active = queue.active!;

            queue.update(active.id, 50);
            queue.update(active.id, -1, "new detail");

            expect(active.progress).toBe(50);
            expect(active.detail).toBe("new detail");
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

        it("activates next queued task of same type", () => {
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
            const id2 = queue.enqueue("Task 2", TASK_TYPE.SYNC);

            queue.cancel(id2);

            expect(queue.queued).toHaveLength(0);
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

    describe("activeAll getter", () => {
        it("returns empty array when no active tasks", () => {
            expect(queue.activeAll).toHaveLength(0);
        });

        it("returns all concurrently active tasks", () => {
            queue.enqueue("Sync", TASK_TYPE.SYNC);
            queue.enqueue("Add", TASK_TYPE.ADD);
            queue.enqueue("Download", TASK_TYPE.DOWNLOAD);

            const active = queue.activeAll;
            expect(active).toHaveLength(3);
            expect(active.map((t) => t.type)).toContain("sync");
            expect(active.map((t) => t.type)).toContain("add");
            expect(active.map((t) => t.type)).toContain("download");
        });
    });

    describe("active getter (backward compat)", () => {
        it("returns null when no active tasks", () => {
            expect(queue.active).toBeNull();
        });

        it("returns one active task when multiple are active", () => {
            queue.enqueue("Sync", TASK_TYPE.SYNC);
            queue.enqueue("Add", TASK_TYPE.ADD);

            expect(queue.active).not.toBeNull();
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

        it("handles moveToHistory when task not found", () => {
            queue.enqueue("Task 1", TASK_TYPE.SYNC);
            queue.enqueue("Task 2", TASK_TYPE.ADD);

            const active = queue.active;
            expect(active).not.toBeNull();
            queue.complete(active!.id);

            (queue as any).moveToHistory("non-existent");
        });

        it("returns null from active when task was deleted externally", () => {
            queue.enqueue("Task", TASK_TYPE.SYNC);

            const activeId = (queue as any).activeIds.get("sync");
            (queue as any).tasks.delete(activeId);

            const active = queue.active;
            expect(active).toBeNull();
        });

        it("queued getter handles missing tasks gracefully", () => {
            queue.enqueue("Sync 1", TASK_TYPE.SYNC);
            queue.enqueue("Sync 2", TASK_TYPE.SYNC);

            // Corrupt the internal queue by removing a task
            const queuedIds = (queue as any).queues.get("sync") as string[];
            const id = queuedIds[0];
            (queue as any).tasks.delete(id);

            // Should not crash, just skip the missing task
            expect(queue.queued.length).toBeLessThanOrEqual(1);
        });
    });
});
