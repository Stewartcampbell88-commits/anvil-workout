#!/usr/bin/env bash
# Build the /preview/ copy of the current tree into OUT (default: ./preview).
# The preview detects /preview/ in its URL and then: prefixes every localStorage key with "anvil-preview:",
# switches Google Sheet sync + Restore off, and uses its own service-worker caches. See PREVIEW.md.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/preview}"
rm -rf "$OUT"; mkdir -p "$OUT"
for f in index.html sw.js favicon.svg icon.svg icon-192.png icon-192-maskable.png icon-512.png icon-512-maskable.png; do cp "$ROOT/$f" "$OUT/"; done
for d in css js sounds; do cp -r "$ROOT/$d" "$OUT/"; done
python3 - "$ROOT/manifest.json" "$OUT/manifest.json" <<'PY'
import json, sys
m = json.load(open(sys.argv[1]))
m.update({"name": "ANVIL Preview", "short_name": "ANVIL β", "id": "./", "description": "ANVIL test build (own data, no sync)"})
json.dump(m, open(sys.argv[2], "w"), indent=2)
PY
sed -i 's#<title>ANVIL</title>#<title>ANVIL Preview</title>#' "$OUT/index.html"
echo "preview built in $OUT ($(grep -o 'anvil-v[0-9]*' "$ROOT/js/core.js" | head -1))"
