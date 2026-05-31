#!/usr/bin/env bash
# Cut a beta release: bump the trailing bNNN in package.json, package-lock.json, and
# manifest.json, commit, tag, and push from main. The Release workflow builds and
# attaches main.js, manifest.json, and styles.css. This script then creates the GH
# release itself with notes generated from the tag diff (as simple headings) plus an
# explicit link to the lilbee server version these changes depend on.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

repo="tobocop2/obsidian-lilbee"
lilbee_repo="tobocop2/lilbee"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

branch=$(git rev-parse --abbrev-ref HEAD)
[ "$branch" = "main" ] || { echo "release: must be on main (on $branch)" >&2; exit 1; }
[ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "release: tracked changes present; commit or stash first" >&2; exit 1; }
git fetch -q origin main
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] \
  || { echo "release: main is not in sync with origin/main" >&2; exit 1; }

cur=$(sed -nE 's/.*"version": *"([^"]+)".*/\1/p' manifest.json | head -1)
case "$cur" in
  *b[0-9]*) ;;
  *) echo "release: version '$cur' has no beta (bNNN) segment to bump" >&2; exit 1;;
esac
next="${cur%b*}b$(( ${cur##*b} + 1 ))"
tag="v${next}"
prev_tag="v${cur}"
echo "release: $cur -> $next ($tag)"

perl -pi -e 's/"\Q'"$cur"'\E"/"'"$next"'"/g' package.json manifest.json package-lock.json

git add package.json manifest.json package-lock.json
git commit -q -m "release: ${next}"
git tag "$tag"
git push origin main
git push origin "$tag"

# The lilbee server release these plugin changes depend on (newest published).
lilbee_tag=$(gh api "repos/${lilbee_repo}/releases" --jq '.[0].tag_name')

notes=$(mktemp)
{
  printf 'Beta release. These changes depend on the next lilbee server, [%s](https://github.com/%s/releases/tag/%s) or newer. Install or update lilbee first, then update the plugin.\n\n' \
    "$lilbee_tag" "$lilbee_repo" "$lilbee_tag"
  bash "$here/release_notes.sh" "$repo" "$tag" "$prev_tag"
} > "$notes"

# CI's Release workflow may create the release first; create, or update if it exists.
gh release create "$tag" --repo "$repo" --title "$tag" --verify-tag --notes-file "$notes" \
  || gh release edit "$tag" --repo "$repo" --notes-file "$notes"
rm -f "$notes"
echo "release: $tag published; CI attaches main.js / manifest.json / styles.css."
