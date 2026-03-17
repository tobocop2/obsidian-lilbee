# lilbee for Obsidian

[![CI](https://github.com/tobocop2/obsidian-lilbee/actions/workflows/ci.yml/badge.svg)](https://github.com/tobocop2/obsidian-lilbee/actions/workflows/ci.yml)
[![Coverage](https://tobocop2.github.io/obsidian-lilbee/coverage/badge.svg)](https://tobocop2.github.io/obsidian-lilbee/coverage/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Obsidian](https://img.shields.io/badge/Obsidian-Plugin-7c3aed?logo=obsidian&logoColor=white)](https://obsidian.md)

> **Warning: This plugin is not usable yet.** It's under active development and will be ready soon.

Chat with your documents privately, entirely on your own machine. Ask questions about your notes, PDFs, code, spreadsheets, and images — and get answers grounded in what you've actually written, with source citations. Save conversations back to your vault as markdown. No cloud services, no API keys, no data leaves your computer.

## Demo

<details>
<summary><b>Scanned PDF → vision OCR → chat</b> (click to expand)</summary>

Attaching a scanned 1998 Star Wars: X-Wing Collector's Edition manual (PDF with no extractable text), indexing it with vision OCR, and chatting about the dev team credits — entirely local.

> Recording sped up 5.5x. Real time ~4 min on M1 Pro / 32 GB. Most time is vision OCR.

![Obsidian chat demo](demos/obsidian-chat.gif)
</details>

---

## What you need

### Ollama

**[Ollama](https://ollama.com)** is a free app that runs AI models locally on your computer. lilbee uses it behind the scenes to understand your documents and answer your questions — nothing is sent to the cloud.

1. Download and install Ollama from [ollama.com](https://ollama.com)
2. Open it — it runs in the background (you'll see a llama icon in your menu bar on macOS or system tray on Windows/Linux)

That's it. The plugin takes care of downloading the specific models it needs. You don't need to use the Ollama terminal or know any commands.

### Models — what they are and why you need them

A "model" is an AI brain that runs on your computer. lilbee uses three kinds:

| Model type | What it does | Do I need to set it up? |
|-----------|-------------|------------------------|
| **Embedding model** | Reads your documents and converts them into a searchable format so lilbee can find the right passages when you ask a question. This is what makes search work. | No — the plugin downloads this automatically the first time you sync. |
| **Chat model** | The AI that reads the relevant passages and writes an answer in plain language. This is what you're talking to in the chat sidebar. | The plugin shows you a list of recommended models and downloads your pick with one click. |
| **Vision model** *(optional)* | Can "read" images and scanned PDFs that don't have selectable text — think photographed pages, screenshots, or old scanned documents. It converts them to text so they become searchable. | Only needed if you want to index images or scanned PDFs. You can enable it in settings whenever you're ready. |

Models are large files (a few GB each) and take a few minutes to download the first time. After that they're cached on your machine and load in seconds.

> **Hardware note:** Models run on your CPU or GPU. A Mac with Apple Silicon (M1/M2/M3/M4) or a PC with an NVIDIA GPU will give the best performance. 8 GB of RAM is the minimum; 16–32 GB is recommended for a smooth experience.

## Quick start

1. Install and open **[Ollama](https://ollama.com)**
2. Install **[BRAT](https://github.com/TfTHacker/obsidian42-brat)** in Obsidian (Settings → Community plugins → Browse → search "BRAT" → Install → Enable)
3. Open the command palette (`Cmd/Ctrl + P`) → **BRAT: Plugins: Add a beta plugin for testing** → paste `tobocop2/obsidian-lilbee` → Add Plugin
4. Enable **lilbee** in Settings → Community plugins
5. **Open chat** (`Cmd/Ctrl + P` → "lilbee: Open chat") and start attaching files — or run **Sync vault** to index everything at once

The plugin downloads and manages the [lilbee](https://github.com/tobocop2/lilbee) server automatically — no terminal commands, no Python, no manual setup.

## How it works

On first launch, the plugin downloads a small server program ([lilbee](https://github.com/tobocop2/lilbee)) and runs it in the background. When you sync your vault or attach files in the chat, this server breaks your documents into passages and uses Ollama to create searchable embeddings. When you ask a question, it finds the most relevant passages and sends them to the chat model, which writes an answer grounded in your actual documents — with links back to the sources.

Everything stays on your machine. The server, the models, the search index, and your documents all live locally.

> **macOS users:** The server binary is unsigned (Apple charges [$99/year](https://developer.apple.com/support/enrollment/) for that). The plugin clears the quarantine flag automatically. If macOS still blocks it, go to System Settings → Privacy & Security and click "Allow Anyway". See the [lilbee source](https://github.com/tobocop2/lilbee) if you want to audit the build.

## Updating the server

The plugin tracks the installed lilbee server version. Go to Settings → lilbee → **Check for updates**. If a newer release is available, the button changes to **Update to vX.Y.Z** — one click stops the running server, downloads the new version, and restarts.

## Documentation

See **[Usage Guide](docs/usage.md)** for the full reference — all commands, settings, chat features, supported formats, troubleshooting, and advanced configuration.

## Build your own integration

lilbee exposes a REST API that isn't tied to any specific model. The search endpoint returns relevant passages without calling an LLM — so you can build your own tools on top of it, or integrate document search into other apps. This plugin is a full working example of a client built on that API.

See the [lilbee README](https://github.com/tobocop2/lilbee) for the API docs.

## License

MIT
