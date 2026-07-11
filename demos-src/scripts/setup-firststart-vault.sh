#!/usr/bin/env bash
# Set up a clean Obsidian vault for the first_start demo.
#
# The vault has no plugins installed and no notes. After this script
# runs, open Obsidian against the printed path (with CDP debugging on
# port 9222) and then run `npm run demo first_start`.
set -euo pipefail

VAULT_DIR="${HOME}/Library/Application Support/obsidian-lilbee-firststart/vault"

# Remove any stale install (lilbee from a prior recording, etc.)
rm -rf "$VAULT_DIR"
mkdir -p "$VAULT_DIR/.obsidian/plugins"

# Drop a brief lilbee overview so the demo's chat question has something
# to retrieve against. Mirrors the open-source overview from the real
# project README in a form Qwen3 0.6B can answer from cleanly.
cat > "$VAULT_DIR/lilbee.md" <<'EOF'
# lilbee

lilbee is a batteries-included local search engine for your files
and code. It runs entirely on your machine, talks to whichever
local model you point it at, and ships with a built-in catalog of
GGUF models from Hugging Face.

It is **open source**, written in Python, distributed under a
permissive license, and available from PyPI, Homebrew, AUR, Docker,
Nix, and as a standalone binary.

## Features

- Local-first chat with citations back to the exact file and line
- Built-in model catalog with download progress in the Task Center
- Crawl web pages into searchable markdown
- Wiki generation: AI-written summaries of your own notes

## Install

The easiest install is `pip install lilbee` or `brew install lilbee`.
EOF

# Enable community plugins so we don't gate on the "turn on" prompt.
cat > "$VAULT_DIR/.obsidian/community-plugins.json" <<'EOF'
[]
EOF

# Pin dark theme so the demo doesn't open in light mode.
cat > "$VAULT_DIR/.obsidian/appearance.json" <<'EOF'
{"theme": "obsidian"}
EOF

echo "Clean vault ready at:"
echo "  $VAULT_DIR"
echo
echo "Next steps:"
echo "  1. Quit any running Obsidian."
echo "  2. Launch Obsidian against this vault with CDP on port 9222:"
echo "       open -a Obsidian --args --remote-debugging-port=9222 --path=\"$VAULT_DIR\""
echo "     (or open Obsidian normally then File -> Open another vault and navigate to the path)"
echo "  3. Run: npm run demo first_start"
