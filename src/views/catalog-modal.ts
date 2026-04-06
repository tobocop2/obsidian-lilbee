import { App, Modal, Notice } from "obsidian";
import type LilbeePlugin from "../main";
import type { ModelFamily, ModelVariant, CatalogViewMode } from "../types";
import { MODEL_TASK, SSE_EVENT, TASK_TYPE, CATALOG_VIEW_MODE, ERROR_NAME } from "../types";
import { MESSAGES, FILTERS, CATALOG_FILTERS } from "../locales/en";
import { ConfirmModal } from "./confirm-modal";
import { ConfirmPullModal } from "./confirm-pull-modal";
import type { Result } from "neverthrow";
import { debounce, DEBOUNCE_MS } from "../utils";
import { renderModelCard, renderBrowseMoreCard } from "../components/model-card";

const PAGE_SIZE = 20;

type TaskFilter = (typeof FILTERS.TASK)[keyof typeof FILTERS.TASK];
type SizeFilter = "" | typeof FILTERS.SIZE.SMALL | typeof FILTERS.SIZE.MEDIUM | typeof FILTERS.SIZE.LARGE;
type SortFilter = (typeof FILTERS.SORT)[keyof typeof FILTERS.SORT];

const SECTION_LABEL: Record<string, string> = {
    [MODEL_TASK.CHAT]: MESSAGES.LABEL_SECTION_CHAT,
    [MODEL_TASK.VISION]: MESSAGES.LABEL_SECTION_VISION,
    [MODEL_TASK.EMBEDDING]: MESSAGES.LABEL_SECTION_EMBEDDING,
};

export class CatalogModal extends Modal {
    private plugin: LilbeePlugin;
    private filterTask: TaskFilter = "";
    private filterSize: SizeFilter = "";
    private filterSort: SortFilter = FILTERS.SORT.FEATURED;
    private filterSearch = "";
    private offset = 0;
    private total = 0;
    private families: ModelFamily[] = [];
    private resultsEl: HTMLElement | null = null;
    private loadMoreBtn: HTMLElement | null = null;
    private viewMode: CatalogViewMode = CATALOG_VIEW_MODE.GRID;
    private hfLoaded = false;
    private sortColumn = "";
    private sortAscending = true;
    private viewToggleBtn: HTMLElement | null = null;
    private debouncedFetch: () => void;
    private debouncedSearch: () => void;
    private cancelDebouncedFetch: () => void;
    private cancelDebouncedSearch: () => void;

    constructor(app: App, plugin: LilbeePlugin) {
        super(app);
        this.plugin = plugin;
        const fetchDebounced = debounce(() => this.fetchPage(), DEBOUNCE_MS);
        const searchDebounced = debounce(() => this.resetAndFetch(), DEBOUNCE_MS);
        this.debouncedFetch = fetchDebounced.run;
        this.cancelDebouncedFetch = fetchDebounced.cancel;
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

        this.loadMoreBtn = contentEl.createEl("button", {
            text: MESSAGES.BUTTON_LOAD_MORE,
            cls: "lilbee-catalog-load-more",
        });
        this.loadMoreBtn.style.display = "none";
        this.loadMoreBtn.addEventListener("click", () => this.fetchMore());

        this.resetAndFetch();
    }

    onClose(): void {
        this.cancelDebouncedFetch();
        this.cancelDebouncedSearch();
    }

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
        this.families = [];
        if (this.resultsEl) this.resultsEl.empty();
        void this.fetchPage();
    }

    private fetchMore(): void {
        void this.fetchPage();
    }

    private async fetchPage(): Promise<void> {
        const params: Parameters<typeof this.plugin.api.catalog>[0] = {
            limit: PAGE_SIZE,
            offset: this.offset,
            sort: this.filterSort,
        };
        if (this.filterTask) params.task = this.filterTask as "chat" | "embedding" | "vision";
        if (this.filterSize) params.size = this.filterSize as "small" | "medium" | "large";
        if (this.filterSearch) params.search = this.filterSearch;

        const result = await this.plugin.api.catalog(params);
        if (result.isErr()) {
            new Notice(MESSAGES.ERROR_LOAD_CATALOG);
            return;
        }

        const response = result.value;
        this.total = response.total;
        this.families.push(...response.families);
        this.offset += response.families.length;

        this.renderResults();
        this.updateLoadMore();
    }

    private renderResults(): void {
        if (!this.resultsEl) return;
        this.resultsEl.empty();

        const allVariants = this.flattenVariants();
        if (allVariants.length === 0) {
            this.resultsEl.createDiv({
                cls: "lilbee-catalog-empty",
                text: MESSAGES.LABEL_NO_MODELS_FOUND,
            });
            return;
        }

        if (this.viewMode === CATALOG_VIEW_MODE.GRID) {
            this.renderGridView(allVariants);
        } else {
            this.renderListView(allVariants);
        }
    }

    private flattenVariants(): { family: ModelFamily; variant: ModelVariant }[] {
        const items: { family: ModelFamily; variant: ModelVariant }[] = [];
        for (const family of this.families) {
            for (const variant of family.variants) {
                items.push({ family, variant });
            }
        }
        return items;
    }

    private renderGridView(items: { family: ModelFamily; variant: ModelVariant }[]): void {
        if (!this.resultsEl) return;
        const picks = items.filter((i) => i.family.featured || i.variant.featured);
        const installed = items.filter((i) => i.variant.installed && !i.family.featured && !i.variant.featured);
        const rest = items.filter((i) => !i.variant.installed && !i.family.featured && !i.variant.featured);

        if (picks.length > 0) this.renderSection(MESSAGES.LABEL_OUR_PICKS, picks);
        if (installed.length > 0) this.renderSection(MESSAGES.LABEL_SECTION_INSTALLED, installed);

        const byTask = this.groupByTask(rest);
        for (const [task, taskItems] of byTask) {
            const label = SECTION_LABEL[task] ?? task;
            this.renderSection(label, taskItems);
        }

        if (!this.hfLoaded) {
            renderBrowseMoreCard(this.resultsEl, () => this.loadFullCatalog());
        }

        this.renderViewToggleCta();
    }

    private renderSection(heading: string, items: { family: ModelFamily; variant: ModelVariant }[]): void {
        if (!this.resultsEl) return;
        this.resultsEl.createDiv({
            cls: "lilbee-catalog-section-heading",
            text: heading,
        });
        const grid = this.resultsEl.createDiv({ cls: "lilbee-catalog-grid" });
        for (const { family, variant } of items) {
            this.renderCard(grid, family, variant);
        }
    }

    private renderCard(container: HTMLElement, family: ModelFamily, variant: ModelVariant): void {
        const isActive =
            this.plugin.activeModel === variant.hf_repo || this.plugin.activeVisionModel === variant.hf_repo;
        renderModelCard(container, family, variant, {
            showActions: true,
            isActive,
            onPull: (f, v, btn) => this.handlePull(f, v, btn),
            onUse: (f, v, btn) => this.handleUse(f, v, btn),
            onRemove: (v, btn) => this.handleRemove(v, btn),
        });
    }

    private renderViewToggleCta(): void {
        if (!this.resultsEl) return;
        const cta = this.resultsEl.createDiv({ cls: "lilbee-view-toggle-cta" });
        cta.createEl("span", { text: MESSAGES.LABEL_VIEW_TOGGLE_CTA });
        const btn = cta.createEl("button", { text: MESSAGES.LABEL_SWITCH_TO_LIST });
        btn.addEventListener("click", () => this.toggleView());
    }

    private groupByTask(
        items: { family: ModelFamily; variant: ModelVariant }[],
    ): [string, { family: ModelFamily; variant: ModelVariant }[]][] {
        const groups = new Map<string, { family: ModelFamily; variant: ModelVariant }[]>();
        for (const item of items) {
            const task = item.variant.task || item.family.task;
            const group = groups.get(task);
            if (group) {
                group.push(item);
            } else {
                groups.set(task, [item]);
            }
        }
        return [...groups.entries()];
    }

    private renderListView(items: { family: ModelFamily; variant: ModelVariant }[]): void {
        if (!this.resultsEl) return;
        const listEl = this.resultsEl.createDiv({ cls: "lilbee-catalog-list" });

        this.renderListHeader(listEl);

        const sorted = this.sortItems(items);
        for (const { family, variant } of sorted) {
            this.renderListRow(listEl, family, variant);
        }
    }

    private renderListHeader(listEl: HTMLElement): void {
        const header = listEl.createDiv({ cls: "lilbee-catalog-list-header" });
        const cols = [
            { key: "name", label: MESSAGES.LABEL_NAME, cls: "lilbee-catalog-list-col-name" },
            { key: "task", label: MESSAGES.LABEL_TASK, cls: "lilbee-catalog-list-col-task" },
            { key: "size", label: MESSAGES.LABEL_SIZE, cls: "lilbee-catalog-list-col-size" },
            { key: "quant", label: MESSAGES.LABEL_QUANT, cls: "lilbee-catalog-list-col-quant" },
            { key: "action", label: "", cls: "lilbee-catalog-list-col-action" },
        ];
        for (const col of cols) {
            const el = header.createEl("span", { text: col.label, cls: col.cls });
            if (col.key !== "action") {
                el.addEventListener("click", () => this.handleSort(col.key));
            }
        }
    }

    private renderListRow(listEl: HTMLElement, family: ModelFamily, variant: ModelVariant): void {
        const row = listEl.createDiv({ cls: "lilbee-catalog-list-row" });
        const displayName = variant.display_name ?? variant.name;
        const featured = variant.featured ?? family.featured;
        const nameText = featured ? `\u2605 ${displayName}` : displayName;
        row.createEl("span", { text: nameText, cls: "lilbee-catalog-list-col-name" });
        row.createEl("span", { text: variant.task || family.task, cls: "lilbee-catalog-list-col-task" });
        row.createEl("span", { text: `${variant.size_gb} GB`, cls: "lilbee-catalog-list-col-size" });
        row.createEl("span", {
            text: variant.quality_tier ?? "",
            cls: "lilbee-catalog-list-col-quant",
        });

        const actionEl = row.createDiv({ cls: "lilbee-catalog-list-col-action" });
        const isActive =
            this.plugin.activeModel === variant.hf_repo || this.plugin.activeVisionModel === variant.hf_repo;

        if (isActive) {
            actionEl.createEl("span", { text: MESSAGES.LABEL_ACTIVE, cls: "lilbee-catalog-active" });
        } else if (variant.installed) {
            const useBtn = actionEl.createEl("button", { text: MESSAGES.BUTTON_USE, cls: "lilbee-catalog-use" });
            useBtn.addEventListener("click", () => this.handleUse(family, variant, useBtn));
            const removeBtn = actionEl.createEl("button", {
                text: MESSAGES.BUTTON_REMOVE,
                cls: "lilbee-catalog-remove",
            });
            removeBtn.addEventListener("click", () => this.handleRemove(variant, removeBtn));
        } else {
            const pullBtn = actionEl.createEl("button", { text: MESSAGES.BUTTON_PULL, cls: "lilbee-catalog-pull" });
            pullBtn.addEventListener("click", () => this.handlePull(family, variant, pullBtn));
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

    private sortItems(
        items: { family: ModelFamily; variant: ModelVariant }[],
    ): { family: ModelFamily; variant: ModelVariant }[] {
        if (!this.sortColumn) return items;
        const sorted = [...items];
        const dir = this.sortAscending ? 1 : -1;
        sorted.sort((a, b) => {
            const va = this.getSortValue(a, this.sortColumn);
            const vb = this.getSortValue(b, this.sortColumn);
            if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
            return String(va).localeCompare(String(vb)) * dir;
        });
        return sorted;
    }

    private getSortValue(item: { family: ModelFamily; variant: ModelVariant }, column: string): string | number {
        switch (column) {
            case "name":
                return item.variant.display_name ?? item.variant.name;
            case "task":
                return item.variant.task || item.family.task;
            case "size":
                return item.variant.size_gb;
            case "quant":
                return item.variant.quality_tier ?? "";
            default:
                return "";
        }
    }

    private loadFullCatalog(): void {
        this.hfLoaded = true;
        this.resetAndFetch();
    }

    private updateLoadMore(): void {
        if (!this.loadMoreBtn) return;
        this.loadMoreBtn.style.display = this.offset < this.total ? "" : "none";
    }

    private handleRemove(variant: ModelVariant, btn: HTMLElement): void {
        const confirmModal = new ConfirmModal(this.app, MESSAGES.NOTICE_CONFIRM_REMOVE(variant.hf_repo));
        confirmModal.open();
        void confirmModal.result.then((confirmed) => {
            if (!confirmed) return;
            void this.executeRemove(variant, btn);
        });
    }

    private async executeRemove(variant: ModelVariant, btn: HTMLElement): Promise<void> {
        btn.textContent = MESSAGES.STATUS_REMOVING;
        (btn as HTMLButtonElement).disabled = true;

        const result = await this.plugin.api.deleteModel(variant.hf_repo, variant.source);
        if (result.isErr()) {
            new Notice(MESSAGES.ERROR_REMOVE_MODEL.replace("{model}", variant.hf_repo));
            btn.textContent = MESSAGES.BUTTON_REMOVE;
            (btn as HTMLButtonElement).disabled = false;
            return;
        }

        new Notice(MESSAGES.NOTICE_REMOVED(variant.hf_repo));
        this.plugin.fetchActiveModel();
        this.resetAndFetch();
    }

    private async handleUse(family: ModelFamily, variant: ModelVariant, btn: HTMLElement): Promise<void> {
        btn.textContent = MESSAGES.STATUS_SETTING;
        (btn as HTMLButtonElement).disabled = true;

        const result = await this.setModelForTask(variant);

        if (result.isErr()) {
            new Notice(MESSAGES.ERROR_SET_MODEL.replace("{model}", variant.hf_repo));
            btn.textContent = MESSAGES.BUTTON_USE;
            (btn as HTMLButtonElement).disabled = false;
            return;
        }

        this.plugin.fetchActiveModel();
        new Notice(MESSAGES.NOTICE_MODEL_ACTIVATED(variant.hf_repo));
        this.resetAndFetch();
    }

    private async setModelForTask(variant: ModelVariant): Promise<Result<void, Error>> {
        if (variant.task === MODEL_TASK.VISION) {
            const result = await this.plugin.api.setVisionModel(variant.hf_repo);
            if (result.isOk()) this.plugin.activeVisionModel = variant.hf_repo;
            return result;
        } else if (variant.task === MODEL_TASK.EMBEDDING) {
            return await this.plugin.api.setEmbeddingModel(variant.hf_repo);
        } else {
            const result = await this.plugin.api.setChatModel(variant.hf_repo);
            if (result.isOk()) this.plugin.activeModel = variant.hf_repo;
            return result;
        }
    }

    private handlePull(family: ModelFamily, variant: ModelVariant, btn: HTMLElement): void {
        const info = {
            name: variant.hf_repo,
            size_gb: variant.size_gb,
            min_ram_gb: variant.min_ram_gb,
            description: variant.description,
            installed: variant.installed,
        };
        const confirmModal = new ConfirmPullModal(this.app, info);
        confirmModal.open();
        void confirmModal.result.then((confirmed) => {
            if (!confirmed) return;
            void this.executePull(family, variant, btn);
        });
    }

    private async executePull(family: ModelFamily, variant: ModelVariant, btn: HTMLElement): Promise<void> {
        btn.textContent = MESSAGES.STATUS_PULLING.replace("{model}", variant.hf_repo);
        (btn as HTMLButtonElement).disabled = true;
        const taskId = this.plugin.taskQueue.enqueue(`Pull ${variant.hf_repo}`, TASK_TYPE.PULL);

        try {
            for await (const event of this.plugin.api.pullModel(variant.hf_repo, variant.source)) {
                if (event.event === SSE_EVENT.PROGRESS) {
                    const d = event.data as { current?: number; total?: number };
                    if (d.total && d.current !== undefined) {
                        const pct = Math.round((d.current / d.total) * 100);
                        btn.textContent = `${pct}%`;
                        this.plugin.taskQueue.update(taskId, pct, variant.hf_repo);
                    }
                }
            }
        } catch (err) {
            if (err instanceof Error && err.name === ERROR_NAME.ABORT_ERROR) {
                new Notice(MESSAGES.NOTICE_PULL_CANCELLED);
                this.plugin.taskQueue.cancel(taskId);
            } else {
                new Notice(MESSAGES.NOTICE_PULL_FAILED);
                this.plugin.taskQueue.fail(taskId, err instanceof Error ? err.message : "unknown");
            }
            btn.textContent = MESSAGES.BUTTON_PULL;
            (btn as HTMLButtonElement).disabled = false;
            return;
        }

        const result = await this.setModelForTask(variant);
        if (result.isErr()) {
            new Notice(MESSAGES.NOTICE_PULL_FAILED);
            const e = result.error;
            this.plugin.taskQueue.fail(taskId, e.message);
            btn.textContent = MESSAGES.BUTTON_PULL;
            (btn as HTMLButtonElement).disabled = false;
            return;
        }

        this.plugin.fetchActiveModel();
        this.plugin.taskQueue.complete(taskId);
        new Notice(MESSAGES.NOTICE_MODEL_ACTIVATED_FULL(variant.hf_repo));
        btn.textContent = MESSAGES.LABEL_ACTIVE;
        (btn as HTMLButtonElement).disabled = true;
    }
}
