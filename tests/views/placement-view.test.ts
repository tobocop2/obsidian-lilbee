import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { App, WorkspaceLeaf, MockElement, Notice, Platform } from "../__mocks__/obsidian";
import { ok, err } from "../../src/result";
import { ServerStartingError, SessionTokenError } from "../../src/api";
import { PlacementView, VIEW_TYPE_PLACEMENT, revealPlacementBeside } from "../../src/views/placement-view";
import type LilbeePlugin from "../../src/main";
import type { GpuStat, PlacementResponse, SSEEvent } from "../../src/types";

function statsEvent(gpus: GpuStat[]): SSEEvent {
    return { event: "gpu_stats", data: { gpus } };
}

async function* statsStream(...events: SSEEvent[]): AsyncGenerator<SSEEvent, void> {
    for (const e of events) yield e;
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const GB = 1_000_000_000;

function single(): PlacementResponse {
    return {
        gpus: [
            {
                index: 0,
                backend: "MTL",
                label: "MTL0",
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
    gpuStatsStream?: ReturnType<typeof vi.fn>;
    health?: ReturnType<typeof vi.fn>;
}

async function* emptyStatsStream(): AsyncGenerator<SSEEvent, void> {}

function makeApi(overrides: ApiOverrides = {}) {
    return {
        placement: vi.fn().mockResolvedValue(ok(multi())),
        placementPreview: vi.fn().mockResolvedValue(ok(multi())),
        applyPlacement: vi.fn().mockResolvedValue(ok(multiManual())),
        clearPlacement: vi.fn().mockResolvedValue(ok(multi())),
        gpuStatsStream: vi.fn(() => emptyStatsStream()),
        health: vi.fn().mockResolvedValue(ok({ chat_ready: true })),
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
    // Stop the live stats stream so it can't fire across other tests; tests drive applyStats directly.
    await view.onClose();
    return { view, contentEl: (view as unknown as { contentEl: MockElement }).contentEl };
}

function rowFor(contentEl: MockElement, role: string): MockElement {
    return contentEl.findAll("lilbee-placement-role-row").find((r) => r.dataset.role === role)!;
}

// A GPU row carries a util meter and a vram meter; each holds a value span and a
// bar fill. These pick the right one for device row `i` (DOM order = device order).
function utilVal(contentEl: MockElement, i: number): MockElement {
    return contentEl.findAll("lilbee-meter-util")[i].find("lilbee-meter-val")!;
}
function vramVal(contentEl: MockElement, i: number): MockElement {
    return contentEl.findAll("lilbee-meter-vram")[i].find("lilbee-meter-val")!;
}
function utilFill(contentEl: MockElement, i: number): MockElement {
    return contentEl.findAll("lilbee-meter-util")[i].find("lilbee-bar-fill")!;
}
function vramFill(contentEl: MockElement, i: number): MockElement {
    return contentEl.findAll("lilbee-meter-vram")[i].find("lilbee-bar-fill")!;
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
        expect(contentEl.findAll("lilbee-gpu-row").length).toBe(2);
        expect(contentEl.findAll("lilbee-placement-role-row").length).toBe(3);
        // toggles are read-only in auto mode
        expect(contentEl.findAll("lilbee-placement-toggle").every((c) => c.classList.contains("is-readonly"))).toBe(
            true,
        );
        // each role shows its placement rule as a one-word hint
        expect(rowFor(contentEl, "chat").find("lilbee-placement-role-hint")!.textContent).toBe("split");
        expect(rowFor(contentEl, "embed").find("lilbee-placement-role-hint")!.textContent).toBe("mirror");
        expect(rowFor(contentEl, "rerank").find("lilbee-placement-role-hint")!.textContent).toBe("one card");
        // older servers omit vram_bytes → no footprint span
        expect(rowFor(contentEl, "chat").find("lilbee-placement-role-vram")).toBeNull();
        // footer: auto-managed message + edit button, no apply
        expect(contentEl.find("lilbee-placement-fit")!.classList.contains("is-muted")).toBe(true);
        const btns = contentEl.findAll("lilbee-placement-btn").map((b) => b.textContent);
        expect(btns).toEqual(["Edit manually"]);
    });

    it("renders an empty utilization bar and free-memory text before any stats arrive", async () => {
        const { contentEl } = await openView(makePlugin(makeApi()));
        expect(utilVal(contentEl, 0).textContent).toBe("—");
        expect(vramVal(contentEl, 0).textContent).toBe("18.0 GB / 24.0 GB free");
    });

    it("shows the roles running on each GPU as badges on its row", async () => {
        const { contentEl } = await openView(makePlugin(makeApi()));
        // device 0 runs chat (0,1) + rerank (0); device 1 runs chat + embed (1)
        const row0Badges = contentEl
            .findAll("lilbee-gpu-row")[0]
            .findAll("lilbee-role-badge")
            .map((b) => b.textContent);
        expect(row0Badges).toEqual(["chat", "rerank"]);
        const row1Badges = contentEl
            .findAll("lilbee-gpu-row")[1]
            .findAll("lilbee-role-badge")
            .map((b) => b.textContent);
        expect(row1Badges).toEqual(["chat", "embed"]);
    });

    it("read-only toggles in auto mode are tooltipped and point to Edit manually on click", async () => {
        const { contentEl } = await openView(makePlugin(makeApi()));
        const chip = contentEl.find("lilbee-placement-toggle")!;
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
        expect(contentEl.find("lilbee-gpu-name")!.textContent).toBe("Apple M3 Max");
        // Metal has no live memory sampling: capacity label, no free/total gauge.
        expect(vramVal(contentEl, 0).textContent).toBe("48.0 GB unified");
        expect(contentEl.findAll("lilbee-meter-vram")[0].find("lilbee-bar-fill")).toBeNull();
        // single device has no GPU toggle matrix
        expect(contentEl.find("lilbee-placement-toggle")).toBeNull();
        // vision has no model → "not set"
        expect(rowFor(contentEl, "vision").find("lilbee-placement-role-model")!.textContent).toBe("not set");
        // single-device steppers are read-only (nothing to assign; replicas live in Settings)
        expect(contentEl.findAll("lilbee-placement-stepper").length).toBe(2);
        expect(contentEl.findAll("lilbee-placement-step").every((s) => s.classList.contains("is-readonly"))).toBe(true);
        // no edit / apply buttons on a single device
        expect(contentEl.findAll("lilbee-placement-btn").length).toBe(0);
    });

    it("shows each role's estimated memory footprint, skipping roles without one", async () => {
        const { contentEl } = await openView(
            makePlugin(makeApi({ placement: vi.fn().mockResolvedValue(ok(single())) })),
        );
        const chatVram = rowFor(contentEl, "chat").find("lilbee-placement-role-vram")!;
        expect(chatVram.textContent).toBe("~6.1 GB");
        expect(chatVram.getAttribute("aria-label")).toBe("Estimated memory the chat model needs");
        expect(rowFor(contentEl, "embed").find("lilbee-placement-role-vram")!.textContent).toBe("~0.3 GB");
        // vision has no model loaded (vram_bytes 0) → no footprint span
        expect(rowFor(contentEl, "vision").find("lilbee-placement-role-vram")).toBeNull();
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

    it("shows a live waiting state while the server starts and loads once it's up", async () => {
        vi.useFakeTimers();
        try {
            const placement = vi
                .fn()
                .mockResolvedValueOnce(err(new ServerStartingError()))
                .mockResolvedValue(ok(multi()));
            const api = makeApi({ placement });
            const view = new PlacementView(new WorkspaceLeaf(), makePlugin(api));
            await view.onOpen();
            const contentEl = (view as unknown as { contentEl: MockElement }).contentEl;

            expect(contentEl.find("lilbee-placement-waiting")).toBeTruthy();
            expect(contentEl.find("lilbee-placement-spinner")).toBeTruthy();
            expect(contentEl.find("lilbee-placement-empty")!.textContent).toContain(
                "Waiting for the lilbee server to start",
            );

            await vi.advanceTimersByTimeAsync(2000);

            expect(placement).toHaveBeenCalledTimes(2);
            expect(contentEl.find("lilbee-placement-waiting")).toBeFalsy();
            expect(contentEl.find("lilbee-placement-state")).toBeTruthy();
            // The stats stream that died during boot is reopened for the fresh cards.
            expect(api.gpuStatsStream).toHaveBeenCalledTimes(2);
            await view.onClose();
        } finally {
            vi.useRealTimers();
        }
    });

    it("keeps polling while the server is still starting and stops on close", async () => {
        vi.useFakeTimers();
        try {
            const placement = vi.fn().mockResolvedValue(err(new ServerStartingError()));
            const api = makeApi({ placement });
            const view = new PlacementView(new WorkspaceLeaf(), makePlugin(api));
            await view.onOpen();
            const contentEl = (view as unknown as { contentEl: MockElement }).contentEl;

            // A manual reload while a poll is pending replaces the pending timer.
            await view.reload();
            expect(placement).toHaveBeenCalledTimes(2);

            await vi.advanceTimersByTimeAsync(2000);
            expect(placement).toHaveBeenCalledTimes(3);
            expect(contentEl.find("lilbee-placement-waiting")).toBeTruthy();

            await view.onClose();
            await vi.advanceTimersByTimeAsync(10_000);
            expect(placement).toHaveBeenCalledTimes(3);
        } finally {
            vi.useRealTimers();
        }
    });

    it("treats a managed-mode token rejection at startup as transient and loads once discovery lands", async () => {
        vi.useFakeTimers();
        try {
            const placement = vi
                .fn()
                .mockResolvedValueOnce(err(new SessionTokenError(401, "bad token")))
                .mockResolvedValue(ok(multi()));
            const api = makeApi({ placement });
            const plugin = { api, settings: { serverMode: "managed" } } as unknown as LilbeePlugin;
            const view = new PlacementView(new WorkspaceLeaf(), plugin);
            await view.onOpen();
            const contentEl = (view as unknown as { contentEl: MockElement }).contentEl;

            expect(contentEl.find("lilbee-placement-waiting")).toBeTruthy();

            await vi.advanceTimersByTimeAsync(2000);
            expect(placement).toHaveBeenCalledTimes(2);
            expect(contentEl.find("lilbee-placement-waiting")).toBeFalsy();
            expect(contentEl.find("lilbee-placement-state")).toBeTruthy();
            await view.onClose();
        } finally {
            vi.useRealTimers();
        }
    });

    it("keeps the actionable error for a token rejection in external mode", async () => {
        vi.useFakeTimers();
        try {
            const placement = vi.fn().mockResolvedValue(err(new SessionTokenError(401, "bad token")));
            const api = makeApi({ placement });
            const view = new PlacementView(new WorkspaceLeaf(), makePlugin(api));
            await view.onOpen();
            const contentEl = (view as unknown as { contentEl: MockElement }).contentEl;

            expect(contentEl.find("lilbee-placement-waiting")).toBeFalsy();
            expect(contentEl.find("lilbee-placement-empty")!.textContent).toContain("Couldn't load placement");

            // No retry is scheduled for a non-transient failure.
            await vi.advanceTimersByTimeAsync(10_000);
            expect(placement).toHaveBeenCalledTimes(1);
            await view.onClose();
        } finally {
            vi.useRealTimers();
        }
    });

    it("waiting state before onOpen is a no-op (no body element)", async () => {
        vi.useFakeTimers();
        try {
            const api = makeApi({ placement: vi.fn().mockResolvedValue(err(new ServerStartingError())) });
            const view = new PlacementView(new WorkspaceLeaf(), makePlugin(api));
            await view.reload();
            expect((view as unknown as { bodyEl: HTMLElement | null }).bodyEl).toBeNull();
            await view.onClose();
        } finally {
            vi.useRealTimers();
        }
    });
});

describe("PlacementView manual editing", () => {
    it("loads a manual plan with editable chips and apply/reset", async () => {
        const { contentEl } = await openView(
            makePlugin(makeApi({ placement: vi.fn().mockResolvedValue(ok(multiManual())) })),
        );
        expect(contentEl.find("lilbee-placement-state")!.textContent).toBe("manual");
        expect(contentEl.findAll("lilbee-placement-toggle").some((c) => c.classList.contains("is-readonly"))).toBe(
            false,
        );
        expect(contentEl.find("lilbee-placement-fit")!.textContent).toBe("Fits all roles");
    });

    it("editable chips and steppers carry descriptive tooltips", async () => {
        const { contentEl } = await openView(
            makePlugin(makeApi({ placement: vi.fn().mockResolvedValue(ok(multiManual())) })),
        );
        expect(rowFor(contentEl, "embed").findAll("lilbee-placement-toggle")[0].getAttribute("aria-label")).toBe(
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
            rowFor(contentEl, "embed").findAll("lilbee-placement-toggle")[0].trigger("click");
            expect(rowFor(contentEl, "embed").findAll("lilbee-placement-toggle")[0].classList.contains("is-on")).toBe(
                true,
            );
            // remove cuda1 → only cuda0 left
            rowFor(contentEl, "embed").findAll("lilbee-placement-toggle")[1].trigger("click");
            expect(rowFor(contentEl, "embed").findAll("lilbee-placement-toggle")[1].classList.contains("is-on")).toBe(
                false,
            );
            // try removing the last device → stays on
            rowFor(contentEl, "embed").findAll("lilbee-placement-toggle")[0].trigger("click");
            expect(rowFor(contentEl, "embed").findAll("lilbee-placement-toggle")[0].classList.contains("is-on")).toBe(
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

    it("rerank is single-select: its toggles are radios and picking a card replaces the pin", async () => {
        const { contentEl } = await openView(
            makePlugin(makeApi({ placement: vi.fn().mockResolvedValue(ok(multiManual())) })),
        );
        const toggles = rowFor(contentEl, "rerank").findAll("lilbee-placement-toggle");
        expect(toggles.every((t) => t.classList.contains("is-radio"))).toBe(true);
        // rerank starts pinned to device 0; embed (a mirror role) is not a radio
        expect(toggles[0].classList.contains("is-on")).toBe(true);
        expect(toggles[1].classList.contains("is-on")).toBe(false);
        expect(rowFor(contentEl, "embed").find("lilbee-placement-toggle")!.classList.contains("is-radio")).toBe(false);
        // picking device 1 moves the single pin there instead of adding a second
        toggles[1].trigger("click");
        const after = rowFor(contentEl, "rerank").findAll("lilbee-placement-toggle");
        expect(after[0].classList.contains("is-on")).toBe(false);
        expect(after[1].classList.contains("is-on")).toBe(true);
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

    it("surfaces a 422 fit rejection as the Won't fit badge, no toast", async () => {
        const api = makeApi({
            placement: vi.fn().mockResolvedValue(ok(multiManual())),
            placementPreview: vi
                .fn()
                .mockResolvedValue(
                    err(
                        new Error(
                            'Server responded 422: {"detail":"chat pinned to device 0 needs 107.7 GiB but device 0 has 40.0 GiB usable"}',
                        ),
                    ),
                ),
        });
        const { contentEl } = await openView(makePlugin(api));
        contentEl
            .findAll("lilbee-placement-btn")
            .find((b) => b.textContent === "Preview")!
            .trigger("click");
        await flush();
        expect(contentEl.find("lilbee-placement-fit")!.classList.contains("is-unfit")).toBe(true);
        expect(rowFor(contentEl, "chat").classList.contains("lilbee-placement-role-unfit")).toBe(true);
        expect(
            contentEl
                .findAll("lilbee-placement-btn")
                .find((b) => b.textContent === "Apply")!
                .classList.contains("is-disabled"),
        ).toBe(true);
        expect(Notice.instances.length).toBe(0);
    });

    it("keeps the prior fit state on a 422 that names no current role", async () => {
        const api = makeApi({
            placement: vi.fn().mockResolvedValue(ok(multiManual())),
            placementPreview: vi
                .fn()
                .mockResolvedValue(err(new Error('Server responded 422: {"detail":"spec is required"}'))),
        });
        const { contentEl } = await openView(makePlugin(api));
        contentEl
            .findAll("lilbee-placement-btn")
            .find((b) => b.textContent === "Preview")!
            .trigger("click");
        await flush();
        expect(contentEl.find("lilbee-placement-fit")!.classList.contains("is-unfit")).toBe(false);
    });
});

describe("PlacementView apply", () => {
    it("applies the built spec, shows progress, and adopts the response", async () => {
        const api = makeApi({ placement: vi.fn().mockResolvedValue(ok(multiManual())) });
        const { view, contentEl } = await openView(makePlugin(api));
        // toggle so the spec reflects an edit
        rowFor(contentEl, "embed").findAll("lilbee-placement-toggle")[0].trigger("click");
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

    it("holds the rebuilding overlay until the fleet reports ready", async () => {
        const health = vi
            .fn()
            .mockResolvedValueOnce(ok({ chat_ready: false }))
            .mockResolvedValue(ok({ chat_ready: true }));
        const api = makeApi({ placement: vi.fn().mockResolvedValue(ok(multiManual())), health });
        const { contentEl } = await openView(makePlugin(api));
        contentEl
            .findAll("lilbee-placement-btn")
            .find((b) => b.textContent === "Apply")!
            .trigger("click");
        await flush();
        // First health check reports the fleet still reloading — overlay stays up.
        expect(contentEl.find("lilbee-placement-overlay")).not.toBeNull();
        await new Promise((r) => setTimeout(r, 1700));
        await flush();
        // Second check reports ready — overlay clears.
        expect(contentEl.find("lilbee-placement-overlay")).toBeNull();
        expect(health).toHaveBeenCalledTimes(2);
    });

    it("stops waiting when the health check errors after apply", async () => {
        const api = makeApi({
            placement: vi.fn().mockResolvedValue(ok(multiManual())),
            health: vi.fn().mockResolvedValue(err(new Error("down"))),
        });
        const { contentEl } = await openView(makePlugin(api));
        contentEl
            .findAll("lilbee-placement-btn")
            .find((b) => b.textContent === "Apply")!
            .trigger("click");
        await flush();
        expect(contentEl.find("lilbee-placement-overlay")).toBeNull();
        expect(Notice.instances.map((n) => n.message)).toContain("Placement applied.");
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

    it("starts each utilization bar at no inline width (CSS drives the empty state)", async () => {
        const { contentEl } = await openView(makePlugin(makeApi()));
        expect(utilFill(contentEl, 0).style.width).toBeFalsy();
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
            rowFor(contentEl, "embed").findAll("lilbee-placement-toggle")[0].trigger("click");
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
            rowFor(contentEl, "chat").findAll("lilbee-placement-toggle")[0].trigger("click");
            vi.advanceTimersByTime(100);
            rowFor(contentEl, "chat").findAll("lilbee-placement-toggle")[0].trigger("click");
            vi.advanceTimersByTime(400);
            await Promise.resolve();
            expect(api.placementPreview).toHaveBeenCalledTimes(1);
        } finally {
            vi.useRealTimers();
        }
    });
});

type StatsApplier = { applyStats: (gpus: GpuStat[]) => void };

describe("PlacementView live usage bars", () => {
    it("moves the utilization bar, util text and memory text from a live snapshot", async () => {
        const { view, contentEl } = await openView(makePlugin(makeApi()));
        (view as unknown as StatsApplier).applyStats([
            { index: 0, utilization_pct: 73, free_bytes: 5 * GB, total_bytes: 24 * GB },
            { index: 1, utilization_pct: 10, free_bytes: 9 * GB, total_bytes: 24 * GB },
        ]);
        expect(utilFill(contentEl, 0).style.width).toBe("73%");
        expect(utilVal(contentEl, 0).textContent).toBe("73%");
        expect(vramVal(contentEl, 0).textContent).toBe("5.0 GB / 24.0 GB free");
        // Working cards glow; idle cards do not.
        expect(utilFill(contentEl, 0).classList.contains("is-active")).toBe(true);
    });

    it("keeps the real vram gauge for a discrete Metal GPU on an Intel Mac", async () => {
        const intelMac = single();
        intelMac.gpus[0].name = "AMD Radeon Pro 5500M";
        const { contentEl } = await openView(
            makePlugin(makeApi({ placement: vi.fn().mockResolvedValue(ok(intelMac)) })),
        );
        expect(vramVal(contentEl, 0).textContent).toBe("36.0 GB / 48.0 GB free");
        expect(contentEl.findAll("lilbee-meter-vram")[0].find("lilbee-bar-fill")).not.toBeNull();
    });

    it("moves util but leaves the unified capacity label alone on a Metal device", async () => {
        const { view, contentEl } = await openView(
            makePlugin(makeApi({ placement: vi.fn().mockResolvedValue(ok(single())) })),
        );
        (view as unknown as StatsApplier).applyStats([
            { index: 0, utilization_pct: 55, free_bytes: 0, total_bytes: 0 },
        ]);
        expect(utilFill(contentEl, 0).style.width).toBe("55%");
        expect(vramVal(contentEl, 0).textContent).toBe("48.0 GB unified");
    });

    it("clears the glow when a card goes idle", async () => {
        const { view, contentEl } = await openView(makePlugin(makeApi()));
        const applier = view as unknown as StatsApplier;
        applier.applyStats([{ index: 0, utilization_pct: 40, free_bytes: 5 * GB, total_bytes: 24 * GB }]);
        expect(utilFill(contentEl, 0).classList.contains("is-active")).toBe(true);
        applier.applyStats([{ index: 0, utilization_pct: 0, free_bytes: 5 * GB, total_bytes: 24 * GB }]);
        expect(utilFill(contentEl, 0).classList.contains("is-active")).toBe(false);
    });

    it("shows an em dash and empties the bar when utilization is unavailable", async () => {
        const { view, contentEl } = await openView(makePlugin(makeApi()));
        (view as unknown as StatsApplier).applyStats([
            { index: 0, utilization_pct: null, free_bytes: 1 * GB, total_bytes: 24 * GB },
        ]);
        expect(utilFill(contentEl, 0).style.width).toBe("0%");
        expect(utilVal(contentEl, 0).textContent).toBe("—");
        expect(vramVal(contentEl, 0).textContent).toBe("1.0 GB / 24.0 GB free");
    });

    it("clamps out-of-range utilization to 0-100", async () => {
        const { view, contentEl } = await openView(makePlugin(makeApi()));
        const applier = view as unknown as StatsApplier;
        applier.applyStats([{ index: 0, utilization_pct: 150, free_bytes: 0, total_bytes: 24 * GB }]);
        expect(utilFill(contentEl, 0).style.width).toBe("100%");
        applier.applyStats([{ index: 0, utilization_pct: -5, free_bytes: 0, total_bytes: 24 * GB }]);
        expect(utilFill(contentEl, 0).style.width).toBe("0%");
    });

    it("fills the vram bar to the used fraction and clamps a zero-total device to empty", async () => {
        const { view, contentEl } = await openView(makePlugin(makeApi()));
        // device 0 initial: 18/24 free → 25% used
        expect(vramFill(contentEl, 0).style.width).toBe("25%");
        const applier = view as unknown as StatsApplier;
        applier.applyStats([{ index: 0, utilization_pct: 0, free_bytes: 6 * GB, total_bytes: 24 * GB }]);
        expect(vramFill(contentEl, 0).style.width).toBe("75%");
        // a device reporting zero total memory can't divide → empty bar
        applier.applyStats([{ index: 0, utilization_pct: 0, free_bytes: 0, total_bytes: 0 }]);
        expect(vramFill(contentEl, 0).style.width).toBe("0%");
    });

    it("skips stats for a device index it isn't rendering", async () => {
        const { view, contentEl } = await openView(makePlugin(makeApi()));
        (view as unknown as StatsApplier).applyStats([
            { index: 99, utilization_pct: 50, free_bytes: 0, total_bytes: 24 * GB },
        ]);
        expect(utilVal(contentEl, 0).textContent).toBe("—");
    });

    it("subscribes to the stats stream on open and applies streamed events", async () => {
        const api = makeApi({
            gpuStatsStream: vi.fn(() =>
                statsStream(statsEvent([{ index: 0, utilization_pct: 42, free_bytes: 2 * GB, total_bytes: 24 * GB }])),
            ),
        });
        const view = new PlacementView(new WorkspaceLeaf(), makePlugin(api));
        await view.onOpen();
        await flush();
        const contentEl = (view as unknown as { contentEl: MockElement }).contentEl;
        expect(api.gpuStatsStream).toHaveBeenCalled();
        expect(utilVal(contentEl, 0).textContent).toBe("42%");
        await view.onClose();
    });

    it("ignores non-gpu_stats events on the stream", async () => {
        const api = makeApi({
            gpuStatsStream: vi.fn(() => statsStream({ event: "done", data: {} })),
        });
        const view = new PlacementView(new WorkspaceLeaf(), makePlugin(api));
        await view.onOpen();
        await flush();
        const contentEl = (view as unknown as { contentEl: MockElement }).contentEl;
        expect(utilVal(contentEl, 0).textContent).toBe("—");
        await view.onClose();
    });

    it("swallows a stats-stream error", async () => {
        const api = makeApi({
            gpuStatsStream: vi.fn(() =>
                (async function* (): AsyncGenerator<SSEEvent, void> {
                    throw new Error("stream boom");
                })(),
            ),
        });
        const view = new PlacementView(new WorkspaceLeaf(), makePlugin(api));
        await expect(view.onOpen()).resolves.toBeUndefined();
        await flush();
        await view.onClose();
    });

    it("opens a stats stream on open and aborts it on close", async () => {
        const api = makeApi();
        const view = new PlacementView(new WorkspaceLeaf(), makePlugin(api));
        await view.onOpen();
        expect((view as unknown as { statsController: AbortController | null }).statsController).not.toBeNull();
        await view.onClose();
        expect((view as unknown as { statsController: AbortController | null }).statsController).toBeNull();
    });
});

afterEach(() => {
    vi.useRealTimers();
});

describe("revealPlacementBeside", () => {
    it("splits beside the source leaf and opens placement when none is open", async () => {
        const app = new App();
        const newLeaf = new WorkspaceLeaf(app);
        app.workspace.getLeavesOfType = vi.fn().mockReturnValue([]);
        app.workspace.createLeafBySplit = vi.fn().mockReturnValue(newLeaf);
        app.workspace.revealLeaf = vi.fn();
        const source = new WorkspaceLeaf(app);
        await revealPlacementBeside(app as never, source as never);
        expect(app.workspace.createLeafBySplit).toHaveBeenCalledWith(source, "vertical");
        expect(newLeaf.setViewState).toHaveBeenCalledWith({ type: VIEW_TYPE_PLACEMENT, active: false });
        expect(app.workspace.revealLeaf).toHaveBeenCalledWith(newLeaf);
    });

    it("reveals an existing placement leaf instead of splitting again", async () => {
        const app = new App();
        const existing = new WorkspaceLeaf(app);
        app.workspace.getLeavesOfType = vi.fn().mockReturnValue([existing]);
        app.workspace.createLeafBySplit = vi.fn();
        app.workspace.revealLeaf = vi.fn();
        await revealPlacementBeside(app as never, new WorkspaceLeaf(app) as never);
        expect(app.workspace.revealLeaf).toHaveBeenCalledWith(existing);
        expect(app.workspace.createLeafBySplit).not.toHaveBeenCalled();
    });
});
