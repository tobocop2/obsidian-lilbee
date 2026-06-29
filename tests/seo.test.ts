import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// SEO invariants for the marketing site. Encodes the on-page rules so a stale
// canonical, a missing Open Graph tag, or a page that drops out of the sitemap
// fails CI instead of silently costing rankings.

const SITE = resolve(dirname(fileURLToPath(import.meta.url)), "..", "site");
const BASE = "https://obsidian.lilbee.sh/";

function read(rel: string): string {
    return readFileSync(resolve(SITE, rel), "utf-8");
}

function meta(html: string, key: string, attr = "property"): string | null {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = new RegExp(`<meta ${attr}="${escaped}" content="([^"]*)"`).exec(html);
    return match ? match[1] : null;
}

function jsonLdBlocks(html: string): string[] {
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    return blocks.map((block) => block[1]);
}

describe("home page SEO", () => {
    const home = read("index.html");

    it("has a present, length-bounded title", () => {
        const match = /<title>([\s\S]*?)<\/title>/.exec(home);
        expect(match).not.toBeNull();
        const title = (match ? match[1] : "").trim();
        expect(title.length).toBeGreaterThanOrEqual(20);
        expect(title.length).toBeLessThanOrEqual(75);
    });

    it("has a present meta description", () => {
        const description = meta(home, "description", "name");
        expect(description).toBeTruthy();
        expect((description ?? "").length).toBeGreaterThanOrEqual(50);
    });

    it("has a self-referential canonical", () => {
        const match = /<link rel="canonical" href="([^"]+)"/.exec(home);
        expect(match?.[1]).toBe(BASE);
    });

    it("has a complete Open Graph and Twitter card set", () => {
        for (const property of ["og:type", "og:title", "og:description", "og:url", "og:image"]) {
            expect(meta(home, property)).toBeTruthy();
        }
        expect(meta(home, "og:url")).toBe(BASE);
        expect(meta(home, "twitter:card", "name")).toBeTruthy();
    });

    it("has exactly one h1", () => {
        const count = (home.match(/<h1[\s>]/g) ?? []).length;
        expect(count).toBe(1);
    });

    it("gives every image alt text", () => {
        for (const tag of home.match(/<img\b[^>]*>/g) ?? []) {
            const match = /alt="([^"]*)"/.exec(tag);
            expect(match !== null && match[1].trim().length > 0).toBe(true);
        }
    });

    it("has valid JSON-LD including WebSite and FAQPage", () => {
        const blocks = jsonLdBlocks(home);
        expect(blocks.length).toBeGreaterThan(0);
        const types = new Set<string>();
        for (const block of blocks) {
            const data = JSON.parse(block) as Record<string, unknown>;
            expect(data["@context"]).toBeTruthy();
            expect(data["@type"]).toBeTruthy();
            types.add(String(data["@type"]));
        }
        expect(types.has("WebSite")).toBe(true);
        expect(types.has("FAQPage")).toBe(true);
    });
});

describe("sitemap", () => {
    it("lists URLs that all resolve to files, each with a trailing slash", () => {
        const sitemap = read("sitemap.xml");
        const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
        expect(locs).toContain(BASE);
        for (const loc of locs) {
            expect(loc.endsWith("/")).toBe(true);
            const rel = loc.slice(BASE.length);
            const file = resolve(SITE, rel === "" ? "index.html" : `${rel}index.html`);
            expect(() => readFileSync(file)).not.toThrow();
        }
    });
});
