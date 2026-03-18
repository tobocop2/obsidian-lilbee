# Usage Guide

## Installation

### Prerequisites

**[Ollama](https://ollama.com)** must be installed and running before you use the plugin. Ollama is a free app that runs AI models locally on your computer — it's what powers lilbee's search and chat. Download it from [ollama.com](https://ollama.com) and open it. You don't need to use the terminal or run any commands — just make sure it's running in the background.

The plugin manages the models for you:

- **Embedding model** — converts your documents into a searchable format. Downloaded automatically the first time you sync.
- **Chat model** — the AI that reads your documents and writes answers. The plugin shows a list of recommended models and downloads your pick with one click.
- **Vision model** *(optional)* — lets lilbee "read" images and scanned PDFs that don't have selectable text. Enable it in settings if you need it.

### Install via BRAT

1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat) if you don't have it — Settings → Community plugins → Browse → search "BRAT" → Install → Enable
2. Open the command palette (`Cmd/Ctrl + P`) → **BRAT: Plugins: Add a beta plugin for testing**
3. Paste `tobocop2/obsidian-lilbee` and click **Add Plugin**
4. Go to Settings → Community plugins and enable **lilbee**

### What happens on first launch

When you enable the plugin for the first time:

1. It downloads the lilbee server binary from GitHub to `.obsidian/plugins/lilbee/bin/` and records the installed version
2. On macOS, it clears the quarantine flag (`xattr -cr`) so the binary can run without Gatekeeper blocking it
3. It starts the server on `127.0.0.1:7433` and shows progress in the status bar
4. Once the server is ready, the status bar shows `lilbee: ready`

To update the server later, go to Settings → lilbee → **Check for updates**. If a newer release exists, the button changes to **Update to vX.Y.Z** — clicking it stops the server, downloads the new binary, and restarts automatically.

If the download or startup fails, the status bar shows `lilbee: error`. Check that you have an internet connection (for the initial download) and that Ollama is running.

---

## Open the chat

Once the status bar shows **lilbee: ready**, open the chat sidebar:

| Platform | How to open chat |
|----------|-----------------|
| **macOS** | `Cmd + P` → type **lilbee: Open chat** → Enter |
| **Windows / Linux** | `Ctrl + P` → type **lilbee: Open chat** → Enter |

The chat panel opens in the right sidebar. You can start asking questions right away — attach files inline or run **Sync vault** first to index your whole vault.

---

## Commands

All commands are available via `Cmd/Ctrl + P` → "lilbee":

| Command | What it does |
|---------|-------------|
| **Sync vault** | Index new/changed files, remove deleted ones |
| **Open chat** | Open the chat sidebar |
| **Search knowledge base** | Semantic search with live results |
| **Ask a question** | One-off answer with source citations |
| **Add current file** | Index just the active file |
| **Add current folder** | Index all files in the active folder |
| **Show status** | Show document and chunk counts |

You can also right-click any file or folder in the file explorer and select **Add to lilbee**.

---

## Chat

The chat sidebar (`lilbee: Open chat`) is the main interface:

- **Streaming responses** — answers render as they arrive, with full markdown support
- **Source citations** — expandable list of source documents with click-to-open
- **Attach files** — use the attachment button to add PDFs, code files, images, or folders to the conversation
- **Save to vault** — export the conversation as a markdown file
- **Stop generation** — cancel mid-stream if the answer isn't useful
- **Inline progress** — sync and indexing progress shows directly in the chat with cancel support

---

## Settings

Settings → Community plugins → lilbee.

### Server mode

| Mode | Description |
|------|-------------|
| **Managed (built-in)** | The plugin downloads, starts, and stops the lilbee server automatically. This is the default. |
| **External (manual)** | You run the lilbee server yourself. Enter the URL in the Server URL field. A "Reset to managed" button lets you switch back. |

When using **managed mode**, the status bar shows `lilbee: ready`. When using **external mode**, it shows `lilbee: ready [external]` so you know you're connected to a server the plugin isn't managing.

### Managed server settings

| Setting | Description |
|---------|-------------|
| **Server status** | Shows the current state with a colored indicator (green = ready, yellow = starting, red = error) |
| **Server port** | Port for the managed server (default: 7433). Leave blank for automatic port selection. |
| **Server version** | Shows the installed lilbee version. Click **Check for updates** to query GitHub — if a newer release exists, the button changes to **Update to vX.Y.Z**. Clicking it stops the server, downloads the new binary, and restarts automatically. |

### External server settings

| Setting | Description |
|---------|-------------|
| **Server URL** | Address of your lilbee server, with a Test button to verify connectivity |
| **Reset to managed** | Switch back to the built-in server |

### Connection

| Setting | Description |
|---------|-------------|
| **Ollama URL** | Address of the Ollama server (default: `http://127.0.0.1:11434`), with a Test button |

### Models

The models section lets you pick which AI models lilbee uses. There are two dropdowns:

- **Chat model** — the AI that answers your questions. It reads the relevant passages from your documents and writes a response. You need a chat model selected to use the chat sidebar or the "Ask a question" command.
- **Vision model** — an optional model that can "see" images and scanned PDFs. If you have documents that are photographs, screenshots, or scanned pages without selectable text, a vision model converts them to text so they become searchable. Leave this set to "Disabled" if you don't need it.

The plugin shows a curated list of recommended models for each type. If a model isn't downloaded yet, selecting it starts the download automatically — you'll see a progress bar. You can also:

- **Pull** any model from the catalog manually
- **Delete** installed models you no longer need
- **Refresh** to re-fetch the catalog from the server

Models you've installed directly through Ollama (outside of this plugin) also appear in the dropdown under "Other...".

### General

| Setting | Description |
|---------|-------------|
| **Results count** | Number of search results to return (1–20, default: 5) |

### Sync

| Setting | Description |
|---------|-------------|
| **Sync mode** | **Manual** — sync only when you run the command. **Auto** — watches for file changes and syncs after a debounce delay. |
| **Sync debounce** | Delay in ms before auto-sync triggers after a change (default: 5000). Only shown in auto mode. |

### Advanced (generation)

These override the model's defaults. Leave blank to use whatever the model ships with — the placeholder shows the model's current default.

| Setting | Description |
|---------|-------------|
| **Temperature** | Controls randomness (0.0–2.0) |
| **Top P** | Nucleus sampling threshold (0.0–1.0) |
| **Top K (sampling)** | Limits token choices per step |
| **Repeat penalty** | Penalizes repeated tokens (1.0+) |
| **Context length** | Max context window in tokens |
| **Seed** | Fixed seed for reproducible output |

---

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

---

## Troubleshooting

### Server won't start

- **macOS Gatekeeper**: The plugin runs `xattr -cr` on the binary automatically, but if macOS still blocks it, go to System Settings → Privacy & Security and click "Allow Anyway" next to the lilbee binary.
- **Port in use**: Change the server port in settings if 7433 is already taken.
- **No internet on first run**: The binary must be downloaded once. After that, the plugin works offline.

### No search results

Run **Sync vault** first. Documents need to be indexed before they're searchable.

### Sync fails

Make sure Ollama is running — syncing needs the embedding model. The first sync pulls the embedding model automatically, which requires Ollama to be reachable.

### Red connection indicator

The server isn't reachable. In managed mode, check the status bar for error details. In external mode, verify the server URL and that the server is running.

### Model pull stuck

Click **Cancel** on the pull progress indicator. Then try again — the download resumes from where it left off (handled by Ollama).

---

[Open an issue](https://github.com/tobocop2/obsidian-lilbee/issues) for bugs or feature requests.
