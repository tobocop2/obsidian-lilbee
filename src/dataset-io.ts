import { Notice, type App, type TFile } from "obsidian";
import type { LilbeeClient } from "./api";
import type { TaskQueue } from "./task-queue";
import {
    DATASET_FORMAT,
    SSE_EVENT,
    TASK_TYPE,
    type DatasetFormat,
    type DatasetImportResponse,
    type SourceContent,
} from "./types";
import { MESSAGES } from "./locales/en";
import { node } from "./binary-manager";
import { electronDialog } from "./utils/file-dialog";
import { extractServerErrorDetail, extractSseErrorMessage } from "./utils";

const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
const IMPORT_PROGRESS_PCT = 50;
const JSONL_EXTENSION = ".jsonl";
const MARKDOWN_EXTENSION = ".md";
const DEFAULT_EXPORT_NAME = "pages.parquet";
const DATASET_EXTENSIONS = ["parquet", "jsonl"];

/** Pick the dataset format from a file path's extension (defaults to parquet). */
function formatFromPath(path: string): DatasetFormat {
    return path.toLowerCase().endsWith(JSONL_EXTENSION) ? DATASET_FORMAT.JSONL : DATASET_FORMAT.PARQUET;
}

/** Folder name for an import: the dataset file's stem (without extension). */
function datasetStem(path: string): string {
    // split() always yields at least one element, so pop() is never undefined.
    const base = path.split("/").pop()!;
    return base.replace(/\.[^.]+$/, "") || "dataset";
}

/** Vault note name for a source: keep an existing `.md`, otherwise use a markdown extension. */
function noteName(source: string): string {
    const base = source.split("/").pop()!;
    return base.toLowerCase().endsWith(MARKDOWN_EXTENSION) ? base : base.replace(/\.[^.]+$/, "") + MARKDOWN_EXTENSION;
}

/** Prefer the server's user-facing `detail` over the raw thrown HTTP error message. */
export function datasetErrorMessage(err: unknown): string {
    if (!(err instanceof Error)) return String(err);
    return extractServerErrorDetail(err.message) ?? err.message;
}

export async function exportDatasetToDisk(api: LilbeeClient): Promise<void> {
    const result = await electronDialog.showSaveDialog({ defaultPath: DEFAULT_EXPORT_NAME });
    if (result.canceled || !result.filePath) return;
    const destination = result.filePath;
    try {
        const bytes = await api.exportDataset(formatFromPath(destination));
        node.writeFileSync(destination, Buffer.from(bytes));
        new Notice(MESSAGES.NOTICE_DATASET_EXPORTED(destination));
    } catch (err) {
        new Notice(MESSAGES.ERROR_DATASET_EXPORT(datasetErrorMessage(err)));
    }
}

export async function importDatasetFromDisk(app: App, api: LilbeeClient, taskQueue: TaskQueue): Promise<void> {
    const result = await electronDialog.showOpenDialog({
        properties: ["openFile"],
        filters: [{ name: MESSAGES.LABEL_DATASET_FILTER, extensions: DATASET_EXTENSIONS }],
    });
    if (result.canceled || result.filePaths.length === 0) return;
    const source = result.filePaths[0];
    let data: Buffer;
    try {
        data = node.readFileSync(source);
    } catch (err) {
        new Notice(MESSAGES.ERROR_DATASET_READ(datasetErrorMessage(err)));
        return;
    }
    if (data.byteLength > MAX_IMPORT_BYTES) {
        new Notice(MESSAGES.ERROR_DATASET_TOO_LARGE);
        return;
    }
    await runImport(app, api, taskQueue, data, formatFromPath(source), datasetStem(source));
}

/** Write each imported source into the vault as a note so it appears natively and citations resolve. */
async function materializeSources(app: App, api: LilbeeClient, sources: string[], folder: string): Promise<void> {
    if (app.vault.getAbstractFileByPath(folder) === null) await app.vault.createFolder(folder);
    for (const source of sources) {
        let content: SourceContent;
        try {
            content = await api.getSource(source);
        } catch {
            continue;
        }
        const path = `${folder}/${noteName(source)}`;
        const existing = app.vault.getAbstractFileByPath(path);
        if (existing === null) await app.vault.create(path, content.markdown);
        else await app.vault.modify(existing as TFile, content.markdown);
    }
}

async function runImport(
    app: App,
    api: LilbeeClient,
    taskQueue: TaskQueue,
    data: Uint8Array,
    format: DatasetFormat,
    folder: string,
): Promise<void> {
    const taskId = taskQueue.enqueue(MESSAGES.LABEL_DATASET_IMPORT_TASK, TASK_TYPE.IMPORT);
    if (taskId === null) {
        new Notice(MESSAGES.NOTICE_QUEUE_FULL);
        return;
    }
    taskQueue.update(taskId, IMPORT_PROGRESS_PCT, MESSAGES.STATUS_DATASET_IMPORTING);
    try {
        let summary: DatasetImportResponse | null = null;
        for await (const event of api.importDataset(data, format)) {
            if (event.event === SSE_EVENT.EMBED) {
                const detail = (event.data as { file?: string }).file ?? "";
                taskQueue.update(taskId, IMPORT_PROGRESS_PCT, MESSAGES.STATUS_DATASET_EMBEDDING(detail));
            } else if (event.event === SSE_EVENT.ERROR) {
                const message = extractSseErrorMessage(event.data, MESSAGES.ERROR_UNKNOWN);
                taskQueue.fail(taskId, message);
                new Notice(MESSAGES.ERROR_DATASET_IMPORT(message));
                return;
            } else if (event.event === SSE_EVENT.DONE) {
                summary = event.data as DatasetImportResponse;
            }
        }
        if (summary === null) {
            taskQueue.fail(taskId, MESSAGES.ERROR_UNKNOWN);
            new Notice(MESSAGES.ERROR_DATASET_IMPORT(MESSAGES.ERROR_UNKNOWN));
            return;
        }
        await materializeSources(app, api, summary.sources, folder);
        taskQueue.complete(taskId);
        new Notice(MESSAGES.NOTICE_DATASET_IMPORTED(summary.sources.length, summary.pages, summary.chunks, folder));
    } catch (err) {
        const message = datasetErrorMessage(err);
        taskQueue.fail(taskId, message);
        new Notice(MESSAGES.ERROR_DATASET_IMPORT(message));
    }
}
