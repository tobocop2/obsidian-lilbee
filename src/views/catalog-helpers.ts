import type { App } from "obsidian";
import type { CatalogEntry, CatalogSource, CatalogTab, KeyStatus, ModelTask } from "../types";
import { CATALOG_SOURCE, CATALOG_TAB, HOSTED_SOURCES, KEY_STATUS, MODEL_TASK } from "../types";
import { MESSAGES } from "../locales/en";

const DISCOVER_RAIL_LIMIT = 12;
const TASK_TO_TAB: Record<ModelTask, CatalogTab> = {
    [MODEL_TASK.CHAT]: CATALOG_TAB.CHAT,
    [MODEL_TASK.EMBEDDING]: CATALOG_TAB.EMBED,
    [MODEL_TASK.VISION]: CATALOG_TAB.VISION,
    [MODEL_TASK.RERANK]: CATALOG_TAB.RERANK,
};
const TAB_TO_TASK: Partial<Record<CatalogTab, ModelTask>> = {
    [CATALOG_TAB.CHAT]: MODEL_TASK.CHAT,
    [CATALOG_TAB.EMBED]: MODEL_TASK.EMBEDDING,
    [CATALOG_TAB.VISION]: MODEL_TASK.VISION,
    [CATALOG_TAB.RERANK]: MODEL_TASK.RERANK,
};

export const KEY_STATUS_PILL_CLASS = {
    READY: "lilbee-key-status-pill-ready",
    NEEDS_KEY: "lilbee-key-status-pill-needs-key",
} as const;

/** Hosted rows (frontier + local servers): selectable, no download. */
export function hostedRowsOnly(rows: CatalogEntry[]): CatalogEntry[] {
    return rows.filter((row) => HOSTED_SOURCES.has(row.source));
}

/** Everything that isn't hosted — native catalog rows the server can download. */
export function localRowsOnly(rows: CatalogEntry[]): CatalogEntry[] {
    return rows.filter((row) => !HOSTED_SOURCES.has(row.source));
}

/** A hosted row is usable unless it's a frontier model still missing its key.
 * Local servers (Ollama, LM Studio) report `key_status` null, so they always pass. */
export function isUsableHostedRow(row: CatalogEntry): boolean {
    return HOSTED_SOURCES.has(row.source) && row.key_status !== KEY_STATUS.MISSING_KEY;
}

/** True when at least one hosted row is ready to select right now. */
export function hasReadyHostedRow(rows: CatalogEntry[]): boolean {
    return rows.some(isUsableHostedRow);
}

/** Local-server sources (Ollama, LM Studio) lead hosted listings; frontier trails. Lower sorts first. */
function hostedSourceRank(source: CatalogSource): number {
    return source === CATALOG_SOURCE.FRONTIER ? 1 : 0;
}

/** Local-first, then provider, then name — deterministic ordering for hosted rows. */
function compareHostedRows(a: CatalogEntry, b: CatalogEntry): number {
    const rankDiff = hostedSourceRank(a.source) - hostedSourceRank(b.source);
    if (rankDiff !== 0) return rankDiff;
    const providerDiff = (a.provider ?? "").localeCompare(b.provider ?? "");
    if (providerDiff !== 0) return providerDiff;
    return a.display_name.localeCompare(b.display_name);
}

/** Selectable hosted rows, local-first: local servers always, frontier only with a ready key. Returns [ref, label]. */
export function hostedOptions(rows: CatalogEntry[]): Array<[string, string]> {
    return rows
        .filter(isUsableHostedRow)
        .sort(compareHostedRows)
        .map((e) => [e.hf_repo, `${e.display_name}${e.provider ? ` [${e.provider}]` : ""}`]);
}

/** Hosted rows grouped by provider, local-server groups before frontier, providers alphabetical within a rank. */
export function groupByProvider(rows: CatalogEntry[]): [string, CatalogEntry[]][] {
    const groups = new Map<string, CatalogEntry[]>();
    for (const row of rows) {
        const provider = row.provider ?? "";
        const existing = groups.get(provider);
        if (existing) {
            existing.push(row);
        } else {
            groups.set(provider, [row]);
        }
    }
    // Each provider maps to one source, so rank the group by its first row's source.
    return [...groups.entries()].sort(([aProvider, aRows], [bProvider, bRows]) => {
        const rankDiff = hostedSourceRank(aRows[0].source) - hostedSourceRank(bRows[0].source);
        if (rankDiff !== 0) return rankDiff;
        return aProvider.localeCompare(bProvider);
    });
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

export function taskToTabId(task: ModelTask): CatalogTab {
    return TASK_TO_TAB[task];
}

export function tabIdToTask(tab: CatalogTab): ModelTask | null {
    return TAB_TO_TASK[tab] ?? null;
}

/**
 * Featured-first ordering, capped at 12. When the user has an active chat
 * model the chat-task entries float to the top so the rail leads with rows
 * matching what they're already using.
 */
export function forYouRail(entries: CatalogEntry[], activeChatModelRef: string): CatalogEntry[] {
    const featured = entries.filter((e) => e.featured);
    const preferChat = activeChatModelRef !== "";
    const sorted = [...featured].sort((a, b) => {
        if (preferChat) {
            const aChat = a.task === MODEL_TASK.CHAT ? 0 : 1;
            const bChat = b.task === MODEL_TASK.CHAT ? 0 : 1;
            if (aChat !== bChat) return aChat - bChat;
        }
        return b.downloads - a.downloads;
    });
    return sorted.slice(0, DISCOVER_RAIL_LIMIT);
}

export function yourCollectionRail(entries: CatalogEntry[]): CatalogEntry[] {
    return entries.filter((e) => e.installed);
}

export function freshRail(entries: CatalogEntry[]): CatalogEntry[] {
    return [...entries].sort((a, b) => b.downloads - a.downloads).slice(0, DISCOVER_RAIL_LIMIT);
}

export function deepLinkToApiKeySettings(app: App, provider: string): void {
    const settingApi = (app as App & { setting?: { open(): void; openTabById(id: string): void } }).setting;
    if (!settingApi) return;
    settingApi.open();
    settingApi.openTabById("lilbee");
    window.setTimeout(() => {
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
