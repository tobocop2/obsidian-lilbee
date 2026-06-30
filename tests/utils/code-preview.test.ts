import { describe, expect, it } from "vitest";
import { languageForSource, toCodeFence } from "../../src/utils/code-preview";

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
