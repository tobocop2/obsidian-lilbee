import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { WorkspaceLeaf, MockElement, Notice, Platform } from "../__mocks__/obsidian";
import { ok, err } from "../../src/result";
import { PlacementView, VIEW_TYPE_PLACEMENT } from "../../src/views/placement-view";
import type LilbeePlugin from "../../src/main";
import type { PlacementResponse } from "../../src/types";

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const GB = 1_000_000_000;

function single(): PlacementResponse {
    return {
        gpus: [
            {
                index: 0,
                backend: "metal",
                label: "mps0",
                name: "Apple M3 Max",
                total_bytes: 48 * GB,
                free_bytes: 36 * GB,
            },
        ],
        roles: [
            {
                role: "chat",
                model: "Qwen3-8B",
                devices: [0],
                tensor_split: null,
                replicas: 1,
                vram_bytes: 6_100_000_000,
            },
            {
                role: "embed",
                model: "nomic-embed",
                devices: [0],
                tensor_split: null,
                replicas: 2,
                vram_bytes: 300_000_000,
            },
            { role: "vision", model: "", devices: [0], tensor_split: null, replicas: 1, vram_bytes: 0 },
        ],
        unplaceable: [],
        manual: false,
        spec_json: null,
    };
}

function multi(): PlacementResponse {
    return {
        gpus: [
            { index: 0, backend: "cuda", label: "cuda0", name: "RTX 4090", total_bytes: 24 * GB, free_bytes: 18 * GB },
            { index: 1, backend: "cuda", label: "cuda1", name: "RTX 3090", total_bytes: 24 * GB, free_bytes: 10 * GB },
        ],
        roles: [
            { role: "chat", model: "Qwen3-Coder", devices: [0, 1], tensor_split: [60, 40], replicas: 1 },
            { role: "embed", model: "nomic-embed", devices: [1], tensor_split: null, replicas: 2 },
            { role: "rerank", model: "bge-rerank", devices: [0], tensor_split: null, replicas: 1 },
        ],
        unplaceable: [],
        manual: false,
        spec_json: null,
    };
}

function multiManual(): PlacementResponse {
    return { ...multi(), manual: true, spec_json: '{"chat":{"devices":[0,1]}}' };
}

function noGpu(): PlacementResponse {
    return {
        gpus: [],
        roles: [{ role: "chat", model: "Qwen3-8B", devices: [], tensor_split: null, replicas: 1 }],
        unplaceable: [],
        manual: false,
        spec_json: null,
    };
}

interface ApiOverrides {
    placement?: ReturnType<typeof vi.fn>;
    placementPreview?: ReturnType<typeof vi.fn>;
    applyPlacement?: ReturnType<typeof vi.fn>;
    clearPlacement?: ReturnType<typeof vi.fn>;
    gpus?: ReturnType<typeof vi.fn>;
}

function makeApi(overrides: ApiOverrides = {}) {
    return {
        placement: vi.fn().mockResolvedValue(ok(multi())),
        placementPreview: vi.fn().mockResolvedValue(ok(multi())),
        applyPlacement: vi.fn().mockResolvedValue(ok(multiManual())),
        clearPlacement: vi.fn().mockResolvedValue(ok(multi())),
        gpus: vi.fn().mockResolvedValue(ok(multi().gpus)),
        ...overrides,
    };
}

function makePlugin(api: ReturnType<typeof makeApi>): LilbeePlugin {
    return { api, settings: { serverMode: "external" } } as unknown as LilbeePlugin;
}

async function openView(plugin: LilbeePlugin): Promise<{ view: PlacementView; contentEl: MockElement }> {
    const view = new PlacementView(new WorkspaceLeaf(), plugin);
    await view.onOpen();
    await flush();
    // Stop the usage poll so it can't fire across other tests; tests drive refreshUsage directly.
    await view.onClose();
    return { view, contentEl: (view as unknown as { contentEl: MockElement }).contentEl };
}

function rowFor(contentEl: MockElement, role: string): MockElement {
    return contentEl.findAll("lilbee-placement-role-row").find((r) => r.dataset.role === role)!;
}

beforeEach(() => {
    Notice.clear();
});

describe("VIEW_TYPE_PLACEMENT + metadata", () => {
    it("exposes the view type, title, and icon", () => {
        expect(VIEW_TYPE_PLACEMENT).toBe("lilbee-placement");
        const view = new PlacementView(new WorkspaceLeaf(), makePlugin(makeApi()));
        expect(view.getViewType()).toBe("lilbee-placement");
        expect(view.getDisplayText()).toBe("lilbee GPU placement");
        expect(view.getIcon()).toBe("cpu");
    });
});

describe("PlacementView multi-GPU (auto)", () => {
    it("renders the GPU table, role matrix, read-only chips, and the edit button", async () => {
        const { contentEl } = await openView(makePlugin(makeApi()));
        expect(contentEl.classList.contains("lilbee-placement-container")).toBe(true);
        expect(contentEl.find("lilbee-placement-header")!.find("lilbee-placement-state")!.textContent).toBe("auto");
        expect(contentEl.findAll("lilbee-placement-card").length).toBe(2);
        expect(contentEl.findAll("lilbee-placement-role-row").length).toBe(3);
        // chips are read-only in auto mode
        expect(contentEl.findAll("lilbee-placement-chip").every((c) => c.classList.contains("is-readonly"))).toBe(true);
        // chat row shows its tensor split
        expect(rowFor(contentEl, "chat").find("lilbee-placement-split")!.textContent).toBe("split 60/40");
        // footer: auto-managed message + edit button, no apply
        expect(contentEl.find("lilbee-placement-fit")!.classList.contains("is-muted")).toBe(true);
        const btns = contentEl.findAll("lilbee-placement-btn").map((b) => b.textContent);
        expect(btns).toEqual(["Edit manually"]);
    });

    it("shows the GPU memory bar filled to used fraction", async () => {
        const { contentEl } = await openView(makePlugin(makeApi()));
        const fill = contentEl.findAll("lilbee-placement-bar-fill")[0];
        // 4090: 6GB used of 24 → 25%
        expect(fill.style.width).toBe("25%");
    });

    it("read-only chips in auto mode are tooltipped and point to Edit manually on click", async () => {
        const { contentEl } = await openView(makePlugin(makeApi()));
        const chip = contentEl.find("lilbee-placement-chip")!;
        expect(chip.getAttribute("aria-label")).toBe('Click "Edit manually" first to change GPU placement.');
        chip.trigger("click");
        expect(Notice.instances.map((n) => n.message)).toContain(
            'Click "Edit manually" first to change GPU placement.',
        );
    });
});

describe("PlacementView single device", () => {
    it("renders the device summary and per-role status, no matrix, no edit button", async () => {
        const { contentEl } = await openView(
            makePlugin(makeApi({ placement: vi.fn().mockResolvedValue(ok(single())) })),
        );
        expect(contentEl.find("lilbee-placement-card-name")!.textContent).toBe("Apple M3 Max");
        expect(contentEl.find("lilbee-placement-mem")!.textContent).toBe("36.0 GB / 48.0 GB free");
        // single device has no GPU toggle chips
        expect(contentEl.find("lilbee-placement-chip")).toBeNull();
        // vision has no model → "not set"
        expect(rowFor(contentEl, "vision").find("lilbee-placement-role-model")!.textContent).toBe("not set");
        // single-device steppers are read-only (nothing to assign; replicas live in Settings)
        expect(contentEl.findAll("lilbee-placement-stepper").length).toBe(2);
        expect(contentEl.findAll("lilbee-placement-step").every((s) => s.classList.contains("is-readonly"))).toBe(true);
        // no edit / apply buttons on a single device
        expect(contentEl.findAll("lilbee-placement-btn").length).toBe(0);
    });

    it("a single-device stepper is read-only: shows guidance, builds no spec, has a tooltip", async () => {
        const api = makeApi({ placement: vi.fn().mockResolvedValue(ok(single())) });
        const { contentEl } = await openView(makePlugin(api));
        const inc = rowFor(contentEl, "embed").findAll("lilbee-placement-step")[1];
        inc.trigger("click");
        // count unchanged + no spec sent (no 422), but the user gets feedback
        expect(rowFor(contentEl, "embed").find("lilbee-placement-step-count")!.textContent).toBe("×2");
        expect(api.placementPreview).not.toHaveBeenCalled();
        expect(Notice.instances.map((n) => n.message)).toContain(
            "This device runs everything together. Set worker counts in Settings → lilbee → Hardware / fleet.",
        );
        expect(inc.getAttribute("aria-label")).toContain("Settings");
    });

    it("shows per-role estimated memory when the server reports it (and omits it at zero)", async () => {
        const { contentEl } = await openView(
            makePlugin(makeApi({ placement: vi.fn().mockResolvedValue(ok(single())) })),
        );
        const mems = contentEl.findAll("lilbee-placement-role-mem").map((m) => m.textContent);
        // chat 6.1 GB and embed 300 MB shown; vision (0 bytes) omitted
        expect(mems).toEqual(["~6.1 GB", "~300 MB"]);
    });

    it("omits per-role memory when the server does not report it (older server)", async () => {
        // multi() roles carry no vram_bytes
        const { contentEl } = await openView(makePlugin(makeApi()));
        expect(contentEl.find("lilbee-placement-role-mem")).toBeNull();
    });

    it("renders a CPU host card when no GPUs are detected (non-Mac)", async () => {
        Platform.isMacOS = false;
        const { contentEl } = await openView(
            makePlugin(makeApi({ placement: vi.fn().mockResolvedValue(ok(noGpu())) })),
        );
        expect(contentEl.find("lilbee-placement-card-name")!.textContent).toBe("CPU");
        expect(contentEl.find("lilbee-placement-card-sub")!.textContent).toBe("no GPU detected");
    });

    it("renders an Apple Silicon unified-memory card on macOS with no discrete GPU", async () => {
        Platform.isMacOS = true;
        try {
            const { contentEl } = await openView(
                makePlugin(makeApi({ placement: vi.fn().mockResolvedValue(ok(noGpu())) })),
            );
            expect(contentEl.find("lilbee-placement-card-name")!.textContent).toBe("Apple Silicon");
            expect(contentEl.find("lilbee-placement-card-sub")!.textContent).toBe("unified memory · Metal");
        } finally {
            Platform.isMacOS = false;
        }
    });
});

describe("PlacementView load failure", () => {
    it("renders a load-failed message", async () => {
        const api = makeApi({ placement: vi.fn().mockResolvedValue(err(new Error("boom"))) });
        const { contentEl } = await openView(makePlugin(api));
        expect(contentEl.find("lilbee-placement-empty")!.textContent).toContain("Couldn't load placement: boom");
    });
});

describe("PlacementView manual editing", () => {
    it("loads a manual plan with editable chips and apply/reset", async () => {
        const { contentEl } = await openView(
            makePlugin(makeApi({ placement: vi.fn().mockResolvedValue(ok(multiManual())) })),
        );
        expect(contentEl.find("lilbee-placement-state")!.textContent).toBe("manual");
        expect(contentEl.findAll("lilbee-placement-chip").some((c) => c.classList.contains("is-readonly"))).toBe(false);
        expect(contentEl.find("lilbee-placement-fit")!.textContent).toBe("Fits all roles");
    });

    it("editable chips and steppers carry descriptive tooltips", async () => {
        const { contentEl } = await openView(
            makePlugin(makeApi({ placement: vi.fn().mockResolvedValue(ok(multiManual())) })),
        );
        expect(rowFor(contentEl, "embed").findAll("lilbee-placement-chip")[0].getAttribute("aria-label")).toBe(
            "Run embedding on cuda0",
        );
        expect(rowFor(contentEl, "embed").findAll("lilbee-placement-step")[1].getAttribute("aria-label")).toBe(
            "Add an embedding worker",
        );
        expect(rowFor(contentEl, "embed").findAll("lilbee-placement-step")[0].getAttribute("aria-label")).toBe(
            "Remove an embedding worker",
        );
    });

    it("enters manual mode from the edit button", async () => {
        const { contentEl } = await openView(makePlugin(makeApi()));
        contentEl
            .findAll("lilbee-placement-btn")
            .find((b) => b.textContent === "Edit manually")!
            .trigger("click");
        expect(contentEl.find("lilbee-placement-state")!.textContent).toBe("manual");
        expect(contentEl.findAll("lilbee-placement-btn").map((b) => b.textContent)).toEqual([
            "Preview",
            "Apply",
            "Reset to auto",
        ]);
    });

    it("toggles a device on, off, and keeps at least one device", async () => {
        vi.useFakeTimers();
        try {
            const api = makeApi({ placement: vi.fn().mockResolvedValue(ok(multiManual())) });
            const view = new PlacementView(new WorkspaceLeaf(), makePlugin(api));
            await view.onOpen();
            const contentEl = (view as unknown as { contentEl: MockElement }).contentEl;
            // embed starts on cuda1 only; add cuda0
            rowFor(contentEl, "embed").findAll("lilbee-placement-chip")[0].trigger("click");
            expect(rowFor(contentEl, "embed").findAll("lilbee-placement-chip")[0].classList.contains("is-on")).toBe(
                true,
            );
            // remove cuda1 → only cuda0 left
            rowFor(contentEl, "embed").findAll("lilbee-placement-chip")[1].trigger("click");
            expect(rowFor(contentEl, "embed").findAll("lilbee-placement-chip")[1].classList.contains("is-on")).toBe(
                false,
            );
            // try removing the last device → stays on
            rowFor(contentEl, "embed").findAll("lilbee-placement-chip")[0].trigger("click");
            expect(rowFor(contentEl, "embed").findAll("lilbee-placement-chip")[0].classList.contains("is-on")).toBe(
                true,
            );
            // debounced preview fires once timers advance
            vi.advanceTimersByTime(400);
            await Promise.resolve();
            expect(api.placementPreview).toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    it("increments and decrements replicas but not below one", async () => {
        const { contentEl } = await openView(
            makePlugin(makeApi({ placement: vi.fn().mockResolvedValue(ok(multiManual())) })),
        );
        const rerankCannotStep = rowFor(contentEl, "rerank").find("lilbee-placement-stepper");
        expect(rerankCannotStep).toBeNull(); // rerank is not a replica role
        const inc = rowFor(contentEl, "embed").findAll("lilbee-placement-step")[1];
        inc.trigger("click"); // 2 → 3
        expect(rowFor(contentEl, "embed").find("lilbee-placement-step-count")!.textContent).toBe("×3");
        const dec = rowFor(contentEl, "embed").findAll("lilbee-placement-step")[0];
        dec.trigger("click"); // 3 → 2
        dec.trigger("click"); // 2 → 1
        dec.trigger("click"); // stays 1
        expect(rowFor(contentEl, "embed").find("lilbee-placement-step-count")!.textContent).toBe("×1");
    });
});

describe("PlacementView preview", () => {
    it("marks unplaceable roles and the unfit footer", async () => {
        const unfit = { ...multi(), unplaceable: ["embed"] };
        const api = makeApi({
            placement: vi.fn().mockResolvedValue(ok(multiManual())),
            placementPreview: vi.fn().mockResolvedValue(ok(unfit)),
        });
        const { contentEl } = await openView(makePlugin(api));
        contentEl
            .findAll("lilbee-placement-btn")
            .find((b) => b.textContent === "Preview")!
            .trigger("click");
        await flush();
        expect(rowFor(contentEl, "embed").classList.contains("lilbee-placement-role-unfit")).toBe(true);
        expect(contentEl.find("lilbee-placement-fit")!.classList.contains("is-unfit")).toBe(true);
        // apply is disabled while something won't fit
        expect(
            contentEl
                .findAll("lilbee-placement-btn")
                .find((b) => b.textContent === "Apply")!
                .classList.contains("is-disabled"),
        ).toBe(true);
    });

    it("fails an automatic preview quietly (no toast spam)", async () => {
        const api = makeApi({
            placement: vi.fn().mockResolvedValue(ok(multiManual())),
            placementPreview: vi.fn().mockResolvedValue(err(new Error("probe died"))),
        });
        const { contentEl } = await openView(makePlugin(api));
        contentEl
            .findAll("lilbee-placement-btn")
            .find((b) => b.textContent === "Preview")!
            .trigger("click");
        await flush();
        expect(Notice.instances.length).toBe(0);
    });
});

describe("PlacementView apply", () => {
    it("applies the built spec, shows progress, and adopts the response", async () => {
        const api = makeApi({ placement: vi.fn().mockResolvedValue(ok(multiManual())) });
        const { view, contentEl } = await openView(makePlugin(api));
        // toggle so the spec reflects an edit
        rowFor(contentEl, "embed").findAll("lilbee-placement-chip")[0].trigger("click");
        contentEl
            .findAll("lilbee-placement-btn")
            .find((b) => b.textContent === "Apply")!
            .trigger("click");
        await flush();
        expect(api.applyPlacement).toHaveBeenCalledWith({
            chat: { devices: [0, 1] },
            embed: { devices: [0, 1], replicas: 2 },
            rerank: { devices: [0] },
        });
        expect(Notice.instances.map((n) => n.message)).toContain("Placement applied.");
        // adopted: manual response → state manual
        expect(
            (view as unknown as { contentEl: MockElement }).contentEl.find("lilbee-placement-state")!.textContent,
        ).toBe("manual");
    });

    it("renders the rebuilding overlay while applying", async () => {
        let resolveApply: (v: unknown) => void = () => {};
        const api = makeApi({
            placement: vi.fn().mockResolvedValue(ok(multiManual())),
            applyPlacement: vi.fn().mockReturnValue(new Promise((r) => (resolveApply = r))),
        });
        const { contentEl } = await openView(makePlugin(api));
        contentEl
            .findAll("lilbee-placement-btn")
            .find((b) => b.textContent === "Apply")!
            .trigger("click");
        await flush();
        expect(contentEl.find("lilbee-placement-overlay")!.find("lilbee-placement-overlay-text")!.textContent).toBe(
            "Rebuilding fleet…",
        );
        resolveApply(ok(multiManual()));
        await flush();
        expect(contentEl.find("lilbee-placement-overlay")).toBeNull();
    });

    it("disables apply and shows a neutral message on a 409", async () => {
        const api = makeApi({
            placement: vi.fn().mockResolvedValue(ok(multiManual())),
            applyPlacement: vi.fn().mockResolvedValue(err(new Error("Server responded 409: nope"))),
        });
        const { contentEl } = await openView(makePlugin(api));
        contentEl
            .findAll("lilbee-placement-btn")
            .find((b) => b.textContent === "Apply")!
            .trigger("click");
        await flush();
        expect(Notice.instances.map((n) => n.message)).toContain(
            "Applying placement isn't enabled on this lilbee server.",
        );
        expect(
            contentEl
                .findAll("lilbee-placement-btn")
                .find((b) => b.textContent === "Apply")!
                .classList.contains("is-disabled"),
        ).toBe(true);
    });

    it("shows a generic failure on a non-409 apply error", async () => {
        const api = makeApi({
            placement: vi.fn().mockResolvedValue(ok(multiManual())),
            applyPlacement: vi.fn().mockResolvedValue(err(new Error("kaboom"))),
        });
        const { contentEl } = await openView(makePlugin(api));
        contentEl
            .findAll("lilbee-placement-btn")
            .find((b) => b.textContent === "Apply")!
            .trigger("click");
        await flush();
        expect(Notice.instances.map((n) => n.message)).toContain("Couldn't apply placement: kaboom");
    });
});

describe("PlacementView reset", () => {
    it("clears to auto and notifies", async () => {
        const api = makeApi({ placement: vi.fn().mockResolvedValue(ok(multiManual())) });
        const { contentEl } = await openView(makePlugin(api));
        contentEl
            .findAll("lilbee-placement-btn")
            .find((b) => b.textContent === "Reset to auto")!
            .trigger("click");
        await flush();
        expect(api.clearPlacement).toHaveBeenCalled();
        expect(Notice.instances.map((n) => n.message)).toContain("Back to automatic placement.");
        expect(contentEl.find("lilbee-placement-state")!.textContent).toBe("auto");
    });

    it("reports a reset failure", async () => {
        const api = makeApi({
            placement: vi.fn().mockResolvedValue(ok(multiManual())),
            clearPlacement: vi.fn().mockResolvedValue(err(new Error("stuck"))),
        });
        const { contentEl } = await openView(makePlugin(api));
        contentEl
            .findAll("lilbee-placement-btn")
            .find((b) => b.textContent === "Reset to auto")!
            .trigger("click");
        await flush();
        expect(Notice.instances.map((n) => n.message)).toContain("Couldn't apply placement: stuck");
    });
});

describe("PlacementView defensive paths", () => {
    it("reload before onOpen does not throw and renders nothing", async () => {
        const view = new PlacementView(new WorkspaceLeaf(), makePlugin(makeApi()));
        await view.reload();
        expect((view as unknown as { bodyEl: HTMLElement | null }).bodyEl).toBeNull();
    });

    it("renderMessage before onOpen is a no-op (load error, no body element)", async () => {
        const api = makeApi({ placement: vi.fn().mockResolvedValue(err(new Error("boom"))) });
        const view = new PlacementView(new WorkspaceLeaf(), makePlugin(api));
        await view.reload();
        expect((view as unknown as { bodyEl: HTMLElement | null }).bodyEl).toBeNull();
    });

    it("render is a no-op when current is null", async () => {
        const { view, contentEl } = await openView(makePlugin(makeApi()));
        (view as unknown as { current: null }).current = null;
        (view as unknown as { render: () => void }).render();
        // body retains the prior render (render bailed before empty())
        expect(contentEl.find("lilbee-placement-body")!.children.length).toBeGreaterThan(0);
    });

    it("draftFor creates a draft for an unseeded role", async () => {
        const { view } = await openView(makePlugin(makeApi()));
        const draft = (
            view as unknown as { draftFor: (r: string) => { devices: Set<number>; replicas: number } }
        ).draftFor("vision");
        expect(draft.replicas).toBe(1);
        expect(draft.devices.size).toBe(0);
    });

    it("renderBar handles a zero-total device", async () => {
        const zero = single();
        zero.gpus[0].total_bytes = 0;
        zero.gpus[0].free_bytes = 0;
        const { contentEl } = await openView(makePlugin(makeApi({ placement: vi.fn().mockResolvedValue(ok(zero)) })));
        expect(contentEl.find("lilbee-placement-bar-fill")!.style.width).toBe("0%");
    });

    it("onClose clears a pending preview timer", async () => {
        vi.useFakeTimers();
        try {
            const view = new PlacementView(
                new WorkspaceLeaf(),
                makePlugin(makeApi({ placement: vi.fn().mockResolvedValue(ok(multiManual())) })),
            );
            await view.onOpen();
            const contentEl = (view as unknown as { contentEl: MockElement }).contentEl;
            rowFor(contentEl, "embed").findAll("lilbee-placement-chip")[0].trigger("click");
            expect((view as unknown as { previewTimer: number | null }).previewTimer).not.toBeNull();
            await view.onClose();
            expect((view as unknown as { previewTimer: number | null }).previewTimer).toBeNull();
        } finally {
            vi.useRealTimers();
        }
    });

    it("onClose is a no-op with no pending timer", async () => {
        const { view } = await openView(makePlugin(makeApi()));
        await expect(view.onClose()).resolves.toBeUndefined();
    });

    it("a second device toggle reschedules the debounced preview", async () => {
        vi.useFakeTimers();
        try {
            const api = makeApi({ placement: vi.fn().mockResolvedValue(ok(multiManual())) });
            const view = new PlacementView(new WorkspaceLeaf(), makePlugin(api));
            await view.onOpen();
            const contentEl = (view as unknown as { contentEl: MockElement }).contentEl;
            rowFor(contentEl, "chat").findAll("lilbee-placement-chip")[0].trigger("click");
            vi.advanceTimersByTime(100);
            rowFor(contentEl, "chat").findAll("lilbee-placement-chip")[0].trigger("click");
            vi.advanceTimersByTime(400);
            await Promise.resolve();
            expect(api.placementPreview).toHaveBeenCalledTimes(1);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe("PlacementView live usage bars", () => {
    it("moves the bars to live GPU usage in place", async () => {
        const api = makeApi();
        const { view, contentEl } = await openView(makePlugin(api));
        // report GPU0 fully used (free 0); the first bar fill jumps to 100%
        const live = multi().gpus.map((g, i) => (i === 0 ? { ...g, free_bytes: 0 } : g));
        api.gpus.mockResolvedValue(ok(live));
        await (view as unknown as { refreshUsage: () => Promise<void> }).refreshUsage();
        expect(contentEl.findAll("lilbee-placement-bar-fill")[0].style.width).toBe("100%");
        expect(contentEl.findAll("lilbee-placement-mem")[0].textContent).toBe("0.0 GB / 24.0 GB free");
    });

    it("skips the poll while applying", async () => {
        const api = makeApi();
        const { view } = await openView(makePlugin(api));
        (view as unknown as { applying: boolean }).applying = true;
        api.gpus.mockClear();
        await (view as unknown as { refreshUsage: () => Promise<void> }).refreshUsage();
        expect(api.gpus).not.toHaveBeenCalled();
    });

    it("ignores a poll error", async () => {
        const api = makeApi({ gpus: vi.fn().mockResolvedValue(err(new Error("probe failed"))) });
        const { view } = await openView(makePlugin(api));
        await expect(
            (view as unknown as { refreshUsage: () => Promise<void> }).refreshUsage(),
        ).resolves.toBeUndefined();
    });

    it("reloads when the device count changes", async () => {
        const api = makeApi();
        const { view } = await openView(makePlugin(api));
        api.placement.mockClear();
        api.gpus.mockResolvedValue(ok([multi().gpus[0]])); // 1 device now (was 2)
        await (view as unknown as { refreshUsage: () => Promise<void> }).refreshUsage();
        expect(api.placement).toHaveBeenCalled();
    });

    it("reloads when a device index is unknown", async () => {
        const api = makeApi();
        const { view } = await openView(makePlugin(api));
        api.placement.mockClear();
        api.gpus.mockResolvedValue(ok(multi().gpus.map((g) => ({ ...g, index: g.index + 10 }))));
        await (view as unknown as { refreshUsage: () => Promise<void> }).refreshUsage();
        expect(api.placement).toHaveBeenCalled();
    });

    it("polls GPU usage on an interval after open and stops on close", async () => {
        vi.useFakeTimers();
        try {
            const api = makeApi();
            const view = new PlacementView(new WorkspaceLeaf(), makePlugin(api));
            await view.onOpen();
            api.gpus.mockClear();
            await vi.advanceTimersByTimeAsync(4000);
            expect(api.gpus).toHaveBeenCalled();
            await view.onClose();
            api.gpus.mockClear();
            await vi.advanceTimersByTimeAsync(8000);
            expect(api.gpus).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });
});

afterEach(() => {
    vi.useRealTimers();
});
