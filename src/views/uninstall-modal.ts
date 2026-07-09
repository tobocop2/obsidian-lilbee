import { App, Modal } from "obsidian";
import { MESSAGES } from "../locales/en";
import { formatBytes } from "../storage-stats";
import { UNINSTALL_TARGET, type UninstallPlan, type UninstallTargetKind } from "../types";
import { bindEscapeToClose } from "../utils";

const TARGET_LABELS: Record<UninstallTargetKind, string> = {
    [UNINSTALL_TARGET.BINARY]: MESSAGES.LABEL_UNINSTALL_BINARY,
    [UNINSTALL_TARGET.MODELS]: MESSAGES.LABEL_UNINSTALL_MODELS,
    [UNINSTALL_TARGET.INDEX]: MESSAGES.LABEL_UNINSTALL_INDEX,
};

/** Confirms a managed-server uninstall by naming and sizing everything it deletes. */
export class UninstallModal extends Modal {
    private plan: UninstallPlan;
    private _resolve: ((value: boolean) => void) | null = null;
    private decided = false;
    readonly result: Promise<boolean>;

    constructor(app: App, plan: UninstallPlan) {
        super(app);
        this.plan = plan;
        this.result = new Promise<boolean>((resolve) => {
            this._resolve = resolve;
        });
        bindEscapeToClose(this);
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("lilbee-uninstall-modal");

        contentEl.createEl("h3", { text: MESSAGES.CONFIRM_UNINSTALL_TITLE });
        contentEl.createEl("p", { text: MESSAGES.CONFIRM_UNINSTALL_BODY });

        const ledger = contentEl.createDiv({ cls: "lilbee-uninstall-ledger" });
        for (const target of this.plan.targets) {
            this.appendRow(
                ledger,
                MESSAGES.LABEL_UNINSTALL_DELETE_TAG,
                TARGET_LABELS[target.kind],
                formatBytes(target.bytes),
            );
        }
        const keep = this.appendRow(
            ledger,
            MESSAGES.LABEL_UNINSTALL_KEEP_TAG,
            MESSAGES.LABEL_UNINSTALL_KEEP,
            MESSAGES.LABEL_UNINSTALL_KEEP_VALUE,
        );
        keep.addClass("is-keep");

        const actions = contentEl.createDiv({ cls: "lilbee-confirm-actions" });
        const cancelBtn = actions.createEl("button", { text: MESSAGES.BUTTON_CANCEL });
        cancelBtn.addEventListener("click", () => this.decide(false));

        const uninstallBtn = actions.createEl("button", { text: MESSAGES.BUTTON_UNINSTALL, cls: "mod-warning" });
        uninstallBtn.addEventListener("click", () => this.decide(true));
    }

    private appendRow(parent: HTMLElement, tag: string, label: string, value: string): HTMLElement {
        const row = parent.createDiv({ cls: "lilbee-uninstall-row" });
        row.createSpan({ cls: "lilbee-uninstall-tag", text: tag });
        row.createSpan({ cls: "lilbee-uninstall-label", text: label });
        row.createSpan({ cls: "lilbee-uninstall-size", text: value });
        return row;
    }

    onClose(): void {
        this.decide(false);
    }

    private decide(confirmed: boolean): void {
        if (this.decided) return;
        this.decided = true;
        /* v8 ignore next -- `decided` guards re-entry, so `_resolve` is always set here */
        if (this._resolve) {
            const resolve = this._resolve;
            this._resolve = null;
            resolve(confirmed);
        }
        this.close();
    }
}
