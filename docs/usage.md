# Usage Guide

Everything the lilbee plugin can do inside Obsidian: the setup wizard, the chat and search surfaces, models, the wiki, crawling, and every setting. For installation see the [README quick start](../README.md#quick-start); for the engine itself (how it indexes and retrieves) see [lilbee](https://lilbee.sh/).

The plugin talks to a local **lilbee** server over HTTP. In the default *managed* mode it downloads and runs that server for you — there's nothing else to install, and no Ollama. Everything stays on your computer unless you choose a cloud model.

- [First launch: the setup wizard](#first-launch-the-setup-wizard)
- [The status bar and ribbon](#the-status-bar-and-ribbon)
- [Commands](#commands)
- [Chat](#chat)
- [Search](#search)
- [Source Preview and citations](#source-preview-and-citations)
- [Adding content](#adding-content)
- [Crawling the web](#crawling-the-web)
- [Browsing your documents](#browsing-your-documents)
- [Models and the catalog](#models-and-the-catalog)
- [The Task Center](#the-task-center)
- [Wiki (beta)](#wiki-beta)
- [Cloud models](#cloud-models)
- [Server modes and multiple vaults](#server-modes-and-multiple-vaults)
- [Settings reference](#settings-reference)
- [Supported formats](#supported-formats)
- [Troubleshooting](#troubleshooting)

---

## First launch: the setup wizard

The first time you enable the plugin, a setup wizard opens and walks you through getting running. You can re-run it any time from the command palette (**Run setup wizard**) or Settings → **Run setup wizard**.

1. **Welcome.** A short intro. Choose **Get Started** or **Skip Setup**.
2. **Server.** Pick **Managed (Recommended)** to let the plugin download and run the server, or **External** to point at a lilbee server you run yourself (enter its URL and, for a remote machine, a session token). On managed, the wizard downloads the right binary for your platform, starts it, and shows progress as *Downloading → Starting → Ready*. It will not advance until the server is ready.
3. **Chat model.** Pick a chat model from a featured grid. If your system RAM is known, the wizard shows it and pre-selects a model that fits. The download streams in; you can open the Task Center to watch it, or browse the full catalog.
4. **Embedding model.** Pick the model that turns your documents into something searchable. Indexing needs this.
5. **Sync.** Optionally index your vault now. Progress shows file by file.
6. **Wiki (experimental).** Optionally turn on the auto-generated wiki. The step lists the tradeoffs before you decide.
7. **Done.** A summary of what was set up, plus where to go next. Choosing **Open Chat** drops you into the chat sidebar.

Finishing setup opens the chat sidebar once, so you don't land on an empty editor. On later launches nothing is forced open: Obsidian reopens whatever panes you left from your previous session.

---

## The status bar and ribbon

**Status bar** (bottom of the window) shows the server and task state with a colored dot:

| Shows | Means |
|-------|-------|
| `lilbee: ready` | Managed server up and serving this vault |
| `lilbee: ready [external]` | Connected to a server you run yourself |
| `lilbee: downloading...` / `starting...` | Bringing the managed server up |
| `lilbee: stopped` | Server not running |
| `lilbee: error` | Server failed to start or isn't reachable |
| `lilbee: auth error` | Missing or invalid session token (usually external mode) |
| `lilbee: serving "Other Vault"` | Another open vault currently holds the shared server (see [multiple vaults](#server-modes-and-multiple-vaults)) |
| `lilbee: 2 tasks running · …` | Background jobs in progress, with the active job and percentage |

Click the status bar to jump to settings. A separate pill with a refresh icon and a count appears when files have changed and a sync is pending.

**Ribbon icon** (left gutter):

- **Open lilbee chat** (speech-bubble icon) — opens the chat sidebar. Open the Task Center from the command palette ("Show task center"); background-job progress shows in the status bar.

---

## Commands

Open the command palette (`Cmd/Ctrl + P`) and type `lilbee`. Commands that need the server are unavailable until it's ready.

| Command | What it does |
|---------|-------------|
| **Open chat** | Open the chat sidebar |
| **Search knowledge base** | Open the search modal for semantic search with live results |
| **Sync vault** | Index new and changed files, drop deleted ones |
| **Retry skipped documents** | Re-attempt files that produced no content on an earlier sync |
| **Rebuild index** | Drop the whole index and re-embed everything (asks first) |
| **Add current file to lilbee** | Index just the active file |
| **Add current folder to lilbee** | Index every file in the active folder |
| **Browse documents** | Open the documents browser |
| **Browse model catalog** | Open the model catalog |
| **Pick chat model** / **Pick embedding model** | Quick picker to switch the active model for a role |
| **Show info for active chat model** / **…embedding model** | Show the active model's details |
| **Crawl web page** | Fetch a web page (or a site) into your vault |
| **Show task center** | Open the Task Center |
| **Show status** | Document and chunk counts, model and wiki status |
| **Run setup wizard** | Re-run the first-launch wizard |
| **Browse wiki** | Open the wiki view *(when wiki is enabled)* |
| **Generate wiki for current file** | Write a wiki page from the active file *(wiki enabled)* |
| **Review wiki drafts** | Open the drafts review queue *(wiki enabled)* |
| **Run wiki lint** | Check wiki pages for stale or broken citations *(wiki enabled)* |
| **Take over the managed lilbee server** | Reclaim the shared server for this vault *(managed mode, when another vault holds it)* |

You can also right-click any file or folder in the file explorer and choose **Add to lilbee**.

---

## Chat

The chat sidebar (**Open chat**, or the ribbon icon) is the main way to use lilbee.

- **Two modes.** Toggle between **Search** and **Chat**. *Search* runs your question through your documents and answers with citations. *Chat* is a plain assistant with no retrieval. Search needs an embedding model; the toggle is disabled until one is set.
- **Search scope.** When the wiki is on, scope buttons let you search **All**, just the **Wiki** summaries, or just the **Raw** document chunks.
- **Streaming answers** render token by token, with full markdown. Capable models show a collapsible **Reasoning** section.
- **Citations.** Each answer has a **Sources** block of clickable chips. Click one to open the [Source Preview](#source-preview-and-citations) at the exact spot.
- **Attach as you go.** The **Add File** button attaches a **Vault File**, a **Disk File**, a **Disk Folder**, or kicks off a **Crawl Web** — all indexed into the conversation's reach.
- **Switch models from the toolbar.** Change the chat model inline; if it isn't installed yet, you'll get a confirmation showing its size and RAM, then a progress bar. Changing the embedding model warns you that a re-index is needed.
- **Stop** a streaming answer mid-flight (the send button becomes a stop button).
- **Save** the conversation to your vault as a dated markdown file under `lilbee/`, or **Clear Chat** to start over.
- **Inline progress.** Sync and indexing progress shows right in the chat, with a cancel option. If the server isn't reachable the input shows *Connecting…* and then *Offline*.

---

## Search

**Search knowledge base** opens a focused search modal: type a query and results stream in as you type (debounced). When the wiki is on, the same **All / Wiki / Raw** scope toggle is available. Each result is a document card with clickable citations that open the Source Preview. For a back-and-forth instead of one-shot lookups, use chat in Search mode.

---

## Source Preview and citations

Every citation — in a chat answer, a search result, or a wiki page — is a live link.

- **Source Preview** opens a resizable panel scrolled to the cited location, with surrounding context visible. Text renders as markdown; PDFs embed and jump to the cited page. If the source lives in your vault, **Open in Vault** takes you to the file.
- From a chat answer, the citation list groups references and shows, per citation, a **Fact** or **Inference** badge, the source file and location, an excerpt, and whether the cited text is still **Current** or has gone **Stale** since indexing.

---

## Adding content

There are several ways to get documents into your library:

- **Sync vault** indexes everything new or changed and removes anything you've deleted. Run it from the palette, or turn on auto-sync (Settings → Sync) to have it run after a short delay whenever files change.
- **Add current file** / **Add current folder**, or right-click → **Add to lilbee**, index a specific file or folder on demand.
- **Rebuild index** drops the entire index and re-embeds from scratch — use it after changing the embedding model or chunking. It asks for confirmation first.
- **Retry skipped documents** re-attempts files that yielded no content last time (for example a scan that needed OCR you've since enabled).

All of this runs as background jobs in the [Task Center](#the-task-center), so you can keep asking questions while indexing proceeds.

---

## Crawling the web

**Crawl web page** (or **Add File → Crawl Web** in chat) fetches a web page, converts it to markdown, and adds it to your library so you can search it offline afterward.

- Enter a URL. Tick **Crawl Recursively** to follow links within the same domain.
- Under the advanced section you can cap the **Depth** and **Max Pages** for a single crawl.
- Site-wide defaults — crawl depth, page limit, per-page timeout, request delay and jitter, concurrency, rate-limit retry/backoff, and URL exclude patterns — live in Settings → **Crawling**.

---

## Browsing your documents

**Browse documents** lists everything indexed in this vault: filename, chunk count, and when it was added. Search to filter, scroll to load more, and select one or more to **Delete Selected** (with a confirmation). Deleting removes a document from the index; it doesn't touch the original file.

---

## Models and the catalog

lilbee uses four model **roles**, each independently chosen:

| Role | What it's for | Default |
|------|---------------|---------|
| **Chat** | Writes the answers | Picked in the wizard |
| **Embedding** | Turns documents into something searchable; required for indexing and Search mode | Picked in the wizard |
| **Vision** | Reads scanned PDFs and image-only pages when OCR isn't enough | Disabled |
| **Reranker** | Reorders results for better relevance | Disabled |

Pick or switch any role from Settings → **Models** (each has a dropdown plus a **Browse more…** button), from the chat toolbar, or with the **Pick chat model** / **Pick embedding model** commands.

**Browse model catalog** opens the catalog:

- **Discover** surfaces rails like **For You** (matched to your active chat model), **Your Collection** (installed), and **Fresh** (newest).
- **Chat / Embed / Vision / Rerank** tabs each split into **Local** (installed) and **Frontier** (cloud) models. Filter by size, sort by featured/downloads/newest, and switch between grid and list.
- Each model shows its size, memory need, and download count. Models that won't run on your hardware are flagged, and the download is blocked unless you override it — so you don't sit through a multi-GB pull only to hit an unsupported model.
- Per model: **Pull** to download, **Use** to activate, **Remove** to delete, and an **info** button for full details (parameters, context length, quantization, a link to Hugging Face). The active model is marked **ACTIVE**.
- **Library** lists only what you've installed.

Downloads run through the [Task Center](#the-task-center), so you can keep working while a model pulls.

---

## The Task Center

**Show task center** (or the ribbon icon) opens a live view of every background job: **sync**, **crawl**, model **pull**, **delete**, **embed**, wiki **build**, **lint**, draft accept/reject, and re-index.

- Jobs are grouped into **active**, **queued**, and **completed**, with a header count.
- Each row shows a type badge, name, elapsed time, a progress bar (with bytes and rate for downloads), and any detail or error.
- Active jobs can be **Cancelled**; failed ones can be **Retried**.
- Jobs of the same type queue behind a concurrency cap so a big sync doesn't starve everything else. **Clear Tasks** tidies the completed list.

---

## Wiki (beta)

When enabled, lilbee reads what you've indexed and writes a linked wiki about it — pages that compound across sources, with citations to every document that mentions a concept. It's experimental: quality depends on your library and models.

Turn it on in Settings → **Wiki (beta)** → **Enable wiki**, then:

- **Browse wiki** opens the wiki view, with summary and concept pages, search, and clickable wikilinks and citations.
- **Generate wiki for current file** writes a page from the active note.
- **Review wiki drafts** opens the queue of lower-confidence pages: each shows why it was held (drift, low faithfulness, a parse or title issue), a diff, and **Accept** / **Reject**.
- **Run wiki lint** (or Settings → **Check wiki health**) scans for stale, deleted, or missing citations and lists them by page. **Clean up wiki** removes pages whose sources are gone.
- **Sync wiki to vault** writes the pages as real markdown files in a folder you choose (**Wiki vault folder**, default `lilbee-wiki`), so they show up in Obsidian's graph view, search, and backlinks alongside your own notes.

Wiki settings also include a **Summary accuracy** threshold and a **Default search mode** (All / Wiki / Raw).

---

## Cloud models

By default everything runs locally. To use a hosted model for a role:

1. Settings → Advanced → **AI backend** → **External (OpenAI, Claude, etc.)**.
2. Add the relevant key under Advanced: **OpenAI API key**, **Anthropic API key**, or **Gemini API key**. For gated Hugging Face downloads, add a **HuggingFace token**.
3. In the catalog's **Frontier** tab (or a role's dropdown), pick a hosted model. Models needing a key you haven't added show a **Missing Key** pill.

You can mix and match — for example a cloud vision model for OCR while chat and embedding stay local. The chat toolbar and status surfaces make it clear whenever a cloud model is active, so you know when text is leaving your machine. Only your query and the matched excerpts are sent; your files and index stay put.

---

## Server modes and multiple vaults

**Managed mode (default).** The plugin downloads the lilbee binary for your platform, stores it in a shared location, and runs it on a local port it picks automatically. On macOS it clears the quarantine flag so Gatekeeper doesn't block it. Settings → Connection shows the server status, **Start / Stop / Restart** controls, the installed **Server version** with a **Check for updates** button (which downloads and restarts on a new release), and a **Disk usage** breakdown.

**External mode.** Point the plugin at a lilbee server you run yourself: enter the **Server URL** (default `http://127.0.0.1:7433`) and **Test** it. A remote server also needs a **Session token**; when the server runs on the same machine the plugin finds the token automatically. **Reset to managed** switches back to the built-in server.

**Multiple vaults.** Vaults on the same computer share one lilbee install and one model cache, so models you download are reused, not re-fetched. Only one vault runs the server at a time; each keeps its own separate index. If you open a second vault, its status bar shows `lilbee: serving "Other Vault"`, and **Take over the managed lilbee server** hands the server to the vault you're in.

**Where documents live.** By default lilbee keeps each vault's index in the shared location. **Store lilbee content in vault** (Settings → Advanced, on by default in managed mode) materializes crawled pages and imported files inside your vault so you can browse them in Obsidian. You can also point a vault at an existing lilbee data directory via **Use existing lilbee data directory**.

---

## Settings reference

Settings → Community plugins → **lilbee**. A filter box at the top searches setting names. Settings are grouped top to bottom:

| Section | Covers |
|---------|--------|
| **Connection** | Server mode (managed/external), re-run setup wizard. Managed: status, start/stop/restart, shared directory, adopt an existing data dir, disk usage, version & updates. External: server URL + test, session token, reset to managed. |
| **Models** | Active chat, embedding, vision, and reranker models; refresh; open the catalog. |
| **Search & Retrieval** | **Results count** (1–20, default 5), **Search strictness** (how close a match must be), **Adaptive threshold** (auto-broaden when too few results). |
| **Generation** *(advanced)* | System prompts for answering with and without documents, **Chat mode**, **Creativity** (temperature), **Top P**, **Top K**, **Repetition penalty**, **Seed**, and caps like max tokens, reasoning length, keep-alive, and GPU memory fraction. Blank means "use the model's default." |
| **Retrieval (advanced)** | Candidate-pool multiplier, minimum relevance score, max sources per answer, max chunks per source, and the MMR relevance/diversity balance. |
| **Ingest** | Chunk size and overlap (changing these invalidates the index), and OCR timeouts. |
| **Worker pool** | Timeouts and idle behavior for the background model workers; whether to start them eagerly. |
| **Crawling** | Depth, page limit, timeouts, request pacing, rate-limit retry/backoff, and URL exclude patterns. |
| **Wiki (beta)** | Enable the wiki, summary accuracy, default search mode, sync-to-vault and its folder, plus health-check and clean-up buttons. |
| **Advanced** | Store content in vault, rerank candidate count, **AI backend** (auto / local / external), API keys (OpenAI, Anthropic, Gemini, Hugging Face), the external endpoint, and **Reset all** server-backed settings. |

Most knobs in Generation, Retrieval, Ingest, and Worker pool are revealed only when the server reports them, so an older server shows fewer. Server-backed settings have a per-row reset; **Reset all** restores them to defaults while leaving your API keys and local preferences untouched.

---

## Supported formats

Text extraction is handled by [Kreuzberg](https://github.com/kreuzberg-dev/kreuzberg), code chunking by [tree-sitter](https://tree-sitter.github.io/tree-sitter/). The list below isn't exhaustive.

| Format | Extensions |
|--------|-----------|
| PDF | `.pdf` (embedded text, with OCR fallback for scanned pages) |
| Office | `.docx`, `.xlsx`, `.pptx` |
| eBook | `.epub` |
| Images | `.png`, `.jpg`, `.jpeg`, `.tiff`, `.bmp`, `.webp` (read with OCR or a vision model) |
| Data | `.csv`, `.tsv`, `.xml`, `.json`, `.jsonl`, `.yaml`, `.yml` |
| Text | `.md`, `.txt`, `.html`, `.rst` |
| Code | `.py`, `.js`, `.ts`, `.go`, `.rs`, `.java`, and [150+ more](https://github.com/Goldziher/tree-sitter-language-pack) |

Scanned PDFs and image-only pages are read with OCR (Tesseract), or with a local or cloud **vision model** for higher quality on tables and layout. Set one under Settings → Models, or toggle OCR from the chat toolbar.

---

## Troubleshooting

**Server won't start (managed).** Check your internet connection — the binary downloads once on first run, then works offline. On macOS, if Gatekeeper still blocks the binary after the plugin clears its quarantine flag, go to System Settings → Privacy & Security and click **Allow Anyway**.

**`lilbee: error` or a red indicator.** The server isn't reachable. In managed mode, open Settings → Connection and try **Restart**. In external mode, verify the **Server URL** and that your server is running, then **Test**.

**`lilbee: auth error`.** The session token is missing or wrong. For a remote server, paste the token under Settings → Connection → **Session token**. For a local server the plugin finds it automatically — a restart usually clears a stale token.

**`lilbee: serving "Other Vault"`.** Another open vault holds the shared server. Run **Take over the managed lilbee server** to move it to the current vault.

**No search results.** Run **Sync vault** first — documents must be indexed before they're searchable — and make sure an embedding model is set.

**Search toggle is disabled in chat.** Set an embedding model (Settings → Models). Search mode needs one.

**A model won't download or is flagged.** Models incompatible with your hardware are marked in the catalog and blocked unless you override. A stuck download can be cancelled in the Task Center and retried; it resumes where it left off.

---

[Open an issue](https://github.com/tobocop2/obsidian-lilbee/issues) for bugs or feature requests.
