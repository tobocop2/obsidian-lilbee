// Helpers for the canonical model ref shape that lilbee server speaks (PR #183).
// Refs come in three flavours:
//   1. native HF refs  — "<org>/<repo>/<filename>.gguf"
//   2. provider refs   — "ollama/qwen3:8b", "openai/gpt-4o", "anthropic/...", etc.
//   3. opaque strings  — anything else; passed through unchanged
// All three are valid identifiers on the wire; the helpers below convert them
// for display or unwrap them for catalog comparison.

const PROVIDER_PREFIXES = ["ollama/", "openai/", "anthropic/", "gemini/", "cohere/"];

const STRIP_SUFFIXES = [/-GGUF$/i, /-Instruct$/i, /-Chat$/i, /-v\d+(\.\d+)*$/i, /-\d{4}$/];

const META_PREFIX = /^Meta-/;

/** Strip the trailing `/<filename>.gguf` from a full HF ref so it matches a `CatalogEntry.hf_repo`. */
export function extractHfRepo(ref: string): string {
    if (!ref.endsWith(".gguf")) return ref;
    const slash = ref.lastIndexOf("/");
    if (slash <= 0) return ref;
    return ref.slice(0, slash);
}

/** Convert a `<repo>` segment (org-stripped) into a friendly label. Mirrors the server's `clean_display_name`. */
export function cleanDisplayName(repo: string): string {
    let name = repo.includes("/") ? repo.slice(repo.indexOf("/") + 1) : repo;
    name = name.replace(META_PREFIX, "");
    let changed = true;
    while (changed) {
        changed = false;
        for (const suffix of STRIP_SUFFIXES) {
            const next = name.replace(suffix, "");
            if (next !== name) {
                name = next;
                changed = true;
            }
        }
    }
    return name.replace(/-/g, " ").replace(/\s+/g, " ").trim();
}

/** Turn any model ref into a label suitable for the status bar, dropdowns, and notices. */
export function displayLabelForRef(ref: string): string {
    if (!ref) return "";
    if (ref.endsWith(".gguf") && ref.includes("/")) {
        return cleanDisplayName(extractHfRepo(ref));
    }
    for (const prefix of PROVIDER_PREFIXES) {
        if (ref.startsWith(prefix)) return ref.slice(prefix.length);
    }
    // Bare HF repo (e.g. plugin.activeModel after a dropdown change, before
    // fetchActiveModel re-syncs from /api/models) — strip the org and tidy.
    if (ref.includes("/")) {
        return cleanDisplayName(ref);
    }
    return ref;
}
