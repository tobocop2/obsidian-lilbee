import { App, Modal, Notice } from "obsidian";
import type LilbeePlugin from "../main";
import type { ModelFamily, ModelVariant, CatalogResponse } from "../types";
import { MODEL_TASK, SSE_EVENT, TASK_TYPE } from "../types";
import { MESSAGES, FILTERS, CATALOG_FILTERS } from "../locales/en";
import { ConfirmModal } from "./confirm-modal";
import { ConfirmPullModal } from "./confirm-pull-modal";
import type { Result } from "neverthrow";
import { debounce, DEBOUNCE_MS } from "../utils";

const PAGE_SIZE = 20;

type TaskFilter = (typeof FILTERS.TASK)[keyof typeof FILTERS.TASK];
type SizeFilter = "" | typeof FILTERS.SIZE.SMALL | typeof FILTERS.SIZE.MEDIUM | typeof FILTERS.SIZE.LARGE;
type SortFilter = (typeof FILTERS.SORT)[keyof typeof FILTERS.SORT];

export class CatalogModal extends Modal {
    private plugin: LilbeePlugin;
    private filterTask: TaskFilter = "";
    private filterSize: SizeFilter = "";
    private filterSort: SortFilter = "featured";
    private filterSearch = "";
    private offset = 0;
    private total = 0;
    private families: ModelFamily[] = [];
    private resultsEl: HTMLElement | null = null;
    private loadMoreBtn: HTMLElement | null = null;
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

        const filters = contentEl.createDiv({ cls: "lilbee-catalog-filters" });

        const taskSelect = filters.createEl("select", { cls: "lilbee-catalog-filter-task" }) as HTMLSelectElement;
        for (const [value, label] of CATALOG_FILTERS.TASK) {
            const opt = taskSelect.createEl("option", { text: label });
            opt.value = value;
        }
        taskSelect.addEventListener("change", () => {
            this.filterTask = taskSelect.value as TaskFilter;
            this.resetAndFetch();
        });

        const sizeSelect = filters.createEl("select", { cls: "lilbee-catalog-filter-size" }) as HTMLSelectElement;
        for (const [value, label] of CATALOG_FILTERS.SIZE) {
            const opt = sizeSelect.createEl("option", { text: label });
            opt.value = value;
        }
        sizeSelect.addEventListener("change", () => {
            this.filterSize = sizeSelect.value as SizeFilter;
            this.resetAndFetch();
        });

        const sortSelect = filters.createEl("select", { cls: "lilbee-catalog-filter-sort" }) as HTMLSelectElement;
        for (const [value, label] of CATALOG_FILTERS.SORT) {
            const opt = sortSelect.createEl("option", { text: label });
            opt.value = value;
        }
        sortSelect.addEventListener("change", () => {
            this.filterSort = sortSelect.value as SortFilter;
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

        const response = (result as { value: CatalogResponse }).value;
        this.total = response.total;
        this.families.push(...response.families);
        this.offset += response.families.length;

        for (const family of response.families) {
            this.renderFamily(family);
        }

        this.updateLoadMore();
    }

    private updateLoadMore(): void {
        if (!this.loadMoreBtn) return;
        this.loadMoreBtn.style.display = this.offset < this.total ? "" : "none";
    }

    private renderFamily(family: ModelFamily): void {
        if (!this.resultsEl) return;
        const container = this.resultsEl.createDiv({ cls: "lilbee-catalog-family" });

        const header = container.createDiv({ cls: "lilbee-catalog-family-header" });
        header.createEl("span", { text: family.family });
        header.createEl("span", { text: family.task, cls: "lilbee-catalog-family-task" });

        header.addEventListener("click", () => {
            if (container.classList.contains("is-collapsed")) {
                container.removeClass("is-collapsed");
            } else {
                container.addClass("is-collapsed");
            }
        });

        const variantsEl = container.createDiv({ cls: "lilbee-catalog-family-variants" });
        for (const variant of family.variants) {
            this.renderVariant(family, variant, variantsEl);
        }
    }

    private renderVariant(family: ModelFamily, variant: ModelVariant, container: HTMLElement): void {
        const row = container.createDiv({ cls: "lilbee-catalog-variant-row" });

        const isRecommended = variant.name === family.recommended;
        const displayName = variant.display_name ?? variant.name;
        const nameCls = isRecommended
            ? "lilbee-catalog-variant-name lilbee-catalog-recommended"
            : "lilbee-catalog-variant-name";
        const nameText = isRecommended ? `${displayName} \u2605` : displayName;
        row.createEl("span", { text: nameText, cls: nameCls });

        if (variant.quality_tier) {
            row.createEl("span", { text: variant.quality_tier, cls: "lilbee-catalog-variant-tier" });
        }

        row.createEl("span", { text: `${variant.size_gb} GB`, cls: "lilbee-catalog-variant-size" });
        row.createEl("span", { text: variant.description, cls: "lilbee-catalog-variant-desc" });

        const actionEl = row.createDiv({ cls: "lilbee-catalog-variant-action" });
        const active = this.plugin.activeModel === variant.hf_repo || this.plugin.activeVisionModel === variant.hf_repo;

        if (active) {
            actionEl.createEl("span", { text: MESSAGES.LABEL_ACTIVE, cls: "lilbee-catalog-active" });
        } else if (variant.installed) {
            const installedBtn = actionEl.createEl("button", { text: MESSAGES.BUTTON_USE, cls: "lilbee-catalog-use" });
            installedBtn.addEventListener("click", () => this.handleUse(family, variant, installedBtn));
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
            if (err instanceof Error && err.name === "AbortError") {
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
            const err = (result as { error: Error }).error;
            this.plugin.taskQueue.fail(taskId, err.message);
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
