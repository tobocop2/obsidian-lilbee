import { App } from "obsidian";
import type { LilbeeClient } from "../api";
import type { DocumentResult, Source } from "../types";
import { executeSourceClick, sourceClickAction } from "../utils/source-click";

const MAX_EXCERPT_CHARS = 200;
const MAX_EXCERPTS = 3;

/** Build a minimal Source from a DocumentResult excerpt so we can dispatch a click action. */
function documentResultToSource(result: DocumentResult): Source {
    const excerpt = result.excerpts[0];
    return {
        source: result.source,
        content_type: result.content_type,
        distance: 0,
        chunk: excerpt?.content ?? "",
        page_start: excerpt?.page_start ?? null,
        page_end: excerpt?.page_end ?? null,
        line_start: excerpt?.line_start ?? null,
        line_end: excerpt?.line_end ?? null,
    };
}

/**
 * Format a citation suffix. Prefer `(p. N)` / `(pp. N–M)` when the server
 * reports a real page (>0) — the chat path can deliver PDF sources with an
 * empty content_type, so we don't gate on it. Fall back to `(lines N–M)`
 * for line bounds; treat 0 as the server's null-sentinel and skip it.
 */
export function formatLocation(excerpt: {
    page_start: number | null;
    page_end: number | null;
    line_start: number | null;
    line_end: number | null;
}): string | null {
    const pageStart = excerpt.page_start ?? 0;
    if (pageStart > 0) {
        const pageEnd = excerpt.page_end ?? 0;
        return pageEnd > 0 && pageEnd !== pageStart ? `pp. ${pageStart}–${pageEnd}` : `p. ${pageStart}`;
    }
    const lineStart = excerpt.line_start ?? 0;
    if (lineStart > 0) {
        const lineEnd = excerpt.line_end ?? 0;
        return lineEnd > 0 && lineEnd !== lineStart ? `lines ${lineStart}–${lineEnd}` : `line ${lineStart}`;
    }
    return null;
}

function truncate(text: string, maxLen: number): string {
    if (text.length <= maxLen) return text;
    return text.slice(0, maxLen) + "...";
}

export function renderDocumentResult(
    container: HTMLElement,
    result: DocumentResult,
    app: App,
    api: LilbeeClient,
): void {
    const card = container.createDiv({ cls: "lilbee-document-card" });

    // Header: filename + content type badge
    const header = card.createDiv({ cls: "lilbee-document-card-header" });
    const link = header.createEl("a", {
        text: result.source,
        cls: "lilbee-document-source",
    });
    link.addEventListener("click", (e) => {
        e.preventDefault();
        const source = documentResultToSource(result);
        void executeSourceClick(app, api, sourceClickAction(source, app.vault));
    });

    header.createEl("span", {
        text: result.content_type,
        cls: "lilbee-content-badge",
    });

    // Relevance bar
    const barContainer = card.createDiv({ cls: "lilbee-relevance-bar-container" });
    const bar = barContainer.createDiv({ cls: "lilbee-relevance-bar" });
    const pct = Math.round(Math.max(0, Math.min(1, result.best_relevance)) * 100);
    bar.style.width = `${pct}%`;

    // Excerpts (up to MAX_EXCERPTS)
    const excerpts = result.excerpts.slice(0, MAX_EXCERPTS);
    for (const excerpt of excerpts) {
        const excerptEl = card.createDiv({ cls: "lilbee-excerpt" });
        excerptEl.createEl("p", { text: truncate(excerpt.content, MAX_EXCERPT_CHARS) });
        const loc = formatLocation(excerpt);
        if (loc) {
            excerptEl.createEl("span", { text: loc, cls: "lilbee-location" });
        }
    }
}

/**
 * Render a source chip. Chips are always clickable: the default click dispatches
 * through `executeSourceClick` (vault deep-link or server preview modal). When
 * `onWikiClick` is provided, wiki chips use that override instead — preserves
 * the wiki view's custom flow where a click navigates to the wiki page in the
 * sidebar rather than opening the source file.
 */
export function renderSourceChip(
    container: HTMLElement,
    source: Source,
    app: App,
    api: LilbeeClient,
    onWikiClick?: (slug: string) => void,
): void {
    const isWiki = source.chunk_type === "wiki";
    const cls = isWiki ? "lilbee-source-chip lilbee-source-chip-wiki" : "lilbee-source-chip";
    const chip = container.createEl("span", { cls });

    if (source.claim_type === "fact") {
        chip.addClass("lilbee-claim-fact");
    } else if (source.claim_type === "inference") {
        chip.addClass("lilbee-claim-inference");
    }

    let label = source.source;
    const loc = formatLocation(source);
    if (loc) {
        label += ` (${loc})`;
    }

    if (isWiki) {
        chip.createEl("span", { text: "W", cls: "lilbee-wiki-type-badge" });
        chip.createEl("span", { text: label });
    } else {
        chip.setText(label);
    }

    chip.style.cursor = "pointer";
    if (isWiki && onWikiClick) {
        chip.addEventListener("click", () => onWikiClick(source.source));
    } else {
        chip.addEventListener("click", () => {
            void executeSourceClick(app, api, sourceClickAction(source, app.vault));
        });
    }
}
