import { App, Modal, Notice } from "obsidian";
import type LilbeePlugin from "../main";
import type { ModelFamily, SSEEvent, SyncDone } from "../types";
import { SERVER_MODE, SERVER_STATE, SSE_EVENT, WIZARD_STEP, ERROR_NAME, MODEL_TASK } from "../types";
import { CatalogModal } from "./catalog-modal";
import { MESSAGES, FILTERS } from "../locales/en";
import { renderModelCard } from "../components/model-card";

interface FeaturedModel {
    name: string;
    size_gb: number;
    min_ram_gb: number;
    description: string;
    source: "native" | "litellm";
    displayName?: string;
}

export function getSystemMemoryGB(): number | null {
    try {
        const os = require("os") as { totalmem(): number };
        return Math.round(os.totalmem() / (1024 * 1024 * 1024));
        /* v8 ignore next 3 */
    } catch {
        return null;
    }
}

export function recommendedIndex(models: FeaturedModel[], memGB: number | null): number {
    if (memGB === null || models.length === 0) return 0;
    let best = 0;
    let bestRam = 0;
    for (let i = 0; i < models.length; i++) {
        if (models[i].min_ram_gb <= memGB && models[i].min_ram_gb >= bestRam) {
            best = i;
            bestRam = models[i].min_ram_gb;
        }
    }
    return best;
}

export class SetupWizard extends Modal {
    private plugin: LilbeePlugin;
    private step = 0;
    private selectedModel: FeaturedModel | null = null;
    private featuredModels: FeaturedModel[] = [];
    private pullController: AbortController | null = null;
    private syncController: AbortController | null = null;
    private syncResult: SyncDone | null = null;
    private pulledModelName = "";

    constructor(app: App, plugin: LilbeePlugin) {
        super(app);
        this.plugin = plugin;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("lilbee-wizard");
        this.renderStep();
    }

    onClose(): void {
        this.pullController?.abort();
        this.syncController?.abort();
    }

    private renderStep(): void {
        const { contentEl } = this;
        contentEl.empty();

        switch (this.step) {
            case WIZARD_STEP.WELCOME:
                this.renderWelcome();
                break;
            case WIZARD_STEP.SERVER_MODE:
                this.renderServerMode();
                break;
            case WIZARD_STEP.MODEL_PICKER:
                this.renderModelPicker();
                break;
            case WIZARD_STEP.SYNC:
                this.renderSync();
                break;
            case WIZARD_STEP.DONE:
                this.renderDone();
                break;
        }
    }

    private renderWelcome(): void {
        const { contentEl } = this;
        const step = contentEl.createDiv({ cls: "lilbee-wizard-step" });

        step.createEl("h2", { text: MESSAGES.TITLE_WELCOME });
        step.createEl("p", { text: MESSAGES.WIZARD_INTRO_DESC });

        step.createEl("p", { text: MESSAGES.WIZARD_INTRO_STEPS });
        const ul = step.createEl("ul");
        ul.createEl("li", { text: MESSAGES.WIZARD_STEP_CHOOSE_MODEL });
        ul.createEl("li", { text: MESSAGES.WIZARD_STEP_INDEX });

        step.createEl("p", { text: MESSAGES.WIZARD_LOCAL_ONLY });

        const actions = step.createDiv({ cls: "lilbee-wizard-actions" });
        const skipBtn = actions.createEl("button", { text: MESSAGES.BUTTON_SKIP_SETUP });
        skipBtn.addEventListener("click", () => this.skip());

        const startBtn = actions.createEl("button", { text: MESSAGES.BUTTON_GET_STARTED, cls: "mod-cta" });
        startBtn.addEventListener("click", () => this.next());
    }

    private renderServerMode(): void {
        const { contentEl } = this;
        const step = contentEl.createDiv({ cls: "lilbee-wizard-step" });

        step.createEl("h2", { text: MESSAGES.TITLE_SERVER_MODE });

        let mode: "managed" | "external" =
            this.plugin.settings.serverMode === SERVER_MODE.EXTERNAL ? SERVER_MODE.EXTERNAL : SERVER_MODE.MANAGED;

        const managedOption = step.createDiv({
            cls: `lilbee-wizard-model-option${mode === SERVER_MODE.MANAGED ? " selected" : ""}`,
        });
        managedOption.createEl("strong", { text: MESSAGES.TITLE_MANAGED_RECOMMENDED });
        managedOption.createEl("p", { text: MESSAGES.WIZARD_MANAGED_DESC });

        const externalOption = step.createDiv({
            cls: `lilbee-wizard-model-option${mode === SERVER_MODE.EXTERNAL ? " selected" : ""}`,
        });
        externalOption.createEl("strong", { text: MESSAGES.TITLE_EXTERNAL });
        externalOption.createEl("p", { text: MESSAGES.WIZARD_EXTERNAL_DESC });

        const urlInput = step.createEl("input", {
            cls: "lilbee-wizard-url-input",
            placeholder: MESSAGES.PLACEHOLDER_HTTP_LOCALHOST,
            attr: { type: "text" },
        });
        urlInput.value = this.plugin.settings.serverUrl;
        urlInput.style.display = mode === SERVER_MODE.EXTERNAL ? "" : "none";

        const statusEl = step.createDiv({ cls: "lilbee-wizard-status" });

        managedOption.addEventListener("click", () => {
            mode = SERVER_MODE.MANAGED;
            managedOption.classList.add("selected");
            externalOption.classList.remove("selected");
            urlInput.style.display = "none";
            statusEl.textContent = "";
        });

        externalOption.addEventListener("click", () => {
            mode = SERVER_MODE.EXTERNAL;
            externalOption.classList.add("selected");
            managedOption.classList.remove("selected");
            urlInput.style.display = "";
        });

        const actions = step.createDiv({ cls: "lilbee-wizard-actions" });
        const backBtn = actions.createEl("button", { text: MESSAGES.BUTTON_BACK });
        backBtn.addEventListener("click", () => this.back());
        const skipBtn = actions.createEl("button", { text: MESSAGES.BUTTON_SKIP_SETUP });
        skipBtn.addEventListener("click", () => this.skip());

        const nextBtn = actions.createEl("button", { text: MESSAGES.BUTTON_NEXT, cls: "mod-cta" });
        nextBtn.addEventListener("click", () => {
            if (mode === SERVER_MODE.MANAGED) {
                this.plugin.settings.serverMode = SERVER_MODE.MANAGED;
                statusEl.textContent = MESSAGES.STATUS_STARTING_SERVER;
                statusEl.classList.add("lilbee-loading");
                nextBtn.disabled = true;
                void this.startManagedAndAdvance(statusEl, nextBtn);
            } else {
                this.plugin.settings.serverUrl = String(urlInput.value || "").trim() || "http://127.0.0.1:7433";
                this.plugin.settings.serverMode = SERVER_MODE.EXTERNAL;
                statusEl.textContent = MESSAGES.STATUS_CHECKING_CONNECTION;
                nextBtn.disabled = true;
                void this.checkExternalAndAdvance(statusEl, nextBtn);
            }
        });
    }

    private async startManagedAndAdvance(statusEl: HTMLElement, nextBtn: HTMLElement): Promise<void> {
        try {
            await this.plugin.saveSettings();
            if (!this.plugin.serverManager) {
                await this.plugin.startManagedServer();
            }
            statusEl.textContent = "";
            statusEl.classList.remove("lilbee-loading");
            this.step = WIZARD_STEP.MODEL_PICKER;
            this.renderStep();
        } catch {
            statusEl.textContent = MESSAGES.ERROR_START_SERVER;
            statusEl.classList.remove("lilbee-loading");
            (nextBtn as HTMLButtonElement).disabled = false;
        }
    }

    private async checkExternalAndAdvance(statusEl: HTMLElement, nextBtn: HTMLElement): Promise<void> {
        try {
            await this.plugin.saveSettings();
            const result = await this.plugin.api.health();
            if (result.isErr()) throw result.error;
            statusEl.textContent = "";
            this.step = WIZARD_STEP.MODEL_PICKER;
            this.renderStep();
        } catch {
            statusEl.textContent = MESSAGES.ERROR_COULD_NOT_CONNECT_EXT;
            (nextBtn as HTMLButtonElement).disabled = false;
        }
    }

    private renderModelPicker(): void {
        const { contentEl } = this;
        const step = contentEl.createDiv({ cls: "lilbee-wizard-step" });

        step.createEl("h2", { text: MESSAGES.TITLE_PICK_MODEL });
        step.createEl("p", { text: MESSAGES.WIZARD_MODEL_HELP });

        const memGB = getSystemMemoryGB();
        if (memGB !== null) {
            step.createEl("p", {
                text: MESSAGES.WIZARD_SYSTEM_RAM.replace("{ram}", String(memGB)),
                cls: "lilbee-wizard-system-info",
            });
        }

        const modelsContainer = step.createDiv({ cls: "lilbee-wizard-models" });
        const statusEl = step.createDiv({ cls: "lilbee-wizard-status" });
        const progressEl = step.createDiv({ cls: "lilbee-wizard-progress" });
        progressEl.style.display = "none";
        const progressBar = progressEl.createDiv({ cls: "lilbee-progress-bar-container" });
        const progressFill = progressBar.createDiv({ cls: "lilbee-progress-bar" });
        const progressLabel = progressEl.createDiv({ cls: "lilbee-wizard-progress-label" });

        const actions = step.createDiv({ cls: "lilbee-wizard-actions" });
        const backBtn = actions.createEl("button", { text: MESSAGES.BUTTON_BACK });
        backBtn.addEventListener("click", () => {
            this.pullController?.abort();
            this.back();
        });
        const skipBtn = actions.createEl("button", { text: MESSAGES.BUTTON_SKIP_SETUP });
        skipBtn.addEventListener("click", () => {
            this.pullController?.abort();
            this.skip();
        });

        const catalogBtn = actions.createEl("button", { text: MESSAGES.BUTTON_BROWSE_FULL_CATALOG });
        catalogBtn.addEventListener("click", () => {
            new CatalogModal(this.app, this.plugin).open();
        });

        const downloadBtn = actions.createEl("button", { text: MESSAGES.BUTTON_DOWNLOAD_CONTINUE, cls: "mod-cta" });
        downloadBtn.addEventListener("click", () => {
            if (!this.selectedModel) {
                statusEl.textContent = MESSAGES.WIZARD_SELECT_MODEL;
                return;
            }
            downloadBtn.disabled = true;
            statusEl.textContent = "";
            void this.pullSelectedModel(downloadBtn, progressEl, progressFill, progressLabel, statusEl);
        });

        void this.loadFeaturedModels(modelsContainer, memGB, statusEl);
    }

    private async loadFeaturedModels(
        container: HTMLElement,
        memGB: number | null,
        statusEl: HTMLElement,
    ): Promise<void> {
        let families: ModelFamily[];
        try {
            const result = await this.plugin.api.catalog({
                task: MODEL_TASK.CHAT,
                featured: true,
                sort: FILTERS.SORT.FEATURED,
                limit: 4,
            });
            if (result.isErr()) {
                this.featuredModels = [];
                return;
            }
            families = result.value.families;
            this.featuredModels = families.map((f: ModelFamily) => {
                const v = f.variants.find((v) => v.name === f.recommended) ?? f.variants[0];
                return {
                    name: v.hf_repo,
                    size_gb: v.size_gb,
                    min_ram_gb: v.min_ram_gb,
                    description: v.description,
                    source: v.source,
                    displayName: f.family,
                };
            });
        } catch {
            this.featuredModels = [];
            statusEl.textContent = MESSAGES.ERROR_LOAD_MODELS;
            return;
        }

        const recommended = recommendedIndex(this.featuredModels, memGB);
        this.selectedModel = this.featuredModels[recommended] ?? null;

        container.createDiv({ cls: "lilbee-catalog-section-heading", text: MESSAGES.LABEL_OUR_PICKS });
        const grid = container.createDiv({ cls: "lilbee-catalog-grid" });

        for (let i = 0; i < families.length; i++) {
            const family = families[i];
            const variant = family.variants.find((v) => v.name === family.recommended) ?? family.variants[0];
            const model = this.featuredModels[i];
            renderModelCard(grid, family, variant, {
                isActive: i === recommended,
                onClick: () => this.selectModel(grid, model),
            });
        }
    }

    private selectModel(grid: HTMLElement, model: FeaturedModel): void {
        this.selectedModel = model;
        for (const child of Array.from(grid.children)) {
            const el = child as HTMLElement;
            if (el.dataset.repo === model.name) {
                el.classList.add("is-selected");
            } else {
                el.classList.remove("is-selected");
            }
        }
    }

    private async pullSelectedModel(
        downloadBtn: HTMLElement,
        progressEl: HTMLElement,
        progressFill: HTMLElement,
        progressLabel: HTMLElement,
        statusEl: HTMLElement,
    ): Promise<void> {
        if (!this.selectedModel) return;
        const model = this.selectedModel;
        progressEl.style.display = "";
        progressLabel.textContent = MESSAGES.STATUS_DOWNLOADING_MODEL.replace("{model}", model.name);
        this.pullController = new AbortController();

        try {
            for await (const event of this.plugin.api.pullModel(model.name, model.source, this.pullController.signal)) {
                if (event.event === SSE_EVENT.PROGRESS) {
                    const d = event.data as { current?: number; total?: number };
                    if (d.total && d.current !== undefined) {
                        const pct = Math.round((d.current / d.total) * 100);
                        progressFill.style.width = `${pct}%`;
                        progressLabel.textContent = MESSAGES.STATUS_DOWNLOADING_MODEL_PCT.replace(
                            "{model}",
                            model.name,
                        ).replace("{pct}", String(pct));
                    }
                }
            }

            await this.plugin.api.setChatModel(model.name);
            this.plugin.activeModel = model.name;
            this.plugin.fetchActiveModel();
            this.pulledModelName = model.name;
            this.step = WIZARD_STEP.SYNC;
            this.renderStep();
        } catch (err) {
            if (err instanceof Error && err.name === ERROR_NAME.ABORT_ERROR) {
                new Notice(MESSAGES.NOTICE_DOWNLOAD_CANCELLED);
            } else {
                statusEl.textContent = MESSAGES.ERROR_DOWNLOAD_FAILED;
            }
            progressEl.style.display = "none";
            (downloadBtn as HTMLButtonElement).disabled = false;
        } finally {
            this.pullController = null;
        }
    }

    private renderSync(): void {
        const { contentEl } = this;
        const step = contentEl.createDiv({ cls: "lilbee-wizard-step" });

        step.createEl("h2", { text: MESSAGES.TITLE_INDEX_VAULT });
        step.createEl("p", { text: MESSAGES.WIZARD_SYNC_HELP });

        const progressEl = step.createDiv({ cls: "lilbee-wizard-progress" });
        const progressBar = progressEl.createDiv({ cls: "lilbee-progress-bar-container" });
        const progressFill = progressBar.createDiv({ cls: "lilbee-progress-bar" });
        const progressLabel = progressEl.createDiv({ cls: "lilbee-wizard-progress-label" });
        progressLabel.textContent = MESSAGES.WIZARD_STATUS_STARTING;

        step.createEl("p", {
            text: MESSAGES.WIZARD_SYNC_HINT,
            cls: "lilbee-wizard-hint",
        });

        const actions = step.createDiv({ cls: "lilbee-wizard-actions" });
        const backBtn = actions.createEl("button", { text: MESSAGES.BUTTON_BACK });
        backBtn.addEventListener("click", () => {
            this.syncController?.abort();
            this.back();
        });
        const skipBtn = actions.createEl("button", { text: MESSAGES.BUTTON_SKIP_SETUP });
        skipBtn.addEventListener("click", () => {
            this.syncController?.abort();
            this.skip();
        });

        void this.runSync(progressFill, progressLabel);
    }

    private async runSync(progressFill: HTMLElement, progressLabel: HTMLElement): Promise<void> {
        this.syncController = new AbortController();
        try {
            let lastEvent: SSEEvent | null = null;
            for await (const event of this.plugin.api.syncStream(
                !!this.plugin.activeVisionModel,
                this.syncController.signal,
            )) {
                if (event.event === SSE_EVENT.FILE_START) {
                    const d = event.data as { current_file: number; total_files: number; file?: string };
                    const pct = d.total_files > 0 ? Math.round((d.current_file / d.total_files) * 100) : 0;
                    progressFill.style.width = `${pct}%`;
                    progressLabel.textContent = MESSAGES.STATUS_PROCESSING_FILES.replace(
                        "{current}",
                        String(d.current_file),
                    ).replace("{total}", String(d.total_files));
                }
                if (event.event === SSE_EVENT.EMBED) {
                    const d = event.data as { file?: string };
                    if (d.file) {
                        progressLabel.textContent = MESSAGES.STATUS_INDEXING.replace("{file}", d.file);
                    }
                }
                lastEvent = event;
            }

            if (lastEvent?.event === SSE_EVENT.DONE) {
                this.syncResult = lastEvent.data as SyncDone;
            }
            progressFill.style.width = "100%";
            progressLabel.textContent = MESSAGES.STATUS_DONE;
            this.step = WIZARD_STEP.DONE;
            this.renderStep();
        } catch (err) {
            if (err instanceof Error && err.name === ERROR_NAME.ABORT_ERROR) {
                new Notice(MESSAGES.NOTICE_INDEXING_CANCELLED);
            } else {
                progressLabel.textContent = MESSAGES.ERROR_INDEXING_FAILED;
            }
        } finally {
            this.syncController = null;
        }
    }

    private renderDone(): void {
        const { contentEl } = this;
        const step = contentEl.createDiv({ cls: "lilbee-wizard-step" });

        step.createEl("h2", { text: MESSAGES.TITLE_ALL_SET });

        const summary = step.createDiv({ cls: "lilbee-wizard-summary" });
        if (this.pulledModelName) {
            summary.createEl("p", { text: MESSAGES.WIZARD_SUMMARY_MODEL.replace("{model}", this.pulledModelName) });
        }
        if (this.syncResult) {
            const total = this.syncResult.added.length + this.syncResult.updated.length + this.syncResult.unchanged;
            const chunks = this.syncResult.added.length + this.syncResult.updated.length;
            summary.createEl("p", { text: MESSAGES.WIZARD_SUMMARY_FILES.replace("{count}", String(total)) });
            if (chunks > 0) {
                summary.createEl("p", { text: MESSAGES.WIZARD_SUMMARY_PROCESSED.replace("{count}", String(chunks)) });
            }
        }

        const tips = step.createDiv({ cls: "lilbee-wizard-tips" });
        tips.createEl("p", { text: MESSAGES.WIZARD_TIPS });
        const ul = tips.createEl("ul");
        ul.createEl("li", { text: MESSAGES.WIZARD_TIP_CHAT });
        ul.createEl("li", { text: MESSAGES.WIZARD_TIP_SEARCH });
        ul.createEl("li", { text: MESSAGES.WIZARD_TIP_DRAG });

        step.createEl("p", { text: MESSAGES.WIZARD_CHANGE_SETTINGS });

        const actions = step.createDiv({ cls: "lilbee-wizard-actions" });
        const openChatBtn = actions.createEl("button", { text: MESSAGES.BUTTON_OPEN_CHAT, cls: "mod-cta" });
        openChatBtn.addEventListener("click", () => this.complete());
    }

    next(): void {
        if (this.step === WIZARD_STEP.WELCOME) {
            const serverReady =
                this.plugin.serverManager?.state === SERVER_STATE.READY ||
                this.plugin.settings.serverMode === SERVER_MODE.EXTERNAL;
            this.step = serverReady ? WIZARD_STEP.MODEL_PICKER : WIZARD_STEP.SERVER_MODE;
        } else {
            this.step++;
        }
        this.renderStep();
    }

    back(): void {
        if (this.step === WIZARD_STEP.MODEL_PICKER) {
            const serverReady =
                this.plugin.serverManager?.state === SERVER_STATE.READY ||
                this.plugin.settings.serverMode === SERVER_MODE.EXTERNAL;
            this.step = serverReady ? WIZARD_STEP.WELCOME : WIZARD_STEP.SERVER_MODE;
        } else {
            this.step = Math.max(0, this.step - 1);
        }
        this.renderStep();
    }

    skip(): void {
        this.close();
    }

    async complete(): Promise<void> {
        this.plugin.settings.setupCompleted = true;
        await this.plugin.saveSettings();
        this.close();
        void this.plugin.activateChatView();
    }
}
