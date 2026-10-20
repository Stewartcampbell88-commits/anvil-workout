#!/usr/bin/env bash
# Put the current branch's build at /anvil-workout/preview/ WITHOUT touching the live app at the root.
# Builds a commit = origin/main + preview/ on local branch "preview-pages".
#   scripts/publish-preview.sh          → tests + build + local commit only (nothing pushed)
#   scripts/publish-preview.sh --push   → also push that commit to main (publishes the preview; live root unchanged)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
npm test || { echo "TESTS FAILED — not building the preview"; exit 1; }
SRC_REV="$(git rev-parse --short HEAD)"
git fetch -q origin main
WT="$(mktemp -d)/pages"
git worktree add -q -B preview-pages "$WT" origin/main
trap 'git worktree remove --force "$WT" >/dev/null 2>&1 || true' EXIT
"$ROOT/scripts/make-preview.sh" "$WT/preview"
# Root (live) files must be byte-identical to origin/main.
(cd "$WT" && git add preview && git diff --cached --name-only | grep -v '^preview/' && { echo "would change live files"; exit 1; } || true)
(cd "$WT" && git commit -qm "Preview build from $SRC_REV at /preview/ (live root unchanged)" && git log --oneline -1)
if [[ "${1:-}" == "--push" ]]; then (cd "$WT" && git push -q origin preview-pages:main) && echo "preview published: https://stewartcampbell88-commits.github.io/anvil-workout/preview/"; else echo "(local only — add --push to publish)"; fi
