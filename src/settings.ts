import { App, Notice, PluginSettingTab, setIcon, Setting } from "obsidian";
import type LilbeePlugin from "./main";
import type { ModelCatalog, ModelInfo, ModelsResponse, OllamaModelDefaults } from "./types";

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
    type: "chat" | "vision",
): Record<string, string> {
    const options: Record<string, string> = {};
    if (type === "vision") {
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
const GEN_DEFAULTS_MAP: Record<GenKey, keyof OllamaModelDefaults> = {
    temperature: "temperature",
    top_p: "top_p",
    top_k_sampling: "top_k",
    repeat_penalty: "repeat_penalty",
    num_ctx: "num_ctx",
    seed: "seed",
};

export class LilbeeSettingTab extends PluginSettingTab {
    plugin: LilbeePlugin;
    private pulling = false;
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
                    .addOption("managed", "Managed (built-in)")
                    .addOption("external", "External (manual)")
                    .setValue(this.plugin.settings.serverMode)
                    .onChange(async (value) => {
                        this.plugin.settings.serverMode = value as "managed" | "external";
                        await this.plugin.saveSettings();
                        this.display();
                    }),
            );

        if (this.plugin.settings.serverMode === "managed") {
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
        void this.checkEndpoint(this.plugin.settings.ollamaUrl, ollamaStatusEl);

        ollamaSetting.addButton((btn) =>
            btn.setButtonText("Test").onClick(async () => {
                await this.checkEndpoint(this.plugin.settings.ollamaUrl, ollamaStatusEl);
            }),
        );
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

        new Setting(containerEl)
            .setName("Server port")
            .setDesc("Port for the managed lilbee server")
            .addText((text) =>
                text
                    .setPlaceholder("7433")
                    .setValue(String(this.plugin.settings.serverPort))
                    .onChange(async (value) => {
                        const num = parseInt(value, 10);
                        if (!isNaN(num) && num > 0 && num <= 65535) {
                            this.plugin.settings.serverPort = num;
                            await this.plugin.saveSettings();
                        }
                    }),
            );

        new Setting(containerEl)
            .setName("Check for updates")
            .setDesc("Check if a newer lilbee binary is available")
            .addButton((btn) =>
                btn.setButtonText("Check").onClick(async () => {
                    try {
                        const { getLatestRelease, checkForUpdate } = await import("./binary-manager");
                        const release = await getLatestRelease();
                        if (checkForUpdate(this.plugin.settings.lilbeeVersion, release.tag)) {
                            new Notice(`lilbee: update available (${release.tag})`);
                        } else {
                            new Notice("lilbee: already up to date");
                        }
                    } catch {
                        new Notice("lilbee: could not check for updates");
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
        void this.checkEndpoint(`${this.plugin.settings.serverUrl}/api/health`, serverStatusEl);

        serverSetting.addButton((btn) =>
            btn.setButtonText("Test").onClick(async () => {
                await this.checkEndpoint(`${this.plugin.settings.serverUrl}/api/health`, serverStatusEl);
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
        this.plugin.ollama.show(model).then((defaults) => {
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
        statusEl.setText("checking...");
        statusEl.classList.remove("lilbee-health-ok", "lilbee-health-error");
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
            const response = await fetch(url, { signal: controller.signal });
            clearTimeout(timeout);
            statusEl.setText(response.ok ? " \u2713 reachable" : ` \u2717 ${response.status}`);
            statusEl.classList.add(response.ok ? "lilbee-health-ok" : "lilbee-health-error");
        } catch {
            statusEl.setText(" \u2717 not reachable");
            statusEl.classList.add("lilbee-health-error");
        }
    }

    private async loadModels(container: HTMLElement): Promise<void> {
        container.empty();
        try {
            const models = await this.plugin.api.listModels();
            this.renderModelSection(container, "Chat Model", models.chat, "chat");
            this.renderModelSection(container, "Vision Model", models.vision, "vision");
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
        type: "chat" | "vision",
    ): void {
        const section = container.createDiv("lilbee-model-section");
        section.createEl("h4", { text: label });

        const activeSetting = new Setting(section)
            .setName(`Active ${type} model`)
            .setDesc(catalog.active || (type === "vision" ? "Disabled" : "Not set"));

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

    private async handleModelChange(
        value: string,
        catalog: ModelCatalog,
        label: string,
        type: "chat" | "vision",
        container: HTMLElement,
    ): Promise<void> {
        const uninstalledCatalogModel = catalog.catalog.find(
            (m) => m.name === value && !m.installed,
        );
        if (uninstalledCatalogModel) {
            await this.autoPullAndSet(uninstalledCatalogModel, type, container);
            return;
        }
        try {
            if (type === "chat") {
                await this.plugin.api.setChatModel(value);
            } else {
                await this.plugin.api.setVisionModel(value);
            }
            new Notice(`${label} set to ${value || "disabled"}`);
            this.display();
        } catch {
            new Notice(`Failed to set ${type} model`);
        }
    }

    private async autoPullAndSet(
        model: ModelInfo,
        type: "chat" | "vision",
        container: HTMLElement,
    ): Promise<void> {
        if (this.pulling) return;
        this.pulling = true;
        new Notice(`Pulling ${model.name}...`);
        const controller = new AbortController();
        const banner = container.createDiv("lilbee-pull-banner");
        const label = banner.createEl("span", { text: `Pulling ${model.name}...` });
        const cancelBtn = banner.createEl("button", { text: "Cancel", cls: "lilbee-pull-banner-cancel" });
        cancelBtn.addEventListener("click", () => controller.abort(), { once: true });
        try {
            for await (const progress of this.plugin.ollama.pull(
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
            if (type === "chat") {
                await this.plugin.api.setChatModel(model.name);
            } else {
                await this.plugin.api.setVisionModel(model.name);
            }
            new Notice(`Model ${model.name} pulled and activated`);
            this.plugin.fetchActiveModel();
            this.display();
        } catch (err) {
            if (err instanceof Error && err.name === "AbortError") {
                new Notice("Pull cancelled");
            } else {
                new Notice(`Failed to pull ${model.name}`);
            }
        } finally {
            banner.remove();
            this.pulling = false;
        }
    }

    private renderCatalogRow(
        table: HTMLTableElement,
        model: ModelInfo,
        type: "chat" | "vision",
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
            btn.addEventListener("click", () => this.pullModel(btn, actionCell, model, type));
        }
    }

    private async pullModel(
        btn: HTMLButtonElement,
        actionCell: HTMLElement,
        model: ModelInfo,
        type: "chat" | "vision",
    ): Promise<void> {
        if (this.pulling) return;
        this.pulling = true;
        const controller = new AbortController();
        btn.textContent = "Cancel";
        btn.addEventListener("click", () => controller.abort(), { once: true });
        const progress = actionCell.createDiv("lilbee-pull-progress");
        try {
            for await (const p of this.plugin.ollama.pull(
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
            new Notice(`Model ${model.name} pulled successfully`);
            if (type === "chat") {
                await this.plugin.api.setChatModel(model.name);
            } else {
                await this.plugin.api.setVisionModel(model.name);
            }
            this.plugin.fetchActiveModel();
            this.display();
        } catch (err) {
            if (err instanceof Error && err.name === "AbortError") {
                new Notice("Pull cancelled");
            } else {
                new Notice(`Failed to pull ${model.name}`);
            }
            btn.disabled = false;
            btn.textContent = "Pull";
        } finally {
            progress.remove();
            this.pulling = false;
        }
    }

    private async deleteModel(
        btn: HTMLButtonElement,
        model: ModelInfo,
        type: "chat" | "vision",
    ): Promise<void> {
        btn.disabled = true;
        try {
            await this.plugin.ollama.delete(model.name);
            new Notice(`Deleted ${model.name}`);
            if (type === "chat" && model.name === this.plugin.activeModel) {
                await this.plugin.api.setChatModel("");
                this.plugin.activeModel = "";
            } else if (type === "vision" && model.name === this.plugin.activeVisionModel) {
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
