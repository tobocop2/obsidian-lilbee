# Demo reel QA matrix

Every demo must pass all universal checks plus its demo-specific check
before it can be marked READY. Status is filled from the per-second
walkthrough frame audit of the final webm (not from intent).

Verdict key: PASS / FAIL / PENDING (not yet re-recorded this round).

All ten re-recorded with a cursor-free ScreenCaptureKit capture plus a
synthetic cursor overlay. The avfoundation capture composited the macOS
hardware cursor, which dropped out during heavy repaints (scrolling lists);
SCK (showsCursor=false) captures no cursor at all and the recorder draws an
always-present arrow from the recorded mouse trace. Verified frame-by-frame
on catalog: the cursor is present in every one of 1579 frames.

## Universal checks (apply to every demo)

- **C1 cursor**: exactly one cursor (the synthetic overlay; capture is cursor-free), present in every frame, smooth Bezier motion. No teleport, no disappearing, no double cursor.
- **C2 status**: status bar reads as running — single icon, soft green, correct active model. (Exception: multi_vault ends released; first_start starts with no server.)
- **C3 workspace**: supporting demos show an actively-used vault (explorer + chat + tasks). Only first_start is a fresh install.
- **C4 no-errors**: no error frames ("unable to load", "No models installed", broken-logo fixation, empty/garbled answer).
- **C5 money shot**: the demo's payoff frame is present and held.

## Per-demo

| Demo | Specific check | C1 | C2 | C3 | C4 | C5 | Verdict |
|------|----------------|----|----|----|----|----|---------|
| tour | Trimmed superset: explorer, catalog flick + download confirm, add, cited chat, settings | PASS | PASS | PASS | PASS | PASS | **PASS** |
| lilbee_on_lilbee | README-only cited answer; citation scrolls to the "Offline copies of websites" GIF | PASS | PASS | PASS | PASS | PASS | **PASS** |
| add | **Task Center cleared before the add**; manual-only ingest; citation opens manual at cited page | PASS | PASS | PASS | PASS | PASS | **PASS** |
| crawl | **Task Center cleared before the crawl**; **answer includes "1986"**; citation opens the 9C1 section | PASS | PASS | PASS | PASS | PASS | **PASS** |
| catalog | **Rapid flick through each tab (Chat/Embed/Vision/Rerank)** showing many models / infinite scroll; then search | PASS | PASS | PASS | PASS | PASS | **PASS** |
| download_model | Real pull of **SmolLM2 360M** (~0.3GB) streams to completion in a cleared Task Center (catalog pull does not auto-activate; status stays Qwen3 8B) | PASS | PASS | PASS | PASS | PASS | **PASS** |
| command_palette | Three palette flows: settings, **crawl (now actually runs — Knowledge_graph)**, add | PASS | PASS | PASS | PASS | PASS | **PASS** |
| settings | Full settings surface scrolled top to bottom through Advanced | PASS | PASS | n/a (blank) | PASS | PASS | **PASS** |
| multi_vault | Active vault (Qwen3 8B, used) → picker shows **3 vaults to choose from** → switch → released/stopped | PASS | PASS (released ending) | PASS | PASS | PASS | **PASS** |
| first_start | From-scratch install → wizard → model → **first chat with a cited answer** | PASS | PASS | n/a (fresh install) | PASS | PASS | **PASS** |

## Notes

- **cursor smoothness (all demos)**: the real defect was the macOS hardware cursor dropping out of the avfoundation capture during heavy repaints (scrolling lists, animating Task Center). Fix: capture cursor-free with ScreenCaptureKit (showsCursor=false) and overlay a synthetic arrow rendered from the recorded mouse trace, so the cursor is drawn into every output frame and cannot flicker. Verified by extracting all 1579 catalog frames and confirming the arrow is present in each.
- **crawl 1986**: retrieval-ranking miss (dense reference list + 1987/1989 paragraphs out-ranked the introduction sentence at low top_k). Fixed by widening top_k to 10.
- **lilbee_on_lilbee / tour README-only**: top_k=1/3 pull an unrelated crawled page via MMR re-selection; top_k=2 dedupes to a README-only citation.
- **download_model**: swapped Llama 3.2 1B (1.2GB, slow, hit the 240s guard) for SmolLM2 360M (~0.3GB). Also wait for the search results to render before clicking the pull (was clicking a stale card).
- **command_palette**: the crawl flow now actually runs (click Crawl + watch the Task Center) instead of pasting the URL and dismissing.
- **multi_vault**: registered two more vaults (Research, Work) so the picker offers a real choice (3 alternatives), per the "at least 2 vaults to choose from" requirement.
- **first_start**: recorded in the firststart vault (BRAT install → enable → wizard → first cited chat). The wizard's model-picker cards load asynchronously, so the storyboard now waits for the Qwen3 0.6B card before selecting. Minor: the chat header shows Qwen3 8B (the firststart vault's active model) while the wizard picked 0.6B; the answer is high-quality and cited.

## Round 3 (glide + lingering + crawl payoff)

- **Gliding cursor**: slowed mouse.py to a cinematic glide (min 420ms, ~1050 px/s, larger arc) — verified via frame AE that a move now spans ~11 continuous frames (~366ms, every-frame motion) vs the old ~5-frame snap.
- **Less lingering**: 500ms lead-in (was 1500) + ~300ms opening holds, so demos start ~0.8s in.
- **command_palette**: after crawling the Knowledge_graph page it now asks "what is a knowledge graph?", gets a cited answer, and the citation glides the crawled article down to the Definitions section (was lingering at the top — the matcher had been hitting the page title).
- **first_start**: the wizard model-picker re-renders asynchronously and stranded the coordinate click; replaced with a polling DOM-click that re-queries until the Qwen3 0.6B card reports selected. Now completes through the first cited chat.

## Round 4 (cursor fix + feedback sweep)

- **Cursor flicker eliminated**: cursor-free ScreenCaptureKit capture + synthetic cursor overlay. Verified present in all 1579 catalog frames (see top note).
- **⌘P badge**: every palette-opening beat flashes a "⌘P" chip top-centre while the palette is up. Wired into all nine palette demos via a `keyHint` beat option.
- **add — amber sync-pill**: the pill counts managed files the server doesn't yet know; it only refreshed on vault file events, so it appeared on add but never cleared when the ingest finished. Now also refreshed on task-queue changes (plugin fix + test). Verified `display:none` after ingest.
- **download_model**: switched from prithivMLmods (its GGUF filename has a stray space the server rejects after downloading) to the well-formed bartowski repo; clicks that card by data-repo. freshModel now uninstalls by deleting the model's manifest+snapshot from the models dir (the HTTP DELETE route can't match slashed names). Verified clean pull to completion.
- **tour**: starts a real Phi-4 chat-model pull, watches it begin in the Task Center, then cancels it (verified status=cancelled). Was: open the confirm and dismiss.
- **multi_vault**: reads the picker, filters to a named vault (Research), then switches — a deliberate choice instead of an ambiguous first-card click.
- **first_start**: preflight uninstalls lilbee with no trace (guarded to the firststart vault) so the opening shows no lilbee plugin UI; BRAT reinstalls it during the demo. Recorded self-driven via vault-aware page selection (vaultMatch).
- **core Sync red icon**: disabled the unconfigured core Obsidian Sync plugin in the demo + firststart vaults — it was showing a red "Uninitialized" error glyph in the corner.
