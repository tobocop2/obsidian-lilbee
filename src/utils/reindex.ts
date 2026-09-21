import { Notice } from "obsidian";
import type { ConfigUpdateResponse, SetModelResponse, SyncOptions } from "../types";
import type { Result } from "../result";
import { MESSAGES } from "../locales/en";

/** The slice of the plugin a forced rebuild needs. */
export interface RebuildPlugin {
    triggerSync: (options?: SyncOptions) => void | Promise<void>;
}

/** The slice of the plugin a server write that can invalidate the index needs. */
export interface ServerWritePlugin extends RebuildPlugin {
    api: {
        setEmbeddingModel: (model: string) => Promise<Result<SetModelResponse, Error>>;
        updateConfig: (updates: Record<string, unknown>) => Promise<ConfigUpdateResponse>;
    };
}

/** An embedding swap and the sync it needs, for a caller that runs the sync later. */
export interface DeferredEmbeddingSwap {
    result: Result<SetModelResponse, Error>;
    syncOptions: SyncOptions | undefined;
}

/** The sync a model or chunking change needs: a forced rebuild, announced, or nothing at all. */
function announceRebuildIfNeeded(reindexRequired: boolean): SyncOptions | undefined {
    if (!reindexRequired) return undefined;
    new Notice(MESSAGES.NOTICE_REINDEX_REQUIRED);
    return { forceRebuild: true };
}

/** Raise the notice and run that sync now; an index that still matches runs no sync at all. */
export function startReindexSync(plugin: RebuildPlugin, reindexRequired: boolean): void {
    const options = announceRebuildIfNeeded(reindexRequired);
    if (options) void plugin.triggerSync(options);
}

/** Write server config, and rebuild the index when the server says the change invalidated it. */
export async function applyConfig(
    plugin: ServerWritePlugin,
    updates: Record<string, unknown>,
): Promise<ConfigUpdateResponse> {
    const response = await plugin.api.updateConfig(updates);
    startReindexSync(plugin, response.reindex_required);
    return response;
}

/** Swap the embedding model and hand back the sync the swap needs; the caller runs it. */
export async function applyEmbeddingModelDeferred(
    plugin: ServerWritePlugin,
    ref: string,
): Promise<DeferredEmbeddingSwap> {
    const result = await plugin.api.setEmbeddingModel(ref);
    const syncOptions = result.isOk() ? announceRebuildIfNeeded(result.value.reindex_required) : undefined;
    return { result, syncOptions };
}

/** Swap the embedding model and rebuild the index now when the old vectors no longer match. */
export async function applyEmbeddingModel(
    plugin: ServerWritePlugin,
    ref: string,
): Promise<Result<SetModelResponse, Error>> {
    const { result, syncOptions } = await applyEmbeddingModelDeferred(plugin, ref);
    if (syncOptions) void plugin.triggerSync(syncOptions);
    return result;
}
