import type { SessionSourceRef, Source } from "../types";

/** Every ASCII punctuation mark: CommonMark lets each one be escaped, and Obsidian gives several of them markup of its own (tags, highlights, math, comments, bare links). */
const ASCII_PUNCTUATION_RE = /[!-/:-@[-`{-~]/g;

/** *text* on one line as markdown that shows exactly that text, with no markup of its own. */
export function markdownText(text: string): string {
    return text.replace(/\s+/g, " ").trim().replace(ASCII_PUNCTUATION_RE, "\\$&");
}

/** The Sources list of an answer: one ref per source of *chunks*, in order, with the server's label and `[n]`, or the path when the server sent no label. */
export function sourceRefs(chunks: readonly Source[]): SessionSourceRef[] {
    const refs = new Map<string, SessionSourceRef>();
    for (const chunk of chunks) {
        if (refs.has(chunk.source)) continue;
        refs.set(chunk.source, {
            source: chunk.source,
            label: chunk.label ?? chunk.source,
            citation_number: chunk.citation_number ?? null,
        });
    }
    return [...refs.values()];
}

/**
 * *refs* as a markdown Sources list, each label escaped so a page title shows as text. Each line
 * shows its `[n]` (its position when it has none) as an escaped number on a hard-broken line,
 * because a markdown list renumbers from its first item and a cited subset skips numbers.
 */
export function sourcesListMarkdown(heading: string, refs: readonly SessionSourceRef[]): string {
    const lines = refs.map((ref, index) => `${ref.citation_number ?? index + 1}\\. ${markdownText(ref.label)}`);
    return `${heading}:\n\n${lines.join("\\\n")}`;
}
