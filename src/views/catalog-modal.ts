import { App, Modal, Notice } from "obsidian";
import type LilbeePlugin from "../main";
import type { CatalogEntry, CatalogViewMode, ModelTask, ModelSize } from "../types";
import { MODEL_TASK, SSE_EVENT, TASK_TYPE, CATALOG_VIEW_MODE, ERROR_NAME } from "../types";
import { MESSAGES, FILTERS, CATALOG_FILTERS } from "../locales/en";
import { ConfirmModal } from "./confirm-modal";
import { ConfirmPullModal } from "./confirm-pull-modal";
import {
    debounce,
    DEBOUNCE_MS,
    formatAbbreviatedCount,
    percentFromSse,
    errorMessage,
    extractSseErrorMessage,
    noticeForResultError,
} from "../utils";
import { renderModelCard } from "../components/model-card";

const PAGE_SIZE = 20;
const SCROLL_BOTTOM_THRESHOLD_PX = 200;

type TaskFilter = (typeof FILTERS.TASK)[keyof typeof FILTERS.TASK];
type SizeFilter = "" | typeof FILTERS.SIZE.SMALL | typeof FILTERS.SIZE.MEDIUM | typeof FILTERS.SIZE.LARGE;
type SortFilter = (typeof FILTERS.SORT)[keyof typeof FILTERS.SORT];

const TASK_SECTION_LABEL: Record<ModelTask, string> = {
    [MODEL_TASK.CHAT]: MESSAGES.LABEL_SECTION_CHAT,
    [MODEL_TASK.VISION]: MESSAGES.LABEL_SECTION_VISION,
    [MODEL_TASK.EMBEDDING]: MESSAGES.LABEL_SECTION_EMBEDDING,
    [MODEL_TASK.RERANK]: MESSAGES.LABEL_SECTION_RERANK,
};

export class CatalogModal extends Modal {
    private plugin: LilbeePlugin;
    private filterTask: TaskFilter = "";
    private filterSize: SizeFilter = "";
    private filterSort: SortFilter = FILTERS.SORT.FEATURED;
    private filterSearch = "";
    private offset = 0;
    private hasMore = false;
    private isFetching = false;
    private entries: CatalogEntry[] = [];
    private resultsEl: HTMLElement | null = null;
    private viewMode: CatalogViewMode = CATALOG_VIEW_MODE.GRID;
    private sortColumn = "";
    private sortAscending = true;
    private viewToggleBtn: HTMLElement | null = null;
    private debouncedSearch: () => void;
    private cancelDebouncedSearch: () => void;

    constructor(app: App, plugin: LilbeePlugin) {
        super(app);
        this.plugin = plugin;
        const searchDebounced = debounce(() => this.resetAndFetch(), DEBOUNCE_MS);
        this.debouncedSearch = searchDebounced.run;
        this.cancelDebouncedSearch = searchDebounced.cancel;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("lilbee-catalog-modal");

        contentEl.createEl("h2", { text: MESSAGES.TITLE_MODEL_CATALOG });
        this.renderFilterBar(contentEl);

        this.resultsEl = contentEl.createDiv({ cls: "lilbee-catalog-results" });
        this.resultsEl.addEventListener("scroll", this.onScroll);

        this.resetAndFetch();
    }

    onClose(): void {
        this.cancelDebouncedSearch();
        this.resultsEl?.removeEventListener("scroll", this.onScroll);
    }

    private onScroll = (): void => {
        if (!this.resultsEl || this.isFetching || !this.hasMore) return;
        const { scrollTop, clientHeight, scrollHeight } = this.resultsEl;
        if (scrollTop + clientHeight >= scrollHeight - SCROLL_BOTTOM_THRESHOLD_PX) {
            void this.fetchPage();
        }
    };

    private renderFilterBar(parent: HTMLElement): void {
        const filters = parent.createDiv({ cls: "lilbee-catalog-filters" });

        this.renderSelect(filters, "lilbee-catalog-filter-task", CATALOG_FILTERS.TASK, (v) => {
            this.filterTask = v as TaskFilter;
            this.resetAndFetch();
        });

        this.renderSelect(filters, "lilbee-catalog-filter-size", CATALOG_FILTERS.SIZE, (v) => {
            this.filterSize = v as SizeFilter;
            this.resetAndFetch();
        });

        this.renderSelect(filters, "lilbee-catalog-filter-sort", CATALOG_FILTERS.SORT, (v) => {
            this.filterSort = v as SortFilter;
            this.resetAndFetch();
        });

        const searchInput = filters.createEl("input", {
            cls: "lilbee-catalog-search",
            placeholder: MESSAGES.PLACEHOLDER_SEARCH_MODELS,
            attr: { type: "text" },
        });
        searchInput.addEventListener("input", () => {
            this.filterSearch = (searchInput as unknown as HTMLInputElement).value;
            this.debouncedSearch();
        });

        this.viewToggleBtn = filters.createEl("button", {
            text: MESSAGES.LABEL_SWITCH_TO_LIST,
            cls: "lilbee-catalog-view-toggle",
        });
        this.viewToggleBtn.addEventListener("click", () => this.toggleView());
    }

    private renderSelect(
        parent: HTMLElement,
        cls: string,
        options: ReadonlyArray<readonly [string, string]>,
        onChange: (value: string) => void,
    ): void {
        const select = parent.createEl("select", { cls }) as HTMLSelectElement;
        for (const [value, label] of options) {
            const opt = select.createEl("option", { text: label });
            opt.value = value;
        }
        select.addEventListener("change", () => onChange(select.value));
    }

    private toggleView(): void {
        this.viewMode = this.viewMode === CATALOG_VIEW_MODE.GRID ? CATALOG_VIEW_MODE.LIST : CATALOG_VIEW_MODE.GRID;
        this.updateToggleLabel();
        this.renderResults();
    }

    private updateToggleLabel(): void {
        if (!this.viewToggleBtn) return;
        this.viewToggleBtn.textContent =
            this.viewMode === CATALOG_VIEW_MODE.GRID ? MESSAGES.LABEL_SWITCH_TO_LIST : MESSAGES.LABEL_SWITCH_TO_GRID;
    }

    private resetAndFetch(): void {
        this.offset = 0;
        this.entries = [];
        if (this.resultsEl) this.resultsEl.empty();
        void this.fetchPage();
    }

    private async fetchPage(): Promise<void> {
        if (this.isFetching) return;
        this.isFetching = true;
        const params: Parameters<typeof this.plugin.api.catalog>[0] = {
            limit: PAGE_SIZE,
            offset: this.offset,
            sort: this.filterSort,
        };
        if (this.filterTask) params.task = this.filterTask as ModelTask;
        if (this.filterSize) params.size = this.filterSize as ModelSize;
        if (this.filterSearch) params.search = this.filterSearch;

        try {
            const result = await this.plugin.api.catalog(params);
            if (result.isErr()) {
                new Notice(noticeForResultError(result.error, MESSAGES.ERROR_LOAD_CATALOG));
                return;
            }

            const response = result.value;
            this.hasMore = response.has_more;
            this.entries.push(...response.models);
            this.offset += response.models.length;

            this.renderResults();
        } finally {
            this.isFetching = false;
        }
    }

    private renderResults(): void {
        if (!this.resultsEl) return;
        this.resultsEl.empty();

        if (this.entries.length === 0) {
            this.resultsEl.createDiv({
                cls: "lilbee-catalog-empty",
                text: MESSAGES.LABEL_NO_MODELS_FOUND,
            });
            return;
        }

        if (this.viewMode === CATALOG_VIEW_MODE.GRID) {
            this.renderGridView(this.entries);
        } else {
            this.renderListView(this.entries);
        }
    }

    private renderGridView(entries: CatalogEntry[]): void {
        if (!this.resultsEl) return;
        const picks = entries.filter((e) => e.featured);
        const installed = entries.filter((e) => !e.featured && e.installed);
        const rest = entries.filter((e) => !e.featured && !e.installed);

        if (picks.length > 0)
            this.renderSection(MESSAGES.LABEL_OUR_PICKS, picks, "lilbee-catalog-section-heading-featured");
        if (installed.length > 0) this.renderSection(MESSAGES.LABEL_SECTION_INSTALLED, installed);

        for (const [task, group] of this.groupByTask(rest)) {
            this.renderSection(TASK_SECTION_LABEL[task] ?? task, group);
        }

        this.renderViewToggleCta();
    }

    private groupByTask(entries: CatalogEntry[]): [ModelTask, CatalogEntry[]][] {
        const groups = new Map<ModelTask, CatalogEntry[]>();
        for (const entry of entries) {
            const group = groups.get(entry.task);
            if (group) {
                group.push(entry);
            } else {
                groups.set(entry.task, [entry]);
            }
        }
        return [...groups.entries()];
    }

    private renderSection(heading: string, entries: CatalogEntry[], headingCls?: string): void {
        if (!this.resultsEl) return;
        const headingEl = this.resultsEl.createDiv({
            cls: "lilbee-catalog-section-heading",
            text: heading,
        });
        if (headingCls) headingEl.addClass(headingCls);
        const grid = this.resultsEl.createDiv({ cls: "lilbee-catalog-grid" });
        for (const entry of entries) {
            this.renderCard(grid, entry);
        }
    }

    private renderCard(container: HTMLElement, entry: CatalogEntry): void {
        const isActive = this.isActiveEntry(entry);
        renderModelCard(container, entry, {
            showActions: true,
            isActive,
            onPull: (e) => this.handlePull(e),
            onUse: (e, btn) => this.handleUse(e, btn),
            onRemove: (e, btn) => this.handleRemove(e, btn),
        });
    }

    private isActiveEntry(entry: CatalogEntry): boolean {
        return this.plugin.activeModel === entry.hf_repo;
    }

    private renderViewToggleCta(): void {
        if (!this.resultsEl) return;
        const cta = this.resultsEl.createDiv({ cls: "lilbee-view-toggle-cta" });
        cta.createEl("span", { text: MESSAGES.LABEL_VIEW_TOGGLE_CTA });
        const btn = cta.createEl("button", { text: MESSAGES.LABEL_SWITCH_TO_LIST });
        btn.addEventListener("click", () => this.toggleView());
    }

    private renderListView(entries: CatalogEntry[]): void {
        if (!this.resultsEl) return;
        const listEl = this.resultsEl.createDiv({ cls: "lilbee-catalog-list" });

        this.renderListHeader(listEl);

        const sorted = this.sortEntries(entries);
        for (const entry of sorted) {
            this.renderListRow(listEl, entry);
        }
    }

    private renderListHeader(listEl: HTMLElement): void {
        const header = listEl.createDiv({ cls: "lilbee-catalog-list-header" });
        const cols = [
            { key: "name", label: MESSAGES.LABEL_NAME, cls: "lilbee-catalog-list-col-name" },
            { key: "task", label: MESSAGES.LABEL_TASK, cls: "lilbee-catalog-list-col-task" },
            { key: "size", label: MESSAGES.LABEL_SIZE, cls: "lilbee-catalog-list-col-size" },
            { key: "downloads", label: MESSAGES.LABEL_DOWNLOADS, cls: "lilbee-catalog-list-col-downloads" },
            { key: "action", label: "", cls: "lilbee-catalog-list-col-action" },
        ];
        for (const col of cols) {
            const el = header.createEl("span", { text: col.label, cls: col.cls });
            if (col.key !== "action") {
                el.addEventListener("click", () => this.handleSort(col.key));
            }
        }
    }

    private renderListRow(listEl: HTMLElement, entry: CatalogEntry): void {
        const row = listEl.createDiv({ cls: "lilbee-catalog-list-row" });
        const nameText = entry.featured ? `\u2605 ${entry.display_name}` : entry.display_name;
        row.createEl("span", { text: nameText, cls: "lilbee-catalog-list-col-name" });
        row.createEl("span", { text: entry.task, cls: "lilbee-catalog-list-col-task" });
        row.createEl("span", { text: `${entry.size_gb} GB`, cls: "lilbee-catalog-list-col-size" });
        row.createEl("span", {
            text: formatAbbreviatedCount(entry.downloads),
            cls: "lilbee-catalog-list-col-downloads",
        });

        const actionEl = row.createDiv({ cls: "lilbee-catalog-list-col-action" });
        const isActive = this.isActiveEntry(entry);

        if (isActive) {
            actionEl.createEl("span", { text: MESSAGES.LABEL_ACTIVE, cls: "lilbee-catalog-active" });
        } else if (entry.installed) {
            const useBtn = actionEl.createEl("button", { text: MESSAGES.BUTTON_USE, cls: "lilbee-catalog-use" });
            useBtn.addEventListener("click", () => this.handleUse(entry, useBtn));
            const removeBtn = actionEl.createEl("button", {
                text: MESSAGES.BUTTON_REMOVE,
                cls: "lilbee-catalog-remove",
            });
            removeBtn.addEventListener("click", () => this.handleRemove(entry, removeBtn));
        } else {
            const pullBtn = actionEl.createEl("button", { text: MESSAGES.BUTTON_PULL, cls: "lilbee-catalog-pull" });
            pullBtn.addEventListener("click", () => this.handlePull(entry));
        }
    }

    private handleSort(column: string): void {
        if (this.sortColumn === column) {
            this.sortAscending = !this.sortAscending;
        } else {
            this.sortColumn = column;
            this.sortAscending = true;
        }
        this.renderResults();
    }

    private sortEntries(entries: CatalogEntry[]): CatalogEntry[] {
        if (!this.sortColumn) return entries;
        const sorted = [...entries];
        const dir = this.sortAscending ? 1 : -1;
        sorted.sort((a, b) => {
            const va = this.getSortValue(a, this.sortColumn);
            const vb = this.getSortValue(b, this.sortColumn);
            if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
            return String(va).localeCompare(String(vb)) * dir;
        });
        return sorted;
    }

    private getSortValue(entry: CatalogEntry, column: string): string | number {
        switch (column) {
            case "name":
                return entry.display_name;
            case "task":
                return entry.task;
            case "size":
                return entry.size_gb;
            case "downloads":
                return entry.downloads;
            default:
                return "";
        }
    }

    private handleRemove(entry: CatalogEntry, btn: HTMLElement): void {
        const confirmModal = new ConfirmModal(this.app, MESSAGES.NOTICE_CONFIRM_REMOVE(entry.hf_repo));
        confirmModal.open();
        void confirmModal.result.then((confirmed) => {
            if (!confirmed) return;
            void this.executeRemove(entry, btn);
        });
    }

    private async executeRemove(entry: CatalogEntry, btn: HTMLElement): Promise<void> {
        const taskId = this.plugin.taskQueue.enqueue(`Remove ${entry.hf_repo}`, TASK_TYPE.DELETE);
        if (taskId === null) {
            new Notice(MESSAGES.NOTICE_QUEUE_FULL);
            return;
        }
        btn.textContent = MESSAGES.STATUS_REMOVING;
        (btn as HTMLButtonElement).disabled = true;
        this.plugin.taskQueue.update(taskId, -1, entry.hf_repo);

        const result = await this.plugin.api.deleteModel(entry.hf_repo, entry.source);
        if (result.isErr()) {
            new Notice(
                noticeForResultError(result.error, MESSAGES.ERROR_REMOVE_MODEL.replace("{model}", entry.hf_repo)),
            );
            this.plugin.taskQueue.fail(taskId, errorMessage(result.error, result.error.message));
            btn.textContent = MESSAGES.BUTTON_REMOVE;
            (btn as HTMLButtonElement).disabled = false;
            return;
        }

        this.plugin.taskQueue.complete(taskId);
        new Notice(MESSAGES.NOTICE_REMOVED(entry.hf_repo));
        this.plugin.fetchActiveModel();
        this.resetAndFetch();
    }

    private async handleUse(entry: CatalogEntry, btn: HTMLElement): Promise<void> {
        btn.textContent = MESSAGES.STATUS_SETTING;
        (btn as HTMLButtonElement).disabled = true;

        const result = await this.setActiveFor(entry);

        if (result.isErr()) {
            new Notice(noticeForResultError(result.error, MESSAGES.ERROR_SET_MODEL.replace("{model}", entry.hf_repo)));
            btn.textContent = MESSAGES.BUTTON_USE;
            (btn as HTMLButtonElement).disabled = false;
            return;
        }

        this.plugin.fetchActiveModel();
        new Notice(MESSAGES.NOTICE_MODEL_ACTIVATED(entry.hf_repo));
        this.resetAndFetch();
    }

    private async setActiveFor(entry: CatalogEntry): ReturnType<typeof this.plugin.api.setChatModel> {
        if (entry.task === MODEL_TASK.EMBEDDING) {
            return this.plugin.api.setEmbeddingModel(entry.hf_repo);
        }
        if (entry.task === MODEL_TASK.RERANK) {
            return this.plugin.api.setRerankerModel(entry.hf_repo);
        }
        if (entry.task === MODEL_TASK.VISION) {
            return this.plugin.api.setVisionModel(entry.hf_repo);
        }
        const result = await this.plugin.api.setChatModel(entry.hf_repo);
        if (result.isOk()) this.plugin.activeModel = entry.hf_repo;
        return result;
    }

    private handlePull(entry: CatalogEntry): void {
        const info = {
            name: entry.hf_repo,
            size_gb: entry.size_gb,
            min_ram_gb: entry.min_ram_gb,
            description: entry.description,
            installed: entry.installed,
        };
        const confirmModal = new ConfirmPullModal(this.app, info);
        confirmModal.open();
        void confirmModal.result.then((confirmed) => {
            if (!confirmed) return;
            void this.executePull(entry);
        });
    }

    private async executePull(entry: CatalogEntry): Promise<void> {
        const taskId = this.plugin.taskQueue.enqueue(`Pull ${entry.hf_repo}`, TASK_TYPE.PULL);
        if (taskId === null) {
            new Notice(MESSAGES.NOTICE_QUEUE_FULL);
            return;
        }
        const controller = new AbortController();
        this.plugin.taskQueue.registerAbort(taskId, controller);
        const pullErrorPrefix = MESSAGES.ERROR_PULL_MODEL.replace("{model}", entry.hf_repo);

        try {
            for await (const event of this.plugin.api.pullModel(entry.hf_repo, entry.source, controller.signal)) {
                if (event.event === SSE_EVENT.PROGRESS) {
                    const d = event.data as { percent?: number; current?: number; total?: number };
                    const pct = percentFromSse(d);
                    if (pct !== undefined) {
                        this.plugin.taskQueue.update(taskId, pct, entry.hf_repo, {
                            current: d.current,
                            total: d.total,
                        });
                    }
                } else if (event.event === SSE_EVENT.ERROR) {
                    const d = event.data as { message?: string } | string;
                    const msg = extractSseErrorMessage(d, MESSAGES.ERROR_UNKNOWN);
                    new Notice(`${pullErrorPrefix}: ${msg}`);
                    this.plugin.taskQueue.fail(taskId, msg);
                    return;
                }
            }
        } catch (err) {
            if (err instanceof Error && err.name === ERROR_NAME.ABORT_ERROR) {
                new Notice(MESSAGES.NOTICE_PULL_CANCELLED);
                this.plugin.taskQueue.cancel(taskId);
            } else {
                const msg = errorMessage(err, MESSAGES.ERROR_UNKNOWN);
                new Notice(`${pullErrorPrefix}: ${msg}`);
                this.plugin.taskQueue.fail(taskId, msg);
            }
            return;
        }

        this.plugin.taskQueue.complete(taskId);

        const result = await this.setActiveFor(entry);
        if (result.isErr()) {
            new Notice(noticeForResultError(result.error, MESSAGES.ERROR_SET_MODEL.replace("{model}", entry.hf_repo)));
            this.plugin.fetchActiveModel();
            this.resetAndFetch();
            return;
        }

        this.plugin.fetchActiveModel();
        new Notice(MESSAGES.NOTICE_MODEL_ACTIVATED_FULL(entry.hf_repo));
        this.resetAndFetch();
    }
}
