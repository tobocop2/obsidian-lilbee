# [lilbee for Obsidian](https://obsidian.lilbee.sh/)

A local search engine for your vault, inside Obsidian.

[Project site](https://obsidian.lilbee.sh/) · [Demo reel](https://obsidian.lilbee.sh/reel) · [Releases](https://github.com/tobocop2/obsidian-lilbee/releases) · [lilbee engine](https://lilbee.sh/)

This plugin runs **[lilbee](https://lilbee.sh/)** against your vault and gives you chat, an auto-generated wiki, click-to-source citations, and a model catalog, all inside Obsidian. It bundles the lilbee server and manages it for you; nothing to install separately. Everything runs on your computer; cloud models are opt-in, per role.

[![CI](https://github.com/tobocop2/obsidian-lilbee/actions/workflows/ci.yml/badge.svg)](https://github.com/tobocop2/obsidian-lilbee/actions/workflows/ci.yml)
[![Coverage](https://obsidian.lilbee.sh/coverage/badge.svg)](https://obsidian.lilbee.sh/coverage/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
![Platforms](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey.svg)
[![Obsidian](https://img.shields.io/badge/Obsidian-Plugin-7c3aed?logo=obsidian&logoColor=white)](https://obsidian.md)

Ask a question in plain English and lilbee answers from your vault, with citations that click straight back to the source line.

![index the lilbee README, ask what lilbee is, and get a cited answer with a click-to-open source](https://raw.githubusercontent.com/tobocop2/obsidian-lilbee/gh-pages/demos/what_is_lilbee.gif)

> **Demo reel:** every recording on this page (and a few extras) as videos with longer notes at [**obsidian.lilbee.sh/reel**](https://obsidian.lilbee.sh/reel).

> ## ⚠️ Beta software
>
> The plugin is in **active beta**. Installation goes through [BRAT](https://github.com/TfTHacker/obsidian42-brat) so you always get the latest pre-release. Interfaces, settings layout, and on-disk formats may shift between betas. Feedback, bug reports, and issues are very welcome; that's the whole point of the beta.

---

- [Highlights](#highlights)
- [Demo reel](https://obsidian.lilbee.sh/reel) (long-form videos)
- [Why a local search engine for Obsidian](#why-a-local-search-engine-for-obsidian)
- [What you can do with it](#what-you-can-do-with-it)
- [Quick start](#quick-start)
- [Open the chat](#open-the-chat)
- [How it works](#how-it-works)
- [Updating the plugin](#updating-the-plugin)
- [Updating the server](#updating-the-server)
- [Documentation](#documentation)

---

## Highlights

- **Ask your vault in plain English.** Type a question; get an answer with citations that click straight back to the source line.
- **Verify in one click.** Every citation opens a Source Preview scrolled to the exact passage: surrounding paragraphs visible, cited lines highlighted.
- **Reads more than markdown.** PDFs, Office files, ebooks, CSV / TSV / JSON / YAML, 150+ programming languages, plus OCR for scans and photographed pages.
- **Your models, your machine.** Browse a built-in model catalog straight from Hugging Face Hub, pull one with a click, run it locally. No account needed.
- **Runs on your computer.** Server, models, index, and vault all stay local; cloud models are opt-in per role, with a persistent indicator when one is active.
- **An auto-generated wiki** *(experimental)*: linked markdown pages written from what you've indexed, citation-checked before publish, landing in your vault's graph alongside your own notes.

## Why a local search engine for Obsidian

A vault is already a curated set of documents: notes you've taken, PDFs you've collected, scans you've filed away. That's exactly the corpus a local search engine wants. This plugin runs lilbee against your vault so a local model can reason over your own library and answer with citations you can click back to the source. lilbee itself is a terminal-first search engine that ships a TUI, an MCP server, a REST API, and a Python library; the plugin is the Obsidian frontend, sharing the same index, the same models, the same wiki.

**The verification loop is one click.** When the answer matters and you want to read what the model read, every citation in chat or wiki opens a **Source Preview** that scrolls to the exact passage in the original document, with the surrounding paragraphs visible. No "open the file, find the page, scroll to the line."

An [Encarta 99](https://en.wikipedia.org/wiki/Encarta) you build for yourself, from your own vault, shaped to your needs.

![a sweep through the lilbee surfaces inside Obsidian: model catalog, settings, command palette](https://raw.githubusercontent.com/tobocop2/obsidian-lilbee/gh-pages/demos/tour.gif)

## What you can do with it

### A library of your vault

Point lilbee at your vault and it builds a searchable library from every note, PDF, ebook, and code file, with citations that click back to the source line. The pattern works for any vault you've curated: a medical-textbook collection, a field's research papers, a car's service manuals, your company's internal wiki. Whatever your vault holds becomes searchable, and you can talk to it.

Add a single file from the right-click menu or the command palette, or run **Sync vault** to index everything at once. Background jobs (sync, crawl, wiki build, model pull) run through a **Task Center** with per-type concurrent queues and a global cap; ask questions while it works.

![add a PDF and a README from the palette, watch the Task Center index them, then ask a cited question](https://raw.githubusercontent.com/tobocop2/obsidian-lilbee/gh-pages/demos/add.gif)

### Verify every answer at the source

Every citation in a chat reply or wiki page is a live link. Click it and a Source Preview opens, scrolled to the exact passage in the source document, surrounding paragraphs visible, cited lines highlighted. From there you can open the full document or copy a deep link back to the citation. A confident-sounding answer with a footnote is only as good as the footnote; making the check one click instead of a separate chore is the difference between trusting the system and re-reading everything by hand.

This works for crawled web pages too: install the `[crawler]` extra (bundled with the managed server), crawl a docs site or a Wikipedia page into your vault, and search or chat with that copy offline, with citations back to the rendered source.

![crawl a Wikipedia page into the vault, ask a cited question, and jump to the cited section](https://raw.githubusercontent.com/tobocop2/obsidian-lilbee/gh-pages/demos/crawl.gif)

### Pick and tune your models

Chat, embedding, vision, and reranker are four separate roles, each picked independently. The Model Catalog (`Open model catalog` from the command palette, or the chat toolbar dropdown) browses featured picks or searches Hugging Face Hub, shows size and RAM before you pull, flags models the bundled engine can't run, and confirms before downloading; pulls run through the Task Center with progress and cancel. Retrieval and generation are deeply tunable from Settings, 50+ knobs in all: chunk size and overlap, search strictness, query rewriting on/off, a reranker pass with a configurable candidate count, each with reset-to-default. Settings groups them into Search & Retrieval, Generation, Sync, Crawling, Wiki, and Advanced, with a filter on top.

![browse the model catalog inside Obsidian: Chat, Embed, Vision, Rerank tabs, search Hugging Face Hub](https://raw.githubusercontent.com/tobocop2/obsidian-lilbee/gh-pages/demos/catalog.gif)

### Documents, code, and scanned images

Your vault is full of more than markdown. lilbee handles the rest:

- **Prose and structured files** (PDFs, `.docx` / `.xlsx` / `.pptx`, `.epub`, CSV / TSV / JSON / YAML) go through [Kreuzberg](https://github.com/Goldziher/kreuzberg)'s heading-aware extraction, so each chunk keeps its section context.
- **Code** (150+ languages) goes through [tree-sitter](https://tree-sitter.github.io/tree-sitter/)'s AST-aware splitter, so chunks map to real functions, classes, and modules instead of arbitrary line ranges.
- **Scanned PDFs and photographed pages** go through OCR: Tesseract for plain text, or a local GGUF vision model that keeps tables and layout as markdown. (A per-vault toggle in Settings.)

![a scanned, image-only PDF read by a local vision model: the Task Center streams OCR page by page, then a cited answer reads the support number and publisher straight off the scanned cover](https://raw.githubusercontent.com/tobocop2/obsidian-lilbee/gh-pages/demos/vision.gif)

### Cloud models, when you want them

By default everything stays on your machine: server, models, index, vault. For a role where a cloud model genuinely helps (sometimes vision OCR, sometimes long-context summarization), Settings → Advanced lets you key in an API endpoint and use it for that role only, while the rest stay local. The plugin shows a persistent indicator whenever a cloud model is the active chat or vision backend, so it's clear when chunks are leaving the machine.

## Experimental

<details>
<summary><strong>Auto-generated wiki</strong> — linked markdown pages written from what you've indexed</summary>

The plugin reads everything you've indexed and writes a wiki about it. Pages compound across sources instead of one-per-document, so concepts and entities that recur get their own page with citations from every source that mentions them. They live in a configurable vault folder (default `lilbee/`) as ordinary markdown with `[[wiki links]]`, so Obsidian's graph view picks them up. Every section is citation-verified and scored for embedding faithfulness before publish; low-confidence pages land in a drafts queue with a review modal (accept, reject, or edit inline), and a lint command surfaces stale or broken citations by page.

</details>

## Quick start

1. Install **[BRAT](https://github.com/TfTHacker/obsidian42-brat)** in Obsidian (Settings → Community plugins → Browse → search "BRAT" → Install → Enable).
2. Open the command palette (`Cmd/Ctrl + P`) → **BRAT: Plugins: Add a beta plugin for testing** → paste `tobocop2/obsidian-lilbee` → **Add Plugin**.
3. Enable **lilbee** in Settings → Community plugins.
4. The Setup Wizard auto-launches. Pick a chat model and an embedding model from the featured grid, then run the initial sync.

The plugin downloads and manages the [lilbee](https://lilbee.sh/) server automatically; nothing to install separately. The first launch fetches the right version for your platform and verifies it before starting. Wait for the status bar to show `lilbee: ready`, then open the chat.

> **Hardware note:** the server runs on your CPU or GPU. A Mac with Apple Silicon (M1+) or a PC with an NVIDIA / AMD / Intel Arc GPU gives the best performance. 8 GB of RAM is the minimum; 16 to 32 GB is recommended. See [lilbee's hardware requirements](https://github.com/tobocop2/lilbee#hardware-requirements) for the full table.

### Open the chat

Once the status bar shows **lilbee: ready**:

| Platform | How to open chat |
|----------|-----------------|
| **macOS** | `Cmd + P` → type **lilbee: Open chat** → Enter |
| **Windows / Linux** | `Ctrl + P` → type **lilbee: Open chat** → Enter |

The chat panel opens in the sidebar. From there you can ask questions, attach individual files, or run **Sync vault** (`Cmd/Ctrl + P` → "lilbee: Sync vault") to index everything at once. Every lilbee surface, the model catalog, the Task Center, chat, is reachable from the command palette.

## How it works

The plugin runs [lilbee](https://lilbee.sh/) in the background for you: on first launch it downloads the right version for your platform, starts it automatically, and shuts it down when you close Obsidian. Your vault is the corpus. lilbee handles indexing, retrieval, generation, and the wiki; the plugin is the interface on top.

Everything stays on your machine. The server, the models, the index, and your vault all live locally. Every Obsidian vault on your computer shares one lilbee binary and one HuggingFace cache under a shared root (`~/Library/Application Support/Lilbee/` on macOS, `~/.local/share/lilbee/` on Linux, `%LOCALAPPDATA%\Lilbee\` on Windows). Each vault keeps its own `vaults/<id>/` subfolder for its index, wiki, and config, so they stay isolated; downloaded models are reused instead of duplicated. The path is configurable from Settings → Connection.

**One vault at a time.** lilbee is a single-vault server, so the managed process follows whichever vault you have open in Obsidian: open a vault and lilbee indexes and answers from it; open a different vault and it re-targets the new one automatically. Each vault's index stays on disk and is restored when you reopen it. If you'd rather run your own lilbee server (on a different machine, in a container, or on a port you control), point the plugin at it from Settings → Connection.

> **macOS users:** the server binary is unsigned (Apple charges [$99/year](https://developer.apple.com/support/enrollment/) for signing). The plugin clears the quarantine flag automatically. If macOS still blocks it, go to System Settings → Privacy & Security and click **Allow Anyway**. See the [lilbee source](https://github.com/tobocop2/lilbee) if you want to audit the build.

## Updating the plugin

Settings → BRAT → Beta Plugin List → click the edit (pencil) icon next to lilbee → change the version to the latest release tag. BRAT downloads the new version. **Restart Obsidian** after the update for the new version to take effect.

## Updating the server

The plugin tracks the installed lilbee server version. Go to Settings → lilbee → **Check for updates**. If a newer release is available the button changes to **Update to vX.Y.Z**: one click stops the running server, downloads the new version, verifies it, and restarts.

## Documentation

See **[Usage Guide](docs/usage.md)** for the full reference: every command, every setting, the chat toolbar, supported formats, troubleshooting, and advanced configuration. For the underlying engine (what it indexes, how retrieval works, model formats, hardware requirements), see [lilbee](https://lilbee.sh/).

## License

MIT
