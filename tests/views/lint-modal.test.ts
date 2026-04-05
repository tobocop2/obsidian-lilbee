import { describe, it, expect, beforeEach } from "vitest";
import { App } from "obsidian";
import { MockElement } from "../__mocks__/obsidian";
import { LintModal } from "../../src/views/lint-modal";
import type { LintIssue } from "../../src/types";

function collectTexts(el: MockElement): string[] {
    const texts: string[] = [];
    if (el.textContent) texts.push(el.textContent);
    for (const child of el.children) {
        texts.push(...collectTexts(child));
    }
    return texts;
}

function makeIssue(overrides: Partial<LintIssue> = {}): LintIssue {
    return {
        wiki_page: "page-one",
        citation_key: "ref-1",
        status: "valid",
        detail: "all good",
        ...overrides,
    };
}

describe("LintModal", () => {
    let app: App;

    beforeEach(() => {
        app = new App();
    });

    it("renders title and summary with empty issues", () => {
        const modal = new LintModal(app as any, []);
        modal.onOpen();

        const el = modal.contentEl as unknown as MockElement;
        const texts = collectTexts(el);
        expect(texts.some((t) => t.includes("Wiki lint results"))).toBe(true);
        expect(texts.some((t) => t.includes("0 issues across 0 pages"))).toBe(true);
    });

    it("renders issues grouped by wiki_page", () => {
        const issues: LintIssue[] = [
            makeIssue({ wiki_page: "alpha", citation_key: "a1", status: "valid" }),
            makeIssue({ wiki_page: "alpha", citation_key: "a2", status: "stale_hash" }),
            makeIssue({ wiki_page: "beta", citation_key: "b1", status: "source_deleted" }),
        ];
        const modal = new LintModal(app as any, issues);
        modal.onOpen();

        const el = modal.contentEl as unknown as MockElement;
        const groups = el.findAll("lilbee-lint-group");
        expect(groups.length).toBe(2);

        const groupTexts0 = collectTexts(groups[0]);
        expect(groupTexts0.some((t) => t === "alpha")).toBe(true);

        const groupTexts1 = collectTexts(groups[1]);
        expect(groupTexts1.some((t) => t === "beta")).toBe(true);
    });

    it("summary line shows correct counts", () => {
        const issues: LintIssue[] = [
            makeIssue({ wiki_page: "p1" }),
            makeIssue({ wiki_page: "p1" }),
            makeIssue({ wiki_page: "p2" }),
            makeIssue({ wiki_page: "p3" }),
        ];
        const modal = new LintModal(app as any, issues);
        modal.onOpen();

        const el = modal.contentEl as unknown as MockElement;
        const summary = el.find("lilbee-lint-summary");
        expect(summary).not.toBeNull();
        expect(summary!.textContent).toBe("4 issues across 3 pages");
    });

    it("renders valid status with correct CSS class and label", () => {
        const issues: LintIssue[] = [makeIssue({ status: "valid" })];
        const modal = new LintModal(app as any, issues);
        modal.onOpen();

        const el = modal.contentEl as unknown as MockElement;
        const status = el.find("lilbee-lint-valid");
        expect(status).not.toBeNull();
        expect(status!.textContent).toBe("valid");
    });

    it("renders stale_hash status with correct CSS class and label", () => {
        const issues: LintIssue[] = [makeIssue({ status: "stale_hash" })];
        const modal = new LintModal(app as any, issues);
        modal.onOpen();

        const el = modal.contentEl as unknown as MockElement;
        const status = el.find("lilbee-lint-stale");
        expect(status).not.toBeNull();
        expect(status!.textContent).toBe("stale hash");
    });

    it("renders source_deleted status with correct CSS class and label", () => {
        const issues: LintIssue[] = [makeIssue({ status: "source_deleted" })];
        const modal = new LintModal(app as any, issues);
        modal.onOpen();

        const el = modal.contentEl as unknown as MockElement;
        const status = el.find("lilbee-lint-deleted");
        expect(status).not.toBeNull();
        expect(status!.textContent).toBe("source deleted");
    });

    it("renders excerpt_missing status with correct CSS class and label", () => {
        const issues: LintIssue[] = [makeIssue({ status: "excerpt_missing" })];
        const modal = new LintModal(app as any, issues);
        modal.onOpen();

        const el = modal.contentEl as unknown as MockElement;
        const status = el.find("lilbee-lint-missing");
        expect(status).not.toBeNull();
        expect(status!.textContent).toBe("excerpt missing");
    });

    it("renders model_changed status with correct CSS class and label", () => {
        const issues: LintIssue[] = [makeIssue({ status: "model_changed" })];
        const modal = new LintModal(app as any, issues);
        modal.onOpen();

        const el = modal.contentEl as unknown as MockElement;
        const status = el.find("lilbee-lint-model");
        expect(status).not.toBeNull();
        expect(status!.textContent).toBe("model changed");
    });

    it("empties content on close", () => {
        const issues: LintIssue[] = [makeIssue()];
        const modal = new LintModal(app as any, issues);
        modal.onOpen();
        modal.onClose();

        const el = modal.contentEl as unknown as MockElement;
        expect(el.children.length).toBe(0);
    });

    it("renders citation key and detail for each issue", () => {
        const issues: LintIssue[] = [
            makeIssue({ citation_key: "smith2024", detail: "hash mismatch", status: "stale_hash" }),
        ];
        const modal = new LintModal(app as any, issues);
        modal.onOpen();

        const el = modal.contentEl as unknown as MockElement;
        const citationKey = el.find("lilbee-citation-key");
        expect(citationKey).not.toBeNull();
        expect(citationKey!.textContent).toBe("smith2024");

        const detail = el.find("lilbee-lint-detail");
        expect(detail).not.toBeNull();
        expect(detail!.textContent).toBe("hash mismatch");
    });

    it("multiple pages group correctly with multiple issues each", () => {
        const issues: LintIssue[] = [
            makeIssue({ wiki_page: "page-a", citation_key: "ref1" }),
            makeIssue({ wiki_page: "page-b", citation_key: "ref2" }),
            makeIssue({ wiki_page: "page-a", citation_key: "ref3" }),
        ];
        const modal = new LintModal(app as any, issues);
        modal.onOpen();

        const el = modal.contentEl as unknown as MockElement;
        const groups = el.findAll("lilbee-lint-group");
        expect(groups.length).toBe(2);

        // page-a should have 2 issues
        const pageAIssues = groups[0].findAll("lilbee-lint-issue");
        expect(pageAIssues.length).toBe(2);

        // page-b should have 1 issue
        const pageBIssues = groups[1].findAll("lilbee-lint-issue");
        expect(pageBIssues.length).toBe(1);
    });
});
