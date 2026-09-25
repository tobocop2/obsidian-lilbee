import { parse } from "content-disposition";

/** Everything up to the last path separator on any desktop platform. */
const FOLDER_PREFIX = /^.*[/\\]/s;

/** Names that point at a folder rather than a file. */
const FOLDER_NAMES: ReadonlySet<string> = new Set(["", ".", ".."]);

/** The file name a `Content-Disposition` header gives (`filename*` first), cut to its last path segment; null when there is none. */
export function attachmentFileName(header: string | null): string | null {
    if (!header) return null;
    const name = parse(header).parameters.filename;
    if (name === undefined) return null;
    const base = name.replace(FOLDER_PREFIX, "");
    return FOLDER_NAMES.has(base) ? null : base;
}
