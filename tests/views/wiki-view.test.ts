import { vi, describe, it, expect, beforeEach } from "vitest";
import { WorkspaceLeaf, MockElement } from "../__mocks__/obsidian";
import { WikiView, VIEW_TYPE_WIKI } from "../../src/views/wiki-view";
import type LilbeePlugin from "../../src/main";
import type { WikiPage, WikiPageDetail, WikiStub } from "../../src/types";
import { INDETERMINATE_PROGRESS } from "../../src/types";

let mockConfirmResult = true;
vi.mock("../../src/views/confirm-modal", () => ({
    ConfirmModal: vi.fn().mockImplementation(function () {
        return { open: vi.fn(), result: Promise.resolve(mockConfirmResult) };
    }),
}));

vi.mock("../../src/views/citation-modal", () => ({
    CitationModal: vi.fn().mockImplementation(function () {
        return {
            open: vi.fn(),
        };
    }),
}));

const tick = () => new Promise((r) => setTimeout(r, 0));

function makeLeaf(): WorkspaceLeaf {
    return new WorkspaceLeaf();
}

function makePlugin(): LilbeePlugin {
    return {
        api: {
            wikiList: vi.fn().mockResolvedValue([]),
            wikiStubs: vi.fn().mockResolvedValue([]),
            wikiGenerate: vi.fn(),
            wikiPage: vi.fn().mockResolvedValue({} as WikiPageDetail),
        },
        runWikiLint: vi.fn(),
        taskQueue: {
            enqueue: vi.fn().mockReturnValue("task-1"),
            update: vi.fn(),
            complete: vi.fn(),
            fail: vi.fn(),
        },
        app: {
            workspace: { openLinkText: vi.fn() },
        },
    } as unknown as LilbeePlugin;
}

/** The generate route streams: a phase, the page, then done carrying the slug
 * the read route accepts. Mocks yield that rather than resolving a body. */
function generateStream(done: { slug: string; path: string } | null, opts: { fail?: Error } = {}) {
    return () =>
        (async function* () {
            yield { event: "wiki_phase", data: { phase: "generate", total: 1 } };
            if (opts.fail) throw opts.fail;
            yield { event: "wiki_page", data: { label: "x", pages: 1, current: 1, total: 1 } };
            if (done) yield { event: "done", data: done };
        })();
}

function makePage(overrides: Partial<WikiPage> = {}): WikiPage {
    return {
        slug: "summaries/test-page",
        title: "Test Page",
        page_type: "summary",
        source_count: 1,
        created_at: new Date().toISOString(),
        ...overrides,
    };
}

function makePageDetail(overrides: Partial<WikiPageDetail> = {}): WikiPageDetail {
    return {
        ...makePage(overrides),
        content: "# Test\nSome content",
        ...overrides,
    };
}

function findByClass(el: MockElement, cls: string): MockElement[] {
    return el.findAll(cls);
}

function collectTexts(el: MockElement): string[] {
    const texts: string[] = [];
    if (el.textContent) texts.push(el.textContent);
    for (const child of el.children) {
        texts.push(...collectTexts(child));
    }
    return texts;
}

describe("VIEW_TYPE_WIKI", () => {
    it("equals 'lilbee-wiki'", () => {
        expect(VIEW_TYPE_WIKI).toBe("lilbee-wiki");
    });
});

describe("WikiView metadata", () => {
    let view: WikiView;

    beforeEach(() => {
        view = new WikiView(makeLeaf(), makePlugin() as unknown as LilbeePlugin);
    });

    it("getViewType returns 'lilbee-wiki'", () => {
        expect(view.getViewType()).toBe("lilbee-wiki");
    });

    it("getDisplayText returns 'lilbee Wiki'", () => {
        expect(view.getDisplayText()).toBe("lilbee Wiki");
    });

    it("getIcon returns 'book-open'", () => {
        expect(view.getIcon()).toBe("book-open");
    });
});

describe("WikiView.onOpen", () => {
    let view: WikiView;
    let plugin: LilbeePlugin;
    let contentEl: MockElement;

    beforeEach(async () => {
        plugin = makePlugin();
        view = new WikiView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();
        contentEl = (view as any).contentEl as MockElement;
    });

    it("closes its leaf from the toolbar x", () => {
        contentEl.find("lilbee-panel-close")!.trigger("click");
        expect((view as any).leaf.detach).toHaveBeenCalledTimes(1);
    });

    it("adds lilbee-wiki-container class", () => {
        expect(contentEl.classList.contains("lilbee-wiki-container")).toBe(true);
    });

    it("renders header with Wiki title", () => {
        const header = contentEl.find("lilbee-wiki-header");
        expect(header).not.toBeNull();
        const texts = collectTexts(header!);
        expect(texts.some((t) => t.includes("Wiki"))).toBe(true);
    });

    it("renders refresh button", () => {
        const buttons = findByClass(contentEl, "lilbee-tasks-clear");
        expect(buttons.length).toBe(2);
        expect(buttons[0]!.attributes["data-icon"]).toBe("refresh-cw");
    });

    it("renders lint button", () => {
        const buttons = findByClass(contentEl, "lilbee-tasks-clear");
        expect(buttons[1]!.attributes["data-icon"]).toBe("check-circle");
    });

    it("renders filter input", () => {
        const filterInput = (view as any).filterInput as MockElement;
        expect(filterInput).not.toBeNull();
        expect(filterInput.tagName).toBe("INPUT");
    });

    it("renders list and detail containers", () => {
        expect(contentEl.find("lilbee-wiki-list")).not.toBeNull();
        expect(contentEl.find("lilbee-wiki-detail")).not.toBeNull();
    });

    it("calls refresh on open", () => {
        expect(plugin.api.wikiList).toHaveBeenCalled();
    });

    it("refresh button triggers refresh", async () => {
        const buttons = findByClass(contentEl, "lilbee-tasks-clear");
        const refreshBtn = buttons[0]!;
        (plugin.api.wikiList as ReturnType<typeof vi.fn>).mockClear();
        refreshBtn.trigger("click");
        await tick();
        expect(plugin.api.wikiList).toHaveBeenCalled();
    });

    it("lint button triggers runWikiLint", () => {
        const buttons = findByClass(contentEl, "lilbee-tasks-clear");
        const lintBtn = buttons[1]!;
        lintBtn.trigger("click");
        expect(plugin.runWikiLint).toHaveBeenCalled();
    });

    it("filter input triggers renderList", async () => {
        const pages = [makePage({ slug: "alpha", title: "Alpha" })];
        (plugin.api.wikiList as ReturnType<typeof vi.fn>).mockResolvedValue(pages);
        await view.refresh();

        const filterInput = (view as any).filterInput as MockElement;
        filterInput.value = "xyz";
        filterInput.trigger("input");

        const listEl = (view as any).listEl as MockElement;
        const emptyState = listEl.find("lilbee-empty-state");
        expect(emptyState).not.toBeNull();
    });
});

describe("WikiView.refresh", () => {
    let view: WikiView;
    let plugin: LilbeePlugin;

    beforeEach(async () => {
        plugin = makePlugin();
        view = new WikiView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();
    });

    it("populates pages from api.wikiList", async () => {
        const pages = [makePage()];
        (plugin.api.wikiList as ReturnType<typeof vi.fn>).mockResolvedValue(pages);
        await view.refresh();
        expect((view as any).pages).toEqual(pages);
    });

    it("sets pages to empty array on api error", async () => {
        (plugin.api.wikiList as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("fail"));
        await view.refresh();
        expect((view as any).pages).toEqual([]);
    });

    it("calls showPage when selectedSlug is set", async () => {
        (view as any).selectedSlug = "my-slug";
        const showPageSpy = vi.spyOn(view as any, "showPage");
        const pages = [makePage({ slug: "my-slug" })];
        (plugin.api.wikiList as ReturnType<typeof vi.fn>).mockResolvedValue(pages);
        await view.refresh();
        expect(showPageSpy).toHaveBeenCalledWith("my-slug");
    });

    it("does not call showPage when selectedSlug is null", async () => {
        (view as any).selectedSlug = null;
        const showPageSpy = vi.spyOn(view as any, "showPage");
        await view.refresh();
        expect(showPageSpy).not.toHaveBeenCalled();
    });
});

describe("WikiView.renderList", () => {
    let view: WikiView;
    let plugin: LilbeePlugin;
    let listEl: MockElement;

    beforeEach(async () => {
        plugin = makePlugin();
        view = new WikiView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();
        listEl = (view as any).listEl as MockElement;
    });

    it("shows empty state when no pages", () => {
        (view as any).pages = [];
        (view as any).renderList();
        const empty = listEl.find("lilbee-empty-state");
        expect(empty).not.toBeNull();
        expect(empty!.textContent).toBe("No wiki pages yet");
    });

    it("renders summary group", () => {
        (view as any).pages = [makePage({ page_type: "summary", title: "Sum Page" })];
        (view as any).renderList();
        const headers = findByClass(listEl, "lilbee-tasks-section-header");
        expect(headers.length).toBe(1);
        expect(headers[0]!.textContent).toBe("Summaries");
    });

    it("renders synthesis/concepts group", () => {
        (view as any).pages = [makePage({ page_type: "synthesis", title: "Concept Page" })];
        (view as any).renderList();
        const headers = findByClass(listEl, "lilbee-tasks-section-header");
        expect(headers.length).toBe(1);
        expect(headers[0]!.textContent).toBe("Concepts");
    });

    it("renders both groups when both types present", () => {
        (view as any).pages = [
            makePage({ slug: "s1", page_type: "summary" }),
            makePage({ slug: "s2", page_type: "synthesis" }),
        ];
        (view as any).renderList();
        const headers = findByClass(listEl, "lilbee-tasks-section-header");
        expect(headers.length).toBe(2);
        expect(headers[0]!.textContent).toBe("Summaries");
        expect(headers[1]!.textContent).toBe("Concepts");
    });

    it("filters pages by input value", () => {
        (view as any).pages = [makePage({ slug: "a", title: "Alpha" }), makePage({ slug: "b", title: "Beta" })];
        const filterInput = (view as any).filterInput as MockElement;
        filterInput.value = "alp";
        (view as any).renderList();

        const items = findByClass(listEl, "lilbee-wiki-page-item");
        expect(items.length).toBe(1);
        const texts = collectTexts(items[0]!);
        expect(texts.some((t) => t === "Alpha")).toBe(true);
    });

    it("shows empty state when filter matches nothing", () => {
        (view as any).pages = [makePage({ title: "Alpha" })];
        const filterInput = (view as any).filterInput as MockElement;
        filterInput.value = "zzz";
        (view as any).renderList();

        const empty = listEl.find("lilbee-empty-state");
        expect(empty).not.toBeNull();
    });

    it("shows all pages when filter is empty", () => {
        (view as any).pages = [makePage({ slug: "a", title: "Alpha" }), makePage({ slug: "b", title: "Beta" })];
        const filterInput = (view as any).filterInput as MockElement;
        filterInput.value = "";
        (view as any).renderList();

        const items = findByClass(listEl, "lilbee-wiki-page-item");
        expect(items.length).toBe(2);
    });

    it("no-ops when listEl is null", () => {
        (view as any).listEl = null;
        expect(() => (view as any).renderList()).not.toThrow();
    });

    it("works when filterInput is null (uses empty string fallback)", () => {
        (view as any).filterInput = null;
        (view as any).pages = [makePage()];
        (view as any).renderList();
        const items = findByClass(listEl, "lilbee-wiki-page-item");
        expect(items.length).toBe(1);
    });
});

describe("WikiView.renderPageItem", () => {
    let view: WikiView;
    let plugin: LilbeePlugin;
    let listEl: MockElement;

    beforeEach(async () => {
        plugin = makePlugin();
        view = new WikiView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();
        listEl = (view as any).listEl as MockElement;
    });

    it("renders page type badge", () => {
        (view as any).pages = [makePage({ page_type: "summary" })];
        (view as any).renderList();
        const badges = findByClass(listEl, "lilbee-wiki-type-badge");
        expect(badges.length).toBe(1);
        expect(badges[0]!.textContent).toBe("summary");
    });

    it("adds lilbee-wiki-type-summary class to summary badge", () => {
        (view as any).pages = [makePage({ page_type: "summary" })];
        (view as any).renderList();
        const badges = findByClass(listEl, "lilbee-wiki-type-badge");
        expect(badges[0]!.classList.contains("lilbee-wiki-type-summary")).toBe(true);
    });

    it("adds lilbee-wiki-type-synthesis class to synthesis badge", () => {
        (view as any).pages = [makePage({ page_type: "synthesis" })];
        (view as any).renderList();
        const badges = findByClass(listEl, "lilbee-wiki-type-badge");
        expect(badges[0]!.classList.contains("lilbee-wiki-type-synthesis")).toBe(true);
    });

    it("renders page title", () => {
        (view as any).pages = [makePage({ title: "My Title" })];
        (view as any).renderList();
        const names = findByClass(listEl, "lilbee-task-name");
        expect(names[0]!.textContent).toBe("My Title");
    });

    it("renders sources count", () => {
        (view as any).pages = [makePage({ source_count: 3 })];
        (view as any).renderList();
        const meta = findByClass(listEl, "lilbee-wiki-meta");
        const texts = collectTexts(meta[0]!);
        expect(texts.some((t) => t === "3 sources")).toBe(true);
    });

    it("renders timestamp for page", () => {
        (view as any).pages = [makePage({ source_count: 2 })];
        (view as any).renderList();
        const times = findByClass(listEl, "lilbee-task-time");
        expect(times.length).toBe(1);
    });

    it("adds active class when page is selected", () => {
        const page = makePage({ slug: "selected-slug" });
        (view as any).selectedSlug = "selected-slug";
        (view as any).pages = [page];
        (view as any).renderList();
        const items = findByClass(listEl, "lilbee-wiki-page-item");
        expect(items[0]!.classList.contains("active")).toBe(true);
    });

    it("does not add active class when page is not selected", () => {
        (view as any).selectedSlug = "other-slug";
        (view as any).pages = [makePage({ slug: "this-slug" })];
        (view as any).renderList();
        const items = findByClass(listEl, "lilbee-wiki-page-item");
        expect(items[0]!.classList.contains("active")).toBe(false);
    });

    it("click selects page and triggers showPage", async () => {
        const page = makePage({ slug: "click-me" });
        (view as any).pages = [page];
        (view as any).renderList();

        const showPageSpy = vi.spyOn(view as any, "showPage");
        const items = findByClass(listEl, "lilbee-wiki-page-item");
        items[0]!.trigger("click");

        expect((view as any).selectedSlug).toBe("click-me");
        expect(showPageSpy).toHaveBeenCalledWith("click-me");
    });

    it("click re-renders list to update active state", () => {
        const page = makePage({ slug: "click-me" });
        (view as any).pages = [page];
        (view as any).renderList();

        const renderListSpy = vi.spyOn(view as any, "renderList");
        const items = findByClass(listEl, "lilbee-wiki-page-item");
        items[0]!.trigger("click");

        expect(renderListSpy).toHaveBeenCalled();
    });
});

describe("WikiView.showPage", () => {
    let view: WikiView;
    let plugin: LilbeePlugin;
    let detailEl: MockElement;

    beforeEach(async () => {
        plugin = makePlugin();
        view = new WikiView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();
        detailEl = (view as any).detailEl as MockElement;
    });

    it("fetches page detail and renders it", async () => {
        const detail = makePageDetail({ slug: "p1", title: "Page One", content: "Hello world" });
        (plugin.api.wikiPage as ReturnType<typeof vi.fn>).mockResolvedValue(detail);

        await (view as any).showPage("p1");

        expect(plugin.api.wikiPage).toHaveBeenCalledWith("p1");
        const texts = collectTexts(detailEl);
        expect(texts.some((t) => t.includes("Page One"))).toBe(true);
    });

    it("shows error message on fetch failure", async () => {
        (plugin.api.wikiPage as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network"));

        await (view as any).showPage("p1");

        const empty = detailEl.find("lilbee-empty-state");
        expect(empty).not.toBeNull();
        expect(empty!.textContent).toBe("Failed to load page.");
    });

    it("removes loading indicator on success", async () => {
        const detail = makePageDetail();
        (plugin.api.wikiPage as ReturnType<typeof vi.fn>).mockResolvedValue(detail);

        await (view as any).showPage("p1");

        const loading = detailEl.find("lilbee-loading");
        expect(loading).toBeNull();
    });

    it("removes loading indicator on failure", async () => {
        (plugin.api.wikiPage as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("err"));

        await (view as any).showPage("p1");

        const loading = detailEl.find("lilbee-loading");
        expect(loading).toBeNull();
    });

    it("no-ops when detailEl is null", async () => {
        (view as any).detailEl = null;
        await expect((view as any).showPage("p1")).resolves.toBeUndefined();
        expect(plugin.api.wikiPage).not.toHaveBeenCalled();
    });
});

describe("WikiView.renderDetail", () => {
    let view: WikiView;
    let plugin: LilbeePlugin;
    let detailEl: MockElement;

    beforeEach(async () => {
        plugin = makePlugin();
        view = new WikiView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();
        detailEl = (view as any).detailEl as MockElement;
    });

    it("renders metadata header with title and date", () => {
        const detail = makePageDetail({
            title: "My Page",
        });
        (view as any).renderDetail(detail);

        const texts = collectTexts(detailEl);
        expect(texts.some((t) => t === "My Page")).toBe(true);
    });

    it("renders markdown content", () => {
        const detail = makePageDetail({ content: "# Hello\nWorld" });
        (view as any).renderDetail(detail);

        const contentDiv = detailEl.find("lilbee-wiki-content");
        expect(contentDiv).not.toBeNull();
        const texts = collectTexts(contentDiv!);
        expect(texts.some((t) => t.includes("Hello"))).toBe(true);
    });

    it("no-ops when detailEl is null", () => {
        (view as any).detailEl = null;
        expect(() => (view as any).renderDetail(makePageDetail())).not.toThrow();
    });

    describe("wikilink click handling", () => {
        it("navigates to matching wiki page by slug", () => {
            const pages = [makePage({ slug: "linked-page", title: "Linked Page" })];
            (view as any).pages = pages;
            (view as any).renderDetail(makePageDetail());

            const contentDiv = detailEl.find("lilbee-wiki-content")!;
            const showPageSpy = vi.spyOn(view as any, "showPage");
            const renderListSpy = vi.spyOn(view as any, "renderList");

            const mockEvent = {
                target: {
                    closest: (selector: string) => {
                        if (selector === "a.internal-link") {
                            return {
                                getAttribute: (attr: string) => (attr === "data-href" ? "linked-page" : null),
                                textContent: "Linked Page",
                            };
                        }
                        return null;
                    },
                } as unknown as HTMLElement,
                preventDefault: vi.fn(),
            };

            contentDiv.trigger("click", mockEvent);

            expect(mockEvent.preventDefault).toHaveBeenCalled();
            expect((view as any).selectedSlug).toBe("linked-page");
            expect(renderListSpy).toHaveBeenCalled();
            expect(showPageSpy).toHaveBeenCalledWith("linked-page");
        });

        it("navigates to matching wiki page by title", () => {
            const pages = [makePage({ slug: "my-slug", title: "My Title" })];
            (view as any).pages = pages;
            (view as any).renderDetail(makePageDetail());

            const contentDiv = detailEl.find("lilbee-wiki-content")!;
            const showPageSpy = vi.spyOn(view as any, "showPage");

            const mockEvent = {
                target: {
                    closest: (selector: string) => {
                        if (selector === "a.internal-link") {
                            return {
                                getAttribute: () => null,
                                textContent: "My Title",
                            };
                        }
                        return null;
                    },
                } as unknown as HTMLElement,
                preventDefault: vi.fn(),
            };

            contentDiv.trigger("click", mockEvent);

            expect((view as any).selectedSlug).toBe("my-slug");
            expect(showPageSpy).toHaveBeenCalledWith("my-slug");
        });

        it("falls back to openLinkText for non-wiki links", () => {
            (view as any).pages = [];
            (view as any).renderDetail(makePageDetail());

            const contentDiv = detailEl.find("lilbee-wiki-content")!;

            const mockEvent = {
                target: {
                    closest: (selector: string) => {
                        if (selector === "a.internal-link") {
                            return {
                                getAttribute: (attr: string) => (attr === "data-href" ? "some-vault-file" : null),
                                textContent: "Some Vault File",
                            };
                        }
                        return null;
                    },
                } as unknown as HTMLElement,
                preventDefault: vi.fn(),
            };

            contentDiv.trigger("click", mockEvent);

            expect(mockEvent.preventDefault).toHaveBeenCalled();
            expect(view.app.workspace.openLinkText).toHaveBeenCalledWith("some-vault-file", "");
        });

        it("uses textContent when data-href is null", () => {
            (view as any).pages = [];
            (view as any).renderDetail(makePageDetail());

            const contentDiv = detailEl.find("lilbee-wiki-content")!;

            const mockEvent = {
                target: {
                    closest: (selector: string) => {
                        if (selector === "a.internal-link") {
                            return {
                                getAttribute: () => null,
                                textContent: "fallback-text",
                            };
                        }
                        return null;
                    },
                } as unknown as HTMLElement,
                preventDefault: vi.fn(),
            };

            contentDiv.trigger("click", mockEvent);

            expect(view.app.workspace.openLinkText).toHaveBeenCalledWith("fallback-text", "");
        });

        it("uses empty string when both data-href and textContent are null", () => {
            (view as any).pages = [];
            (view as any).renderDetail(makePageDetail());

            const contentDiv = detailEl.find("lilbee-wiki-content")!;

            const mockEvent = {
                target: {
                    closest: (selector: string) => {
                        if (selector === "a.internal-link") {
                            return {
                                getAttribute: () => null,
                                textContent: null,
                            };
                        }
                        return null;
                    },
                } as unknown as HTMLElement,
                preventDefault: vi.fn(),
            };

            contentDiv.trigger("click", mockEvent);

            expect(view.app.workspace.openLinkText).toHaveBeenCalledWith("", "");
        });

        it("does nothing when click target is not a link", () => {
            (view as any).renderDetail(makePageDetail());

            const contentDiv = detailEl.find("lilbee-wiki-content")!;

            const mockEvent = {
                target: {
                    closest: () => null,
                } as unknown as HTMLElement,
                preventDefault: vi.fn(),
            };

            contentDiv.trigger("click", mockEvent);

            expect(mockEvent.preventDefault).not.toHaveBeenCalled();
        });
    });

    describe("citation footnote click handling", () => {
        it("opens CitationModal on #^src footnote click", async () => {
            const { CitationModal } = await import("../../src/views/citation-modal");
            (view as any).selectedSlug = "my-page";
            (view as any).renderDetail(makePageDetail());

            const contentDiv = detailEl.find("lilbee-wiki-content")!;

            const mockEvent = {
                target: {
                    closest: (selector: string) => {
                        if (selector === "a.internal-link") return null;
                        if (selector === "a[href^='#^src'], a[href^='#fn']") {
                            return { getAttribute: () => "#^src-1" };
                        }
                        return null;
                    },
                } as unknown as HTMLElement,
                preventDefault: vi.fn(),
            };

            contentDiv.trigger("click", mockEvent);

            expect(mockEvent.preventDefault).toHaveBeenCalled();
            expect(CitationModal).toHaveBeenCalled();
        });

        it("opens CitationModal on #fn footnote click", async () => {
            const { CitationModal } = await import("../../src/views/citation-modal");
            (CitationModal as ReturnType<typeof vi.fn>).mockClear();

            (view as any).selectedSlug = "my-page";
            (view as any).renderDetail(makePageDetail());

            const contentDiv = detailEl.find("lilbee-wiki-content")!;

            const mockEvent = {
                target: {
                    closest: (selector: string) => {
                        if (selector === "a.internal-link") return null;
                        if (selector === "a[href^='#^src'], a[href^='#fn']") {
                            return { getAttribute: () => "#fn-1" };
                        }
                        return null;
                    },
                } as unknown as HTMLElement,
                preventDefault: vi.fn(),
            };

            contentDiv.trigger("click", mockEvent);

            expect(CitationModal).toHaveBeenCalled();
        });

        it("does not open CitationModal for non-footnote clicks", async () => {
            const { CitationModal } = await import("../../src/views/citation-modal");
            (CitationModal as ReturnType<typeof vi.fn>).mockClear();

            (view as any).renderDetail(makePageDetail());

            const contentDiv = detailEl.find("lilbee-wiki-content")!;

            const mockEvent = {
                target: {
                    closest: () => null,
                } as unknown as HTMLElement,
                preventDefault: vi.fn(),
            };

            contentDiv.trigger("click", mockEvent);

            expect(CitationModal).not.toHaveBeenCalled();
        });
    });
});

describe("WikiView handles missing created_at", () => {
    let view: WikiView;
    let plugin: LilbeePlugin;
    let listEl: MockElement;

    beforeEach(async () => {
        plugin = makePlugin();
        view = new WikiView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();
        listEl = (view as any).listEl as MockElement;
    });

    it("does not render time span when page.created_at is null", () => {
        (view as any).pages = [makePage({ created_at: null })];
        (view as any).renderList();
        const times = findByClass(listEl, "lilbee-task-time");
        expect(times.length).toBe(0);
    });

    it("does not render date span in detail when page.created_at is null", () => {
        const detail = makePageDetail({ created_at: null });
        const detailEl = (view as any).detailEl as MockElement;
        (view as any).renderDetail(detail);
        const meta = findByClass(detailEl, "lilbee-wiki-meta");
        // Should have the strong (title) but no date span
        const spans = meta[0]!.children.filter((c: MockElement) => c.tagName === "SPAN");
        expect(spans.length).toBe(0);
    });
});

describe("relativeTime via renderPageItem timestamps", () => {
    let view: WikiView;
    let plugin: LilbeePlugin;
    let listEl: MockElement;

    beforeEach(async () => {
        plugin = makePlugin();
        view = new WikiView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();
        listEl = (view as any).listEl as MockElement;
    });

    it("shows 'just now' for recent timestamps", () => {
        (view as any).pages = [makePage({ created_at: new Date().toISOString() })];
        (view as any).renderList();
        const times = findByClass(listEl, "lilbee-task-time");
        expect(times[0]!.textContent).toBe("just now");
    });

    it("shows minutes for timestamps minutes ago", () => {
        const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        (view as any).pages = [makePage({ created_at: fiveMinAgo })];
        (view as any).renderList();
        const times = findByClass(listEl, "lilbee-task-time");
        expect(times[0]!.textContent).toBe("5m ago");
    });

    it("shows hours for timestamps hours ago", () => {
        const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
        (view as any).pages = [makePage({ created_at: threeHoursAgo })];
        (view as any).renderList();
        const times = findByClass(listEl, "lilbee-task-time");
        expect(times[0]!.textContent).toBe("3h ago");
    });

    it("shows days for timestamps days ago", () => {
        const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
        (view as any).pages = [makePage({ created_at: twoDaysAgo })];
        (view as any).renderList();
        const times = findByClass(listEl, "lilbee-task-time");
        expect(times[0]!.textContent).toBe("2d ago");
    });
});

function makeStub(overrides: Partial<WikiStub> = {}): WikiStub {
    return {
        slug: "titan",
        label: "Titan",
        kind: "entity",
        type_hint: "LOC",
        mentions: 4,
        sources: ["corpus/Saturn.txt"],
        ...overrides,
    };
}

describe("WikiView unwritten subjects", () => {
    beforeEach(() => {
        mockConfirmResult = true;
    });

    it("lists entities under Entities, not under Concepts", async () => {
        const plugin = makePlugin();
        (plugin.api.wikiList as ReturnType<typeof vi.fn>).mockResolvedValue([
            makePage({ slug: "concepts/orbit", title: "Orbit", page_type: "concept" }),
            makePage({ slug: "entities/saturn", title: "Saturn", page_type: "entity" }),
        ]);
        const view = new WikiView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        const headers = (view.contentEl as unknown as MockElement)
            .findAll("lilbee-tasks-section-header")
            .map((h) => h.textContent);
        expect(headers).toContain("Concepts");
        expect(headers).toContain("Entities");
    });

    it("shows an unwritten subject, marked as not written", async () => {
        const plugin = makePlugin();
        (plugin.api.wikiStubs as ReturnType<typeof vi.fn>).mockResolvedValue([makeStub()]);
        const view = new WikiView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        const el = view.contentEl as unknown as MockElement;
        expect(el.findAll("lilbee-wiki-stub").length).toBe(1);
        const texts = el.findAll("lilbee-wiki-stub-hint").map((h) => h.textContent);
        expect(texts).toContain("not written yet");
        expect(el.findAll("lilbee-tasks-section-header").map((h) => h.textContent)).toContain("Not written yet (1)");
    });

    it("writes the page when the offer is accepted, then opens it", async () => {
        const plugin = makePlugin();
        (plugin.api.wikiStubs as ReturnType<typeof vi.fn>).mockResolvedValue([makeStub()]);
        (plugin.api.wikiGenerate as ReturnType<typeof vi.fn>).mockImplementation(
            generateStream({ slug: "entities/titan", path: "/w/entities/titan.md" }),
        );
        const view = new WikiView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        (view.contentEl as unknown as MockElement).findAll("lilbee-wiki-stub")[0].trigger("click");
        await tick();
        await tick();

        expect(plugin.api.wikiGenerate).toHaveBeenCalledWith("titan");
        expect(plugin.api.wikiPage).toHaveBeenCalledWith("entities/titan");
    });

    it("writes nothing when the offer is declined", async () => {
        mockConfirmResult = false;
        const plugin = makePlugin();
        (plugin.api.wikiStubs as ReturnType<typeof vi.fn>).mockResolvedValue([makeStub()]);
        const view = new WikiView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        (view.contentEl as unknown as MockElement).findAll("lilbee-wiki-stub")[0].trigger("click");
        await tick();

        expect(plugin.api.wikiGenerate).not.toHaveBeenCalled();
    });

    it("keeps the written pages when the stubs route is unavailable", async () => {
        const plugin = makePlugin();
        (plugin.api.wikiList as ReturnType<typeof vi.fn>).mockResolvedValue([makePage()]);
        (plugin.api.wikiStubs as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("nope"));
        const view = new WikiView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        const el = view.contentEl as unknown as MockElement;
        expect(el.findAll("lilbee-wiki-page-item").length).toBe(1);
        expect(el.findAll("lilbee-wiki-stub").length).toBe(0);
    });

    it("refuses a second write while one is already running", async () => {
        const plugin = makePlugin();
        (plugin.api.wikiStubs as ReturnType<typeof vi.fn>).mockResolvedValue([makeStub()]);
        // Hold the stream open between events so the write stays in flight.
        let release: (v: unknown) => void = () => {};
        const held = new Promise((r) => {
            release = r;
        });
        (plugin.api.wikiGenerate as ReturnType<typeof vi.fn>).mockImplementation(() =>
            (async function* () {
                yield { event: "wiki_phase", data: { phase: "generate", total: 1 } };
                await held;
                yield { event: "done", data: { slug: "entities/titan", path: "/w/t.md" } };
            })(),
        );
        const view = new WikiView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        const el = view.contentEl as unknown as MockElement;
        el.findAll("lilbee-wiki-stub")[0].trigger("click");
        await tick();
        // The row now reads as busy, and a second click is ignored.
        expect(el.findAll("lilbee-wiki-stub-hint").map((h) => h.textContent)).toContain("writing...");
        el.findAll("lilbee-wiki-stub")[0].trigger("click");
        await tick();
        expect(plugin.api.wikiGenerate).toHaveBeenCalledTimes(1);
        release(null);
    });

    it("surfaces a failed write and clears the busy state", async () => {
        const plugin = makePlugin();
        (plugin.api.wikiStubs as ReturnType<typeof vi.fn>).mockResolvedValue([makeStub()]);
        (plugin.api.wikiGenerate as ReturnType<typeof vi.fn>).mockImplementation(
            generateStream(null, { fail: new Error("gpu busy") }),
        );
        const view = new WikiView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        const el = view.contentEl as unknown as MockElement;
        el.findAll("lilbee-wiki-stub")[0].trigger("click");
        await tick();
        await tick();

        expect(el.findAll("lilbee-wiki-stub-hint").map((h) => h.textContent)).toContain("not written yet");
    });
});

describe("WikiView filtering with unwritten subjects", () => {
    beforeEach(() => {
        mockConfirmResult = true;
    });

    it("filters unwritten subjects too, since that is how you find one", async () => {
        const plugin = makePlugin();
        (plugin.api.wikiList as ReturnType<typeof vi.fn>).mockResolvedValue([
            makePage({ slug: "entities/saturn", title: "Saturn", page_type: "entity" }),
        ]);
        (plugin.api.wikiStubs as ReturnType<typeof vi.fn>).mockResolvedValue([
            makeStub({ slug: "titan", label: "Titan" }),
            makeStub({ slug: "rhea", label: "Rhea" }),
        ]);
        const view = new WikiView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        const el = view.contentEl as unknown as MockElement;
        const input = el.find("lilbee-wiki-search")!;
        input.value = "titan";
        input.trigger("input");

        const stubs = el.findAll("lilbee-wiki-stub");
        expect(stubs.length).toBe(1);
        expect(stubs[0].textContent).toContain("Titan");
        // The written page does not match "titan", so only the offer remains.
        expect(el.findAll("lilbee-wiki-page-item").length).toBe(1);
    });

    it("falls back to the slug when a subject carries no label", async () => {
        const plugin = makePlugin();
        (plugin.api.wikiStubs as ReturnType<typeof vi.fn>).mockResolvedValue([
            makeStub({ slug: "gas-giant", label: "" }),
        ]);
        const view = new WikiView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        const el = view.contentEl as unknown as MockElement;
        expect(el.findAll("lilbee-wiki-stub")[0].textContent).toContain("gas-giant");

        const input = el.find("lilbee-wiki-search")!;
        input.value = "gas";
        input.trigger("input");
        expect(el.findAll("lilbee-wiki-stub").length).toBe(1);
    });

    it("says there is nothing when neither pages nor offers match", async () => {
        const plugin = makePlugin();
        (plugin.api.wikiStubs as ReturnType<typeof vi.fn>).mockResolvedValue([makeStub()]);
        const view = new WikiView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        const el = view.contentEl as unknown as MockElement;
        const input = el.find("lilbee-wiki-search")!;
        input.value = "zzzz";
        input.trigger("input");

        expect(el.findAll("lilbee-empty-state").length).toBe(1);
    });
});

describe("WikiView cross-links", () => {
    function linkPages(): WikiPage[] {
        return [
            makePage({ slug: "entities/jupiter", title: "Jupiter", page_type: "entity" }),
            makePage({ slug: "concepts/orbit", title: "Orbit", page_type: "concept" }),
        ];
    }

    async function openWith(plugin: LilbeePlugin) {
        const view = new WikiView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();
        return view;
    }

    it("resolves a bare-subject link to the page whose slug ends with it", async () => {
        // Generated pages link each other as [[jupiter]] while the slug is
        // entities/jupiter. Matching only the full slug sent every cross-link to
        // openLinkText and navigated out of the wiki.
        const plugin = makePlugin();
        (plugin.api.wikiList as ReturnType<typeof vi.fn>).mockResolvedValue(linkPages());
        const view = await openWith(plugin);

        expect((view as any).resolveWikiLink("jupiter")?.slug).toBe("entities/jupiter");
        expect(plugin.app.workspace.openLinkText).not.toHaveBeenCalled();
    });

    it("matches the title regardless of case", async () => {
        const plugin = makePlugin();
        (plugin.api.wikiList as ReturnType<typeof vi.fn>).mockResolvedValue(linkPages());
        const view = await openWith(plugin);
        expect((view as any).resolveWikiLink("JUPITER")?.slug).toBe("entities/jupiter");
        expect((view as any).resolveWikiLink("Orbit")?.slug).toBe("concepts/orbit");
    });

    it("still resolves a full slug", async () => {
        const plugin = makePlugin();
        (plugin.api.wikiList as ReturnType<typeof vi.fn>).mockResolvedValue(linkPages());
        const view = await openWith(plugin);
        expect((view as any).resolveWikiLink("entities/jupiter")?.slug).toBe("entities/jupiter");
    });

    it("returns nothing for a link that names no page, so the vault fallback still runs", async () => {
        const plugin = makePlugin();
        (plugin.api.wikiList as ReturnType<typeof vi.fn>).mockResolvedValue(linkPages());
        const view = await openWith(plugin);
        expect((view as any).resolveWikiLink("pluto")).toBeUndefined();
        expect((view as any).resolveWikiLink("   ")).toBeUndefined();
    });
});

describe("WikiView reports generation in the Task Centre", () => {
    beforeEach(() => {
        mockConfirmResult = true;
    });

    it("enqueues a wiki task and completes it", async () => {
        const plugin = makePlugin();
        (plugin.api.wikiStubs as ReturnType<typeof vi.fn>).mockResolvedValue([makeStub()]);
        (plugin.api.wikiGenerate as ReturnType<typeof vi.fn>).mockImplementation(
            generateStream({ slug: "entities/titan", path: "/w/t.md" }),
        );
        const view = new WikiView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        (view.contentEl as unknown as MockElement).findAll("lilbee-wiki-stub")[0].trigger("click");
        await tick();
        await tick();

        expect(plugin.taskQueue.enqueue).toHaveBeenCalledWith("Write Titan", "wiki");
        expect(plugin.taskQueue.complete).toHaveBeenCalledWith("task-1");
        expect(plugin.taskQueue.fail).not.toHaveBeenCalled();
    });

    it("fails the task when the write fails", async () => {
        const plugin = makePlugin();
        (plugin.api.wikiStubs as ReturnType<typeof vi.fn>).mockResolvedValue([makeStub()]);
        (plugin.api.wikiGenerate as ReturnType<typeof vi.fn>).mockImplementation(
            generateStream(null, { fail: new Error("gpu busy") }),
        );
        const view = new WikiView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        (view.contentEl as unknown as MockElement).findAll("lilbee-wiki-stub")[0].trigger("click");
        await tick();
        await tick();

        expect(plugin.taskQueue.fail).toHaveBeenCalledWith("task-1", "gpu busy");
        expect(plugin.taskQueue.complete).not.toHaveBeenCalled();
    });

    it("does not write when the queue is full", async () => {
        const plugin = makePlugin();
        (plugin.taskQueue.enqueue as ReturnType<typeof vi.fn>).mockReturnValue(null);
        (plugin.api.wikiStubs as ReturnType<typeof vi.fn>).mockResolvedValue([makeStub()]);
        const view = new WikiView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        (view.contentEl as unknown as MockElement).findAll("lilbee-wiki-stub")[0].trigger("click");
        await tick();

        expect(plugin.api.wikiGenerate).not.toHaveBeenCalled();
    });
});

describe("WikiView opens the page it just wrote", () => {
    beforeEach(() => {
        mockConfirmResult = true;
    });

    it("opens the slug the done event carries, not the one it asked for", async () => {
        // The caller asks by bare slug; pages are addressed by section. The
        // done event is the only place the read-route slug appears, so opening
        // anything else is a 404 for the page just written.
        const plugin = makePlugin();
        (plugin.api.wikiStubs as ReturnType<typeof vi.fn>).mockResolvedValue([
            makeStub({ slug: "cassini", label: "Cassini" }),
        ]);
        (plugin.api.wikiGenerate as ReturnType<typeof vi.fn>).mockImplementation(
            generateStream({ slug: "entities/cassini", path: "/w/entities/cassini.md" }),
        );
        (plugin.api.wikiList as ReturnType<typeof vi.fn>)
            .mockResolvedValueOnce([])
            .mockResolvedValue([makePage({ slug: "entities/cassini", title: "Cassini", page_type: "entity" })]);

        const view = new WikiView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();
        (view.contentEl as unknown as MockElement).findAll("lilbee-wiki-stub")[0].trigger("click");
        await tick();
        await tick();

        expect(plugin.api.wikiGenerate).toHaveBeenCalledWith("cassini");
        expect(plugin.api.wikiPage).toHaveBeenCalledWith("entities/cassini");
    });
});

describe("WikiView reports the write as indeterminate", () => {
    beforeEach(() => {
        mockConfirmResult = true;
    });

    it("marks the task indeterminate rather than leaving it at zero percent", async () => {
        // The generate route answers once, at the end, so there is no phase to
        // report. A percentage bar would sit at 0 for the whole model call and
        // read as hung; the Task Centre draws an indeterminate bar below zero.
        const plugin = makePlugin();
        (plugin.api.wikiStubs as ReturnType<typeof vi.fn>).mockResolvedValue([
            makeStub({ slug: "cassini", label: "Cassini" }),
        ]);
        (plugin.api.wikiGenerate as ReturnType<typeof vi.fn>).mockImplementation(
            generateStream({ slug: "entities/cassini", path: "/w/entities/cassini.md" }),
        );

        const view = new WikiView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();
        (view.contentEl as unknown as MockElement).findAll("lilbee-wiki-stub")[0].trigger("click");
        await tick();
        await tick();

        expect(plugin.taskQueue.update).toHaveBeenCalledWith("task-1", INDETERMINATE_PROGRESS, expect.any(String));
        // and it is set before the call is awaited, not after it returns
        const updateOrder = (plugin.taskQueue.update as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
        const completeOrder = (plugin.taskQueue.complete as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
        expect(updateOrder).toBeLessThan(completeOrder);
    });
});

describe("WikiView detail pane under overlapping renders", () => {
    it("renders only the newest page when two loads overlap", async () => {
        // refresh() starts a load for the selected page without awaiting it, so
        // selecting another page in the same tick leaves two loads in flight.
        // Both empty the pane before their await and render after it, which
        // stacked both articles in the pane.
        const plugin = makePlugin();
        const resolvers: Array<(p: WikiPageDetail) => void> = [];
        (plugin.api.wikiPage as ReturnType<typeof vi.fn>).mockImplementation(
            () => new Promise<WikiPageDetail>((res) => resolvers.push(res)),
        );

        const view = new WikiView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        const showPage = (view as unknown as { showPage: (s: string) => Promise<void> }).showPage.bind(view);
        const first = showPage("entities/sun");
        const second = showPage("entities/amazonis-planitia");

        // The stale load lands last, which is the ordering that produced the bug.
        resolvers[1](makePageDetail({ slug: "entities/amazonis-planitia", title: "Amazonis Planitia" }));
        resolvers[0](makePageDetail({ slug: "entities/sun", title: "Sun" }));
        await Promise.all([first, second]);
        await tick();

        const titles = (view.contentEl as unknown as MockElement)
            .findAll("lilbee-wiki-meta")
            .map((el) => el.textContent);
        expect(titles.filter((t) => t?.includes("Sun"))).toHaveLength(0);
        expect(titles.filter((t) => t?.includes("Amazonis Planitia"))).toHaveLength(1);
    });
});

describe("WikiView detail pane when a stale load fails", () => {
    it("keeps the newest page when an older overlapping load rejects", async () => {
        // The losing load can fail rather than resolve — a refresh for a page
        // that has since been pruned, say. Its error must not replace the page
        // the user is actually looking at.
        const plugin = makePlugin();
        let rejectFirst: (e: Error) => void = () => {};
        let resolveSecond: (p: WikiPageDetail) => void = () => {};
        (plugin.api.wikiPage as ReturnType<typeof vi.fn>)
            .mockImplementationOnce(() => new Promise<WikiPageDetail>((_, rej) => (rejectFirst = rej)))
            .mockImplementationOnce(() => new Promise<WikiPageDetail>((res) => (resolveSecond = res)));

        const view = new WikiView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        const showPage = (view as unknown as { showPage: (s: string) => Promise<void> }).showPage.bind(view);
        const first = showPage("entities/pruned");
        const second = showPage("entities/amazonis-planitia");

        resolveSecond(makePageDetail({ slug: "entities/amazonis-planitia", title: "Amazonis Planitia" }));
        rejectFirst(new Error("gone"));
        await Promise.all([first, second]);
        await tick();

        const detail = (view.contentEl as unknown as MockElement).find("lilbee-wiki-detail")!;
        expect(collectTexts(detail).some((t) => t.includes("Amazonis Planitia"))).toBe(true);
        expect(detail.findAll("lilbee-empty-state")).toHaveLength(0);
    });
});

describe("WikiView writes the generated page into the vault", () => {
    beforeEach(() => {
        mockConfirmResult = true;
    });

    it("syncs the new page to the vault when wiki sync is on", async () => {
        // Only a full reconcile used to write pages out, so a page written here
        // was missing from the vault until the next one.
        const plugin = makePlugin();
        (plugin as unknown as { wikiSync: { writePage: ReturnType<typeof vi.fn> } }).wikiSync = {
            writePage: vi.fn().mockResolvedValue(undefined),
        };
        (plugin.api.wikiStubs as ReturnType<typeof vi.fn>).mockResolvedValue([
            makeStub({ slug: "cassini", label: "Cassini" }),
        ]);
        (plugin.api.wikiGenerate as ReturnType<typeof vi.fn>).mockImplementation(
            generateStream({ slug: "entities/cassini", path: "/w/entities/cassini.md" }),
        );
        (plugin.api.wikiList as ReturnType<typeof vi.fn>)
            .mockResolvedValueOnce([])
            .mockResolvedValue([makePage({ slug: "entities/cassini", title: "Cassini", page_type: "entity" })]);

        const view = new WikiView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();
        (view.contentEl as unknown as MockElement).findAll("lilbee-wiki-stub")[0].trigger("click");
        await tick();
        await tick();

        const sync = (plugin as unknown as { wikiSync: { writePage: ReturnType<typeof vi.fn> } }).wikiSync;
        expect(sync.writePage).toHaveBeenCalledWith("entities/cassini");
    });

    it("still opens the page when the vault write fails", async () => {
        const plugin = makePlugin();
        (plugin as unknown as { wikiSync: { writePage: ReturnType<typeof vi.fn> } }).wikiSync = {
            writePage: vi.fn().mockRejectedValue(new Error("read-only vault")),
        };
        (plugin.api.wikiStubs as ReturnType<typeof vi.fn>).mockResolvedValue([
            makeStub({ slug: "cassini", label: "Cassini" }),
        ]);
        (plugin.api.wikiGenerate as ReturnType<typeof vi.fn>).mockImplementation(
            generateStream({ slug: "entities/cassini", path: "/w/entities/cassini.md" }),
        );
        (plugin.api.wikiList as ReturnType<typeof vi.fn>)
            .mockResolvedValueOnce([])
            .mockResolvedValue([makePage({ slug: "entities/cassini", title: "Cassini", page_type: "entity" })]);

        const view = new WikiView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();
        (view.contentEl as unknown as MockElement).findAll("lilbee-wiki-stub")[0].trigger("click");
        await tick();
        await tick();

        expect(plugin.api.wikiPage).toHaveBeenCalledWith("entities/cassini");
    });
});

describe("WikiView generate stream handling", () => {
    beforeEach(() => {
        mockConfirmResult = true;
    });

    it("the mock's events match the client's SSEEvent shape", async () => {
        // These tests are not typechecked, so a mock that yields the wrong
        // field name makes every branch it feeds look covered while being dead.
        // The view switches on `event`; pin that here rather than trusting it.
        const stream = generateStream({ slug: "entities/x", path: "/w/x.md" })();
        const first = (await stream.next()).value as Record<string, unknown>;
        expect(Object.keys(first).sort()).toEqual(["data", "event"]);
    });

    it("fails the task when the run reports an error mid-stream", async () => {
        // A stale index entry surfaces as an error event rather than a status
        // code, because the run discovers it after the stream has opened.
        const plugin = makePlugin();
        (plugin.api.wikiStubs as ReturnType<typeof vi.fn>).mockResolvedValue([
            makeStub({ slug: "cassini", label: "Cassini" }),
        ]);
        (plugin.api.wikiGenerate as ReturnType<typeof vi.fn>).mockImplementation(() =>
            (async function* () {
                yield { event: "wiki_phase", data: { phase: "generate", total: 1 } };
                yield { event: "error", data: "index entry for cassini is stale" };
            })(),
        );

        const view = new WikiView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();
        (view.contentEl as unknown as MockElement).findAll("lilbee-wiki-stub")[0].trigger("click");
        await tick();
        await tick();

        expect(plugin.taskQueue.fail).toHaveBeenCalledWith("task-1", expect.stringContaining("stale"));
        expect(plugin.taskQueue.complete).not.toHaveBeenCalled();
    });

    it("fails the task when the stream ends without a done event", async () => {
        const plugin = makePlugin();
        (plugin.api.wikiStubs as ReturnType<typeof vi.fn>).mockResolvedValue([
            makeStub({ slug: "cassini", label: "Cassini" }),
        ]);
        (plugin.api.wikiGenerate as ReturnType<typeof vi.fn>).mockImplementation(() =>
            (async function* () {
                yield { event: "wiki_phase", data: { phase: "generate", total: 1 } };
            })(),
        );

        const view = new WikiView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();
        (view.contentEl as unknown as MockElement).findAll("lilbee-wiki-stub")[0].trigger("click");
        await tick();
        await tick();

        expect(plugin.taskQueue.fail).toHaveBeenCalled();
        expect(plugin.api.wikiPage).not.toHaveBeenCalled();
    });
});

describe("WikiView page loading is forgiving of a just-written page", () => {
    it("retries once when the first read misses, and shows the page", async () => {
        // A page read straight after it was written can briefly not be served.
        // Surfacing that as "Failed to load page" strands the user on the page
        // they just asked for.
        const plugin = makePlugin();
        (plugin.api.wikiPage as ReturnType<typeof vi.fn>)
            .mockRejectedValueOnce(new Error("Server responded 404: "))
            .mockResolvedValue(makePageDetail({ slug: "entities/cassini", title: "Cassini" }));

        const view = new WikiView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();
        await (view as unknown as { showPage: (s: string) => Promise<void> }).showPage("entities/cassini");

        expect(plugin.api.wikiPage).toHaveBeenCalledTimes(2);
        const detail = (view.contentEl as unknown as MockElement).find("lilbee-wiki-detail")!;
        expect(collectTexts(detail).some((t) => t.includes("Cassini"))).toBe(true);
    });

    it("reports the failure when both reads miss", async () => {
        const plugin = makePlugin();
        (plugin.api.wikiPage as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Server responded 404: "));

        const view = new WikiView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();
        await (view as unknown as { showPage: (s: string) => Promise<void> }).showPage("entities/gone");

        expect(plugin.api.wikiPage).toHaveBeenCalledTimes(2);
        const detail = (view.contentEl as unknown as MockElement).find("lilbee-wiki-detail")!;
        expect(detail.findAll("lilbee-empty-state").length).toBeGreaterThan(0);
    });
});

describe("WikiView drops a stale failure", () => {
    it("does not blank the current page when an older load finally fails", async () => {
        // Both attempts of the losing load fail, and by the time it gives up the
        // newer page is already on screen. Its error must not replace it.
        const plugin = makePlugin();
        (plugin.api.wikiPage as ReturnType<typeof vi.fn>).mockImplementation((slug: string) =>
            slug === "entities/gone"
                ? Promise.reject(new Error("Server responded 404: "))
                : Promise.resolve(makePageDetail({ slug, title: "Amazonis Planitia" })),
        );

        const view = new WikiView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();
        const showPage = (view as unknown as { showPage: (s: string) => Promise<void> }).showPage.bind(view);
        const losing = showPage("entities/gone");
        await showPage("entities/amazonis-planitia");
        await losing;

        const detail = (view.contentEl as unknown as MockElement).find("lilbee-wiki-detail")!;
        expect(collectTexts(detail).some((t) => t.includes("Amazonis Planitia"))).toBe(true);
        expect(detail.findAll("lilbee-empty-state")).toHaveLength(0);
    });
});
