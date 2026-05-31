import {
    FuzzySuggestModal,
    ItemView,
    MarkdownRenderer,
    Menu,
    Notice,
    setIcon,
    type TFile,
    WorkspaceLeaf,
} from "obsidian";
import type LilbeePlugin from "../main";
import {
    CATALOG_SOURCE,
    CHAT_MODE,
    CONFIG_KEY,
    HOSTED_SOURCES,
    MODEL_TASK,
    SSE_EVENT,
    TASK_TYPE,
    ERROR_NAME,
} from "../types";
import type { CatalogEntry, ChatMode, InstalledModel, Message, SearchChunkType, Source, SSEEvent } from "../types";
import { RateLimitedError } from "../api";

import { renderAggregatedSourceChips } from "./results";
import { SEPARATOR_KEY, SEPARATOR_LABEL } from "../settings";
import { displayLabelForRef, extractHfRepo } from "../utils/model-ref";
import { ConfirmPullModal } from "./confirm-pull-modal";
import { ConfirmModal } from "./confirm-modal";
import { CatalogModal } from "./catalog-modal";
import { CrawlModal } from "./crawl-modal";
import { MESSAGES } from "../locales/en";
import {
    RETRY_INTERVAL_MS,
    SPINNER_MIN_DISPLAY_MS,
    percentFromSse,
    errorMessage,
    extractSseErrorMessage,
    extractSseErrorCode,
    isModelUnavailableError,
    noticeForResultError,
    getRelevantSystemMemoryGB,
} from "../utils";
import { SetupWizard } from "./setup-wizard";
import { hostedOptions, isUsableHostedRow } from "./catalog-helpers";

interface OpenDialogResult {
    canceled: boolean;
    filePaths: string[];
}

/** Thin wrapper around Electron's dialog — exported for test stubbing. */
export const electronDialog = {
    /* v8 ignore start -- requires Electron runtime */
    showOpenDialog(opts: Record<string, unknown>): Promise<OpenDialogResult> {
        const electron = require("electron") as {
            remote: { dialog: { showOpenDialog(o: Record<string, unknown>): Promise<OpenDialogResult> } };
        };
        return electron.remote.dialog.showOpenDialog(opts);
    },
    /* v8 ignore stop */
};

export const VIEW_TYPE_CHAT = "lilbee-chat";

/** Sentinel option value: selecting it opens the catalog instead of switching models. */
const RAIL_BROWSE_KEY = "__lilbee_browse__";
/** Option value that turns an optional role off (matches the server's empty model ref). */
const RAIL_DISABLED_KEY = "";

/** Static description of an optional rail role (Vision, Rerank). Dynamic state lives on the view. */
interface OptionalRoleSpec {
    key: "vision" | "rerank";
    task: typeof MODEL_TASK.VISION | typeof MODEL_TASK.RERANK;
    label: string;
    dotClass: string;
    selectClass: string;
    disabledLabel: string;
    tooltip: string;
    configKey: string;
    setActive: (api: LilbeePlugin["api"], model: string) => Promise<{ isErr(): boolean }>;
    failNotice: string;
}

const OPTIONAL_ROLE_SPECS: OptionalRoleSpec[] = [
    {
        key: "vision",
        task: MODEL_TASK.VISION,
        label: MESSAGES.RAIL_LABEL_VISION,
        dotClass: "is-vision",
        selectClass: "lilbee-vision-model-select",
        disabledLabel: MESSAGES.LABEL_VISION_DISABLED,
        tooltip: MESSAGES.TOOLTIP_ROLE_VISION,
        configKey: "vision_model",
        setActive: (api, model) => api.setVisionModel(model),
        failNotice: MESSAGES.RAIL_LABEL_VISION,
    },
    {
        key: "rerank",
        task: MODEL_TASK.RERANK,
        label: MESSAGES.RAIL_LABEL_RERANK,
        dotClass: "is-rerank",
        selectClass: "lilbee-rerank-model-select",
        disabledLabel: MESSAGES.LABEL_RERANKER_DISABLED,
        tooltip: MESSAGES.TOOLTIP_ROLE_RERANK,
        configKey: "reranker_model",
        setActive: (api, model) => api.setRerankerModel(model),
        failNotice: MESSAGES.RAIL_LABEL_RERANK,
    },
];

function extractString(data: unknown, field: string): string {
    if (typeof data === "object" && data !== null && field in data) {
        return String((data as Record<string, unknown>)[field]);
    }
    return String(data);
}

export function extractBanner(data: unknown): string | null {
    if (data === null || typeof data !== "object") return null;
    const banner = (data as Record<string, unknown>).banner;
    return typeof banner === "string" && banner.length > 0 ? banner : null;
}

export class ChatView extends ItemView {
    private plugin: LilbeePlugin;
    private history: Message[] = [];
    private messagesEl: HTMLElement | null = null;
    private sendBtn: HTMLButtonElement | null = null;
    private textareaEl: HTMLTextAreaElement | null = null;
    private sending = false;
    private streamController: AbortController | null = null;
    private pullController: AbortController | null = null;
    private chatCatalogEntries: CatalogEntry[] = [];
    private chatInstalled: InstalledModel[] = [];
    private chatActive = "";
    private chatSelectEl: HTMLSelectElement | null = null;
    private embeddingSelectEl: HTMLSelectElement | null = null;
    private embeddingModels: CatalogEntry[] = [];
    private activeEmbeddingModel = "";
    private chatModeContainer: HTMLElement | null = null;
    private chatModeCurrent: ChatMode | null = null;
    // Optional model roles (Vision, Rerank) surfaced in the rail. Keyed by the
    // spec's `key`; data refreshed alongside the chat/embed selectors. Options
    // come from the per-task catalog (so only role-capable models show), exactly
    // like the Settings model manager.
    private optionalRailEl: HTMLElement | null = null;
    private optionalCatalog: Record<string, CatalogEntry[]> = { vision: [], rerank: [] };
    private optionalActive: Record<string, string> = { vision: "", rerank: "" };
    private static readonly OFFLINE_THRESHOLD = 3;
    private retryTimer: ReturnType<typeof setTimeout> | null = null;
    private retryCount = 0;
    private emptyStateEl: HTMLElement | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: LilbeePlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return VIEW_TYPE_CHAT;
    }

    getDisplayText(): string {
        return MESSAGES.LABEL_CHAT_VIEW;
    }

    getIcon(): string {
        return "message-circle";
    }

    async onOpen(): Promise<void> {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass("lilbee-chat-container");

        this.createToolbar(container);
        this.messagesEl = container.createDiv({ cls: "lilbee-chat-messages" });
        this.createInputArea(container);
    }

    async onClose(): Promise<void> {
        this.streamController?.abort();
        this.pullController?.abort();
        if (this.retryTimer) {
            clearTimeout(this.retryTimer);
            this.retryTimer = null;
        }
        this.retryCount = 0;
    }

    private createToolbar(container: HTMLElement): void {
        const toolbar = container.createDiv({ cls: "lilbee-chat-toolbar" });

        // Model rail (line 1): the four roles as content-sized chips that wrap
        // when the panel is narrow. Each chip is a colored dot (filled = on,
        // hollow = off) + a clear label + the model picker. All four read the
        // same way — bb-72pq parity, no role is icon-only.
        const rail = toolbar.createDiv({ cls: "lilbee-model-rail" });

        const chatChip = rail.createDiv({ cls: "lilbee-model-chip lilbee-toolbar-group" });
        chatChip.setAttribute("aria-label", MESSAGES.TOOLTIP_ROLE_CHAT);
        chatChip.setAttribute("aria-label-position", "top");
        chatChip.createSpan({ cls: "lilbee-model-chip-dot is-chat is-active" });
        chatChip.createSpan({ cls: "lilbee-model-chip-label", text: MESSAGES.RAIL_LABEL_CHAT });
        this.chatSelectEl = chatChip.createEl("select", {
            cls: "lilbee-chat-model-select lilbee-model-chip-select",
        }) as HTMLSelectElement;
        this.attachChatListener(this.chatSelectEl);

        const embedChip = rail.createDiv({ cls: "lilbee-model-chip lilbee-toolbar-group lilbee-toolbar-group-embed" });
        embedChip.setAttribute("aria-label", MESSAGES.TOOLTIP_ROLE_EMBED);
        embedChip.setAttribute("aria-label-position", "top");
        embedChip.createSpan({ cls: "lilbee-model-chip-dot is-embed is-active" });
        embedChip.createSpan({ cls: "lilbee-model-chip-label", text: MESSAGES.RAIL_LABEL_EMBED });
        this.embeddingSelectEl = embedChip.createEl("select", {
            cls: "lilbee-embed-model-select lilbee-model-chip-select",
        }) as HTMLSelectElement;
        this.attachEmbeddingListener(this.embeddingSelectEl);

        // Optional roles (Vision, Rerank) are chips in the same wrapping rail.
        this.optionalRailEl = rail.createDiv({ cls: "lilbee-model-rail-optional" });
        this.fillOptionalRoles();

        // "Browse more" sits at the far right of the rail and opens the full
        // model catalog (all roles) — not tied to any one chip.
        const railBrowseBtn = rail.createEl("button", {
            text: MESSAGES.BUTTON_BROWSE_MORE,
            cls: "lilbee-embed-browse lilbee-rail-browse",
        });
        railBrowseBtn.setAttribute("aria-label", MESSAGES.BUTTON_BROWSE_MORE);
        railBrowseBtn.addEventListener("click", () => {
            new CatalogModal(this.app, this.plugin).open();
        });

        // Controls (line 2): mode toggles on the left, save/clear on the right.
        const actions = toolbar.createDiv({ cls: "lilbee-chat-toolbar-actions" });

        this.chatModeContainer = actions.createDiv({ cls: "lilbee-chat-mode-container" });

        this.fetchAndFillSelectors();

        // Search mode toggle (only shown when wiki feature is enabled)
        const wikiEnabled = this.plugin.settings.wikiEnabled;
        if (!wikiEnabled && this.plugin.settings.searchChunkType === "wiki") {
            this.plugin.settings.searchChunkType = "all";
        }
        if (wikiEnabled) {
            const modeGroup = actions.createDiv({ cls: "lilbee-search-mode" });
            const modes: { value: SearchChunkType; label: string }[] = [
                { value: "all", label: MESSAGES.LABEL_SEARCH_ALL },
                { value: "wiki", label: MESSAGES.LABEL_SEARCH_WIKI },
                { value: "raw", label: MESSAGES.LABEL_SEARCH_RAW },
            ];
            for (const mode of modes) {
                const btn = modeGroup.createEl("button", {
                    text: mode.label,
                    cls: `lilbee-search-mode-btn${this.plugin.settings.searchChunkType === mode.value ? " active" : ""}`,
                });
                btn.addEventListener("click", () => {
                    this.plugin.settings.searchChunkType = mode.value;
                    void this.plugin.saveSettings();
                    modeGroup.querySelectorAll(".lilbee-search-mode-btn").forEach((b) => b.removeClass("active"));
                    btn.addClass("active");
                });
            }
        }

        actions.createDiv({ cls: "lilbee-toolbar-spacer" });

        const saveBtn = actions.createEl("button", { cls: "lilbee-chat-save" });
        setIcon(saveBtn, "save");
        saveBtn.setAttribute("aria-label", MESSAGES.LABEL_SAVE_VAULT);
        saveBtn.addEventListener("click", () => this.saveToVault());

        const clearBtn = actions.createEl("button", { cls: "lilbee-chat-clear" });
        setIcon(clearBtn, "eraser");
        clearBtn.setAttribute("aria-label", MESSAGES.BUTTON_CLEAR_CHAT);
        clearBtn.addEventListener("click", () => this.clearChat());
    }

    private createInputArea(container: HTMLElement): void {
        const inputArea = container.createDiv({ cls: "lilbee-chat-input" });

        const addBtn = inputArea.createEl("button", { cls: "lilbee-chat-add-file" });
        addBtn.setAttribute("aria-label", MESSAGES.LABEL_ADD_FILE);
        setIcon(addBtn, "paperclip");
        addBtn.addEventListener("click", (e) => this.openFilePicker(e));

        const textarea = inputArea.createEl("textarea", {
            placeholder: MESSAGES.PLACEHOLDER_ASK_SOMETHING,
            cls: "lilbee-chat-textarea",
        }) as HTMLTextAreaElement;
        this.textareaEl = textarea;
        this.sendBtn = inputArea.createEl("button", {
            text: MESSAGES.BUTTON_SEND,
            cls: "lilbee-chat-send",
        }) as HTMLButtonElement;

        const handleSend = (): void => {
            // Defensively wrap in try/catch — exceptions in the click/keydown
            // path used to bubble out silently because Obsidian swallows them
            // at the event-listener boundary, leaving the user staring at a
            // chat with their question echoed back but no fetch fired.
            try {
                if (this.sending) return;
                const text = textarea.value.trim();
                if (!text) return;
                textarea.value = "";
                void this.sendMessage(text);
            } catch (err) {
                const reason = errorMessage(err, MESSAGES.ERROR_UNKNOWN, this.plugin.settings.serverMode);
                new Notice(MESSAGES.ERROR_CHAT_FAILED(reason));
            }
        };

        this.sendBtn.addEventListener("click", () => {
            if (this.sending) {
                this.streamController?.abort();
            } else {
                handleSend();
            }
        });
        textarea.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
            }
        });
    }

    private fetchAndFillSelectors(): void {
        Promise.all([
            this.plugin.api.catalog({ task: MODEL_TASK.CHAT }),
            this.plugin.api.installedModels({ task: MODEL_TASK.CHAT }).catch(() => ({ models: [] })),
            this.plugin.api.catalog({ task: MODEL_TASK.EMBEDDING }).catch(() => null),
            this.plugin.api.config().catch(() => null),
            this.plugin.api.catalog({ task: MODEL_TASK.VISION }).catch(() => null),
            this.plugin.api.catalog({ task: MODEL_TASK.RERANK }).catch(() => null),
        ])
            .then(([chatCatalogResult, chatInstalled, embeddingResult, serverConfig, visionCatalog, rerankCatalog]) => {
                if (this.retryTimer) {
                    clearTimeout(this.retryTimer);
                    this.retryTimer = null;
                }
                this.retryCount = 0;
                if (this.chatSelectEl) this.chatSelectEl.empty();
                this.chatCatalogEntries = chatCatalogResult.isOk() ? chatCatalogResult.value.models : [];
                this.chatInstalled = chatInstalled.models;
                this.chatActive = serverConfig ? String(serverConfig["chat_model"] ?? "") : "";
                if (this.chatSelectEl) this.fillSelectOptions(this.chatSelectEl);

                this.fillEmbeddingSelector(embeddingResult, serverConfig);
                this.fillOptionalRoleData(
                    visionCatalog && visionCatalog.isOk() ? visionCatalog.value.models : [],
                    rerankCatalog && rerankCatalog.isOk() ? rerankCatalog.value.models : [],
                    serverConfig,
                );
                this.renderChatModeToggle(serverConfig);

                if (this.chatInstalled.length === 0) {
                    this.showEmptyState();
                    this.retryTimer = setTimeout(() => this.fetchAndFillSelectors(), RETRY_INTERVAL_MS);
                } else {
                    this.hideEmptyState();
                }
            })
            .catch(() => {
                this.retryCount++;
                const connecting = this.retryCount < ChatView.OFFLINE_THRESHOLD;
                const label = connecting ? MESSAGES.LABEL_CONNECTING : MESSAGES.LABEL_OFFLINE;
                if (this.chatSelectEl) {
                    this.chatSelectEl.empty();
                    this.chatSelectEl.createEl("option", { text: label });
                }
                if (this.embeddingSelectEl) {
                    this.embeddingSelectEl.empty();
                    this.embeddingSelectEl.createEl("option", { text: label });
                }
                if (this.retryCount === ChatView.OFFLINE_THRESHOLD) {
                    new Notice(MESSAGES.ERROR_SERVER_UNREACHABLE);
                }
                this.retryTimer = setTimeout(() => this.fetchAndFillSelectors(), RETRY_INTERVAL_MS);
            });
    }

    private renderChatModeToggle(serverConfig: Record<string, unknown> | null): void {
        /* v8 ignore next 2 */
        if (!this.chatModeContainer) return;
        this.chatModeContainer.empty();
        const rawMode = serverConfig?.chat_mode;
        if (rawMode !== CHAT_MODE.SEARCH && rawMode !== CHAT_MODE.CHAT) return;
        this.chatModeCurrent = rawMode;
        const embeddingModel = typeof serverConfig?.embedding_model === "string" ? serverConfig.embedding_model : "";
        const noEmbedding = embeddingModel === "";

        const segments: { mode: ChatMode; label: string; tooltip: string }[] = [
            { mode: CHAT_MODE.SEARCH, label: MESSAGES.LABEL_CHAT_MODE_SEARCH, tooltip: MESSAGES.TOOLTIP_MODE_SEARCH },
            { mode: CHAT_MODE.CHAT, label: MESSAGES.LABEL_CHAT_MODE_CHAT, tooltip: MESSAGES.TOOLTIP_MODE_CHAT },
        ];
        for (const seg of segments) {
            const btn = this.chatModeContainer.createEl("button", {
                text: seg.label,
                cls: `lilbee-chat-mode-btn${seg.mode === rawMode ? " active" : ""}`,
            });
            btn.setAttribute("aria-label", seg.tooltip);
            btn.setAttribute("aria-label-position", "top");
            if (noEmbedding) {
                btn.disabled = true;
                btn.setAttribute("title", MESSAGES.TOOLTIP_CHAT_MODE_NEEDS_EMBEDDING);
                btn.addClass("lilbee-disabled");
            }
            btn.addEventListener("click", () => {
                if (noEmbedding || seg.mode === this.chatModeCurrent) return;
                void this.persistChatMode(seg.mode);
            });
        }
    }

    private async persistChatMode(mode: ChatMode): Promise<void> {
        try {
            await this.plugin.api.updateConfig({ [CONFIG_KEY.CHAT_MODE]: mode });
            this.chatModeCurrent = mode;
            this.applyActiveClassToChatModeButtons(mode);
        } catch (err) {
            const reason = errorMessage(err, MESSAGES.ERROR_UNKNOWN, this.plugin.settings.serverMode);
            new Notice(MESSAGES.NOTICE_FAILED_UPDATE(`${MESSAGES.LABEL_CHAT_MODE}: ${reason}`));
        }
    }

    private applyActiveClassToChatModeButtons(mode: ChatMode): void {
        /* v8 ignore next 2 */
        if (!this.chatModeContainer) return;
        const buttons = this.chatModeContainer.querySelectorAll(".lilbee-chat-mode-btn");
        const activeIdx = mode === CHAT_MODE.SEARCH ? 0 : 1;
        for (let i = 0; i < buttons.length; i++) {
            if (i === activeIdx) buttons[i].addClass("active");
            else buttons[i].removeClass("active");
        }
    }

    private fillEmbeddingSelector(
        embeddingResult: import("neverthrow").Result<import("../types").CatalogResponse, Error> | null,
        serverConfig: Record<string, unknown> | null,
    ): void {
        if (!this.embeddingSelectEl) return;
        this.embeddingSelectEl.empty();

        const activeModel = serverConfig ? String(serverConfig["embedding_model"] ?? "") : "";
        this.activeEmbeddingModel = activeModel;

        const models =
            embeddingResult && embeddingResult.isOk() ? embeddingResult.value.models.filter((m) => m.installed) : [];
        this.embeddingModels = models;

        for (const model of models) {
            const option = this.embeddingSelectEl.createEl("option", { text: model.display_name });
            (option as HTMLOptionElement).value = model.hf_repo;
            if (model.hf_repo === extractHfRepo(activeModel)) {
                (option as HTMLOptionElement).selected = true;
            }
        }

        if (models.length === 0 && activeModel) {
            const option = this.embeddingSelectEl.createEl("option", { text: displayLabelForRef(activeModel) });
            (option as HTMLOptionElement).value = activeModel;
            (option as HTMLOptionElement).selected = true;
        }
    }

    private fillSelectOptions(selectEl: HTMLSelectElement): void {
        const sourceMap = new Map(this.chatInstalled.map((m) => [m.name, m.source]));
        const installedRepos = new Set(this.chatInstalled.map((m) => extractHfRepo(m.name)));
        const activeRepo = extractHfRepo(this.chatActive);

        // Featured rows that have an installed quant.
        const featuredInstalled = this.chatCatalogEntries.filter((e) => installedRepos.has(e.hf_repo));
        for (const entry of featuredInstalled) {
            const sourceTag = HOSTED_SOURCES.has(entry.source) ? ` [${entry.provider ?? entry.source}]` : "";
            const option = selectEl.createEl("option", { text: `${entry.display_name}${sourceTag}` });
            (option as HTMLOptionElement).value = entry.hf_repo;
            if (entry.hf_repo === activeRepo) {
                (option as HTMLOptionElement).selected = true;
            }
        }

        // Hosted rows (frontier/ollama) are selectable even when absent from the
        // installed registry — ollama always, frontier with a ready key. Skip any
        // already emitted above as an installed featured row (an ollama model can
        // be both hosted and registered as installed).
        for (const [ref, label] of hostedOptions(this.chatCatalogEntries)) {
            if (installedRepos.has(ref)) continue;
            const option = selectEl.createEl("option", { text: label });
            (option as HTMLOptionElement).value = ref;
            if (ref === activeRepo) {
                (option as HTMLOptionElement).selected = true;
            }
        }

        // Anything installed that isn't in the featured catalog (manually pulled, ollama/, openai/, …).
        const featuredRepos = new Set(this.chatCatalogEntries.map((e) => e.hf_repo));
        const otherInstalled = this.chatInstalled
            .filter((m) => !featuredRepos.has(extractHfRepo(m.name)))
            .sort((a, b) => a.name.localeCompare(b.name));
        // Only emit the separator when it's actually dividing two
        // sections. Without this guard, an empty featured catalog (e.g.
        // server still warming up) lets the separator be the first
        // option, which browsers render as the dropdown's displayed
        // value — "—— Other... ——" instead of the real active model.
        if (featuredInstalled.length > 0 && otherInstalled.length > 0) {
            const sep = selectEl.createEl("option", { text: SEPARATOR_LABEL });
            (sep as HTMLOptionElement).value = SEPARATOR_KEY;
            (sep as HTMLOptionElement).disabled = true;
        }
        for (const m of otherInstalled) {
            const source = sourceMap.get(m.name);
            const suffix = source && source !== CATALOG_SOURCE.NATIVE ? ` [${source}]` : "";
            const option = selectEl.createEl("option", { text: `${displayLabelForRef(m.name)}${suffix}` });
            (option as HTMLOptionElement).value = m.name;
            if (m.name === this.chatActive) {
                (option as HTMLOptionElement).selected = true;
            }
        }
    }

    private attachChatListener(el: HTMLSelectElement): void {
        el.addEventListener("change", () => {
            if (!el.value || el.value === SEPARATOR_KEY) return;
            const uninstalled = this.chatCatalogEntries.find((e) => e.hf_repo === el.value && !e.installed);
            if (uninstalled) {
                const modal = new ConfirmPullModal(this.plugin.app, {
                    displayName: uninstalled.display_name,
                    sizeGb: uninstalled.size_gb,
                    minRamGb: uninstalled.min_ram_gb,
                    systemMemGb: getRelevantSystemMemoryGB(this.plugin.settings.serverMode),
                });
                modal.open();
                void modal.result.then((confirmed) => {
                    if (confirmed) {
                        void this.autoPullAndSet(uninstalled);
                    }
                });
                return;
            }
            this.plugin.api.setChatModel(el.value).then((result) => {
                if (result.isOk()) {
                    this.plugin.activeModel = el.value;
                    this.plugin.fetchActiveModel();
                    this.plugin.refreshSettingsTab();
                } else {
                    new Notice(MESSAGES.ERROR_SWITCH_MODEL);
                }
            });
        });
    }

    private attachEmbeddingListener(el: HTMLSelectElement): void {
        el.addEventListener("change", () => {
            if (!el.value) return;
            const previous = this.activeEmbeddingModel;
            const modal = new ConfirmModal(this.plugin.app, MESSAGES.DESC_EMBEDDING_REINDEX_WARNING);
            modal.open();
            void modal.result.then(async (confirmed) => {
                if (!confirmed) {
                    this.revertEmbeddingSelect(previous);
                    return;
                }
                const result = await this.plugin.api.setEmbeddingModel(el.value);
                if (result.isErr()) {
                    new Notice(noticeForResultError(result.error, MESSAGES.NOTICE_FAILED_EMBEDDING));
                    this.revertEmbeddingSelect(previous);
                    return;
                }
                this.activeEmbeddingModel = el.value;
                new Notice(MESSAGES.NOTICE_EMBEDDING_UPDATED);
                new Notice(MESSAGES.NOTICE_REINDEX_REQUIRED);
                this.plugin.refreshSettingsTab();
                void this.plugin.triggerSync();
            });
        });
    }

    /** Store the latest per-task catalog + active model for the optional roles, then re-render. */
    private fillOptionalRoleData(
        visionCatalog: CatalogEntry[],
        rerankCatalog: CatalogEntry[],
        serverConfig: Record<string, unknown> | null,
    ): void {
        this.optionalCatalog.vision = visionCatalog;
        this.optionalCatalog.rerank = rerankCatalog;
        this.optionalActive.vision = serverConfig ? String(serverConfig["vision_model"] ?? "") : "";
        this.optionalActive.rerank = serverConfig ? String(serverConfig["reranker_model"] ?? "") : "";
        this.fillOptionalRoles();
    }

    /** Rebuild the optional (Vision, Rerank) rail rows from current catalog/active state. */
    private fillOptionalRoles(): void {
        /* v8 ignore next 2 */
        if (!this.optionalRailEl) return;
        this.optionalRailEl.empty();
        for (const spec of OPTIONAL_ROLE_SPECS) {
            this.renderOptionalRoleRow(this.optionalRailEl, spec);
        }
    }

    /**
     * Selectable models for a role: local installed builds + hosted (LiteLLM)
     * entries — mirroring the Settings model manager so only role-capable
     * models appear. Un-installed catalog builds are reached via "Browse catalog".
     */
    private optionalRoleOptions(spec: OptionalRoleSpec): { value: string; label: string }[] {
        const entries = this.optionalCatalog[spec.key];
        const localInstalled = entries.filter((e) => !HOSTED_SOURCES.has(e.source) && e.installed);
        const hosted = entries.filter(isUsableHostedRow);
        const options = localInstalled.map((e) => ({ value: e.hf_repo, label: e.display_name }));
        for (const e of hosted) {
            options.push({ value: e.hf_repo, label: `${e.display_name} — ${MESSAGES.LABEL_VISION_HOSTED_GROUP}` });
        }
        return options;
    }

    private renderOptionalRoleRow(rail: HTMLElement, spec: OptionalRoleSpec): void {
        const active = this.optionalActive[spec.key];
        const options = this.optionalRoleOptions(spec);
        const chip = rail.createDiv({ cls: "lilbee-model-chip lilbee-model-chip-optional" });
        chip.setAttribute("aria-label", spec.tooltip);
        chip.setAttribute("aria-label-position", "top");
        if (!active) chip.addClass("is-off");
        const dot = chip.createSpan({ cls: `lilbee-model-chip-dot ${spec.dotClass}` });
        if (active) dot.addClass("is-active");
        chip.createSpan({ cls: "lilbee-model-chip-label", text: spec.label });

        const select = chip.createEl("select", {
            cls: `lilbee-model-chip-select ${spec.selectClass}`,
        }) as HTMLSelectElement;
        // "Disabled" turns the role off (model ref ""); the role stays visible
        // even with nothing installed, and "Browse catalog" downloads one.
        const disabled = select.createEl("option", { text: spec.disabledLabel });
        (disabled as HTMLOptionElement).value = RAIL_DISABLED_KEY;
        if (!active) (disabled as HTMLOptionElement).selected = true;

        const activeRepo = extractHfRepo(active);
        for (const opt of options) {
            const option = select.createEl("option", { text: opt.label });
            (option as HTMLOptionElement).value = opt.value;
            if (opt.value === active || opt.value === activeRepo) {
                (option as HTMLOptionElement).selected = true;
            }
        }
        const browse = select.createEl("option", { text: MESSAGES.RAIL_BROWSE_CATALOG });
        (browse as HTMLOptionElement).value = RAIL_BROWSE_KEY;
        this.attachOptionalRoleListener(select, spec);
    }

    private attachOptionalRoleListener(el: HTMLSelectElement, spec: OptionalRoleSpec): void {
        el.addEventListener("change", () => {
            if (el.value === RAIL_BROWSE_KEY) {
                new CatalogModal(this.app, this.plugin, spec.task).open();
                // Reset selection so reopening the catalog stays possible.
                el.value = this.optionalActive[spec.key];
                return;
            }
            // el.value === "" disables the role; any other value activates it.
            void spec.setActive(this.plugin.api, el.value).then((result) => {
                if (result.isErr()) {
                    new Notice(MESSAGES.NOTICE_FAILED_UPDATE(spec.failNotice));
                    return;
                }
                this.optionalActive[spec.key] = el.value;
                this.fillOptionalRoles();
                this.plugin.fetchActiveModel();
                this.plugin.refreshSettingsTab();
            });
        });
    }

    private revertEmbeddingSelect(previousValue: string): void {
        if (!this.embeddingSelectEl) return;
        // HTMLSelectElement.value is a no-op if no option matches — which
        // silently blanks the picker. Guard so the previous value only wins
        // when it actually exists in the current option set; otherwise fall
        // back to a server refresh so the picker can't get stuck empty.
        const hasOption = Array.from(this.embeddingSelectEl.options).some((opt) => opt.value === previousValue);
        if (hasOption) {
            this.embeddingSelectEl.value = previousValue;
            return;
        }
        void this.fetchAndFillSelectors();
    }

    private async autoPullAndSet(entry: CatalogEntry): Promise<void> {
        const taskId = this.plugin.taskQueue.enqueue(`Pull ${entry.display_name}`, TASK_TYPE.PULL);
        if (taskId === null) {
            new Notice(MESSAGES.NOTICE_QUEUE_FULL);
            return;
        }
        this.pullController = new AbortController();
        this.plugin.taskQueue.registerAbort(taskId, this.pullController);
        let pullFailed = false;
        try {
            for await (const event of this.plugin.api.pullModel(entry.hf_repo, "native", this.pullController.signal)) {
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
                    const d = event.data as { message?: string } | string;
                    const msg = extractSseErrorMessage(d, MESSAGES.ERROR_UNKNOWN);
                    new Notice(MESSAGES.ERROR_PULL_MODEL.replace("{model}", entry.display_name));
                    this.plugin.taskQueue.fail(taskId, msg);
                    pullFailed = true;
                    break;
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
            this.pullController = null;
            return;
        }
        this.pullController = null;

        if (pullFailed) return;

        this.plugin.taskQueue.complete(taskId);

        const result = await this.plugin.api.setChatModel(entry.hf_repo);
        if (result.isErr()) {
            new Notice(
                noticeForResultError(result.error, MESSAGES.ERROR_SET_MODEL.replace("{model}", entry.display_name)),
            );
        } else {
            this.plugin.activeModel = entry.hf_repo;
            new Notice(MESSAGES.NOTICE_MODEL_ACTIVATED_FULL(entry.display_name));
            this.plugin.refreshSettingsTab();
        }
        this.plugin.fetchActiveModel();
        this.refreshModelSelector();
    }

    private refreshModelSelector(): void {
        if (this.chatSelectEl) this.chatSelectEl.empty();
        if (this.embeddingSelectEl) this.embeddingSelectEl.empty();
        this.fetchAndFillSelectors();
    }

    private clearChat(): void {
        this.history = [];
        if (this.messagesEl) this.messagesEl.empty();
    }

    private async sendMessage(text: string): Promise<void> {
        if (!this.messagesEl || this.sending) return;
        this.sending = true;
        this.streamController = new AbortController();
        this.plugin.notifyChatStart();
        if (this.sendBtn) this.sendBtn.textContent = MESSAGES.BUTTON_STOP;
        if (this.textareaEl) this.textareaEl.disabled = true;

        const userBubble = this.messagesEl.createDiv({ cls: "lilbee-chat-message user" });
        userBubble.createEl("p", { text });
        this.history.push({ role: "user", content: text });

        const assistantBubble = this.messagesEl.createDiv({ cls: "lilbee-chat-message assistant" });
        const spinner = assistantBubble.createDiv({ cls: "lilbee-thinking-dots" });
        spinner.createDiv({ cls: "lilbee-thinking-dot" });
        spinner.createDiv({ cls: "lilbee-thinking-dot" });
        spinner.createDiv({ cls: "lilbee-thinking-dot" });
        const textEl = assistantBubble.createDiv({ cls: "lilbee-chat-content" });
        textEl.style.display = "none";
        this.messagesEl.scrollTop = this.messagesEl.scrollHeight;

        const state = { fullContent: "", reasoningContent: "", sources: [] as Source[], renderPending: false };

        const spinnerCreatedAt = Date.now();
        const revealContent = (): void => {
            const elapsed = Date.now() - spinnerCreatedAt;
            const delay = Math.max(0, SPINNER_MIN_DISPLAY_MS - elapsed);
            setTimeout(() => {
                if (spinner.parentElement) spinner.remove();
                textEl.style.display = "";
            }, delay);
        };

        const scrollToBottom = (): void => {
            if (this.messagesEl) this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
        };

        const scheduleRender = (): void => {
            if (state.renderPending) return;
            state.renderPending = true;
            requestAnimationFrame(() => {
                state.renderPending = false;
                void this.renderMarkdown(textEl, state.fullContent).then(scrollToBottom);
            });
        };

        try {
            for await (const event of this.plugin.api.chatStream(
                text,
                this.history.slice(0, -1),
                this.plugin.settings.topK,
                this.streamController.signal,
                undefined,
                this.plugin.settings.searchChunkType,
            )) {
                this.handleStreamEvent(event, textEl, assistantBubble, state, revealContent, scheduleRender);
            }
        } catch (err) {
            if (err instanceof Error && err.name === ERROR_NAME.ABORT_ERROR) {
                revealContent();
                if (state.fullContent) {
                    void this.renderMarkdown(textEl, `${state.fullContent}\n\n${MESSAGES.LABEL_STOPPED_MD}`);
                    this.history.push({ role: "assistant", content: state.fullContent });
                } else {
                    textEl.textContent = MESSAGES.LABEL_STOPPED;
                }
            } else if (err instanceof RateLimitedError) {
                this.renderInlineError(assistantBubble, MESSAGES.ERROR_RATE_LIMITED(err.retryAfterSeconds));
            } else {
                this.renderInlineError(
                    assistantBubble,
                    MESSAGES.ERROR_CHAT_FAILED(
                        errorMessage(err, MESSAGES.ERROR_UNKNOWN, this.plugin.settings.serverMode),
                    ),
                );
            }
        } finally {
            this.sending = false;
            this.streamController = null;
            this.plugin.notifyChatEnd();
            if (this.sendBtn) {
                this.sendBtn.textContent = MESSAGES.BUTTON_SEND;
            }
            if (this.textareaEl) this.textareaEl.disabled = false;
        }
    }

    private handleStreamEvent(
        event: SSEEvent,
        textEl: HTMLElement,
        assistantBubble: HTMLElement,
        state: { fullContent: string; reasoningContent: string; sources: Source[] },
        revealContent: () => void,
        scheduleRender: () => void,
    ): void {
        switch (event.event) {
            case SSE_EVENT.TOKEN: {
                revealContent();
                state.fullContent += extractString(event.data, "token");
                scheduleRender();
                break;
            }
            case SSE_EVENT.REASONING: {
                state.reasoningContent += extractString(event.data, "token");
                break;
            }
            case SSE_EVENT.SOURCES:
                state.sources.push(...(event.data as Source[]));
                break;
            case SSE_EVENT.DONE: {
                revealContent();
                const rendered = state.fullContent;
                if (state.reasoningContent) {
                    const details = assistantBubble.createEl("details", { cls: "lilbee-reasoning" });
                    details.createEl("summary", { text: MESSAGES.LABEL_REASONING });
                    const content = details.createDiv({ cls: "lilbee-reasoning-content" });
                    void MarkdownRenderer.render(this.app, state.reasoningContent, content, "", this.plugin);
                    details.removeAttribute("open");
                }
                this.renderBannerIfPresent(event.data, assistantBubble);
                void this.renderMarkdown(textEl, rendered);
                if (state.sources.length > 0) this.renderSources(assistantBubble, state.sources);
                this.history.push({ role: "assistant", content: rendered });
                break;
            }
            case SSE_EVENT.ERROR: {
                const errMsg = extractString(event.data, "message");
                assistantBubble.empty();
                // Match the thrown-error path: drop the assistant skin so the
                // error bubble doesn't inherit the assistant background colour
                // from .lilbee-chat-message.assistant.
                assistantBubble.removeClass("assistant");
                assistantBubble.addClass("lilbee-chat-message-error");
                assistantBubble.setAttribute("role", "alert");
                assistantBubble.createDiv({
                    cls: "lilbee-chat-error-text",
                    text: MESSAGES.ERROR_STREAM(errMsg),
                });
                new Notice(MESSAGES.ERROR_STREAM(errMsg));
                if (isModelUnavailableError(extractSseErrorCode(event.data), errMsg)) {
                    new Notice(MESSAGES.NOTICE_MODEL_UNAVAILABLE_SETUP);
                    new SetupWizard(this.app, this.plugin).open();
                }
                break;
            }
        }
    }

    private async renderMarkdown(el: HTMLElement, markdown: string): Promise<void> {
        el.empty();
        await MarkdownRenderer.render(this.app, markdown, el, "", this.plugin);
        el.addClass("markdown-rendered");
    }

    private renderInlineError(assistantBubble: HTMLElement, text: string): void {
        this.history.pop();
        assistantBubble.empty();
        assistantBubble.removeClass("assistant");
        assistantBubble.addClass("lilbee-chat-message-error");
        assistantBubble.setAttribute("role", "alert");
        assistantBubble.createDiv({ cls: "lilbee-chat-error-text", text });
        new Notice(text);
    }

    private openFilePicker(event: MouseEvent): void {
        const menu = new Menu();
        menu.addItem((item) => {
            item.setTitle(MESSAGES.WIZARD_FILE_PICKER_VAULT)
                .setIcon("vault")
                .onClick(() => {
                    new VaultFilePickerModal(this.app, (file) => this.enqueueAddFile(file)).open();
                });
        });
        menu.addItem((item) => {
            item.setTitle(MESSAGES.WIZARD_FILE_PICKER_DISK)
                .setIcon("file-plus")
                .onClick(() => this.openNativeFilePicker(false));
        });
        menu.addItem((item) => {
            item.setTitle(MESSAGES.WIZARD_FOLDER_PICKER_DISK)
                .setIcon("folder-plus")
                .onClick(() => this.openNativeFilePicker(true));
        });
        menu.addItem((item) => {
            item.setTitle(MESSAGES.WIZARD_CRAWL_WEB)
                .setIcon("globe")
                .onClick(() => {
                    new CrawlModal(this.app, this.plugin).open();
                });
        });
        // Belt-and-braces ESC dismissal. Obsidian's Menu is supposed to close
        // on ESC, but in QA the popover stayed open — the textarea kept
        // focus, so the keypress never reached the menu. Routing the ESC
        // listener through the document with capture=true catches it before
        // any input handler can swallow it.
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.preventDefault();
                menu.hide();
            }
        };
        document.addEventListener("keydown", onKey, true);
        menu.onHide(() => document.removeEventListener("keydown", onKey, true));
        menu.showAtMouseEvent(event);
    }

    private openNativeFilePicker(directory: boolean): void {
        const properties = directory ? ["openDirectory"] : ["openFile", "multiSelections"];
        electronDialog
            .showOpenDialog({ properties })
            .then((result) => {
                if (result.canceled || result.filePaths.length === 0) return;
                void this.plugin.addExternalFiles(result.filePaths);
            })
            .catch(() => {
                new Notice(MESSAGES.ERROR_FILE_PICKER);
            });
    }

    private enqueueAddFile(file: TFile): void {
        void this.plugin.addToLilbee(file);
    }

    private showEmptyState(): void {
        if (this.emptyStateEl || !this.messagesEl) return;
        this.emptyStateEl = this.messagesEl.createDiv({ cls: "lilbee-chat-empty-state" });
        this.emptyStateEl.createDiv({ cls: "lilbee-chat-empty-icon", text: "🔬" });
        this.emptyStateEl.createDiv({ cls: "lilbee-chat-empty-heading", text: MESSAGES.NOTICE_NO_MODELS_INSTALLED });
        this.emptyStateEl.createEl("p", { text: MESSAGES.NOTICE_NO_MODELS_DESCRIPTION });
        const btn = this.emptyStateEl.createEl("button", { text: MESSAGES.BUTTON_BROWSE_CATALOG, cls: "mod-cta" });
        btn.addEventListener("click", () => {
            new CatalogModal(this.app, this.plugin).open();
        });
    }

    private hideEmptyState(): void {
        if (this.emptyStateEl) {
            this.emptyStateEl.remove();
            this.emptyStateEl = null;
        }
    }

    private async saveToVault(): Promise<void> {
        if (this.history.length === 0) {
            new Notice(MESSAGES.NOTICE_NOTHING_SAVE);
            return;
        }
        const now = new Date();
        const pad = (n: number) => String(n).padStart(2, "0");
        const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
        const filename = `chat-${stamp}.md`;
        const folder = "lilbee";
        const path = `${folder}/${filename}`;

        const lines = [`# ${MESSAGES.LABEL_CHAT_VIEW} — ${now.toLocaleDateString()}`, ""];
        for (const msg of this.history) {
            const label = msg.role === "user" ? "User" : "Assistant";
            lines.push(`**${label}**: ${msg.content}`, "");
        }
        const content = lines.join("\n");

        try {
            const vault = this.app.vault;
            const existing = vault.getAbstractFileByPath(folder);
            if (!existing) {
                await vault.createFolder(folder);
            }
            await vault.create(path, content);
            new Notice(MESSAGES.NOTICE_SAVED(path));
        } catch {
            new Notice(MESSAGES.ERROR_SAVE_CHAT);
        }
    }

    private renderSources(container: HTMLElement, sources: Source[]): void {
        const sourcesEl = container.createDiv({ cls: "lilbee-chat-sources" });
        const details = sourcesEl.createEl("details");
        details.createEl("summary", { text: MESSAGES.LABEL_SOURCES });
        const chipsEl = details.createDiv({ cls: "lilbee-chat-source-chips" });
        renderAggregatedSourceChips(chipsEl, sources, this.app, this.plugin.api);
    }

    private renderBannerIfPresent(data: unknown, assistantBubble: HTMLElement): void {
        const banner = extractBanner(data);
        if (banner === null || !this.messagesEl) return;
        const bannerEl = this.messagesEl.createDiv({ cls: "lilbee-chat-banner" });
        bannerEl.setText(banner);
        this.messagesEl.insertBefore(bannerEl, assistantBubble);
    }
}

export class VaultFilePickerModal extends FuzzySuggestModal<TFile> {
    private onChoose: (file: TFile) => void;

    constructor(app: import("obsidian").App, onChoose: (file: TFile) => void) {
        super(app);
        this.onChoose = onChoose;
        this.setPlaceholder(MESSAGES.PLACEHOLDER_PICK_VAULT_FILE);
    }

    getItems(): TFile[] {
        return this.app.vault.getFiles();
    }

    getItemText(item: TFile): string {
        return item.path;
    }

    onChooseItem(item: TFile): void {
        this.onChoose(item);
    }
}
