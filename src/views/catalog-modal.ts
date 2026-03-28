import { App, Modal, Notice } from "obsidian";
import type LilbeePlugin from "../main";
import type { CatalogModel, CatalogResponse, ModelType, SSEEvent } from "../types";
import { MODEL_TYPE, NOTICE, SSE_EVENT } from "../types";
import { ConfirmPullModal } from "./confirm-pull-modal";
import { PullQueue } from "../pull-queue";

const PAGE_SIZE = 20;
const DEBOUNCE_MS = 300;

type TaskFilter = "" | "chat" | "embedding" | "vision";
type SizeFilter = "" | "small" | "medium" | "large";
type SortFilter = "featured" | "downloads" | "name" | "size_asc" | "size_desc";

export class CatalogModal extends Modal {
    private plugin: LilbeePlugin;
    private pullQueue = new PullQueue();
    private filterTask: TaskFilter = "";
    private filterSize: SizeFilter = "";
    private filterSort: SortFilter = "featured";
    private filterSearch = "";
    private offset = 0;
    private total = 0;
    private models: CatalogModel[] = [];
    private resultsEl: HTMLElement | null = null;
    private loadMoreBtn: HTMLElement | null = null;
    private debounceTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(app: App, plugin: LilbeePlugin) {
        super(app);
        this.plugin = plugin;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("lilbee-catalog-modal");

        contentEl.createEl("h2", { text: "Model Catalog" });

        const filters = contentEl.createDiv({ cls: "lilbee-catalog-filters" });

        const taskSelect = filters.createEl("select", { cls: "lilbee-catalog-filter-task" }) as HTMLSelectElement;
        for (const [value, label] of [["", "All tasks"], ["chat", "Chat"], ["embedding", "Embedding"], ["vision", "Vision"]] as const) {
            const opt = taskSelect.createEl("option", { text: label }) as HTMLOptionElement;
            opt.value = value;
        }
        taskSelect.addEventListener("change", () => {
            this.filterTask = taskSelect.value as TaskFilter;
            this.resetAndFetch();
        });

        const sizeSelect = filters.createEl("select", { cls: "lilbee-catalog-filter-size" }) as HTMLSelectElement;
        for (const [value, label] of [["", "All sizes"], ["small", "Small"], ["medium", "Medium"], ["large", "Large"]] as const) {
            const opt = sizeSelect.createEl("option", { text: label }) as HTMLOptionElement;
            opt.value = value;
        }
        sizeSelect.addEventListener("change", () => {
            this.filterSize = sizeSelect.value as SizeFilter;
            this.resetAndFetch();
        });

        const sortSelect = filters.createEl("select", { cls: "lilbee-catalog-filter-sort" }) as HTMLSelectElement;
        for (const [value, label] of [["featured", "Featured"], ["downloads", "Downloads"], ["name", "Name"], ["size_asc", "Size (asc)"], ["size_desc", "Size (desc)"]] as const) {
            const opt = sortSelect.createEl("option", { text: label }) as HTMLOptionElement;
            opt.value = value;
        }
        sortSelect.addEventListener("change", () => {
            this.filterSort = sortSelect.value as SortFilter;
            this.resetAndFetch();
        });

        const searchInput = filters.createEl("input", {
            cls: "lilbee-catalog-search",
            placeholder: "Search models...",
            attr: { type: "text" },
        });
        searchInput.addEventListener("input", () => {
            if (this.debounceTimer) clearTimeout(this.debounceTimer);
            this.debounceTimer = setTimeout(() => {
                this.filterSearch = (searchInput as unknown as HTMLInputElement).value;
                this.resetAndFetch();
            }, DEBOUNCE_MS);
        });

        this.resultsEl = contentEl.createDiv({ cls: "lilbee-catalog-results" });

        this.loadMoreBtn = contentEl.createEl("button", {
            text: "Load more",
            cls: "lilbee-catalog-load-more",
        });
        this.loadMoreBtn.style.display = "none";
        this.loadMoreBtn.addEventListener("click", () => this.fetchMore());

        this.resetAndFetch();
    }

    onClose(): void {
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
    }

    private resetAndFetch(): void {
        this.offset = 0;
        this.models = [];
        if (this.resultsEl) this.resultsEl.empty();
        void this.fetchPage();
    }

    private fetchMore(): void {
        void this.fetchPage();
    }

    private async fetchPage(): Promise<void> {
        try {
            const params: Parameters<typeof this.plugin.api.catalog>[0] = {
                limit: PAGE_SIZE,
                offset: this.offset,
                sort: this.filterSort,
            };
            if (this.filterTask) params.task = this.filterTask as "chat" | "embedding" | "vision";
            if (this.filterSize) params.size = this.filterSize as "small" | "medium" | "large";
            if (this.filterSearch) params.search = this.filterSearch;

            const response: CatalogResponse = await this.plugin.api.catalog(params);
            this.total = response.total;
            this.models.push(...response.models);
            this.offset += response.models.length;

            for (const model of response.models) {
                this.renderRow(model);
            }

            this.updateLoadMore();
        } catch {
            new Notice("lilbee: failed to load catalog");
        }
    }

    private updateLoadMore(): void {
        if (!this.loadMoreBtn) return;
        this.loadMoreBtn.style.display = this.offset < this.total ? "" : "none";
    }

    private renderRow(model: CatalogModel): void {
        if (!this.resultsEl) return;
        const row = this.resultsEl.createDiv({ cls: "lilbee-catalog-row" });
        row.createDiv({ cls: "lilbee-catalog-row-name", text: model.name });
        row.createDiv({ cls: "lilbee-catalog-row-size", text: `${model.size_gb} GB` });
        row.createDiv({ cls: "lilbee-catalog-row-desc", text: model.description });

        const actionEl = row.createDiv({ cls: "lilbee-catalog-row-action" });
        const active = this.plugin.activeModel === model.name || this.plugin.activeVisionModel === model.name;

        if (active) {
            actionEl.createEl("span", { text: "Active", cls: "lilbee-catalog-active" });
        } else if (model.installed) {
            actionEl.createEl("span", { text: "Installed", cls: "lilbee-installed" });
        } else {
            const pullBtn = actionEl.createEl("button", { text: "Pull", cls: "lilbee-catalog-pull" });
            pullBtn.addEventListener("click", () => this.handlePull(model, pullBtn));
        }
    }

    private handlePull(model: CatalogModel, btn: HTMLElement): void {
        const info = {
            name: model.name,
            size_gb: model.size_gb,
            min_ram_gb: model.min_ram_gb,
            description: model.description,
            installed: model.installed,
        };
        const confirmModal = new ConfirmPullModal(this.app, info);
        confirmModal.open();
        void confirmModal.result.then((confirmed) => {
            if (!confirmed) return;
            void this.pullQueue.enqueue(
                () => this.executePull(model, btn),
                model.name,
            );
        });
    }

    private async executePull(model: CatalogModel, btn: HTMLElement): Promise<void> {
        btn.textContent = "Pulling...";
        (btn as HTMLButtonElement).disabled = true;
        try {
            for await (const event of this.plugin.api.pullModel(model.name, model.source)) {
                if (event.event === SSE_EVENT.PROGRESS) {
                    const d = event.data as { current?: number; total?: number };
                    if (d.total && d.current !== undefined) {
                        const pct = Math.round((d.current / d.total) * 100);
                        btn.textContent = `${pct}%`;
                    }
                }
            }
            if (this.filterTask === "vision") {
                await this.plugin.api.setVisionModel(model.name);
                this.plugin.activeVisionModel = model.name;
            } else {
                await this.plugin.api.setChatModel(model.name);
                this.plugin.activeModel = model.name;
            }
            this.plugin.fetchActiveModel();
            new Notice(`lilbee: ${model.name} pulled and activated`);
            btn.textContent = "Active";
            (btn as HTMLButtonElement).disabled = true;
        } catch (err) {
            if (err instanceof Error && err.name === "AbortError") {
                new Notice(NOTICE.PULL_CANCELLED);
            } else {
                new Notice(NOTICE.PULL_FAILED);
            }
            btn.textContent = "Pull";
            (btn as HTMLButtonElement).disabled = false;
        }
    }
}
