import { describe, it, expect, vi, beforeEach } from "vitest";
import { App, Notice } from "obsidian";
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
        activeModel: overrides.activeModel ?? "mistral:7b",
        api: {
            status: vi.fn(),
            showModel: vi.fn(),
            health: vi.fn().mockResolvedValue(ok({ status: "ok", version: "1" })),
            listDocuments: vi.fn().mockResolvedValue(makeDocsResponse()),
        },
    } as unknown as LilbeePlugin;
}

function asMock(fn: unknown): ReturnType<typeof vi.fn> {
    return fn as ReturnType<typeof vi.fn>;
}

function makeStatus(overrides: Partial<StatusResponse> = {}): StatusResponse {
    return {
        config: { chat_model: "mistral:7b", embedding_model: "nomic-embed-text" },
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

    it("renders wiki section when wiki is present", async () => {
        const plugin = makePlugin();
        (plugin.api.status as ReturnType<typeof vi.fn>).mockResolvedValue(
            ok(
                makeStatus({
                    wiki: { enabled: true, page_count: 10, draft_count: 2, last_lint: "2026-01-01" },
                }),
            ),
        );
        (plugin.api.showModel as ReturnType<typeof vi.fn>).mockResolvedValue({});

        const modal = new StatusModal(new App(), plugin);
        modal.open();
        await vi.waitFor(() => {
            const content = (modal as any).contentEl as MockElement;
            const tables = content.findAll("lilbee-status-table");
            expect(tables.length).toBe(3);
        });

        const content = (modal as any).contentEl as MockElement;
        const values = content.findAll("lilbee-status-value");
        const texts = values.map((v: MockElement) => v.textContent);
        expect(texts).toContain("10");
        expect(texts).toContain("2");
        expect(texts).toContain("2026-01-01");
    });

    it("does not render wiki section when wiki is absent", async () => {
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

    it("renders wiki disabled status", async () => {
        const plugin = makePlugin();
        (plugin.api.status as ReturnType<typeof vi.fn>).mockResolvedValue(
            ok(
                makeStatus({
                    wiki: { enabled: false, page_count: 0, draft_count: 0, last_lint: null },
                }),
            ),
        );
        (plugin.api.showModel as ReturnType<typeof vi.fn>).mockResolvedValue({});

        const modal = new StatusModal(new App(), plugin);
        modal.open();
        await vi.waitFor(() => {
            const content = (modal as any).contentEl as MockElement;
            expect(content.findAll("lilbee-status-table").length).toBe(3);
        });

        const content = (modal as any).contentEl as MockElement;
        const values = content.findAll("lilbee-status-value");
        const texts = values.map((v: MockElement) => v.textContent);
        expect(texts).toContain("disabled");
        expect(texts).toContain("n/a");
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

        expect(plugin.api.listDocuments).toHaveBeenCalledWith(undefined, 20, 0);
        const names = content.findAll("lilbee-documents-row-name").map((el: MockElement) => el.textContent);
        expect(names).toEqual(["a.md", "b.md"]);
        expect(content.findAll("lilbee-documents-checkbox").length).toBe(0);
    });

    it("says all documents are shown for a single page", async () => {
        const plugin = makePlugin();
        asMock(plugin.api.listDocuments).mockResolvedValue(makeDocsResponse([makeDoc()]));

        const content = await openWithDocuments(plugin);

        expect(content.find("lilbee-status-documents-summary")!.textContent).toBe("Showing all 1.");
        expect(content.find("lilbee-status-load-more")!.style.display).toBe("none");
    });

    it("says the index is empty when no documents come back", async () => {
        const plugin = makePlugin();
        asMock(plugin.api.listDocuments).mockResolvedValue(makeDocsResponse());

        const content = await openWithDocuments(plugin);

        expect(content.find("lilbee-status-documents-summary")!.textContent).toBe("The index has no documents.");
        expect(content.find("lilbee-status-load-more")!.style.display).toBe("none");
    });

    it("loads the next page when the reader selects load more", async () => {
        const page1 = Array.from({ length: 20 }, (_, i) => makeDoc({ filename: `f${i}.md` }));
        const plugin = makePlugin();
        asMock(plugin.api.listDocuments)
            .mockResolvedValueOnce(makeDocsResponse(page1, 21, true))
            .mockResolvedValueOnce(makeDocsResponse([makeDoc({ filename: "f20.md" })], 21));

        const content = await openWithDocuments(plugin);
        const summary = content.find("lilbee-status-documents-summary")!;
        const button = content.find("lilbee-status-load-more")!;
        expect(summary.textContent).toBe("Showing 20 of 21.");
        expect(button.style.display).not.toBe("none");

        button.trigger("click");
        await vi.waitFor(() => {
            expect(summary.textContent).toBe("Showing all 21.");
        });

        expect(plugin.api.listDocuments).toHaveBeenLastCalledWith(undefined, 20, 20);
        expect(content.findAll("lilbee-documents-row").length).toBe(21);
        expect(button.style.display).toBe("none");
    });

    it("reports a failed document fetch and keeps load more for a retry", async () => {
        const plugin = makePlugin();
        asMock(plugin.api.listDocuments).mockRejectedValue(new Error("network"));

        const content = await openWithDocuments(plugin);

        expect(content.find("lilbee-status-documents-summary")!.textContent).toBe(
            MESSAGES.LABEL_STATUS_DOCUMENTS_FAILED,
        );
        expect(content.find("lilbee-status-load-more")!.style.display).not.toBe("none");
        expect(Notice.instances.some((n: any) => n.message.includes("failed to load documents"))).toBe(true);
    });
});
