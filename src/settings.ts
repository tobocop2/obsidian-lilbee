import { App, Notice, PluginSettingTab, setIcon, Setting } from "obsidian";
import type LilbeePlugin from "./main";
import type { ReleaseInfo } from "./binary-manager";
import { DEFAULT_SETTINGS, MODEL_TYPE, NOTICE, SERVER_MODE } from "./types";
import type { ModelCatalog, ModelInfo, ModelType, ModelsResponse, ModelDefaults, ServerMode } from "./types";
import { PullQueue } from "./pull-queue";
import { ConfirmPullModal } from "./views/confirm-pull-modal";

const CHECK_TIMEOUT_MS = 5000;
const CLS_MODELS_CONTAINER = "lilbee-models-container";
const SEPARATOR_KEY = "__separator__";
const SEPARATOR_LABEL = "\u2500\u2500 Other... \u2500\u2500";

/**
 * Remove `:latest` entries when a more specific tag of the same model exists.
 * e.g. if both `mistral:latest` and `mistral:7b` are present, drop `mistral:latest`.
 */
export function deduplicateLatest(models: string[]): string[] {
    const bases = new Set(
        models
            .filter((m) => !m.endsWith(":latest"))
            .map((m) => m.split(":")[0]),
    );
    return models.filter((m) => {
        if (!m.endsWith(":latest")) return true;
        return !bases.has(m.split(":")[0]);
    });
}

export function buildModelOptions(
    catalog: ModelCatalog,
    type: ModelType,
): Record<string, string> {
    const options: Record<string, string> = {};
    if (type === MODEL_TYPE.VISION) {
        options[""] = "Disabled";
    }

    const catalogNames = new Set(catalog.catalog.map((m) => m.name));
    for (const model of catalog.catalog) {
        const suffix = model.installed ? "" : " (not installed)";
        options[model.name] = `${model.name}${suffix}`;
    }

    const otherInstalled = deduplicateLatest(
        catalog.installed.filter((name) => !catalogNames.has(name)),
    ).sort();

    if (otherInstalled.length > 0) {
        options[SEPARATOR_KEY] = SEPARATOR_LABEL;
        for (const name of otherInstalled) {
            options[name] = name;
        }
    }

    return options;
}

export { SEPARATOR_KEY, SEPARATOR_LABEL };

type GenKey = "temperature" | "top_p" | "top_k_sampling" | "repeat_penalty" | "num_ctx" | "seed";
const GEN_DEFAULTS_MAP: Record<GenKey, keyof ModelDefaults> = {
    temperature: "temperature",
    top_p: "top_p",
    top_k_sampling: "top_k",
    repeat_penalty: "repeat_penalty",
    num_ctx: "num_ctx",
    seed: "seed",
};

export class LilbeeSettingTab extends PluginSettingTab {
    plugin: LilbeePlugin;
    private pullQueue = new PullQueue();
    private pullAbortController: AbortController | null = null;
    private genInputs: Map<GenKey, HTMLInputElement> = new Map();

    constructor(app: App, plugin: LilbeePlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        this.renderConnectionSettings(containerEl);
        this.renderModelsSection(containerEl);
        this.renderGeneralSettings(containerEl);
        this.renderSyncSettings(containerEl);
        this.renderGenerationSettings(containerEl);
        this.loadModelDefaults();
    }

    private renderConnectionSettings(containerEl: HTMLElement): void {
        new Setting(containerEl)
            .setName("Server mode")
            .setDesc("How the lilbee server is managed")
            .addDropdown((dropdown) =>
                dropdown
                    .addOption(SERVER_MODE.MANAGED, "Managed (built-in)")
                    .addOption(SERVER_MODE.EXTERNAL, "External (manual)")
                    .setValue(this.plugin.settings.serverMode)
                    .onChange(async (value) => {
                        this.plugin.settings.serverMode = value as ServerMode;
                        await this.plugin.saveSettings();
                        this.display();
                    }),
            );

        if (this.plugin.settings.serverMode === SERVER_MODE.MANAGED) {
            this.renderManagedSettings(containerEl);
        } else {
            this.renderExternalSettings(containerEl);
        }

        const ollamaSetting = new Setting(containerEl)
            .setName("Ollama URL")
            .setDesc("Address of the Ollama server")
            .addText((text) =>
                text
                    .setPlaceholder("http://127.0.0.1:11434")
                    .setValue(this.plugin.settings.ollamaUrl)
                    .onChange(async (value) => {
                        this.plugin.settings.ollamaUrl = value;
                        await this.plugin.saveSettings();
                    }),
            );

        const ollamaStatusEl = ollamaSetting.settingEl.createEl("span", { cls: "lilbee-health-status" });

        ollamaSetting.addButton((btn) =>
            btn.setButtonText("Test").onClick(async () => {
                await this.checkEndpoint(this.plugin.settings.ollamaUrl, ollamaStatusEl);
            }),
        );

        void this.checkEndpoint(this.plugin.settings.ollamaUrl, ollamaStatusEl);
    }

    private renderManagedSettings(containerEl: HTMLElement): void {
        const statusSetting = new Setting(containerEl)
            .setName("Server status")
            .setDesc("Current state of the managed lilbee server");

        const statusEl = statusSetting.settingEl.createDiv({ cls: "lilbee-server-status" });
        const dot = statusEl.createDiv({ cls: "lilbee-server-dot" });
        const stateText = statusEl.createEl("span");

        const serverState = this.plugin.serverManager?.state ?? "stopped";
        stateText.textContent = serverState;
        dot.classList.add(`is-${serverState}`);

        const controlSetting = new Setting(containerEl)
            .setName("Server controls")
            .setDesc("Start, stop, or restart the managed server");

        if (serverState === "stopped" || serverState === "error") {
            controlSetting.addButton((btn) =>
                btn.setButtonText("Start").onClick(async () => {
                    await this.plugin.startManagedServer();
                    this.display();
                }),
            );
        }
        if (serverState === "ready" || serverState === "starting") {
            controlSetting.addButton((btn) =>
                btn.setButtonText("Stop").onClick(async () => {
                    await this.plugin.serverManager?.stop();
                    this.display();
                }),
            );
        }
        if (serverState === "ready") {
            controlSetting.addButton((btn) =>
                btn.setButtonText("Restart").onClick(async () => {
                    await this.plugin.serverManager?.restart();
                    this.display();
                }),
            );
        }

        new Setting(containerEl)
            .setName("Server port")
            .setDesc("Port for the managed server. Leave blank for automatic.")
            .addText((text) =>
                text
                    .setPlaceholder("Auto")
                    .setValue(this.plugin.settings.serverPort !== null ? String(this.plugin.settings.serverPort) : "")
                    .onChange(async (value) => {
                        const trimmed = value.trim();
                        if (trimmed === "" || trimmed === "0") {
                            this.plugin.settings.serverPort = null;
                        } else {
                            const num = parseInt(trimmed, 10);
                            if (!isNaN(num) && num > 0 && num <= 65535) {
                                this.plugin.settings.serverPort = num;
                            }
                        }
                        await this.plugin.saveSettings();
                    }),
            );

        const updateSetting = new Setting(containerEl)
            .setName("Server version")
            .setDesc(this.plugin.settings.lilbeeVersion || "Unknown");

        let pendingRelease: ReleaseInfo | null = null;
        updateSetting.addButton((checkBtn) =>
            checkBtn.setButtonText("Check for updates").onClick(async () => {
                if (pendingRelease) {
                    const release = pendingRelease;
                    checkBtn.setDisabled(true);
                    checkBtn.setButtonText("Updating...");
                    try {
                        await this.plugin.updateServer(release, (msg) => {
                            checkBtn.setButtonText(msg);
                        });
                        new Notice(`lilbee: updated to ${release.tag}`);
                        this.display();
                    } catch (err) {
                        new Notice("lilbee: update failed");
                        console.error("[lilbee] update failed:", err);
                        pendingRelease = null;
                        checkBtn.setButtonText("Check for updates");
                        checkBtn.setDisabled(false);
                    }
                    return;
                }

                checkBtn.setDisabled(true);
                checkBtn.setButtonText("Checking...");
                try {
                    const result = await this.plugin.checkForUpdate();
                    if (result.available && result.release) {
                        pendingRelease = result.release;
                        checkBtn.setButtonText(`Update to ${result.release.tag}`);
                        checkBtn.setDisabled(false);
                    } else {
                        new Notice("lilbee: already up to date");
                        checkBtn.setButtonText("Check for updates");
                        checkBtn.setDisabled(false);
                    }
                } catch {
                    new Notice("lilbee: could not check for updates");
                    checkBtn.setButtonText("Check for updates");
                    checkBtn.setDisabled(false);
                }
            }),
        );
    }

    private renderExternalSettings(containerEl: HTMLElement): void {
        const serverSetting = new Setting(containerEl)
            .setName("Server URL")
            .setDesc("Address of the lilbee HTTP server")
            .addText((text) =>
                text
                    .setPlaceholder("http://127.0.0.1:7433")
                    .setValue(this.plugin.settings.serverUrl)
                    .onChange(async (value) => {
                        this.plugin.settings.serverUrl = value;
                        await this.plugin.saveSettings();
                    }),
            );

        const serverStatusEl = serverSetting.settingEl.createEl("span", { cls: "lilbee-health-status" });

        serverSetting.addButton((btn) =>
            btn.setButtonText("Test").onClick(async () => {
                await this.checkEndpoint(`${this.plugin.settings.serverUrl}/api/health`, serverStatusEl);
            }),
        );

        void this.checkEndpoint(`${this.plugin.settings.serverUrl}/api/health`, serverStatusEl);

        new Setting(containerEl)
            .setName("Switch to managed server")
            .setDesc("Stop using an external server and start the built-in one")
            .addButton((btn) =>
                btn.setButtonText("Reset to managed").onClick(async () => {
                    this.plugin.settings.serverMode = SERVER_MODE.MANAGED;
                    this.plugin.settings.serverUrl = DEFAULT_SETTINGS.serverUrl;
                    await this.plugin.saveSettings();
                    this.display();
                }),
            );
    }

    private renderModelsSection(containerEl: HTMLElement): void {
        containerEl.createEl("h3", { text: "Models" });
        containerEl.createEl("p", {
            text: "Curated catalog — see ollama.com/library for the full model list. Requires the lilbee server.",
            cls: "setting-item-description",
        });

        const modelsContainer = containerEl.createDiv(CLS_MODELS_CONTAINER);
        new Setting(containerEl)
            .setName("Refresh models")
            .setDesc("Fetch available models from the server")
            .addButton((btn) =>
                btn.setButtonText("Refresh").onClick(async () => {
                    await this.loadModels(modelsContainer);
                }),
            );

        this.loadModels(modelsContainer);
    }

    private renderGeneralSettings(containerEl: HTMLElement): void {
        new Setting(containerEl)
            .setName("Results count")
            .setDesc("Number of search results to return")
            .addSlider((slider) =>
                slider
                    .setLimits(1, 20, 1)
                    .setValue(this.plugin.settings.topK)
                    .setDynamicTooltip()
                    .onChange(async (value) => {
                        this.plugin.settings.topK = value;
                        await this.plugin.saveSettings();
                    }),
            );
    }

    private renderGenerationSettings(containerEl: HTMLElement): void {
        const details = containerEl.createEl("details", { cls: "lilbee-generation-details" });
        const modelLabel = this.plugin.activeModel || "no model selected";
        details.createEl("summary", { text: `Advanced settings (${modelLabel})` });

        new Setting(details)
            .setName("System prompt")
            .setDesc("lilbee has a default system prompt, but you can override it here for different projects or use cases")
            .addText((text) =>
                text
                    .setPlaceholder("Default")
                    .setValue(this.plugin.settings.systemPrompt)
                    .onChange(async (value) => {
                        this.plugin.settings.systemPrompt = value;
                        await this.plugin.saveSettings();
                    }),
            );

        this.genInputs.clear();
        const fields: { key: GenKey; name: string; desc: string; integer: boolean }[] = [
            { key: "temperature", name: "Temperature", desc: "Controls randomness (0.0–2.0)", integer: false },
            { key: "top_p", name: "Top P", desc: "Nucleus sampling threshold (0.0–1.0)", integer: false },
            { key: "top_k_sampling", name: "Top K (sampling)", desc: "Limits token choices per step", integer: true },
            { key: "repeat_penalty", name: "Repeat penalty", desc: "Penalizes repeated tokens (1.0+)", integer: false },
            { key: "num_ctx", name: "Context length", desc: "Max context window in tokens", integer: true },
            { key: "seed", name: "Seed", desc: "Fixed seed for reproducible output", integer: true },
        ];

        for (const field of fields) {
            new Setting(details)
                .setName(field.name)
                .setDesc(field.desc)
                .addText((text) => {
                    text
                        .setPlaceholder("Not set")
                        .setValue(this.plugin.settings[field.key] !== null ? String(this.plugin.settings[field.key]) : "")
                        .onChange(async (value) => {
                            const trimmed = value.trim();
                            if (trimmed === "") {
                                this.plugin.settings[field.key] = null;
                            } else {
                                const num = field.integer ? parseInt(trimmed, 10) : parseFloat(trimmed);
                                if (!isNaN(num)) {
                                    this.plugin.settings[field.key] = num;
                                }
                            }
                            await this.plugin.saveSettings();
                        });
                    this.genInputs.set(field.key, text.inputEl);
                });
        }
    }

    private loadModelDefaults(): void {
        const model = this.plugin.activeModel;
        if (!model) return;
        this.plugin.api.showModel(model).then((defaults) => {
            for (const [key, inputEl] of this.genInputs) {
                const ollamaKey = GEN_DEFAULTS_MAP[key];
                const val = defaults[ollamaKey];
                if (val !== undefined) {
                    inputEl.placeholder = String(val);
                }
            }
        }).catch(() => {
            // Ollama unreachable — leave "Not set" placeholders
        });
    }

    private renderSyncSettings(containerEl: HTMLElement): void {
        new Setting(containerEl)
            .setName("Sync mode")
            .setDesc("How vault changes are synced to the knowledge base")
            .addDropdown((dropdown) =>
                dropdown
                    .addOption("manual", "Manual (command only)")
                    .addOption("auto", "Auto (watch for changes)")
                    .setValue(this.plugin.settings.syncMode)
                    .onChange(async (value) => {
                        this.plugin.settings.syncMode = value as "manual" | "auto";
                        await this.plugin.saveSettings();
                        this.display();
                    }),
            );

        if (this.plugin.settings.syncMode === "auto") {
            new Setting(containerEl)
                .setName("Sync debounce")
                .setDesc("Delay in ms before syncing after a change")
                .addText((text) =>
                    text
                        .setPlaceholder("5000")
                        .setValue(String(this.plugin.settings.syncDebounceMs))
                        .onChange(async (value) => {
                            const num = parseInt(value, 10);
                            if (!isNaN(num) && num >= 0) {
                                this.plugin.settings.syncDebounceMs = num;
                                await this.plugin.saveSettings();
                            }
                        }),
                );
        }
    }

    async checkEndpoint(url: string, statusEl: HTMLSpanElement): Promise<void> {
        statusEl.empty();
        statusEl.classList.remove("lilbee-health-ok", "lilbee-health-error");
        const dot = statusEl.createDiv({ cls: "lilbee-health-dot" });
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
            const response = await globalThis.fetch(url, { signal: controller.signal });
            clearTimeout(timeout);
            const ok = response.ok;
            dot.classList.add(ok ? "is-ok" : "is-error");
            statusEl.classList.add(ok ? "lilbee-health-ok" : "lilbee-health-error");
        } catch {
            dot.classList.add("is-error");
            statusEl.classList.add("lilbee-health-error");
        }
    }

    private async loadModels(container: HTMLElement): Promise<void> {
        container.empty();
        try {
            const models = await this.plugin.api.listModels();
            this.renderModelSection(container, "Chat Model", models.chat, MODEL_TYPE.CHAT);
            this.renderModelSection(container, "Vision Model", models.vision, MODEL_TYPE.VISION);
        } catch {
            container.createEl("p", {
                text: "Could not connect to lilbee server. Is it running?",
                cls: "mod-warning",
            });
        }
    }

    private renderModelSection(
        container: HTMLElement,
        label: string,
        catalog: ModelsResponse["chat"],
        type: ModelType,
    ): void {
        const section = container.createDiv("lilbee-model-section");
        section.createEl("h4", { text: label });

        const activeSetting = new Setting(section)
            .setName(`Active ${type} model`)
            .setDesc(catalog.active || (type === MODEL_TYPE.VISION ? "Disabled" : "Not set"));

        const options = buildModelOptions(catalog, type);

        activeSetting.addDropdown((dropdown) =>
            dropdown
                .addOptions(options)
                .setValue(catalog.active)
                .onChange(async (value) => {
                    if (value === SEPARATOR_KEY) return;
                    await this.handleModelChange(value, catalog, label, type, container);
                }),
        );

        const catalogEl = section.createDiv("lilbee-model-catalog");
        const table = catalogEl.createEl("table");
        const header = table.createEl("tr");
        header.createEl("th", { text: "Model" });
        header.createEl("th", { text: "Size" });
        header.createEl("th", { text: "Description" });
        header.createEl("th", { text: "" });

        for (const model of catalog.catalog) {
            this.renderCatalogRow(table, model, type);
        }
    }

    private async setModel(model: { name: string }, type: ModelType): Promise<void> {
        if (type === MODEL_TYPE.CHAT) {
            await this.plugin.api.setChatModel(model.name);
        } else {
            await this.plugin.api.setVisionModel(model.name);
        }
    }

    private async handleModelChange(
        value: string,
        catalog: ModelCatalog,
        label: string,
        type: ModelType,
        container: HTMLElement,
    ): Promise<void> {
        const uninstalledCatalogModel = catalog.catalog.find(
            (m) => m.name === value && !m.installed,
        );
        if (uninstalledCatalogModel) {
            const modal = new ConfirmPullModal(this.app, uninstalledCatalogModel);
            modal.open();
            const confirmed = await modal.result;
            if (!confirmed) return;
            await this.pullQueue.enqueue(
                () => this.autoPullAndSet(uninstalledCatalogModel, type, container),
                uninstalledCatalogModel.name,
            );
            return;
        }
        try {
            await this.setModel({ name: value }, type);
            new Notice(`${label} set to ${value || "disabled"}`);
            this.display();
        } catch {
            new Notice(`Failed to set ${type} model`);
        }
    }

    private async autoPullAndSet(
        model: ModelInfo,
        type: ModelType,
        container: HTMLElement,
    ): Promise<void> {
        new Notice(`lilbee: pulling ${model.name}...`);
        const controller = new AbortController();
        this.pullAbortController = controller;
        const banner = container.createDiv("lilbee-pull-banner");
        const label = banner.createEl("span", { text: `Pulling ${model.name}...` });
        const cancelBtn = banner.createEl("button", { text: "Cancel", cls: "lilbee-pull-banner-cancel" });
        cancelBtn.addEventListener("click", () => controller.abort(), { once: true });
        try {
            for await (const progress of this.plugin.api.pullModel(
                model.name,
                controller.signal,
            )) {
                if (progress.total && progress.completed !== undefined) {
                    const pct = Math.round((progress.completed / progress.total) * 100);
                    label.textContent = `Pulling ${model.name} — ${pct}%`;
                    if (this.plugin.statusBarEl) {
                        this.plugin.statusBarEl.setText(
                            `lilbee: pulling ${model.name} — ${pct}%`,
                        );
                    }
                }
            }
            await this.setModel(model, type);
            new Notice(`lilbee: ${model.name} pulled and activated`);
            this.plugin.fetchActiveModel();
            this.display();
        } catch (err) {
            if (err instanceof Error && err.name === "AbortError") {
                new Notice(NOTICE.PULL_CANCELLED);
            } else {
                new Notice(`lilbee: failed to pull ${model.name}`);
            }
        } finally {
            banner.remove();
            this.pullAbortController = null;
        }
    }

    private renderCatalogRow(
        table: HTMLTableElement,
        model: ModelInfo,
        type: ModelType,
    ): void {
        const row = table.createEl("tr");
        row.createEl("td", { text: model.name });
        row.createEl("td", { text: `${model.size_gb} GB` });
        row.createEl("td", { text: model.description });
        const actionCell = row.createEl("td");

        if (model.installed) {
            actionCell.createEl("span", { text: "Installed", cls: "lilbee-installed" });
            const deleteBtn = actionCell.createEl("button", { cls: "lilbee-model-delete" }) as HTMLButtonElement;
            setIcon(deleteBtn, "trash-2");
            deleteBtn.setAttribute("aria-label", "Delete model");
            deleteBtn.addEventListener("click", () => this.deleteModel(deleteBtn, model, type));
        } else {
            const btn = actionCell.createEl("button", { text: "Pull" }) as HTMLButtonElement;
            btn.addEventListener("click", () => {
                if (this.pullQueue.isPulling) {
                    this.pullAbortController?.abort();
                    return;
                }
                return this.pullModel(btn, actionCell, model, type);
            });
        }
    }

    private async pullModel(
        btn: HTMLButtonElement,
        actionCell: HTMLElement,
        model: ModelInfo,
        type: ModelType,
    ): Promise<void> {
        await this.pullQueue.enqueue(
            () => this.executePull(btn, actionCell, model, type),
            model.name,
        );
    }

    private async executePull(
        btn: HTMLButtonElement,
        actionCell: HTMLElement,
        model: ModelInfo,
        type: ModelType,
    ): Promise<void> {
        const controller = new AbortController();
        this.pullAbortController = controller;
        btn.textContent = "Cancel";
        const progress = actionCell.createDiv("lilbee-pull-progress");
        try {
            for await (const p of this.plugin.api.pullModel(
                model.name,
                controller.signal,
            )) {
                if (p.total && p.completed !== undefined) {
                    const pct = Math.round((p.completed / p.total) * 100);
                    progress.textContent = `${pct}%`;
                    if (this.plugin.statusBarEl) {
                        this.plugin.statusBarEl.setText(`lilbee: pulling ${model.name} — ${pct}%`);
                    }
                }
            }
            new Notice(`lilbee: ${model.name} pulled successfully`);
            await this.setModel(model, type);
            this.plugin.fetchActiveModel();
            this.display();
        } catch (err) {
            if (err instanceof Error && err.name === "AbortError") {
                new Notice(NOTICE.PULL_CANCELLED);
            } else {
                new Notice(`lilbee: failed to pull ${model.name}`);
            }
            btn.disabled = false;
            btn.textContent = "Pull";
        } finally {
            progress.remove();
            this.pullAbortController = null;
        }
    }

    private async deleteModel(
        btn: HTMLButtonElement,
        model: ModelInfo,
        type: ModelType,
    ): Promise<void> {
        btn.disabled = true;
        try {
            await this.plugin.api.deleteModel(model.name);
            new Notice(`Deleted ${model.name}`);
            if (type === MODEL_TYPE.CHAT && model.name === this.plugin.activeModel) {
                await this.plugin.api.setChatModel("");
                this.plugin.activeModel = "";
            } else if (type === MODEL_TYPE.VISION && model.name === this.plugin.activeVisionModel) {
                await this.plugin.api.setVisionModel("");
                this.plugin.activeVisionModel = "";
            }
            this.plugin.fetchActiveModel();
            const modelsContainer = this.containerEl.querySelector(`.${CLS_MODELS_CONTAINER}`);
            if (modelsContainer instanceof HTMLElement) {
                await this.loadModels(modelsContainer);
            }
        } catch {
            new Notice(`Failed to delete ${model.name}`);
            btn.disabled = false;
        }
    }
}
