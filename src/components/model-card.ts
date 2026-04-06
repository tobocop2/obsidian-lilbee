import type { ModelFamily, ModelVariant, ModelCardOptions } from "../types";
import { MESSAGES } from "../locales/en";
import { renderTaskPill, renderPickPill, PILL_CLS, renderPill } from "./pill";

export function renderModelCard(
    container: HTMLElement,
    family: ModelFamily,
    variant: ModelVariant,
    options: ModelCardOptions,
): HTMLElement {
    const card = container.createDiv({ cls: "lilbee-model-card" });
    card.dataset.repo = variant.hf_repo;
    if (options.isActive) card.addClass("is-selected");

    renderCardHeader(card, family, variant);
    renderCardSpecs(card, variant);
    renderCardStatus(card, variant);
    if (options.showActions) {
        renderCardActions(card, family, variant, options);
    }

    if (options.onClick) {
        const handler = options.onClick;
        card.addEventListener("click", (e: Event) => {
            if ((e.target as HTMLElement)?.tagName === "BUTTON") return;
            handler(family, variant);
        });
    }

    return card;
}

function renderCardHeader(card: HTMLElement, family: ModelFamily, variant: ModelVariant): void {
    const header = card.createDiv({ cls: "lilbee-model-card-header" });
    const name = variant.display_name ?? variant.name;
    header.createEl("span", { text: name, cls: "lilbee-model-card-name" });
    renderTaskPill(header, variant.task || family.task);
    const featured = variant.featured ?? family.featured;
    if (featured) renderPickPill(header);
}

function renderCardSpecs(card: HTMLElement, variant: ModelVariant): void {
    const tier = variant.quality_tier ?? "";
    const parts = [tier, `${variant.size_gb} GB`].filter(Boolean);
    card.createDiv({ cls: "lilbee-model-card-specs", text: parts.join(" \u00B7 ") });
}

function renderCardStatus(card: HTMLElement, variant: ModelVariant): void {
    const status = card.createDiv({ cls: "lilbee-model-card-status" });
    if (variant.installed) {
        renderPill(status, MESSAGES.LABEL_INSTALLED, PILL_CLS.INSTALLED);
    } else if (variant.downloads !== undefined) {
        status.createEl("span", {
            text: formatDownloads(variant.downloads),
            cls: "lilbee-model-card-downloads",
        });
    }
}

function renderCardActions(
    card: HTMLElement,
    family: ModelFamily,
    variant: ModelVariant,
    options: ModelCardOptions,
): void {
    const actions = card.createDiv({ cls: "lilbee-model-card-actions" });

    if (options.isActive) {
        actions.createEl("span", {
            text: MESSAGES.LABEL_ACTIVE,
            cls: "lilbee-catalog-active",
        });
        return;
    }

    if (variant.installed) {
        const useBtn = actions.createEl("button", {
            text: MESSAGES.BUTTON_USE,
            cls: "lilbee-catalog-use",
        });
        if (options.onUse) {
            const handler = options.onUse;
            useBtn.addEventListener("click", () => handler(family, variant, useBtn));
        }
        const removeBtn = actions.createEl("button", {
            text: MESSAGES.BUTTON_REMOVE,
            cls: "lilbee-catalog-remove",
        });
        if (options.onRemove) {
            const handler = options.onRemove;
            removeBtn.addEventListener("click", () => handler(variant, removeBtn));
        }
    } else {
        const pullBtn = actions.createEl("button", {
            text: MESSAGES.BUTTON_PULL,
            cls: "lilbee-catalog-pull",
        });
        if (options.onPull) {
            const handler = options.onPull;
            pullBtn.addEventListener("click", () => handler(family, variant, pullBtn));
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

function formatDownloads(count: number): string {
    if (count >= 1_000_000) return MESSAGES.LABEL_DOWNLOADS_COUNT(`${(count / 1_000_000).toFixed(1)}M`);
    if (count >= 1_000) return MESSAGES.LABEL_DOWNLOADS_COUNT(`${(count / 1_000).toFixed(1)}K`);
    return MESSAGES.LABEL_DOWNLOADS_COUNT(String(count));
}
