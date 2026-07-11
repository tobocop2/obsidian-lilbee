import { ItemView, Notice, Platform, WorkspaceLeaf, type App } from "obsidian";
import type LilbeePlugin from "../main";
import { isHttpStatus } from "../api";
import { displayLabelForRef } from "../utils/model-ref";
import {
    ERROR_NAME,
    PLACEMENT_MODE,
    REPLICA_ROLES,
    SSE_EVENT,
    WORKER_ROLE,
    type GpuInfo,
    type GpuStat,
    type GpuStatsPayload,
    type PlacementMode,
    type PlacementResponse,
    type PlacementRoleSpec,
    type PlacementSpec,
    type RolePlacement,
    type WorkerRole,
} from "../types";
import { MESSAGES } from "../locales/en";
import { errorMessage } from "../utils";

export const VIEW_TYPE_PLACEMENT = "lilbee-placement";

/** Open the GPU placement view in a split beside `sourceLeaf` so live GPU
 *  activity sits next to the chat. Reuses an existing placement leaf if open. */
export async function revealPlacementBeside(app: App, sourceLeaf: WorkspaceLeaf): Promise<void> {
    const existing = app.workspace.getLeavesOfType(VIEW_TYPE_PLACEMENT);
    if (existing.length > 0) {
        app.workspace.revealLeaf(existing[0]);
        return;
    }
    const leaf = app.workspace.createLeafBySplit(sourceLeaf, "vertical");
    await leaf.setViewState({ type: VIEW_TYPE_PLACEMENT, active: false });
    app.workspace.revealLeaf(leaf);
}

const PREVIEW_DEBOUNCE_MS = 350;
const STARTUP_RETRY_MS = 2000;
const HTTP_CONFLICT = 409;
const HTTP_UNPROCESSABLE = 422;
const GB = 1_000_000_000;

/** A role row's editable state while a manual placement is being assembled. */
interface RoleDraft {
    devices: Set<number>;
    replicas: number;
}

function formatGb(bytes: number): string {
    return `${(bytes / GB).toFixed(1)} GB`;
}

/** Apple's Metal backend has no live GPU-memory sampling; its memory figure is a capacity, not a gauge.
 *  The server reports the device prefix "MTL"; older builds emit "Metal". */
const UNIFIED_BACKENDS = new Set(["mtl", "metal"]);
function isUnifiedMemory(gpu: GpuInfo): boolean {
    return UNIFIED_BACKENDS.has(gpu.backend.toLowerCase());
}

export class PlacementView extends ItemView {
    private plugin: LilbeePlugin;
    private current: PlacementResponse | null = null;
    private mode: PlacementMode = PLACEMENT_MODE.AUTO;
    private draft: Map<WorkerRole, RoleDraft> = new Map();
    private applying = false;
    private unplaceable: string[] = [];
    private applyDisabled = false;
    private multiDevice = false;
    private previewTimer: number | null = null;
    private startupRetryTimer: number | null = null;
    private waitingForServer = false;
    private statsController: AbortController | null = null;
    /** Live util + vram bars and their text per device index, updated in place by the stats stream. */
    // vramFill/memText are absent on unified-memory rows, which render a static capacity label.
    private gpuBars: Map<
        number,
        { utilFill: HTMLElement; utilText: HTMLElement; vramFill?: HTMLElement; memText?: HTMLElement }
    > = new Map();
    private bodyEl: HTMLElement | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: LilbeePlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return VIEW_TYPE_PLACEMENT;
    }

    getDisplayText(): string {
        return MESSAGES.LABEL_PLACEMENT_VIEW;
    }

    getIcon(): string {
        return "cpu";
    }

    async onOpen(): Promise<void> {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("lilbee-placement-container");
        this.bodyEl = contentEl.createDiv({ cls: "lilbee-placement-body" });
        await this.reload();
        // Stream live per-GPU utilization + memory so the cards animate as the
        // fleet loads and ingest runs, instead of freezing at the open snapshot.
        void this.subscribeStats();
    }

    async reload(): Promise<void> {
        const result = await this.plugin.api.placement();
        if (result.isErr()) {
            this.current = null;
            if (result.error.name === ERROR_NAME.SERVER_STARTING) {
                this.waitingForServer = true;
                this.renderWaitingForServer();
                this.scheduleStartupRetry();
                return;
            }
            this.waitingForServer = false;
            this.renderMessage(
                MESSAGES.PLACEMENT_LOAD_FAILED(
                    errorMessage(result.error, MESSAGES.ERROR_UNKNOWN, this.plugin.settings.serverMode),
                ),
            );
            return;
        }
        const resumedAfterWait = this.waitingForServer;
        this.waitingForServer = false;
        this.adoptResponse(result.value);
        // The stats stream opened at onOpen died while the server was booting;
        // reopen it so the freshly rendered cards animate.
        if (resumedAfterWait) void this.subscribeStats();
    }

    /** Live holding state while the server boots; reload() polls until it answers. */
    private renderWaitingForServer(): void {
        if (!this.bodyEl) return;
        this.bodyEl.empty();
        const wait = this.bodyEl.createDiv({ cls: "lilbee-placement-empty lilbee-placement-waiting" });
        wait.createDiv({ cls: "lilbee-placement-spinner" });
        wait.createDiv({ text: MESSAGES.PLACEMENT_WAITING_SERVER });
    }

    private scheduleStartupRetry(): void {
        if (this.startupRetryTimer !== null) window.clearTimeout(this.startupRetryTimer);
        this.startupRetryTimer = window.setTimeout(() => {
            this.startupRetryTimer = null;
            void this.reload();
        }, STARTUP_RETRY_MS);
    }

    /** Rebuild the editable draft from the current resolved plan. */
    private seedDraft(roles: RolePlacement[]): void {
        this.draft = new Map();
        for (const role of roles) {
            this.draft.set(role.role, { devices: new Set(role.devices), replicas: role.replicas });
        }
    }

    /** The draft for a role, created (pinned to no device, single replica) if absent. */
    private draftFor(role: WorkerRole): RoleDraft {
        let d = this.draft.get(role);
        if (!d) {
            d = { devices: new Set(), replicas: 1 };
            this.draft.set(role, d);
        }
        return d;
    }

    private renderMessage(message: string): void {
        if (!this.bodyEl) return;
        this.bodyEl.empty();
        this.bodyEl.createDiv({ cls: "lilbee-placement-empty", text: message });
    }

    private render(): void {
        const data = this.current;
        if (!this.bodyEl || !data) return;
        this.multiDevice = data.gpus.length >= 2;
        this.gpuBars.clear();
        this.bodyEl.empty();
        this.renderHeader(this.bodyEl, data);
        if (data.gpus.length < 2) {
            this.renderSingleDevice(this.bodyEl, data);
        } else {
            this.renderMatrix(this.bodyEl, data);
        }
        this.renderFooter(this.bodyEl, data);
        if (this.applying) this.renderApplyingOverlay(this.bodyEl);
    }

    private stateLabel(data: PlacementResponse): string {
        if (this.applying) return MESSAGES.PLACEMENT_STATE_APPLYING;
        if (this.mode === PLACEMENT_MODE.MANUAL) {
            return this.isEdited(data) ? MESSAGES.PLACEMENT_STATE_EDITED : MESSAGES.PLACEMENT_STATE_MANUAL;
        }
        return MESSAGES.PLACEMENT_STATE_AUTO;
    }

    private renderHeader(container: HTMLElement, data: PlacementResponse): void {
        const header = container.createDiv({ cls: "lilbee-placement-header" });
        header.createEl("h2", { text: MESSAGES.PLACEMENT_TITLE });
        const state = this.applying ? "applying" : this.mode;
        header.createSpan({ cls: `lilbee-placement-state is-${state}`, text: this.stateLabel(data) });
    }

    private renderSectionTitle(container: HTMLElement, text: string): void {
        container.createDiv({ cls: "lilbee-placement-section-title", text });
    }

    // ---- hardware cards -------------------------------------------------------

    /** Single device: one unified/CPU host card (no discrete GPUs) or one GPU card. */
    private renderSingleDevice(container: HTMLElement, data: PlacementResponse): void {
        this.renderSectionTitle(container, MESSAGES.PLACEMENT_SECTION_HARDWARE);
        const hw = container.createDiv({ cls: "lilbee-placement-hw" });
        if (data.gpus.length === 1) {
            this.renderGpuRow(hw, data.gpus[0], data);
        } else {
            this.renderHostCard(hw);
        }
        this.renderRoleSection(container, data, null);
    }

    /** The host's compute when no discrete GPU is enumerated: Apple unified memory
     * (the chat fleet runs on Metal) or a plain CPU host elsewhere. */
    private renderHostCard(container: HTMLElement): void {
        const card = container.createDiv({ cls: "lilbee-placement-card" });
        const head = card.createDiv({ cls: "lilbee-placement-card-head" });
        if (Platform.isMacOS) {
            head.createSpan({ cls: "lilbee-placement-card-name", text: MESSAGES.PLACEMENT_HOST_APPLE });
            head.createSpan({ cls: "lilbee-placement-card-sub", text: MESSAGES.PLACEMENT_HOST_APPLE_SUB });
        } else {
            head.createSpan({ cls: "lilbee-placement-card-name", text: MESSAGES.PLACEMENT_HOST_CPU });
            head.createSpan({ cls: "lilbee-placement-card-sub", text: MESSAGES.PLACEMENT_HOST_CPU_SUB });
        }
    }

    /** One GPU as a compact row: index chip, name, role badges, and util + vram
     *  mini-bars. Scales to many GPUs where a card-per-GPU layout would not. */
    private renderGpuRow(container: HTMLElement, gpu: GpuInfo, data: PlacementResponse): void {
        const row = container.createDiv({ cls: "lilbee-gpu-row" });
        row.createSpan({ cls: "lilbee-gpu-idx", text: String(gpu.index) });
        const top = row.createDiv({ cls: "lilbee-gpu-top" });
        top.createSpan({ cls: "lilbee-gpu-name", text: gpu.name });
        const badges = top.createDiv({ cls: "lilbee-gpu-roles" });
        for (const role of data.roles) {
            if (role.devices.includes(gpu.index)) {
                badges.createSpan({ cls: `lilbee-role-badge is-${role.role}`, text: role.role });
            }
        }
        const meters = row.createDiv({ cls: "lilbee-gpu-meters" });
        const util = this.renderMeter(meters, "util", MESSAGES.PLACEMENT_METER_UTIL);
        util.val.setText(MESSAGES.PLACEMENT_UTIL_NA);
        if (isUnifiedMemory(gpu)) {
            // Apple reports no live GPU-memory usage, so a free/total gauge would
            // sit at "all free" forever. Show the unified capacity as a plain label.
            const meter = meters.createDiv({ cls: "lilbee-meter lilbee-meter-vram" });
            meter.createSpan({ cls: "lilbee-meter-label", text: MESSAGES.PLACEMENT_METER_VRAM });
            meter.createSpan({
                cls: "lilbee-meter-val",
                text: MESSAGES.PLACEMENT_MEM_UNIFIED(formatGb(gpu.total_bytes)),
            });
            this.gpuBars.set(gpu.index, { utilFill: util.fill, utilText: util.val });
            return;
        }
        const vram = this.renderMeter(meters, "vram", MESSAGES.PLACEMENT_METER_VRAM);
        this.setVram(vram, gpu.free_bytes, gpu.total_bytes);
        // Keep refs so the live stats stream can move the bars without a full re-render.
        this.gpuBars.set(gpu.index, {
            utilFill: util.fill,
            utilText: util.val,
            vramFill: vram.fill,
            memText: vram.val,
        });
    }

    /** A labelled mini-bar ("util" / "vram"): label, track+fill, value text. */
    private renderMeter(
        container: HTMLElement,
        variant: "util" | "vram",
        label: string,
    ): { fill: HTMLElement; val: HTMLElement } {
        const meter = container.createDiv({ cls: `lilbee-meter lilbee-meter-${variant}` });
        meter.createSpan({ cls: "lilbee-meter-label", text: label });
        const bar = meter.createDiv({ cls: "lilbee-bar" });
        const fill = bar.createDiv({ cls: "lilbee-bar-fill" });
        const val = meter.createSpan({ cls: "lilbee-meter-val" });
        return { fill, val };
    }

    /** Fill the vram bar to the used fraction and set its free/total text. */
    private setVram(vram: { fill: HTMLElement; val: HTMLElement }, freeBytes: number, totalBytes: number): void {
        const usedPct = totalBytes > 0 ? this.clampPct(((totalBytes - freeBytes) / totalBytes) * 100) : 0;
        vram.fill.setCssProps({ width: `${usedPct}%` });
        vram.val.setText(MESSAGES.PLACEMENT_MEM_FREE(formatGb(freeBytes), formatGb(totalBytes)));
    }

    // ---- roles ----------------------------------------------------------------

    /** The Roles section. `gpus` non-null renders the per-role GPU toggle matrix. */
    private renderRoleSection(container: HTMLElement, data: PlacementResponse, gpus: GpuInfo[] | null): void {
        this.renderSectionTitle(container, MESSAGES.PLACEMENT_SECTION_ROLES);
        const table = container.createDiv({ cls: "lilbee-placement-roles" });
        for (const role of data.roles) {
            this.renderRoleRow(table, role, gpus);
        }
    }

    private renderRoleRow(container: HTMLElement, role: RolePlacement, gpus: GpuInfo[] | null): void {
        const row = container.createDiv({ cls: "lilbee-placement-role-row" });
        row.dataset.role = role.role;
        if (this.unplaceable.includes(role.role)) row.addClass("lilbee-placement-role-unfit");
        const head = row.createDiv({ cls: "lilbee-placement-role-head" });
        head.createSpan({ cls: `lilbee-placement-badge is-${role.role}`, text: role.role });
        head.createSpan({ cls: "lilbee-placement-role-hint", text: this.roleHint(role.role) });
        row.createSpan({
            cls: "lilbee-placement-role-model",
            text: role.model ? displayLabelForRef(role.model) : MESSAGES.PLACEMENT_NOT_SET,
        });
        // Truthy: absent on older servers, 0 for a role with no model loaded.
        if (role.vram_bytes) {
            const vram = row.createSpan({
                cls: "lilbee-placement-role-vram",
                text: MESSAGES.PLACEMENT_ROLE_VRAM(formatGb(role.vram_bytes)),
            });
            this.tip(vram, MESSAGES.PLACEMENT_TIP_ROLE_VRAM(role.role));
        }
        if (gpus) {
            const toggles = row.createDiv({ cls: "lilbee-placement-toggles" });
            for (const gpu of gpus) {
                this.renderToggle(toggles, role.role, gpu);
            }
        }
        if (REPLICA_ROLES.has(role.role)) this.renderStepper(row, role.role);
    }

    /** A single-instance role (rerank) pins to exactly one card: it is neither
     *  tensor-split like chat nor data-parallel replicated like embed/vision. */
    private isSingleSelect(role: WorkerRole): boolean {
        return role !== WORKER_ROLE.CHAT && !REPLICA_ROLES.has(role);
    }

    /** The one-word placement rule shown under each role: split / mirror / one card. */
    private roleHint(role: WorkerRole): string {
        if (role === WORKER_ROLE.CHAT) return MESSAGES.PLACEMENT_HINT_SPLIT;
        if (REPLICA_ROLES.has(role)) return MESSAGES.PLACEMENT_HINT_MIRROR;
        return MESSAGES.PLACEMENT_HINT_SINGLE;
    }

    // ---- multi-GPU matrix -----------------------------------------------------

    private renderMatrix(container: HTMLElement, data: PlacementResponse): void {
        this.renderSectionTitle(container, MESSAGES.PLACEMENT_SECTION_HARDWARE);
        const hw = container.createDiv({ cls: "lilbee-placement-hw" });
        for (const gpu of data.gpus) {
            this.renderGpuRow(hw, gpu, data);
        }
        this.renderRoleSection(container, data, data.gpus);
    }

    private renderToggle(container: HTMLElement, role: WorkerRole, gpu: GpuInfo): void {
        const draft = this.draftFor(role);
        let cls = "lilbee-placement-toggle";
        if (this.isSingleSelect(role)) cls += " is-radio";
        if (draft.devices.has(gpu.index)) cls += " is-on";
        const toggle = container.createEl("button", { cls, text: String(gpu.index) });
        if (this.isEditable()) {
            this.tip(toggle, MESSAGES.PLACEMENT_TIP_CHIP(role, gpu.label));
            toggle.addEventListener("click", () => this.toggleDevice(role, gpu.index));
        } else {
            this.makeReadOnly(toggle);
        }
    }

    private renderStepper(container: HTMLElement, role: WorkerRole): void {
        const draft = this.draftFor(role);
        const stepper = container.createDiv({ cls: "lilbee-placement-stepper" });
        const dec = stepper.createEl("button", { cls: "lilbee-placement-step", text: "−" });
        stepper.createSpan({ cls: "lilbee-placement-step-count", text: `×${draft.replicas}` });
        const inc = stepper.createEl("button", { cls: "lilbee-placement-step", text: "+" });
        if (this.isEditable()) {
            this.tip(dec, MESSAGES.PLACEMENT_TIP_REPLICA_REMOVE(role));
            this.tip(inc, MESSAGES.PLACEMENT_TIP_REPLICA_ADD(role));
            dec.addEventListener("click", () => this.changeReplicas(role, -1));
            inc.addEventListener("click", () => this.changeReplicas(role, 1));
        } else {
            this.makeReadOnly(dec);
            this.makeReadOnly(inc);
        }
    }

    /** Tooltip via aria-label only: Obsidian renders its own styled tooltip from
     * it. Setting `title` too would stack a second native tooltip on hover. */
    private tip(el: HTMLElement, text: string): void {
        el.setAttribute("aria-label", text);
    }

    /** A disabled control: greyed, tooltipped with why, and a click explains where
     * to make the change instead (rather than silently doing nothing). */
    private makeReadOnly(el: HTMLElement): void {
        el.addClass("is-readonly");
        this.tip(el, this.readOnlyHint());
        el.addEventListener("click", () => new Notice(this.readOnlyHint()));
    }

    /** Why editing is unavailable: enter manual mode on multi-GPU, or use Settings
     * on a single/unified device where there is nothing to assign. */
    private readOnlyHint(): string {
        return this.multiDevice ? MESSAGES.PLACEMENT_HINT_EDIT_MANUALLY : MESSAGES.PLACEMENT_HINT_REPLICAS_SETTINGS;
    }

    private clampPct(pct: number): number {
        return Math.min(100, Math.max(0, Math.round(pct)));
    }

    /** Subscribe to the live GPU stats SSE stream; each event moves the bars in
     * place. The stream stays open until the view closes (onClose aborts it) or
     * the server drops it, in which case the bars hold their last values. */
    private async subscribeStats(): Promise<void> {
        this.statsController = new AbortController();
        try {
            for await (const event of this.plugin.api.gpuStatsStream(this.statsController.signal)) {
                if (event.event === SSE_EVENT.GPU_STATS) {
                    this.applyStats((event.data as GpuStatsPayload).gpus);
                }
            }
        } catch {
            // Stream aborted (view closed) or failed (server gone): leave the bars as they are.
        }
    }

    /** Move each card's utilization bar and util/memory text from a live snapshot.
     * Skips devices not currently rendered (a reload rebuilds the cards). */
    private applyStats(gpus: GpuStat[]): void {
        for (const gpu of gpus) {
            const refs = this.gpuBars.get(gpu.index);
            if (!refs) continue;
            const pct = gpu.utilization_pct;
            const clamped = pct === null ? 0 : this.clampPct(pct);
            refs.utilFill.setCssProps({ width: `${clamped}%` });
            // Glow only while the card is actually working; idle bars stay flat.
            refs.utilFill.toggleClass("is-active", clamped > 0);
            refs.utilText.setText(pct === null ? MESSAGES.PLACEMENT_UTIL_NA : MESSAGES.PLACEMENT_UTIL(clamped));
            if (refs.vramFill && refs.memText) {
                this.setVram({ fill: refs.vramFill, val: refs.memText }, gpu.free_bytes, gpu.total_bytes);
            }
        }
    }

    /** Chips and replica steppers are editable only in manual mode, which is
     * reachable only on multi-GPU hosts. A single or unified device has nothing to
     * assign — the server rejects a device-less spec — so replica counts there are
     * configured in Settings (Hardware / fleet), not here. */
    private isEditable(): boolean {
        return this.mode === PLACEMENT_MODE.MANUAL && !this.applying;
    }

    // ---- footer + actions -----------------------------------------------------

    private renderFooter(container: HTMLElement, data: PlacementResponse): void {
        const footer = container.createDiv({ cls: "lilbee-placement-footer" });
        const fit = footer.createSpan({ cls: "lilbee-placement-fit" });
        fit.createSpan({ cls: "lilbee-placement-fit-dot" });
        const label = fit.createSpan({ cls: "lilbee-placement-fit-label" });
        if (this.unplaceable.length > 0) {
            fit.addClass("is-unfit");
            label.setText(MESSAGES.PLACEMENT_WONT_FIT(this.unplaceable.join(", ")));
        } else if (this.mode === PLACEMENT_MODE.AUTO) {
            fit.addClass("is-muted");
            label.setText(MESSAGES.PLACEMENT_AUTO_MANAGED);
        } else {
            label.setText(MESSAGES.PLACEMENT_FITS);
        }
        this.renderFooterButtons(footer, data);
    }

    private renderFooterButtons(footer: HTMLElement, data: PlacementResponse): void {
        if (this.mode === PLACEMENT_MODE.AUTO) {
            // Single device has nothing to assign; multi-GPU offers manual editing.
            if (data.gpus.length >= 2) {
                const edit = footer.createEl("button", { cls: "lilbee-placement-btn", text: MESSAGES.PLACEMENT_EDIT });
                edit.addEventListener("click", () => this.enterManual());
            }
            return;
        }
        const preview = footer.createEl("button", { cls: "lilbee-placement-btn", text: MESSAGES.PLACEMENT_PREVIEW });
        preview.addEventListener("click", () => void this.runPreview());
        const apply = footer.createEl("button", {
            cls: "lilbee-placement-btn lilbee-placement-btn-primary",
            text: MESSAGES.PLACEMENT_APPLY,
        });
        if (this.applyBlocked()) apply.addClass("is-disabled");
        else apply.addEventListener("click", () => void this.runApply());
        const reset = footer.createEl("button", { cls: "lilbee-placement-btn", text: MESSAGES.PLACEMENT_RESET });
        reset.addEventListener("click", () => void this.runReset());
    }

    private applyBlocked(): boolean {
        return this.unplaceable.length > 0 || this.applyDisabled || this.applying;
    }

    private renderApplyingOverlay(container: HTMLElement): void {
        const overlay = container.createDiv({ cls: "lilbee-placement-overlay" });
        overlay.createDiv({ cls: "lilbee-placement-spinner" });
        overlay.createDiv({ cls: "lilbee-placement-overlay-text", text: MESSAGES.PLACEMENT_REBUILDING });
    }

    // ---- edit transitions -----------------------------------------------------

    private enterManual(): void {
        this.mode = PLACEMENT_MODE.MANUAL;
        this.render();
    }

    private toggleDevice(role: WorkerRole, deviceIndex: number): void {
        const draft = this.draftFor(role);
        if (this.isSingleSelect(role)) {
            // rerank is a single pinned instance: picking a card replaces the pin.
            draft.devices = new Set([deviceIndex]);
        } else if (draft.devices.has(deviceIndex)) {
            // Keep at least one device per role — the server rejects an empty set.
            if (draft.devices.size > 1) draft.devices.delete(deviceIndex);
        } else {
            draft.devices.add(deviceIndex);
        }
        this.render();
        this.schedulePreview();
    }

    private changeReplicas(role: WorkerRole, delta: number): void {
        const draft = this.draftFor(role);
        draft.replicas = Math.max(1, draft.replicas + delta);
        this.render();
        this.schedulePreview();
    }

    /** True when the draft diverges from the resolved plan we loaded. */
    private isEdited(data: PlacementResponse): boolean {
        for (const role of data.roles) {
            const draft = this.draftFor(role.role);
            if (draft.replicas !== role.replicas) return true;
            if (draft.devices.size !== role.devices.length) return true;
            if (!role.devices.every((d) => draft.devices.has(d))) return true;
        }
        return false;
    }

    /** Build the wire spec covering every drafted role. */
    private buildSpec(): PlacementSpec {
        const spec: PlacementSpec = {};
        for (const [role, draft] of this.draft) {
            const entry: PlacementRoleSpec = { devices: [...draft.devices].sort((a, b) => a - b) };
            if (REPLICA_ROLES.has(role)) entry.replicas = draft.replicas;
            spec[role] = entry;
        }
        return spec;
    }

    private schedulePreview(): void {
        if (this.previewTimer !== null) window.clearTimeout(this.previewTimer);
        this.previewTimer = window.setTimeout(() => {
            this.previewTimer = null;
            void this.runPreview();
        }, PREVIEW_DEBOUNCE_MS);
    }

    private async runPreview(): Promise<void> {
        // Preview is automatic (debounced on every edit), so a failure stays quiet
        // (no toast) — but a fit rejection surfaces as the "Won't fit" badge so a
        // model pinned to too few GPUs reads as won't-fit, not as nothing happening.
        const result = await this.plugin.api.placementPreview(this.buildSpec());
        if (result.isErr()) {
            this.unplaceable = this.unplaceableFrom422(result.error);
            this.render();
            return;
        }
        this.unplaceable = result.value.unplaceable;
        this.render();
    }

    /** The server rejects an impossible pin with a 422 naming the role(s) that
     * won't fit ("chat pinned to device 0 needs N GiB but device 0 has M GiB").
     * Map that to the unplaceable list; on any other error keep the prior state. */
    private unplaceableFrom422(error: Error): string[] {
        if (!isHttpStatus(error, HTTP_UNPROCESSABLE)) return this.unplaceable;
        const roles = [...this.draft.keys()].filter((role) => error.message.includes(`${role} pinned to device`));
        return roles.length > 0 ? roles : this.unplaceable;
    }

    private async runApply(): Promise<void> {
        this.applying = true;
        this.render();
        const result = await this.plugin.api.applyPlacement(this.buildSpec());
        if (result.isErr()) {
            this.applying = false;
            this.handleMutationError(result.error);
            this.render();
            return;
        }
        this.adoptResponse(result.value);
        // The model reloads on the new device layout — keep the "Rebuilding fleet"
        // overlay up until it reports ready, so the view isn't a silent idle screen.
        this.applying = true;
        this.render();
        await this.waitForFleetReady();
        this.applying = false;
        this.render();
        new Notice(MESSAGES.PLACEMENT_APPLIED);
    }

    /** Poll health until the fleet reports ready after a placement change; stops
     *  early on an errored/absent health signal so it never blocks indefinitely. */
    private async waitForFleetReady(): Promise<void> {
        for (let i = 0; i < 200; i++) {
            const health = await this.plugin.api.health();
            if (health.isErr() || health.value.chat_ready !== false) return;
            await new Promise((r) => setTimeout(r, 1500));
        }
    }

    private async runReset(): Promise<void> {
        this.applying = true;
        this.render();
        const result = await this.plugin.api.clearPlacement();
        this.applying = false;
        if (result.isErr()) {
            this.handleMutationError(result.error);
            this.render();
            return;
        }
        new Notice(MESSAGES.PLACEMENT_RESET_DONE);
        this.adoptResponse(result.value);
    }

    private adoptResponse(response: PlacementResponse): void {
        this.current = response;
        this.mode = response.manual ? PLACEMENT_MODE.MANUAL : PLACEMENT_MODE.AUTO;
        this.unplaceable = response.unplaceable;
        this.applyDisabled = false;
        this.seedDraft(response.roles);
        this.render();
    }

    private handleMutationError(error: Error): void {
        if (isHttpStatus(error, HTTP_CONFLICT)) {
            this.applyDisabled = true;
            new Notice(MESSAGES.PLACEMENT_APPLY_NOT_ENABLED);
            return;
        }
        new Notice(
            MESSAGES.PLACEMENT_APPLY_FAILED(
                errorMessage(error, MESSAGES.ERROR_UNKNOWN, this.plugin.settings.serverMode),
            ),
        );
    }

    async onClose(): Promise<void> {
        if (this.previewTimer !== null) {
            window.clearTimeout(this.previewTimer);
            this.previewTimer = null;
        }
        if (this.startupRetryTimer !== null) {
            window.clearTimeout(this.startupRetryTimer);
            this.startupRetryTimer = null;
        }
        if (this.statsController !== null) {
            this.statsController.abort();
            this.statsController = null;
        }
    }
}
