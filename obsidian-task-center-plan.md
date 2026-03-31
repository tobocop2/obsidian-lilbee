# Obsidian Plugin: Task Center Plan

## Problem

Background operations (model pulls, syncs, crawls, file adds) currently report progress in scattered ways:

- **Chat view** has two inline progress banners (`fileProgress`, `pullProgress`) that overlay the chat
- **Catalog modal** shows pull progress inline on the pull button (`btn.textContent = "52%"`)
- **Crawl modal** shows progress in a `<div>` inside the modal
- **Status bar** shows a single task name or "N tasks" via `activeTasks` map
- **PullQueue** serializes model pulls but has no visibility into what's queued

There is no unified view of all running and queued operations, no history of completed tasks, and closing a modal/view loses progress visibility entirely.

> **Note**: Some features depend on server-side fixes for cancellation. See `../lilbee/server-cancellation-bugs.md`. The plugin UI implements workarounds (confirmation dialogs) to handle the current limitations.

## Design

### Overview

A **Task Center** sidebar view (like the existing Chat view) that shows all background operations in one place. It registers as an Obsidian `ItemView` and lives in the right sidebar, switchable with the chat view.

### Architecture

```
src/task-queue.ts          -- Unified task queue (replaces activeTasks map + PullQueue)
src/views/task-center.ts   -- ItemView for the sidebar panel
src/types.ts               -- New types (TaskEntry, TaskStatus, etc.)
```

## Design Decisions

1. **Serialization**: Sync and add operations are serialized (one at a time). This matches current behavior and avoids triggering server concurrency bugs (see `../lilbee/server-cancellation-bugs.md`).

2. **Auto-sync visibility**: Auto-sync tasks (triggered by vault events) are visible in the task center, same as manual sync operations.

3. **Cancel behavior**: 
   - Queued tasks can be truly cancelled (just remove from queue)
   - Active tasks (sync, add, pull, crawl) cannot be cancelled server-side (server doesn't support it yet)
   - When user clicks cancel on an active task, show a confirmation dialog: *"This operation is already in progress on the server. Canceling will hide it from the task center, but it may still complete. Continue?"*
   - If confirmed, mark as "cancelled" in UI but don't stop the actual operation

4. **Task start notification**: When a task moves from queued → active, show:
   - A brief `new Notice("Task started: {name}", 3000)` 
   - An icon indicator in the status bar (list-checks icon next to status text)

## Detailed Plan

### 1. New types in `src/types.ts`

```typescript
export type TaskStatus = "queued" | "active" | "done" | "failed" | "cancelled";

export const TASK_STATUS = {
    QUEUED: "queued",
    ACTIVE: "active",
    DONE: "done",
    FAILED: "failed",
    CANCELLED: "cancelled",
} as const satisfies Record<string, TaskStatus>;

export type TaskType = "sync" | "add" | "pull" | "crawl" | "download";

export const TASK_TYPE = {
    SYNC: "sync",
    ADD: "add",
    PULL: "pull",
    CRAWL: "crawl",
    DOWNLOAD: "download",
} as const satisfies Record<string, TaskType>;

export interface TaskEntry {
    id: string;
    name: string;
    type: TaskType;
    status: TaskStatus;
    progress: number;       // 0-100, -1 for indeterminate
    detail: string;         // e.g. "page 3/10", "chunk 42/100"
    startedAt: number;      // Date.now()
    completedAt: number | null;
    error: string | null;
    canCancel: boolean;     // true for queued, false for active server operations
}
```

### 2. New `src/task-queue.ts` (replaces `PullQueue` and `activeTasks`)

The current plugin has two separate task tracking mechanisms:

- `PullQueue` in `src/pull-queue.ts` -- serializes model pulls with a simple FIFO
- `activeTasks: Map<string, string>` on the plugin -- tracks running operations for the status bar

These merge into a single `TaskQueue` class modeled after the TUI's `task_queue.py`:

```typescript
export type TaskChangeListener = () => void;

export class TaskQueue {
    private tasks: Map<string, TaskEntry> = new Map();
    private queue: string[] = [];
    private activeId: string | null = null;
    private history: TaskEntry[] = [];     // completed tasks, newest first
    private listeners: TaskChangeListener[] = [];

    static readonly MAX_HISTORY = 50;

    /** Subscribe to changes. Returns unsubscribe function. */
    onChange(listener: TaskChangeListener): () => void;

    /** Enqueue a new task. Returns its id. */
    enqueue(name: string, type: TaskType): string;

    /** Mark task as active (called internally or by the runner). */
    activate(id: string): void;

    /** Update progress (0-100) and detail text. */
    update(id: string, progress: number, detail?: string): void;

    /** Mark done. Moves to history. */
    complete(id: string): void;

    /** Mark failed. Moves to history. */
    fail(id: string, error?: string): void;

    /** Cancel a queued or active task. Moves to history. */
    cancel(id: string): void;

    /** Get the currently active task, if any. */
    get active(): TaskEntry | null;

    /** Get all queued tasks (not yet active). */
    get queued(): TaskEntry[];

    /** Get completed/failed/cancelled tasks (newest first). */
    get completed(): TaskEntry[];

    /** Clear completed history. */
    clearHistory(): void;
}
```

Key differences from the TUI version:
- No threading (JS is single-threaded; async is cooperative)
- Stores a **history** of completed tasks (the TUI removes them immediately since it has a full-screen table)
- Listener pattern instead of a single callback (multiple views may watch)

### 3. New `src/views/task-center.ts` -- sidebar view

Register as `VIEW_TYPE_TASKS = "lilbee-tasks"` alongside the existing `VIEW_TYPE_CHAT`.

#### Layout

```
+-----------------------------------------+
| Task Center                    [Clear]  |
+-----------------------------------------+
| ACTIVE                                  |
| > Syncing vault          45%  [Cancel]  |
|   Embedding chunk 3/7                   |
|                                         |
| QUEUED                                  |
|   Pull qwen3:8b                         |
|   Pull nomic-embed-text                 |
|                                         |
| COMPLETED                               |
|   [ok] Sync vault           2m ago      |
|   [ok] Pull gemma3:4b       5m ago      |
|   [x]  Crawl example.com    8m ago      |
+-----------------------------------------+
```

#### Implementation

```typescript
export const VIEW_TYPE_TASKS = "lilbee-tasks";

export class TaskCenterView extends ItemView {
    private plugin: LilbeePlugin;
    private unsubscribe: (() => void) | null = null;
    private activeSection: HTMLElement | null = null;
    private queuedSection: HTMLElement | null = null;
    private completedSection: HTMLElement | null = null;

    getViewType(): string { return VIEW_TYPE_TASKS; }
    getDisplayText(): string { return "lilbee Tasks"; }
    getIcon(): string { return "list-checks"; }

    async onOpen(): Promise<void> {
        // Build DOM: header + 3 collapsible sections
        // Subscribe to plugin.taskQueue.onChange(...)
        // Initial render
    }

    async onClose(): Promise<void> {
        this.unsubscribe?.();
    }

    private render(): void {
        // Re-render all three sections from taskQueue state
        // Active task: name, type badge, progress bar, detail, cancel button
        // Queued: list with names and type badges
        // Completed: list with status icon, name, relative time, error tooltip
    }
}
```

#### Rendering details

- **Active task row**: progress bar (`<div class="lilbee-task-progress-bar">` with inner fill div), detail text below, cancel button (X icon)
  - Clicking cancel: if `canCancel === true`, cancel immediately. If `canCancel === false`, show confirm dialog explaining the operation can't be truly cancelled and asking if they want to hide it from the UI
- **Queued task rows**: just name + type badge, no progress yet
- **Completed task rows**: status icon (checkmark/X), name, relative timestamp ("2m ago"), hover tooltip with error message if failed
- **Empty state**: "All quiet -- no active tasks" centered message
- Auto-updates via `TaskQueue.onChange` -- the view subscribes on open, unsubscribes on close
- Timestamps refresh every 30 seconds via `setInterval`

### 4. Integration with `main.ts`

#### Plugin changes

```typescript
// In LilbeePlugin class:
taskQueue: TaskQueue = new TaskQueue();

// Remove these:
// - activeTasks: Map<string, string>
// - startTask() / endTask() / updateTaskStatusBar()
// These are replaced by taskQueue.enqueue/complete/fail

async onload(): Promise<void> {
    // ... existing setup ...
    this.registerView(VIEW_TYPE_TASKS, (leaf) => new TaskCenterView(leaf, this));
    
    // Subscribe to queue changes for status bar updates
    this.taskQueue.onChange(() => this.updateStatusBarFromQueue());
}
```

#### Replacing activeTasks usage

Current `startTask`/`endTask` calls in `main.ts`:

1. **runAdd** (line 446-479): `startTask("add-" + Date.now(), "adding files")` / `endTask(taskId)`
   - Replace with: `taskQueue.enqueue("Adding files", TASK_TYPE.ADD)` at start, `taskQueue.update(id, pct, detail)` on SSE events, `taskQueue.complete(id)` / `taskQueue.fail(id, msg)` at end

2. **triggerSync** (line 534-568): `startTask("sync-" + Date.now(), "syncing")` / `endTask(taskId)`
   - Replace with: `taskQueue.enqueue("Sync vault", TASK_TYPE.SYNC)` + progress updates from SSE events
   - Mark as `canCancel: true` when queued, `canCancel: false` when activated (sync cannot be cancelled server-side)

3. **Auto-sync** (via vault event listeners): Also uses taskQueue so users can see background sync progress
   - Uses same serialization as manual sync (queued behind any active operation)

#### Replacing PullQueue usage

The `PullQueue` in `src/pull-queue.ts` serializes model pulls. Replace its usage in:

1. **ChatView** (line 82-83): `pullQueue` and `addQueue` instances
2. **CatalogModal** (line 18): `pullQueue` instance

Instead of each view having its own PullQueue, all operations go through `plugin.taskQueue`. The serialization behavior (one-at-a-time for pulls) stays the same since TaskQueue runs one task at a time.

For pulls specifically, the pattern becomes:

```typescript
// In ChatView.autoPullAndSet or CatalogModal.executePull:
const taskId = this.plugin.taskQueue.enqueue(`Pull ${model.name}`, TASK_TYPE.PULL);
this.plugin.taskQueue.activate(taskId);
try {
    for await (const event of this.plugin.api.pullModel(...)) {
        if (event.event === SSE_EVENT.PROGRESS) {
            const d = event.data as { current?: number; total?: number };
            const pct = d.total ? Math.round((d.current! / d.total) * 100) : 0;
            this.plugin.taskQueue.update(taskId, pct, `${model.name}`);
        }
    }
    this.plugin.taskQueue.complete(taskId);
} catch (err) {
    this.plugin.taskQueue.fail(taskId, err instanceof Error ? err.message : "unknown");
}
```

#### Replacing progress banners in ChatView

The chat view currently has two progress banners for file sync and model pull. With the task center:

- **Remove** the `fileProgress` and `pullProgress` banners from `ChatView`
- **Remove** `handleProgress()`, `showFileProgress()`, `showPullProgress()`, `hideProgress()`, `hidePullProgress()`, `updateSubLabel()` from `ChatView`
- **Remove** `plugin.onProgress` callback -- no longer needed since task center subscribes to the queue directly
- Chat view stays focused on chat only

The progress information that previously went through `plugin.onProgress` now goes through `taskQueue.update()` calls in `main.ts`.

### 5. How to open the Task Center

Three access points:

1. **Command palette**: `lilbee:tasks` -- "Show task center"
   ```typescript
   this.addCommand({
       id: "lilbee:tasks",
       name: "Show task center",
       callback: () => this.activateTaskView(),
   });
   ```

2. **Status bar click**: clicking the status bar text opens the task center
   ```typescript
   this.statusBarEl.addEventListener("click", () => this.activateTaskView());
   ```

3. **Ribbon icon** (optional, low priority): a list-checks icon in the left ribbon

The `activateTaskView()` method mirrors `activateChatView()`:

```typescript
async activateTaskView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_TASKS);
    if (existing.length > 0) {
        this.app.workspace.revealLeaf(existing[0]);
        return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (leaf) {
        await leaf.setViewState({ type: VIEW_TYPE_TASKS, active: true });
        this.app.workspace.revealLeaf(leaf);
    }
}
```

### 6. Status bar integration

The status bar continues to show a summary, but now driven by the queue:

```typescript
private updateStatusBarFromQueue(): void {
    const active = this.taskQueue.active;
    const queued = this.taskQueue.queued;

    if (!active && queued.length === 0) {
        this.setStatusReady();
        return;
    }

    if (active) {
        const suffix = queued.length > 0 ? ` +${queued.length}` : "";
        const pct = active.progress > 0 ? ` ${active.progress}%` : "";
        this.updateStatusBar(`lilbee: ${active.name}${pct}${suffix}`);
        this.setStatusClass("lilbee-status-adding");
    }
}
```

When tasks are active, also show a list-checks icon in the status bar to indicate task center has new activity.

### 6b. Task start notification

When a task moves from queued → active, show:
- A brief `new Notice("Task started: {name}", 3000)` (3 second duration)
- The icon indicator in status bar (see above)

This ensures users know there's a task running when they trigger one and the task center is not open.

Currently, SSE events from sync/add operations flow through `plugin.onProgress` to whichever view registered last. This is fragile (only one listener).

New approach: SSE events update the task queue directly in `main.ts`. The task center view (and anything else) reacts to queue changes.

```typescript
// In runAdd():
for await (const event of this.api.addFiles(...)) {
    if (event.event === SSE_EVENT.FILE_START) {
        const d = event.data as { current_file: number; total_files: number };
        const pct = Math.round((d.current_file / d.total_files) * 100);
        this.taskQueue.update(taskId, pct, `file ${d.current_file}/${d.total_files}`);
    } else if (event.event === SSE_EVENT.EXTRACT) {
        const d = event.data as { page: number; total_pages: number; file: string };
        this.taskQueue.update(taskId, -1, `extracting ${d.file} p${d.page}/${d.total_pages}`);
    } else if (event.event === SSE_EVENT.EMBED) {
        const d = event.data as { chunk: number; total_chunks: number };
        this.taskQueue.update(taskId, -1, `embedding chunk ${d.chunk}/${d.total_chunks}`);
    }
}
```

The `-1` progress value means "don't change the main percentage, just update the detail text."

### 8. Crawl modal integration

The crawl modal currently tracks its own progress inline. With the task center, it should:

1. Register the crawl as a task when started
2. Update progress via `taskQueue.update()` on each `CRAWL_PAGE` event
3. Complete/fail via `taskQueue.complete()`/`taskQueue.fail()`
4. The modal can still show inline progress for immediate feedback, but the task center provides persistent visibility after the modal closes

### 9. Server API

No new server endpoint is needed. The server does not track tasks -- it streams SSE events for individual operations. Task tracking is purely client-side. The plugin already receives all the SSE events it needs:

- `file_start`, `extract`, `embed`, `file_done`, `done` -- for sync/add
- `progress` -- for model pulls
- `crawl_start`, `crawl_page`, `crawl_done`, `crawl_error` -- for crawls

The task queue aggregates these into a unified view.

### 10. CSS

New styles needed in `styles.css`:

- `.lilbee-tasks-container` -- main container
- `.lilbee-tasks-section` -- collapsible section (active/queued/completed)
- `.lilbee-tasks-section-header` -- section title
- `.lilbee-task-row` -- individual task row
- `.lilbee-task-type-badge` -- colored badge for task type (sync=blue, pull=purple, crawl=green, add=orange)
- `.lilbee-task-progress-bar` -- progress bar container + fill
- `.lilbee-task-detail` -- sub-text with current operation detail
- `.lilbee-task-cancel` -- cancel button (X icon)
- `.lilbee-task-status-icon` -- checkmark/X for completed tasks
- `.lilbee-task-time` -- relative timestamp ("2m ago")
- `.lilbee-tasks-empty` -- empty state message

## Implementation Order

1. **Add types** to `src/types.ts` (TaskEntry, TaskStatus, TaskType)
2. **Create `src/task-queue.ts`** with the unified TaskQueue class
3. **Create `src/views/task-center.ts`** with the ItemView
4. **Add CSS** for the task center
5. **Wire up in `main.ts`**: register view, create queue, add command, status bar click handler
6. **Migrate `runAdd`** to use taskQueue instead of activeTasks
7. **Migrate `triggerSync`** to use taskQueue instead of activeTasks
8. **Migrate model pulls** in ChatView and CatalogModal to use plugin.taskQueue instead of local PullQueue instances
9. **Migrate CrawlModal** to register crawls with taskQueue
10. **Remove `PullQueue`** (`src/pull-queue.ts`) and old progress banner code from ChatView
11. **Remove `activeTasks` map** and `startTask`/`endTask`/`updateTaskStatusBar` from main.ts
12. **Test**: verify all operations appear in task center with correct progress, cancel works, history shows completed tasks

## Files changed

| File | Change |
|------|--------|
| `src/types.ts` | Add TaskEntry, TaskStatus, TaskType, TASK_STATUS, TASK_TYPE |
| `src/task-queue.ts` | New file -- unified TaskQueue class |
| `src/views/task-center.ts` | New file -- TaskCenterView (ItemView) |
| `src/main.ts` | Register task view, replace activeTasks with taskQueue, add command, status bar click |
| `src/views/chat-view.ts` | Remove progress banners, use plugin.taskQueue for pulls and adds |
| `src/views/catalog-modal.ts` | Use plugin.taskQueue instead of local PullQueue |
| `src/views/crawl-modal.ts` | Register crawl tasks with plugin.taskQueue |
| `src/pull-queue.ts` | Delete (replaced by task-queue.ts) |
| `styles.css` | Add task center styles |

## Out of scope

- Server-side task tracking / `/api/tasks` endpoint (not needed; client-side is sufficient)
- Task persistence across plugin restarts (tasks are ephemeral by nature)
- Task cancellation for crawls (requires server-side abort support, tracked separately)
- Drag-and-drop reordering of queued tasks
- True server-side cancellation (see `../lilbee/server-cancellation-bugs.md`)
