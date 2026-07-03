import { App, Modal, Notice } from "obsidian";
import type { Result } from "../result";
import type LilbeePlugin from "../main";
import type { CatalogEntry, ModelTask } from "../types";
import { CATALOG_SOURCE, HOSTED_SOURCES, KEY_STATUS, MODEL_TASK } from "../types";
import { MESSAGES } from "../locales/en";
import {
    deepLinkToApiKeySettings,
    groupByProvider,
    hasReadyHostedRow,
    hostedRowsOnly,
    localRowsOnly,
    renderKeyStatusPill,
    renderProviderPill,
} from "./catalog-helpers";
import { renderPill, PILL_CLS } from "../components/pill";
import { renderFitChip } from "../components/fit-chip";
import { tagModalChrome } from "../utils";

const SEARCH_DEBOUNCE_MS = 100;
const PAGE_SIZE = 50;
// A model set right after a pull can hit the server mid worker-reload and
// return a transient error even though the model is applied. Retry the
// (idempotent) set a few times before surfacing a failure.
export const SET_MODEL_RETRIES = 4;
export const SET_MODEL_RETRY_MS = 600;

export type PickerScope = typeof MODEL_TASK.CHAT | typeof MODEL_TASK.EMBEDDING;

export class ModelPickerModal extends Modal {
    private plugin: LilbeePlugin;
    private pickerScope: PickerScope;
    private allRows: CatalogEntry[] = [];
    private filteredRows: CatalogEntry[] = [];
    private filterText = "";
    private searchInputEl: HTMLInputElement | null = null;
    private listEl: HTMLElement | null = null;
    private highlightedIndex = 0;
    private filterTimer: number | null = null;

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
            text:
                this.pickerScope === MODEL_TASK.CHAT
                    ? MESSAGES.MODEL_PICKER_TITLE_CHAT
                    : MESSAGES.MODEL_PICKER_TITLE_EMBED,
        });
        this.renderSearchInput(contentEl);
        this.listEl = contentEl.createDiv({ cls: "lilbee-model-picker-list" });
        this.registerKeyHandlers();
        void this.fetchAndRender();
    }

    onClose(): void {
        if (this.filterTimer !== null) window.clearTimeout(this.filterTimer);
    }

    private renderSearchInput(parent: HTMLElement): void {
        const wrap = parent.createDiv({ cls: "lilbee-model-picker-search" });
        this.searchInputEl = wrap.createEl("input", {
            cls: "lilbee-model-picker-search-input",
            attr: { type: "text" },
            placeholder: MESSAGES.MODEL_PICKER_SEARCH_PLACEHOLDER,
        });
        this.searchInputEl.addEventListener("input", () => {
            /* v8 ignore next */
            const value = this.searchInputEl?.value ?? "";
            if (this.filterTimer !== null) window.clearTimeout(this.filterTimer);
            this.filterTimer = window.setTimeout(() => {
                this.filterText = value;
                this.applyFilterAndRender();
            }, SEARCH_DEBOUNCE_MS);
        });
        window.setTimeout(() => this.searchInputEl?.focus(), 0);
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
        const taskFilter: ModelTask = this.pickerScope;
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
        const hosted = hasReadyHostedRow(this.allRows) ? hostedRowsOnly(this.allRows) : [];
        const visible = [...local, ...hosted];
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
        const local = this.filteredRows.filter((r) => !HOSTED_SOURCES.has(r.source));
        const hosted = this.filteredRows.filter((r) => HOSTED_SOURCES.has(r.source));
        if (local.length > 0) {
            this.listEl.createDiv({
                cls: "lilbee-model-picker-section-header",
                text: MESSAGES.MODEL_PICKER_LOCAL_HEADING,
            });
            for (const row of local) this.renderRow(this.listEl, row);
        }
        for (const [provider, group] of groupByProvider(hosted)) {
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
        if (HOSTED_SOURCES.has(row.source)) {
            /* v8 ignore next */
            const provider = row.provider ?? "";
            renderProviderPill(nameRow, provider);
            // Local servers (Ollama, LM Studio) need no API key — provider pill only.
            if (row.source === CATALOG_SOURCE.FRONTIER) {
                renderKeyStatusPill(nameRow, row.key_status ?? KEY_STATUS.MISSING_KEY);
            }
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
            /* v8 ignore next */
            const keyStatus = row.key_status ?? KEY_STATUS.MISSING_KEY;
            if (keyStatus === KEY_STATUS.MISSING_KEY) {
                /* v8 ignore next */
                const provider = row.provider ?? "";
                this.close();
                deepLinkToApiKeySettings(this.app, provider);
                return;
            }
        }
        const result = await this.setActiveModelWithRetry(row.hf_repo);
        if (result.isErr()) {
            new Notice(MESSAGES.ERROR_SET_MODEL.replace("{model}", row.hf_repo));
            return;
        }
        if (this.pickerScope === MODEL_TASK.CHAT) this.plugin.activeModel = row.hf_repo;
        void this.plugin.fetchActiveModel();
        this.plugin.refreshSettingsTab();
        new Notice(MESSAGES.NOTICE_MODEL_ACTIVATED(row.display_name));
        this.close();
    }

    /**
     * Set the model, retrying on error. A set issued right after a pull can
     * reach the server mid worker-reload and return a transient error even
     * though the model is applied; the PUT is idempotent, so retry a few times
     * before reporting failure. A successful retry also confirms the model
     * took, so a transient not-ready response no longer surfaces as "Failed to
     * set" while the model quietly activates.
     */
    private async setActiveModelWithRetry(repo: string): Promise<Result<void, Error>> {
        const set = (m: string): Promise<Result<void, Error>> =>
            this.pickerScope === MODEL_TASK.CHAT
                ? this.plugin.api.setChatModel(m)
                : this.plugin.api.setEmbeddingModel(m);
        let result = await set(repo);
        for (let attempt = 0; attempt < SET_MODEL_RETRIES && result.isErr(); attempt++) {
            await new Promise((resolve) => window.setTimeout(resolve, SET_MODEL_RETRY_MS));
            result = await set(repo);
        }
        return result;
    }
}

export function filterRowsByText(rows: CatalogEntry[], text: string): CatalogEntry[] {
    const trimmed = text.trim().toLowerCase();
    if (trimmed === "") return rows;
    return rows.filter((r) => r.display_name.toLowerCase().includes(trimmed));
}
