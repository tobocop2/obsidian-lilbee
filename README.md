# lilbee for Obsidian — local-first RAG with click-to-source citations

[Project site](https://tobocop2.github.io/obsidian-lilbee/) · [Releases](https://github.com/tobocop2/obsidian-lilbee/releases) · [lilbee engine](https://github.com/tobocop2/lilbee)

Local-first RAG for your Obsidian vault. Chat with your notes, PDFs, code, and 150+ formats — and verify every answer at the source. Every citation in chat or wiki opens a Source Preview that scrolls to the exact passage in the original document. Private, offline, self-hosted.

[![CI](https://github.com/tobocop2/obsidian-lilbee/actions/workflows/ci.yml/badge.svg)](https://github.com/tobocop2/obsidian-lilbee/actions/workflows/ci.yml)
[![Coverage](https://tobocop2.github.io/obsidian-lilbee/coverage/badge.svg)](https://tobocop2.github.io/obsidian-lilbee/coverage/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
![Platforms](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey.svg)
[![Obsidian](https://img.shields.io/badge/Obsidian-Plugin-7c3aed?logo=obsidian&logoColor=white)](https://obsidian.md)

> ## ⚠️ Beta software
>
> The plugin is in **active beta**. Installation goes through [BRAT](https://github.com/TfTHacker/obsidian42-brat) so you always get the latest pre-release. Interfaces, settings layout, and on-disk formats may shift between betas. Feedback, bug reports, and issues are very welcome — that's the whole point of the beta.

---

- [Why a local-first RAG plugin for Obsidian](#why-a-local-first-rag-plugin-for-obsidian)
- [Previews](#previews)
- [What you can do with it](#what-you-can-do-with-it)
- [Quick start](#quick-start)
- [Open the chat](#open-the-chat)
- [How it works](#how-it-works)
- [Updating the plugin](#updating-the-plugin)
- [Updating the server](#updating-the-server)
- [Documentation](#documentation)

---

## Why a local-first RAG plugin for Obsidian

Local AI tools have gotten great at getting you to a chat window fast. The first evening with a local model is genuinely fun. What makes it more than a novelty is grounding: the model needs context from your notes, your files, your codebase. Without that, the local AI tool runs out of places to go.

Local AI can be made more substantial than a chatbot. A vault is already a curated set of documents — notes you've taken, PDFs you've collected, scans you've filed away — and that's exactly the corpus a real local search engine wants. lilbee for Obsidian pairs your vault with the [lilbee](https://github.com/tobocop2/lilbee) search engine, so a local model can reason over your own library and answer with citations you can click back to the source.

**The verification loop is one click.** When the answer matters and you want to read what the model read, every citation in chat or wiki opens a **Source Preview** that scrolls to the exact passage in the original document, with the surrounding paragraphs visible. No "open the file, find the page, scroll to the line."

An [Encarta 99](https://en.wikipedia.org/wiki/Encarta) you build for yourself, from your own vault, shaped to your needs.

## Previews

> Real recordings coming soon. Previews below give the shape of each screen.

**Chat sidebar.** Streaming replies with `[¹]` citations. Click a citation to open the source preview.

```
 ┌─ Chat ────────────────────────────────────┐
 │ [💬 qwen3:8b ▾] [🗄 nomic-embed ▾]         │
 │ [OCR] [All|Wiki|Raw]       [💾] [Clear]    │
 │──────────────────────────────────────────│
 │                                            │
 │ You:  what does the oil pressure warning   │
 │       mean?                                │
 │                                            │
 │ ▸ thinking...                              │
 │                                            │
 │ Lilbee: The oil pressure warning indicates │
 │         low oil pressure.[¹] When the      │
 │         light stays on, stop the engine    │
 │         immediately.[²]                    │
 │         ────────────────────────────────   │
 │         Sources                            │
 │         [¹ owners-manual.pdf:42] ← preview │
 │         [² owners-manual.pdf:43]           │
 │                                            │
 │──────────────────────────────────────────│
 │ [📎] Ask anything...              [Send]   │
 └────────────────────────────────────────────┘
```

**Source preview.** Opens when you click any `[¹]` citation in chat or wiki. Scrolls to the exact chunk and highlights the cited lines.

```
 ┌─ Source preview ──────────────────────────────────┐
 │ owners-manual.pdf · chunk 42 of 188     [Close ×] │
 │───────────────────────────────────────────────────│
 │ ...                                               │
 │ Engine warnings                                   │
 │                                                   │
 │ ▌The oil pressure warning indicates low oil      ▐│
 │ ▌pressure. When the light stays on, stop the     ▐│
 │ ▌engine immediately and check the oil level.     ▐│
 │                                                   │
 │ If the warning persists after a top-up, do not    │
 │ continue driving — call for service.              │
 │ ...                                               │
 │                                                   │
 │              [Open document]  [Copy link]         │
 └───────────────────────────────────────────────────┘
```

**Model Catalog.** Browse, search, and install models without leaving Obsidian. Featured picks for each role; full HuggingFace catalog one toggle away. `★` marks the developer's recommendation.

```
 ┌─ Model Catalog ─────────────────────────┐
 │ [All tasks ▾] [All sizes ▾] [Featured ▾]│
 │ 🔍 search...                 [Grid|List]│
 │                                          │
 │ Our picks                                │
 │ ┌────────────┐ ┌────────────┐           │
 │ │ Qwen3 8B ★ │ │ Nomic      │           │
 │ │ ▌chat▐     │ │ ▌embed▐    │           │
 │ │ [GGUF]     │ │ [GGUF]     │           │
 │ │ 4.9 GB  ✓  │ │ 274 MB     │           │
 │ │ [Use]      │ │ [Pull]     │           │
 │ └────────────┘ └────────────┘           │
 │                                          │
 │            [Load more]                   │
 └──────────────────────────────────────────┘
```

**Task Center.** Every background job (sync, crawl, wiki build, model pull) in one place. Per-type concurrent queues with a global cap.

```
 ┌─ Task Center ───────── [cap 3/3] [Clear]┐
 │ ACTIVE (2)                               │
 │   ████████████░░░░░░░░  42%  PULL  qwen3 │
 │   ██████░░░░░░░░░░░░░░  18%  SYNC  vault │
 │ QUEUED (1)                               │
 │   CRAWL  https://docs.example.com        │
 │ COMPLETED                                │
 │   ✓ SYNC  vault              2 min ago  │
 │   ✗ PULL  mistral            5 min ago  │
 └──────────────────────────────────────────┘
```

**Wiki sidebar.** Auto-generated concept and entity pages, drafts queue, citation footnotes that open the source preview.

```
 ┌─ Wiki ───────────────────────────────────┐
 │ 🔍 Filter pages...                        │
 │                                           │
 │ Summaries (12)                            │
 │   Oil System Overview          3 src     │
 │ Concepts (8)                              │
 │   Maintenance Schedule         5 src     │
 │ Drafts (2)                                │
 │   Tire Pressure                1 src     │
 │─────────────────────────────────────────│
 │ ┌─ Oil System Overview ─────────────────┐│
 │ │ 3 sources · faithfulness 0.92         ││
 │ │                                        ││
 │ │ The oil system uses a wet-sump         ││
 │ │ design with a capacity of 5 quarts     ││
 │ │ including filter.[¹]                   ││
 │ │                                        ││
 │ │ [¹ owners-manual.pdf:42]  ← preview   ││
 │ └────────────────────────────────────────┘│
 └──────────────────────────────────────────┘
```

**Setup wizard.** 7-step guided onboarding on first launch. Re-runnable from the command palette.

```
 ●──○──○──○──○──○──○
 1  2  3  4  5  6  7

 1  Welcome
 2  Server mode      → Managed or External (URL + health)
 3  Chat model       → Featured grid, RAM-based pick
 4  Embedding model  → Featured grid (or keep current)
 5  Initial sync     → SSE progress bar
 6  Wiki (optional)  → Pros/cons, recommend skipping
 7  Done             → Summary + tips + [Open chat]
```

## What you can do with it

### A personal encyclopedia of your vault

Point lilbee at your vault and it indexes every note, PDF, ebook, and code file into a searchable archive with citations that click back to the source line. The same pattern works for any vault you've curated: a medical textbook collection, a guitar theory library, a field's research papers, a car's service manuals, your company's internal wiki. Whatever corpus your vault holds becomes a searchable, talkable version of exactly what you have.

### Verify every answer at the source

Every citation in a chat reply or wiki page is a live link. Click it and a Source Preview modal opens scrolled to the exact passage in the source document, with the surrounding paragraphs visible and the cited lines highlighted. From there you can open the full document or copy a deep link back to the citation.

This matters for the things you'd actually want a private knowledge base for — medical references, legal documents, manuals, internal docs. A confident-sounding answer with a footnote is only as good as the footnote. Treating verification as a one-click action, not a separate workflow, is the difference between trusting the system and double-checking everything by hand.

### An auto-generated wiki of your knowledge

The plugin reads everything you've indexed and writes a wiki about it. Pages compound across sources instead of being one-per-document, so concepts and entities that show up repeatedly get their own page with citations from every source that mentions them. Pages live in a configurable vault folder (default `lilbee/`) as ordinary markdown with `[[wiki links]]`, so Obsidian's graph view picks them up.

Every section is citation-verified against the source chunks and scored for embedding faithfulness before publish. Low-confidence pages land in a drafts queue with a review modal — accept, reject, or edit them inline. A lint command surfaces stale or broken citations grouped by page.

### Documents, code, and scanned images

Your vault is full of more than markdown. lilbee indexes PDFs, Office files (`.docx`, `.xlsx`, `.pptx`), ebooks (`.epub`), CSV / TSV / JSON / YAML, and 150+ programming languages. Prose goes through [Kreuzberg](https://github.com/Goldziher/kreuzberg)'s heading-aware extraction so each chunk keeps its section context. Code goes through [tree-sitter](https://tree-sitter.github.io/tree-sitter/)'s AST-aware splitter, so chunks map to real functions, classes, and modules instead of arbitrary line ranges.

Scanned PDFs and photographed pages go through OCR — Tesseract for plain text, or a local GGUF vision model that preserves tables and layout as markdown. OCR is a per-vault toggle in Settings.

### Pick and tune your models

Chat, embedding, vision, and reranker are four separate roles, each picked and managed independently. The Model Catalog (`Open model catalog` from the command palette, or the toolbar dropdown in chat) lets you browse featured picks or search the full HuggingFace catalog, see size and RAM requirements before pulling, and confirm before downloading. Pulls run through the Task Center with progress and cancel.

Retrieval and generation are deeply tunable from Settings: chunk size and overlap, search strictness, query rewriting on/off, reranker pass with a configurable candidate count, and per-knob reset-to-default. Search & Retrieval, Generation, Sync, Crawling, Wiki, and Advanced are all separate sections with a filter on top.

### Local-first, frontier-capable

By default everything stays on your machine — server, models, index, vault. For roles where a frontier model genuinely helps (sometimes vision OCR, sometimes long-context summarization), Settings → Advanced lets you key in OpenAI, Anthropic, Gemini, or any LiteLLM-compatible endpoint and use it for that role only, while keeping the rest local. The plugin shows a persistent indicator whenever a cloud model is the active chat or vision backend so it's clear when chunks are leaving the machine.

## Quick start

1. Install **[BRAT](https://github.com/TfTHacker/obsidian42-brat)** in Obsidian (Settings → Community plugins → Browse → search "BRAT" → Install → Enable).
2. Open the command palette (`Cmd/Ctrl + P`) → **BRAT: Plugins: Add a beta plugin for testing** → paste `tobocop2/obsidian-lilbee` → **Add Plugin**.
3. Enable **lilbee** in Settings → Community plugins.
4. The Setup Wizard auto-launches. Pick a chat model and an embedding model from the featured grid, then run the initial sync.

The plugin downloads and manages the [lilbee](https://github.com/tobocop2/lilbee) server automatically — nothing to install separately. The first launch fetches the right version for your platform and verifies it before starting. Wait for the status bar to show `lilbee: ready`, then open the chat.

> **Hardware note:** the server runs on your CPU or GPU. A Mac with Apple Silicon (M1+) or a PC with an NVIDIA / AMD / Intel Arc GPU gives the best performance. 8 GB of RAM is the minimum; 16–32 GB is recommended. See [lilbee's hardware requirements](https://github.com/tobocop2/lilbee#hardware-requirements) for the full table.

### Open the chat

Once the status bar shows **lilbee: ready**:

| Platform | How to open chat |
|----------|-----------------|
| **macOS** | `Cmd + P` → type **lilbee: Open chat** → Enter |
| **Windows / Linux** | `Ctrl + P` → type **lilbee: Open chat** → Enter |

The chat panel opens in the sidebar. From there you can ask questions, attach individual files, or run **Sync vault** (`Cmd/Ctrl + P` → "lilbee: Sync vault") to index everything at once.

## How it works

The plugin runs [lilbee](https://github.com/tobocop2/lilbee) in the background for you — on first launch it downloads the right version for your platform, starts it automatically, and shuts it down when you close Obsidian. Your vault is the corpus. lilbee handles indexing, retrieval, generation, and the wiki; the plugin is the interface on top.

Everything stays on your machine. The server, the models, the index, and your vault all live locally. Like all Obsidian plugins, lilbee is installed per vault — each vault runs its own server instance with its own index, so there's no shared global store. If you'd rather run your own lilbee server (on a different machine, in a container, or on a port you control), point the plugin at it from Settings → Connection.

> **macOS users:** the server binary is unsigned (Apple charges [$99/year](https://developer.apple.com/support/enrollment/) for signing). The plugin clears the quarantine flag automatically. If macOS still blocks it, go to System Settings → Privacy & Security and click **Allow Anyway**. See the [lilbee source](https://github.com/tobocop2/lilbee) if you want to audit the build.

## Updating the plugin

Settings → BRAT → Beta Plugin List → click the edit (pencil) icon next to lilbee → change the version to the latest release tag. BRAT downloads the new version. **Restart Obsidian** after the update for the new version to take effect.

## Updating the server

The plugin tracks the installed lilbee server version. Go to Settings → lilbee → **Check for updates**. If a newer release is available the button changes to **Update to vX.Y.Z** — one click stops the running server, downloads the new version, verifies it, and restarts.

## Documentation

See **[Usage Guide](docs/usage.md)** for the full reference — every command, every setting, the chat toolbar, supported formats, troubleshooting, and advanced configuration. For the underlying engine — what it indexes, how retrieval works, model formats, hardware requirements — see [lilbee](https://github.com/tobocop2/lilbee).

## License

MIT
