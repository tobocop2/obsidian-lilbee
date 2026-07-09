import { App, Modal, setIcon } from "obsidian";
import { MESSAGES } from "../locales/en";
import { MANAGED_CONSENT_RESULT, type ManagedConsentResult } from "../types";
import {
    GITHUB_REPO,
    LILBEE_GITHUB_REPO_URL,
    getLatestRelease,
    getPlatformAssetName,
    type ReleaseInfo,
} from "../binary-manager";

/** Modal that asks the user to consent to a managed-mode lilbee server download, with GitHub provenance. */
export class ManagedConsentModal extends Modal {
    private resolver: ((r: ManagedConsentResult) => void) | null = null;
    private resolved = false;
    /** Populated synchronously by renderManagedCard during onOpen, before any helper reads it. */
    private provBody!: HTMLElement;

    constructor(
        app: App,
        private includeDev: boolean,
    ) {
        super(app);
    }

    openConsent(): Promise<ManagedConsentResult> {
        return new Promise((resolve) => {
            this.resolver = resolve;
            this.open();
        });
    }

    onOpen(): void {
        const root = this.contentEl;
        root.empty();
        root.addClass("lilbee-managed-consent");
        this.renderHeader(root);
        const paths = root.createDiv({ cls: "lilbee-managed-consent-paths" });
        this.renderManagedCard(paths);
        this.renderExternalCard(paths);
        this.renderFooter(root);
        void this.fetchProvenance();
    }

    onClose(): void {
        if (!this.resolved) {
            this.resolved = true;
            this.resolver?.({ kind: MANAGED_CONSENT_RESULT.CANCEL });
        }
    }

    private resolveAndClose(result: ManagedConsentResult): void {
        if (this.resolved) return;
        this.resolved = true;
        this.resolver?.(result);
        this.close();
    }

    private renderHeader(root: HTMLElement): void {
        const head = root.createDiv({ cls: "lilbee-managed-consent-head" });
        const beeWrap = head.createDiv({ cls: "lilbee-managed-consent-bee" });
        beeWrap.createDiv({ cls: "lilbee-managed-consent-bee-glow" });
        const bee = beeWrap.createDiv({ cls: "lilbee-managed-consent-bee-mark" });
        // Obsidian doesn't ship a bee icon; fall back to a stable Lucide name.
        // The CSS treatment (gradient + glow) carries the visual identity.
        setIcon(bee, "sparkles");
        head.createDiv({ cls: "lilbee-managed-consent-title", text: MESSAGES.MANAGED_CONSENT_TITLE });
        head.createDiv({ cls: "lilbee-managed-consent-subtitle", text: MESSAGES.MANAGED_CONSENT_SUBTITLE });
    }

    private renderManagedCard(paths: HTMLElement): void {
        const card = paths.createDiv({
            cls: "lilbee-managed-consent-card lilbee-managed-consent-card-managed",
        });
        card.createDiv({
            cls: "lilbee-managed-consent-pill",
            text: MESSAGES.MANAGED_CONSENT_PILL_RECOMMENDED,
        });
        card.createEl("h4", { text: MESSAGES.MANAGED_CONSENT_CARD_MANAGED_TITLE });
        card.createEl("p", {
            cls: "lilbee-managed-consent-card-desc",
            text: MESSAGES.MANAGED_CONSENT_CARD_MANAGED_DESC,
        });
        this.provBody = card.createDiv({ cls: "lilbee-managed-consent-prov" });
        this.renderProvLabel();
        this.provBody.createDiv({
            cls: "lilbee-managed-consent-prov-pending",
            text: MESSAGES.MANAGED_CONSENT_PROV_PENDING,
        });
    }

    private renderProvLabel(): void {
        const label = this.provBody.createDiv({ cls: "lilbee-managed-consent-prov-label" });
        const ghIcon = label.createSpan({ cls: "lilbee-managed-consent-gh" });
        setIcon(ghIcon, "github");
        label.createSpan({ text: " " + MESSAGES.MANAGED_CONSENT_PROV_LABEL });
    }

    private renderProvResolved(release: ReleaseInfo): void {
        this.provBody.empty();
        this.renderProvLabel();

        const repoLine = this.provBody.createDiv({ cls: "lilbee-managed-consent-prov-repo" });
        const repoLink = repoLine.createEl("a", { text: `github.com/${GITHUB_REPO}` });
        repoLink.setAttribute("href", LILBEE_GITHUB_REPO_URL);
        repoLink.setAttribute("target", "_blank");
        repoLine.createSpan({
            cls: "lilbee-managed-consent-prov-at",
            text: ` @ ${release.tag}`,
        });

        const asset = this.provBody.createDiv({ cls: "lilbee-managed-consent-prov-asset" });
        asset.createSpan({
            cls: "lilbee-managed-consent-prov-asset-name",
            text: safeAssetName(),
        });
        asset.createSpan({
            cls: "lilbee-managed-consent-prov-asset-size",
            text: ` · ${formatMb(release.sizeBytes)} · ${MESSAGES.MANAGED_CONSENT_PROV_ONE_TIME}`,
        });

        const notes = this.provBody.createEl("a", {
            cls: "lilbee-managed-consent-prov-notes",
            text: MESSAGES.MANAGED_CONSENT_PROV_RELEASE_NOTES,
        });
        notes.setAttribute("href", `${LILBEE_GITHUB_REPO_URL}/releases/tag/${release.tag}`);
        notes.setAttribute("target", "_blank");
    }

    private renderProvFailed(): void {
        this.provBody.empty();
        this.renderProvLabel();
        const repoLine = this.provBody.createDiv({ cls: "lilbee-managed-consent-prov-repo" });
        const repoLink = repoLine.createEl("a", { text: `github.com/${GITHUB_REPO}` });
        repoLink.setAttribute("href", LILBEE_GITHUB_REPO_URL);
        repoLink.setAttribute("target", "_blank");
        this.provBody.createDiv({
            cls: "lilbee-managed-consent-prov-failed",
            text: MESSAGES.MANAGED_CONSENT_PROV_FAILED,
        });
    }

    private async fetchProvenance(): Promise<void> {
        try {
            const release = await getLatestRelease(this.includeDev);
            if (!this.resolved) this.renderProvResolved(release);
        } catch {
            if (!this.resolved) this.renderProvFailed();
        }
    }

    private renderExternalCard(paths: HTMLElement): void {
        const card = paths.createDiv({
            cls: "lilbee-managed-consent-card lilbee-managed-consent-card-external",
        });
        card.createEl("h4", { text: MESSAGES.MANAGED_CONSENT_CARD_EXTERNAL_TITLE });
        card.createEl("p", {
            cls: "lilbee-managed-consent-card-desc",
            text: MESSAGES.MANAGED_CONSENT_CARD_EXTERNAL_DESC,
        });
        const ins = card.createDiv({ cls: "lilbee-managed-consent-card-ins" });
        ins.createSpan({ text: "→ " });
        ins.createSpan({
            cls: "lilbee-managed-consent-configure-link",
            text: MESSAGES.MANAGED_CONSENT_CONFIGURE_LINK,
        });
        card.createDiv({
            cls: "lilbee-managed-consent-card-hint",
            text: MESSAGES.MANAGED_CONSENT_CARD_EXTERNAL_HINT,
        });
        card.addEventListener("click", () => this.resolveAndClose({ kind: MANAGED_CONSENT_RESULT.EXTERNAL }));
    }

    private renderFooter(root: HTMLElement): void {
        const foot = root.createDiv({ cls: "lilbee-managed-consent-foot" });
        const cancel = foot.createEl("button", {
            cls: "lilbee-managed-consent-btn-cancel",
            text: MESSAGES.MANAGED_CONSENT_BTN_CANCEL,
        });
        cancel.addEventListener("click", () => this.resolveAndClose({ kind: MANAGED_CONSENT_RESULT.CANCEL }));
        const dl = foot.createEl("button", {
            cls: "lilbee-managed-consent-btn-download mod-cta",
            text: MESSAGES.MANAGED_CONSENT_BTN_DOWNLOAD,
        });
        dl.addEventListener("click", () => this.resolveAndClose({ kind: MANAGED_CONSENT_RESULT.DOWNLOAD }));
    }
}

function safeAssetName(): string {
    try {
        return getPlatformAssetName(null);
    } catch {
        return "lilbee";
    }
}

function formatMb(bytes: number): string {
    if (!bytes || bytes < 0) return "?";
    return `~${Math.round(bytes / 1024 / 1024)} MB`;
}
