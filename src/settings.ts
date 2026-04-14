import { App, Notice, PluginSettingTab, setIcon, Setting } from "obsidian";
import type LilbeePlugin from "./main";
import type { ReleaseInfo } from "./binary-manager";
import { DEFAULT_SETTINGS, SERVER_MODE, SERVER_STATE, SSE_EVENT, SYNC_MODE, TASK_TYPE, ERROR_NAME } from "./types";
import type { GenerationOptions, ModelCatalog, ModelInfo, ModelsResponse, ServerMode } from "./types";
import { MESSAGES } from "./locales/en";
import { CatalogModal } from "./views/catalog-modal";
import { ConfirmModal } from "./views/confirm-modal";
import { ConfirmPullModal } from "./views/confirm-pull-modal";
import { SetupWizard } from "./views/setup-wizard";

const CHECK_TIMEOUT_MS = 5000;
const CLS_MODELS_CONTAINER = "lilbee-models-container";
const SEPARATOR_KEY = "__separator__";
const SEPARATOR_LABEL = "\u2500\u2500 Other... \u2500\u2500";

/**
 * Remove `:latest` entries when a more specific tag of the same model exists.
 * e.g. if both `mistral:latest` and `mistral:7b` are present, drop `mistral:latest`.
 */
export function deduplicateLatest(models: string[]): string[] {
    const bases = new Set(models.filter((m) => !m.endsWith(":latest")).map((m) => m.split(":")[0]));
    return models.filter((m) => {
        if (!m.endsWith(":latest")) return true;
        return !bases.has(m.split(":")[0]);
    });
}

export function buildModelOptions(catalog: ModelCatalog): Record<string, string> {
    const options: Record<string, string> = {};

    const catalogNames = new Set(catalog.catalog.map((m) => m.name));
    for (const model of catalog.catalog) {
        const suffix = model.installed ? "" : MESSAGES.LABEL_NOT_INSTALLED;
        options[model.name] = `${model.name}${suffix}`;
    }

    const otherInstalled = deduplicateLatest(catalog.installed.filter((name) => !catalogNames.has(name))).sort();

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
const GEN_DEFAULTS_MAP: Record<GenKey, keyof GenerationOptions> = {
    temperature: "temperature",
    top_p: "top_p",
    top_k_sampling: "top_k",
    repeat_penalty: "repeat_penalty",
    num_ctx: "num_ctx",
    seed: "seed",
};

export class LilbeeSettingTab extends PluginSettingTab {
    plugin: LilbeePlugin;
    private pullAbortController: AbortController | null = null;
    private genInputs: Map<GenKey, HTMLInputElement> = new Map();
    private serverConfigInputs: Map<string, HTMLInputElement> = new Map();

    constructor(app: App, plugin: LilbeePlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        this.serverConfigInputs.clear();

        const filterInput = containerEl.createEl("input", {
            cls: "lilbee-settings-filter",
            placeholder: MESSAGES.PLACEHOLDER_FILTER_SETTINGS,
            attr: { type: "text" },
        });
        filterInput.addEventListener("input", () => {
            this.filterSettings(containerEl, (filterInput as unknown as HTMLInputElement).value);
        });

        this.renderConnectionSettings(containerEl);
        this.renderModelsSection(containerEl);
        this.renderSearchRetrievalSettings(containerEl);
        this.renderGenerationSettings(containerEl);
        this.renderSyncSettings(containerEl);
        this.renderCrawlingSettings(containerEl);
        this.renderWikiSettings(containerEl);
        this.renderAdvancedSettings(containerEl);
        this.loadModelDefaults();
    }

    private filterSettings(containerEl: HTMLElement, query: string): void {
        const term = query.trim().toLowerCase();
        const sections = containerEl.querySelectorAll(".lilbee-settings-section");
        for (const section of Array.from(sections)) {
            const items = section.querySelectorAll(".setting-item");
            let visibleCount = 0;
            for (const item of Array.from(items)) {
                const nameEl = item.querySelector(".setting-item-name");
                const name = nameEl?.textContent?.toLowerCase() ?? "";
                const matches = !term || name.includes(term);
                (item as HTMLElement).style.display = matches ? "" : "none";
                if (matches) visibleCount++;
            }
            (section as HTMLElement).style.display = visibleCount > 0 || !term ? "" : "none";
            if (term && visibleCount > 0) {
                section.setAttribute("open", "");
            }
        }
    }

    private renderConnectionSettings(containerEl: HTMLElement): void {
        new Setting(containerEl)
            .setName(MESSAGES.LABEL_SERVER_MODE)
            .setDesc(MESSAGES.DESC_SERVER_MODE)
            .addDropdown((dropdown) =>
                dropdown
                    .addOption(SERVER_MODE.MANAGED, MESSAGES.DESC_MANAGED_BUILTIN)
                    .addOption(SERVER_MODE.EXTERNAL, MESSAGES.DESC_EXTERNAL_MANUAL)
                    .setValue(this.plugin.settings.serverMode)
                    .onChange(async (value) => {
                        this.plugin.settings.serverMode = value as ServerMode;
                        await this.plugin.saveSettings();
                        this.display();
                    }),
            );

        new Setting(containerEl)
            .setName(MESSAGES.LABEL_SETUP_WIZARD)
            .setDesc(MESSAGES.DESC_SETUP_WIZARD)
            .addButton((btn) =>
                btn.setButtonText(MESSAGES.BUTTON_RUN_SETUP_WIZARD).onClick(() => {
                    new SetupWizard(this.app, this.plugin).open();
                }),
            );

        if (this.plugin.settings.serverMode === SERVER_MODE.MANAGED) {
            this.renderManagedSettings(containerEl);
        } else {
            this.renderExternalSettings(containerEl);
        }
    }

    private renderManagedSettings(containerEl: HTMLElement): void {
        const statusSetting = new Setting(containerEl)
            .setName(MESSAGES.LABEL_SERVER_STATUS)
            .setDesc(MESSAGES.DESC_SERVER_STATUS_CURRENT);

        const statusEl = statusSetting.settingEl.createDiv({ cls: "lilbee-server-status" });
        const dot = statusEl.createDiv({ cls: "lilbee-server-dot" });
        const stateText = statusEl.createEl("span");

        const serverState = this.plugin.serverManager?.state ?? "stopped";
        stateText.textContent = serverState;
        dot.classList.add(`is-${serverState}`);

        const controlSetting = new Setting(containerEl)
            .setName(MESSAGES.LABEL_SERVER_CONTROLS)
            .setDesc(MESSAGES.DESC_SERVER_CONTROLS_START_STOP);

        if (serverState === SERVER_STATE.STOPPED || serverState === SERVER_STATE.ERROR) {
            controlSetting.addButton((btn) =>
                btn.setButtonText(MESSAGES.BUTTON_START).onClick(async () => {
                    await this.plugin.startManagedServer();
                    this.display();
                }),
            );
        }
        if (serverState === SERVER_STATE.READY || serverState === SERVER_STATE.STARTING) {
            controlSetting.addButton((btn) =>
                btn.setButtonText(MESSAGES.BUTTON_STOP).onClick(async () => {
                    await this.plugin.serverManager?.stop();
                    this.display();
                }),
            );
        }
        if (serverState === SERVER_STATE.READY) {
            controlSetting.addButton((btn) =>
                btn.setButtonText(MESSAGES.BUTTON_RESTART).onClick(async () => {
                    await this.plugin.serverManager?.restart();
                    this.display();
                }),
            );
        }

        new Setting(containerEl)
            .setName(MESSAGES.LABEL_SERVER_PORT)
            .setDesc(MESSAGES.DESC_SERVER_PORT_HELP)
            .addText((text) =>
                text
                    .setPlaceholder(MESSAGES.PLACEHOLDER_AUTO)
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
            .setName(MESSAGES.LABEL_SERVER_VERSION)
            .setDesc(this.plugin.settings.lilbeeVersion || MESSAGES.DESC_SERVER_VERSION_UNKNOWN);

        let pendingRelease: ReleaseInfo | null = null;
        updateSetting.addButton((checkBtn) =>
            checkBtn.setButtonText(MESSAGES.BUTTON_CHECK_UPDATES).onClick(async () => {
                if (pendingRelease) {
                    const release = pendingRelease;
                    checkBtn.setDisabled(true);
                    checkBtn.setButtonText(MESSAGES.STATUS_DOWNLOADING);
                    try {
                        await this.plugin.updateServer(release, (msg) => {
                            checkBtn.setButtonText(msg);
                        });
                        new Notice(MESSAGES.NOTICE_UPDATED_TO(release.tag));
                        this.display();
                    } catch (err) {
                        new Notice(MESSAGES.ERROR_FAILED_UPDATE);
                        console.error("[lilbee] update failed:", err);
                        pendingRelease = null;
                        checkBtn.setButtonText(MESSAGES.BUTTON_CHECK_UPDATES);
                        checkBtn.setDisabled(false);
                    }
                    return;
                }

                checkBtn.setDisabled(true);
                checkBtn.setButtonText(MESSAGES.STATUS_CHECKING_CONNECTION);
                try {
                    const result = await this.plugin.checkForUpdate();
                    if (result.available && result.release) {
                        pendingRelease = result.release;
                        checkBtn.setButtonText(`Update to ${result.release.tag}`);
                        checkBtn.setDisabled(false);
                    } else {
                        new Notice(MESSAGES.ERROR_ALREADY_UPTODATE);
                        checkBtn.setButtonText(MESSAGES.BUTTON_CHECK_UPDATES);
                        checkBtn.setDisabled(false);
                    }
                } catch {
                    new Notice(MESSAGES.ERROR_COULD_NOT_CHECK);
                    checkBtn.setButtonText(MESSAGES.BUTTON_CHECK_UPDATES);
                    checkBtn.setDisabled(false);
                }
            }),
        );
    }

    private renderExternalSettings(containerEl: HTMLElement): void {
        const serverSetting = new Setting(containerEl)
            .setName(MESSAGES.LABEL_SERVER_URL)
            .setDesc(MESSAGES.DESC_SERVER_URL_HELP)
            .addText((text) =>
                text
                    .setPlaceholder(MESSAGES.PLACEHOLDER_HTTP_LOCALHOST)
                    .setValue(this.plugin.settings.serverUrl)
                    .onChange(async (value) => {
                        this.plugin.settings.serverUrl = value;
                        await this.plugin.saveSettings();
                    }),
            );

        const serverStatusEl = serverSetting.settingEl.createEl("span", { cls: "lilbee-health-status" });

        serverSetting.addButton((btn) =>
            btn.setButtonText(MESSAGES.BUTTON_TEST).onClick(async () => {
                await this.checkEndpoint(`${this.plugin.settings.serverUrl}/api/health`, serverStatusEl);
            }),
        );

        void this.checkEndpoint(`${this.plugin.settings.serverUrl}/api/health`, serverStatusEl);

        new Setting(containerEl).setName(MESSAGES.LABEL_SESSION_TOKEN).setDesc(MESSAGES.DESC_SESSION_TOKEN_AUTO);

        new Setting(containerEl)
            .setName(MESSAGES.LABEL_SWITCH_MANAGED)
            .setDesc(MESSAGES.DESC_SWITCH_MANAGED)
            .addButton((btn) =>
                btn.setButtonText(MESSAGES.BUTTON_RESET_MANAGED).onClick(async () => {
                    this.plugin.settings.serverMode = SERVER_MODE.MANAGED;
                    this.plugin.settings.serverUrl = DEFAULT_SETTINGS.serverUrl;
                    await this.plugin.saveSettings();
                    this.display();
                }),
            );
    }

    private renderModelsSection(containerEl: HTMLElement): void {
        containerEl.createEl("h3", { text: MESSAGES.LABEL_MODELS });
        containerEl.createEl("p", {
            text: MESSAGES.DESC_MODELS_HELP,
            cls: "setting-item-description",
        });

        const modelsContainer = containerEl.createDiv(CLS_MODELS_CONTAINER);
        const modelSettings = new Setting(containerEl)
            .setName(MESSAGES.LABEL_REFRESH_MODELS)
            .setDesc(MESSAGES.DESC_REFRESH_MODELS)
            .addButton((btn) =>
                btn.setButtonText(MESSAGES.BUTTON_REFRESH).onClick(async () => {
                    await this.loadModels(modelsContainer);
                }),
            );
        modelSettings.addButton((btn) =>
            btn.setButtonText(MESSAGES.BUTTON_BROWSE_CATALOG).onClick(() => {
                new CatalogModal(this.app, this.plugin).open();
            }),
        );

        this.loadModels(modelsContainer);
    }

    private renderSearchRetrievalSettings(containerEl: HTMLElement): void {
        containerEl.createEl("h3", { text: MESSAGES.LABEL_SEARCH_RETRIEVAL });

        new Setting(containerEl)
            .setName(MESSAGES.LABEL_RESULTS_COUNT)
            .setDesc(MESSAGES.DESC_RESULTS_COUNT)
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

        new Setting(containerEl)
            .setName(MESSAGES.LABEL_MAX_DISTANCE)
            .setDesc(MESSAGES.DESC_MAX_DISTANCE)
            .addSlider((slider) =>
                slider
                    .setLimits(0.1, 1.0, 0.1)
                    .setValue(this.plugin.settings.maxDistance ?? 0.9)
                    .setDynamicTooltip()
                    .onChange(async (value) => {
                        this.plugin.settings.maxDistance = value;
                        await this.plugin.saveSettings();
                    }),
            );

        new Setting(containerEl)
            .setName(MESSAGES.LABEL_ADAPTIVE_THRESHOLD)
            .setDesc(MESSAGES.DESC_ADAPTIVE_THRESHOLD)
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.adaptiveThreshold ?? false).onChange(async (value) => {
                    this.plugin.settings.adaptiveThreshold = value;
                    await this.plugin.saveSettings();
                }),
            );

        const serverDefaultsEl = containerEl.createDiv({ cls: "lilbee-server-defaults" });
        this.loadServerDefaults(serverDefaultsEl);
    }

    private loadServerDefaults(container: HTMLElement): void {
        this.plugin.api
            .config()
            .then((cfg: Record<string, unknown>) => {
                container.empty();
                const fields: [string, string][] = [
                    ["chunk_size", MESSAGES.DESC_CHUNK_SIZE],
                    ["chunk_overlap", MESSAGES.DESC_CHUNK_OVERLAP],
                    ["embedding_model", MESSAGES.LABEL_EMBEDDING_MODEL],
                ];
                for (const [key, label] of fields) {
                    if (cfg[key] !== undefined) {
                        new Setting(container).setName(label).setDesc(String(cfg[key]));
                    }
                }
                // Populate editable crawl and advanced inputs with current server values
                for (const [key, inputEl] of this.serverConfigInputs) {
                    if (cfg[key] !== undefined) {
                        inputEl.value = String(cfg[key]);
                    }
                }
            })
            .catch(() => {
                container.empty();
                container.createEl("p", { text: MESSAGES.ERROR_SERVER_UNREACHABLE, cls: "mod-warning" });
            });
    }

    private renderGenerationSettings(containerEl: HTMLElement): void {
        const details = containerEl.createEl("details", { cls: "lilbee-generation-details lilbee-settings-section" });
        const modelLabel = this.plugin.activeModel || MESSAGES.LABEL_NO_MODEL_SELECTED;
        details.createEl("summary", { text: `${MESSAGES.LABEL_GENERATION} (${modelLabel})` });

        new Setting(details)
            .setName(MESSAGES.LABEL_SYSTEM_PROMPT)
            .setDesc(MESSAGES.DESC_SYSTEM_PROMPT)
            .addText((text) =>
                text
                    .setPlaceholder(MESSAGES.PLACEHOLDER_DEFAULT)
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
                    text.setPlaceholder(MESSAGES.PLACEHOLDER_NOT_SET)
                        .setValue(
                            this.plugin.settings[field.key] !== null ? String(this.plugin.settings[field.key]) : "",
                        )
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
        this.plugin.api
            .showModel(model)
            .then((defaults: Record<string, unknown>) => {
                for (const [key, inputEl] of this.genInputs) {
                    const genKey = GEN_DEFAULTS_MAP[key];
                    const val = defaults[genKey];
                    if (val !== undefined) {
                        inputEl.placeholder = String(val);
                    }
                }
            })
            .catch(() => {
                // Server unreachable — leave "Not set" placeholders
            });
    }

    private renderSyncSettings(containerEl: HTMLElement): void {
        new Setting(containerEl)
            .setName(MESSAGES.LABEL_SYNC_MODE)
            .setDesc(MESSAGES.DESC_SYNC_MODE)
            .addDropdown((dropdown) =>
                dropdown
                    .addOption("manual", MESSAGES.DESC_SYNC_MANUAL)
                    .addOption("auto", MESSAGES.DESC_SYNC_AUTO)
                    .setValue(this.plugin.settings.syncMode)
                    .onChange(async (value) => {
                        this.plugin.settings.syncMode = value as "manual" | "auto";
                        await this.plugin.saveSettings();
                        this.display();
                    }),
            );

        if (this.plugin.settings.syncMode === SYNC_MODE.AUTO) {
            new Setting(containerEl)
                .setName(MESSAGES.LABEL_SYNC_DEBOUNCE)
                .setDesc(MESSAGES.DESC_SYNC_DEBOUNCE)
                .addText((text) =>
                    text
                        .setPlaceholder(MESSAGES.PLACEHOLDER_5000)
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

    private renderCrawlingSettings(containerEl: HTMLElement): void {
        containerEl.createEl("h3", { text: MESSAGES.LABEL_CRAWLING });

        const crawlFields: { key: string; name: string; desc: string; placeholder: string }[] = [
            {
                key: "crawl_max_depth",
                name: "Max depth",
                desc: MESSAGES.DESC_CRAWL_MAX_DEPTH,
                placeholder: MESSAGES.PLACEHOLDER_0,
            },
            {
                key: "crawl_max_pages",
                name: "Max pages",
                desc: MESSAGES.DESC_CRAWL_MAX_PAGES,
                placeholder: MESSAGES.PLACEHOLDER_50,
            },
            {
                key: "crawl_timeout",
                name: "Timeout (seconds)",
                desc: MESSAGES.DESC_CRAWL_TIMEOUT,
                placeholder: MESSAGES.PLACEHOLDER_30,
            },
        ];

        for (const field of crawlFields) {
            new Setting(containerEl)
                .setName(field.name)
                .setDesc(field.desc)
                .addText((text) => {
                    text.setPlaceholder(field.placeholder)
                        .setValue("")
                        .onChange(async (value) => {
                            const trimmed = value.trim();
                            if (trimmed === "") return;
                            const num = parseInt(trimmed, 10);
                            if (isNaN(num) || num < 0) return;
                            try {
                                await this.plugin.api.updateConfig({ [field.key]: num });
                                new Notice(MESSAGES.NOTICE_FIELD_UPDATED(field.name));
                            } catch {
                                new Notice(MESSAGES.NOTICE_FAILED_UPDATE(field.name));
                            }
                        });
                    this.serverConfigInputs.set(field.key, text.inputEl as unknown as HTMLInputElement);
                });
        }
    }

    private renderWikiSettings(containerEl: HTMLElement): void {
        const wikiEnabled = this.plugin.wikiEnabled;
        const heading = wikiEnabled ? MESSAGES.LABEL_WIKI_SECTION : MESSAGES.LABEL_WIKI_NOT_ENABLED;
        const details = containerEl.createEl("details", { cls: "lilbee-advanced-details lilbee-settings-section" });
        details.createEl("summary", { text: heading });

        if (!wikiEnabled) {
            details.createEl("p", {
                text: MESSAGES.DESC_WIKI_NOT_ENABLED,
                cls: "setting-item-description",
            });
            return;
        }

        // Wiki status (display only)
        const statusDesc = `Enabled — ${this.plugin.wikiPageCount} pages, ${this.plugin.wikiDraftCount} drafts`;
        new Setting(details).setName(MESSAGES.LABEL_WIKI_STATUS).setDesc(statusDesc).setDisabled(true);

        // Prune raw chunks
        new Setting(details)
            .setName(MESSAGES.LABEL_WIKI_PRUNE_RAW)
            .setDesc(MESSAGES.DESC_WIKI_PRUNE_RAW)
            .addToggle((toggle) => {
                toggle.setValue(this.plugin.settings.wikiPruneRaw);
                toggle.onChange(async (value) => {
                    this.plugin.settings.wikiPruneRaw = value;
                    await this.plugin.saveSettings();
                    try {
                        await this.plugin.api.updateConfig({ wiki_prune_raw: value });
                        new Notice(MESSAGES.NOTICE_FIELD_UPDATED("prune raw"));
                    } catch {
                        new Notice(MESSAGES.NOTICE_FAILED_UPDATE("prune raw"));
                    }
                });
            });

        // Faithfulness threshold
        new Setting(details)
            .setName(MESSAGES.LABEL_WIKI_FAITHFULNESS)
            .setDesc(MESSAGES.DESC_WIKI_FAITHFULNESS)
            .addSlider((slider) => {
                slider
                    .setLimits(0, 1, 0.05)
                    .setValue(this.plugin.settings.wikiFaithfulnessThreshold)
                    .setDynamicTooltip()
                    .onChange(async (value) => {
                        this.plugin.settings.wikiFaithfulnessThreshold = value;
                        await this.plugin.saveSettings();
                        try {
                            await this.plugin.api.updateConfig({ wiki_faithfulness_threshold: value });
                            new Notice(MESSAGES.NOTICE_FIELD_UPDATED("faithfulness threshold"));
                        } catch {
                            new Notice(MESSAGES.NOTICE_FAILED_UPDATE("faithfulness threshold"));
                        }
                    });
            });

        // Default search mode
        new Setting(details)
            .setName(MESSAGES.LABEL_WIKI_SEARCH_MODE)
            .setDesc(MESSAGES.DESC_WIKI_SEARCH_MODE)
            .addDropdown((dropdown) => {
                dropdown
                    .addOption("all", MESSAGES.LABEL_SEARCH_ALL)
                    .addOption("wiki", MESSAGES.LABEL_SEARCH_WIKI)
                    .addOption("raw", MESSAGES.LABEL_SEARCH_RAW)
                    .setValue(this.plugin.settings.searchChunkType)
                    .onChange(async (value) => {
                        this.plugin.settings.searchChunkType = value as "all" | "wiki" | "raw";
                        await this.plugin.saveSettings();
                    });
            });

        // Sync wiki to vault
        new Setting(details)
            .setName(MESSAGES.LABEL_WIKI_SYNC_TO_VAULT)
            .setDesc(MESSAGES.DESC_WIKI_SYNC_TO_VAULT)
            .addToggle((toggle) => {
                toggle.setValue(this.plugin.settings.wikiSyncToVault);
                toggle.onChange(async (value) => {
                    this.plugin.settings.wikiSyncToVault = value;
                    await this.plugin.saveSettings();
                    if (value && this.plugin.wikiEnabled) {
                        this.plugin.initWikiSync();
                        void this.plugin.reconcileWiki();
                    } else {
                        this.plugin.wikiSync = null;
                    }
                });
            });

        // Wiki vault folder
        new Setting(details)
            .setName(MESSAGES.LABEL_WIKI_VAULT_FOLDER)
            .setDesc(MESSAGES.DESC_WIKI_VAULT_FOLDER)
            .addText((text) => {
                text.setValue(this.plugin.settings.wikiVaultFolder);
                text.onChange(async (value) => {
                    this.plugin.settings.wikiVaultFolder = value || "lilbee-wiki";
                    await this.plugin.saveSettings();
                    if (this.plugin.settings.wikiSyncToVault && this.plugin.wikiEnabled) {
                        this.plugin.initWikiSync();
                    }
                });
            });

        // Run lint button
        new Setting(details).setName(MESSAGES.LABEL_WIKI_RUN_LINT).addButton((btn) => {
            btn.setButtonText(MESSAGES.LABEL_WIKI_RUN_LINT);
            btn.onClick(() => {
                void this.plugin.runWikiLint();
            });
        });

        // Run prune button
        new Setting(details).setName(MESSAGES.LABEL_WIKI_RUN_PRUNE).addButton((btn) => {
            btn.setButtonText(MESSAGES.LABEL_WIKI_RUN_PRUNE);
            btn.onClick(() => {
                void this.plugin.runWikiPrune();
            });
        });
    }

    private renderAdvancedSettings(containerEl: HTMLElement): void {
        const details = containerEl.createEl("details", { cls: "lilbee-advanced-details lilbee-settings-section" });
        details.createEl("summary", { text: MESSAGES.LABEL_ADVANCED });

        const advancedFields: { key: string; name: string; desc: string; reindex: boolean }[] = [
            { key: "chunk_size", name: MESSAGES.DESC_CHUNK_SIZE, desc: MESSAGES.DESC_CHUNK_SIZE, reindex: true },
            {
                key: "chunk_overlap",
                name: MESSAGES.DESC_CHUNK_OVERLAP,
                desc: MESSAGES.DESC_CHUNK_OVERLAP,
                reindex: true,
            },
        ];

        for (const field of advancedFields) {
            new Setting(details)
                .setName(field.name)
                .setDesc(field.desc)
                .addText((text) => {
                    text.setPlaceholder(MESSAGES.PLACEHOLDER_DEFAULT)
                        .setValue("")
                        .onChange(async (value) => {
                            const trimmed = value.trim();
                            if (trimmed === "") return;
                            const num = parseInt(trimmed, 10);
                            if (isNaN(num) || num < 0) return;
                            if (field.reindex) {
                                const confirmModal = new ConfirmModal(
                                    this.app,
                                    MESSAGES.DESC_REINDEX_WARNING.replace("{field}", field.name),
                                );
                                confirmModal.open();
                                const confirmed = await confirmModal.result;
                                if (!confirmed) return;
                            }
                            try {
                                const result = await this.plugin.api.updateConfig({ [field.key]: num });
                                new Notice(MESSAGES.NOTICE_FIELD_UPDATED(field.name));
                                if (result.reindex_required) {
                                    new Notice(MESSAGES.NOTICE_REINDEX_REQUIRED);
                                    void this.plugin.triggerSync();
                                }
                            } catch {
                                new Notice(MESSAGES.NOTICE_FAILED_UPDATE(field.name));
                            }
                        });
                    this.serverConfigInputs.set(field.key, text.inputEl as unknown as HTMLInputElement);
                });
        }

        new Setting(details)
            .setName(MESSAGES.LABEL_EMBEDDING_MODEL)
            .setDesc(MESSAGES.DESC_EMBEDDING_MODEL)
            .addText((text) => {
                text.setPlaceholder(MESSAGES.PLACEHOLDER_DEFAULT)
                    .setValue("")
                    .onChange(async (value) => {
                        const trimmed = value.trim();
                        if (trimmed === "") return;
                        const confirmModal = new ConfirmModal(this.app, MESSAGES.DESC_EMBEDDING_REINDEX_WARNING);
                        confirmModal.open();
                        const confirmed = await confirmModal.result;
                        if (!confirmed) return;
                        try {
                            await this.plugin.api.setEmbeddingModel(trimmed);
                            new Notice(MESSAGES.NOTICE_EMBEDDING_UPDATED);
                            new Notice(MESSAGES.NOTICE_REINDEX_REQUIRED);
                            void this.plugin.triggerSync();
                        } catch {
                            new Notice(MESSAGES.NOTICE_FAILED_EMBEDDING);
                        }
                    });
                this.serverConfigInputs.set("embedding_model", text.inputEl as unknown as HTMLInputElement);
            });

        new Setting(details)
            .setName(MESSAGES.LABEL_LLM_PROVIDER)
            .setDesc(MESSAGES.DESC_LLM_PROVIDER)
            .addDropdown((dropdown) => {
                dropdown
                    .addOption("auto", MESSAGES.DESC_LLM_PROVIDER_AUTO)
                    .addOption("llama-cpp", MESSAGES.DESC_LLM_PROVIDER_LOCAL)
                    .addOption("litellm", MESSAGES.DESC_LLM_PROVIDER_EXTERNAL)
                    .setValue("auto")
                    .onChange(async (value) => {
                        try {
                            await this.plugin.api.updateConfig({ llm_provider: value });
                            new Notice(MESSAGES.NOTICE_LLM_UPDATED);
                        } catch {
                            new Notice(MESSAGES.NOTICE_FAILED_LLM);
                        }
                    });
                this.serverConfigInputs.set("llm_provider", dropdown.selectEl as unknown as HTMLInputElement);
            });

        new Setting(details)
            .setName(MESSAGES.LABEL_API_KEY)
            .setDesc(MESSAGES.DESC_API_KEY)
            .addText((text) => {
                text.setPlaceholder(MESSAGES.PLACEHOLDER_SK)
                    .setValue("")
                    .onChange(async (value) => {
                        const trimmed = value.trim();
                        if (trimmed === "") return;
                        try {
                            await this.plugin.api.updateConfig({ llm_api_key: trimmed });
                            new Notice(MESSAGES.NOTICE_API_KEY_SAVED);
                        } catch {
                            new Notice(MESSAGES.NOTICE_FAILED_SAVE_KEY);
                        }
                    });
                text.inputEl.type = "password";
            });

        new Setting(details)
            .setName(MESSAGES.LABEL_HF_TOKEN)
            .setDesc(MESSAGES.DESC_HF_TOKEN)
            .addText((text) => {
                text.setPlaceholder(MESSAGES.PLACEHOLDER_HF_TOKEN)
                    .setValue(this.plugin.settings.hfToken)
                    .onChange(async (value) => {
                        const trimmed = value.trim();
                        this.plugin.settings.hfToken = trimmed;
                        await this.plugin.saveSettings();
                        try {
                            await this.plugin.api.updateConfig({ hf_token: trimmed });
                            new Notice(MESSAGES.NOTICE_HF_TOKEN_SAVED);
                        } catch {
                            new Notice(MESSAGES.NOTICE_FAILED_HF_TOKEN);
                        }
                    });
                text.inputEl.type = "password";
            });

        new Setting(details)
            .setName(MESSAGES.LABEL_LITELLM_BASE_URL)
            .setDesc(MESSAGES.DESC_LITELLM_BASE_URL)
            .addText((text) => {
                text.setPlaceholder("http://localhost:11434")
                    .setValue("")
                    .onChange(async (value) => {
                        const trimmed = value.trim();
                        if (trimmed === "") return;
                        try {
                            await this.plugin.api.updateConfig({ litellm_base_url: trimmed });
                            new Notice(MESSAGES.NOTICE_LITELLM_UPDATED);
                        } catch {
                            new Notice(MESSAGES.NOTICE_FAILED_LITELLM);
                        }
                    });
                this.serverConfigInputs.set("litellm_base_url", text.inputEl as unknown as HTMLInputElement);
            });
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
            this.renderModelSection(container, MESSAGES.LABEL_CHAT_MODEL, models.chat);
        } catch {
            // Connection status is shown via the Test button — no duplicate warning needed
        }
    }

    private renderModelSection(container: HTMLElement, label: string, catalog: ModelsResponse["chat"]): void {
        const section = container.createDiv("lilbee-model-section");
        section.createEl("h4", { text: label });

        const activeSetting = new Setting(section)
            .setName(`${MESSAGES.LABEL_ACTIVE} chat model`)
            .setDesc(catalog.active || MESSAGES.LABEL_NOT_SET);

        const options = buildModelOptions(catalog);

        activeSetting.addDropdown((dropdown) =>
            dropdown
                .addOptions(options)
                .setValue(catalog.active)
                .onChange(async (value) => {
                    if (value === SEPARATOR_KEY) return;
                    await this.handleModelChange(value, catalog, label, container);
                }),
        );

        const catalogEl = section.createDiv("lilbee-model-catalog");
        const table = catalogEl.createEl("table");
        const header = table.createEl("tr");
        header.createEl("th", { text: MESSAGES.LABEL_MODEL });
        header.createEl("th", { text: MESSAGES.LABEL_SIZE });
        header.createEl("th", { text: MESSAGES.LABEL_DESCRIPTION });
        header.createEl("th", { text: "" });

        for (const model of catalog.catalog) {
            this.renderCatalogRow(table, model);
        }
    }

    private async setModel(model: { name: string }): Promise<void> {
        await this.plugin.api.setChatModel(model.name);
    }

    private async handleModelChange(
        value: string,
        catalog: ModelCatalog,
        label: string,
        container: HTMLElement,
    ): Promise<void> {
        const uninstalledCatalogModel = catalog.catalog.find((m) => m.name === value && !m.installed);
        if (uninstalledCatalogModel) {
            const modal = new ConfirmPullModal(this.app, uninstalledCatalogModel);
            modal.open();
            const confirmed = await modal.result;
            if (!confirmed) return;
            await this.autoPullAndSet(uninstalledCatalogModel, container);
            return;
        }
        try {
            await this.setModel({ name: value });
            new Notice(MESSAGES.NOTICE_SET_MODEL(label, value || MESSAGES.LABEL_NOT_SET.toLowerCase()));
            this.plugin.fetchActiveModel();
            this.display();
        } catch {
            new Notice(MESSAGES.NOTICE_FAILED_SET_MODEL("chat"));
        }
    }

    private async autoPullAndSet(model: ModelInfo, container: HTMLElement): Promise<void> {
        const taskId = this.plugin.taskQueue.enqueue(`Pull ${model.name}`, TASK_TYPE.PULL);
        const controller = new AbortController();
        this.pullAbortController = controller;
        const banner = container.createDiv("lilbee-pull-banner");
        const label = banner.createEl("span", { text: MESSAGES.STATUS_PULLING.replace("{model}", model.name) });
        const cancelBtn = banner.createEl("button", { text: MESSAGES.BUTTON_CANCEL, cls: "lilbee-pull-banner-cancel" });
        cancelBtn.addEventListener("click", () => controller.abort(), { once: true });
        try {
            for await (const event of this.plugin.api.pullModel(model.name, "native", controller.signal)) {
                if (event.event === SSE_EVENT.PROGRESS) {
                    const d = event.data as { percent?: number; current?: number; total?: number };
                    const pct = d.percent ?? (d.total ? Math.round((d.current! / d.total) * 100) : undefined);
                    if (pct !== undefined) {
                        label.textContent = MESSAGES.STATUS_PULLING_PCT.replace("{model}", model.name).replace(
                            "{pct}",
                            String(pct),
                        );
                        this.plugin.taskQueue.update(taskId, pct, model.name);
                    }
                } else if (event.event === SSE_EVENT.ERROR) {
                    const d = event.data as { message?: string } | string;
                    const msg = typeof d === "string" ? d : (d.message ?? "unknown error");
                    new Notice(`${MESSAGES.ERROR_PULL_MODEL.replace("{model}", model.name)}: ${msg}`);
                    this.plugin.taskQueue.fail(taskId, msg);
                    break;
                }
            }
            await this.setModel(model);
            this.plugin.taskQueue.complete(taskId);
            new Notice(MESSAGES.NOTICE_MODEL_ACTIVATED_FULL(model.name));
            this.plugin.fetchActiveModel();
            this.display();
        } catch (err) {
            if (err instanceof Error && err.name === ERROR_NAME.ABORT_ERROR) {
                new Notice(MESSAGES.NOTICE_PULL_CANCELLED);
                this.plugin.taskQueue.cancel(taskId);
            } else {
                const reason = err instanceof Error ? err.message : "unknown error";
                new Notice(`${MESSAGES.ERROR_PULL_MODEL.replace("{model}", model.name)}: ${reason}`);
                this.plugin.taskQueue.fail(taskId, reason);
            }
        } finally {
            banner.remove();
            this.pullAbortController = null;
        }
    }

    private renderCatalogRow(table: HTMLTableElement, model: ModelInfo): void {
        const row = table.createEl("tr");
        row.createEl("td", { text: model.name });
        row.createEl("td", { text: `${model.size_gb} GB` });
        row.createEl("td", { text: model.description });
        const actionCell = row.createEl("td");

        if (model.installed) {
            actionCell.createEl("span", { text: MESSAGES.LABEL_INSTALLED, cls: "lilbee-installed" });
            const deleteBtn = actionCell.createEl("button", { cls: "lilbee-model-delete" }) as HTMLButtonElement;
            setIcon(deleteBtn, "trash-2");
            deleteBtn.setAttribute("aria-label", "Delete model");
            deleteBtn.addEventListener("click", () => this.deleteModel(deleteBtn, model));
        } else {
            const btn = actionCell.createEl("button", { text: MESSAGES.BUTTON_PULL }) as HTMLButtonElement;
            btn.addEventListener("click", () => {
                if (this.plugin.taskQueue.active) {
                    this.pullAbortController?.abort();
                    return;
                }
                return this.pullModel(btn, actionCell, model);
            });
        }
    }

    private async pullModel(btn: HTMLButtonElement, actionCell: HTMLElement, model: ModelInfo): Promise<void> {
        await this.executePull(btn, actionCell, model);
    }

    private async executePull(btn: HTMLButtonElement, actionCell: HTMLElement, model: ModelInfo): Promise<void> {
        const taskId = this.plugin.taskQueue.enqueue(`Pull ${model.name}`, TASK_TYPE.PULL);
        const controller = new AbortController();
        this.pullAbortController = controller;
        btn.textContent = MESSAGES.BUTTON_CANCEL;
        const progress = actionCell.createDiv("lilbee-pull-progress");
        try {
            for await (const event of this.plugin.api.pullModel(model.name, "native", controller.signal)) {
                if (event.event === SSE_EVENT.PROGRESS) {
                    const d = event.data as { percent?: number; current?: number; total?: number };
                    const pct = d.percent ?? (d.total ? Math.round((d.current! / d.total) * 100) : undefined);
                    if (pct !== undefined) {
                        progress.textContent = `${pct}%`;
                        this.plugin.taskQueue.update(taskId, pct, model.name);
                    }
                } else if (event.event === SSE_EVENT.ERROR) {
                    const d = event.data as { message?: string } | string;
                    const msg = typeof d === "string" ? d : (d.message ?? "unknown error");
                    new Notice(`${MESSAGES.ERROR_PULL_MODEL.replace("{model}", model.name)}: ${msg}`);
                    this.plugin.taskQueue.fail(taskId, msg);
                    break;
                }
            }
            this.plugin.taskQueue.complete(taskId);
            new Notice(MESSAGES.NOTICE_MODEL_ACTIVATED_FULL(model.name));
            await this.setModel(model);
            this.plugin.fetchActiveModel();
            this.display();
        } catch (err) {
            if (err instanceof Error && err.name === ERROR_NAME.ABORT_ERROR) {
                new Notice(MESSAGES.NOTICE_PULL_CANCELLED);
                this.plugin.taskQueue.cancel(taskId);
            } else {
                const reason = err instanceof Error ? err.message : "unknown error";
                new Notice(`${MESSAGES.ERROR_PULL_MODEL.replace("{model}", model.name)}: ${reason}`);
                this.plugin.taskQueue.fail(taskId, reason);
            }
            btn.disabled = false;
            btn.textContent = MESSAGES.BUTTON_PULL;
        } finally {
            progress.remove();
            this.pullAbortController = null;
        }
    }

    private async deleteModel(btn: HTMLButtonElement, model: ModelInfo): Promise<void> {
        btn.disabled = true;
        const result = await this.plugin.api.deleteModel(model.name);
        if (result.isErr()) {
            new Notice(MESSAGES.ERROR_DELETE_MODEL.replace("{model}", model.name));
            btn.disabled = false;
            return;
        }
        new Notice(MESSAGES.NOTICE_REMOVED(model.name));
        if (model.name === this.plugin.activeModel) {
            await this.plugin.api.setChatModel("");
            this.plugin.activeModel = "";
        }
        this.plugin.fetchActiveModel();
        const modelsContainer = this.containerEl.querySelector(`.${CLS_MODELS_CONTAINER}`);
        if (modelsContainer) {
            await this.loadModels(modelsContainer as HTMLElement);
        }
    }
}
