import type { ModelShowResponse } from "../types";
import { MESSAGES } from "../locales/en";

export interface ModelShowRow {
    label: string;
    value: string;
}

/** The labelled rows a /api/models/show answer yields, in a fixed order.
 *  `chat_template` and `parameters` are multi-line blobs and `file_type` is a raw GGUF
 *  code, so none of the three gets a row. */
export function modelShowRows(info: ModelShowResponse): ModelShowRow[] {
    const rows: ModelShowRow[] = [];
    if (info.architecture) rows.push({ label: MESSAGES.LABEL_STATUS_ARCHITECTURE, value: info.architecture });
    if (info.context_length) rows.push({ label: MESSAGES.LABEL_STATUS_CONTEXT_LENGTH, value: info.context_length });
    if (info.embedding_length)
        rows.push({ label: MESSAGES.LABEL_STATUS_EMBEDDING_LENGTH, value: info.embedding_length });
    return rows;
}
