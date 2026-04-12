import { describe, it, expect, vi, beforeEach } from "vitest";
import { App, Notice } from "obsidian";
import { ok, err } from "neverthrow";
import { StatusModal } from "../../src/views/status-modal";
import { MockElement } from "../__mocks__/obsidian";
import type LilbeePlugin from "../../src/main";
import type { StatusResponse } from "../../src/types";

function makePlugin(overrides: Partial<{ activeModel: string }> = {}): LilbeePlugin {
    return {
        activeModel: overrides.activeModel ?? "mistral:7b",
        api: {
            status: vi.fn(),
            showModel: vi.fn(),
        },
    } as unknown as LilbeePlugin;
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
        await vi.waitFor(() => {
            const content = (modal as any).contentEl as MockElement;
            expect(content.find("lilbee-status-modal")).toBeTruthy();
        });

        const content = (modal as any).contentEl as MockElement;
        const tables = content.findAll("lilbee-status-table");
        expect(tables.length).toBeGreaterThanOrEqual(2);

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
        expect(texts).toContain("Q4_K_M");
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
        expect(texts).toContain("OCR: Auto");
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
        expect(texts).toContain("OCR: On");
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
        expect(texts).toContain("OCR: Off");
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
