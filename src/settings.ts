import { App, Notice, PluginSettingTab, setIcon, Setting } from "obsidian";
import type LilbeePlugin from "./main";
import type { ReleaseInfo } from "./binary-manager";
import {
    DEFAULT_SETTINGS,
    MODEL_SOURCE,
    MODEL_TASK,
    SERVER_MODE,
    SERVER_STATE,
    SSE_EVENT,
    SYNC_MODE,
    TASK_TYPE,
    ERROR_NAME,
} from "./types";
import type { CatalogEntry, ConfigResponse, InstalledModel, LilbeeSettings, ServerMode } from "./types";
import { MESSAGES } from "./locales/en";
import { displayLabelForRef, extractHfRepo } from "./utils/model-ref";
import { CatalogModal } from "./views/catalog-modal";
import { ConfirmModal } from "./views/confirm-modal";
import { ConfirmPullModal } from "./views/confirm-pull-modal";
import { SetupWizard } from "./views/setup-wizard";
import {
    debounce,
    DEBOUNCE_MS,
    percentFromSse,
    errorMessage,
    extractSseErrorMessage,
    noticeForResultError,
    getRelevantSystemMemoryGB,
} from "./utils";

const CHECK_TIMEOUT_MS = 5000;
const CLS_MODELS_CONTAINER = "lilbee-models-container";
const RERANKER_DISABLED_KEY = "";
const VISION_DISABLED_KEY = "";
const RERANK_CANDIDATES_MIN = 1;
const RERANK_CANDIDATES_MAX = 100;
const SEPARATOR_KEY = "__separator__";
const SEPARATOR_LABEL = "\u2500\u2500 Other... \u2500\u2500";
const ICON_RESET = "rotate-ccw";

// Credential-like fields that must never be clobbered by the global "Reset all" button,
// even if the server endpoint returns a default for them. Resetting a user's API key to the
// empty default would silently break external-provider access with no undo path.
const CREDENTIAL_FIELDS = new Set([
    "openai_api_key",
    "anthropic_api_key",
    "gemini_api_key",
    "hf_token",
    "manual_session_token",
]);

export { SEPARATOR_KEY, SEPARATOR_LABEL };

type GenKey = "temperature" | "top_p" | "top_k_sampling" | "repeat_penalty" | "num_ctx" | "seed";

export class LilbeeSettingTab extends PluginSettingTab {
    plugin: LilbeePlugin;
    private serverConfigInputs: Map<string, HTMLInputElement> = new Map();
    private serverConfigToggles: Map<string, { setValue: (v: boolean) => unknown }> = new Map();
    private serverConfigTextAreas: Map<string, HTMLTextAreaElement> = new Map();
    private configDefaults: Record<string, unknown> = {};
    // Set to true while loadServerDefaults is programmatically syncing toggles to the server
    // value so their onChange doesn't round-trip the same value back to the server.
    private suppressToggleChanges = false;

    constructor(app: App, plugin: LilbeePlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        this.serverConfigInputs.clear();
        this.serverConfigToggles.clear();
        this.serverConfigTextAreas.clear();

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
        this.loadServerDefaults();
        this.loadConfigDefaults();
    }

    private filterSettings(containerEl: HTMLElement, query: string): void {
        const term = query.trim().toLowerCase();
        const matches = (item: Element): boolean => {
            const nameEl = item.querySelector(".setting-item-name");
            const name = nameEl?.textContent?.toLowerCase() ?? "";
            return !term || name.includes(term);
        };

        // Top-level setting-items live as direct children of containerEl,
        // outside any .lilbee-settings-section wrapper. The original
        // implementation only walked into sections, so the bulk of the
        // settings page (server controls, port, models, etc.) stayed
        // visible regardless of the filter query.
        for (const child of Array.from(containerEl.children)) {
            if (!child.classList.contains("setting-item")) continue;
            (child as HTMLElement).style.display = matches(child) ? "" : "none";
        }

        const sections = containerEl.querySelectorAll(".lilbee-settings-section");
        for (const section of Array.from(sections)) {
            const items = section.querySelectorAll(".setting-item");
            let visibleCount = 0;
            for (const item of Array.from(items)) {
                const m = matches(item);
                (item as HTMLElement).style.display = m ? "" : "none";
                if (m) visibleCount++;
            }
            (section as HTMLElement).style.display = visibleCount > 0 || !term ? "" : "none";
            if (term && visibleCount > 0) {
                section.setAttribute("open", "");
            }
        }
    }

    private renderConnectionSettings(containerEl: HTMLElement): void {
        const modeSetting = new Setting(containerEl)
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
        this.appendLocalResetAffordance(modeSetting, "serverMode", MESSAGES.LABEL_SERVER_MODE);

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

        const portSetting = new Setting(containerEl)
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
        this.appendLocalResetAffordance(portSetting, "serverPort", MESSAGES.LABEL_SERVER_PORT);

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
                        // 51g: explicit feedback on the no-update path so the
                        // click visibly registers. Surface the *current*
                        // version so the user can see what was checked, and
                        // pin the inline button label to "Up to date" until
                        // the next click — both the toast and the button
                        // change confirm the action.
                        const current = this.plugin.settings.lilbeeVersion || MESSAGES.LABEL_UNKNOWN;
                        new Notice(MESSAGES.NOTICE_SERVER_UPTODATE(current));
                        checkBtn.setButtonText(MESSAGES.LABEL_UPTODATE);
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
        this.appendLocalResetAffordance(serverSetting, "serverUrl", MESSAGES.LABEL_SERVER_URL);

        void this.checkEndpoint(`${this.plugin.settings.serverUrl}/api/health`, serverStatusEl);

        new Setting(containerEl).setName(MESSAGES.LABEL_SESSION_TOKEN).setDesc(MESSAGES.DESC_SESSION_TOKEN_AUTO);

        const manualTokenSetting = new Setting(containerEl)
            .setName(MESSAGES.LABEL_MANUAL_TOKEN)
            .setDesc(MESSAGES.DESC_MANUAL_TOKEN)
            .addText((text) => {
                text.setPlaceholder("")
                    .setValue(this.plugin.settings.manualToken)
                    .onChange(async (value) => {
                        this.plugin.settings.manualToken = value.trim();
                        await this.plugin.saveSettings();
                    });
                text.inputEl.type = "password";
            });
        this.appendLocalResetAffordance(manualTokenSetting, "manualToken", MESSAGES.LABEL_MANUAL_TOKEN);

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

        const topKSetting = new Setting(containerEl)
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
        this.appendLocalResetAffordance(topKSetting, "topK", MESSAGES.LABEL_RESULTS_COUNT);

        const maxDistanceSetting = new Setting(containerEl)
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
        this.appendLocalResetAffordance(maxDistanceSetting, "maxDistance", MESSAGES.LABEL_MAX_DISTANCE);

        const adaptiveSetting = new Setting(containerEl)
            .setName(MESSAGES.LABEL_ADAPTIVE_THRESHOLD)
            .setDesc(MESSAGES.DESC_ADAPTIVE_THRESHOLD)
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.adaptiveThreshold ?? false).onChange(async (value) => {
                    this.plugin.settings.adaptiveThreshold = value;
                    await this.plugin.saveSettings();
                }),
            );
        this.appendLocalResetAffordance(adaptiveSetting, "adaptiveThreshold", MESSAGES.LABEL_ADAPTIVE_THRESHOLD);
    }

    private loadServerDefaults(): void {
        this.plugin.api
            .config()
            .then((cfg: ConfigResponse) => {
                // Populate editable server-config inputs with the current server values.
                for (const [key, inputEl] of this.serverConfigInputs) {
                    const v = cfg[key];
                    if (v === undefined) continue;
                    inputEl.value = v === null ? "" : String(v);
                }
                for (const [key, toggle] of this.serverConfigToggles) {
                    const v = cfg[key];
                    if (typeof v === "boolean") {
                        this.suppressToggleChanges = true;
                        try {
                            toggle.setValue(v);
                        } finally {
                            this.suppressToggleChanges = false;
                        }
                    }
                }
                for (const [key, textArea] of this.serverConfigTextAreas) {
                    const v = cfg[key];
                    if (Array.isArray(v)) {
                        textArea.value = v.join("\n");
                    }
                }
                // Populate system prompt placeholder from server config.
                if (cfg.system_prompt !== undefined) {
                    const sysPromptInput = this.serverConfigInputs.get("system_prompt");
                    if (sysPromptInput) {
                        sysPromptInput.placeholder = String(cfg.system_prompt);
                    }
                }
            })
            .catch(() => {
                // Connection status is shown via the Test button — no duplicate warning needed
            });
    }

    private loadConfigDefaults(): void {
        this.plugin.api
            .configDefaults()
            .then((defaults: Record<string, unknown>) => {
                this.configDefaults = defaults;
            })
            .catch(() => {
                // Older servers without /api/config/defaults — reset affordances simply hide.
                this.configDefaults = {};
            });
    }

    private appendResetAffordance(setting: Setting, key: string, label: string): Setting {
        return setting.addExtraButton((btn) =>
            btn
                .setIcon(ICON_RESET)
                .setTooltip(MESSAGES.LABEL_RESET_TO_DEFAULT)
                .onClick(async () => {
                    // Silent no-op until defaults have loaded (old servers or racing first click).
                    if (!(key in this.configDefaults)) return;
                    const def = this.configDefaults[key];
                    try {
                        await this.plugin.api.updateConfig({ [key]: def });
                        new Notice(MESSAGES.NOTICE_FIELD_RESET(label));
                        this.display();
                    } catch {
                        new Notice(MESSAGES.NOTICE_FAILED_RESET(label));
                    }
                }),
        );
    }

    private appendLocalResetAffordance<K extends keyof LilbeeSettings>(
        setting: Setting,
        key: K,
        label: string,
    ): Setting {
        return setting.addExtraButton((btn) =>
            btn
                .setIcon(ICON_RESET)
                .setTooltip(MESSAGES.LABEL_RESET_TO_DEFAULT)
                .onClick(async () => {
                    this.plugin.settings[key] = DEFAULT_SETTINGS[key];
                    await this.plugin.saveSettings();
                    new Notice(MESSAGES.NOTICE_FIELD_RESET(label));
                    this.display();
                }),
        );
    }

    /**
     * Reset affordance for fields that dual-write: PATCH the server default AND mirror it back
     * into `plugin.settings[localKey]`. Prevents the re-render from picking up a stale local value
     * via `toggle.setValue(this.plugin.settings[localKey])`.
     */
    private appendDualResetAffordance<K extends keyof LilbeeSettings>(
        setting: Setting,
        serverKey: string,
        localKey: K,
        label: string,
    ): Setting {
        return setting.addExtraButton((btn) =>
            btn
                .setIcon(ICON_RESET)
                .setTooltip(MESSAGES.LABEL_RESET_TO_DEFAULT)
                .onClick(async () => {
                    if (!(serverKey in this.configDefaults)) return;
                    const def = this.configDefaults[serverKey];
                    try {
                        await this.plugin.api.updateConfig({ [serverKey]: def });
                        this.plugin.settings[localKey] = def as LilbeeSettings[K];
                        await this.plugin.saveSettings();
                        new Notice(MESSAGES.NOTICE_FIELD_RESET(label));
                        this.display();
                    } catch {
                        new Notice(MESSAGES.NOTICE_FAILED_RESET(label));
                    }
                }),
        );
    }

    private renderGenerationSettings(containerEl: HTMLElement): void {
        const details = containerEl.createEl("details", { cls: "lilbee-generation-details lilbee-settings-section" });
        const modelLabel = displayLabelForRef(this.plugin.activeModel) || MESSAGES.LABEL_NO_MODEL_SELECTED;
        details.createEl("summary", { text: `${MESSAGES.LABEL_GENERATION} (${modelLabel})` });
        details.createEl("p", {
            text: MESSAGES.LABEL_GENERATION_HELP,
            cls: "setting-item-description",
        });

        const promptSetting = new Setting(details)
            .setName(MESSAGES.LABEL_SYSTEM_PROMPT)
            .setDesc(MESSAGES.DESC_SYSTEM_PROMPT)
            .addTextArea((text) => {
                text.setPlaceholder(MESSAGES.PLACEHOLDER_DEFAULT)
                    .setValue(this.plugin.settings.systemPrompt)
                    .onChange(async (value) => {
                        this.plugin.settings.systemPrompt = value;
                        await this.plugin.saveSettings();
                    });
                this.serverConfigInputs.set("system_prompt", text.inputEl as unknown as HTMLInputElement);
            });
        this.appendLocalResetAffordance(promptSetting, "systemPrompt", MESSAGES.LABEL_SYSTEM_PROMPT);

        const fields: { key: GenKey; name: string; desc: string; integer: boolean }[] = [
            {
                key: "temperature",
                name: MESSAGES.LABEL_GEN_TEMPERATURE,
                desc: MESSAGES.DESC_GEN_TEMPERATURE,
                integer: false,
            },
            {
                key: "top_p",
                name: MESSAGES.LABEL_GEN_TOP_P,
                desc: MESSAGES.DESC_GEN_TOP_P,
                integer: false,
            },
            {
                key: "top_k_sampling",
                name: MESSAGES.LABEL_GEN_TOP_K,
                desc: MESSAGES.DESC_GEN_TOP_K,
                integer: true,
            },
            {
                key: "repeat_penalty",
                name: MESSAGES.LABEL_GEN_REPEAT_PENALTY,
                desc: MESSAGES.DESC_GEN_REPEAT_PENALTY,
                integer: false,
            },
            {
                key: "num_ctx",
                name: MESSAGES.LABEL_GEN_NUM_CTX,
                desc: MESSAGES.DESC_GEN_NUM_CTX,
                integer: true,
            },
            {
                key: "seed",
                name: MESSAGES.LABEL_GEN_SEED,
                desc: MESSAGES.DESC_GEN_SEED,
                integer: true,
            },
        ];

        for (const field of fields) {
            const genSetting = new Setting(details)
                .setName(field.name)
                .setDesc(field.desc)
                .addText((text) => {
                    text.setPlaceholder(MESSAGES.PLACEHOLDER_NOT_SET)
                        .setValue("")
                        .onChange(async (value) => {
                            const trimmed = value.trim();
                            if (trimmed === "") {
                                try {
                                    await this.plugin.api.updateConfig({ [field.key]: null });
                                    new Notice(MESSAGES.NOTICE_FIELD_UPDATED(field.name));
                                } catch {
                                    new Notice(MESSAGES.NOTICE_FAILED_UPDATE(field.name));
                                }
                                return;
                            }
                            const num = field.integer ? parseInt(trimmed, 10) : parseFloat(trimmed);
                            if (isNaN(num)) return;
                            try {
                                await this.plugin.api.updateConfig({ [field.key]: num });
                                new Notice(MESSAGES.NOTICE_FIELD_UPDATED(field.name));
                            } catch {
                                new Notice(MESSAGES.NOTICE_FAILED_UPDATE(field.name));
                            }
                        });
                    this.serverConfigInputs.set(field.key, text.inputEl);
                });
            this.appendResetAffordance(genSetting, field.key, field.name);
        }
    }

    private loadEmbeddingDropdown(container: HTMLElement): void {
        this.plugin.api
            .catalog({ task: MODEL_TASK.EMBEDDING })
            .then((result) => {
                if (result.isErr()) {
                    this.renderEmbeddingFallback(container);
                    return;
                }
                const models = result.value.models;
                new Setting(container)
                    .setName(MESSAGES.LABEL_EMBEDDING_MODEL)
                    .setDesc(MESSAGES.DESC_EMBEDDING_MODEL)
                    .addDropdown((dropdown) => {
                        for (const model of models) {
                            const suffix = model.installed ? "" : MESSAGES.LABEL_NOT_INSTALLED;
                            dropdown.addOption(model.hf_repo, `${model.display_name}${suffix}`);
                        }
                        dropdown.onChange(async (value) => {
                            if (!value) return;
                            const confirmModal = new ConfirmModal(this.app, MESSAGES.DESC_EMBEDDING_REINDEX_WARNING);
                            confirmModal.open();
                            const confirmed = await confirmModal.result;
                            if (!confirmed) return;
                            const result = await this.plugin.api.setEmbeddingModel(value);
                            if (result.isErr()) {
                                new Notice(noticeForResultError(result.error, MESSAGES.NOTICE_FAILED_EMBEDDING));
                                return;
                            }
                            new Notice(MESSAGES.NOTICE_EMBEDDING_UPDATED);
                            new Notice(MESSAGES.NOTICE_REINDEX_REQUIRED);
                            void this.plugin.triggerSync();
                        });
                    })
                    .addButton((btn) =>
                        btn.setButtonText(MESSAGES.BUTTON_BROWSE_MORE).onClick(() => {
                            new CatalogModal(this.app, this.plugin, MODEL_TASK.EMBEDDING).open();
                        }),
                    );
            })
            .catch(() => {
                this.renderEmbeddingFallback(container);
            });
    }

    private renderRerankerSection(container: HTMLElement): void {
        Promise.all([
            this.plugin.api.config(),
            this.plugin.api.catalog({ task: MODEL_TASK.RERANK }),
            this.plugin.api.installedModels({ task: MODEL_TASK.RERANK }).catch(() => ({ models: [] })),
        ])
            .then(([cfg, catalogResult, installedResp]) => {
                const active = typeof cfg.reranker_model === "string" ? cfg.reranker_model : RERANKER_DISABLED_KEY;
                const catalogEntries = catalogResult.isOk() ? catalogResult.value.models : [];
                this.renderRerankerDropdown(container, active, catalogEntries, installedResp.models);
            })
            .catch(() => {
                new Notice(MESSAGES.NOTICE_RERANKER_LOAD_FAILED);
            });
    }

    private renderRerankerDropdown(
        container: HTMLElement,
        active: string,
        catalogEntries: CatalogEntry[],
        installed: InstalledModel[],
    ): void {
        const options = this.buildRerankerOptions(catalogEntries, installed);
        new Setting(container)
            .setName(MESSAGES.LABEL_RERANKER_TITLE)
            .setDesc(MESSAGES.DESC_RERANKER_MODEL)
            .addDropdown((dropdown) => {
                for (const [value, label] of options) {
                    dropdown.addOption(value, label);
                }
                dropdown.setValue(active || RERANKER_DISABLED_KEY);
                dropdown.onChange(async (value) => {
                    await this.handleRerankerChange(value, catalogEntries, installed);
                });
            })
            .addButton((btn) =>
                btn.setButtonText(MESSAGES.BUTTON_BROWSE_MORE).onClick(() => {
                    new CatalogModal(this.app, this.plugin, MODEL_TASK.RERANK).open();
                }),
            );
    }

    private buildRerankerOptions(catalogEntries: CatalogEntry[], installed: InstalledModel[]): Array<[string, string]> {
        // `installed[].name` is the server's canonical ref (full HF path, or `provider/name`).
        // For HF refs we strip the trailing `/<filename>.gguf` so it matches `entry.hf_repo`;
        // provider refs pass through unchanged, so a hosted reranker isn't mislabelled
        // `(not installed)`.
        const installedRepos = new Set(installed.map((m) => extractHfRepo(m.name)));
        const isInstalled = (e: CatalogEntry): boolean => installedRepos.has(e.hf_repo);
        const opts: Array<[string, string]> = [[RERANKER_DISABLED_KEY, MESSAGES.LABEL_RERANKER_DISABLED]];
        const localInstalled = catalogEntries.filter((e) => e.source !== MODEL_SOURCE.LITELLM && isInstalled(e));
        const localNotInstalled = catalogEntries.filter((e) => e.source !== MODEL_SOURCE.LITELLM && !isInstalled(e));
        const hosted = catalogEntries.filter((e) => e.source === MODEL_SOURCE.LITELLM);
        for (const e of localInstalled) opts.push([e.hf_repo, e.display_name]);
        for (const e of localNotInstalled) opts.push([e.hf_repo, `${e.display_name}${MESSAGES.LABEL_NOT_INSTALLED}`]);
        if (hosted.length > 0) {
            for (const e of hosted)
                opts.push([e.hf_repo, `${e.display_name} — ${MESSAGES.LABEL_RERANKER_HOSTED_GROUP}`]);
        }
        return opts;
    }

    private async handleRerankerChange(
        value: string,
        catalogEntries: CatalogEntry[],
        installed: InstalledModel[],
    ): Promise<void> {
        const installedRepos = new Set(installed.map((m) => extractHfRepo(m.name)));
        const catalogEntry = catalogEntries.find((e) => e.hf_repo === value);
        if (
            value === RERANKER_DISABLED_KEY ||
            installedRepos.has(value) ||
            catalogEntry?.source === MODEL_SOURCE.LITELLM
        ) {
            await this.applyRerankerSelection(value);
            return;
        }
        if (catalogEntry) {
            await this.pullAndSetReranker(catalogEntry);
        }
    }

    private async applyRerankerSelection(value: string): Promise<void> {
        const result = await this.plugin.api.setRerankerModel(value);
        if (result.isErr()) {
            new Notice(noticeForResultError(result.error, MESSAGES.NOTICE_FAILED_RERANKER));
            return;
        }
        new Notice(MESSAGES.NOTICE_RERANKER_UPDATED);
    }

    private async pullAndSetReranker(entry: CatalogEntry): Promise<void> {
        const taskId = this.plugin.taskQueue.enqueue(`Pull ${entry.display_name}`, TASK_TYPE.PULL);
        if (taskId === null) {
            new Notice(MESSAGES.NOTICE_QUEUE_FULL);
            return;
        }
        const controller = new AbortController();
        this.plugin.taskQueue.registerAbort(taskId, controller);
        const ok = await this.streamRerankerPull(taskId, entry, controller.signal);
        if (!ok) return;
        this.plugin.taskQueue.complete(taskId);
        await this.applyRerankerSelection(entry.hf_repo);
    }

    private async streamRerankerPull(taskId: string, entry: CatalogEntry, signal: AbortSignal): Promise<boolean> {
        try {
            for await (const event of this.plugin.api.pullModel(entry.hf_repo, MODEL_SOURCE.NATIVE, signal)) {
                if (event.event === SSE_EVENT.PROGRESS) {
                    this.handleRerankerPullProgress(taskId, entry, event.data);
                } else if (event.event === SSE_EVENT.ERROR) {
                    this.handleRerankerPullSseError(taskId, entry, event.data);
                    return false;
                }
            }
        } catch (err) {
            this.handleRerankerPullException(taskId, entry, err);
            return false;
        }
        return true;
    }

    private handleRerankerPullProgress(taskId: string, entry: CatalogEntry, data: unknown): void {
        const d = data as { percent?: number; current?: number; total?: number };
        const pct = percentFromSse(d);
        if (pct !== undefined) {
            this.plugin.taskQueue.update(taskId, pct, entry.display_name, { current: d.current, total: d.total });
        }
    }

    private handleRerankerPullSseError(taskId: string, entry: CatalogEntry, data: unknown): void {
        const msg = extractSseErrorMessage(data as { message?: string } | string, MESSAGES.ERROR_UNKNOWN);
        new Notice(`${MESSAGES.ERROR_PULL_MODEL.replace("{model}", entry.display_name)}: ${msg}`);
        this.plugin.taskQueue.fail(taskId, msg);
    }

    private handleRerankerPullException(taskId: string, entry: CatalogEntry, err: unknown): void {
        if (err instanceof Error && err.name === ERROR_NAME.ABORT_ERROR) {
            new Notice(MESSAGES.NOTICE_PULL_CANCELLED);
            this.plugin.taskQueue.cancel(taskId);
            return;
        }
        const reason = errorMessage(err, MESSAGES.ERROR_UNKNOWN);
        new Notice(`${MESSAGES.ERROR_PULL_MODEL.replace("{model}", entry.display_name)}: ${reason}`);
        this.plugin.taskQueue.fail(taskId, reason);
    }

    private renderVisionSection(container: HTMLElement): void {
        Promise.all([
            this.plugin.api.config(),
            this.plugin.api.catalog({ task: MODEL_TASK.VISION }),
            this.plugin.api.installedModels({ task: MODEL_TASK.VISION }).catch(() => ({ models: [] })),
        ])
            .then(([cfg, catalogResult, installedResp]) => {
                const active = typeof cfg.vision_model === "string" ? cfg.vision_model : VISION_DISABLED_KEY;
                const catalogEntries = catalogResult.isOk() ? catalogResult.value.models : [];
                this.renderVisionDropdown(container, active, catalogEntries, installedResp.models);
            })
            .catch(() => {
                new Notice(MESSAGES.NOTICE_VISION_LOAD_FAILED);
            });
    }

    private renderVisionDropdown(
        container: HTMLElement,
        active: string,
        catalogEntries: CatalogEntry[],
        installed: InstalledModel[],
    ): void {
        const options = this.buildVisionOptions(catalogEntries, installed);
        new Setting(container)
            .setName(MESSAGES.LABEL_VISION_TITLE)
            .setDesc(MESSAGES.DESC_VISION_MODEL)
            .addDropdown((dropdown) => {
                for (const [value, label] of options) {
                    dropdown.addOption(value, label);
                }
                dropdown.setValue(active || VISION_DISABLED_KEY);
                dropdown.onChange(async (value) => {
                    await this.handleVisionChange(value, catalogEntries, installed);
                });
            })
            .addButton((btn) =>
                btn.setButtonText(MESSAGES.BUTTON_BROWSE_MORE).onClick(() => {
                    new CatalogModal(this.app, this.plugin, MODEL_TASK.VISION).open();
                }),
            );
    }

    private buildVisionOptions(catalogEntries: CatalogEntry[], installed: InstalledModel[]): Array<[string, string]> {
        // Strip the trailing `/<filename>.gguf` from installed refs so they match the catalog's bare `hf_repo`.
        const installedRepos = new Set(installed.map((m) => extractHfRepo(m.name)));
        const opts: Array<[string, string]> = [[VISION_DISABLED_KEY, MESSAGES.LABEL_VISION_DISABLED]];
        const localInstalled = catalogEntries.filter(
            (e) => e.source !== MODEL_SOURCE.LITELLM && installedRepos.has(e.hf_repo),
        );
        const localNotInstalled = catalogEntries.filter(
            (e) => e.source !== MODEL_SOURCE.LITELLM && !installedRepos.has(e.hf_repo),
        );
        const hosted = catalogEntries.filter((e) => e.source === MODEL_SOURCE.LITELLM);
        for (const e of localInstalled) opts.push([e.hf_repo, e.display_name]);
        for (const e of localNotInstalled) opts.push([e.hf_repo, `${e.display_name}${MESSAGES.LABEL_NOT_INSTALLED}`]);
        if (hosted.length > 0) {
            for (const e of hosted) opts.push([e.hf_repo, `${e.display_name} — ${MESSAGES.LABEL_VISION_HOSTED_GROUP}`]);
        }
        return opts;
    }

    private async handleVisionChange(
        value: string,
        catalogEntries: CatalogEntry[],
        installed: InstalledModel[],
    ): Promise<void> {
        const installedRepos = new Set(installed.map((m) => extractHfRepo(m.name)));
        const catalogEntry = catalogEntries.find((e) => e.hf_repo === value);
        if (
            value === VISION_DISABLED_KEY ||
            installedRepos.has(value) ||
            catalogEntry?.source === MODEL_SOURCE.LITELLM
        ) {
            await this.applyVisionSelection(value);
            return;
        }
        if (catalogEntry) {
            await this.pullAndSetVision(catalogEntry);
        }
    }

    private async applyVisionSelection(value: string): Promise<void> {
        const result = await this.plugin.api.setVisionModel(value);
        if (result.isErr()) {
            new Notice(noticeForResultError(result.error, MESSAGES.NOTICE_FAILED_VISION));
            return;
        }
        new Notice(MESSAGES.NOTICE_VISION_UPDATED);
    }

    private async pullAndSetVision(entry: CatalogEntry): Promise<void> {
        const taskId = this.plugin.taskQueue.enqueue(`Pull ${entry.display_name}`, TASK_TYPE.PULL);
        if (taskId === null) {
            new Notice(MESSAGES.NOTICE_QUEUE_FULL);
            return;
        }
        const controller = new AbortController();
        this.plugin.taskQueue.registerAbort(taskId, controller);
        const ok = await this.streamVisionPull(taskId, entry, controller.signal);
        if (!ok) return;
        this.plugin.taskQueue.complete(taskId);
        await this.applyVisionSelection(entry.hf_repo);
    }

    private async streamVisionPull(taskId: string, entry: CatalogEntry, signal: AbortSignal): Promise<boolean> {
        try {
            for await (const event of this.plugin.api.pullModel(entry.hf_repo, MODEL_SOURCE.NATIVE, signal)) {
                if (event.event === SSE_EVENT.PROGRESS) {
                    this.handleVisionPullProgress(taskId, entry, event.data);
                } else if (event.event === SSE_EVENT.ERROR) {
                    this.handleVisionPullSseError(taskId, entry, event.data);
                    return false;
                }
            }
        } catch (err) {
            this.handleVisionPullException(taskId, entry, err);
            return false;
        }
        return true;
    }

    private handleVisionPullProgress(taskId: string, entry: CatalogEntry, data: unknown): void {
        const d = data as { percent?: number; current?: number; total?: number };
        const pct = percentFromSse(d);
        if (pct !== undefined) {
            this.plugin.taskQueue.update(taskId, pct, entry.display_name, { current: d.current, total: d.total });
        }
    }

    private handleVisionPullSseError(taskId: string, entry: CatalogEntry, data: unknown): void {
        const msg = extractSseErrorMessage(data as { message?: string } | string, MESSAGES.ERROR_UNKNOWN);
        new Notice(`${MESSAGES.ERROR_PULL_MODEL.replace("{model}", entry.display_name)}: ${msg}`);
        this.plugin.taskQueue.fail(taskId, msg);
    }

    private handleVisionPullException(taskId: string, entry: CatalogEntry, err: unknown): void {
        if (err instanceof Error && err.name === ERROR_NAME.ABORT_ERROR) {
            new Notice(MESSAGES.NOTICE_PULL_CANCELLED);
            this.plugin.taskQueue.cancel(taskId);
            return;
        }
        const reason = errorMessage(err, MESSAGES.ERROR_UNKNOWN);
        new Notice(`${MESSAGES.ERROR_PULL_MODEL.replace("{model}", entry.display_name)}: ${reason}`);
        this.plugin.taskQueue.fail(taskId, reason);
    }

    private renderEmbeddingFallback(container: HTMLElement): void {
        new Setting(container)
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
                        const result = await this.plugin.api.setEmbeddingModel(trimmed);
                        if (result.isErr()) {
                            new Notice(noticeForResultError(result.error, MESSAGES.NOTICE_FAILED_EMBEDDING));
                            return;
                        }
                        new Notice(MESSAGES.NOTICE_EMBEDDING_UPDATED);
                        new Notice(MESSAGES.NOTICE_REINDEX_REQUIRED);
                        void this.plugin.triggerSync();
                    });
                this.serverConfigInputs.set("embedding_model", text.inputEl as unknown as HTMLInputElement);
            });
    }

    private renderSyncSettings(containerEl: HTMLElement): void {
        const syncModeSetting = new Setting(containerEl)
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
        this.appendLocalResetAffordance(syncModeSetting, "syncMode", MESSAGES.LABEL_SYNC_MODE);

        if (this.plugin.settings.syncMode === SYNC_MODE.AUTO) {
            const debounceSetting = new Setting(containerEl)
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
            this.appendLocalResetAffordance(debounceSetting, "syncDebounceMs", MESSAGES.LABEL_SYNC_DEBOUNCE);
        }
    }

    private renderCrawlingSettings(containerEl: HTMLElement): void {
        containerEl.createEl("h3", { text: MESSAGES.LABEL_CRAWLING });

        type NumericKind = "int" | "float";
        type NumericField = {
            key: string;
            name: string;
            desc: string;
            placeholder: string;
            kind: NumericKind;
            nullable: boolean;
            min?: number;
        };
        type BoolField = { key: string; name: string; desc: string; kind: "bool" };
        type Field = NumericField | BoolField;

        const fields: Field[] = [
            {
                key: "crawl_max_depth",
                name: MESSAGES.LABEL_CRAWL_MAX_DEPTH,
                desc: MESSAGES.DESC_CRAWL_MAX_DEPTH,
                placeholder: MESSAGES.HINT_CRAWL_BLANK_NO_LIMIT,
                kind: "int",
                nullable: true,
                min: 0,
            },
            {
                key: "crawl_max_pages",
                name: MESSAGES.LABEL_CRAWL_MAX_PAGES,
                desc: MESSAGES.DESC_CRAWL_MAX_PAGES,
                placeholder: MESSAGES.HINT_CRAWL_BLANK_NO_LIMIT,
                kind: "int",
                nullable: true,
                min: 1,
            },
            {
                key: "crawl_timeout",
                name: MESSAGES.LABEL_CRAWL_TIMEOUT,
                desc: MESSAGES.DESC_CRAWL_TIMEOUT,
                placeholder: MESSAGES.PLACEHOLDER_30,
                kind: "int",
                nullable: false,
                min: 1,
            },
            {
                key: "crawl_mean_delay",
                name: MESSAGES.LABEL_CRAWL_MEAN_DELAY,
                desc: MESSAGES.DESC_CRAWL_MEAN_DELAY,
                placeholder: "0.5",
                kind: "float",
                nullable: false,
                min: 0,
            },
            {
                key: "crawl_max_delay_range",
                name: MESSAGES.LABEL_CRAWL_MAX_DELAY_RANGE,
                desc: MESSAGES.DESC_CRAWL_MAX_DELAY_RANGE,
                placeholder: "0.5",
                kind: "float",
                nullable: false,
                min: 0,
            },
            {
                key: "crawl_concurrent_requests",
                name: MESSAGES.LABEL_CRAWL_CONCURRENT_REQUESTS,
                desc: MESSAGES.DESC_CRAWL_CONCURRENT_REQUESTS,
                placeholder: "3",
                kind: "int",
                nullable: false,
                min: 1,
            },
            {
                key: "crawl_retry_on_rate_limit",
                name: MESSAGES.LABEL_CRAWL_RETRY_ON_RATE_LIMIT,
                desc: MESSAGES.DESC_CRAWL_RETRY_ON_RATE_LIMIT,
                kind: "bool",
            },
            {
                key: "crawl_retry_base_delay_min",
                name: MESSAGES.LABEL_CRAWL_RETRY_BASE_DELAY_MIN,
                desc: MESSAGES.DESC_CRAWL_RETRY_BASE_DELAY_MIN,
                placeholder: "1.0",
                kind: "float",
                nullable: false,
                min: 0,
            },
            {
                key: "crawl_retry_base_delay_max",
                name: MESSAGES.LABEL_CRAWL_RETRY_BASE_DELAY_MAX,
                desc: MESSAGES.DESC_CRAWL_RETRY_BASE_DELAY_MAX,
                placeholder: "3.0",
                kind: "float",
                nullable: false,
                min: 0,
            },
            {
                key: "crawl_retry_max_backoff",
                name: MESSAGES.LABEL_CRAWL_RETRY_MAX_BACKOFF,
                desc: MESSAGES.DESC_CRAWL_RETRY_MAX_BACKOFF,
                placeholder: "30.0",
                kind: "float",
                nullable: false,
                min: 0,
            },
            {
                key: "crawl_retry_max_attempts",
                name: MESSAGES.LABEL_CRAWL_RETRY_MAX_ATTEMPTS,
                desc: MESSAGES.DESC_CRAWL_RETRY_MAX_ATTEMPTS,
                placeholder: "3",
                kind: "int",
                nullable: false,
                min: 0,
            },
        ];

        for (const field of fields) {
            if (field.kind === "bool") {
                const boolSetting = new Setting(containerEl)
                    .setName(field.name)
                    .setDesc(field.desc)
                    .addToggle((toggle) => {
                        toggle.onChange(async (value) => {
                            if (this.suppressToggleChanges) return;
                            try {
                                await this.plugin.api.updateConfig({ [field.key]: value });
                                new Notice(MESSAGES.NOTICE_FIELD_UPDATED(field.name));
                            } catch {
                                new Notice(MESSAGES.NOTICE_FAILED_UPDATE(field.name));
                            }
                        });
                        this.serverConfigToggles.set(field.key, toggle);
                    });
                this.appendResetAffordance(boolSetting, field.key, field.name);
                continue;
            }

            const numField = field;
            const numSetting = new Setting(containerEl)
                .setName(numField.name)
                .setDesc(numField.desc)
                .addText((text) => {
                    text.setPlaceholder(numField.placeholder)
                        .setValue("")
                        .onChange(async (value) => {
                            const trimmed = value.trim();
                            if (trimmed === "") {
                                if (!numField.nullable) return;
                                try {
                                    await this.plugin.api.updateConfig({ [numField.key]: null });
                                    new Notice(MESSAGES.NOTICE_FIELD_UPDATED(numField.name));
                                } catch {
                                    new Notice(MESSAGES.NOTICE_FAILED_UPDATE(numField.name));
                                }
                                return;
                            }
                            const num = Number(trimmed);
                            if (!Number.isFinite(num)) return;
                            if (numField.kind === "int" && !Number.isInteger(num)) return;
                            if (numField.min !== undefined && num < numField.min) return;
                            try {
                                await this.plugin.api.updateConfig({ [numField.key]: num });
                                new Notice(MESSAGES.NOTICE_FIELD_UPDATED(numField.name));
                            } catch {
                                new Notice(MESSAGES.NOTICE_FAILED_UPDATE(numField.name));
                            }
                        });
                    this.serverConfigInputs.set(numField.key, text.inputEl as unknown as HTMLInputElement);
                });
            this.appendResetAffordance(numSetting, numField.key, numField.name);
        }

        const patternsSetting = new Setting(containerEl)
            .setName(MESSAGES.LABEL_CRAWL_EXCLUDE_PATTERNS)
            .setDesc(MESSAGES.DESC_CRAWL_EXCLUDE_PATTERNS)
            .addTextArea((text) => {
                text.setValue("").onChange(async (value) => {
                    const patterns = value
                        .split("\n")
                        .map((p) => p.trim())
                        .filter((p) => p.length > 0);
                    try {
                        await this.plugin.api.updateConfig({ crawl_exclude_patterns: patterns });
                        new Notice(MESSAGES.NOTICE_FIELD_UPDATED(MESSAGES.LABEL_CRAWL_EXCLUDE_PATTERNS));
                    } catch {
                        new Notice(MESSAGES.NOTICE_FAILED_UPDATE(MESSAGES.LABEL_CRAWL_EXCLUDE_PATTERNS));
                    }
                });
                text.inputEl.addClass("lilbee-crawl-exclude-patterns");
                this.serverConfigTextAreas.set(
                    "crawl_exclude_patterns",
                    text.inputEl as unknown as HTMLTextAreaElement,
                );
            });
        this.appendResetAffordance(patternsSetting, "crawl_exclude_patterns", MESSAGES.LABEL_CRAWL_EXCLUDE_PATTERNS);
    }

    private renderWikiSettings(containerEl: HTMLElement): void {
        const details = containerEl.createEl("details", { cls: "lilbee-advanced-details lilbee-settings-section" });
        details.createEl("summary", { text: MESSAGES.LABEL_WIKI_SECTION });

        // Enable wiki toggle (user preference — independent of server)
        const subSettingsContainer = details.createDiv({ cls: "lilbee-wiki-sub-settings" });

        const enableSetting = new Setting(details)
            .setName(MESSAGES.LABEL_WIKI_ENABLE_TOGGLE)
            .setDesc(MESSAGES.DESC_WIKI_ENABLE_TOGGLE)
            .addToggle((toggle) => {
                toggle.setValue(this.plugin.settings.wikiEnabled);
                toggle.onChange(async (value) => {
                    this.plugin.settings.wikiEnabled = value;
                    this.plugin.wikiEnabled = value;
                    await this.plugin.saveSettings();
                    this.setSubSettingsVisible(subSettingsContainer, value);
                });
            });
        this.appendLocalResetAffordance(enableSetting, "wikiEnabled", MESSAGES.LABEL_WIKI_ENABLE_TOGGLE);

        this.setSubSettingsVisible(subSettingsContainer, this.plugin.settings.wikiEnabled);

        // Wiki status (display only)
        const statusDesc = `Enabled — ${this.plugin.wikiPageCount} pages, ${this.plugin.wikiDraftCount} drafts`;
        new Setting(subSettingsContainer).setName(MESSAGES.LABEL_WIKI_STATUS).setDesc(statusDesc).setDisabled(true);

        // Prune raw chunks
        const pruneSetting = new Setting(subSettingsContainer)
            .setName(MESSAGES.LABEL_WIKI_PRUNE_RAW)
            .setDesc(MESSAGES.DESC_WIKI_PRUNE_RAW)
            .addToggle((toggle) => {
                toggle.setValue(this.plugin.settings.wikiPruneRaw);
                toggle.onChange(async (value) => {
                    this.plugin.settings.wikiPruneRaw = value;
                    await this.plugin.saveSettings();
                    try {
                        await this.plugin.api.updateConfig({ wiki_prune_raw: value });
                        new Notice(MESSAGES.NOTICE_FIELD_UPDATED(MESSAGES.LABEL_WIKI_PRUNE_RAW));
                    } catch {
                        new Notice(MESSAGES.NOTICE_FAILED_UPDATE(MESSAGES.LABEL_WIKI_PRUNE_RAW));
                    }
                });
            });
        this.appendDualResetAffordance(pruneSetting, "wiki_prune_raw", "wikiPruneRaw", MESSAGES.LABEL_WIKI_PRUNE_RAW);

        // Faithfulness threshold
        const faithSetting = new Setting(subSettingsContainer)
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
                            new Notice(MESSAGES.NOTICE_FIELD_UPDATED(MESSAGES.LABEL_WIKI_FAITHFULNESS));
                        } catch {
                            new Notice(MESSAGES.NOTICE_FAILED_UPDATE(MESSAGES.LABEL_WIKI_FAITHFULNESS));
                        }
                    });
            });
        this.appendDualResetAffordance(
            faithSetting,
            "wiki_faithfulness_threshold",
            "wikiFaithfulnessThreshold",
            MESSAGES.LABEL_WIKI_FAITHFULNESS,
        );

        // Default search mode
        const searchModeSetting = new Setting(subSettingsContainer)
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
        this.appendLocalResetAffordance(searchModeSetting, "searchChunkType", MESSAGES.LABEL_WIKI_SEARCH_MODE);

        // Sync wiki to vault
        const syncSetting = new Setting(subSettingsContainer)
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
        this.appendLocalResetAffordance(syncSetting, "wikiSyncToVault", MESSAGES.LABEL_WIKI_SYNC_TO_VAULT);

        // Wiki vault folder
        const folderSetting = new Setting(subSettingsContainer)
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
        this.appendLocalResetAffordance(folderSetting, "wikiVaultFolder", MESSAGES.LABEL_WIKI_VAULT_FOLDER);

        // Run lint button
        new Setting(subSettingsContainer)
            .setName(MESSAGES.LABEL_WIKI_RUN_LINT)
            .setDesc(MESSAGES.DESC_WIKI_RUN_LINT)
            .addButton((btn) => {
                btn.setButtonText(MESSAGES.LABEL_WIKI_RUN_LINT);
                btn.onClick(() => {
                    void this.plugin.runWikiLint();
                });
            });

        // Run prune button
        new Setting(subSettingsContainer)
            .setName(MESSAGES.LABEL_WIKI_RUN_PRUNE)
            .setDesc(MESSAGES.DESC_WIKI_RUN_PRUNE)
            .addButton((btn) => {
                btn.setButtonText(MESSAGES.LABEL_WIKI_RUN_PRUNE);
                btn.onClick(() => {
                    void this.plugin.runWikiPrune();
                });
            });
    }

    private setSubSettingsVisible(container: HTMLElement, visible: boolean): void {
        container.style.display = visible ? "" : "none";
    }

    private renderAdvancedSettings(containerEl: HTMLElement): void {
        const details = containerEl.createEl("details", { cls: "lilbee-advanced-details lilbee-settings-section" });
        details.createEl("summary", { text: MESSAGES.LABEL_ADVANCED });
        details.createEl("p", {
            text: MESSAGES.LABEL_ADVANCED_HELP,
            cls: "setting-item-description",
        });

        const storeSetting = new Setting(details)
            .setName(MESSAGES.LABEL_STORE_CONTENT_IN_VAULT)
            .setDesc(MESSAGES.DESC_STORE_CONTENT_IN_VAULT)
            .addToggle((toggle) => {
                toggle.setValue(this.plugin.settings.storeContentInVault);
                toggle.setDisabled(this.plugin.settings.serverMode !== SERVER_MODE.MANAGED);
                toggle.onChange(async (value) => {
                    this.plugin.settings.storeContentInVault = value;
                    await this.plugin.saveSettings();
                    if (value) {
                        void this.plugin.configureManagedStorage();
                    }
                });
            });
        if (this.plugin.settings.serverMode !== SERVER_MODE.MANAGED) {
            storeSetting.settingEl.addClass("lilbee-setting-disabled");
        }

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
            const advancedSetting = new Setting(details)
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
            this.appendResetAffordance(advancedSetting, field.key, field.name);
        }

        this.renderRerankCandidatesField(details);

        const litellmContainer = details.createDiv({ cls: "lilbee-litellm-container" });

        const llmSetting = new Setting(details)
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
                            litellmContainer.style.display = value === "litellm" ? "" : "none";
                        } catch {
                            new Notice(MESSAGES.NOTICE_FAILED_LLM);
                        }
                    });
                this.serverConfigInputs.set("llm_provider", dropdown.selectEl as unknown as HTMLInputElement);
            });
        this.appendResetAffordance(llmSetting, "llm_provider", MESSAGES.LABEL_LLM_PROVIDER);

        const apiKeyFields: { label: string; desc: string; configKey: string }[] = [
            {
                label: MESSAGES.LABEL_OPENAI_API_KEY,
                desc: MESSAGES.DESC_OPENAI_API_KEY,
                configKey: "openai_api_key",
            },
            {
                label: MESSAGES.LABEL_ANTHROPIC_API_KEY,
                desc: MESSAGES.DESC_ANTHROPIC_API_KEY,
                configKey: "anthropic_api_key",
            },
            {
                label: MESSAGES.LABEL_GEMINI_API_KEY,
                desc: MESSAGES.DESC_GEMINI_API_KEY,
                configKey: "gemini_api_key",
            },
        ];

        for (const apiField of apiKeyFields) {
            new Setting(details)
                .setName(apiField.label)
                .setDesc(apiField.desc)
                .addText((text) => {
                    text.setPlaceholder(MESSAGES.PLACEHOLDER_SK).setValue("");
                    text.inputEl.type = "password";
                    text.inputEl.addEventListener("blur", async () => {
                        const trimmed = text.inputEl.value.trim();
                        if (trimmed === "") return;
                        try {
                            await this.plugin.api.updateConfig({ [apiField.configKey]: trimmed });
                            new Notice(MESSAGES.NOTICE_API_KEY_SAVED);
                        } catch {
                            new Notice(MESSAGES.NOTICE_FAILED_SAVE_KEY);
                        }
                    });
                });
        }

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

        litellmContainer.style.display = "none";
        const litellmSetting = new Setting(litellmContainer)
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
        this.appendResetAffordance(litellmSetting, "litellm_base_url", MESSAGES.LABEL_LITELLM_BASE_URL);

        new Setting(details)
            .setName(MESSAGES.LABEL_RESET_ALL_SETTINGS)
            .setDesc(MESSAGES.DESC_RESET_ALL_SETTINGS)
            .addButton((btn) =>
                btn
                    .setButtonText(MESSAGES.BUTTON_RESET_ALL)
                    .setWarning()
                    .onClick(async () => {
                        const confirm = new ConfirmModal(this.app, MESSAGES.CONFIRM_RESET_ALL_SETTINGS);
                        confirm.open();
                        const confirmed = await confirm.result;
                        if (!confirmed) return;
                        const payload = { ...this.configDefaults };
                        // Never wipe credential fields — resetting them would surprise the user.
                        for (const k of CREDENTIAL_FIELDS) delete payload[k];
                        if (Object.keys(payload).length === 0) return;
                        try {
                            await this.plugin.api.updateConfig(payload);
                            new Notice(MESSAGES.NOTICE_SETTINGS_RESET);
                            this.display();
                        } catch {
                            new Notice(MESSAGES.NOTICE_FAILED_RESET_ALL);
                        }
                    }),
            );
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
        const chatContainer = container.createDiv({ cls: "lilbee-chat-container" });
        this.renderChatSection(chatContainer);
        const embeddingContainer = container.createDiv({ cls: "lilbee-embedding-container" });
        this.loadEmbeddingDropdown(embeddingContainer);
        const visionContainer = container.createDiv({ cls: "lilbee-vision-container" });
        this.renderVisionSection(visionContainer);
        const rerankerContainer = container.createDiv({ cls: "lilbee-reranker-container" });
        this.renderRerankerSection(rerankerContainer);
    }

    private renderChatSection(container: HTMLElement): void {
        Promise.all([
            this.plugin.api.config(),
            this.plugin.api.catalog({ task: MODEL_TASK.CHAT }),
            this.plugin.api.installedModels({ task: MODEL_TASK.CHAT }).catch(() => ({ models: [] })),
        ])
            .then(([cfg, catalogResult, installedResp]) => {
                const active = typeof cfg.chat_model === "string" ? cfg.chat_model : "";
                const catalogEntries = catalogResult.isOk() ? catalogResult.value.models : [];
                this.renderChatPicker(container, active, catalogEntries, installedResp.models);
            })
            .catch(() => {
                // Connection status is shown via the Test button — no duplicate warning needed.
            });
    }

    private renderChatPicker(
        container: HTMLElement,
        active: string,
        catalogEntries: CatalogEntry[],
        installed: InstalledModel[],
    ): void {
        const section = container.createDiv("lilbee-model-section");
        section.createEl("h4", { text: MESSAGES.LABEL_CHAT_MODEL });

        const activeSetting = new Setting(section)
            .setName(`${MESSAGES.LABEL_ACTIVE} chat model`)
            .setDesc(displayLabelForRef(active) || MESSAGES.LABEL_NOT_SET);

        const options = this.buildChatOptions(catalogEntries, installed);
        activeSetting.addDropdown((dropdown) => {
            for (const [value, label] of options) {
                dropdown.addOption(value, label);
            }
            dropdown.setValue(active);
            dropdown.onChange(async (value) => {
                if (value === SEPARATOR_KEY) return;
                await this.handleChatChange(value, catalogEntries);
            });
        });

        const catalogEl = section.createDiv("lilbee-model-catalog");
        const table = catalogEl.createEl("table");
        const header = table.createEl("tr");
        header.createEl("th", { text: MESSAGES.LABEL_MODEL });
        header.createEl("th", { text: MESSAGES.LABEL_SIZE });
        header.createEl("th", { text: MESSAGES.LABEL_DESCRIPTION });
        header.createEl("th", { text: "" });
        for (const entry of catalogEntries) {
            this.renderChatCatalogRow(table, entry, active);
        }
    }

    private buildChatOptions(catalogEntries: CatalogEntry[], installed: InstalledModel[]): Array<[string, string]> {
        const installedRepos = new Set(installed.map((m) => extractHfRepo(m.name)));
        const opts: Array<[string, string]> = [];
        for (const entry of catalogEntries) {
            const sourceTag = entry.source && entry.source !== MODEL_SOURCE.NATIVE ? ` [${entry.source}]` : "";
            const installedFlag = installedRepos.has(entry.hf_repo);
            const suffix = installedFlag ? "" : MESSAGES.LABEL_NOT_INSTALLED;
            opts.push([entry.hf_repo, `${entry.display_name}${sourceTag}${suffix}`]);
        }
        const featuredRepos = new Set(catalogEntries.map((e) => e.hf_repo));
        const otherInstalled = installed
            .filter((m) => !featuredRepos.has(extractHfRepo(m.name)))
            .sort((a, b) => a.name.localeCompare(b.name));
        if (otherInstalled.length > 0) {
            opts.push([SEPARATOR_KEY, SEPARATOR_LABEL]);
            for (const m of otherInstalled) {
                opts.push([m.name, displayLabelForRef(m.name)]);
            }
        }
        return opts;
    }

    private async handleChatChange(value: string, catalogEntries: CatalogEntry[]): Promise<void> {
        const featuredEntry = catalogEntries.find((e) => e.hf_repo === value);
        if (featuredEntry && !featuredEntry.installed) {
            const modal = new ConfirmPullModal(this.app, {
                displayName: featuredEntry.display_name,
                sizeGb: featuredEntry.size_gb,
                minRamGb: featuredEntry.min_ram_gb,
                systemMemGb: getRelevantSystemMemoryGB(this.plugin.settings.serverMode),
            });
            modal.open();
            const confirmed = await modal.result;
            if (!confirmed) return;
            await this.pullAndSetChat(featuredEntry);
            return;
        }
        const label = featuredEntry?.display_name ?? displayLabelForRef(value);
        await this.applyChatSelection(value, label);
    }

    private async applyChatSelection(ref: string, label: string): Promise<void> {
        const result = await this.plugin.api.setChatModel(ref);
        if (result.isErr()) {
            new Notice(noticeForResultError(result.error, MESSAGES.NOTICE_FAILED_SET_MODEL(MODEL_TASK.CHAT)));
            return;
        }
        new Notice(MESSAGES.NOTICE_SET_MODEL(MESSAGES.LABEL_CHAT_MODEL, label || MESSAGES.LABEL_NOT_SET.toLowerCase()));
        this.plugin.fetchActiveModel();
        this.display();
    }

    private async pullAndSetChat(entry: CatalogEntry): Promise<void> {
        const ok = await this.streamChatPull(entry);
        if (!ok) return;
        const setResult = await this.plugin.api.setChatModel(entry.hf_repo);
        if (setResult.isErr()) {
            new Notice(
                noticeForResultError(setResult.error, MESSAGES.ERROR_SET_MODEL.replace("{model}", entry.display_name)),
            );
        } else {
            new Notice(MESSAGES.NOTICE_MODEL_ACTIVATED_FULL(entry.display_name));
        }
        this.plugin.fetchActiveModel();
        this.display();
    }

    private async streamChatPull(entry: CatalogEntry): Promise<boolean> {
        const taskId = this.plugin.taskQueue.enqueue(`Pull ${entry.display_name}`, TASK_TYPE.PULL);
        if (taskId === null) {
            new Notice(MESSAGES.NOTICE_QUEUE_FULL);
            return false;
        }
        const controller = new AbortController();
        this.plugin.taskQueue.registerAbort(taskId, controller);
        try {
            for await (const event of this.plugin.api.pullModel(
                entry.hf_repo,
                MODEL_SOURCE.NATIVE,
                controller.signal,
            )) {
                if (event.event === SSE_EVENT.PROGRESS) {
                    const d = event.data as { percent?: number; current?: number; total?: number };
                    const pct = percentFromSse(d);
                    if (pct !== undefined) {
                        this.plugin.taskQueue.update(taskId, pct, entry.display_name, {
                            current: d.current,
                            total: d.total,
                        });
                    }
                } else if (event.event === SSE_EVENT.ERROR) {
                    const msg = extractSseErrorMessage(
                        event.data as { message?: string } | string,
                        MESSAGES.ERROR_UNKNOWN,
                    );
                    new Notice(`${MESSAGES.ERROR_PULL_MODEL.replace("{model}", entry.display_name)}: ${msg}`);
                    this.plugin.taskQueue.fail(taskId, msg);
                    return false;
                }
            }
        } catch (err) {
            if (err instanceof Error && err.name === ERROR_NAME.ABORT_ERROR) {
                new Notice(MESSAGES.NOTICE_PULL_CANCELLED);
                this.plugin.taskQueue.cancel(taskId);
            } else {
                const reason = errorMessage(err, MESSAGES.ERROR_UNKNOWN);
                new Notice(`${MESSAGES.ERROR_PULL_MODEL.replace("{model}", entry.display_name)}: ${reason}`);
                this.plugin.taskQueue.fail(taskId, reason);
            }
            return false;
        }
        this.plugin.taskQueue.complete(taskId);
        return true;
    }

    private renderChatCatalogRow(table: HTMLTableElement, entry: CatalogEntry, active: string): void {
        const row = table.createEl("tr");
        row.createEl("td", { text: entry.display_name });
        row.createEl("td", { text: `${entry.size_gb} GB` });
        row.createEl("td", { text: entry.description });
        const actionCell = row.createEl("td");
        if (entry.installed) {
            actionCell.createEl("span", { text: MESSAGES.LABEL_INSTALLED, cls: "lilbee-installed" });
            const deleteBtn = actionCell.createEl("button", { cls: "lilbee-model-delete" }) as HTMLButtonElement;
            setIcon(deleteBtn, "trash-2");
            deleteBtn.setAttribute("aria-label", MESSAGES.LABEL_DELETE_MODEL);
            deleteBtn.addEventListener("click", () => this.deleteChatEntry(deleteBtn, entry, active));
        } else {
            const btn = actionCell.createEl("button", { text: MESSAGES.BUTTON_PULL }) as HTMLButtonElement;
            btn.addEventListener("click", () => this.pullAndSetChat(entry));
        }
    }

    private async deleteChatEntry(btn: HTMLButtonElement, entry: CatalogEntry, active: string): Promise<void> {
        const taskId = this.plugin.taskQueue.enqueue(`Remove ${entry.display_name}`, TASK_TYPE.DELETE);
        if (taskId === null) {
            new Notice(MESSAGES.NOTICE_QUEUE_FULL);
            return;
        }
        btn.disabled = true;
        this.plugin.taskQueue.update(taskId, -1, entry.display_name);
        const result = await this.plugin.api.deleteModel(entry.hf_repo, entry.source);
        if (result.isErr()) {
            new Notice(
                noticeForResultError(result.error, MESSAGES.ERROR_DELETE_MODEL.replace("{model}", entry.display_name)),
            );
            this.plugin.taskQueue.fail(taskId, errorMessage(result.error, result.error.message));
            btn.disabled = false;
            return;
        }
        this.plugin.taskQueue.complete(taskId);
        new Notice(MESSAGES.NOTICE_REMOVED(entry.display_name));
        if (extractHfRepo(active) === entry.hf_repo) {
            const clearResult = await this.plugin.api.setChatModel("");
            if (clearResult.isOk()) {
                this.plugin.activeModel = "";
            }
        }
        this.plugin.fetchActiveModel();
        const modelsContainer = this.containerEl.querySelector(`.${CLS_MODELS_CONTAINER}`);
        if (modelsContainer) {
            await this.loadModels(modelsContainer as HTMLElement);
        }
    }

    private renderRerankCandidatesField(container: HTMLElement): void {
        const patch = debounce((...args: unknown[]) => {
            const num = args[0] as number;
            void this.patchRerankCandidates(num);
        }, DEBOUNCE_MS);

        new Setting(container)
            .setName(MESSAGES.LABEL_RERANKER_CANDIDATES)
            .setDesc(MESSAGES.DESC_RERANKER_CANDIDATES)
            .addText((text) => {
                text.setPlaceholder(MESSAGES.PLACEHOLDER_RERANK_CANDIDATES)
                    .setValue("")
                    .onChange((value) => {
                        const trimmed = value.trim();
                        if (trimmed === "") return;
                        const num = parseInt(trimmed, 10);
                        if (isNaN(num) || num < RERANK_CANDIDATES_MIN || num > RERANK_CANDIDATES_MAX) return;
                        patch.run(num);
                    });
                this.serverConfigInputs.set("rerank_candidates", text.inputEl as unknown as HTMLInputElement);
            });
    }

    private async patchRerankCandidates(num: number): Promise<void> {
        try {
            await this.plugin.api.updateConfig({ rerank_candidates: num });
            new Notice(MESSAGES.NOTICE_FIELD_UPDATED(MESSAGES.LABEL_RERANKER_CANDIDATES));
        } catch {
            new Notice(MESSAGES.NOTICE_FAILED_UPDATE(MESSAGES.LABEL_RERANKER_CANDIDATES));
        }
    }
}
