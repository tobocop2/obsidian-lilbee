# lilbee for Obsidian

> **Work in progress** — the first release is coming soon. The plugin is not usable yet.

Talk to your vault. Ask questions about your notes, PDFs, code, spreadsheets, and images — and get answers grounded in what you've actually written, with source citations. Save conversations back to your vault as markdown. Everything runs locally on your machine via [Ollama](https://ollama.com), so your documents never leave your computer.

## Demo

<details>
<summary><b>Scanned PDF → vision OCR → chat</b> (click to expand)</summary>

Attaching a scanned 1998 Star Wars: X-Wing Collector's Edition manual (PDF with no extractable text), indexing it with vision OCR, and chatting about the dev team credits — entirely local.

> Recording sped up 5.5x. Real time ~4 min on M1 Pro / 32 GB. Most time is vision OCR.

![Obsidian chat demo](demos/obsidian-chat.gif)
</details>

---

## What you can do

- **Chat with your vault** — ask questions and get answers from your actual notes, with sources you can click through to
- **Attach anything** — drop PDFs, code files, images, or folders into a conversation to talk about them
- **Search by meaning** — find content by what it's about, not just keywords, with live results as you type
- **Quick answers** — ask a one-off question and get a synthesized answer with sources
- **Save conversations** — export any chat to your vault as markdown
- **Scan images and PDFs** — OCR extracts text from scanned documents so you can chat about them too
- **Stay in control** — stop generation mid-stream, cancel syncs, switch models on the fly
- **Fully local** — everything runs on your machine. Nothing is sent to the cloud.

## Prerequisites

1. **[Ollama](https://ollama.com)** — local LLM runtime (embedding model auto-pulled on first sync)
2. **[lilbee](https://github.com/tobocop2/lilbee)** — `pip install lilbee` or `uv tool install lilbee`

## Quick start

1. Start Ollama (`ollama serve`)
2. Initialize and start lilbee in your vault:
   ```bash
   cd /path/to/your/vault
   lilbee init && lilbee serve
   ```
3. Copy `main.js`, `manifest.json`, `styles.css` into `.obsidian/plugins/lilbee/`
4. Enable "lilbee" in Settings → Community plugins
5. **Sync vault** from the command palette to index your documents
6. **Open chat** and start talking to your vault

## Commands

All commands available via `Ctrl/Cmd + P` → "lilbee":

| Command | Description |
|---------|-------------|
| Search knowledge base | Semantic search with live results |
| Ask a question | Single answer with source citations |
| Open chat | Multi-turn chat sidebar |
| Sync vault | Index new/changed files, remove deleted |
| Add current file | Index the active file |
| Add current folder | Index all files in the active folder |
| Show status | Document and chunk counts |

Right-click any file or folder in the file explorer to **Add to lilbee** from the context menu.

## Chat

The chat sidebar is where most of the action happens:

- **Streaming responses** with full markdown rendering and expandable source citations
- **Attach files** — drag in PDFs, code, images, or whole folders to talk about them
- **Save to vault** — export the conversation as a markdown file in your vault
- **Stop generation** mid-stream if the answer is going off track
- **Model selectors** — switch chat and vision models without leaving the conversation
- **Connection indicator** — green when connected, red when the server is unreachable
- **Inline progress** for sync/indexing with cancel support

## Settings

Settings → Community plugins → lilbee:

| Section | Settings |
|---------|----------|
| **Connection** | Server URL, Ollama URL (both with Test button) |
| **Models** | Chat and vision model dropdowns with curated catalog, pull/delete, auto-pull with progress |
| **General** | Results count (1–20) |
| **Sync** | Manual or auto mode (with configurable debounce) |
| **Advanced** | Temperature, top_p, top_k, repeat_penalty, context length, seed — defaults loaded live from the active model |

## Supported formats

Text extraction powered by [Kreuzberg](https://github.com/Goldziher/kreuzberg), code chunking by [tree-sitter](https://tree-sitter.github.io/tree-sitter/). This list is not exhaustive — Kreuzberg supports additional formats beyond what's listed here.

| Format | Extensions |
|--------|-----------|
| PDF | `.pdf` (embedded text + OCR fallback for scanned pages) |
| Office | `.docx`, `.xlsx`, `.pptx` |
| eBook | `.epub` |
| Images | `.png`, `.jpg`, `.jpeg`, `.tiff`, `.bmp`, `.webp` (requires vision model) |
| Data | `.csv`, `.tsv`, `.xml`, `.json`, `.jsonl`, `.yaml`, `.yml` |
| Text | `.md`, `.txt`, `.html`, `.rst` |
| Code | `.py`, `.js`, `.ts`, `.go`, `.rs`, `.java`, and [150+ more](https://github.com/Goldziher/tree-sitter-language-pack) |

## Build your own integration

lilbee is local-first, but the REST API it exposes is not tied to any specific model. The search endpoint returns relevant document chunks without calling a language model — so if you'd rather use a frontier model like ChatGPT or Claude instead of a local one, you can. Index your documents with lilbee, query the search API, and feed the results into whatever LLM you prefer.

This plugin is a full working example of a client built on that API. Use it as a reference if you want to build your own.

See the [lilbee README](https://github.com/tobocop2/lilbee) for more on the API.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Red connection dot | Start the server: `lilbee serve` in your vault directory |
| No search results | Run **Sync vault** to index your documents |
| Sync fails | Ensure Ollama is running — sync needs the embedding model |

[Open an issue](https://github.com/tobocop2/obsidian-lilbee/issues) for bugs or feature requests.

## License

MIT
