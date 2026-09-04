import { App, Modal } from "obsidian";
import type { ReleaseInfo } from "../binary-manager";
import { MESSAGES } from "../locales/en";
import { bindEscapeToClose } from "../utils";

export interface UpdateReminderActions {
    openSettings: () => void;
    stopReminding: () => void;
}

/** Launch-time reminder that a newer server exists while automatic updates are off. */
export class UpdateAvailableModal extends Modal {
    constructor(
        app: App,
        private release: ReleaseInfo,
        private build: string | null,
        private actions: UpdateReminderActions,
    ) {
        super(app);
        bindEscapeToClose(this);
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("lilbee-update-modal");
        contentEl.createEl("h3", { text: MESSAGES.UPDATE_MODAL_TITLE });
        contentEl.createEl("p", { text: MESSAGES.UPDATE_MODAL_BODY(this.release.tag, this.build) });
        contentEl.createEl("p", { text: MESSAGES.UPDATE_MODAL_HOW_TO_DISABLE, cls: "lilbee-update-modal-hint" });

        const actions = contentEl.createDiv({ cls: "modal-button-container" });
        const open = actions.createEl("button", { text: MESSAGES.BUTTON_OPEN_UPDATE_SETTINGS, cls: "mod-cta" });
        open.addEventListener("click", () => {
            this.close();
            this.actions.openSettings();
        });
        const later = actions.createEl("button", { text: MESSAGES.BUTTON_NOT_NOW });
        later.addEventListener("click", () => this.close());
        const stop = actions.createEl("button", { text: MESSAGES.BUTTON_STOP_REMINDING });
        stop.addEventListener("click", () => {
            this.actions.stopReminding();
            this.close();
        });
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
