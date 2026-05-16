# The full reel

Same demos as on [tobocop2.github.io/obsidian-lilbee/](https://tobocop2.github.io/obsidian-lilbee/),
with longer captions and a couple of bonus demos that don't fit in the
site's tab list.

The nine that match the site reel, in order:

1. [First run](#first-run)
2. [Tour](#tour)
3. [Chat with cited answers](#chat-with-cited-answers)
4. [Click to source](#click-to-source)
5. [Add a file](#add-a-file)
6. [Crawl a URL](#crawl-a-url)
7. [Model catalog](#model-catalog)
8. [Settings](#settings)
9. [Wiki](#wiki)

Bonus demos: [lilbee talking to lilbee](#lilbee-talking-to-lilbee),
[search modal](#search-modal).

## First run

Fresh install. Plugin loads with `setupCompleted=false`; the SetupWizard
opens. Pick **managed mode** and the plugin installs the lilbee server
itself (fast-forwarded in post). Pick **Qwen3 4B Q8_0** for chat,
**Nomic v1.5** for embeddings (same models the lilbee TUI's first-run
demo uses; same small-model pull beat). Vault syncs automatically. Chat
opens. Type *"What is lilbee and how do I use it?"* against the staged
lilbee README. Cited reply lands.

![first run](https://raw.githubusercontent.com/tobocop2/obsidian-lilbee/gh-pages/demos/first-run.gif)

## Tour

A minute through every plugin surface: chat sidebar via the ribbon →
quick cited Q&A → tasks ribbon → catalog modal peek → settings tab →
wiki sidebar → back to chat. The bigger Qwen3 8B chat model is loaded
for crisp answers.

![tour](https://raw.githubusercontent.com/tobocop2/obsidian-lilbee/gh-pages/demos/tour.gif)

## Chat with cited answers

Type *"What does the oil pressure warning mean?"* against the indexed
Crown Victoria owner's manual. The reply streams in with `[1] [2]`
footnotes pointing at page 42-43 of the PDF. **Same question, same
source, same answer as the lilbee TUI `tui-chat` demo.**

![chat](https://raw.githubusercontent.com/tobocop2/obsidian-lilbee/gh-pages/demos/chat.gif)

## Click to source

Continuation of the chat reply. Click `[1]` and the SourcePreviewModal
opens to the cited paragraph in the cv-manual PDF, with the cited lines
highlighted and the surrounding paragraphs visible. Click `[2]` for the
second source. *This is the moment that justifies the whole plugin.*

![click to source](https://raw.githubusercontent.com/tobocop2/obsidian-lilbee/gh-pages/demos/click-to-source.gif)

## Add a file

Right-click any file in your vault's Files explorer → choose
`Add to lilbee` → toast confirms `Added 1 file` → Task Center sidebar
shows a brief sync → switch to Chat → ask about that file → cited
answer.

![add](https://raw.githubusercontent.com/tobocop2/obsidian-lilbee/gh-pages/demos/add.gif)

## Crawl a URL

Command Palette → `lilbee:crawl` → CrawlModal opens → paste
`https://en.wikipedia.org/wiki/Chevrolet_Caprice` → Crawl → Task Center
fills (post-process speedup) → switch to Chat → ask *"When was the 9C1
police package introduced?"* → cited answer: **1986**. **Same URL,
same question, same answer as the lilbee TUI `tui-crawl` demo.**

![crawl](https://raw.githubusercontent.com/tobocop2/obsidian-lilbee/gh-pages/demos/crawl.gif)

## Model catalog

Command Palette → `lilbee:catalog` → CatalogModal browses Hugging Face
Hub → search `qwen` → click a card → ModelInfoModal shows size and
description → close → Pull Qwen3 0.6B (small, fast on camera) →
ConfirmPullModal → confirm → Task Center shows live progress →
installed badge appears → close → Chat → swap active chat model from
the inline picker → ModelBar updates.

![catalog](https://raw.githubusercontent.com/tobocop2/obsidian-lilbee/gh-pages/demos/catalog.gif)

## Settings

Settings tab (gear icon) → filter input "topK" → relevant settings
narrow → tweak the value → toggle reranker if available → cycle to the
Generation section → glance at system prompts → close. Brief; the
filter is the headline.

![settings](https://raw.githubusercontent.com/tobocop2/obsidian-lilbee/gh-pages/demos/settings.gif)

## Wiki

Auto-generated, citation-checked concept pages, written from your
indexed content. Built headlessly via lilbee CLI before the recording
to lock the recipe (see [`demos/wiki-recipe.md`](../demos/wiki-recipe.md));
**Qwen3 8B Q4_K_M** generates 9 published concepts + 9 quarantined
drafts against the sample vault. Obsidian replays this state.

Open the Wiki sidebar → click `Model Context Protocol (MCP)` →
the page opens in the main pane with inline `[^src2] [^src4]` footnotes
→ click `[^src2]` → SourcePreviewModal opens to the cited paragraph in
lilbee-README.md → close → `lilbee:wiki-drafts` → DraftModal lists the
9 quarantined pages → `lilbee:wiki-lint` → 0 errors.

![wiki](https://raw.githubusercontent.com/tobocop2/obsidian-lilbee/gh-pages/demos/wiki.gif)

## Bonus

These don't have a tab on the site, but they're part of the same reel.

### lilbee talking to lilbee

Vault has `Code/system.py` and `Code/mcp_server.py` indexed (the lilbee
source slice). Chat → ask *"Show me the function in lilbee that walks
up from the current directory to find a project-local `.lilbee/`
directory. Quote the function body and cite the file and line range."*
→ cited answer pointing at `Code/system.py:26-33` with the
`find_local_root` body quoted (the `Path.parents` walk-up). Mirrors
the lilbee TUI `mcp-code` flagship.

![lilbee on lilbee](https://raw.githubusercontent.com/tobocop2/obsidian-lilbee/gh-pages/demos/lilbee-on-lilbee.gif)

### Search modal

Command Palette → `lilbee:search` → SearchModal opens → type a query
→ results list with highlighted excerpts. Use when you want raw
retrieval without going through chat.

![search](https://raw.githubusercontent.com/tobocop2/obsidian-lilbee/gh-pages/demos/search.gif)

---

GIFs and stills live off `main` on the
[`gh-pages` branch](https://github.com/tobocop2/obsidian-lilbee/tree/gh-pages/demos),
embedded here via `raw.githubusercontent.com` URLs. Recording recipes
are in [`demos/recording-guide.md`](../demos/recording-guide.md);
re-render via QuickTime + `bash demos/_postprocess.sh`.
