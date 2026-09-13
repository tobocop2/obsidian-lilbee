import type { App } from "obsidian";
import type { SyncOptions } from "../types";
import { MESSAGES } from "../locales/en";
import { ConfirmModal } from "../views/confirm-modal";

/** A server degradation the plugin knows how to fix: what to tell the user, and what the button does. */
export interface WarningRemedy {
    text: string;
    action: () => void;
}

/** The slice of the plugin a warning-remedy action needs: the app for dialogs and the rebuild entry point. */
export interface WarningRemedyPlugin {
    app: App;
    triggerSync: (options?: SyncOptions) => void | Promise<void>;
}

/** Codes the plugin can fix itself; every other code falls back to the server's remedy text. */
const KNOWN_CODES = new Set(["fts_unavailable", "embedding_prefix_mismatch", "stale_index"]);

function rebuildAction(plugin: WarningRemedyPlugin): () => void {
    return () => {
        const modal = new ConfirmModal(plugin.app, MESSAGES.CONFIRM_SYNC_REBUILD);
        modal.open();
        void modal.result.then((confirmed) => {
            if (confirmed) void plugin.triggerSync({ forceRebuild: true });
        });
    };
}

/** Map a warning code to a plugin-native remedy, or null when the plugin does not know the code. */
export function remedyForWarning(code: string, plugin: WarningRemedyPlugin): WarningRemedy | null {
    if (!KNOWN_CODES.has(code)) return null;
    return { text: MESSAGES.WARNING_REMEDY_REBUILD, action: rebuildAction(plugin) };
}
