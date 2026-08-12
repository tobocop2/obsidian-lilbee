import { describe, it, expect } from "vitest";
import { App } from "obsidian";
import type { MockElement } from "../__mocks__/obsidian";
import { AGENT_PICKER_RESULT, AgentPickerModal, type AgentPickerResult } from "../../src/views/agent-picker-modal";
import { AGENT_CLIENT, type AgentClient, type AgentClientDetection } from "../../src/types";
import { AGENT_LABELS, MESSAGES } from "../../src/locales/en";

const detection = (client: AgentClient, cli_detected: boolean): AgentClientDetection => ({
    client,
    cli_detected,
    cli_path: cli_detected ? `/usr/local/bin/${client}` : null,
});

function openPicker(
    detections: AgentClientDetection[],
    claudianInstalled = false,
): { modal: AgentPickerModal; result: Promise<AgentPickerResult>; root: MockElement } {
    const modal = new AgentPickerModal(new App(), detections, claudianInstalled);
    const result = modal.openPicker();
    return { modal, result, root: modal.contentEl as unknown as MockElement };
}

/** The footer's primary button, which carries the selected agent's name. */
function connectButton(root: MockElement): MockElement {
    const foot = root.find("lilbee-agent-picker-foot");
    return foot?.children[1] as MockElement;
}

function cards(root: MockElement): MockElement[] {
    return root.findAll("lilbee-agent-picker-card");
}

describe("AgentPickerModal", () => {
    it("shows a card per agent with its pitch", () => {
        const { root } = openPicker([detection(AGENT_CLIENT.OPENCODE, true)]);
        const texts = cards(root).map((c) => c.textContent);

        expect(cards(root)).toHaveLength(3);
        expect(texts.join(" ")).toContain(MESSAGES.AGENT_PICKER_OPENCODE_DESC);
        expect(texts.join(" ")).toContain(MESSAGES.AGENT_PICKER_CLAUDE_DESC);
    });

    it("greys out an agent that is not installed", () => {
        const { root } = openPicker([detection(AGENT_CLIENT.OPENCODE, true), detection(AGENT_CLIENT.HERMES, false)]);
        const [opencode, , hermes] = cards(root);

        expect(opencode.classList.contains("is-unavailable")).toBe(false);
        expect(hermes.classList.contains("is-unavailable")).toBe(true);
        expect(hermes.textContent).toContain(MESSAGES.AGENT_PICKER_NOT_DETECTED);
    });

    it("badges OpenCode when Claudian is installed", () => {
        const { root } = openPicker([detection(AGENT_CLIENT.OPENCODE, true)], true);
        expect(root.find("lilbee-agent-picker-badge")?.textContent).toBe(MESSAGES.AGENT_PICKER_BADGE_CLAUDIAN);
    });

    it("leaves the badge off when Claudian is absent", () => {
        const { root } = openPicker([detection(AGENT_CLIENT.OPENCODE, true)], false);
        expect(root.find("lilbee-agent-picker-badge")).toBeNull();
    });

    it("preselects the fullest pairing that is installed", () => {
        const { root } = openPicker([detection(AGENT_CLIENT.OPENCODE, true), detection(AGENT_CLIENT.CLAUDE, true)]);

        expect(cards(root)[0].classList.contains("selected")).toBe(true);
        expect(connectButton(root).textContent).toBe(
            MESSAGES.BUTTON_AGENT_CONNECT(AGENT_LABELS[AGENT_CLIENT.OPENCODE]),
        );
    });

    it("falls back to whichever agent is installed", () => {
        const { root } = openPicker([detection(AGENT_CLIENT.OPENCODE, false), detection(AGENT_CLIENT.CLAUDE, true)]);
        expect(connectButton(root).textContent).toBe(MESSAGES.BUTTON_AGENT_CONNECT(AGENT_LABELS[AGENT_CLIENT.CLAUDE]));
    });

    it("disables connecting when nothing is installed", () => {
        const { root } = openPicker([detection(AGENT_CLIENT.OPENCODE, false)]);
        const button = connectButton(root);

        expect(button.disabled).toBe(true);
        expect(button.textContent).toBe(MESSAGES.BUTTON_AGENT_CONNECT_NONE);
    });

    it("moves the selection when another installed agent is clicked", () => {
        const { root } = openPicker([detection(AGENT_CLIENT.OPENCODE, true), detection(AGENT_CLIENT.CLAUDE, true)]);
        cards(root)[1].trigger("click");

        expect(cards(root)[0].classList.contains("selected")).toBe(false);
        expect(cards(root)[1].classList.contains("selected")).toBe(true);
    });

    it("ignores clicks on an agent that is not installed", () => {
        const { root } = openPicker([detection(AGENT_CLIENT.OPENCODE, true), detection(AGENT_CLIENT.HERMES, false)]);
        cards(root)[2].trigger("click");

        expect(cards(root)[0].classList.contains("selected")).toBe(true);
    });

    it("resolves with the selected agent and remembers by default", async () => {
        const { root, result } = openPicker([detection(AGENT_CLIENT.OPENCODE, true)]);
        connectButton(root).trigger("click");

        expect(await result).toEqual({
            kind: AGENT_PICKER_RESULT.CONNECT,
            client: AGENT_CLIENT.OPENCODE,
            remember: true,
        });
    });

    it("wires the session only when the user unchecks remember", async () => {
        const { root, result } = openPicker([detection(AGENT_CLIENT.OPENCODE, true)]);
        const checkbox = root.find("lilbee-agent-picker-remember")?.children[0] as MockElement;
        checkbox.checked = false;
        checkbox.trigger("change");
        connectButton(root).trigger("click");

        expect(await result).toMatchObject({ remember: false });
    });

    it("dismisses on Not now", async () => {
        const { root, result } = openPicker([detection(AGENT_CLIENT.OPENCODE, true)]);
        (root.find("lilbee-agent-picker-foot")?.children[0] as MockElement).trigger("click");

        expect(await result).toEqual({ kind: AGENT_PICKER_RESULT.DISMISS });
    });

    it("dismisses when closed without a choice", async () => {
        const { modal, result } = openPicker([detection(AGENT_CLIENT.OPENCODE, true)]);
        modal.onClose();

        expect(await result).toEqual({ kind: AGENT_PICKER_RESULT.DISMISS });
    });

    it("keeps the first answer when the modal closes after connecting", async () => {
        const { modal, root, result } = openPicker([detection(AGENT_CLIENT.OPENCODE, true)]);
        connectButton(root).trigger("click");
        modal.onClose();

        expect(await result).toMatchObject({ kind: AGENT_PICKER_RESULT.CONNECT });
    });

    it("does nothing when the primary button is pressed with no selection", async () => {
        const { modal, root, result } = openPicker([detection(AGENT_CLIENT.OPENCODE, false)]);
        connectButton(root).trigger("click");
        modal.onClose();

        expect(await result).toEqual({ kind: AGENT_PICKER_RESULT.DISMISS });
    });
});
