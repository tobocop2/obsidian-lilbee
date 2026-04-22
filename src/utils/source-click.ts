import type { App, Vault } from "obsidian";
import type { LilbeeClient } from "../api";
import type { Source } from "../types";
import { CONTENT_TYPE } from "../types";
import { SourcePreviewModal } from "../views/source-preview-modal";

/** Discriminator tags for `SourceClickAction`. */
export const SOURCE_ACTION = {
    VAULT_PDF: "vault-pdf",
    VAULT_MARKDOWN: "vault-markdown",
    VAULT_NOTE: "vault-note",
    PREVIEW: "preview",
} as const;

/**
 * The resolved intent of clicking a Source chip or card. One of:
 * - `vault-pdf`: open the PDF at a specific page in Obsidian's PDF viewer.
 * - `vault-markdown`: open the markdown file and scroll to a specific line.
 * - `vault-note`: open the vault file without deep-linking.
 * - `preview`: file is not in the vault, fetch via `/api/source` and show the
 *   source-preview modal.
 */
export type SourceClickAction =
    | { kind: typeof SOURCE_ACTION.VAULT_PDF; path: string; page: number }
    | { kind: typeof SOURCE_ACTION.VAULT_MARKDOWN; path: string; line: number }
    | { kind: typeof SOURCE_ACTION.VAULT_NOTE; path: string }
    | { kind: typeof SOURCE_ACTION.PREVIEW; source: Source };

const DEFAULT_PDF_PAGE = 1;

function isMarkdownish(contentType: string): boolean {
    return contentType === CONTENT_TYPE.MARKDOWN || contentType === CONTENT_TYPE.HTML;
}

/**
 * Resolve what should happen when the user clicks a source reference.
 *
 * A vault-side file takes precedence: if the server returned a `vault_path`
 * and the file exists in the vault, deep-link into Obsidian. Otherwise fall
 * back to a preview modal that fetches the content from the server.
 */
export function sourceClickAction(source: Source, vault: Vault): SourceClickAction {
    const path = source.vault_path;
    if (path && vault.getAbstractFileByPath(path)) {
        if (source.content_type === CONTENT_TYPE.PDF) {
            return {
                kind: SOURCE_ACTION.VAULT_PDF,
                path,
                page: source.page_start ?? DEFAULT_PDF_PAGE,
            };
        }
        if (isMarkdownish(source.content_type) && source.line_start !== null) {
            return {
                kind: SOURCE_ACTION.VAULT_MARKDOWN,
                path,
                line: source.line_start,
            };
        }
        return { kind: SOURCE_ACTION.VAULT_NOTE, path };
    }
    return { kind: SOURCE_ACTION.PREVIEW, source };
}

/**
 * Dispatch a resolved `SourceClickAction`. Opens the vault file with the
 * appropriate deep-link for PDFs / markdown, or opens the preview modal for
 * sources that only live on the server.
 */
export async function executeSourceClick(app: App, api: LilbeeClient, action: SourceClickAction): Promise<void> {
    switch (action.kind) {
        case SOURCE_ACTION.VAULT_PDF:
            app.workspace.openLinkText(`${action.path}#page=${action.page}`, "");
            return;
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
