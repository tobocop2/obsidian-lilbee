import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import type LilbeePlugin from "../main";
import { MEMORY_CONFIG_KEY, MEMORY_KIND, type MemoryItem } from "../types";
import { MESSAGES } from "../locales/en";
import { errorMessage } from "../utils";
import { ConfirmModal } from "./confirm-modal";
import { RememberModal } from "./remember-modal";

export const VIEW_TYPE_MEMORIES = "lilbee-memories";

export class MemoriesView extends ItemView {
    private plugin: LilbeePlugin;
    private memories: MemoryItem[] | null = null;
    private filter = "";
    private listEl: HTMLElement | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: LilbeePlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return VIEW_TYPE_MEMORIES;
    }

    getDisplayText(): string {
        return MESSAGES.LABEL_MEMORIES_VIEW;
    }

    getIcon(): string {
        return "brain";
    }

    async onOpen(): Promise<void> {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("lilbee-memories-container");

        const header = contentEl.createDiv({ cls: "lilbee-memories-header" });
        header.createEl("h2", { text: MESSAGES.LABEL_MEMORIES_TITLE });
        const addBtn = header.createEl("button", { text: MESSAGES.BUTTON_ADD_MEMORY, cls: "lilbee-memories-add" });
        addBtn.addEventListener("click", () => new RememberModal(this.app, this.plugin).open());

        const searchEl = contentEl.createEl("input", { cls: "lilbee-memories-search" });
        searchEl.type = "text";
        searchEl.placeholder = MESSAGES.MEMORIES_SEARCH_PLACEHOLDER;
        searchEl.addEventListener("input", () => {
            this.filter = searchEl.value.toLowerCase();
            this.renderList();
        });

        this.listEl = contentEl.createDiv({ cls: "lilbee-memories-list" });

        await this.load();
    }

    async reload(): Promise<void> {
        await this.load();
    }

    private async load(): Promise<void> {
        try {
            const cfg = await this.plugin.api.config();
            if (cfg[MEMORY_CONFIG_KEY.ENABLED] !== true) {
                this.memories = null;
                this.renderMessage(MESSAGES.MEMORIES_DISABLED);
                return;
            }
            this.memories = await this.plugin.api.listMemories();
            this.renderList();
        } catch (err) {
            this.memories = null;
            this.renderMessage(
                MESSAGES.MEMORIES_LOAD_FAILED(
                    errorMessage(err, MESSAGES.ERROR_UNKNOWN, this.plugin.settings.serverMode),
                ),
            );
        }
    }

    private renderMessage(message: string): void {
        if (!this.listEl) return;
        this.listEl.empty();
        this.listEl.createDiv({ cls: "lilbee-memories-empty", text: message });
    }

    private renderList(): void {
        if (!this.listEl || this.memories === null) return;
        this.listEl.empty();

        const visible = this.memories.filter((m) => m.text.toLowerCase().includes(this.filter));
        if (visible.length === 0) {
            this.listEl.createDiv({ cls: "lilbee-memories-empty", text: MESSAGES.MEMORIES_EMPTY });
            return;
        }

        for (const memory of visible) {
            this.renderRow(this.listEl, memory);
        }
    }

    private renderRow(container: HTMLElement, memory: MemoryItem): void {
        const row = container.createDiv({ cls: "lilbee-memory-row" });
        row.dataset.kind = memory.kind;

        row.createSpan({
            cls: `lilbee-memory-kind lilbee-memory-kind-${memory.kind}`,
            text:
                memory.kind === MEMORY_KIND.PREFERENCE
                    ? MESSAGES.LABEL_REMEMBER_KIND_PREFERENCE
                    : MESSAGES.LABEL_REMEMBER_KIND_FACT,
        });

        row.createSpan({ cls: "lilbee-memory-text", text: memory.text });

        const shareBtn = row.createEl("button", {
            cls: "lilbee-memory-share",
            text: memory.shared ? MESSAGES.MEMORIES_FLAG_YES : MESSAGES.MEMORIES_FLAG_NO,
        });
        shareBtn.title = MESSAGES.MEMORIES_SHARE_TOOLTIP;
        shareBtn.toggleClass("is-shared", memory.shared);
        shareBtn.addEventListener("click", () => void this.toggleShared(memory));

        const deleteBtn = row.createEl("button", {
            cls: "lilbee-memory-delete",
            text: MESSAGES.LABEL_CLOSE_GLYPH,
        });
        deleteBtn.title = MESSAGES.MEMORIES_DELETE_TOOLTIP;
        deleteBtn.addEventListener("click", () => void this.confirmDelete(memory));
    }

    private async toggleShared(memory: MemoryItem): Promise<void> {
        const next = !memory.shared;
        try {
            await this.plugin.api.setMemoryShared(memory.id, next);
            new Notice(next ? MESSAGES.MEMORIES_SHARED_ON : MESSAGES.MEMORIES_SHARED_OFF);
            await this.load();
        } catch (err) {
            new Notice(
                MESSAGES.MEMORIES_FLAG_FAILED(
                    errorMessage(err, MESSAGES.ERROR_UNKNOWN, this.plugin.settings.serverMode),
                ),
            );
        }
    }

    private async confirmDelete(memory: MemoryItem): Promise<void> {
        const modal = new ConfirmModal(this.app, MESSAGES.MEMORIES_DELETE_CONFIRM);
        modal.open();
        const confirmed = await modal.result;
        if (!confirmed) return;
        try {
            await this.plugin.api.forgetMemory(memory.id);
            new Notice(MESSAGES.MEMORIES_DELETED);
            await this.load();
        } catch (err) {
            new Notice(
                MESSAGES.MEMORIES_DELETE_FAILED(
                    errorMessage(err, MESSAGES.ERROR_UNKNOWN, this.plugin.settings.serverMode),
                ),
            );
        }
    }
}
