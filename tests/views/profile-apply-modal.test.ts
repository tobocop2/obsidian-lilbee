import { describe, it, expect } from "vitest";
import { App } from "obsidian";
import { MockElement } from "../__mocks__/obsidian";
import { ApplyProfileModal } from "../../src/views/profile-apply-modal";
import { MESSAGES } from "../../src/locales/en";
import { APPLY_CHOICE } from "../../src/types";
import type { ProfileDiffResponse } from "../../src/types";
import { ACTIVE_SAVED, DIFF, DIFF_ACTIVE, LIST, button, buttonLabels, byTag } from "../profile-fixtures";

const NOTES = LIST.profiles.find((p) => p.name === "Notes and markdown")!;
const COURT = LIST.profiles.find((p) => p.name === "Court filings")!;
const CONFIG = { chunk_size: 500, chunk_overlap: 100 };

function open(diff: ProfileDiffResponse, profile = NOTES): { modal: ApplyProfileModal; el: MockElement } {
    const modal = new ApplyProfileModal(new App() as never, { profile, diff, config: CONFIG });
    modal.open();
    return { modal, el: modal.contentEl as unknown as MockElement };
}

function rows(el: MockElement): string[][] {
    return byTag(el, "tr").map((tr) => tr.children.map((cell) => cell.textContent));
}

describe("ApplyProfileModal", () => {
    it("shows the server's changes with their cost, and a loud pill only for a reindex", () => {
        const { el } = open(DIFF);
        expect(rows(el)).toEqual([
            [
                MESSAGES.PROFILE_COL_SETTING,
                MESSAGES.PROFILE_COL_NOW,
                MESSAGES.PROFILE_COL_AFTER,
                MESSAGES.PROFILE_COL_COST,
            ],
            ["chunk_overlap", "100", "64", "reindex"],
            ["enable_ocr", "none", "off", "new files only"],
        ]);
        expect(el.findAll("lilbee-pill-reindex").map((p) => p.textContent)).toEqual(["reindex"]);
    });

    it("lists the user's values it keeps with the value they hold now", () => {
        const { el } = open(DIFF);
        expect(el.find("lilbee-profile-kept")?.textContent).toBe(`chunk_size 500${MESSAGES.PILL_SOURCE_USER}`);
    });

    it("says how many settings stay untouched and how many changes rebuild the index", () => {
        const { el } = open(DIFF);
        expect(el.find("lilbee-profile-untouched")?.textContent).toBe(
            MESSAGES.PROFILE_APPLY_UNTOUCHED(DIFF.untouched_count),
        );
        expect(el.find("lilbee-profile-summary")?.textContent).toBe(MESSAGES.PROFILE_APPLY_REINDEX(1));
    });

    it("counts every change that rebuilds the index", () => {
        const twoReindex = { ...DIFF, changes: DIFF.changes.map((row) => ({ ...row, effect: "reindex" as const })) };
        expect(open(twoReindex).el.find("lilbee-profile-summary")?.textContent).toBe("2 changes rebuild the index.");
    });

    it("offers Apply and reindex only when a change needs a reindex", () => {
        expect(buttonLabels(open(DIFF).el)).toEqual([
            MESSAGES.BUTTON_PROFILE_APPLY_REINDEX,
            MESSAGES.BUTTON_PROFILE_APPLY,
            MESSAGES.BUTTON_CANCEL,
        ]);
        const noReindex = { ...DIFF, changes: DIFF.changes.filter((row) => row.effect !== "reindex") };
        const { el } = open(noReindex);
        expect(buttonLabels(el)).toEqual([MESSAGES.BUTTON_PROFILE_APPLY, MESSAGES.BUTTON_CANCEL]);
        expect(el.find("lilbee-profile-summary")).toBeNull();
    });

    it("says nothing changes when the diff is empty, and shows no tables", () => {
        const { el } = open(DIFF_ACTIVE);
        expect(el.find("lilbee-profile-summary")?.textContent).toBe(MESSAGES.PROFILE_APPLY_NOTHING);
        expect(byTag(el, "table")).toHaveLength(0);
    });

    it("shows no kept line when the profile keeps none of the user's values", () => {
        const { el } = open({ ...DIFF, kept: [] });
        expect(el.find("lilbee-profile-kept")).toBeNull();
    });

    it("shows the profile's description and credit with what it was tested on", () => {
        const { el } = open(DIFF, COURT);
        expect(el.find("lilbee-profile-description")?.textContent).toBe(COURT.description);
        expect(el.find("lilbee-profile-credit")?.textContent).toBe(
            `by Jane Doe (@janedoe). ${MESSAGES.PROFILE_TESTED_ON("4,000 scanned county court filings, 1990-2010")}`,
        );
    });

    it("omits the credit line for a profile with no authors and no corpus", () => {
        const { el } = open(DIFF, ACTIVE_SAVED.profile!);
        expect(el.find("lilbee-profile-credit")).toBeNull();
        expect(el.find("lilbee-profile-description")).toBeNull();
    });

    it.each([
        [MESSAGES.BUTTON_PROFILE_APPLY_REINDEX, APPLY_CHOICE.APPLY_REINDEX],
        [MESSAGES.BUTTON_PROFILE_APPLY, APPLY_CHOICE.APPLY],
        [MESSAGES.BUTTON_CANCEL, APPLY_CHOICE.CANCEL],
    ])("%s resolves the choice", async (label, choice) => {
        const { modal, el } = open(DIFF);
        button(el, label)!.trigger("click");
        expect(await modal.result).toBe(choice);
    });

    it("closing the modal cancels", async () => {
        const { modal } = open(DIFF);
        modal.close();
        expect(await modal.result).toBe(APPLY_CHOICE.CANCEL);
    });
});
