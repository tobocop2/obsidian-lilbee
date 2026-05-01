/**
 * Shared helpers for catalog-modal and model-picker-modal.
 *
 * Both UIs render rows that flow from `LilbeeClient.catalog()` and need
 * the same provider grouping, key-status pill rendering, search filter,
 * and "deep-link to API Keys settings" affordance. Keeping the logic
 * here avoids drift between the two consumers.
 */

import type { App } from "obsidian";
import type { CatalogEntry, KeyStatus } from "../types";
import { CATALOG_SOURCE, KEY_STATUS } from "../types";
import { MESSAGES } from "../locales/en";

/** Key-status pill class names — kept stable so CSS rules can target them. */
export const KEY_STATUS_PILL_CLASS = {
    READY: "lilbee-key-status-pill-ready",
    NEEDS_KEY: "lilbee-key-status-pill-needs-key",
} as const;

/**
 * Returns true when at least one row in `rows` is a frontier row whose key
 * is configured (`key_status === "ready"`). Used to gate the visibility of
 * the Frontier tab in the catalog modal and the inclusion of frontier rows
 * in the unified model-picker modal: with no key configured, frontier rows
 * are hidden entirely until the user sets at least one key.
 */
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

/**
 * Filter an entry list to only frontier rows. Rows missing a `provider`
 * field are dropped — the rendering code below doesn't have anything
 * meaningful to render without one.
 */
export function frontierRowsOnly(rows: CatalogEntry[]): CatalogEntry[] {
    return rows.filter((row) => row.source === CATALOG_SOURCE.FRONTIER);
}

/** Filter to local rows (everything that isn't a frontier row). */
export function localRowsOnly(rows: CatalogEntry[]): CatalogEntry[] {
    return rows.filter((row) => row.source !== CATALOG_SOURCE.FRONTIER);
}

/**
 * Group frontier rows by provider, preserving first-seen ordering. Returns
 * an array of `[provider, rows]` tuples so callers can iterate without
 * worrying about Map iteration order surprises across runtimes.
 */
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

/**
 * Render the small provider pill (e.g. "OpenAI", "Anthropic") onto a row.
 * Returns the created element for further styling if needed.
 */
export function renderProviderPill(parent: HTMLElement, provider: string): HTMLElement {
    return parent.createSpan({
        cls: "lilbee-provider-pill",
        text: provider,
    });
}

/**
 * Render the key-status pill — green "Ready" when the provider has a key
 * configured, amber "Needs key" otherwise. Click handling lives in the
 * caller (catalog-modal / model-picker-modal); this helper only paints.
 */
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

/**
 * Open the plugin's settings tab and scroll to the relevant API-key input
 * for `provider`. Used by the missing-key click handler in catalog and
 * model-picker rows. Falls back to opening the settings tab without
 * scrolling when the input element can't be located (e.g. older settings
 * tab where the section hasn't rendered yet).
 *
 * The provider→input-id mapping intentionally lives here — both modals
 * dispatch through this helper so they stay in sync.
 */
export function deepLinkToApiKeySettings(app: App, provider: string): void {
    const settingApi = (app as App & { setting?: { open(): void; openTabById(id: string): void } }).setting;
    if (!settingApi) return;
    settingApi.open();
    settingApi.openTabById("lilbee");
    // Defer one tick to let the settings tab render its DOM before scrolling.
    setTimeout(() => {
        const escaped = provider.toLowerCase().replace(/[^a-z0-9-]/g, "-");
        const target = document.querySelector(`[data-lilbee-api-key="${escaped}"]`);
        if (target instanceof HTMLElement) {
            target.scrollIntoView({ behavior: "smooth", block: "center" });
            target.focus();
        }
    }, 50);
}
