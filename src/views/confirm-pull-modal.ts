import { App, Modal } from "obsidian";
import type { ModelInfo } from "../types";

export class ConfirmPullModal extends Modal {
    private model: ModelInfo;
    private _resolve: ((value: boolean) => void) | null = null;
    private decided = false;
    readonly result: Promise<boolean>;

    constructor(app: App, model: ModelInfo) {
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

        contentEl.createEl("h2", { text: "Download model?" });

        const info = contentEl.createDiv({ cls: "lilbee-confirm-pull-info" });
        info.createEl("p", { text: `Model: ${this.model.name}` });
        info.createEl("p", { text: `Size: ${this.model.size_gb} GB` });
        info.createEl("p", { text: `Minimum RAM: ${this.model.min_ram_gb} GB` });

        const actions = contentEl.createDiv({ cls: "lilbee-confirm-pull-actions" });
        const pullBtn = actions.createEl("button", {
            text: "Pull Model",
            cls: "mod-cta",
        });
        pullBtn.addEventListener("click", () => this.decide(true));

        const cancelBtn = actions.createEl("button", { text: "Cancel" });
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
