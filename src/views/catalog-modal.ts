import { App, Modal, Notice } from "obsidian";
import type LilbeePlugin from "../main";
import type {
    CatalogEntry,
    CatalogSource,
    CatalogTab,
    CatalogViewMode,
    KeyStatus,
    ModelTask,
    ModelSize,
} from "../types";
import {
    CATALOG_SOURCE,
    CATALOG_TAB,
    KEY_STATUS,
    MODEL_TASK,
    SSE_EVENT,
    TASK_TYPE,
    CATALOG_VIEW_MODE,
    ERROR_NAME,
} from "../types";
import { MESSAGES, FILTERS, CATALOG_FILTERS } from "../locales/en";
import { extractHfRepo } from "../utils/model-ref";
import { ConfirmModal } from "./confirm-modal";
import { ConfirmPullModal } from "./confirm-pull-modal";
import {
    bindEscapeToClose,
    debounce,
    DEBOUNCE_MS,
    formatAbbreviatedCount,
    percentFromSse,
    errorMessage,
    extractSseErrorMessage,
    noticeForResultError,
    getRelevantSystemMemoryGB,
} from "../utils";
import { renderModelCard } from "../components/model-card";
import { renderModelDetail } from "../components/model-detail";
import { ModelInfoModal } from "./model-info-modal";
import {
    deepLinkToApiKeySettings,
    forYouRail,
    freshRail,
    frontierRowsOnly,
    groupByProvider,
    hasReadyFrontierRow,
    localRowsOnly,
    renderKeyStatusPill,
    renderProviderPill,
    tabIdToTask,
    taskToTabId,
    yourCollectionRail,
} from "./catalog-helpers";

const PAGE_SIZE = 20;
const SCROLL_BOTTOM_THRESHOLD_PX = 200;
const DRAWER_BREAKPOINT_PX = 800;
const DRAWER_FOCUS_DEBOUNCE_MS = 30;

type TaskFilter = (typeof FILTERS.TASK)[keyof typeof FILTERS.TASK];
type SizeFilter = "" | typeof FILTERS.SIZE.SMALL | typeof FILTERS.SIZE.MEDIUM | typeof FILTERS.SIZE.LARGE;
type SortFilter = (typeof FILTERS.SORT)[keyof typeof FILTERS.SORT];

const TASK_SECTION_LABEL: Record<ModelTask, string> = {
    [MODEL_TASK.CHAT]: MESSAGES.LABEL_SECTION_CHAT,
    [MODEL_TASK.VISION]: MESSAGES.LABEL_SECTION_VISION,
    [MODEL_TASK.EMBEDDING]: MESSAGES.LABEL_SECTION_EMBEDDING,
    [MODEL_TASK.RERANK]: MESSAGES.LABEL_SECTION_RERANK,
};

interface TabSpec {
    id: CatalogTab;
    label: string;
}

const TAB_SPECS: readonly TabSpec[] = [
    { id: CATALOG_TAB.DISCOVER, label: MESSAGES.TAB_DISCOVER },
    { id: CATALOG_TAB.CHAT, label: MESSAGES.TAB_CHAT_MODELS },
    { id: CATALOG_TAB.EMBED, label: MESSAGES.TAB_EMBED_MODELS },
    { id: CATALOG_TAB.VISION, label: MESSAGES.TAB_VISION_MODELS },
    { id: CATALOG_TAB.RERANK, label: MESSAGES.TAB_RERANK_MODELS },
    { id: CATALOG_TAB.LIBRARY, label: MESSAGES.TAB_LIBRARY },
];

interface RailSpec {
    heading: string;
    help: string;
    rows: CatalogEntry[];
}

export class CatalogModal extends Modal {
    private plugin: LilbeePlugin;
    private filterTask: TaskFilter = "";
    private filterSize: SizeFilter = "";
    private filterSort: SortFilter = FILTERS.SORT.FEATURED;
    private filterSearch = "";
    private offset = 0;
    private hasMore = false;
    private isFetching = false;
    private entries: CatalogEntry[] = [];
    private resultsEl: HTMLElement | null = null;
    private viewMode: CatalogViewMode = CATALOG_VIEW_MODE.GRID;
    private sortColumn = "";
    private sortAscending = true;
    private viewToggleBtn: HTMLElement | null = null;
    private debouncedSearch: () => void;
    private cancelDebouncedSearch: () => void;
    private currentTab: CatalogSource = CATALOG_SOURCE.LOCAL;
    private subTabBarEl: HTMLElement | null = null;
    private frontierTabBtn: HTMLElement | null = null;
    private activeTab: CatalogTab;
    private mainTabBarEl: HTMLElement | null = null;
    private bodyEl: HTMLElement | null = null;
    private drawerEl: HTMLElement | null = null;
    private drawerContentEl: HTMLElement | null = null;
    private drawerToggleBtn: HTMLElement | null = null;
    // Drawer starts collapsed: the cards are too cramped at the default modal
    // width when the 320px drawer eats half the row. Users discover details via
    // the per-card 'i' info button (Model Info modal); the drawer toggle in
    // the modal header lets them switch to the passive-panel layout.
    private drawerCollapsedByUser = true;
    private focusedRepo: string | null = null;
    private focusDebounceTimeout: ReturnType<typeof setTimeout> | null = null;

    /**
     * @param initialTaskFilter Pre-select a task tab when opening (e.g.
     * from the wizard's Vision step so users land on vision-only results).
     * Defaults to "" which shows all tasks.
     * @param initialTab Pre-select one of the top-level catalog tabs. When
     * omitted, the modal restores the user's last-used tab from settings.
     */
    constructor(app: App, plugin: LilbeePlugin, initialTaskFilter: TaskFilter = "", initialTab?: CatalogTab) {
        super(app);
        this.plugin = plugin;
        this.filterTask = initialTaskFilter;
        this.activeTab = initialTab ?? plugin.settings.lastCatalogTab ?? CATALOG_TAB.DISCOVER;
        if (initialTab === undefined && initialTaskFilter !== "") {
            this.activeTab = taskToTabId(initialTaskFilter as ModelTask);
        }
        const searchDebounced = debounce(() => this.resetAndFetch(), DEBOUNCE_MS);
        this.debouncedSearch = searchDebounced.run;
        this.cancelDebouncedSearch = searchDebounced.cancel;
        bindEscapeToClose(this);
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("lilbee-catalog-modal");

        contentEl.createEl("h2", { text: MESSAGES.TITLE_MODEL_CATALOG });
        this.renderMainTabBar(contentEl);
        this.renderSubTabBar(contentEl);
        this.renderFilterBar(contentEl);

        this.bodyEl = contentEl.createDiv({ cls: "lilbee-catalog-body lilbee-catalog-body-with-drawer" });
        this.resultsEl = this.bodyEl.createDiv({ cls: "lilbee-catalog-results lilbee-catalog-tab-content" });
        this.resultsEl.addEventListener("scroll", this.onScroll);
        this.renderDrawer(this.bodyEl);
        this.bodyEl.addEventListener("focusin", this.onCardFocus);
        this.bodyEl.addEventListener("pointerover", this.onCardFocus);
        contentEl.addEventListener("keydown", this.onKeyDown);
        this.applyDrawerVisibility();

        this.applyTabToFilter();
        this.resetAndFetch();
    }

    private renderDrawer(parent: HTMLElement): void {
        this.drawerEl = parent.createDiv({ cls: "lilbee-catalog-drawer" });
        const header = this.drawerEl.createDiv({ cls: "lilbee-catalog-drawer-header" });
        this.drawerToggleBtn = header.createEl("button", {
            cls: "lilbee-catalog-drawer-toggle",
            text: MESSAGES.BUTTON_DRAWER_TOGGLE,
        });
        this.drawerToggleBtn.addEventListener("click", () => this.toggleDrawer());
        this.drawerContentEl = this.drawerEl.createDiv({ cls: "lilbee-catalog-drawer-content" });
        this.drawerContentEl.createEl("p", {
            cls: "lilbee-catalog-drawer-empty",
            text: MESSAGES.LABEL_DRAWER_NO_SELECTION,
        });
    }

    private toggleDrawer(): void {
        this.drawerCollapsedByUser = !this.drawerCollapsedByUser;
        this.applyDrawerVisibility();
    }

    private applyDrawerVisibility(): void {
        /* v8 ignore next 2 */
        if (!this.drawerEl || !this.bodyEl) return;
        const narrow = typeof window !== "undefined" && window.innerWidth < DRAWER_BREAKPOINT_PX;
        const collapsed = narrow || this.drawerCollapsedByUser;
        this.drawerEl.toggleClass("lilbee-catalog-drawer-collapsed", collapsed);
        this.bodyEl.toggleClass("lilbee-catalog-body-with-drawer", !collapsed);
    }

    private onCardFocus = (e: Event): void => {
        const card = findCardElement(e.target);
        if (!card) return;
        const repo = card.dataset.repo;
        if (!repo || repo === this.focusedRepo) return;
        if (this.focusDebounceTimeout !== null) clearTimeout(this.focusDebounceTimeout);
        this.focusDebounceTimeout = setTimeout(() => {
            this.focusedRepo = repo;
            this.updateDrawerForRepo(repo);
        }, DRAWER_FOCUS_DEBOUNCE_MS);
    };

    private updateDrawerForRepo(repo: string): void {
        /* v8 ignore next 2 */
        if (!this.drawerContentEl) return;
        const entry = this.entries.find((e) => e.hf_repo === repo);
        if (!entry) return;
        renderModelDetail(entry, this.drawerContentEl);
    }

    private focusedEntry(): CatalogEntry | null {
        if (this.focusedRepo === null) return null;
        return this.entries.find((e) => e.hf_repo === this.focusedRepo) ?? null;
    }

    private renderMainTabBar(parent: HTMLElement): void {
        this.mainTabBarEl = parent.createDiv({ cls: "lilbee-catalog-tab-bar lilbee-catalog-main-tab-bar" });
        for (const spec of TAB_SPECS) {
            const btn = this.mainTabBarEl.createEl("button", { cls: "lilbee-catalog-tab" });
            btn.dataset.tabId = spec.id;
            btn.createSpan({ text: spec.label });
            btn.setAttribute("aria-selected", spec.id === this.activeTab ? "true" : "false");
            if (spec.id === this.activeTab) btn.addClass("lilbee-catalog-tab-active");
            btn.addEventListener("click", () => this.switchMainTab(spec.id));
        }
    }

    private switchMainTab(tab: CatalogTab): void {
        if (this.activeTab === tab) return;
        this.activeTab = tab;
        if (this.mainTabBarEl) {
            for (const btn of Array.from(this.mainTabBarEl.children) as HTMLElement[]) {
                const isActive = btn.dataset.tabId === tab;
                btn.toggleClass("lilbee-catalog-tab-active", isActive);
                btn.setAttribute("aria-selected", isActive ? "true" : "false");
            }
        }
        this.plugin.settings.lastCatalogTab = tab;
        void this.plugin.saveSettings();
        // Reset to the local sub-tab when leaving a task tab — frontier state shouldn't persist.
        this.currentTab = CATALOG_SOURCE.LOCAL;
        this.applyTabToFilter();
        this.updateSubTabBarVisibility();
        this.resetAndFetch();
    }

    private applyTabToFilter(): void {
        const task = tabIdToTask(this.activeTab);
        this.filterTask = task ?? "";
    }

    private renderSubTabBar(parent: HTMLElement): void {
        this.subTabBarEl = parent.createDiv({ cls: "lilbee-catalog-tab-bar lilbee-catalog-sub-tab-bar" });
        const localBtn = this.subTabBarEl.createEl("button", {
            text: MESSAGES.TAB_LOCAL,
            cls: "lilbee-catalog-tab lilbee-catalog-tab-active",
        });
        localBtn.setAttribute("aria-selected", "true");
        localBtn.addEventListener("click", () => this.switchSubTab(CATALOG_SOURCE.LOCAL));

        this.frontierTabBtn = this.subTabBarEl.createEl("button", {
            text: MESSAGES.TAB_FRONTIER,
            cls: "lilbee-catalog-tab",
        });
        this.frontierTabBtn.setAttribute("aria-selected", "false");
        this.frontierTabBtn.style.display = "none";
        this.frontierTabBtn.addEventListener("click", () => this.switchSubTab(CATALOG_SOURCE.FRONTIER));
        this.updateSubTabBarVisibility();
    }

    private updateSubTabBarVisibility(): void {
        /* v8 ignore next 2 */
        if (!this.subTabBarEl) return;
        const showSubTabs = tabIdToTask(this.activeTab) !== null;
        this.subTabBarEl.style.display = showSubTabs ? "" : "none";
    }

    private switchSubTab(tab: CatalogSource): void {
        if (this.currentTab === tab) return;
        this.currentTab = tab;
        /* v8 ignore next 2 */
        if (!this.subTabBarEl) return;
        for (const btn of Array.from(this.subTabBarEl.children) as HTMLElement[]) {
            const isActive =
                (tab === CATALOG_SOURCE.LOCAL && btn.textContent === MESSAGES.TAB_LOCAL) ||
                (tab === CATALOG_SOURCE.FRONTIER && btn.textContent === MESSAGES.TAB_FRONTIER);
            btn.toggleClass("lilbee-catalog-tab-active", isActive);
            btn.setAttribute("aria-selected", isActive ? "true" : "false");
        }
        this.renderResults();
    }

    private updateFrontierTabVisibility(): void {
        /* v8 ignore next 2 */
        if (!this.frontierTabBtn) return;
        const showFrontier = tabIdToTask(this.activeTab) !== null && hasReadyFrontierRow(this.entries);
        if (showFrontier) {
            this.frontierTabBtn.style.display = "";
            return;
        }
        this.frontierTabBtn.style.display = "none";
        // Bounce the user home if a refetch revoked the only ready frontier row.
        if (this.currentTab === CATALOG_SOURCE.FRONTIER) this.switchSubTab(CATALOG_SOURCE.LOCAL);
    }

    onClose(): void {
        this.cancelDebouncedSearch();
        this.resultsEl?.removeEventListener("scroll", this.onScroll);
        this.bodyEl?.removeEventListener("focusin", this.onCardFocus);
        this.bodyEl?.removeEventListener("pointerover", this.onCardFocus);
        this.contentEl.removeEventListener("keydown", this.onKeyDown);
        if (this.focusDebounceTimeout !== null) {
            clearTimeout(this.focusDebounceTimeout);
            this.focusDebounceTimeout = null;
        }
    }

    private onScroll = (): void => {
        if (!this.resultsEl || this.isFetching || !this.hasMore) return;
        const { scrollTop, clientHeight, scrollHeight } = this.resultsEl;
        if (scrollTop + clientHeight >= scrollHeight - SCROLL_BOTTOM_THRESHOLD_PX) {
            void this.fetchPage();
        }
    };

    private onKeyDown = (e: KeyboardEvent): void => {
        if (e.key === "i" && !isTextInputTarget(e.target)) {
            const entry = this.focusedEntry();
            if (entry) {
                e.preventDefault();
                e.stopPropagation();
                new ModelInfoModal(this.app, this.plugin, entry).open();
            }
        }
    };

    private renderFilterBar(parent: HTMLElement): void {
        const filters = parent.createDiv({ cls: "lilbee-catalog-filters" });

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
        this.entries = [];
        if (this.resultsEl) this.resultsEl.empty();
        void this.fetchPage();
    }

    private async fetchPage(): Promise<void> {
        if (this.isFetching) return;
        this.isFetching = true;
        const params: Parameters<typeof this.plugin.api.catalog>[0] = {
            limit: PAGE_SIZE,
            offset: this.offset,
            sort: this.filterSort,
        };
        if (this.filterTask) params.task = this.filterTask as ModelTask;
        if (this.filterSize) params.size = this.filterSize as ModelSize;
        if (this.filterSearch) params.search = this.filterSearch;

        try {
            const result = await this.plugin.api.catalog(params);
            if (result.isErr()) {
                new Notice(noticeForResultError(result.error, MESSAGES.ERROR_LOAD_CATALOG));
                return;
            }

            const response = result.value;
            this.hasMore = response.has_more;
            // Defensive client-side task filter — older server builds and some
            // frontier providers tag rows loosely, leaking embedding/vision
            // models into the chat tab and vice versa.
            const filtered = this.filterTask
                ? response.models.filter((m) => m.task === this.filterTask)
                : response.models;
            this.entries.push(...filtered);
            this.offset += response.models.length;

            this.updateFrontierTabVisibility();
            this.renderResults();
        } finally {
            this.isFetching = false;
        }
    }

    private renderResults(): void {
        if (!this.resultsEl) return;
        this.resultsEl.empty();

        if (this.activeTab === CATALOG_TAB.DISCOVER) {
            this.renderDiscoverTab();
            return;
        }
        if (this.activeTab === CATALOG_TAB.LIBRARY) {
            this.renderLibraryTab();
            return;
        }

        if (this.currentTab === CATALOG_SOURCE.FRONTIER) {
            this.renderFrontierResults();
            return;
        }
        this.renderTaskTabLocal();
    }

    private renderTaskTabLocal(): void {
        /* v8 ignore next 2 */
        if (!this.resultsEl) return;
        const localEntries = localRowsOnly(this.entries);
        if (localEntries.length === 0) {
            this.resultsEl.createDiv({
                cls: "lilbee-catalog-empty",
                text: MESSAGES.LABEL_NO_MODELS_FOUND,
            });
            return;
        }
        if (this.viewMode === CATALOG_VIEW_MODE.GRID) {
            this.renderGridView(localEntries);
        } else {
            this.renderListView(localEntries);
        }
    }

    private renderDiscoverTab(): void {
        /* v8 ignore next 2 */
        if (!this.resultsEl) return;
        const activeChatRef = extractHfRepo(this.plugin.activeModel);
        const rails: RailSpec[] = [
            {
                heading: MESSAGES.RAIL_FOR_YOU,
                help: MESSAGES.RAIL_FOR_YOU_HELP,
                rows: forYouRail(this.entries, activeChatRef),
            },
            {
                heading: MESSAGES.RAIL_YOUR_COLLECTION,
                help: MESSAGES.RAIL_YOUR_COLLECTION_HELP,
                rows: yourCollectionRail(this.entries),
            },
            {
                heading: MESSAGES.RAIL_FRESH,
                help: MESSAGES.RAIL_FRESH_HELP,
                rows: freshRail(this.entries),
            },
        ];
        for (const rail of rails) {
            this.renderRail(rail);
        }
    }

    private renderRail(rail: RailSpec): void {
        /* v8 ignore next 2 */
        if (!this.resultsEl) return;
        const railEl = this.resultsEl.createDiv({ cls: "lilbee-discover-rail" });
        const heading = railEl.createDiv({ cls: "lilbee-discover-rail-heading" });
        heading.createSpan({ text: rail.heading });
        heading.createSpan({ cls: "lilbee-discover-rail-heading-help", text: rail.help });
        const cards = railEl.createDiv({ cls: "lilbee-discover-rail-cards" });
        if (rail.rows.length === 0) {
            cards.createDiv({ cls: "lilbee-discover-rail-empty", text: MESSAGES.RAIL_NO_ITEMS });
            return;
        }
        for (const entry of rail.rows) {
            this.renderCard(cards, entry);
        }
    }

    private renderLibraryTab(): void {
        /* v8 ignore next 2 */
        if (!this.resultsEl) return;
        const installed = this.entries.filter((e) => e.installed);
        if (installed.length === 0) {
            this.resultsEl.createDiv({
                cls: "lilbee-catalog-empty",
                text: MESSAGES.LABEL_NO_MODELS_FOUND,
            });
            return;
        }
        if (this.viewMode === CATALOG_VIEW_MODE.GRID) {
            this.renderGridView(installed);
        } else {
            this.renderListView(installed);
        }
    }

    private renderFrontierResults(): void {
        /* v8 ignore next 2 */
        if (!this.resultsEl) return;
        // Sub-toggle is only visible on task tabs, so taskForTab is always non-null here.
        const taskForTab = tabIdToTask(this.activeTab);
        const allFrontier = frontierRowsOnly(this.entries);
        /* v8 ignore next 2 */
        const rows = taskForTab === null ? allFrontier : allFrontier.filter((r) => r.task === taskForTab);
        if (rows.length === 0) {
            this.resultsEl.createDiv({
                cls: "lilbee-catalog-empty",
                text: MESSAGES.LABEL_NO_MODELS_FOUND,
            });
            return;
        }
        for (const [provider, group] of groupByProvider(rows)) {
            this.resultsEl.createDiv({ cls: "lilbee-catalog-section-heading", text: provider });
            const list = this.resultsEl.createDiv({ cls: "lilbee-catalog-frontier-list" });
            for (const row of group) {
                this.renderFrontierRow(list, row);
            }
        }
    }

    private renderFrontierRow(parent: HTMLElement, row: CatalogEntry): void {
        const rowEl = parent.createDiv({ cls: "lilbee-frontier-row" });
        const nameEl = rowEl.createSpan({ cls: "lilbee-frontier-row-name", text: row.display_name });
        const provider = (row as CatalogEntry & { provider?: string }).provider ?? "";
        const keyStatus = (row as CatalogEntry & { key_status?: KeyStatus }).key_status ?? KEY_STATUS.MISSING_KEY;
        renderProviderPill(nameEl, provider);
        renderKeyStatusPill(nameEl, keyStatus);
        rowEl.addEventListener("click", () => {
            if (keyStatus === KEY_STATUS.MISSING_KEY) {
                this.close();
                deepLinkToApiKeySettings(this.app, provider);
                return;
            }
            void this.handleUseFrontier(row);
        });
    }

    private async handleUseFrontier(row: CatalogEntry): Promise<void> {
        const result = await this.setActiveFor(row);
        if (result.isErr()) {
            new Notice(noticeForResultError(result.error, MESSAGES.ERROR_SET_MODEL.replace("{model}", row.hf_repo)));
            return;
        }
        this.plugin.fetchActiveModel();
        this.plugin.refreshSettingsTab();
        new Notice(MESSAGES.NOTICE_MODEL_ACTIVATED(this.activatedRefFor(row)));
        this.close();
    }

    private renderGridView(entries: CatalogEntry[]): void {
        if (!this.resultsEl) return;
        const picks = entries.filter((e) => e.featured);
        const installed = entries.filter((e) => !e.featured && e.installed);
        const rest = entries.filter((e) => !e.featured && !e.installed);

        if (picks.length > 0)
            this.renderSection(MESSAGES.LABEL_OUR_PICKS, picks, "lilbee-catalog-section-heading-featured");
        if (installed.length > 0) this.renderSection(MESSAGES.LABEL_SECTION_INSTALLED, installed);

        for (const [task, group] of this.groupByTask(rest)) {
            this.renderSection(TASK_SECTION_LABEL[task] ?? task, group);
        }

        this.renderViewToggleCta();
    }

    private groupByTask(entries: CatalogEntry[]): [ModelTask, CatalogEntry[]][] {
        const groups = new Map<ModelTask, CatalogEntry[]>();
        for (const entry of entries) {
            const group = groups.get(entry.task);
            if (group) {
                group.push(entry);
            } else {
                groups.set(entry.task, [entry]);
            }
        }
        return [...groups.entries()];
    }

    private renderSection(heading: string, entries: CatalogEntry[], headingCls?: string): void {
        if (!this.resultsEl) return;
        const headingEl = this.resultsEl.createDiv({
            cls: "lilbee-catalog-section-heading",
            text: heading,
        });
        if (headingCls) headingEl.addClass(headingCls);
        const grid = this.resultsEl.createDiv({ cls: "lilbee-catalog-grid" });
        for (const entry of entries) {
            this.renderCard(grid, entry);
        }
    }

    private renderCard(container: HTMLElement, entry: CatalogEntry): void {
        const isActive = this.isActiveEntry(entry);
        renderModelCard(container, entry, {
            showActions: true,
            isActive,
            onPull: (e) => this.handlePull(e),
            onUse: (e, btn) => this.handleUse(e, btn),
            onRemove: (e, btn) => this.handleRemove(e, btn),
            onInfo: (e) => new ModelInfoModal(this.app, this.plugin, e).open(),
        });
    }

    private isActiveEntry(entry: CatalogEntry): boolean {
        return extractHfRepo(this.plugin.activeModel) === entry.hf_repo;
    }

    private renderViewToggleCta(): void {
        if (!this.resultsEl) return;
        const cta = this.resultsEl.createDiv({ cls: "lilbee-view-toggle-cta" });
        cta.createEl("span", { text: MESSAGES.LABEL_VIEW_TOGGLE_CTA });
        const btn = cta.createEl("button", { text: MESSAGES.LABEL_SWITCH_TO_LIST });
        btn.addEventListener("click", () => this.toggleView());
    }

    private renderListView(entries: CatalogEntry[]): void {
        if (!this.resultsEl) return;
        const listEl = this.resultsEl.createDiv({ cls: "lilbee-catalog-list" });

        this.renderListHeader(listEl);

        const sorted = this.sortEntries(entries);
        for (const entry of sorted) {
            this.renderListRow(listEl, entry);
        }
    }

    private renderListHeader(listEl: HTMLElement): void {
        const header = listEl.createDiv({ cls: "lilbee-catalog-list-header" });
        const cols = [
            { key: "name", label: MESSAGES.LABEL_NAME, cls: "lilbee-catalog-list-col-name" },
            { key: "task", label: MESSAGES.LABEL_TASK, cls: "lilbee-catalog-list-col-task" },
            { key: "size", label: MESSAGES.LABEL_SIZE, cls: "lilbee-catalog-list-col-size" },
            { key: "downloads", label: MESSAGES.LABEL_DOWNLOADS, cls: "lilbee-catalog-list-col-downloads" },
            { key: "action", label: "", cls: "lilbee-catalog-list-col-action" },
        ];
        for (const col of cols) {
            const el = header.createEl("span", { text: col.label, cls: col.cls });
            if (col.key !== "action") {
                el.addEventListener("click", () => this.handleSort(col.key));
            }
        }
    }

    private renderListRow(listEl: HTMLElement, entry: CatalogEntry): void {
        const row = listEl.createDiv({ cls: "lilbee-catalog-list-row" });
        const nameText = entry.featured ? `★ ${entry.display_name}` : entry.display_name;
        row.createEl("span", { text: nameText, cls: "lilbee-catalog-list-col-name" });
        row.createEl("span", { text: entry.task, cls: "lilbee-catalog-list-col-task" });
        row.createEl("span", { text: `${entry.size_gb} GB`, cls: "lilbee-catalog-list-col-size" });
        row.createEl("span", {
            text: formatAbbreviatedCount(entry.downloads),
            cls: "lilbee-catalog-list-col-downloads",
        });

        const actionEl = row.createDiv({ cls: "lilbee-catalog-list-col-action" });
        const isActive = this.isActiveEntry(entry);

        if (isActive) {
            actionEl.createEl("span", { text: MESSAGES.LABEL_ACTIVE, cls: "lilbee-catalog-active" });
        } else if (entry.installed) {
            const useBtn = actionEl.createEl("button", { text: MESSAGES.BUTTON_USE, cls: "lilbee-catalog-use" });
            useBtn.addEventListener("click", () => this.handleUse(entry, useBtn));
            const removeBtn = actionEl.createEl("button", {
                text: MESSAGES.BUTTON_REMOVE,
                cls: "lilbee-catalog-remove",
            });
            removeBtn.addEventListener("click", () => this.handleRemove(entry, removeBtn));
        } else {
            const pullBtn = actionEl.createEl("button", { text: MESSAGES.BUTTON_PULL, cls: "lilbee-catalog-pull" });
            pullBtn.addEventListener("click", () => this.handlePull(entry));
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

    private sortEntries(entries: CatalogEntry[]): CatalogEntry[] {
        if (!this.sortColumn) return entries;
        const sorted = [...entries];
        const dir = this.sortAscending ? 1 : -1;
        sorted.sort((a, b) => {
            const va = this.getSortValue(a, this.sortColumn);
            const vb = this.getSortValue(b, this.sortColumn);
            if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
            return String(va).localeCompare(String(vb)) * dir;
        });
        return sorted;
    }

    private getSortValue(entry: CatalogEntry, column: string): string | number {
        switch (column) {
            case "name":
                return entry.display_name;
            case "task":
                return entry.task;
            case "size":
                return entry.size_gb;
            case "downloads":
                return entry.downloads;
            default:
                return "";
        }
    }

    private handleRemove(entry: CatalogEntry, btn: HTMLElement): void {
        const confirmModal = new ConfirmModal(this.app, MESSAGES.NOTICE_CONFIRM_REMOVE(entry.hf_repo));
        confirmModal.open();
        void confirmModal.result.then((confirmed) => {
            if (!confirmed) return;
            void this.executeRemove(entry, btn);
        });
    }

    private async executeRemove(entry: CatalogEntry, btn: HTMLElement): Promise<void> {
        const taskId = this.plugin.taskQueue.enqueue(`Remove ${entry.hf_repo}`, TASK_TYPE.DELETE);
        if (taskId === null) {
            new Notice(MESSAGES.NOTICE_QUEUE_FULL);
            return;
        }
        btn.textContent = MESSAGES.STATUS_REMOVING;
        (btn as HTMLButtonElement).disabled = true;
        this.plugin.taskQueue.update(taskId, -1, entry.hf_repo);

        const result = await this.plugin.api.deleteModel(entry.hf_repo, entry.source);
        if (result.isErr()) {
            new Notice(
                noticeForResultError(result.error, MESSAGES.ERROR_REMOVE_MODEL.replace("{model}", entry.hf_repo)),
            );
            this.plugin.taskQueue.fail(taskId, errorMessage(result.error, result.error.message));
            btn.textContent = MESSAGES.BUTTON_REMOVE;
            (btn as HTMLButtonElement).disabled = false;
            return;
        }

        this.plugin.taskQueue.complete(taskId);
        new Notice(MESSAGES.NOTICE_REMOVED(entry.hf_repo));
        this.plugin.fetchActiveModel();
        this.resetAndFetch();
    }

    private async handleUse(entry: CatalogEntry, btn: HTMLElement): Promise<void> {
        btn.textContent = MESSAGES.STATUS_SETTING;
        (btn as HTMLButtonElement).disabled = true;

        const result = await this.setActiveFor(entry);

        if (result.isErr()) {
            new Notice(noticeForResultError(result.error, MESSAGES.ERROR_SET_MODEL.replace("{model}", entry.hf_repo)));
            btn.textContent = MESSAGES.BUTTON_USE;
            (btn as HTMLButtonElement).disabled = false;
            return;
        }

        this.plugin.fetchActiveModel();
        this.plugin.refreshSettingsTab();
        new Notice(MESSAGES.NOTICE_MODEL_ACTIVATED(this.activatedRefFor(entry)));
        this.resetAndFetch();
    }

    /** Identifier to surface in user-facing toasts. */
    private activatedRefFor(entry: CatalogEntry): string {
        return entry.display_name;
    }

    private async setActiveFor(entry: CatalogEntry): ReturnType<typeof this.plugin.api.setChatModel> {
        if (entry.task === MODEL_TASK.EMBEDDING) {
            return this.plugin.api.setEmbeddingModel(entry.hf_repo);
        }
        if (entry.task === MODEL_TASK.RERANK) {
            return this.plugin.api.setRerankerModel(entry.hf_repo);
        }
        if (entry.task === MODEL_TASK.VISION) {
            return this.plugin.api.setVisionModel(entry.hf_repo);
        }
        const result = await this.plugin.api.setChatModel(entry.hf_repo);
        if (result.isOk()) this.plugin.activeModel = entry.hf_repo;
        return result;
    }

    private handlePull(entry: CatalogEntry): void {
        const confirmModal = new ConfirmPullModal(this.app, {
            displayName: entry.display_name,
            sizeGb: entry.size_gb,
            minRamGb: entry.min_ram_gb,
            systemMemGb: getRelevantSystemMemoryGB(this.plugin.settings.serverMode),
        });
        confirmModal.open();
        void confirmModal.result.then((confirmed) => {
            if (!confirmed) return;
            void this.executePull(entry);
        });
    }

    private async executePull(entry: CatalogEntry): Promise<void> {
        const taskId = this.plugin.taskQueue.enqueue(`Pull ${entry.hf_repo}`, TASK_TYPE.PULL);
        if (taskId === null) {
            new Notice(MESSAGES.NOTICE_QUEUE_FULL);
            return;
        }
        const controller = new AbortController();
        this.plugin.taskQueue.registerAbort(taskId, controller);
        const pullErrorPrefix = MESSAGES.ERROR_PULL_MODEL.replace("{model}", entry.hf_repo);

        try {
            for await (const event of this.plugin.api.pullModel(entry.hf_repo, "native", controller.signal)) {
                if (event.event === SSE_EVENT.PROGRESS) {
                    const d = event.data as { percent?: number; current?: number; total?: number };
                    const pct = percentFromSse(d);
                    if (pct !== undefined) {
                        this.plugin.taskQueue.update(taskId, pct, entry.hf_repo, {
                            current: d.current,
                            total: d.total,
                        });
                    }
                } else if (event.event === SSE_EVENT.ERROR) {
                    const d = event.data as { message?: string } | string;
                    const msg = extractSseErrorMessage(d, MESSAGES.ERROR_UNKNOWN);
                    new Notice(`${pullErrorPrefix}: ${msg}`);
                    this.plugin.taskQueue.fail(taskId, msg);
                    return;
                }
            }
        } catch (err) {
            if (err instanceof Error && err.name === ERROR_NAME.ABORT_ERROR) {
                new Notice(MESSAGES.NOTICE_PULL_CANCELLED);
                this.plugin.taskQueue.cancel(taskId);
            } else {
                const msg = errorMessage(err, MESSAGES.ERROR_UNKNOWN);
                new Notice(`${pullErrorPrefix}: ${msg}`);
                this.plugin.taskQueue.fail(taskId, msg);
            }
            return;
        }

        this.plugin.taskQueue.complete(taskId);

        const result = await this.setActiveFor(entry);
        if (result.isErr()) {
            new Notice(noticeForResultError(result.error, MESSAGES.ERROR_SET_MODEL.replace("{model}", entry.hf_repo)));
            this.plugin.fetchActiveModel();
            this.resetAndFetch();
            return;
        }

        this.plugin.fetchActiveModel();
        this.plugin.refreshSettingsTab();
        new Notice(MESSAGES.NOTICE_MODEL_ACTIVATED_FULL(this.activatedRefFor(entry)));
        this.resetAndFetch();
    }
}

function findCardElement(target: EventTarget | null): HTMLElement | null {
    let el = target as (HTMLElement & { dataset?: Record<string, string> }) | null;
    while (el) {
        if (el.dataset?.repo) return el;
        el = (el.parentElement ?? null) as (HTMLElement & { dataset?: Record<string, string> }) | null;
    }
    return null;
}

function isTextInputTarget(target: EventTarget | null): boolean {
    const el = target as { tagName?: string } | null;
    if (!el?.tagName) return false;
    const tag = el.tagName;
    return tag === "INPUT" || tag === "TEXTAREA";
}
