export interface OpenDialogResult {
    canceled: boolean;
    filePaths: string[];
}

export interface SaveDialogResult {
    canceled: boolean;
    filePath?: string;
}

interface ElectronDialog {
    showOpenDialog(opts: Record<string, unknown>): Promise<OpenDialogResult>;
    showSaveDialog(opts: Record<string, unknown>): Promise<SaveDialogResult>;
}

/** Thin wrapper around Electron's native dialogs — exported for test stubbing. */
export const electronDialog = {
    /* v8 ignore start -- requires Electron runtime */
    showOpenDialog(opts: Record<string, unknown>): Promise<OpenDialogResult> {
        const electron = require("electron") as { remote: { dialog: ElectronDialog } };
        return electron.remote.dialog.showOpenDialog(opts);
    },
    showSaveDialog(opts: Record<string, unknown>): Promise<SaveDialogResult> {
        const electron = require("electron") as { remote: { dialog: ElectronDialog } };
        return electron.remote.dialog.showSaveDialog(opts);
    },
    /* v8 ignore stop */
};
