#!/usr/bin/env bash
# Thin wrapper around the demo recording pipeline that lives on the
# gh-pages branch (so main stays clean). Worktrees gh-pages, runs the
# corresponding `make` target there, leaves the worktree in place for
# the next call.
#
# Usage:
#   scripts/demo.sh prep      # install harness deps + verify deps
#   scripts/demo.sh render    # records every tape into demos-src/output/
#   scripts/demo.sh publish   # copies + commits webms onto gh-pages

set -euo pipefail

WORKTREE="${OBSIDIAN_LILBEE_GH_PAGES_WORKTREE:-/tmp/obsidian-lilbee-gh-pages}"
REPO_ROOT="$(git rev-parse --show-toplevel)"

if [ ! -d "$WORKTREE" ]; then
    git -C "$REPO_ROOT" fetch origin gh-pages >/dev/null
    git -C "$REPO_ROOT" worktree add "$WORKTREE" origin/gh-pages
fi

git -C "$WORKTREE" fetch origin gh-pages >/dev/null 2>&1 || true
git -C "$WORKTREE" checkout gh-pages
git -C "$WORKTREE" pull --ff-only origin gh-pages >/dev/null 2>&1 || true

export OBSIDIAN_LILBEE_REPO_ROOT="$REPO_ROOT"

case "${1:-render}" in
    prep)
        make -C "$WORKTREE" demo-prep
        ;;
    render)
        make -C "$WORKTREE" demo
        ;;
    publish)
        make -C "$WORKTREE" demo-publish
        ;;
    *)
        echo "usage: $0 {prep|render|publish}" >&2
        exit 2
        ;;
esac
