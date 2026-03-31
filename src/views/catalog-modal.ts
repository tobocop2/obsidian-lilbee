import { App, Modal, Notice } from "obsidian";
import type LilbeePlugin from "../main";
import type { ModelFamily, ModelVariant, CatalogResponse } from "../types";
import { NOTICE, SSE_EVENT, TASK_TYPE } from "../types";
import { ConfirmModal } from "./confirm-modal";
import { ConfirmPullModal } from "./confirm-pull-modal";

const PAGE_SIZE = 20;
const DEBOUNCE_MS = 300;

type TaskFilter = "" | "chat" | "embedding" | "vision";
type SizeFilter = "" | "small" | "medium" | "large";
type SortFilter = "featured" | "downloads" | "name" | "size_asc" | "size_desc";

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
        this.families = [];
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
            this.families.push(...response.families);
            this.offset += response.families.length;

            for (const family of response.families) {
                this.renderFamily(family);
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
        const nameCls = isRecommended ? "lilbee-catalog-variant-name lilbee-catalog-recommended" : "lilbee-catalog-variant-name";
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
            actionEl.createEl("span", { text: "Active", cls: "lilbee-catalog-active" });
        } else if (variant.installed) {
            const installedBtn = actionEl.createEl("button", { text: "Use", cls: "lilbee-catalog-use" });
            installedBtn.addEventListener("click", () => this.handleUse(family, variant, installedBtn));
            const removeBtn = actionEl.createEl("button", { text: "Remove", cls: "lilbee-catalog-remove" });
            removeBtn.addEventListener("click", () => this.handleRemove(variant, removeBtn));
        } else {
            const pullBtn = actionEl.createEl("button", { text: "Pull", cls: "lilbee-catalog-pull" });
            pullBtn.addEventListener("click", () => this.handlePull(family, variant, pullBtn));
        }
    }

    private handleRemove(variant: ModelVariant, btn: HTMLElement): void {
        const confirmModal = new ConfirmModal(
            this.app,
            `Remove ${variant.hf_repo}? This deletes the model file from disk.`,
        );
        confirmModal.open();
        void confirmModal.result.then((confirmed) => {
            if (!confirmed) return;
            void this.executeRemove(variant, btn);
        });
    }

    private async executeRemove(variant: ModelVariant, btn: HTMLElement): Promise<void> {
        btn.textContent = "Removing...";
        (btn as HTMLButtonElement).disabled = true;
        try {
            await this.plugin.api.deleteModel(variant.hf_repo, variant.source);
            new Notice(`Removed ${variant.hf_repo}`);
            this.plugin.fetchActiveModel();
            this.resetAndFetch();
        } catch {
            new Notice(`Failed to remove ${variant.hf_repo}`);
            btn.textContent = "Remove";
            (btn as HTMLButtonElement).disabled = false;
        }
    }

    private async handleUse(family: ModelFamily, variant: ModelVariant, btn: HTMLElement): Promise<void> {
        btn.textContent = "Setting...";
        (btn as HTMLButtonElement).disabled = true;
        try {
            if (variant.task === "vision") {
                await this.plugin.api.setVisionModel(variant.hf_repo);
                this.plugin.activeVisionModel = variant.hf_repo;
            } else if (variant.task === "embedding") {
                await this.plugin.api.setEmbeddingModel(variant.hf_repo);
            } else {
                await this.plugin.api.setChatModel(variant.hf_repo);
                this.plugin.activeModel = variant.hf_repo;
            }
            this.plugin.fetchActiveModel();
            new Notice(`Now using ${variant.hf_repo}`);
            this.resetAndFetch();
        } catch {
            new Notice(`Failed to set ${variant.hf_repo}`);
            btn.textContent = "Use";
            (btn as HTMLButtonElement).disabled = false;
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
        btn.textContent = "Pulling...";
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
            if (variant.task === "vision") {
                await this.plugin.api.setVisionModel(variant.hf_repo);
                this.plugin.activeVisionModel = variant.hf_repo;
            } else if (variant.task === "embedding") {
                await this.plugin.api.setEmbeddingModel(variant.hf_repo);
            } else {
                await this.plugin.api.setChatModel(variant.hf_repo);
                this.plugin.activeModel = variant.hf_repo;
            }
            this.plugin.fetchActiveModel();
            this.plugin.taskQueue.complete(taskId);
            new Notice(`lilbee: ${variant.hf_repo} pulled and activated`);
            btn.textContent = "Active";
            (btn as HTMLButtonElement).disabled = true;
        } catch (err) {
            if (err instanceof Error && err.name === "AbortError") {
                new Notice(NOTICE.PULL_CANCELLED);
                this.plugin.taskQueue.cancel(taskId);
            } else {
                new Notice(NOTICE.PULL_FAILED);
                this.plugin.taskQueue.fail(taskId, err instanceof Error ? err.message : "unknown");
            }
            btn.textContent = "Pull";
            (btn as HTMLButtonElement).disabled = false;
        }
    }
}
