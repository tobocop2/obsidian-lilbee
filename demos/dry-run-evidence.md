# Dry-run evidence (2026-05-15)

Empirical findings from driving the loaded plugin in Obsidian end-to-end
via computer-use, against the demo profile + sample vault + a dedicated
external lilbee server. **Read this before recording.**

## Setup that worked

- **Plugin build**: `cd /Users/tobias/projects/obsidian-lilbee-demos && npm install && npm run build` produces `main.js` (415 KB), `manifest.json`, `styles.css`. ~30 s.
- **Demo profile**: `~/Library/Application Support/obsidian-lilbee-demo/vault/` with the sample vault contents copied in, plugin symlinked at `<vault>/.obsidian/plugins/lilbee` → the worktree, plugin enabled in `<vault>/.obsidian/community-plugins.json`.
- **Vault registration**: kill Obsidian, then add the demo vault to `~/Library/Application Support/obsidian/obsidian.json` so `open -a Obsidian "<vault path>"` opens it. Obsidian overwrites that file while running, so the edit must happen with Obsidian closed.
- **External lilbee server**: `tmux new-session -d -s demo-server` running `LILBEE_DATA=/tmp/obsidian-demo-recipe LILBEE_MODELS_DIR=/tmp/lilbee-demo/models lilbee serve --port 7434`. Comes up in ~6 s, sample vault already indexed (7 sources visible via `/api/status`).
- **External-mode auth**: plugin requires URL + session token. Token from `LILBEE_DATA=/tmp/obsidian-demo-recipe lilbee token` (single-line base64-ish string, e.g. `Pz1oO_c928eg9913BnJj68KFl3xpDoMYDrEE73SMuW4`). Paste into the wizard's external-mode form OR Settings → Connection.

## What the wizard actually shows

- **Step 0**: "Welcome to lilbee" splash with the 6-step pill row (SERVER → MODEL → EMBED → SYNC → WIKI → DONE), 3-bullet description, "Skip setup" / "Get started" buttons. ~30 s of bullet read time.
- **Step 1 (SERVER)**: "How do you want to run lilbee?" — two cards (Managed recommended / External). Picking External expands a form with `SERVER URL` (default `http://127.0.0.1:7433`) + `SESSION TOKEN` (placeholder `lilbee-...`).
- **Step 2 (MODEL)**: "Pick a chat model" — header notes host RAM (`Your system: 32 GB RAM`). 7 cards visible in the OUR PICKS list (scroll required to see all):
  - gemma 4 E2B it (3.1 GB)
  - gemma 4 E4B it (5.3 GB)
  - Qwen3 Coder 30B A3B (18 GB)
  - Qwen3 0.6B (0.5 GB) — **INSTALLED** badge
  - Qwen3 4B (2.5 GB) — **INSTALLED** badge
  - Qwen3 8B (5 GB) — **ACTIVE** badge (currently the server's chat model)
  - Mistral 7B v0.3 (4.4 GB)
  - Each card has a `pick` badge, `native` badge, `FITS` badge (right side), and either `INSTALLED` or `ACTIVE` if applicable.
  - Card click → purple border around it (selected). Auto-focus is the first card (gemma 4 E2B it).
- Steps 3-6 (EMBED / SYNC / WIKI / DONE): not exercised in this run (skipped to chat).

## Critical gotchas the recording recipe must handle

1. **Managed-mode FAILS if port 7433 is occupied.** The plugin tries to start its own lilbee server on the default port; if anything else listens on 7433 (e.g. the user's other vault's QA server), the wizard shows toast `lilbee: managed server didn't produce a session token — try restarting the plugin` and the status bar shows `lilbee: error`. **Recording prep**: `lsof -iTCP:7433 -sTCP:LISTEN` must return empty before the first-run recording. Kill any existing servers first.

2. **Wiki commands are HIDDEN by default.** Searching the Command Palette for "lilbee:" shows **15** commands: Open chat, Sync vault, Show status, Rebuild index, Crawl web page, Pick chat model, Browse documents, Run setup wizard, Show task center, Browse model catalog, Pick embedding model, Search knowledge base, Retry skipped documents, Show info for active chat model, Show info for active embedding model. **No wiki commands.** They only appear after enabling wiki in plugin settings (Settings → lilbee → Wiki section). The recording recipe must enable wiki BEFORE the wiki demo otherwise `lilbee:wiki` / `lilbee:wiki-drafts` / `lilbee:wiki-lint` simply don't exist.

3. **The actual command labels differ from the recording-guide.md draft.** I had been writing them as `lilbee:catalog`, `lilbee:tasks`, etc. The real labels are:
   - `lilbee: Open chat` (was `lilbee:chat`)
   - `lilbee: Browse model catalog` (was `lilbee:catalog`)
   - `lilbee: Show task center` (was `lilbee:tasks`)
   - `lilbee: Crawl web page` (was `lilbee:crawl`)
   - `lilbee: Browse documents` (was `lilbee:documents`)
   - `lilbee: Show status` (was `lilbee:status`)
   - `lilbee: Search knowledge base` (was `lilbee:search`)
   - `lilbee: Run setup wizard` (was `lilbee:setup`)
   - `lilbee: Sync vault` (was `lilbee:sync`)
   - `lilbee: Rebuild index` (was `lilbee:sync-rebuild`)
   - `lilbee: Pick chat model` / `Pick embedding model`
   - `lilbee: Show info for active chat model` / `embedding model`
   - `lilbee: Retry skipped documents` (was `lilbee:sync-retry-skipped`)
   - Update recording-guide.md to use the real labels.

## Headline chat answer (this is the recording moment)

**Prompt** (replaces the TUI's oil-pressure question — it's much more interesting):

> I'm prepping this car to tow my boat. What does the manual say I need to check?

**Active model in this run**: Qwen3 8B Q4_K_M (the Phase-0 baseline). Qwen3 4B parity was not retested but the prompt is shorter than oil-pressure so quality holds.

**Time**: ~60 s start-to-finish answer streaming.

**Answer body** (cleaned, real):

> To prepare your car for towing a boat, the manual specifies the following checks:
>
> 1. **Trailer Wiring**: Disconnect the trailer wiring before backing into water; reconnect after removing the trailer from water [1].
> 2. **Water Level & Waves**: Ensure static water level does not rise above the rear bumper's bottom edge, and waves do not exceed 6 in (15 cm) above it during launching/retrieval [1].
> 3. **Rear Axle Lubricant**: Replace rear axle lubricant if the axle was submerged in water [1].
> 4. **Towing Method**: Use a wheel lift or flatbed; avoid slingbelts (not approved by Ford) [3].
> 5. **Air Suspension**: If equipped, turn off the air suspension control before towing [3].
> 6. **Emergency Towing**: For disabled vehicles without proper equipment, flat-tow with all wheels on the ground under these conditions:
>    - Transmission in Neutral [3].
>    - Max speed: 35 mph (56 km/h).
>    - Max distance: 50 miles (80 km).
>
> Ensure compliance to prevent vehicle damage.

**Sources block** (collapsible at bottom, opens with `▶ Sources`):
- `sample-vault/Crown Victoria Owner's Manual.pdf` with badges `p. 173`, `p. 256`, `pp. 211-212`
- `sample-vault/Code/lilbee-README.md` with `open` `open` badges (false retrieval — model dragged a lilbee chunk into a towing answer; ignorable)

**Why this beats the oil-pressure prompt**:
- Multi-section retrieval (towing + air suspension + emergency procedures), 3 distinct page references in the cv-manual.
- Specific facts (35 mph, 50 miles, slingbelts not approved, 6 in / 15 cm wave threshold).
- The boat-launch-into-water guidance is genuinely surprising/delightful — most readers don't know the manual has it.
- 6 numbered items render as a clean structured answer in the chat sidebar.

## Click-to-source modal (the differentiator)

Clicked the `p. 256` badge in the Sources block. Modal opens centered:
- **Title**: "Source preview"
- **Subtitle**: `sample-vault/Crown Victoria Owner's Manual.pdf`
- **Page label**: `p. 256`
- **Body**: full inline PDF viewer (Ford-branded, "256 / 333" page indicator, zoom 60%, page thumbnails on the left, the rendered page on the right showing "Maintenance and Specifications / Readiness for Inspection/Maintenance (I/M) testing")
- **Buttons**: `Save to vault` / `Close`
- Cited page lines are NOT visibly highlighted in the viewer (it's a regular PDF preview); the highlight behavior the README describes might apply to markdown sources only.

The modal looks great. **The differentiator demo works.** Caveat: in this specific run the cited p. 256 was about emissions-readiness (not towing) — model retrieval was off. Re-running should produce more on-topic citations; if still off, the demo recipe might need to switch to a more retrievable prompt or use Qwen3 4B for tighter retrieval.

## Status bar

Bottom-right shows `lilbee: ready [external] (Qwen3 8B)` — green pill with the model name. Same pattern across every demo state. Bottom-left shows the vault name (`vault`).

## Wiki test (run 2, after enabling wiki in plugin settings)

**Steps**: Settings → Community plugins → lilbee → scroll past Models /
Embedding / Vision / Reranker / Search & Retrieval / Crawling sections
to **Wiki (beta)** → toggle **Enable wiki** on. Setting persists in
`<vault>/.obsidian/plugins/lilbee/data.json` as `wikiEnabled: true`.

**Verified**:
- Three new commands appear in the palette after enabling:
  - `lilbee: Browse wiki`
  - `lilbee: Run wiki lint`
  - `lilbee: Review wiki drafts`
  Total command count rises from 15 to 18 (still NOT the 21 the plugin
  exploration agent's earlier count claimed; possibly more wiki commands
  surface only with vault-side wiki pages present).
- `lilbee: Browse wiki` opens a "Wiki" leaf in the right sidebar with a
  refresh button, build button, and a "Type to search..." input.
- Plugin Settings shows a new "Wiki status" line: "Enabled — 0 pages, 0
  drafts" — *but the server has 9 published + 9 drafts per `/api/wiki/status`*.

**New gotcha (the wiki demo will hit this)**: the plugin's wiki
sidebar surfaces wiki pages whose source matches a path inside the
Obsidian vault directory. My Phase 0 built the wiki against
`/tmp/obsidian-demo-recipe/documents/sample-vault/...`; the plugin's
vault is at `~/Library/Application Support/obsidian-lilbee-demo/vault/...`.
Different paths — plugin shows zero wiki pages even though the server
has nine. **Recording recipe fix**: the Phase 0 wiki must be built
against documents whose paths live inside the Obsidian vault so the
plugin surfaces them. Either:
  1. Move the demo lilbee server's `documents_dir` to point inside the
     vault (`<vault>/.lilbee/documents`), then re-run `lilbee wiki build`;
     OR
  2. Enable the plugin setting "Sync wiki to vault" (writes wiki pages
     as files in the vault under a configurable folder, default
     `lilbee-wiki/`) so the pages land in the vault and Obsidian's graph
     picks them up — this is also the demo moment "wiki pages land in
     the graph" the README promises.

Either path needs a re-run of the wiki build with the corrected
documents location, and an updated `wiki-recipe.md`. **The recording
guide currently assumes the wiki sidebar will be populated; that
assumption is wrong unless the recipe is updated.**

## Open questions / things I did NOT verify in this run

- Wizard step 3 (EMBED), step 4 (SYNC), step 5 (WIKI), step 6 (DONE) — only saw step 0, 1, 2.
- Catalog modal interaction (I have the commands but didn't open the catalog).
- Settings tab + filter input behaviour with non-empty queries.
- Right-click "Add to lilbee" file context menu.
- Crawl modal flow against the Caprice URL.
- Wiki sidebar with **vault-resident** wiki pages (the empty state above is the path-mismatch bug, not a real "no pages" state).
- Wiki drafts modal + lint modal interactions.
- ModelPicker modal opened from the inline chat-header selector.
- Whether Qwen3 4B as the active chat model produces the same answer parity with the TUI (haven't switched; still on 8B).

These should all be exercised before the recording session.

## Filed bug

- `obsidian-lilbee-auz` (P2): Managed mode silently fails when default port 7433 is occupied. Repro + suggested fixes captured.

## Recording-guide updates derived from this run

1. Use the **towing question** as the chat demo prompt (replaces oil pressure).
2. Update every `lilbee:<cmd>` reference to the actual label (e.g. `lilbee: Open chat`, `lilbee: Browse model catalog`).
3. Add a pre-recording checklist:
   - `lsof -iTCP:7433 -sTCP:LISTEN` → empty before first-run demo.
   - Wiki **enabled** in plugin settings before wiki demo.
   - External lilbee server running on port 7434 with token captured.
   - Plugin built (`main.js` exists in the worktree).
   - Demo vault registered in Obsidian's vault list.
4. Note that the SourcePreviewModal is centered and fixed-size — recording window of 1400×900 fits it cleanly.
5. Status-bar pill `lilbee: ready [external] (...)` is the always-visible health indicator; tape it as part of the still composition.
