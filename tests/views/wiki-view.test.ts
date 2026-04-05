import { vi, describe, it, expect, beforeEach } from "vitest";
import { WorkspaceLeaf, MockElement } from "../__mocks__/obsidian";
import { WikiView, VIEW_TYPE_WIKI } from "../../src/views/wiki-view";
import type LilbeePlugin from "../../src/main";
import type { WikiPage, WikiPageDetail } from "../../src/types";

vi.mock("../../src/views/citation-modal", () => ({
    CitationModal: vi.fn().mockImplementation(() => ({
        open: vi.fn(),
    })),
}));

const tick = () => new Promise((r) => setTimeout(r, 0));

function makeLeaf(): WorkspaceLeaf {
    return new WorkspaceLeaf();
}

function makePlugin(): LilbeePlugin {
    return {
        api: {
            wikiList: vi.fn().mockResolvedValue([]),
            wikiPage: vi.fn().mockResolvedValue({} as WikiPageDetail),
        },
        runWikiLint: vi.fn(),
        app: {
            workspace: { openLinkText: vi.fn() },
        },
    } as unknown as LilbeePlugin;
}

function makePage(overrides: Partial<WikiPage> = {}): WikiPage {
    return {
        slug: "test-page",
        title: "Test Page",
        page_type: "summary",
        sources: ["source1.md"],
        faithfulness_score: 0.85,
        generated_by: "gpt-4",
        generated_at: new Date().toISOString(),
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

    it("renders page title", () => {
        (view as any).pages = [makePage({ title: "My Title" })];
        (view as any).renderList();
        const names = findByClass(listEl, "lilbee-task-name");
        expect(names[0]!.textContent).toBe("My Title");
    });

    it("renders sources count", () => {
        (view as any).pages = [makePage({ sources: ["a", "b", "c"] })];
        (view as any).renderList();
        const meta = findByClass(listEl, "lilbee-wiki-meta");
        const texts = collectTexts(meta[0]!);
        expect(texts.some((t) => t === "3 sources")).toBe(true);
    });

    it("renders faithfulness score bar", () => {
        (view as any).pages = [makePage({ faithfulness_score: 0.75 })];
        (view as any).renderList();
        const bars = findByClass(listEl, "lilbee-relevance-bar");
        expect(bars.length).toBe(1);
        expect(bars[0]!.style.width).toBe("75%");
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

    it("renders metadata header with title, generated_by, score, and date", () => {
        const detail = makePageDetail({
            title: "My Page",
            generated_by: "gpt-4",
            faithfulness_score: 0.92,
        });
        (view as any).renderDetail(detail);

        const texts = collectTexts(detailEl);
        expect(texts.some((t) => t === "My Page")).toBe(true);
        expect(texts.some((t) => t.includes("gpt-4"))).toBe(true);
        expect(texts.some((t) => t.includes("92%"))).toBe(true);
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
        (view as any).pages = [makePage({ generated_at: new Date().toISOString() })];
        (view as any).renderList();
        const times = findByClass(listEl, "lilbee-task-time");
        expect(times[0]!.textContent).toBe("just now");
    });

    it("shows minutes for timestamps minutes ago", () => {
        const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        (view as any).pages = [makePage({ generated_at: fiveMinAgo })];
        (view as any).renderList();
        const times = findByClass(listEl, "lilbee-task-time");
        expect(times[0]!.textContent).toBe("5m ago");
    });

    it("shows hours for timestamps hours ago", () => {
        const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
        (view as any).pages = [makePage({ generated_at: threeHoursAgo })];
        (view as any).renderList();
        const times = findByClass(listEl, "lilbee-task-time");
        expect(times[0]!.textContent).toBe("3h ago");
    });

    it("shows days for timestamps days ago", () => {
        const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
        (view as any).pages = [makePage({ generated_at: twoDaysAgo })];
        (view as any).renderList();
        const times = findByClass(listEl, "lilbee-task-time");
        expect(times[0]!.textContent).toBe("2d ago");
    });
});
