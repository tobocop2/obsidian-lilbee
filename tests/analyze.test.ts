import { vi, describe, it, expect, beforeEach } from "vitest";
import { App, Notice } from "obsidian";
import { analyzeSupported, dismissAnalyzeTip, maybeShowAnalyzeTip, runAnalyze } from "../src/analyze";
import { MESSAGES } from "../src/locales/en";

const openMock = vi.fn();

vi.mock("../src/views/analyze-modal", () => ({
    AnalyzeModal: vi.fn().mockImplementation(function AnalyzeModal(this: { open: typeof openMock }) {
        this.open = openMock;
    }),
}));

import { AnalyzeModal } from "../src/views/analyze-modal";

const AnalyzeModalMock = AnalyzeModal as unknown as ReturnType<typeof vi.fn>;

function makePlugin() {
    return {
        app: new App(),
        api: {
            analyzeState: vi.fn(),
            dismissAnalyzeTip: vi.fn(),
        },
    };
}

beforeEach(() => {
    openMock.mockClear();
    AnalyzeModalMock.mockClear();
    Notice.clear();
});

describe("runAnalyze()", () => {
    it("opens an AnalyzeModal built from the plugin, directory and onDone callback", () => {
        const plugin = makePlugin();
        const onDone = vi.fn();

        runAnalyze(plugin as any, "/vault/notes", onDone);

        expect(AnalyzeModalMock).toHaveBeenCalledWith(plugin.app, plugin, "/vault/notes", onDone);
        expect(openMock).toHaveBeenCalledTimes(1);
    });

    it("defaults to no directory and no callback", () => {
        const plugin = makePlugin();

        runAnalyze(plugin as any);

        expect(AnalyzeModalMock).toHaveBeenCalledWith(plugin.app, plugin, null, undefined);
    });
});

describe("analyzeSupported()", () => {
    it("is true when the server answers the state route", async () => {
        const plugin = makePlugin();
        plugin.api.analyzeState.mockResolvedValue({ analyzed: false, tip_dismissed: false, tip_shows: false });

        await expect(analyzeSupported(plugin as any)).resolves.toBe(true);
    });

    it("is false when the state route answers null", async () => {
        const plugin = makePlugin();
        plugin.api.analyzeState.mockResolvedValue(null);

        await expect(analyzeSupported(plugin as any)).resolves.toBe(false);
    });

    it("is false when the state call throws", async () => {
        const plugin = makePlugin();
        plugin.api.analyzeState.mockRejectedValue(new Error("network down"));

        await expect(analyzeSupported(plugin as any)).resolves.toBe(false);
    });
});

describe("maybeShowAnalyzeTip()", () => {
    it("shows the tip when the server says it should", async () => {
        const plugin = makePlugin();
        plugin.api.analyzeState.mockResolvedValue({ analyzed: false, tip_dismissed: false, tip_shows: true });

        await maybeShowAnalyzeTip(plugin as any);

        expect(Notice.instances.map((n) => n.message)).toContain(MESSAGES.NOTICE_ANALYZE_TIP);
    });

    it("shows nothing when the server says the tip should not show", async () => {
        const plugin = makePlugin();
        plugin.api.analyzeState.mockResolvedValue({ analyzed: true, tip_dismissed: false, tip_shows: false });

        await maybeShowAnalyzeTip(plugin as any);

        expect(Notice.instances).toHaveLength(0);
    });

    it("shows nothing against a server that predates analyze", async () => {
        const plugin = makePlugin();
        plugin.api.analyzeState.mockResolvedValue(null);

        await maybeShowAnalyzeTip(plugin as any);

        expect(Notice.instances).toHaveLength(0);
    });

    it("swallows a network error rather than blocking the add or sync it precedes", async () => {
        const plugin = makePlugin();
        plugin.api.analyzeState.mockRejectedValue(new Error("network down"));

        await expect(maybeShowAnalyzeTip(plugin as any)).resolves.toBeUndefined();
        expect(Notice.instances).toHaveLength(0);
    });
});

describe("dismissAnalyzeTip()", () => {
    it("hides the tip and raises a confirming notice", async () => {
        const plugin = makePlugin();
        plugin.api.dismissAnalyzeTip.mockResolvedValue({ analyzed: false, tip_dismissed: true, tip_shows: false });

        await dismissAnalyzeTip(plugin as any);

        expect(Notice.instances.map((n) => n.message)).toContain(MESSAGES.NOTICE_ANALYZE_TIP_DISMISSED);
    });

    it("says the server predates analyze when the dismiss route answers null", async () => {
        const plugin = makePlugin();
        plugin.api.dismissAnalyzeTip.mockResolvedValue(null);

        await dismissAnalyzeTip(plugin as any);

        expect(Notice.instances.map((n) => n.message)).toContain(MESSAGES.NOTICE_ANALYZE_UNSUPPORTED);
    });

    it("reports a failed write", async () => {
        const plugin = makePlugin();
        plugin.api.dismissAnalyzeTip.mockRejectedValue(new Error("disk full"));

        await dismissAnalyzeTip(plugin as any);

        expect(Notice.instances.map((n) => n.message)).toContain(MESSAGES.ERROR_ANALYZE_ACTION("disk full"));
    });

    it("reports a failed write thrown as a non-Error value", async () => {
        const plugin = makePlugin();
        plugin.api.dismissAnalyzeTip.mockRejectedValue("disk full");

        await dismissAnalyzeTip(plugin as any);

        expect(Notice.instances.map((n) => n.message)).toContain(MESSAGES.ERROR_ANALYZE_ACTION("disk full"));
    });
});
