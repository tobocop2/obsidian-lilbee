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

    it("renders counters in header", () => {
        const counters = contentEl.find("lilbee-tasks-counters");
        expect(counters).not.toBeNull();
        expect(counters!.textContent).toBe("0 running · 0 queued · 0 done");
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

    it("renders active task row with rail, body, progress bar", () => {
        plugin.taskQueue.enqueue("Sync vault", TASK_TYPE.SYNC);
        (view as any).render();

        const rows = findByClass(contentEl, "lilbee-task-row");
        expect(rows.length).toBeGreaterThan(0);
        expect(rows[0]!.dataset.state).toBe("active");
        expect(rows[0]!.dataset.type).toBe("sync");

        const rails = findByClass(contentEl, "lilbee-task-rail");
        expect(rails.length).toBe(1);

        const names = findByClass(contentEl, "lilbee-task-name");
        expect(names[0]!.textContent).toBe("Sync vault");

        const bars = findByClass(contentEl, "lilbee-task-progress-bar");
        expect(bars.length).toBe(1);
    });

    it("renders stats label from task detail when no bytes", () => {
        const id = plugin.taskQueue.enqueue("Adding files", TASK_TYPE.ADD);
        plugin.taskQueue.update(id, 50, "file 2/4");
        (view as any).render();

        const stats = findByClass(contentEl, "lilbee-task-stats-label");
        expect(stats.length).toBe(1);
        expect(stats[0]!.textContent).toBe("file 2/4");
    });

    it("renders bytes and rate when provided on a pull task", () => {
        const id = plugin.taskQueue.enqueue("Pull demo", TASK_TYPE.PULL);
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-04-19T00:00:00Z"));
        plugin.taskQueue.update(id, 10, "", { current: 1_000_000, total: 10_000_000 });
        vi.setSystemTime(new Date("2026-04-19T00:00:01Z"));
        plugin.taskQueue.update(id, 30, "", { current: 3_000_000, total: 10_000_000 });
        (view as any).render();

        const stats = findByClass(contentEl, "lilbee-task-stats-label");
        expect(stats[0]!.textContent).toContain("MB");
        expect(stats[0]!.textContent).toContain("MB/s");
        expect(stats[0]!.textContent).toContain("/");

        vi.useRealTimers();
    });

    it("renders percentage in pct label", () => {
        const id = plugin.taskQueue.enqueue("Sync vault", TASK_TYPE.SYNC);
        plugin.taskQueue.update(id, 75);
        (view as any).render();

        const pctTexts = findByClass(contentEl, "lilbee-task-pct");
        expect(pctTexts.length).toBe(1);
        expect(pctTexts[0]!.textContent).toBe("75%");
    });

    it("renders elapsed timer in mm:ss format for active row meta", () => {
        const id = plugin.taskQueue.enqueue("Sync", TASK_TYPE.SYNC);
        const task = plugin.taskQueue.active!;
        (task as any).startedAt = Date.now() - 65_000;
        void id;
        (view as any).render();

        const meta = findByClass(contentEl, "lilbee-task-meta");
        expect(meta[0]!.textContent).toMatch(/^01:0\d$/);
    });

    it("renders queued tasks with data-state=queued", () => {
        plugin.taskQueue.enqueue("Sync vault", TASK_TYPE.SYNC);
        plugin.taskQueue.enqueue("Sync again", TASK_TYPE.SYNC);
        (view as any).render();

        const rows = findByClass(contentEl, "lilbee-task-row");
        const queuedRow = rows.find((r) => r.dataset.state === "queued");
        expect(queuedRow).toBeDefined();
        const meta = queuedRow!.find("lilbee-task-meta");
        expect(meta!.textContent).toBe("queued");
    });

    it("renders completed/done rows with state and relative time", () => {
        const id = plugin.taskQueue.enqueue("Sync vault", TASK_TYPE.SYNC);
        plugin.taskQueue.complete(id);
        (view as any).render();

        const rows = findByClass(contentEl, "lilbee-task-row");
        expect(rows.length).toBe(1);
        expect(rows[0]!.dataset.state).toBe("done");

        const meta = rows[0]!.find("lilbee-task-meta");
        expect(meta!.textContent).toBe("just now");
    });

    it("renders failed rows with error tooltip", () => {
        const id = plugin.taskQueue.enqueue("Crawl example.com", TASK_TYPE.CRAWL);
        plugin.taskQueue.fail(id, "connection refused");
        (view as any).render();

        const rows = findByClass(contentEl, "lilbee-task-row");
        expect(rows[0]!.dataset.state).toBe("failed");
        expect(rows[0]!.title).toBe("connection refused");
    });

    it("renders cancelled rows with data-state=cancelled", () => {
        const id = plugin.taskQueue.enqueue("Sync vault", TASK_TYPE.SYNC);
        plugin.taskQueue.cancel(id);
        (view as any).render();

        const rows = findByClass(contentEl, "lilbee-task-row");
        expect(rows[0]!.dataset.state).toBe("cancelled");
    });

    it("renders type badge with correct text and class", () => {
        plugin.taskQueue.enqueue("Pull model", TASK_TYPE.PULL);
        (view as any).render();

        const badges = findByClass(contentEl, "lilbee-task-type-badge");
        expect(badges[0]!.textContent).toBe("PULL");
        expect(badges[0]!.classList.contains("lilbee-task-badge-pull")).toBe(true);
    });

    it("renders cancel button on active task with canCancel = true", () => {
        const _id = plugin.taskQueue.enqueue("Sync vault", TASK_TYPE.SYNC);
        const task = plugin.taskQueue.active!;
        (task as any).canCancel = true;
        (view as any).render();

        const cancelBtns = findByClass(contentEl, "lilbee-task-cancel");
        expect(cancelBtns.length).toBe(1);
        expect(cancelBtns[0]!.textContent).toBe("\u00D7");

        const handleCancelSpy = vi.spyOn(view as any, "handleCancel");
        cancelBtns[0]!.trigger("click", { stopPropagation: vi.fn() });
        expect(handleCancelSpy).toHaveBeenCalledWith(task);
    });

    it("does not render cancel button on active task when canCancel = false", () => {
        plugin.taskQueue.enqueue("Sync vault", TASK_TYPE.SYNC);
        (view as any).render();

        const cancelBtns = findByClass(contentEl, "lilbee-task-cancel");
        expect(cancelBtns.length).toBe(0);
    });

    it("clears empty state when tasks are present", () => {
        plugin.taskQueue.enqueue("Sync vault", TASK_TYPE.SYNC);
        (view as any).render();

        const activeSection = (view as any).activeSection as MockElement;
        const emptyInActive = activeSection.find("lilbee-tasks-empty");
        expect(emptyInActive).toBeNull();
    });

    it("removes stale task rows on re-render", () => {
        const id1 = plugin.taskQueue.enqueue("Task 1", TASK_TYPE.SYNC);
        (view as any).render();

        plugin.taskQueue.complete(id1);
        (view as any).render();

        const activeSection = (view as any).activeSection as MockElement;
        const empty = activeSection.find("lilbee-tasks-empty");
        expect(empty).not.toBeNull();
    });

    it("updates counters as tasks progress", () => {
        plugin.taskQueue.enqueue("a", TASK_TYPE.SYNC);
        const pullId = plugin.taskQueue.enqueue("b", TASK_TYPE.PULL);
        plugin.taskQueue.enqueue("c", TASK_TYPE.SYNC);
        plugin.taskQueue.complete(pullId);
        (view as any).render();

        const counters = contentEl.find("lilbee-tasks-counters");
        expect(counters!.textContent).toBe("1 running · 1 queued · 1 done");
    });

    it("applies lilbee-task-flash class to rows still within flash window", () => {
        const id = plugin.taskQueue.enqueue("Pull demo", TASK_TYPE.PULL);
        plugin.taskQueue.complete(id);
        (view as any).render();

        const row = contentEl.find("lilbee-task-row")!;
        expect(row.classList.contains("lilbee-task-flash")).toBe(true);
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

describe("TaskCenterView — defensive guards", () => {
    it("renderCapPill bails when capPill is null", () => {
        const plugin = makePlugin();
        const view = new TaskCenterView(makeLeaf(), plugin);
        (view as any).capPill = null;
        expect(() => (view as any).renderCapPill()).not.toThrow();
    });

    it("renderCounters bails when countersEl is null", () => {
        const plugin = makePlugin();
        const view = new TaskCenterView(makeLeaf(), plugin);
        (view as any).countersEl = null;
        expect(() => (view as any).renderCounters()).not.toThrow();
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
        const pctTexts = contentEl.findAll("lilbee-task-pct");
        expect(pctTexts[0]!.textContent).toBe("");
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
        const pctTexts = contentEl.findAll("lilbee-task-pct");
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

        plugin.taskQueue.enqueue("Task 1", TASK_TYPE.SYNC);
        const id2 = plugin.taskQueue.enqueue("Task 2", TASK_TYPE.SYNC);

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

        await view.onClose();
        const renderSpy = vi.spyOn(view as any, "render");
        plugin.taskQueue.enqueue("Test", TASK_TYPE.SYNC);
        expect(renderSpy).not.toHaveBeenCalled();
    });

    it("clears refresh interval on close", async () => {
        const plugin = makePlugin();
        const view = new TaskCenterView(makeLeaf(), plugin);
        await view.onOpen();

        expect((view as any).refreshInterval).not.toBeNull();

        const clearSpy = vi.spyOn(globalThis, "clearInterval");
        await view.onClose();

        expect(clearSpy).toHaveBeenCalled();
    });

    it("retunes refresh interval to 1s while active tasks exist", async () => {
        const plugin = makePlugin();
        const view = new TaskCenterView(makeLeaf(), plugin);
        await view.onOpen();

        expect((view as any).refreshIntervalMs).toBe(30_000);

        plugin.taskQueue.enqueue("Sync", TASK_TYPE.SYNC);
        expect((view as any).refreshIntervalMs).toBe(1000);

        const id = plugin.taskQueue.active!.id;
        plugin.taskQueue.complete(id);
        expect((view as any).refreshIntervalMs).toBe(30_000);

        await view.onClose();
    });

    it("auto-updates when taskQueue changes", async () => {
        const plugin = makePlugin();
        const view = new TaskCenterView(makeLeaf(), plugin);
        await view.onOpen();
        const contentEl = (view as any).contentEl as MockElement;

        const emptyEls = findByClass(contentEl, "lilbee-tasks-empty");
        expect(emptyEls.some((e) => e.textContent === "No active tasks")).toBe(true);

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

    it("completed task without completedAt shows no time", async () => {
        const plugin = makePlugin();
        const view = new TaskCenterView(makeLeaf(), plugin);
        await view.onOpen();
        const contentEl = (view as any).contentEl as MockElement;

        const id = plugin.taskQueue.enqueue("Sync", TASK_TYPE.SYNC);
        plugin.taskQueue.complete(id);
        const task = plugin.taskQueue.completed[0]!;
        (task as any).completedAt = null;

        (view as any).render();

        const meta = findByClass(contentEl, "lilbee-task-meta");
        expect(meta[0]!.textContent).toBe("done");

        await view.onClose();
    });

    it("failed task without completedAt shows 'failed' label", async () => {
        const plugin = makePlugin();
        const view = new TaskCenterView(makeLeaf(), plugin);
        await view.onOpen();
        const contentEl = (view as any).contentEl as MockElement;

        const id = plugin.taskQueue.enqueue("Crawl", TASK_TYPE.CRAWL);
        plugin.taskQueue.fail(id, "boom");
        const task = plugin.taskQueue.completed[0]!;
        (task as any).completedAt = null;

        (view as any).render();

        const meta = findByClass(contentEl, "lilbee-task-meta");
        expect(meta[0]!.textContent).toBe("failed");

        await view.onClose();
    });

    it("cancelled task without completedAt shows 'cancelled' label", async () => {
        const plugin = makePlugin();
        const view = new TaskCenterView(makeLeaf(), plugin);
        await view.onOpen();
        const contentEl = (view as any).contentEl as MockElement;

        const id = plugin.taskQueue.enqueue("Sync", TASK_TYPE.SYNC);
        plugin.taskQueue.cancel(id);
        const task = plugin.taskQueue.completed[0]!;
        (task as any).completedAt = null;

        (view as any).render();

        const meta = findByClass(contentEl, "lilbee-task-meta");
        expect(meta[0]!.textContent).toBe("cancelled");

        await view.onClose();
    });

    it("stats line shows detail text when no bytes tracked for completed row", async () => {
        const plugin = makePlugin();
        const view = new TaskCenterView(makeLeaf(), plugin);
        await view.onOpen();
        const contentEl = (view as any).contentEl as MockElement;

        const id = plugin.taskQueue.enqueue("Sync", TASK_TYPE.SYNC);
        plugin.taskQueue.update(id, 100, "all files embedded");
        plugin.taskQueue.complete(id);
        (view as any).render();

        const statsLabel = findByClass(contentEl, "lilbee-task-stats-label");
        expect(statsLabel[0]!.textContent).toBe("all files embedded");

        await view.onClose();
    });

    it("stats line falls back to error on failed row without detail", async () => {
        const plugin = makePlugin();
        const view = new TaskCenterView(makeLeaf(), plugin);
        await view.onOpen();
        const contentEl = (view as any).contentEl as MockElement;

        const id = plugin.taskQueue.enqueue("Crawl", TASK_TYPE.CRAWL);
        plugin.taskQueue.fail(id, "connection refused");
        (view as any).render();

        const statsLabel = findByClass(contentEl, "lilbee-task-stats-label");
        expect(statsLabel[0]!.textContent).toBe("connection refused");

        await view.onClose();
    });

    it("renders only bytesCurrent when no total provided", async () => {
        const plugin = makePlugin();
        const view = new TaskCenterView(makeLeaf(), plugin);
        await view.onOpen();
        const contentEl = (view as any).contentEl as MockElement;

        const id = plugin.taskQueue.enqueue("Pull", TASK_TYPE.PULL);
        plugin.taskQueue.update(id, 10, "", { current: 500_000 });
        (view as any).render();

        const stats = findByClass(contentEl, "lilbee-task-stats-label");
        expect(stats[0]!.textContent).toContain("KB");
        expect(stats[0]!.textContent).not.toContain("/");

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

        const meta = findByClass(contentEl, "lilbee-task-meta");
        expect(meta[0]!.textContent).toBe("just now");

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

        const meta = findByClass(contentEl, "lilbee-task-meta");
        expect(meta[0]!.textContent).toBe("5m ago");

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

        const meta = findByClass(contentEl, "lilbee-task-meta");
        expect(meta[0]!.textContent).toBe("3h ago");

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

        const meta = findByClass(contentEl, "lilbee-task-meta");
        expect(meta[0]!.textContent).toBe("2d ago");

        await view.onClose();
    });
});
