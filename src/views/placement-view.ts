import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import type LilbeePlugin from "../main";
import { isHttpStatus } from "../api";
import {
    PLACEMENT_MODE,
    REPLICA_ROLES,
    type GpuInfo,
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

const PREVIEW_DEBOUNCE_MS = 350;
const HTTP_CONFLICT = 409;
const GB = 1_000_000_000;

/** A role row's editable state while a manual placement is being assembled. */
interface RoleDraft {
    devices: Set<number>;
    replicas: number;
}

function formatGb(bytes: number): string {
    return `${(bytes / GB).toFixed(1)} GB`;
}

export class PlacementView extends ItemView {
    private plugin: LilbeePlugin;
    private current: PlacementResponse | null = null;
    private mode: PlacementMode = PLACEMENT_MODE.AUTO;
    private draft: Map<WorkerRole, RoleDraft> = new Map();
    private applying = false;
    private unplaceable: string[] = [];
    private applyDisabled = false;
    private previewTimer: number | null = null;
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
    }

    async reload(): Promise<void> {
        const result = await this.plugin.api.placement();
        if (result.isErr()) {
            this.current = null;
            this.renderMessage(
                MESSAGES.PLACEMENT_LOAD_FAILED(
                    errorMessage(result.error, MESSAGES.ERROR_UNKNOWN, this.plugin.settings.serverMode),
                ),
            );
            return;
        }
        this.adoptResponse(result.value);
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
        header.createSpan({ cls: "lilbee-placement-state", text: this.stateLabel(data) });
    }

    // ---- single-device (the common case: unified memory or one GPU) ----------

    private renderSingleDevice(container: HTMLElement, data: PlacementResponse): void {
        if (data.gpus.length === 1) {
            this.renderDeviceSummary(container, data.gpus[0]);
        } else {
            container.createDiv({ cls: "lilbee-placement-device", text: MESSAGES.PLACEMENT_NO_GPUS });
        }
        const table = container.createDiv({ cls: "lilbee-placement-roles" });
        for (const role of data.roles) {
            this.renderRoleStatusRow(table, role);
        }
    }

    private renderDeviceSummary(container: HTMLElement, gpu: GpuInfo): void {
        const dev = container.createDiv({ cls: "lilbee-placement-device" });
        dev.createSpan({ cls: "lilbee-placement-device-name", text: gpu.name });
        this.renderBar(dev, gpu.total_bytes - gpu.free_bytes, gpu.total_bytes);
        dev.createSpan({
            cls: "lilbee-placement-mem",
            text: MESSAGES.PLACEMENT_MEM_FREE(formatGb(gpu.free_bytes), formatGb(gpu.total_bytes)),
        });
    }

    private renderRoleStatusRow(container: HTMLElement, role: RolePlacement): void {
        const row = container.createDiv({ cls: "lilbee-placement-role-row" });
        row.dataset.role = role.role;
        row.createSpan({ cls: "lilbee-placement-role-name", text: role.role });
        row.createSpan({ cls: "lilbee-placement-role-model", text: role.model || MESSAGES.PLACEMENT_NOT_SET });
        if (REPLICA_ROLES.has(role.role)) this.renderStepper(row, role.role);
    }

    // ---- multi-GPU matrix -----------------------------------------------------

    private renderMatrix(container: HTMLElement, data: PlacementResponse): void {
        const gpuTable = container.createDiv({ cls: "lilbee-placement-gpus" });
        for (const gpu of data.gpus) {
            this.renderGpuRow(gpuTable, gpu);
        }
        const matrix = container.createDiv({ cls: "lilbee-placement-matrix" });
        for (const role of data.roles) {
            this.renderMatrixRow(matrix, role, data.gpus);
        }
    }

    private renderGpuRow(container: HTMLElement, gpu: GpuInfo): void {
        const row = container.createDiv({ cls: "lilbee-placement-gpu-row" });
        row.createSpan({ cls: "lilbee-placement-gpu-label", text: gpu.label });
        row.createSpan({ cls: "lilbee-placement-gpu-name", text: gpu.name });
        this.renderBar(row, gpu.total_bytes - gpu.free_bytes, gpu.total_bytes);
        row.createSpan({
            cls: "lilbee-placement-mem",
            text: MESSAGES.PLACEMENT_MEM_FREE(formatGb(gpu.free_bytes), formatGb(gpu.total_bytes)),
        });
    }

    private renderMatrixRow(container: HTMLElement, role: RolePlacement, gpus: GpuInfo[]): void {
        const row = container.createDiv({ cls: "lilbee-placement-role-row" });
        row.dataset.role = role.role;
        if (this.unplaceable.includes(role.role)) row.addClass("lilbee-placement-role-unfit");
        row.createSpan({ cls: "lilbee-placement-role-name", text: role.role });
        const chips = row.createDiv({ cls: "lilbee-placement-chips" });
        for (const gpu of gpus) {
            this.renderChip(chips, role.role, gpu);
        }
        if (role.tensor_split && role.tensor_split.length > 0) {
            row.createSpan({
                cls: "lilbee-placement-split",
                text: MESSAGES.PLACEMENT_SPLIT(role.tensor_split.join("/")),
            });
        }
        if (REPLICA_ROLES.has(role.role)) this.renderStepper(row, role.role);
    }

    private renderChip(container: HTMLElement, role: WorkerRole, gpu: GpuInfo): void {
        const draft = this.draftFor(role);
        const on = draft.devices.has(gpu.index);
        const chip = container.createEl("button", {
            cls: on ? "lilbee-placement-chip is-on" : "lilbee-placement-chip",
            text: gpu.label,
        });
        if (this.isEditable()) chip.addEventListener("click", () => this.toggleDevice(role, gpu.index));
        else chip.addClass("is-readonly");
    }

    private renderStepper(container: HTMLElement, role: WorkerRole): void {
        const draft = this.draftFor(role);
        const stepper = container.createDiv({ cls: "lilbee-placement-stepper" });
        const dec = stepper.createEl("button", { cls: "lilbee-placement-step", text: "−" });
        stepper.createSpan({ cls: "lilbee-placement-step-count", text: `×${draft.replicas}` });
        const inc = stepper.createEl("button", { cls: "lilbee-placement-step", text: "+" });
        if (this.stepperEditable()) {
            dec.addEventListener("click", () => this.changeReplicas(role, -1));
            inc.addEventListener("click", () => this.changeReplicas(role, 1));
        } else {
            dec.addClass("is-readonly");
            inc.addClass("is-readonly");
        }
    }

    private renderBar(container: HTMLElement, used: number, total: number): void {
        const bar = container.createDiv({ cls: "lilbee-placement-bar" });
        const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
        bar.createDiv({ cls: "lilbee-placement-bar-fill" }).setCssProps({ width: `${pct}%` });
    }

    /** Device chips are assignable only in manual mode (multi-GPU). */
    private isEditable(): boolean {
        return this.mode === PLACEMENT_MODE.MANUAL && !this.applying;
    }

    /** Replica steppers are also editable on a single device, where bumping a
     * count is the one meaningful placement change and switches to manual. */
    private stepperEditable(): boolean {
        const singleDevice = this.current?.gpus.length === 1;
        return (this.mode === PLACEMENT_MODE.MANUAL || singleDevice) && !this.applying;
    }

    // ---- footer + actions -----------------------------------------------------

    private renderFooter(container: HTMLElement, data: PlacementResponse): void {
        const footer = container.createDiv({ cls: "lilbee-placement-footer" });
        const fit = footer.createSpan({ cls: "lilbee-placement-fit" });
        if (this.unplaceable.length > 0) {
            fit.addClass("is-unfit");
            fit.setText(MESSAGES.PLACEMENT_WONT_FIT(this.unplaceable.join(", ")));
        } else if (this.mode === PLACEMENT_MODE.AUTO) {
            fit.addClass("is-muted");
            fit.setText(MESSAGES.PLACEMENT_AUTO_MANAGED);
        } else {
            fit.setText(MESSAGES.PLACEMENT_FITS);
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
        if (draft.devices.has(deviceIndex)) {
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
        if (this.mode === PLACEMENT_MODE.AUTO) this.mode = PLACEMENT_MODE.MANUAL;
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
        const result = await this.plugin.api.placementPreview(this.buildSpec());
        if (result.isErr()) {
            new Notice(
                MESSAGES.PLACEMENT_PREVIEW_FAILED(
                    errorMessage(result.error, MESSAGES.ERROR_UNKNOWN, this.plugin.settings.serverMode),
                ),
            );
            return;
        }
        this.unplaceable = result.value.unplaceable;
        this.render();
    }

    private async runApply(): Promise<void> {
        this.applying = true;
        this.render();
        const result = await this.plugin.api.applyPlacement(this.buildSpec());
        this.applying = false;
        if (result.isErr()) {
            this.handleMutationError(result.error);
            this.render();
            return;
        }
        new Notice(MESSAGES.PLACEMENT_APPLIED);
        this.adoptResponse(result.value);
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
    }
}
