import { App } from "obsidian";
import { MESSAGES } from "../locales/en";
import { ChoiceModal } from "./choice-modal";

export class ConfirmModal extends ChoiceModal<boolean> {
    private message: string;

    constructor(app: App, message: string) {
        super(app, false);
        this.message = message;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("lilbee-confirm-modal");

        contentEl.createEl("p", { text: this.message });

        const actions = contentEl.createDiv({ cls: "modal-button-container" });
        this.addChoice(actions, MESSAGES.BUTTON_CONTINUE, true, true);
        this.addChoice(actions, MESSAGES.BUTTON_CANCEL, false);
    }
}
