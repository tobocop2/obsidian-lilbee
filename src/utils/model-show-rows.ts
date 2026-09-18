import type { ModelShowResponse } from "../types";
import { MESSAGES } from "../locales/en";

export interface ModelShowRow {
    label: string;
    value: string;
}

/** The labelled rows a /api/models/show answer yields. Empty when the server knows nothing. */
export function modelShowRows(info: ModelShowResponse): ModelShowRow[] {
    const rows: ModelShowRow[] = [];
    if (info.architecture) rows.push({ label: MESSAGES.LABEL_STATUS_ARCHITECTURE, value: info.architecture });
    if (info.context_length) rows.push({ label: MESSAGES.LABEL_STATUS_CONTEXT_LENGTH, value: info.context_length });
    return rows;
}
