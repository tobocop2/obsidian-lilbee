import { Notice } from "obsidian";
import type { SetModelResponse } from "../types";

/** Show each warning the server attached to a model change, such as a vision model that OCR mode "off" leaves unused. */
export function noticeModelWarnings(response: SetModelResponse | undefined): void {
    for (const warning of response?.warnings ?? []) new Notice(warning);
}
