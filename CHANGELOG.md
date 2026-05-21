# Changelog

## Unreleased

### Breaking changes

- **Shared lilbee install replaces per-vault installs.** The plugin no longer keeps a separate lilbee binary, models cache, or data directory per Obsidian vault. Everything moves to a shared root (`~/Library/Application Support/Lilbee/` on macOS, `~/.local/share/lilbee/` on Linux, `%LOCALAPPDATA%\Lilbee\` on Windows). The binary lives in `<shared-root>/bin/`, downloaded models live in `<shared-root>/models/`, and each Obsidian vault has its own `vaults/<id>/` subfolder for its index, wiki, and config. The shared root path is configurable in Settings → Connection.

  **No automatic migration.** Existing installs will spawn lilbee against the new shared root on first load and behave as a fresh install for indexing purposes. To recover disk space and (optionally) carry over your existing index, do this once per vault:

  1. **Close Obsidian.**
  2. **Move your existing data over (optional, preserves the index):**
     ```bash
     # macOS / Linux. Replace <vault> with your Obsidian vault path.
     mkdir -p ~/Library/Application\ Support/Lilbee/vaults
     mv "<vault>/.obsidian/plugins/lilbee/server-data" \
        ~/Library/Application\ Support/Lilbee/vaults/legacy
     ```
     The plugin will pick this up when you register the vault (Settings → Connection → "Use existing lilbee data directory").
  3. **Or just delete the leftovers (loses the existing index — rebuild on next sync):**
     ```bash
     rm -rf "<vault>/.obsidian/plugins/lilbee/server-data" \
            "<vault>/.obsidian/plugins/lilbee/bin"
     ```

  After cleanup the plugin starts with one binary download and one model download that every vault on the machine shares.

- **Only one Obsidian vault can drive the managed lilbee at a time.** Lilbee is single-vault. Opening a second vault shows the active owner in the status bar; the `lilbee: Take over the managed lilbee server` command switches the running process to the new vault after a confirmation dialog. The previous vault's index is preserved on disk and restored when you reopen it. A new `lilbee: Switch lilbee to another vault` command lists registered vaults so you can release the managed server for another vault without a take-over prompt.

- **`lilbeeVersion` and `hfToken` moved out of per-vault settings.** Both now live in `<shared-root>/config.json` because the binary and HuggingFace cache they describe are shared. Any per-vault values in `data.json` are ignored; re-enter the HuggingFace token in Settings → Advanced if you had one.

- Renamed the local plugin setting `systemPrompt` to `ragSystemPrompt` to match the lilbee server's `system_prompt` → `rag_system_prompt` rename. Any prompt set under the old key resets to the default.
- The `LILBEE_SYSTEM_PROMPT` env var passed to managed servers is now `LILBEE_RAG_SYSTEM_PROMPT`. A second env var `LILBEE_GENERAL_SYSTEM_PROMPT` is set when the new sibling field is configured.
- Auto-sync mode is gone. The status bar shows a clickable "lilbee: N to sync" hint when the vault has files the server hasn't indexed; click to sync. The `syncMode` and `syncDebounceMs` plugin settings are no longer used.
- The "Server port" setting and the underlying `serverPort` field are gone. The managed server always binds an OS-picked free port and the plugin reads the chosen port from `data/server.port`. Any persisted value is ignored.

### Fixed

- Managed mode no longer wedges into a "didn't produce a session token" loop when another process is already listening on 7433. The plugin lets the server pick any free port on every start.

### Added

- A separate "When answering without documents" prompt (`general_system_prompt`) sits next to the cited-answer prompt in Settings → Generation. The cited-answer prompt is now labelled "When answering with documents".
- A Search / Chat mode toggle in the chat header switches the server's `cfg.chat_mode`. Disabled (with a tooltip) when no embedding model is configured. Hidden when the connected server predates the field.
- Banners returned by the chat stream render verbatim above the answer bubble — copy like "Search needs an embedding model" comes from the server, not the plugin.
- The Browse Catalog modal has Local | Frontier sub-tabs. The Frontier tab is hidden until at least one provider API key is set in Settings; once a key is saved, the tab appears with cloud models grouped by provider, each with a Ready / Needs-key pill. Clicking a Needs-key row deep-links to that provider's API-key input.
- A new model picker modal opens via `lilbee: Pick chat model` and `lilbee: Pick embedding model` (assignable hotkeys via Obsidian → Hotkeys). Search input + virtualized list grouped by provider; Frontier rows are hidden until at least one key is configured.
- Settings sections for API Keys, Crawling, and Wiki are hidden entirely when their feature isn't installed server-side. Capability probes hit `/api/models/external`, `/setup/crawler/status`, and `/api/config.wiki` and cache per session.
- The chat input is dimmed and locked while a message is in flight; the Stop button on the same row cancels it. When the server replies HTTP 429 (another client is already streaming), the chat surface shows "lilbee is busy with another request — try again in N seconds" instead of a generic error, and never auto-retries.
- Per-file ingest progress: the Task Center surfaces a `BATCH_PROGRESS` line (`indexed K/N file.pdf`, or `skipped` / `failed` per file status) as the server completes each file in a sync or add. Sync result Notices now include a "N skipped" segment whenever the server reports skipped documents.
- Settings → Advanced gains four new groups: Worker Pool (`worker_pool_call_timeout_s`, `worker_pool_eager_start`, `worker_pool_max_idle_s`), Ingest extras (`chunk_size`, `chunk_overlap`, `tesseract_timeout`, `vision_load_budget_s`), Generation extras (`max_tokens`, `model_keep_alive`, `gpu_memory_fraction`), and Retrieval extras (`candidate_multiplier`, `min_relevance_score`, `max_context_sources`, `diversity_max_per_source`, `mmr_lambda`). Each row is hidden until the connected server includes the matching field in `/api/config`.
- Browse Catalog is now a 6-tab layout: Discover (For You / Your Collection / Fresh rails), Chat, Embed, Vision, Rerank, Library. Press `1`-`6` to jump tabs. Active tab persists across opens via the new `lastCatalogTab` plugin setting. Inside each task tab the Local | Frontier sub-toggle still works as before.
- Each catalog row shows a hardware-fit chip (`fits` / `tight` / `won't run`) when the server reports `fit` on the row. The plugin no longer probes the client's RAM, so the chip stays accurate when the server runs on a different machine.
- A right-side detail drawer in Browse Catalog mirrors the focused row's metadata (fit chip, size variants, description, downloads, install status). The drawer collapses below 800px viewport width and via the header toggle button.
- A Model Info modal opens on the `i` key in Browse Catalog or via the new `lilbee: Show info for active chat model` and `lilbee: Show info for active embedding model` commands. The modal renders the full row metadata plus a clickable Hugging Face link.
- The Vision and Reranker model dropdowns in Settings prepend an explicit "(disabled — no model)" option that clears the field on the server.
- Setup-completed installs open the cockpit on launch: chat docks in the right sidebar and the Task Center splits the main editor horizontally beneath whatever you're reading — both stay visible instead of collapsing into a single tab. A new chat ribbon icon sits next to the task icon. The task-ribbon "tasks running" pulse is louder — a bigger dot with a scaling glow ring while tasks are in flight (static dot under reduced-motion). An "Auto-open chat + Task Center" toggle in Settings → Advanced turns it off.
- Settings → Generation gains a "Max reasoning characters" input (`max_reasoning_chars`) — caps how much a reasoning model can think before it's forced to answer. The row stays hidden on servers that don't report the key. The chat renderer keeps reasoning and the answer tokens that follow a mid-stream cap in the same assistant bubble.
- Two commands surface the server's sync-recovery paths: `lilbee: Retry skipped documents` re-runs a sync that re-attempts files which produced no content last time (timed-out OCR, no extractable text), and `lilbee: Rebuild index` — behind a confirm — drops the whole index and re-embeds every document from scratch. Both run through the Task Center like a regular sync.
