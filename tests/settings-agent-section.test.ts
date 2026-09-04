/** Tests for the "Agent integration" section of the Settings panel. */
import { vi, describe, it, expect, beforeEach } from "vitest";
import { App, MockElement, Notice, Setting } from "./__mocks__/obsidian";
import { LilbeeSettingTab } from "../src/settings";
import { DEFAULT_SETTINGS, type AgentClientDetection, type LilbeeSettings } from "../src/types";
import { ok, err } from "../src/result";
import { TaskQueue } from "../src/task-queue";
import { ErrorJournal } from "../src/error-journal";
import { AGENT_LINKS, MESSAGES } from "../src/locales/en";

vi.mock("../src/server-binary", () => ({
    listReleases: vi.fn(async () => []),
    isDevBuild: (tag: string) => /\.dev\d*$/i.test(tag),
    isDownloadCanceled: () => false,
    DownloadCanceledError: class DownloadCanceledError extends Error {},
}));
vi.mock("../src/node", () => ({
    node: {},
}));

const mockModelPickerOpen = vi.fn();
vi.mock("../src/views/model-picker-modal", () => ({
    ModelPickerModal: vi.fn().mockImplementation(function () {
        return { open: mockModelPickerOpen };
    }),
}));
vi.mock("../src/views/catalog-modal", () => ({
    CatalogModal: vi.fn().mockImplementation(function () {
        return { open: vi.fn() };
    }),
}));

const detection = (client: string, cli_detected: boolean): AgentClientDetection =>
    ({ client, cli_detected, cli_path: cli_detected ? `/usr/bin/${client}` : null }) as AgentClientDetection;

const DETECTED_INDEX = ok({
    clients: [detection("claude", true), detection("hermes", false), detection("opencode", true)],
});

function makePlugin(agentIntegration: Partial<LilbeeSettings["agentIntegration"]> = {}, over: any = {}) {
    return {
        settings: {
            ...DEFAULT_SETTINGS,
            agentIntegration: { ...DEFAULT_SETTINGS.agentIntegration, ...agentIntegration },
        },
        journal: new ErrorJournal(),
        api: {
            getAgentConfigIndex: vi.fn().mockResolvedValue(DETECTED_INDEX),
            getAgentConfig: vi.fn().mockResolvedValue(ok({ client: "hermes", format: "yaml", content: "models:\n" })),
            health: vi.fn().mockResolvedValue(ok({ status: "ok", version: "1", chat_ctx: 32768 })),
        },
        activeModel: "unsloth/Qwen3-8B-GGUF:Q4_K_M",
        lastAgentWrite: null,
        serverManager: { serverUrl: "http://127.0.0.1:54321" },
        applyAgentWiring: vi.fn().mockResolvedValue(undefined),
        persistAgentIntegration: vi.fn().mockResolvedValue(undefined),
        taskQueue: new TaskQueue(),
        ...over,
    } as unknown as InstanceType<typeof import("../src/main").default>;
}

interface Captured {
    /** Row labels, which the Setting mock stores rather than rendering. */
    names: string[];
    dropdowns: any[];
    toggles: any[];
    buttons: { label: string; click: () => void | Promise<void> }[];
}

/** Render the agent section and capture the interactive components it built. */
async function renderSection(plugin: any, app = new App()): Promise<{ root: MockElement; captured: Captured }> {
    const captured: Captured = { names: [], dropdowns: [], toggles: [], buttons: [] };
    const origName = Setting.prototype.setName;
    const origDropdown = Setting.prototype.addDropdown;
    const origToggle = Setting.prototype.addToggle;
    const origButton = Setting.prototype.addButton;
    Setting.prototype.setName = function (name: string) {
        captured.names.push(name);
        return origName.call(this, name);
    };
    Setting.prototype.addDropdown = function (cb: any) {
        return origDropdown.call(this, (d: any) => {
            captured.dropdowns.push(d);
            cb(d);
        });
    };
    Setting.prototype.addToggle = function (cb: any) {
        return origToggle.call(this, (t: any) => {
            captured.toggles.push(t);
            cb(t);
        });
    };
    Setting.prototype.addButton = function (cb: any) {
        return origButton.call(this, (b: any) => {
            cb(b);
            captured.buttons.push({ label: b.text, click: () => b.triggerClick() });
        });
    };

    const tab = new LilbeeSettingTab(app as any, plugin);
    const root = new MockElement("div");
    try {
        (tab as any).renderAgentIntegration(root as unknown as HTMLElement);
        await flush();
    } finally {
        Setting.prototype.setName = origName;
        Setting.prototype.addDropdown = origDropdown;
        Setting.prototype.addToggle = origToggle;
        Setting.prototype.addButton = origButton;
    }
    return { root, captured };
}

/** Settle the fire-and-forget detection and health fetches. */
const flush = async (): Promise<void> => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
};

beforeEach(() => {
    vi.clearAllMocks();
    Notice.clear();
});

describe("agent detection", () => {
    it("lists where to get every supported agent", async () => {
        const { root } = await renderSection(makePlugin());
        expect(root.findAll("lilbee-external-link")).toHaveLength(AGENT_LINKS.length);
    });

    it("offers only none in the dropdown when nothing is installed", async () => {
        const plugin = makePlugin();
        plugin.api.getAgentConfigIndex = vi.fn().mockResolvedValue(ok({ clients: [detection("opencode", false)] }));
        const { root, captured } = await renderSection(plugin);

        expect(captured.dropdowns[0].options).toEqual(["none"]);
        expect(root.findAll("lilbee-external-link")).toHaveLength(3);
    });

    it("never offers to install an agent itself", async () => {
        const plugin = makePlugin();
        plugin.api.getAgentConfigIndex = vi.fn().mockResolvedValue(ok({ clients: [detection("opencode", false)] }));
        const { captured } = await renderSection(plugin);

        expect(captured.buttons.map((b) => b.label)).toEqual([MESSAGES.BUTTON_AGENT_RESCAN]);
    });

    it("explains itself when the server cannot be reached", async () => {
        const plugin = makePlugin();
        plugin.api.getAgentConfigIndex = vi.fn().mockResolvedValue(err(new Error("offline")));
        const { root, captured } = await renderSection(plugin);

        expect(root.textContent).toContain(MESSAGES.AGENT_DETECT_UNAVAILABLE);
        expect(captured.buttons.map((b) => b.label)).toContain(MESSAGES.BUTTON_AGENT_RESCAN);
    });

    it("reuses the last probe instead of re-asking on every render", async () => {
        const plugin = makePlugin();
        const tab = new LilbeeSettingTab(new App() as any, plugin);
        const root = new MockElement("div");
        (tab as any).renderAgentIntegration(root as unknown as HTMLElement);
        await flush();
        (tab as any).renderAgentIntegration(new MockElement("div") as unknown as HTMLElement);
        await flush();

        expect(plugin.api.getAgentConfigIndex).toHaveBeenCalledTimes(1);
    });

    it("re-probes when the user rescans", async () => {
        const plugin = makePlugin();
        const { captured } = await renderSection(plugin);
        const rescan = captured.buttons.find((b) => b.label === MESSAGES.BUTTON_AGENT_RESCAN);
        await rescan!.click();
        await flush();

        expect(plugin.api.getAgentConfigIndex).toHaveBeenCalledTimes(2);
    });
});

describe("agent selection", () => {
    it("offers none plus each installed client", async () => {
        const { captured } = await renderSection(makePlugin());
        expect(captured.dropdowns[0].options).toEqual(["none", "claude", "opencode"]);
    });

    it("wires the agent the user picks", async () => {
        const plugin = makePlugin();
        const { captured } = await renderSection(plugin);
        await captured.dropdowns[0].triggerChange("opencode");

        expect(plugin.settings.agentIntegration.agent).toBe("opencode");
        expect(plugin.settings.agentIntegration.pickerShown).toBe(true);
        expect(plugin.applyAgentWiring).toHaveBeenCalledWith("opencode");
    });

    it("writes nothing when the user picks none", async () => {
        const plugin = makePlugin({ agent: "opencode" });
        const { captured } = await renderSection(plugin);
        await captured.dropdowns[0].triggerChange("none");

        expect(plugin.settings.agentIntegration.agent).toBe("none");
        expect(plugin.applyAgentWiring).not.toHaveBeenCalled();
    });

    it("hides the per-agent rows until an agent is chosen", async () => {
        const { root, captured } = await renderSection(makePlugin());
        expect(root.find("lilbee-pill-context")).toBeNull();
        expect(captured.names).not.toContain(MESSAGES.LABEL_AGENT_CLAUDIAN);
    });

    it("persists the keep-connected toggle", async () => {
        const plugin = makePlugin({ agent: "claude" });
        const { captured } = await renderSection(plugin);
        await captured.toggles[0].triggerChange(false);

        expect(plugin.settings.agentIntegration.keepConfigFresh).toBe(false);
        expect(plugin.persistAgentIntegration).toHaveBeenCalled();
    });
});

describe("agent model row", () => {
    it("shows the chat model and its context window", async () => {
        const { root } = await renderSection(makePlugin({ agent: "opencode" }));
        const context = root.find("lilbee-pill-context");

        expect(context?.textContent).toContain(MESSAGES.AGENT_CONTEXT_BADGE(32768));
        expect(root.find("lilbee-agent-note")).toBeNull();
    });

    it("warns when the window is too small for agent work", async () => {
        const plugin = makePlugin({ agent: "opencode" });
        plugin.api.health = vi.fn().mockResolvedValue(ok({ status: "ok", version: "1", chat_ctx: 8192 }));
        const { root } = await renderSection(plugin);

        expect(root.find("lilbee-agent-note")?.textContent).toBe(MESSAGES.AGENT_CONTEXT_WARNING);
    });

    it("shows no context pill when the window is unknown", async () => {
        const plugin = makePlugin({ agent: "opencode" });
        plugin.api.health = vi.fn().mockResolvedValue(ok({ status: "ok", version: "1", chat_ctx: null }));
        const { root } = await renderSection(plugin);

        expect(root.find("lilbee-pill-context")).toBeNull();
        expect(root.find("lilbee-agent-note")).toBeNull();
    });

    it("shows no context pill when the server cannot be asked", async () => {
        const plugin = makePlugin({ agent: "opencode" });
        plugin.api.health = vi.fn().mockResolvedValue(err(new Error("offline")));
        const { root } = await renderSection(plugin);

        expect(root.find("lilbee-pill-context")).toBeNull();
    });

    it("changes the model through the existing picker", async () => {
        const { captured } = await renderSection(makePlugin({ agent: "opencode" }));
        const change = captured.buttons.find((b) => b.label === MESSAGES.BUTTON_AGENT_CHANGE_MODEL);
        change!.click();

        expect(mockModelPickerOpen).toHaveBeenCalled();
    });
});

describe("Claudian row", () => {
    function appWithClaudian(installed: boolean): App {
        const app = new App();
        app.plugins = { manifests: installed ? { realclaudian: { id: "realclaudian" } } : {} };
        return app;
    }

    it("points at the community store when Claudian is absent", async () => {
        const { captured } = await renderSection(makePlugin({ agent: "opencode" }), appWithClaudian(false));

        expect(captured.names).toContain(MESSAGES.LABEL_AGENT_CLAUDIAN);
        expect(captured.buttons.map((b) => b.label)).not.toContain(MESSAGES.BUTTON_OPEN_CLAUDIAN);
    });

    it("confirms the bridge is set up and opens Claudian", async () => {
        const app = appWithClaudian(true);
        app.setting = { open: vi.fn(), openTabById: vi.fn(), close: vi.fn() };
        const { root, captured } = await renderSection(makePlugin({ agent: "opencode" }), app);

        expect(root.textContent).toContain(MESSAGES.PILL_AGENT_CLAUDIAN_CONFIGURED);
        captured.buttons.find((b) => b.label === MESSAGES.BUTTON_OPEN_CLAUDIAN)!.click();
        expect(app.setting!.openTabById).toHaveBeenCalledWith("realclaudian");
    });

    it("hands setup back to the user when Claudian's file was skipped", async () => {
        const plugin = makePlugin({ agent: "opencode" }, { lastAgentWrite: { claudian: "skipped" } });
        const { root } = await renderSection(plugin, appWithClaudian(true));

        const pills = root.findAll("lilbee-key-status-pill").map((p) => p.textContent);
        expect(pills).not.toContain(MESSAGES.PILL_AGENT_CLAUDIAN_CONFIGURED);
    });

    it("is not shown for an agent that brings its own models", async () => {
        const { captured } = await renderSection(makePlugin({ agent: "claude" }), appWithClaudian(true));
        expect(captured.names).not.toContain(MESSAGES.LABEL_AGENT_CLAUDIAN);
    });
});

describe("config freshness", () => {
    it("says the agent is connected once its config is written", async () => {
        const plugin = makePlugin(
            { agent: "opencode" },
            { lastAgentWrite: { claudian: "absent", writtenAt: Date.now() } },
        );
        const { root } = await renderSection(plugin);

        expect(root.find("lilbee-agent-status")?.textContent).toBe(MESSAGES.AGENT_STATUS_CONNECTED);
    });

    it("says the config lands at startup before anything is written", async () => {
        const { root } = await renderSection(makePlugin({ agent: "claude" }));
        expect(root.find("lilbee-agent-status")?.textContent).toBe(MESSAGES.AGENT_STATUS_PENDING);
    });
});

describe("hermes config block", () => {
    it("offers the config to copy instead of writing a file", async () => {
        const { root } = await renderSection(makePlugin({ agent: "hermes" }));

        expect(root.find("lilbee-agent-status")?.textContent).toBe(MESSAGES.AGENT_STATUS_GLOBAL);
        expect(root.find("lilbee-agent-config-block")?.textContent).toBe("models:\n");
    });

    it("copies the block to the clipboard", async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal("navigator", { clipboard: { writeText } });
        const { captured } = await renderSection(makePlugin({ agent: "hermes" }));

        captured.buttons.find((b) => b.label === MESSAGES.BUTTON_AGENT_COPY)!.click();

        expect(writeText).toHaveBeenCalledWith("models:\n");
        expect(Notice.instances[0].message).toBe(MESSAGES.NOTICE_AGENT_COPIED);
        vi.unstubAllGlobals();
    });

    it("shows an empty block when the server cannot supply one", async () => {
        const plugin = makePlugin({ agent: "hermes" });
        plugin.api.getAgentConfig = vi.fn().mockResolvedValue(err(new Error("offline")));
        const { root } = await renderSection(plugin);

        expect(root.find("lilbee-agent-config-block")?.textContent).toBe("");
    });
});

describe("defensive rendering", () => {
    it("does nothing when there is no section body to draw into", () => {
        const tab = new LilbeeSettingTab(new App() as any, makePlugin());
        expect(() => (tab as any).renderAgentBody()).not.toThrow();
    });

    it("says the model is unset when no chat model is active", async () => {
        const plugin = makePlugin({ agent: "opencode" }, { activeModel: "" });
        const { captured } = await renderSection(plugin);

        expect(captured.names).toContain(MESSAGES.LABEL_AGENT_MODEL);
    });

    it("shows an empty block when the server sends no hermes content", async () => {
        const plugin = makePlugin({ agent: "hermes" });
        plugin.api.getAgentConfig = vi.fn().mockResolvedValue(ok({ client: "hermes", format: "yaml" }));
        const { root } = await renderSection(plugin);

        expect(root.find("lilbee-agent-config-block")?.textContent).toBe("");
    });

    it("opens an agent's home page in the browser", async () => {
        const open = vi.fn();
        vi.stubGlobal("window", { ...globalThis.window, open });
        const plugin = makePlugin();
        plugin.api.getAgentConfigIndex = vi.fn().mockResolvedValue(ok({ clients: [detection("opencode", false)] }));
        const { root } = await renderSection(plugin);

        root.findAll("lilbee-external-link")[0].trigger("click", { preventDefault: vi.fn() });

        expect(open).toHaveBeenCalledWith("https://opencode.ai", "_blank");
        vi.unstubAllGlobals();
    });
});
