import { App, Modal, Notice } from "obsidian";
import type LilbeePlugin from "../main";
import type { DocumentResult, SearchChunkType } from "../types";
import { renderDocumentResult, renderSourceChip } from "./results";
import { MESSAGES } from "../locales/en";
import { debounce, DEBOUNCE_MS } from "../utils";

export class SearchModal extends Modal {
    private plugin: LilbeePlugin;
    private mode: "search" | "ask";
    private debouncedSearch: () => void;
    private resultsContainer: HTMLElement | null = null;

    constructor(app: App, plugin: LilbeePlugin, mode: "search" | "ask" = "search") {
        super(app);
        this.plugin = plugin;
        this.mode = mode;
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

        const title = this.mode === "search" ? MESSAGES.TITLE_SEARCH : MESSAGES.TITLE_ASK;
        contentEl.createEl("h2", { text: title });

        const input = contentEl.createEl("input", {
            type: "text",
            cls: "lilbee-search-input",
            placeholder: this.mode === "search" ? MESSAGES.PLACEHOLDER_TYPE_SEARCH : MESSAGES.PLACEHOLDER_ASK_ANYTHING,
        });

        // Search mode toggle (only for search mode)
        if (this.mode === "search") {
            this.renderSearchModeToggle(contentEl);
        }

        this.resultsContainer = contentEl.createDiv({ cls: "lilbee-modal-results" });
        this.renderEmptyState("Enter a query to begin.");

        if (this.mode === "search") {
            input.addEventListener("input", () => {
                this.lastSearchQuery = input.value.trim();
                this.debouncedSearch();
            });
        } else {
            input.addEventListener("keydown", (e) => {
                if (e.key === "Enter" && input.value.trim()) {
                    this.runAsk(input.value.trim());
                }
            });
        }

        setTimeout(() => input.focus(), 0);
    }

    onClose(): void {
        this.cancelDebouncedSearch();
        const { contentEl } = this;
        contentEl.empty();
    }

    private renderSearchModeToggle(container: HTMLElement): void {
        const modes: { value: SearchChunkType; label: string }[] = [
            { value: "all", label: MESSAGES.LABEL_SEARCH_ALL },
            { value: "wiki", label: MESSAGES.LABEL_SEARCH_WIKI },
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
            this.renderEmptyState("Enter a query to begin.");
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
                this.renderEmptyState("No results found.");
                return;
            }
            for (const result of results) {
                renderDocumentResult(this.resultsContainer, result, this.app);
            }
        } catch {
            new Notice(MESSAGES.ERROR_COULD_NOT_CONNECT);
            this.renderEmptyState("Error: could not connect to lilbee server.");
        }
    }

    private async runAsk(question: string): Promise<void> {
        this.renderLoading();
        try {
            const response = await this.plugin.api.ask(question, this.plugin.settings.topK);
            if (!this.resultsContainer) return;
            this.resultsContainer.empty();

            this.resultsContainer.createEl("p", {
                text: response.answer,
                cls: "lilbee-ask-answer",
            });

            if (response.sources.length > 0) {
                const sourcesEl = this.resultsContainer.createDiv({ cls: "lilbee-ask-sources" });
                sourcesEl.createEl("span", { text: "Sources: " });
                for (const source of response.sources) {
                    renderSourceChip(sourcesEl, source);
                }
            }
        } catch {
            new Notice(MESSAGES.ERROR_COULD_NOT_CONNECT);
            this.renderEmptyState("Error: could not connect to lilbee server.");
        }
    }
}
