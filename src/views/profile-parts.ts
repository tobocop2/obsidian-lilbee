import { MESSAGES, PROFILE_EFFECT_LABELS, PROFILE_FOLDER_LABELS } from "../locales/en";
import { PROFILE_EFFECT } from "../types";
import type { ProfileEffect, ProfileEntry } from "../types";
import { PILL_CLS, renderPill } from "../components/pill";

/** The folder's label, or the server's own value when it names a folder this build doesn't know. */
export function profileFolderLabel(folder: string): string {
    return (PROFILE_FOLDER_LABELS as Record<string, string>)[folder] ?? folder;
}

/** A setting value as the profile surfaces show it: on/off, none, or a comma list. */
export function profileValueText(value: unknown): string {
    if (typeof value === "boolean") return value ? MESSAGES.PROFILE_VALUE_ON : MESSAGES.PROFILE_VALUE_OFF;
    if (value === null || value === undefined) return MESSAGES.PROFILE_VALUE_NONE;
    if (Array.isArray(value)) return value.map(profileValueText).join(", ") || MESSAGES.PROFILE_VALUE_NONE;
    if (typeof value === "string" || typeof value === "number") return String(value);
    return JSON.stringify(value);
}

/** The credit line: the server's author credit, then what the profile was tested on. */
export function profileCreditText(entry: ProfileEntry): string {
    const parts = [entry.credit, entry.tested_on === null ? null : MESSAGES.PROFILE_TESTED_ON(entry.tested_on)];
    return parts.filter((part): part is string => part !== null && part !== "").join(". ");
}

/** A paragraph of muted text, skipped when there is nothing to say. */
export function renderNote(container: HTMLElement, text: string | null, cls: string): void {
    if (text) container.createEl("p", { text, cls: `setting-item-description ${cls}` });
}

/** One table row; a row with an effect gets a Cost cell. */
export interface ProfileTableRow {
    cells: string[];
    effect?: ProfileEffect;
}

/** A table with a header row, and a Cost column when any row carries an effect. */
export function renderProfileTable(container: HTMLElement, headers: string[], rows: ProfileTableRow[]): void {
    const costed = rows.some((row) => row.effect !== undefined);
    const table = container.createEl("table", { cls: "lilbee-profile-table" });
    const head = table.createEl("tr");
    for (const header of costed ? [...headers, MESSAGES.PROFILE_COL_COST] : headers) {
        head.createEl("th", { text: header });
    }
    for (const row of rows) {
        const tr = table.createEl("tr");
        for (const cell of row.cells) tr.createEl("td", { text: cell });
        if (row.effect !== undefined) renderEffect(tr.createEl("td"), row.effect);
    }
}

/** The Cost cell: a loud pill for a reindex, plain text otherwise. */
function renderEffect(cell: HTMLElement, effect: ProfileEffect): void {
    if (effect === PROFILE_EFFECT.REINDEX) {
        renderPill(cell, PROFILE_EFFECT_LABELS[effect], PILL_CLS.REINDEX);
        return;
    }
    cell.setText(PROFILE_EFFECT_LABELS[effect]);
}
