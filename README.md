<p align="center">
  <a href="https://obsidian.lilbee.sh/">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="docs/obsidian-lilbee-logo-dark.svg">
      <img alt="lilbee for Obsidian" src="docs/obsidian-lilbee-logo-light.svg" width="360">
    </picture>
  </a>
</p>

<p align="center"><strong>A local search engine for your vault, inside Obsidian.</strong></p>

<p align="center"><a href="https://obsidian.lilbee.sh/">Project site</a> &nbsp;·&nbsp; <a href="https://obsidian.lilbee.sh/tutorial">Tutorial reel</a> &nbsp;·&nbsp; <a href="https://github.com/tobocop2/obsidian-lilbee/releases">Releases</a> &nbsp;·&nbsp; <a href="https://lilbee.sh/">lilbee engine</a></p>

This plugin runs **[lilbee](https://lilbee.sh/)** against your vault and gives you chat, an auto-generated wiki, click-to-source citations, and a model catalog, all inside Obsidian. It downloads and manages the lilbee server for you; nothing to install separately. Everything runs on your computer; cloud models are opt-in, per role.

[![CI](https://github.com/tobocop2/obsidian-lilbee/actions/workflows/ci.yml/badge.svg)](https://github.com/tobocop2/obsidian-lilbee/actions/workflows/ci.yml)
[![Coverage](https://obsidian.lilbee.sh/coverage/badge.svg)](https://obsidian.lilbee.sh/coverage/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
![Platforms](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey.svg)
[![Obsidian](https://img.shields.io/badge/Obsidian-Plugin-7c3aed?logo=obsidian&logoColor=white)](https://obsidian.md)

Ask a question in plain English and lilbee answers from your vault, with citations that click straight back to the source line.

<p align="center"><img alt="index the lilbee README, ask what lilbee is, and get a cited answer with a click-to-open source" src="https://raw.githubusercontent.com/tobocop2/obsidian-lilbee/gh-pages/demos/what_is_lilbee.gif" width="640"></p>

> **Tutorial reel:** every recording on this page (and a few extras) as videos with longer notes at [**obsidian.lilbee.sh/tutorial**](https://obsidian.lilbee.sh/tutorial).

> ## ⚠️ Beta software
>
> The plugin is in **active beta**. Installation goes through [BRAT](https://github.com/TfTHacker/obsidian42-brat) so you always get the latest pre-release. Interfaces, settings layout, and on-disk formats may shift between betas. Feedback, bug reports, and issues are very welcome; that's the whole point of the beta.

> **Heads up: this downloads to your computer.** lilbee is a local search engine with its own models, so the plugin fetches the lilbee server (a few hundred MB) on first launch and the models you pick from the catalog (a few hundred MB up to several GB each) when you choose them. It's all stored locally and runs on your machine.

---

- [Highlights](#highlights)
- [Tutorial reel](https://obsidian.lilbee.sh/tutorial) (long-form videos)
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
- **Verify in one click.** Every citation opens a Source Preview scrolled to the exact spot: surrounding paragraphs visible, cited lines highlighted.
- **Reads more than markdown.** PDFs, Office files, ebooks, CSV / TSV / JSON / YAML, 150+ programming languages, plus OCR for scans and photographed pages.
- **Your models, your machine.** Browse a built-in model catalog straight from Hugging Face Hub, pull one with a click, run it locally. No account needed.
- **Already on Ollama or LM Studio? Keep them.** lilbee manages models for you by default, but it also works with both, so you never have to switch model managers. Their models appear in the same pickers, alongside lilbee's own.
- **Runs on your computer.** Server, models, index, and vault all stay local; cloud models are opt-in per role, with a persistent indicator when one is active.
- **An auto-generated wiki** *(experimental)*: linked markdown pages written from what you've indexed, citation-checked before publish, landing in your vault's graph alongside your own notes.

## Why a local search engine for Obsidian

A vault is already a curated set of documents: notes you've taken, PDFs you've collected, scans you've filed away. That's exactly what a local search engine wants. This plugin points lilbee at your vault so a local model can reason over your library and answer with citations you click straight back to the source.

An [Encarta 99](https://en.wikipedia.org/wiki/Encarta) you build for yourself, from your own vault, shaped to your needs.

<p align="center"><img alt="a sweep through the lilbee surfaces inside Obsidian: model catalog, settings, command palette" src="https://raw.githubusercontent.com/tobocop2/obsidian-lilbee/gh-pages/demos/tour.gif" width="640"></p>

## What you can do with it

### A library of your vault

Point lilbee at your vault and it builds a searchable library from every note, PDF, ebook, and code file. The pattern works for any vault you've curated, a medical-textbook collection, a field's research papers, a company wiki: whatever it holds becomes searchable, and you can talk to it.

Add a single file from the right-click menu or the command palette, or run **Sync vault** to index everything at once. Background jobs (sync, crawl, wiki build, model downloads) run in a **Task Center**, so you can keep asking questions while they work.

<p align="center"><img alt="add a PDF and a README from the palette, watch the Task Center index them, then ask a cited question" src="https://raw.githubusercontent.com/tobocop2/obsidian-lilbee/gh-pages/demos/add.gif" width="640"></p>

### Verify every answer at the source

Every citation in a chat reply or wiki page is a live link. Click it and a Source Preview opens, scrolled to the exact spot, surrounding paragraphs visible and cited lines highlighted; from there, open the full document or copy a deep link back. A confident answer with a footnote is only as good as the footnote, so the check is one click instead of a separate chore.

This works for web pages too: crawl a docs site or a Wikipedia page into your vault, then search or chat with that copy offline, with citations back to the source.

<p align="center"><img alt="crawl a Wikipedia page into the vault, ask a cited question, and jump to the cited section" src="https://raw.githubusercontent.com/tobocop2/obsidian-lilbee/gh-pages/demos/crawl.gif" width="640"></p>

### Pick and tune your models

Chat, embedding, vision, and reranking are separate roles, each with its own model. The Model Catalog (command palette or chat toolbar) browses featured picks or searches Hugging Face Hub, shows each model's size and memory before you pull, and flags ones that won't run on your hardware. Defaults are sensible out of the gate; Settings exposes the retrieval and generation knobs when you want to go deeper, each with a reset.

<p align="center"><img alt="browse the model catalog inside Obsidian: Chat, Embed, Vision, Rerank tabs, search Hugging Face Hub" src="https://raw.githubusercontent.com/tobocop2/obsidian-lilbee/gh-pages/demos/catalog.gif" width="640"></p>

### Already running Ollama or LM Studio? Keep them.

**lilbee now works with [Ollama](https://ollama.com/) and [LM Studio](https://lmstudio.ai/).** Managing models for you is the default and the simplest path: lilbee downloads, runs, and updates them itself, no second app to think about. But you don't have to switch model managers to use lilbee.

If your models already live in Ollama or LM Studio, point lilbee at the running server and they show up right in the same Chat / Embed / Vision / Rerank pickers, next to lilbee's own models and any cloud models, each labeled by where it runs. You keep managing them in the app you already use; lilbee just uses them. Pick whichever fits how you already work, and mix all three freely.

### Documents, code, and scanned images

Your vault is full of more than markdown. lilbee handles the rest:

- **Prose and structured files** (PDFs, Word / Excel / PowerPoint, ebooks, CSV / JSON / YAML) are split so each chunk keeps its section context.
- **Code** (150+ languages) is split along real functions and classes, not arbitrary line ranges.
- **Scanned PDFs and photographed pages** are read with OCR, including a local vision model that keeps tables and layout intact. (A per-vault toggle in Settings.)

<p align="center"><img alt="a scanned, image-only PDF read by a local vision model: the Task Center streams OCR page by page, then a cited answer reads the support number and publisher straight off the scanned cover" src="https://raw.githubusercontent.com/tobocop2/obsidian-lilbee/gh-pages/demos/vision.gif" width="640"></p>

### Cloud models, when you want them

By default everything stays on your machine: server, models, index, vault. For a role where a cloud model genuinely helps (vision OCR, long-context summarization), Settings → Advanced lets you key in an API endpoint for that role only while the rest stay local. A persistent indicator shows whenever a cloud model is the active backend, so it's clear when chunks are leaving the machine.

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

<p align="center"><img alt="first run on a fresh vault: install lilbee through BRAT, walk the setup wizard, and ask a question that gets a cited answer from your notes" src="https://raw.githubusercontent.com/tobocop2/obsidian-lilbee/gh-pages/demos/first_start.gif" width="640"></p>

> **Hardware note:** the server runs on your CPU or GPU. A Mac with Apple Silicon (M1+) or a PC with an NVIDIA / AMD / Intel Arc GPU gives the best performance. 8 GB of RAM is the minimum; 16 to 32 GB is recommended. See [lilbee's hardware requirements](https://github.com/tobocop2/lilbee#hardware-requirements) for the full table.

### Open the chat

Once the status bar shows **lilbee: ready**:

| Platform | How to open chat |
|----------|-----------------|
| **macOS** | `Cmd + P` → type **lilbee: Open chat** → Enter |
| **Windows / Linux** | `Ctrl + P` → type **lilbee: Open chat** → Enter |

The chat panel opens in the sidebar. From there you can ask questions, attach individual files, or run **Sync vault** (`Cmd/Ctrl + P` → "lilbee: Sync vault") to index everything at once. Every lilbee surface, the model catalog, the Task Center, chat, is reachable from the command palette.

## How it works

The plugin runs [lilbee](https://lilbee.sh/) in the background: on first launch it downloads the right version for your platform, starts it, and shuts it down when you close Obsidian. Your vault is what it searches; lilbee handles indexing, retrieval, generation, and the wiki, and the plugin is the interface on top.

Vaults on the same computer share one lilbee install and one model cache, so downloaded models are reused instead of fetched again, while each vault keeps its own isolated index.

**One vault at a time.** lilbee follows whichever vault you have open, re-targeting automatically when you switch, and each vault's index is saved and restored when you reopen it. (Advanced users can point the plugin at their own lilbee server from Settings → Connection.)

> **macOS users:** the server binary is unsigned (Apple charges [$99/year](https://developer.apple.com/support/enrollment/) for signing). The plugin clears the quarantine flag automatically. If macOS still blocks it, go to System Settings → Privacy & Security and click **Allow Anyway**. See the [lilbee source](https://github.com/tobocop2/lilbee) if you want to audit the build.

## Updating the plugin

Settings → BRAT → Beta Plugin List → click the edit (pencil) icon next to lilbee → change the version to the latest release tag. BRAT downloads the new version. **Restart Obsidian** after the update for the new version to take effect.

## Updating the server

The plugin tracks the installed lilbee server version. Go to Settings → lilbee → **Check for updates**. If a newer release is available the button changes to **Update to vX.Y.Z**: one click stops the running server, downloads the new version, verifies it, and restarts.

## Documentation

See **[Usage Guide](docs/usage.md)** for the full reference: every command, every setting, the chat toolbar, supported formats, troubleshooting, and advanced configuration. For the underlying engine (what it indexes, how retrieval works, model formats, hardware requirements), see [lilbee](https://lilbee.sh/).

## License

MIT
