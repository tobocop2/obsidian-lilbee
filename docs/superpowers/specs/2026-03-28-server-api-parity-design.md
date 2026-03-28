# lilbee Obsidian Plugin — Server API Parity Design

**Date:** 2026-03-28
**Status:** Approved
**Server dependency:** `feature/api-config-endpoint` branch on lilbee (built later)

## Problem

The lilbee server removed Ollama completely and introduced a HuggingFace model catalog, web crawling, document management, reasoning token support, and a PATCH config endpoint. The Obsidian plugin still depends on Ollama for model pull/delete/show operations and doesn't expose any of the new server features.

## Scope

6 phases across 12 files (6 modified, 3 new). Server-side PATCH endpoint is a separate workstream.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Scope | All phases in one go | Phases 2-5 are independent files after Phase 1 |
| Server endpoint | Build later, plugin uses stubs | Silent 404 fallback; generation params work per-request |
| Catalog layout | Grouped sections (chat/vision/embed) | All types visible, headers explain purpose |
| Settings PATCH | Batch on save | Matches Obsidian's existing save pattern |
| Tests | TDD — tests first | 100% coverage required per AGENTS.md |
| Empty state | Just-in-time, no setup wizard | Simpler, contextual, non-blocking |
| Re-index fields | Confirmation dialog + auto-sync | Prevents accidental index invalidation |

## Phase 1: Ollama Removal + API Migration

### What's removed

- `OllamaClient` class from `api.ts`
- `OllamaPullProgress`, `OllamaModelDefaults` from `types.ts`
- `ollamaUrl` from `LilbeeSettings`, `DEFAULT_SETTINGS`, settings tab
- `OLLAMA_HOST` from `server-manager.ts` spawn env
- `updateOllamaUrl()` from `server-manager.ts`

### What's added to `LilbeeClient`

| Method | Endpoint | Notes |
|---|---|---|
| `catalog(params?)` | `GET /api/models/catalog` | Filterable by task, size, sort |
| `installedModels()` | `GET /api/models/installed` | |
| `showModel(model)` | `POST /api/models/show` | Replaces Ollama show |
| `deleteModel(model, source?)` | `DELETE /api/models/{model}` | Replaces Ollama delete |
| `pullModel(model, source)` | `POST /api/models/pull` | Updated — adds source param |
| `listDocuments(search?, limit?, offset?)` | `GET /api/documents` | |
| `removeDocuments(names, deleteFiles?)` | `POST /api/documents/remove` | |
| `crawl(url, depth?, maxPages?)` | `POST /api/crawl` | SSE stream |
| `config()` | `GET /api/config` | Read-only server config |
| `updateConfig(updates)` | `PATCH /api/config` | Stub — silent 404 fallback |
| `setEmbeddingModel(model)` | `PUT /api/models/embedding` | Stub — silent 404 fallback |

### Type changes

- `GenerationOptions` becomes standalone (no longer alias to Ollama types)
- New: `CatalogModel`, `CatalogResponse`, `InstalledModel`, `InstalledResponse`, `DocumentEntry`, `DocumentsResponse`, `ConfigUpdateResponse`, `EmbeddingModelResponse`
- New SSE events: `REASONING`, `CRAWL_START`, `CRAWL_PAGE`, `CRAWL_DONE`, `CRAWL_ERROR`

## Phase 2: Chat Enhancements

### Reasoning tokens

- SSE event `reasoning` carries thinking tokens from reasoning models (Qwen3, DeepSeek)
- Accumulated in a separate buffer during streaming
- On `DONE`: rendered as `<details class="lilbee-reasoning"><summary>Reasoning</summary>...</details>`
- Collapsed by default

### Empty state handling

| Context | Behavior |
|---|---|
| Chat view, no models | Toolbar shows "Browse Catalog" button |
| Search/ask, no model | `Notice("No model installed — select one in settings")` |
| Settings, no model | Dropdown shows "(none)" + "Browse Catalog" button |

## Phase 3: Catalog Browser Modal

New file: `views/catalog-modal.ts`

**Layout**: Grouped sections on open — Chat Models, Vision Models, Embedding Models — each with explanatory headers. Featured models shown first. "Show all from HuggingFace" button expands to full filterable catalog.

```
┌─ Browse Model Catalog ──────────────────────────────────────┐
│ [🔍 Search models...]                  Sort: [Popular ▾]    │
│                                                               │
│ Chat Models                                                   │
│ ★ Qwen3 8B              5.0 GB   RAM: 8 GB     [Active ✓]   │
│ ★ Qwen3 4B              2.5 GB   RAM: 8 GB     [Pull ↓]     │
│                                                               │
│ Vision Models  (for PDF scanning & image OCR)                 │
│ ★ LightOnOCR-2           1.5 GB   RAM: 4 GB     [Pull ↓]    │
│                                                               │
│ Embedding Models  (for search quality)                        │
│ ★ Nomic Embed Text v1.5   0.3 GB   RAM: 2 GB    [Installed] │
│                                                               │
│ [Show all from HuggingFace →]                                │
└───────────────────────────────────────────────────────────────┘
```

**Behavior**:
- Task filter: All/Chat/Vision/Embed
- "All" (default): shows grouped sections — Chat Models, Vision Models, Embedding Models — each with explanatory headers
- "Chat"/"Vision"/"Embed": shows flat list filtered to that task type only
- Sort: Popular/Name/Size
- Search: 300ms debounce, searches name + description
- "Pull ↓" → ConfirmPullModal → `api.pullModel(name)` with progress
- Embedding models: pull only, no auto-activate. Notice directs to Settings → Advanced
- Contextual nudge: when user adds a PDF without a vision model, suggest setting one

**Access**: Command `lilbee:catalog` + buttons in settings and chat empty state

## Phase 4: Web Crawl

New file: `views/crawl-modal.ts`

```
┌─ Crawl Web Page ─────────────────────┐
│ URL: [https://docs.example.com/    ]  │
│ Depth: [0]  Max pages: [50]           │
│          [Cancel]  [Crawl]            │
│ Progress: Crawling page 3/10...       │
└───────────────────────────────────────┘
```

**SSE events**: `crawl_start { url, depth }`, `crawl_page { url, current, total }`, `crawl_done { pages_crawled, files_written }`, `crawl_error { message }`

**Access**: Command `lilbee:crawl` + "Crawl web page" in chat file picker menu

## Phase 5: Document Browser

New file: `views/documents-modal.ts`

```
┌─ Indexed Documents ─────────────────────────────────────────┐
│ 🔍 [Search documents...]                                     │
│ 📄 meeting-notes.md        12 chunks  2026-03-28  [☐]      │
│ 📄 project-spec.md          8 chunks  2026-03-27  [☐]      │
│                              [Remove selected] [Load more]   │
└──────────────────────────────────────────────────────────────┘
```

**Behavior**: Search with debounce, checkbox selection, bulk remove with confirmation, paginated.

**Access**: Command `lilbee:documents`

## Phase 6: Settings Redesign

Settings tab uses progressive disclosure. Common settings visible by default, advanced settings behind a "Show advanced" toggle.

### Visible by default

- **Server** — mode, status, port, version
- **Models** — chat/vision dropdowns + "Browse Catalog" button
- **Generation** — system prompt, temperature, top_p, top_k_sampling, repeat_penalty, num_ctx, seed, show_reasoning (editable, batched PATCH on save)
- **Sync** — mode, debounce

### Behind "Show advanced" toggle

- **Search & Retrieval** — top_k, max_distance, diversity_max_per_source, mmr_lambda, candidate_multiplier, query_expansion_count, adaptive_threshold_step, max_context_sources, hyde, hyde_weight, temporal_filtering
- **Reranking** — reranker_model, rerank_candidates
- **Chunking** — chunk_size, chunk_overlap (reindex confirmation on change)
- **Crawling** — crawl_max_depth, crawl_max_pages, crawl_timeout, crawl_sync_interval
- **Concept Graph** — concept_graph, concept_boost_weight, concept_max_per_chunk
- **Provider** — llm_provider dropdown, litellm_base_url
- **Embedding Model** — dropdown from catalog (reindex confirmation on change)

### Truly read-only (not shown in settings)

`server_host`, `server_port`, `cors_origins`, `data_root`, `documents_dir`, `data_dir`, `lancedb_dir`, `models_dir`, `max_embed_chars`, `ignore_dirs`, `embedding_dim`, `json_mode`, `vision_timeout`

These are infrastructure, security, or auto-set values. No user-facing UI.

### Re-index confirmations

When user changes chunk_size, chunk_overlap, or embedding_model:
1. Confirmation dialog: "This will re-index all documents. Continue?"
2. On confirm → `PATCH /api/config` / `PUT /api/models/embedding`
3. Server returns `reindex_required: true` → `Notice("Re-indexing...")` → auto-sync with progress banner

### PATCH fallback

`updateConfig()` and `setEmbeddingModel()` are stubs. If the server returns 404/405, the error is caught and silently ignored. Generation params continue to work via per-request `options` field. When the server endpoint is deployed, the plugin works without changes.

## File Summary

| File | Action | Purpose |
|---|---|---|
| `src/types.ts` | Modify | Remove Ollama types, add new interfaces |
| `src/api.ts` | Modify | Remove OllamaClient, add 11 new methods |
| `src/main.ts` | Modify | Remove Ollama, add 3 commands |
| `src/server-manager.ts` | Modify | Remove Ollama env and option |
| `src/settings.ts` | Modify | Restructure, remove Ollama, add PATCH wiring |
| `src/views/chat-view.ts` | Modify | Migrate pull, add reasoning, add empty state |
| `src/views/catalog-modal.ts` | New | Model catalog browser |
| `src/views/crawl-modal.ts` | New | Web crawl with progress |
| `src/views/documents-modal.ts` | New | Document browser with bulk remove |

## SSE Event Reference

| Event | Data | Context |
|---|---|---|
| `token` | `{ token }` | LLM tokens |
| `reasoning` | `{ token }` | Thinking blocks |
| `sources` | `Source[]` | RAG sources |
| `error` | `{ message }` | Errors |
| `done` | `{}` | Stream complete |
| `progress` | `{ current, total }` | Pull / indexing |
| `file_start` | `{ file, total_files, current_file }` | Sync start |
| `file_done` | `{ file, status, chunks }` | Sync file done |
| `extract` | `{ file, page, total_pages }` | Vision OCR |
| `embed` | `{ file, chunk, total_chunks }` | Embedding |
| `crawl_start` | `{ url, depth }` | Crawl started |
| `crawl_page` | `{ url, current, total }` | Page crawled |
| `crawl_done` | `{ pages_crawled, files_written }` | Crawl complete |
| `crawl_error` | `{ message }` | Crawl failed |

## Execution Order

1. Types — remove Ollama types, add new interfaces (`types.ts`)
2. API client — remove OllamaClient, add new endpoints (`api.ts`)
3. Core — remove Ollama from main.ts, server-manager.ts
4. Settings — remove Ollama URL, migrate model management (`settings.ts`)
5. Chat view — migrate pull, add reasoning, add empty state (`chat-view.ts`)
6. Catalog browser modal (new `views/catalog-modal.ts`)
7. Settings redesign — PATCH wiring, reindex confirmations (`settings.ts`)
8. Web crawling (new `views/crawl-modal.ts`)
9. Document browser (new `views/documents-modal.ts`)
10. Tests — 100% coverage, TDD throughout
