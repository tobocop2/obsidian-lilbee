import { App, DataAdapter } from "obsidian";
import { LilbeeClient } from "./api";
import { MESSAGES } from "./locales/en";
import { AGENT_CLIENT, type AgentClient } from "./types";
import { ok, err, Result } from "./result";

/** opencode reads this from the directory it is launched in, so it lives at the vault root. */
export const OPENCODE_CONFIG_PATH = "opencode.json";
/** Claude Code's project-scoped MCP registration, also read from the working directory. */
export const CLAUDE_MCP_CONFIG_PATH = ".mcp.json";
export const CLAUDIAN_PLUGIN_ID = "realclaudian";
/** The key lilbee owns inside every agent config container it merges into. */
const LILBEE_KEY = "lilbee";
const PROVIDER_KEY = "provider";
const MCP_KEY = "mcp";
const MCP_SERVERS_KEY = "mcpServers";
const MODEL_KEY = "model";
const SCHEMA_KEY = "$schema";

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The existing container at *key*, or a fresh object when it is missing or malformed. */
function containerAt(source: Record<string, unknown>, key: string): Record<string, unknown> {
    const existing = source[key];
    return isRecord(existing) ? { ...existing } : {};
}

/** Replace only lilbee's entry inside `target[key]`, leaving the user's other entries alone. */
function adoptLilbeeEntry(target: Record<string, unknown>, fresh: Record<string, unknown>, key: string): void {
    const freshContainer = fresh[key];
    if (!isRecord(freshContainer) || !(LILBEE_KEY in freshContainer)) return;
    const merged = containerAt(target, key);
    merged[LILBEE_KEY] = freshContainer[LILBEE_KEY];
    target[key] = merged;
}

/**
 * Fold the server's opencode block into the user's `opencode.json`.
 *
 * lilbee owns `provider.lilbee` and `mcp.lilbee` and overwrites them outright —
 * they carry the port and token, which change every boot. Everything else in the
 * file survives, and `model` is only filled in when the user has not pinned one.
 */
export function mergeOpencodeConfig(
    existing: Record<string, unknown> | null,
    fresh: Record<string, unknown>,
): Record<string, unknown> {
    const merged: Record<string, unknown> = { ...(existing ?? {}) };
    if (merged[SCHEMA_KEY] === undefined && fresh[SCHEMA_KEY] !== undefined) {
        merged[SCHEMA_KEY] = fresh[SCHEMA_KEY];
    }
    adoptLilbeeEntry(merged, fresh, PROVIDER_KEY);
    adoptLilbeeEntry(merged, fresh, MCP_KEY);
    if (merged[MODEL_KEY] === undefined && fresh[MODEL_KEY] !== undefined) {
        merged[MODEL_KEY] = fresh[MODEL_KEY];
    }
    return merged;
}

/** Fold the server's `mcpServers.lilbee` block into the user's `.mcp.json`. */
export function mergeClaudeConfig(
    existing: Record<string, unknown> | null,
    fresh: Record<string, unknown>,
): Record<string, unknown> {
    const merged: Record<string, unknown> = { ...(existing ?? {}) };
    adoptLilbeeEntry(merged, fresh, MCP_SERVERS_KEY);
    return merged;
}

/**
 * The `provider/model-id` string opencode starts on, which is also the key
 * Claudian lists in `visibleModels`. Null when the server pinned no default.
 */
export function agentModelKey(config: Record<string, unknown>): string | null {
    const model = config[MODEL_KEY];
    return typeof model === "string" && model !== "" ? model : null;
}

/**
 * Turn on Claudian's opencode provider without disturbing the rest of its data.
 *
 * Returns null when the file is not the shape this expects — Claudian owns that
 * file and a blind write would corrupt its settings, so the caller points the
 * user at Claudian's own settings instead.
 */
export function mergeClaudianData(existing: unknown, modelKey: string | null): Record<string, unknown> | null {
    if (!isRecord(existing)) return null;
    // Claudian prunes default-valued settings from disk, so a virgin install
    // has no providerConfigs key at all. Absent means "defaults", which is a
    // shape this merge understands; refuse only a key that exists with a
    // shape it does not.
    const providerConfigs = existing.providerConfigs === undefined ? {} : existing.providerConfigs;
    if (!isRecord(providerConfigs)) return null;

    const opencode = containerAt(providerConfigs, AGENT_CLIENT.OPENCODE);
    opencode.enabled = true;
    if (modelKey !== null) {
        const visible = opencode.visibleModels;
        const models = Array.isArray(visible) ? [...(visible as unknown[])] : [];
        if (!models.includes(modelKey)) models.push(modelKey);
        opencode.visibleModels = models;
    }
    return {
        ...existing,
        providerConfigs: { ...providerConfigs, [AGENT_CLIENT.OPENCODE]: opencode },
    };
}

/** Obsidian's undocumented-but-stable plugin registry, used to detect and reload Claudian. */
interface PluginsApi {
    manifests?: Record<string, unknown>;
    enabledPlugins?: Set<string>;
    disablePlugin?: (id: string) => Promise<void>;
    enablePlugin?: (id: string) => Promise<void>;
}

function pluginsApi(app: App): PluginsApi | null {
    return (app as unknown as { plugins?: PluginsApi }).plugins ?? null;
}

export function isClaudianInstalled(app: App): boolean {
    const manifests = pluginsApi(app)?.manifests;
    return isRecord(manifests) && CLAUDIAN_PLUGIN_ID in manifests;
}

export function isClaudianLoaded(app: App): boolean {
    return pluginsApi(app)?.enabledPlugins?.has(CLAUDIAN_PLUGIN_ID) === true;
}

/** Toggle Claudian off and on so it re-reads the data file lilbee just changed. */
export async function reloadClaudian(app: App): Promise<void> {
    const plugins = pluginsApi(app);
    if (!plugins?.disablePlugin || !plugins.enablePlugin) return;
    await plugins.disablePlugin(CLAUDIAN_PLUGIN_ID);
    await plugins.enablePlugin(CLAUDIAN_PLUGIN_ID);
}

/** What happened to Claudian's data file during a wiring pass. */
export type ClaudianOutcome = "absent" | "written" | "unchanged" | "skipped";

export const CLAUDIAN_OUTCOME = {
    /** Claudian is not installed, so there was nothing to bridge. */
    ABSENT: "absent",
    WRITTEN: "written",
    UNCHANGED: "unchanged",
    /** Installed, but its data file is not the shape lilbee knows how to edit. */
    SKIPPED: "skipped",
} as const satisfies Record<string, ClaudianOutcome>;

export interface AgentWireOutcome {
    client: AgentClient;
    /** Vault-relative file written, or null for a client whose config is global. */
    path: string | null;
    claudian: ClaudianOutcome;
    writtenAt: number;
}

/** Writes the server's agent config into the vault, merging rather than replacing. */
export class AgentWiring {
    private adapter: DataAdapter;

    constructor(
        private app: App,
        private api: LilbeeClient,
    ) {
        this.adapter = app.vault.adapter;
    }

    /** Fetch *client*'s config and write it where that client looks for it. */
    async apply(client: AgentClient): Promise<Result<AgentWireOutcome, Error>> {
        const fetched = await this.api.getAgentConfig(client);
        if (fetched.isErr()) return err(fetched.error);
        const config = fetched.value.config;

        if (client === AGENT_CLIENT.HERMES) {
            // hermes reads a single global config.yaml, so there is no vault file
            // to own; the settings row offers the block to copy instead.
            return ok(this.outcome(client, null, CLAUDIAN_OUTCOME.ABSENT));
        }
        if (!isRecord(config)) {
            return err(new Error(MESSAGES.ERROR_AGENT_CONFIG_EMPTY(client)));
        }

        const path = client === AGENT_CLIENT.OPENCODE ? OPENCODE_CONFIG_PATH : CLAUDE_MCP_CONFIG_PATH;
        const existing = await this.readJson(path);
        if (existing.isErr()) return err(existing.error);

        const merged =
            client === AGENT_CLIENT.OPENCODE
                ? mergeOpencodeConfig(existing.value, config)
                : mergeClaudeConfig(existing.value, config);
        try {
            await this.writeJson(path, merged);
        } catch (e) {
            return err(e instanceof Error ? e : new Error(String(e)));
        }

        const claudian =
            client === AGENT_CLIENT.OPENCODE ? await this.syncClaudian(agentModelKey(config)) : CLAUDIAN_OUTCOME.ABSENT;
        return ok(this.outcome(client, path, claudian));
    }

    private outcome(client: AgentClient, path: string | null, claudian: ClaudianOutcome): AgentWireOutcome {
        return { client, path, claudian, writtenAt: Date.now() };
    }

    /** Point Claudian's opencode provider at lilbee's models. Never fails the wiring. */
    private async syncClaudian(modelKey: string | null): Promise<ClaudianOutcome> {
        if (!isClaudianInstalled(this.app)) return CLAUDIAN_OUTCOME.ABSENT;
        const path = `${this.app.vault.configDir}/plugins/${CLAUDIAN_PLUGIN_ID}/data.json`;
        const existing = await this.readJson(path);
        if (existing.isErr()) return CLAUDIAN_OUTCOME.SKIPPED;
        const merged = mergeClaudianData(existing.value, modelKey);
        if (merged === null) return CLAUDIAN_OUTCOME.SKIPPED;
        if (JSON.stringify(merged) === JSON.stringify(existing.value)) return CLAUDIAN_OUTCOME.UNCHANGED;
        try {
            await this.writeJson(path, merged);
        } catch {
            return CLAUDIAN_OUTCOME.SKIPPED;
        }
        return CLAUDIAN_OUTCOME.WRITTEN;
    }

    /** Null when the file is absent; an error when it exists but cannot be parsed. */
    private async readJson(path: string): Promise<Result<Record<string, unknown> | null, Error>> {
        if (!(await this.adapter.exists(path))) return ok(null);
        let raw: string;
        try {
            raw = await this.adapter.read(path);
        } catch (e) {
            return err(e instanceof Error ? e : new Error(String(e)));
        }
        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch {
            // Overwriting a file the user hand-edited into a broken state would
            // destroy work; refuse and let them fix it.
            return err(new Error(MESSAGES.ERROR_AGENT_CONFIG_UNREADABLE(path)));
        }
        if (!isRecord(parsed)) return err(new Error(MESSAGES.ERROR_AGENT_CONFIG_UNREADABLE(path)));
        return ok(parsed);
    }

    private async writeJson(path: string, value: Record<string, unknown>): Promise<void> {
        await this.adapter.write(path, `${JSON.stringify(value, null, 2)}\n`);
    }
}
