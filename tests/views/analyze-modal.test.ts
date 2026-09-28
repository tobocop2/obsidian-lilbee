import { vi, describe, it, expect, beforeEach } from "vitest";
import { App, Notice } from "obsidian";
import { MockElement } from "../__mocks__/obsidian";
import { AnalyzeModal } from "../../src/views/analyze-modal";
import { MESSAGES } from "../../src/locales/en";
import { PROFILE_FOLDER } from "../../src/types";
import type { AnalyzeResponse } from "../../src/types";
import { button, buttonLabels, byTag } from "../profile-fixtures";

const openMock = vi.fn();
let nameModalOptions: {
    title: string;
    askTarget: boolean;
    submit: (name: string, target: string) => Promise<string | null>;
} | null = null;

vi.mock("../../src/views/profile-name-modal", () => ({
    ProfileNameModal: vi.fn().mockImplementation(function (
        this: { open: typeof openMock },
        _app: unknown,
        options: typeof nameModalOptions,
    ) {
        nameModalOptions = options;
        this.open = openMock;
    }),
}));

/** Let a pending analyze call and its handler settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const BASE_REPORT: AnalyzeResponse = {
    files_total: 4,
    documents_total: 1,
    files_read: 1,
    files_counted: 3,
    cap: 500,
    failed: [],
    file_types: { ".md": 1 },
    code_share: 0.25,
    pdf: {
        files: 0,
        pages: 0,
        scanned_pages: 0,
        scanned_share: 0,
        files_with_tables: 0,
        tables: 0,
        median_pages: null,
    },
    median_chars: 120,
    languages: [],
    recommendation: { builtin: "Default", name: null, values: {}, changes: [], kept: [], reasons: [], notes: [] },
    saved: null,
};

const FULL_REPORT: AnalyzeResponse = {
    ...BASE_REPORT,
    files_read: 3,
    documents_total: 5,
    failed: [{ file: "bad.pdf", error: "corrupt" }],
    pdf: {
        files: 2,
        pages: 10,
        scanned_pages: 5,
        scanned_share: 0.5,
        files_with_tables: 1,
        tables: 2,
        median_pages: 5,
    },
    languages: [
        { code: "eng", share: 0.8, fts_language: "english", ocr_supported: true },
        { code: "chi_sim", share: 0.2, fts_language: null, ocr_supported: false },
    ],
    recommendation: {
        builtin: "Scanned archive",
        name: null,
        values: {},
        changes: [
            { key: "enable_ocr", current: false, current_source: "user", new: true, effect: "reindex" },
            { key: "chunk_size", current: 500, current_source: "profile", new: 800, effect: "new_files_only" },
        ],
        kept: ["chunk_overlap"],
        reasons: [{ key: "profile", text: "Most pages are scans." }],
        notes: ["Images are counted, not read."],
    },
    saved: null,
};

type StreamEvent = { event: string; data: unknown };

function makePlugin(events: StreamEvent[]): {
    app: App;
    settings: { serverMode: string };
    triggerSync: ReturnType<typeof vi.fn>;
    api: { analyzeStream: ReturnType<typeof vi.fn> };
} {
    return {
        app: new App(),
        settings: { serverMode: "managed" },
        triggerSync: vi.fn(),
        api: {
            analyzeStream: vi.fn(async function* () {
                for (const event of events) yield event;
            }),
        },
    };
}

function throwingPlugin(error: unknown) {
    return {
        app: new App(),
        settings: { serverMode: "managed" },
        triggerSync: vi.fn(),
        api: {
            analyzeStream: vi.fn(() => {
                throw error;
            }),
        },
    };
}

function el(modal: AnalyzeModal): MockElement {
    return modal.contentEl as unknown as MockElement;
}

async function openToReport(
    report: AnalyzeResponse = FULL_REPORT,
): Promise<{ modal: AnalyzeModal; plugin: ReturnType<typeof makePlugin>; onDone: ReturnType<typeof vi.fn> }> {
    const plugin = makePlugin([{ event: "done", data: report }]);
    const onDone = vi.fn();

    const modal = new AnalyzeModal(plugin.app, plugin as any, null, onDone);
    modal.open();
    await settle();
    return { modal, plugin, onDone };
}

beforeEach(() => {
    Notice.clear();
    openMock.mockClear();
    nameModalOptions = null;
});

describe("AnalyzeModal running phase", () => {
    it("shows the running title and a status line while it reads", () => {
        const plugin = makePlugin([]);

        const modal = new AnalyzeModal(plugin.app, plugin as any, null);
        modal.open();
        expect(byTag(el(modal), "h3")[0].textContent).toBe(MESSAGES.TITLE_ANALYZE_RUNNING);
        expect(byTag(el(modal), "p")[0].textContent).toBe(MESSAGES.STATUS_ANALYZE_STARTING);
    });

    it("updates the status line as analyze progress frames arrive", async () => {
        const plugin = makePlugin([
            { event: "analyze", data: { done: 1, total: 3, file: "a.md" } },
            { event: "done", data: BASE_REPORT },
        ]);

        const modal = new AnalyzeModal(plugin.app, plugin as any, null);
        modal.open();
        await settle();
        // The report has rendered by now; check the report title replaced the running one.
        expect(byTag(el(modal), "h3")[0].textContent).toBe(MESSAGES.TITLE_ANALYZE_REPORT);
    });

    it("aborts the run when Cancel is clicked, and closes with no notice", async () => {
        const plugin = makePlugin([]);
        plugin.api.analyzeStream.mockImplementation(function (_dir: unknown, _opts: unknown, signal: AbortSignal) {
            return (async function* () {
                await new Promise<void>((resolve) => {
                    signal.addEventListener("abort", () => resolve());
                });
                throw Object.assign(new Error("aborted"), { name: "AbortError" });
            })();
        });
        const onDone = vi.fn();

        const modal = new AnalyzeModal(plugin.app, plugin as any, null, onDone);
        modal.open();
        button(el(modal), MESSAGES.BUTTON_CANCEL)!.trigger("click");
        await settle();
        expect(Notice.instances).toHaveLength(0);
        expect(onDone).toHaveBeenCalledTimes(1);
    });

    it("shows a notice and closes when the server predates analyze", async () => {
        const plugin = throwingPlugin(new Error("Server responded 404: {}"));
        const onDone = vi.fn();

        const modal = new AnalyzeModal(plugin.app, plugin as any, null, onDone);
        modal.open();
        await settle();
        expect(Notice.instances.map((n) => n.message)).toContain(MESSAGES.NOTICE_ANALYZE_UNSUPPORTED);
        expect(onDone).toHaveBeenCalledTimes(1);
    });

    it("shows a notice and closes when the preview run fails", async () => {
        const plugin = makePlugin([{ event: "error", data: "boom" }]);
        const onDone = vi.fn();

        const modal = new AnalyzeModal(plugin.app, plugin as any, null, onDone);
        modal.open();
        await settle();
        expect(Notice.instances.map((n) => n.message)).toContain(MESSAGES.ERROR_ANALYZE_ACTION("boom"));
        expect(onDone).toHaveBeenCalledTimes(1);
    });

    it("fires onDone once even if the modal is closed more than once", async () => {
        const plugin = makePlugin([]);
        const onDone = vi.fn();

        const modal = new AnalyzeModal(plugin.app, plugin as any, null, onDone);
        modal.open();
        modal.close();
        modal.close();
        await settle();
        expect(onDone).toHaveBeenCalledTimes(1);
    });

    it("does not render into a modal already closed by the user mid-run", async () => {
        let resolveNext: (() => void) | null = null;
        const plugin = makePlugin([]);
        plugin.api.analyzeStream.mockImplementation(function () {
            return (async function* () {
                yield { event: "analyze", data: { done: 0, total: 1, file: "a.md" } };
                await new Promise<void>((resolve) => (resolveNext = resolve));
                yield { event: "done", data: BASE_REPORT };
            })();
        });
        const onDone = vi.fn();

        const modal = new AnalyzeModal(plugin.app, plugin as any, null, onDone);
        modal.open();
        await settle();
        modal.close();
        resolveNext!();
        await settle();
        // Still the running/closed content; the report never overwrote it, and onDone fired once.
        expect(onDone).toHaveBeenCalledTimes(1);
    });
});

describe("AnalyzeModal defensive guards", () => {
    it("renderReport no-ops when there is no report to show", () => {
        const plugin = makePlugin([]);

        const modal = new AnalyzeModal(plugin.app, plugin as any, null) as any;
        modal.open();
        const before = el(modal).children.length;
        modal.renderReport();
        expect(el(modal).children.length).toBe(before);
    });

    it("saveOnly no-ops when there is no report to save", () => {
        const plugin = makePlugin([]);

        const modal = new AnalyzeModal(plugin.app, plugin as any, null) as any;
        modal.open();
        modal.saveOnly();
        expect(nameModalOptions).toBeNull();
    });
});

describe("AnalyzeModal report phase", () => {
    it("shows the reading line and the sampled note when fewer documents were read than exist", async () => {
        const { modal } = await openToReport({ ...FULL_REPORT, documents_total: 10, files_read: 3, failed: [] });
        expect(el(modal).find("lilbee-analyze-reading")?.textContent).toBe(MESSAGES.LABEL_ANALYZE_READING(3, 10, 3));
        expect(el(modal).find("lilbee-analyze-sampled")?.textContent).toBe(MESSAGES.LABEL_ANALYZE_SAMPLED(500));
    });

    it("omits the sampled note when every document was read", async () => {
        const { modal } = await openToReport({
            ...FULL_REPORT,
            documents_total: 4,
            files_read: 3,
            failed: [{ file: "bad.pdf", error: "corrupt" }],
        });
        expect(el(modal).find("lilbee-analyze-sampled")).toBeNull();
    });

    it("lists files analyze could not read", async () => {
        const { modal } = await openToReport();
        expect(el(modal).find("lilbee-analyze-failures")?.textContent).toBe("bad.pdf: corrupt");
    });

    it("omits the failures section when nothing failed", async () => {
        const { modal } = await openToReport(BASE_REPORT);
        expect(el(modal).find("lilbee-analyze-failures")).toBeNull();
    });

    it("shows code share, PDF stats and languages", async () => {
        const { modal } = await openToReport();
        const stats = el(modal).find("lilbee-analyze-stats")!;
        expect(stats.textContent).toContain(MESSAGES.LABEL_ANALYZE_CODE_SHARE(25));
        expect(stats.textContent).toContain(MESSAGES.LABEL_ANALYZE_PDF_SUMMARY(2, 50, 2));
        expect(byTag(el(modal), "table").length).toBeGreaterThan(0);
    });

    it("omits the PDF line when there are no PDFs", async () => {
        const { modal } = await openToReport(BASE_REPORT);
        expect(el(modal).find("lilbee-analyze-stats")?.textContent).not.toContain("PDFs");
    });

    it("omits the languages table when nothing was detected", async () => {
        const { modal } = await openToReport(BASE_REPORT);
        expect(byTag(el(modal), "table").length).toBe(0);
    });

    it("shows the recommendation's changes, kept values, reasons and notes", async () => {
        const { modal } = await openToReport();
        const tables = byTag(el(modal), "table");
        const changesTable = tables[tables.length - 1];
        expect(changesTable.children.map((tr) => tr.children.map((c) => c.textContent))).toEqual([
            [
                MESSAGES.PROFILE_COL_SETTING,
                MESSAGES.PROFILE_COL_NOW,
                MESSAGES.PROFILE_COL_AFTER,
                MESSAGES.PROFILE_COL_COST,
            ],
            ["enable_ocr", "off", "on", "reindex"],
            ["chunk_size", "500", "800", "new files only"],
        ]);
        expect(el(modal).find("lilbee-analyze-kept")?.textContent).toBe(
            `${MESSAGES.LABEL_ANALYZE_KEPT}: chunk_overlap`,
        );
        expect(el(modal).textContent).toContain("Most pages are scans.");
        expect(el(modal).textContent).toContain("Images are counted, not read.");
    });

    it("says there is nothing to change when the recommendation has no changes", async () => {
        const { modal } = await openToReport(BASE_REPORT);
        expect(el(modal).find("lilbee-analyze-nothing")?.textContent).toBe(MESSAGES.LABEL_ANALYZE_NOTHING_TO_CHANGE);
        expect(buttonLabels(el(modal))).toEqual([
            MESSAGES.BUTTON_PROFILE_APPLY,
            MESSAGES.BUTTON_ANALYZE_SAVE_ONLY,
            MESSAGES.BUTTON_CLOSE,
        ]);
    });

    it("offers Apply and reindex only when a change needs a reindex", async () => {
        const { modal } = await openToReport();
        expect(buttonLabels(el(modal))).toEqual([
            MESSAGES.BUTTON_PROFILE_APPLY_REINDEX,
            MESSAGES.BUTTON_PROFILE_APPLY,
            MESSAGES.BUTTON_ANALYZE_SAVE_ONLY,
            MESSAGES.BUTTON_CLOSE,
        ]);
    });

    it("closes without applying or saving anything when Close is clicked", async () => {
        const { modal, plugin, onDone } = await openToReport();
        button(el(modal), MESSAGES.BUTTON_CLOSE)!.trigger("click");
        expect(plugin.api.analyzeStream).toHaveBeenCalledTimes(1);
        expect(onDone).toHaveBeenCalledTimes(1);
    });
});

describe("AnalyzeModal apply", () => {
    it("applies without reindexing, shows the switch notice, and does not trigger a sync", async () => {
        const { modal, plugin, onDone } = await openToReport();
        plugin.api.analyzeStream.mockImplementation(async function* () {
            yield { event: "analyze", data: { done: 1, total: 1, file: "a.md" } };
            yield {
                event: "done",
                data: {
                    ...FULL_REPORT,
                    saved: { name: "Scanned archive (my vault)", folder: "project", path: "/p", applied: true },
                },
            };
        });
        button(el(modal), MESSAGES.BUTTON_PROFILE_APPLY)!.trigger("click");
        await settle();
        expect(Notice.instances.map((n) => n.message)).toContain(
            MESSAGES.NOTICE_ANALYZE_APPLIED("Scanned archive (my vault)"),
        );
        expect(plugin.triggerSync).not.toHaveBeenCalled();
        expect(onDone).toHaveBeenCalledTimes(1);
    });

    it("applies and reindexes when Apply and reindex is clicked", async () => {
        const { modal, plugin } = await openToReport();
        plugin.api.analyzeStream.mockImplementation(async function* () {
            yield {
                event: "done",
                data: {
                    ...FULL_REPORT,
                    saved: { name: "Scanned archive (my vault)", folder: "project", path: "/p", applied: true },
                },
            };
        });
        button(el(modal), MESSAGES.BUTTON_PROFILE_APPLY_REINDEX)!.trigger("click");
        await settle();
        expect(plugin.triggerSync).toHaveBeenCalledWith({ forceRebuild: true });
    });

    it("sends apply true and no target on the follow-up call", async () => {
        const { modal, plugin } = await openToReport();
        button(el(modal), MESSAGES.BUTTON_PROFILE_APPLY)!.trigger("click");
        await settle();
        expect(plugin.api.analyzeStream).toHaveBeenLastCalledWith(null, { apply: true }, expect.anything());
    });

    it("returns to the report with a notice when the apply run fails", async () => {
        const { modal, plugin } = await openToReport();
        plugin.api.analyzeStream.mockImplementation(async function* () {
            yield { event: "error", data: "Could not save the change: disk full" };
        });
        button(el(modal), MESSAGES.BUTTON_PROFILE_APPLY)!.trigger("click");
        await settle();
        expect(Notice.instances.map((n) => n.message)).toContain(
            MESSAGES.ERROR_ANALYZE_ACTION("Could not save the change: disk full"),
        );
        expect(buttonLabels(el(modal))).toContain(MESSAGES.BUTTON_PROFILE_APPLY);
    });

    it("returns to the report with no notice when the apply run is cancelled", async () => {
        const { modal, plugin } = await openToReport();
        plugin.api.analyzeStream.mockImplementation(function (_dir: unknown, _opts: unknown, signal: AbortSignal) {
            return (async function* () {
                await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve()));
                throw Object.assign(new Error("aborted"), { name: "AbortError" });
            })();
        });
        button(el(modal), MESSAGES.BUTTON_PROFILE_APPLY)!.trigger("click");
        button(el(modal), MESSAGES.BUTTON_CANCEL)!.trigger("click");
        await settle();
        expect(Notice.instances).toHaveLength(0);
        expect(buttonLabels(el(modal))).toContain(MESSAGES.BUTTON_PROFILE_APPLY);
    });

    it("does not re-render the report when the modal is closed mid-apply", async () => {
        const { modal, plugin, onDone } = await openToReport();
        let resolveNext: (() => void) | null = null;
        plugin.api.analyzeStream.mockImplementation(function () {
            return (async function* () {
                yield { event: "analyze", data: { done: 0, total: 1, file: "a.md" } };
                await new Promise<void>((resolve) => (resolveNext = resolve));
                yield { event: "error", data: "boom" };
            })();
        });
        button(el(modal), MESSAGES.BUTTON_PROFILE_APPLY)!.trigger("click");
        await settle();
        modal.close();
        resolveNext!();
        await settle();
        expect(Notice.instances.map((n) => n.message)).not.toContain(MESSAGES.ERROR_ANALYZE_ACTION("boom"));
        expect(onDone).toHaveBeenCalledTimes(1);
    });

    it("shows the unsupported notice when the follow-up call 404s", async () => {
        const { modal, plugin } = await openToReport();
        plugin.api.analyzeStream.mockImplementation(() => {
            throw new Error("Server responded 404: {}");
        });
        button(el(modal), MESSAGES.BUTTON_PROFILE_APPLY)!.trigger("click");
        await settle();
        expect(Notice.instances.map((n) => n.message)).toContain(MESSAGES.NOTICE_ANALYZE_UNSUPPORTED);
    });
});

describe("AnalyzeModal save only", () => {
    it("opens the name dialog and saves without applying", async () => {
        const { modal, plugin } = await openToReport();
        button(el(modal), MESSAGES.BUTTON_ANALYZE_SAVE_ONLY)!.trigger("click");
        expect(nameModalOptions).toMatchObject({ title: MESSAGES.TITLE_ANALYZE_SAVING, askTarget: true });

        plugin.api.analyzeStream.mockImplementation(async function* () {
            yield { event: "analyze", data: { done: 1, total: 1, file: "a.md" } };
            yield {
                event: "done",
                data: {
                    ...FULL_REPORT,
                    saved: { name: "Mine", folder: "project", path: "/p/mine.toml", applied: false },
                },
            };
        });
        const refusal = await nameModalOptions!.submit("Mine", PROFILE_FOLDER.PROJECT);

        expect(refusal).toBeNull();
        expect(plugin.api.analyzeStream).toHaveBeenLastCalledWith(
            null,
            { save: "Mine", target: PROFILE_FOLDER.PROJECT },
            expect.anything(),
        );
        expect(Notice.instances.map((n) => n.message)).toContain(MESSAGES.NOTICE_ANALYZE_SAVED("Mine", "/p/mine.toml"));
    });

    it("keeps the server's refusal in the dialog", async () => {
        const { modal, plugin } = await openToReport();
        button(el(modal), MESSAGES.BUTTON_ANALYZE_SAVE_ONLY)!.trigger("click");
        plugin.api.analyzeStream.mockImplementation(async function* () {
            yield { event: "error", data: "Bad name" };
        });
        const refusal = await nameModalOptions!.submit("bad", PROFILE_FOLDER.PROJECT);
        expect(refusal).toBe("Bad name");
    });

    it("reports a server that predates analyze from the name dialog", async () => {
        const { modal, plugin } = await openToReport();
        button(el(modal), MESSAGES.BUTTON_ANALYZE_SAVE_ONLY)!.trigger("click");
        plugin.api.analyzeStream.mockImplementation(() => {
            throw new Error("Server responded 404: {}");
        });
        const refusal = await nameModalOptions!.submit("Mine", PROFILE_FOLDER.PROJECT);
        expect(refusal).toBe(MESSAGES.NOTICE_ANALYZE_UNSUPPORTED);
    });

    it("reports the unknown-outcome fallback when a save answers a report with no saved profile", async () => {
        const { modal, plugin } = await openToReport();
        button(el(modal), MESSAGES.BUTTON_ANALYZE_SAVE_ONLY)!.trigger("click");
        plugin.api.analyzeStream.mockImplementation(async function* () {
            yield { event: "done", data: { ...FULL_REPORT, saved: null } };
        });
        const refusal = await nameModalOptions!.submit("Mine", PROFILE_FOLDER.PROJECT);
        expect(refusal).toBe(MESSAGES.ERROR_UNKNOWN);
    });
});
