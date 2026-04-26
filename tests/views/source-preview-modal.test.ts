import { vi, describe, it, expect, beforeEach } from "vitest";
import { App, MockElement, Notice } from "../__mocks__/obsidian";
import { SourcePreviewModal } from "../../src/views/source-preview-modal";
import { CONTENT_TYPE } from "../../src/types";
import type { Source, SourceContent } from "../../src/types";
import type { LilbeeClient } from "../../src/api";

function makeSource(overrides: Partial<Source> = {}): Source {
    return {
        source: "crawled/example.com/page.md",
        content_type: CONTENT_TYPE.MARKDOWN,
        distance: 0.1,
        chunk: "chunk",
        page_start: null,
        page_end: null,
        line_start: null,
        line_end: null,
        ...overrides,
    };
}

function makeApi(overrides: Partial<Record<keyof LilbeeClient, unknown>> = {}): LilbeeClient {
    return {
        getSource: vi.fn(),
        getSourceRaw: vi.fn(),
        ...overrides,
    } as unknown as LilbeeClient;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
    Notice.clear();
});

describe("SourcePreviewModal — malformed source", () => {
    it("shows an error notice and does not fetch when source.source is empty", async () => {
        const app = new App();
        const api = makeApi();
        const modal = new SourcePreviewModal(app as never, api, makeSource({ source: "" }));
        modal.open();
        await tick();
        expect(api.getSource).not.toHaveBeenCalled();
        const messages = Notice.instances.map((n) => n.message);
        expect(messages.some((m) => m.toLowerCase().includes("source"))).toBe(true);
    });
});

describe("SourcePreviewModal — resizable frame", () => {
    it("applies the resize class and sizing styles to the outer modal frame", async () => {
        const app = new App();
        const api = makeApi({
            getSource: vi.fn().mockResolvedValue({
                markdown: "body",
                content_type: CONTENT_TYPE.MARKDOWN,
            }),
        });
        const modal = new SourcePreviewModal(app as never, api, makeSource());
        modal.open();
        await tick();
        const frame = modal.modalEl as unknown as MockElement;
        expect(frame.classList.contains("lilbee-preview-modal-frame")).toBe(true);
        expect(frame.style.resize).toBe("both");
        expect(frame.style.overflow).toBe("hidden");
        expect(frame.style.width).toContain("92vw");
        expect(frame.style.height).toContain("85vh");
    });
});

describe("SourcePreviewModal — loading + success (markdown)", () => {
    it("shows loading spinner immediately", () => {
        const app = new App();
        const api = makeApi({
            getSource: vi.fn(() => new Promise<SourceContent>(() => {})),
        });
        const modal = new SourcePreviewModal(app as never, api, makeSource());
        modal.open();
        const el = modal.contentEl as unknown as MockElement;
        expect(el.find("lilbee-preview-loading")).not.toBeNull();
    });

    it("renders markdown body after fetch resolves", async () => {
        const app = new App();
        const api = makeApi({
            getSource: vi.fn().mockResolvedValue({
                markdown: "# Hello from server",
                content_type: CONTENT_TYPE.MARKDOWN,
            } satisfies SourceContent),
        });
        const modal = new SourcePreviewModal(app as never, api, makeSource());
        modal.open();
        await tick();
        const el = modal.contentEl as unknown as MockElement;
        expect(el.find("lilbee-preview-loading")).toBeNull();
        const body = el.find("lilbee-preview-body");
        expect(body).not.toBeNull();
        expect(body!.textContent).toContain("# Hello from server");
    });

    it("renders header with vault_path when available", async () => {
        const app = new App();
        const api = makeApi({
            getSource: vi.fn().mockResolvedValue({
                markdown: "body",
                content_type: CONTENT_TYPE.MARKDOWN,
            }),
        });
        const modal = new SourcePreviewModal(
            app as never,
            api,
            makeSource({ vault_path: "lilbee/crawled/example.com/page.md" }),
        );
        modal.open();
        await tick();
        const el = modal.contentEl as unknown as MockElement;
        const header = el.find("lilbee-preview-header")!;
        expect(header.textContent).toContain("lilbee/crawled/example.com/page.md");
    });

    it("falls back to source.source for the header when no vault_path", async () => {
        const app = new App();
        const api = makeApi({
            getSource: vi.fn().mockResolvedValue({
                markdown: "body",
                content_type: CONTENT_TYPE.MARKDOWN,
            }),
        });
        const modal = new SourcePreviewModal(
            app as never,
            api,
            makeSource({ source: "external/path.md", vault_path: null }),
        );
        modal.open();
        await tick();
        const el = modal.contentEl as unknown as MockElement;
        const header = el.find("lilbee-preview-header")!;
        expect(header.textContent).toContain("external/path.md");
    });

    it("shows page metadata when page_start is set", async () => {
        const app = new App();
        const api = makeApi({
            getSource: vi.fn().mockResolvedValue({
                markdown: "body",
                content_type: CONTENT_TYPE.MARKDOWN,
            }),
        });
        const modal = new SourcePreviewModal(app as never, api, makeSource({ page_start: 5 }));
        modal.open();
        await tick();
        const el = modal.contentEl as unknown as MockElement;
        const meta = el.find("lilbee-preview-meta");
        expect(meta).not.toBeNull();
        expect(meta!.textContent).toContain("p. 5");
    });

    it("shows line metadata when line_start is set", async () => {
        const app = new App();
        const api = makeApi({
            getSource: vi.fn().mockResolvedValue({
                markdown: "body",
                content_type: CONTENT_TYPE.MARKDOWN,
            }),
        });
        const modal = new SourcePreviewModal(app as never, api, makeSource({ line_start: 12 }));
        modal.open();
        await tick();
        const el = modal.contentEl as unknown as MockElement;
        const meta = el.find("lilbee-preview-meta");
        expect(meta).not.toBeNull();
        expect(meta!.textContent).toContain("line 12");
    });

    it("omits metadata block when no page or line info", async () => {
        const app = new App();
        const api = makeApi({
            getSource: vi.fn().mockResolvedValue({
                markdown: "body",
                content_type: CONTENT_TYPE.MARKDOWN,
            }),
        });
        const modal = new SourcePreviewModal(app as never, api, makeSource());
        modal.open();
        await tick();
        const el = modal.contentEl as unknown as MockElement;
        expect(el.find("lilbee-preview-meta")).toBeNull();
    });
});

describe("SourcePreviewModal — success (PDF)", () => {
    it('renders an <object type="application/pdf"> pointing to the raw URL', async () => {
        const app = new App();
        const api = makeApi({
            getSource: vi.fn().mockResolvedValue({
                markdown: "",
                content_type: CONTENT_TYPE.PDF,
            }),
        });
        const modal = new SourcePreviewModal(
            app as never,
            api,
            makeSource({ source: "crawled/example.com/book.pdf", content_type: CONTENT_TYPE.PDF }),
        );
        modal.open();
        await tick();
        const el = modal.contentEl as unknown as MockElement;
        const frame = el.find("lilbee-preview-pdf-frame");
        expect(frame).not.toBeNull();
        // Type-locked <object> tag prevents server-controlled mime from rendering
        // a malicious .html source as text/html inside the plugin origin.
        expect(frame!.tagName).toBe("OBJECT");
        expect(frame!.attributes["type"]).toBe("application/pdf");
        expect(frame!.attributes["data"]).toContain("book.pdf");
        expect(el.find("lilbee-preview-iframe")).toBeNull();
    });

    it("renders a PDF object when source.content_type is PDF even if body content_type differs", async () => {
        const app = new App();
        const api = makeApi({
            getSource: vi.fn().mockResolvedValue({
                markdown: "",
                content_type: "text/plain",
            }),
        });
        const modal = new SourcePreviewModal(app as never, api, makeSource({ content_type: CONTENT_TYPE.PDF }));
        modal.open();
        await tick();
        const el = modal.contentEl as unknown as MockElement;
        const frame = el.find("lilbee-preview-pdf-frame")!;
        expect(frame.tagName).toBe("OBJECT");
    });

    it("appends #page=N to the object data URL when page_start is set", async () => {
        const app = new App();
        const api = makeApi({
            getSource: vi.fn().mockResolvedValue({
                markdown: "",
                content_type: CONTENT_TYPE.PDF,
            }),
        });
        const modal = new SourcePreviewModal(
            app as never,
            api,
            makeSource({
                source: "crawled/example.com/book.pdf",
                content_type: CONTENT_TYPE.PDF,
                page_start: 42,
            }),
        );
        modal.open();
        await tick();
        const el = modal.contentEl as unknown as MockElement;
        const frame = el.find("lilbee-preview-pdf-frame")!;
        expect(frame.attributes["data"]).toContain("#page=42");
    });

    it("omits the #page= fragment when page_start is null", async () => {
        const app = new App();
        const api = makeApi({
            getSource: vi.fn().mockResolvedValue({
                markdown: "",
                content_type: CONTENT_TYPE.PDF,
            }),
        });
        const modal = new SourcePreviewModal(
            app as never,
            api,
            makeSource({ content_type: CONTENT_TYPE.PDF, page_start: null }),
        );
        modal.open();
        await tick();
        const el = modal.contentEl as unknown as MockElement;
        const frame = el.find("lilbee-preview-pdf-frame")!;
        expect(frame.attributes["data"]).not.toContain("#page=");
    });
});

describe("SourcePreviewModal — unsupported mime", () => {
    it("renders an error message instead of treating unknown content as markdown", async () => {
        const app = new App();
        const api = makeApi({
            getSource: vi.fn().mockResolvedValue({
                markdown: "<script>alert(1)</script>",
                content_type: "application/octet-stream",
            }),
        });
        const modal = new SourcePreviewModal(
            app as never,
            api,
            makeSource({
                source: "evil.html",
                content_type: "application/octet-stream",
            }),
        );
        modal.open();
        await tick();
        const el = modal.contentEl as unknown as MockElement;
        // No body rendered with attacker-controlled markup.
        expect(el.find("lilbee-preview-body")).toBeNull();
        const errorEl = el.find("lilbee-preview-error");
        expect(errorEl).not.toBeNull();
        expect(errorEl!.textContent).toContain("application/octet-stream");
    });

    it.each(["text/html", "text/javascript", "application/javascript", "application/xhtml+xml", "text/css"])(
        "denies inline render for %s even though it falls under text/*",
        async (mime) => {
            const app = new App();
            const api = makeApi({
                getSource: vi.fn().mockResolvedValue({
                    markdown: "<script>alert(1)</script>",
                    content_type: mime,
                }),
            });
            const modal = new SourcePreviewModal(app as never, api, makeSource({ source: "evil", content_type: mime }));
            modal.open();
            await tick();
            const el = modal.contentEl as unknown as MockElement;
            expect(el.find("lilbee-preview-body")).toBeNull();
            const errorEl = el.find("lilbee-preview-error");
            expect(errorEl).not.toBeNull();
            expect(errorEl!.textContent).toContain(mime);
        },
    );

    it("still renders text/plain inline (regression guard for the deny-list)", async () => {
        const app = new App();
        const api = makeApi({
            getSource: vi.fn().mockResolvedValue({
                markdown: "plain text body",
                content_type: "text/plain",
            }),
        });
        const modal = new SourcePreviewModal(
            app as never,
            api,
            makeSource({ source: "notes.txt", content_type: "text/plain" }),
        );
        modal.open();
        await tick();
        const el = modal.contentEl as unknown as MockElement;
        const body = el.find("lilbee-preview-body");
        expect(body).not.toBeNull();
        expect(body!.textContent).toContain("plain text body");
    });
});

describe("SourcePreviewModal — error", () => {
    it("shows a Notice and error state when getSource throws", async () => {
        const app = new App();
        const api = makeApi({
            getSource: vi.fn().mockRejectedValue(new Error("boom")),
        });
        const modal = new SourcePreviewModal(app as never, api, makeSource());
        modal.open();
        await tick();
        const el = modal.contentEl as unknown as MockElement;
        expect(el.find("lilbee-preview-loading")).toBeNull();
        expect(el.find("lilbee-preview-error")).not.toBeNull();
        const messages = Notice.instances.map((n) => n.message);
        expect(messages.some((m) => m.toLowerCase().includes("boom"))).toBe(true);
    });
});

describe("SourcePreviewModal — footer", () => {
    it("renders Close and disabled Save-to-vault buttons", async () => {
        const app = new App();
        const api = makeApi({
            getSource: vi.fn().mockResolvedValue({
                markdown: "body",
                content_type: CONTENT_TYPE.MARKDOWN,
            }),
        });
        const modal = new SourcePreviewModal(app as never, api, makeSource());
        modal.open();
        await tick();
        const el = modal.contentEl as unknown as MockElement;
        const footer = el.find("lilbee-preview-footer")!;
        const buttons = footer.children.filter((c) => c.tagName === "BUTTON");
        expect(buttons).toHaveLength(2);
        const save = buttons.find((b) => b.classList.contains("lilbee-preview-save"))!;
        expect(save.disabled).toBe(true);
        expect(save.attributes["title"]).toBeDefined();
    });

    it("Close button closes the modal", async () => {
        const app = new App();
        const api = makeApi({
            getSource: vi.fn().mockResolvedValue({
                markdown: "body",
                content_type: CONTENT_TYPE.MARKDOWN,
            }),
        });
        const modal = new SourcePreviewModal(app as never, api, makeSource());
        const closeSpy = vi.spyOn(modal, "close");
        modal.open();
        await tick();
        const el = modal.contentEl as unknown as MockElement;
        const close = el.find("lilbee-preview-close")!;
        close.trigger("click");
        expect(closeSpy).toHaveBeenCalled();
    });
});

describe("SourcePreviewModal — onClose", () => {
    it("empties content on close", async () => {
        const app = new App();
        const api = makeApi({
            getSource: vi.fn().mockResolvedValue({
                markdown: "body",
                content_type: CONTENT_TYPE.MARKDOWN,
            }),
        });
        const modal = new SourcePreviewModal(app as never, api, makeSource());
        modal.open();
        await tick();
        modal.close();
        const el = modal.contentEl as unknown as MockElement;
        expect(el.children.length).toBe(0);
    });
});
