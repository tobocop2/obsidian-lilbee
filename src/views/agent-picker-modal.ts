import { App, Modal } from "obsidian";
import { AGENT_LABELS, MESSAGES } from "../locales/en";
import { bindEscapeToClose } from "../utils";
import { AGENT_CLIENT, type AgentClient, type AgentClientDetection } from "../types";

export type AgentPickerResult = { kind: "connect"; client: AgentClient; remember: boolean } | { kind: "dismiss" };

export const AGENT_PICKER_RESULT = {
    CONNECT: "connect",
    DISMISS: "dismiss",
} as const;

const asInput = (el: HTMLElement): HTMLInputElement => el as unknown as HTMLInputElement;

/** Card order: the fullest pairing first, so the default selection is the best one. */
const CARD_ORDER: readonly AgentClient[] = [AGENT_CLIENT.OPENCODE, AGENT_CLIENT.CLAUDE, AGENT_CLIENT.HERMES];

const CARD_DESC: Record<AgentClient, string> = {
    [AGENT_CLIENT.OPENCODE]: MESSAGES.AGENT_PICKER_OPENCODE_DESC,
    [AGENT_CLIENT.CLAUDE]: MESSAGES.AGENT_PICKER_CLAUDE_DESC,
    [AGENT_CLIENT.HERMES]: MESSAGES.AGENT_PICKER_HERMES_DESC,
};

/** Offered once when lilbee first sees an agent CLI on the machine. */
export class AgentPickerModal extends Modal {
    private resolver: ((r: AgentPickerResult) => void) | null = null;
    private resolved = false;
    private selected: AgentClient | null = null;
    private remember = true;
    private cards: Map<AgentClient, HTMLElement> = new Map();
    /** Populated by renderFooter during onOpen, before the first select() call. */
    private connectBtn!: HTMLButtonElement;

    constructor(
        app: App,
        private detections: AgentClientDetection[],
        private claudianInstalled: boolean,
    ) {
        super(app);
        bindEscapeToClose(this);
    }

    openPicker(): Promise<AgentPickerResult> {
        return new Promise((resolve) => {
            this.resolver = resolve;
            this.open();
        });
    }

    onOpen(): void {
        const root = this.contentEl;
        root.empty();
        root.addClass("lilbee-agent-picker");
        root.createEl("h3", { text: MESSAGES.AGENT_PICKER_TITLE });
        root.createEl("p", { cls: "lilbee-agent-picker-subtitle", text: MESSAGES.AGENT_PICKER_SUBTITLE });

        const cards = root.createDiv({ cls: "lilbee-agent-picker-cards" });
        for (const client of CARD_ORDER) {
            this.renderCard(cards, client);
        }
        this.renderRemember(root);
        this.renderFooter(root);
        this.select(CARD_ORDER.find((client) => this.isDetected(client)) ?? null);
    }

    onClose(): void {
        this.decide({ kind: AGENT_PICKER_RESULT.DISMISS });
    }

    private isDetected(client: AgentClient): boolean {
        return this.detections.some((d) => d.client === client && d.cli_detected);
    }

    private renderCard(parent: HTMLElement, client: AgentClient): void {
        const detected = this.isDetected(client);
        const card = parent.createDiv({
            cls: `lilbee-agent-picker-card${detected ? "" : " is-unavailable"}`,
        });
        const head = card.createDiv({ cls: "lilbee-agent-picker-card-head" });
        head.createEl("strong", { text: AGENT_LABELS[client] });
        if (client === AGENT_CLIENT.OPENCODE && this.claudianInstalled) {
            head.createSpan({ cls: "lilbee-agent-picker-badge", text: MESSAGES.AGENT_PICKER_BADGE_CLAUDIAN });
        }
        if (!detected) {
            head.createSpan({ cls: "lilbee-agent-picker-missing", text: MESSAGES.AGENT_PICKER_NOT_DETECTED });
        }
        card.createEl("p", { text: CARD_DESC[client] });
        this.cards.set(client, card);
        if (!detected) return;
        card.addEventListener("click", () => this.select(client));
    }

    private renderRemember(root: HTMLElement): void {
        const label = root.createEl("label", { cls: "lilbee-agent-picker-remember" });
        const input = label.createEl("input", { attr: { type: "checkbox" } });
        asInput(input).checked = this.remember;
        input.addEventListener("change", () => {
            this.remember = asInput(input).checked;
        });
        label.createSpan({ text: MESSAGES.AGENT_PICKER_REMEMBER });
    }

    private renderFooter(root: HTMLElement): void {
        const foot = root.createDiv({ cls: "lilbee-agent-picker-foot" });
        const notNow = foot.createEl("button", { text: MESSAGES.BUTTON_AGENT_NOT_NOW });
        notNow.addEventListener("click", () => this.decide({ kind: AGENT_PICKER_RESULT.DISMISS }));
        const connect = foot.createEl("button", { cls: "mod-cta" });
        connect.addEventListener("click", () => {
            if (this.selected === null) return;
            this.decide({
                kind: AGENT_PICKER_RESULT.CONNECT,
                client: this.selected,
                remember: this.remember,
            });
        });
        this.connectBtn = connect;
    }

    private select(client: AgentClient | null): void {
        this.selected = client;
        for (const [key, card] of this.cards) {
            card.toggleClass("selected", key === client);
        }
        this.connectBtn.disabled = client === null;
        this.connectBtn.setText(
            client === null ? MESSAGES.BUTTON_AGENT_CONNECT_NONE : MESSAGES.BUTTON_AGENT_CONNECT(AGENT_LABELS[client]),
        );
    }

    private decide(result: AgentPickerResult): void {
        if (this.resolved) return;
        this.resolved = true;
        this.resolver?.(result);
        this.close();
    }
}
