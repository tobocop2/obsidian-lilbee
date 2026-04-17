import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { WorkspaceLeaf, MockElement } from "../__mocks__/obsidian";
import { TaskCenterView, VIEW_TYPE_TASKS } from "../../src/views/task-center";
import { TaskQueue } from "../../src/task-queue";
import { TASK_TYPE, TASK_STATUS } from "../../src/types";
import type LilbeePlugin from "../../src/main";

function makePlugin(): LilbeePlugin {
    return {
        taskQueue: new TaskQueue(),
    } as unknown as LilbeePlugin;
}

function makeLeaf(): WorkspaceLeaf {
    return new WorkspaceLeaf();
}

function collectTexts(el: MockElement): string[] {
    const texts: string[] = [];
    if (el.textContent) texts.push(el.textContent);
    for (const child of el.children) {
        texts.push(...collectTexts(child));
    }
    return texts;
}

function findByClass(el: MockElement, cls: string): MockElement[] {
    return el.findAll(cls);
}

describe("VIEW_TYPE_TASKS", () => {
    it("equals 'lilbee-tasks'", () => {
        expect(VIEW_TYPE_TASKS).toBe("lilbee-tasks");
    });
});

describe("TaskCenterView metadata", () => {
    let view: TaskCenterView;

    beforeEach(() => {
        view = new TaskCenterView(makeLeaf(), makePlugin());
    });

    it("getViewType returns 'lilbee-tasks'", () => {
        expect(view.getViewType()).toBe("lilbee-tasks");
    });

    it("getDisplayText returns 'lilbee Tasks'", () => {
        expect(view.getDisplayText()).toBe("lilbee Tasks");
    });

    it("getIcon returns 'list-checks'", () => {
        expect(view.getIcon()).toBe("list-checks");
    });
});

describe("TaskCenterView.onOpen", () => {
    let view: TaskCenterView;
    let plugin: LilbeePlugin;
    let contentEl: MockElement;

    beforeEach(async () => {
        plugin = makePlugin();
        view = new TaskCenterView(makeLeaf(), plugin);
        await view.onOpen();
        contentEl = (view as any).contentEl as MockElement;
    });

    afterEach(async () => {
        await view.onClose();
    });

    it("renders container with lilbee-tasks-container class", () => {
        expect(contentEl.classList.contains("lilbee-tasks-container")).toBe(true);
    });

    it("renders header with title and clear button", () => {
        const header = contentEl.find("lilbee-tasks-header");
        expect(header).not.toBeNull();
        const texts = collectTexts(header!);
        expect(texts.some((t) => t.includes("Task Center"))).toBe(true);

        const clearBtn = contentEl.find("lilbee-tasks-clear");
        expect(clearBtn).not.toBeNull();
        expect(clearBtn!.textContent).toBe("Clear");
    });

    it("renders three sections: ACTIVE, QUEUED, COMPLETED", () => {
        const sections = findByClass(contentEl, "lilbee-tasks-section");
        expect(sections.length).toBe(3);

        const headers = findByClass(contentEl, "lilbee-tasks-section-header");
        expect(headers.map((h) => h.textContent)).toEqual(["ACTIVE", "QUEUED", "COMPLETED"]);
    });

    it("renders empty state when no tasks", () => {
        const emptyEls = findByClass(contentEl, "lilbee-tasks-empty");
        expect(emptyEls.length).toBe(3);
        expect(emptyEls[0]!.textContent).toBe("No active tasks");
        expect(emptyEls[1]!.textContent).toBe("No queued tasks");
        expect(emptyEls[2]!.textContent).toBe("No completed tasks");
    });
});

describe("TaskCenterView rendering", () => {
    let view: TaskCenterView;
    let plugin: LilbeePlugin;
    let contentEl: MockElement;

    beforeEach(async () => {
        plugin = makePlugin();
        view = new TaskCenterView(makeLeaf(), plugin);
        await view.onOpen();
        contentEl = (view as any).contentEl as MockElement;
    });

    afterEach(async () => {
        await view.onClose();
    });

    it("renders active task with progress bar", () => {
        plugin.taskQueue.enqueue("Sync vault", TASK_TYPE.SYNC);

        // Trigger render via onChange
        (view as any).render();

        const rows = findByClass(contentEl, "lilbee-task-row");
        expect(rows.length).toBeGreaterThan(0);

        const progressBar = findByClass(contentEl, "lilbee-task-progress-bar");
        expect(progressBar.length).toBe(1);

        const name = findByClass(contentEl, "lilbee-task-name");
        expect(name[0]!.textContent).toBe("Sync vault");
    });

    it("renders active task with detail text", () => {
        const id = plugin.taskQueue.enqueue("Adding files", TASK_TYPE.ADD);
        plugin.taskQueue.update(id, 50, "file 2/4");

        (view as any).render();

        const details = findByClass(contentEl, "lilbee-task-detail");
        expect(details.length).toBe(1);
        expect(details[0]!.textContent).toBe("file 2/4");
    });

    it("renders active task progress percentage text", () => {
        const id = plugin.taskQueue.enqueue("Sync vault", TASK_TYPE.SYNC);
        plugin.taskQueue.update(id, 75);

        (view as any).render();

        const pctTexts = findByClass(contentEl, "lilbee-task-progress-text");
        expect(pctTexts.length).toBe(1);
        expect(pctTexts[0]!.textContent).toBe("75%");
    });

    it("renders queued tasks", () => {
        plugin.taskQueue.enqueue("Sync vault", TASK_TYPE.SYNC);
        plugin.taskQueue.enqueue("Sync again", TASK_TYPE.SYNC);

        (view as any).render();

        const names = findByClass(contentEl, "lilbee-task-name");
        expect(names.map((n) => n.textContent)).toContain("Sync again");
    });

    it("renders completed tasks with status icons and time", () => {
        const id = plugin.taskQueue.enqueue("Sync vault", TASK_TYPE.SYNC);
        plugin.taskQueue.complete(id);

        (view as any).render();

        const doneIcons = findByClass(contentEl, "lilbee-task-status-done");
        expect(doneIcons.length).toBe(1);
        expect(doneIcons[0]!.textContent).toBe("\u2713");

        const times = findByClass(contentEl, "lilbee-task-time");
        expect(times.length).toBe(1);
        expect(times[0]!.textContent).toBe("just now");
    });

    it("renders failed tasks with error icon and tooltip", () => {
        const id = plugin.taskQueue.enqueue("Crawl example.com", TASK_TYPE.CRAWL);
        plugin.taskQueue.fail(id, "connection refused");

        (view as any).render();

        const failedIcons = findByClass(contentEl, "lilbee-task-status-failed");
        expect(failedIcons.length).toBe(1);
        expect(failedIcons[0]!.textContent).toBe("\u2717");

        // Error tooltip on the row
        const rows = findByClass(contentEl, "lilbee-task-row");
        const completedRow = rows.find((r) => r.title !== "");
        expect(completedRow?.title).toBe("connection refused");
    });

    it("renders cancelled tasks with cancelled icon", () => {
        const id = plugin.taskQueue.enqueue("Sync vault", TASK_TYPE.SYNC);
        plugin.taskQueue.cancel(id);

        (view as any).render();

        const cancelledIcons = findByClass(contentEl, "lilbee-task-status-cancelled");
        expect(cancelledIcons.length).toBe(1);
        expect(cancelledIcons[0]!.textContent).toBe("\u25CB");
    });

    it("renders type badge with correct text", () => {
        plugin.taskQueue.enqueue("Sync vault", TASK_TYPE.SYNC);

        (view as any).render();

        const badges = findByClass(contentEl, "lilbee-task-type-badge");
        expect(badges.length).toBeGreaterThan(0);
        expect(badges[0]!.textContent).toBe("SYNC");
    });

    it("renders cancel button on active task with canCancel = true", () => {
        const _id = plugin.taskQueue.enqueue("Sync vault", TASK_TYPE.SYNC);
        const task = plugin.taskQueue.active!;
        // Force canCancel to true for testing
        (task as any).canCancel = true;

        (view as any).render();

        const cancelBtns = findByClass(contentEl, "lilbee-task-cancel");
        expect(cancelBtns.length).toBe(1);
        expect(cancelBtns[0]!.textContent).toBe("\u00D7");

        // Clicking it should call handleCancel
        const handleCancelSpy = vi.spyOn(view as any, "handleCancel");
        cancelBtns[0]!.trigger("click", { stopPropagation: vi.fn() });
        expect(handleCancelSpy).toHaveBeenCalledWith(task);
    });

    it("does not render cancel button on active task (canCancel = false)", () => {
        plugin.taskQueue.enqueue("Sync vault", TASK_TYPE.SYNC);

        (view as any).render();

        const cancelBtns = findByClass(contentEl, "lilbee-task-cancel");
        expect(cancelBtns.length).toBe(0);
    });

    it("clears empty state when tasks are present", () => {
        plugin.taskQueue.enqueue("Sync vault", TASK_TYPE.SYNC);

        (view as any).render();

        // Active section should not have empty state
        const activeSection = (view as any).activeSection as MockElement;
        const emptyInActive = activeSection.find("lilbee-tasks-empty");
        expect(emptyInActive).toBeNull();
    });

    it("removes stale task rows on re-render", () => {
        const id1 = plugin.taskQueue.enqueue("Task 1", TASK_TYPE.SYNC);
        (view as any).render();

        // Complete the task and re-render
        plugin.taskQueue.complete(id1);
        (view as any).render();

        // Active section should show empty state, not stale task row
        const activeSection = (view as any).activeSection as MockElement;
        const empty = activeSection.find("lilbee-tasks-empty");
        expect(empty).not.toBeNull();
    });
});

describe("TaskCenterView — cap pill", () => {
    it("hides cap pill when below MAX_CONCURRENT_BACKGROUND", async () => {
        const plugin = makePlugin();
        const view = new TaskCenterView(makeLeaf(), plugin);
        await view.onOpen();
        const contentEl = (view as any).contentEl as MockElement;
        plugin.taskQueue.enqueue("Sync vault", TASK_TYPE.SYNC);
        (view as any).render();
        const pill = contentEl.find("lilbee-tasks-cap-pill")!;
        expect(pill.style.display).toBe("none");
        await view.onClose();
    });

    it("shows cap pill with 2/2 running when saturated", async () => {
        const plugin = makePlugin();
        const view = new TaskCenterView(makeLeaf(), plugin);
        await view.onOpen();
        const contentEl = (view as any).contentEl as MockElement;
        plugin.taskQueue.enqueue("Sync", TASK_TYPE.SYNC);
        plugin.taskQueue.enqueue("Pull", TASK_TYPE.PULL);
        (view as any).render();
        const pill = contentEl.find("lilbee-tasks-cap-pill")!;
        expect(pill.style.display).toBe("");
        expect(pill.textContent).toBe("2/2 running");
        await view.onClose();
    });
});

describe("TaskCenterView — cap pill defensive guards", () => {
    it("renderCapPill bails when capPill is null", () => {
        const plugin = makePlugin();
        const view = new TaskCenterView(makeLeaf(), plugin);
        (view as any).capPill = null;
        expect(() => (view as any).renderCapPill()).not.toThrow();
    });
});

describe("TaskCenterView — indeterminate progress", () => {
    it("renders indeterminate bar when progress is -1", async () => {
        const plugin = makePlugin();
        const view = new TaskCenterView(makeLeaf(), plugin);
        await view.onOpen();
        const contentEl = (view as any).contentEl as MockElement;
        const id = plugin.taskQueue.enqueue("Adding", TASK_TYPE.ADD);
        plugin.taskQueue.update(id, -1, "preparing…");
        (view as any).render();
        const fills = contentEl.findAll("lilbee-task-progress-fill");
        expect(fills.length).toBe(1);
        expect(fills[0]!.classList.contains("lilbee-task-progress-indeterminate")).toBe(true);
        const pctTexts = contentEl.findAll("lilbee-task-progress-text");
        expect(pctTexts.length).toBe(0);
        await view.onClose();
    });

    it("renders percentage text when progress >= 0", async () => {
        const plugin = makePlugin();
        const view = new TaskCenterView(makeLeaf(), plugin);
        await view.onOpen();
        const contentEl = (view as any).contentEl as MockElement;
        const id = plugin.taskQueue.enqueue("Pull", TASK_TYPE.PULL);
        plugin.taskQueue.update(id, 40);
        (view as any).render();
        const fills = contentEl.findAll("lilbee-task-progress-fill");
        expect(fills[0]!.classList.contains("lilbee-task-progress-indeterminate")).toBe(false);
        const pctTexts = contentEl.findAll("lilbee-task-progress-text");
        expect(pctTexts[0]!.textContent).toBe("40%");
        await view.onClose();
    });
});

describe("TaskCenterView — clear history", () => {
    it("clear button removes completed tasks", async () => {
        const plugin = makePlugin();
        const view = new TaskCenterView(makeLeaf(), plugin);
        await view.onOpen();
        const contentEl = (view as any).contentEl as MockElement;

        const id = plugin.taskQueue.enqueue("Sync", TASK_TYPE.SYNC);
        plugin.taskQueue.complete(id);
        (view as any).render();

        expect(plugin.taskQueue.completed.length).toBe(1);

        const clearBtn = contentEl.find("lilbee-tasks-clear")!;
        clearBtn.trigger("click");

        expect(plugin.taskQueue.completed.length).toBe(0);

        await view.onClose();
    });
});

describe("TaskCenterView — cancel handling", () => {
    it("cancel on queued task removes it immediately", async () => {
        const plugin = makePlugin();
        const view = new TaskCenterView(makeLeaf(), plugin);
        await view.onOpen();

        // Queue two same-type tasks so second stays queued
        plugin.taskQueue.enqueue("Task 1", TASK_TYPE.SYNC);
        const id2 = plugin.taskQueue.enqueue("Task 2", TASK_TYPE.SYNC);

        // Call handleCancel on the queued task
        const task2 = plugin.taskQueue.queued.find((t) => t.id === id2);
        expect(task2).toBeDefined();
        (view as any).handleCancel(task2!);

        expect(plugin.taskQueue.queued.length).toBe(0);

        await view.onClose();
    });

    it("cancel on active task with canCancel=false prompts confirmation", async () => {
        const plugin = makePlugin();
        const view = new TaskCenterView(makeLeaf(), plugin);
        await view.onOpen();

        const _id = plugin.taskQueue.enqueue("Sync", TASK_TYPE.SYNC);
        const task = plugin.taskQueue.active!;
        expect(task.canCancel).toBe(false);

        // Mock confirm to return true
        const origConfirm = globalThis.confirm;
        globalThis.confirm = vi.fn().mockReturnValue(true);

        (view as any).handleCancel(task);

        expect(globalThis.confirm).toHaveBeenCalled();
        expect(plugin.taskQueue.completed.some((t) => t.status === TASK_STATUS.CANCELLED)).toBe(true);

        globalThis.confirm = origConfirm;

        await view.onClose();
    });

    it("cancel on active task with confirmation denied does not cancel", async () => {
        const plugin = makePlugin();
        const view = new TaskCenterView(makeLeaf(), plugin);
        await view.onOpen();

        plugin.taskQueue.enqueue("Sync", TASK_TYPE.SYNC);
        const task = plugin.taskQueue.active!;

        const origConfirm = globalThis.confirm;
        globalThis.confirm = vi.fn().mockReturnValue(false);

        (view as any).handleCancel(task);

        expect(globalThis.confirm).toHaveBeenCalled();
        expect(plugin.taskQueue.active).not.toBeNull();

        globalThis.confirm = origConfirm;

        await view.onClose();
    });
});

describe("TaskCenterView — subscribe/unsubscribe", () => {
    it("subscribes to taskQueue.onChange on open", async () => {
        const plugin = makePlugin();
        const onChangeSpy = vi.spyOn(plugin.taskQueue, "onChange");
        const view = new TaskCenterView(makeLeaf(), plugin);
        await view.onOpen();

        expect(onChangeSpy).toHaveBeenCalled();

        await view.onClose();
    });

    it("unsubscribes from taskQueue.onChange on close", async () => {
        const plugin = makePlugin();
        const view = new TaskCenterView(makeLeaf(), plugin);
        await view.onOpen();

        const unsubscribe = (view as any).unsubscribe;
        expect(unsubscribe).not.toBeNull();

        // After close, enqueuing a task should not trigger a re-render
        await view.onClose();
        const renderSpy = vi.spyOn(view as any, "render");
        plugin.taskQueue.enqueue("Test", TASK_TYPE.SYNC);
        expect(renderSpy).not.toHaveBeenCalled();
    });

    it("clears time refresh interval on close", async () => {
        const plugin = makePlugin();
        const view = new TaskCenterView(makeLeaf(), plugin);
        await view.onOpen();

        expect((view as any).timeRefreshInterval).not.toBeNull();

        const clearSpy = vi.spyOn(globalThis, "clearInterval");
        await view.onClose();

        expect(clearSpy).toHaveBeenCalled();
    });

    it("auto-updates when taskQueue changes", async () => {
        const plugin = makePlugin();
        const view = new TaskCenterView(makeLeaf(), plugin);
        await view.onOpen();
        const contentEl = (view as any).contentEl as MockElement;

        // Initially empty
        const emptyEls = findByClass(contentEl, "lilbee-tasks-empty");
        expect(emptyEls.some((e) => e.textContent === "No active tasks")).toBe(true);

        // Enqueue a task -- onChange fires render
        plugin.taskQueue.enqueue("Sync vault", TASK_TYPE.SYNC);

        const names = findByClass(contentEl, "lilbee-task-name");
        expect(names.some((n) => n.textContent === "Sync vault")).toBe(true);

        await view.onClose();
    });
});

describe("TaskCenterView — render edge cases", () => {
    it("render no-ops when sections are null", () => {
        const plugin = makePlugin();
        const view = new TaskCenterView(makeLeaf(), plugin);
        // Don't call onOpen -- sections are null
        expect(() => (view as any).render()).not.toThrow();
    });

    it("renderActive no-ops when activeSection is null", () => {
        const plugin = makePlugin();
        const view = new TaskCenterView(makeLeaf(), plugin);
        (view as any).activeSection = null;
        expect(() => (view as any).renderActive()).not.toThrow();
    });

    it("renderQueued no-ops when queuedSection is null", () => {
        const plugin = makePlugin();
        const view = new TaskCenterView(makeLeaf(), plugin);
        (view as any).queuedSection = null;
        expect(() => (view as any).renderQueued()).not.toThrow();
    });

    it("renderCompleted no-ops when completedSection is null", () => {
        const plugin = makePlugin();
        const view = new TaskCenterView(makeLeaf(), plugin);
        (view as any).completedSection = null;
        expect(() => (view as any).renderCompleted()).not.toThrow();
    });

    it("renders progress fill width based on task progress", async () => {
        const plugin = makePlugin();
        const view = new TaskCenterView(makeLeaf(), plugin);
        await view.onOpen();
        const contentEl = (view as any).contentEl as MockElement;

        const id = plugin.taskQueue.enqueue("Sync", TASK_TYPE.SYNC);
        plugin.taskQueue.update(id, 42);
        (view as any).render();

        const fill = findByClass(contentEl, "lilbee-task-progress-fill");
        expect(fill.length).toBe(1);
        expect(fill[0]!.style.width).toBe("42%");

        await view.onClose();
    });

    it("type badge color is applied via CSS class", async () => {
        const plugin = makePlugin();
        const view = new TaskCenterView(makeLeaf(), plugin);
        await view.onOpen();
        const contentEl = (view as any).contentEl as MockElement;

        plugin.taskQueue.enqueue("Pull model", TASK_TYPE.PULL);
        (view as any).render();

        const badges = findByClass(contentEl, "lilbee-task-type-badge");
        expect(badges[0]!.classList.contains("lilbee-task-badge-pull")).toBe(true);

        await view.onClose();
    });

    it("renders progress background div for active tasks", async () => {
        const plugin = makePlugin();
        const view = new TaskCenterView(makeLeaf(), plugin);
        await view.onOpen();
        const contentEl = (view as any).contentEl as MockElement;

        const id = plugin.taskQueue.enqueue("Sync", TASK_TYPE.SYNC);
        plugin.taskQueue.update(id, 60);
        (view as any).render();

        const progressBg = findByClass(contentEl, "lilbee-task-progress-bg");
        expect(progressBg.length).toBe(1);
        expect(progressBg[0]!.classList.contains("lilbee-task-progress-bg-sync")).toBe(true);
        expect(progressBg[0]!.style.width).toBe("60%");

        await view.onClose();
    });

    it("completed task without completedAt shows no time", async () => {
        const plugin = makePlugin();
        const view = new TaskCenterView(makeLeaf(), plugin);
        await view.onOpen();
        const contentEl = (view as any).contentEl as MockElement;

        const id = plugin.taskQueue.enqueue("Sync", TASK_TYPE.SYNC);
        plugin.taskQueue.complete(id);
        // Manually set completedAt to null for edge case
        const task = plugin.taskQueue.completed[0]!;
        (task as any).completedAt = null;

        (view as any).render();

        const times = findByClass(contentEl, "lilbee-task-time");
        expect(times[0]!.textContent).toBe("");

        await view.onClose();
    });
});

describe("relativeTime helper", () => {
    it("returns 'just now' for timestamps less than 60 seconds ago", async () => {
        const plugin = makePlugin();
        const view = new TaskCenterView(makeLeaf(), plugin);
        await view.onOpen();
        const contentEl = (view as any).contentEl as MockElement;

        const id = plugin.taskQueue.enqueue("Sync", TASK_TYPE.SYNC);
        plugin.taskQueue.complete(id);
        (view as any).render();

        const times = findByClass(contentEl, "lilbee-task-time");
        expect(times[0]!.textContent).toBe("just now");

        await view.onClose();
    });

    it("returns minutes for timestamps 1-59 minutes ago", async () => {
        const plugin = makePlugin();
        const view = new TaskCenterView(makeLeaf(), plugin);
        await view.onOpen();
        const contentEl = (view as any).contentEl as MockElement;

        const id = plugin.taskQueue.enqueue("Sync", TASK_TYPE.SYNC);
        plugin.taskQueue.complete(id);
        const task = plugin.taskQueue.completed[0]!;
        (task as any).completedAt = Date.now() - 5 * 60 * 1000;
        (view as any).render();

        const times = findByClass(contentEl, "lilbee-task-time");
        expect(times[0]!.textContent).toBe("5m ago");

        await view.onClose();
    });

    it("returns hours for timestamps 1-23 hours ago", async () => {
        const plugin = makePlugin();
        const view = new TaskCenterView(makeLeaf(), plugin);
        await view.onOpen();
        const contentEl = (view as any).contentEl as MockElement;

        const id = plugin.taskQueue.enqueue("Sync", TASK_TYPE.SYNC);
        plugin.taskQueue.complete(id);
        const task = plugin.taskQueue.completed[0]!;
        (task as any).completedAt = Date.now() - 3 * 60 * 60 * 1000;
        (view as any).render();

        const times = findByClass(contentEl, "lilbee-task-time");
        expect(times[0]!.textContent).toBe("3h ago");

        await view.onClose();
    });

    it("returns days for timestamps 24+ hours ago", async () => {
        const plugin = makePlugin();
        const view = new TaskCenterView(makeLeaf(), plugin);
        await view.onOpen();
        const contentEl = (view as any).contentEl as MockElement;

        const id = plugin.taskQueue.enqueue("Sync", TASK_TYPE.SYNC);
        plugin.taskQueue.complete(id);
        const task = plugin.taskQueue.completed[0]!;
        (task as any).completedAt = Date.now() - 2 * 24 * 60 * 60 * 1000;
        (view as any).render();

        const times = findByClass(contentEl, "lilbee-task-time");
        expect(times[0]!.textContent).toBe("2d ago");

        await view.onClose();
    });
});
