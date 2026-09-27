import { Setting } from "obsidian";
import type LilbeePlugin from "../main";
import { MESSAGES, PROFILE_FOLDER_NOTES, PROFILE_STATUS_NOTES } from "../locales/en";
import { PROFILE_OWNED_FOLDERS, PROFILE_STATUS } from "../types";
import type { ActiveProfileResponse, ProfileChangeRow, ProfileEffect, ProfileEntry } from "../types";
import {
    chooseProfile,
    discardProfileChanges,
    PROFILE_ACTION,
    PROFILE_ACTION_ALLOWS,
    saveProfileAs,
    updateProfile,
} from "../profiles";
import { ProfileLibraryModal } from "../views/profile-library-modal";
import { profileCreditText, profileValueText, renderNote, renderProfileTable } from "../views/profile-parts";

/** The Setting/Your value/Profile value columns a "Your changes" row needs, plus its reindex cost when known. */
type ChangeTableRow = Pick<ProfileChangeRow, "key" | "yours" | "profile_value"> & { effect?: ProfileEffect };

/** Everything the group shows, read from the server in one load. */
interface ProfileSnapshot {
    profiles: ProfileEntry[];
    active: ActiveProfileResponse;
    /** The changes list built the old way, for a server that predates `active.changes`. Empty otherwise. */
    legacyChanges: ChangeTableRow[];
}

type GroupState = { kind: "loading" } | { kind: "hidden" } | { kind: "ready"; snapshot: ProfileSnapshot };

/** The Profile group at the top of Settings: the active profile, the user's changes, and the profile actions. */
export class ProfileGroup {
    private state: GroupState = { kind: "loading" };
    private bodyEl: HTMLElement | null = null;
    private withHeading = false;

    constructor(
        private readonly plugin: LilbeePlugin,
        private readonly onChanged: () => void,
        private readonly onVisibility: () => void,
    ) {}

    /** False until the server answers with profiles; an older server keeps the group hidden. */
    visible(): boolean {
        return this.state.kind === "ready";
    }

    /** Render into *container*, reusing its body across re-renders; *heading* adds the group's own heading row. */
    mount(container: HTMLElement, heading: boolean): void {
        this.withHeading = heading;
        this.bodyEl =
            container.querySelector<HTMLDivElement>(".lilbee-profile-body") ??
            container.createDiv({ cls: "lilbee-profile-body" });
        this.render();
    }

    /** Read the server again, then redraw and report whether the group shows. */
    async load(): Promise<void> {
        this.state = await this.read();
        this.render();
        this.onVisibility();
    }

    /** The group's state: hidden on a server without profiles, or when the profiles cannot be read. */
    private async read(): Promise<GroupState> {
        try {
            const list = await this.plugin.api.listProfiles();
            if (list === null) return { kind: "hidden" };
            const active = await this.plugin.api.activeProfile();
            const legacyChanges = active.changes === undefined ? await this.readLegacyChanges(active) : [];
            return { kind: "ready", snapshot: { profiles: list.profiles, active, legacyChanges } };
        } catch {
            return { kind: "hidden" };
        }
    }

    /** The changes list a server that predates `active.changes` needs: the diff's kept keys against
     *  the current config and the active profile's values. */
    private async readLegacyChanges(active: ActiveProfileResponse): Promise<ChangeTableRow[]> {
        const [config, diff] = await Promise.all([
            this.plugin.api.config(),
            this.plugin.api.profileDiff(active.name).catch(() => null),
        ]);
        return (diff?.kept ?? []).map((key) => ({
            key,
            yours: config[key],
            profile_value: active.values[key],
        }));
    }

    private render(): void {
        const body = this.bodyEl;
        if (body === null) return;
        body.empty();
        if (this.state.kind !== "ready") return;
        const { snapshot } = this.state;
        if (this.withHeading) {
            new Setting(body)
                .setName(MESSAGES.LABEL_PROFILE_SECTION)
                .setHeading()
                .setDesc(MESSAGES.DESC_PROFILE_SECTION);
        }
        this.renderPicker(body, snapshot);
        this.renderAbout(body, snapshot.active);
        this.renderChanges(body, snapshot);
        this.renderActions(body, snapshot);
    }

    private renderPicker(body: HTMLElement, snapshot: ProfileSnapshot): void {
        const { active } = snapshot;
        const names = snapshot.profiles.filter(PROFILE_ACTION_ALLOWS[PROFILE_ACTION.APPLY]).map((entry) => entry.name);
        if (!names.includes(active.name)) names.unshift(active.name);
        new Setting(body)
            .setName(MESSAGES.LABEL_PROFILE_SECTION)
            .setDesc(MESSAGES.DESC_PROFILE_PICK)
            .addDropdown((dropdown) => {
                for (const name of names) dropdown.addOption(name, name);
                dropdown.setValue(active.name);
                dropdown.onChange(async (name) => {
                    if (name === active.name) return;
                    await chooseProfile(this.plugin, name, this.onChanged);
                    dropdown.setValue(active.name);
                });
            });
    }

    private renderAbout(body: HTMLElement, active: ActiveProfileResponse): void {
        const entry = active.profile;
        if (entry !== null) {
            renderNote(body, entry.description, "lilbee-profile-description");
            renderNote(body, profileCreditText(entry), "lilbee-profile-credit");
            renderNote(body, PROFILE_FOLDER_NOTES[entry.folder], "lilbee-profile-folder");
        }
        renderNote(body, PROFILE_STATUS_NOTES[active.status], "lilbee-profile-status");
    }

    /** The rows the group shows as "Your changes": the active profile's own list, or the legacy fallback. */
    private changeRows(snapshot: ProfileSnapshot): ChangeTableRow[] {
        return snapshot.active.changes ?? snapshot.legacyChanges;
    }

    /** The user's values the active profile lists, or the legacy fallback on an older server. */
    private renderChanges(body: HTMLElement, snapshot: ProfileSnapshot): void {
        const { active } = snapshot;
        const rows = this.changeRows(snapshot);
        body.createEl("h4", { text: MESSAGES.PROFILE_CHANGES_TITLE });
        const help = rows.length > 0 ? MESSAGES.PROFILE_CHANGES_HELP : MESSAGES.PROFILE_CHANGES_NONE;
        renderNote(body, help(active.name), "lilbee-profile-changes-help");
        if (rows.length === 0) return;
        renderProfileTable(
            body,
            [MESSAGES.PROFILE_COL_SETTING, MESSAGES.PROFILE_COL_YOURS, MESSAGES.PROFILE_COL_PROFILE],
            rows.map((row) => ({
                cells: [row.key, profileValueText(row.yours), profileValueText(row.profile_value)],
                effect: row.effect,
            })),
        );
    }

    private renderActions(body: HTMLElement, snapshot: ProfileSnapshot): void {
        const { active } = snapshot;
        const owned = active.profile !== null && PROFILE_OWNED_FOLDERS.has(active.profile.folder);
        const hasChanges = this.changeRows(snapshot).length > 0;
        const setting = new Setting(body);
        if (owned && active.status === PROFILE_STATUS.CURRENT && hasChanges) {
            setting.addButton((button) =>
                button
                    .setButtonText(MESSAGES.BUTTON_PROFILE_UPDATE(active.name))
                    .onClick(() => void updateProfile(this.plugin, active.name, this.onChanged)),
            );
        }
        if (active.status === PROFILE_STATUS.CHANGED) {
            setting.addButton((button) =>
                button
                    .setButtonText(MESSAGES.BUTTON_PROFILE_REAPPLY(active.name))
                    .onClick(() => void chooseProfile(this.plugin, active.name, this.onChanged)),
            );
        }
        setting.addButton((button) =>
            button
                .setButtonText(MESSAGES.BUTTON_PROFILE_SAVE_AS)
                .onClick(() => saveProfileAs(this.plugin, active.name, this.onChanged)),
        );
        if (hasChanges) {
            setting.addButton((button) =>
                button
                    .setButtonText(MESSAGES.BUTTON_PROFILE_DISCARD)
                    .onClick(() => void discardProfileChanges(this.plugin, active.name, this.onChanged)),
            );
        }
        setting.addButton((button) =>
            button
                .setButtonText(MESSAGES.BUTTON_PROFILE_MANAGE)
                .onClick(() => new ProfileLibraryModal(this.plugin, this.onChanged).open()),
        );
    }
}
