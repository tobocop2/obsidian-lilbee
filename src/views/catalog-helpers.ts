import type { App } from "obsidian";
import type { CatalogEntry, KeyStatus } from "../types";
import { CATALOG_SOURCE, KEY_STATUS } from "../types";
import { MESSAGES } from "../locales/en";

export const KEY_STATUS_PILL_CLASS = {
    READY: "lilbee-key-status-pill-ready",
    NEEDS_KEY: "lilbee-key-status-pill-needs-key",
} as const;

/** Catalog modal and model picker hide frontier rows entirely until this is true. */
export function hasReadyFrontierRow(rows: CatalogEntry[]): boolean {
    for (const row of rows) {
        if (
            row.source === CATALOG_SOURCE.FRONTIER &&
            (row as CatalogEntry & { key_status?: KeyStatus }).key_status === KEY_STATUS.READY
        ) {
            return true;
        }
    }
    return false;
}

export function frontierRowsOnly(rows: CatalogEntry[]): CatalogEntry[] {
    return rows.filter((row) => row.source === CATALOG_SOURCE.FRONTIER);
}

export function localRowsOnly(rows: CatalogEntry[]): CatalogEntry[] {
    return rows.filter((row) => row.source !== CATALOG_SOURCE.FRONTIER);
}

export function groupByProvider(rows: CatalogEntry[]): [string, CatalogEntry[]][] {
    const groups = new Map<string, CatalogEntry[]>();
    for (const row of rows) {
        const provider = (row as CatalogEntry & { provider?: string }).provider ?? "";
        const existing = groups.get(provider);
        if (existing) {
            existing.push(row);
        } else {
            groups.set(provider, [row]);
        }
    }
    return [...groups.entries()];
}

export function renderProviderPill(parent: HTMLElement, provider: string): HTMLElement {
    return parent.createSpan({ cls: "lilbee-provider-pill", text: provider });
}

export function renderKeyStatusPill(parent: HTMLElement, status: KeyStatus): HTMLElement {
    if (status === KEY_STATUS.READY) {
        return parent.createSpan({
            cls: `lilbee-key-status-pill ${KEY_STATUS_PILL_CLASS.READY}`,
            text: MESSAGES.PILL_KEY_READY,
        });
    }
    return parent.createSpan({
        cls: `lilbee-key-status-pill ${KEY_STATUS_PILL_CLASS.NEEDS_KEY}`,
        text: MESSAGES.PILL_KEY_NEEDS_KEY,
    });
}

export function deepLinkToApiKeySettings(app: App, provider: string): void {
    const settingApi = (app as App & { setting?: { open(): void; openTabById(id: string): void } }).setting;
    if (!settingApi) return;
    settingApi.open();
    settingApi.openTabById("lilbee");
    setTimeout(() => {
        // Timer can fire after the modal closes; Node test envs don't have a global document.
        if (typeof document === "undefined") return;
        const escaped = provider.toLowerCase().replace(/[^a-z0-9-]/g, "-");
        const target = document.querySelector(`[data-lilbee-api-key="${escaped}"]`);
        if (target instanceof HTMLElement) {
            target.scrollIntoView({ behavior: "smooth", block: "center" });
            target.focus();
        }
    }, 50);
}
