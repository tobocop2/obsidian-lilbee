import { App, Modal } from "obsidian";
import { MESSAGES } from "../locales/en";

export class ConfirmModal extends Modal {
    private message: string;
    private _resolve: ((value: boolean) => void) | null = null;
    private decided = false;
    readonly result: Promise<boolean>;

    constructor(app: App, message: string) {
        super(app);
        this.message = message;
        this.result = new Promise<boolean>((resolve) => {
            this._resolve = resolve;
        });
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("lilbee-confirm-modal");

        contentEl.createEl("p", { text: this.message });

        const actions = contentEl.createDiv({ cls: "lilbee-confirm-actions" });
        const continueBtn = actions.createEl("button", { text: MESSAGES.BUTTON_CONTINUE, cls: "mod-cta" });
        continueBtn.addEventListener("click", () => this.decide(true));

        const cancelBtn = actions.createEl("button", { text: MESSAGES.BUTTON_CANCEL });
        cancelBtn.addEventListener("click", () => this.decide(false));
    }

    onClose(): void {
        this.decide(false);
    }

    private decide(confirmed: boolean): void {
        if (this.decided) return;
        this.decided = true;
        if (this._resolve) {
            const resolve = this._resolve;
            this._resolve = null;
            resolve(confirmed);
        }
        this.close();
    }
}
