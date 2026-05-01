import { App, Modal, Notice } from "obsidian";
import type LilbeePlugin from "../main";
import type { CatalogEntry, KeyStatus, ModelTask } from "../types";
import { CATALOG_SOURCE, KEY_STATUS, MODEL_TASK } from "../types";
import { MESSAGES } from "../locales/en";
import {
    deepLinkToApiKeySettings,
    frontierRowsOnly,
    groupByProvider,
    hasReadyFrontierRow,
    localRowsOnly,
    renderKeyStatusPill,
    renderProviderPill,
} from "./catalog-helpers";

const SEARCH_DEBOUNCE_MS = 100;
const PAGE_SIZE = 50;

/** Scope of a picker — controls the title, the catalog task filter, and the PATCH key. */
export type PickerScope = "chat" | "embedding";

/**
 * ModelPickerModal — replaces the inline `<select>` chat-model and
 * embedding-model dropdowns in the chat header. Layout:
 *
 *   [search input                            ]
 *   ── Local ──
 *     row, row, …
 *   ── OpenAI ──
 *     row, row, …
 *   ── Anthropic ──
 *     row, row, …
 *
 * Frontier rows are filtered out entirely when no provider key is
 * configured (matches the catalog modal's Frontier-tab gating). Search
 * filters all rows client-side over what's already loaded.
 *
 * Keyboard: ↑/↓ navigate, Enter select, Escape close.
 */
export class ModelPickerModal extends Modal {
    private plugin: LilbeePlugin;
    private pickerScope: PickerScope;
    private allRows: CatalogEntry[] = [];
    private filteredRows: CatalogEntry[] = [];
    private filterText = "";
    private searchInputEl: HTMLInputElement | null = null;
    private listEl: HTMLElement | null = null;
    private highlightedIndex = 0;
    private filterTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(app: App, plugin: LilbeePlugin, pickerScope: PickerScope) {
        super(app);
        this.plugin = plugin;
        this.pickerScope = pickerScope;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("lilbee-model-picker-modal");
        contentEl.createEl("h2", {
            text: this.pickerScope === "chat" ? MESSAGES.MODEL_PICKER_TITLE_CHAT : MESSAGES.MODEL_PICKER_TITLE_EMBED,
        });
        this.renderSearchInput(contentEl);
        this.listEl = contentEl.createDiv({ cls: "lilbee-model-picker-list" });
        this.registerKeyHandlers();
        void this.fetchAndRender();
    }

    onClose(): void {
        if (this.filterTimer !== null) clearTimeout(this.filterTimer);
    }

    private renderSearchInput(parent: HTMLElement): void {
        const wrap = parent.createDiv({ cls: "lilbee-model-picker-search" });
        this.searchInputEl = wrap.createEl("input", {
            cls: "lilbee-model-picker-search-input",
            attr: { type: "text" },
            placeholder: MESSAGES.MODEL_PICKER_SEARCH_PLACEHOLDER,
        }) as HTMLInputElement;
        this.searchInputEl.addEventListener("input", () => {
            /* v8 ignore next -- searchInputEl is set on the previous statement so the optional chain always finds it */
            const value = this.searchInputEl?.value ?? "";
            if (this.filterTimer !== null) clearTimeout(this.filterTimer);
            this.filterTimer = setTimeout(() => {
                this.filterText = value;
                this.applyFilterAndRender();
            }, SEARCH_DEBOUNCE_MS);
        });
        // Auto-focus on open so the user can start typing immediately.
        setTimeout(() => this.searchInputEl?.focus(), 0);
    }

    /**
     * Register Enter / Escape / ↑↓ on the modal scope. Obsidian's `Scope.register`
     * is the supported way to handle keys without leaking listeners across
     * modals — `Modal.scope` is created by Obsidian per-instance and torn down
     * on close.
     */
    private registerKeyHandlers(): void {
        const scope = (
            this as { scope?: { register: (mods: string[] | null, key: string, cb: () => unknown) => unknown } }
        ).scope;
        /* v8 ignore next -- Modal always provides scope; the guard exists only for hostile test stubs */
        if (!scope || typeof scope.register !== "function") return;
        scope.register([], "Enter", () => this.activateHighlighted());
        scope.register([], "Escape", () => {
            this.close();
            return false;
        });
        scope.register([], "ArrowDown", () => {
            this.moveHighlight(1);
            return false;
        });
        scope.register([], "ArrowUp", () => {
            this.moveHighlight(-1);
            return false;
        });
    }

    private moveHighlight(delta: number): void {
        if (this.filteredRows.length === 0) return;
        this.highlightedIndex = (this.highlightedIndex + delta + this.filteredRows.length) % this.filteredRows.length;
        this.repaintHighlight();
    }

    private repaintHighlight(): void {
        /* v8 ignore next -- listEl is set in onOpen before any keypress can reach moveHighlight */
        if (!this.listEl) return;
        const rows = this.listEl.querySelectorAll(".lilbee-model-picker-row");
        for (let i = 0; i < rows.length; i++) {
            rows[i].toggleClass("lilbee-model-picker-row-highlighted", i === this.highlightedIndex);
        }
    }

    private activateHighlighted(): void {
        const row = this.filteredRows[this.highlightedIndex];
        /* v8 ignore next -- Enter is wired to activateHighlighted only after fetchAndRender produces filteredRows */
        if (!row) return;
        void this.activateRow(row);
    }

    private async fetchAndRender(): Promise<void> {
        const taskFilter: ModelTask = this.pickerScope === "chat" ? MODEL_TASK.CHAT : MODEL_TASK.EMBEDDING;
        const result = await this.plugin.api.catalog({ task: taskFilter, limit: PAGE_SIZE });
        if (result.isErr()) {
            new Notice(MESSAGES.ERROR_LOAD_CATALOG);
            return;
        }
        this.allRows = result.value.models;
        this.applyFilterAndRender();
    }

    /**
     * Compose the visible row set: Local rows always show; Frontier rows show
     * only when at least one provider key is configured (gate matches the
     * catalog modal). Then the search filter trims by display name.
     */
    private applyFilterAndRender(): void {
        const local = localRowsOnly(this.allRows);
        const frontier = hasReadyFrontierRow(this.allRows) ? frontierRowsOnly(this.allRows) : [];
        const visible = [...local, ...frontier];
        this.filteredRows = filterRowsByText(visible, this.filterText);
        this.highlightedIndex = 0;
        this.renderList();
    }

    private renderList(): void {
        /* v8 ignore next -- listEl is set in onOpen before applyFilterAndRender runs */
        if (!this.listEl) return;
        this.listEl.empty();
        if (this.filteredRows.length === 0) {
            this.listEl.createDiv({ cls: "lilbee-model-picker-empty", text: MESSAGES.MODEL_PICKER_EMPTY });
            return;
        }
        const local = this.filteredRows.filter((r) => r.source !== CATALOG_SOURCE.FRONTIER);
        const frontier = this.filteredRows.filter((r) => r.source === CATALOG_SOURCE.FRONTIER);
        if (local.length > 0) {
            this.listEl.createDiv({
                cls: "lilbee-model-picker-section-header",
                text: MESSAGES.MODEL_PICKER_LOCAL_HEADING,
            });
            for (const row of local) this.renderRow(this.listEl, row);
        }
        for (const [provider, group] of groupByProvider(frontier)) {
            this.listEl.createDiv({ cls: "lilbee-model-picker-section-header", text: provider });
            for (const row of group) this.renderRow(this.listEl, row);
        }
        this.repaintHighlight();
    }

    private renderRow(parent: HTMLElement, row: CatalogEntry): void {
        const rowEl = parent.createDiv({ cls: "lilbee-model-picker-row" });
        const name = rowEl.createSpan({ cls: "lilbee-model-picker-row-name", text: row.display_name });
        if (row.source === CATALOG_SOURCE.FRONTIER) {
            const frontier = row as CatalogEntry & { provider?: string; key_status?: KeyStatus };
            /* v8 ignore next -- frontier rows are server-side guaranteed to carry these fields; the ?? is paranoia */
            const provider = frontier.provider ?? "";
            /* v8 ignore next */
            const keyStatus = frontier.key_status ?? KEY_STATUS.MISSING_KEY;
            renderProviderPill(name, provider);
            renderKeyStatusPill(name, keyStatus);
        }
        rowEl.addEventListener("click", () => {
            void this.activateRow(row);
        });
    }

    private async activateRow(row: CatalogEntry): Promise<void> {
        if (row.source === CATALOG_SOURCE.FRONTIER) {
            const frontier = row as CatalogEntry & { provider?: string; key_status?: KeyStatus };
            /* v8 ignore next -- server-guaranteed; defensive fallback only */
            const keyStatus = frontier.key_status ?? KEY_STATUS.MISSING_KEY;
            if (keyStatus === KEY_STATUS.MISSING_KEY) {
                /* v8 ignore next -- server-guaranteed; defensive fallback only */
                const provider = frontier.provider ?? "";
                this.close();
                deepLinkToApiKeySettings(this.app, provider);
                return;
            }
        }
        const result =
            this.pickerScope === "chat"
                ? await this.plugin.api.setChatModel(row.hf_repo)
                : await this.plugin.api.setEmbeddingModel(row.hf_repo);
        if (result.isErr()) {
            new Notice(MESSAGES.ERROR_SET_MODEL.replace("{model}", row.hf_repo));
            return;
        }
        if (this.pickerScope === "chat") this.plugin.activeModel = row.hf_repo;
        this.plugin.fetchActiveModel();
        this.plugin.refreshSettingsTab();
        new Notice(MESSAGES.NOTICE_MODEL_ACTIVATED(row.display_name));
        this.close();
    }
}

/**
 * Filter `rows` by case-insensitive substring match on display_name. Empty
 * filter returns everything. Exported for direct unit testing.
 */
export function filterRowsByText(rows: CatalogEntry[], text: string): CatalogEntry[] {
    const trimmed = text.trim().toLowerCase();
    if (trimmed === "") return rows;
    return rows.filter((r) => r.display_name.toLowerCase().includes(trimmed));
}
