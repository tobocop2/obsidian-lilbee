import type { CatalogEntry, HardwareFit, ModelCardOptions } from "../types";
import { CATALOG_SOURCE, HARDWARE_FIT, MODEL_TASK } from "../types";
import { MESSAGES } from "../locales/en";
import { formatAbbreviatedCount } from "../utils";

const FIT_RAIL_CLASS: Record<HardwareFit, string> = {
    [HARDWARE_FIT.FITS]: "is-fits",
    [HARDWARE_FIT.TIGHT]: "is-tight",
    [HARDWARE_FIT.WONT_RUN]: "is-wont-run",
};

const FIT_LABEL: Record<HardwareFit, string> = {
    [HARDWARE_FIT.FITS]: MESSAGES.LABEL_FIT_FITS,
    [HARDWARE_FIT.TIGHT]: MESSAGES.LABEL_FIT_TIGHT,
    [HARDWARE_FIT.WONT_RUN]: MESSAGES.LABEL_FIT_WONT_RUN,
};

const TASK_TAG_CLS: Record<string, string> = {
    [MODEL_TASK.CHAT]: "is-chat",
    [MODEL_TASK.EMBEDDING]: "is-embed",
    [MODEL_TASK.VISION]: "is-vision",
    [MODEL_TASK.RERANK]: "is-rerank",
};

export function renderModelCard(container: HTMLElement, entry: CatalogEntry, options: ModelCardOptions): HTMLElement {
    const card = container.createDiv({ cls: "lilbee-model-card" });
    card.dataset.repo = entry.hf_repo;
    if (options.isActive) card.addClass("is-selected");
    if (entry.fit && FIT_RAIL_CLASS[entry.fit]) card.addClass(FIT_RAIL_CLASS[entry.fit]);

    renderCardHead(card, entry, options);
    renderCardTags(card, entry);
    renderCardSpecs(card, entry);
    renderCardStatus(card, entry, options);
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

function renderCardHead(card: HTMLElement, entry: CatalogEntry, options: ModelCardOptions): void {
    const head = card.createDiv({ cls: "lilbee-model-card-head" });
    head.createDiv({ cls: "lilbee-model-card-name", text: entry.display_name });
    if (options.onInfo) {
        const onInfo = options.onInfo;
        const infoBtn = head.createEl("button", {
            cls: "lilbee-model-card-info",
            text: "i",
            attr: {
                type: "button",
                "aria-label": MESSAGES.LABEL_MODEL_INFO_BTN,
                title: MESSAGES.LABEL_MODEL_INFO_BTN,
            },
        });
        infoBtn.addEventListener("click", (e: Event) => {
            e.stopPropagation();
            onInfo(entry);
        });
    }
}

function renderCardTags(card: HTMLElement, entry: CatalogEntry): void {
    const tags = card.createDiv({ cls: "lilbee-model-card-tags" });
    const taskCls = TASK_TAG_CLS[entry.task] ?? "is-chat";
    tags.createEl("span", { text: entry.task, cls: `lilbee-tag lilbee-tag-task ${taskCls}` });
    if (entry.featured) {
        tags.createEl("span", { text: MESSAGES.LABEL_PICK, cls: "lilbee-tag lilbee-tag-featured" });
    }
    if (entry.source && entry.source !== CATALOG_SOURCE.LOCAL) {
        tags.createEl("span", { text: entry.source, cls: "lilbee-tag lilbee-tag-provider" });
    }
}

function renderCardSpecs(card: HTMLElement, entry: CatalogEntry): void {
    const specs = card.createDiv({ cls: "lilbee-model-card-specs" });
    specs.createEl("strong", { text: `${entry.size_gb} GB` });
    appendSpecPart(specs, entry.quality_tier);
    appendSpecPart(specs, entry.param_count ? `${entry.param_count} params` : "");
}

function appendSpecPart(parent: HTMLElement, text: string): void {
    if (!text) return;
    parent.createEl("span", { cls: "lilbee-model-card-specs-sep" });
    parent.createEl("span", { text });
}

function renderCardStatus(card: HTMLElement, entry: CatalogEntry, options: ModelCardOptions): void {
    const status = card.createDiv({ cls: "lilbee-model-card-status" });
    const tone = statusTone(entry, options);
    status.createEl("span", { cls: `lilbee-model-card-status-dot ${tone.dotCls}` });
    const label = status.createEl("span", {
        text: tone.label,
        cls: `lilbee-model-card-status-label ${tone.labelCls}`,
    });
    if (entry.installed) {
        label.setAttribute("title", MESSAGES.TOOLTIP_MODEL_INSTALLED_SHARED);
    }
    if (entry.fit && FIT_LABEL[entry.fit]) {
        status.createEl("span", {
            text: FIT_LABEL[entry.fit],
            cls: "lilbee-model-card-fit-text",
        });
    }
}

function statusTone(
    entry: CatalogEntry,
    options: ModelCardOptions,
): { dotCls: string; labelCls: string; label: string } {
    if (options.isActive) {
        return { dotCls: "is-active", labelCls: "is-active", label: MESSAGES.LABEL_ACTIVE };
    }
    if (entry.installed) {
        return { dotCls: "is-installed", labelCls: "is-installed", label: MESSAGES.LABEL_INSTALLED };
    }
    if (entry.downloads > 0) {
        return {
            dotCls: "is-muted",
            labelCls: "is-muted",
            label: MESSAGES.LABEL_DOWNLOADS_COUNT(formatAbbreviatedCount(entry.downloads)),
        };
    }
    return { dotCls: "is-muted", labelCls: "is-muted", label: "" };
}

function renderCardActions(card: HTMLElement, entry: CatalogEntry, options: ModelCardOptions): void {
    const actions = card.createDiv({ cls: "lilbee-model-card-actions" });

    if (options.isActive) {
        const btn = actions.createEl("button", {
            text: MESSAGES.LABEL_ACTIVE,
            cls: "lilbee-btn lilbee-btn-active",
            attr: { disabled: "true" },
        });
        if (options.onUse) {
            const handler = options.onUse;
            btn.addEventListener("click", () => handler(entry, btn));
        }
        return;
    }

    if (entry.installed) {
        const useBtn = actions.createEl("button", {
            text: MESSAGES.BUTTON_USE,
            cls: "lilbee-btn lilbee-btn-primary lilbee-catalog-use",
        });
        if (options.onUse) {
            const handler = options.onUse;
            useBtn.addEventListener("click", () => handler(entry, useBtn));
        }
        const removeBtn = actions.createEl("button", {
            text: MESSAGES.BUTTON_REMOVE,
            cls: "lilbee-btn lilbee-btn-danger lilbee-catalog-remove",
        });
        if (options.onRemove) {
            const handler = options.onRemove;
            removeBtn.addEventListener("click", () => handler(entry, removeBtn));
        }
    } else {
        const pullBtn = actions.createEl("button", {
            text: MESSAGES.BUTTON_PULL,
            cls: "lilbee-btn lilbee-btn-primary lilbee-catalog-pull",
        });
        if (options.onPull) {
            const handler = options.onPull;
            pullBtn.addEventListener("click", () => handler(entry, pullBtn));
        }
    }
}
