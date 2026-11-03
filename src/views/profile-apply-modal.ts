import { App } from "obsidian";
import { MESSAGES } from "../locales/en";
import { APPLY_CHOICE, PROFILE_EFFECT } from "../types";
import type { ApplyChoice, ConfigResponse, ProfileDiffResponse, ProfileEntry } from "../types";
import { PILL_CLS, renderPill } from "../components/pill";
import { ChoiceModal } from "./choice-modal";
import { profileCreditText, profileValueText, renderProfileTable, renderNote } from "./profile-parts";

/** What the Apply modal shows: the profile, the server's diff for it, and the user's current values. */
export interface ApplyPlan {
    profile: ProfileEntry;
    diff: ProfileDiffResponse;
    config: ConfigResponse;
}

/** Shows what applying a profile changes and keeps; nothing changes until the user picks Apply. */
export class ApplyProfileModal extends ChoiceModal<ApplyChoice> {
    constructor(
        app: App,
        private readonly plan: ApplyPlan,
    ) {
        super(app, APPLY_CHOICE.CANCEL);
    }

    onOpen(): void {
        const { contentEl } = this;
        const { profile, diff } = this.plan;
        contentEl.empty();
        contentEl.addClass("lilbee-profile-apply-modal");
        contentEl.createEl("h3", { text: MESSAGES.PROFILE_APPLY_TITLE(profile.name) });
        renderNote(contentEl, profile.description, "lilbee-profile-description");
        renderNote(contentEl, profileCreditText(profile), "lilbee-profile-credit");
        this.renderChanges(contentEl);
        this.renderKept(contentEl);
        renderNote(contentEl, MESSAGES.PROFILE_APPLY_UNTOUCHED(diff.untouched_count), "lilbee-profile-untouched");
        renderNote(contentEl, this.summary(), "lilbee-profile-summary");
        this.renderActions(contentEl.createDiv({ cls: "modal-button-container" }));
    }

    private reindexCount(): number {
        return this.plan.diff.changes.filter((row) => row.effect === PROFILE_EFFECT.REINDEX).length;
    }

    private renderChanges(container: HTMLElement): void {
        const { changes } = this.plan.diff;
        if (changes.length === 0) return;
        container.createEl("h4", { text: MESSAGES.PROFILE_APPLY_CHANGES });
        renderProfileTable(
            container,
            [MESSAGES.PROFILE_COL_SETTING, MESSAGES.PROFILE_COL_NOW, MESSAGES.PROFILE_COL_AFTER],
            changes.map((row) => ({
                cells: [row.key, profileValueText(row.current), profileValueText(row.new)],
                effect: row.effect,
            })),
        );
    }

    private renderKept(container: HTMLElement): void {
        const { kept } = this.plan.diff;
        if (kept.length === 0) return;
        container.createEl("h4", { text: MESSAGES.PROFILE_APPLY_KEEPS });
        const line = container.createEl("p", { cls: "lilbee-profile-kept" });
        line.createSpan({
            text: kept.map((key) => `${key} ${profileValueText(this.plan.config[key])}`).join(", "),
        });
        renderPill(line, MESSAGES.PILL_SOURCE_USER, `${PILL_CLS.SOURCE} ${PILL_CLS.SOURCE_USER}`);
    }

    private summary(): string | null {
        if (this.plan.diff.changes.length === 0) return MESSAGES.PROFILE_APPLY_NOTHING;
        const count = this.reindexCount();
        return count === 0 ? null : MESSAGES.PROFILE_APPLY_REINDEX(count);
    }

    private renderActions(actions: HTMLElement): void {
        const reindex = this.reindexCount() > 0;
        if (reindex) this.addChoice(actions, MESSAGES.BUTTON_PROFILE_APPLY_REINDEX, APPLY_CHOICE.APPLY_REINDEX, true);
        this.addChoice(actions, MESSAGES.BUTTON_PROFILE_APPLY, APPLY_CHOICE.APPLY, !reindex);
        this.addChoice(actions, MESSAGES.BUTTON_CANCEL, APPLY_CHOICE.CANCEL);
    }
}
