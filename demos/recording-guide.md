# Recording guide: obsidian-lilbee demo reel

This guide is the canonical recipe for re-recording the marketing reel.
Obsidian is an Electron app with no headless mode, so every demo is a
manual screen recording. The `_postprocess.sh` and `_publish.sh` scripts
handle everything after `Cmd+Shift+5` stops.

## Conventions

- **Window size**: 1400×900 Obsidian window. Use a Mac window-resize
  utility (Rectangle, Magnet, Spectacle) or run this AppleScript:

  ```applescript
  tell application "System Events" to tell process "Obsidian"
      set position of window 1 to {120, 80}
      set size of window 1 to {1400, 900}
  end tell
  ```

- **Theme**: Obsidian's default light theme on the demo profile, sidebar
  panes pinned for the relevant demo. Whatever's chosen, keep it
  consistent across all nine demos.

- **Capture**: `Cmd+Shift+5` → "Record Selected Portion" → drag the
  selection rectangle to match the Obsidian window exactly → click
  Record. Stop with the menu-bar stop button or `Cmd+Ctrl+Esc`. The
  `.mov` lands at `~/Desktop/Screen Recording <date>.mov`.

- **Post-process**: `bash demos/_postprocess.sh ~/Desktop/Screen\ Recording*.mov <name>`
  produces `demos/_out/<name>.gif` + `<name>.png`. The script crops the
  top 32 px so the GIF reads as platform-neutral.

- **Publish**: once all demos are post-processed, `bash demos/_publish.sh`
  copies them onto the gh-pages worktree. Push gh-pages manually.

## Demo profile

A dedicated Obsidian profile keeps the recordings reproducible without
disturbing your live vault. Configure it once:

1. Create profile dir: `~/Library/Application Support/obsidian-lilbee-demo/`
2. Open Obsidian → "Open another vault" → "Create new vault" pointed at
   `<profile>/vault`
3. Install the lilbee plugin in dev mode:
   ```bash
   ln -s /Users/tobias/projects/obsidian-lilbee-demos \
         <profile>/vault/.obsidian/plugins/lilbee
   ```
4. Reset between recordings with `bash demos/reset-vault.sh`. The
   `--first-run` flag also clears `setupCompleted` for the wizard demo.

## Two-tier model strategy

- **Setup wizard demo**: managed mode. Plugin installs **Qwen3 4B Q4_K_M**
  (chat) + **Nomic v1.5** (embed) on camera. Same models the lilbee TUI
  `tui-setup` demo uses; same first question (`What is lilbee and how do
  I use it?`); same source (lilbee-README.md, pre-staged in the demo
  vault under `Code/lilbee-README.md`).

- **All other demos**: external server already running on `localhost:7433`
  with **Qwen3 8B Q4_K_M** as the active chat model. The plugin connects
  to it (Settings → Connection → External, URL pre-filled). Larger model
  = polished answers for the chat / click-to-source / wiki / lilbee-Q
  demos.

Start the external server in a separate terminal before recording the
non-wizard demos:

```bash
LILBEE_DATA=~/Library/Application\ Support/obsidian-lilbee-demo/.lilbee \
  lilbee serve --port 7433
```

## The nine demos

For each demo: starting state → mouse path → what to type → stop cue.
Aim for 30–60 s of recording per demo; post-process trims tails.

### Demo matrix

Every demo's recipe in one table. **Small models do the simple
prompts** — exact parity with the TUI reel (same questions, same
expected answers). The big **Gemma 3n 26B** is reserved for the wiki
(headless build then on-camera replay) and the lilbee-on-lilbee bonus
where the longer reasoning chain shows the model's strength.

| # | Demo | Active chat model | Server mode | Source | Prompt | Expected answer |
|---|---|---|---|---|---|---|
| 1 | first run | **Qwen3 4B Q8_0** *(installed on camera)* | managed | `Code/lilbee-README.md` | What is lilbee and how do I use it? | Structured 3-step usage list, cites README chunks. Same answer as TUI `tui-setup`. |
| 2 | tour | **Qwen3 4B** *(pre-pulled)* | external | mixed | brief cited Q against cv-manual mid-sweep | sweep through every surface; chat moment shows a quick cited answer |
| 3 | chat | **Qwen3 4B Q4_K_M** | external | `Crown Victoria Owner's Manual.pdf` | I'm prepping this car to tow my boat. What does the manual say I need to check? | 6-item numbered list (Trailer Wiring / Water Level & Waves / Rear Axle Lubricant / Towing Method / Air Suspension / Emergency Towing) with `[1] [3]` citations to cv-manual pp. 173, 211-212, 256. Verified against the running plugin. Multi-section retrieval; specific facts (35 mph, 50 mi, slingbelts not approved). |
| 4 | click to source | (same as #3) | external | continuation of #3 | click `[1]` then `[2]` | SourcePreviewModal opens to the cited paragraphs in cv-manual with the quoted lines highlighted |
| 5 | add | **Qwen3 0.6B** | external | a single note removed then re-added on camera | what's the most recent entry in Daily.md? | one-line cited answer; small model is enough |
| 6 | crawl | **Qwen3 4B Q4_K_M** | external | crawled `https://en.wikipedia.org/wiki/Chevrolet_Caprice` | When was the 9C1 police package introduced? | **1986**, cites the crawled `Chevrolet_Caprice/index.md`. Same as TUI `tui-crawl`. |
| 7 | catalog | UI demo, no chat | external | n/a (pulls Qwen3 0.6B on camera) | n/a | catalog grid + Hugging Face tab + a live small-model pull + an installed-state badge appearing |
| 8 | settings | UI demo, no chat | external | n/a | n/a | filter input narrows on `topK`, value gets edited, reranker toggled |
| 9 | wiki | **Gemma 3n 26B** *(pre-built headlessly per `wiki-recipe.md`)* | external | sample vault (built before recording) | Replay built state | open Wiki sidebar &rarr; click `Model Context Protocol (MCP)` &rarr; cited prose &rarr; click `[^src2]` &rarr; SourcePreviewModal &rarr; close &rarr; `lilbee:wiki-drafts` (9 quarantined) &rarr; `lilbee:wiki-lint` (0 errors) |

Bonus (in `docs/demos.md`, not in the site reel):

| # | Demo | Model | Source | Prompt | Expected answer |
|---|---|---|---|---|---|
| B1 | lilbee-on-lilbee | **Gemma 3n 26B** | `Code/system.py`, `Code/mcp_server.py` | Show me the function in lilbee that walks up from the current directory to find a project-local `.lilbee/` directory. Quote the function body and cite the file and line range. | Quotes `find_local_root` body with the `Path.parents` walk, cites `Code/system.py:26-33`. Mirrors TUI `mcp-code`. |
| B2 | search | n/a (UI only) | sample vault | `oil pressure` | SearchModal results with highlighted excerpts |

Two recording sessions implied:
- **Session A — small-model demos** (Qwen3 0.6B / 4B already cached, no Gemma needed): #1, #2, #3, #4, #5, #6, #7, #8. Eight of nine demos can record today, including the headline chat + click-to-source moments.
- **Session B — big-model demos** (Gemma 3n 26B required): #9 wiki, B1 lilbee-on-lilbee. Records once Gemma finishes pulling and the wiki is rebuilt against it.

### 1. first-run

- **Reset**: `bash demos/reset-vault.sh --first-run`
- **Recording starts**: with Obsidian closed.
- **Steps**: open Obsidian → vault prompt → pick the demo vault → plugin
  loads → SetupWizard modal opens → step through Welcome → "Managed
  server" → wait for managed lilbee binary install (fast-forward in
  post: `--speed 8` on this segment) → chat model picker → pick Qwen3 4B
  → embedding picker → pick Nomic v1.5 → vault sync runs in foreground
  → done → wizard auto-opens chat → type `What is lilbee and how do I
  use it?` → wait for answer → stop recording on the cited reply.
- **Still offset**: the cited answer (~50 s in).

### 2. tour

The "this plugin does a LOT" moment. The tour exists to surface the
plugin areas the dedicated demos don't cover (Command Palette breadth,
Task Center, Documents modal, Status modal, Search modal, ModelPicker
modal, wiki drafts, wiki lint, ribbon icons, file context menu, status
bar). Fast cuts; ~75 s wall time before post-process speedup.

- **Reset**: `bash demos/reset-vault.sh --keep-models`
  (vault already indexed, wiki already built per `wiki-recipe.md`,
  external lilbee server already running on `localhost:7433`, Qwen3 4B
  pinned as the active chat model)
- **Pre-state**: Obsidian open on the demo vault, Chat sidebar visible,
  no modal open. ~2 s of held quiet before the first action.

**Storyboard** (each beat ~5 s except where noted):

  1. `Cmd+P` → type `lilbee` → palette filters to the full
     `lilbee:*` command list. *Hold for 4 s on the populated palette —
     this is the "look how much surface this plugin has" frame.*
  2. Click `lilbee:tasks` → Task Center sidebar opens. Glance at any
     active sync row / installed-models pane. ~5 s.
  3. `Cmd+P` → `lilbee:documents` → DocumentsModal opens listing the
     indexed sample-vault files. Close with Esc. ~5 s.
  4. `Cmd+P` → `lilbee:status` → StatusModal: server URL, version,
     mode, sync state. Close. ~4 s.
  5. `Cmd+P` → `lilbee:search` → SearchModal → type `oil pressure`
     → results with highlighted excerpts → close. ~7 s.
  6. `Cmd+P` → `lilbee:wiki` → Wiki sidebar populates with the 9
     pre-built concept pages. Click `Search Engine` → page opens with
     citation footnotes inline. ~10 s.
  7. `Cmd+P` → `lilbee:wiki-drafts` → DraftModal lists the 9
     quarantined pages. Close. ~5 s.
  8. `Cmd+P` → `lilbee:wiki-lint` → LintModal: 0 errors. Close. ~3 s.
  9. `Cmd+P` → `lilbee:catalog` → CatalogModal opens, click the
     Hugging Face tab so the grid is visible. Close. ~5 s.
  10. Right-click a file in the Files explorer → context menu shows
      `Add to lilbee`. Close menu without picking. ~3 s.
  11. Open Obsidian's Settings (gear) → scroll to the lilbee section
      → filter input gets `topK` typed → settings narrow. Close. ~5 s.
  12. `Cmd+P` → `lilbee:chat` → Chat sidebar focuses. Click the
      inline chat-model selector in the chat header → ModelPickerModal
      opens, close without picking. ~4 s.
  13. Type a quick cited Q in chat: `What does this manual say about
      tire pressure?` → answer streams with `[1]` citation. ~12 s.
  14. Stop recording on the streaming answer.

- **Still offset**: the populated `lilbee:*` Command Palette list from
  step 1 (~3 s in) — the proof-of-breadth frame.
- **Post-process**: `bash demos/_postprocess.sh ~/Desktop/Screen\ Recording*.mov tour 3`
  for the still at the 3 s mark. The tape itself often benefits from a
  1.5-2× post-process speedup so the cuts stay snappy; if you keep the
  recording short the speedup is optional.

### 3. chat

- **Steps**: Chat sidebar already open. Type
  `What does the oil pressure warning mean?` (same Q as the lilbee TUI
  reel, against the same Crown Vic PDF). Watch streaming reply with
  `[1] [2]` citations. Stop on completion.
- **Still**: cited answer fully rendered.

### 4. click-to-source (the differentiator)

- **Steps**: continuation of #3, OR fresh recording from the same state.
  Mouse hovers `[1]` → click → SourcePreviewModal opens to the exact
  passage in cv-manual.pdf with the cited lines highlighted → read for
  a beat → close → click `[2]` → second source opens.
- **Still**: SourcePreviewModal open, cited lines visible.

### 5. add

- **Reset**: clear one note from the index so we can re-add it.
- **Steps**: right-click the file in the Files explorer → "Add to
  lilbee" → notice toast "Added 1 file" → Task Center sidebar shows
  brief sync → switch to Chat → ask a question that hits that note →
  cited answer.
- **Still**: file context menu open with "Add to lilbee" highlighted.

### 6. crawl

- **Steps**: Command Palette → `lilbee:crawl` → CrawlModal opens →
  paste `https://en.wikipedia.org/wiki/Chevrolet_Caprice` (same URL as
  the TUI reel) → click Crawl → Task Center shows progress (post-
  process speedup if needed) → switch to Chat → ask
  `When was the 9C1 police package introduced?` → cited answer points
  at the crawled page.
- **Still**: cited answer about the 9C1.

### 7. catalog

- **Steps**: Command Palette → `lilbee:catalog` → CatalogModal opens →
  browse Hugging Face tab → search "qwen" → click a card →
  ModelInfoModal → close → "Pull" Qwen3 0.6B (small, fast) →
  ConfirmPullModal → confirm → Task Center shows live progress
  (fast-forward in post) → installed badge appears → close Catalog →
  back in Chat, swap active chat model via inline picker → ModelBar
  updates.
- **Still**: Catalog grid with installed-state badges.

### 8. settings

- **Steps**: Settings tab (gear icon) → filter input "topK" → relevant
  setting highlights → tweak topK → toggle reranker (if available) →
  cycle to Generation section → glance at system prompts → close.
  Brief; ~30 s.
- **Still**: Settings with filter active and a value being edited.

### 9. wiki

- **Reset**: pre-warmed wiki built (Phase 0 recipe — see
  `demos/wiki-recipe.md` for the validated model + parameters).
- **Steps**: Command Palette → `lilbee:wiki` → Wiki sidebar populates →
  click a generated page (e.g. "Search Engine") → see the citation
  footnotes inline → click a footnote → SourcePreviewModal opens →
  close → run `lilbee:wiki-lint` → LintModal shows zero issues → close
  → run `lilbee:wiki-drafts` → DraftModal shows the MCP draft (faith
  0.0) for review.
- **Still**: Wiki page open with citation footnotes visible + Obsidian
  graph in the background.

## Optional bonus (not in the site reel)

### lilbee talking to lilbee

- **Steps**: vault has `Code/system.py` and `Code/mcp_server.py` indexed
  → Chat → ask `Show me the function in lilbee that walks up from cwd
  to find a project-local .lilbee/ directory. Quote it with
  file:line.` → cited answer pointing at `Code/system.py:NN` with the
  `find_local_root` body quoted. Mirrors the TUI `mcp-code` flagship.
- **Still**: cited answer with code block visible.

### search modal

- **Steps**: Command Palette → `lilbee:search` → SearchModal → type
  query → results with highlighted excerpts.
- **Still**: results list.
