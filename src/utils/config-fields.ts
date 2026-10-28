import type { ConfigFieldSchema } from "../types";

/** Settings that have their own row; the generic section skips them. */
export const CURATED_CONFIG_KEYS: ReadonlySet<string> = new Set([
    "adaptive_fusion",
    "adaptive_fusion_margin",
    "adaptive_threshold",
    "candidate_multiplier",
    "chat_compaction",
    "chat_mode",
    "chunk_overlap",
    "chunk_size",
    "contextual_enrichment",
    "crawl_browser_extra_wait_ms",
    "crawl_concurrent_requests",
    "crawl_exclude_patterns",
    "crawl_max_delay_range",
    "crawl_max_depth",
    "crawl_max_pages",
    "crawl_mean_delay",
    "crawl_render_mode",
    "crawl_respect_robots_txt",
    "crawl_retry_base_delay_max",
    "crawl_retry_base_delay_min",
    "crawl_retry_max_attempts",
    "crawl_retry_max_backoff",
    "crawl_retry_on_rate_limit",
    "crawl_timeout",
    "crawl_user_agent",
    "diversity_max_per_source",
    "embed_replicas",
    "embed_titles",
    "fast_model_downloads",
    "filter_structural_chunks",
    "flash_attention",
    "fts_language",
    "general_system_prompt",
    "gpu_devices",
    "gpu_memory_fraction",
    "ingest_processes",
    "kv_cache_type",
    "layout_detection",
    "lexical_fusion_weight",
    "lm_studio_base_url",
    "max_chunks_per_file",
    "max_context_sources",
    "max_distance",
    "max_reasoning_chars",
    "max_tokens",
    "memory_auto_extract",
    "memory_enabled",
    "min_relevance_score",
    "mmr_lambda",
    "model_keep_alive",
    "n_gpu_layers",
    "neighbor_expansion",
    "ocr",
    "ocr_language",
    "ollama_base_url",
    "rag_system_prompt",
    "repeat_penalty",
    "rerank_candidates",
    "rerank_min_score",
    "seed",
    "show_reasoning",
    "system_memory_reserve_gb",
    "table_extraction",
    "table_model",
    "temperature",
    "title_search",
    "title_search_weight",
    "token_sizing",
    "top_k_sampling",
    "top_p",
    "usable_vram_fraction",
    "vision_load_budget_s",
    "vision_replicas",
    "wiki",
    "wiki_auto_update",
    "wiki_embedding_faithfulness_threshold",
    "wiki_entity_page_prompt",
    "wiki_prune_raw",
    "wiki_stub_max_chunk_refs",
    "worker_pool_eager_start",
]);

/** Settings the server rejects over HTTP, so a row for them could only fail. */
export const HTTP_REFUSED_KEYS: ReadonlySet<string> = new Set(["llm_provider"]);

/** A key that names a credential. Its row is masked and never filled from the server. */
const SECRET_KEY = /(api_key|token|password|secret|cookie|authorization|credential)/;

const NULLABLE_SUFFIX = "|null";

export type GenericKind = "toggle" | "choice" | "number" | "text" | "list" | "json";

export interface GenericField {
    key: string;
    kind: GenericKind;
    /** The schema's type name, e.g. `int|null`. */
    type: string;
    integer: boolean;
    /** True for an int or float, including when a closed set of choices holds the values. */
    numeric: boolean;
    nullable: boolean;
    secret: boolean;
    /** The closed set of values; empty when the setting is open. */
    choices: string[];
    help: string;
    group: string;
    reindexRequired: boolean;
}

function baseType(type: string): string {
    return type.endsWith(NULLABLE_SUFFIX) ? type.slice(0, -NULLABLE_SUFFIX.length) : type;
}

function kindOf(base: string, choices: string[]): GenericKind {
    if (choices.length > 0) return "choice";
    switch (base) {
        case "bool":
            return "toggle";
        case "int":
        case "float":
            return "number";
        case "list":
            return "list";
        case "dict":
            return "json";
        default:
            return "text";
    }
}

/** Whether the key names a credential. */
export function isSecretKey(key: string): boolean {
    return SECRET_KEY.test(key);
}

/** The writable settings that have no curated row, sorted by the server's group and then by key. */
export function genericFields(fields: ConfigFieldSchema[]): GenericField[] {
    return fields
        .filter((f) => f.writable && !CURATED_CONFIG_KEYS.has(f.key) && !HTTP_REFUSED_KEYS.has(f.key))
        .map((f): GenericField => {
            const base = baseType(f.type);
            const choices = f.choices ?? [];
            return {
                key: f.key,
                kind: kindOf(base, choices),
                type: f.type,
                integer: base === "int",
                numeric: base === "int" || base === "float",
                nullable: f.nullable || f.type.endsWith(NULLABLE_SUFFIX),
                secret: isSecretKey(f.key),
                choices,
                help: f.help,
                group: f.group,
                reindexRequired: f.reindex_required,
            };
        })
        .sort((a, b) => a.group.localeCompare(b.group) || a.key.localeCompare(b.key));
}
