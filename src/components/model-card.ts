import type { CatalogEntry, ModelCardOptions } from "../types";
import { MESSAGES } from "../locales/en";
import { renderPill, PILL_CLS } from "./pill";

export function renderModelCard(container: HTMLElement, entry: CatalogEntry, options: ModelCardOptions): HTMLElement {
    const card = container.createDiv({ cls: "lilbee-model-card" });
    card.dataset.name = entry.name;
    if (options.isActive) card.addClass("is-selected");

    renderCardHeader(card, entry);
    renderCardSpecs(card, entry);
    renderCardStatus(card, entry);
    if (options.showActions) {
        renderCardActions(card, entry, options);
    }

    if (options.onClick) {
        const handler = options.onClick;
        card.addEventListener("click", (e: Event) => {
            if ((e.target as HTMLElement)?.tagName === "BUTTON") return;
            handler(entry);
        });
    }

    return card;
}

function renderCardHeader(card: HTMLElement, entry: CatalogEntry): void {
    const header = card.createDiv({ cls: "lilbee-model-card-header" });
    header.createEl("span", { text: entry.display_name, cls: "lilbee-model-card-name" });
}

function renderCardSpecs(card: HTMLElement, entry: CatalogEntry): void {
    const parts = [entry.quality_tier, `${entry.size_gb} GB`].filter(Boolean);
    card.createDiv({ cls: "lilbee-model-card-specs", text: parts.join(" \u00B7 ") });
}

function renderCardStatus(card: HTMLElement, entry: CatalogEntry): void {
    const status = card.createDiv({ cls: "lilbee-model-card-status" });
    if (entry.installed) {
        renderPill(status, MESSAGES.LABEL_INSTALLED, PILL_CLS.INSTALLED);
    }
}

function renderCardActions(card: HTMLElement, entry: CatalogEntry, options: ModelCardOptions): void {
    const actions = card.createDiv({ cls: "lilbee-model-card-actions" });

    if (options.isActive) {
        actions.createEl("span", {
            text: MESSAGES.LABEL_ACTIVE,
            cls: "lilbee-catalog-active",
        });
        return;
    }

    if (entry.installed) {
        const useBtn = actions.createEl("button", {
            text: MESSAGES.BUTTON_USE,
            cls: "lilbee-catalog-use",
        });
        if (options.onUse) {
            const handler = options.onUse;
            useBtn.addEventListener("click", () => handler(entry, useBtn));
        }
        const removeBtn = actions.createEl("button", {
            text: MESSAGES.BUTTON_REMOVE,
            cls: "lilbee-catalog-remove",
        });
        if (options.onRemove) {
            const handler = options.onRemove;
            removeBtn.addEventListener("click", () => handler(entry, removeBtn));
        }
    } else {
        const pullBtn = actions.createEl("button", {
            text: MESSAGES.BUTTON_PULL,
            cls: "lilbee-catalog-pull",
        });
        if (options.onPull) {
            const handler = options.onPull;
            pullBtn.addEventListener("click", () => handler(entry, pullBtn));
        }
    }
}

export function renderBrowseMoreCard(container: HTMLElement, onClick: () => void): HTMLElement {
    const card = container.createDiv({
        cls: "lilbee-browse-more-card",
        text: MESSAGES.LABEL_BROWSE_MORE,
    });
    card.addEventListener("click", onClick);
    return card;
}
