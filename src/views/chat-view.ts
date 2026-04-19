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
import { SSE_EVENT, TASK_TYPE, ERROR_NAME, MODEL_SOURCE } from "../types";
import type {
    CatalogEntry,
    GenerationOptions,
    Message,
    ModelCatalog,
    SearchChunkType,
    Source,
    SSEEvent,
} from "../types";

import { renderSourceChip } from "./results";
import { buildModelOptions, SEPARATOR_KEY } from "../settings";
import { ConfirmPullModal } from "./confirm-pull-modal";
import { ConfirmModal } from "./confirm-modal";
import { CatalogModal } from "./catalog-modal";
import { CrawlModal } from "./crawl-modal";
import { MESSAGES } from "../locales/en";
import { RETRY_INTERVAL_MS, SPINNER_MIN_DISPLAY_MS } from "../utils";

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

export function buildGenerationOptions(settings: {
    temperature: number | null;
    top_p: number | null;
    top_k_sampling: number | null;
    repeat_penalty: number | null;
    num_ctx: number | null;
    seed: number | null;
}): GenerationOptions {
    const opts: GenerationOptions = {};
    if (settings.temperature != null) opts.temperature = settings.temperature;
    if (settings.top_p != null) opts.top_p = settings.top_p;
    if (settings.top_k_sampling != null) opts.top_k = settings.top_k_sampling;
    if (settings.repeat_penalty != null) opts.repeat_penalty = settings.repeat_penalty;
    if (settings.num_ctx != null) opts.num_ctx = settings.num_ctx;
    if (settings.seed != null) opts.seed = settings.seed;
    return opts;
}

function extractString(data: unknown, field: string): string {
    if (typeof data === "object" && data !== null && field in data) {
        return String((data as Record<string, unknown>)[field]);
    }
    return String(data);
}

export class ChatView extends ItemView {
    private plugin: LilbeePlugin;
    private history: Message[] = [];
    private messagesEl: HTMLElement | null = null;
    private sendBtn: HTMLButtonElement | null = null;
    private sending = false;
    private streamController: AbortController | null = null;
    private pullController: AbortController | null = null;
    private chatCatalog: ModelCatalog | null = null;
    private chatSelectEl: HTMLSelectElement | null = null;
    private embeddingSelectEl: HTMLSelectElement | null = null;
    private embeddingModels: CatalogEntry[] = [];
    private activeEmbeddingModel = "";
    private ocrToggleEl: HTMLElement | null = null;
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

        const chatGroup = toolbar.createDiv({ cls: "lilbee-toolbar-group" });
        const chatIcon = chatGroup.createDiv({ cls: "lilbee-toolbar-icon" });
        setIcon(chatIcon, "message-circle");
        chatIcon.setAttribute("title", MESSAGES.LABEL_CHAT_MODEL_ICON);

        this.chatSelectEl = chatGroup.createEl("select", {
            cls: "lilbee-chat-model-select",
        }) as HTMLSelectElement;
        this.attachChatListener(this.chatSelectEl);

        const embedGroup = toolbar.createDiv({ cls: "lilbee-toolbar-group lilbee-toolbar-group-embed" });
        const embedIcon = embedGroup.createDiv({ cls: "lilbee-toolbar-icon" });
        setIcon(embedIcon, "database");
        embedIcon.setAttribute("title", MESSAGES.LABEL_EMBEDDING_MODEL_ICON);

        this.embeddingSelectEl = embedGroup.createEl("select", {
            cls: "lilbee-embed-model-select",
        }) as HTMLSelectElement;
        this.attachEmbeddingListener(this.embeddingSelectEl);

        this.ocrToggleEl = toolbar.createDiv({ cls: "lilbee-ocr-toggle" });
        this.updateOcrToggle();
        this.ocrToggleEl.addEventListener("click", () => this.cycleOcr());

        this.fetchAndFillSelectors();

        // Search mode toggle
        const wikiEnabled = this.plugin.settings.wikiEnabled;
        if (!wikiEnabled && this.plugin.settings.searchChunkType === "wiki") {
            this.plugin.settings.searchChunkType = "all";
        }
        const modeGroup = toolbar.createDiv({ cls: "lilbee-search-mode" });
        const modes: { value: SearchChunkType; label: string }[] = [
            { value: "all", label: MESSAGES.LABEL_SEARCH_ALL },
            ...(wikiEnabled ? [{ value: "wiki" as SearchChunkType, label: MESSAGES.LABEL_SEARCH_WIKI }] : []),
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

        toolbar.createDiv({ cls: "lilbee-toolbar-spacer" });

        const saveBtn = toolbar.createEl("button", { cls: "lilbee-chat-save" });
        setIcon(saveBtn, "save");
        saveBtn.setAttribute("aria-label", MESSAGES.LABEL_SAVE_VAULT);
        saveBtn.addEventListener("click", () => this.saveToVault());

        const clearBtn = toolbar.createEl("button", {
            text: MESSAGES.BUTTON_CLEAR_CHAT,
            cls: "lilbee-chat-clear",
        });
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
        });
        this.sendBtn = inputArea.createEl("button", {
            text: MESSAGES.BUTTON_SEND,
            cls: "lilbee-chat-send",
        }) as HTMLButtonElement;

        const handleSend = (): void => {
            if (this.sending) return;
            const text = textarea.value.trim();
            if (!text) return;
            textarea.value = "";
            void this.sendMessage(text);
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
            this.plugin.api.listModels(),
            this.plugin.api.installedModels().catch(() => ({ models: [] })),
            this.plugin.api.catalog({ task: "embedding" }).catch(() => null),
            this.plugin.api.config().catch(() => null),
        ])
            .then(([models, installed, embeddingResult, serverConfig]) => {
                if (this.retryTimer) {
                    clearTimeout(this.retryTimer);
                    this.retryTimer = null;
                }
                this.retryCount = 0;
                if (this.chatSelectEl) this.chatSelectEl.empty();
                this.chatCatalog = models.chat;
                const sourceMap = new Map(installed.models.map((m) => [m.name, m.source]));
                if (this.chatSelectEl) this.fillSelectOptions(this.chatSelectEl, models.chat, sourceMap);

                this.fillEmbeddingSelector(embeddingResult, serverConfig);

                // No models installed — show empty state with catalog button
                if (models.chat.installed.length === 0) {
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
            const option = this.embeddingSelectEl.createEl("option", { text: model.name });
            (option as HTMLOptionElement).value = model.name;
            if (model.name === activeModel) {
                (option as HTMLOptionElement).selected = true;
            }
        }

        if (models.length === 0 && activeModel) {
            const option = this.embeddingSelectEl.createEl("option", { text: activeModel });
            (option as HTMLOptionElement).value = activeModel;
            (option as HTMLOptionElement).selected = true;
        }
    }

    private fillSelectOptions(
        selectEl: HTMLSelectElement,
        catalog: ModelCatalog,
        sourceMap: Map<string, string> = new Map(),
    ): void {
        const installedOnly: ModelCatalog = {
            ...catalog,
            catalog: catalog.catalog.filter((m) => m.installed),
        };
        const options = buildModelOptions(installedOnly);
        for (const [value, label] of Object.entries(options)) {
            const source = sourceMap.get(value) ?? "";
            const suffix = source && source !== MODEL_SOURCE.NATIVE ? ` [${source}]` : "";
            const option = selectEl.createEl("option", { text: `${label}${suffix}` });
            (option as HTMLOptionElement).value = value;
            if (value === SEPARATOR_KEY) {
                (option as HTMLOptionElement).disabled = true;
            }
            if (value === catalog.active) {
                (option as HTMLOptionElement).selected = true;
            }
        }
    }

    private attachChatListener(el: HTMLSelectElement): void {
        el.addEventListener("change", () => {
            if (!el.value || el.value === SEPARATOR_KEY) return;
            const uninstalled = this.chatCatalog?.catalog.find((m) => m.name === el.value && !m.installed);
            if (uninstalled) {
                const modal = new ConfirmPullModal(this.plugin.app, uninstalled);
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
            void modal.result.then((confirmed) => {
                if (confirmed) {
                    this.plugin.api
                        .setEmbeddingModel(el.value)
                        .then((result) => {
                            if (result.isOk()) {
                                this.activeEmbeddingModel = el.value;
                                new Notice(MESSAGES.NOTICE_EMBEDDING_UPDATED);
                                new Notice(MESSAGES.NOTICE_REINDEX_REQUIRED);
                                void this.plugin.triggerSync();
                            } else {
                                new Notice(MESSAGES.NOTICE_FAILED_EMBEDDING);
                                this.revertEmbeddingSelect(previous);
                            }
                        })
                        .catch(() => {
                            new Notice(MESSAGES.NOTICE_FAILED_EMBEDDING);
                            this.revertEmbeddingSelect(previous);
                        });
                } else {
                    this.revertEmbeddingSelect(previous);
                }
            });
        });
    }

    private revertEmbeddingSelect(previousValue: string): void {
        if (!this.embeddingSelectEl) return;
        this.embeddingSelectEl.value = previousValue;
    }

    private async autoPullAndSet(model: { name: string }): Promise<void> {
        const taskId = this.plugin.taskQueue.enqueue(`Pull ${model.name}`, TASK_TYPE.PULL);
        if (taskId === null) {
            new Notice(MESSAGES.NOTICE_QUEUE_FULL);
            return;
        }
        this.pullController = new AbortController();
        this.plugin.taskQueue.registerAbort(taskId, this.pullController);
        let pullFailed = false;
        try {
            for await (const event of this.plugin.api.pullModel(model.name, "native", this.pullController.signal)) {
                if (event.event === SSE_EVENT.PROGRESS) {
                    const d = event.data as { percent?: number; current?: number; total?: number };
                    const pct = d.percent ?? (d.total ? Math.round((d.current! / d.total) * 100) : undefined);
                    if (pct !== undefined) {
                        this.plugin.taskQueue.update(taskId, pct, model.name, {
                            current: d.current,
                            total: d.total,
                        });
                    }
                } else if (event.event === SSE_EVENT.ERROR) {
                    const d = event.data as { message?: string } | string;
                    const msg = typeof d === "string" ? d : (d.message ?? "unknown error");
                    new Notice(MESSAGES.ERROR_PULL_MODEL.replace("{model}", model.name));
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
                const reason = err instanceof Error ? err.message : "unknown error";
                new Notice(`${MESSAGES.ERROR_PULL_MODEL.replace("{model}", model.name)}: ${reason}`);
                this.plugin.taskQueue.fail(taskId, reason);
            }
            this.pullController = null;
            return;
        }
        this.pullController = null;

        if (pullFailed) return;

        this.plugin.taskQueue.complete(taskId);

        try {
            await this.plugin.api.setChatModel(model.name);
            this.plugin.activeModel = model.name;
            new Notice(MESSAGES.NOTICE_MODEL_ACTIVATED_FULL(model.name));
        } catch {
            new Notice(MESSAGES.ERROR_SET_MODEL.replace("{model}", model.name));
        }
        this.plugin.fetchActiveModel();
        this.refreshModelSelector();
    }

    private cycleOcr(): void {
        const current = this.plugin.settings.enableOcr;
        if (current === null) {
            this.plugin.settings.enableOcr = true;
        } else if (current === true) {
            this.plugin.settings.enableOcr = false;
        } else {
            this.plugin.settings.enableOcr = null;
        }
        void this.plugin.saveSettings();
        this.updateOcrToggle();
    }

    private updateOcrToggle(): void {
        if (!this.ocrToggleEl) return;
        this.ocrToggleEl.empty();
        const iconEl = this.ocrToggleEl.createDiv({ cls: "lilbee-toolbar-icon" });
        setIcon(iconEl, "eye");

        const state = this.plugin.settings.enableOcr;
        this.ocrToggleEl.classList.remove("is-auto", "is-on", "is-off");
        if (state === null) {
            this.ocrToggleEl.classList.add("is-auto");
            this.ocrToggleEl.setAttribute("title", MESSAGES.LABEL_OCR_AUTO);
        } else if (state === true) {
            this.ocrToggleEl.classList.add("is-on");
            this.ocrToggleEl.setAttribute("title", MESSAGES.LABEL_OCR_ON);
        } else {
            this.ocrToggleEl.classList.add("is-off");
            this.ocrToggleEl.setAttribute("title", MESSAGES.LABEL_OCR_OFF);
        }
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
        if (this.sendBtn) this.sendBtn.textContent = MESSAGES.BUTTON_STOP;

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

        const genOpts = buildGenerationOptions(this.plugin.settings);

        try {
            for await (const event of this.plugin.api.chatStream(
                text,
                this.history.slice(0, -1),
                this.plugin.settings.topK,
                this.streamController.signal,
                genOpts,
            )) {
                this.handleStreamEvent(event, textEl, assistantBubble, state, revealContent, scheduleRender);
            }
        } catch (err) {
            if (err instanceof Error && err.name === ERROR_NAME.ABORT_ERROR) {
                revealContent();
                if (state.fullContent) {
                    void this.renderMarkdown(textEl, state.fullContent + "\n\n*(stopped)*");
                    this.history.push({ role: "assistant", content: state.fullContent });
                } else {
                    textEl.textContent = "(stopped)";
                }
            } else {
                assistantBubble.remove();
                this.history.pop();
                new Notice(MESSAGES.ERROR_SERVER_UNREACHABLE);
            }
        } finally {
            this.sending = false;
            this.streamController = null;
            if (this.sendBtn) {
                this.sendBtn.textContent = MESSAGES.BUTTON_SEND;
            }
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
                void this.renderMarkdown(textEl, rendered);
                if (state.sources.length > 0) this.renderSources(assistantBubble, state.sources);
                this.history.push({ role: "assistant", content: rendered });
                break;
            }
            case SSE_EVENT.ERROR: {
                const errMsg = extractString(event.data, "message");
                assistantBubble.empty();
                assistantBubble.addClass("lilbee-chat-message-error");
                assistantBubble.setAttribute("role", "alert");
                assistantBubble.createDiv({
                    cls: "lilbee-chat-error-text",
                    text: MESSAGES.ERROR_STREAM(errMsg),
                });
                new Notice(MESSAGES.ERROR_STREAM(errMsg));
                break;
            }
        }
    }

    private async renderMarkdown(el: HTMLElement, markdown: string): Promise<void> {
        el.empty();
        await MarkdownRenderer.render(this.app, markdown, el, "", this.plugin);
        el.addClass("markdown-rendered");
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
        for (const source of sources) {
            renderSourceChip(chipsEl, source);
        }
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
