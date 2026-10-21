#!/usr/bin/env bash
# Publish the current branch's build as the preview at https://stewartcampbell88-commits.github.io/anvil-preview/
# (repo Stewartcampbell88-commits/anvil-preview, Pages from main /). It is OUTSIDE the live app's scope
# (/anvil-workout/), so the installed ANVIL app can never open it. The live repo is not touched at all.
#   scripts/publish-preview.sh          → tests + build + local commit only (nothing pushed)
#   scripts/publish-preview.sh --push   → also push that commit to anvil-preview main (publishes the preview)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
PREVIEW_REPO="${PREVIEW_REPO:-https://github.com/Stewartcampbell88-commits/anvil-preview.git}"
PREVIEW_URL="https://stewartcampbell88-commits.github.io/anvil-preview/"
npm test || { echo "TESTS FAILED — not building the preview"; exit 1; }
SRC_REV="$(git rev-parse --short HEAD)"
WT="$(mktemp -d)/anvil-preview"
trap 'rm -rf "$(dirname "$WT")"' EXIT
git clone -q --depth 1 "$PREVIEW_REPO" "$WT" 2>/dev/null || { mkdir -p "$WT"; git -C "$WT" init -q -b main; git -C "$WT" remote add origin "$PREVIEW_REPO"; }
git -C "$WT" config user.name "$(git config user.name || echo ANVIL)"; git -C "$WT" config user.email "$(git config user.email || echo anvil@users.noreply.github.com)"
(cd "$WT" && git rm -rqf --ignore-unmatch . >/dev/null)
"$ROOT/scripts/make-preview.sh" "$WT/site"
cp -r "$WT/site/." "$WT/"; rm -rf "$WT/site"; touch "$WT/.nojekyll"
printf '# ANVIL preview\n\nTest build of [ANVIL](https://github.com/Stewartcampbell88-commits/anvil-workout) from %s. Own data (anvil-preview: keys), no sync. Published by scripts/publish-preview.sh — do not edit here.\n' "$SRC_REV" > "$WT/README.md"
git -C "$WT" add -A
if git -C "$WT" diff --cached --quiet; then echo "preview already up to date"; else git -C "$WT" commit -qm "Preview build from anvil-workout $SRC_REV"; fi
git -C "$WT" log --oneline -1
if [[ "${1:-}" == "--push" ]]; then (cd "$WT" && git push -q origin HEAD:main) && echo "preview published: $PREVIEW_URL"; else echo "(local only — add --push to publish)"; fi
