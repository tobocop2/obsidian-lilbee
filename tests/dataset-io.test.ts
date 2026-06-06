import { vi, describe, it, expect, beforeEach } from "vitest";
import { Notice } from "obsidian";
import { datasetErrorMessage, exportDatasetToDisk, importDatasetFromDisk } from "../src/dataset-io";
import { electronDialog } from "../src/utils/file-dialog";
import { node } from "../src/binary-manager";
import { MESSAGES } from "../src/locales/en";
import type { App } from "obsidian";
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

async function* sseEvents(
    events: { event: string; data: unknown }[],
): AsyncGenerator<{ event: string; data: unknown }> {
    for (const e of events) yield e;
}

async function* sseThrows(err: Error): AsyncGenerator<{ event: string; data: unknown }> {
    throw err;
    yield { event: "", data: null };
}

function fakeApi(overrides: Partial<LilbeeClient> = {}): LilbeeClient {
    return {
        exportDataset: vi.fn(),
        importDataset: vi.fn(),
        getSource: vi.fn().mockResolvedValue({ markdown: "note body", content_type: "text/markdown", title: null }),
        ...overrides,
    } as unknown as LilbeeClient;
}

function fakeApp(existing: (path: string) => unknown = () => null): {
    app: App;
    getAbstractFileByPath: ReturnType<typeof vi.fn>;
    createFolder: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    modify: ReturnType<typeof vi.fn>;
} {
    const getAbstractFileByPath = vi.fn((path: string) => existing(path));
    const createFolder = vi.fn().mockResolvedValue(undefined);
    const create = vi.fn().mockResolvedValue(undefined);
    const modify = vi.fn().mockResolvedValue(undefined);
    const app = { vault: { getAbstractFileByPath, createFolder, create, modify } } as unknown as App;
    return { app, getAbstractFileByPath, createFolder, create, modify };
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

    it("falls back to the full message when the body is not JSON", () => {
        const err = new Error("Server responded 500: upstream exploded");
        expect(datasetErrorMessage(err)).toBe("Server responded 500: upstream exploded");
    });

    it("falls back to the full message when JSON has no string detail", () => {
        const err = new Error('Server responded 400: {"other":1}');
        expect(datasetErrorMessage(err)).toBe('Server responded 400: {"other":1}');
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
        await importDatasetFromDisk(fakeApp().app, api, queue);
        expect(readFileSync).not.toHaveBeenCalled();
        expect(api.importDataset).not.toHaveBeenCalled();
    });

    it("does nothing when no file is selected", async () => {
        showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [] });
        const api = fakeApi();
        const { queue } = fakeQueue("task-1");
        await importDatasetFromDisk(fakeApp().app, api, queue);
        expect(readFileSync).not.toHaveBeenCalled();
    });

    it("notifies when the file cannot be read", async () => {
        showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ["/tmp/x.parquet"] });
        readFileSync.mockImplementation(() => {
            throw new Error("EACCES");
        });
        const api = fakeApi();
        const { queue } = fakeQueue("task-1");
        await importDatasetFromDisk(fakeApp().app, api, queue);
        expect(messages()).toContain(MESSAGES.ERROR_DATASET_READ("EACCES"));
        expect(api.importDataset).not.toHaveBeenCalled();
    });

    it("rejects datasets over the upload limit", async () => {
        showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ["/tmp/big.parquet"] });
        readFileSync.mockReturnValue({ byteLength: 11 * 1024 * 1024 } as unknown as Buffer);
        const api = fakeApi();
        const { queue } = fakeQueue("task-1");
        await importDatasetFromDisk(fakeApp().app, api, queue);
        expect(messages()).toContain(MESSAGES.ERROR_DATASET_TOO_LARGE);
        expect(api.importDataset).not.toHaveBeenCalled();
    });

    it("streams progress, materializes notes into a folder, and notifies on success", async () => {
        showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ["/tmp/pages.jsonl"] });
        const data = { byteLength: 3 } as unknown as Buffer;
        readFileSync.mockReturnValue(data);
        const api = fakeApi({
            importDataset: vi.fn(() =>
                sseEvents([
                    { event: "embed", data: { file: "notes.md", chunk: 1, total_chunks: 1 } },
                    { event: "embed", data: {} },
                    { event: "message", data: "noise" },
                    {
                        event: "done",
                        data: { command: "import", sources: ["notes.md", "manual.pdf"], pages: 2, chunks: 5 },
                    },
                ]),
            ),
        });
        const { queue, update, complete } = fakeQueue("task-1");
        const { app, createFolder, create } = fakeApp();
        await importDatasetFromDisk(app, api, queue);

        expect(api.importDataset).toHaveBeenCalledWith(data, "jsonl");
        expect(update).toHaveBeenCalledWith("task-1", 50, MESSAGES.STATUS_DATASET_EMBEDDING("notes.md"));
        // Folder is the dataset stem; each source becomes a markdown note in it.
        expect(createFolder).toHaveBeenCalledWith("pages");
        expect(create).toHaveBeenCalledWith("pages/notes.md", "note body");
        expect(create).toHaveBeenCalledWith("pages/manual.md", "note body");
        expect(complete).toHaveBeenCalledWith("task-1");
        expect(messages()).toContain(MESSAGES.NOTICE_DATASET_IMPORTED(2, 2, 5, "pages"));
    });

    it("reuses an existing folder, overwrites existing notes, and skips unreadable sources", async () => {
        showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ["/tmp/data.parquet"] });
        readFileSync.mockReturnValue({ byteLength: 3 } as unknown as Buffer);
        const api = fakeApi({
            getSource: vi
                .fn()
                .mockResolvedValueOnce({ markdown: "first", content_type: "text/markdown", title: null })
                .mockRejectedValueOnce(new Error("404")),
            importDataset: vi.fn(() =>
                sseEvents([
                    { event: "done", data: { command: "import", sources: ["a.md", "b.md"], pages: 2, chunks: 2 } },
                ]),
            ),
        });
        const { queue } = fakeQueue("task-1");
        // Folder "data" and note "data/a.md" already exist on disk.
        const { app, createFolder, create, modify } = fakeApp((path) =>
            path === "data" || path === "data/a.md" ? {} : null,
        );
        await importDatasetFromDisk(app, api, queue);

        expect(createFolder).not.toHaveBeenCalled();
        expect(modify).toHaveBeenCalledWith({}, "first");
        // b.md's getSource rejected, so it is skipped — no create call.
        expect(create).not.toHaveBeenCalled();
    });

    it("names the import folder 'dataset' when the file is all extension", async () => {
        showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ["/tmp/.parquet"] });
        readFileSync.mockReturnValue({ byteLength: 3 } as unknown as Buffer);
        const api = fakeApi({
            importDataset: vi.fn(() =>
                sseEvents([{ event: "done", data: { command: "import", sources: [], pages: 0, chunks: 0 } }]),
            ),
        });
        const { queue } = fakeQueue("task-1");
        const { app, createFolder } = fakeApp();
        await importDatasetFromDisk(app, api, queue);
        expect(createFolder).toHaveBeenCalledWith("dataset");
    });

    it("notifies when the task queue is full", async () => {
        showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ["/tmp/pages.parquet"] });
        readFileSync.mockReturnValue({ byteLength: 3 } as unknown as Buffer);
        const api = fakeApi();
        const { queue } = fakeQueue(null);
        await importDatasetFromDisk(fakeApp().app, api, queue);
        expect(messages()).toContain(MESSAGES.NOTICE_QUEUE_FULL);
        expect(api.importDataset).not.toHaveBeenCalled();
    });

    it("fails the task on a server error event", async () => {
        showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ["/tmp/pages.parquet"] });
        readFileSync.mockReturnValue({ byteLength: 3 } as unknown as Buffer);
        const api = fakeApi({
            importDataset: vi.fn(() => sseEvents([{ event: "error", data: { message: "embedding model mismatch" } }])),
        });
        const { queue, fail } = fakeQueue("task-1");
        await importDatasetFromDisk(fakeApp().app, api, queue);
        expect(fail).toHaveBeenCalledWith("task-1", "embedding model mismatch");
        expect(messages()).toContain(MESSAGES.ERROR_DATASET_IMPORT("embedding model mismatch"));
    });

    it("fails the task when the stream ends without a done event", async () => {
        showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ["/tmp/pages.parquet"] });
        readFileSync.mockReturnValue({ byteLength: 3 } as unknown as Buffer);
        const api = fakeApi({
            importDataset: vi.fn(() => sseEvents([{ event: "embed", data: { file: "doc.pdf" } }])),
        });
        const { queue, fail } = fakeQueue("task-1");
        await importDatasetFromDisk(fakeApp().app, api, queue);
        expect(fail).toHaveBeenCalledWith("task-1", MESSAGES.ERROR_UNKNOWN);
        expect(messages()).toContain(MESSAGES.ERROR_DATASET_IMPORT(MESSAGES.ERROR_UNKNOWN));
    });

    it("fails the task and surfaces the server detail when the request throws", async () => {
        showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ["/tmp/pages.parquet"] });
        readFileSync.mockReturnValue({ byteLength: 3 } as unknown as Buffer);
        const err = new Error('Server responded 401: {"detail":"bad token"}');
        const api = fakeApi({ importDataset: vi.fn(() => sseThrows(err)) });
        const { queue, fail } = fakeQueue("task-1");
        await importDatasetFromDisk(fakeApp().app, api, queue);
        expect(fail).toHaveBeenCalledWith("task-1", "bad token");
        expect(messages()).toContain(MESSAGES.ERROR_DATASET_IMPORT("bad token"));
    });
});
