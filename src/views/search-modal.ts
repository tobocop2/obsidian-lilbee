import { App, Modal, Notice } from "obsidian";
import type LilbeePlugin from "../main";
import type { DocumentResult, SearchChunkType } from "../types";
import { renderDocumentResult } from "./results";
import { MESSAGES } from "../locales/en";
import { debounce, DEBOUNCE_MS } from "../utils";

export class SearchModal extends Modal {
    private plugin: LilbeePlugin;
    private debouncedSearch: () => void;
    private resultsContainer: HTMLElement | null = null;

    constructor(app: App, plugin: LilbeePlugin) {
        super(app);
        this.plugin = plugin;
        const debounced = debounce(() => {
            if (this.lastSearchQuery) {
                this.runSearch(this.lastSearchQuery);
            }
        }, DEBOUNCE_MS);
        this.debouncedSearch = debounced.run;
        this.cancelDebouncedSearch = debounced.cancel;
        this.lastSearchQuery = "";
    }

    private lastSearchQuery = "";
    private cancelDebouncedSearch: () => void;

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("lilbee-modal");

        contentEl.createEl("h2", { text: MESSAGES.TITLE_SEARCH });

        const input = contentEl.createEl("input", {
            type: "text",
            cls: "lilbee-search-input",
            placeholder: MESSAGES.PLACEHOLDER_TYPE_SEARCH,
        });

        this.renderSearchModeToggle(contentEl);

        this.resultsContainer = contentEl.createDiv({ cls: "lilbee-modal-results" });
        this.renderEmptyState(MESSAGES.LABEL_ENTER_QUERY);

        input.addEventListener("input", () => {
            this.lastSearchQuery = input.value.trim();
            this.debouncedSearch();
        });

        setTimeout(() => input.focus(), 0);
    }

    onClose(): void {
        this.cancelDebouncedSearch();
        const { contentEl } = this;
        contentEl.empty();
    }

    private renderSearchModeToggle(container: HTMLElement): void {
        const wikiEnabled = this.plugin.settings.wikiEnabled;
        if (!wikiEnabled && this.plugin.settings.searchChunkType === "wiki") {
            this.plugin.settings.searchChunkType = "all";
        }
        const modes: { value: SearchChunkType; label: string }[] = [
            { value: "all", label: MESSAGES.LABEL_SEARCH_ALL },
            ...(wikiEnabled ? [{ value: "wiki" as SearchChunkType, label: MESSAGES.LABEL_SEARCH_WIKI }] : []),
            { value: "raw", label: MESSAGES.LABEL_SEARCH_RAW },
        ];
        const group = container.createDiv({ cls: "lilbee-search-mode" });
        for (const mode of modes) {
            const btn = group.createEl("button", {
                text: mode.label,
                cls: `lilbee-search-mode-btn${this.plugin.settings.searchChunkType === mode.value ? " active" : ""}`,
            });
            btn.addEventListener("click", () => {
                this.plugin.settings.searchChunkType = mode.value;
                void this.plugin.saveSettings();
                group.querySelectorAll(".lilbee-search-mode-btn").forEach((b) => b.removeClass("active"));
                btn.addClass("active");
                if (this.lastSearchQuery) this.debouncedSearch();
            });
        }
    }

    private renderEmptyState(message: string): void {
        if (!this.resultsContainer) return;
        this.resultsContainer.empty();
        this.resultsContainer.createEl("p", {
            text: message,
            cls: "lilbee-empty-state",
        });
    }

    private renderLoading(): void {
        if (!this.resultsContainer) return;
        this.resultsContainer.empty();
        this.resultsContainer.createDiv({ cls: "lilbee-loading" });
    }

    private async runSearch(query: string): Promise<void> {
        if (!query) {
            this.renderEmptyState(MESSAGES.LABEL_ENTER_QUERY);
            return;
        }
        this.renderLoading();
        try {
            const results: DocumentResult[] = await this.plugin.api.search(
                query,
                this.plugin.settings.topK,
                this.plugin.settings.searchChunkType,
            );
            if (!this.resultsContainer) return;
            this.resultsContainer.empty();
            if (results.length === 0) {
                this.renderEmptyState(MESSAGES.LABEL_NO_RESULTS);
                return;
            }
            for (const result of results) {
                renderDocumentResult(this.resultsContainer, result, this.app, this.plugin.api);
            }
        } catch {
            new Notice(MESSAGES.ERROR_COULD_NOT_CONNECT);
            this.renderEmptyState(MESSAGES.ERROR_SEARCH_CONNECT);
        }
    }
}
