import { Notice } from "obsidian";
import type { LilbeeClient } from "./api";
import type { TaskQueue } from "./task-queue";
import { DATASET_FORMAT, TASK_TYPE, type DatasetFormat } from "./types";
import { MESSAGES } from "./locales/en";
import { node } from "./binary-manager";
import { electronDialog } from "./utils/file-dialog";

const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
const IMPORT_PROGRESS_PCT = 50;
const JSONL_EXTENSION = ".jsonl";
const DEFAULT_EXPORT_NAME = "pages.parquet";
const DATASET_EXTENSIONS = ["parquet", "jsonl"];
const SERVER_ERROR_PATTERN = /^Server responded \d+: (.*)$/s;

/** Pick the dataset format from a file path's extension (defaults to parquet). */
function formatFromPath(path: string): DatasetFormat {
    return path.toLowerCase().endsWith(JSONL_EXTENSION) ? DATASET_FORMAT.JSONL : DATASET_FORMAT.PARQUET;
}

/** Extract the server's user-facing `detail` from a thrown HTTP error message. */
export function datasetErrorMessage(err: unknown): string {
    if (!(err instanceof Error)) return String(err);
    const match = SERVER_ERROR_PATTERN.exec(err.message);
    if (!match) return err.message;
    try {
        const body = JSON.parse(match[1]) as { detail?: unknown };
        if (typeof body.detail === "string") return body.detail;
    } catch {
        /* not JSON — fall through to the raw body */
    }
    return match[1];
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

export async function importDatasetFromDisk(api: LilbeeClient, taskQueue: TaskQueue): Promise<void> {
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
    await runImport(api, taskQueue, data, formatFromPath(source));
}

async function runImport(
    api: LilbeeClient,
    taskQueue: TaskQueue,
    data: Uint8Array,
    format: DatasetFormat,
): Promise<void> {
    const taskId = taskQueue.enqueue(MESSAGES.LABEL_DATASET_IMPORT_TASK, TASK_TYPE.IMPORT);
    if (taskId === null) {
        new Notice(MESSAGES.NOTICE_QUEUE_FULL);
        return;
    }
    taskQueue.update(taskId, IMPORT_PROGRESS_PCT, MESSAGES.STATUS_DATASET_IMPORTING);
    try {
        const result = await api.importDataset(data, format);
        taskQueue.complete(taskId);
        new Notice(MESSAGES.NOTICE_DATASET_IMPORTED(result.sources.length, result.pages, result.chunks));
    } catch (err) {
        const message = datasetErrorMessage(err);
        taskQueue.fail(taskId, message);
        new Notice(MESSAGES.ERROR_DATASET_IMPORT(message));
    }
}
