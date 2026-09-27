import { Modal } from "obsidian";
import type LilbeePlugin from "../main";
import { MESSAGES } from "../locales/en";
import type { ProfileEntry } from "../types";
import { PILL_CLS, renderPill } from "../components/pill";
import { bindEscapeToClose } from "../utils";
import {
    deleteProfile,
    duplicateProfile,
    exportProfile,
    importProfile,
    loadProfiles,
    PROFILE_ACTION,
    PROFILE_ACTION_ALLOWS,
    renameProfile,
} from "../profiles";
import type { ProfileAction } from "../profiles";
import { profileCreditText, profileFolderLabel, renderNote } from "./profile-parts";

type LibraryAction = Exclude<ProfileAction, typeof PROFILE_ACTION.APPLY>;

const LIBRARY_BUTTONS: ReadonlyArray<[LibraryAction, string]> = [
    [PROFILE_ACTION.DUPLICATE, MESSAGES.BUTTON_PROFILE_DUPLICATE],
    [PROFILE_ACTION.RENAME, MESSAGES.BUTTON_PROFILE_RENAME],
    [PROFILE_ACTION.DELETE, MESSAGES.BUTTON_PROFILE_DELETE],
    [PROFILE_ACTION.EXPORT, MESSAGES.BUTTON_PROFILE_EXPORT],
];

/** Every profile with its folder, credit and state, and the file operations each one allows. */
export class ProfileLibraryModal extends Modal {
    private listEl: HTMLElement | null = null;
    private readonly runners: Readonly<Record<LibraryAction, (name: string) => unknown>>;

    constructor(
        private readonly plugin: LilbeePlugin,
        private readonly onChanged?: () => void,
    ) {
        super(plugin.app);
        bindEscapeToClose(this);
        const changed = (): void => this.changed();
        this.runners = {
            [PROFILE_ACTION.DUPLICATE]: (name) => duplicateProfile(plugin, name, changed),
            [PROFILE_ACTION.RENAME]: (name) => renameProfile(plugin, name, changed),
            [PROFILE_ACTION.DELETE]: (name) => deleteProfile(plugin, name, changed),
            [PROFILE_ACTION.EXPORT]: (name) => exportProfile(plugin, name),
        };
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("lilbee-profile-library");
        contentEl.createEl("h3", { text: MESSAGES.PROFILE_LIBRARY_TITLE });
        const actions = contentEl.createDiv({ cls: "modal-button-container" });
        const importButton = actions.createEl("button", { text: MESSAGES.BUTTON_PROFILE_IMPORT });
        importButton.addEventListener("click", () => void importProfile(this.plugin, () => this.changed()));
        this.listEl = contentEl.createDiv({ cls: "lilbee-profile-library-list" });
        void this.load();
    }

    private changed(): void {
        this.onChanged?.();
        void this.load();
    }

    /** Read the profiles and the active one again, then redraw the list. */
    private async load(): Promise<void> {
        const list = await loadProfiles(this.plugin);
        if (list === null || this.listEl === null) return;
        const active = await this.plugin.api.activeProfile().catch(() => null);
        this.listEl.empty();
        for (const entry of list.profiles) this.renderEntry(this.listEl, entry, active?.name ?? null);
    }

    private renderEntry(container: HTMLElement, entry: ProfileEntry, activeName: string | null): void {
        const row = container.createDiv({ cls: "lilbee-profile-library-row" });
        const title = row.createDiv({ cls: "lilbee-profile-library-name" });
        title.createSpan({ text: entry.name });
        renderPill(title, profileFolderLabel(entry.folder), PILL_CLS.PROFILE_FOLDER);
        if (entry.name === activeName && entry.shadowed_by === null) {
            renderPill(title, MESSAGES.PROFILE_ACTIVE_MARK, PILL_CLS.PROFILE_ACTIVE);
        }
        renderNote(row, entry.description, "lilbee-profile-description");
        renderNote(row, profileCreditText(entry), "lilbee-profile-credit");
        renderNote(row, this.stateNote(entry), "lilbee-profile-state");
        const buttons = row.createDiv({ cls: "lilbee-profile-library-actions" });
        for (const [action, label] of LIBRARY_BUTTONS) {
            if (!PROFILE_ACTION_ALLOWS[action](entry)) continue;
            const button = buttons.createEl("button", { text: label });
            button.addEventListener("click", () => void this.runners[action](entry.name));
        }
    }

    /** Why a profile cannot be used or reached, or null for one that can. */
    private stateNote(entry: ProfileEntry): string | null {
        if (entry.shadowed_by !== null) return MESSAGES.PROFILE_SHADOWED(profileFolderLabel(entry.shadowed_by));
        if (entry.error !== null) return MESSAGES.PROFILE_BROKEN(entry.error);
        return null;
    }
}
