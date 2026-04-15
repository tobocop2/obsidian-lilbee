import { FuzzySuggestModal, ItemView, MarkdownRenderer, Menu, Notice, setIcon, type TFile, WorkspaceLeaf } from "obsidian";
import type LilbeePlugin from "../main";
import { MODEL_TYPE, NOTICE, SEARCH_CHUNK_TYPE, SSE_EVENT } from "../types";
import type { GenerationOptions, Message, ModelCatalog, ModelType, OllamaPullProgress, SearchChunkType, Source, SSEEvent } from "../types";
import { PullQueue } from "../pull-queue";
import { renderSourceChip } from "./results";
import { buildModelOptions, SEPARATOR_KEY } from "../settings";
import { ConfirmPullModal } from "./confirm-pull-modal";

interface OpenDialogResult {
    canceled: boolean;
    filePaths: string[];
}

/** Thin wrapper around Electron's dialog — exported for test stubbing. */
export const electronDialog = {
    /* v8 ignore start -- requires Electron runtime */
    showOpenDialog(opts: Record<string, unknown>): Promise<OpenDialogResult> {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const electron = require("electron") as {
            remote: { dialog: { showOpenDialog(o: Record<string, unknown>): Promise<OpenDialogResult> } };
        };
        return electron.remote.dialog.showOpenDialog(opts);
    },
    /* v8 ignore stop */
};

export const VIEW_TYPE_CHAT = "lilbee-chat";

export interface ProgressState {
    fileIndex: number;
    fileTotal: number;
    fileName: string;
    subLabel: string;
    subCurrent: number;
    subTotal: number;
}

export interface ProgressRefs {
    banner: HTMLElement;
    topLabel: HTMLElement;
    bar: HTMLElement;
    cancelBtn: HTMLElement;
    subLabel: HTMLElement | null;
}

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
    private pullQueue = new PullQueue();
    private addQueue = new PullQueue();
    private fileProgress: ProgressRefs | null = null;
    private pullProgress: ProgressRefs | null = null;
    private chatCatalog: ModelCatalog | null = null;
    private visionCatalog: ModelCatalog | null = null;
    private chatSelectEl: HTMLSelectElement | null = null;
    private visionSelectEl: HTMLSelectElement | null = null;
    private static readonly OFFLINE_THRESHOLD = 3;
    private retryTimer: ReturnType<typeof setTimeout> | null = null;
    private retryCount = 0;

    constructor(leaf: WorkspaceLeaf, plugin: LilbeePlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return VIEW_TYPE_CHAT;
    }

    getDisplayText(): string {
        return "lilbee Chat";
    }

    getIcon(): string {
        return "message-circle";
    }

    async onOpen(): Promise<void> {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass("lilbee-chat-container");

        this.createToolbar(container);
        this.fileProgress = this.createBanner(container, "lilbee-progress-banner", true, () => {
            this.plugin.cancelSync();
        });
        this.pullProgress = this.createBanner(container, "lilbee-progress-banner-pull", false, () => {
            this.pullController?.abort();
        });
        this.messagesEl = container.createDiv({ cls: "lilbee-chat-messages" });
        this.createInputArea(container);

        this.plugin.onProgress = (event) => this.handleProgress(event);
    }

    async onClose(): Promise<void> {
        this.streamController?.abort();
        this.pullController?.abort();
        if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
        this.retryCount = 0;
        if (this.plugin.onProgress) {
            this.plugin.onProgress = null;
        }
    }

    private createToolbar(container: HTMLElement): void {
        const toolbar = container.createDiv({ cls: "lilbee-chat-toolbar" });

        const chatGroup = toolbar.createDiv({ cls: "lilbee-toolbar-group" });
        const chatIcon = chatGroup.createDiv({ cls: "lilbee-toolbar-icon" });
        setIcon(chatIcon, "message-circle");
        chatIcon.setAttribute("title", "Chat model");

        this.chatSelectEl = chatGroup.createEl("select", {
            cls: "lilbee-chat-model-select",
        }) as HTMLSelectElement;
        this.attachChatListener(this.chatSelectEl);

        const visionGroup = toolbar.createDiv({ cls: "lilbee-toolbar-group" });
        const visionIcon = visionGroup.createDiv({ cls: "lilbee-toolbar-icon" });
        setIcon(visionIcon, "eye");
        visionIcon.setAttribute("title", "Vision model");

        this.visionSelectEl = visionGroup.createEl("select", {
            cls: "lilbee-chat-vision-select",
        }) as HTMLSelectElement;
        this.attachVisionListener(this.visionSelectEl);

        this.fetchAndFillSelectors();

        this.renderSearchModeToggle(toolbar);

        toolbar.createDiv({ cls: "lilbee-toolbar-spacer" });

        const saveBtn = toolbar.createEl("button", { cls: "lilbee-chat-save" });
        setIcon(saveBtn, "save");
        saveBtn.setAttribute("aria-label", "Save to vault");
        saveBtn.addEventListener("click", () => this.saveToVault());

        const clearBtn = toolbar.createEl("button", {
            text: "Clear chat",
            cls: "lilbee-chat-clear",
        });
        clearBtn.addEventListener("click", () => this.clearChat());
    }

    private renderSearchModeToggle(container: HTMLElement): void {
        if (!this.plugin.settings.wikiEnabled
            && this.plugin.settings.searchChunkType === SEARCH_CHUNK_TYPE.WIKI) {
            this.plugin.settings.searchChunkType = SEARCH_CHUNK_TYPE.ALL;
        }
        const group = container.createDiv({ cls: "lilbee-search-mode-toggle" });
        const modes: SearchChunkType[] = this.plugin.settings.wikiEnabled
            ? [SEARCH_CHUNK_TYPE.ALL, SEARCH_CHUNK_TYPE.RAW, SEARCH_CHUNK_TYPE.WIKI]
            : [SEARCH_CHUNK_TYPE.ALL, SEARCH_CHUNK_TYPE.RAW];
        const buttons: HTMLElement[] = [];
        for (const mode of modes) {
            const btn = group.createEl("button", {
                text: mode,
                cls: "lilbee-search-mode-btn",
            });
            if (mode === this.plugin.settings.searchChunkType) {
                btn.addClass("is-active");
            }
            btn.addEventListener("click", () => {
                this.plugin.settings.searchChunkType = mode;
                for (const b of buttons) b.removeClass("is-active");
                btn.addClass("is-active");
            });
            buttons.push(btn);
        }
    }

    private createBanner(
        container: HTMLElement,
        className: string,
        withSubLabel: boolean,
        onCancel: () => void,
    ): ProgressRefs {
        const banner = container.createDiv({ cls: className });
        banner.dataset.hidden = "";
        const row = banner.createDiv({ cls: "lilbee-progress-row" });
        const topLabel = row.createDiv({ cls: "lilbee-progress-top-label" });
        const cancelBtn = row.createEl("button", { cls: "lilbee-progress-cancel" });
        setIcon(cancelBtn, "x");
        cancelBtn.setAttribute("aria-label", "Cancel");
        cancelBtn.addEventListener("click", onCancel);
        const barContainer = banner.createDiv({ cls: "lilbee-progress-bar-container" });
        const bar = barContainer.createDiv({ cls: "lilbee-progress-bar" });
        const subLabel = withSubLabel
            ? banner.createDiv({ cls: "lilbee-progress-sub-label" })
            : null;
        return { banner, topLabel, bar, cancelBtn, subLabel };
    }

    private createInputArea(container: HTMLElement): void {
        const inputArea = container.createDiv({ cls: "lilbee-chat-input" });

        const addBtn = inputArea.createEl("button", { cls: "lilbee-chat-add-file" });
        addBtn.setAttribute("aria-label", "Add file");
        setIcon(addBtn, "paperclip");
        addBtn.addEventListener("click", (e) => this.openFilePicker(e));

        const textarea = inputArea.createEl("textarea", {
            placeholder: "Ask something...",
            cls: "lilbee-chat-textarea",
        });
        this.sendBtn = inputArea.createEl("button", {
            text: "Send",
            cls: "lilbee-chat-send",
        }) as HTMLButtonElement;

        const handleSend = (): void => {
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
        this.plugin.api.listModels().then((models) => {
            if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
            this.retryCount = 0;
            if (this.chatSelectEl) this.chatSelectEl.empty();
            if (this.visionSelectEl) this.visionSelectEl.empty();
            this.chatCatalog = models.chat;
            this.visionCatalog = models.vision;
            if (this.chatSelectEl) this.fillSelectOptions(this.chatSelectEl, models.chat, "chat");
            if (this.visionSelectEl) this.fillSelectOptions(this.visionSelectEl, models.vision, "vision");
            // Ollama not running — retry until models appear
            if (models.chat.installed.length === 0 && models.vision.installed.length === 0) {
                this.retryTimer = setTimeout(() => this.fetchAndFillSelectors(), 5000);
            }
        }).catch(() => {
            this.retryCount++;
            const connecting = this.retryCount < ChatView.OFFLINE_THRESHOLD;
            const label = connecting ? "(connecting...)" : "(offline)";
            if (this.chatSelectEl) { this.chatSelectEl.empty(); this.chatSelectEl.createEl("option", { text: label }); }
            if (this.visionSelectEl) { this.visionSelectEl.empty(); this.visionSelectEl.createEl("option", { text: label }); }
            if (this.retryCount === ChatView.OFFLINE_THRESHOLD) {
                new Notice("lilbee: could not reach server — is Ollama running?");
            }
            this.retryTimer = setTimeout(() => this.fetchAndFillSelectors(), 5000);
        });
    }

    private fillSelectOptions(selectEl: HTMLSelectElement, catalog: ModelCatalog, type: "chat" | "vision"): void {
        const options = buildModelOptions(catalog, type);
        for (const [value, label] of Object.entries(options)) {
            const option = selectEl.createEl("option", { text: label });
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
            const uninstalled = this.chatCatalog?.catalog.find(
                (m) => m.name === el.value && !m.installed,
            );
            if (uninstalled) {
                const modal = new ConfirmPullModal(this.plugin.app, uninstalled);
                modal.open();
                void modal.result.then((confirmed) => {
                    if (confirmed) {
                        void this.pullQueue.enqueue(() => this.autoPullAndSet(uninstalled, MODEL_TYPE.CHAT), uninstalled.name);
                    }
                });
                return;
            }
            this.plugin.api.setChatModel(el.value).then(() => {
                this.plugin.activeModel = el.value;
                this.plugin.fetchActiveModel();
            }).catch(() => {
                new Notice("lilbee: failed to switch model");
            });
        });
    }

    private attachVisionListener(el: HTMLSelectElement): void {
        el.addEventListener("change", () => {
            if (el.value === SEPARATOR_KEY) return;
            const uninstalled = this.visionCatalog?.catalog.find(
                (m) => m.name === el.value && !m.installed,
            );
            if (uninstalled) {
                const modal = new ConfirmPullModal(this.plugin.app, uninstalled);
                modal.open();
                void modal.result.then((confirmed) => {
                    if (confirmed) {
                        void this.pullQueue.enqueue(() => this.autoPullAndSet(uninstalled, MODEL_TYPE.VISION), uninstalled.name);
                    }
                });
                return;
            }
            this.plugin.api.setVisionModel(el.value).then(() => {
                this.plugin.activeVisionModel = el.value;
                this.plugin.fetchActiveModel();
            }).catch(() => {
                new Notice("lilbee: failed to switch vision model");
            });
        });
    }

    private async autoPullAndSet(model: { name: string }, type: ModelType): Promise<void> {
        new Notice(`lilbee: pulling ${model.name}...`);
        this.pullController = new AbortController();
        try {
            for await (const progress of this.plugin.ollama.pull(
                model.name,
                this.pullController.signal,
            )) {
                if (progress.total && progress.completed !== undefined) {
                    const pct = Math.round((progress.completed / progress.total) * 100);
                    this.showPullProgress(
                        `Pulling ${model.name} — ${pct}%`,
                        progress.completed,
                        progress.total,
                    );
                }
            }
            this.hidePullProgress();
            if (type === MODEL_TYPE.CHAT) {
                await this.plugin.api.setChatModel(model.name);
                this.plugin.activeModel = model.name;
            } else {
                await this.plugin.api.setVisionModel(model.name);
                this.plugin.activeVisionModel = model.name;
            }
            this.plugin.fetchActiveModel();
            new Notice(`lilbee: ${model.name} pulled and activated`);
            this.refreshModelSelector();
        } catch (err) {
            if (err instanceof Error && err.name === "AbortError") {
                new Notice(NOTICE.PULL_CANCELLED);
            } else {
                new Notice(`lilbee: failed to pull ${model.name}`);
            }
            this.hidePullProgress();
        } finally {
            this.pullController = null;
        }
    }

    private refreshModelSelector(): void {
        if (this.chatSelectEl) this.chatSelectEl.empty();
        if (this.visionSelectEl) this.visionSelectEl.empty();
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
        if (this.sendBtn) this.sendBtn.textContent = "Stop";

        const userBubble = this.messagesEl.createDiv({ cls: "lilbee-chat-message user" });
        userBubble.createEl("p", { text });
        this.history.push({ role: "user", content: text });

        const assistantBubble = this.messagesEl.createDiv({ cls: "lilbee-chat-message assistant" });
        const spinner = assistantBubble.createDiv({ cls: "lilbee-loading" });
        spinner.textContent = "Thinking...";
        const textEl = assistantBubble.createDiv({ cls: "lilbee-chat-content" });
        textEl.style.display = "none";
        this.messagesEl.scrollTop = this.messagesEl.scrollHeight;

        const state = { fullContent: "", sources: [] as Source[], renderPending: false };

        const revealContent = (): void => {
            if (spinner.parentElement) spinner.remove();
            textEl.style.display = "";
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
            if (err instanceof Error && err.name === "AbortError") {
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
                new Notice("lilbee: could not reach server — is lilbee running?");
            }
        } finally {
            this.sending = false;
            this.streamController = null;
            if (this.sendBtn) {
                this.sendBtn.textContent = "Send";
            }
        }
    }

    private handleStreamEvent(
        event: SSEEvent,
        textEl: HTMLElement,
        assistantBubble: HTMLElement,
        state: { fullContent: string; sources: Source[] },
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
            case SSE_EVENT.SOURCES:
                state.sources.push(...(event.data as Source[]));
                break;
            case SSE_EVENT.DONE: {
                revealContent();
                void this.renderMarkdown(textEl, state.fullContent);
                if (state.sources.length > 0) this.renderSources(assistantBubble, state.sources);
                this.history.push({ role: "assistant", content: state.fullContent });
                break;
            }
            case SSE_EVENT.ERROR: {
                const errMsg = extractString(event.data, "message");
                assistantBubble.remove();
                new Notice(`lilbee: ${errMsg}`);
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
            item.setTitle("From vault")
                .setIcon("vault")
                .onClick(() => {
                    new VaultFilePickerModal(this.app, (file) => this.enqueueAddFile(file)).open();
                });
        });
        menu.addItem((item) => {
            item.setTitle("Files from disk")
                .setIcon("file-plus")
                .onClick(() => this.openNativeFilePicker(false));
        });
        menu.addItem((item) => {
            item.setTitle("Folder from disk")
                .setIcon("folder-plus")
                .onClick(() => this.openNativeFilePicker(true));
        });
        menu.showAtMouseEvent(event);
    }

    private openNativeFilePicker(directory: boolean): void {
        const properties = directory
            ? ["openDirectory"]
            : ["openFile", "multiSelections"];
        electronDialog.showOpenDialog({ properties }).then((result) => {
            if (result.canceled || result.filePaths.length === 0) return;
            const label = result.filePaths.length === 1
                ? result.filePaths[0].split("/").pop()!
                : `${result.filePaths.length} files`;
            void this.addQueue.enqueue(
                () => this.plugin.addExternalFiles(result.filePaths),
                label,
            );
        }).catch(() => {
            new Notice("lilbee: could not open file picker");
        });
    }

    private enqueueAddFile(file: TFile): void {
        void this.addQueue.enqueue(
            () => this.plugin.addToLilbee(file),
            file.name,
        );
    }

    handleProgress(event: SSEEvent): void {
        const data = event.data as Record<string, unknown>;

        switch (event.event) {
            case SSE_EVENT.FILE_START: {
                const fileIndex = Number(data.current_file ?? 0);
                const fileTotal = Number(data.total_files ?? 0);
                this.showFileProgress(`Syncing ${fileIndex}/${fileTotal} files`, fileIndex, fileTotal, "");
                break;
            }
            case SSE_EVENT.EXTRACT: {
                const page = Number(data.page ?? 0);
                const totalPages = Number(data.total_pages ?? 0);
                this.updateSubLabel(`Extracting page ${page}/${totalPages} — ${data.file ?? ""}`);
                break;
            }
            case SSE_EVENT.EMBED: {
                const chunk = Number(data.chunk ?? 0);
                const totalChunks = Number(data.total_chunks ?? 0);
                this.updateSubLabel(`Embedding chunk ${chunk}/${totalChunks} — ${data.file ?? ""}`);
                break;
            }
            case SSE_EVENT.PROGRESS: {
                const current = Number(data.current ?? 0);
                const total = Number(data.total ?? 0);
                this.showFileProgress(`Indexing ${current}/${total} — ${data.file ?? ""}`, current, total, "");
                break;
            }
            case SSE_EVENT.PULL: {
                const current = Number(data.current ?? 0);
                const total = Number(data.total ?? 0);
                const pct = total > 0 ? Math.round((current / total) * 100) : 0;
                this.showPullProgress(`Pulling model — ${pct}%`, current, total);
                break;
            }
            case SSE_EVENT.DONE:
                this.hideProgress();
                break;
        }
    }

    private showFileProgress(topLabel: string, current: number, total: number, subLabel: string): void {
        if (!this.fileProgress) return;
        delete this.fileProgress.banner.dataset.hidden;
        this.fileProgress.topLabel.textContent = topLabel;
        this.fileProgress.bar.style.width = total > 0 ? `${Math.round((current / total) * 100)}%` : "0%";
        if (this.fileProgress.subLabel) this.fileProgress.subLabel.textContent = subLabel;
    }

    private showPullProgress(label: string, current: number, total: number): void {
        if (!this.pullProgress) return;
        delete this.pullProgress.banner.dataset.hidden;
        this.pullProgress.topLabel.textContent = label;
        this.pullProgress.bar.style.width = total > 0 ? `${Math.round((current / total) * 100)}%` : "0%";
    }

    private updateSubLabel(text: string): void {
        if (!this.fileProgress?.subLabel) return;
        this.fileProgress.subLabel.textContent = text;
    }

    hideProgress(): void {
        if (!this.fileProgress) return;
        this.fileProgress.banner.dataset.hidden = "";
        this.fileProgress.bar.style.width = "0%";
        this.fileProgress.topLabel.textContent = "";
        if (this.fileProgress.subLabel) this.fileProgress.subLabel.textContent = "";
    }

    private hidePullProgress(): void {
        if (!this.pullProgress) return;
        this.pullProgress.banner.dataset.hidden = "";
        this.pullProgress.bar.style.width = "0%";
        this.pullProgress.topLabel.textContent = "";
    }

    private async saveToVault(): Promise<void> {
        if (this.history.length === 0) {
            new Notice("Nothing to save");
            return;
        }
        const now = new Date();
        const pad = (n: number) => String(n).padStart(2, "0");
        const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
        const filename = `chat-${stamp}.md`;
        const folder = "lilbee";
        const path = `${folder}/${filename}`;

        const lines = [`# lilbee Chat — ${now.toLocaleDateString()}`, ""];
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
            new Notice(`Saved to ${path}`);
        } catch {
            new Notice("Failed to save chat");
        }
    }

    private renderSources(container: HTMLElement, sources: Source[]): void {
        const sourcesEl = container.createDiv({ cls: "lilbee-chat-sources" });
        const details = sourcesEl.createEl("details");
        details.createEl("summary", { text: "Sources" });
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
        this.setPlaceholder("Pick a vault file to add to lilbee...");
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
