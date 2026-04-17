import { describe, it, expect } from "vitest";
import { ensureUrlScheme } from "../src/utils";

describe("ensureUrlScheme", () => {
    it("returns URL unchanged when it starts with https://", () => {
        expect(ensureUrlScheme("https://example.com")).toBe("https://example.com");
    });

    it("returns URL unchanged when it starts with http://", () => {
        expect(ensureUrlScheme("http://example.com")).toBe("http://example.com");
    });

    it("is case-insensitive for existing scheme", () => {
        expect(ensureUrlScheme("HTTP://example.com")).toBe("HTTP://example.com");
        expect(ensureUrlScheme("HTTPS://example.com")).toBe("HTTPS://example.com");
        expect(ensureUrlScheme("Https://example.com")).toBe("Https://example.com");
    });

    it("prepends https:// when no scheme is present", () => {
        expect(ensureUrlScheme("example.com")).toBe("https://example.com");
    });

    it("prepends https:// for URLs with paths but no scheme", () => {
        expect(ensureUrlScheme("example.com/page")).toBe("https://example.com/page");
    });

    it("prepends https:// for URLs with subdomains but no scheme", () => {
        expect(ensureUrlScheme("www.example.com")).toBe("https://www.example.com");
    });
});
