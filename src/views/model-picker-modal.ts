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
import { renderPill, PILL_CLS } from "../components/pill";
import { renderFitChip } from "../components/fit-chip";
import { tagModalChrome } from "../utils";

const SEARCH_DEBOUNCE_MS = 100;
const PAGE_SIZE = 50;

export type PickerScope = "chat" | "embedding";

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
        tagModalChrome(this);
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
            /* v8 ignore next */
            const value = this.searchInputEl?.value ?? "";
            if (this.filterTimer !== null) clearTimeout(this.filterTimer);
            this.filterTimer = setTimeout(() => {
                this.filterText = value;
                this.applyFilterAndRender();
            }, SEARCH_DEBOUNCE_MS);
        });
        setTimeout(() => this.searchInputEl?.focus(), 0);
    }

    private registerKeyHandlers(): void {
        const scope = (
            this as { scope?: { register: (mods: string[] | null, key: string, cb: () => unknown) => unknown } }
        ).scope;
        /* v8 ignore next */
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
        /* v8 ignore next */
        if (!this.listEl) return;
        const rows = this.listEl.querySelectorAll(".lilbee-model-picker-row");
        for (let i = 0; i < rows.length; i++) {
            rows[i].toggleClass("lilbee-model-picker-row-highlighted", i === this.highlightedIndex);
        }
    }

    private activateHighlighted(): void {
        const row = this.filteredRows[this.highlightedIndex];
        /* v8 ignore next */
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
        // Defensive client-side filter: if the server returns rows whose
        // declared task doesn't match what we asked for (older builds, or
        // frontier providers tagged loosely), drop them so the chat picker
        // never shows embedding/vision/rerank models and vice versa.
        this.allRows = result.value.models.filter((m) => m.task === taskFilter);
        this.applyFilterAndRender();
    }

    private applyFilterAndRender(): void {
        const local = localRowsOnly(this.allRows);
        const frontier = hasReadyFrontierRow(this.allRows) ? frontierRowsOnly(this.allRows) : [];
        const visible = [...local, ...frontier];
        this.filteredRows = filterRowsByText(visible, this.filterText);
        this.highlightedIndex = 0;
        this.renderList();
    }

    private renderList(): void {
        /* v8 ignore next */
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
        const nameRow = rowEl.createDiv({ cls: "lilbee-model-picker-row-name" });
        nameRow.createSpan({ text: row.display_name, cls: "lilbee-model-picker-row-display" });
        if (row.installed) {
            renderPill(nameRow, MESSAGES.LABEL_INSTALLED, PILL_CLS.INSTALLED);
        }
        renderFitChip(nameRow, row.fit);
        if (row.source === CATALOG_SOURCE.FRONTIER) {
            const frontier = row as CatalogEntry & { provider?: string; key_status?: KeyStatus };
            /* v8 ignore next 2 */
            const provider = frontier.provider ?? "";
            const keyStatus = frontier.key_status ?? KEY_STATUS.MISSING_KEY;
            renderProviderPill(nameRow, provider);
            renderKeyStatusPill(nameRow, keyStatus);
        }
        if (row.size_gb > 0) {
            rowEl.createDiv({
                cls: "lilbee-model-picker-row-meta",
                text: `${row.size_gb} GB${row.quality_tier ? ` · ${row.quality_tier}` : ""}`,
            });
        }
        rowEl.addEventListener("click", () => {
            void this.activateRow(row);
        });
    }

    private async activateRow(row: CatalogEntry): Promise<void> {
        if (row.source === CATALOG_SOURCE.FRONTIER) {
            const frontier = row as CatalogEntry & { provider?: string; key_status?: KeyStatus };
            /* v8 ignore next */
            const keyStatus = frontier.key_status ?? KEY_STATUS.MISSING_KEY;
            if (keyStatus === KEY_STATUS.MISSING_KEY) {
                /* v8 ignore next */
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

export function filterRowsByText(rows: CatalogEntry[], text: string): CatalogEntry[] {
    const trimmed = text.trim().toLowerCase();
    if (trimmed === "") return rows;
    return rows.filter((r) => r.display_name.toLowerCase().includes(trimmed));
}
