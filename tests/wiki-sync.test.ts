import { vi, describe, it, expect, beforeEach } from "vitest";
import {
    WikiSync,
    pageVaultPath,
    buildFileContent,
    isManagedFile,
    MANAGED_MARKER,
    AUTO_GENERATED_COMMENT,
} from "../src/wiki-sync";
import type { LilbeeClient } from "../src/api";
import type { WikiPage, WikiPageDetail } from "../src/types";

const FOLDER = "wiki";

function makePage(overrides: Partial<WikiPage> = {}): WikiPage {
    return {
        slug: "test-page",
        title: "Test Page",
        page_type: "summary",
        sources: ["a.pdf"],
        faithfulness_score: 0.95,
        generated_by: "gpt-4",
        generated_at: "2025-01-01T00:00:00Z",
        ...overrides,
    };
}

function makeDetail(overrides: Partial<WikiPageDetail> = {}): WikiPageDetail {
    return {
        ...makePage(),
        content: "# Hello\n\nSome content.",
        ...overrides,
    };
}

const mockApi = {
    wikiList: vi.fn(),
    wikiPage: vi.fn(),
};

const mockVault = {
    exists: vi.fn(),
    read: vi.fn(),
    write: vi.fn(),
    remove: vi.fn(),
    mkdir: vi.fn(),
    list: vi.fn(),
};

let sync: WikiSync;

beforeEach(() => {
    vi.resetAllMocks();
    sync = new WikiSync(mockApi as unknown as LilbeeClient, mockVault, FOLDER);
});

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

describe("pageVaultPath", () => {
    it("returns summaries subdir for summary page_type", () => {
        const page = makePage({ slug: "foo", page_type: "summary" });
        expect(pageVaultPath(FOLDER, page)).toBe("wiki/summaries/foo.md");
    });

    it("returns concepts subdir for synthesis page_type", () => {
        const page = makePage({ slug: "bar", page_type: "synthesis" });
        expect(pageVaultPath(FOLDER, page)).toBe("wiki/concepts/bar.md");
    });
});

describe("buildFileContent", () => {
    it("produces frontmatter, comment, and content", () => {
        const detail = makeDetail({
            slug: "x",
            generated_by: "gpt-4",
            generated_at: "2025-06-01",
            sources: ["a.pdf", "b.pdf"],
            faithfulness_score: 0.88,
            content: "Body text",
        });
        const result = buildFileContent(detail);

        expect(result).toContain("---");
        expect(result).toContain(MANAGED_MARKER);
        expect(result).toContain("generated_by: gpt-4");
        expect(result).toContain("generated_at: 2025-06-01");
        expect(result).toContain("sources: [a.pdf, b.pdf]");
        expect(result).toContain("faithfulness_score: 0.88");
        expect(result).toContain(AUTO_GENERATED_COMMENT);
        expect(result).toContain("Body text");

        // Verify structure: frontmatter then comment then content
        const lines = result.split("\n");
        expect(lines[0]).toBe("---");
        expect(lines[lines.indexOf("---", 1)]).toBe("---");
        expect(result).toMatch(/---\n.*\n.*\n.*\n.*\n---\n<!-- .* -->\n\nBody text/s);
    });
});

describe("isManagedFile", () => {
    it("returns true when content contains MANAGED_MARKER", () => {
        expect(isManagedFile(`---\n${MANAGED_MARKER}\n---\ntext`)).toBe(true);
    });

    it("returns false when content does not contain MANAGED_MARKER", () => {
        expect(isManagedFile("---\ntitle: foo\n---\ntext")).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// WikiSync.isWikiPath
// ---------------------------------------------------------------------------

describe("isWikiPath", () => {
    it("returns true for paths inside the folder", () => {
        expect(sync.isWikiPath("wiki/summaries/foo.md")).toBe(true);
    });

    it("returns false for paths outside the folder", () => {
        expect(sync.isWikiPath("other/foo.md")).toBe(false);
    });

    it("returns false for paths that start with folder name but no slash", () => {
        expect(sync.isWikiPath("wikiextra/foo.md")).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// WikiSync.reconcile
// ---------------------------------------------------------------------------

describe("reconcile", () => {
    beforeEach(() => {
        // ensureFolders: all directories exist by default
        vi.mocked(mockVault.exists).mockResolvedValue(true);
        // removeStalePages: empty dirs by default
        vi.mocked(mockVault.list).mockResolvedValue({ files: [] });
    });

    it("writes new pages that don't exist on disk", async () => {
        const page = makePage({ slug: "new-page" });
        const detail = makeDetail({ slug: "new-page" });
        vi.mocked(mockApi.wikiList).mockResolvedValue([page]);
        vi.mocked(mockVault.exists).mockImplementation(async (path: string) => {
            if (path === "wiki/summaries/new-page.md") return false;
            return true; // folders exist
        });
        vi.mocked(mockApi.wikiPage).mockResolvedValue(detail);

        const result = await sync.reconcile();

        expect(result.written).toBe(1);
        expect(mockApi.wikiPage).toHaveBeenCalledWith("new-page");
        expect(mockVault.write).toHaveBeenCalledWith(
            "wiki/summaries/new-page.md",
            expect.stringContaining(MANAGED_MARKER),
        );
    });

    it("skips pages where generated_at matches", async () => {
        const page = makePage({ slug: "up-to-date", generated_at: "2025-01-01" });
        vi.mocked(mockApi.wikiList).mockResolvedValue([page]);
        vi.mocked(mockVault.exists).mockResolvedValue(true);
        vi.mocked(mockVault.read).mockResolvedValue(`---\n${MANAGED_MARKER}\ngenerated_at: 2025-01-01\n---\ncontent`);

        const result = await sync.reconcile();

        expect(result.written).toBe(0);
        expect(mockApi.wikiPage).not.toHaveBeenCalled();
    });

    it("updates pages where generated_at differs", async () => {
        const page = makePage({ slug: "stale", generated_at: "2025-02-01" });
        const detail = makeDetail({ slug: "stale", generated_at: "2025-02-01" });
        vi.mocked(mockApi.wikiList).mockResolvedValue([page]);
        vi.mocked(mockVault.exists).mockResolvedValue(true);
        vi.mocked(mockVault.read).mockResolvedValue(
            `---\n${MANAGED_MARKER}\ngenerated_at: 2025-01-01\n---\nold content`,
        );
        vi.mocked(mockApi.wikiPage).mockResolvedValue(detail);

        const result = await sync.reconcile();

        expect(result.written).toBe(1);
        expect(mockVault.write).toHaveBeenCalled();
    });

    it("skips pages that exist but are not managed", async () => {
        const page = makePage({ slug: "manual" });
        vi.mocked(mockApi.wikiList).mockResolvedValue([page]);
        vi.mocked(mockVault.exists).mockResolvedValue(true);
        vi.mocked(mockVault.read).mockResolvedValue("---\ntitle: Manual\n---\nuser content");

        const result = await sync.reconcile();

        expect(result.written).toBe(0);
        expect(mockApi.wikiPage).not.toHaveBeenCalled();
    });

    it("updates managed files with no generated_at field", async () => {
        const page = makePage({ slug: "no-date" });
        const detail = makeDetail({ slug: "no-date" });
        vi.mocked(mockApi.wikiList).mockResolvedValue([page]);
        vi.mocked(mockVault.exists).mockResolvedValue(true);
        vi.mocked(mockVault.read).mockResolvedValue(`---\n${MANAGED_MARKER}\n---\ncontent without generated_at`);
        vi.mocked(mockApi.wikiPage).mockResolvedValue(detail);

        const result = await sync.reconcile();

        expect(result.written).toBe(1);
    });

    it("creates folders when they don't exist", async () => {
        vi.mocked(mockApi.wikiList).mockResolvedValue([]);
        vi.mocked(mockVault.exists).mockResolvedValue(false);
        vi.mocked(mockVault.list).mockRejectedValue(new Error("not found"));

        // Override exists: folders don't exist, dirs for removeStalePages also don't exist
        vi.mocked(mockVault.exists).mockResolvedValue(false);

        await sync.reconcile();

        expect(mockVault.mkdir).toHaveBeenCalledWith("wiki");
        expect(mockVault.mkdir).toHaveBeenCalledWith("wiki/summaries");
        expect(mockVault.mkdir).toHaveBeenCalledWith("wiki/concepts");
    });

    it("skips folder creation when folders exist", async () => {
        vi.mocked(mockApi.wikiList).mockResolvedValue([]);
        vi.mocked(mockVault.exists).mockResolvedValue(true);

        await sync.reconcile();

        expect(mockVault.mkdir).not.toHaveBeenCalled();
    });

    it("calls removeStalePages and includes removed count", async () => {
        const page = makePage({ slug: "kept" });
        vi.mocked(mockApi.wikiList).mockResolvedValue([page]);
        // File doesn't exist on disk, so it will be written
        vi.mocked(mockVault.exists).mockImplementation(async (path: string) => {
            if (path === "wiki/summaries/kept.md") return false;
            // summaries dir exists, concepts dir exists
            return true;
        });
        vi.mocked(mockApi.wikiPage).mockResolvedValue(makeDetail({ slug: "kept" }));
        // Stale file in summaries dir
        vi.mocked(mockVault.list).mockImplementation(async (path: string) => {
            if (path === "wiki/summaries") {
                return { files: ["wiki/summaries/old.md"] };
            }
            return { files: [] };
        });
        vi.mocked(mockVault.read).mockResolvedValue(`---\n${MANAGED_MARKER}\n---\nold content`);

        const result = await sync.reconcile();

        expect(result.removed).toBe(1);
        expect(mockVault.remove).toHaveBeenCalledWith("wiki/summaries/old.md");
    });

    it("filters out non-summary/synthesis page types", async () => {
        const pages = [
            makePage({ slug: "s", page_type: "summary" }),
            makePage({ slug: "c", page_type: "synthesis" }),
            // Force a different page_type to test the filter
            { ...makePage({ slug: "other" }), page_type: "draft" } as unknown as WikiPage,
        ];
        vi.mocked(mockApi.wikiList).mockResolvedValue(pages);
        vi.mocked(mockVault.exists).mockImplementation(async (path: string) => {
            // files don't exist, folders do
            return !path.endsWith(".md");
        });
        vi.mocked(mockApi.wikiPage).mockImplementation(async (slug: string) => makeDetail({ slug }));

        const result = await sync.reconcile();

        // Only summary and synthesis are written, not "draft"
        expect(result.written).toBe(2);
        expect(mockApi.wikiPage).toHaveBeenCalledWith("s");
        expect(mockApi.wikiPage).toHaveBeenCalledWith("c");
        expect(mockApi.wikiPage).not.toHaveBeenCalledWith("other");
    });
});

// ---------------------------------------------------------------------------
// WikiSync.writePage
// ---------------------------------------------------------------------------

describe("writePage", () => {
    it("fetches page detail and writes to correct path", async () => {
        const detail = makeDetail({ slug: "my-page", page_type: "summary" });
        vi.mocked(mockApi.wikiPage).mockResolvedValue(detail);
        vi.mocked(mockVault.exists).mockResolvedValue(true);

        await sync.writePage("my-page");

        expect(mockApi.wikiPage).toHaveBeenCalledWith("my-page");
        expect(mockVault.write).toHaveBeenCalledWith(
            "wiki/summaries/my-page.md",
            expect.stringContaining(MANAGED_MARKER),
        );
    });

    it("writes synthesis pages to concepts subdir", async () => {
        const detail = makeDetail({ slug: "concept-x", page_type: "synthesis" });
        vi.mocked(mockApi.wikiPage).mockResolvedValue(detail);
        vi.mocked(mockVault.exists).mockResolvedValue(true);

        await sync.writePage("concept-x");

        expect(mockVault.write).toHaveBeenCalledWith(
            "wiki/concepts/concept-x.md",
            expect.stringContaining(detail.content),
        );
    });

    it("creates folders if they don't exist", async () => {
        const detail = makeDetail({ slug: "new" });
        vi.mocked(mockApi.wikiPage).mockResolvedValue(detail);
        vi.mocked(mockVault.exists).mockResolvedValue(false);

        await sync.writePage("new");

        expect(mockVault.mkdir).toHaveBeenCalledWith("wiki");
        expect(mockVault.mkdir).toHaveBeenCalledWith("wiki/summaries");
        expect(mockVault.mkdir).toHaveBeenCalledWith("wiki/concepts");
    });
});

// ---------------------------------------------------------------------------
// WikiSync.removeStalePages
// ---------------------------------------------------------------------------

describe("removeStalePages", () => {
    it("removes managed files not in current page list", async () => {
        const currentPages = [makePage({ slug: "keep", page_type: "summary" })];
        vi.mocked(mockVault.exists).mockResolvedValue(true);
        vi.mocked(mockVault.list).mockImplementation(async (path: string) => {
            if (path === "wiki/summaries") {
                return { files: ["wiki/summaries/keep.md", "wiki/summaries/stale.md"] };
            }
            return { files: [] };
        });
        vi.mocked(mockVault.read).mockResolvedValue(`---\n${MANAGED_MARKER}\n---\ncontent`);

        const removed = await sync.removeStalePages(currentPages);

        expect(removed).toBe(1);
        expect(mockVault.remove).toHaveBeenCalledWith("wiki/summaries/stale.md");
        expect(mockVault.remove).not.toHaveBeenCalledWith("wiki/summaries/keep.md");
    });

    it("skips non-.md files", async () => {
        vi.mocked(mockVault.exists).mockResolvedValue(true);
        vi.mocked(mockVault.list).mockImplementation(async (path: string) => {
            if (path === "wiki/summaries") {
                return { files: ["wiki/summaries/notes.txt", "wiki/summaries/.DS_Store"] };
            }
            return { files: [] };
        });

        const removed = await sync.removeStalePages([]);

        expect(removed).toBe(0);
        expect(mockVault.read).not.toHaveBeenCalled();
        expect(mockVault.remove).not.toHaveBeenCalled();
    });

    it("skips non-managed .md files", async () => {
        vi.mocked(mockVault.exists).mockResolvedValue(true);
        vi.mocked(mockVault.list).mockImplementation(async (path: string) => {
            if (path === "wiki/summaries") {
                return { files: ["wiki/summaries/manual.md"] };
            }
            return { files: [] };
        });
        vi.mocked(mockVault.read).mockResolvedValue("---\ntitle: Manual\n---\nuser notes");

        const removed = await sync.removeStalePages([]);

        expect(removed).toBe(0);
        expect(mockVault.remove).not.toHaveBeenCalled();
    });

    it("handles directory not existing", async () => {
        vi.mocked(mockVault.exists).mockResolvedValue(false);

        const removed = await sync.removeStalePages([]);

        expect(removed).toBe(0);
        expect(mockVault.list).not.toHaveBeenCalled();
    });

    it("checks both summaries and concepts dirs", async () => {
        const currentPages: WikiPage[] = [];
        vi.mocked(mockVault.exists).mockResolvedValue(true);
        vi.mocked(mockVault.list).mockImplementation(async (path: string) => {
            if (path === "wiki/summaries") {
                return { files: ["wiki/summaries/a.md"] };
            }
            if (path === "wiki/concepts") {
                return { files: ["wiki/concepts/b.md"] };
            }
            return { files: [] };
        });
        vi.mocked(mockVault.read).mockResolvedValue(`---\n${MANAGED_MARKER}\n---\ncontent`);

        const removed = await sync.removeStalePages(currentPages);

        expect(removed).toBe(2);
        expect(mockVault.remove).toHaveBeenCalledWith("wiki/summaries/a.md");
        expect(mockVault.remove).toHaveBeenCalledWith("wiki/concepts/b.md");
    });
});
