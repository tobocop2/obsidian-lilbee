import { describe, it, expect, beforeEach, vi } from "vitest";
import { App, Notice } from "obsidian";
import type { MockElement } from "./__mocks__/obsidian";

vi.mock("../src/server-binary", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../src/server-binary")>();
    return {
        ...actual,
        getLatestRelease: vi.fn(),
    };
});

import * as binMgr from "../src/server-binary";
import { ManagedConsentModal } from "../src/views/managed-consent-modal";
import { MANAGED_CONSENT_RESULT } from "../src/types";
import { MESSAGES } from "../src/locales/en";

type MockedReleaseFn = ReturnType<typeof vi.fn>;
const mockedGetLatestRelease = binMgr.getLatestRelease as unknown as MockedReleaseFn;

function openModal(): { modal: ManagedConsentModal; promise: Promise<unknown>; root: MockElement } {
    const modal = new ManagedConsentModal(new App(), false);
    const promise = modal.openConsent();
    const root = modal.contentEl as unknown as MockElement;
    return { modal, promise, root };
}

/** Flush microtasks so any in-flight fetchProvenance promise resolves. */
async function flush(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
}

describe("ManagedConsentModal", () => {
    beforeEach(() => {
        Notice.clear();
        vi.clearAllMocks();
    });

    it("renders header, both cards, and footer buttons", () => {
        mockedGetLatestRelease.mockResolvedValue({
            tag: "v0.6.66",
            url: "https://x/lilbee",
            assetName: "lilbee-linux-x86_64",
            variant: "default",
            size: 412_000_000,
        });
        const { root } = openModal();
        expect(root.find("lilbee-managed-consent-title")?.textContent).toBe(MESSAGES.MANAGED_CONSENT_TITLE);
        expect(root.find("lilbee-managed-consent-subtitle")).not.toBeNull();
        expect(root.findAll("lilbee-managed-consent-card").length).toBe(2);
        expect(root.find("lilbee-managed-consent-card-managed")).not.toBeNull();
        expect(root.find("lilbee-managed-consent-card-external")).not.toBeNull();
        expect(root.find("lilbee-managed-consent-btn-download")?.textContent).toBe(
            MESSAGES.MANAGED_CONSENT_BTN_DOWNLOAD,
        );
        expect(root.find("lilbee-managed-consent-btn-cancel")?.textContent).toBe(MESSAGES.MANAGED_CONSENT_BTN_CANCEL);
    });

    it("shows pending Source placeholder while release info is fetching", () => {
        let resolveFn: (v: unknown) => void = () => {};
        mockedGetLatestRelease.mockReturnValue(new Promise((r) => (resolveFn = r)));
        const { root } = openModal();
        expect(root.find("lilbee-managed-consent-prov-pending")?.textContent).toBe(
            MESSAGES.MANAGED_CONSENT_PROV_PENDING,
        );
        resolveFn({ tag: "v0", url: "", assetName: "lilbee-linux-x86_64", variant: "default", size: 0 });
    });

    it("renders resolved Source block with tag, asset name, size, and notes link", async () => {
        mockedGetLatestRelease.mockResolvedValue({
            tag: "v0.6.66",
            url: "https://x/lilbee",
            assetName: "lilbee-linux-x86_64",
            variant: "default",
            size: 412_000_000,
        });
        const { root } = openModal();
        await flush();
        expect(root.find("lilbee-managed-consent-prov-pending")).toBeNull();
        const repoLine = root.find("lilbee-managed-consent-prov-repo");
        expect(repoLine).not.toBeNull();
        expect(repoLine!.textContent).toContain("github.com/tobocop2/lilbee");
        expect(repoLine!.textContent).toContain("v0.6.66");
        const asset = root.find("lilbee-managed-consent-prov-asset");
        expect(asset).not.toBeNull();
        expect(asset!.textContent).toContain("MB");
        const notes = root.find("lilbee-managed-consent-prov-notes");
        expect(notes).not.toBeNull();
        expect(notes!.attributes["href"]).toContain("/releases/tag/v0.6.66");
    });

    it("reads provenance through the adapter, never GitHub directly", async () => {
        const fetchSpy = vi.fn();
        vi.stubGlobal("fetch", fetchSpy);
        try {
            mockedGetLatestRelease.mockResolvedValue({
                tag: "v0.6.66",
                url: "https://x/lilbee",
                assetName: "lilbee-linux-x86_64",
                variant: "default",
                size: 412_000_000,
            });
            openModal();
            await flush();

            expect(mockedGetLatestRelease).toHaveBeenCalledWith(false);
            expect(fetchSpy).not.toHaveBeenCalled();
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it("degrades to repo-only when getLatestRelease fails", async () => {
        mockedGetLatestRelease.mockRejectedValue(new Error("offline"));
        const { root } = openModal();
        await flush();
        expect(root.find("lilbee-managed-consent-prov-failed")?.textContent).toBe(MESSAGES.MANAGED_CONSENT_PROV_FAILED);
        expect(root.find("lilbee-managed-consent-prov-repo")?.textContent).toContain("github.com/tobocop2/lilbee");
    });

    it("Download button resolves with { kind: 'download' } once", async () => {
        mockedGetLatestRelease.mockResolvedValue({
            tag: "v0",
            url: "",
            assetName: "lilbee-linux-x86_64",
            variant: "default",
            size: 0,
        });
        const { promise, root } = openModal();
        const btn = root.find("lilbee-managed-consent-btn-download")!;
        btn.trigger("click");
        // second click must not double-resolve
        btn.trigger("click");
        await expect(promise).resolves.toEqual({ kind: MANAGED_CONSENT_RESULT.DOWNLOAD });
    });

    it("External card click resolves with { kind: 'external' }", async () => {
        mockedGetLatestRelease.mockResolvedValue({
            tag: "v0",
            url: "",
            assetName: "lilbee-linux-x86_64",
            variant: "default",
            size: 0,
        });
        const { promise, root } = openModal();
        root.find("lilbee-managed-consent-card-external")!.trigger("click");
        await expect(promise).resolves.toEqual({ kind: MANAGED_CONSENT_RESULT.EXTERNAL });
    });

    it("Cancel button resolves with { kind: 'cancel' }", async () => {
        mockedGetLatestRelease.mockResolvedValue({
            tag: "v0",
            url: "",
            assetName: "lilbee-linux-x86_64",
            variant: "default",
            size: 0,
        });
        const { promise, root } = openModal();
        root.find("lilbee-managed-consent-btn-cancel")!.trigger("click");
        await expect(promise).resolves.toEqual({ kind: MANAGED_CONSENT_RESULT.CANCEL });
    });

    it("onClose without explicit choice resolves with { kind: 'cancel' }", async () => {
        mockedGetLatestRelease.mockResolvedValue({
            tag: "v0",
            url: "",
            assetName: "lilbee-linux-x86_64",
            variant: "default",
            size: 0,
        });
        const { modal, promise } = openModal();
        modal.close();
        await expect(promise).resolves.toEqual({ kind: MANAGED_CONSENT_RESULT.CANCEL });
    });

    it("does not overwrite the resolved DOM if release arrives after a choice was made", async () => {
        let resolveFn: (v: unknown) => void = () => {};
        mockedGetLatestRelease.mockReturnValue(new Promise((r) => (resolveFn = r)));
        const { promise, root } = openModal();
        root.find("lilbee-managed-consent-btn-download")!.trigger("click");
        resolveFn({ tag: "v0", url: "", assetName: "lilbee-linux-x86_64", variant: "default", size: 0 });
        await flush();
        await expect(promise).resolves.toEqual({ kind: MANAGED_CONSENT_RESULT.DOWNLOAD });
    });

    it("names the asset of the resolved build, so the name and the size agree", async () => {
        mockedGetLatestRelease.mockResolvedValue({
            tag: "v0",
            url: "",
            assetName: "lilbee-linux-x86_64-rocm",
            variant: "rocm",
            size: 897_000_000,
        });
        const { root } = openModal();
        await flush();

        expect(root.find("lilbee-managed-consent-prov-asset-name")?.textContent).toBe("lilbee-linux-x86_64-rocm");
        expect(root.find("lilbee-managed-consent-prov-asset-size")?.textContent).toContain("~855 MB");
    });

    it("renders '?' when the release reports a negative or missing size", async () => {
        mockedGetLatestRelease.mockResolvedValue({
            tag: "v0",
            url: "",
            assetName: "lilbee-linux-x86_64",
            variant: "default",
            size: -1,
        });
        const { root } = openModal();
        await flush();
        expect(root.find("lilbee-managed-consent-prov-asset-size")?.textContent).toContain("?");
    });

    it("does not overwrite the resolved DOM if release fetch fails after a choice was made", async () => {
        let rejectFn: (e: Error) => void = () => {};
        mockedGetLatestRelease.mockReturnValue(new Promise((_r, rj) => (rejectFn = rj)));
        const { promise, root } = openModal();
        root.find("lilbee-managed-consent-card-external")!.trigger("click");
        rejectFn(new Error("offline"));
        await flush();
        await expect(promise).resolves.toEqual({ kind: MANAGED_CONSENT_RESULT.EXTERNAL });
    });
});
