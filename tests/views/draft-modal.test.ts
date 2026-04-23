import { vi, describe, it, expect, beforeEach } from "vitest";
import { App, Notice } from "obsidian";
import { MockElement } from "../__mocks__/obsidian";
import { DraftModal } from "../../src/views/draft-modal";
import type { DraftInfoResponse, DraftPendingKind } from "../../src/types";

let mockConfirmResult = true;
vi.mock("../../src/views/confirm-modal", () => ({
    ConfirmModal: vi.fn().mockImplementation(() => ({
        open: vi.fn(),
        get result() {
            return Promise.resolve(mockConfirmResult);
        },
        close: vi.fn(),
    })),
}));

const tick = () => new Promise((r) => setTimeout(r, 0));

function collectTexts(el: MockElement): string[] {
    const texts: string[] = [];
    if (el.textContent) texts.push(el.textContent);
    for (const child of el.children) {
        texts.push(...collectTexts(child));
    }
    return texts;
}

function findButtons(el: MockElement): MockElement[] {
    const buttons: MockElement[] = [];
    if (el.tagName === "BUTTON") buttons.push(el);
    for (const child of el.children) {
        buttons.push(...findButtons(child));
    }
    return buttons;
}

function makeDraft(overrides: Partial<DraftInfoResponse> = {}): DraftInfoResponse {
    return {
        slug: "summaries/caprice-1951",
        path: "/data/wiki/drafts/summaries/caprice-1951.md",
        drift_ratio: 0.34,
        faithfulness_score: 0.42,
        bad_title: false,
        published_path: "/data/wiki/summaries/caprice-1951.md",
        published_exists: true,
        pending_kind: "drift",
        mtime: 1745452800,
        ...overrides,
    };
}

function makePlugin() {
    return {
        wikiDraftCount: 3,
        wikiPageCount: 5,
        refreshOpenWikiViews: vi.fn(),
        reconcileWiki: vi.fn().mockResolvedValue(undefined),
        api: {
            wikiDrafts: vi.fn(),
            wikiDraftDiff: vi.fn(),
            wikiDraftAccept: vi.fn(),
            wikiDraftReject: vi.fn(),
        },
    };
}

describe("DraftModal", () => {
    let app: App;
    let plugin: ReturnType<typeof makePlugin>;

    beforeEach(() => {
        Notice.clear();
        mockConfirmResult = true;
        app = new App();
        plugin = makePlugin();
    });

    it("renders chrome with title, refresh button, and disabled action buttons", () => {
        plugin.api.wikiDrafts.mockResolvedValue([]);
        const modal = new DraftModal(app as any, plugin as any);
        modal.onOpen();
        const el = modal.contentEl as unknown as MockElement;
        expect(collectTexts(el).some((t) => t.startsWith("Wiki drafts"))).toBe(true);
        const buttons = findButtons(el);
        const accept = buttons.find((b) => b.textContent === "Accept")!;
        const reject = buttons.find((b) => b.textContent === "Reject")!;
        expect((accept as any).disabled).toBe(true);
        expect((reject as any).disabled).toBe(true);
        expect(buttons.find((b) => b.textContent === "Refresh")).toBeDefined();
    });

    it("shows empty-state when API returns no drafts", async () => {
        plugin.api.wikiDrafts.mockResolvedValue([]);
        const modal = new DraftModal(app as any, plugin as any);
        modal.onOpen();
        await tick();
        const el = modal.contentEl as unknown as MockElement;
        expect(collectTexts(el).some((t) => t.includes("No pending wiki drafts"))).toBe(true);
        expect(el.find("lilbee-empty-state")).not.toBeNull();
    });

    it("shows error state when wikiDrafts() throws", async () => {
        plugin.api.wikiDrafts.mockRejectedValue(new Error("network"));
        const modal = new DraftModal(app as any, plugin as any);
        modal.onOpen();
        await tick();
        const el = modal.contentEl as unknown as MockElement;
        expect(collectTexts(el).some((t) => t.includes("Failed to load drafts"))).toBe(true);
        expect(el.find("lilbee-loading")).toBeNull();
    });

    it("renders one row per draft with kind / drift / faith / pub chips", async () => {
        plugin.api.wikiDrafts.mockResolvedValue([
            makeDraft({ slug: "drift-row" }),
            makeDraft({
                slug: "new-row",
                drift_ratio: null,
                faithfulness_score: null,
                published_exists: false,
                pending_kind: "parse",
            }),
        ]);
        const modal = new DraftModal(app as any, plugin as any);
        modal.onOpen();
        await tick();
        const el = modal.contentEl as unknown as MockElement;
        expect(el.findAll("lilbee-draft-row")).toHaveLength(2);
        const texts = collectTexts(el);
        expect(texts.some((t) => t === "DRIFT")).toBe(true);
        expect(texts.some((t) => t === "PARSE")).toBe(true);
        expect(texts.some((t) => t === "34% drift")).toBe(true);
        expect(texts.some((t) => t === "faith 0.42")).toBe(true);
        expect(texts.some((t) => t === "faith —")).toBe(true);
        expect(texts.some((t) => t === "pub")).toBe(true);
        expect(texts.some((t) => t === "new")).toBe(true);
    });

    it.each<[DraftPendingKind, string]>([
        ["drift", "DRIFT"],
        ["parse", "PARSE"],
        ["collision", "COLLISION"],
        ["low_faithfulness", "LOW FAITH"],
        ["bad_title", "BAD TITLE"],
    ])("maps pending_kind=%s to chip label %s", async (kind, label) => {
        plugin.api.wikiDrafts.mockResolvedValue([makeDraft({ pending_kind: kind })]);
        const modal = new DraftModal(app as any, plugin as any);
        modal.onOpen();
        await tick();
        const texts = collectTexts(modal.contentEl as unknown as MockElement);
        expect(texts.some((t) => t === label)).toBe(true);
    });

    it("falls back to BAD TITLE chip when pending_kind is null but bad_title is true", async () => {
        plugin.api.wikiDrafts.mockResolvedValue([makeDraft({ pending_kind: null, bad_title: true })]);
        const modal = new DraftModal(app as any, plugin as any);
        modal.onOpen();
        await tick();
        const texts = collectTexts(modal.contentEl as unknown as MockElement);
        expect(texts.some((t) => t === "BAD TITLE")).toBe(true);
    });

    it("omits the kind chip when pending_kind is null and bad_title is false", async () => {
        plugin.api.wikiDrafts.mockResolvedValue([makeDraft({ pending_kind: null, bad_title: false })]);
        const modal = new DraftModal(app as any, plugin as any);
        modal.onOpen();
        await tick();
        const el = modal.contentEl as unknown as MockElement;
        expect(el.find("lilbee-draft-kind")).toBeNull();
    });

    it("clicking a row fetches the diff, renders +/- spans, and arms the action buttons", async () => {
        plugin.api.wikiDrafts.mockResolvedValue([makeDraft()]);
        plugin.api.wikiDraftDiff.mockResolvedValue("--- a\n+++ b\n@@ -1 +1 @@\n-old\n+new\n ctx\n");
        const modal = new DraftModal(app as any, plugin as any);
        modal.onOpen();
        await tick();
        const el = modal.contentEl as unknown as MockElement;
        const row = el.find("lilbee-draft-row")!;
        row.trigger("click");
        await tick();
        await tick();
        expect(plugin.api.wikiDraftDiff).toHaveBeenCalledWith("summaries/caprice-1951");
        expect(el.find("lilbee-draft-diff-add")).not.toBeNull();
        expect(el.find("lilbee-draft-diff-del")).not.toBeNull();
        expect(el.find("lilbee-draft-diff-meta")).not.toBeNull();
        expect(el.find("lilbee-draft-diff-hunk")).not.toBeNull();
        expect(el.find("lilbee-draft-diff-ctx")).not.toBeNull();
        expect(row.classList.contains("is-selected")).toBe(true);
        const accept = findButtons(el).find((b) => b.textContent === "Accept")!;
        expect((accept as any).disabled).toBe(false);
    });

    it("renders the no-diff placeholder when the diff body is empty", async () => {
        plugin.api.wikiDrafts.mockResolvedValue([makeDraft({ published_exists: false })]);
        plugin.api.wikiDraftDiff.mockResolvedValue("   \n");
        const modal = new DraftModal(app as any, plugin as any);
        modal.onOpen();
        await tick();
        (modal.contentEl as unknown as MockElement).find("lilbee-draft-row")!.trigger("click");
        await tick();
        await tick();
        expect(
            collectTexts(modal.contentEl as unknown as MockElement).some((t) =>
                t.includes("No diff (draft has no published counterpart)"),
            ),
        ).toBe(true);
    });

    it("surfaces ERROR_LOAD_DIFF when wikiDraftDiff throws", async () => {
        plugin.api.wikiDrafts.mockResolvedValue([makeDraft()]);
        plugin.api.wikiDraftDiff.mockRejectedValue(new Error("boom"));
        const modal = new DraftModal(app as any, plugin as any);
        modal.onOpen();
        await tick();
        (modal.contentEl as unknown as MockElement).find("lilbee-draft-row")!.trigger("click");
        await tick();
        await tick();
        const texts = collectTexts(modal.contentEl as unknown as MockElement);
        expect(texts.some((t) => t.includes("Failed to load diff"))).toBe(true);
    });

    it("accept flow removes the row, posts a notice, decrements counts, and refreshes wiki views", async () => {
        plugin.api.wikiDrafts.mockResolvedValue([makeDraft({ published_exists: false })]);
        plugin.api.wikiDraftDiff.mockResolvedValue("--- a\n+++ b\n+new\n");
        plugin.api.wikiDraftAccept.mockResolvedValue({
            slug: "summaries/caprice-1951",
            moved_to: "/data/wiki/summaries/caprice-1951.md",
            reindexed_chunks: 7,
        });
        const modal = new DraftModal(app as any, plugin as any);
        modal.onOpen();
        await tick();
        const el = modal.contentEl as unknown as MockElement;
        el.find("lilbee-draft-row")!.trigger("click");
        await tick();
        await tick();
        const accept = findButtons(el).find((b) => b.textContent === "Accept")!;
        accept.trigger("click");
        await tick();
        await tick();
        await tick();
        expect(plugin.api.wikiDraftAccept).toHaveBeenCalledWith("summaries/caprice-1951");
        expect(el.find("lilbee-draft-row")).toBeNull();
        expect(plugin.wikiDraftCount).toBe(2);
        expect(plugin.wikiPageCount).toBe(6);
        expect(plugin.refreshOpenWikiViews).toHaveBeenCalled();
        expect(plugin.reconcileWiki).toHaveBeenCalled();
        expect(Notice.instances.map((n) => n.message)).toContain("Accepted summaries/caprice-1951 (7 chunks indexed).");
    });

    it("accept flow keeps wikiPageCount unchanged when the draft already had a published counterpart", async () => {
        plugin.api.wikiDrafts.mockResolvedValue([makeDraft({ published_exists: true })]);
        plugin.api.wikiDraftDiff.mockResolvedValue("--- a\n+++ b\n-old\n+new\n");
        plugin.api.wikiDraftAccept.mockResolvedValue({
            slug: "summaries/caprice-1951",
            moved_to: "/data/wiki/summaries/caprice-1951.md",
            reindexed_chunks: 4,
        });
        const modal = new DraftModal(app as any, plugin as any);
        modal.onOpen();
        await tick();
        const el = modal.contentEl as unknown as MockElement;
        el.find("lilbee-draft-row")!.trigger("click");
        await tick();
        await tick();
        findButtons(el)
            .find((b) => b.textContent === "Accept")!
            .trigger("click");
        await tick();
        await tick();
        await tick();
        expect(plugin.wikiPageCount).toBe(5);
    });

    it("reject flow removes the row, posts a notice, and does NOT refresh the wiki view", async () => {
        plugin.api.wikiDrafts.mockResolvedValue([makeDraft()]);
        plugin.api.wikiDraftDiff.mockResolvedValue("--- a\n+++ b\n");
        plugin.api.wikiDraftReject.mockResolvedValue({ slug: "summaries/caprice-1951" });
        const modal = new DraftModal(app as any, plugin as any);
        modal.onOpen();
        await tick();
        const el = modal.contentEl as unknown as MockElement;
        el.find("lilbee-draft-row")!.trigger("click");
        await tick();
        await tick();
        findButtons(el)
            .find((b) => b.textContent === "Reject")!
            .trigger("click");
        await tick();
        await tick();
        await tick();
        expect(plugin.api.wikiDraftReject).toHaveBeenCalledWith("summaries/caprice-1951");
        expect(el.find("lilbee-draft-row")).toBeNull();
        expect(plugin.refreshOpenWikiViews).not.toHaveBeenCalled();
        expect(plugin.reconcileWiki).not.toHaveBeenCalled();
        expect(Notice.instances.map((n) => n.message)).toContain("Rejected summaries/caprice-1951.");
    });

    it("accept failure surfaces a generic notice and leaves the row intact", async () => {
        plugin.api.wikiDrafts.mockResolvedValue([makeDraft()]);
        plugin.api.wikiDraftDiff.mockResolvedValue("--- a\n+++ b\n");
        plugin.api.wikiDraftAccept.mockRejectedValue(new Error("server down"));
        const modal = new DraftModal(app as any, plugin as any);
        modal.onOpen();
        await tick();
        const el = modal.contentEl as unknown as MockElement;
        el.find("lilbee-draft-row")!.trigger("click");
        await tick();
        await tick();
        findButtons(el)
            .find((b) => b.textContent === "Accept")!
            .trigger("click");
        await tick();
        await tick();
        await tick();
        expect(el.find("lilbee-draft-row")).not.toBeNull();
        expect(plugin.wikiDraftCount).toBe(3);
        expect(Notice.instances.map((n) => n.message)).toContain("Draft action failed. Check the server log.");
    });

    it("reject failure surfaces a generic notice and leaves the row intact", async () => {
        plugin.api.wikiDrafts.mockResolvedValue([makeDraft()]);
        plugin.api.wikiDraftDiff.mockResolvedValue("--- a\n+++ b\n");
        plugin.api.wikiDraftReject.mockRejectedValue(new Error("server down"));
        const modal = new DraftModal(app as any, plugin as any);
        modal.onOpen();
        await tick();
        const el = modal.contentEl as unknown as MockElement;
        el.find("lilbee-draft-row")!.trigger("click");
        await tick();
        await tick();
        findButtons(el)
            .find((b) => b.textContent === "Reject")!
            .trigger("click");
        await tick();
        await tick();
        await tick();
        expect(el.find("lilbee-draft-row")).not.toBeNull();
        expect(Notice.instances.map((n) => n.message)).toContain("Draft action failed. Check the server log.");
    });

    it("does nothing when the user cancels the accept confirmation", async () => {
        mockConfirmResult = false;
        plugin.api.wikiDrafts.mockResolvedValue([makeDraft()]);
        plugin.api.wikiDraftDiff.mockResolvedValue("--- a\n+++ b\n");
        const modal = new DraftModal(app as any, plugin as any);
        modal.onOpen();
        await tick();
        const el = modal.contentEl as unknown as MockElement;
        el.find("lilbee-draft-row")!.trigger("click");
        await tick();
        await tick();
        findButtons(el)
            .find((b) => b.textContent === "Accept")!
            .trigger("click");
        await tick();
        await tick();
        expect(plugin.api.wikiDraftAccept).not.toHaveBeenCalled();
        expect(el.find("lilbee-draft-row")).not.toBeNull();
    });

    it("does nothing when the user cancels the reject confirmation", async () => {
        mockConfirmResult = false;
        plugin.api.wikiDrafts.mockResolvedValue([makeDraft()]);
        plugin.api.wikiDraftDiff.mockResolvedValue("--- a\n+++ b\n");
        const modal = new DraftModal(app as any, plugin as any);
        modal.onOpen();
        await tick();
        const el = modal.contentEl as unknown as MockElement;
        el.find("lilbee-draft-row")!.trigger("click");
        await tick();
        await tick();
        findButtons(el)
            .find((b) => b.textContent === "Reject")!
            .trigger("click");
        await tick();
        await tick();
        expect(plugin.api.wikiDraftReject).not.toHaveBeenCalled();
    });

    it("refresh button re-fetches the draft list", async () => {
        plugin.api.wikiDrafts.mockResolvedValue([makeDraft()]);
        const modal = new DraftModal(app as any, plugin as any);
        modal.onOpen();
        await tick();
        const el = modal.contentEl as unknown as MockElement;
        const refreshBtn = findButtons(el).find((b) => b.textContent === "Refresh")!;
        plugin.api.wikiDrafts.mockClear();
        refreshBtn.trigger("click");
        await tick();
        expect(plugin.api.wikiDrafts).toHaveBeenCalled();
    });

    it("ignores accept and reject clicks while no draft is selected", async () => {
        plugin.api.wikiDrafts.mockResolvedValue([makeDraft()]);
        const modal = new DraftModal(app as any, plugin as any);
        modal.onOpen();
        await tick();
        // Force-call without selecting; via the buttons (which start disabled) is a no-op.
        await (modal as any).accept();
        await (modal as any).reject();
        expect(plugin.api.wikiDraftAccept).not.toHaveBeenCalled();
        expect(plugin.api.wikiDraftReject).not.toHaveBeenCalled();
    });

    it("does not start a second action while one is in flight", async () => {
        plugin.api.wikiDrafts.mockResolvedValue([makeDraft()]);
        plugin.api.wikiDraftDiff.mockResolvedValue("--- a\n+++ b\n");
        let resolveAccept!: (v: { slug: string; moved_to: string; reindexed_chunks: number }) => void;
        plugin.api.wikiDraftAccept.mockImplementation(
            () =>
                new Promise((resolve) => {
                    resolveAccept = resolve;
                }),
        );
        const modal = new DraftModal(app as any, plugin as any);
        modal.onOpen();
        await tick();
        const el = modal.contentEl as unknown as MockElement;
        el.find("lilbee-draft-row")!.trigger("click");
        await tick();
        await tick();
        // Fire two accept invocations without awaiting; the second must short-circuit.
        const first = (modal as any).accept();
        const second = (modal as any).accept();
        await tick();
        await tick();
        resolveAccept({
            slug: "summaries/caprice-1951",
            moved_to: "/data/wiki/summaries/caprice-1951.md",
            reindexed_chunks: 1,
        });
        await first;
        await second;
        expect(plugin.api.wikiDraftAccept).toHaveBeenCalledTimes(1);
    });

    it("ignores row clicks while an action is in flight", async () => {
        plugin.api.wikiDrafts.mockResolvedValue([makeDraft({ slug: "row-a" }), makeDraft({ slug: "row-b" })]);
        plugin.api.wikiDraftDiff.mockResolvedValue("--- a\n+++ b\n");
        let resolveAccept!: (v: { slug: string; moved_to: string; reindexed_chunks: number }) => void;
        plugin.api.wikiDraftAccept.mockImplementation(
            () =>
                new Promise((resolve) => {
                    resolveAccept = resolve;
                }),
        );
        const modal = new DraftModal(app as any, plugin as any);
        modal.onOpen();
        await tick();
        const el = modal.contentEl as unknown as MockElement;
        const rows = el.findAll("lilbee-draft-row");
        rows[0].trigger("click");
        await tick();
        await tick();
        const accept = findButtons(el).find((b) => b.textContent === "Accept")!;
        accept.trigger("click");
        await tick();
        plugin.api.wikiDraftDiff.mockClear();
        rows[1].trigger("click");
        await tick();
        expect(plugin.api.wikiDraftDiff).not.toHaveBeenCalled();
        resolveAccept({ slug: "row-a", moved_to: "x", reindexed_chunks: 0 });
        await tick();
    });

    it("does not over-decrement wikiDraftCount when it is already zero", async () => {
        plugin.wikiDraftCount = 0;
        plugin.api.wikiDrafts.mockResolvedValue([makeDraft()]);
        plugin.api.wikiDraftDiff.mockResolvedValue("--- a\n+++ b\n");
        plugin.api.wikiDraftReject.mockResolvedValue({ slug: "summaries/caprice-1951" });
        const modal = new DraftModal(app as any, plugin as any);
        modal.onOpen();
        await tick();
        const el = modal.contentEl as unknown as MockElement;
        el.find("lilbee-draft-row")!.trigger("click");
        await tick();
        await tick();
        findButtons(el)
            .find((b) => b.textContent === "Reject")!
            .trigger("click");
        await tick();
        await tick();
        await tick();
        expect(plugin.wikiDraftCount).toBe(0);
    });

    it("clears the contentEl on close", async () => {
        plugin.api.wikiDrafts.mockResolvedValue([]);
        const modal = new DraftModal(app as any, plugin as any);
        modal.onOpen();
        await tick();
        modal.onClose();
        expect((modal.contentEl as unknown as MockElement).children.length).toBe(0);
    });
});
