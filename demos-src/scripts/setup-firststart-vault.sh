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

# Seed the vault with the real lilbee README so the demo adds and cites
# the same document the what_is_lilbee reel uses.
LILBEE_README="${LILBEE_README:-$HOME/projects/lilbee/README.md}"
[ -f "$LILBEE_README" ] || { echo "lilbee README not found at $LILBEE_README" >&2; exit 1; }
cp "$LILBEE_README" "$VAULT_DIR/README.md"

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
