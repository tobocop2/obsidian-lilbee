import { App, ButtonComponent, Notice, PluginSettingTab, setIcon, Setting } from "obsidian";
import type LilbeePlugin from "./main";
import type { ReleaseInfo } from "./binary-manager";
import {
    CAPABILITY,
    CHAT_MODE,
    CRAWL_RENDER_MODE,
    CRAWL_RENDER_MODE_CONFIG_KEY,
    CONFIG_KEY,
    MEMORY_CONFIG_KEY,
    DEFAULT_SETTINGS,
    HOSTED_SOURCES,
    MODEL_TASK,
    SERVER_MODE,
    SERVER_STATE,
    SSE_EVENT,
    TASK_TYPE,
    ERROR_NAME,
} from "./types";
import type { CatalogEntry, ConfigResponse, InstalledModel, LilbeeSettings, ServerMode } from "./types";
import { exportDiagnostics } from "./diagnostics-export";
import { formatBytes, reportForVault } from "./storage-stats";
import { MESSAGES } from "./locales/en";
import { displayLabelForRef, extractHfRepo, matchModelOption } from "./utils/model-ref";
import { CatalogModal } from "./views/catalog-modal";
import { hostedOptions } from "./views/catalog-helpers";
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
    noticeServerUnreachableIfApplicable,
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

/** Elements of the managed-server update progress panel. */
interface UpdateProgressEls {
    panel: HTMLElement;
    phase: HTMLElement;
    size: HTMLElement;
}

export class LilbeeSettingTab extends PluginSettingTab {
    plugin: LilbeePlugin;
    private serverConfigInputs: Map<string, HTMLInputElement> = new Map();
    private serverConfigToggles: Map<string, { setValue: (v: boolean) => unknown }> = new Map();
    private memoryToggles: Map<string, { setValue: (v: boolean) => unknown }> = new Map();
    private serverConfigTextAreas: Map<string, HTMLTextAreaElement> = new Map();
    private serverConfigDropdowns: Map<string, { setValue: (v: string) => unknown }> = new Map();
    // Rows hidden until loadServerDefaults sees a defined value for the matching cfg key.
    private serverConfigHideableEls: Map<string, HTMLElement> = new Map();
    private configDefaults: Record<string, unknown> = {};
    // Guards programmatic toggle.setValue() calls from echoing back to the server.
    private suppressToggleChanges = false;
    private chatModeSettingEl: HTMLElement | null = null;
    private chatModeDropdown: { setValue: (v: string) => unknown } | null = null;
    private chatModeSelectEl: HTMLSelectElement | null = null;
    private apiKeysContainerEl: HTMLElement | null = null;
    private crawlingContainerEl: HTMLElement | null = null;
    private wikiContainerEl: HTMLElement | null = null;

    constructor(app: App, plugin: LilbeePlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        this.render();
    }

    render(): void {
        const { containerEl } = this;
        containerEl.empty();
        this.serverConfigInputs.clear();
        this.serverConfigToggles.clear();
        this.serverConfigTextAreas.clear();
        this.serverConfigDropdowns.clear();
        this.serverConfigHideableEls.clear();

        const filterInput = containerEl.createEl("input", {
            cls: "lilbee-settings-filter",
            placeholder: MESSAGES.PLACEHOLDER_FILTER_SETTINGS,
            attr: { type: "text" },
        });
        filterInput.addEventListener("input", () => {
            this.filterSettings(containerEl, filterInput.value);
        });

        this.renderConnectionSettings(containerEl);
        this.renderModelsSection(containerEl);
        this.renderChatSettings(containerEl);
        this.renderSearchRetrievalSettings(containerEl);
        this.renderGenerationSettings(containerEl);
        this.renderMemorySection(containerEl);
        this.renderRetrievalAdvanced(containerEl);
        this.renderIngestSettings(containerEl);
        this.renderWorkerPoolSettings(containerEl);
        this.crawlingContainerEl = containerEl.createDiv();
        this.renderCrawlingSettings(this.crawlingContainerEl);
        this.wikiContainerEl = containerEl.createDiv();
        this.renderWikiSettings(this.wikiContainerEl);
        this.renderDiagnostics(containerEl);
        this.renderAdvancedSettings(containerEl);
        this.loadServerDefaults();
        this.loadConfigDefaults();
        void this.applyCapabilityGating();
    }

    private async applyCapabilityGating(): Promise<void> {
        const [apiKeys, crawling, wiki] = await Promise.all([
            this.plugin.api.getCapability(CAPABILITY.API_KEYS),
            this.plugin.api.getCapability(CAPABILITY.CRAWLING),
            this.plugin.api.getCapability(CAPABILITY.WIKI),
        ]);
        if (!apiKeys && this.apiKeysContainerEl) this.apiKeysContainerEl.hide();
        if (!crawling && this.crawlingContainerEl) this.crawlingContainerEl.hide();
        if (!wiki && this.wikiContainerEl) this.wikiContainerEl.hide();
    }

    private filterSettings(containerEl: HTMLElement, query: string): void {
        const term = query.trim().toLowerCase();
        const matches = (item: Element): boolean => {
            const name = item.querySelector(".setting-item-name")?.textContent?.toLowerCase() ?? "";
            const desc = item.querySelector(".setting-item-description")?.textContent?.toLowerCase() ?? "";
            return !term || name.includes(term) || desc.includes(term);
        };

        for (const item of Array.from(containerEl.querySelectorAll(".setting-item"))) {
            (item as HTMLElement).style.display = matches(item) ? "" : "none";
        }

        const wrappers = containerEl.querySelectorAll(
            ".lilbee-settings-section, .lilbee-models-container, .lilbee-chat-container, " +
                ".lilbee-embedding-container, .lilbee-vision-container, .lilbee-reranker-container, " +
                ".lilbee-model-section",
        );
        for (const wrapper of Array.from(wrappers)) {
            const items = Array.from(wrapper.querySelectorAll(".setting-item"));
            const anyVisible = items.some((i) => (i as HTMLElement).style.display !== "none");
            (wrapper as HTMLElement).style.display = anyVisible || !term ? "" : "none";
            if (term && anyVisible && wrapper.tagName === "DETAILS") {
                wrapper.setAttribute("open", "");
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
                        this.render();
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

        const serverState = this.plugin.serverManager?.state ?? SERVER_STATE.STOPPED;
        stateText.textContent = serverState;
        dot.classList.add(`is-${serverState}`);

        const controlSetting = new Setting(containerEl)
            .setName(MESSAGES.LABEL_SERVER_CONTROLS)
            .setDesc(MESSAGES.DESC_SERVER_CONTROLS_START_STOP);

        if (serverState === SERVER_STATE.STOPPED || serverState === SERVER_STATE.ERROR) {
            controlSetting.addButton((btn) =>
                btn.setButtonText(MESSAGES.BUTTON_START).onClick(async () => {
                    await this.plugin.startManagedServer();
                    this.render();
                }),
            );
        }
        if (serverState === SERVER_STATE.READY || serverState === SERVER_STATE.STARTING) {
            controlSetting.addButton((btn) =>
                btn.setButtonText(MESSAGES.BUTTON_STOP).onClick(async () => {
                    await this.plugin.serverManager?.stop();
                    this.render();
                }),
            );
        }
        if (serverState === SERVER_STATE.READY) {
            controlSetting.addButton((btn) =>
                btn.setButtonText(MESSAGES.BUTTON_RESTART).onClick(async () => {
                    try {
                        await this.plugin.serverManager?.restart();
                    } catch (err) {
                        new Notice(errorMessage(err, MESSAGES.ERROR_START_SERVER));
                    }
                    this.render();
                }),
            );
        }

        this.renderSharedRootSetting(containerEl);
        this.renderAdoptDataDir(containerEl);
        this.renderStorageReport(containerEl);

        const updateSetting = new Setting(containerEl)
            .setName(MESSAGES.LABEL_SERVER_VERSION)
            .setDesc(this.plugin.getSharedLilbeeVersion() || MESSAGES.DESC_SERVER_VERSION_UNKNOWN);

        const progress = this.renderUpdateProgress(containerEl);

        let pendingRelease: ReleaseInfo | null = null;
        updateSetting.addButton((checkBtn) =>
            checkBtn.setButtonText(MESSAGES.BUTTON_CHECK_UPDATES).onClick(async () => {
                if (pendingRelease) {
                    if (!(await this.runServerUpdate(pendingRelease, checkBtn, progress))) {
                        pendingRelease = null;
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
                        const current = this.plugin.getSharedLilbeeVersion() || MESSAGES.LABEL_UNKNOWN;
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

    /** Indeterminate progress panel for the managed-server update; hidden until an update runs. */
    private renderUpdateProgress(containerEl: HTMLElement): UpdateProgressEls {
        const panel = containerEl.createDiv({ cls: "lilbee-update-progress" });
        panel.hide();
        const bar = panel.createDiv({ cls: "lilbee-progress-bar-container" });
        bar.createDiv({ cls: "lilbee-progress-bar lilbee-wizard-progress-fill lilbee-wizard-progress-indeterminate" });
        const phase = panel.createDiv({ cls: "lilbee-update-progress-phase" });
        const size = panel.createDiv({ cls: "lilbee-update-progress-size" });
        return { panel, phase, size };
    }

    /** Download and install a server update, surfacing phase + total download size. Returns false on failure. */
    private async runServerUpdate(
        release: ReleaseInfo,
        checkBtn: ButtonComponent,
        progress: UpdateProgressEls,
    ): Promise<boolean> {
        checkBtn.setDisabled(true);
        checkBtn.setButtonText(MESSAGES.STATUS_DOWNLOADING);
        progress.panel.show();
        progress.size.setText(MESSAGES.STATUS_UPDATE_SIZE(release.tag, formatBytes(release.sizeBytes)));
        try {
            await this.plugin.updateServer(release, (msg) => progress.phase.setText(msg));
            new Notice(MESSAGES.NOTICE_UPDATED_TO(release.tag));
            this.render();
            return true;
        } catch (err) {
            // errorMessage carries the server's reason, e.g. insufficient disk space.
            new Notice(errorMessage(err, MESSAGES.ERROR_FAILED_UPDATE));
            console.error("[lilbee] update failed:", err);
            progress.panel.hide();
            checkBtn.setButtonText(MESSAGES.BUTTON_CHECK_UPDATES);
            checkBtn.setDisabled(false);
            return false;
        }
    }

    private renderSharedRootSetting(containerEl: HTMLElement): void {
        const resolved = this.plugin.vaultRegistry?.sharedRoot ?? "";
        new Setting(containerEl)
            .setName(MESSAGES.LABEL_SHARED_ROOT)
            .setDesc(MESSAGES.DESC_SHARED_ROOT(resolved))
            .addText((text) =>
                text
                    .setPlaceholder(resolved)
                    .setValue(this.plugin.settings.sharedRoot)
                    .onChange(async (value) => {
                        this.plugin.settings.sharedRoot = value.trim();
                        await this.plugin.saveSettings();
                    }),
            );
    }

    private renderAdoptDataDir(containerEl: HTMLElement): void {
        const registry = this.plugin.vaultRegistry;
        if (!registry) return;
        let staged = "";
        new Setting(containerEl)
            .setName(MESSAGES.LABEL_ADOPT_DATA_DIR)
            .setDesc(MESSAGES.DESC_ADOPT_DATA_DIR)
            .addText((text) =>
                text.setPlaceholder(MESSAGES.PLACEHOLDER_ADOPT_DATA_DIR).onChange((value) => {
                    staged = value.trim();
                }),
            )
            .addButton((btn) =>
                btn.setButtonText(MESSAGES.BUTTON_ADOPT_DATA_DIR).onClick(async () => {
                    if (!staged) {
                        new Notice(MESSAGES.NOTICE_ADOPT_DATA_DIR_BLANK);
                        return;
                    }
                    await this.plugin.adoptDataDir(staged);
                    new Notice(MESSAGES.NOTICE_ADOPT_DATA_DIR_DONE(staged));
                    this.render();
                }),
            );
    }

    private renderStorageReport(containerEl: HTMLElement): void {
        const registry = this.plugin.vaultRegistry;
        if (!registry) return;
        const report = reportForVault(registry.sharedRoot, registry.resolveDataDir(this.plugin.vaultId));
        new Setting(containerEl).setName(MESSAGES.LABEL_STORAGE_REPORT).setDesc(MESSAGES.DESC_STORAGE_REPORT);

        const list = containerEl.createDiv({ cls: "lilbee-storage-report" });
        appendStorageRow(list, MESSAGES.LABEL_STORAGE_BIN, report.binBytes);
        appendStorageRow(list, MESSAGES.LABEL_STORAGE_MODELS, report.modelsBytes);
        appendStorageRow(list, MESSAGES.LABEL_STORAGE_VAULT, report.vaultBytes, report.vaultDataDir);
        appendStorageRow(list, MESSAGES.LABEL_STORAGE_TOTAL, report.totalBytes);
    }

    private renderDiagnostics(containerEl: HTMLElement): void {
        new Setting(containerEl)
            .setName(MESSAGES.LABEL_EXPORT_DIAGNOSTICS)
            .setDesc(MESSAGES.DESC_EXPORT_DIAGNOSTICS)
            .addButton((btn) =>
                btn.setButtonText(MESSAGES.BUTTON_EXPORT_DIAGNOSTICS).onClick(() => {
                    void exportDiagnostics(this.plugin.diagnosticsContext());
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
                    this.render();
                }),
            );
    }

    private renderModelsSection(containerEl: HTMLElement): void {
        new Setting(containerEl).setName(MESSAGES.LABEL_MODELS).setHeading();
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

        void this.loadModels(modelsContainer);
    }

    private renderChatSettings(containerEl: HTMLElement): void {
        new Setting(containerEl).setName(MESSAGES.LABEL_CHAT_SECTION).setHeading();

        const showReasoningSetting = new Setting(containerEl)
            .setName(MESSAGES.LABEL_SHOW_REASONING)
            .setDesc(MESSAGES.DESC_SHOW_REASONING)
            .addToggle((toggle) => {
                toggle.onChange(async (value) => {
                    if (this.suppressToggleChanges) return;
                    try {
                        await this.plugin.api.updateConfig({ [CONFIG_KEY.SHOW_REASONING]: value });
                        new Notice(MESSAGES.NOTICE_FIELD_UPDATED(MESSAGES.LABEL_SHOW_REASONING));
                    } catch {
                        new Notice(MESSAGES.NOTICE_FAILED_UPDATE(MESSAGES.LABEL_SHOW_REASONING));
                    }
                });
                this.serverConfigToggles.set(CONFIG_KEY.SHOW_REASONING, toggle);
            });
        showReasoningSetting.settingEl.hide();
        this.serverConfigHideableEls.set(CONFIG_KEY.SHOW_REASONING, showReasoningSetting.settingEl);
    }

    private renderSearchRetrievalSettings(containerEl: HTMLElement): void {
        new Setting(containerEl).setName(MESSAGES.LABEL_SEARCH_RETRIEVAL).setHeading();

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
                // Populate editable server-config inputs with the current server values
                // and surface them as placeholders so users see what's effective when
                // they clear an override.
                for (const [key, inputEl] of this.serverConfigInputs) {
                    const v = cfg[key];
                    if (v === undefined) continue;
                    const formatted =
                        typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : "";
                    inputEl.value = formatted;
                    if (formatted !== "") {
                        inputEl.placeholder = formatted;
                    }
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
                for (const [key, dropdown] of this.serverConfigDropdowns) {
                    const v = cfg[key];
                    if (typeof v === "string") {
                        dropdown.setValue(v);
                    }
                }
                if (typeof cfg.rag_system_prompt === "string") {
                    const ragInput = this.serverConfigInputs.get("rag_system_prompt");
                    if (ragInput) {
                        ragInput.placeholder = cfg.rag_system_prompt;
                    }
                }
                if (typeof cfg.general_system_prompt === "string") {
                    const generalInput = this.serverConfigInputs.get("general_system_prompt");
                    if (generalInput) {
                        generalInput.placeholder = cfg.general_system_prompt;
                    }
                }
                this.applyChatModeFromConfig(cfg);
                this.applyHideableConfigFields(cfg);
            })
            .catch(() => {
                // Connection status is shown via the Test button — no duplicate warning needed
            });
    }

    private applyHideableConfigFields(cfg: ConfigResponse): void {
        // The initial render leaves each row's settingEl with display = "none". When the server
        // reports a value for a key, reveal the row. Older servers omit unknown keys entirely,
        // in which case the row stays hidden via its initial style.
        for (const [key, settingEl] of this.serverConfigHideableEls) {
            if (cfg[key] !== undefined) {
                settingEl.show();
            }
        }
    }

    private applyChatModeFromConfig(cfg: ConfigResponse): void {
        /* v8 ignore next 2 */
        if (!this.chatModeSettingEl) return;
        if (cfg.chat_mode === undefined) {
            this.chatModeSettingEl.hide();
            return;
        }
        this.chatModeSettingEl.show();
        if (this.chatModeDropdown) {
            this.chatModeDropdown.setValue(cfg.chat_mode);
        }
        if (this.chatModeSelectEl) {
            const noEmbedding = !cfg.embedding_model || cfg.embedding_model === "";
            this.chatModeSelectEl.disabled = noEmbedding;
            this.chatModeSelectEl.title = noEmbedding ? MESSAGES.TOOLTIP_CHAT_MODE_NEEDS_EMBEDDING : "";
        }
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
                        this.render();
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
                    this.render();
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
                        this.render();
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

        const ragPromptSetting = new Setting(details)
            .setName(MESSAGES.LABEL_RAG_SYSTEM_PROMPT)
            .setDesc(MESSAGES.DESC_RAG_SYSTEM_PROMPT)
            .addTextArea((text) => {
                text.setPlaceholder(MESSAGES.PLACEHOLDER_DEFAULT)
                    .setValue(this.plugin.settings.ragSystemPrompt)
                    .onChange(async (value) => {
                        this.plugin.settings.ragSystemPrompt = value;
                        await this.plugin.saveSettings();
                    });
                this.serverConfigInputs.set("rag_system_prompt", text.inputEl as unknown as HTMLInputElement);
            });
        this.appendLocalResetAffordance(ragPromptSetting, "ragSystemPrompt", MESSAGES.LABEL_RAG_SYSTEM_PROMPT);

        const generalPromptSetting = new Setting(details)
            .setName(MESSAGES.LABEL_GENERAL_SYSTEM_PROMPT)
            .setDesc(MESSAGES.DESC_GENERAL_SYSTEM_PROMPT)
            .addTextArea((text) => {
                text.setPlaceholder(MESSAGES.PLACEHOLDER_DEFAULT)
                    .setValue(this.plugin.settings.generalSystemPrompt)
                    .onChange(async (value) => {
                        this.plugin.settings.generalSystemPrompt = value;
                        await this.plugin.saveSettings();
                    });
                this.serverConfigInputs.set("general_system_prompt", text.inputEl as unknown as HTMLInputElement);
            });
        this.appendLocalResetAffordance(
            generalPromptSetting,
            "generalSystemPrompt",
            MESSAGES.LABEL_GENERAL_SYSTEM_PROMPT,
        );

        const chatModeSetting = new Setting(details)
            .setName(MESSAGES.LABEL_CHAT_MODE)
            .setDesc(MESSAGES.DESC_CHAT_MODE)
            .addDropdown((dd) => {
                dd.addOption(CHAT_MODE.SEARCH, MESSAGES.LABEL_CHAT_MODE_SEARCH);
                dd.addOption(CHAT_MODE.CHAT, MESSAGES.LABEL_CHAT_MODE_CHAT);
                dd.setValue(CHAT_MODE.SEARCH);
                dd.onChange(async (value) => {
                    try {
                        await this.plugin.api.updateConfig({ [CONFIG_KEY.CHAT_MODE]: value });
                    } catch {
                        new Notice(MESSAGES.NOTICE_FAILED_UPDATE(MESSAGES.LABEL_CHAT_MODE));
                    }
                });
                this.chatModeDropdown = dd;
                this.chatModeSelectEl = dd.selectEl;
            });
        this.chatModeSettingEl = chatModeSetting.settingEl;
        this.chatModeSettingEl.hide();

        const fields: { key: string; name: string; desc: string; integer: boolean; hideable?: boolean }[] = [
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
            // num_ctx is intentionally not surfaced — it's a model-side
            // property. The server picks a context window appropriate to the
            // active model; exposing it as a user knob invites mismatches
            // (asking for more than the model supports, or over-allocating
            // RAM for no benefit).
            {
                key: "seed",
                name: MESSAGES.LABEL_GEN_SEED,
                desc: MESSAGES.DESC_GEN_SEED,
                integer: true,
            },
            {
                key: "max_tokens",
                name: MESSAGES.LABEL_GEN_MAX_TOKENS,
                desc: MESSAGES.DESC_GEN_MAX_TOKENS,
                integer: true,
                hideable: true,
            },
            {
                key: "max_reasoning_chars",
                name: MESSAGES.LABEL_GEN_MAX_REASONING_CHARS,
                desc: MESSAGES.DESC_GEN_MAX_REASONING_CHARS,
                integer: true,
                hideable: true,
            },
            {
                key: "model_keep_alive",
                name: MESSAGES.LABEL_GEN_MODEL_KEEP_ALIVE,
                desc: MESSAGES.DESC_GEN_MODEL_KEEP_ALIVE,
                integer: true,
                hideable: true,
            },
            {
                key: "gpu_memory_fraction",
                name: MESSAGES.LABEL_GEN_GPU_MEMORY_FRACTION,
                desc: MESSAGES.DESC_GEN_GPU_MEMORY_FRACTION,
                integer: false,
                hideable: true,
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
            if (field.hideable) {
                genSetting.settingEl.hide();
                this.serverConfigHideableEls.set(field.key, genSetting.settingEl);
            }
        }
    }

    private renderWorkerPoolSettings(containerEl: HTMLElement): void {
        const details = containerEl.createEl("details", {
            cls: "lilbee-worker-pool-details lilbee-settings-section",
        });
        details.createEl("summary", { text: MESSAGES.LABEL_WORKER_POOL });
        details.createEl("p", {
            text: MESSAGES.LABEL_WORKER_POOL_HELP,
            cls: "setting-item-description",
        });

        const callTimeoutSetting = this.renderHideableNumberField(
            details,
            "worker_pool_call_timeout_s",
            MESSAGES.LABEL_WORKER_POOL_CALL_TIMEOUT,
            MESSAGES.DESC_WORKER_POOL_CALL_TIMEOUT,
            { integer: false, min: 0 },
        );
        this.appendResetAffordance(
            callTimeoutSetting,
            "worker_pool_call_timeout_s",
            MESSAGES.LABEL_WORKER_POOL_CALL_TIMEOUT,
        );

        const eagerStartSetting = new Setting(details)
            .setName(MESSAGES.LABEL_WORKER_POOL_EAGER_START)
            .setDesc(MESSAGES.DESC_WORKER_POOL_EAGER_START)
            .addToggle((toggle) => {
                toggle.onChange(async (value) => {
                    if (this.suppressToggleChanges) return;
                    try {
                        await this.plugin.api.updateConfig({ worker_pool_eager_start: value });
                        new Notice(MESSAGES.NOTICE_FIELD_UPDATED(MESSAGES.LABEL_WORKER_POOL_EAGER_START));
                    } catch {
                        new Notice(MESSAGES.NOTICE_FAILED_UPDATE(MESSAGES.LABEL_WORKER_POOL_EAGER_START));
                    }
                });
                this.serverConfigToggles.set("worker_pool_eager_start", toggle);
            });
        this.appendResetAffordance(
            eagerStartSetting,
            "worker_pool_eager_start",
            MESSAGES.LABEL_WORKER_POOL_EAGER_START,
        );
        eagerStartSetting.settingEl.hide();
        this.serverConfigHideableEls.set("worker_pool_eager_start", eagerStartSetting.settingEl);

        const maxIdleSetting = this.renderHideableNumberField(
            details,
            "worker_pool_max_idle_s",
            MESSAGES.LABEL_WORKER_POOL_MAX_IDLE,
            MESSAGES.DESC_WORKER_POOL_MAX_IDLE,
            { integer: false, min: 0 },
        );
        this.appendResetAffordance(maxIdleSetting, "worker_pool_max_idle_s", MESSAGES.LABEL_WORKER_POOL_MAX_IDLE);
    }

    private renderIngestSettings(containerEl: HTMLElement): void {
        const details = containerEl.createEl("details", {
            cls: "lilbee-ingest-details lilbee-settings-section",
        });
        details.createEl("summary", { text: MESSAGES.LABEL_INGEST });
        details.createEl("p", {
            text: MESSAGES.LABEL_INGEST_HELP,
            cls: "setting-item-description",
        });

        const chunkSizeSetting = this.renderHideableNumberField(
            details,
            "chunk_size",
            MESSAGES.LABEL_CHUNK_SIZE,
            MESSAGES.DESC_CHUNK_SIZE,
            { integer: true, min: 1, reindex: true },
        );
        this.appendResetAffordance(chunkSizeSetting, "chunk_size", MESSAGES.LABEL_CHUNK_SIZE);

        const chunkOverlapSetting = this.renderHideableNumberField(
            details,
            "chunk_overlap",
            MESSAGES.LABEL_CHUNK_OVERLAP,
            MESSAGES.DESC_CHUNK_OVERLAP,
            { integer: true, min: 0, reindex: true },
        );
        this.appendResetAffordance(chunkOverlapSetting, "chunk_overlap", MESSAGES.LABEL_CHUNK_OVERLAP);

        const tesseractSetting = this.renderHideableNumberField(
            details,
            "tesseract_timeout",
            MESSAGES.LABEL_TESSERACT_TIMEOUT,
            MESSAGES.DESC_TESSERACT_TIMEOUT,
            { integer: false, min: 0 },
        );
        this.appendResetAffordance(tesseractSetting, "tesseract_timeout", MESSAGES.LABEL_TESSERACT_TIMEOUT);

        const visionBudgetSetting = this.renderHideableNumberField(
            details,
            "vision_load_budget_s",
            MESSAGES.LABEL_VISION_LOAD_BUDGET,
            MESSAGES.DESC_VISION_LOAD_BUDGET,
            { integer: false, min: 0 },
        );
        this.appendResetAffordance(visionBudgetSetting, "vision_load_budget_s", MESSAGES.LABEL_VISION_LOAD_BUDGET);
    }

    private renderMemorySection(containerEl: HTMLElement): void {
        const section = containerEl.createDiv({ cls: "lilbee-settings-section" });
        new Setting(section).setName(MESSAGES.LABEL_MEMORY_SECTION).setHeading();
        this.plugin.api
            .config()
            .then((cfg) => {
                this.renderMemoryToggle(
                    section,
                    MEMORY_CONFIG_KEY.ENABLED,
                    cfg[MEMORY_CONFIG_KEY.ENABLED] === true,
                    MESSAGES.LABEL_MEMORY_ENABLED,
                    MESSAGES.DESC_MEMORY_ENABLED,
                );
                this.renderMemoryToggle(
                    section,
                    MEMORY_CONFIG_KEY.AUTO_EXTRACT,
                    cfg[MEMORY_CONFIG_KEY.AUTO_EXTRACT] === true,
                    MESSAGES.LABEL_MEMORY_AUTO_EXTRACT,
                    MESSAGES.DESC_MEMORY_AUTO_EXTRACT,
                );
            })
            .catch((err) => {
                if (noticeServerUnreachableIfApplicable(err)) return;
                new Notice(MESSAGES.NOTICE_MEMORY_CONFIG_FAILED);
            });
    }

    private renderMemoryToggle(section: HTMLElement, key: string, initial: boolean, name: string, desc: string): void {
        new Setting(section)
            .setName(name)
            .setDesc(desc)
            .addToggle((toggle) => {
                toggle.setValue(initial);
                toggle.onChange(async (value) => {
                    try {
                        await this.plugin.api.updateConfig({ [key]: value });
                        new Notice(MESSAGES.NOTICE_FIELD_UPDATED(name));
                    } catch {
                        new Notice(MESSAGES.NOTICE_FAILED_UPDATE(name));
                    }
                });
                this.memoryToggles.set(key, toggle);
            });
    }

    private renderRetrievalAdvanced(containerEl: HTMLElement): void {
        const details = containerEl.createEl("details", {
            cls: "lilbee-retrieval-advanced-details lilbee-settings-section",
        });
        details.createEl("summary", { text: MESSAGES.LABEL_RETRIEVAL_ADVANCED });
        details.createEl("p", {
            text: MESSAGES.LABEL_RETRIEVAL_ADVANCED_HELP,
            cls: "setting-item-description",
        });

        const candidateSetting = this.renderHideableNumberField(
            details,
            "candidate_multiplier",
            MESSAGES.LABEL_CANDIDATE_MULTIPLIER,
            MESSAGES.DESC_CANDIDATE_MULTIPLIER,
            { integer: true, min: 1 },
        );
        this.appendResetAffordance(candidateSetting, "candidate_multiplier", MESSAGES.LABEL_CANDIDATE_MULTIPLIER);

        const minRelevanceSetting = this.renderHideableNumberField(
            details,
            "min_relevance_score",
            MESSAGES.LABEL_MIN_RELEVANCE_SCORE,
            MESSAGES.DESC_MIN_RELEVANCE_SCORE,
            { integer: false, min: 0 },
        );
        this.appendResetAffordance(minRelevanceSetting, "min_relevance_score", MESSAGES.LABEL_MIN_RELEVANCE_SCORE);

        const maxSourcesSetting = this.renderHideableNumberField(
            details,
            "max_context_sources",
            MESSAGES.LABEL_MAX_CONTEXT_SOURCES,
            MESSAGES.DESC_MAX_CONTEXT_SOURCES,
            { integer: true, min: 1 },
        );
        this.appendResetAffordance(maxSourcesSetting, "max_context_sources", MESSAGES.LABEL_MAX_CONTEXT_SOURCES);

        const diversitySetting = this.renderHideableNumberField(
            details,
            "diversity_max_per_source",
            MESSAGES.LABEL_DIVERSITY_MAX_PER_SOURCE,
            MESSAGES.DESC_DIVERSITY_MAX_PER_SOURCE,
            { integer: true, min: 1 },
        );
        this.appendResetAffordance(
            diversitySetting,
            "diversity_max_per_source",
            MESSAGES.LABEL_DIVERSITY_MAX_PER_SOURCE,
        );

        const mmrSetting = this.renderHideableNumberField(
            details,
            "mmr_lambda",
            MESSAGES.LABEL_MMR_LAMBDA,
            MESSAGES.DESC_MMR_LAMBDA,
            { integer: false, min: 0 },
        );
        this.appendResetAffordance(mmrSetting, "mmr_lambda", MESSAGES.LABEL_MMR_LAMBDA);
    }

    private renderHideableNumberField(
        container: HTMLElement,
        key: string,
        name: string,
        desc: string,
        opts: { integer: boolean; min?: number; reindex?: boolean },
    ): Setting {
        const setting = new Setting(container)
            .setName(name)
            .setDesc(desc)
            .addText((text) => {
                text.setPlaceholder(MESSAGES.PLACEHOLDER_NOT_SET)
                    .setValue("")
                    .onChange(async (value) => {
                        await this.handleHideableNumberChange(value, key, name, opts);
                    });
                this.serverConfigInputs.set(key, text.inputEl);
            });
        setting.settingEl.hide();
        this.serverConfigHideableEls.set(key, setting.settingEl);
        return setting;
    }

    private async handleHideableNumberChange(
        value: string,
        key: string,
        name: string,
        opts: { integer: boolean; min?: number; reindex?: boolean },
    ): Promise<void> {
        const trimmed = value.trim();
        if (trimmed === "") return;
        const num = opts.integer ? parseInt(trimmed, 10) : parseFloat(trimmed);
        if (isNaN(num)) return;
        if (opts.min !== undefined && num < opts.min) return;
        if (opts.reindex) {
            const confirmModal = new ConfirmModal(this.app, MESSAGES.DESC_REINDEX_WARNING.replace("{field}", name));
            confirmModal.open();
            const confirmed = await confirmModal.result;
            if (!confirmed) return;
        }
        try {
            const result = await this.plugin.api.updateConfig({ [key]: num });
            new Notice(MESSAGES.NOTICE_FIELD_UPDATED(name));
            if (opts.reindex && result.reindex_required) {
                new Notice(MESSAGES.NOTICE_REINDEX_REQUIRED);
                void this.plugin.triggerSync();
            }
        } catch {
            new Notice(MESSAGES.NOTICE_FAILED_UPDATE(name));
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
                // Settings dropdown lists installed local embedding models plus
                // always-on hosted ones (e.g. an Ollama embedding model), matching
                // the chat/vision/reranker pickers. Discovery and downloads happen
                // via Browse catalog, which the button on the right of this row opens.
                const catalogEntries = result.value.models;
                const localInstalled = catalogEntries.filter(
                    (m) => m.task === MODEL_TASK.EMBEDDING && m.installed && !HOSTED_SOURCES.has(m.source),
                );
                new Setting(container)
                    .setName(MESSAGES.LABEL_EMBEDDING_MODEL)
                    .setDesc(MESSAGES.DESC_EMBEDDING_MODEL)
                    .addDropdown((dropdown) => {
                        for (const model of localInstalled) {
                            dropdown.addOption(model.hf_repo, model.display_name);
                        }
                        for (const [ref, label] of hostedOptions(catalogEntries)) {
                            dropdown.addOption(ref, label);
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
                const catalogEntries = catalogResult.isOk()
                    ? catalogResult.value.models.filter((m) => m.task === MODEL_TASK.RERANK)
                    : [];
                this.renderRerankerDropdown(container, active, catalogEntries, installedResp.models);
            })
            .catch((err) => {
                if (noticeServerUnreachableIfApplicable(err)) return;
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
                dropdown.setValue(
                    matchModelOption(
                        active || RERANKER_DISABLED_KEY,
                        options.map(([value]) => value),
                    ),
                );
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
        // provider refs pass through unchanged so hosted rerankers aren't mislabelled.
        const installedRepos = new Set(installed.map((m) => extractHfRepo(m.name)));
        const isInstalled = (e: CatalogEntry): boolean => installedRepos.has(e.hf_repo);
        const opts: Array<[string, string]> = [[RERANKER_DISABLED_KEY, MESSAGES.LABEL_RERANKER_DISABLED]];
        // Settings dropdown lists installed local rerankers + always-on hosted rerankers.
        // Discovery and downloads happen via the Browse catalog button.
        const localInstalled = catalogEntries.filter((e) => !HOSTED_SOURCES.has(e.source) && isInstalled(e));
        for (const e of localInstalled) opts.push([e.hf_repo, e.display_name]);
        for (const [ref, label] of hostedOptions(catalogEntries)) {
            opts.push([ref, `${label} — ${MESSAGES.LABEL_RERANKER_HOSTED_GROUP}`]);
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
            (catalogEntry !== undefined && HOSTED_SOURCES.has(catalogEntry.source))
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
            for await (const event of this.plugin.api.pullModel(entry.hf_repo, "native", signal)) {
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
        const msg = extractSseErrorMessage(data, MESSAGES.ERROR_UNKNOWN);
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
                const catalogEntries = catalogResult.isOk()
                    ? catalogResult.value.models.filter((m) => m.task === MODEL_TASK.VISION)
                    : [];
                this.renderVisionDropdown(container, active, catalogEntries, installedResp.models);
            })
            .catch((err) => {
                if (noticeServerUnreachableIfApplicable(err)) return;
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
                dropdown.setValue(
                    matchModelOption(
                        active || VISION_DISABLED_KEY,
                        options.map(([value]) => value),
                    ),
                );
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
        // Settings dropdown lists installed local vision models + hosted ones.
        // Discovery and downloads happen via the Browse catalog button.
        const localInstalled = catalogEntries.filter(
            (e) => !HOSTED_SOURCES.has(e.source) && installedRepos.has(e.hf_repo),
        );
        for (const e of localInstalled) opts.push([e.hf_repo, e.display_name]);
        for (const [ref, label] of hostedOptions(catalogEntries)) {
            opts.push([ref, `${label} — ${MESSAGES.LABEL_VISION_HOSTED_GROUP}`]);
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
            (catalogEntry !== undefined && HOSTED_SOURCES.has(catalogEntry.source))
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
            for await (const event of this.plugin.api.pullModel(entry.hf_repo, "native", signal)) {
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
        const msg = extractSseErrorMessage(data, MESSAGES.ERROR_UNKNOWN);
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
                this.serverConfigInputs.set("embedding_model", text.inputEl);
            });
    }

    private renderCrawlingSettings(containerEl: HTMLElement): void {
        new Setting(containerEl).setName(MESSAGES.LABEL_CRAWLING).setHeading();

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
                    this.serverConfigInputs.set(numField.key, text.inputEl);
                });
            this.appendResetAffordance(numSetting, numField.key, numField.name);
        }

        // Wrap the render-mode row in its own child div so the hide-until-supported
        // toggle targets just this row, not the capability-gated crawling container.
        const renderModeContainer = containerEl.createDiv();
        const renderModeSetting = new Setting(renderModeContainer)
            .setName(MESSAGES.LABEL_CRAWL_RENDER_MODE)
            .setDesc(MESSAGES.DESC_CRAWL_RENDER_MODE)
            .addDropdown((dropdown) => {
                dropdown.addOption(CRAWL_RENDER_MODE.HTTP, MESSAGES.LABEL_CRAWL_RENDER_MODE_HTTP);
                dropdown.addOption(CRAWL_RENDER_MODE.BROWSER, MESSAGES.LABEL_CRAWL_RENDER_MODE_BROWSER);
                dropdown.setValue(CRAWL_RENDER_MODE.HTTP);
                dropdown.onChange(async (value) => {
                    try {
                        await this.plugin.api.updateConfig({ [CRAWL_RENDER_MODE_CONFIG_KEY]: value });
                        new Notice(MESSAGES.NOTICE_FIELD_UPDATED(MESSAGES.LABEL_CRAWL_RENDER_MODE));
                    } catch {
                        new Notice(MESSAGES.NOTICE_FAILED_UPDATE(MESSAGES.LABEL_CRAWL_RENDER_MODE));
                    }
                });
                this.serverConfigDropdowns.set(CRAWL_RENDER_MODE_CONFIG_KEY, dropdown);
            });
        this.appendResetAffordance(renderModeSetting, CRAWL_RENDER_MODE_CONFIG_KEY, MESSAGES.LABEL_CRAWL_RENDER_MODE);
        renderModeContainer.hide();
        this.serverConfigHideableEls.set(CRAWL_RENDER_MODE_CONFIG_KEY, renderModeContainer);

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
                this.serverConfigTextAreas.set("crawl_exclude_patterns", text.inputEl);
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

        this.renderRerankCandidatesField(details);

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
                        } catch {
                            new Notice(MESSAGES.NOTICE_FAILED_LLM);
                        }
                    });
                this.serverConfigInputs.set("llm_provider", dropdown.selectEl as unknown as HTMLInputElement);
            });
        this.appendResetAffordance(llmSetting, "llm_provider", MESSAGES.LABEL_LLM_PROVIDER);

        const apiKeyFields: { label: string; desc: string; configKey: string; provider: string }[] = [
            {
                label: MESSAGES.LABEL_OPENAI_API_KEY,
                desc: MESSAGES.DESC_OPENAI_API_KEY,
                configKey: "openai_api_key",
                provider: "openai",
            },
            {
                label: MESSAGES.LABEL_ANTHROPIC_API_KEY,
                desc: MESSAGES.DESC_ANTHROPIC_API_KEY,
                configKey: "anthropic_api_key",
                provider: "anthropic",
            },
            {
                label: MESSAGES.LABEL_GEMINI_API_KEY,
                desc: MESSAGES.DESC_GEMINI_API_KEY,
                configKey: "gemini_api_key",
                provider: "gemini",
            },
        ];

        const apiKeysContainer = details.createDiv({ cls: "lilbee-api-keys-section" });
        this.apiKeysContainerEl = apiKeysContainer;
        for (const apiField of apiKeyFields) {
            const setting = new Setting(apiKeysContainer)
                .setName(apiField.label)
                .setDesc(apiField.desc)
                .addText((text) => {
                    text.setPlaceholder(MESSAGES.PLACEHOLDER_SK).setValue("");
                    text.inputEl.type = "password";
                    const saveKey = async (): Promise<void> => {
                        const trimmed = text.inputEl.value.trim();
                        if (trimmed === "") return;
                        try {
                            await this.plugin.api.updateConfig({ [apiField.configKey]: trimmed });
                            this.plugin.api.invalidateCapability(CAPABILITY.API_KEYS);
                            new Notice(MESSAGES.NOTICE_API_KEY_SAVED);
                        } catch {
                            new Notice(MESSAGES.NOTICE_FAILED_SAVE_KEY);
                        }
                    };
                    text.inputEl.addEventListener("blur", () => void saveKey());
                });
            setting.settingEl.setAttribute("data-lilbee-api-key", apiField.provider);
        }

        new Setting(details)
            .setName(MESSAGES.LABEL_HF_TOKEN)
            .setDesc(MESSAGES.DESC_HF_TOKEN)
            .addText((text) => {
                text.setPlaceholder(MESSAGES.PLACEHOLDER_HF_TOKEN)
                    .setValue(this.plugin.getSharedHfToken())
                    .onChange(async (value) => {
                        const trimmed = value.trim();
                        this.plugin.setSharedHfToken(trimmed);
                        try {
                            await this.plugin.api.updateConfig({ hf_token: trimmed });
                            new Notice(MESSAGES.NOTICE_HF_TOKEN_SAVED);
                        } catch {
                            new Notice(MESSAGES.NOTICE_FAILED_HF_TOKEN);
                        }
                    });
                text.inputEl.type = "password";
            });

        const localServerFields: {
            label: string;
            desc: string;
            configKey: string;
            placeholder: string;
        }[] = [
            {
                label: MESSAGES.LABEL_OLLAMA_BASE_URL,
                desc: MESSAGES.DESC_OLLAMA_BASE_URL,
                configKey: "ollama_base_url",
                placeholder: "http://localhost:11434",
            },
            {
                label: MESSAGES.LABEL_LM_STUDIO_BASE_URL,
                desc: MESSAGES.DESC_LM_STUDIO_BASE_URL,
                configKey: "lm_studio_base_url",
                placeholder: "http://localhost:1234/v1",
            },
        ];
        for (const field of localServerFields) {
            const setting = new Setting(details)
                .setName(field.label)
                .setDesc(field.desc)
                .addText((text) => {
                    text.setPlaceholder(field.placeholder)
                        .setValue("")
                        .onChange(async (value) => {
                            const trimmed = value.trim();
                            if (trimmed === "") return;
                            try {
                                await this.plugin.api.updateConfig({ [field.configKey]: trimmed });
                                new Notice(MESSAGES.NOTICE_LOCAL_SERVER_URL_UPDATED);
                            } catch {
                                new Notice(MESSAGES.NOTICE_FAILED_LOCAL_SERVER_URL);
                            }
                        });
                    this.serverConfigInputs.set(field.configKey, text.inputEl);
                });
            this.appendResetAffordance(setting, field.configKey, field.label);
        }

        const cockpitSetting = new Setting(details)
            .setName(MESSAGES.LABEL_AUTO_OPEN_COCKPIT)
            .setDesc(MESSAGES.DESC_AUTO_OPEN_COCKPIT)
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.autoOpenCockpit).onChange(async (value) => {
                    this.plugin.settings.autoOpenCockpit = value;
                    await this.plugin.saveSettings();
                }),
            );
        this.appendLocalResetAffordance(cockpitSetting, "autoOpenCockpit", MESSAGES.LABEL_AUTO_OPEN_COCKPIT);

        new Setting(details)
            .setName(MESSAGES.LABEL_RESET_ALL_SETTINGS)
            .setDesc(MESSAGES.DESC_RESET_ALL_SETTINGS)
            .addButton((btn) =>
                btn
                    .setButtonText(MESSAGES.BUTTON_RESET_ALL)
                    .setClass("mod-warning")
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
                            this.render();
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
            const timeout = window.setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
            const response = await window.fetch(url, { signal: controller.signal });
            window.clearTimeout(timeout);
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
                // Defensive client-side task filter: older server builds and
                // some frontier providers return rows tagged with a different
                // task than requested, which would surface embedding/vision
                // models in the chat dropdown.
                const catalogEntries = catalogResult.isOk()
                    ? catalogResult.value.models.filter((m) => m.task === MODEL_TASK.CHAT)
                    : [];
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
        new Setting(section).setName(MESSAGES.LABEL_CHAT_MODEL).setHeading();

        const activeSetting = new Setting(section)
            .setName(`${MESSAGES.LABEL_ACTIVE} chat model`)
            .setDesc(displayLabelForRef(active) || MESSAGES.LABEL_NOT_SET);

        const options = this.buildChatOptions(catalogEntries, installed);
        activeSetting.addDropdown((dropdown) => {
            for (const [value, label] of options) {
                dropdown.addOption(value, label);
            }
            dropdown.setValue(
                matchModelOption(
                    active,
                    options.map(([value]) => value),
                ),
            );
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
        // Settings is a quick-pick of what's already on disk; downloads happen
        // in Browse Catalog. Showing 30 "(not installed)" entries here is
        // noise that pushes installed models off-screen.
        const installedRepos = new Set(installed.map((m) => extractHfRepo(m.name)));
        const opts: Array<[string, string]> = [];
        const featuredInstalled = catalogEntries.filter((e) => installedRepos.has(e.hf_repo));
        for (const entry of featuredInstalled) {
            const sourceTag = HOSTED_SOURCES.has(entry.source) ? ` [${entry.provider ?? entry.source}]` : "";
            opts.push([entry.hf_repo, `${entry.display_name}${sourceTag}`]);
        }
        // Hosted rows are selectable even when absent from the installed
        // registry — ollama always, frontier with a ready key. Skip any already
        // emitted above as an installed featured row.
        for (const [ref, label] of hostedOptions(catalogEntries)) {
            if (!installedRepos.has(ref)) opts.push([ref, label]);
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
        void this.plugin.fetchActiveModel();
        this.render();
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
        void this.plugin.fetchActiveModel();
        this.render();
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
            for await (const event of this.plugin.api.pullModel(entry.hf_repo, "native", controller.signal)) {
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
                    const msg = extractSseErrorMessage(event.data, MESSAGES.ERROR_UNKNOWN);
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
        // Wrap the action contents in an inner div so the cell stays a
        // proper table cell — display:flex on a <td> drops it out of
        // the table layout and any wrapped text in adjacent cells then
        // misaligns the row.
        const actions = actionCell.createDiv({ cls: "lilbee-model-actions" });
        if (entry.installed) {
            actions.createEl("span", { text: MESSAGES.LABEL_INSTALLED, cls: "lilbee-installed" });
            const deleteBtn = actions.createEl("button", { cls: "lilbee-model-delete" });
            setIcon(deleteBtn, "trash-2");
            deleteBtn.setAttribute("aria-label", MESSAGES.LABEL_DELETE_MODEL);
            deleteBtn.addEventListener("click", () => void this.deleteChatEntry(deleteBtn, entry, active));
        } else {
            const btn = actions.createEl("button", { text: MESSAGES.BUTTON_PULL });
            btn.addEventListener("click", () => void this.pullAndSetChat(entry));
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
        void this.plugin.fetchActiveModel();
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
                this.serverConfigInputs.set("rerank_candidates", text.inputEl);
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

function appendStorageRow(parent: HTMLElement, label: string, bytes: number, detail?: string): void {
    const row = parent.createDiv({ cls: "lilbee-storage-row" });
    row.createSpan({ text: label, cls: "lilbee-storage-row-label" });
    row.createSpan({ text: formatBytes(bytes), cls: "lilbee-storage-row-bytes" });
    if (detail) row.createSpan({ text: detail, cls: "lilbee-storage-row-detail" });
}
