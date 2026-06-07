import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { App, Notice, MockElement } from "../__mocks__/obsidian";
import { ModelPickerModal, filterRowsByText, SET_MODEL_RETRIES } from "../../src/views/model-picker-modal";
import type { CatalogEntry } from "../../src/types";
import { ok, err } from "../../src/result";
import { TaskQueue } from "../../src/task-queue";
import { MESSAGES } from "../../src/locales/en";

function localRow(overrides: Partial<CatalogEntry> = {}): CatalogEntry {
    return {
        hf_repo: "Q/L",
        gguf_filename: "x.gguf",
        display_name: "Local-Default",
        size_gb: 1,
        min_ram_gb: 2,
        description: "",
        quality_tier: "balanced",
        installed: true,
        source: "native",
        task: "chat",
        featured: false,
        downloads: 0,
        param_count: "",
        ...overrides,
    };
}

function frontierRow(overrides: Partial<CatalogEntry> = {}): CatalogEntry {
    return {
        ...localRow({
            source: "frontier",
            display_name: "OpenAI-default",
            hf_repo: "openai/gpt-4o",
            ...overrides,
        }),
        ...({
            provider: (overrides as { provider?: string }).provider ?? "OpenAI",
            key_status: (overrides as { key_status?: string }).key_status ?? "missing_key",
            is_curated: true,
            context_window: 128000,
            modality: "text",
        } as Partial<CatalogEntry>),
    } as CatalogEntry;
}

function makePlugin(catalogModels: CatalogEntry[] = [localRow()]) {
    return {
        api: {
            catalog: vi
                .fn()
                .mockResolvedValue(
                    ok({ total: catalogModels.length, limit: 50, offset: 0, models: catalogModels, has_more: false }),
                ),
            setChatModel: vi.fn().mockResolvedValue(ok(undefined)),
            setEmbeddingModel: vi.fn().mockResolvedValue(ok(undefined)),
        },
        activeModel: "",
        settings: {},
        fetchActiveModel: vi.fn(),
        refreshSettingsTab: vi.fn(),
        taskQueue: new TaskQueue(),
    } as any;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

async function openPicker(
    plugin: ReturnType<typeof makePlugin>,
    scope: "chat" | "embedding" = "chat",
): Promise<ModelPickerModal> {
    const modal = new ModelPickerModal(new App() as any, plugin, scope);
    modal.open();
    await tick();
    await tick();
    return modal;
}

function contentEl(modal: ModelPickerModal): MockElement {
    return (modal as unknown as { contentEl: MockElement }).contentEl;
}

describe("ModelPickerModal", () => {
    beforeEach(() => Notice.clear());
    afterEach(() => vi.unstubAllGlobals());

    it("renders the title appropriate to its scope", async () => {
        const chat = await openPicker(makePlugin(), "chat");
        const embed = await openPicker(makePlugin(), "embedding");
        expect(contentEl(chat).textContent).toContain(MESSAGES.MODEL_PICKER_TITLE_CHAT);
        expect(contentEl(embed).textContent).toContain(MESSAGES.MODEL_PICKER_TITLE_EMBED);
    });

    it("hides frontier rows when no provider key is configured", async () => {
        const plugin = makePlugin([
            localRow({ display_name: "Local-A" }),
            frontierRow({ ...({ key_status: "missing_key" } as Partial<CatalogEntry>) }),
        ]);
        const modal = await openPicker(plugin);
        await tick();
        const rows = contentEl(modal).findAll("lilbee-model-picker-row");
        expect(rows.length).toBe(1);
        expect(rows[0].textContent).toContain("Local-A");
    });

    it("includes frontier rows once at least one provider has key_status=ready", async () => {
        const plugin = makePlugin([
            localRow({ display_name: "Local-A" }),
            frontierRow({ display_name: "Ready-OpenAI", ...({ key_status: "ready" } as Partial<CatalogEntry>) }),
            frontierRow({
                hf_repo: "anthropic/claude",
                display_name: "Anth-Claude",
                ...({ provider: "Anthropic", key_status: "missing_key" } as Partial<CatalogEntry>),
            }),
        ]);
        const modal = await openPicker(plugin);
        await tick();
        const rows = contentEl(modal).findAll("lilbee-model-picker-row");
        // 1 local + 2 frontier (gating only hides frontier rows when NO provider has any key set).
        expect(rows.length).toBe(3);
    });

    it("groups rows under Local then provider section headers", async () => {
        const plugin = makePlugin([
            localRow({ display_name: "Local-A" }),
            frontierRow({
                display_name: "OAI",
                ...({ key_status: "ready", provider: "OpenAI" } as Partial<CatalogEntry>),
            }),
            frontierRow({
                hf_repo: "a/b",
                display_name: "Ant",
                ...({ key_status: "missing_key", provider: "Anthropic" } as Partial<CatalogEntry>),
            }),
        ]);
        const modal = await openPicker(plugin);
        await tick();
        const headers = contentEl(modal)
            .findAll("lilbee-model-picker-section-header")
            .map((h) => h.textContent);
        expect(headers).toEqual([MESSAGES.MODEL_PICKER_LOCAL_HEADING, "Anthropic", "OpenAI"]);
    });

    it("renders ollama rows with a provider pill and no key pill, and defaults a key-less frontier row to Needs key", async () => {
        const keylessFrontier = {
            ...localRow({ display_name: "Keyless", hf_repo: "openai/keyless", source: "frontier" }),
            provider: "OpenAI",
            // key_status intentionally omitted to exercise the `?? missing_key` fallback.
        } as CatalogEntry;
        const ollama = {
            ...localRow({ display_name: "Llama", hf_repo: "ollama/llama3", source: "ollama" }),
            provider: "Ollama",
        } as CatalogEntry;
        const plugin = makePlugin([keylessFrontier, ollama]);
        const modal = await openPicker(plugin);
        await tick();
        const content = contentEl(modal);
        // Ollama always surfaces the hosted set (no key needed) and, as a local server, leads the frontier row.
        expect(content.findAll("lilbee-provider-pill").map((p) => p.textContent)).toEqual(["Ollama", "OpenAI"]);
        // Only the frontier row carries a key-status pill; it defaults to Needs key.
        const keyPills = content.findAll("lilbee-key-status-pill");
        expect(keyPills).toHaveLength(1);
        expect(keyPills[0].textContent).toBe(MESSAGES.PILL_KEY_NEEDS_KEY);
    });

    it("clicking a Local row calls setChatModel and closes the modal", async () => {
        const plugin = makePlugin([localRow({ display_name: "L1", hf_repo: "h/L1" })]);
        const modal = await openPicker(plugin, "chat");
        const closeSpy = vi.spyOn(modal, "close").mockImplementation(() => {});
        const row = contentEl(modal).find("lilbee-model-picker-row")!;
        row.trigger("click");
        await tick();
        await tick();
        expect(plugin.api.setChatModel).toHaveBeenCalledWith("h/L1");
        expect(closeSpy).toHaveBeenCalled();
    });

    it("clicking a Local row in embedding scope calls setEmbeddingModel", async () => {
        const plugin = makePlugin([localRow({ display_name: "L1", hf_repo: "h/L1", task: "embedding" })]);
        const modal = await openPicker(plugin, "embedding");
        vi.spyOn(modal, "close").mockImplementation(() => {});
        const row = contentEl(modal).find("lilbee-model-picker-row")!;
        row.trigger("click");
        await tick();
        await tick();
        expect(plugin.api.setEmbeddingModel).toHaveBeenCalledWith("h/L1");
    });

    it("clicking a Needs-key frontier row opens settings (deep-link) and does not set the model", async () => {
        const plugin = makePlugin([
            localRow({ display_name: "Anchor", hf_repo: "a/anchor" }),
            frontierRow({ ...({ key_status: "ready" } as Partial<CatalogEntry>) }),
            frontierRow({
                hf_repo: "a/needs",
                display_name: "needs-key",
                ...({ key_status: "missing_key", provider: "Anthropic" } as Partial<CatalogEntry>),
            }),
        ]);
        const modal = await openPicker(plugin, "chat");
        const closeSpy = vi.spyOn(modal, "close").mockImplementation(() => {});
        // Click the missing-key frontier row.
        const rows = contentEl(modal).findAll("lilbee-model-picker-row");
        const needsKeyRow = rows.find((r) => r.textContent.includes("needs-key"))!;
        needsKeyRow.trigger("click");
        await tick();
        expect(plugin.api.setChatModel).not.toHaveBeenCalled();
        expect(closeSpy).toHaveBeenCalled();
    });

    it("clicking a Ready frontier row sets the model active", async () => {
        const plugin = makePlugin([
            frontierRow({
                hf_repo: "openai/gpt-4o",
                display_name: "gpt-4o",
                ...({ key_status: "ready" } as Partial<CatalogEntry>),
            }),
        ]);
        const modal = await openPicker(plugin, "chat");
        vi.spyOn(modal, "close").mockImplementation(() => {});
        const row = contentEl(modal).find("lilbee-model-picker-row")!;
        row.trigger("click");
        await tick();
        await tick();
        expect(plugin.api.setChatModel).toHaveBeenCalledWith("openai/gpt-4o");
    });

    it("surfaces a Notice when the underlying setModel keeps failing", async () => {
        Notice.clear();
        const plugin = makePlugin([localRow({ display_name: "L1", hf_repo: "h/L1" })]);
        plugin.api.setChatModel = vi.fn().mockResolvedValue(err(new Error("boom")));
        const modal = await openPicker(plugin, "chat");
        vi.spyOn(modal, "close").mockImplementation(() => {});
        contentEl(modal).find("lilbee-model-picker-row")!.trigger("click");
        // The set retries before reporting failure; wait long enough for every
        // retry delay to elapse, then give up.
        await vi.waitFor(
            () =>
                expect(Notice.instances.map((n) => n.message)).toContain(
                    MESSAGES.ERROR_SET_MODEL.replace("{model}", "h/L1"),
                ),
            { timeout: 6000, interval: 100 },
        );
        // Initial attempt plus every retry.
        expect(plugin.api.setChatModel).toHaveBeenCalledTimes(SET_MODEL_RETRIES + 1);
    });

    it("retries a transient set failure and activates without an error toast", async () => {
        Notice.clear();
        const plugin = makePlugin([localRow({ display_name: "L1", hf_repo: "h/L1" })]);
        // First set races the worker reload and errors; the retry succeeds.
        plugin.api.setChatModel = vi
            .fn()
            .mockResolvedValueOnce(err(new Error("server is still starting up")))
            .mockResolvedValue(ok(undefined));
        const modal = await openPicker(plugin, "chat");
        vi.spyOn(modal, "close").mockImplementation(() => {});
        contentEl(modal).find("lilbee-model-picker-row")!.trigger("click");
        await vi.waitFor(() =>
            expect(Notice.instances.map((n) => n.message)).toContain(MESSAGES.NOTICE_MODEL_ACTIVATED("L1")),
        );
        expect(plugin.api.setChatModel).toHaveBeenCalledTimes(2);
        expect(Notice.instances.map((n) => n.message)).not.toContain(
            MESSAGES.ERROR_SET_MODEL.replace("{model}", "h/L1"),
        );
    });

    it("surfaces a Notice when /api/catalog returns an error", async () => {
        Notice.clear();
        const plugin = makePlugin();
        plugin.api.catalog = vi.fn().mockResolvedValue(err(new Error("offline")));
        await openPicker(plugin, "chat");
        await tick();
        expect(Notice.instances.map((n) => n.message)).toContain(MESSAGES.ERROR_LOAD_CATALOG);
    });

    it("renders an empty-state message when no rows match the filter", async () => {
        const plugin = makePlugin([localRow({ display_name: "alpha" }), localRow({ display_name: "beta" })]);
        const modal = await openPicker(plugin, "chat");
        // Force-set the filter and re-render.
        (modal as any).filterText = "no-such-model";
        (modal as any).applyFilterAndRender();
        const empty = contentEl(modal).find("lilbee-model-picker-empty");
        expect(empty?.textContent).toBe(MESSAGES.MODEL_PICKER_EMPTY);
    });

    it("drops rows whose task does not match the picker scope (defensive)", async () => {
        const plugin = makePlugin([
            localRow({ display_name: "Real-Chat", task: "chat" }),
            localRow({ display_name: "Embed-Misclassified", task: "embedding" }),
            localRow({ display_name: "Vision-Misclassified", task: "vision" }),
        ]);
        const modal = await openPicker(plugin, "chat");
        const rows = contentEl(modal).findAll("lilbee-model-picker-row");
        const labels = rows.map((r) => r.find("lilbee-model-picker-row-display")?.textContent);
        expect(labels).toEqual(["Real-Chat"]);
    });

    it("scope=embedding filters out chat models even if the server returns them", async () => {
        const plugin = makePlugin([
            localRow({ display_name: "Chat-X", task: "chat" }),
            localRow({ display_name: "Embed-Y", task: "embedding" }),
        ]);
        const modal = await openPicker(plugin, "embedding");
        const rows = contentEl(modal).findAll("lilbee-model-picker-row");
        const labels = rows.map((r) => r.find("lilbee-model-picker-row-display")?.textContent);
        expect(labels).toEqual(["Embed-Y"]);
    });

    it("renders an installed pill, fit chip, and meta line when the row carries that data", async () => {
        const plugin = makePlugin([
            localRow({
                display_name: "Local-FitsBig",
                installed: true,
                size_gb: 4,
                quality_tier: "balanced",
                ...({ fit: "fits" } as Partial<CatalogEntry>),
            }),
        ]);
        const modal = await openPicker(plugin);
        const el = contentEl(modal);
        const row = el.find("lilbee-model-picker-row")!;
        expect(row.find("lilbee-pill-installed")).not.toBeNull();
        expect(row.find("lilbee-fit-fits")).not.toBeNull();
        const meta = row.find("lilbee-model-picker-row-meta");
        expect(meta?.textContent).toBe("4 GB · balanced");
    });

    it("omits the meta line when size_gb is zero", async () => {
        const plugin = makePlugin([localRow({ display_name: "Local-NoSize", size_gb: 0 })]);
        const modal = await openPicker(plugin);
        const row = contentEl(modal).find("lilbee-model-picker-row")!;
        expect(row.find("lilbee-model-picker-row-meta")).toBeNull();
    });

    it("renders the meta line without a quality-tier suffix when the row has no tier", async () => {
        const plugin = makePlugin([localRow({ display_name: "Local-NoTier", size_gb: 4, quality_tier: "" })]);
        const modal = await openPicker(plugin);
        const row = contentEl(modal).find("lilbee-model-picker-row")!;
        const meta = row.find("lilbee-model-picker-row-meta");
        expect(meta?.textContent).toBe("4 GB");
    });

    it("filterRowsByText filters case-insensitively and returns all rows when text is empty", () => {
        const rows = [localRow({ display_name: "Qwen 3 8B" }), localRow({ display_name: "Llama" })];
        expect(filterRowsByText(rows, "")).toEqual(rows);
        expect(filterRowsByText(rows, "qwen").map((r) => r.display_name)).toEqual(["Qwen 3 8B"]);
        expect(filterRowsByText(rows, "  LLAMA  ").map((r) => r.display_name)).toEqual(["Llama"]);
    });

    it("a second keystroke during the debounce window cancels the prior pending timer", async () => {
        vi.useFakeTimers();
        try {
            const plugin = makePlugin([localRow({ display_name: "alpha" }), localRow({ display_name: "beta" })]);
            const modal = new ModelPickerModal(new App() as any, plugin, "chat");
            modal.open();
            await vi.runAllTimersAsync();
            const input = (modal as any).searchInputEl as { value: string; trigger: (e: string) => void };
            // Two rapid inputs; the second must clear the first pending timer.
            input.value = "a";
            input.trigger("input");
            input.value = "ab";
            input.trigger("input");
            await vi.advanceTimersByTimeAsync(200);
            expect((modal as any).filterText).toBe("ab");
        } finally {
            vi.useRealTimers();
        }
    });

    it("debounces typing into the search input before filtering", async () => {
        vi.useFakeTimers();
        try {
            const plugin = makePlugin([localRow({ display_name: "alpha" }), localRow({ display_name: "beta" })]);
            const modal = new ModelPickerModal(new App() as any, plugin, "chat");
            modal.open();
            // Resolve the catalog promise so initial render completes.
            await vi.runAllTimersAsync();
            const input = (modal as any).searchInputEl as { value: string; trigger: (e: string) => void };
            input.value = "alpha";
            input.trigger("input");
            // Before the debounce fires.
            expect((modal as any).filterText).toBe("");
            await vi.advanceTimersByTimeAsync(200);
            expect((modal as any).filterText).toBe("alpha");
        } finally {
            vi.useRealTimers();
        }
    });

    it("ArrowDown / ArrowUp move the highlighted index, wrapping at boundaries", async () => {
        const plugin = makePlugin([
            localRow({ display_name: "L1", hf_repo: "1" }),
            localRow({ display_name: "L2", hf_repo: "2" }),
            localRow({ display_name: "L3", hf_repo: "3" }),
        ]);
        const modal = await openPicker(plugin);
        await tick();
        const inst = modal as unknown as { highlightedIndex: number; moveHighlight: (d: number) => void };
        inst.moveHighlight(1);
        expect(inst.highlightedIndex).toBe(1);
        inst.moveHighlight(1);
        expect(inst.highlightedIndex).toBe(2);
        // Wrap forward.
        inst.moveHighlight(1);
        expect(inst.highlightedIndex).toBe(0);
        // Wrap backward.
        inst.moveHighlight(-1);
        expect(inst.highlightedIndex).toBe(2);
    });

    it("scope key handlers fire activateHighlighted / close / moveHighlight callbacks", async () => {
        const plugin = makePlugin([localRow({ display_name: "L1" }), localRow({ display_name: "L2" })]);
        const modal = await openPicker(plugin, "chat");
        const closeSpy = vi.spyOn(modal, "close").mockImplementation(() => {});
        const inst = modal as unknown as { scope: { trigger: (key: string) => void } };
        inst.scope.trigger("ArrowDown");
        inst.scope.trigger("ArrowDown");
        inst.scope.trigger("ArrowUp");
        inst.scope.trigger("Escape");
        expect(closeSpy).toHaveBeenCalled();
    });

    it("Enter activates the highlighted row", async () => {
        const plugin = makePlugin([
            localRow({ display_name: "L1", hf_repo: "h/1" }),
            localRow({ display_name: "L2", hf_repo: "h/2" }),
        ]);
        const modal = await openPicker(plugin, "chat");
        vi.spyOn(modal, "close").mockImplementation(() => {});
        await tick();
        // Move highlight to the second row, then activate.
        const inst = modal as unknown as { highlightedIndex: number; activateHighlighted: () => void };
        inst.highlightedIndex = 1;
        inst.activateHighlighted();
        await tick();
        await tick();
        expect(plugin.api.setChatModel).toHaveBeenCalledWith("h/2");
    });

    it("onClose clears any pending filter debounce timer", async () => {
        vi.useFakeTimers();
        try {
            const plugin = makePlugin([localRow()]);
            const modal = new ModelPickerModal(new App() as any, plugin, "chat");
            modal.open();
            await vi.runAllTimersAsync();
            const input = (modal as any).searchInputEl as { value: string; trigger: (e: string) => void };
            input.value = "alpha";
            input.trigger("input");
            // Filter timer is pending; close before it fires.
            expect((modal as any).filterTimer).not.toBeNull();
            modal.close();
            // No assertion on side effects — the goal is exercising the cleanup path.
            await vi.advanceTimersByTimeAsync(500);
        } finally {
            vi.useRealTimers();
        }
    });

    it("onClose is a no-op when no filter debounce timer is pending", async () => {
        const plugin = makePlugin([localRow()]);
        const modal = await openPicker(plugin, "chat");
        expect((modal as any).filterTimer).toBeNull();
        expect(() => modal.close()).not.toThrow();
    });

    it("the scope Enter handler activates the highlighted row", async () => {
        const plugin = makePlugin([
            localRow({ display_name: "L1", hf_repo: "h/1" }),
            localRow({ display_name: "L2", hf_repo: "h/2" }),
        ]);
        const modal = await openPicker(plugin, "chat");
        vi.spyOn(modal, "close").mockImplementation(() => {});
        await tick();
        (modal as any).highlightedIndex = 1;
        const inst = modal as unknown as { scope: { trigger: (key: string) => void } };
        inst.scope.trigger("Enter");
        await tick();
        await tick();
        expect(plugin.api.setChatModel).toHaveBeenCalledWith("h/2");
    });

    it("omits the Installed pill when the row is not installed", async () => {
        const plugin = makePlugin([localRow({ display_name: "Not-Installed", installed: false })]);
        const modal = await openPicker(plugin);
        const row = contentEl(modal).find("lilbee-model-picker-row")!;
        expect(row.find("lilbee-pill-installed")).toBeNull();
    });

    it("moveHighlight is a no-op when the filtered list is empty", async () => {
        const plugin = makePlugin([]);
        const modal = await openPicker(plugin);
        const inst = modal as unknown as { highlightedIndex: number; moveHighlight: (d: number) => void };
        inst.moveHighlight(1);
        expect(inst.highlightedIndex).toBe(0);
    });
});
