import { App, Modal } from "obsidian";
import { MESSAGES, PROFILE_FOLDER_LABELS } from "../locales/en";
import { PROFILE_FOLDER, PROFILE_SAVE_TARGETS } from "../types";
import type { ProfileFolder } from "../types";
import { bindEscapeToClose } from "../utils";

/** Runs the write; answers the server's refusal to show in the dialog, or null once the write is done. */
export type ProfileNameSubmit = (name: string, target: ProfileFolder) => Promise<string | null>;

export interface ProfileNameOptions {
    title: string;
    explain?: string;
    initialName?: string;
    /** False for a rename, which keeps the profile in its folder. */
    askTarget: boolean;
    submit: ProfileNameSubmit;
}

/** Asks for a profile name and, for a new file, the folder: this vault or all projects. */
export class ProfileNameModal extends Modal {
    private nameEl: HTMLInputElement | null = null;
    private target: ProfileFolder = PROFILE_FOLDER.GLOBAL;
    private errorEl: HTMLElement | null = null;
    private busy = false;

    constructor(
        app: App,
        private readonly options: ProfileNameOptions,
    ) {
        super(app);
        bindEscapeToClose(this);
    }

    onOpen(): void {
        const { contentEl, options } = this;
        contentEl.empty();
        contentEl.addClass("lilbee-profile-name-modal");
        contentEl.createEl("h3", { text: options.title });
        this.nameEl = contentEl.createEl("input", {
            cls: "lilbee-profile-name",
            attr: { type: "text", placeholder: MESSAGES.PLACEHOLDER_PROFILE_NAME },
        });
        this.nameEl.value = options.initialName ?? "";
        this.nameEl.addEventListener("keydown", (event: KeyboardEvent) => {
            if (event.key === "Enter") void this.save();
        });
        this.errorEl = contentEl.createEl("p", { cls: "lilbee-profile-name-error" });
        if (options.askTarget) this.renderTarget(contentEl);
        if (options.explain) contentEl.createEl("p", { text: options.explain, cls: "setting-item-description" });
        const actions = contentEl.createDiv({ cls: "modal-button-container" });
        const save = actions.createEl("button", { text: MESSAGES.BUTTON_PROFILE_SAVE, cls: "mod-cta" });
        save.addEventListener("click", () => void this.save());
        const cancel = actions.createEl("button", { text: MESSAGES.BUTTON_CANCEL });
        cancel.addEventListener("click", () => this.close());
        this.nameEl.focus();
    }

    private renderTarget(container: HTMLElement): void {
        container.createEl("h4", { text: MESSAGES.LABEL_PROFILE_SAVE_TO });
        const select = container.createEl("select", { cls: "dropdown lilbee-profile-target" });
        for (const folder of PROFILE_SAVE_TARGETS) {
            select.createEl("option", { text: PROFILE_FOLDER_LABELS[folder], attr: { value: folder } });
        }
        select.value = this.target;
        select.addEventListener("change", () => {
            this.target = PROFILE_SAVE_TARGETS.find((folder) => folder === select.value) ?? PROFILE_FOLDER.GLOBAL;
        });
    }

    /** Send the name; a refusal stays in the dialog for correcting, a success closes it. */
    private async save(): Promise<void> {
        const name = this.nameEl?.value.trim() ?? "";
        if (this.busy || name === "") return;
        this.busy = true;
        const refusal = await this.options.submit(name, this.target);
        this.busy = false;
        if (refusal === null) {
            this.close();
            return;
        }
        this.errorEl?.setText(refusal);
    }
}
