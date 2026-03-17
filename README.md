# lilbee for Obsidian

[![CI](https://github.com/tobocop2/obsidian-lilbee/actions/workflows/ci.yml/badge.svg)](https://github.com/tobocop2/obsidian-lilbee/actions/workflows/ci.yml)
[![Coverage](https://tobocop2.github.io/obsidian-lilbee/coverage/badge.svg)](https://tobocop2.github.io/obsidian-lilbee/coverage/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Obsidian](https://img.shields.io/badge/Obsidian-Plugin-7c3aed?logo=obsidian&logoColor=white)](https://obsidian.md)

> **⚠️ This plugin is not usable yet.** It's under active development and will be ready soon.

Talk to your vault. Ask questions about your notes, PDFs, code, spreadsheets, and images — and get answers grounded in what you've actually written, with source citations. Save conversations back to your vault as markdown. Everything runs locally on your machine via [Ollama](https://ollama.com), so your documents never leave your computer.

## Demo

<details>
<summary><b>Scanned PDF → vision OCR → chat</b> (click to expand)</summary>

Attaching a scanned 1998 Star Wars: X-Wing Collector's Edition manual (PDF with no extractable text), indexing it with vision OCR, and chatting about the dev team credits — entirely local.

> Recording sped up 5.5x. Real time ~4 min on M1 Pro / 32 GB. Most time is vision OCR.

![Obsidian chat demo](demos/obsidian-chat.gif)
</details>

---

## Quick start

1. Install [Ollama](https://ollama.com) and start it
2. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat) if you don't have it (Settings → Community plugins → Browse → search "BRAT")
3. In Obsidian, open the command palette (`Cmd/Ctrl + P`) → **BRAT: Plugins: Add a beta plugin for testing** → paste `tobocop2/obsidian-lilbee` → Add Plugin
4. Enable "lilbee" in Settings → Community plugins
5. **Open chat** and start attaching files to talk about them — or **Sync vault** to index everything at once

The plugin downloads and manages the lilbee server automatically — no terminal, no pip, no manual setup.

## How it works

On first launch, the plugin downloads a pre-built [lilbee](https://github.com/tobocop2/lilbee) server binary from GitHub Releases into `.obsidian/plugins/lilbee/bin/` and runs it in the background. Syncing sends your documents to this local server, which chunks and embeds them using Ollama. When you search or chat, the server retrieves the most relevant chunks and passes them to the LLM for a grounded response.

Everything stays on your machine. The server, models, embeddings, and your documents all run and live locally.

> **macOS users:** The binary is unsigned (Apple charges [$99/year](https://developer.apple.com/support/enrollment/) for that). The plugin clears the quarantine flag via [`xattr -cr`](https://support.apple.com/en-us/102445) automatically. See the [lilbee source](https://github.com/tobocop2/lilbee) if you want to audit the build.

## Documentation

See **[Usage Guide](docs/usage.md)** for the full reference — all commands, settings, chat features, supported formats, troubleshooting, and advanced configuration.

## Build your own integration

lilbee exposes a REST API that isn't tied to any specific model. The search endpoint returns relevant chunks without calling an LLM — so you can index locally with lilbee and feed results into a frontier model like ChatGPT or Claude if you prefer. This plugin is a full working example of a client built on that API.

See the [lilbee README](https://github.com/tobocop2/lilbee) for the API docs.

## License

MIT
