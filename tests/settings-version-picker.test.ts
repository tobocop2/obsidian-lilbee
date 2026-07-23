import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { App, Setting } from "obsidian";
import { MockElement } from "./__mocks__/obsidian";
import { LilbeeSettingTab } from "../src/settings";
import { node } from "../src/binary-manager";
import { DEFAULT_SETTINGS, SERVER_MODE } from "../src/types";
import { MESSAGES } from "../src/locales/en";
import type LilbeePlugin from "../src/main";

/**
 * The release list tobocop2/lilbee serves: a run of published dev builds ahead
 * of the stable line, all on one GitHub page.
 */
const DEV_RUN = Array.from({ length: 14 }, (_, i) => `v0.6.90b420.dev${723 - i}`);
const STABLE_RUN = Array.from({ length: 12 }, (_, i) => `v0.6.66b${507 - i}`);

/** The setup file pins platform to linux; pin arch to x64 for a supported pair. */
const ASSET_NAME = "lilbee-linux-x86_64";

function ghRelease(tag: string) {
    return {
        tag_name: tag,
        assets: [
            {
                name: ASSET_NAME,
                browser_download_url: `https://example.com/${tag}`,
                size: 10,
                digest: null,
            },
        ],
    };
}

interface CapturedDropdown {
    options: string[];
    disabledStates: boolean[];
    value: string | null;
}

interface CapturedButton {
    labels: string[];
    disabledStates: boolean[];
    handler: (() => unknown) | null;
}

describe("server version picker with the real release list", () => {
    let dropdown: CapturedDropdown;
    let buttons: CapturedButton[];
    let descs: string[];
    let originalAddDropdown: typeof Setting.prototype.addDropdown;
    let originalAddButton: typeof Setting.prototype.addButton;
    let originalArch: PropertyDescriptor | undefined;

    beforeEach(() => {
        vi.restoreAllMocks();
        originalArch = Object.getOwnPropertyDescriptor(process, "arch");
        Object.defineProperty(process, "arch", { value: "x64", configurable: true });
        dropdown = { options: [], disabledStates: [], value: null };
        buttons = [];
        descs = [];

        originalAddDropdown = Setting.prototype.addDropdown;
        Setting.prototype.addDropdown = function (cb: (dd: any) => void) {
            const dd = {
                addOption: (v: string) => {
                    dropdown.options.push(v);
                    return dd;
                },
                addOptions: () => dd,
                setValue: (v: string) => {
                    dropdown.value = v;
                    return dd;
                },
                setDisabled: (d: boolean) => {
                    dropdown.disabledStates.push(d);
                    return dd;
                },
                onChange: () => dd,
            };
            cb(dd);
            return this;
        };
        originalAddButton = Setting.prototype.addButton;
        Setting.prototype.addButton = function (cb: (btn: any) => void) {
            const captured: CapturedButton = { labels: [], disabledStates: [], handler: null };
            const btn = {
                setButtonText: (t: string) => {
                    captured.labels.push(t);
                    return btn;
                },
                setDisabled: (d: boolean) => {
                    captured.disabledStates.push(d);
                    return btn;
                },
                onClick: (h: () => unknown) => {
                    captured.handler = h;
                    return btn;
                },
                buttonEl: { toggleClass: () => {}, addClass: () => {} },
            };
            buttons.push(captured);
            cb(btn);
            return this;
        };
        vi.spyOn(Setting.prototype, "setDesc").mockImplementation(function (desc) {
            descs.push(String(desc));
            return this;
        });

        vi.spyOn(node, "execFile").mockRejectedValue(new Error("nvidia-smi not found"));
        vi.spyOn(node, "requestUrl").mockResolvedValue({
            status: 200,
            json: [...DEV_RUN, ...STABLE_RUN].map(ghRelease),
            arrayBuffer: new ArrayBuffer(0),
            headers: {},
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        Setting.prototype.addDropdown = originalAddDropdown;
        Setting.prototype.addButton = originalAddButton;
        if (originalArch) Object.defineProperty(process, "arch", originalArch);
    });

    function makeTab(includeDevBuilds: boolean): LilbeeSettingTab {
        const plugin = {
            settings: { ...DEFAULT_SETTINGS, serverMode: SERVER_MODE.MANAGED, includeDevBuilds },
            getSharedLilbeeVersion: () => STABLE_RUN[0],
        } as unknown as LilbeePlugin;
        return new LilbeeSettingTab(new App(), plugin);
    }

    async function renderPicker(includeDevBuilds: boolean): Promise<CapturedDropdown> {
        const tab = makeTab(includeDevBuilds);
        (tab as any).renderVersionSetting(new MockElement() as unknown as HTMLElement);
        await new Promise((resolve) => setTimeout(resolve, 0));
        return dropdown;
    }

    it("offers stable releases by default even when dev builds lead the release list", async () => {
        const dd = await renderPicker(false);

        expect(dd.options).toEqual(STABLE_RUN.slice(0, 10));
        expect(dd.value).toBe(STABLE_RUN[0]);
        expect(dd.disabledStates).toContain(false);
        expect(descs[descs.length - 1]).not.toBe(MESSAGES.DESC_SERVER_VERSION_LOADING);
    });

    it("offers dev and stable builds when dev builds are included", async () => {
        const dd = await renderPicker(true);

        expect(dd.options).toEqual([...DEV_RUN.slice(0, 10), ...STABLE_RUN.slice(0, 10)]);
        expect(dd.value).toBe(STABLE_RUN[0]);
        expect(dd.disabledStates).toContain(false);
    });

    it("fetches the release list only once across repeated renders", async () => {
        const tab = makeTab(false);
        (tab as any).renderVersionSetting(new MockElement() as unknown as HTMLElement);
        await new Promise((resolve) => setTimeout(resolve, 0));
        (tab as any).renderVersionSetting(new MockElement() as unknown as HTMLElement);
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(node.requestUrl).toHaveBeenCalledTimes(1);
    });

    it("says why and offers a retry when the release list cannot be read", async () => {
        vi.spyOn(node, "requestUrl").mockRejectedValue(new Error("network down"));
        await renderPicker(false);

        const labels = buttons.flatMap((b) => b.labels);
        expect(labels).toContain("Retry");
    });

    it("names the GitHub rate limit when GitHub answers 403", async () => {
        vi.spyOn(node, "requestUrl").mockResolvedValue({
            status: 403,
            json: { message: "API rate limit exceeded for 1.2.3.4." },
            arrayBuffer: new ArrayBuffer(0),
            headers: {},
        });
        await renderPicker(false);

        expect(descs[descs.length - 1].toLowerCase()).toContain("rate limit");
    });
});
