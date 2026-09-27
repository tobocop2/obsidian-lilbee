import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { App, FuzzySuggestModal, Modal, Notice } from "obsidian";
import type { MockElement } from "./__mocks__/obsidian";
import {
    activeProfileName,
    chooseProfile,
    deleteProfile,
    discardProfileChanges,
    duplicateProfile,
    exportProfile,
    importProfile,
    loadProfiles,
    pickProfileFor,
    PROFILE_ACTION,
    PROFILE_ACTION_ALLOWS,
    profileErrorText,
    ProfilePickerModal,
    renameProfile,
    saveProfileAs,
    updateProfile,
} from "../src/profiles";
import { MESSAGES, PROFILE_FOLDER_LABELS } from "../src/locales/en";
import { PROFILE_FOLDER, PROFILE_MAX_BYTES } from "../src/types";
import type { ProfileFolder } from "../src/types";
import { node } from "../src/node";
import { electronDialog } from "../src/utils/file-dialog";
import type LilbeePlugin from "../src/main";
import { ACTIVE_DEFAULT, APPLY, DIFF, LIST, button, refusal } from "./profile-fixtures";
import recorded from "./fixtures/profile-responses.json";

const NOTES = LIST.profiles.find((p) => p.name === "Notes and markdown")!;

function makePlugin() {
    return {
        app: new App(),
        triggerSync: vi.fn(),
        api: {
            listProfiles: vi.fn().mockResolvedValue(LIST),
            activeProfile: vi.fn().mockResolvedValue(ACTIVE_DEFAULT),
            getProfile: vi.fn().mockResolvedValue(NOTES),
            profileDiff: vi.fn().mockResolvedValue(DIFF),
            config: vi.fn().mockResolvedValue({ chunk_size: 500 }),
            applyProfile: vi.fn().mockResolvedValue(APPLY),
            saveProfile: vi.fn().mockResolvedValue(recorded.save_as.body),
            updateProfile: vi.fn().mockResolvedValue(recorded.update.body),
            discardProfileChanges: vi.fn().mockResolvedValue(recorded.discard.body),
            duplicateProfile: vi.fn().mockResolvedValue(recorded.duplicate.body),
            renameProfile: vi.fn().mockResolvedValue(recorded.rename.body),
            deleteProfile: vi.fn().mockResolvedValue(recorded.delete.body),
            exportProfile: vi.fn().mockResolvedValue({ filename: "old-scans.toml", content: recorded.export.body }),
            validateProfile: vi.fn().mockResolvedValue(recorded.validate_ok.body),
            importProfile: vi.fn().mockResolvedValue(recorded.import.body),
        },
    };
}

type Plugin = ReturnType<typeof makePlugin>;
const asPlugin = (plugin: Plugin) => plugin as unknown as LilbeePlugin;

let opened: Modal[];
let picked: FuzzySuggestModal<unknown>[];

beforeEach(() => {
    Notice.clear();
    opened = [];
    picked = [];
    vi.spyOn(Modal.prototype, "open").mockImplementation(function (this: Modal) {
        opened.push(this);
        this.onOpen();
    });
    vi.spyOn(FuzzySuggestModal.prototype, "open").mockImplementation(function (this: FuzzySuggestModal<unknown>) {
        picked.push(this);
    });
});

afterEach(() => vi.restoreAllMocks());

const notices = () => Notice.instances.map((n) => n.message);
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const lastEl = () => opened[opened.length - 1].contentEl as unknown as MockElement;

/** Click *label* in the newest modal once the flow has opened it. */
async function click(label: string): Promise<void> {
    await settle();
    button(lastEl(), label)!.trigger("click");
    await settle();
}

describe("profileErrorText", () => {
    it("prefers the server's detail, then the error's message, then the value itself", () => {
        expect(profileErrorText(refusal("error_missing"))).toBe("No profile named 'No such profile'");
        expect(profileErrorText(new Error("offline"))).toBe("offline");
        expect(profileErrorText("boom")).toBe("boom");
    });
});

describe("PROFILE_ACTION_ALLOWS", () => {
    const byName = (name: string, folder: string) => LIST.profiles.find((p) => p.name === name && p.folder === folder)!;

    it("keeps a shadowed profile out of every action, since its name reaches the project copy", () => {
        const shadowed = byName("Court filings", "global");
        for (const action of Object.values(PROFILE_ACTION)) expect(PROFILE_ACTION_ALLOWS[action](shadowed)).toBe(false);
    });

    it("lets a built-in be applied, duplicated and exported, never renamed or deleted", () => {
        const builtin = byName("Default", "builtin");
        expect(PROFILE_ACTION_ALLOWS.apply(builtin)).toBe(true);
        expect(PROFILE_ACTION_ALLOWS.duplicate(builtin)).toBe(true);
        expect(PROFILE_ACTION_ALLOWS.export(builtin)).toBe(true);
        expect(PROFILE_ACTION_ALLOWS.rename(builtin)).toBe(false);
        expect(PROFILE_ACTION_ALLOWS.delete(builtin)).toBe(false);
    });

    it("lets a broken file of the user's be deleted and nothing else", () => {
        const broken = byName("broken", "global");
        expect(Object.values(PROFILE_ACTION).filter((a) => PROFILE_ACTION_ALLOWS[a](broken))).toEqual(["delete"]);
    });

    it("lets a project profile take every action", () => {
        const project = byName("Court filings", "project");
        for (const action of Object.values(PROFILE_ACTION)) expect(PROFILE_ACTION_ALLOWS[action](project)).toBe(true);
    });
});

describe("loadProfiles and activeProfileName", () => {
    it("says the server has no profiles when the list route is missing", async () => {
        const plugin = makePlugin();
        plugin.api.listProfiles.mockResolvedValue(null);
        expect(await loadProfiles(asPlugin(plugin))).toBeNull();
        expect(await activeProfileName(asPlugin(plugin))).toBeNull();
        expect(notices()).toEqual([MESSAGES.NOTICE_PROFILES_UNSUPPORTED, MESSAGES.NOTICE_PROFILES_UNSUPPORTED]);
        expect(plugin.api.activeProfile).not.toHaveBeenCalled();
    });

    it("reports a failed read", async () => {
        const plugin = makePlugin();
        plugin.api.listProfiles.mockRejectedValue(new Error("offline"));
        expect(await loadProfiles(asPlugin(plugin))).toBeNull();
        expect(notices()).toEqual([MESSAGES.ERROR_PROFILE_LOAD("offline")]);
    });

    it("names the active profile, or reports why it cannot", async () => {
        const plugin = makePlugin();
        expect(await activeProfileName(asPlugin(plugin))).toBe("Default");
        plugin.api.activeProfile.mockRejectedValue(new Error("offline"));
        expect(await activeProfileName(asPlugin(plugin))).toBeNull();
        expect(notices()).toEqual([MESSAGES.ERROR_PROFILE_LOAD("offline")]);
    });
});

describe("chooseProfile", () => {
    it("shows the server's diff and applies with a reindex when the user picks Apply and reindex", async () => {
        const plugin = makePlugin();
        const onDone = vi.fn();
        const flow = chooseProfile(asPlugin(plugin), "Notes and markdown", onDone);
        await click(MESSAGES.BUTTON_PROFILE_APPLY_REINDEX);
        await flow;
        expect(plugin.api.profileDiff).toHaveBeenCalledWith("Notes and markdown");
        expect(plugin.api.applyProfile).toHaveBeenCalledWith("Notes and markdown");
        expect(plugin.triggerSync).toHaveBeenCalledWith({ forceRebuild: true });
        expect(notices()).toContain(MESSAGES.NOTICE_PROFILE_APPLIED("Notes and markdown"));
        expect(onDone).toHaveBeenCalled();
    });

    it("applies without a rebuild when the user picks Apply", async () => {
        const plugin = makePlugin();
        const flow = chooseProfile(asPlugin(plugin), "Notes and markdown");
        await click(MESSAGES.BUTTON_PROFILE_APPLY);
        await flow;
        expect(plugin.api.applyProfile).toHaveBeenCalled();
        expect(plugin.triggerSync).not.toHaveBeenCalled();
    });

    it("changes nothing when the user cancels", async () => {
        const plugin = makePlugin();
        const onDone = vi.fn();
        const flow = chooseProfile(asPlugin(plugin), "Notes and markdown", onDone);
        await click(MESSAGES.BUTTON_CANCEL);
        await flow;
        expect(plugin.api.applyProfile).not.toHaveBeenCalled();
        expect(onDone).not.toHaveBeenCalled();
    });

    it("reports a diff the server refuses and opens no modal", async () => {
        const plugin = makePlugin();
        plugin.api.profileDiff.mockRejectedValue(refusal("error_missing"));
        await chooseProfile(asPlugin(plugin), "No such profile");
        expect(opened).toHaveLength(0);
        expect(notices()).toEqual([MESSAGES.ERROR_PROFILE_ACTION("No profile named 'No such profile'")]);
    });

    it("reports a failed apply and skips onDone", async () => {
        const plugin = makePlugin();
        plugin.api.applyProfile.mockRejectedValue(new Error("offline"));
        const onDone = vi.fn();
        const flow = chooseProfile(asPlugin(plugin), "Notes and markdown", onDone);
        await click(MESSAGES.BUTTON_PROFILE_APPLY);
        await flow;
        expect(notices()).toEqual([MESSAGES.ERROR_PROFILE_ACTION("offline")]);
        expect(onDone).not.toHaveBeenCalled();
    });
});

/** Type *name* into the open name dialog and press Save. */
async function saveName(name: string): Promise<void> {
    lastEl().find("lilbee-profile-name")!.value = name;
    await click(MESSAGES.BUTTON_PROFILE_SAVE);
}

describe("name-dialog flows", () => {
    it("save as sends the name to all projects by default and reports the saved path", async () => {
        const plugin = makePlugin();
        const onDone = vi.fn();
        saveProfileAs(asPlugin(plugin), "Notes and markdown", onDone);
        await saveName("My notes");
        expect(plugin.api.saveProfile).toHaveBeenCalledWith("My notes", PROFILE_FOLDER.GLOBAL);
        expect(notices()).toEqual([MESSAGES.NOTICE_PROFILE_SAVED("My notes", "<project>/profiles/my-notes.toml")]);
        expect(onDone).toHaveBeenCalled();
    });

    it("save as sends the folder the user picks", async () => {
        const plugin = makePlugin();
        saveProfileAs(asPlugin(plugin), "Notes and markdown");
        const select = lastEl().find("lilbee-profile-target")!;
        select.value = PROFILE_FOLDER.PROJECT;
        select.trigger("change");
        await saveName("My notes");
        expect(plugin.api.saveProfile).toHaveBeenCalledWith("My notes", PROFILE_FOLDER.PROJECT);
    });

    it("save as keeps a refused name in the dialog", async () => {
        const plugin = makePlugin();
        plugin.api.saveProfile.mockRejectedValue(refusal("error_reserved"));
        const onDone = vi.fn();
        saveProfileAs(asPlugin(plugin), "Default", onDone);
        await saveName("active");
        expect(lastEl().find("lilbee-profile-name-error")?.textContent).toBe(
            "Reserved name: active cannot name a profile",
        );
        expect(onDone).not.toHaveBeenCalled();
    });

    it("duplicate sends the source, the new name and the folder", async () => {
        const plugin = makePlugin();
        duplicateProfile(asPlugin(plugin), "Scanned archive");
        await saveName("Scans");
        expect(plugin.api.duplicateProfile).toHaveBeenCalledWith("Scanned archive", "Scans", PROFILE_FOLDER.GLOBAL);
        expect(notices()).toEqual([MESSAGES.NOTICE_PROFILE_DUPLICATED("Scans")]);
    });

    it("rename asks for no folder and sends the new name", async () => {
        const plugin = makePlugin();
        renameProfile(asPlugin(plugin), "Scans");
        expect(lastEl().find("lilbee-profile-target")).toBeNull();
        await saveName("Old scans");
        expect(plugin.api.renameProfile).toHaveBeenCalledWith("Scans", "Old scans");
        expect(notices()).toEqual([MESSAGES.NOTICE_PROFILE_RENAMED("Old scans")]);
    });
});

describe("update, discard and delete", () => {
    it("update writes the active profile and reports it", async () => {
        const plugin = makePlugin();
        const onDone = vi.fn();
        await updateProfile(asPlugin(plugin), "My notes", onDone);
        expect(plugin.api.updateProfile).toHaveBeenCalledWith("My notes");
        expect(notices()).toEqual([MESSAGES.NOTICE_PROFILE_UPDATED("My notes")]);
        expect(onDone).toHaveBeenCalled();
    });

    it("update reports a built-in's refusal", async () => {
        const plugin = makePlugin();
        plugin.api.updateProfile.mockRejectedValue(refusal("error_builtin"));
        await updateProfile(asPlugin(plugin), "Default");
        expect(notices()).toEqual([
            MESSAGES.ERROR_PROFILE_ACTION("Default ships with lilbee and cannot be changed; duplicate it instead"),
        ]);
    });

    it("discard says whose values show through, or that there was nothing to discard", async () => {
        const plugin = makePlugin();
        plugin.api.discardProfileChanges.mockResolvedValue({ dropped: ["chunk_overlap"], reindex_required: false });
        await discardProfileChanges(asPlugin(plugin), "My notes");
        plugin.api.discardProfileChanges.mockResolvedValue({ dropped: [] });
        await discardProfileChanges(asPlugin(plugin), "My notes");
        expect(notices()).toEqual([
            MESSAGES.NOTICE_PROFILE_DISCARDED("My notes"),
            MESSAGES.NOTICE_PROFILE_NOTHING_TO_DISCARD,
        ]);
        expect(plugin.triggerSync).not.toHaveBeenCalled();
    });

    it("asks before a rebuild the discard needs, and rebuilds only when confirmed", async () => {
        const plugin = makePlugin();
        plugin.api.discardProfileChanges.mockResolvedValue({ dropped: ["chunk_size"], reindex_required: true });

        const cancelled = discardProfileChanges(asPlugin(plugin), "My notes");
        await settle();
        expect(lastEl().textContent).toContain(MESSAGES.CONFIRM_PROFILE_DISCARD_REINDEX("My notes"));
        await click(MESSAGES.BUTTON_CANCEL);
        await cancelled;
        expect(plugin.triggerSync).not.toHaveBeenCalled();

        const confirmed = discardProfileChanges(asPlugin(plugin), "My notes");
        await click(MESSAGES.BUTTON_CONTINUE);
        await confirmed;
        expect(plugin.triggerSync).toHaveBeenCalledWith({ forceRebuild: true });
        expect(notices()).toEqual([
            MESSAGES.NOTICE_PROFILE_DISCARDED("My notes"),
            MESSAGES.NOTICE_PROFILE_DISCARDED("My notes"),
        ]);
    });

    it("discard runs no rebuild against a server that predates reindex_required", async () => {
        const plugin = makePlugin();
        plugin.api.discardProfileChanges.mockResolvedValue({ dropped: ["chunk_size"] });
        await discardProfileChanges(asPlugin(plugin), "My notes");
        expect(plugin.triggerSync).not.toHaveBeenCalled();
    });

    it("discard reports its refusal and asks nothing", async () => {
        const plugin = makePlugin();
        plugin.api.discardProfileChanges.mockRejectedValue(new Error("offline"));
        await discardProfileChanges(asPlugin(plugin), "My notes");
        expect(notices()).toEqual([MESSAGES.ERROR_PROFILE_ACTION("offline")]);
        expect(plugin.triggerSync).not.toHaveBeenCalled();
        expect(opened).toHaveLength(0);
    });

    it("delete asks first and removes the file only on Continue", async () => {
        const plugin = makePlugin();
        const cancelled = deleteProfile(asPlugin(plugin), "Old scans");
        await click(MESSAGES.BUTTON_CANCEL);
        await cancelled;
        expect(plugin.api.deleteProfile).not.toHaveBeenCalled();

        const confirmed = deleteProfile(asPlugin(plugin), "Old scans");
        await click(MESSAGES.BUTTON_CONTINUE);
        await confirmed;
        expect(plugin.api.deleteProfile).toHaveBeenCalledWith("Old scans");
        expect(notices()).toEqual([MESSAGES.NOTICE_PROFILE_DELETED("Old scans")]);
    });
});

describe("exportProfile", () => {
    it("writes the server's text to the file the user picks, named as the server names it", async () => {
        const plugin = makePlugin();
        const save = vi
            .spyOn(electronDialog, "showSaveDialog")
            .mockResolvedValue({ canceled: false, filePath: "/x/o.toml" });
        const write = vi.spyOn(node, "writeFileSync").mockImplementation(() => undefined);
        await exportProfile(asPlugin(plugin), "Old scans");
        expect(save.mock.calls[0][0]).toMatchObject({ defaultPath: "old-scans.toml" });
        expect(write).toHaveBeenCalledWith("/x/o.toml", recorded.export.body, "utf8");
        expect(notices()).toEqual([MESSAGES.NOTICE_PROFILE_EXPORTED("/x/o.toml")]);
    });

    it("falls back to the profile's name when the server names no file, and writes nothing on cancel", async () => {
        const plugin = makePlugin();
        plugin.api.exportProfile.mockResolvedValue({ filename: null, content: "[values]\n" });
        const save = vi.spyOn(electronDialog, "showSaveDialog").mockResolvedValue({ canceled: true });
        const write = vi.spyOn(node, "writeFileSync");
        await exportProfile(asPlugin(plugin), "Mine");
        expect(save.mock.calls[0][0]).toMatchObject({ defaultPath: "Mine.toml" });
        expect(write).not.toHaveBeenCalled();
    });

    it("reports a refused export and a failed write", async () => {
        const plugin = makePlugin();
        plugin.api.exportProfile.mockRejectedValueOnce(refusal("error_missing"));
        await exportProfile(asPlugin(plugin), "No such profile");
        vi.spyOn(electronDialog, "showSaveDialog").mockResolvedValue({ canceled: false, filePath: "/ro/o.toml" });
        vi.spyOn(node, "writeFileSync").mockImplementation(() => {
            throw new Error("EACCES");
        });
        await exportProfile(asPlugin(plugin), "Old scans");
        expect(notices()).toEqual([
            MESSAGES.ERROR_PROFILE_ACTION("No profile named 'No such profile'"),
            MESSAGES.ERROR_PROFILE_WRITE("EACCES"),
        ]);
    });
});

describe("importProfile", () => {
    function pickFile(size = 120, content = "[values]\n") {
        vi.spyOn(electronDialog, "showOpenDialog").mockResolvedValue({
            canceled: false,
            filePaths: ["/in/court.toml"],
        });
        vi.spyOn(node, "statSync").mockReturnValue({ size } as never);
        return vi.spyOn(node, "readFileSync").mockReturnValue(content as never);
    }

    it("checks the file against the folder the user picks, then copies it in", async () => {
        const plugin = makePlugin();
        pickFile();
        const onDone = vi.fn();
        const flow = importProfile(asPlugin(plugin), onDone);
        await click(PROFILE_FOLDER_LABELS.project);
        await flow;
        expect(plugin.api.validateProfile).toHaveBeenCalledWith("[values]\n", "court.toml", PROFILE_FOLDER.PROJECT);
        expect(plugin.api.importProfile).toHaveBeenCalledWith("[values]\n", "court.toml", PROFILE_FOLDER.PROJECT);
        expect(notices()).toEqual([MESSAGES.NOTICE_PROFILE_IMPORTED("Old scans")]);
        expect(onDone).toHaveBeenCalled();
    });

    it("lists every problem and copies nothing for a file lilbee cannot use", async () => {
        const plugin = makePlugin();
        plugin.api.validateProfile.mockResolvedValue(recorded.validate_bad.body);
        pickFile();
        const flow = importProfile(asPlugin(plugin));
        await click(PROFILE_FOLDER_LABELS.global);
        await flow;
        expect(plugin.api.importProfile).not.toHaveBeenCalled();
        expect(notices()).toEqual([MESSAGES.ERROR_PROFILE_INVALID("Profiles cannot set chat_model")]);
    });

    it("refuses a file over the server's cap before reading it", async () => {
        const plugin = makePlugin();
        const read = pickFile(PROFILE_MAX_BYTES + 1);
        void importProfile(asPlugin(plugin));
        await settle();
        expect(read).not.toHaveBeenCalled();
        expect(notices()).toEqual([MESSAGES.ERROR_PROFILE_TOO_LARGE(256)]);
    });

    it("reads a file exactly at the cap", async () => {
        const plugin = makePlugin();
        const read = pickFile(PROFILE_MAX_BYTES);
        const flow = importProfile(asPlugin(plugin));
        await click(MESSAGES.BUTTON_CANCEL);
        await flow;
        expect(read).toHaveBeenCalled();
        expect(plugin.api.validateProfile).not.toHaveBeenCalled();
    });

    it("does nothing when the user picks no file", async () => {
        const plugin = makePlugin();
        vi.spyOn(electronDialog, "showOpenDialog").mockResolvedValue({ canceled: true, filePaths: [] });
        await importProfile(asPlugin(plugin));
        expect(opened).toHaveLength(0);
    });

    it("reports a file it cannot read and a check the server cannot run", async () => {
        const plugin = makePlugin();
        vi.spyOn(electronDialog, "showOpenDialog").mockResolvedValue({ canceled: false, filePaths: ["/in/x.toml"] });
        vi.spyOn(node, "statSync").mockImplementation(() => {
            throw new Error("ENOENT");
        });
        await importProfile(asPlugin(plugin));
        pickFile();
        plugin.api.validateProfile.mockRejectedValue(refusal("error_too_large"));
        const flow = importProfile(asPlugin(plugin));
        await click(PROFILE_FOLDER_LABELS.global);
        await flow;
        expect(notices()).toEqual([
            MESSAGES.ERROR_PROFILE_READ("ENOENT"),
            MESSAGES.ERROR_PROFILE_ACTION("The file is over 256 KB, too large for a profile file"),
        ]);
    });

    it("reports a name clash on import", async () => {
        const plugin = makePlugin();
        plugin.api.importProfile.mockRejectedValue(refusal("error_clash"));
        pickFile();
        const flow = importProfile(asPlugin(plugin));
        await click(PROFILE_FOLDER_LABELS.global);
        await flow;
        expect(notices()[0]).toContain("A profile named Old scans already exists");
    });
});

describe("pickProfileFor", () => {
    it("offers only the profiles the action takes and runs on the pick", async () => {
        const plugin = makePlugin();
        const run = vi.fn();
        await pickProfileFor(asPlugin(plugin), PROFILE_ACTION.RENAME, run);
        const picker = picked[0] as ProfilePickerModal;
        expect(picker.getItems().map((e) => `${e.name}/${e.folder}`)).toEqual(["Court filings/project"]);
        expect(picker.getItemText(picker.getItems()[0])).toBe(`Court filings (${PROFILE_FOLDER_LABELS.project})`);
        picker.onChooseItem(picker.getItems()[0]);
        expect(run).toHaveBeenCalledWith(picker.getItems()[0]);
    });

    it("shows a folder an old server names that this build doesn't know as its own text", async () => {
        const plugin = makePlugin();
        await pickProfileFor(asPlugin(plugin), PROFILE_ACTION.RENAME, vi.fn());
        const picker = picked[0] as ProfilePickerModal;
        const unknown = { ...picker.getItems()[0], folder: "community" as ProfileFolder };
        expect(picker.getItemText(unknown)).toBe("Court filings (community)");
    });

    it("opens no picker on a server without profiles", async () => {
        const plugin = makePlugin();
        plugin.api.listProfiles.mockResolvedValue(null);
        await pickProfileFor(asPlugin(plugin), PROFILE_ACTION.APPLY, vi.fn());
        expect(picked).toHaveLength(0);
    });
});
