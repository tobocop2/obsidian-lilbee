#!/usr/bin/env bash
# Cut a stable store release: bump the patch version in package.json,
# package-lock.json, and manifest.json, record it in versions.json, commit, tag,
# and push from main. The tag has no "v" prefix (the community plugin store
# requires the release tag to equal the manifest version exactly), so the
# Release workflow does not fire; this script builds main.js and attaches the
# assets itself, with notes generated from the tag diff plus an explicit link
# to the lilbee server version these changes depend on.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

repo="tobocop2/obsidian-lilbee"
lilbee_repo="tobocop2/lilbee"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

branch=$(git rev-parse --abbrev-ref HEAD)
[ "$branch" = "main" ] || { echo "release-store: must be on main (on $branch)" >&2; exit 1; }
[ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "release-store: tracked changes present; commit or stash first" >&2; exit 1; }
git fetch -q origin main
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] \
  || { echo "release-store: main is not in sync with origin/main" >&2; exit 1; }

cur=$(sed -nE 's/.*"version": *"([^"]+)".*/\1/p' manifest.json | head -1)
case "$cur" in
  *[!0-9.]*) echo "release-store: version '$cur' is not stable x.y.z; use 'make release' for betas" >&2; exit 1;;
esac
next="${cur%.*}.$(( ${cur##*.} + 1 ))"
tag="$next"
prev_tag="$cur"
echo "release-store: $cur -> $next ($tag)"

perl -pi -e 's/"\Q'"$cur"'\E"/"'"$next"'"/g' package.json manifest.json package-lock.json
node -e '
  const fs = require("fs");
  const versions = JSON.parse(fs.readFileSync("versions.json", "utf8"));
  const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
  versions[manifest.version] = manifest.minAppVersion;
  fs.writeFileSync("versions.json", JSON.stringify(versions, null, "\t") + "\n");
'

git add package.json manifest.json package-lock.json versions.json
git commit -q -m "release: ${next}"
git tag "$tag"
git push origin main
git push origin "$tag"

npm run build

# The lilbee server release these plugin changes depend on (newest published).
lilbee_tag=$(gh api "repos/${lilbee_repo}/releases" --jq '.[0].tag_name')

notes=$(mktemp)
{
  printf 'Requires lilbee server [%s](https://github.com/%s/releases/tag/%s) or newer. In managed mode the plugin downloads and runs the server for you.\n\n' \
    "$lilbee_tag" "$lilbee_repo" "$lilbee_tag"
  bash "$here/release_notes.sh" "$repo" "$tag" "$prev_tag"
} > "$notes"

gh release create "$tag" --repo "$repo" --title "$tag" --verify-tag --notes-file "$notes" \
  main.js manifest.json styles.css
rm -f "$notes"
echo "release-store: $tag published with main.js / manifest.json / styles.css."
