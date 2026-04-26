import { App } from "obsidian";
import type { LilbeeClient } from "../api";
import type { DocumentResult, Source } from "../types";
import { CONTENT_TYPE } from "../types";
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
 * Format a citation suffix. PDFs get a `(p. N)` / `(pp. N–M)` page label;
 * non-PDFs prefer `(lines N–M)` when line bounds are present (markdown is
 * the common case) and otherwise return null. The `content_type` gate
 * silences the `(p. 0)` artefact that the server emits for some markdown
 * sources whose `page_start` is a placeholder rather than a real page.
 */
export function formatLocation(
    excerpt: {
        page_start: number | null;
        page_end: number | null;
        line_start: number | null;
        line_end: number | null;
    },
    content_type?: string,
): string | null {
    const isPdf = content_type === CONTENT_TYPE.PDF;
    if (isPdf && excerpt.page_start !== null) {
        return excerpt.page_end !== null && excerpt.page_end !== excerpt.page_start
            ? `pp. ${excerpt.page_start}–${excerpt.page_end}`
            : `p. ${excerpt.page_start}`;
    }
    if (excerpt.line_start !== null) {
        return excerpt.line_end !== null && excerpt.line_end !== excerpt.line_start
            ? `lines ${excerpt.line_start}–${excerpt.line_end}`
            : `line ${excerpt.line_start}`;
    }
    // Fallback for callers that don't (yet) thread content_type through —
    // preserve the legacy page label so older surfaces keep working.
    if (content_type === undefined && excerpt.page_start !== null) {
        return excerpt.page_end !== null && excerpt.page_end !== excerpt.page_start
            ? `pp. ${excerpt.page_start}–${excerpt.page_end}`
            : `p. ${excerpt.page_start}`;
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
        const loc = formatLocation(excerpt, result.content_type);
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
    const loc = formatLocation(source, source.content_type);
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
