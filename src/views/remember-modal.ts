import { App, Modal, Notice } from "obsidian";
import type LilbeePlugin from "../main";
import { MEMORY_KIND, type MemoryKind } from "../types";
import { MESSAGES } from "../locales/en";
import { bindEscapeToClose, errorMessage } from "../utils";

export class RememberModal extends Modal {
    private plugin: LilbeePlugin;
    private text = "";
    private kind: MemoryKind = MEMORY_KIND.FACT;
    private shared = false;

    constructor(app: App, plugin: LilbeePlugin) {
        super(app);
        this.plugin = plugin;
        bindEscapeToClose(this);
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("lilbee-remember-modal");
        contentEl.createEl("h3", { text: MESSAGES.LABEL_REMEMBER_TITLE });

        contentEl.createEl("label", { text: MESSAGES.LABEL_REMEMBER_TEXT_LABEL, cls: "lilbee-remember-label" });
        const textEl = contentEl.createEl("textarea", { cls: "lilbee-remember-text" });
        textEl.placeholder = MESSAGES.LABEL_REMEMBER_TEXT_PLACEHOLDER;
        textEl.addEventListener("input", () => {
            this.text = textEl.value;
        });

        const kindRow = contentEl.createDiv({ cls: "lilbee-remember-row" });
        kindRow.createEl("label", { text: MESSAGES.LABEL_REMEMBER_KIND_LABEL, cls: "lilbee-remember-label" });
        const kindEl = kindRow.createEl("select", { cls: "lilbee-remember-kind" });
        kindEl.createEl("option", { text: MESSAGES.LABEL_REMEMBER_KIND_FACT, value: MEMORY_KIND.FACT });
        kindEl.createEl("option", { text: MESSAGES.LABEL_REMEMBER_KIND_PREFERENCE, value: MEMORY_KIND.PREFERENCE });
        kindEl.value = MEMORY_KIND.FACT;
        kindEl.addEventListener("change", () => {
            this.kind = kindEl.value === MEMORY_KIND.PREFERENCE ? MEMORY_KIND.PREFERENCE : MEMORY_KIND.FACT;
        });

        const sharedBtn = kindRow.createEl("button", {
            text: MESSAGES.LABEL_REMEMBER_SHARED_LABEL,
            cls: "lilbee-remember-shared",
        });
        sharedBtn.addEventListener("click", () => {
            this.shared = !this.shared;
            sharedBtn.toggleClass("is-active", this.shared);
        });

        const actions = contentEl.createDiv({ cls: "lilbee-remember-actions" });
        const saveBtn = actions.createEl("button", { text: MESSAGES.BUTTON_REMEMBER, cls: "mod-cta" });
        saveBtn.addEventListener("click", () => void this.submit());
        const cancelBtn = actions.createEl("button", { text: MESSAGES.BUTTON_CANCEL });
        cancelBtn.addEventListener("click", () => this.close());
    }

    private async submit(): Promise<void> {
        const text = this.text.trim();
        if (!text) {
            new Notice(MESSAGES.REMEMBER_EMPTY);
            return;
        }
        try {
            await this.plugin.api.remember(text, this.kind, this.shared);
            new Notice(MESSAGES.REMEMBER_SUCCESS(this.kind));
            this.plugin.refreshMemoryViews();
            this.close();
        } catch (err) {
            new Notice(
                MESSAGES.REMEMBER_FAILED(errorMessage(err, MESSAGES.ERROR_UNKNOWN, this.plugin.settings.serverMode)),
            );
        }
    }
}
