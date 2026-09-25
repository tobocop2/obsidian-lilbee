import { describe, expect, it } from "vitest";
import { attachmentFileName } from "../../src/utils/attachment";

describe("attachmentFileName", () => {
    it("reads a plain ASCII filename", () => {
        expect(attachmentFileName('attachment; filename="bees-3f2a1b2c.md"')).toBe("bees-3f2a1b2c.md");
    });

    it("prefers the UTF-8 filename* over the ASCII fallback, in either order", () => {
        const utf8 = "filename*=UTF-8''%C3%A9t%C3%A9-3f2a1b2c.md";
        const ascii = 'filename="__t_-3f2a1b2c.md"';
        expect(attachmentFileName(`attachment; ${ascii}; ${utf8}`)).toBe("été-3f2a1b2c.md");
        expect(attachmentFileName(`attachment; ${utf8}; ${ascii}`)).toBe("été-3f2a1b2c.md");
    });

    it("decodes percent-escapes and keeps an encoded byte-order mark in the name", () => {
        expect(attachmentFileName("attachment; filename*=UTF-8''a%20b%25c.md")).toBe("a b%c.md");
        expect(attachmentFileName("attachment; filename*=UTF-8''%EF%BB%BFbees.md")).toBe("﻿bees.md");
    });

    it("unescapes a quoted filename", () => {
        expect(attachmentFileName('attachment; filename="say \\"hi\\".md"')).toBe('say "hi".md');
    });

    it.each([null, "", "attachment", "inline; size=4", "attachment; filename", 'attachment; filename=""'])(
        "is null when the header %j names no file",
        (header) => {
            expect(attachmentFileName(header)).toBeNull();
        },
    );

    it("falls back to the ASCII filename when filename* does not decode", () => {
        expect(attachmentFileName("attachment; filename*=UTF-8''%E0%A4%A.md; filename=\"bees.md\"")).toBe("bees.md");
        expect(attachmentFileName("attachment; filename*=UTF-8''%E0%A4%A.md")).toBeNull();
        expect(attachmentFileName("attachment; filename*=KOI8-R''bees.md")).toBeNull();
    });

    it("keeps only the last path segment so the name cannot leave the chosen folder", () => {
        expect(attachmentFileName("attachment; filename*=UTF-8''..%2F..%2Fetc%2Fbees.md")).toBe("bees.md");
        expect(attachmentFileName("attachment; filename*=UTF-8''..%5C..%5Cbees.md")).toBe("bees.md");
        expect(attachmentFileName('attachment; filename="/tmp/bees.md"')).toBe("bees.md");
        expect(attachmentFileName("attachment; filename*=UTF-8''a%0A%2Fbees.md")).toBe("bees.md");
    });

    it.each(["/", "a/", "..", "a/..", "a\\.", "."])("is null when the name %j is only a path", (name) => {
        expect(attachmentFileName(`attachment; filename*=UTF-8''${encodeURIComponent(name)}`)).toBeNull();
    });
});
