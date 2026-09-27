import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { App, Modal, Notice, Setting } from "obsidian";
import { MockElement } from "../__mocks__/obsidian";
import { ProfileGroup } from "../../src/components/profile-group";
import { MESSAGES, PROFILE_FOLDER_NOTES, PROFILE_STATUS_NOTES } from "../../src/locales/en";
import type LilbeePlugin from "../../src/main";
import { ProfileLibraryModal } from "../../src/views/profile-library-modal";
import {
    ACTIVE_APPLIED,
    ACTIVE_DEFAULT,
    ACTIVE_SAVED,
    DIFF,
    DIFF_ACTIVE,
    DIFF_SAVED,
    LIST,
    byTag,
    refusal,
    withoutChanges,
} from "../profile-fixtures";
import recorded from "../fixtures/profile-responses.json";

type Button = { text: string; triggerClick: () => void };
type Dropdown = { options: string[]; getValue: () => string; triggerChange: (v: string) => void };

let buttons: Button[];
let dropdowns: Dropdown[];
let opened: Modal[];

beforeEach(() => {
    Notice.clear();
    buttons = [];
    dropdowns = [];
    opened = [];
    const addButton = Setting.prototype.addButton;
    vi.spyOn(Setting.prototype, "addButton").mockImplementation(function (this: Setting, cb) {
        return addButton.call(this, (b) => {
            cb(b);
            buttons.push(b as unknown as Button);
        });
    });
    const addDropdown = Setting.prototype.addDropdown;
    vi.spyOn(Setting.prototype, "addDropdown").mockImplementation(function (this: Setting, cb) {
        return addDropdown.call(this, (d) => {
            cb(d);
            dropdowns.push(d as unknown as Dropdown);
        });
    });
    vi.spyOn(Modal.prototype, "open").mockImplementation(function (this: Modal) {
        opened.push(this);
        this.onOpen();
    });
});
afterEach(() => vi.restoreAllMocks());

function makePlugin(active = ACTIVE_APPLIED, diff = DIFF_ACTIVE) {
    return {
        app: new App(),
        triggerSync: vi.fn(),
        api: {
            listProfiles: vi.fn().mockResolvedValue(LIST),
            activeProfile: vi.fn().mockResolvedValue(active),
            profileDiff: vi.fn().mockResolvedValue(diff),
            getProfile: vi.fn().mockResolvedValue(LIST.profiles[0]),
            config: vi.fn().mockResolvedValue({ chunk_size: 500, chunk_overlap: 80 }),
            applyProfile: vi.fn().mockResolvedValue(recorded.apply.body),
            updateProfile: vi.fn().mockResolvedValue(recorded.update.body),
            discardProfileChanges: vi.fn().mockResolvedValue(recorded.discard.body),
        },
    };
}

async function mounted(plugin = makePlugin(), heading = false) {
    const onChanged = vi.fn();
    const onVisibility = vi.fn();
    const group = new ProfileGroup(plugin as unknown as LilbeePlugin, onChanged, onVisibility);
    const container = new MockElement();
    group.mount(container as unknown as HTMLElement, heading);
    await group.load();
    return { group, container, onChanged, onVisibility, plugin };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const labels = () => buttons.map((b) => b.text);
const clickButton = (label: string) => buttons.find((b) => b.text === label)!.triggerClick();

describe("ProfileGroup", () => {
    it("stays hidden and draws nothing on a server without profiles", async () => {
        const plugin = makePlugin();
        plugin.api.listProfiles.mockResolvedValue(null);
        const { group, container, onVisibility } = await mounted(plugin);
        expect(group.visible()).toBe(false);
        expect(container.find("lilbee-profile-body")!.children).toHaveLength(0);
        expect(onVisibility).toHaveBeenCalled();
        expect(plugin.api.activeProfile).not.toHaveBeenCalled();
    });

    it("stays hidden when the server cannot read the profiles", async () => {
        const plugin = makePlugin();
        plugin.api.activeProfile.mockRejectedValue(new Error("offline"));
        const { group } = await mounted(plugin);
        expect(group.visible()).toBe(false);
    });

    it("is hidden until the first load answers", () => {
        const group = new ProfileGroup(makePlugin() as unknown as LilbeePlugin, vi.fn(), vi.fn());
        expect(group.visible()).toBe(false);
    });

    it("offers every usable profile in the dropdown, set to the active one", async () => {
        const { group } = await mounted();
        expect(group.visible()).toBe(true);
        expect(dropdowns[0].options).toEqual([
            "Court filings",
            "Code repository",
            "Default",
            "Notes and markdown",
            "Research papers",
            "Scanned archive",
        ]);
        expect(dropdowns[0].getValue()).toBe("Notes and markdown");
    });

    it("keeps an active profile the dropdown would not otherwise list", async () => {
        await mounted(makePlugin({ ...ACTIVE_APPLIED, name: "Gone", status: "missing", profile: null }, DIFF_ACTIVE));
        expect(dropdowns[0].options[0]).toBe("Gone");
    });

    it("shows the active profile's description, folder and file state", async () => {
        const { container } = await mounted(makePlugin({ ...ACTIVE_APPLIED, status: "changed" }));
        expect(container.find("lilbee-profile-description")?.textContent).toBe(ACTIVE_APPLIED.profile!.description);
        expect(container.find("lilbee-profile-folder")?.textContent).toBe(PROFILE_FOLDER_NOTES.builtin);
        expect(container.find("lilbee-profile-status")?.textContent).toBe(PROFILE_STATUS_NOTES.changed);
    });

    it("shows the values of yours the active profile lists, with their reindex cost, without reading a separate diff", async () => {
        const { container, plugin } = await mounted();
        expect(plugin.api.profileDiff).not.toHaveBeenCalled();
        const rows = byTag(container, "tr").map((tr) => tr.children.map((td) => td.textContent));
        expect(rows).toEqual([
            [
                MESSAGES.PROFILE_COL_SETTING,
                MESSAGES.PROFILE_COL_YOURS,
                MESSAGES.PROFILE_COL_PROFILE,
                MESSAGES.PROFILE_COL_COST,
            ],
            ["chunk_size", "500", "384", "reindex"],
        ]);
        expect(container.find("lilbee-profile-changes-help")?.textContent).toBe(
            MESSAGES.PROFILE_CHANGES_HELP("Notes and markdown"),
        );
    });

    it("shows the values of yours that override the built-in default, under no applied profile", async () => {
        const { container, plugin } = await mounted(makePlugin(ACTIVE_DEFAULT));
        expect(plugin.api.profileDiff).not.toHaveBeenCalled();
        const rows = byTag(container, "tr").map((tr) => tr.children.map((td) => td.textContent));
        expect(rows).toEqual([
            [
                MESSAGES.PROFILE_COL_SETTING,
                MESSAGES.PROFILE_COL_YOURS,
                MESSAGES.PROFILE_COL_PROFILE,
                MESSAGES.PROFILE_COL_COST,
            ],
            ["chunk_size", "500", "512", "reindex"],
        ]);
    });

    it("says none of yours override the profile when the active profile lists no changes", async () => {
        const { container } = await mounted(makePlugin({ ...ACTIVE_DEFAULT, changes: [] }));
        expect(byTag(container, "table")).toHaveLength(0);
        expect(container.find("lilbee-profile-changes-help")?.textContent).toBe(
            MESSAGES.PROFILE_CHANGES_NONE("Default"),
        );
    });

    it("falls back to the diff's kept list on a server that predates active.changes", async () => {
        const { container, plugin } = await mounted(makePlugin(withoutChanges(ACTIVE_APPLIED), DIFF_ACTIVE));
        expect(plugin.api.profileDiff).toHaveBeenCalledWith("Notes and markdown");
        const rows = byTag(container, "tr").map((tr) => tr.children.map((td) => td.textContent));
        expect(rows).toEqual([
            [MESSAGES.PROFILE_COL_SETTING, MESSAGES.PROFILE_COL_YOURS, MESSAGES.PROFILE_COL_PROFILE],
            ["chunk_size", "500", "384"],
        ]);
    });

    it("shows no changes on a legacy server whose diff is refused", async () => {
        const plugin = makePlugin(withoutChanges({ ...ACTIVE_APPLIED, status: "broken" }));
        plugin.api.profileDiff.mockRejectedValue(refusal("error_missing"));
        const { group, container } = await mounted(plugin);
        expect(group.visible()).toBe(true);
        expect(byTag(container, "table")).toHaveLength(0);
    });

    it("offers Update only for the user's own current profile", async () => {
        await mounted(makePlugin(ACTIVE_SAVED, DIFF_SAVED));
        expect(labels()).toEqual([
            MESSAGES.BUTTON_PROFILE_UPDATE("My notes"),
            MESSAGES.BUTTON_PROFILE_SAVE_AS,
            MESSAGES.BUTTON_PROFILE_DISCARD,
            MESSAGES.BUTTON_PROFILE_MANAGE,
        ]);
        buttons = [];
        await mounted(makePlugin({ ...ACTIVE_SAVED, status: "changed" }, DIFF_SAVED));
        expect(labels()).toEqual([
            MESSAGES.BUTTON_PROFILE_REAPPLY("My notes"),
            MESSAGES.BUTTON_PROFILE_SAVE_AS,
            MESSAGES.BUTTON_PROFILE_DISCARD,
            MESSAGES.BUTTON_PROFILE_MANAGE,
        ]);
        buttons = [];
        await mounted(makePlugin(ACTIVE_DEFAULT));
        expect(labels()).toEqual([
            MESSAGES.BUTTON_PROFILE_SAVE_AS,
            MESSAGES.BUTTON_PROFILE_DISCARD,
            MESSAGES.BUTTON_PROFILE_MANAGE,
        ]);
    });

    it("hides Update and Discard when the active profile has no changes", async () => {
        await mounted(makePlugin({ ...ACTIVE_SAVED, changes: [] }, DIFF_SAVED));
        expect(labels()).toEqual([MESSAGES.BUTTON_PROFILE_SAVE_AS, MESSAGES.BUTTON_PROFILE_MANAGE]);
    });

    it("choosing another profile opens the Apply modal on the server's diff and applies it", async () => {
        const { plugin, onChanged } = await mounted();
        plugin.api.profileDiff.mockResolvedValue(DIFF);
        dropdowns[0].triggerChange("Court filings");
        await settle();
        const modal = opened[0].contentEl as unknown as MockElement;
        expect(modal.textContent).toContain(MESSAGES.PROFILE_APPLY_TITLE("Court filings"));
        byTag(modal, "button")
            .find((b) => b.textContent === MESSAGES.BUTTON_PROFILE_APPLY_REINDEX)!
            .trigger("click");
        await settle();
        await settle();
        expect(plugin.api.applyProfile).toHaveBeenCalledWith("Court filings");
        expect(plugin.triggerSync).toHaveBeenCalledWith({ forceRebuild: true });
        expect(onChanged).toHaveBeenCalled();
        expect(dropdowns[0].getValue()).toBe("Notes and markdown");
    });

    it("picking the active profile again opens nothing", async () => {
        const { plugin } = await mounted();
        dropdowns[0].triggerChange("Notes and markdown");
        await settle();
        expect(opened).toHaveLength(0);
        expect(plugin.api.getProfile).not.toHaveBeenCalled();
    });

    it("each action button runs its operation", async () => {
        const { plugin, onChanged } = await mounted(makePlugin(ACTIVE_SAVED, DIFF_SAVED));
        clickButton(MESSAGES.BUTTON_PROFILE_UPDATE("My notes"));
        clickButton(MESSAGES.BUTTON_PROFILE_DISCARD);
        await settle();
        expect(plugin.api.updateProfile).toHaveBeenCalledWith("My notes");
        expect(plugin.api.discardProfileChanges).toHaveBeenCalled();
        expect(onChanged).toHaveBeenCalledTimes(2);
        clickButton(MESSAGES.BUTTON_PROFILE_SAVE_AS);
        expect((opened.at(-1)!.contentEl as unknown as MockElement).textContent).toContain(MESSAGES.PROFILE_SAVE_TITLE);
        clickButton(MESSAGES.BUTTON_PROFILE_MANAGE);
        expect(opened.at(-1)).toBeInstanceOf(ProfileLibraryModal);
    });

    it("re-apply opens the Apply modal for the active profile", async () => {
        const { plugin } = await mounted(makePlugin({ ...ACTIVE_SAVED, status: "changed" }, DIFF_SAVED));
        clickButton(MESSAGES.BUTTON_PROFILE_REAPPLY("My notes"));
        await settle();
        expect(plugin.api.getProfile).toHaveBeenCalledWith("My notes");
        expect(opened).toHaveLength(1);
    });

    it("draws its own heading only when asked, and reuses its body on a re-mount", async () => {
        const { container, group } = await mounted(makePlugin(), true);
        expect(container.find("setting-item-heading")?.textContent).toBe(MESSAGES.LABEL_PROFILE_SECTION);
        group.mount(container as unknown as HTMLElement, false);
        expect(container.findAll("lilbee-profile-body")).toHaveLength(1);
        expect(container.find("setting-item-heading")).toBeNull();
    });

    it("loads without a mounted body to draw into", async () => {
        const group = new ProfileGroup(makePlugin() as unknown as LilbeePlugin, vi.fn(), vi.fn());
        await group.load();
        expect(group.visible()).toBe(true);
    });
});
