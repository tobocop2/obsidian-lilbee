import { vi, describe, it, expect, beforeEach } from "vitest";
import { App, MockElement } from "../__mocks__/obsidian";
import { VaultPickerModal } from "../../src/views/vault-picker-modal";
import { MESSAGES } from "../../src/locales/en";
import type { VaultRegistryEntry } from "../../src/types";

function entry(overrides: Partial<VaultRegistryEntry> = {}): VaultRegistryEntry {
    return {
        id: "a",
        displayName: "Work",
        dataDir: "/shared/vaults/a",
        obsidianVaultPath: "/Users/x/Work",
        addedAt: 1,
        lastActiveAt: Date.now() - 30_000,
        ...overrides,
    };
}

function openModal(entries: VaultRegistryEntry[], onPick: (e: VaultRegistryEntry) => void = () => {}) {
    const modal = new VaultPickerModal(new App() as any, entries, onPick);
    modal.open();
    return { modal, contentEl: modal.contentEl as unknown as MockElement };
}

describe("VaultPickerModal", () => {
    beforeEach(() => vi.useRealTimers());

    it("shows the empty-state message when no other vaults are registered", () => {
        const { contentEl } = openModal([]);
        const empty = contentEl.find("lilbee-vault-picker-empty");
        expect(empty?.textContent).toBe(MESSAGES.EMPTY_VAULT_PICKER);
    });

    it("renders one card per entry with displayName + path + freshness", () => {
        const { contentEl } = openModal([entry({ displayName: "Work" }), entry({ id: "b", displayName: "Personal" })]);
        const cards = contentEl.findAll("lilbee-vault-picker-card");
        expect(cards).toHaveLength(2);
        const names = cards.map((c) => c.find("lilbee-vault-picker-card-name")?.textContent);
        expect(names).toEqual(["Work", "Personal"]);
        const paths = cards.map((c) => c.find("lilbee-vault-picker-card-path")?.textContent);
        expect(paths.every((p) => p && p.length > 0)).toBe(true);
    });

    it("invokes the onPick callback and closes when the Switch button is clicked", () => {
        const onPick = vi.fn();
        const { modal, contentEl } = openModal([entry({ displayName: "Work" })], onPick);
        const closeSpy = vi.spyOn(modal, "close").mockImplementation(() => {});
        const switchBtn = contentEl.find("lilbee-vault-picker-switch-btn");
        switchBtn?.trigger("click");
        expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ displayName: "Work" }));
        expect(closeSpy).toHaveBeenCalled();
    });

    it("formats lastActiveAt across every freshness bucket", () => {
        const now = Date.now();
        const { contentEl } = openModal([
            entry({ id: "n", displayName: "Never", lastActiveAt: 0 }),
            entry({ id: "s", displayName: "JustNow", lastActiveAt: now - 5_000 }),
            entry({ id: "m1", displayName: "OneMin", lastActiveAt: now - 60_000 }),
            entry({ id: "m2", displayName: "ManyMin", lastActiveAt: now - 5 * 60_000 }),
            entry({ id: "h1", displayName: "OneHr", lastActiveAt: now - 60 * 60_000 }),
        ]);
        const labels = contentEl.findAll("lilbee-vault-picker-card-meta").map((m) => m.textContent);
        expect(labels).toEqual([
            MESSAGES.LABEL_VAULT_NEVER_ACTIVE,
            MESSAGES.LABEL_VAULT_ACTIVE_RECENTLY,
            MESSAGES.LABEL_VAULT_ACTIVE_MINUTES(1),
            MESSAGES.LABEL_VAULT_ACTIVE_MINUTES(5),
            MESSAGES.LABEL_VAULT_ACTIVE_HOURS(1),
        ]);
    });

    it("formats hours and days buckets", () => {
        const now = Date.now();
        const { contentEl } = openModal([
            entry({ id: "h2", displayName: "ManyHr", lastActiveAt: now - 3 * 60 * 60_000 }),
            entry({ id: "d1", displayName: "OneDay", lastActiveAt: now - 24 * 60 * 60_000 }),
            entry({ id: "d2", displayName: "ManyDays", lastActiveAt: now - 7 * 24 * 60 * 60_000 }),
        ]);
        const labels = contentEl.findAll("lilbee-vault-picker-card-meta").map((m) => m.textContent);
        expect(labels).toEqual([
            MESSAGES.LABEL_VAULT_ACTIVE_HOURS(3),
            MESSAGES.LABEL_VAULT_ACTIVE_DAYS(1),
            MESSAGES.LABEL_VAULT_ACTIVE_DAYS(7),
        ]);
    });

    it("clamps negative skew (future timestamp) to recently-active", () => {
        const { contentEl } = openModal([entry({ lastActiveAt: Date.now() + 60_000 })]);
        const meta = contentEl.find("lilbee-vault-picker-card-meta");
        expect(meta?.textContent).toBe(MESSAGES.LABEL_VAULT_ACTIVE_RECENTLY);
    });

    it("filters by displayName as the user types", () => {
        const { modal, contentEl } = openModal([
            entry({ id: "a", displayName: "Work", obsidianVaultPath: "/Users/x/Job" }),
            entry({ id: "b", displayName: "Personal", obsidianVaultPath: "/Users/x/Personal" }),
            entry({ id: "c", displayName: "Field research", obsidianVaultPath: "/Users/x/Field" }),
        ]);
        const input = modal.filterInput as unknown as MockElement;
        input.value = "work";
        input.trigger("input");
        const names = contentEl.findAll("lilbee-vault-picker-card-name").map((c) => c.textContent);
        expect(names).toEqual(["Work"]);
    });

    it("filters by path substring as well", () => {
        const { modal, contentEl } = openModal([
            entry({ id: "a", displayName: "Work", obsidianVaultPath: "/Users/x/Work" }),
            entry({ id: "b", displayName: "Personal", obsidianVaultPath: "/Users/x/Notes/Personal" }),
        ]);
        const input = modal.filterInput as unknown as MockElement;
        input.value = "notes";
        input.trigger("input");
        const names = contentEl.findAll("lilbee-vault-picker-card-name").map((c) => c.textContent);
        expect(names).toEqual(["Personal"]);
    });

    it("shows an empty-state when the filter matches nothing", () => {
        const { modal, contentEl } = openModal([entry({ displayName: "Work" })]);
        const input = modal.filterInput as unknown as MockElement;
        input.value = "zzz-no-match";
        input.trigger("input");
        const empties = contentEl.findAll("lilbee-vault-picker-empty");
        expect(empties.length).toBeGreaterThan(0);
    });

    it("paginates when more than the page size of entries exist", () => {
        const entries = Array.from({ length: 12 }, (_, i) =>
            entry({ id: `v${i}`, displayName: `Vault ${i}`, lastActiveAt: Date.now() - 60_000 * (i + 1) }),
        );
        const { contentEl } = openModal(entries);
        const firstPage = contentEl.findAll("lilbee-vault-picker-card-name").map((c) => c.textContent);
        expect(firstPage).toHaveLength(5);
        expect(firstPage[0]).toBe("Vault 0");
        const nextBtn = contentEl
            .findAll("lilbee-vault-picker-page-btn")
            .find((b) => b.textContent === MESSAGES.BUTTON_NEXT_PAGE);
        nextBtn?.trigger("click");
        const secondPage = contentEl.findAll("lilbee-vault-picker-card-name").map((c) => c.textContent);
        expect(secondPage).toHaveLength(5);
        expect(secondPage[0]).toBe("Vault 5");
    });

    it("filter input resets to page 1 even if a later page was active", () => {
        const entries = Array.from({ length: 12 }, (_, i) =>
            entry({
                id: `v${i}`,
                displayName: `Vault ${i}`,
                obsidianVaultPath: `/Users/x/Vault${i}`,
                lastActiveAt: Date.now() - 60_000 * (i + 1),
            }),
        );
        const { modal, contentEl } = openModal(entries);
        const nextBtn = contentEl
            .findAll("lilbee-vault-picker-page-btn")
            .find((b) => b.textContent === MESSAGES.BUTTON_NEXT_PAGE);
        nextBtn?.trigger("click");
        // Now filter to a single match. Page index should reset to 0.
        const input = modal.filterInput as unknown as MockElement;
        input.value = "Vault 0";
        input.trigger("input");
        const names = contentEl.findAll("lilbee-vault-picker-card-name").map((c) => c.textContent);
        expect(names).toEqual(["Vault 0"]);
    });

    it("disables Prev on the first page and Next on the last page", () => {
        const entries = Array.from({ length: 7 }, (_, i) =>
            entry({ id: `v${i}`, displayName: `Vault ${i}`, lastActiveAt: Date.now() - 60_000 * (i + 1) }),
        );
        const { contentEl } = openModal(entries);
        const prev = contentEl
            .findAll("lilbee-vault-picker-page-btn")
            .find((b) => b.textContent === MESSAGES.BUTTON_PREV_PAGE);
        const next = contentEl
            .findAll("lilbee-vault-picker-page-btn")
            .find((b) => b.textContent === MESSAGES.BUTTON_NEXT_PAGE);
        expect((prev as any)?.disabled).toBe(true);
        expect((next as any)?.disabled).toBe(false);
        next?.trigger("click");
        const prev2 = contentEl
            .findAll("lilbee-vault-picker-page-btn")
            .find((b) => b.textContent === MESSAGES.BUTTON_PREV_PAGE);
        const next2 = contentEl
            .findAll("lilbee-vault-picker-page-btn")
            .find((b) => b.textContent === MESSAGES.BUTTON_NEXT_PAGE);
        expect((prev2 as any)?.disabled).toBe(false);
        expect((next2 as any)?.disabled).toBe(true);
        // Click Prev to go back to page 1.
        prev2?.trigger("click");
        const names = contentEl.findAll("lilbee-vault-picker-card-name").map((c) => c.textContent);
        expect(names[0]).toBe("Vault 0");
    });

    it("Prev click on the first page is a no-op", () => {
        const entries = Array.from({ length: 12 }, (_, i) =>
            entry({ id: `v${i}`, displayName: `Vault ${i}`, lastActiveAt: Date.now() - 60_000 * (i + 1) }),
        );
        const { contentEl } = openModal(entries);
        const prev = contentEl
            .findAll("lilbee-vault-picker-page-btn")
            .find((b) => b.textContent === MESSAGES.BUTTON_PREV_PAGE);
        prev?.trigger("click"); // guarded; should do nothing
        const names = contentEl.findAll("lilbee-vault-picker-card-name").map((c) => c.textContent);
        expect(names[0]).toBe("Vault 0");
    });

    it("Next click on the last page is a no-op", () => {
        const entries = Array.from({ length: 7 }, (_, i) =>
            entry({ id: `v${i}`, displayName: `Vault ${i}`, lastActiveAt: Date.now() - 60_000 * (i + 1) }),
        );
        const { contentEl } = openModal(entries);
        const nextBtn = contentEl
            .findAll("lilbee-vault-picker-page-btn")
            .find((b) => b.textContent === MESSAGES.BUTTON_NEXT_PAGE);
        nextBtn?.trigger("click"); // go to page 2
        const nextBtn2 = contentEl
            .findAll("lilbee-vault-picker-page-btn")
            .find((b) => b.textContent === MESSAGES.BUTTON_NEXT_PAGE);
        nextBtn2?.trigger("click"); // guarded; already on last page
        const names = contentEl.findAll("lilbee-vault-picker-card-name").map((c) => c.textContent);
        expect(names[0]).toBe("Vault 5");
    });

    it("hides pagination controls when there is only one page", () => {
        const { contentEl } = openModal([entry({ displayName: "Work" })]);
        const btns = contentEl.findAll("lilbee-vault-picker-page-btn");
        expect(btns).toHaveLength(0);
    });

    it("friendly-paths uses USERPROFILE when HOME is unset", () => {
        const savedHome = process.env.HOME;
        const savedUserProfile = process.env.USERPROFILE;
        delete process.env.HOME;
        process.env.USERPROFILE = "C:\\\\Users\\\\x";
        try {
            const { contentEl } = openModal([entry({ obsidianVaultPath: "C:\\\\Users\\\\x\\\\Docs\\\\Notes" })]);
            const path = contentEl.find("lilbee-vault-picker-card-path");
            expect(path?.textContent?.startsWith("~/")).toBe(true);
        } finally {
            if (savedHome !== undefined) process.env.HOME = savedHome;
            if (savedUserProfile === undefined) delete process.env.USERPROFILE;
            else process.env.USERPROFILE = savedUserProfile;
        }
    });

    it("friendly-paths short paths under home without ellipsis", () => {
        const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
        if (!home) return;
        const { contentEl } = openModal([entry({ obsidianVaultPath: `${home}/Notes` })]);
        const path = contentEl.find("lilbee-vault-picker-card-path");
        expect(path?.textContent).toBe("~/Notes");
    });

    it("friendly-paths falls back to absolute when HOME is unset", () => {
        const savedHome = process.env.HOME;
        const savedUserProfile = process.env.USERPROFILE;
        delete process.env.HOME;
        delete process.env.USERPROFILE;
        try {
            const { contentEl } = openModal([entry({ obsidianVaultPath: "/var/data/some/long/path/to/vault" })]);
            const path = contentEl.find("lilbee-vault-picker-card-path");
            // Without HOME, the prefix is "…/" + last-two-segments.
            expect(path?.textContent).toBe("…/to/vault");
        } finally {
            if (savedHome !== undefined) process.env.HOME = savedHome;
            if (savedUserProfile !== undefined) process.env.USERPROFILE = savedUserProfile;
        }
    });

    it("friendly-paths the home dir with ~ and trims to the last two segments", () => {
        const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
        if (!home) return; // skip if HOME isn't set
        const { contentEl } = openModal([
            entry({
                id: "h1",
                displayName: "Home",
                obsidianVaultPath: `${home}/Documents/Notes`,
            }),
            entry({
                id: "abs",
                displayName: "Abs",
                obsidianVaultPath: "/var/data/some/long/path/to/vault",
            }),
        ]);
        const paths = contentEl.findAll("lilbee-vault-picker-card-path").map((c) => c.textContent);
        expect(paths[0]).toBe("~/Documents/Notes");
        expect(paths[1]).toBe("…/to/vault");
    });
});
