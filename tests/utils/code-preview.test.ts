import { describe, expect, it } from "vitest";
import { citedLineScrollTop, languageForSource, toCodeFence } from "../../src/utils/code-preview";

describe("languageForSource", () => {
    it("maps known code extensions to Prism languages", () => {
        expect(languageForSource("src/lilbee/providers/fleet/ctx.py")).toBe("python");
        expect(languageForSource("api.ts")).toBe("typescript");
        expect(languageForSource("views/Chat.tsx")).toBe("tsx");
        expect(languageForSource("main.rs")).toBe("rust");
        expect(languageForSource("config.yaml")).toBe("yaml");
    });

    it("is case-insensitive and ignores directories", () => {
        expect(languageForSource("DEEP/Nested/Path/Module.PY")).toBe("python");
        expect(languageForSource("C:\\win\\style\\file.GO")).toBe("go");
    });

    it("recognizes extensionless code filenames", () => {
        expect(languageForSource("repo/Dockerfile")).toBe("docker");
        expect(languageForSource("Makefile")).toBe("makefile");
    });

    it("returns null for markdown, plain text, and unknown extensions", () => {
        expect(languageForSource("notes/readme.md")).toBeNull();
        expect(languageForSource("plain.txt")).toBeNull();
        expect(languageForSource("archive.bin")).toBeNull();
        expect(languageForSource("noextension")).toBeNull();
        expect(languageForSource(".gitignore")).toBeNull();
    });
});

describe("toCodeFence", () => {
    it("wraps content in a language-tagged fence", () => {
        expect(toCodeFence("print('hi')", "python")).toBe("```python\nprint('hi')\n```");
    });

    it("grows the fence past any backtick run inside the content", () => {
        const content = "a = '```'  # three backticks";
        const fenced = toCodeFence(content, "python");
        expect(fenced.startsWith("````python\n")).toBe(true);
        expect(fenced.endsWith("\n````")).toBe(true);
    });

    it("uses a four-backtick fence when content holds a triple run", () => {
        expect(toCodeFence("```", "text")).toBe("````text\n```\n````");
    });
});

describe("citedLineScrollTop", () => {
    it("scrolls to the cited line with a two-line lead-in", () => {
        // 100 lines over 1000px => 10px/line; line 50 => (49-2)*10 = 470.
        expect(citedLineScrollTop(1000, 100, 50)).toBe(470);
    });

    it("never returns a negative offset for an early line", () => {
        expect(citedLineScrollTop(1000, 100, 2)).toBe(0);
    });

    it("returns 0 when there is no cited line or nothing to scroll", () => {
        expect(citedLineScrollTop(1000, 100, null)).toBe(0);
        expect(citedLineScrollTop(1000, 100, 1)).toBe(0);
        expect(citedLineScrollTop(1000, 0, 50)).toBe(0);
        expect(citedLineScrollTop(0, 100, 50)).toBe(0);
    });
});
