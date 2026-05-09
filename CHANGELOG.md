# Changelog

## Unreleased

### Breaking changes

- Renamed the local plugin setting `systemPrompt` to `ragSystemPrompt` to match the lilbee server's `system_prompt` → `rag_system_prompt` rename. Any prompt set under the old key resets to the default.
- The `LILBEE_SYSTEM_PROMPT` env var passed to managed servers is now `LILBEE_RAG_SYSTEM_PROMPT`. A second env var `LILBEE_GENERAL_SYSTEM_PROMPT` is set when the new sibling field is configured.
- Auto-sync mode is gone. The status bar shows a clickable "lilbee: N to sync" hint when the vault has files the server hasn't indexed; click to sync. The `syncMode` and `syncDebounceMs` plugin settings are no longer used.

### Added

- A separate "When answering without documents" prompt (`general_system_prompt`) sits next to the cited-answer prompt in Settings → Generation. The cited-answer prompt is now labelled "When answering with documents".
- A Search / Chat mode toggle in the chat header switches the server's `cfg.chat_mode`. Disabled (with a tooltip) when no embedding model is configured. Hidden when the connected server predates the field.
- Banners returned by the chat stream render verbatim above the answer bubble — copy like "Search needs an embedding model" comes from the server, not the plugin.
- The Browse Catalog modal has Local | Frontier sub-tabs. The Frontier tab is hidden until at least one provider API key is set in Settings; once a key is saved, the tab appears with cloud models grouped by provider, each with a Ready / Needs-key pill. Clicking a Needs-key row deep-links to that provider's API-key input.
- A new model picker modal opens via `lilbee: Pick chat model` and `lilbee: Pick embedding model` (assignable hotkeys via Obsidian → Hotkeys). Search input + virtualized list grouped by provider; Frontier rows are hidden until at least one key is configured.
- Settings sections for API Keys, Crawling, and Wiki are hidden entirely when their feature isn't installed server-side. Capability probes hit `/api/models/external`, `/setup/crawler/status`, and `/api/config.wiki` and cache per session.
- The chat input is dimmed and locked while a message is in flight; the Stop button on the same row cancels it. When the server replies HTTP 429 (another client is already streaming), the chat surface shows "lilbee is busy with another request — try again in N seconds" instead of a generic error, and never auto-retries.
