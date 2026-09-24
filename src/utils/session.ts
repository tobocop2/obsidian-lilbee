import { Notice, type Vault } from "obsidian";
import { MESSAGES } from "../locales/en";
import { node } from "../node";
import { errorMessage } from "../utils";
import { SEARCH_CHUNK_TYPE, type SearchChunkType } from "../types";

/** The server's `SearchScope` vocabulary. It says "both" where the plugin says "all". */
export type SessionScope = "raw" | "wiki" | "both";

export const SESSION_SCOPE = {
    RAW: "raw",
    WIKI: "wiki",
    BOTH: "both",
} as const satisfies Record<string, SessionScope>;

/** Longest auto-derived title before it gets an ellipsis. Matches the server's TITLE_MAX_LEN. */
export const SESSION_TITLE_MAX_LEN = 60;

const TITLE_ELLIPSIS = "…";

/** Vault folder that "Save to vault" writes chats into. */
const CHAT_NOTE_FOLDER = "lilbee";

/** Write `content` as a new timestamped note in the chat folder and say where, or say it failed. */
export async function saveChatNote(vault: Vault, content: string): Promise<void> {
    const now = new Date();
    const pad = (n: number): string => String(n).padStart(2, "0");
    const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const path = `${CHAT_NOTE_FOLDER}/chat-${stamp}.md`;
    try {
        if (!vault.getAbstractFileByPath(CHAT_NOTE_FOLDER)) await vault.createFolder(CHAT_NOTE_FOLDER);
        await vault.create(path, content);
        new Notice(MESSAGES.NOTICE_SAVED(path));
    } catch {
        new Notice(MESSAGES.ERROR_SAVE_CHAT);
    }
}

/** Icon on every "Save to vault" action: the chat toolbar and the sessions list rows. */
export const SAVE_ICON = "save";

/** Icon on every "Export chat" action: the chat toolbar and the sessions list rows. */
export const EXPORT_ICON = "download";

/** Bounds and fallback of the server's export file name. */
const EXPORT_SLUG_MAX_LEN = 60;
const EXPORT_ID_PREFIX_LEN = 8;
const EXPORT_FALLBACK_STEM = "chat";

/** Extension of an exported chat file. */
export const CHAT_EXPORT_EXTENSION = "md";

/** The server's default export name: `<title-slug>-<id prefix>.md`, without the id for an unsaved chat. */
export function chatExportName(title: string, sessionId: string | null): string {
    const slug = title
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim()
        .replace(/\//g, "--")
        .replace(/ /g, "-")
        .replace(/[^a-z0-9-]/g, "")
        .replace(/^-+|-+$/g, "");
    const stem = slug.slice(0, EXPORT_SLUG_MAX_LEN).replace(/-+$/, "") || EXPORT_FALLBACK_STEM;
    const base = sessionId ? `${stem}-${sessionId.slice(0, EXPORT_ID_PREFIX_LEN)}` : stem;
    return `${base}.${CHAT_EXPORT_EXTENSION}`;
}

/** Ask where to export, then write `content()` there and say where; a cancel or a null content writes nothing. */
export async function exportChatFile(
    choosePath: (defaultName: string) => Promise<string | null>,
    defaultName: string,
    content: () => Promise<string | null>,
): Promise<void> {
    try {
        const path = await choosePath(defaultName);
        if (!path) return;
        const text = await content();
        if (text === null) return;
        node.writeFileSync(path, text);
        new Notice(MESSAGES.NOTICE_CHAT_EXPORTED(path));
    } catch (err) {
        new Notice(MESSAGES.ERROR_CHAT_EXPORT_FAILED(errorMessage(err, MESSAGES.ERROR_UNKNOWN)));
    }
}

/** Icon on every fork action: the sessions list rows and the chat's answers. */
export const FORK_ICON = "git-fork";

/** Translate the plugin's chunk-type selection into a scope the server can parse. */
export function scopeFromChunkType(chunk: SearchChunkType): SessionScope {
    return chunk === SEARCH_CHUNK_TYPE.ALL ? SESSION_SCOPE.BOTH : chunk;
}

/** Inverse of `scopeFromChunkType`. Null for a scope this build doesn't know. */
export function chunkTypeFromScope(scope: string): SearchChunkType | null {
    switch (scope) {
        case SESSION_SCOPE.BOTH:
            return SEARCH_CHUNK_TYPE.ALL;
        case SESSION_SCOPE.WIKI:
            return SEARCH_CHUNK_TYPE.WIKI;
        case SESSION_SCOPE.RAW:
            return SEARCH_CHUNK_TYPE.RAW;
        default:
            return null;
    }
}

/** Title a session from its first user message: first line, truncated. Mirrors `derive_title`. */
export function deriveSessionTitle(text: string): string {
    const stripped = text.trim();
    if (!stripped) return MESSAGES.SESSIONS_UNTITLED;
    const first = stripped.split(/\r\n|[\r\n]/)[0];
    if (first.length > SESSION_TITLE_MAX_LEN) return first.slice(0, SESSION_TITLE_MAX_LEN) + TITLE_ELLIPSIS;
    return first;
}
