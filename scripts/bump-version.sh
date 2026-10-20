#!/usr/bin/env bash
# Usage: scripts/bump-version.sh 44   → APP_VERSION, sw.js CACHE and every ?v= in index.html/sw.js become anvil-v44.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
N="${1:?usage: bump-version.sh <number>}"; [[ "$N" =~ ^[0-9]+$ ]] || { echo "number only"; exit 1; }
V="anvil-v$N"
sed -i -E "s/const APP_VERSION = \"anvil-v[0-9]+\"/const APP_VERSION = \"$V\"/" "$ROOT/js/core.js"
sed -i -E "s/const CACHE = \"anvil-v[0-9]+\"/const CACHE = \"$V\"/; s/\?v=anvil-v[0-9]+/?v=$V/g" "$ROOT/sw.js"
sed -i -E "s/\?v=anvil-v[0-9]+/?v=$V/g" "$ROOT/index.html"
grep -c "$V" "$ROOT/js/core.js" "$ROOT/sw.js" "$ROOT/index.html"
