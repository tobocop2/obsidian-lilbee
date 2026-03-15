import { FuzzySuggestModal, ItemView, MarkdownRenderer, Menu, Notice, setIcon, type TFile, WorkspaceLeaf } from "obsidian";
import type LilbeePlugin from "../main";
import { SSE_EVENT } from "../types";
import type { GenerationOptions, Message, ModelCatalog, OllamaPullProgress, Source, SSEEvent } from "../types";
import { renderSourceChip } from "./results";
import { buildModelOptions, SEPARATOR_KEY } from "../settings";

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

interface ProgressInfo {
    label: string;
    current: number;
    total: number;
}

const PROGRESS_EXTRACTORS: Record<string, (data: any) => ProgressInfo> = {
    [SSE_EVENT.FILE_START]: (d) => ({
        label: `Indexing ${d.current_file}/${d.total_files} — ${d.file}`,
        current: d.current_file,
        total: d.total_files,
    }),
    [SSE_EVENT.EXTRACT]: (d) => ({
        label: `Extracting ${d.file} (page ${d.page}/${d.total_pages})`,
        current: d.page,
        total: d.total_pages,
    }),
    [SSE_EVENT.EMBED]: (d) => ({
        label: `Embedding ${d.file} (${d.chunk}/${d.total_chunks} chunks)`,
        current: d.chunk,
        total: d.total_chunks,
    }),
    [SSE_EVENT.PROGRESS]: (d) => ({
        label: `Indexing ${d.current}/${d.total} — ${d.file}`,
        current: d.current,
        total: d.total,
    }),
    [SSE_EVENT.PULL]: (d) => ({
        label: `Pulling ${d.model} — ${Math.round((d.current / d.total) * 100)}%`,
        current: d.current,
        total: d.total,
    }),
};

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
    private progressCancelBtn: HTMLElement | null = null;
    private progressBanner: HTMLElement | null = null;
    private progressLabel: HTMLElement | null = null;
    private progressBar: HTMLElement | null = null;
    private chatCatalog: ModelCatalog | null = null;
    private visionCatalog: ModelCatalog | null = null;
    private chatSelectEl: HTMLSelectElement | null = null;
    private visionSelectEl: HTMLSelectElement | null = null;

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
        this.createProgressBanner(container);
        this.messagesEl = container.createDiv({ cls: "lilbee-chat-messages" });
        this.createInputArea(container);

        this.plugin.onProgress = (event) => this.handleProgress(event);
    }

    async onClose(): Promise<void> {
        this.streamController?.abort();
        this.pullController?.abort();
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

    private createProgressBanner(container: HTMLElement): void {
        this.progressBanner = container.createDiv({ cls: "lilbee-progress-banner" });
        this.progressBanner.style.display = "none";
        const row = this.progressBanner.createDiv({ cls: "lilbee-progress-row" });
        this.progressLabel = row.createDiv({ cls: "lilbee-progress-label" });
        this.progressCancelBtn = row.createEl("button", { cls: "lilbee-progress-cancel" });
        setIcon(this.progressCancelBtn, "x");
        this.progressCancelBtn.setAttribute("aria-label", "Cancel");
        this.progressCancelBtn.style.display = "none";
        this.progressCancelBtn.addEventListener("click", () => this.pullController?.abort());
        const barContainer = this.progressBanner.createDiv({ cls: "lilbee-progress-bar-container" });
        this.progressBar = barContainer.createDiv({ cls: "lilbee-progress-bar" });
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
            this.chatCatalog = models.chat;
            this.visionCatalog = models.vision;
            if (this.chatSelectEl) this.fillSelectOptions(this.chatSelectEl, models.chat, "chat");
            if (this.visionSelectEl) this.fillSelectOptions(this.visionSelectEl, models.vision, "vision");
        }).catch(() => {
            if (this.chatSelectEl) this.chatSelectEl.createEl("option", { text: "(offline)" });
            if (this.visionSelectEl) this.visionSelectEl.createEl("option", { text: "(offline)" });
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
                this.autoPullAndSetChat(uninstalled);
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
                this.autoPullAndSetVision(uninstalled);
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

    private autoPullAndSetChat(model: { name: string }): void {
        this.autoPullAndSet(model, "chat");
    }

    private autoPullAndSetVision(model: { name: string }): void {
        this.autoPullAndSet(model, "vision");
    }

    private autoPullAndSet(model: { name: string }, type: "chat" | "vision"): void {
        new Notice(`Pulling ${model.name}...`);
        this.pullController = new AbortController();
        if (this.progressCancelBtn) this.progressCancelBtn.style.display = "";
        (async () => {
            try {
                for await (const progress of this.plugin.ollama.pull(
                    model.name,
                    this.pullController!.signal,
                )) {
                    if (progress.total && progress.completed !== undefined) {
                        const pct = Math.round((progress.completed / progress.total) * 100);
                        this.showProgress(
                            `Pulling ${model.name} — ${pct}%`,
                            progress.completed,
                            progress.total,
                        );
                    }
                }
                this.hideProgress();
                if (type === "chat") {
                    await this.plugin.api.setChatModel(model.name);
                    this.plugin.activeModel = model.name;
                } else {
                    await this.plugin.api.setVisionModel(model.name);
                    this.plugin.activeVisionModel = model.name;
                }
                this.plugin.fetchActiveModel();
                new Notice(`Model ${model.name} pulled and activated`);
                this.refreshModelSelector();
            } catch (err) {
                if (err instanceof Error && err.name === "AbortError") {
                    new Notice("Pull cancelled");
                } else {
                    new Notice(`Failed to pull ${model.name}`);
                }
                this.hideProgress();
            } finally {
                this.pullController = null;
                if (this.progressCancelBtn) this.progressCancelBtn.style.display = "none";
            }
        })();
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
                revealContent();
                textEl.textContent = "Server unavailable — retries exhausted. Is lilbee running?";
                textEl.addClass("lilbee-chat-error");
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
                revealContent();
                textEl.textContent = errMsg;
                textEl.addClass("lilbee-chat-error");
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
                    new VaultFilePickerModal(this.app, this.plugin).open();
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
            void this.plugin.addExternalFiles(result.filePaths);
        }).catch(() => {
            new Notice("lilbee: could not open file picker");
        });
    }

    handleProgress(event: SSEEvent): void {
        if (event.event === SSE_EVENT.DONE) {
            this.hideProgress();
            return;
        }

        const extractor = PROGRESS_EXTRACTORS[event.event];
        if (!extractor) return;

        const info = extractor(event.data);
        this.showProgress(info.label, info.current, info.total);
    }

    showProgress(label: string, current: number, total: number): void {
        if (!this.progressBanner || !this.progressLabel || !this.progressBar) return;
        this.progressBanner.style.display = "";
        this.progressLabel.textContent = label;
        this.progressBar.style.width = `${Math.round((current / total) * 100)}%`;
    }

    hideProgress(): void {
        if (!this.progressBanner || !this.progressBar) return;
        this.progressBanner.style.display = "none";
        this.progressBar.style.width = "0%";
        if (this.progressCancelBtn) this.progressCancelBtn.style.display = "none";
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
    private plugin: LilbeePlugin;

    constructor(app: import("obsidian").App, plugin: LilbeePlugin) {
        super(app);
        this.plugin = plugin;
        this.setPlaceholder("Pick a vault file to add to lilbee...");
    }

    getItems(): TFile[] {
        return this.app.vault.getFiles();
    }

    getItemText(item: TFile): string {
        return item.path;
    }

    onChooseItem(item: TFile): void {
        void this.plugin.addToLilbee(item);
    }
}
