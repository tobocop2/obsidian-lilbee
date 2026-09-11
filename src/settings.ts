import {
    App,
    ButtonComponent,
    DropdownComponent,
    Notice,
    PluginSettingTab,
    requireApiVersion,
    setIcon,
    Setting,
} from "obsidian";
import type { SettingDefinition, SettingDefinitionGroup, SettingDefinitionItem, SettingGroup } from "obsidian";
import type LilbeePlugin from "./main";
import { LilbeeClient } from "./api";
import { isDownloadCanceled, listReleases, isDevBuild } from "./server-binary";
import type { ReleaseInfo } from "./server-binary";

/** Community IRC channel for dev-build feedback. */
const LIBERA_LILBEE_URL = "https://web.libera.chat/#lilbee";
import {
    AGENT_CLIENT,
    AGENT_MIN_CONTEXT_TOKENS,
    AGENT_SELECTION,
    CAPABILITY,
    CHAT_MODE,
    CONFIG_KEY,
    CRAWL_RENDER_MODE,
    DEFAULT_SETTINGS,
    ERROR_NAME,
    HOSTED_SOURCES,
    KV_CACHE_TYPE,
    LILBEE_REPO_URL,
    MEMORY_CONFIG_KEY,
    MODEL_TASK,
    SEARCH_CHUNK_TYPE,
    SERVER_MODE,
    SERVER_STATE,
    SSE_EVENT,
    TABLE_MODEL,
    TASK_TYPE,
    VERSION_ACTION,
} from "./types";
import type {
    AgentClient,
    AgentClientDetection,
    AgentSelection,
    CatalogEntry,
    ConfigResponse,
    InstalledModel,
    LilbeeSettings,
    SearchChunkType,
    ServerMode,
} from "./types";
import { exportDiagnostics } from "./diagnostics-export";
import { reportForVault } from "./storage-stats";
import { AGENT_LABELS, AGENT_LINKS, MESSAGES } from "./locales/en";
import { CLAUDIAN_OUTCOME, CLAUDIAN_PLUGIN_ID, isClaudianInstalled } from "./agent-integration";
import { PILL_CLS } from "./components/pill";
import { displayLabelForRef, extractHfRepo, matchModelOption } from "./utils/model-ref";
import { versionActionFor, versionButtonLabel, versionDescription } from "./utils/server-version";
import { CatalogModal } from "./views/catalog-modal";
import { hostedOptions, KEY_STATUS_PILL_CLASS } from "./views/catalog-helpers";
import { ModelPickerModal } from "./views/model-picker-modal";
import { ConfirmModal } from "./views/confirm-modal";
import { ConfirmPullModal } from "./views/confirm-pull-modal";
import { SetupWizard } from "./views/setup-wizard";
import { UninstallModal } from "./views/uninstall-modal";
import {
    debounce,
    DEBOUNCE_MS,
    percentFromSse,
    errorMessage,
    extractSseErrorMessage,
    formatDiskSize,
    noticeForResultError,
    getRelevantSystemMemoryGB,
    noticeServerUnreachableIfApplicable,
    openPluginSettingsById,
    renderExternalLink,
    SERVER_PROBE_TIMEOUT_MS,
    setDeterminateProgress,
} from "./utils";

/** GitHub's unauthenticated releases API allows 60 requests/hour per IP, so renders share one fetch. */
const RELEASES_CACHE_TTL_MS = 10 * 60 * 1000;
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

/** Paint the phase line, and grow the bar once a real percentage arrives. */
function showPhase(progress: UpdateProgressEls, message: string, percent?: number): void {
    progress.phase.setText(message);
    if (percent !== undefined) setDeterminateProgress(progress.fill, percent);
}

/** Elements of the managed-server update progress panel. */
interface UpdateProgressEls {
    panel: HTMLElement;
    phase: HTMLElement;
    size: HTMLElement;
    fill: HTMLElement;
    cancel: HTMLElement;
}

/** Marks the setting a navigation landed on; the theme colours the flash. */
const SETTING_FOCUS_CLASS = "lilbee-setting-focus";

/** A server-config row: the key the server reports it under, and how it is labelled. */
interface ConfigRowSpec {
    key: string;
    name: string;
    desc: string;
}

/** Slider bounds for a server-config number. */
interface SliderLimits {
    min: number;
    max: number;
    step: number;
}

/** Parsing rules for a server-config number typed into a text field. */
interface NumberFieldOpts {
    integer: boolean;
    min?: number;
    reindex?: boolean;
}

/** One settings row, read by both paths: display() builds it, getSettingDefinitions() declares it. */
interface RowSpec {
    name: string;
    desc: string;
    /** Set when the connected server has to report the key before the row means anything. */
    key?: string;
    /** Set only by gated(), which is never nested. */
    visible?: () => boolean;
    /** False for rows that carry a section's own DOM rather than a setting a user searches for. */
    searchable?: boolean;
    /** Extra search terms: the names of the hidden rows this row reveals. */
    aliases?: string[];
    /** `container` is where a row that needs more than one element puts the rest. */
    apply: (setting: Setting, container: HTMLElement) => void;
}

const CHAT_TOGGLES: ConfigRowSpec[] = [
    { key: CONFIG_KEY.SHOW_REASONING, name: MESSAGES.LABEL_SHOW_REASONING, desc: MESSAGES.DESC_SHOW_REASONING },
    { key: CONFIG_KEY.CHAT_COMPACTION, name: MESSAGES.LABEL_CHAT_COMPACTION, desc: MESSAGES.DESC_CHAT_COMPACTION },
];

const MAX_DISTANCE: ConfigRowSpec = {
    key: "max_distance",
    name: MESSAGES.LABEL_MAX_DISTANCE,
    desc: MESSAGES.DESC_MAX_DISTANCE,
};
const MAX_DISTANCE_LIMITS: SliderLimits = { min: 0.05, max: 1.0, step: 0.05 };
const ADAPTIVE_THRESHOLD: ConfigRowSpec = {
    key: "adaptive_threshold",
    name: MESSAGES.LABEL_ADAPTIVE_THRESHOLD,
    desc: MESSAGES.DESC_ADAPTIVE_THRESHOLD,
};
const TOP_K_LIMITS: SliderLimits = { min: 1, max: 20, step: 1 };
const WIKI_FAITHFULNESS_LIMITS: SliderLimits = { min: 0, max: 1, step: 0.05 };

/** A crawl number typed into a text box. */
interface CrawlNumericField extends ConfigRowSpec {
    placeholder: string;
    kind: "int" | "float";
    nullable: boolean;
    min?: number;
}

interface CrawlBoolField extends ConfigRowSpec {
    kind: "bool";
}

type CrawlField = CrawlNumericField | CrawlBoolField;

const CRAWL_FIELDS: CrawlField[] = [
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

/** A retrieval-advanced number typed into a text box. */
interface RetrievalNumberField extends ConfigRowSpec {
    kind: "number";
    integer: boolean;
    min: number;
}

interface RetrievalToggleField extends ConfigRowSpec {
    kind: "toggle";
}

/** The full-text search language, which takes free text rather than a number or a toggle. */
interface RetrievalLanguageField extends ConfigRowSpec {
    kind: "language";
}

type RetrievalField = RetrievalNumberField | RetrievalToggleField | RetrievalLanguageField;

const RETRIEVAL_ADVANCED_FIELDS: RetrievalField[] = [
    {
        kind: "number",
        key: "candidate_multiplier",
        name: MESSAGES.LABEL_CANDIDATE_MULTIPLIER,
        desc: MESSAGES.DESC_CANDIDATE_MULTIPLIER,
        integer: true,
        min: 1,
    },
    {
        kind: "number",
        key: "min_relevance_score",
        name: MESSAGES.LABEL_MIN_RELEVANCE_SCORE,
        desc: MESSAGES.DESC_MIN_RELEVANCE_SCORE,
        integer: false,
        min: 0,
    },
    {
        kind: "number",
        key: "max_context_sources",
        name: MESSAGES.LABEL_MAX_CONTEXT_SOURCES,
        desc: MESSAGES.DESC_MAX_CONTEXT_SOURCES,
        integer: true,
        min: 1,
    },
    {
        kind: "number",
        key: "diversity_max_per_source",
        name: MESSAGES.LABEL_DIVERSITY_MAX_PER_SOURCE,
        desc: MESSAGES.DESC_DIVERSITY_MAX_PER_SOURCE,
        integer: true,
        min: 1,
    },
    { kind: "toggle", key: "title_search", name: MESSAGES.LABEL_TITLE_SEARCH, desc: MESSAGES.DESC_TITLE_SEARCH },
    {
        kind: "number",
        key: "title_search_weight",
        name: MESSAGES.LABEL_TITLE_SEARCH_WEIGHT,
        desc: MESSAGES.DESC_TITLE_SEARCH_WEIGHT,
        integer: false,
        min: 0,
    },
    {
        kind: "toggle",
        key: "adaptive_fusion",
        name: MESSAGES.LABEL_ADAPTIVE_FUSION,
        desc: MESSAGES.DESC_ADAPTIVE_FUSION,
    },
    {
        kind: "number",
        key: "adaptive_fusion_margin",
        name: MESSAGES.LABEL_ADAPTIVE_FUSION_MARGIN,
        desc: MESSAGES.DESC_ADAPTIVE_FUSION_MARGIN,
        integer: false,
        min: 0,
    },
    {
        kind: "number",
        key: "lexical_fusion_weight",
        name: MESSAGES.LABEL_LEXICAL_FUSION_WEIGHT,
        desc: MESSAGES.DESC_LEXICAL_FUSION_WEIGHT,
        integer: false,
        min: 0,
    },
    {
        kind: "number",
        key: "neighbor_expansion",
        name: MESSAGES.LABEL_NEIGHBOR_EXPANSION,
        desc: MESSAGES.DESC_NEIGHBOR_EXPANSION,
        integer: true,
        min: 0,
    },
    {
        kind: "toggle",
        key: "filter_structural_chunks",
        name: MESSAGES.LABEL_FILTER_STRUCTURAL_CHUNKS,
        desc: MESSAGES.DESC_FILTER_STRUCTURAL_CHUNKS,
    },
    {
        kind: "number",
        key: "rerank_min_score",
        name: MESSAGES.LABEL_RERANK_MIN_SCORE,
        desc: MESSAGES.DESC_RERANK_MIN_SCORE,
        integer: false,
        min: 0,
    },
    { kind: "language", key: "fts_language", name: MESSAGES.LABEL_FTS_LANGUAGE, desc: MESSAGES.DESC_FTS_LANGUAGE },
    // Indexing-side quality: these only take effect on documents ingested after the change.
    {
        kind: "toggle",
        key: "contextual_enrichment",
        name: MESSAGES.LABEL_CONTEXTUAL_ENRICHMENT,
        desc: MESSAGES.DESC_CONTEXTUAL_ENRICHMENT,
    },
    { kind: "toggle", key: "embed_titles", name: MESSAGES.LABEL_EMBED_TITLES, desc: MESSAGES.DESC_EMBED_TITLES },
    { kind: "toggle", key: "token_sizing", name: MESSAGES.LABEL_TOKEN_SIZING, desc: MESSAGES.DESC_TOKEN_SIZING },
    {
        kind: "number",
        key: "mmr_lambda",
        name: MESSAGES.LABEL_MMR_LAMBDA,
        desc: MESSAGES.DESC_MMR_LAMBDA,
        integer: false,
        min: 0,
    },
];

const MEMORY_TOGGLES: ConfigRowSpec[] = [
    {
        key: MEMORY_CONFIG_KEY.ENABLED,
        name: MESSAGES.LABEL_MEMORY_ENABLED,
        desc: MESSAGES.DESC_MEMORY_ENABLED,
    },
    {
        key: MEMORY_CONFIG_KEY.AUTO_EXTRACT,
        name: MESSAGES.LABEL_MEMORY_AUTO_EXTRACT,
        desc: MESSAGES.DESC_MEMORY_AUTO_EXTRACT,
    },
];

/** A provider API key stored on the server. */
interface ApiKeyField extends ConfigRowSpec {
    provider: string;
}

const API_KEY_FIELDS: ApiKeyField[] = [
    {
        key: "openai_api_key",
        name: MESSAGES.LABEL_OPENAI_API_KEY,
        desc: MESSAGES.DESC_OPENAI_API_KEY,
        provider: "openai",
    },
    {
        key: "anthropic_api_key",
        name: MESSAGES.LABEL_ANTHROPIC_API_KEY,
        desc: MESSAGES.DESC_ANTHROPIC_API_KEY,
        provider: "anthropic",
    },
    {
        key: "gemini_api_key",
        name: MESSAGES.LABEL_GEMINI_API_KEY,
        desc: MESSAGES.DESC_GEMINI_API_KEY,
        provider: "gemini",
    },
];

/** A local model server the lilbee server can talk to. */
interface LocalServerField extends ConfigRowSpec {
    placeholder: string;
}

const LOCAL_SERVER_FIELDS: LocalServerField[] = [
    {
        key: "ollama_base_url",
        name: MESSAGES.LABEL_OLLAMA_BASE_URL,
        desc: MESSAGES.DESC_OLLAMA_BASE_URL,
        placeholder: "http://localhost:11434",
    },
    {
        key: "lm_studio_base_url",
        name: MESSAGES.LABEL_LM_STUDIO_BASE_URL,
        desc: MESSAGES.DESC_LM_STUDIO_BASE_URL,
        placeholder: "http://localhost:1234/v1",
    },
];

/** A generation knob typed into a text box. Hideable rows wait for the server to report the key. */
interface GenerationField extends ConfigRowSpec {
    integer: boolean;
    hideable?: boolean;
}

// num_ctx is not surfaced; the server picks the context window for the active model.
const GENERATION_FIELDS: GenerationField[] = [
    { key: "temperature", name: MESSAGES.LABEL_GEN_TEMPERATURE, desc: MESSAGES.DESC_GEN_TEMPERATURE, integer: false },
    { key: "top_p", name: MESSAGES.LABEL_GEN_TOP_P, desc: MESSAGES.DESC_GEN_TOP_P, integer: false },
    { key: "top_k_sampling", name: MESSAGES.LABEL_GEN_TOP_K, desc: MESSAGES.DESC_GEN_TOP_K, integer: true },
    {
        key: "repeat_penalty",
        name: MESSAGES.LABEL_GEN_REPEAT_PENALTY,
        desc: MESSAGES.DESC_GEN_REPEAT_PENALTY,
        integer: false,
    },
    { key: "seed", name: MESSAGES.LABEL_GEN_SEED, desc: MESSAGES.DESC_GEN_SEED, integer: true },
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

export class LilbeeSettingTab extends PluginSettingTab {
    private versionSettingEl: HTMLElement | null = null;
    /** Set by the update ribbon icon and the reminder: keep the version row in view across re-renders. */
    private focusServerUpdate = false;
    plugin: LilbeePlugin;
    /** Total bytes of the shared install, set by the storage report each render. */
    private storageTotalBytes = 0;
    // Textareas live here too: the prompt fields are multi-line but are filled
    // from a plain string like every other input, and both element types carry
    // the value and placeholder this map is read for.
    private serverConfigInputs: Map<string, HTMLInputElement | HTMLTextAreaElement> = new Map();
    private serverConfigToggles: Map<string, { setValue: (v: boolean) => unknown }> = new Map();
    private memoryToggles: Map<string, { setValue: (v: boolean) => unknown }> = new Map();
    private serverConfigTextAreas: Map<string, HTMLTextAreaElement> = new Map();
    private serverConfigDropdowns: Map<string, { setValue: (v: string) => unknown }> = new Map();
    private serverConfigSliders: Map<string, { setValue: (v: number) => unknown }> = new Map();
    // Rows hidden until loadServerDefaults sees a defined value for the matching cfg key.
    private serverConfigHideableEls: Map<string, HTMLElement> = new Map();
    private configDefaults: Record<string, unknown> = {};
    // Guards programmatic toggle.setValue() and slider.setValue() calls from echoing back to the server.
    private suppressChangeEvents = false;
    private chatModeSettingEl: HTMLElement | null = null;
    private chatModeDropdown: { setValue: (v: string) => unknown } | null = null;
    private chatModeSelectEl: HTMLSelectElement | null = null;
    private apiKeysContainerEl: HTMLElement | null = null;
    private crawlingContainerEl: HTMLElement | null = null;
    private crawlerBrowserSetupEl: HTMLElement | null = null;
    // Gates the install offer only. Assumed ready until the probe reports otherwise.
    private crawlerBrowserReady = true;
    private wikiContainerEl: HTMLElement | null = null;
    private wikiSubSettingsEl: HTMLElement | null = null;
    private modelsContainerEl: HTMLElement | null = null;
    /** Last successful release-list fetch; failures are not cached, so a retry always refetches. */
    private releasesCache: { at: number; releases: ReleaseInfo[] } | null = null;
    /** Detected agent CLIs; null until the first probe lands or after it fails. */
    private agentDetections: AgentClientDetection[] | null = null;
    private agentBodyEl: HTMLElement | null = null;
    /** Last server config; the definitions read it to decide which rows the connected server supports. */
    private serverConfig: ConfigResponse | null = null;
    /** Capabilities the connected server reports; null until the first probe lands. */
    private capabilities: Record<string, boolean> | null = null;

    constructor(app: App, plugin: LilbeePlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        this.render();
        this.revealServerUpdate();
    }

    /** True from 1.13.0 on; the store ruleset only recognises a literal version here. */
    private usesDefinitions(): boolean {
        return requireApiVersion("1.13.0");
    }

    /** Ask Obsidian to re-evaluate the definitions' visible predicates. */
    private refreshVisibility(): void {
        if (requireApiVersion("1.13.0")) this.refreshDomState();
    }

    /** Build each row into its own Setting, in order. The pre-1.13 path. */
    private renderRows(container: HTMLElement, rows: RowSpec[]): void {
        for (const row of rows) row.apply(new Setting(container), container);
    }

    /** A collapsible section with its summary and one-line explainer. The pre-1.13 path. */
    private openDetails(containerEl: HTMLElement, cls: string, summary: string, help?: string): HTMLElement {
        const details = containerEl.createEl("details", { cls: `${cls} lilbee-settings-section` });
        details.createEl("summary", { text: summary });
        if (help !== undefined) details.createEl("p", { text: help, cls: "setting-item-description" });
        return details;
    }

    /** Turn a section's rows into a searchable group. The 1.13 path. */
    private groupOf(
        heading: string | undefined,
        rows: RowSpec[],
        opts?: { help?: string; visible?: () => boolean },
    ): SettingDefinitionGroup {
        const items: SettingDefinition[] = rows.map((row) => this.definitionOf(row));
        if (opts?.help !== undefined) items.unshift({ name: "", desc: opts.help, searchable: false });
        const group: SettingDefinitionGroup = { type: "group", items };
        if (heading !== undefined) group.heading = heading;
        if (opts?.visible) group.visible = opts.visible;
        return group;
    }

    private definitionOf(row: RowSpec): SettingDefinition {
        const { key, visible } = row;
        const definition: SettingDefinition = {
            name: row.name,
            desc: row.desc,
            render: (setting: Setting, group: SettingGroup) => {
                if (requireApiVersion("1.13.0")) row.apply(setting, group.listEl);
            },
        };
        if (row.searchable === false) definition.searchable = false;
        if (row.aliases !== undefined) definition.aliases = row.aliases;
        if (key !== undefined || visible !== undefined) {
            definition.visible = (): boolean =>
                (key === undefined || this.serverReports(key)) && (visible === undefined || visible());
        }
        return definition;
    }

    /** Hide a whole run of rows behind one condition, e.g. the wiki rows behind the wiki toggle. */
    private gated(rows: RowSpec[], visible: () => boolean): RowSpec[] {
        return rows.map((row) => ({ ...row, visible }));
    }

    /** A row with no server-config key of its own: plugin settings, a button, or section DOM. */
    private localRow(name: string, desc: string, apply: (setting: Setting, container: HTMLElement) => void): RowSpec {
        return { name, desc, apply };
    }

    private toggleRow(spec: ConfigRowSpec): RowSpec {
        return { ...spec, apply: (setting) => this.applyConfigToggle(setting, spec) };
    }

    private bareToggleRow(spec: ConfigRowSpec): RowSpec {
        return { ...spec, apply: (setting) => this.applyBareConfigToggle(setting, spec) };
    }

    private sliderRow(spec: ConfigRowSpec, limits: SliderLimits): RowSpec {
        return { ...spec, apply: (setting) => this.applyConfigSlider(setting, spec, limits) };
    }

    private numberRow(spec: ConfigRowSpec, opts: NumberFieldOpts): RowSpec {
        return { ...spec, apply: (setting) => this.applyNumberFieldWithReset(setting, spec, opts) };
    }

    /** OCR languages and the like: always shown; the server answers with a default. */
    private listRow(spec: ConfigRowSpec): RowSpec {
        return this.localRow(spec.name, spec.desc, (setting) => this.applyConfigList(setting, spec));
    }

    /** Push one server-config value and say whether it took. */
    private async pushConfig(key: string, value: unknown, name: string): Promise<void> {
        try {
            await this.plugin.api.updateConfig({ [key]: value });
            new Notice(MESSAGES.NOTICE_FIELD_UPDATED(name));
        } catch {
            new Notice(MESSAGES.NOTICE_FAILED_UPDATE(name));
        }
    }

    /** A server-config boolean on a toggle, with no reset affordance. */
    private applyBareConfigToggle(setting: Setting, spec: ConfigRowSpec): void {
        setting
            .setName(spec.name)
            .setDesc(spec.desc)
            .addToggle((toggle) => {
                toggle.onChange(async (value) => {
                    if (this.suppressChangeEvents) return;
                    await this.pushConfig(spec.key, value, spec.name);
                });
                this.serverConfigToggles.set(spec.key, toggle);
            });
        this.hideUntilServerReports(setting.settingEl, spec.key);
    }

    /** Rebuild the tab after state a control's own callback changed. */
    refresh(): void {
        if (requireApiVersion("1.13.0")) {
            this.update();
            return;
        }
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
        this.renderBugFeedback(containerEl);

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
        this.renderAgentIntegration(containerEl);
        this.applyDiagnosticsRow(new Setting(containerEl));
        this.renderAdvancedSettings(containerEl);
        this.renderFleetSettings(containerEl);
        if (this.plugin.settings.serverMode === SERVER_MODE.MANAGED && this.hasManagedServer()) {
            this.renderUninstallSection(containerEl);
        }
        this.loadTabState();
    }

    /** The 1.13 render path: Obsidian renders and search-indexes from this instead of calling display(). */
    getSettingDefinitions(): SettingDefinitionItem[] {
        const items: SettingDefinitionItem[] = [
            this.definitionOf({
                name: "",
                desc: "",
                searchable: false,
                apply: (setting) => {
                    // The first row to render, so the tab loads its server state only when shown.
                    this.loadTabState();
                    this.renderBugFeedback(setting.descEl);
                },
            }),
            this.groupOf(undefined, this.rowsConnection()),
            ...this.defsModels(),
            this.groupOf(MESSAGES.LABEL_CHAT_SECTION, this.rowsChatSettings()),
            this.groupOf(MESSAGES.LABEL_SEARCH_RETRIEVAL, this.rowsSearchRetrieval()),
            this.groupOf(this.generationHeading(), this.rowsGeneration(), {
                help: MESSAGES.LABEL_GENERATION_HELP,
            }),
            this.groupOf(MESSAGES.LABEL_MEMORY_SECTION, this.rowsMemory()),
            this.groupOf(MESSAGES.LABEL_RETRIEVAL_ADVANCED, this.rowsRetrievalAdvanced(), {
                help: MESSAGES.LABEL_RETRIEVAL_ADVANCED_HELP,
            }),
            this.groupOf(MESSAGES.LABEL_INGEST, this.rowsIngest(), { help: MESSAGES.LABEL_INGEST_HELP }),
            this.groupOf(MESSAGES.LABEL_WORKER_POOL, this.rowsWorkerPool(), {
                help: MESSAGES.LABEL_WORKER_POOL_HELP,
            }),
            this.groupOf(MESSAGES.LABEL_CRAWLING, this.rowsCrawling(), {
                visible: () => this.serverSupports(CAPABILITY.CRAWLING),
            }),
            this.groupOf(MESSAGES.LABEL_WIKI_SECTION, this.rowsWiki(), {
                visible: () => this.serverSupports(CAPABILITY.WIKI),
            }),
            ...this.defsAgentIntegration(),
            this.definitionOf(
                this.localRow(MESSAGES.LABEL_EXPORT_DIAGNOSTICS, MESSAGES.DESC_EXPORT_DIAGNOSTICS, (setting) =>
                    this.applyDiagnosticsRow(setting),
                ),
            ),
            this.groupOf(MESSAGES.LABEL_ADVANCED, this.rowsAdvanced(), { help: MESSAGES.LABEL_ADVANCED_HELP }),
            this.groupOf(MESSAGES.LABEL_FLEET, this.rowsFleet(), { help: MESSAGES.LABEL_FLEET_HELP }),
        ];
        if (this.plugin.settings.serverMode === SERVER_MODE.MANAGED && this.hasManagedServer()) {
            items.push(...this.defsUninstall());
        }
        return items;
    }

    /** Server state every render depends on: current config, its defaults, and the capabilities. */
    private loadTabState(): void {
        this.loadServerDefaults();
        this.loadConfigDefaults();
        void this.applyCapabilityGating();
    }

    private generationHeading(): string {
        const modelLabel = displayLabelForRef(this.plugin.activeModel) || MESSAGES.LABEL_NO_MODEL_SELECTED;
        return `${MESSAGES.LABEL_GENERATION} (${modelLabel})`;
    }

    private async applyCapabilityGating(): Promise<void> {
        const [apiKeys, crawling, crawlingBrowser, wiki] = await Promise.all([
            this.plugin.api.getCapability(CAPABILITY.API_KEYS),
            this.plugin.api.getCapability(CAPABILITY.CRAWLING),
            this.plugin.api.getCapability(CAPABILITY.CRAWLING_BROWSER),
            this.plugin.api.getCapability(CAPABILITY.WIKI),
        ]);
        this.capabilities = {
            [CAPABILITY.API_KEYS]: apiKeys,
            [CAPABILITY.CRAWLING]: crawling,
            [CAPABILITY.CRAWLING_BROWSER]: crawlingBrowser,
            [CAPABILITY.WIKI]: wiki,
        };
        if (this.usesDefinitions()) {
            this.crawlerBrowserReady = crawlingBrowser;
            this.refreshVisibility();
            return;
        }
        if (!apiKeys && this.apiKeysContainerEl) this.apiKeysContainerEl.hide();
        if (!crawling && this.crawlingContainerEl) this.crawlingContainerEl.hide();
        if (!wiki && this.wikiContainerEl) this.wikiContainerEl.hide();
        // The offer belongs inside a visible Crawling section, never on its own.
        if (crawling && !crawlingBrowser && this.crawlerBrowserSetupEl) this.crawlerBrowserSetupEl.show();
    }

    private filterSettings(containerEl: HTMLElement, query: string): void {
        const term = query.trim().toLowerCase();
        const matches = (item: Element): boolean => {
            const name = item.querySelector(".setting-item-name")?.textContent?.toLowerCase() ?? "";
            const desc = item.querySelector(".setting-item-description")?.textContent?.toLowerCase() ?? "";
            return !term || name.includes(term) || desc.includes(term);
        };

        for (const item of Array.from(containerEl.querySelectorAll(".setting-item"))) {
            // Rows hidden by capability (server does not report the key) must stay
            // hidden even when the search box is cleared: clearing the box makes
            // matches() true for every row, which would otherwise reveal them.
            if (item.hasAttribute("data-lilbee-hidden-by-capability")) {
                (item as HTMLElement).style.display = "none";
                continue;
            }
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

    private rowsConnection(): RowSpec[] {
        const managed = this.plugin.settings.serverMode === SERVER_MODE.MANAGED;
        return [
            this.localRow(MESSAGES.LABEL_SERVER_MODE, MESSAGES.DESC_SERVER_MODE, (setting) =>
                this.applyServerModeRow(setting),
            ),
            this.localRow(MESSAGES.LABEL_SETUP_WIZARD, MESSAGES.DESC_SETUP_WIZARD, (setting) =>
                this.applySetupWizardRow(setting),
            ),
            ...(managed ? this.rowsManaged() : this.rowsExternal()),
        ];
    }

    private renderConnectionSettings(containerEl: HTMLElement): void {
        this.renderRows(containerEl, this.rowsConnection());
    }

    private applyServerModeRow(setting: Setting): void {
        setting
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
                        this.refresh();
                    }),
            );
        this.appendLocalResetAffordance(setting, "serverMode", MESSAGES.LABEL_SERVER_MODE);
    }

    private applySetupWizardRow(setting: Setting): void {
        setting
            .setName(MESSAGES.LABEL_SETUP_WIZARD)
            .setDesc(MESSAGES.DESC_SETUP_WIZARD)
            .addButton((btn) =>
                btn.setButtonText(MESSAGES.BUTTON_RUN_SETUP_WIZARD).onClick(() => {
                    new SetupWizard(this.app, this.plugin).open();
                }),
            );
    }

    /**
     * A binary on disk that the plugin is still allowed to run. An uninstalled
     * server never starts, even if a binary was put back by hand, until an
     * explicit install clears the flag.
     */
    private renderAgentIntegration(containerEl: HTMLElement): void {
        const section = containerEl.createDiv({ cls: "lilbee-settings-section lilbee-agent-section" });
        new Setting(section).setName(MESSAGES.LABEL_AGENT_SECTION).setHeading().setDesc(MESSAGES.DESC_AGENT_SECTION);
        this.mountAgentBody(section);
    }

    /**
     * The agent rows depend on a CLI probe and rebuild themselves, so the whole body stays
     * imperative behind one searchable definition.
     */
    private defsAgentIntegration(): SettingDefinitionItem[] {
        return [
            {
                type: "group",
                heading: MESSAGES.LABEL_AGENT_SECTION,
                cls: "lilbee-agent-section",
                items: [
                    this.definitionOf({
                        name: MESSAGES.LABEL_AGENT_CHOICE,
                        desc: MESSAGES.DESC_AGENT_SECTION,
                        apply: (_setting, container) => this.mountAgentBody(container),
                    }),
                ],
            },
        ];
    }

    private mountAgentBody(container: HTMLElement): void {
        this.agentBodyEl = container.createDiv({ cls: "lilbee-agent-body" });
        void this.loadAgentDetections();
    }

    /** Probe for agent CLIs, reusing the last result unless the user asked to rescan. */
    private async loadAgentDetections(force = false): Promise<void> {
        if (this.agentDetections === null || force) {
            const index = await this.plugin.api.getAgentConfigIndex();
            this.agentDetections = index.isOk() ? index.value.clients : null;
        }
        this.renderAgentBody();
    }

    private renderAgentBody(): void {
        const body = this.agentBodyEl;
        if (!body) return;
        body.empty();
        const detections = this.agentDetections;
        if (detections === null) {
            body.createEl("p", { cls: "setting-item-description", text: MESSAGES.AGENT_DETECT_UNAVAILABLE });
            this.addRescanButton(body);
            return;
        }
        const installed = detections.filter((d) => d.cli_detected).map((d) => d.client);
        this.renderAgentChoice(body, installed);
        this.renderSupportedAgents(body);
        const selected = this.plugin.settings.agentIntegration.agent;
        if (selected === AGENT_SELECTION.NONE) return;
        this.renderAgentKeepFresh(body);
        this.renderAgentModelRow(body);
        if (selected === AGENT_CLIENT.OPENCODE) this.renderClaudianRow(body);
        this.renderAgentStatus(body, selected);
    }

    private addRescanButton(parent: HTMLElement, setting?: Setting): void {
        const target = setting ?? new Setting(parent).setName(MESSAGES.LABEL_AGENT_SUPPORTED);
        target.addButton((btn) =>
            btn.setButtonText(MESSAGES.BUTTON_AGENT_RESCAN).onClick(() => {
                void this.loadAgentDetections(true);
            }),
        );
    }

    /** A plain links row: the projects a user installs to get a coding agent. */
    private renderSupportedAgents(body: HTMLElement): void {
        const setting = new Setting(body).setName(MESSAGES.LABEL_AGENT_SUPPORTED);
        const links = setting.descEl.createSpan({ cls: "lilbee-agent-links" });
        AGENT_LINKS.forEach((link, i) => {
            if (i > 0) links.appendText(" · ");
            renderExternalLink(links, link.label, link.url);
        });
        this.addRescanButton(body, setting);
    }

    /** The dropdown lists only installed agents, so what shows is what you can pick. */
    private renderAgentChoice(body: HTMLElement, installed: AgentClient[]): void {
        new Setting(body)
            .setName(MESSAGES.LABEL_AGENT_CHOICE)
            .setDesc(MESSAGES.DESC_AGENT_CHOICE)
            .addDropdown((dropdown) => {
                dropdown.addOption(AGENT_SELECTION.NONE, MESSAGES.AGENT_OPTION_NONE);
                for (const client of installed) {
                    dropdown.addOption(client, AGENT_LABELS[client]);
                }
                dropdown.setValue(this.plugin.settings.agentIntegration.agent);
                dropdown.onChange(async (value) => {
                    const agent = value as AgentSelection;
                    this.plugin.settings.agentIntegration.agent = agent;
                    this.plugin.settings.agentIntegration.pickerShown = true;
                    await this.plugin.persistAgentIntegration();
                    if (agent !== AGENT_SELECTION.NONE) await this.plugin.applyAgentWiring(agent);
                    this.renderAgentBody();
                });
            });
    }

    private renderAgentKeepFresh(body: HTMLElement): void {
        new Setting(body)
            .setName(MESSAGES.LABEL_AGENT_KEEP_FRESH)
            .setDesc(MESSAGES.DESC_AGENT_KEEP_FRESH)
            .addToggle((toggle) => {
                toggle.setValue(this.plugin.settings.agentIntegration.keepConfigFresh);
                toggle.onChange(async (value) => {
                    this.plugin.settings.agentIntegration.keepConfigFresh = value;
                    await this.plugin.persistAgentIntegration();
                });
            });
    }

    /** The agent runs on lilbee's chat model, so this row drives the same selection. */
    private renderAgentModelRow(body: HTMLElement): void {
        const setting = new Setting(body)
            .setName(MESSAGES.LABEL_AGENT_MODEL)
            .setDesc(displayLabelForRef(this.plugin.activeModel) || MESSAGES.LABEL_NOT_SET)
            .addButton((btn) =>
                btn.setButtonText(MESSAGES.BUTTON_AGENT_CHANGE_MODEL).onClick(() => {
                    new ModelPickerModal(this.app, this.plugin, MODEL_TASK.CHAT).open();
                }),
            );
        // The context pill sits in the control slot, left of the button; the
        // low-context warning, if any, gets its own note row below.
        void this.renderAgentContext(setting, body);
    }

    private async renderAgentContext(setting: Setting, body: HTMLElement): Promise<void> {
        const health = await this.plugin.api.health();
        const ctx = health.isOk() ? health.value.chat_ctx : null;
        if (typeof ctx !== "number") return;
        const pill = createSpan({
            cls: `lilbee-key-status-pill ${PILL_CLS.CONTEXT}`,
            text: MESSAGES.AGENT_CONTEXT_BADGE(ctx),
        });
        setting.controlEl.prepend(pill);
        if (ctx < AGENT_MIN_CONTEXT_TOKENS) {
            body.createDiv({
                cls: "lilbee-agent-note setting-item-description is-warning",
                text: MESSAGES.AGENT_CONTEXT_WARNING,
            });
        }
    }

    private renderClaudianRow(body: HTMLElement): void {
        const setting = new Setting(body).setName(MESSAGES.LABEL_AGENT_CLAUDIAN);
        if (!isClaudianInstalled(this.app)) {
            setting.setDesc(MESSAGES.DESC_AGENT_CLAUDIAN_MISSING);
            return;
        }
        const skipped = this.plugin.lastAgentWrite?.claudian === CLAUDIAN_OUTCOME.SKIPPED;
        setting.setDesc(skipped ? MESSAGES.DESC_AGENT_CLAUDIAN_SKIPPED : MESSAGES.DESC_AGENT_CLAUDIAN_CONFIGURED);
        if (!skipped) {
            setting.controlEl.createSpan({
                cls: `lilbee-key-status-pill ${KEY_STATUS_PILL_CLASS.READY}`,
                text: MESSAGES.PILL_AGENT_CLAUDIAN_CONFIGURED,
            });
        }
        setting.addButton((btn) =>
            btn.setButtonText(MESSAGES.BUTTON_OPEN_CLAUDIAN).onClick(() => {
                openPluginSettingsById(this.app, CLAUDIAN_PLUGIN_ID);
            }),
        );
    }

    private renderAgentStatus(body: HTMLElement, agent: AgentClient): void {
        const text =
            agent === AGENT_CLIENT.HERMES
                ? MESSAGES.AGENT_STATUS_GLOBAL
                : this.plugin.lastAgentWrite === null
                  ? MESSAGES.AGENT_STATUS_PENDING
                  : MESSAGES.AGENT_STATUS_CONNECTED;
        const status = body.createDiv({ cls: "lilbee-agent-status setting-item-description" });
        status.createSpan({ cls: "lilbee-agent-status-dot" });
        status.createSpan({ text });
        if (agent === AGENT_CLIENT.HERMES) this.renderHermesConfigBlock(body);
    }

    /** hermes keeps one global config, so lilbee offers the block rather than writing it. */
    private renderHermesConfigBlock(body: HTMLElement): void {
        const setting = new Setting(body).setName(MESSAGES.LABEL_AGENT_COPY_CONFIG);
        const block = body.createEl("pre", { cls: "lilbee-agent-config-block" });
        void this.plugin.api.getAgentConfig(AGENT_CLIENT.HERMES).then((result) => {
            const content = result.isOk() ? (result.value.content ?? "") : "";
            block.setText(content);
            setting.addButton((btn) =>
                btn.setButtonText(MESSAGES.BUTTON_AGENT_COPY).onClick(() => {
                    void navigator.clipboard.writeText(content);
                    new Notice(MESSAGES.NOTICE_AGENT_COPIED);
                }),
            );
        });
    }

    private hasManagedServer(): boolean {
        return this.plugin.isServerInstalled() && !this.plugin.isServerUninstalled();
    }

    private rowsManaged(): RowSpec[] {
        const sharedRoot = this.localRow(
            MESSAGES.LABEL_SHARED_ROOT,
            MESSAGES.DESC_SHARED_ROOT(this.plugin.vaultRegistry?.sharedRoot ?? ""),
            (setting) => this.applySharedRootRow(setting),
        );
        if (!this.hasManagedServer()) return [...this.rowsInstallServer(), sharedRoot];
        // Adopting a data dir and sizing the install both need the registry that resolves it.
        const registryRows: RowSpec[] =
            this.plugin.vaultRegistry === null
                ? []
                : [
                      this.localRow(MESSAGES.LABEL_ADOPT_DATA_DIR, MESSAGES.DESC_ADOPT_DATA_DIR, (setting) =>
                          this.applyAdoptDataDirRow(setting),
                      ),
                      this.localRow(MESSAGES.LABEL_STORAGE_REPORT, MESSAGES.DESC_STORAGE_REPORT, (setting, container) =>
                          this.applyStorageReportRow(setting, container),
                      ),
                  ];
        return [
            this.localRow(MESSAGES.LABEL_SERVER_STATUS, MESSAGES.DESC_SERVER_STATUS_CURRENT, (setting) =>
                this.applyServerStatusRow(setting),
            ),
            this.localRow(MESSAGES.LABEL_SERVER_CONTROLS, MESSAGES.DESC_SERVER_CONTROLS_START_STOP, (setting) =>
                this.applyServerControlsRow(setting),
            ),
            sharedRoot,
            ...registryRows,
            this.localRow(MESSAGES.LABEL_SERVER_VERSION, MESSAGES.DESC_SERVER_VERSION_LOADING, (setting, container) =>
                this.applyVersionRow(setting, container),
            ),
            this.localRow(MESSAGES.LABEL_SERVER_AUTO_UPDATE, MESSAGES.DESC_SERVER_AUTO_UPDATE, (setting) =>
                this.applyAutoUpdateRow(setting),
            ),
            this.localRow(MESSAGES.LABEL_SERVER_UPDATE_REMINDER, MESSAGES.DESC_SERVER_UPDATE_REMINDER, (setting) =>
                this.applyUpdateReminderRow(setting),
            ),
            this.localRow(MESSAGES.LABEL_INCLUDE_DEV_BUILDS, MESSAGES.DESC_INCLUDE_DEV_BUILDS, (setting) =>
                this.applyDevBuildsRow(setting),
            ),
        ];
    }

    private applyServerStatusRow(setting: Setting): void {
        setting.setName(MESSAGES.LABEL_SERVER_STATUS).setDesc(MESSAGES.DESC_SERVER_STATUS_CURRENT);
        const statusEl = setting.settingEl.createDiv({ cls: "lilbee-server-status" });
        const dot = statusEl.createDiv({ cls: "lilbee-server-dot" });
        const stateText = statusEl.createSpan();
        const serverState = this.plugin.serverManager?.state ?? SERVER_STATE.STOPPED;
        stateText.setText(serverState);
        dot.classList.add(`is-${serverState}`);
    }

    private applyServerControlsRow(setting: Setting): void {
        setting.setName(MESSAGES.LABEL_SERVER_CONTROLS).setDesc(MESSAGES.DESC_SERVER_CONTROLS_START_STOP);
        const serverState = this.plugin.serverManager?.state ?? SERVER_STATE.STOPPED;
        if (serverState === SERVER_STATE.STOPPED || serverState === SERVER_STATE.ERROR) {
            setting.addButton((btn) =>
                btn.setButtonText(MESSAGES.BUTTON_START).onClick(async () => {
                    this.plugin.journal.lifecycle("start requested from the settings tab");
                    await this.plugin.startManagedServer();
                    this.refresh();
                }),
            );
        }
        if (serverState === SERVER_STATE.READY || serverState === SERVER_STATE.STARTING) {
            setting.addButton((btn) =>
                btn.setButtonText(MESSAGES.BUTTON_STOP).onClick(async () => {
                    this.plugin.journal.lifecycle("stop requested from the settings tab");
                    await this.plugin.serverManager?.stop();
                    this.refresh();
                }),
            );
        }
        if (serverState === SERVER_STATE.READY) {
            setting.addButton((btn) =>
                btn.setButtonText(MESSAGES.BUTTON_RESTART).onClick(async () => {
                    this.plugin.journal.lifecycle("restart requested from the settings tab");
                    try {
                        await this.plugin.serverManager?.restart();
                    } catch (err) {
                        new Notice(errorMessage(err, MESSAGES.ERROR_START_SERVER));
                    }
                    this.refresh();
                }),
            );
        }
    }

    private applyAutoUpdateRow(setting: Setting): void {
        setting
            .setName(MESSAGES.LABEL_SERVER_AUTO_UPDATE)
            .setDesc(MESSAGES.DESC_SERVER_AUTO_UPDATE)
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.isServerAutoUpdateEnabled()).onChange((value) => {
                    this.plugin.setServerAutoUpdate(value);
                }),
            );
    }

    private applyUpdateReminderRow(setting: Setting): void {
        setting
            .setName(MESSAGES.LABEL_SERVER_UPDATE_REMINDER)
            .setDesc(MESSAGES.DESC_SERVER_UPDATE_REMINDER)
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.isServerUpdateReminderEnabled()).onChange((value) => {
                    this.plugin.setServerUpdateReminder(value);
                }),
            );
    }

    /** Bring the server version row into view and mark it; the update ribbon icon and reminder land here. */
    scrollToServerUpdate(): void {
        this.focusServerUpdate = true;
        this.revealServerUpdate();
    }

    /** Runs after a render and after the release list lands, so the row is measured before it scrolls. */
    private revealServerUpdate(): void {
        const row = this.versionSettingEl;
        if (!this.focusServerUpdate || !row) return;
        window.setTimeout(() => {
            row.scrollIntoView({ block: "center" });
            row.addClass(SETTING_FOCUS_CLASS);
        }, 0);
    }

    hide(): void {
        this.focusServerUpdate = false;
        this.versionSettingEl?.removeClass(SETTING_FOCUS_CLASS);
    }

    /**
     * One control for upgrade, downgrade, and reinstall. The dropdown lists
     * recent releases newest-first; the button names what the selection does.
     */
    private applyVersionRow(setting: Setting, container: HTMLElement): void {
        const installed = this.plugin.getSharedLilbeeVersion();
        setting.setName(MESSAGES.LABEL_SERVER_VERSION).setDesc(MESSAGES.DESC_SERVER_VERSION_LOADING);
        // aria-label only: Obsidian renders its styled tooltip from it, and a
        // title attribute would stack the native browser tooltip on top.
        setting.settingEl.setAttribute("aria-label", MESSAGES.TOOLTIP_SERVER_VERSION_SUPPORT);
        this.versionSettingEl = setting.settingEl;
        const progress = this.renderUpdateProgress(container);

        let releases: ReleaseInfo[] = [];
        let selectedTag = installed;
        // A dev build newer than the newest stable, shown as a nudge when dev builds are off.
        let newerDevTag: string | null = null;
        // addDropdown / addButton run their callback synchronously, so both are set below.
        let dropdown!: DropdownComponent;
        let actionBtn!: ButtonComponent;

        const refresh = (): void => {
            const tags = releases.map((r) => r.tag);
            const action = versionActionFor(tags, installed, selectedTag);
            let desc = versionDescription(action, installed, selectedTag, tags[0] === installed);
            // Which build is installed answers why the download was the size it was.
            const installedBuild = this.plugin.getSharedLilbeeVariant();
            if (installed && installedBuild) {
                desc += MESSAGES.DESC_SERVER_BUILD(MESSAGES.LABEL_SERVER_BUILD(installedBuild));
                const detection = this.plugin.getSharedGpuDetection();
                if (detection) desc += ` ${MESSAGES.DESC_GPU_DETECTION(detection)}`;
            }
            if (newerDevTag) desc += ` ${MESSAGES.DESC_DEV_BUILD_AVAILABLE(newerDevTag)}`;
            setting.setDesc(desc);
            actionBtn.setButtonText(versionButtonLabel(action, selectedTag));
            actionBtn.buttonEl.toggleClass("mod-cta", action === VERSION_ACTION.UPDATE);
            actionBtn.buttonEl.toggleClass("mod-warning", action === VERSION_ACTION.DOWNGRADE);
        };

        setting.addDropdown((dd) => {
            dropdown = dd;
            dd.setDisabled(true);
            dd.onChange((value) => {
                selectedTag = value;
                refresh();
            });
        });

        setting.addButton((btn) => {
            actionBtn = btn;
            btn.setDisabled(true);
            btn.setButtonText(MESSAGES.BUTTON_REINSTALL).onClick(async () => {
                const release = releases.find((r) => r.tag === selectedTag);
                if (!release) return;
                const label = versionButtonLabel(
                    versionActionFor(
                        releases.map((r) => r.tag),
                        installed,
                        selectedTag,
                    ),
                    selectedTag,
                );
                const updated = await this.runServerUpdate(release, btn, progress, label);
                // An explicit non-latest install turns off automatic updates
                // so the chosen version is honored across plugin updates.
                if (updated && selectedTag !== releases[0].tag) {
                    this.plugin.setServerAutoUpdate(false);
                    this.refresh();
                }
            });
        });

        void this.loadReleases().then((loaded) => {
            this.revealServerUpdate();
            if (loaded.releases === null) {
                setting.setDesc(
                    installed
                        ? MESSAGES.DESC_SERVER_VERSION_OFFLINE(installed, loaded.error)
                        : MESSAGES.DESC_SERVER_VERSION_UNKNOWN,
                );
                setting.addButton((btn) => btn.setButtonText(MESSAGES.BUTTON_RETRY).onClick(() => this.refresh()));
                return;
            }
            const all = loaded.releases;
            const includeDev = this.plugin.settings.includeDevBuilds;
            // all holds every installable release (dev builds included); when dev builds are
            // off, hide them and nudge toward the newest one if it leads the stable line and the
            // user isn't already running it.
            const newest = all[0];
            newerDevTag =
                !includeDev && newest && isDevBuild(newest.tag) && newest.tag !== installed ? newest.tag : null;
            releases = includeDev ? all : all.filter((r) => !isDevBuild(r.tag));
            if (releases.length === 0) return;
            if (!releases.some((r) => r.tag === selectedTag)) selectedTag = releases[0].tag;
            for (const release of releases) dropdown.addOption(release.tag, release.tag);
            dropdown.setValue(selectedTag);
            dropdown.setDisabled(false);
            actionBtn.setDisabled(false);
            refresh();
        });
    }

    /** Recent installable releases, dev builds included, or why GitHub could not be read. */
    private async loadReleases(): Promise<{ releases: ReleaseInfo[] } | { releases: null; error: string }> {
        if (this.releasesCache && Date.now() - this.releasesCache.at < RELEASES_CACHE_TTL_MS) {
            return { releases: this.releasesCache.releases };
        }
        try {
            const releases = await listReleases(true);
            this.releasesCache = { at: Date.now(), releases };
            return { releases };
        } catch (err) {
            return { releases: null, error: errorMessage(err, String(err)) };
        }
    }

    /** Opt in to in-development builds. */
    private applyDevBuildsRow(setting: Setting): void {
        setting
            .setName(MESSAGES.LABEL_INCLUDE_DEV_BUILDS)
            .setDesc(MESSAGES.DESC_INCLUDE_DEV_BUILDS)
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.includeDevBuilds).onChange(async (value) => {
                    this.plugin.settings.includeDevBuilds = value;
                    await this.plugin.saveSettings();
                    this.refresh();
                }),
            );
    }

    /** Where bug reports go. Rendered at the top of the settings view in both server modes. */
    private renderBugFeedback(containerEl: HTMLElement): void {
        const feedback = containerEl.createDiv({ cls: "lilbee-bug-feedback" });
        feedback.createSpan({ text: MESSAGES.BUG_FEEDBACK_PREFIX });
        const gh = feedback.createEl("a", { text: MESSAGES.BUG_FEEDBACK_GITHUB });
        gh.setAttribute("href", `${LILBEE_REPO_URL}/issues`);
        gh.setAttribute("target", "_blank");
        feedback.createSpan({ text: " or " });
        const irc = feedback.createEl("a", { text: MESSAGES.BUG_FEEDBACK_IRC });
        irc.setAttribute("href", LIBERA_LILBEE_URL);
        irc.setAttribute("target", "_blank");
        feedback.createSpan({ text: MESSAGES.BUG_FEEDBACK_SUFFIX });
    }

    /**
     * Managed mode only: Obsidian never removes the server this plugin downloaded.
     * The delete plan is built when the button is clicked.
     */
    private renderUninstallSection(containerEl: HTMLElement): void {
        const heading = new Setting(containerEl).setName(MESSAGES.LABEL_UNINSTALL).setHeading();
        heading.settingEl.addClass("lilbee-danger-heading");
        heading.settingEl.setAttribute("aria-label", MESSAGES.TOOLTIP_UNINSTALL_SECTION);
        this.renderUninstallCallout(containerEl);
        this.applyUninstallServerRow(new Setting(containerEl));
    }

    private defsUninstall(): SettingDefinitionItem[] {
        return [
            {
                type: "group",
                heading: MESSAGES.LABEL_UNINSTALL,
                cls: "lilbee-danger-heading",
                items: [
                    this.definitionOf({
                        name: "",
                        desc: MESSAGES.CALLOUT_UNINSTALL_FIRST,
                        searchable: false,
                        apply: (_setting, container) => this.renderUninstallCallout(container),
                    }),
                    this.definitionOf(
                        this.localRow(
                            MESSAGES.LABEL_UNINSTALL_SERVER,
                            MESSAGES.DESC_UNINSTALL_SERVER(formatDiskSize(this.storageTotalBytes)),
                            (setting) => this.applyUninstallServerRow(setting),
                        ),
                    ),
                ],
            },
        ];
    }

    private renderUninstallCallout(container: HTMLElement): void {
        const callout = container.createDiv({ cls: "lilbee-uninstall-callout" });
        const mark = callout.createSpan({ cls: "lilbee-uninstall-callout-mark", text: "!" });
        mark.setAttribute("aria-hidden", "true");
        callout.createEl("p", { text: MESSAGES.CALLOUT_UNINSTALL_FIRST });
    }

    /** Reads the total at render time, which the storage report row sets when it renders above this one. */
    private applyUninstallServerRow(setting: Setting): void {
        setting
            .setName(MESSAGES.LABEL_UNINSTALL_SERVER)
            .setDesc(MESSAGES.DESC_UNINSTALL_SERVER(formatDiskSize(this.storageTotalBytes)))
            .addButton((btn) => {
                btn.setButtonText(MESSAGES.BUTTON_UNINSTALL_SERVER).onClick(() => void this.confirmUninstall());
                btn.buttonEl.addClass("mod-warning");
            });
    }

    private async confirmUninstall(): Promise<void> {
        const plan = this.plugin.planServerUninstall();
        if (!plan) return;
        const modal = new UninstallModal(this.app, plan);
        modal.open();
        if (!(await modal.result)) return;
        try {
            const freed = await this.plugin.uninstallServer(plan);
            new Notice(MESSAGES.NOTICE_UNINSTALLED(formatDiskSize(freed)));
        } catch (err) {
            new Notice(errorMessage(err, MESSAGES.ERROR_UNINSTALL_FAILED));
            console.error("[lilbee] uninstall failed:", err);
        }
        this.refresh();
    }

    /** Recovery path after an uninstall: pick a release and pull the server back. */
    private rowsInstallServer(): RowSpec[] {
        if (this.plugin.isDownloadingServer()) {
            return [
                this.localRow(MESSAGES.LABEL_SERVER_STATUS, MESSAGES.DESC_SERVER_DOWNLOADING, (setting) =>
                    this.applyCancelDownloadRow(setting),
                ),
            ];
        }
        return [
            this.localRow(MESSAGES.LABEL_SERVER_STATUS, MESSAGES.DESC_SERVER_NOT_INSTALLED, (setting) => {
                setting.setName(MESSAGES.LABEL_SERVER_STATUS).setDesc(MESSAGES.DESC_SERVER_NOT_INSTALLED);
            }),
            this.localRow(MESSAGES.LABEL_INSTALL_SERVER, MESSAGES.DESC_SERVER_VERSION_LOADING, (setting, container) =>
                this.applyInstallServerRow(setting, container),
            ),
        ];
    }

    /** A download kicked off outside Settings is still in flight: offer to stop it. */
    private applyCancelDownloadRow(setting: Setting): void {
        setting
            .setName(MESSAGES.LABEL_SERVER_STATUS)
            .setDesc(MESSAGES.DESC_SERVER_DOWNLOADING)
            .addButton((btn) => {
                btn.setButtonText(MESSAGES.BUTTON_CANCEL_DOWNLOAD).onClick(() => {
                    this.plugin.cancelServerDownload();
                    this.refresh();
                });
                btn.buttonEl.addClass("mod-warning");
            });
    }

    private applyInstallServerRow(setting: Setting, container: HTMLElement): void {
        setting.setName(MESSAGES.LABEL_INSTALL_SERVER).setDesc(MESSAGES.DESC_SERVER_VERSION_LOADING);
        // aria-label only: Obsidian renders its styled tooltip from it, and a
        // title attribute would stack the native browser tooltip on top.
        setting.settingEl.setAttribute("aria-label", MESSAGES.TOOLTIP_SERVER_VERSION_SUPPORT);
        const progress = this.renderUpdateProgress(container);

        let releases: ReleaseInfo[] = [];
        let selectedTag = "";
        // addDropdown / addButton run their callback synchronously, so both are set below.
        let dropdown!: DropdownComponent;
        let installBtn!: ButtonComponent;

        const describe = (): void => {
            const release = releases.find((r) => r.tag === selectedTag);
            /* v8 ignore next -- the dropdown only ever offers tags from `releases` */
            if (!release) return;
            setting.setDesc(MESSAGES.DESC_INSTALL_SERVER(formatDiskSize(release.size)));
        };

        setting.addDropdown((dd) => {
            dropdown = dd;
            dd.setDisabled(true);
            dd.onChange((value) => {
                selectedTag = value;
                describe();
            });
        });

        setting.addButton((btn) => {
            installBtn = btn;
            btn.setDisabled(true);
            btn.buttonEl.addClass("mod-cta");
            btn.setButtonText(MESSAGES.BUTTON_INSTALL_SERVER).onClick(async () => {
                const release = releases.find((r) => r.tag === selectedTag);
                if (!release) return;
                await this.runServerInstall(release, btn, progress);
            });
        });

        void this.loadReleases().then((loaded) => {
            if (loaded.releases === null) {
                setting.setDesc(MESSAGES.ERROR_RELEASE_LIST(loaded.error));
                setting.addButton((btn) => btn.setButtonText(MESSAGES.BUTTON_RETRY).onClick(() => this.refresh()));
                return;
            }
            releases = loaded.releases;
            if (releases.length === 0) return;
            selectedTag = releases[0].tag;
            for (const release of releases) dropdown.addOption(release.tag, release.tag);
            dropdown.setValue(selectedTag);
            dropdown.setDisabled(false);
            installBtn.setDisabled(false);
            describe();
        });
    }

    private async runServerInstall(
        release: ReleaseInfo,
        btn: ButtonComponent,
        progress: UpdateProgressEls,
    ): Promise<void> {
        btn.setDisabled(true);
        btn.setButtonText(MESSAGES.BUTTON_DOWNLOADING);
        progress.panel.show();
        progress.size.setText(MESSAGES.STATUS_UPDATE_SIZE(release.tag, formatDiskSize(release.size)));
        try {
            await this.plugin.installServer(release, (msg, percent) => showPhase(progress, msg, percent));
            new Notice(MESSAGES.NOTICE_INSTALLED(release.tag));
            this.refresh();
        } catch (err) {
            // Unloading aborted it, and this tab is gone with the plugin.
            if (this.plugin.isUnloaded()) return;
            if (isDownloadCanceled(err)) {
                new Notice(MESSAGES.NOTICE_DOWNLOAD_CANCELED);
            } else {
                new Notice(errorMessage(err, MESSAGES.ERROR_INSTALL_FAILED));
                console.error("[lilbee] install failed:", err);
            }
            progress.panel.hide();
            btn.setButtonText(MESSAGES.BUTTON_INSTALL_SERVER);
            btn.setDisabled(false);
        }
    }

    /** Indeterminate progress panel for the managed-server update; hidden until an update runs. */
    private renderUpdateProgress(containerEl: HTMLElement): UpdateProgressEls {
        const panel = containerEl.createDiv({ cls: "lilbee-update-progress" });
        panel.hide();
        const bar = panel.createDiv({ cls: "lilbee-progress-bar-container" });
        const fill = bar.createDiv({
            cls: "lilbee-progress-bar lilbee-wizard-progress-fill lilbee-progress-indeterminate",
        });
        const phase = panel.createDiv({ cls: "lilbee-update-progress-phase" });
        const size = panel.createDiv({ cls: "lilbee-update-progress-size" });
        const cancel = panel.createEl("button", {
            cls: "lilbee-update-progress-cancel",
            text: MESSAGES.BUTTON_CANCEL_DOWNLOAD,
        });
        cancel.addEventListener("click", () => this.plugin.cancelServerDownload());
        return { panel, phase, size, fill, cancel };
    }

    /** Download and install *release*, surfacing phase + total download size. Returns false on failure. */
    private async runServerUpdate(
        release: ReleaseInfo,
        actionBtn: ButtonComponent,
        progress: UpdateProgressEls,
        restoreLabel: string,
    ): Promise<boolean> {
        actionBtn.setDisabled(true);
        actionBtn.setButtonText(MESSAGES.BUTTON_DOWNLOADING);
        progress.panel.show();
        progress.size.setText(MESSAGES.STATUS_UPDATE_SIZE(release.tag, formatDiskSize(release.size)));
        try {
            await this.plugin.updateServer(release, (msg, percent) => showPhase(progress, msg, percent));
            new Notice(MESSAGES.NOTICE_UPDATED_TO(release.tag));
            this.refresh();
            return true;
        } catch (err) {
            // Unloading aborted it, and this tab is gone with the plugin.
            if (this.plugin.isUnloaded()) return false;
            if (isDownloadCanceled(err)) {
                new Notice(MESSAGES.NOTICE_DOWNLOAD_CANCELED);
            } else {
                // errorMessage carries the server's reason, e.g. insufficient disk space.
                new Notice(errorMessage(err, MESSAGES.ERROR_FAILED_UPDATE));
                console.error("[lilbee] update failed:", err);
            }
            progress.panel.hide();
            actionBtn.setButtonText(restoreLabel);
            actionBtn.setDisabled(false);
            return false;
        }
    }

    private applySharedRootRow(setting: Setting): void {
        const resolved = this.plugin.vaultRegistry?.sharedRoot ?? "";
        setting
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

    private applyAdoptDataDirRow(setting: Setting): void {
        const registry = this.plugin.vaultRegistry;
        if (!registry) return;
        let staged = "";
        setting
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
                    this.refresh();
                }),
            );
    }

    /** Walks the shared install; the total is reused by the uninstall section. */
    private applyStorageReportRow(setting: Setting, container: HTMLElement): void {
        const registry = this.plugin.vaultRegistry;
        if (!registry) return;
        const report = reportForVault(registry.sharedRoot, registry.resolveDataDir(this.plugin.vaultId));
        this.storageTotalBytes = report.totalBytes;
        setting.setName(MESSAGES.LABEL_STORAGE_REPORT).setDesc(MESSAGES.DESC_STORAGE_REPORT);

        const list = container.createDiv({ cls: "lilbee-storage-report" });
        appendStorageRow(list, MESSAGES.LABEL_STORAGE_BIN, report.binBytes);
        appendStorageRow(list, MESSAGES.LABEL_STORAGE_MODELS, report.modelsBytes);
        appendStorageRow(list, MESSAGES.LABEL_STORAGE_VAULT, report.vaultBytes, report.vaultDataDir);
        appendStorageRow(list, MESSAGES.LABEL_STORAGE_TOTAL, report.totalBytes);
    }

    private applyDiagnosticsRow(setting: Setting): void {
        setting
            .setName(MESSAGES.LABEL_EXPORT_DIAGNOSTICS)
            .setDesc(MESSAGES.DESC_EXPORT_DIAGNOSTICS)
            .addButton((btn) =>
                btn.setButtonText(MESSAGES.BUTTON_EXPORT_DIAGNOSTICS).onClick(() => {
                    void exportDiagnostics(this.plugin.diagnosticsContext());
                }),
            );
    }

    private rowsExternal(): RowSpec[] {
        return [
            this.localRow(MESSAGES.LABEL_SERVER_URL, MESSAGES.DESC_SERVER_URL_HELP, (setting) =>
                this.applyServerUrlRow(setting),
            ),
            this.localRow(MESSAGES.LABEL_MANUAL_TOKEN, MESSAGES.DESC_MANUAL_TOKEN, (setting) =>
                this.applyManualTokenRow(setting),
            ),
            this.localRow(MESSAGES.LABEL_SWITCH_MANAGED, MESSAGES.DESC_SWITCH_MANAGED, (setting) =>
                this.applySwitchToManagedRow(setting),
            ),
        ];
    }

    private applyServerUrlRow(setting: Setting): void {
        setting
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

        const serverStatusEl = setting.settingEl.createSpan({ cls: "lilbee-health-status" });

        setting.addButton((btn) =>
            btn.setButtonText(MESSAGES.BUTTON_TEST).onClick(async () => {
                await this.checkEndpoint(`${this.plugin.settings.serverUrl}/api/health`, serverStatusEl);
            }),
        );
        this.appendLocalResetAffordance(setting, "serverUrl", MESSAGES.LABEL_SERVER_URL);

        void this.checkEndpoint(`${this.plugin.settings.serverUrl}/api/health`, serverStatusEl);
    }

    private applyManualTokenRow(setting: Setting): void {
        setting
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
        this.appendLocalResetAffordance(setting, "manualToken", MESSAGES.LABEL_MANUAL_TOKEN);
    }

    private applySwitchToManagedRow(setting: Setting): void {
        setting
            .setName(MESSAGES.LABEL_SWITCH_MANAGED)
            .setDesc(MESSAGES.DESC_SWITCH_MANAGED)
            .addButton((btn) =>
                btn.setButtonText(MESSAGES.BUTTON_RESET_MANAGED).onClick(async () => {
                    this.plugin.settings.serverMode = SERVER_MODE.MANAGED;
                    this.plugin.settings.serverUrl = DEFAULT_SETTINGS.serverUrl;
                    await this.plugin.saveSettings();
                    this.refresh();
                }),
            );
    }

    private renderModelsSection(containerEl: HTMLElement): void {
        new Setting(containerEl).setName(MESSAGES.LABEL_MODELS).setHeading();
        containerEl.createEl("p", { text: MESSAGES.DESC_MODELS_HELP, cls: "setting-item-description" });
        this.mountModelPickers(containerEl);
        this.applyRefreshModelsRow(new Setting(containerEl));
    }

    private defsModels(): SettingDefinitionItem[] {
        return [
            {
                type: "group",
                heading: MESSAGES.LABEL_MODELS,
                items: [
                    this.definitionOf({
                        name: "",
                        desc: MESSAGES.DESC_MODELS_HELP,
                        searchable: false,
                        apply: (_setting, container) => this.mountModelPickers(container),
                    }),
                    this.definitionOf(
                        this.localRow(MESSAGES.LABEL_REFRESH_MODELS, MESSAGES.DESC_REFRESH_MODELS, (setting) =>
                            this.applyRefreshModelsRow(setting),
                        ),
                    ),
                ],
            },
        ];
    }

    /** The chat, embedding, vision and reranker pickers all live in one container the Refresh button reloads. */
    private mountModelPickers(container: HTMLElement): void {
        this.modelsContainerEl = container.createDiv(CLS_MODELS_CONTAINER);
        void this.loadModels(this.modelsContainerEl);
    }

    private applyRefreshModelsRow(setting: Setting): void {
        setting
            .setName(MESSAGES.LABEL_REFRESH_MODELS)
            .setDesc(MESSAGES.DESC_REFRESH_MODELS)
            .addButton((btn) =>
                btn.setButtonText(MESSAGES.BUTTON_REFRESH).onClick(async () => {
                    if (this.modelsContainerEl) await this.loadModels(this.modelsContainerEl);
                }),
            )
            .addButton((btn) =>
                btn.setButtonText(MESSAGES.BUTTON_BROWSE_CATALOG).onClick(() => {
                    new CatalogModal(this.app, this.plugin).open();
                }),
            );
    }

    private rowsChatSettings(): RowSpec[] {
        return CHAT_TOGGLES.map((spec) => this.bareToggleRow(spec));
    }

    private renderChatSettings(containerEl: HTMLElement): void {
        new Setting(containerEl).setName(MESSAGES.LABEL_CHAT_SECTION).setHeading();
        this.renderRows(containerEl, this.rowsChatSettings());
    }

    private rowsSearchRetrieval(): RowSpec[] {
        return [
            this.localRow(MESSAGES.LABEL_RESULTS_COUNT, MESSAGES.DESC_RESULTS_COUNT, (setting) =>
                this.applyResultsCountRow(setting),
            ),
            this.sliderRow(MAX_DISTANCE, MAX_DISTANCE_LIMITS),
            this.toggleRow(ADAPTIVE_THRESHOLD),
        ];
    }

    private renderSearchRetrievalSettings(containerEl: HTMLElement): void {
        new Setting(containerEl).setName(MESSAGES.LABEL_SEARCH_RETRIEVAL).setHeading();
        this.renderRows(containerEl, this.rowsSearchRetrieval());
    }

    private applyResultsCountRow(setting: Setting): void {
        setting
            .setName(MESSAGES.LABEL_RESULTS_COUNT)
            .setDesc(MESSAGES.DESC_RESULTS_COUNT)
            .addSlider((slider) =>
                slider
                    .setLimits(TOP_K_LIMITS.min, TOP_K_LIMITS.max, TOP_K_LIMITS.step)
                    .setValue(this.plugin.settings.topK)
                    .onChange(async (value) => {
                        this.plugin.settings.topK = value;
                        await this.plugin.saveSettings();
                    }),
            );
        this.appendLocalResetAffordance(setting, "topK", MESSAGES.LABEL_RESULTS_COUNT);
    }

    private loadServerDefaults(): void {
        this.plugin.api
            .config()
            .then((cfg: ConfigResponse) => this.adoptServerConfig(cfg))
            .catch(() => {
                // Connection status is shown via the Test button, so no duplicate warning here.
            });
    }

    /** Fills the rendered controls, then holds the config the row predicates read. */
    private adoptServerConfig(cfg: ConfigResponse): void {
        this.fillConfigInputs(cfg);
        this.fillConfigComponents(cfg);
        this.applyPromptPlaceholders(cfg);
        const first = this.serverConfig === null;
        this.serverConfig = cfg;
        this.applyChatModeFromConfig(cfg);
        this.applyHideableConfigFields(cfg);
        if (!this.usesDefinitions()) return;
        // The first config rebuilds the tab; later ones only re-evaluate visibility.
        if (first) this.refresh();
        else this.refreshVisibility();
    }

    /** The server value fills the box and stays as the placeholder a cleared override falls back to. */
    private fillConfigInputs(cfg: ConfigResponse): void {
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
    }

    private fillConfigComponents(cfg: ConfigResponse): void {
        for (const [key, toggle] of this.serverConfigToggles) {
            const v = cfg[key];
            if (typeof v === "boolean") this.setValueSilently(() => toggle.setValue(v));
        }
        for (const [key, slider] of this.serverConfigSliders) {
            const v = cfg[key];
            if (typeof v === "number") this.setValueSilently(() => slider.setValue(v));
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
    }

    private applyPromptPlaceholders(cfg: ConfigResponse): void {
        for (const key of [CONFIG_KEY.RAG_SYSTEM_PROMPT, CONFIG_KEY.GENERAL_SYSTEM_PROMPT]) {
            const value = cfg[key];
            const input = this.serverConfigInputs.get(key);
            if (typeof value === "string" && input) {
                input.placeholder = value;
            }
        }
    }

    /** Send a system prompt to the server. An empty box means "use the default",
     *  so it clears the override rather than setting an empty prompt. */
    private async pushSystemPrompt(key: string, value: string, name: string): Promise<void> {
        const trimmed = value.trim();
        try {
            await this.plugin.api.updateConfig({ [key]: trimmed === "" ? null : trimmed });
        } catch {
            new Notice(MESSAGES.NOTICE_FAILED_UPDATE(name));
        }
    }

    /** Runs a programmatic setValue with the control's onChange muted, so nothing echoes to the server. */
    private setValueSilently(apply: () => unknown): void {
        this.suppressChangeEvents = true;
        try {
            apply();
        } finally {
            this.suppressChangeEvents = false;
        }
    }

    /** Show or hide a row the plugin owns. On 1.13 the row's visible predicate owns it and this is a no-op. */
    private setRowVisible(el: HTMLElement | null, visible: boolean): void {
        if (!el || this.usesDefinitions()) return;
        if (visible) el.show();
        else el.hide();
    }

    /** Pre-1.13 hides the row until the server reports the key; 1.13 uses the row's visible predicate. */
    private hideUntilServerReports(el: HTMLElement, key: string): void {
        if (this.usesDefinitions()) return;
        el.hide();
        this.serverConfigHideableEls.set(key, el);
    }

    /** Fails open: settings search skips a hidden row, and the config that would unhide it loads late. */
    private serverReports(key: string): boolean {
        return this.serverConfig === null || this.serverConfig[key] !== undefined;
    }

    /** True until a capability probe says the connected server lacks the feature. */
    private serverSupports(capability: string): boolean {
        return this.capabilities === null || this.capabilities[capability];
    }

    private applyHideableConfigFields(cfg: ConfigResponse): void {
        // The initial render leaves each row's settingEl with display = "none". When the server
        // reports a value for a key, reveal the row. Older servers omit unknown keys entirely,
        // in which case the row stays hidden via its initial style.
        for (const [key, settingEl] of this.serverConfigHideableEls) {
            if (cfg[key] !== undefined) {
                settingEl.show();
                settingEl.removeAttribute("data-lilbee-hidden-by-capability");
            } else {
                settingEl.hide();
                settingEl.setAttribute("data-lilbee-hidden-by-capability", "true");
            }
        }
    }

    private applyChatModeFromConfig(cfg: ConfigResponse): void {
        // On 1.13 the row's visible predicate owns its visibility.
        this.setRowVisible(this.chatModeSettingEl, cfg.chat_mode !== undefined);
        if (cfg.chat_mode === undefined) return;
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
                        this.refresh();
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
                    this.refresh();
                }),
        );
    }

    private rowsGeneration(): RowSpec[] {
        const rag: ConfigRowSpec = {
            key: CONFIG_KEY.RAG_SYSTEM_PROMPT,
            name: MESSAGES.LABEL_RAG_SYSTEM_PROMPT,
            desc: MESSAGES.DESC_RAG_SYSTEM_PROMPT,
        };
        const general: ConfigRowSpec = {
            key: CONFIG_KEY.GENERAL_SYSTEM_PROMPT,
            name: MESSAGES.LABEL_GENERAL_SYSTEM_PROMPT,
            desc: MESSAGES.DESC_GENERAL_SYSTEM_PROMPT,
        };
        return [
            // Both prompts are server config, shown in external mode too.
            this.localRow(rag.name, rag.desc, (setting) =>
                this.applySystemPromptRow(setting, rag, "ragSystemPrompt", this.plugin.settings.ragSystemPrompt),
            ),
            this.localRow(general.name, general.desc, (setting) =>
                this.applySystemPromptRow(
                    setting,
                    general,
                    "generalSystemPrompt",
                    this.plugin.settings.generalSystemPrompt,
                ),
            ),
            {
                key: CONFIG_KEY.CHAT_MODE,
                name: MESSAGES.LABEL_CHAT_MODE,
                desc: MESSAGES.DESC_CHAT_MODE,
                apply: (setting) => this.applyChatModeRow(setting),
            },
            ...GENERATION_FIELDS.map((field) => this.generationRow(field)),
        ];
    }

    private renderGenerationSettings(containerEl: HTMLElement): void {
        const details = this.openDetails(
            containerEl,
            "lilbee-generation-details",
            this.generationHeading(),
            MESSAGES.LABEL_GENERATION_HELP,
        );
        this.renderRows(details, this.rowsGeneration());
    }

    /** A prompt kept in plugin settings and mirrored to the server. */
    private applySystemPromptRow(
        setting: Setting,
        spec: ConfigRowSpec,
        settingsKey: "ragSystemPrompt" | "generalSystemPrompt",
        initial: string,
    ): void {
        setting
            .setName(spec.name)
            .setDesc(spec.desc)
            .addTextArea((text) => {
                text.setPlaceholder(MESSAGES.PLACEHOLDER_DEFAULT)
                    .setValue(initial)
                    .onChange(async (value) => {
                        this.plugin.settings[settingsKey] = value;
                        await this.plugin.saveSettings();
                        await this.pushSystemPrompt(spec.key, value, spec.name);
                    });
                this.serverConfigInputs.set(spec.key, text.inputEl);
            });
        this.appendLocalResetAffordance(setting, settingsKey, spec.name);
    }

    private applyChatModeRow(setting: Setting): void {
        setting
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
        this.chatModeSettingEl = setting.settingEl;
        this.setRowVisible(this.chatModeSettingEl, false);
    }

    private generationRow(field: GenerationField): RowSpec {
        const spec: ConfigRowSpec = { key: field.key, name: field.name, desc: field.desc };
        const apply = (setting: Setting): void => this.applyGenerationField(setting, spec, field);
        return field.hideable === true ? { ...spec, apply } : this.localRow(spec.name, spec.desc, apply);
    }

    /** A generation knob: a number, or an empty box that clears the override. */
    private applyGenerationField(setting: Setting, spec: ConfigRowSpec, field: GenerationField): void {
        setting
            .setName(spec.name)
            .setDesc(spec.desc)
            .addText((text) => {
                text.setPlaceholder(MESSAGES.PLACEHOLDER_NOT_SET)
                    .setValue("")
                    .onChange(async (value) => {
                        const trimmed = value.trim();
                        if (trimmed === "") {
                            await this.pushConfig(spec.key, null, spec.name);
                            return;
                        }
                        const num = field.integer ? parseInt(trimmed, 10) : parseFloat(trimmed);
                        if (isNaN(num)) return;
                        await this.pushConfig(spec.key, num, spec.name);
                    });
                this.serverConfigInputs.set(spec.key, text.inputEl);
            });
        this.appendResetAffordance(setting, spec.key, spec.name);
        if (field.hideable === true) this.hideUntilServerReports(setting.settingEl, spec.key);
    }

    private rowsWorkerPool(): RowSpec[] {
        return [
            this.numberRow(
                {
                    key: "worker_pool_call_timeout_s",
                    name: MESSAGES.LABEL_WORKER_POOL_CALL_TIMEOUT,
                    desc: MESSAGES.DESC_WORKER_POOL_CALL_TIMEOUT,
                },
                { integer: false, min: 0 },
            ),
            this.toggleRow({
                key: "worker_pool_eager_start",
                name: MESSAGES.LABEL_WORKER_POOL_EAGER_START,
                desc: MESSAGES.DESC_WORKER_POOL_EAGER_START,
            }),
            this.numberRow(
                {
                    key: "worker_pool_max_idle_s",
                    name: MESSAGES.LABEL_WORKER_POOL_MAX_IDLE,
                    desc: MESSAGES.DESC_WORKER_POOL_MAX_IDLE,
                },
                { integer: false, min: 0 },
            ),
        ];
    }

    private renderWorkerPoolSettings(containerEl: HTMLElement): void {
        const details = this.openDetails(
            containerEl,
            "lilbee-worker-pool-details",
            MESSAGES.LABEL_WORKER_POOL,
            MESSAGES.LABEL_WORKER_POOL_HELP,
        );
        this.renderRows(details, this.rowsWorkerPool());
    }

    /** GPU / fleet tuning knobs not surfaced in the placement view. Each row stays
     * hidden until the connected server reports the key, so older servers show none. */
    private rowsFleet(): RowSpec[] {
        const kv: ConfigRowSpec = {
            key: "kv_cache_type",
            name: MESSAGES.LABEL_KV_CACHE_TYPE,
            desc: MESSAGES.DESC_KV_CACHE_TYPE,
        };
        const devices: ConfigRowSpec = {
            key: "gpu_devices",
            name: MESSAGES.LABEL_GPU_DEVICES,
            desc: MESSAGES.DESC_GPU_DEVICES,
        };
        return [
            { ...kv, apply: (setting) => this.applyKvCacheRow(setting, kv) },
            this.toggleRow({
                key: "flash_attention",
                name: MESSAGES.LABEL_FLASH_ATTENTION,
                desc: MESSAGES.DESC_FLASH_ATTENTION,
            }),
            this.numberRow(
                { key: "n_gpu_layers", name: MESSAGES.LABEL_N_GPU_LAYERS, desc: MESSAGES.DESC_N_GPU_LAYERS },
                { integer: true, min: 0 },
            ),
            this.numberRow(
                { key: "embed_replicas", name: MESSAGES.LABEL_EMBED_REPLICAS, desc: MESSAGES.DESC_EMBED_REPLICAS },
                { integer: true, min: 0 },
            ),
            this.numberRow(
                { key: "vision_replicas", name: MESSAGES.LABEL_VISION_REPLICAS, desc: MESSAGES.DESC_VISION_REPLICAS },
                { integer: true, min: 0 },
            ),
            {
                ...devices,
                apply: (setting) => this.applyNullableTextRow(setting, devices, MESSAGES.PLACEHOLDER_GPU_DEVICES),
            },
        ];
    }

    private renderFleetSettings(containerEl: HTMLElement): void {
        const details = this.openDetails(
            containerEl,
            "lilbee-fleet-details",
            MESSAGES.LABEL_FLEET,
            MESSAGES.LABEL_FLEET_HELP,
        );
        this.renderRows(details, this.rowsFleet());
    }

    private applyKvCacheRow(setting: Setting, spec: ConfigRowSpec): void {
        setting
            .setName(spec.name)
            .setDesc(spec.desc)
            .addDropdown((dropdown) => {
                dropdown.addOption(KV_CACHE_TYPE.F16, KV_CACHE_TYPE.F16);
                dropdown.addOption(KV_CACHE_TYPE.Q8_0, KV_CACHE_TYPE.Q8_0);
                dropdown.addOption(KV_CACHE_TYPE.Q4_0, KV_CACHE_TYPE.Q4_0);
                dropdown.addOption(KV_CACHE_TYPE.F32, KV_CACHE_TYPE.F32);
                dropdown.setValue(KV_CACHE_TYPE.Q8_0);
                dropdown.onChange(async (value) => {
                    await this.pushConfig(spec.key, value, spec.name);
                });
                this.serverConfigDropdowns.set(spec.key, dropdown);
            });
        this.hideUntilServerReports(setting.settingEl, spec.key);
        this.appendResetAffordance(setting, spec.key, spec.name);
    }

    /** A server-config string in a text box; an empty box clears the override. */
    private applyNullableTextRow(setting: Setting, spec: ConfigRowSpec, placeholder: string): void {
        setting
            .setName(spec.name)
            .setDesc(spec.desc)
            .addText((text) => {
                text.setPlaceholder(placeholder)
                    .setValue("")
                    .onChange(async (value) => {
                        const trimmed = value.trim();
                        await this.pushConfig(spec.key, trimmed === "" ? null : trimmed, spec.name);
                    });
                this.serverConfigInputs.set(spec.key, text.inputEl);
            });
        this.hideUntilServerReports(setting.settingEl, spec.key);
        this.appendResetAffordance(setting, spec.key, spec.name);
    }

    private rowsIngest(): RowSpec[] {
        const tableModel: ConfigRowSpec = {
            key: "table_model",
            name: MESSAGES.LABEL_TABLE_MODEL,
            desc: MESSAGES.DESC_TABLE_MODEL,
        };
        return [
            // layout_detection is off by default server-side because of what it costs.
            this.toggleRow({
                key: "layout_detection",
                name: MESSAGES.LABEL_LAYOUT_DETECTION,
                desc: MESSAGES.DESC_LAYOUT_DETECTION,
            }),
            this.toggleRow({
                key: "table_extraction",
                name: MESSAGES.LABEL_TABLE_EXTRACTION,
                desc: MESSAGES.DESC_TABLE_EXTRACTION,
            }),
            this.localRow(tableModel.name, tableModel.desc, (setting) => this.applyTableModelRow(setting, tableModel)),
            this.listRow({
                key: "ocr_language",
                name: MESSAGES.LABEL_OCR_LANGUAGE,
                desc: MESSAGES.DESC_OCR_LANGUAGE,
            }),
            this.numberRow(
                {
                    key: "ingest_processes",
                    name: MESSAGES.LABEL_INGEST_PROCESSES,
                    desc: MESSAGES.DESC_INGEST_PROCESSES,
                },
                { integer: true, min: 0 },
            ),
            this.numberRow(
                {
                    key: "system_memory_reserve_gb",
                    name: MESSAGES.LABEL_SYSTEM_MEMORY_RESERVE_GB,
                    desc: MESSAGES.DESC_SYSTEM_MEMORY_RESERVE_GB,
                },
                { integer: false, min: 0 },
            ),
            this.numberRow(
                {
                    key: "usable_vram_fraction",
                    name: MESSAGES.LABEL_USABLE_VRAM_FRACTION,
                    desc: MESSAGES.DESC_USABLE_VRAM_FRACTION,
                },
                { integer: false, min: 0 },
            ),
            this.toggleRow({
                key: "fast_model_downloads",
                name: MESSAGES.LABEL_FAST_MODEL_DOWNLOADS,
                desc: MESSAGES.DESC_FAST_MODEL_DOWNLOADS,
            }),
            this.numberRow(
                { key: "chunk_size", name: MESSAGES.LABEL_CHUNK_SIZE, desc: MESSAGES.DESC_CHUNK_SIZE },
                { integer: true, min: 1, reindex: true },
            ),
            this.numberRow(
                { key: "chunk_overlap", name: MESSAGES.LABEL_CHUNK_OVERLAP, desc: MESSAGES.DESC_CHUNK_OVERLAP },
                { integer: true, min: 0, reindex: true },
            ),
            this.numberRow(
                {
                    key: "max_chunks_per_file",
                    name: MESSAGES.LABEL_MAX_CHUNKS_PER_FILE,
                    desc: MESSAGES.DESC_MAX_CHUNKS_PER_FILE,
                },
                { integer: true, min: 0 },
            ),
            this.numberRow(
                {
                    key: "tesseract_timeout",
                    name: MESSAGES.LABEL_TESSERACT_TIMEOUT,
                    desc: MESSAGES.DESC_TESSERACT_TIMEOUT,
                },
                { integer: false, min: 0 },
            ),
            this.numberRow(
                {
                    key: "vision_load_budget_s",
                    name: MESSAGES.LABEL_VISION_LOAD_BUDGET,
                    desc: MESSAGES.DESC_VISION_LOAD_BUDGET,
                },
                { integer: false, min: 0 },
            ),
        ];
    }

    private renderIngestSettings(containerEl: HTMLElement): void {
        const details = this.openDetails(
            containerEl,
            "lilbee-ingest-details",
            MESSAGES.LABEL_INGEST,
            MESSAGES.LABEL_INGEST_HELP,
        );
        this.renderRows(details, this.rowsIngest());
    }

    private applyTableModelRow(setting: Setting, spec: ConfigRowSpec): void {
        setting
            .setName(spec.name)
            .setDesc(spec.desc)
            .addDropdown((dropdown) => {
                for (const model of Object.values(TABLE_MODEL)) dropdown.addOption(model, model);
                dropdown.setValue(TABLE_MODEL.SLANET_AUTO);
                dropdown.onChange(async (value) => {
                    await this.pushConfig(spec.key, value, spec.name);
                });
                this.serverConfigDropdowns.set(spec.key, dropdown);
            });
        this.appendResetAffordance(setting, spec.key, spec.name);
    }

    /** Memory rows read the config the tab already holds, so they exist only once it has arrived. */
    private rowsMemory(): RowSpec[] {
        return MEMORY_TOGGLES.map((spec) => ({
            ...spec,
            apply: (setting: Setting) => this.applyMemoryToggle(setting, spec, this.serverConfig?.[spec.key] === true),
        }));
    }

    private renderMemorySection(containerEl: HTMLElement): void {
        const section = containerEl.createDiv({ cls: "lilbee-settings-section" });
        new Setting(section).setName(MESSAGES.LABEL_MEMORY_SECTION).setHeading();
        this.plugin.api
            .config()
            .then((cfg) => {
                for (const spec of MEMORY_TOGGLES) {
                    this.applyMemoryToggle(new Setting(section), spec, cfg[spec.key] === true);
                }
            })
            .catch((err) => {
                if (noticeServerUnreachableIfApplicable(err)) return;
                this.plugin.journal.record(MESSAGES.NOTICE_MEMORY_CONFIG_FAILED, errorMessage(err, ""));
            });
    }

    private applyMemoryToggle(setting: Setting, spec: ConfigRowSpec, initial: boolean): void {
        setting
            .setName(spec.name)
            .setDesc(spec.desc)
            .addToggle((toggle) => {
                toggle.setValue(initial);
                toggle.onChange(async (value) => {
                    await this.pushConfig(spec.key, value, spec.name);
                });
                this.memoryToggles.set(spec.key, toggle);
            });
    }

    private rowsRetrievalAdvanced(): RowSpec[] {
        return RETRIEVAL_ADVANCED_FIELDS.map((field) => this.retrievalRow(field));
    }

    private retrievalRow(field: RetrievalField): RowSpec {
        const spec: ConfigRowSpec = { key: field.key, name: field.name, desc: field.desc };
        if (field.kind === "toggle") return this.toggleRow(spec);
        if (field.kind === "language")
            return this.localRow(spec.name, spec.desc, (setting) => this.applyFtsLanguageRow(setting, spec));
        return this.numberRow(spec, { integer: field.integer, min: field.min });
    }

    private renderRetrievalAdvanced(containerEl: HTMLElement): void {
        const details = this.openDetails(
            containerEl,
            "lilbee-retrieval-advanced-details",
            MESSAGES.LABEL_RETRIEVAL_ADVANCED,
            MESSAGES.LABEL_RETRIEVAL_ADVANCED_HELP,
        );
        this.renderRows(details, this.rowsRetrievalAdvanced());
    }

    /** A blank box means "leave the server's language alone", so it sends nothing. */
    private applyFtsLanguageRow(setting: Setting, spec: ConfigRowSpec): void {
        setting
            .setName(spec.name)
            .setDesc(spec.desc)
            .addText((text) => {
                text.onChange(async (value) => {
                    const trimmed = value.trim();
                    if (trimmed === "") return;
                    await this.pushConfig(spec.key, trimmed, spec.name);
                });
                this.serverConfigInputs.set(spec.key, text.inputEl);
            });
        this.appendResetAffordance(setting, spec.key, spec.name);
    }

    /** A server-config boolean on a toggle, hidden until loadServerDefaults sees the key. */
    private applyConfigToggle(setting: Setting, spec: ConfigRowSpec): void {
        this.applyBareConfigToggle(setting, spec);
        this.appendResetAffordance(setting, spec.key, spec.name);
    }

    /** A server-config number on a slider, hidden until loadServerDefaults sees the key. */
    private applyConfigSlider(setting: Setting, spec: ConfigRowSpec, limits: SliderLimits): void {
        setting
            .setName(spec.name)
            .setDesc(spec.desc)
            .addSlider((slider) => {
                slider.setLimits(limits.min, limits.max, limits.step).onChange(async (value) => {
                    if (this.suppressChangeEvents) return;
                    await this.pushConfig(spec.key, value, spec.name);
                });
                this.serverConfigSliders.set(spec.key, slider);
            });
        this.hideUntilServerReports(setting.settingEl, spec.key);
        this.appendResetAffordance(setting, spec.key, spec.name);
    }

    /** A server-config list of short strings, one per line (e.g. OCR languages). */
    private applyConfigList(setting: Setting, spec: ConfigRowSpec): void {
        setting
            .setName(spec.name)
            .setDesc(spec.desc)
            .addTextArea((area) => {
                area.onChange(async (value) => {
                    const items = value
                        .split("\n")
                        .map((line) => line.trim())
                        .filter((line) => line !== "");
                    // An empty box means "use the server default", not "no
                    // languages" — sending [] would leave OCR unable to read
                    // anything at all.
                    await this.pushConfig(spec.key, items.length > 0 ? items : null, spec.name);
                });
                this.serverConfigTextAreas.set(spec.key, area.inputEl);
            });
        this.appendResetAffordance(setting, spec.key, spec.name);
    }

    private applyHideableNumberField(setting: Setting, spec: ConfigRowSpec, opts: NumberFieldOpts): Setting {
        setting
            .setName(spec.name)
            .setDesc(spec.desc)
            .addText((text) => {
                text.setPlaceholder(MESSAGES.PLACEHOLDER_NOT_SET)
                    .setValue("")
                    .onChange(async (value) => {
                        await this.handleHideableNumberChange(value, spec.key, spec.name, opts);
                    });
                this.serverConfigInputs.set(spec.key, text.inputEl);
            });
        this.hideUntilServerReports(setting.settingEl, spec.key);
        return setting;
    }

    /** A hideable number field with its reset affordance: the shape most server-config rows take. */
    private applyNumberFieldWithReset(setting: Setting, spec: ConfigRowSpec, opts: NumberFieldOpts): void {
        this.appendResetAffordance(this.applyHideableNumberField(setting, spec, opts), spec.key, spec.name);
    }

    private async handleHideableNumberChange(
        value: string,
        key: string,
        name: string,
        opts: NumberFieldOpts,
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
                            if (!result.value.reindex_required) return;
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
                // Journal, not a notice: this fires while a section renders
                // (often mid-startup) and an optional dropdown failing to
                // populate is not something the user can act on.
                this.plugin.journal.record(MESSAGES.NOTICE_RERANKER_LOAD_FAILED, errorMessage(err, ""));
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
        const taskId = this.plugin.enqueuePull(`Pull ${entry.display_name}`);
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
                this.plugin.journal.record(MESSAGES.NOTICE_VISION_LOAD_FAILED, errorMessage(err, ""));
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
        const taskId = this.plugin.enqueuePull(`Pull ${entry.display_name}`);
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
                        if (!result.value.reindex_required) return;
                        new Notice(MESSAGES.NOTICE_REINDEX_REQUIRED);
                        void this.plugin.triggerSync();
                    });
                this.serverConfigInputs.set("embedding_model", text.inputEl);
            });
    }

    private rowsCrawling(): RowSpec[] {
        const renderMode: ConfigRowSpec = {
            key: CONFIG_KEY.CRAWL_RENDER_MODE,
            name: MESSAGES.LABEL_CRAWL_RENDER_MODE,
            desc: MESSAGES.DESC_CRAWL_RENDER_MODE,
        };
        const patterns: ConfigRowSpec = {
            key: "crawl_exclude_patterns",
            name: MESSAGES.LABEL_CRAWL_EXCLUDE_PATTERNS,
            desc: MESSAGES.DESC_CRAWL_EXCLUDE_PATTERNS,
        };
        return [
            ...CRAWL_FIELDS.map((field) => this.crawlRow(field)),
            {
                ...renderMode,
                // The setup offer's search terms; picking browser mode installs the browser.
                aliases: [MESSAGES.LABEL_CRAWL_BROWSER_SETUP],
                apply: (setting) => this.applyCrawlRenderModeRow(setting, renderMode),
            },
            {
                name: MESSAGES.LABEL_CRAWL_BROWSER_SETUP,
                desc: MESSAGES.DESC_CRAWL_BROWSER_SETUP,
                visible: () => !this.crawlerBrowserReady,
                apply: (setting) => this.applyCrawlBrowserSetupRow(setting),
            },
            this.localRow(patterns.name, patterns.desc, (setting) =>
                this.applyCrawlExcludePatternsRow(setting, patterns),
            ),
        ];
    }

    private renderCrawlingSettings(containerEl: HTMLElement): void {
        new Setting(containerEl).setName(MESSAGES.LABEL_CRAWLING).setHeading();
        this.renderRows(containerEl, this.rowsCrawling());
    }

    private crawlRow(field: CrawlField): RowSpec {
        const spec: ConfigRowSpec = { key: field.key, name: field.name, desc: field.desc };
        if (field.kind === "bool")
            return this.localRow(spec.name, spec.desc, (setting) => this.applyCrawlBool(setting, spec));
        return this.localRow(spec.name, spec.desc, (setting) => this.applyCrawlNumber(setting, spec, field));
    }

    private applyCrawlBool(setting: Setting, spec: ConfigRowSpec): void {
        setting
            .setName(spec.name)
            .setDesc(spec.desc)
            .addToggle((toggle) => {
                toggle.onChange(async (value) => {
                    if (this.suppressChangeEvents) return;
                    await this.pushConfig(spec.key, value, spec.name);
                });
                this.serverConfigToggles.set(spec.key, toggle);
            });
        this.appendResetAffordance(setting, spec.key, spec.name);
    }

    private applyCrawlNumber(setting: Setting, spec: ConfigRowSpec, field: CrawlNumericField): void {
        setting
            .setName(spec.name)
            .setDesc(spec.desc)
            .addText((text) => {
                text.setPlaceholder(field.placeholder)
                    .setValue("")
                    .onChange(async (value) => {
                        const trimmed = value.trim();
                        if (trimmed === "") {
                            if (!field.nullable) return;
                            await this.pushConfig(spec.key, null, spec.name);
                            return;
                        }
                        const num = Number(trimmed);
                        if (!Number.isFinite(num)) return;
                        if (field.kind === "int" && !Number.isInteger(num)) return;
                        if (field.min !== undefined && num < field.min) return;
                        await this.pushConfig(spec.key, num, spec.name);
                    });
                this.serverConfigInputs.set(spec.key, text.inputEl);
            });
        this.appendResetAffordance(setting, spec.key, spec.name);
    }

    private applyCrawlRenderModeRow(setting: Setting, spec: ConfigRowSpec): void {
        setting
            .setName(spec.name)
            .setDesc(spec.desc)
            .addDropdown((dropdown) => {
                dropdown.addOption(CRAWL_RENDER_MODE.HTTP, MESSAGES.LABEL_CRAWL_RENDER_MODE_HTTP);
                dropdown.addOption(CRAWL_RENDER_MODE.BROWSER, MESSAGES.LABEL_CRAWL_RENDER_MODE_BROWSER);
                dropdown.setValue(CRAWL_RENDER_MODE.HTTP);
                dropdown.onChange(async (value) => {
                    // A fresh read: the gating probe can still be in flight.
                    if (
                        value === CRAWL_RENDER_MODE.BROWSER &&
                        !(await this.plugin.api.getCapability(CAPABILITY.CRAWLING_BROWSER))
                    ) {
                        // Browser mode without a browser installs one.
                        if (!(await this.plugin.installCrawlerBrowser())) {
                            dropdown.setValue(CRAWL_RENDER_MODE.HTTP);
                            return;
                        }
                        this.crawlerBrowserReady = true;
                        this.crawlerBrowserSetupEl?.hide();
                    }
                    await this.pushConfig(spec.key, value, spec.name);
                });
                this.serverConfigDropdowns.set(spec.key, dropdown);
            });
        this.appendResetAffordance(setting, spec.key, spec.name);
        this.hideUntilServerReports(setting.settingEl, spec.key);
    }

    /** Offered only inside a visible Crawling section, and only while the browser is missing. */
    private applyCrawlBrowserSetupRow(setting: Setting): void {
        setting
            .setName(MESSAGES.LABEL_CRAWL_BROWSER_SETUP)
            .setDesc(MESSAGES.DESC_CRAWL_BROWSER_SETUP)
            .addButton((btn) =>
                btn.setButtonText(MESSAGES.BUTTON_INSTALL_CHROMIUM).onClick(async () => {
                    btn.setDisabled(true);
                    const installed = await this.plugin.installCrawlerBrowser();
                    btn.setDisabled(false);
                    if (!installed) return;
                    this.crawlerBrowserReady = true;
                    this.hideCrawlBrowserSetup();
                }),
            );
        this.setRowVisible(setting.settingEl, false);
        this.crawlerBrowserSetupEl = setting.settingEl;
    }

    private hideCrawlBrowserSetup(): void {
        if (this.usesDefinitions()) {
            this.refreshVisibility();
            return;
        }
        this.crawlerBrowserSetupEl?.hide();
    }

    private applyCrawlExcludePatternsRow(setting: Setting, spec: ConfigRowSpec): void {
        setting
            .setName(spec.name)
            .setDesc(spec.desc)
            .addTextArea((text) => {
                text.setValue("").onChange(async (value) => {
                    const patterns = value
                        .split("\n")
                        .map((pattern) => pattern.trim())
                        .filter((pattern) => pattern.length > 0);
                    await this.pushConfig(spec.key, patterns, spec.name);
                });
                text.inputEl.addClass("lilbee-crawl-exclude-patterns");
                this.serverConfigTextAreas.set(spec.key, text.inputEl);
            });
        this.appendResetAffordance(setting, spec.key, spec.name);
    }

    /** The wiki rows that only mean anything while the wiki is on. */
    private rowsWikiSubSettings(): RowSpec[] {
        const entityPrompt: ConfigRowSpec = {
            key: "wiki_entity_page_prompt",
            name: MESSAGES.LABEL_WIKI_ENTITY_PAGE_PROMPT,
            desc: MESSAGES.DESC_WIKI_ENTITY_PAGE_PROMPT,
        };
        const status = MESSAGES.DESC_WIKI_STATUS_COUNTS(this.plugin.wikiPageCount, this.plugin.wikiDraftCount);
        return [
            this.localRow(MESSAGES.LABEL_WIKI_STATUS, status, (setting) => this.applyWikiStatusRow(setting, status)),
            this.toggleRow({
                key: "wiki_prune_raw",
                name: MESSAGES.LABEL_WIKI_PRUNE_RAW,
                desc: MESSAGES.DESC_WIKI_PRUNE_RAW,
            }),
            this.sliderRow(
                {
                    key: "wiki_embedding_faithfulness_threshold",
                    name: MESSAGES.LABEL_WIKI_FAITHFULNESS,
                    desc: MESSAGES.DESC_WIKI_FAITHFULNESS,
                },
                WIKI_FAITHFULNESS_LIMITS,
            ),
            this.localRow(MESSAGES.LABEL_WIKI_SEARCH_MODE, MESSAGES.DESC_WIKI_SEARCH_MODE, (setting) =>
                this.applyWikiSearchModeRow(setting),
            ),
            this.localRow(MESSAGES.LABEL_WIKI_SYNC_TO_VAULT, MESSAGES.DESC_WIKI_SYNC_TO_VAULT, (setting) =>
                this.applyWikiSyncRow(setting),
            ),
            this.localRow(MESSAGES.LABEL_WIKI_VAULT_FOLDER, MESSAGES.DESC_WIKI_VAULT_FOLDER, (setting) =>
                this.applyWikiFolderRow(setting),
            ),
            this.toggleRow({
                key: "wiki_auto_update",
                name: MESSAGES.LABEL_WIKI_AUTO_UPDATE,
                desc: MESSAGES.DESC_WIKI_AUTO_UPDATE,
            }),
            this.numberRow(
                {
                    key: "wiki_stub_max_chunk_refs",
                    name: MESSAGES.LABEL_WIKI_STUB_MAX_CHUNK_REFS,
                    desc: MESSAGES.DESC_WIKI_STUB_MAX_CHUNK_REFS,
                },
                { integer: true, min: 1 },
            ),
            this.localRow(entityPrompt.name, entityPrompt.desc, (setting) =>
                this.applyWikiEntityPromptRow(setting, entityPrompt),
            ),
            this.localRow(MESSAGES.LABEL_WIKI_RUN_LINT, MESSAGES.DESC_WIKI_RUN_LINT, (setting) =>
                this.applyWikiActionRow(setting, MESSAGES.LABEL_WIKI_RUN_LINT, MESSAGES.DESC_WIKI_RUN_LINT, () =>
                    this.plugin.runWikiLint(),
                ),
            ),
            this.localRow(MESSAGES.LABEL_WIKI_RUN_PRUNE, MESSAGES.DESC_WIKI_RUN_PRUNE, (setting) =>
                this.applyWikiActionRow(setting, MESSAGES.LABEL_WIKI_RUN_PRUNE, MESSAGES.DESC_WIKI_RUN_PRUNE, () =>
                    this.plugin.runWikiPrune(),
                ),
            ),
        ];
    }

    /** The enable toggle leads the section, as display() draws it, and answers for the rows it hides. */
    private rowsWiki(): RowSpec[] {
        const subSettings = this.rowsWikiSubSettings();
        return [
            {
                ...this.localRow(MESSAGES.LABEL_WIKI_ENABLE_TOGGLE, MESSAGES.DESC_WIKI_ENABLE_TOGGLE, (setting) =>
                    this.applyWikiEnableRow(setting),
                ),
                aliases: subSettings.map((row) => row.name),
            },
            ...this.gated(subSettings, () => this.plugin.settings.wikiEnabled),
        ];
    }

    private renderWikiSettings(containerEl: HTMLElement): void {
        const details = this.openDetails(containerEl, "lilbee-advanced-details", MESSAGES.LABEL_WIKI_SECTION);
        const subSettingsContainer = details.createDiv({ cls: "lilbee-wiki-sub-settings" });
        this.wikiSubSettingsEl = subSettingsContainer;
        this.applyWikiEnableRow(new Setting(details));
        this.setSubSettingsVisible(subSettingsContainer, this.plugin.settings.wikiEnabled);
        this.renderRows(subSettingsContainer, this.rowsWikiSubSettings());
    }

    private applyWikiEnableRow(setting: Setting): void {
        setting
            .setName(MESSAGES.LABEL_WIKI_ENABLE_TOGGLE)
            .setDesc(MESSAGES.DESC_WIKI_ENABLE_TOGGLE)
            .addToggle((toggle) => {
                toggle.setValue(this.plugin.settings.wikiEnabled);
                toggle.onChange(async (value) => {
                    this.plugin.settings.wikiEnabled = value;
                    await this.plugin.saveSettings();
                    this.showWikiSubSettings(value);
                });
            });
        this.appendLocalResetAffordance(setting, "wikiEnabled", MESSAGES.LABEL_WIKI_ENABLE_TOGGLE);
    }

    /** Reveal or hide the wiki rows after the enable toggle changed. */
    private showWikiSubSettings(visible: boolean): void {
        if (this.usesDefinitions()) {
            this.refreshVisibility();
            return;
        }
        if (this.wikiSubSettingsEl) this.setSubSettingsVisible(this.wikiSubSettingsEl, visible);
    }

    private applyWikiStatusRow(setting: Setting, status: string): void {
        setting.setName(MESSAGES.LABEL_WIKI_STATUS).setDesc(status).setDisabled(true);
    }

    private applyWikiSearchModeRow(setting: Setting): void {
        setting
            .setName(MESSAGES.LABEL_WIKI_SEARCH_MODE)
            .setDesc(MESSAGES.DESC_WIKI_SEARCH_MODE)
            .addDropdown((dropdown) => {
                dropdown
                    .addOption(SEARCH_CHUNK_TYPE.ALL, MESSAGES.LABEL_SEARCH_ALL)
                    .addOption(SEARCH_CHUNK_TYPE.WIKI, MESSAGES.LABEL_SEARCH_WIKI)
                    .addOption(SEARCH_CHUNK_TYPE.RAW, MESSAGES.LABEL_SEARCH_RAW)
                    .setValue(this.plugin.settings.searchChunkType)
                    .onChange(async (value) => {
                        this.plugin.settings.searchChunkType = value as SearchChunkType;
                        await this.plugin.saveSettings();
                    });
            });
        this.appendLocalResetAffordance(setting, "searchChunkType", MESSAGES.LABEL_WIKI_SEARCH_MODE);
    }

    private applyWikiSyncRow(setting: Setting): void {
        setting
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
        this.appendLocalResetAffordance(setting, "wikiSyncToVault", MESSAGES.LABEL_WIKI_SYNC_TO_VAULT);
    }

    private applyWikiFolderRow(setting: Setting): void {
        setting
            .setName(MESSAGES.LABEL_WIKI_VAULT_FOLDER)
            .setDesc(MESSAGES.DESC_WIKI_VAULT_FOLDER)
            .addText((text) => {
                text.setValue(this.plugin.settings.wikiVaultFolder);
                text.onChange(async (value) => {
                    this.plugin.settings.wikiVaultFolder = value || DEFAULT_SETTINGS.wikiVaultFolder;
                    await this.plugin.saveSettings();
                    if (this.plugin.settings.wikiSyncToVault && this.plugin.wikiEnabled) {
                        this.plugin.initWikiSync();
                    }
                });
            });
        this.appendLocalResetAffordance(setting, "wikiVaultFolder", MESSAGES.LABEL_WIKI_VAULT_FOLDER);
    }

    /** An empty box means "use the built-in prompt", which is null rather than an empty prompt. */
    private applyWikiEntityPromptRow(setting: Setting, spec: ConfigRowSpec): void {
        setting
            .setName(spec.name)
            .setDesc(spec.desc)
            .addTextArea((area) => {
                area.onChange(async (value) => {
                    const trimmed = value.trim();
                    await this.pushConfig(spec.key, trimmed === "" ? null : trimmed, spec.name);
                });
                this.serverConfigInputs.set(spec.key, area.inputEl);
            });
        this.appendResetAffordance(setting, spec.key, spec.name);
    }

    private applyWikiActionRow(setting: Setting, name: string, desc: string, run: () => Promise<unknown>): void {
        setting
            .setName(name)
            .setDesc(desc)
            .addButton((btn) => {
                btn.setButtonText(name);
                btn.onClick(() => {
                    void run();
                });
            });
    }

    private setSubSettingsVisible(container: HTMLElement, visible: boolean): void {
        container.style.display = visible ? "" : "none";
    }

    private rowsAdvanced(): RowSpec[] {
        const llm: ConfigRowSpec = {
            key: "llm_provider",
            name: MESSAGES.LABEL_LLM_PROVIDER,
            desc: MESSAGES.DESC_LLM_PROVIDER,
        };
        return [
            this.localRow(MESSAGES.LABEL_STORE_CONTENT_IN_VAULT, MESSAGES.DESC_STORE_CONTENT_IN_VAULT, (setting) =>
                this.applyStoreContentRow(setting),
            ),
            this.localRow(MESSAGES.LABEL_RERANKER_CANDIDATES, MESSAGES.DESC_RERANKER_CANDIDATES, (setting) =>
                this.applyRerankCandidatesRow(setting),
            ),
            this.localRow(llm.name, llm.desc, (setting) => this.applyLlmProviderRow(setting, llm)),
            ...this.gated(
                API_KEY_FIELDS.map((field) =>
                    this.localRow(field.name, field.desc, (setting) => this.applyApiKeyRow(setting, field)),
                ),
                () => this.serverSupports(CAPABILITY.API_KEYS),
            ),
            this.localRow(MESSAGES.LABEL_HF_TOKEN, MESSAGES.DESC_HF_TOKEN, (setting) => this.applyHfTokenRow(setting)),
            ...LOCAL_SERVER_FIELDS.map((field) =>
                this.localRow(field.name, field.desc, (setting) => this.applyLocalServerUrlRow(setting, field)),
            ),
            this.localRow(MESSAGES.LABEL_RESET_ALL_SETTINGS, MESSAGES.DESC_RESET_ALL_SETTINGS, (setting) =>
                this.applyResetAllRow(setting),
            ),
        ];
    }

    private renderAdvancedSettings(containerEl: HTMLElement): void {
        const details = this.openDetails(
            containerEl,
            "lilbee-advanced-details",
            MESSAGES.LABEL_ADVANCED,
            MESSAGES.LABEL_ADVANCED_HELP,
        );
        this.applyStoreContentRow(new Setting(details));
        this.applyRerankCandidatesRow(new Setting(details));
        const llm: ConfigRowSpec = {
            key: "llm_provider",
            name: MESSAGES.LABEL_LLM_PROVIDER,
            desc: MESSAGES.DESC_LLM_PROVIDER,
        };
        this.applyLlmProviderRow(new Setting(details), llm);
        const apiKeysContainer = details.createDiv({ cls: "lilbee-api-keys-section" });
        this.apiKeysContainerEl = apiKeysContainer;
        for (const field of API_KEY_FIELDS) this.applyApiKeyRow(new Setting(apiKeysContainer), field);
        this.applyHfTokenRow(new Setting(details));
        for (const field of LOCAL_SERVER_FIELDS) this.applyLocalServerUrlRow(new Setting(details), field);
        this.applyResetAllRow(new Setting(details));
    }

    private applyStoreContentRow(setting: Setting): void {
        const managed = this.plugin.settings.serverMode === SERVER_MODE.MANAGED;
        setting
            .setName(MESSAGES.LABEL_STORE_CONTENT_IN_VAULT)
            .setDesc(MESSAGES.DESC_STORE_CONTENT_IN_VAULT)
            .addToggle((toggle) => {
                toggle.setValue(this.plugin.settings.storeContentInVault);
                toggle.setDisabled(!managed);
                toggle.onChange(async (value) => {
                    this.plugin.settings.storeContentInVault = value;
                    // Flipping the toggle is the way out of a refused move.
                    this.plugin.settings.rejectedStorageMove = null;
                    await this.plugin.saveSettings();
                    // Both directions move content; off is not a no-op.
                    void this.plugin.configureManagedStorage();
                });
            });
        if (!managed) setting.settingEl.addClass("lilbee-setting-disabled");
    }

    private applyLlmProviderRow(setting: Setting, spec: ConfigRowSpec): void {
        setting
            .setName(spec.name)
            .setDesc(spec.desc)
            .addDropdown((dropdown) => {
                dropdown
                    .addOption("auto", MESSAGES.DESC_LLM_PROVIDER_AUTO)
                    .addOption("llama-cpp", MESSAGES.DESC_LLM_PROVIDER_LOCAL)
                    .addOption("litellm", MESSAGES.DESC_LLM_PROVIDER_EXTERNAL)
                    .setValue("auto")
                    .onChange(async (value) => {
                        try {
                            await this.plugin.api.updateConfig({ [spec.key]: value });
                            new Notice(MESSAGES.NOTICE_LLM_UPDATED);
                        } catch {
                            new Notice(MESSAGES.NOTICE_FAILED_LLM);
                        }
                    });
                this.serverConfigInputs.set(spec.key, dropdown.selectEl as unknown as HTMLInputElement);
            });
        this.appendResetAffordance(setting, spec.key, spec.name);
    }

    /** Keys are written on blur, so a partly typed key is never sent. */
    private applyApiKeyRow(setting: Setting, field: ApiKeyField): void {
        setting
            .setName(field.name)
            .setDesc(field.desc)
            .addText((text) => {
                text.setPlaceholder(MESSAGES.PLACEHOLDER_SK).setValue("");
                text.inputEl.type = "password";
                const saveKey = async (): Promise<void> => {
                    const trimmed = text.inputEl.value.trim();
                    if (trimmed === "") return;
                    try {
                        await this.plugin.api.updateConfig({ [field.key]: trimmed });
                        this.plugin.api.invalidateCapability(CAPABILITY.API_KEYS);
                        new Notice(MESSAGES.NOTICE_API_KEY_SAVED);
                    } catch {
                        new Notice(MESSAGES.NOTICE_FAILED_SAVE_KEY);
                    }
                };
                text.inputEl.addEventListener("blur", () => void saveKey());
            });
        setting.settingEl.setAttribute("data-lilbee-api-key", field.provider);
    }

    private applyHfTokenRow(setting: Setting): void {
        setting
            .setName(MESSAGES.LABEL_HF_TOKEN)
            .setDesc(MESSAGES.DESC_HF_TOKEN)
            .addText((text) => {
                text.setPlaceholder(MESSAGES.PLACEHOLDER_HF_TOKEN).setValue(this.plugin.getSharedHfToken());
                text.inputEl.type = "password";
                // Tracks input events, not a value change: re-entering the stored value still sends.
                let edited = false;
                text.inputEl.addEventListener("input", () => {
                    edited = true;
                });
                const saveToken = async (): Promise<void> => {
                    if (!edited) return;
                    edited = false;
                    const trimmed = text.inputEl.value.trim();
                    try {
                        await this.plugin.api.updateConfig({ hf_token: trimmed });
                    } catch {
                        new Notice(MESSAGES.NOTICE_FAILED_HF_TOKEN);
                        // Still unsaved; the next blur retries.
                        edited = true;
                        return;
                    }
                    // An edit made during the request owns the stored copy.
                    if (text.inputEl.value.trim() !== trimmed) return;
                    this.plugin.setSharedHfToken(trimmed);
                    new Notice(MESSAGES.NOTICE_HF_TOKEN_SAVED);
                };
                text.inputEl.addEventListener("blur", () => void saveToken());
            });
    }

    private applyLocalServerUrlRow(setting: Setting, field: LocalServerField): void {
        setting
            .setName(field.name)
            .setDesc(field.desc)
            .addText((text) => {
                text.setPlaceholder(field.placeholder)
                    .setValue("")
                    .onChange(async (value) => {
                        const trimmed = value.trim();
                        if (trimmed === "") return;
                        try {
                            await this.plugin.api.updateConfig({ [field.key]: trimmed });
                            new Notice(MESSAGES.NOTICE_LOCAL_SERVER_URL_UPDATED);
                        } catch {
                            new Notice(MESSAGES.NOTICE_FAILED_LOCAL_SERVER_URL);
                        }
                    });
                this.serverConfigInputs.set(field.key, text.inputEl);
            });
        this.appendResetAffordance(setting, field.key, field.name);
    }

    private applyResetAllRow(setting: Setting): void {
        setting
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
                        // Never wipe credential fields: resetting an API key has no undo path.
                        for (const k of CREDENTIAL_FIELDS) delete payload[k];
                        if (Object.keys(payload).length === 0) return;
                        try {
                            await this.plugin.api.updateConfig(payload);
                            new Notice(MESSAGES.NOTICE_SETTINGS_RESET);
                            this.refresh();
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
        const ok = await LilbeeClient.probe(url, SERVER_PROBE_TIMEOUT_MS, this.plugin.readCurrentToken());
        dot.classList.add(ok ? "is-ok" : "is-error");
        statusEl.classList.add(ok ? "lilbee-health-ok" : "lilbee-health-error");
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
        this.refresh();
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
        this.refresh();
    }

    private async streamChatPull(entry: CatalogEntry): Promise<boolean> {
        const taskId = this.plugin.enqueuePull(`Pull ${entry.display_name}`);
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
            actions.createSpan({ text: MESSAGES.LABEL_INSTALLED, cls: "lilbee-installed" });
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

    private applyRerankCandidatesRow(setting: Setting): void {
        const patch = debounce((...args: unknown[]) => {
            const num = args[0] as number;
            void this.patchRerankCandidates(num);
        }, DEBOUNCE_MS);

        setting
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
    row.createSpan({ text: formatDiskSize(bytes), cls: "lilbee-storage-row-bytes" });
    if (detail) row.createSpan({ text: detail, cls: "lilbee-storage-row-detail" });
}
