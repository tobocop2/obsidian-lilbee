import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { App, Modal, Notice } from "obsidian";
import type { MockElement } from "../__mocks__/obsidian";
import { ProfileLibraryModal } from "../../src/views/profile-library-modal";
import { MESSAGES, PROFILE_FOLDER_LABELS } from "../../src/locales/en";
import { electronDialog } from "../../src/utils/file-dialog";
import { node } from "../../src/node";
import type LilbeePlugin from "../../src/main";
import type { ProfileFolder } from "../../src/types";
import { ACTIVE_SAVED, LIST, button, buttonLabels } from "../profile-fixtures";
import recorded from "../fixtures/profile-responses.json";

function makePlugin() {
    return {
        app: new App(),
        api: {
            listProfiles: vi.fn().mockResolvedValue(LIST),
            activeProfile: vi.fn().mockResolvedValue({ ...ACTIVE_SAVED, name: "Court filings" }),
            duplicateProfile: vi.fn().mockResolvedValue(recorded.duplicate.body),
            renameProfile: vi.fn().mockResolvedValue(recorded.rename.body),
            deleteProfile: vi.fn().mockResolvedValue(recorded.delete.body),
            exportProfile: vi.fn().mockResolvedValue({ filename: "x.toml", content: "" }),
        },
    };
}

let opened: Modal[];
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
    Notice.clear();
    opened = [];
    vi.spyOn(Modal.prototype, "open").mockImplementation(function (this: Modal) {
        opened.push(this);
        this.onOpen();
    });
});
afterEach(() => vi.restoreAllMocks());

async function openLibrary(plugin = makePlugin(), onChanged?: () => void) {
    const modal = new ProfileLibraryModal(plugin as unknown as LilbeePlugin, onChanged);
    modal.open();
    await settle();
    const el = modal.contentEl as unknown as MockElement;
    const rowOf = (name: string, folder: string) =>
        el
            .findAll("lilbee-profile-library-row")
            .find(
                (row) =>
                    row.find("lilbee-profile-library-name")!.textContent.startsWith(name) &&
                    row.textContent.includes(PROFILE_FOLDER_LABELS[folder as "project"]),
            )!;
    return { modal, el, plugin, rowOf };
}

describe("ProfileLibraryModal", () => {
    it("lists every profile with its folder, the active one marked", async () => {
        const { el } = await openLibrary();
        const names = el.findAll("lilbee-profile-library-name").map((n) => n.textContent);
        expect(names).toContain(`Court filings${PROFILE_FOLDER_LABELS.project}${MESSAGES.PROFILE_ACTIVE_MARK}`);
        expect(names).toContain(`Court filings${PROFILE_FOLDER_LABELS.global}`);
        expect(names).toContain(`Default${PROFILE_FOLDER_LABELS.builtin}`);
        expect(names).toHaveLength(LIST.profiles.length);
    });

    it("marks the shadowed copy and gives it no actions", async () => {
        const { rowOf } = await openLibrary();
        const shadowed = rowOf("Court filings", "global");
        expect(shadowed.find("lilbee-profile-state")?.textContent).toBe(
            MESSAGES.PROFILE_SHADOWED(PROFILE_FOLDER_LABELS.project),
        );
        expect(buttonLabels(shadowed)).toEqual([]);
    });

    it("shows a broken file's reason and offers only Delete", async () => {
        const { rowOf } = await openLibrary();
        const broken = rowOf("broken", "global");
        expect(broken.find("lilbee-profile-state")?.textContent).toBe(
            MESSAGES.PROFILE_BROKEN("Profiles cannot set chat_model"),
        );
        expect(buttonLabels(broken)).toEqual([MESSAGES.BUTTON_PROFILE_DELETE]);
    });

    it("offers a built-in Duplicate and Export, and the user's own profile every action", async () => {
        const { rowOf } = await openLibrary();
        expect(buttonLabels(rowOf("Default", "builtin"))).toEqual([
            MESSAGES.BUTTON_PROFILE_DUPLICATE,
            MESSAGES.BUTTON_PROFILE_EXPORT,
        ]);
        expect(buttonLabels(rowOf("Court filings", "project"))).toEqual([
            MESSAGES.BUTTON_PROFILE_DUPLICATE,
            MESSAGES.BUTTON_PROFILE_RENAME,
            MESSAGES.BUTTON_PROFILE_DELETE,
            MESSAGES.BUTTON_PROFILE_EXPORT,
        ]);
        expect(rowOf("Court filings", "project").find("lilbee-profile-credit")?.textContent).toContain(
            "by Jane Doe (@janedoe)",
        );
    });

    it("runs each row action on that row's profile and reloads after a change", async () => {
        const onChanged = vi.fn();
        const { plugin, rowOf } = await openLibrary(makePlugin(), onChanged);
        button(rowOf("Court filings", "project"), MESSAGES.BUTTON_PROFILE_RENAME)!.trigger("click");
        const dialog = opened[opened.length - 1].contentEl as unknown as MockElement;
        dialog.find("lilbee-profile-name")!.value = "Court (old)";
        button(dialog, MESSAGES.BUTTON_PROFILE_SAVE)!.trigger("click");
        await settle();
        await settle();
        expect(plugin.api.renameProfile).toHaveBeenCalledWith("Court filings", "Court (old)");
        expect(onChanged).toHaveBeenCalledTimes(1);
        expect(plugin.api.listProfiles).toHaveBeenCalledTimes(2);
    });

    it("duplicates, deletes and exports the row's profile", async () => {
        const { plugin, rowOf } = await openLibrary();
        vi.spyOn(electronDialog, "showSaveDialog").mockResolvedValue({ canceled: true });
        button(rowOf("Default", "builtin"), MESSAGES.BUTTON_PROFILE_EXPORT)!.trigger("click");
        button(rowOf("Default", "builtin"), MESSAGES.BUTTON_PROFILE_DUPLICATE)!.trigger("click");
        expect((opened[opened.length - 1].contentEl as unknown as MockElement).textContent).toContain(
            MESSAGES.PROFILE_DUPLICATE_TITLE("Default"),
        );
        button(rowOf("broken", "global"), MESSAGES.BUTTON_PROFILE_DELETE)!.trigger("click");
        await settle();
        expect((opened[opened.length - 1].contentEl as unknown as MockElement).textContent).toContain(
            MESSAGES.CONFIRM_DELETE_PROFILE("broken"),
        );
        expect(plugin.api.exportProfile).toHaveBeenCalledWith("Default");
    });

    it("imports from its Import button and reloads once the file is in", async () => {
        const plugin = makePlugin();
        Object.assign(plugin.api, {
            validateProfile: vi.fn().mockResolvedValue(recorded.validate_ok.body),
            importProfile: vi.fn().mockResolvedValue(recorded.import.body),
        });
        const onChanged = vi.fn();
        const { el } = await openLibrary(plugin, onChanged);
        vi.spyOn(electronDialog, "showOpenDialog").mockResolvedValue({ canceled: false, filePaths: ["/in/a.toml"] });
        vi.spyOn(node, "statSync").mockReturnValue({ size: 10 } as never);
        vi.spyOn(node, "readFileSync").mockReturnValue("[values]\n" as never);
        button(el, MESSAGES.BUTTON_PROFILE_IMPORT)!.trigger("click");
        await settle();
        const ask = opened[opened.length - 1].contentEl as unknown as MockElement;
        button(ask, PROFILE_FOLDER_LABELS.global)!.trigger("click");
        await settle();
        await settle();
        expect(plugin.api.importProfile).toHaveBeenCalledWith("[values]\n", "a.toml", "global");
        expect(onChanged).toHaveBeenCalled();
        expect(plugin.api.listProfiles).toHaveBeenCalledTimes(2);
    });

    it("lists nothing and says why on a server without profiles", async () => {
        const plugin = makePlugin();
        plugin.api.listProfiles.mockResolvedValue(null);
        const { el } = await openLibrary(plugin);
        expect(el.findAll("lilbee-profile-library-row")).toHaveLength(0);
        expect(Notice.instances.map((n) => n.message)).toEqual([MESSAGES.NOTICE_PROFILES_UNSUPPORTED]);
    });

    it("shows a folder an old server names that this build doesn't know, without a special pill", async () => {
        const plugin = makePlugin();
        const unknown = {
            ...LIST.profiles[0],
            name: "Vintage",
            folder: "community" as ProfileFolder,
            shadowed_by: null,
        };
        plugin.api.listProfiles.mockResolvedValue({ profiles: [unknown] });
        const { el } = await openLibrary(plugin);
        const row = el.findAll("lilbee-profile-library-row")[0];
        expect(row.find("lilbee-profile-library-name")?.textContent).toBe("Vintagecommunity");
        expect(row.textContent).not.toContain("Community");
    });

    it("still lists the profiles when the active profile cannot be read", async () => {
        const plugin = makePlugin();
        plugin.api.activeProfile.mockRejectedValue(new Error("offline"));
        const { el } = await openLibrary(plugin);
        expect(el.findAll("lilbee-pill-profile-active")).toHaveLength(0);
        expect(el.findAll("lilbee-profile-library-row")).toHaveLength(LIST.profiles.length);
    });
});
