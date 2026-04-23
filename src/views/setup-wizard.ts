import { App, Modal, Notice } from "obsidian";
import type LilbeePlugin from "../main";
import type { CatalogEntry, SSEEvent, SyncDone } from "../types";
import { SERVER_MODE, SERVER_STATE, SSE_EVENT, WIZARD_STEP, ERROR_NAME, MODEL_TASK, MODEL_SOURCE } from "../types";
import { CatalogModal } from "./catalog-modal";
import { MESSAGES, FILTERS } from "../locales/en";
import { renderModelCard } from "../components/model-card";
import { percentFromSse, extractSseErrorMessage } from "../utils";

type FeaturedModel = CatalogEntry;
type EmbeddingModel = CatalogEntry;

/**
 * Ordered, visible-in-indicator steps. The indicator labels these 1..6 so the
 * user has a clear sense of "Step N of 6" while moving through setup. Welcome
 * is not in the numbered sequence (it's the intro splash).
 */
const INDICATOR_STEPS: { step: number; key: string; label: string }[] = [
    { step: WIZARD_STEP.SERVER_MODE, key: "server", label: "Server" },
    { step: WIZARD_STEP.MODEL_PICKER, key: "model", label: "Model" },
    { step: WIZARD_STEP.EMBEDDING_PICKER, key: "embedding", label: "Embed" },
    { step: WIZARD_STEP.SYNC, key: "sync", label: "Sync" },
    { step: WIZARD_STEP.WIKI, key: "wiki", label: "Wiki" },
    { step: WIZARD_STEP.DONE, key: "done", label: "Done" },
];

/**
 * data-step attribute on the step container drives per-step CSS (rail color,
 * badge color, progress accent). Semantic keys map to existing lilbee color
 * tokens so the wizard's visual language stays in sync with the Task Center's.
 */
const STEP_KEY: Record<number, string> = {
    [WIZARD_STEP.WELCOME]: "welcome",
    [WIZARD_STEP.SERVER_MODE]: "server",
    [WIZARD_STEP.MODEL_PICKER]: "model",
    [WIZARD_STEP.EMBEDDING_PICKER]: "embedding",
    [WIZARD_STEP.SYNC]: "sync",
    [WIZARD_STEP.WIKI]: "wiki",
    [WIZARD_STEP.DONE]: "done",
};

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

/**
 * Families the wizard surfaces first as its native picks. Ordered by
 * recency/recognition — a fresh-install user seeing "Gemma", "Qwen", "Llama"
 * as the first four tiles gets an immediate sense of what's familiar. Any
 * native models outside these families backfill after.
 */
const PREFERRED_FAMILIES = ["gemma-4", "gemma-3", "gemma-2", "qwen3", "qwen2", "llama-3", "phi-3"];
const MAX_FEATURED_PICKS = 8;

/**
 * Rank the server's featured chat entries into the wizard's "Our picks" row.
 *
 * Deliberately does NOT filter by `source`. When a server is mis-configured
 * and tags every featured model as `source="litellm"` (a known transient bug
 * in older builds), filtering on source emptied the wizard grid. The featured
 * list itself is the source of truth — the server has already decided these
 * are the models a fresh user should see. We just reorder them so recognised
 * open-weight families (Gemma, Qwen, Llama, Phi) lead.
 *
 * Callers that genuinely need to hide a subset (e.g. API-only entries in a
 * different UI) can pass a custom `filter` predicate.
 */
export function pickNativeChatModels(
    models: FeaturedModel[],
    filter: (m: FeaturedModel) => boolean = () => true,
): FeaturedModel[] {
    const eligible = models.filter(filter);
    const seen = new Set<string>();
    const ordered: FeaturedModel[] = [];
    for (const prefix of PREFERRED_FAMILIES) {
        for (const m of eligible) {
            if (m.name.startsWith(prefix) && !seen.has(m.hf_repo)) {
                ordered.push(m);
                seen.add(m.hf_repo);
                if (ordered.length >= MAX_FEATURED_PICKS) return ordered;
            }
        }
    }
    for (const m of eligible) {
        if (!seen.has(m.hf_repo)) {
            ordered.push(m);
            seen.add(m.hf_repo);
            if (ordered.length >= MAX_FEATURED_PICKS) break;
        }
    }
    return ordered;
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
    private selectedEmbedding: EmbeddingModel | null = null;
    private embeddingModels: EmbeddingModel[] = [];

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
            case WIZARD_STEP.EMBEDDING_PICKER:
                this.renderEmbeddingPicker();
                break;
            case WIZARD_STEP.SYNC:
                this.renderSync();
                break;
            case WIZARD_STEP.WIKI:
                this.renderWiki();
                break;
            case WIZARD_STEP.DONE:
                this.renderDone();
                break;
        }
    }

    /**
     * Build the step frame: outer `<div data-step="...">` with a left rail and a
     * numbered breadcrumb at the top. Every `render<Step>` method calls this to
     * get a consistent scaffold.
     */
    private beginStep(): HTMLElement {
        const { contentEl } = this;
        const step = contentEl.createDiv({ cls: "lilbee-wizard-step" });
        // STEP_KEY covers every WIZARD_STEP value; `this.step` is only set
        // via the enum (renderStep switch + next/back guards), so the lookup
        // is total.
        step.dataset.step = STEP_KEY[this.step];
        step.createDiv({ cls: "lilbee-wizard-rail" });
        this.renderStepIndicator(step);
        return step;
    }

    private renderStepIndicator(container: HTMLElement): void {
        const indicator = container.createDiv({ cls: "lilbee-wizard-step-indicator" });
        for (let i = 0; i < INDICATOR_STEPS.length; i++) {
            const meta = INDICATOR_STEPS[i];
            if (i > 0) {
                const line = indicator.createDiv({ cls: "lilbee-wizard-step-line" });
                if (meta.step <= this.step) line.addClass("is-done");
            }
            const slot = indicator.createDiv({ cls: "lilbee-wizard-step-slot" });
            slot.dataset.step = meta.key;
            const circle = slot.createDiv({ cls: "lilbee-wizard-step-circle" });
            const isActive = meta.step === this.step;
            const isDone = meta.step < this.step;
            if (isActive) circle.addClass("is-active");
            if (isDone) circle.addClass("is-done");
            circle.textContent = isDone ? "✓" : String(i + 1);
            slot.createDiv({ cls: "lilbee-wizard-step-label", text: meta.label });
        }
    }

    /**
     * Step header: a Task-Center-style uppercase badge (`STEP 03 · MODEL`)
     * followed by the h2 title. The badge carries the step's semantic color.
     */
    private renderStepHeader(container: HTMLElement, title: string): void {
        const meta = INDICATOR_STEPS.find((m) => m.step === this.step);
        const header = container.createDiv({ cls: "lilbee-wizard-step-header" });
        if (meta) {
            const badge = header.createSpan({ cls: "lilbee-wizard-step-badge" });
            badge.textContent = MESSAGES.WIZARD_STEP_BADGE.replace(
                "{num}",
                String(INDICATOR_STEPS.indexOf(meta) + 1).padStart(2, "0"),
            ).replace("{label}", meta.label.toUpperCase());
        }
        header.createEl("h2", { text: title });
    }

    /** Task-Center-style section heading: uppercase, letter-spaced, muted. */
    private renderSectionHeading(container: HTMLElement, text: string): void {
        container.createDiv({ cls: "lilbee-wizard-section-heading", text });
    }

    private renderWelcome(): void {
        const step = this.beginStep();
        this.renderStepHeader(step, MESSAGES.TITLE_WELCOME);
        step.createEl("p", { text: MESSAGES.WIZARD_INTRO_DESC });

        this.renderSectionHeading(step, MESSAGES.WIZARD_INTRO_STEPS);
        const ul = step.createEl("ul", { cls: "lilbee-wizard-intro-list" });
        ul.createEl("li", { text: MESSAGES.WIZARD_STEP_CHOOSE_MODEL });
        ul.createEl("li", { text: MESSAGES.WIZARD_STEP_INDEX });

        step.createEl("p", { text: MESSAGES.WIZARD_LOCAL_ONLY, cls: "lilbee-wizard-hint" });

        const actions = step.createDiv({ cls: "lilbee-wizard-actions" });
        const skipBtn = actions.createEl("button", { text: MESSAGES.BUTTON_SKIP_SETUP });
        skipBtn.addEventListener("click", () => this.skip());

        const startBtn = actions.createEl("button", { text: MESSAGES.BUTTON_GET_STARTED, cls: "mod-cta" });
        startBtn.addEventListener("click", () => this.next());
    }

    private renderServerMode(): void {
        const step = this.beginStep();
        this.renderStepHeader(step, MESSAGES.TITLE_SERVER_MODE);

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

        // External-mode fields: URL + session token (password-masked). Both
        // hidden in managed mode. The token lines up with readCurrentToken's
        // `settings.manualToken` lookup, so the API client will pick it up as
        // soon as the wizard advances.
        const externalFields = step.createDiv({ cls: "lilbee-wizard-external-fields" });
        externalFields.style.display = mode === SERVER_MODE.EXTERNAL ? "" : "none";

        const urlLabel = externalFields.createDiv({ cls: "lilbee-wizard-field-label" });
        urlLabel.textContent = MESSAGES.LABEL_SERVER_URL;
        const urlInput = externalFields.createEl("input", {
            cls: "lilbee-wizard-url-input",
            placeholder: MESSAGES.PLACEHOLDER_HTTP_LOCALHOST,
            attr: { type: "text" },
        });
        urlInput.value = this.plugin.settings.serverUrl;

        const tokenLabel = externalFields.createDiv({ cls: "lilbee-wizard-field-label" });
        tokenLabel.textContent = MESSAGES.LABEL_MANUAL_TOKEN;
        const tokenInput = externalFields.createEl("input", {
            cls: "lilbee-wizard-url-input",
            placeholder: MESSAGES.PLACEHOLDER_MANUAL_TOKEN,
            attr: { type: "password" },
        });
        tokenInput.value = this.plugin.settings.manualToken;
        externalFields.createDiv({
            cls: "lilbee-wizard-hint",
            text: MESSAGES.WIZARD_EXTERNAL_TOKEN_HINT,
        });

        const statusEl = step.createDiv({ cls: "lilbee-wizard-status" });
        const { progressEl, progressFill, progressLabel } = this.renderProgressPanel(step);

        managedOption.addEventListener("click", () => {
            mode = SERVER_MODE.MANAGED;
            managedOption.classList.add("selected");
            externalOption.classList.remove("selected");
            externalFields.style.display = "none";
            statusEl.textContent = "";
        });

        externalOption.addEventListener("click", () => {
            mode = SERVER_MODE.EXTERNAL;
            externalOption.classList.add("selected");
            managedOption.classList.remove("selected");
            externalFields.style.display = "";
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
                nextBtn.disabled = true;
                void this.startManagedAndAdvance(step, progressEl, progressFill, progressLabel, statusEl, nextBtn);
            } else {
                this.plugin.settings.serverUrl = String(urlInput.value || "").trim() || "http://127.0.0.1:7433";
                this.plugin.settings.manualToken = String(tokenInput.value || "").trim();
                this.plugin.settings.serverMode = SERVER_MODE.EXTERNAL;
                statusEl.textContent = MESSAGES.STATUS_CHECKING_CONNECTION;
                nextBtn.disabled = true;
                void this.checkExternalAndAdvance(statusEl, nextBtn);
            }
        });
    }

    private async startManagedAndAdvance(
        step: HTMLElement,
        progressEl: HTMLElement,
        progressFill: HTMLElement,
        progressLabel: HTMLElement,
        statusEl: HTMLElement,
        nextBtn: HTMLElement,
    ): Promise<void> {
        progressEl.style.display = "";
        progressLabel.textContent = MESSAGES.WIZARD_SERVER_PREPARING;
        this.updateProgress(step, progressFill, undefined);
        statusEl.textContent = "";

        try {
            await this.plugin.saveSettings();
            if (!this.plugin.serverManager) {
                await this.plugin.startManagedServer((event) => {
                    // Surface binary-download + server-boot phases inline. This
                    // is the only place the user sees what's happening during
                    // the initial ~10-60s wait for the server to come online.
                    if (event.phase === "downloading") {
                        progressLabel.textContent = MESSAGES.WIZARD_SERVER_DOWNLOADING.replace("{msg}", event.message);
                    } else if (event.phase === "starting") {
                        progressLabel.textContent = MESSAGES.WIZARD_SERVER_STARTING;
                    } else if (event.phase === "ready") {
                        progressLabel.textContent = MESSAGES.WIZARD_SERVER_READY;
                    } else if (event.phase === "error") {
                        progressLabel.textContent = event.message;
                    }
                });
            }
            this.updateProgress(step, progressFill, 100);
            progressLabel.textContent = MESSAGES.WIZARD_SERVER_READY;
            this.step = WIZARD_STEP.MODEL_PICKER;
            this.renderStep();
        } catch {
            progressEl.style.display = "none";
            statusEl.textContent = MESSAGES.ERROR_START_SERVER;
            (nextBtn as HTMLButtonElement).disabled = false;
        }
    }

    private async checkExternalAndAdvance(statusEl: HTMLElement, nextBtn: HTMLElement): Promise<void> {
        try {
            await this.plugin.saveSettings();
            // Repoint the existing client at the new URL and hand it the token
            // the user just pasted. Updating in-place keeps test mocks intact
            // and avoids churning listeners keyed on the old instance.
            this.plugin.api.setBaseUrl(this.plugin.settings.serverUrl);
            this.plugin.api.setToken(this.plugin.settings.manualToken || null);
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

    /**
     * Build the shared download-progress panel used by steps 3–5. The panel
     * starts hidden; `activateProgressPanel` below flips it on once work
     * begins. The Task Center CTA is always present but only *visible* while
     * progress is active — users need the affordance the moment downloads
     * start, never before.
     */
    private renderProgressPanel(step: HTMLElement): {
        progressEl: HTMLElement;
        progressFill: HTMLElement;
        progressLabel: HTMLElement;
    } {
        const progressEl = step.createDiv({ cls: "lilbee-wizard-progress" });
        progressEl.style.display = "none";

        const progressBar = progressEl.createDiv({ cls: "lilbee-progress-bar-container" });
        const progressFill = progressBar.createDiv({
            cls: "lilbee-progress-bar lilbee-wizard-progress-fill lilbee-wizard-progress-indeterminate",
        });
        const progressLabel = progressEl.createDiv({ cls: "lilbee-wizard-progress-label" });

        const footer = progressEl.createDiv({ cls: "lilbee-wizard-progress-footer" });
        footer.createDiv({
            cls: "lilbee-wizard-progress-hint",
            text: MESSAGES.WIZARD_PROGRESS_BACKGROUND,
        });

        const taskCenterBtn = footer.createEl("button", {
            cls: "lilbee-wizard-task-center-cta",
            text: MESSAGES.BUTTON_OPEN_TASK_CENTER,
        });
        taskCenterBtn.addEventListener("click", (e) => {
            e.preventDefault();
            this.plugin.activateTaskView();
        });

        return { progressEl, progressFill, progressLabel };
    }

    /**
     * Update the progress fill: hands off from indeterminate to determinate
     * the first time a percentage comes in. Also sets the hero rail to the
     * "active" state so the step visually pulses like a Task Center row.
     */
    private updateProgress(step: HTMLElement, progressFill: HTMLElement, pct: number | undefined): void {
        const rail = step.querySelector<HTMLElement>(".lilbee-wizard-rail");
        rail?.classList.add("is-active");
        if (pct === undefined) return;
        progressFill.classList.remove("lilbee-wizard-progress-indeterminate");
        progressFill.style.width = `${pct}%`;
    }

    private renderModelPicker(): void {
        const step = this.beginStep();
        this.renderStepHeader(step, MESSAGES.TITLE_PICK_MODEL);
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
        const { progressEl, progressFill, progressLabel } = this.renderProgressPanel(step);

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
            void this.pullSelectedModel(downloadBtn, progressEl, progressFill, progressLabel, statusEl, step);
        });

        void this.loadFeaturedModels(modelsContainer, memGB, statusEl);
    }

    private async loadFeaturedModels(
        container: HTMLElement,
        memGB: number | null,
        statusEl: HTMLElement,
    ): Promise<void> {
        try {
            // The server's featured list is the source of truth for the
            // wizard's "Our picks" row. Do NOT filter by `source` here — a
            // mis-configured server can tag every featured model as
            // `source="litellm"`, which would empty the grid and leave the
            // user stuck. `pickNativeChatModels` just reorders so recognised
            // open-weight families (Gemma, Qwen, Llama) lead.
            const result = await this.plugin.api.catalog({
                task: MODEL_TASK.CHAT,
                featured: true,
                sort: FILTERS.SORT.DOWNLOADS,
                limit: 40,
            });
            if (result.isErr()) {
                this.featuredModels = [];
                return;
            }
            this.featuredModels = pickNativeChatModels(result.value.models);
        } catch {
            this.featuredModels = [];
            statusEl.textContent = MESSAGES.ERROR_LOAD_MODELS;
            return;
        }

        const recommended = recommendedIndex(this.featuredModels, memGB);
        this.selectedModel = this.featuredModels[recommended] ?? null;

        this.renderSectionHeading(container, MESSAGES.LABEL_OUR_PICKS);
        const grid = container.createDiv({ cls: "lilbee-catalog-grid" });

        for (let i = 0; i < this.featuredModels.length; i++) {
            const entry = this.featuredModels[i];
            renderModelCard(grid, entry, {
                isActive: i === recommended,
                onClick: () => this.selectModel(grid, entry),
            });
        }
    }

    private selectModel(grid: HTMLElement, model: FeaturedModel): void {
        this.selectedModel = model;
        for (const child of Array.from(grid.children)) {
            const el = child as HTMLElement;
            if (el.dataset.repo === model.hf_repo) {
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
        step: HTMLElement,
    ): Promise<void> {
        if (!this.selectedModel) return;
        const model = this.selectedModel;
        progressEl.style.display = "";
        progressLabel.textContent = MESSAGES.STATUS_DOWNLOADING_MODEL.replace("{model}", model.hf_repo);
        this.pullController = new AbortController();
        this.updateProgress(step, progressFill, undefined);

        try {
            for await (const event of this.plugin.api.pullModel(
                model.hf_repo,
                MODEL_SOURCE.NATIVE,
                this.pullController.signal,
            )) {
                if (event.event === SSE_EVENT.PROGRESS) {
                    const d = event.data as { percent?: number; current?: number; total?: number };
                    const pct = percentFromSse(d);
                    if (pct !== undefined) {
                        this.updateProgress(step, progressFill, pct);
                        progressLabel.textContent = MESSAGES.STATUS_DOWNLOADING_MODEL_PCT.replace(
                            "{model}",
                            model.hf_repo,
                        ).replace("{pct}", String(pct));
                    }
                } else if (event.event === SSE_EVENT.ERROR) {
                    const d = event.data as { message?: string } | string;
                    const msg = extractSseErrorMessage(d, MESSAGES.ERROR_UNKNOWN);
                    new Notice(MESSAGES.ERROR_DOWNLOAD_FAILED);
                    statusEl.textContent = msg;
                    break;
                }
            }

            const setResult = await this.plugin.api.setChatModel(model.hf_repo);
            if (setResult.isErr()) {
                new Notice(MESSAGES.ERROR_SET_MODEL.replace("{model}", model.display_name));
                statusEl.textContent = setResult.error.message;
                progressEl.style.display = "none";
                (downloadBtn as HTMLButtonElement).disabled = false;
                return;
            }
            this.plugin.activeModel = model.display_name;
            this.plugin.fetchActiveModel();
            this.pulledModelName = model.display_name;
            this.step = WIZARD_STEP.EMBEDDING_PICKER;
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

    private renderEmbeddingPicker(): void {
        const step = this.beginStep();
        this.renderStepHeader(step, MESSAGES.TITLE_PICK_EMBEDDING);
        step.createEl("p", { text: MESSAGES.WIZARD_EMBEDDING_HELP });

        const modelsContainer = step.createDiv({ cls: "lilbee-wizard-models" });
        const statusEl = step.createDiv({ cls: "lilbee-wizard-status" });
        const { progressEl, progressFill, progressLabel } = this.renderProgressPanel(step);

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

        const downloadBtn = actions.createEl("button", { text: MESSAGES.BUTTON_DOWNLOAD_CONTINUE, cls: "mod-cta" });
        downloadBtn.addEventListener("click", () => {
            if (!this.selectedEmbedding) {
                this.step = WIZARD_STEP.SYNC;
                this.renderStep();
                return;
            }
            if (this.selectedEmbedding.installed) {
                const name = this.selectedEmbedding.name;
                void (async () => {
                    const result = await this.plugin.api.setEmbeddingModel(name);
                    if (result.isErr()) {
                        new Notice(MESSAGES.ERROR_SET_MODEL.replace("{model}", name));
                        return;
                    }
                    this.step = WIZARD_STEP.SYNC;
                    this.renderStep();
                })();
                return;
            }
            downloadBtn.disabled = true;
            statusEl.textContent = "";
            void this.pullEmbeddingModel(downloadBtn, progressEl, progressFill, progressLabel, statusEl, step);
        });

        void this.loadEmbeddingModels(modelsContainer, statusEl);
    }

    private async loadEmbeddingModels(container: HTMLElement, statusEl: HTMLElement): Promise<void> {
        try {
            const result = await this.plugin.api.catalog({
                task: MODEL_TASK.EMBEDDING,
                featured: true,
                sort: FILTERS.SORT.DOWNLOADS,
                limit: 20,
            });
            if (result.isErr()) {
                this.embeddingModels = [];
                return;
            }
            // Trust the server's featured list — don't filter by source.
            // Mis-configured builds can stamp every featured embedding as
            // source="litellm", which would leave the picker empty.
            this.embeddingModels = result.value.models.slice(0, MAX_FEATURED_PICKS);
        } catch {
            this.embeddingModels = [];
            statusEl.textContent = MESSAGES.ERROR_LOAD_MODELS;
            return;
        }

        const recommended = this.embeddingModels.findIndex((m) => m.name.includes("nomic-embed-text"));
        const defaultIdx = recommended >= 0 ? recommended : 0;
        this.selectedEmbedding = this.embeddingModels[defaultIdx] ?? null;

        this.renderSectionHeading(container, MESSAGES.WIZARD_EMBEDDING_RECOMMENDED);
        const grid = container.createDiv({ cls: "lilbee-catalog-grid" });

        for (let i = 0; i < this.embeddingModels.length; i++) {
            const entry = this.embeddingModels[i];
            renderModelCard(grid, entry, {
                isActive: i === defaultIdx,
                onClick: () => this.selectEmbedding(grid, entry),
            });
        }
    }

    private selectEmbedding(grid: HTMLElement, model: EmbeddingModel): void {
        this.selectedEmbedding = model;
        for (const child of Array.from(grid.children)) {
            const el = child as HTMLElement;
            if (el.dataset.repo === model.hf_repo) {
                el.classList.add("is-selected");
            } else {
                el.classList.remove("is-selected");
            }
        }
    }

    private async pullEmbeddingModel(
        downloadBtn: HTMLElement,
        progressEl: HTMLElement,
        progressFill: HTMLElement,
        progressLabel: HTMLElement,
        statusEl: HTMLElement,
        step: HTMLElement,
    ): Promise<void> {
        if (!this.selectedEmbedding) return;
        const model = this.selectedEmbedding;
        progressEl.style.display = "";
        progressLabel.textContent = MESSAGES.STATUS_DOWNLOADING_MODEL.replace("{model}", model.hf_repo);
        this.pullController = new AbortController();
        this.updateProgress(step, progressFill, undefined);

        try {
            for await (const event of this.plugin.api.pullModel(
                model.hf_repo,
                MODEL_SOURCE.NATIVE,
                this.pullController.signal,
            )) {
                if (event.event === SSE_EVENT.PROGRESS) {
                    const d = event.data as { percent?: number; current?: number; total?: number };
                    const pct = percentFromSse(d);
                    if (pct !== undefined) {
                        this.updateProgress(step, progressFill, pct);
                        progressLabel.textContent = MESSAGES.STATUS_DOWNLOADING_MODEL_PCT.replace(
                            "{model}",
                            model.hf_repo,
                        ).replace("{pct}", String(pct));
                    }
                } else if (event.event === SSE_EVENT.ERROR) {
                    const d = event.data as { message?: string } | string;
                    const msg = extractSseErrorMessage(d, MESSAGES.ERROR_UNKNOWN);
                    new Notice(MESSAGES.ERROR_DOWNLOAD_FAILED);
                    statusEl.textContent = msg;
                    break;
                }
            }

            const setResult = await this.plugin.api.setEmbeddingModel(model.hf_repo);
            if (setResult.isErr()) {
                new Notice(MESSAGES.ERROR_SET_MODEL.replace("{model}", model.display_name));
                statusEl.textContent = setResult.error.message;
                progressEl.style.display = "none";
                (downloadBtn as HTMLButtonElement).disabled = false;
                return;
            }
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
        const step = this.beginStep();
        this.renderStepHeader(step, MESSAGES.TITLE_INDEX_VAULT);
        step.createEl("p", { text: MESSAGES.WIZARD_SYNC_HELP });

        const { progressEl, progressFill, progressLabel } = this.renderProgressPanel(step);
        progressEl.style.display = "";
        progressLabel.textContent = MESSAGES.WIZARD_STATUS_STARTING;
        this.updateProgress(step, progressFill, undefined);

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

        void this.runSync(progressFill, progressLabel, step);
    }

    private async runSync(progressFill: HTMLElement, progressLabel: HTMLElement, step: HTMLElement): Promise<void> {
        this.syncController = new AbortController();
        try {
            let lastEvent: SSEEvent | null = null;
            for await (const event of this.plugin.api.syncStream(
                this.plugin.settings.enableOcr,
                this.syncController.signal,
            )) {
                if (event.event === SSE_EVENT.FILE_START) {
                    const d = event.data as { current_file: number; total_files: number; file?: string };
                    const pct = d.total_files > 0 ? Math.round((d.current_file / d.total_files) * 100) : 0;
                    this.updateProgress(step, progressFill, pct);
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
                } else if (event.event === SSE_EVENT.ERROR) {
                    const d = event.data as { message?: string } | string;
                    const msg = extractSseErrorMessage(d, MESSAGES.ERROR_UNKNOWN);
                    progressLabel.textContent = msg;
                    throw new Error(msg);
                }
                lastEvent = event;
            }

            if (lastEvent?.event === SSE_EVENT.DONE) {
                this.syncResult = lastEvent.data as SyncDone;
            }
            this.updateProgress(step, progressFill, 100);
            progressLabel.textContent = MESSAGES.STATUS_DONE;
            this.step = WIZARD_STEP.WIKI;
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

    private renderWiki(): void {
        const step = this.beginStep();
        this.renderStepHeader(step, MESSAGES.WIZARD_WIKI_TITLE);
        step.createEl("p", { text: MESSAGES.WIZARD_WIKI_DESC });

        // Put the "experimental — here's why in plain English" explanation
        // up front so users who care see it immediately. Two-bullet structure
        // reads faster than one paragraph and signals "there are exactly two
        // things to know." Rich pros/cons move to a disclosure below.
        const experimental = step.createDiv({ cls: "lilbee-wizard-experimental-note" });
        this.renderSectionHeading(experimental, MESSAGES.WIZARD_WIKI_EXPERIMENTAL_HEADING);
        experimental.createEl("p", {
            text: MESSAGES.WIZARD_WIKI_EXPERIMENTAL_INTRO,
            cls: "lilbee-wizard-experimental-intro",
        });
        const bullets = experimental.createEl("ul", { cls: "lilbee-wizard-experimental-bullets" });
        bullets.createEl("li", { text: MESSAGES.WIZARD_WIKI_EXPERIMENTAL_QUALITY });
        bullets.createEl("li", { text: MESSAGES.WIZARD_WIKI_EXPERIMENTAL_SLOW });

        const tradeoffs = step.createEl("details", { cls: "lilbee-wizard-wiki-tradeoffs" });
        tradeoffs.createEl("summary", { text: MESSAGES.WIZARD_WIKI_TRADEOFFS_LABEL });

        const prosSection = tradeoffs.createDiv({ cls: "lilbee-wizard-wiki-section" });
        this.renderSectionHeading(prosSection, MESSAGES.WIZARD_WIKI_PROS_HEADING);
        const prosList = prosSection.createEl("ul");
        prosList.createEl("li", { text: MESSAGES.WIZARD_WIKI_PRO_SUMMARIES });
        prosList.createEl("li", { text: MESSAGES.WIZARD_WIKI_PRO_CROSSREFS });
        prosList.createEl("li", { text: MESSAGES.WIZARD_WIKI_PRO_ANSWERS });

        const consSection = tradeoffs.createDiv({ cls: "lilbee-wizard-wiki-section" });
        this.renderSectionHeading(consSection, MESSAGES.WIZARD_WIKI_CONS_HEADING);
        const consList = consSection.createEl("ul");
        consList.createEl("li", { text: MESSAGES.WIZARD_WIKI_CON_TOKENS });
        consList.createEl("li", { text: MESSAGES.WIZARD_WIKI_CON_ACCURACY });
        consList.createEl("li", { text: MESSAGES.WIZARD_WIKI_CON_SEARCH });
        consList.createEl("li", { text: MESSAGES.WIZARD_WIKI_CON_COMPLEXITY });

        // Default to Skip for first-time users — experimental features
        // shouldn't be on by default.
        let wikiEnabled = this.plugin.settings.wikiEnabled ?? false;

        const enableOption = step.createDiv({
            cls: `lilbee-wizard-model-option${wikiEnabled ? " selected" : ""}`,
        });
        enableOption.createEl("strong", { text: MESSAGES.WIZARD_WIKI_ENABLE });
        enableOption.createEl("p", { text: MESSAGES.WIZARD_WIKI_ENABLE_DESC });

        const disableOption = step.createDiv({
            cls: `lilbee-wizard-model-option${!wikiEnabled ? " selected" : ""}`,
        });
        disableOption.createEl("strong", { text: MESSAGES.WIZARD_WIKI_DISABLE });
        disableOption.createEl("p", { text: MESSAGES.WIZARD_WIKI_DISABLE_DESC });

        enableOption.addEventListener("click", () => {
            wikiEnabled = true;
            enableOption.classList.add("selected");
            disableOption.classList.remove("selected");
        });

        disableOption.addEventListener("click", () => {
            wikiEnabled = false;
            disableOption.classList.add("selected");
            enableOption.classList.remove("selected");
        });

        const actions = step.createDiv({ cls: "lilbee-wizard-actions" });
        const backBtn = actions.createEl("button", { text: MESSAGES.BUTTON_BACK });
        backBtn.addEventListener("click", () => this.back());
        const skipBtn = actions.createEl("button", { text: MESSAGES.BUTTON_SKIP_SETUP });
        skipBtn.addEventListener("click", () => this.skip());

        const nextBtn = actions.createEl("button", { text: MESSAGES.BUTTON_NEXT, cls: "mod-cta" });
        nextBtn.addEventListener("click", () => {
            this.plugin.settings.wikiEnabled = wikiEnabled;
            void this.plugin.saveSettings();
            this.next();
        });
    }

    private renderDone(): void {
        const step = this.beginStep();
        this.renderStepHeader(step, MESSAGES.TITLE_ALL_SET);

        // "Task-row" style summary: a bordered box with a green rail on the
        // left, echoing the completed Task Center rows the user will see
        // throughout normal operation.
        const summary = step.createDiv({ cls: "lilbee-wizard-summary-card" });
        const summaryBody = summary.createDiv({ cls: "lilbee-wizard-summary-body" });
        this.renderSectionHeading(summaryBody, MESSAGES.WIZARD_SUMMARY_HEADING);

        const stats = summaryBody.createDiv({ cls: "lilbee-wizard-summary-stats" });
        if (this.pulledModelName) {
            stats.createEl("span", {
                cls: "lilbee-wizard-summary-stat",
                text: MESSAGES.WIZARD_SUMMARY_MODEL.replace("{model}", this.pulledModelName),
            });
        }
        if (this.syncResult) {
            const total = this.syncResult.added.length + this.syncResult.updated.length + this.syncResult.unchanged;
            const chunks = this.syncResult.added.length + this.syncResult.updated.length;
            stats.createEl("span", {
                cls: "lilbee-wizard-summary-stat",
                text: MESSAGES.WIZARD_SUMMARY_FILES.replace("{count}", String(total)),
            });
            if (chunks > 0) {
                stats.createEl("span", {
                    cls: "lilbee-wizard-summary-stat",
                    text: MESSAGES.WIZARD_SUMMARY_PROCESSED.replace("{count}", String(chunks)),
                });
            }
        }

        this.renderSectionHeading(step, MESSAGES.WIZARD_TIPS);
        const tips = step.createDiv({ cls: "lilbee-wizard-tips" });
        const tipData: [string, string][] = [
            ["\u{1F4AC}", MESSAGES.WIZARD_TIP_CHAT],
            ["\u{1F50D}", MESSAGES.WIZARD_TIP_SEARCH],
            ["\u{1F4C4}", MESSAGES.WIZARD_TIP_DRAG],
        ];
        for (const [icon, text] of tipData) {
            const tip = tips.createDiv({ cls: "lilbee-wizard-tip" });
            tip.createEl("span", { cls: "lilbee-wizard-tip-icon", text: icon });
            tip.createEl("span", { text });
        }

        step.createEl("p", { text: MESSAGES.WIZARD_CHANGE_SETTINGS, cls: "lilbee-wizard-hint" });

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
        } else if (this.step === WIZARD_STEP.EMBEDDING_PICKER) {
            this.step = WIZARD_STEP.MODEL_PICKER;
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
