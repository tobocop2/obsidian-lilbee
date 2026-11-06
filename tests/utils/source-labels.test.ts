import { describe, it, expect } from "vitest";
import { markdownText, sourceRefs, sourcesListMarkdown } from "../../src/utils/source-labels";
import type { Source } from "../../src/types";

function chunk(source: string, extra: Partial<Source> = {}): Source {
    return {
        source,
        content_type: "text/markdown",
        distance: 0,
        chunk: "",
        page_start: null,
        page_end: null,
        line_start: null,
        line_end: null,
        ...extra,
    };
}

describe("markdownText", () => {
    it("escapes every ASCII punctuation mark", () => {
        expect(markdownText("[a](b) ![c](d) <img> `e` *f* _g_ ~h~ ==i== #j $k$ %%l%% https://m.example")).toBe(
            "\\[a\\]\\(b\\) \\!\\[c\\]\\(d\\) \\<img\\> \\`e\\` \\*f\\* \\_g\\_ \\~h\\~ \\=\\=i\\=\\= \\#j \\$k\\$ \\%\\%l\\%\\% https\\:\\/\\/m\\.example",
        );
    });

    it("leaves letters, digits and other characters as they are", () => {
        expect(markdownText("forum · Ünïcode 42")).toBe("forum · Ünïcode 42");
    });

    it("puts the text on one line", () => {
        expect(markdownText("  a\t\tb \n c  ")).toBe("a b c");
    });
});

describe("sourceRefs", () => {
    it("keeps one ref per source, in order, with the server's label and number", () => {
        const refs = sourceRefs([
            chunk("a.md", { label: "a", citation_number: 1 }),
            chunk("b.md", { label: "forum · [click](https://evil.example/x)", citation_number: 3 }),
            chunk("a.md", { label: "a", citation_number: 1 }),
        ]);
        expect(refs).toEqual([
            { source: "a.md", label: "a", citation_number: 1 },
            { source: "b.md", label: "forum · [click](https://evil.example/x)", citation_number: 3 },
        ]);
    });

    it("names a source by its path and no number when the server sent neither", () => {
        expect(sourceRefs([chunk("notes.md")])).toEqual([
            { source: "notes.md", label: "notes.md", citation_number: null },
        ]);
    });
});

describe("sourcesListMarkdown", () => {
    it.each([
        [
            "a link",
            "forum · [click](https://evil.example/x)",
            "forum · \\[click\\]\\(https\\:\\/\\/evil\\.example\\/x\\)",
        ],
        [
            "an image",
            "a · ![px](https://evil.example/p.png)",
            "a · \\!\\[px\\]\\(https\\:\\/\\/evil\\.example\\/p\\.png\\)",
        ],
        ["an HTML tag", "b · <img src=x onerror=alert(1)>", "b · \\<img src\\=x onerror\\=alert\\(1\\)\\>"],
        ["a closing bracket", "c · ]", "c · \\]"],
    ])("escapes %s in a label", (_name, label, escaped) => {
        expect(sourcesListMarkdown("Sources", [{ source: "x.md", label, citation_number: 2 }])).toBe(
            `Sources:\n\n2\\. ${escaped}`,
        );
    });

    it("shows a cited subset's true numbers on hard-broken lines", () => {
        const refs = [
            { source: "a.md", label: "a", citation_number: 1 },
            { source: "c.md", label: "c", citation_number: 3 },
        ];
        expect(sourcesListMarkdown("Sources", refs)).toBe("Sources:\n\n1\\. a\\\n3\\. c");
    });

    it("numbers a ref with no number by its position", () => {
        const refs = [
            { source: "a.md", label: "a", citation_number: null },
            { source: "b.md", label: "b", citation_number: null },
        ];
        expect(sourcesListMarkdown("Sources", refs)).toBe("Sources:\n\n1\\. a\\\n2\\. b");
    });
});
