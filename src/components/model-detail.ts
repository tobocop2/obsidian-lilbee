import type { CatalogEntry, SizeVariant } from "../types";
import { MESSAGES } from "../locales/en";
import { formatAbbreviatedCount } from "../utils";
import { renderFitChip } from "./fit-chip";

const MAX_DESCRIPTION_CHARS = 200;

export function renderModelDetail(entry: CatalogEntry, container: HTMLElement): void {
    container.empty();

    container.createEl("h3", { cls: "lilbee-detail-name", text: entry.display_name });
    renderFitChip(container, entry.fit);
    renderVariants(container, entry.size_variants ?? null);
    renderDescription(container, entry.description);
    renderInstallStatus(container, entry);
    renderDownloads(container, entry.downloads);
}

function renderVariants(container: HTMLElement, variants: SizeVariant[] | null): void {
    if (!variants || variants.length === 0) return;
    const section = container.createDiv({ cls: "lilbee-detail-section" });
    section.createEl("span", { cls: "lilbee-detail-section-label", text: MESSAGES.LABEL_DETAIL_VARIANTS });
    const strip = section.createDiv({ cls: "lilbee-detail-variants" });
    for (const variant of variants) {
        strip.createEl("span", { cls: "lilbee-detail-variant", text: variant.size_label });
    }
}

function renderDescription(container: HTMLElement, description: string): void {
    if (!description) return;
    const trimmed =
        description.length > MAX_DESCRIPTION_CHARS ? `${description.slice(0, MAX_DESCRIPTION_CHARS)}…` : description;
    const section = container.createDiv({ cls: "lilbee-detail-section" });
    section.createEl("span", { cls: "lilbee-detail-section-label", text: MESSAGES.LABEL_DETAIL_DESCRIPTION });
    section.createEl("p", { cls: "lilbee-detail-description", text: trimmed });
}

function renderInstallStatus(container: HTMLElement, entry: CatalogEntry): void {
    const section = container.createDiv({ cls: "lilbee-detail-section" });
    section.createEl("span", { cls: "lilbee-detail-section-label", text: MESSAGES.LABEL_DETAIL_INSTALL_STATUS });
    const statusText = entry.installed ? MESSAGES.LABEL_INSTALLED : MESSAGES.LABEL_NOT_INSTALLED.trim();
    section.createEl("span", { cls: "lilbee-detail-install-status", text: statusText });
}

function renderDownloads(container: HTMLElement, downloads: number): void {
    if (downloads <= 0) return;
    const section = container.createDiv({ cls: "lilbee-detail-section" });
    section.createEl("span", { cls: "lilbee-detail-section-label", text: MESSAGES.LABEL_DETAIL_DOWNLOADS });
    section.createEl("span", { cls: "lilbee-detail-downloads-value", text: formatAbbreviatedCount(downloads) });
}
