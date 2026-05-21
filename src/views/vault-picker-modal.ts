import { App, Modal } from "obsidian";
import type { VaultRegistryEntry } from "../types";
import { MESSAGES } from "../locales/en";
import { bindEscapeToClose } from "../utils";

/**
 * Modal listing the vaults registered against this shared lilbee root, minus
 * the currently-active one. Picking a vault triggers the on-pick callback;
 * the caller decides what "switch to that vault" means (typically: release
 * our lock so the picked vault can claim it on its next plugin load).
 */
export class VaultPickerModal extends Modal {
    private entries: VaultRegistryEntry[];
    private onPick: (entry: VaultRegistryEntry) => void;

    constructor(app: App, entries: VaultRegistryEntry[], onPick: (entry: VaultRegistryEntry) => void) {
        super(app);
        this.entries = entries;
        this.onPick = onPick;
        bindEscapeToClose(this);
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("lilbee-vault-picker-modal");
        contentEl.createEl("h2", { text: MESSAGES.TITLE_VAULT_PICKER });
        contentEl.createEl("p", { text: MESSAGES.DESC_VAULT_PICKER, cls: "lilbee-vault-picker-desc" });

        if (this.entries.length === 0) {
            contentEl.createEl("p", { text: MESSAGES.EMPTY_VAULT_PICKER, cls: "lilbee-vault-picker-empty" });
            return;
        }

        const list = contentEl.createDiv({ cls: "lilbee-vault-picker-list" });
        for (const entry of this.entries) {
            const row = list.createEl("button", { cls: "lilbee-vault-picker-row" });
            row.createEl("div", { text: entry.displayName, cls: "lilbee-vault-picker-name" });
            row.createEl("div", { text: entry.obsidianVaultPath, cls: "lilbee-vault-picker-path" });
            row.createEl("div", {
                text: formatLastActive(entry.lastActiveAt),
                cls: "lilbee-vault-picker-meta",
            });
            row.addEventListener("click", () => {
                this.onPick(entry);
                this.close();
            });
        }
    }
}

function formatLastActive(ms: number): string {
    if (!ms) return MESSAGES.LABEL_VAULT_NEVER_ACTIVE;
    const seconds = Math.max(0, Math.floor((Date.now() - ms) / 1000));
    if (seconds < 60) return MESSAGES.LABEL_VAULT_ACTIVE_RECENTLY;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return MESSAGES.LABEL_VAULT_ACTIVE_MINUTES(minutes);
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return MESSAGES.LABEL_VAULT_ACTIVE_HOURS(hours);
    const days = Math.floor(hours / 24);
    return MESSAGES.LABEL_VAULT_ACTIVE_DAYS(days);
}
