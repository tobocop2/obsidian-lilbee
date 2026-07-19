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

describe("server version picker with the real release list", () => {
    let dropdown: CapturedDropdown;
    let descs: string[];
    let originalAddDropdown: typeof Setting.prototype.addDropdown;
    let originalArch: PropertyDescriptor | undefined;

    beforeEach(() => {
        vi.restoreAllMocks();
        originalArch = Object.getOwnPropertyDescriptor(process, "arch");
        Object.defineProperty(process, "arch", { value: "x64", configurable: true });
        dropdown = { options: [], disabledStates: [], value: null };
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
        Setting.prototype.addDropdown = originalAddDropdown;
        if (originalArch) Object.defineProperty(process, "arch", originalArch);
    });

    async function renderPicker(includeDevBuilds: boolean): Promise<CapturedDropdown> {
        const plugin = {
            settings: { ...DEFAULT_SETTINGS, serverMode: SERVER_MODE.MANAGED, includeDevBuilds },
            getSharedLilbeeVersion: () => STABLE_RUN[0],
        } as unknown as LilbeePlugin;
        const tab = new LilbeeSettingTab(new App(), plugin);
        (tab as any).renderVersionSetting(new MockElement() as unknown as HTMLElement);
        await new Promise((resolve) => setTimeout(resolve, 0));
        return dropdown;
    }

    it("offers stable releases by default even when dev builds lead the release list", async () => {
        const dd = await renderPicker(false);

        expect(dd.options).toEqual(STABLE_RUN.slice(0, 10));
        expect(dd.disabledStates).toContain(false);
        expect(descs[descs.length - 1]).not.toBe(MESSAGES.DESC_SERVER_VERSION_LOADING);
    });

    it("offers dev and stable builds when dev builds are included", async () => {
        const dd = await renderPicker(true);

        expect(dd.options).toEqual([...DEV_RUN.slice(0, 10), ...STABLE_RUN.slice(0, 10)]);
        expect(dd.disabledStates).toContain(false);
    });
});
