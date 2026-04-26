import type { App, Vault } from "obsidian";
import type { LilbeeClient } from "../api";
import type { Source } from "../types";
import { CONTENT_TYPE } from "../types";
import { SourcePreviewModal } from "../views/source-preview-modal";

/** Discriminator tags for `SourceClickAction`. */
export const SOURCE_ACTION = {
    VAULT_MARKDOWN: "vault-markdown",
    VAULT_NOTE: "vault-note",
    PREVIEW: "preview",
} as const;

/**
 * The resolved intent of clicking a Source chip or card. One of:
 * - `vault-markdown`: open the markdown file and scroll to a specific line.
 * - `vault-note`: open the vault file without deep-linking.
 * - `preview`: file is not in the vault, OR is a PDF — fetch via `/api/source`
 *   and show the source-preview modal so we can deep-link to a page via
 *   `<object data="...?page=N">` (Obsidian's PDF viewer doesn't honour the
 *   `#page=N` fragment in `openLinkText`).
 */
export type SourceClickAction =
    | { kind: typeof SOURCE_ACTION.VAULT_MARKDOWN; path: string; line: number }
    | { kind: typeof SOURCE_ACTION.VAULT_NOTE; path: string }
    | { kind: typeof SOURCE_ACTION.PREVIEW; source: Source };

function isMarkdownish(contentType: string): boolean {
    return contentType === CONTENT_TYPE.MARKDOWN || contentType === CONTENT_TYPE.HTML;
}

function vaultAction(source: Source, path: string): SourceClickAction {
    if (isMarkdownish(source.content_type) && source.line_start !== null) {
        return {
            kind: SOURCE_ACTION.VAULT_MARKDOWN,
            path,
            line: source.line_start,
        };
    }
    return { kind: SOURCE_ACTION.VAULT_NOTE, path };
}

/**
 * Resolve what should happen when the user clicks a source reference.
 *
 * PDFs always route to the preview modal — Obsidian's built-in PDF viewer
 * does not honour `#page=N` fragments passed through `openLinkText`, so we
 * use the modal's `<object data="…?page=N">` path that does. The modal
 * exposes an "Open in vault" button for users who want the file opened in
 * the main pane.
 *
 * For non-PDFs, prefer the server-supplied `vault_path`. If absent (older
 * server builds, or external-server mode), fall back to `source.source` —
 * sources ingested via a vault-native flow often match a vault-relative
 * path directly. Only fall through to the preview modal when no vault file
 * can be resolved.
 */
export function sourceClickAction(source: Source, vault: Vault): SourceClickAction {
    if (source.content_type === CONTENT_TYPE.PDF) {
        return { kind: SOURCE_ACTION.PREVIEW, source };
    }
    const vaultPath = source.vault_path;
    if (vaultPath && vault.getAbstractFileByPath(vaultPath)) {
        return vaultAction(source, vaultPath);
    }
    if (source.source && vault.getAbstractFileByPath(source.source)) {
        return vaultAction(source, source.source);
    }
    return { kind: SOURCE_ACTION.PREVIEW, source };
}

/**
 * Dispatch a resolved `SourceClickAction`. Opens the vault file with the
 * appropriate deep-link for markdown, or opens the preview modal for PDFs
 * and sources that only live on the server.
 */
export async function executeSourceClick(app: App, api: LilbeeClient, action: SourceClickAction): Promise<void> {
    switch (action.kind) {
        case SOURCE_ACTION.VAULT_MARKDOWN:
            app.workspace.openLinkText(action.path, "", false, { eState: { line: action.line } });
            return;
        case SOURCE_ACTION.VAULT_NOTE:
            app.workspace.openLinkText(action.path, "");
            return;
        case SOURCE_ACTION.PREVIEW:
            new SourcePreviewModal(app, api, action.source).open();
            return;
    }
}
