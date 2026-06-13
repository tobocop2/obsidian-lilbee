// Helpers for the canonical model ref shape lilbee speaks. Refs come in three
// flavours: native HF refs ("<org>/<repo>/<filename>.gguf"), provider refs
// ("ollama/qwen3:8b", "openai/gpt-4o", …), and opaque strings. The helpers
// below convert them for display or unwrap them for catalog comparison.

const PROVIDER_PREFIXES = ["ollama/", "lm_studio/", "openai/", "anthropic/", "gemini/", "cohere/"];

const STRIP_SUFFIXES = [/-GGUF$/i, /-Instruct$/i, /-Chat$/i, /-v\d+(\.\d+)*$/i, /-\d{4}$/];

const META_PREFIX = /^Meta-/;

/**
 * Build the ref to send when activating a catalog entry. A multi-quant GGUF
 * repo (e.g. "bartowski/SmolLM2-360M-Instruct-GGUF") has no single default
 * file, so the server rejects the bare repo with "not available"; send the
 * concrete "<repo>/<filename>.gguf" instead. Falls back to the bare repo when
 * the filename is missing or a glob (sharded/pattern entries).
 */
export function nativeModelRef(hfRepo: string, ggufFilename: string | null | undefined): string {
    const f = ggufFilename ?? "";
    if (f && f.endsWith(".gguf") && !f.includes("*")) return `${hfRepo}/${f}`;
    return hfRepo;
}

/** Strip the trailing `/<filename>.gguf` from a full HF ref so it matches a `CatalogEntry.hf_repo`. */
export function extractHfRepo(ref: string): string {
    if (!ref.endsWith(".gguf")) return ref;
    const slash = ref.lastIndexOf("/");
    if (slash <= 0) return ref;
    return ref.slice(0, slash);
}

/**
 * The dropdown option value that represents `active`. Server config stores a full
 * native ref (`<repo>/<file>.gguf`) but installed-featured options key on the bare
 * `hf_repo`, so an exact lookup misses and the dropdown renders blank. Match exactly
 * first (hosted refs, other-installed full refs), then by bare repo; fall back to the
 * ref unchanged when nothing matches.
 */
export function matchModelOption(active: string, optionValues: string[]): string {
    if (optionValues.includes(active)) return active;
    const repo = extractHfRepo(active);
    if (optionValues.includes(repo)) return repo;
    return active;
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
    if (ref.includes("/")) {
        return cleanDisplayName(ref);
    }
    return ref;
}
