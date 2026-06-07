#!/usr/bin/env bash
# Cut a stable store release: bump the patch version in package.json,
# package-lock.json, and manifest.json, record it in versions.json, commit, tag,
# and push from main. The tag has no "v" prefix (the community plugin store
# requires the release tag to equal the manifest version exactly), so the beta
# Release workflow does not fire; pushing the tag triggers the Store Release
# workflow, which builds, attests, and publishes the release with notes
# generated from the tag diff plus a link to the lilbee server version these
# changes depend on.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

repo="tobocop2/obsidian-lilbee"

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

echo "release-store: $tag pushed; the Store Release workflow publishes the release."

# The run takes a moment to appear after the tag push.
run_id=""
for _ in $(seq 1 12); do
  run_id=$(gh run list --repo "$repo" --workflow=release-store.yml --branch "$tag" --limit 1 --json databaseId --jq '.[0].databaseId // empty')
  [ -n "$run_id" ] && break
  sleep 5
done
[ -n "$run_id" ] || { echo "release-store: no workflow run found for $tag; check gh run list --workflow=release-store.yml" >&2; exit 1; }

gh run watch --repo "$repo" "$run_id" --exit-status \
  || { echo "release-store: workflow failed; see gh run view --repo $repo $run_id" >&2; exit 1; }
echo "release-store: $tag published with main.js / manifest.json / styles.css."
