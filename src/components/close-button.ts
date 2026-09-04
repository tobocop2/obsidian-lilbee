import { setIcon, type WorkspaceLeaf } from "obsidian";

/** Close control for a sidebar view; sidebar leaves hide the view header that would otherwise carry it. */
export function addCloseButton(container: HTMLElement, leaf: WorkspaceLeaf, label: string): HTMLElement {
    const button = container.createEl("button", { cls: "lilbee-panel-close", attr: { "aria-label": label } });
    setIcon(button, "x");
    button.addEventListener("click", () => leaf.detach());
    return button;
}
