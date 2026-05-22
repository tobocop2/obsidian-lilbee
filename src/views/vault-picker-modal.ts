import { App, Modal, setIcon } from "obsidian";
import type { VaultRegistryEntry } from "../types";
import { MESSAGES } from "../locales/en";
import { bindEscapeToClose } from "../utils";

/**
 * Modal listing the vaults registered against this shared lilbee root, minus
 * the currently-active one. Picking a vault triggers the on-pick callback;
 * the caller decides what "switch to that vault" means (typically: release
 * our lock so the picked vault can claim it on its next plugin load).
 *
 * Rich vault cards with a filter input at the top so users with many
 * registered vaults can narrow by name or path.
 */
const VAULT_PICKER_PAGE_SIZE = 5;

export class VaultPickerModal extends Modal {
    private entries: VaultRegistryEntry[];
    private onPick: (entry: VaultRegistryEntry) => void;
    private filterValue = "";
    private listEl: HTMLElement | null = null;
    private paginationEl: HTMLElement | null = null;
    // Exposed for tests to read/set value before triggering the input event.
    filterInput: HTMLInputElement | null = null;
    private currentPage = 0;

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

        const filterWrap = contentEl.createDiv({ cls: "lilbee-vault-picker-filter" });
        const filterIcon = filterWrap.createSpan({ cls: "lilbee-vault-picker-filter-icon" });
        setIcon(filterIcon, "search");
        const filterInput = filterWrap.createEl("input", {
            type: "text",
            placeholder: MESSAGES.PLACEHOLDER_VAULT_FILTER,
            cls: "lilbee-vault-picker-filter-input",
        }) as HTMLInputElement;
        this.filterInput = filterInput;
        filterInput.addEventListener("input", () => {
            /* c8 ignore next */
            this.filterValue = (this.filterInput?.value ?? "").trim().toLowerCase();
            this.currentPage = 0;
            this.renderList();
        });

        this.listEl = contentEl.createDiv({ cls: "lilbee-vault-picker-list" });
        this.paginationEl = contentEl.createDiv({ cls: "lilbee-vault-picker-pagination" });
        this.renderList();
    }

    private renderList(): void {
        /* c8 ignore next */
        if (!this.listEl || !this.paginationEl) return;
        this.listEl.empty();
        this.paginationEl.empty();
        const matches = this.filterValue
            ? this.entries.filter(
                  (e) =>
                      e.displayName.toLowerCase().includes(this.filterValue) ||
                      e.obsidianVaultPath.toLowerCase().includes(this.filterValue),
              )
            : this.entries;
        if (matches.length === 0) {
            this.listEl.createEl("p", { text: MESSAGES.EMPTY_VAULT_FILTER, cls: "lilbee-vault-picker-empty" });
            return;
        }
        const pageCount = Math.max(1, Math.ceil(matches.length / VAULT_PICKER_PAGE_SIZE));
        /* c8 ignore next */
        if (this.currentPage >= pageCount) this.currentPage = pageCount - 1;
        const start = this.currentPage * VAULT_PICKER_PAGE_SIZE;
        const page = matches.slice(start, start + VAULT_PICKER_PAGE_SIZE);
        for (const entry of page) {
            this.renderCard(this.listEl, entry);
        }
        if (pageCount > 1) {
            this.renderPagination(this.paginationEl, pageCount, matches.length);
        }
    }

    private renderPagination(container: HTMLElement, pageCount: number, totalMatches: number): void {
        const prev = container.createEl("button", {
            text: MESSAGES.BUTTON_PREV_PAGE,
            cls: "lilbee-vault-picker-page-btn",
        });
        (prev as HTMLButtonElement).disabled = this.currentPage === 0;
        prev.addEventListener("click", () => {
            if (this.currentPage > 0) {
                this.currentPage -= 1;
                this.renderList();
            }
        });
        const status = container.createSpan({
            cls: "lilbee-vault-picker-page-status",
            text: MESSAGES.LABEL_PAGE_STATUS(this.currentPage + 1, pageCount, totalMatches),
        });
        void status;
        const next = container.createEl("button", {
            text: MESSAGES.BUTTON_NEXT_PAGE,
            cls: "lilbee-vault-picker-page-btn",
        });
        (next as HTMLButtonElement).disabled = this.currentPage >= pageCount - 1;
        next.addEventListener("click", () => {
            if (this.currentPage < pageCount - 1) {
                this.currentPage += 1;
                this.renderList();
            }
        });
    }

    private renderCard(list: HTMLElement, entry: VaultRegistryEntry): void {
        const card = list.createDiv({ cls: "lilbee-vault-picker-card" });

        const iconEl = card.createDiv({ cls: "lilbee-vault-picker-card-icon" });
        setIcon(iconEl, "folder");

        const body = card.createDiv({ cls: "lilbee-vault-picker-card-body" });
        body.createDiv({ text: entry.displayName, cls: "lilbee-vault-picker-card-name" });
        body.createDiv({ text: friendlyPath(entry.obsidianVaultPath), cls: "lilbee-vault-picker-card-path" });
        body.createDiv({
            text: formatLastActive(entry.lastActiveAt),
            cls: "lilbee-vault-picker-card-meta",
        });

        const action = card.createDiv({ cls: "lilbee-vault-picker-card-action" });
        const switchBtn = action.createEl("button", {
            text: MESSAGES.BUTTON_SWITCH,
            cls: "mod-cta lilbee-vault-picker-switch-btn",
        });
        switchBtn.addEventListener("click", () => {
            this.onPick(entry);
            this.close();
        });
    }
}

/**
 * Shorten a filesystem path for display: keep the last two segments,
 * prefix with "~" if under the user's home directory, otherwise prefix
 * with "…". Paths shown in the picker can be 60-80 chars otherwise.
 */
function friendlyPath(absPath: string): string {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
    let rest = absPath;
    let prefix = "";
    if (home && absPath.startsWith(home)) {
        rest = absPath.slice(home.length).replace(/^[/\\]/, "");
        prefix = "~/";
    }
    const parts = rest.split(/[/\\]/).filter(Boolean);
    if (parts.length <= 2) return prefix + parts.join("/");
    const tail = parts.slice(-2).join("/");
    return (prefix || "…/") + tail;
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
