import { App, Modal } from "obsidian";
import { MESSAGES } from "../locales/en";
import { bindEscapeToClose } from "../utils";

/** Explains how to allow the unsigned lilbee server after macOS Gatekeeper blocks it. */
export class GatekeeperModal extends Modal {
    constructor(app: App) {
        super(app);
        bindEscapeToClose(this);
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("lilbee-gatekeeper-modal");

        contentEl.createEl("h3", { text: MESSAGES.GATEKEEPER_TITLE });
        contentEl.createEl("p", { text: MESSAGES.GATEKEEPER_INTRO });

        const steps = contentEl.createEl("ol");
        steps.createEl("li", { text: MESSAGES.GATEKEEPER_STEP_1 });
        steps.createEl("li", { text: MESSAGES.GATEKEEPER_STEP_2 });
        steps.createEl("li", { text: MESSAGES.GATEKEEPER_STEP_3 });

        contentEl.createEl("p", { text: MESSAGES.GATEKEEPER_RETRY });

        const actions = contentEl.createDiv({ cls: "lilbee-confirm-actions" });
        const gotItBtn = actions.createEl("button", { text: MESSAGES.BUTTON_GOT_IT, cls: "mod-cta" });
        gotItBtn.addEventListener("click", () => this.close());
    }
}
