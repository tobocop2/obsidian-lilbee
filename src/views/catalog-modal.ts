import { Modal, Notice, setIcon } from "obsidian";
import type LilbeePlugin from "../main";
import type { SSEEvent } from "../types";

interface CatalogEntry {
    name: string;
    size_gb: number;
    min_ram_gb: number;
    description: string;
    installed: boolean;
    source: string;
}

interface CatalogResponse {
    total: number;
    limit: number;
    offset: number;
    models: CatalogEntry[];
}

export class CatalogModal extends Modal {
    private plugin: LilbeePlugin;
    private task: "chat" | "vision";
    private searchInput: HTMLInputElement | null = null;
    private resultsEl: HTMLElement | null = null;
    private debounceTimer: ReturnType<typeof setTimeout> | null = null;
    private onSelect: ((model: string) => void) | null;

    constructor(
        plugin: LilbeePlugin,
        task: "chat" | "vision",
        onSelect?: (model: string) => void,
    ) {
        super(plugin.app);
        this.plugin = plugin;
        this.task = task;
        this.onSelect = onSelect ?? null;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("lilbee-catalog-modal");

        contentEl.createEl("h2", {
            text: `Browse ${this.task} models`,
        });

        const controls = contentEl.createDiv("lilbee-catalog-controls");
        this.searchInput = controls.createEl("input", {
            type: "text",
            placeholder: "Search models...",
            cls: "lilbee-catalog-search",
        });
        this.searchInput.addEventListener("input", () => this.onSearchInput());

        this.resultsEl = contentEl.createDiv("lilbee-catalog-results");
        this.loadModels();
    }

    onClose(): void {
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.contentEl.empty();
    }

    private onSearchInput(): void {
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => this.loadModels(), 300);
    }

    private async loadModels(): Promise<void> {
        if (!this.resultsEl) return;
        this.resultsEl.empty();
        this.resultsEl.createEl("p", { text: "Loading...", cls: "lilbee-catalog-loading" });

        const search = this.searchInput?.value ?? "";
        try {
            const url = `${this.plugin.settings.serverUrl}/api/models/catalog`;
            const params = new URLSearchParams({
                task: this.task,
                search,
                featured: search ? "false" : "true",
                limit: "20",
                offset: "0",
            });
            const res = await fetch(`${url}?${params}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data: CatalogResponse = await res.json();
            this.renderResults(data);
        } catch {
            this.resultsEl.empty();
            this.resultsEl.createEl("p", {
                text: "Failed to load catalog. Is the lilbee server running?",
                cls: "lilbee-catalog-error",
            });
        }
    }

    private renderResults(data: CatalogResponse): void {
        if (!this.resultsEl) return;
        this.resultsEl.empty();

        if (data.models.length === 0) {
            this.resultsEl.createEl("p", {
                text: "No models found.",
                cls: "lilbee-catalog-empty",
            });
            return;
        }

        const table = this.resultsEl.createEl("table", { cls: "lilbee-catalog-table" });
        const thead = table.createEl("thead");
        const headerRow = thead.createEl("tr");
        headerRow.createEl("th", { text: "Model" });
        headerRow.createEl("th", { text: "Size" });
        headerRow.createEl("th", { text: "Description" });
        headerRow.createEl("th", { text: "" });

        const tbody = table.createEl("tbody");
        for (const model of data.models) {
            const row = tbody.createEl("tr");
            const nameCell = row.createEl("td");
            nameCell.createEl("strong", { text: model.name });
            if (model.source === "ollama") {
                nameCell.createEl("span", {
                    text: " (ollama)",
                    cls: "lilbee-catalog-source-badge",
                });
            }
            row.createEl("td", { text: `${model.size_gb} GB` });
            row.createEl("td", { text: model.description });

            const actionCell = row.createEl("td");
            if (model.installed) {
                const badge = actionCell.createEl("span", {
                    text: "Installed",
                    cls: "lilbee-installed",
                });
                badge.addEventListener("click", () => {
                    if (this.onSelect) this.onSelect(model.name);
                    this.close();
                });
            } else {
                const btn = actionCell.createEl("button", {
                    text: "Install",
                    cls: "lilbee-catalog-install-btn",
                });
                btn.addEventListener("click", () => this.installModel(model, btn));
            }
        }

        if (data.total > data.models.length) {
            this.resultsEl.createEl("p", {
                text: `Showing ${data.models.length} of ${data.total} models. Refine your search to see more.`,
                cls: "lilbee-catalog-pagination-hint",
            });
        }
    }

    private async installModel(model: CatalogEntry, btn: HTMLButtonElement): Promise<void> {
        btn.disabled = true;
        btn.textContent = "Installing...";
        try {
            for await (const event of this.plugin.api.pullModel(model.name)) {
                const data = event.data as Record<string, unknown>;
                const total = Number(data?.total ?? 0);
                const completed = Number(data?.completed ?? 0);
                if (total > 0 && completed > 0) {
                    const pct = Math.round((completed / total) * 100);
                    btn.textContent = `${pct}%`;
                }
            }
            new Notice(`Model ${model.name} installed`);
            if (this.onSelect) this.onSelect(model.name);
            this.close();
        } catch (err) {
            btn.disabled = false;
            btn.textContent = "Install";
            new Notice(`Failed to install ${model.name}`);
        }
    }
}
