import { App, Modal, Notice, setIcon } from "obsidian";
import type LilbeePlugin from "../main";
import { isHttpStatus } from "../api";
import type { SessionMeta } from "../types";
import { ConfirmModal } from "./confirm-modal";
import { MESSAGES } from "../locales/en";
import { bindEscapeToClose, errorMessage, relativeTimeFromIso } from "../utils";
import { displayLabelForRef } from "../utils/model-ref";

/** Hooks the chat view supplies so the modal can drive it without importing it. */
export interface SessionsModalHooks {
    /** Id of the conversation the chat view currently has open, if any. */
    activeId: string | null;
    resume: (id: string) => void;
    startNew: () => void;
}

export class SessionsModal extends Modal {
    private plugin: LilbeePlugin;
    private hooks: SessionsModalHooks;
    private sessions: SessionMeta[] = [];
    private filter = "";
    private renamingId: string | null = null;
    private loadFailed = false;
    /** True when the server said sessions are switched off; renders the turn-on offer. */
    private disabled = false;
    private listEl: HTMLElement | null = null;
    private countEl: HTMLElement | null = null;

    constructor(app: App, plugin: LilbeePlugin, hooks: SessionsModalHooks) {
        super(app);
        this.plugin = plugin;
        this.hooks = hooks;
        bindEscapeToClose(this);
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("lilbee-sessions-modal");

        const header = contentEl.createDiv({ cls: "lilbee-sessions-header" });
        header.createEl("h2", { text: MESSAGES.TITLE_SESSIONS });
        this.countEl = header.createSpan({ cls: "lilbee-sessions-count" });

        const newBtn = header.createEl("button", { cls: "lilbee-sessions-new" });
        setIcon(newBtn, "plus");
        newBtn.setAttribute("aria-label", MESSAGES.LABEL_NEW_SESSION);
        newBtn.addEventListener("click", () => {
            this.hooks.startNew();
            this.close();
        });

        const filterEl = contentEl.createEl("input", {
            cls: "lilbee-sessions-filter",
            placeholder: MESSAGES.PLACEHOLDER_FILTER_SESSIONS,
            attr: { type: "text" },
        });
        filterEl.addEventListener("input", () => {
            this.filter = filterEl.value;
            this.renderList();
        });
        window.setTimeout(() => filterEl.focus(), 0);

        this.listEl = contentEl.createDiv({ cls: "lilbee-sessions-list" });
        void this.load();
    }

    private async load(): Promise<void> {
        try {
            this.sessions = await this.plugin.api.listSessions();
            this.loadFailed = false;
            this.disabled = false;
        } catch (err) {
            this.loadFailed = true;
            // The server 404s every session route when sessions_enabled is off.
            if (err instanceof Error && isHttpStatus(err, 404)) {
                this.disabled = true;
            } else {
                const reason = errorMessage(err, MESSAGES.ERROR_UNKNOWN, this.plugin.settings.serverMode);
                new Notice(MESSAGES.ERROR_SESSIONS_LOAD_FAILED(reason));
            }
        }
        this.renderList();
    }

    /** Flip the server's writable `sessions_enabled` flag, then reload the list. */
    private async enableSessions(): Promise<void> {
        try {
            await this.plugin.api.updateConfig({ sessions_enabled: true });
        } catch (err) {
            const reason = errorMessage(err, MESSAGES.ERROR_UNKNOWN, this.plugin.settings.serverMode);
            new Notice(MESSAGES.ERROR_SESSIONS_ENABLE_FAILED(reason));
            return;
        }
        await this.load();
    }

    private renderDisabledState(container: HTMLElement): void {
        const box = container.createDiv({ cls: "lilbee-sessions-disabled" });
        box.createDiv({ cls: "lilbee-sessions-disabled-text", text: MESSAGES.SESSIONS_DISABLED });
        const enableBtn = box.createEl("button", {
            cls: "lilbee-sessions-enable",
            text: MESSAGES.LABEL_ENABLE_SESSIONS,
        });
        enableBtn.addEventListener("click", () => void this.enableSessions());
    }

    /** Case-insensitive substring on the title, matching the TUI's filter. */
    private visible(): SessionMeta[] {
        const needle = this.filter.trim().toLowerCase();
        if (!needle) return this.sessions;
        return this.sessions.filter((s) => s.title.toLowerCase().includes(needle));
    }

    private renderList(): void {
        if (!this.listEl) return;
        this.listEl.empty();
        const rows = this.visible();
        this.countEl?.setText(MESSAGES.SESSIONS_COUNT(rows.length));

        if (rows.length === 0) {
            if (this.disabled) {
                this.renderDisabledState(this.listEl);
                return;
            }
            if (this.loadFailed) return;
            const empty = this.sessions.length === 0 ? MESSAGES.SESSIONS_EMPTY : MESSAGES.SESSIONS_NO_MATCH;
            this.listEl.createDiv({ cls: "lilbee-sessions-empty", text: empty });
            return;
        }
        for (const meta of rows) this.renderRow(this.listEl, meta);
    }

    private renderRow(container: HTMLElement, meta: SessionMeta): void {
        const isActive = meta.id === this.hooks.activeId;
        const row = container.createDiv({
            cls: `lilbee-session-row${isActive ? " is-active" : ""}`,
        });

        if (this.renamingId === meta.id) {
            this.renderRenameField(row, meta);
            return;
        }

        const main = row.createDiv({ cls: "lilbee-session-main" });
        const titleRow = main.createDiv({ cls: "lilbee-session-title-row" });
        titleRow.createSpan({ cls: "lilbee-session-title", text: meta.title });
        const dateEl = titleRow.createSpan({
            cls: "lilbee-session-date",
            text: relativeTimeFromIso(meta.updated_at),
        });
        if (meta.updated_at) dateEl.setAttribute("title", meta.updated_at);
        main.createDiv({
            cls: "lilbee-session-meta",
            text: MESSAGES.SESSIONS_ROW_META(meta.message_count, displayLabelForRef(meta.model_ref)),
        });
        main.addEventListener("click", () => this.resume(meta));

        const actions = row.createDiv({ cls: "lilbee-session-actions" });
        const renameBtn = actions.createEl("button", { cls: "lilbee-session-rename" });
        setIcon(renameBtn, "pencil");
        renameBtn.setAttribute("aria-label", MESSAGES.LABEL_RENAME_SESSION);
        renameBtn.addEventListener("click", () => {
            this.renamingId = meta.id;
            this.renderList();
        });

        const deleteBtn = actions.createEl("button", { cls: "lilbee-session-delete" });
        setIcon(deleteBtn, "trash-2");
        deleteBtn.setAttribute("aria-label", MESSAGES.LABEL_DELETE_SESSION);
        deleteBtn.addEventListener("click", () => void this.confirmDelete(meta));
    }

    private renderRenameField(row: HTMLElement, meta: SessionMeta): void {
        const input = row.createEl("input", {
            cls: "lilbee-session-rename-input",
            placeholder: MESSAGES.PLACEHOLDER_RENAME_SESSION,
            attr: { type: "text" },
        });
        input.value = meta.title;
        // Focus after the row re-renders; select the title so typing replaces it.
        window.setTimeout(() => {
            input.focus();
            input.select();
        }, 0);
        input.addEventListener("keydown", (evt: KeyboardEvent) => {
            if (evt.key === "Enter") void this.commitRename(meta, input.value);
            else if (evt.key === "Escape") {
                evt.stopPropagation();
                this.renamingId = null;
                this.renderList();
            }
        });
    }

    /** An empty title is discarded rather than written, matching the TUI. */
    private async commitRename(meta: SessionMeta, raw: string): Promise<void> {
        const title = raw.trim();
        this.renamingId = null;
        if (!title || title === meta.title) {
            this.renderList();
            return;
        }
        try {
            await this.plugin.api.renameSession(meta.id, title);
            meta.title = title;
        } catch (err) {
            const reason = errorMessage(err, MESSAGES.ERROR_UNKNOWN, this.plugin.settings.serverMode);
            new Notice(MESSAGES.ERROR_SESSION_RENAME_FAILED(reason));
        }
        this.renderList();
    }

    private async confirmDelete(meta: SessionMeta): Promise<void> {
        const modal = new ConfirmModal(this.app, MESSAGES.NOTICE_CONFIRM_DELETE_SESSION(meta.title));
        modal.open();
        if (!(await modal.result)) return;
        try {
            await this.plugin.api.deleteSession(meta.id);
            this.sessions = this.sessions.filter((s) => s.id !== meta.id);
            new Notice(MESSAGES.NOTICE_SESSION_DELETED(meta.title));
            this.renderList();
        } catch (err) {
            const reason = errorMessage(err, MESSAGES.ERROR_UNKNOWN, this.plugin.settings.serverMode);
            new Notice(MESSAGES.ERROR_SESSION_DELETE_FAILED(reason));
        }
    }

    private resume(meta: SessionMeta): void {
        this.hooks.resume(meta.id);
        this.close();
    }
}
