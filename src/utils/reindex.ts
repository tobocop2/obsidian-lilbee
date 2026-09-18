import { Notice } from "obsidian";
import type { SyncOptions } from "../types";
import { MESSAGES } from "../locales/en";

/** The slice of the plugin a forced rebuild needs. */
export interface RebuildPlugin {
    triggerSync: (options?: SyncOptions) => void | Promise<void>;
}

/** The sync a model or chunking change needs: a forced rebuild, announced, or nothing at all. */
export function reindexSyncOptions(reindexRequired: boolean): SyncOptions | undefined {
    if (!reindexRequired) return undefined;
    new Notice(MESSAGES.NOTICE_REINDEX_REQUIRED);
    return { forceRebuild: true };
}

/** Raise the notice and run that sync now; an index that still matches runs no sync at all. */
export function startReindexSync(plugin: RebuildPlugin, reindexRequired: boolean): void {
    const options = reindexSyncOptions(reindexRequired);
    if (options) void plugin.triggerSync(options);
}
