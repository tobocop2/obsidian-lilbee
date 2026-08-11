import { describe, it, expect, beforeEach, vi } from "vitest";
import { App } from "obsidian";
import {
    AgentWiring,
    CLAUDIAN_OUTCOME,
    CLAUDE_MCP_CONFIG_PATH,
    CLAUDIAN_PLUGIN_ID,
    OPENCODE_CONFIG_PATH,
    agentModelKey,
    isClaudianInstalled,
    isClaudianLoaded,
    mergeClaudeConfig,
    mergeClaudianData,
    mergeOpencodeConfig,
    reloadClaudian,
} from "../src/agent-integration";
import { AGENT_CLIENT } from "../src/types";
import { ok, err } from "../src/result";
import type { LilbeeClient } from "../src/api";

/** The provider/mcp blocks the server builds, trimmed to the keys the merge cares about. */
const freshOpencode = (): Record<string, unknown> => ({
    $schema: "https://opencode.ai/config.json",
    provider: {
        lilbee: {
            npm: "@ai-sdk/openai-compatible",
            options: { baseURL: "http://127.0.0.1:7433/v1", apiKey: "token-b" },
        },
    },
    mcp: { lilbee: { type: "remote", url: "http://127.0.0.1:7433/mcp" } },
    model: "lilbee/Qwen3-8B",
});

const freshClaude = (): Record<string, unknown> => ({
    mcpServers: {
        lilbee: { type: "http", url: "http://127.0.0.1:7433/mcp", headers: { Authorization: "Bearer token-b" } },
    },
});

describe("mergeOpencodeConfig", () => {
    it("keeps every key the user already had", () => {
        const existing = {
            theme: "tokyonight",
            keybinds: { leader: "ctrl+x" },
            provider: { anthropic: { name: "Anthropic" } },
            mcp: { github: { type: "local" } },
        };
        const merged = mergeOpencodeConfig(existing, freshOpencode());

        expect(merged.theme).toBe("tokyonight");
        expect(merged.keybinds).toEqual({ leader: "ctrl+x" });
        expect((merged.provider as Record<string, unknown>).anthropic).toEqual({ name: "Anthropic" });
        expect((merged.mcp as Record<string, unknown>).github).toEqual({ type: "local" });
    });

    it("replaces lilbee's stale provider and mcp entries outright", () => {
        const existing = {
            provider: { lilbee: { options: { apiKey: "token-a", baseURL: "http://127.0.0.1:1111/v1" } } },
            mcp: { lilbee: { url: "http://127.0.0.1:1111/mcp" } },
        };
        const merged = mergeOpencodeConfig(existing, freshOpencode());

        const provider = (merged.provider as Record<string, Record<string, unknown>>).lilbee;
        expect(provider.options).toEqual({ baseURL: "http://127.0.0.1:7433/v1", apiKey: "token-b" });
        expect((merged.mcp as Record<string, Record<string, unknown>>).lilbee.url).toBe("http://127.0.0.1:7433/mcp");
    });

    it("writes the whole block when there is no existing file", () => {
        const merged = mergeOpencodeConfig(null, freshOpencode());
        expect(merged).toEqual(freshOpencode());
    });

    it("leaves a model the user pinned alone", () => {
        const merged = mergeOpencodeConfig({ model: "anthropic/claude-opus-4" }, freshOpencode());
        expect(merged.model).toBe("anthropic/claude-opus-4");
    });

    it("fills in the model only when the file has none", () => {
        expect(mergeOpencodeConfig({}, freshOpencode()).model).toBe("lilbee/Qwen3-8B");
    });

    it("omits the model when the server pinned none", () => {
        const fresh = freshOpencode();
        delete fresh.model;
        expect("model" in mergeOpencodeConfig({}, fresh)).toBe(false);
    });

    it("keeps a $schema the user set and adds one when absent", () => {
        expect(mergeOpencodeConfig({ $schema: "./local.json" }, freshOpencode()).$schema).toBe("./local.json");
        expect(mergeOpencodeConfig({}, freshOpencode()).$schema).toBe("https://opencode.ai/config.json");
    });

    it("does not add a $schema the server omitted", () => {
        const fresh = freshOpencode();
        delete fresh.$schema;
        expect("$schema" in mergeOpencodeConfig({}, fresh)).toBe(false);
    });

    it("replaces a malformed container instead of merging into it", () => {
        const merged = mergeOpencodeConfig({ provider: "broken", mcp: ["also broken"] }, freshOpencode());
        expect(merged.provider).toEqual({ lilbee: (freshOpencode().provider as Record<string, unknown>).lilbee });
        expect(merged.mcp).toEqual({ lilbee: (freshOpencode().mcp as Record<string, unknown>).lilbee });
    });

    it("leaves the user's containers untouched when the server omits lilbee's entry", () => {
        const existing = { provider: { anthropic: {} }, mcp: { github: {} } };
        const merged = mergeOpencodeConfig(existing, { provider: {}, mcp: "nonsense" });
        expect(merged.provider).toEqual({ anthropic: {} });
        expect(merged.mcp).toEqual({ github: {} });
    });
});

describe("mergeClaudeConfig", () => {
    it("merges lilbee into mcpServers without dropping other servers", () => {
        const merged = mergeClaudeConfig({ mcpServers: { github: { command: "gh" } } }, freshClaude());
        const servers = merged.mcpServers as Record<string, Record<string, unknown>>;
        expect(servers.github).toEqual({ command: "gh" });
        expect(servers.lilbee.url).toBe("http://127.0.0.1:7433/mcp");
    });

    it("writes the block when there is no existing file", () => {
        expect(mergeClaudeConfig(null, freshClaude())).toEqual(freshClaude());
    });
});

describe("agentModelKey", () => {
    it("reads the model the server pinned", () => {
        expect(agentModelKey(freshOpencode())).toBe("lilbee/Qwen3-8B");
    });

    it("is null when there is no usable model", () => {
        expect(agentModelKey({})).toBeNull();
        expect(agentModelKey({ model: 7 })).toBeNull();
        expect(agentModelKey({ model: "" })).toBeNull();
    });
});

describe("mergeClaudianData", () => {
    it("turns on the opencode provider and lists the model", () => {
        const merged = mergeClaudianData({ providerConfigs: { opencode: { enabled: false } } }, "lilbee/Qwen3-8B");
        const opencode = (merged as Record<string, Record<string, Record<string, unknown>>>).providerConfigs.opencode;
        expect(opencode.enabled).toBe(true);
        expect(opencode.visibleModels).toEqual(["lilbee/Qwen3-8B"]);
    });

    it("keeps Claudian's other settings and other providers", () => {
        const existing = {
            version: 3,
            providerConfigs: { anthropic: { enabled: true }, opencode: { enabled: false } },
        };
        const merged = mergeClaudianData(existing, "lilbee/Qwen3-8B") as Record<string, unknown>;
        expect(merged.version).toBe(3);
        expect((merged.providerConfigs as Record<string, unknown>).anthropic).toEqual({ enabled: true });
    });

    it("does not duplicate a model that is already visible", () => {
        const merged = mergeClaudianData(
            { providerConfigs: { opencode: { visibleModels: ["lilbee/Qwen3-8B", "other"] } } },
            "lilbee/Qwen3-8B",
        );
        const opencode = (merged as Record<string, Record<string, Record<string, unknown>>>).providerConfigs.opencode;
        expect(opencode.visibleModels).toEqual(["lilbee/Qwen3-8B", "other"]);
    });

    it("replaces a malformed visibleModels list", () => {
        const merged = mergeClaudianData({ providerConfigs: { opencode: { visibleModels: "oops" } } }, "m");
        const opencode = (merged as Record<string, Record<string, Record<string, unknown>>>).providerConfigs.opencode;
        expect(opencode.visibleModels).toEqual(["m"]);
    });

    it("creates the opencode entry when the provider list has none", () => {
        const merged = mergeClaudianData({ providerConfigs: {} }, "m");
        const opencode = (merged as Record<string, Record<string, Record<string, unknown>>>).providerConfigs.opencode;
        expect(opencode).toEqual({ enabled: true, visibleModels: ["m"] });
    });

    it("only enables the provider when there is no model to list", () => {
        const merged = mergeClaudianData({ providerConfigs: { opencode: {} } }, null);
        const opencode = (merged as Record<string, Record<string, Record<string, unknown>>>).providerConfigs.opencode;
        expect(opencode).toEqual({ enabled: true });
    });

    it("refuses a file that is not the shape lilbee knows", () => {
        expect(mergeClaudianData(null, "m")).toBeNull();
        expect(mergeClaudianData(["array"], "m")).toBeNull();
        expect(mergeClaudianData({ providerConfigs: "not an object" }, "m")).toBeNull();
    });

    it("treats a missing providerConfigs as a virgin install and creates it", () => {
        // Claudian prunes default-valued settings from disk, so a first-time
        // install has no providerConfigs key; the bridge must still configure it.
        const merged = mergeClaudianData({ somethingElse: 1 }, "lilbee/Qwen3-14B");
        expect(merged).not.toBeNull();
        const providerConfigs = merged?.providerConfigs as Record<string, Record<string, unknown>>;
        expect(providerConfigs.opencode.enabled).toBe(true);
        expect(providerConfigs.opencode.visibleModels).toEqual(["lilbee/Qwen3-14B"]);
        expect(merged?.somethingElse).toBe(1);
    });
});

describe("Claudian plugin probes", () => {
    let app: App;

    beforeEach(() => {
        app = new App();
    });

    it("reports installed only when the manifest is registered", () => {
        expect(isClaudianInstalled(app)).toBe(false);
        app.plugins = { manifests: { [CLAUDIAN_PLUGIN_ID]: { id: CLAUDIAN_PLUGIN_ID } } };
        expect(isClaudianInstalled(app)).toBe(true);
    });

    it("reports not installed when Obsidian exposes no plugin registry", () => {
        app.plugins = undefined;
        expect(isClaudianInstalled(app)).toBe(false);
        expect(isClaudianLoaded(app)).toBe(false);
    });

    it("reports loaded from the enabled set", () => {
        expect(isClaudianLoaded(app)).toBe(false);
        app.plugins = { enabledPlugins: new Set([CLAUDIAN_PLUGIN_ID]) };
        expect(isClaudianLoaded(app)).toBe(true);
    });

    it("reloads by toggling the plugin off and on", async () => {
        const disablePlugin = vi.fn().mockResolvedValue(undefined);
        const enablePlugin = vi.fn().mockResolvedValue(undefined);
        app.plugins = { disablePlugin, enablePlugin };
        await reloadClaudian(app);
        expect(disablePlugin).toHaveBeenCalledWith(CLAUDIAN_PLUGIN_ID);
        expect(enablePlugin).toHaveBeenCalledWith(CLAUDIAN_PLUGIN_ID);
    });

    it("does nothing when the registry cannot toggle plugins", async () => {
        app.plugins = { manifests: {} };
        await expect(reloadClaudian(app)).resolves.toBeUndefined();
        app.plugins = { disablePlugin: vi.fn() };
        await expect(reloadClaudian(app)).resolves.toBeUndefined();
    });
});

/** A vault whose files live in a plain map, so writes are observable. */
function fakeVault(app: App, files: Record<string, string>): void {
    app.vault.adapter.exists = vi.fn((path: string) => Promise.resolve(path in files));
    app.vault.adapter.read = vi.fn((path: string) => Promise.resolve(files[path]));
    app.vault.adapter.write = vi.fn((path: string, data: string) => {
        files[path] = data;
        return Promise.resolve();
    });
}

const claudianPath = `.obsidian/plugins/${CLAUDIAN_PLUGIN_ID}/data.json`;

function fakeApi(response: unknown, failure?: Error): LilbeeClient {
    return {
        getAgentConfig: vi.fn(() => Promise.resolve(failure ? err(failure) : ok(response))),
    } as unknown as LilbeeClient;
}

describe("AgentWiring.apply", () => {
    let app: App;
    let files: Record<string, string>;

    beforeEach(() => {
        app = new App();
        files = {};
        fakeVault(app, files);
    });

    it("writes opencode.json at the vault root", async () => {
        const api = fakeApi({ client: "opencode", format: "json", surfaces: [], config: freshOpencode() });
        const result = await new AgentWiring(app, api).apply(AGENT_CLIENT.OPENCODE);

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap().path).toBe(OPENCODE_CONFIG_PATH);
        expect(JSON.parse(files[OPENCODE_CONFIG_PATH])).toEqual(freshOpencode());
    });

    it("preserves foreign keys in an existing opencode.json", async () => {
        files[OPENCODE_CONFIG_PATH] = JSON.stringify({ theme: "gruvbox" });
        const api = fakeApi({ client: "opencode", format: "json", surfaces: [], config: freshOpencode() });
        await new AgentWiring(app, api).apply(AGENT_CLIENT.OPENCODE);

        expect(JSON.parse(files[OPENCODE_CONFIG_PATH]).theme).toBe("gruvbox");
    });

    it("writes .mcp.json for Claude Code and skips the Claudian bridge", async () => {
        const api = fakeApi({ client: "claude", format: "json", surfaces: [], config: freshClaude() });
        const result = await new AgentWiring(app, api).apply(AGENT_CLIENT.CLAUDE);

        expect(result._unsafeUnwrap().path).toBe(CLAUDE_MCP_CONFIG_PATH);
        expect(result._unsafeUnwrap().claudian).toBe(CLAUDIAN_OUTCOME.ABSENT);
        expect(JSON.parse(files[CLAUDE_MCP_CONFIG_PATH])).toEqual(freshClaude());
    });

    it("writes the http form, not the stdio alternative, when the server sends both", async () => {
        const api = fakeApi({
            client: "claude",
            format: "json",
            surfaces: ["mcp"],
            config: freshClaude(),
            stdio_config: { mcpServers: { lilbee: { command: "lilbee", args: ["mcp"] } } },
        });
        await new AgentWiring(app, api).apply(AGENT_CLIENT.CLAUDE);

        const servers = JSON.parse(files[CLAUDE_MCP_CONFIG_PATH]).mcpServers;
        expect(servers.lilbee.type).toBe("http");
        expect(servers.lilbee.command).toBeUndefined();
    });

    it("writes no file for hermes", async () => {
        const api = fakeApi({ client: "hermes", format: "yaml", surfaces: [], content: "models:\n" });
        const result = await new AgentWiring(app, api).apply(AGENT_CLIENT.HERMES);

        expect(result._unsafeUnwrap().path).toBeNull();
        expect(app.vault.adapter.write).not.toHaveBeenCalled();
    });

    it("surfaces the fetch failure", async () => {
        const api = fakeApi(null, new Error("connection refused"));
        const result = await new AgentWiring(app, api).apply(AGENT_CLIENT.OPENCODE);

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr().message).toBe("connection refused");
    });

    it("refuses to write when the server sent no config block", async () => {
        const api = fakeApi({ client: "opencode", format: "json", surfaces: [], config: null });
        const result = await new AgentWiring(app, api).apply(AGENT_CLIENT.OPENCODE);

        expect(result.isErr()).toBe(true);
        expect(app.vault.adapter.write).not.toHaveBeenCalled();
    });

    it("leaves a hand-broken config alone rather than clobbering it", async () => {
        files[OPENCODE_CONFIG_PATH] = "{ not json";
        const api = fakeApi({ client: "opencode", format: "json", surfaces: [], config: freshOpencode() });
        const result = await new AgentWiring(app, api).apply(AGENT_CLIENT.OPENCODE);

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr().message).toContain("not valid JSON");
        expect(files[OPENCODE_CONFIG_PATH]).toBe("{ not json");
    });

    it("leaves a config that is valid JSON but not an object alone", async () => {
        files[OPENCODE_CONFIG_PATH] = "[1, 2]";
        const api = fakeApi({ client: "opencode", format: "json", surfaces: [], config: freshOpencode() });
        const result = await new AgentWiring(app, api).apply(AGENT_CLIENT.OPENCODE);

        expect(result.isErr()).toBe(true);
        expect(files[OPENCODE_CONFIG_PATH]).toBe("[1, 2]");
    });

    it("reports an unreadable file", async () => {
        app.vault.adapter.exists = vi.fn().mockResolvedValue(true);
        app.vault.adapter.read = vi.fn().mockRejectedValue(new Error("EACCES"));
        const api = fakeApi({ client: "opencode", format: "json", surfaces: [], config: freshOpencode() });
        const result = await new AgentWiring(app, api).apply(AGENT_CLIENT.OPENCODE);

        expect(result._unsafeUnwrapErr().message).toBe("EACCES");
    });

    it("reports a failed write", async () => {
        app.vault.adapter.write = vi.fn().mockRejectedValue(new Error("ENOSPC"));
        const api = fakeApi({ client: "opencode", format: "json", surfaces: [], config: freshOpencode() });
        const result = await new AgentWiring(app, api).apply(AGENT_CLIENT.OPENCODE);

        expect(result._unsafeUnwrapErr().message).toBe("ENOSPC");
    });

    it("describes a write failure that was not thrown as an Error", async () => {
        app.vault.adapter.write = vi.fn().mockRejectedValue("disk full");
        const api = fakeApi({ client: "opencode", format: "json", surfaces: [], config: freshOpencode() });
        const result = await new AgentWiring(app, api).apply(AGENT_CLIENT.OPENCODE);

        expect(result._unsafeUnwrapErr().message).toBe("disk full");
    });

    it("describes a read failure that was not thrown as an Error", async () => {
        app.vault.adapter.exists = vi.fn().mockResolvedValue(true);
        app.vault.adapter.read = vi.fn().mockRejectedValue("EPERM");
        const api = fakeApi({ client: "opencode", format: "json", surfaces: [], config: freshOpencode() });
        const result = await new AgentWiring(app, api).apply(AGENT_CLIENT.OPENCODE);

        expect(result._unsafeUnwrapErr().message).toBe("EPERM");
    });
});

describe("AgentWiring Claudian bridge", () => {
    let app: App;
    let files: Record<string, string>;
    let api: LilbeeClient;

    beforeEach(() => {
        app = new App();
        files = {};
        fakeVault(app, files);
        app.plugins = { manifests: { [CLAUDIAN_PLUGIN_ID]: { id: CLAUDIAN_PLUGIN_ID } } };
        api = fakeApi({ client: "opencode", format: "json", surfaces: [], config: freshOpencode() });
    });

    it("enables the opencode provider and lists the chat model", async () => {
        files[claudianPath] = JSON.stringify({ providerConfigs: { opencode: { enabled: false } } });
        const result = await new AgentWiring(app, api).apply(AGENT_CLIENT.OPENCODE);

        expect(result._unsafeUnwrap().claudian).toBe(CLAUDIAN_OUTCOME.WRITTEN);
        const data = JSON.parse(files[claudianPath]);
        expect(data.providerConfigs.opencode.enabled).toBe(true);
        expect(data.providerConfigs.opencode.visibleModels).toEqual(["lilbee/Qwen3-8B"]);
    });

    it("skips silently when Claudian's data file is not the expected shape", async () => {
        // providerConfigs present but wrong-typed is the unknown-shape case;
        // an absent key is a virgin install and gets configured instead.
        files[claudianPath] = JSON.stringify({ providerConfigs: "corrupted" });
        const result = await new AgentWiring(app, api).apply(AGENT_CLIENT.OPENCODE);

        expect(result._unsafeUnwrap().claudian).toBe(CLAUDIAN_OUTCOME.SKIPPED);
        expect(JSON.parse(files[claudianPath])).toEqual({ providerConfigs: "corrupted" });
    });

    it("skips when Claudian has not written its data file yet", async () => {
        const result = await new AgentWiring(app, api).apply(AGENT_CLIENT.OPENCODE);
        expect(result._unsafeUnwrap().claudian).toBe(CLAUDIAN_OUTCOME.SKIPPED);
    });

    it("skips when the data file cannot be parsed", async () => {
        files[claudianPath] = "{{{";
        const result = await new AgentWiring(app, api).apply(AGENT_CLIENT.OPENCODE);
        expect(result._unsafeUnwrap().claudian).toBe(CLAUDIAN_OUTCOME.SKIPPED);
    });

    it("skips when the data file cannot be written", async () => {
        files[claudianPath] = JSON.stringify({ providerConfigs: {} });
        app.vault.adapter.write = vi.fn((path: string) => {
            if (path === claudianPath) return Promise.reject(new Error("read-only"));
            return Promise.resolve();
        });
        const result = await new AgentWiring(app, api).apply(AGENT_CLIENT.OPENCODE);
        expect(result._unsafeUnwrap().claudian).toBe(CLAUDIAN_OUTCOME.SKIPPED);
    });

    it("reports no change when Claudian is already set up", async () => {
        files[claudianPath] = JSON.stringify({
            providerConfigs: { opencode: { enabled: true, visibleModels: ["lilbee/Qwen3-8B"] } },
        });
        const before = files[claudianPath];
        const result = await new AgentWiring(app, api).apply(AGENT_CLIENT.OPENCODE);

        expect(result._unsafeUnwrap().claudian).toBe(CLAUDIAN_OUTCOME.UNCHANGED);
        expect(files[claudianPath]).toBe(before);
    });

    it("does nothing when Claudian is not installed", async () => {
        app.plugins = { manifests: {} };
        const result = await new AgentWiring(app, api).apply(AGENT_CLIENT.OPENCODE);
        expect(result._unsafeUnwrap().claudian).toBe(CLAUDIAN_OUTCOME.ABSENT);
    });

    it("honours a vault with a renamed config directory", async () => {
        app.vault.configDir = ".obsidian-custom";
        const path = `.obsidian-custom/plugins/${CLAUDIAN_PLUGIN_ID}/data.json`;
        files[path] = JSON.stringify({ providerConfigs: {} });
        const result = await new AgentWiring(app, api).apply(AGENT_CLIENT.OPENCODE);

        expect(result._unsafeUnwrap().claudian).toBe(CLAUDIAN_OUTCOME.WRITTEN);
        expect(JSON.parse(files[path]).providerConfigs.opencode.enabled).toBe(true);
    });
});
