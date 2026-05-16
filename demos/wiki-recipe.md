# Wiki recipe (Phase 0)

The wiki layer is the most quality-sensitive piece of the demo. Before
each Obsidian wiki recording, build the wiki headlessly via lilbee CLI
on a known-good vault and assess the output. The recipe below is the
validated baseline.

## Validated baseline (2026-05-15, Qwen3 8B)

**Models:**
- Chat / synthesis: `Qwen/Qwen3-8B-GGUF/Qwen3-8B-Q4_K_M.gguf`
- Embedding: `nomic-ai/nomic-embed-text-v1.5-GGUF`

Qwen3 8B Q4_K_M is the chosen baseline. It's the active chat model for
every non-wizard demo (chat, click-to-source, add, crawl, settings,
wiki). The setup-wizard demo still installs Qwen3 4B Q4_K_M on camera
because that's the small-model story.

**Vault content** (`demos/sample-vault/`):
- `Code/lilbee-README.md` — drives the "Search Engine" + "Model Context
  Protocol" concept pages.
- `Code/system.py`, `Code/mcp_server.py` — small lilbee source slice for
  the lilbee-talking-to-lilbee chat demo.
- `Crown Victoria Owner's Manual.pdf` — drives the chat / click-to-
  source demos.
- `Notes/Recipes.md`, `Notes/Project ideas.md`, `Notes/Daily.md` —
  small markdown set for vault realism.

**Build:**
```bash
RECIPE=/tmp/obsidian-demo-recipe
rm -rf "$RECIPE" && mkdir -p "$RECIPE"
cat > "$RECIPE/config.toml" <<EOF
chat_model = "Qwen/Qwen3-4B-GGUF/Qwen3-4B-Q4_K_M.gguf"
embedding_model = "nomic-ai/nomic-embed-text-v1.5-GGUF"
wiki = true
EOF
LILBEE_DATA="$RECIPE" lilbee add demos/sample-vault/
LILBEE_DATA="$RECIPE" lilbee wiki build
```

## Output assessment

After the build:

- **Concept pages published** (`wiki/concepts/`): pages whose
  `faithfulness_score >= 0.5` land here; the demo's wiki sidebar shows
  these.
- **Drafts** (`wiki/drafts/`): pages with `faithfulness_score < 0.5`
  quarantined for human review. The demo's "wiki drafts" modal shows
  these.

### Baseline run results (Qwen3 8B Q4_K_M)

**Published concepts** (faithfulness >= 0.5, 9 total):

| Page | Faithfulness |
|---|---|
| MCP | 0.84 |
| Warning lights and chimes | 0.83 |
| Air suspension | 0.82 |
| Model Catalog | 0.82 |
| Shared Models Directory | 0.80 |
| Error envelope | 0.78 |
| Instrument Cluster | 0.77 |
| Fuel Pump Shut-off Switch | 0.74 |
| Traction Control | 0.71 |

**Drafts** (low faithfulness, 9 total): cross-platform-path-construction,
directory-ignoring-rules, document-synchronization, knowledge-base-search,
local-ai-chat-with-grounding, local-project-root-detection,
platform-specific-data-directory, system-status-monitoring,
wiki-page-management. The wiki-drafts demo replays this state.

For comparison, **Qwen3 4B Q4_K_M** baseline (earlier run): 6 published,
1 draft, faithfulness scores 0.0-0.82. 8B nearly doubles published
output and produces sharper concept names.

### Why this is a good demo

The MCP draft is *exactly* the failure case the wiki UX is designed
for: the model wrote something plausible, the citation checker caught
that the quotes didn't trace back, the page landed in drafts pending
human review. Show this in the demo's `lilbee:wiki-drafts` step — it's
the proof that the wiki layer is more than "ask a model to summarize."

## When the recipe needs re-validation

Re-run the recipe and update this file when:

- A bigger chat model becomes available (e.g. Qwen3 8B finishes pulling
  — bump `chat_model` and re-build).
- The lilbee version changes the wiki extraction pipeline.
- The sample vault changes content.

The Obsidian wiki demo (`demos/recording-guide.md` step #9) uses
whatever the latest validated recipe in this file says.
