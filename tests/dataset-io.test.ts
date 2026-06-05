import { vi, describe, it, expect, beforeEach } from "vitest";
import { Notice } from "obsidian";
import { datasetErrorMessage, exportDatasetToDisk, importDatasetFromDisk } from "../src/dataset-io";
import { electronDialog } from "../src/utils/file-dialog";
import { node } from "../src/binary-manager";
import { MESSAGES } from "../src/locales/en";
import type { LilbeeClient } from "../src/api";
import type { TaskQueue } from "../src/task-queue";

vi.mock("../src/utils/file-dialog", () => ({
    electronDialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
}));

vi.mock("../src/binary-manager", () => ({
    node: { writeFileSync: vi.fn(), readFileSync: vi.fn() },
}));

const showSaveDialog = electronDialog.showSaveDialog as ReturnType<typeof vi.fn>;
const showOpenDialog = electronDialog.showOpenDialog as ReturnType<typeof vi.fn>;
const writeFileSync = node.writeFileSync as unknown as ReturnType<typeof vi.fn>;
const readFileSync = node.readFileSync as unknown as ReturnType<typeof vi.fn>;

function fakeApi(overrides: Partial<LilbeeClient> = {}): LilbeeClient {
    return {
        exportDataset: vi.fn(),
        importDataset: vi.fn(),
        ...overrides,
    } as unknown as LilbeeClient;
}

function fakeQueue(enqueueId: string | null): {
    queue: TaskQueue;
    update: ReturnType<typeof vi.fn>;
    complete: ReturnType<typeof vi.fn>;
    fail: ReturnType<typeof vi.fn>;
} {
    const update = vi.fn();
    const complete = vi.fn();
    const fail = vi.fn();
    const queue = { enqueue: vi.fn().mockReturnValue(enqueueId), update, complete, fail } as unknown as TaskQueue;
    return { queue, update, complete, fail };
}

function messages(): string[] {
    return Notice.instances.map((n) => n.message);
}

beforeEach(() => {
    vi.clearAllMocks();
    Notice.clear();
});

describe("datasetErrorMessage()", () => {
    it("stringifies non-Error values", () => {
        expect(datasetErrorMessage(404)).toBe("404");
    });

    it("returns the message for a plain Error", () => {
        expect(datasetErrorMessage(new Error("boom"))).toBe("boom");
    });

    it("extracts the server detail from a JSON error body", () => {
        const err = new Error('Server responded 400: {"status_code":400,"detail":"Source not found: x.pdf"}');
        expect(datasetErrorMessage(err)).toBe("Source not found: x.pdf");
    });

    it("returns the raw body when it is not JSON", () => {
        const err = new Error("Server responded 500: upstream exploded");
        expect(datasetErrorMessage(err)).toBe("upstream exploded");
    });

    it("returns the raw body when JSON has no string detail", () => {
        const err = new Error('Server responded 400: {"other":1}');
        expect(datasetErrorMessage(err)).toBe('{"other":1}');
    });
});

describe("exportDatasetToDisk()", () => {
    it("does nothing when the save dialog is canceled", async () => {
        showSaveDialog.mockResolvedValue({ canceled: true });
        const api = fakeApi();
        await exportDatasetToDisk(api);
        expect(api.exportDataset).not.toHaveBeenCalled();
        expect(writeFileSync).not.toHaveBeenCalled();
        expect(messages()).toHaveLength(0);
    });

    it("does nothing when no path is chosen", async () => {
        showSaveDialog.mockResolvedValue({ canceled: false, filePath: "" });
        const api = fakeApi();
        await exportDatasetToDisk(api);
        expect(api.exportDataset).not.toHaveBeenCalled();
    });

    it("writes parquet bytes and notifies on success", async () => {
        showSaveDialog.mockResolvedValue({ canceled: false, filePath: "/tmp/pages.parquet" });
        const bytes = new Uint8Array([1, 2]).buffer;
        const api = fakeApi({ exportDataset: vi.fn().mockResolvedValue(bytes) });
        await exportDatasetToDisk(api);
        expect(api.exportDataset).toHaveBeenCalledWith("parquet");
        expect(writeFileSync).toHaveBeenCalledTimes(1);
        expect(writeFileSync.mock.calls[0][0]).toBe("/tmp/pages.parquet");
        expect(messages()).toContain(MESSAGES.NOTICE_DATASET_EXPORTED("/tmp/pages.parquet"));
    });

    it("infers jsonl format from the extension", async () => {
        showSaveDialog.mockResolvedValue({ canceled: false, filePath: "/tmp/pages.jsonl" });
        const api = fakeApi({ exportDataset: vi.fn().mockResolvedValue(new ArrayBuffer(0)) });
        await exportDatasetToDisk(api);
        expect(api.exportDataset).toHaveBeenCalledWith("jsonl");
    });

    it("notifies on export failure", async () => {
        showSaveDialog.mockResolvedValue({ canceled: false, filePath: "/tmp/pages.parquet" });
        const api = fakeApi({ exportDataset: vi.fn().mockRejectedValue(new Error("Nothing to export")) });
        await exportDatasetToDisk(api);
        expect(messages()).toContain(MESSAGES.ERROR_DATASET_EXPORT("Nothing to export"));
    });
});

describe("importDatasetFromDisk()", () => {
    it("does nothing when the open dialog is canceled", async () => {
        showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
        const api = fakeApi();
        const { queue } = fakeQueue("task-1");
        await importDatasetFromDisk(api, queue);
        expect(readFileSync).not.toHaveBeenCalled();
        expect(api.importDataset).not.toHaveBeenCalled();
    });

    it("does nothing when no file is selected", async () => {
        showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [] });
        const api = fakeApi();
        const { queue } = fakeQueue("task-1");
        await importDatasetFromDisk(api, queue);
        expect(readFileSync).not.toHaveBeenCalled();
    });

    it("notifies when the file cannot be read", async () => {
        showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ["/tmp/x.parquet"] });
        readFileSync.mockImplementation(() => {
            throw new Error("EACCES");
        });
        const api = fakeApi();
        const { queue } = fakeQueue("task-1");
        await importDatasetFromDisk(api, queue);
        expect(messages()).toContain(MESSAGES.ERROR_DATASET_READ("EACCES"));
        expect(api.importDataset).not.toHaveBeenCalled();
    });

    it("rejects datasets over the upload limit", async () => {
        showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ["/tmp/big.parquet"] });
        readFileSync.mockReturnValue({ byteLength: 11 * 1024 * 1024 } as unknown as Buffer);
        const api = fakeApi();
        const { queue } = fakeQueue("task-1");
        await importDatasetFromDisk(api, queue);
        expect(messages()).toContain(MESSAGES.ERROR_DATASET_TOO_LARGE);
        expect(api.importDataset).not.toHaveBeenCalled();
    });

    it("imports, completes the task, and notifies on success", async () => {
        showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ["/tmp/pages.jsonl"] });
        const data = { byteLength: 3 } as unknown as Buffer;
        readFileSync.mockReturnValue(data);
        const summary = { sources: ["doc.pdf"], pages: 2, chunks: 5 };
        const api = fakeApi({ importDataset: vi.fn().mockResolvedValue(summary) });
        const { queue, update, complete } = fakeQueue("task-1");
        await importDatasetFromDisk(api, queue);
        expect(api.importDataset).toHaveBeenCalledWith(data, "jsonl");
        expect(update).toHaveBeenCalledWith("task-1", 50, MESSAGES.STATUS_DATASET_IMPORTING);
        expect(complete).toHaveBeenCalledWith("task-1");
        expect(messages()).toContain(MESSAGES.NOTICE_DATASET_IMPORTED(1, 2, 5));
    });

    it("notifies when the task queue is full", async () => {
        showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ["/tmp/pages.parquet"] });
        readFileSync.mockReturnValue({ byteLength: 3 } as unknown as Buffer);
        const api = fakeApi();
        const { queue } = fakeQueue(null);
        await importDatasetFromDisk(api, queue);
        expect(messages()).toContain(MESSAGES.NOTICE_QUEUE_FULL);
        expect(api.importDataset).not.toHaveBeenCalled();
    });

    it("fails the task and surfaces the server detail on import error", async () => {
        showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ["/tmp/pages.parquet"] });
        readFileSync.mockReturnValue({ byteLength: 3 } as unknown as Buffer);
        const err = new Error('Server responded 400: {"detail":"embedding model mismatch"}');
        const api = fakeApi({ importDataset: vi.fn().mockRejectedValue(err) });
        const { queue, fail } = fakeQueue("task-1");
        await importDatasetFromDisk(api, queue);
        expect(fail).toHaveBeenCalledWith("task-1", "embedding model mismatch");
        expect(messages()).toContain(MESSAGES.ERROR_DATASET_IMPORT("embedding model mismatch"));
    });
});
