import { setIcon, type WorkspaceLeaf } from "obsidian";

/** Icon button that closes a sidebar view. Sidebar leaves hide the view header, so the control sits in the panel's own toolbar. */
export function addCloseButton(container: HTMLElement, leaf: WorkspaceLeaf, label: string): HTMLElement {
    const button = container.createEl("button", { cls: "lilbee-panel-close", attr: { "aria-label": label } });
    setIcon(button, "x");
    button.addEventListener("click", () => leaf.detach());
    return button;
}
