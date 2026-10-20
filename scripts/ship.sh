#!/usr/bin/env bash
# Ship the current branch to live (GitHub Pages = origin/main). Refuses on any failing test.
#   scripts/ship.sh            → checks only (tests, version bump, clean tree); pushes nothing
#   scripts/ship.sh --push     → after the checks: fast-forward main to this branch, push, wait for Pages
# Only run --push after Stewart has OK'd the preview.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
PAGES="https://stewartcampbell88-commits.github.io/anvil-workout"
BR="$(git rev-parse --abbrev-ref HEAD)"
[[ -z "$(git status --porcelain)" ]] || { echo "Working tree not clean"; exit 1; }
[[ -d node_modules ]] || npm ci --no-audit --no-fund
npm test || { echo "TESTS FAILED — not shipping"; exit 1; }
V="$(grep -oE 'const APP_VERSION = "anvil-v[0-9]+"' js/core.js | grep -oE 'anvil-v[0-9]+')"
git fetch -q origin main
LIVE="$(git show origin/main:sw.js | grep -oE 'const CACHE = "anvil-v[0-9]+"' | grep -oE 'anvil-v[0-9]+')"
[[ "$V" != "$LIVE" ]] || { echo "Version not bumped (still $LIVE) — run scripts/bump-version.sh"; exit 1; }
git merge-base --is-ancestor origin/main HEAD || { echo "$BR is not based on origin/main — rebase first"; exit 1; }
echo "OK to ship $V from $BR (live is $LIVE)"
[[ "${1:-}" == "--push" ]] || { echo "(dry run — add --push to publish)"; exit 0; }
git push -q origin "HEAD:main"
echo "pushed $(git rev-parse --short HEAD) to main; waiting for Pages"
for i in $(seq 1 30); do
  if curl -s "$PAGES/sw.js?$(date +%s)" | grep -q "\"$V\""; then echo "LIVE: $V"; exit 0; fi
  sleep 10
done
echo "not live yet after 5 min"; exit 2
