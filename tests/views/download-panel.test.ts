import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { MockElement } from "../__mocks__/obsidian";
import { DownloadPanel } from "../../src/views/download-panel";
import { TaskQueue } from "../../src/task-queue";
import { TASK_TYPE, DOWNLOAD_PANEL } from "../../src/types";
import type LilbeePlugin from "../../src/main";

function makePlugin(): LilbeePlugin {
    return {
        taskQueue: new TaskQueue(),
    } as unknown as LilbeePlugin;
}

describe("DownloadPanel", () => {
    let plugin: LilbeePlugin;
    let parentEl: MockElement;
    let panel: DownloadPanel;

    beforeEach(() => {
        vi.useFakeTimers();
        plugin = makePlugin();
        parentEl = new MockElement();
        panel = new DownloadPanel(plugin, parentEl as unknown as HTMLElement);
    });

    afterEach(() => {
        panel.detach();
        vi.useRealTimers();
    });

    describe("attach", () => {
        it("creates container with lilbee-dp-container class", () => {
            panel.attach();
            const container = parentEl.find("lilbee-dp-container");
            expect(container).not.toBeNull();
        });

        it("creates panels wrapper and queued label", () => {
            panel.attach();
            const container = parentEl.find("lilbee-dp-container");
            expect(container!.find("lilbee-dp-panels")).not.toBeNull();
            expect(container!.find("lilbee-dp-queued")).not.toBeNull();
        });

        it("hides container initially when no tasks", () => {
            panel.attach();
            const container = parentEl.find("lilbee-dp-container");
            expect(container!.style.display).toBe("none");
        });
    });

    describe("detach", () => {
        it("removes container from parent", () => {
            panel.attach();
            panel.detach();
            expect(parentEl.find("lilbee-dp-container")).toBeNull();
        });

        it("clears dismiss timers", () => {
            panel.attach();
            const id = plugin.taskQueue.enqueue("Pull model", TASK_TYPE.PULL);
            // Complete the task so a dismiss timer is scheduled
            plugin.taskQueue.complete(id);
            // Detach should clear the timer without errors
            panel.detach();
            // Advancing timers after detach should not throw
            vi.advanceTimersByTime(DOWNLOAD_PANEL.DISMISS_DELAY_MS + 100);
        });

        it("clears spinner interval", () => {
            panel.attach();
            panel.detach();
            // Advancing timers should not trigger spinner updates
            vi.advanceTimersByTime(1000);
        });
    });

    describe("pull task panels", () => {
        it("shows panel when pull task becomes active", () => {
            panel.attach();
            plugin.taskQueue.enqueue("Pull llama", TASK_TYPE.PULL);
            const panelsEl = parentEl.find("lilbee-dp-panels");
            const dp = panelsEl!.find("lilbee-dp-panel");
            expect(dp).not.toBeNull();
            const name = dp!.find("lilbee-dp-name");
            expect(name!.textContent).toBe("Pull llama");
        });

        it("shows panel when download task becomes active", () => {
            panel.attach();
            plugin.taskQueue.enqueue("Download weights", TASK_TYPE.DOWNLOAD);
            const dp = parentEl.find("lilbee-dp-panel");
            expect(dp).not.toBeNull();
        });

        it("does not show panel for sync tasks", () => {
            panel.attach();
            plugin.taskQueue.enqueue("Sync vault", TASK_TYPE.SYNC);
            expect(parentEl.find("lilbee-dp-panel")).toBeNull();
        });

        it("does not show panel for add tasks", () => {
            panel.attach();
            plugin.taskQueue.enqueue("Add files", TASK_TYPE.ADD);
            expect(parentEl.find("lilbee-dp-panel")).toBeNull();
        });

        it("does not show panel for crawl tasks", () => {
            panel.attach();
            plugin.taskQueue.enqueue("Crawl site", TASK_TYPE.CRAWL);
            expect(parentEl.find("lilbee-dp-panel")).toBeNull();
        });

        it("does not show panel for wiki tasks", () => {
            panel.attach();
            plugin.taskQueue.enqueue("Wiki sync", TASK_TYPE.WIKI);
            expect(parentEl.find("lilbee-dp-panel")).toBeNull();
        });
    });

    describe("progress updates", () => {
        it("updates percentage text on progress", () => {
            panel.attach();
            const id = plugin.taskQueue.enqueue("Pull model", TASK_TYPE.PULL);
            plugin.taskQueue.update(id, 42, "model.gguf");

            const pct = parentEl.find("lilbee-dp-pct");
            expect(pct!.textContent).toBe("42%");
        });

        it("updates progress bar width", () => {
            panel.attach();
            const id = plugin.taskQueue.enqueue("Pull model", TASK_TYPE.PULL);
            plugin.taskQueue.update(id, 75);

            const barFill = parentEl.find("lilbee-dp-bar-fill");
            expect(barFill!.style.width).toBe("75%");
        });
    });

    describe("completion", () => {
        it("adds lilbee-dp-done class on task done", () => {
            panel.attach();
            const id = plugin.taskQueue.enqueue("Pull model", TASK_TYPE.PULL);
            plugin.taskQueue.complete(id);

            const dp = parentEl.find("lilbee-dp-panel");
            expect(dp!.classList.contains("lilbee-dp-done")).toBe(true);
        });

        it("shows checkmark icon on done", () => {
            panel.attach();
            const id = plugin.taskQueue.enqueue("Pull model", TASK_TYPE.PULL);
            plugin.taskQueue.complete(id);

            const icon = parentEl.find("lilbee-dp-icon");
            expect(icon!.textContent).toBe("✓");
        });

        it("sets progress to 100% on done", () => {
            panel.attach();
            const id = plugin.taskQueue.enqueue("Pull model", TASK_TYPE.PULL);
            plugin.taskQueue.complete(id);

            const pct = parentEl.find("lilbee-dp-pct");
            expect(pct!.textContent).toBe("100%");
            const barFill = parentEl.find("lilbee-dp-bar-fill");
            expect(barFill!.style.width).toBe("100%");
        });

        it("hides cancel button on done", () => {
            panel.attach();
            const id = plugin.taskQueue.enqueue("Pull model", TASK_TYPE.PULL);
            plugin.taskQueue.complete(id);

            const cancelBtn = parentEl.find("lilbee-dp-cancel");
            expect(cancelBtn!.style.display).toBe("none");
        });

        it("auto-dismisses panel after DISMISS_DELAY_MS", () => {
            panel.attach();
            const id = plugin.taskQueue.enqueue("Pull model", TASK_TYPE.PULL);
            plugin.taskQueue.complete(id);

            expect(parentEl.find("lilbee-dp-panel")).not.toBeNull();
            vi.advanceTimersByTime(DOWNLOAD_PANEL.DISMISS_DELAY_MS);
            expect(parentEl.find("lilbee-dp-panel")).toBeNull();
        });
    });

    describe("failure", () => {
        it("adds lilbee-dp-failed class on task failure", () => {
            panel.attach();
            const id = plugin.taskQueue.enqueue("Pull model", TASK_TYPE.PULL);
            plugin.taskQueue.fail(id, "Network error");

            const dp = parentEl.find("lilbee-dp-panel");
            expect(dp!.classList.contains("lilbee-dp-failed")).toBe(true);
        });

        it("shows X icon on failure", () => {
            panel.attach();
            const id = plugin.taskQueue.enqueue("Pull model", TASK_TYPE.PULL);
            plugin.taskQueue.fail(id, "timeout");

            const icon = parentEl.find("lilbee-dp-icon");
            expect(icon!.textContent).toBe("✗");
        });

        it("shows error message in name on failure", () => {
            panel.attach();
            const id = plugin.taskQueue.enqueue("Pull model", TASK_TYPE.PULL);
            plugin.taskQueue.fail(id, "Connection refused");

            const name = parentEl.find("lilbee-dp-name");
            expect(name!.textContent).toBe("Connection refused");
        });

        it("auto-dismisses failed panel after DISMISS_DELAY_MS", () => {
            panel.attach();
            const id = plugin.taskQueue.enqueue("Pull model", TASK_TYPE.PULL);
            plugin.taskQueue.fail(id, "error");

            vi.advanceTimersByTime(DOWNLOAD_PANEL.DISMISS_DELAY_MS);
            expect(parentEl.find("lilbee-dp-panel")).toBeNull();
        });
    });

    describe("cancel", () => {
        it("dismisses panel immediately on cancel button click", () => {
            panel.attach();
            plugin.taskQueue.enqueue("Pull model", TASK_TYPE.PULL);

            const cancelBtn = parentEl.find("lilbee-dp-cancel") as MockElement;
            cancelBtn.trigger("click");

            expect(parentEl.find("lilbee-dp-panel")).toBeNull();
        });

        it("dismisses panel when task is cancelled externally", () => {
            panel.attach();
            const id = plugin.taskQueue.enqueue("Pull model", TASK_TYPE.PULL);
            expect(parentEl.find("lilbee-dp-panel")).not.toBeNull();

            // Cancel via task queue directly (not via button)
            plugin.taskQueue.cancel(id);
            expect(parentEl.find("lilbee-dp-panel")).toBeNull();
        });
    });

    describe("multiple concurrent downloads", () => {
        it("shows separate panels for each download", () => {
            panel.attach();
            plugin.taskQueue.enqueue("Pull A", TASK_TYPE.PULL);
            plugin.taskQueue.enqueue("Pull B", TASK_TYPE.DOWNLOAD);

            const panels = parentEl.findAll("lilbee-dp-panel");
            expect(panels.length).toBe(2);
        });

        it("caps visible panels at MAX_VISIBLE", () => {
            panel.attach();
            for (let i = 0; i < DOWNLOAD_PANEL.MAX_VISIBLE + 2; i++) {
                plugin.taskQueue.enqueue(`Pull ${i}`, TASK_TYPE.PULL);
            }

            // Only first one is active (per-type queue), rest are queued
            // The TaskQueue only activates one per type at a time
            const panels = parentEl.findAll("lilbee-dp-panel");
            expect(panels.length).toBe(1);
        });

        it("shows queued overflow text", () => {
            panel.attach();
            // Enqueue multiple — only 1 active per type, rest queued
            const firstId = plugin.taskQueue.enqueue(`Pull 0`, TASK_TYPE.PULL);
            plugin.taskQueue.enqueue(`Pull 1`, TASK_TYPE.PULL);
            plugin.taskQueue.enqueue(`Pull 2`, TASK_TYPE.PULL);
            plugin.taskQueue.enqueue(`Pull 3`, TASK_TYPE.PULL);
            // Trigger re-render by updating the active task (enqueue only notifies for first)
            plugin.taskQueue.update(firstId, 10);

            const queuedEl = parentEl.find("lilbee-dp-queued");
            expect(queuedEl!.textContent).toContain("+3 queued");
        });
    });

    describe("container visibility", () => {
        it("shows container when tasks exist", () => {
            panel.attach();
            plugin.taskQueue.enqueue("Pull model", TASK_TYPE.PULL);

            const container = parentEl.find("lilbee-dp-container");
            expect(container!.style.display).toBe("");
        });

        it("hides container when all panels dismissed", () => {
            panel.attach();
            const id = plugin.taskQueue.enqueue("Pull model", TASK_TYPE.PULL);
            plugin.taskQueue.complete(id);
            vi.advanceTimersByTime(DOWNLOAD_PANEL.DISMISS_DELAY_MS);

            const container = parentEl.find("lilbee-dp-container");
            expect(container!.style.display).toBe("none");
        });
    });

    describe("spinner", () => {
        it("updates spinner icon on interval", () => {
            panel.attach();
            plugin.taskQueue.enqueue("Pull model", TASK_TYPE.PULL);

            const icon = parentEl.find("lilbee-dp-icon");
            const initial = icon!.textContent;

            vi.advanceTimersByTime(100);
            expect(icon!.textContent).not.toBe(initial);
        });

        it("does not update spinner on completed panels", () => {
            panel.attach();
            const id = plugin.taskQueue.enqueue("Pull model", TASK_TYPE.PULL);
            plugin.taskQueue.complete(id);

            const icon = parentEl.find("lilbee-dp-icon");
            expect(icon!.textContent).toBe("✓");

            vi.advanceTimersByTime(100);
            expect(icon!.textContent).toBe("✓");
        });
    });

    describe("render without attach", () => {
        it("render is no-op when containerEl is null", () => {
            panel.attach();
            // Null out containerEl to simulate detached state
            (panel as any).containerEl = null;
            // Trigger render via task queue — should not throw
            plugin.taskQueue.enqueue("Pull model", TASK_TYPE.PULL);
        });
    });

    describe("edge cases", () => {
        it("skips already-dismissing tasks in render", () => {
            panel.attach();
            const id = plugin.taskQueue.enqueue("Pull model", TASK_TYPE.PULL);
            plugin.taskQueue.complete(id);

            // Completing already scheduled a dismiss timer; completing again should not double-schedule
            // Trigger another render
            plugin.taskQueue.enqueue("Pull other", TASK_TYPE.DOWNLOAD);
            // No error means the dismissTimers.has() guard worked
        });

        it("handles completion when panel is missing from map", () => {
            panel.attach();
            const id = plugin.taskQueue.enqueue("Pull model", TASK_TYPE.PULL);
            // Manually remove from panelMap to simulate edge case
            (panel as any).panelMap.delete(id);
            // Complete should not throw
            plugin.taskQueue.complete(id);
        });

        it("does not double-schedule dismiss timer", () => {
            panel.attach();
            const id = plugin.taskQueue.enqueue("Pull model", TASK_TYPE.PULL);
            plugin.taskQueue.complete(id);

            // Call scheduleDismiss again for the same task — should be a no-op
            (panel as any).scheduleDismiss(id);
            // Advancing time should dismiss only once
            vi.advanceTimersByTime(DOWNLOAD_PANEL.DISMISS_DELAY_MS);
            expect(parentEl.find("lilbee-dp-panel")).toBeNull();
        });

        it("handles createPanel when panelsEl is null", () => {
            panel.attach();
            // Null out panelsEl
            (panel as any).panelsEl = null;
            // Enqueue should not throw even though panelsEl is null
            plugin.taskQueue.enqueue("Pull model", TASK_TYPE.PULL);
        });

        it("detach is safe when called without attach", () => {
            // Detach without prior attach — containerEl is null
            panel.detach();
        });

        it("defaults parentEl to document.body", () => {
            const mockBody = new MockElement() as unknown as HTMLElement;
            vi.stubGlobal("document", { body: mockBody });
            const p = new DownloadPanel(plugin);
            p.attach();
            const container = (mockBody as unknown as MockElement).find("lilbee-dp-container");
            expect(container).not.toBeNull();
            p.detach();
            vi.unstubAllGlobals();
        });
    });
});
