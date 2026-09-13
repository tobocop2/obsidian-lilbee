import { describe, it, expect, vi, beforeEach } from "vitest";
import { App, Notice, TFile } from "obsidian";
import { ok, err } from "../../src/result";
import { StatusModal } from "../../src/views/status-modal";
import { MESSAGES } from "../../src/locales/en";
import { MockElement } from "../__mocks__/obsidian";
import type LilbeePlugin from "../../src/main";
import type { DocumentEntry, DocumentsResponse, StatusResponse } from "../../src/types";

function makeDoc(overrides: Partial<DocumentEntry> = {}): DocumentEntry {
    return {
        filename: "test.md",
        chunk_count: 5,
        ingested_at: "2024-01-01T00:00:00Z",
        ...overrides,
    };
}

function makeDocsResponse(docs: DocumentEntry[] = [], total?: number, hasMore = false): DocumentsResponse {
    return {
        documents: docs,
        total: total ?? docs.length,
        limit: 20,
        offset: 0,
        has_more: hasMore,
    };
}

function makePlugin(overrides: Partial<{ activeModel: string }> = {}): LilbeePlugin {
    return {
        healthWarnings: [],
        activeModel: overrides.activeModel ?? "mistral:7b",
        api: {
            status: vi.fn(),
            showModel: vi.fn(),
            health: vi.fn().mockResolvedValue(ok({ status: "ok", version: "1" })),
            listDocuments: vi.fn().mockResolvedValue(makeDocsResponse()),
            wikiStatus: vi.fn().mockResolvedValue(err(new Error("wiki off"))),
        },
    } as unknown as LilbeePlugin;
}

function asMock(fn: unknown): ReturnType<typeof vi.fn> {
    return fn as ReturnType<typeof vi.fn>;
}

function makeStatus(overrides: Partial<StatusResponse> = {}): StatusResponse {
    return {
        config: { chat_model: "mistral:7b", embedding_model: "nomic-embed-text" },
        document_count: 2,
        sources: [
            { filename: "a.md", chunk_count: 3 },
            { filename: "b.md", chunk_count: 2 },
        ],
        total_chunks: 5,
        ...overrides,
    };
}

describe("StatusModal", () => {
    beforeEach(() => {
        Notice.clear();
    });

    it("renders document section with counts", async () => {
        const plugin = makePlugin();
        (plugin.api.status as ReturnType<typeof vi.fn>).mockResolvedValue(ok(makeStatus()));
        (plugin.api.showModel as ReturnType<typeof vi.fn>).mockResolvedValue({});

        const modal = new StatusModal(new App(), plugin);
        modal.open();
        const content = (modal as any).contentEl as MockElement;
        await vi.waitFor(() => {
            expect(content.findAll("lilbee-status-table").length).toBeGreaterThanOrEqual(2);
        });

        const tables = content.findAll("lilbee-status-table");

        // Documents section
        const docTable = tables[0];
        const rows = docTable.findAll("lilbee-status-label");
        expect(rows.length).toBe(2);
    });

    it("shows document_count in the Documents row even when sources is empty", async () => {
        const plugin = makePlugin();
        (plugin.api.status as ReturnType<typeof vi.fn>).mockResolvedValue(
            ok(makeStatus({ document_count: 7, sources: [] })),
        );
        (plugin.api.showModel as ReturnType<typeof vi.fn>).mockResolvedValue({});

        const modal = new StatusModal(new App(), plugin);
        modal.open();
        await vi.waitFor(() => {
            const content = (modal as any).contentEl as MockElement;
            expect(content.findAll("lilbee-status-table").length).toBeGreaterThanOrEqual(2);
        });

        const content = (modal as any).contentEl as MockElement;
        const docTable = content.findAll("lilbee-status-table")[0];
        const values = docTable.findAll("lilbee-status-value").map((v: MockElement) => v.textContent);
        expect(values[0]).toBe("7");
    });

    it("renders model architecture details when available", async () => {
        const plugin = makePlugin();
        (plugin.api.status as ReturnType<typeof vi.fn>).mockResolvedValue(ok(makeStatus()));
        (plugin.api.showModel as ReturnType<typeof vi.fn>).mockResolvedValue({
            architecture: "llama",
            context_length: "4096",
            file_type: "Q4_K_M",
        });

        const modal = new StatusModal(new App(), plugin);
        modal.open();
        await vi.waitFor(() => {
            const content = (modal as any).contentEl as MockElement;
            const tables = content.findAll("lilbee-status-table");
            expect(tables.length).toBeGreaterThanOrEqual(2);
        });

        const content = (modal as any).contentEl as MockElement;
        const values = content.findAll("lilbee-status-value");
        const texts = values.map((v: MockElement) => v.textContent);
        expect(texts).toContain("llama");
        expect(texts).toContain("4096");
        // file_type is not surfaced — server returns a raw GGUF code that is
        // meaningless to users (e.g. "1" for F16). Drop it until the server
        // ships humanized quant labels.
        expect(texts).not.toContain("Q4_K_M");
    });

    it("renders chat model as basename with full path in tooltip", async () => {
        const plugin = makePlugin();
        (plugin.api.status as ReturnType<typeof vi.fn>).mockResolvedValue(
            ok(
                makeStatus({
                    config: {
                        chat_model: "Smoffyy/Gemma4-E4B-Instruct-Pure-GGUF/Gemma4-E4B-F16.gguf",
                        embedding_model: "nomic-embed-text",
                    },
                }),
            ),
        );
        (plugin.api.showModel as ReturnType<typeof vi.fn>).mockResolvedValue({});

        const modal = new StatusModal(new App(), plugin);
        modal.open();
        await vi.waitFor(() => {
            const content = (modal as any).contentEl as MockElement;
            expect(content.findAll("lilbee-status-table").length).toBeGreaterThanOrEqual(2);
        });

        const content = (modal as any).contentEl as MockElement;
        const values = content.findAll("lilbee-status-value");
        const texts = values.map((v: MockElement) => v.textContent);
        expect(texts).toContain("Gemma4-E4B-F16.gguf");
        const cell = values.find((v: MockElement) => v.textContent === "Gemma4-E4B-F16.gguf");
        expect(cell?.attributes["title"]).toBe("Smoffyy/Gemma4-E4B-Instruct-Pure-GGUF/Gemma4-E4B-F16.gguf");
    });

    it("renders a plugin-native remedy with an action button for a known code", async () => {
        const plugin = makePlugin();
        (plugin as any).healthWarnings = [
            { code: "fts_unavailable", message: "Keyword search is unavailable.", remedy: "Run rebuild." },
        ];
        (plugin.api.status as ReturnType<typeof vi.fn>).mockResolvedValue(ok(makeStatus()));
        (plugin.api.showModel as ReturnType<typeof vi.fn>).mockResolvedValue({});

        const modal = new StatusModal(new App(), plugin);
        modal.open();
        const content = (modal as any).contentEl as MockElement;
        await vi.waitFor(() => {
            expect(content.textContent ?? "").toContain("Keyword search is unavailable.");
        });
        expect(content.textContent ?? "").toContain("Rebuild the index");
        expect(content.textContent ?? "").toContain("Rebuild index");
        expect(content.textContent ?? "").not.toContain("Run rebuild.");
        expect(content.find("lilbee-status-warning-action")).not.toBeNull();
    });

    it("falls back to the server remedy for an unknown code", async () => {
        const plugin = makePlugin();
        (plugin as any).healthWarnings = [
            { code: "some_future_warning", message: "Something is degraded.", remedy: "Server says do X." },
        ];
        (plugin.api.status as ReturnType<typeof vi.fn>).mockResolvedValue(ok(makeStatus()));
        (plugin.api.showModel as ReturnType<typeof vi.fn>).mockResolvedValue({});

        const modal = new StatusModal(new App(), plugin);
        modal.open();
        const content = (modal as any).contentEl as MockElement;
        await vi.waitFor(() => {
            expect(content.textContent ?? "").toContain("Something is degraded.");
        });
        expect(content.textContent ?? "").toContain("Server says do X.");
        expect(content.find("lilbee-status-warning-action")).toBeNull();
    });

    it("omits the remedy line when the server sends none", async () => {
        const plugin = makePlugin();
        (plugin as any).healthWarnings = [{ code: "x", message: "Something is degraded.", remedy: null }];
        (plugin.api.status as ReturnType<typeof vi.fn>).mockResolvedValue(ok(makeStatus()));
        (plugin.api.showModel as ReturnType<typeof vi.fn>).mockResolvedValue({});

        const modal = new StatusModal(new App(), plugin);
        modal.open();
        await vi.waitFor(() => {
            const content = (modal as any).contentEl as MockElement;
            expect(content.textContent ?? "").toContain("Something is degraded.");
        });
        expect(((modal as any).contentEl as MockElement).find("lilbee-status-warning-remedy")).toBeNull();
    });

    it("omits the degraded section when the server reports nothing", async () => {
        const plugin = makePlugin();
        (plugin.api.status as ReturnType<typeof vi.fn>).mockResolvedValue(ok(makeStatus()));
        (plugin.api.showModel as ReturnType<typeof vi.fn>).mockResolvedValue({});

        const modal = new StatusModal(new App(), plugin);
        modal.open();
        await vi.waitFor(() => {
            const content = (modal as any).contentEl as MockElement;
            expect(content.findAll("lilbee-status-table").length).toBeGreaterThan(0);
        });
        expect(((modal as any).contentEl as MockElement).find("lilbee-status-warning")).toBeNull();
    });

    it("renders the wiki counters from /api/wiki/status", async () => {
        const plugin = makePlugin();
        (plugin.api.status as ReturnType<typeof vi.fn>).mockResolvedValue(ok(makeStatus()));
        (plugin.api.showModel as ReturnType<typeof vi.fn>).mockResolvedValue({});
        asMock(plugin.api.wikiStatus).mockResolvedValue(
            ok({
                wiki_enabled: true,
                summaries: 4,
                drafts: 2,
                pages: 10,
                lint_errors: 1,
                lint_warnings: 3,
            }),
        );

        const modal = new StatusModal(new App(), plugin);
        modal.open();
        await vi.waitFor(() => {
            const content = (modal as any).contentEl as MockElement;
            const tables = content.findAll("lilbee-status-table");
            expect(tables.length).toBe(3);
        });

        const content = (modal as any).contentEl as MockElement;
        const texts = content.findAll("lilbee-status-value").map((v: MockElement) => v.textContent);
        expect(texts).toContain("10");
        expect(texts).toContain("2");
        expect(texts).toContain("1 errors, 3 warnings");
    });

    it("renders the wiki section as disabled when the server reports it off", async () => {
        const plugin = makePlugin();
        (plugin.api.status as ReturnType<typeof vi.fn>).mockResolvedValue(ok(makeStatus()));
        (plugin.api.showModel as ReturnType<typeof vi.fn>).mockResolvedValue({});
        asMock(plugin.api.wikiStatus).mockResolvedValue(
            ok({ wiki_enabled: false, summaries: 0, drafts: 0, pages: 0, lint_errors: 0, lint_warnings: 0 }),
        );

        const modal = new StatusModal(new App(), plugin);
        modal.open();
        await vi.waitFor(() => {
            const content = (modal as any).contentEl as MockElement;
            expect(content.findAll("lilbee-status-table").length).toBe(3);
        });
        const content = (modal as any).contentEl as MockElement;
        const texts = content.findAll("lilbee-status-value").map((v: MockElement) => v.textContent);
        expect(texts).toContain("disabled");
    });

    it("omits the wiki section when the wiki status call fails", async () => {
        const plugin = makePlugin();
        (plugin.api.status as ReturnType<typeof vi.fn>).mockResolvedValue(ok(makeStatus()));
        (plugin.api.showModel as ReturnType<typeof vi.fn>).mockResolvedValue({});

        const modal = new StatusModal(new App(), plugin);
        modal.open();
        await vi.waitFor(() => {
            const content = (modal as any).contentEl as MockElement;
            expect(content.findAll("lilbee-status-table").length).toBe(2);
        });
    });

    it("shows error notice and closes on API failure", async () => {
        const plugin = makePlugin();
        (plugin.api.status as ReturnType<typeof vi.fn>).mockResolvedValue(err(new Error("timeout")));

        const modal = new StatusModal(new App(), plugin);
        const closeSpy = vi.spyOn(modal, "close");
        modal.open();
        await vi.waitFor(() => {
            expect(closeSpy).toHaveBeenCalled();
        });

        expect(Notice.instances.some((n: any) => n.message.includes("cannot connect"))).toBe(true);
    });

    it("shows error notice and closes on thrown error", async () => {
        const plugin = makePlugin();
        (plugin.api.status as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network"));

        const modal = new StatusModal(new App(), plugin);
        const closeSpy = vi.spyOn(modal, "close");
        modal.open();
        await vi.waitFor(() => {
            expect(closeSpy).toHaveBeenCalled();
        });

        expect(Notice.instances.some((n: any) => n.message.includes("cannot connect"))).toBe(true);
    });

    it("shows the served context window when health reports chat_ctx", async () => {
        const plugin = makePlugin();
        (plugin.api.status as ReturnType<typeof vi.fn>).mockResolvedValue(ok(makeStatus()));
        (plugin.api.showModel as ReturnType<typeof vi.fn>).mockResolvedValue({});
        (plugin.api.health as ReturnType<typeof vi.fn>).mockResolvedValue(
            ok({ status: "ok", version: "1", chat_ctx: 32768 }),
        );

        const modal = new StatusModal(new App(), plugin);
        modal.open();
        await vi.waitFor(() => {
            const content = (modal as any).contentEl as MockElement;
            expect(content.findAll("lilbee-status-table").length).toBeGreaterThanOrEqual(2);
        });

        const content = (modal as any).contentEl as MockElement;
        const labels = content.findAll("lilbee-status-label").map((l: MockElement) => l.textContent);
        const values = content.findAll("lilbee-status-value").map((v: MockElement) => v.textContent);
        expect(labels).toContain("Serving context");
        expect(values).toContain("32768");
    });

    it("omits the served context row when chat_ctx is null or health fails", async () => {
        for (const health of [ok({ status: "ok", version: "1", chat_ctx: null }), err(new Error("down"))]) {
            const plugin = makePlugin();
            (plugin.api.status as ReturnType<typeof vi.fn>).mockResolvedValue(ok(makeStatus()));
            (plugin.api.showModel as ReturnType<typeof vi.fn>).mockResolvedValue({});
            (plugin.api.health as ReturnType<typeof vi.fn>).mockResolvedValue(health);

            const modal = new StatusModal(new App(), plugin);
            modal.open();
            await vi.waitFor(() => {
                const content = (modal as any).contentEl as MockElement;
                expect(content.findAll("lilbee-status-table").length).toBeGreaterThanOrEqual(2);
            });

            const content = (modal as any).contentEl as MockElement;
            const labels = content.findAll("lilbee-status-label").map((l: MockElement) => l.textContent);
            expect(labels).not.toContain("Serving context");
        }
    });

    it("shows OCR: Auto when enable_ocr is not set", async () => {
        const plugin = makePlugin();
        (plugin.api.status as ReturnType<typeof vi.fn>).mockResolvedValue(ok(makeStatus()));
        (plugin.api.showModel as ReturnType<typeof vi.fn>).mockResolvedValue({});

        const modal = new StatusModal(new App(), plugin);
        modal.open();
        await vi.waitFor(() => {
            const content = (modal as any).contentEl as MockElement;
            expect(content.findAll("lilbee-status-table").length).toBeGreaterThanOrEqual(2);
        });

        const content = (modal as any).contentEl as MockElement;
        const values = content.findAll("lilbee-status-value");
        const texts = values.map((v: MockElement) => v.textContent);
        expect(texts).toContain("Auto");
    });

    it("shows OCR: On when enable_ocr is true", async () => {
        const plugin = makePlugin();
        (plugin.api.status as ReturnType<typeof vi.fn>).mockResolvedValue(
            ok(makeStatus({ config: { chat_model: "mistral:7b", enable_ocr: "true" } })),
        );
        (plugin.api.showModel as ReturnType<typeof vi.fn>).mockResolvedValue({});

        const modal = new StatusModal(new App(), plugin);
        modal.open();
        await vi.waitFor(() => {
            const content = (modal as any).contentEl as MockElement;
            expect(content.findAll("lilbee-status-table").length).toBeGreaterThanOrEqual(2);
        });

        const content = (modal as any).contentEl as MockElement;
        const values = content.findAll("lilbee-status-value");
        const texts = values.map((v: MockElement) => v.textContent);
        expect(texts).toContain("On");
    });

    it("shows OCR: Off when enable_ocr is false", async () => {
        const plugin = makePlugin();
        (plugin.api.status as ReturnType<typeof vi.fn>).mockResolvedValue(
            ok(makeStatus({ config: { chat_model: "mistral:7b", enable_ocr: "false" } })),
        );
        (plugin.api.showModel as ReturnType<typeof vi.fn>).mockResolvedValue({});

        const modal = new StatusModal(new App(), plugin);
        modal.open();
        await vi.waitFor(() => {
            const content = (modal as any).contentEl as MockElement;
            expect(content.findAll("lilbee-status-table").length).toBeGreaterThanOrEqual(2);
        });

        const content = (modal as any).contentEl as MockElement;
        const values = content.findAll("lilbee-status-value");
        const texts = values.map((v: MockElement) => v.textContent);
        expect(texts).toContain("Off");
    });

    it("handles showModel failure gracefully", async () => {
        const plugin = makePlugin();
        (plugin.api.status as ReturnType<typeof vi.fn>).mockResolvedValue(ok(makeStatus()));
        (plugin.api.showModel as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("fail"));

        const modal = new StatusModal(new App(), plugin);
        modal.open();
        await vi.waitFor(() => {
            const content = (modal as any).contentEl as MockElement;
            expect(content.findAll("lilbee-status-table").length).toBeGreaterThanOrEqual(2);
        });

        // Should still render without crashing
        const content = (modal as any).contentEl as MockElement;
        const values = content.findAll("lilbee-status-value");
        expect(values.length).toBeGreaterThan(0);
    });

    it("skips model details when no chat model set", async () => {
        const plugin = makePlugin();
        (plugin.api.status as ReturnType<typeof vi.fn>).mockResolvedValue(
            ok(makeStatus({ config: { chat_model: "" } })),
        );

        const modal = new StatusModal(new App(), plugin);
        modal.open();
        await vi.waitFor(() => {
            const content = (modal as any).contentEl as MockElement;
            expect(content.findAll("lilbee-status-table").length).toBeGreaterThanOrEqual(2);
        });

        expect(plugin.api.showModel).not.toHaveBeenCalled();
    });
});

describe("StatusModal document list", () => {
    beforeEach(() => {
        Notice.clear();
    });

    async function openWithDocuments(plugin: LilbeePlugin): Promise<MockElement> {
        asMock(plugin.api.status).mockResolvedValue(ok(makeStatus()));
        asMock(plugin.api.showModel).mockResolvedValue({});

        const modal = new StatusModal(new App(), plugin);
        modal.open();
        const content = (modal as any).contentEl as MockElement;
        await vi.waitFor(() => {
            expect(content.find("lilbee-status-documents-summary")?.textContent).toBeTruthy();
        });
        return content;
    }

    it("lists the indexed documents beneath the count rows", async () => {
        const plugin = makePlugin();
        asMock(plugin.api.listDocuments).mockResolvedValue(
            makeDocsResponse([makeDoc({ filename: "a.md", chunk_count: 3 }), makeDoc({ filename: "b.md" })]),
        );

        const content = await openWithDocuments(plugin);

        expect(plugin.api.listDocuments).toHaveBeenCalledWith(undefined, 200, 0);
        const names = content.findAll("lilbee-documents-row-name").map((el: MockElement) => el.textContent);
        expect(names).toEqual(["a.md", "b.md"]);
        expect(content.findAll("lilbee-documents-checkbox").length).toBe(0);
    });

    it("says all documents are shown for a single page", async () => {
        const plugin = makePlugin();
        asMock(plugin.api.listDocuments).mockResolvedValue(makeDocsResponse([makeDoc()]));

        const content = await openWithDocuments(plugin);

        expect(content.find("lilbee-status-documents-summary")!.textContent).toBe("Showing all 1.");
    });

    it("says the index is empty when no documents come back", async () => {
        const plugin = makePlugin();
        asMock(plugin.api.listDocuments).mockResolvedValue(makeDocsResponse());

        const content = await openWithDocuments(plugin);

        expect(content.find("lilbee-status-documents-summary")!.textContent).toBe("The index has no documents.");
    });

    it("loads the next page when the reader scrolls near the bottom", async () => {
        const page1 = Array.from({ length: 200 }, (_, i) => makeDoc({ filename: `f${i}.md` }));
        const plugin = makePlugin();
        asMock(plugin.api.listDocuments)
            .mockResolvedValueOnce(makeDocsResponse(page1, 201, true))
            .mockResolvedValueOnce(makeDocsResponse([makeDoc({ filename: "f200.md" })], 201));

        const content = await openWithDocuments(plugin);
        const summary = content.find("lilbee-status-documents-summary")!;
        expect(summary.textContent).toBe("Showing 200 of 201.");

        const listEl = content.find("lilbee-status-documents")!;
        Object.assign(listEl, { scrollTop: 800, clientHeight: 400, scrollHeight: 1100 });
        listEl.trigger("scroll");
        await vi.waitFor(() => {
            expect(summary.textContent).toBe("Showing all 201.");
        });

        expect(plugin.api.listDocuments).toHaveBeenLastCalledWith(undefined, 200, 200);
        expect(content.findAll("lilbee-documents-row").length).toBe(201);
    });

    it("opens the note behind a row from the managed folder and closes", async () => {
        const plugin = makePlugin();
        asMock(plugin.api.status).mockResolvedValue(ok(makeStatus()));
        asMock(plugin.api.showModel).mockResolvedValue({});
        asMock(plugin.api.listDocuments).mockResolvedValue(makeDocsResponse([makeDoc({ filename: "notes/a.md" })]));
        const app = new App();
        const file = new TFile();
        asMock(app.vault.getAbstractFileByPath).mockImplementation((path: string) =>
            path === "lilbee/notes/a.md" ? file : null,
        );
        const openFile = vi.fn();
        asMock(app.workspace.getLeaf).mockReturnValue({ openFile });

        const modal = new StatusModal(app, plugin);
        const closeSpy = vi.spyOn(modal, "close");
        modal.open();
        const content = (modal as any).contentEl as MockElement;
        await vi.waitFor(() => {
            expect(content.find("lilbee-documents-row-link")).toBeTruthy();
        });
        content.find("lilbee-documents-row-link")!.trigger("click");

        expect(openFile).toHaveBeenCalledWith(file);
        expect(closeSpy).toHaveBeenCalledTimes(1);
    });

    it.each([
        ["docs.zip/report.pdf", "lilbee/docs.zip"],
        ["docs.zip/inner.zip/notes.txt", "docs.zip"],
    ])("opens the archive behind a member row %s and says which archive holds it", async (member, archivePath) => {
        const plugin = makePlugin();
        asMock(plugin.api.status).mockResolvedValue(ok(makeStatus()));
        asMock(plugin.api.showModel).mockResolvedValue({});
        asMock(plugin.api.listDocuments).mockResolvedValue(makeDocsResponse([makeDoc({ filename: member })]));
        const app = new App();
        const archive = new TFile();
        archive.name = "docs.zip";
        asMock(app.vault.getAbstractFileByPath).mockImplementation((path: string) =>
            path === archivePath ? archive : null,
        );
        const openFile = vi.fn();
        asMock(app.workspace.getLeaf).mockReturnValue({ openFile });
        const revealInFolder = vi.fn();
        const explorer = { view: { revealInFolder } };
        app.workspace.getLeavesOfType = vi.fn().mockReturnValue([explorer]);
        app.workspace.revealLeaf = vi.fn();
        const modal = new StatusModal(app, plugin);
        const closeSpy = vi.spyOn(modal, "close");
        modal.open();
        const content = (modal as any).contentEl as MockElement;
        await vi.waitFor(() => {
            expect(content.find("lilbee-documents-row-link")).toBeTruthy();
        });
        content.find("lilbee-documents-row-link")!.trigger("click");
        expect(openFile).not.toHaveBeenCalled();
        expect(revealInFolder).toHaveBeenCalledWith(archive);
        expect(app.workspace.revealLeaf).toHaveBeenCalledWith(explorer);
        expect(closeSpy).toHaveBeenCalledTimes(1);
        expect(Notice.instances.map((n: any) => n.message)).toContain(
            MESSAGES.NOTICE_DOCUMENT_IN_ARCHIVE(member, "docs.zip"),
        );
    });

    it("still names the archive when the file explorer is closed", async () => {
        const plugin = makePlugin();
        asMock(plugin.api.status).mockResolvedValue(ok(makeStatus()));
        asMock(plugin.api.showModel).mockResolvedValue({});
        asMock(plugin.api.listDocuments).mockResolvedValue(makeDocsResponse([makeDoc({ filename: "docs.zip/a.pdf" })]));
        const app = new App();
        const archive = new TFile();
        archive.name = "docs.zip";
        asMock(app.vault.getAbstractFileByPath).mockImplementation((path: string) =>
            path === "lilbee/docs.zip" ? archive : null,
        );
        app.workspace.getLeavesOfType = vi.fn().mockReturnValue([]);
        const modal = new StatusModal(app, plugin);
        modal.open();
        const content = (modal as any).contentEl as MockElement;
        await vi.waitFor(() => {
            expect(content.find("lilbee-documents-row-link")).toBeTruthy();
        });
        content.find("lilbee-documents-row-link")!.trigger("click");
        expect(Notice.instances.map((n: any) => n.message)).toContain(
            MESSAGES.NOTICE_DOCUMENT_IN_ARCHIVE("docs.zip/a.pdf", "docs.zip"),
        );
    });

    it("says when a document is not in this vault", async () => {
        const plugin = makePlugin();
        asMock(plugin.api.listDocuments).mockResolvedValue(makeDocsResponse([makeDoc({ filename: "outside.pdf" })]));

        const content = await openWithDocuments(plugin);
        content.find("lilbee-documents-row-link")!.trigger("click");

        expect(Notice.instances.map((n: any) => n.message)).toContain("outside.pdf is not in this vault.");
    });

    it("reports a failed document fetch in the summary", async () => {
        const plugin = makePlugin();
        asMock(plugin.api.listDocuments).mockRejectedValue(new Error("network"));

        const content = await openWithDocuments(plugin);

        expect(content.find("lilbee-status-documents-summary")!.textContent).toBe(
            MESSAGES.LABEL_STATUS_DOCUMENTS_FAILED,
        );
        expect(Notice.instances.some((n: any) => n.message.includes("failed to load documents"))).toBe(true);
    });
});

describe("StatusModal held-out files", () => {
    beforeEach(() => {
        Notice.clear();
    });

    async function openWithStatus(status: StatusResponse): Promise<MockElement> {
        const plugin = makePlugin();
        asMock(plugin.api.status).mockResolvedValue(ok(status));
        asMock(plugin.api.showModel).mockResolvedValue({});

        const modal = new StatusModal(new App(), plugin);
        modal.open();
        const content = (modal as any).contentEl as MockElement;
        await vi.waitFor(() => {
            expect(content.findAll("lilbee-status-table").length).toBeGreaterThanOrEqual(2);
        });
        return content;
    }

    it.each([
        ["the server omits the fields", makeStatus()],
        ["no files are held out", makeStatus({ skipped: [], skipped_total: 0 })],
    ])("renders no held-out section when %s", async (_label, status) => {
        const content = await openWithStatus(status);

        expect(content.find("lilbee-status-held-out")).toBeNull();
        expect(content.find("lilbee-status-held-out-retry")).toBeNull();
    });

    it("lists each held-out file with its reason and names the retry command", async () => {
        const content = await openWithStatus(
            makeStatus({
                skipped: [
                    { filename: "scan.pdf", reason: "no text extracted" },
                    { filename: "empty.md", reason: "file is empty" },
                ],
                skipped_total: 2,
            }),
        );

        const names = content.findAll("lilbee-status-held-out-name").map((el: MockElement) => el.textContent);
        const reasons = content.findAll("lilbee-status-held-out-reason").map((el: MockElement) => el.textContent);
        expect(names).toEqual(["scan.pdf", "empty.md"]);
        expect(reasons).toEqual(["no text extracted", "file is empty"]);
        expect(content.find("lilbee-status-held-out-name")!.attributes["title"]).toBe("scan.pdf");
        expect(content.find("lilbee-status-held-out-more")).toBeNull();
        expect(content.find("lilbee-status-held-out-retry")!.textContent).toContain(
            MESSAGES.COMMAND_SYNC_RETRY_SKIPPED,
        );
    });

    it("shows no overflow line when the server sends the list without a total", async () => {
        const content = await openWithStatus(
            makeStatus({ skipped: [{ filename: "scan.pdf", reason: "no text extracted" }] }),
        );

        expect(content.findAll("lilbee-status-held-out-name").length).toBe(1);
        expect(content.find("lilbee-status-held-out-more")).toBeNull();
    });

    it("says how many more files are held out when the list is capped", async () => {
        const content = await openWithStatus(
            makeStatus({
                skipped: [{ filename: "scan.pdf", reason: "no text extracted" }],
                skipped_total: 13,
            }),
        );

        expect(content.findAll("lilbee-status-held-out-name").length).toBe(1);
        expect(content.find("lilbee-status-held-out-more")!.textContent).toBe("12 more held out.");
    });
});
