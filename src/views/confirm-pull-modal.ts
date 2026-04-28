import { App, Modal } from "obsidian";
import { MESSAGES } from "../locales/en";

export interface ConfirmPullInfo {
    displayName: string;
    sizeGb: number;
    minRamGb: number;
    /** Total system RAM in GB. When set and below ``minRamGb`` the modal warns the user. */
    systemMemGb?: number | null;
}

export class ConfirmPullModal extends Modal {
    private model: ConfirmPullInfo;
    private _resolve: ((value: boolean) => void) | null = null;
    private decided = false;
    readonly result: Promise<boolean>;

    constructor(app: App, model: ConfirmPullInfo) {
        super(app);
        this.model = model;
        this.result = new Promise<boolean>((resolve) => {
            this._resolve = resolve;
        });
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("lilbee-confirm-pull");

        contentEl.createEl("h2", { text: MESSAGES.TITLE_DOWNLOAD_MODEL });

        const info = contentEl.createDiv({ cls: "lilbee-confirm-pull-info" });
        info.createEl("p", { text: `${MESSAGES.LABEL_MODEL}: ${this.model.displayName}` });
        info.createEl("p", { text: `${MESSAGES.LABEL_SIZE}: ${this.model.sizeGb} GB` });
        info.createEl("p", { text: `${MESSAGES.LABEL_MIN_RAM}: ${this.model.minRamGb} GB` });

        const tooLarge = typeof this.model.systemMemGb === "number" && this.model.systemMemGb < this.model.minRamGb;
        if (tooLarge) {
            const warn = contentEl.createDiv({ cls: "lilbee-confirm-pull-warning" });
            warn.createEl("p", {
                text: MESSAGES.WARNING_MODEL_EXCEEDS_RAM(this.model.minRamGb, this.model.systemMemGb!),
            });
        }

        const actions = contentEl.createDiv({ cls: "lilbee-confirm-pull-actions" });
        const pullBtn = actions.createEl("button", {
            text: tooLarge ? MESSAGES.BUTTON_PULL_ANYWAY : MESSAGES.BUTTON_PULL_MODEL,
            cls: "mod-cta",
        });
        pullBtn.addEventListener("click", () => this.decide(true));

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
