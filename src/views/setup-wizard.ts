import { App, Modal, Notice } from "obsidian";
import type LilbeePlugin from "../main";
import type { CatalogModel, SSEEvent, SyncDone } from "../types";
import { SERVER_MODE, SSE_EVENT } from "../types";
import { CatalogModal } from "./catalog-modal";

interface FeaturedModel {
    name: string;
    size_gb: number;
    min_ram_gb: number;
    description: string;
    source: "native" | "litellm";
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
            case 0: this.renderWelcome(); break;
            case 1: this.renderServerMode(); break;
            case 2: this.renderModelPicker(); break;
            case 3: this.renderSync(); break;
            case 4: this.renderDone(); break;
        }
    }

    private renderWelcome(): void {
        const { contentEl } = this;
        const step = contentEl.createDiv({ cls: "lilbee-wizard-step" });

        step.createEl("h2", { text: "Welcome to lilbee" });
        step.createEl("p", {
            text: "lilbee turns your Obsidian vault into a searchable knowledge base powered by AI running on your machine.",
        });

        step.createEl("p", { text: "This wizard will help you:" });
        const ul = step.createEl("ul");
        ul.createEl("li", { text: "Choose an AI model that fits your computer" });
        ul.createEl("li", { text: "Index your vault so you can search and chat" });

        step.createEl("p", {
            text: "Everything runs locally \u2014 your notes never leave your machine.",
        });

        const actions = step.createDiv({ cls: "lilbee-wizard-actions" });
        const skipBtn = actions.createEl("button", { text: "Skip setup" });
        skipBtn.addEventListener("click", () => this.skip());

        const startBtn = actions.createEl("button", { text: "Get started", cls: "mod-cta" });
        startBtn.addEventListener("click", () => this.next());
    }

    private renderServerMode(): void {
        const { contentEl } = this;
        const step = contentEl.createDiv({ cls: "lilbee-wizard-step" });

        step.createEl("h2", { text: "How do you want to run lilbee?" });

        let mode: "managed" | "external" = this.plugin.settings.serverMode === SERVER_MODE.EXTERNAL
            ? "external"
            : "managed";

        const managedOption = step.createDiv({ cls: `lilbee-wizard-model-option${mode === "managed" ? " selected" : ""}` });
        managedOption.createEl("strong", { text: "Managed (recommended)" });
        managedOption.createEl("p", {
            text: "lilbee starts and stops automatically with Obsidian. No terminal needed.",
        });

        const externalOption = step.createDiv({ cls: `lilbee-wizard-model-option${mode === "external" ? " selected" : ""}` });
        externalOption.createEl("strong", { text: "External" });
        externalOption.createEl("p", {
            text: "You run the lilbee server yourself. For advanced users or shared setups.",
        });

        const urlInput = step.createEl("input", {
            cls: "lilbee-wizard-url-input",
            placeholder: "http://127.0.0.1:7433",
            attr: { type: "text" },
        });
        urlInput.value = this.plugin.settings.serverUrl;
        urlInput.style.display = mode === "external" ? "" : "none";

        const statusEl = step.createDiv({ cls: "lilbee-wizard-status" });

        managedOption.addEventListener("click", () => {
            mode = "managed";
            managedOption.classList.add("selected");
            externalOption.classList.remove("selected");
            urlInput.style.display = "none";
            statusEl.textContent = "";
        });

        externalOption.addEventListener("click", () => {
            mode = "external";
            externalOption.classList.add("selected");
            managedOption.classList.remove("selected");
            urlInput.style.display = "";
        });

        const actions = step.createDiv({ cls: "lilbee-wizard-actions" });
        const backBtn = actions.createEl("button", { text: "Back" });
        backBtn.addEventListener("click", () => this.back());
        const skipBtn = actions.createEl("button", { text: "Skip setup" });
        skipBtn.addEventListener("click", () => this.skip());

        const nextBtn = actions.createEl("button", { text: "Next", cls: "mod-cta" });
        nextBtn.addEventListener("click", () => {
            if (mode === "managed") {
                this.plugin.settings.serverMode = SERVER_MODE.MANAGED;
                statusEl.textContent = "Starting server...";
                statusEl.classList.add("lilbee-loading");
                nextBtn.disabled = true;
                void this.startManagedAndAdvance(statusEl, nextBtn);
            } else {
                this.plugin.settings.serverUrl = String(urlInput.value || "").trim() || "http://127.0.0.1:7433";
                this.plugin.settings.serverMode = SERVER_MODE.EXTERNAL;
                statusEl.textContent = "Checking connection...";
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
            this.step = 2;
            this.renderStep();
        } catch {
            statusEl.textContent = "Failed to start server. Check the settings tab for details.";
            statusEl.classList.remove("lilbee-loading");
            (nextBtn as HTMLButtonElement).disabled = false;
        }
    }

    private async checkExternalAndAdvance(statusEl: HTMLElement, nextBtn: HTMLElement): Promise<void> {
        try {
            await this.plugin.saveSettings();
            await this.plugin.api.health();
            statusEl.textContent = "";
            this.step = 2;
            this.renderStep();
        } catch {
            statusEl.textContent = "Could not connect. Check the URL and make sure the server is running.";
            (nextBtn as HTMLButtonElement).disabled = false;
        }
    }

    private renderModelPicker(): void {
        const { contentEl } = this;
        const step = contentEl.createDiv({ cls: "lilbee-wizard-step" });

        step.createEl("h2", { text: "Pick a chat model" });
        step.createEl("p", {
            text: "This is the AI that answers your questions about your notes. Bigger models are smarter but need more RAM and disk space.",
        });

        const memGB = getSystemMemoryGB();
        if (memGB !== null) {
            step.createEl("p", {
                text: `Your system: ${memGB} GB RAM`,
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
        const backBtn = actions.createEl("button", { text: "Back" });
        backBtn.addEventListener("click", () => {
            this.pullController?.abort();
            this.back();
        });
        const skipBtn = actions.createEl("button", { text: "Skip setup" });
        skipBtn.addEventListener("click", () => {
            this.pullController?.abort();
            this.skip();
        });

        const catalogBtn = actions.createEl("button", { text: "Browse full catalog" });
        catalogBtn.addEventListener("click", () => {
            new CatalogModal(this.app, this.plugin).open();
        });

        const downloadBtn = actions.createEl("button", { text: "Download & continue", cls: "mod-cta" });
        downloadBtn.addEventListener("click", () => {
            if (!this.selectedModel) {
                statusEl.textContent = "Please select a model first.";
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
        try {
            const response = await this.plugin.api.catalog({
                task: "chat",
                featured: true,
                sort: "featured",
                limit: 4,
            });
            this.featuredModels = response.models.map((m: CatalogModel) => ({
                name: m.name,
                size_gb: m.size_gb,
                min_ram_gb: m.min_ram_gb,
                description: m.description,
                source: m.source,
            }));
        } catch {
            this.featuredModels = [];
            statusEl.textContent = "Could not load models from server.";
            return;
        }

        const recommended = recommendedIndex(this.featuredModels, memGB);
        this.selectedModel = this.featuredModels[recommended] ?? null;

        for (let i = 0; i < this.featuredModels.length; i++) {
            const model = this.featuredModels[i];
            const option = container.createDiv({
                cls: `lilbee-wizard-model-option${i === recommended ? " selected" : ""}`,
            });

            const header = option.createDiv({ cls: "lilbee-wizard-model-header" });
            if (i === recommended) {
                header.createEl("span", { text: "Recommended", cls: "lilbee-wizard-recommended" });
            }
            header.createEl("strong", { text: model.name });
            header.createEl("span", { text: `${model.size_gb} GB` });
            option.createEl("p", { text: model.description });
            option.createEl("p", { text: `Minimum ${model.min_ram_gb} GB RAM`, cls: "lilbee-wizard-model-ram" });

            option.addEventListener("click", () => {
                this.selectedModel = model;
                for (const child of container.children) {
                    child.classList.remove("selected");
                }
                option.classList.add("selected");
            });
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
        progressLabel.textContent = `Downloading ${model.name}...`;
        this.pullController = new AbortController();

        try {
            for await (const event of this.plugin.api.pullModel(
                model.name,
                model.source,
                this.pullController.signal,
            )) {
                if (event.event === SSE_EVENT.PROGRESS) {
                    const d = event.data as { current?: number; total?: number };
                    if (d.total && d.current !== undefined) {
                        const pct = Math.round((d.current / d.total) * 100);
                        progressFill.style.width = `${pct}%`;
                        progressLabel.textContent = `Downloading ${model.name}... ${pct}%`;
                    }
                }
            }

            await this.plugin.api.setChatModel(model.name);
            this.plugin.activeModel = model.name;
            this.plugin.fetchActiveModel();
            this.pulledModelName = model.name;
            this.step = 3;
            this.renderStep();
        } catch (err) {
            if (err instanceof Error && err.name === "AbortError") {
                new Notice("lilbee: download cancelled");
            } else {
                statusEl.textContent = "Download failed. Please try again or pick a different model.";
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

        step.createEl("h2", { text: "Index your vault" });
        step.createEl("p", {
            text: "lilbee needs to read your notes once to make them searchable. This happens locally on your machine.",
        });

        const progressEl = step.createDiv({ cls: "lilbee-wizard-progress" });
        const progressBar = progressEl.createDiv({ cls: "lilbee-progress-bar-container" });
        const progressFill = progressBar.createDiv({ cls: "lilbee-progress-bar" });
        const progressLabel = progressEl.createDiv({ cls: "lilbee-wizard-progress-label" });
        progressLabel.textContent = "Starting...";

        step.createEl("p", {
            text: "After this, new and changed files are indexed automatically (or manually, your choice).",
            cls: "lilbee-wizard-hint",
        });

        const actions = step.createDiv({ cls: "lilbee-wizard-actions" });
        const backBtn = actions.createEl("button", { text: "Back" });
        backBtn.addEventListener("click", () => {
            this.syncController?.abort();
            this.back();
        });
        const skipBtn = actions.createEl("button", { text: "Skip setup" });
        skipBtn.addEventListener("click", () => {
            this.syncController?.abort();
            this.skip();
        });

        void this.runSync(progressFill, progressLabel);
    }

    private async runSync(
        progressFill: HTMLElement,
        progressLabel: HTMLElement,
    ): Promise<void> {
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
                    progressLabel.textContent = `Processing ${d.current_file}/${d.total_files} files`;
                }
                if (event.event === SSE_EVENT.EMBED) {
                    const d = event.data as { file?: string };
                    if (d.file) {
                        progressLabel.textContent = `Indexing: ${d.file}`;
                    }
                }
                lastEvent = event;
            }

            if (lastEvent?.event === SSE_EVENT.DONE) {
                this.syncResult = lastEvent.data as SyncDone;
            }
            progressFill.style.width = "100%";
            progressLabel.textContent = "Done!";
            this.step = 4;
            this.renderStep();
        } catch (err) {
            if (err instanceof Error && err.name === "AbortError") {
                new Notice("lilbee: indexing cancelled");
            } else {
                progressLabel.textContent = "Indexing failed. You can retry from the settings tab.";
            }
        } finally {
            this.syncController = null;
        }
    }

    private renderDone(): void {
        const { contentEl } = this;
        const step = contentEl.createDiv({ cls: "lilbee-wizard-step" });

        step.createEl("h2", { text: "You're all set!" });

        const summary = step.createDiv({ cls: "lilbee-wizard-summary" });
        if (this.pulledModelName) {
            summary.createEl("p", { text: `Chat model: ${this.pulledModelName}` });
        }
        if (this.syncResult) {
            const total = this.syncResult.added.length +
                this.syncResult.updated.length +
                this.syncResult.unchanged;
            const chunks = this.syncResult.added.length + this.syncResult.updated.length;
            summary.createEl("p", { text: `${total} files indexed` });
            if (chunks > 0) {
                summary.createEl("p", { text: `${chunks} files processed` });
            }
        }

        const tips = step.createDiv({ cls: "lilbee-wizard-tips" });
        tips.createEl("p", { text: "Try it out:" });
        const ul = tips.createEl("ul");
        ul.createEl("li", { text: "Open the chat panel to ask questions about your notes" });
        ul.createEl("li", { text: "Use the search command to find specific content" });
        ul.createEl("li", { text: "Drag files into the chat to add context" });

        step.createEl("p", {
            text: "You can change models and settings anytime in the lilbee settings tab.",
        });

        const actions = step.createDiv({ cls: "lilbee-wizard-actions" });
        const openChatBtn = actions.createEl("button", { text: "Open chat", cls: "mod-cta" });
        openChatBtn.addEventListener("click", () => this.complete());
    }

    next(): void {
        if (this.step === 0) {
            const serverReady = this.plugin.serverManager?.state === "ready" ||
                this.plugin.settings.serverMode === SERVER_MODE.EXTERNAL;
            this.step = serverReady ? 2 : 1;
        } else {
            this.step++;
        }
        this.renderStep();
    }

    back(): void {
        if (this.step === 2) {
            const serverReady = this.plugin.serverManager?.state === "ready" ||
                this.plugin.settings.serverMode === SERVER_MODE.EXTERNAL;
            this.step = serverReady ? 0 : 1;
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
