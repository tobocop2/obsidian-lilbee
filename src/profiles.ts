import { App, FuzzySuggestModal, Notice } from "obsidian";
import type LilbeePlugin from "./main";
import { MESSAGES, PROFILE_FOLDER_LABELS } from "./locales/en";
import { APPLY_CHOICE, PROFILE_MAX_BYTES, PROFILE_OWNED_FOLDERS, PROFILE_SAVE_TARGETS } from "./types";
import type {
    ExportedProfile,
    ProfileDiscardResponse,
    ProfileEntry,
    ProfileFolder,
    ProfileListResponse,
    ProfileValidationResponse,
} from "./types";
import { node } from "./node";
import { extractServerErrorDetail } from "./utils";
import { applyProfile } from "./utils/reindex";
import { electronDialog } from "./utils/file-dialog";
import { ApplyProfileModal } from "./views/profile-apply-modal";
import { ChoiceModal } from "./views/choice-modal";
import { ConfirmModal } from "./views/confirm-modal";
import { profileFolderLabel } from "./views/profile-parts";
import { ProfileNameModal } from "./views/profile-name-modal";
import type { ProfileNameSubmit } from "./views/profile-name-modal";

/** An operation on one existing profile. */
export type ProfileAction = "apply" | "duplicate" | "rename" | "delete" | "export";

export const PROFILE_ACTION = {
    APPLY: "apply",
    DUPLICATE: "duplicate",
    RENAME: "rename",
    DELETE: "delete",
    EXPORT: "export",
} as const satisfies Record<string, ProfileAction>;

const PROFILE_EXTENSION = "toml";
const BYTES_PER_KB = 1024;

/** A profile a name reaches: a name picks the highest folder, so a shadowed file is out of reach. */
function reachable(entry: ProfileEntry): boolean {
    return entry.shadowed_by === null;
}

function owned(entry: ProfileEntry): boolean {
    return reachable(entry) && PROFILE_OWNED_FOLDERS.has(entry.folder);
}

/** Which profiles each action can take, read off the fields the server reports. */
export const PROFILE_ACTION_ALLOWS: Readonly<Record<ProfileAction, (entry: ProfileEntry) => boolean>> = {
    [PROFILE_ACTION.APPLY]: (entry) => reachable(entry) && entry.valid,
    [PROFILE_ACTION.DUPLICATE]: (entry) => reachable(entry) && entry.valid,
    [PROFILE_ACTION.RENAME]: (entry) => owned(entry) && entry.valid,
    [PROFILE_ACTION.DELETE]: owned,
    [PROFILE_ACTION.EXPORT]: (entry) => reachable(entry) && entry.valid,
};

/** The server's refusal text when it gave one, else the error's own message. */
export function profileErrorText(error: unknown): string {
    if (!(error instanceof Error)) return String(error);
    return extractServerErrorDetail(error.message) ?? error.message;
}

/** Run one profile write: a notice for the outcome, and *onDone* after a success. */
async function attempt<T>(op: () => Promise<T>, notice: (value: T) => string, onDone?: () => void): Promise<void> {
    try {
        new Notice(notice(await op()));
    } catch (error) {
        new Notice(MESSAGES.ERROR_PROFILE_ACTION(profileErrorText(error)));
        return;
    }
    onDone?.();
}

/** The name dialog's submit: a refusal stays in the dialog, a success raises a notice and runs *onDone*. */
function submitter<T>(
    op: (name: string, target: ProfileFolder) => Promise<T>,
    notice: (value: T) => string,
    onDone?: () => void,
): ProfileNameSubmit {
    return async (name, target) => {
        try {
            new Notice(notice(await op(name, target)));
        } catch (error) {
            return profileErrorText(error);
        }
        onDone?.();
        return null;
    };
}

/** Every profile, or null after telling the user why there is no list. */
export async function loadProfiles(plugin: LilbeePlugin): Promise<ProfileListResponse | null> {
    try {
        const list = await plugin.api.listProfiles();
        if (list === null) new Notice(MESSAGES.NOTICE_PROFILES_UNSUPPORTED);
        return list;
    } catch (error) {
        new Notice(MESSAGES.ERROR_PROFILE_LOAD(profileErrorText(error)));
        return null;
    }
}

/** The active profile's name, or null after a notice when the server cannot say. */
export async function activeProfileName(plugin: LilbeePlugin): Promise<string | null> {
    if ((await loadProfiles(plugin)) === null) return null;
    try {
        return (await plugin.api.activeProfile()).name;
    } catch (error) {
        new Notice(MESSAGES.ERROR_PROFILE_LOAD(profileErrorText(error)));
        return null;
    }
}

/** Show the server's diff for *name* in the Apply modal, then apply it as the user chose. */
export async function chooseProfile(plugin: LilbeePlugin, name: string, onDone?: () => void): Promise<void> {
    let modal: ApplyProfileModal;
    try {
        const [profile, diff, config] = await Promise.all([
            plugin.api.getProfile(name),
            plugin.api.profileDiff(name),
            plugin.api.config(),
        ]);
        modal = new ApplyProfileModal(plugin.app, { profile, diff, config });
    } catch (error) {
        new Notice(MESSAGES.ERROR_PROFILE_ACTION(profileErrorText(error)));
        return;
    }
    modal.open();
    const choice = await modal.result;
    if (choice === APPLY_CHOICE.CANCEL) return;
    await attempt(
        () => applyProfile(plugin, name, choice === APPLY_CHOICE.APPLY_REINDEX),
        (response) => MESSAGES.NOTICE_PROFILE_APPLIED(response.name),
        onDone,
    );
}

/** Ask for a name and folder, then save the vault's settings as that profile. */
export function saveProfileAs(plugin: LilbeePlugin, activeName: string, onDone?: () => void): void {
    new ProfileNameModal(plugin.app, {
        title: MESSAGES.PROFILE_SAVE_TITLE,
        explain: MESSAGES.PROFILE_SAVE_EXPLAIN(activeName),
        askTarget: true,
        submit: submitter(
            (name, target) => plugin.api.saveProfile(name, target),
            (saved) => MESSAGES.NOTICE_PROFILE_SAVED(saved.name, saved.path),
            onDone,
        ),
    }).open();
}

/** Write the vault's settings into its profile. */
export async function updateProfile(plugin: LilbeePlugin, name: string, onDone?: () => void): Promise<void> {
    await attempt(
        () => plugin.api.updateProfile(name),
        (saved) => MESSAGES.NOTICE_PROFILE_UPDATED(saved.name),
        onDone,
    );
}

/** Remove the user's values of profile settings so *activeName*'s values show through, then ask
 *  before rebuilding the index those values had shaped. */
export async function discardProfileChanges(
    plugin: LilbeePlugin,
    activeName: string,
    onDone?: () => void,
): Promise<void> {
    let result: ProfileDiscardResponse;
    try {
        result = await plugin.api.discardProfileChanges();
    } catch (error) {
        new Notice(MESSAGES.ERROR_PROFILE_ACTION(profileErrorText(error)));
        return;
    }
    new Notice(
        result.dropped.length === 0
            ? MESSAGES.NOTICE_PROFILE_NOTHING_TO_DISCARD
            : MESSAGES.NOTICE_PROFILE_DISCARDED(activeName),
    );
    onDone?.();
    if (result.reindex_required) await confirmDiscardRebuild(plugin, activeName);
}

/** Ask before rebuilding the index; the caller's discard already happened either way. */
async function confirmDiscardRebuild(plugin: LilbeePlugin, name: string): Promise<void> {
    const confirm = new ConfirmModal(plugin.app, MESSAGES.CONFIRM_PROFILE_DISCARD_REINDEX(name));
    confirm.open();
    if (await confirm.result) void plugin.triggerSync({ forceRebuild: true });
}

export function duplicateProfile(plugin: LilbeePlugin, name: string, onDone?: () => void): void {
    new ProfileNameModal(plugin.app, {
        title: MESSAGES.PROFILE_DUPLICATE_TITLE(name),
        askTarget: true,
        submit: submitter(
            (newName, target) => plugin.api.duplicateProfile(name, newName, target),
            (made) => MESSAGES.NOTICE_PROFILE_DUPLICATED(made.name),
            onDone,
        ),
    }).open();
}

export function renameProfile(plugin: LilbeePlugin, name: string, onDone?: () => void): void {
    new ProfileNameModal(plugin.app, {
        title: MESSAGES.PROFILE_RENAME_TITLE(name),
        initialName: name,
        askTarget: false,
        submit: submitter(
            (newName) => plugin.api.renameProfile(name, newName),
            (renamed) => MESSAGES.NOTICE_PROFILE_RENAMED(renamed.name),
            onDone,
        ),
    }).open();
}

/** Ask first, then remove the profile file. */
export async function deleteProfile(plugin: LilbeePlugin, name: string, onDone?: () => void): Promise<void> {
    const confirm = new ConfirmModal(plugin.app, MESSAGES.CONFIRM_DELETE_PROFILE(name));
    confirm.open();
    if (!(await confirm.result)) return;
    await attempt(
        () => plugin.api.deleteProfile(name),
        (removed) => MESSAGES.NOTICE_PROFILE_DELETED(removed.name),
        onDone,
    );
}

/** Write the profile as a clean file where the user picks. */
export async function exportProfile(plugin: LilbeePlugin, name: string): Promise<void> {
    let exported: ExportedProfile;
    try {
        exported = await plugin.api.exportProfile(name);
    } catch (error) {
        new Notice(MESSAGES.ERROR_PROFILE_ACTION(profileErrorText(error)));
        return;
    }
    const result = await electronDialog.showSaveDialog({
        defaultPath: exported.filename ?? `${name}.${PROFILE_EXTENSION}`,
        filters: [{ name: MESSAGES.LABEL_PROFILE_FILTER, extensions: [PROFILE_EXTENSION] }],
    });
    if (result.canceled || !result.filePath) return;
    try {
        node.writeFileSync(result.filePath, exported.content, "utf8");
    } catch (error) {
        new Notice(MESSAGES.ERROR_PROFILE_WRITE(profileErrorText(error)));
        return;
    }
    new Notice(MESSAGES.NOTICE_PROFILE_EXPORTED(result.filePath));
}

/** The text of a profile file the user picks, or null after a notice when it cannot be used. */
async function pickProfileFile(): Promise<{ path: string; content: string } | null> {
    const result = await electronDialog.showOpenDialog({
        properties: ["openFile"],
        filters: [{ name: MESSAGES.LABEL_PROFILE_FILTER, extensions: [PROFILE_EXTENSION] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const [path] = result.filePaths;
    try {
        if (node.statSync(path).size > PROFILE_MAX_BYTES) {
            new Notice(MESSAGES.ERROR_PROFILE_TOO_LARGE(PROFILE_MAX_BYTES / BYTES_PER_KB));
            return null;
        }
        return { path, content: node.readFileSync(path, "utf8") };
    } catch (error) {
        new Notice(MESSAGES.ERROR_PROFILE_READ(profileErrorText(error)));
        return null;
    }
}

/** Asks which folder an imported profile goes to. */
class ImportTargetModal extends ChoiceModal<ProfileFolder | null> {
    constructor(
        app: App,
        private readonly filename: string,
    ) {
        super(app, null);
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h3", { text: MESSAGES.PROFILE_IMPORT_TITLE(this.filename) });
        contentEl.createEl("p", { text: MESSAGES.LABEL_PROFILE_SAVE_TO });
        const actions = contentEl.createDiv({ cls: "modal-button-container" });
        PROFILE_SAVE_TARGETS.forEach((folder, index) =>
            this.addChoice(actions, PROFILE_FOLDER_LABELS[folder], folder, index === 0),
        );
        this.addChoice(actions, MESSAGES.BUTTON_CANCEL, null);
    }
}

/** Pick a profile file, ask where it goes, check it with the server, then copy it in. */
export async function importProfile(plugin: LilbeePlugin, onDone?: () => void): Promise<void> {
    const picked = await pickProfileFile();
    if (picked === null) return;
    const filename = node.basename(picked.path);
    const ask = new ImportTargetModal(plugin.app, filename);
    ask.open();
    const target = await ask.result;
    if (target === null) return;
    let check: ProfileValidationResponse;
    try {
        check = await plugin.api.validateProfile(picked.content, filename, target);
    } catch (error) {
        new Notice(MESSAGES.ERROR_PROFILE_ACTION(profileErrorText(error)));
        return;
    }
    if (!check.valid) {
        new Notice(MESSAGES.ERROR_PROFILE_INVALID(check.problems.join("; ")));
        return;
    }
    await attempt(
        () => plugin.api.importProfile(picked.content, filename, target),
        (imported) => MESSAGES.NOTICE_PROFILE_IMPORTED(imported.name),
        onDone,
    );
}

/** Picks one profile an action can take. */
export class ProfilePickerModal extends FuzzySuggestModal<ProfileEntry> {
    constructor(
        app: App,
        private readonly entries: ProfileEntry[],
        private readonly onPick: (entry: ProfileEntry) => void,
    ) {
        super(app);
        this.setPlaceholder(MESSAGES.PLACEHOLDER_PICK_PROFILE);
    }

    getItems(): ProfileEntry[] {
        return this.entries;
    }

    getItemText(entry: ProfileEntry): string {
        return `${entry.name} (${profileFolderLabel(entry.folder)})`;
    }

    onChooseItem(entry: ProfileEntry): void {
        this.onPick(entry);
    }
}

/** List the profiles *action* can take and run *run* on the one the user picks. */
export async function pickProfileFor(
    plugin: LilbeePlugin,
    action: ProfileAction,
    run: (entry: ProfileEntry) => void,
): Promise<void> {
    const list = await loadProfiles(plugin);
    if (list === null) return;
    new ProfilePickerModal(plugin.app, list.profiles.filter(PROFILE_ACTION_ALLOWS[action]), run).open();
}
