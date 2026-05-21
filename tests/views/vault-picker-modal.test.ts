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

    it("renders one row per entry with displayName, path, and freshness", () => {
        const { contentEl } = openModal([entry({ displayName: "Work" }), entry({ id: "b", displayName: "Personal" })]);
        const rows = contentEl.findAll("lilbee-vault-picker-row");
        expect(rows).toHaveLength(2);
        const names = rows.map((r) => r.find("lilbee-vault-picker-name")?.textContent);
        expect(names).toEqual(["Work", "Personal"]);
    });

    it("invokes the onPick callback and closes when a row is clicked", () => {
        const onPick = vi.fn();
        const { modal, contentEl } = openModal([entry({ displayName: "Work" })], onPick);
        const closeSpy = vi.spyOn(modal, "close").mockImplementation(() => {});
        contentEl.find("lilbee-vault-picker-row")?.trigger("click");
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
            entry({ id: "h2", displayName: "ManyHr", lastActiveAt: now - 3 * 60 * 60_000 }),
            entry({ id: "d1", displayName: "OneDay", lastActiveAt: now - 24 * 60 * 60_000 }),
            entry({ id: "d2", displayName: "ManyDays", lastActiveAt: now - 7 * 24 * 60 * 60_000 }),
        ]);
        const labels = contentEl.findAll("lilbee-vault-picker-meta").map((m) => m.textContent);
        expect(labels).toEqual([
            MESSAGES.LABEL_VAULT_NEVER_ACTIVE,
            MESSAGES.LABEL_VAULT_ACTIVE_RECENTLY,
            MESSAGES.LABEL_VAULT_ACTIVE_MINUTES(1),
            MESSAGES.LABEL_VAULT_ACTIVE_MINUTES(5),
            MESSAGES.LABEL_VAULT_ACTIVE_HOURS(1),
            MESSAGES.LABEL_VAULT_ACTIVE_HOURS(3),
            MESSAGES.LABEL_VAULT_ACTIVE_DAYS(1),
            MESSAGES.LABEL_VAULT_ACTIVE_DAYS(7),
        ]);
    });

    it("clamps negative skew (future timestamp) to recently-active", () => {
        const { contentEl } = openModal([entry({ lastActiveAt: Date.now() + 60_000 })]);
        const meta = contentEl.find("lilbee-vault-picker-meta");
        expect(meta?.textContent).toBe(MESSAGES.LABEL_VAULT_ACTIVE_RECENTLY);
    });
});
