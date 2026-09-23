#!/usr/bin/env bash
# Rebuild com.anvil.workout APK: replace assets/www from repo web source, bump version, sign.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT"
WWW_FILES=(index.html manifest.json sw.js favicon.svg icon.svg
  icon-192.png icon-192-maskable.png icon-512.png icon-512-maskable.png)

# Tool locations (override via env)
APKTOOL_JAR="${APKTOOL_JAR:-/workspace/tools/apktool.jar}"
ANDROID_HOME="${ANDROID_HOME:-/workspace/tools/android-sdk}"
BUILD_TOOLS="${BUILD_TOOLS:-$ANDROID_HOME/build-tools/35.0.0}"
PATH="/usr/lib/jvm/java-21-openjdk-amd64/bin:$BUILD_TOOLS:$PATH"

DECODE_DIR="${DECODE_DIR:-/workspace/anvil-apk-decoded}"
BUILD_DIR="${BUILD_DIR:-/workspace/anvil-build}"
KEYSTORE="${KEYSTORE:-$ROOT/android/anvil-release.keystore}"
PASS_FILE="${PASS_FILE:-$ROOT/android/keystore.pass}"
OUT_APK="${OUT_APK:-$ROOT/dist/anvil-workout.apk}"
BASE_APK="${BASE_APK:-}"

usage() {
  cat <<USAGE
Usage: $0 [--base-apk PATH] [--version-code N] [--version-name X.Y]

  Replaces assets/www in a decoded APK tree with web files from the repo root,
  bumps version, rebuilds, zipaligns, and signs with android/anvil-release.keystore.

  If DECODE_DIR is missing and --base-apk is set, apktool-decodes first.
USAGE
}

VERSION_CODE=""
VERSION_NAME=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --base-apk) BASE_APK="$2"; shift 2 ;;
    --version-code) VERSION_CODE="$2"; shift 2 ;;
    --version-name) VERSION_NAME="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown arg: $1"; usage; exit 1 ;;
  esac
done

command -v java >/dev/null || { echo "java required"; exit 1; }
[[ -f "$APKTOOL_JAR" ]] || { echo "Missing apktool jar: $APKTOOL_JAR"; exit 1; }
[[ -x "$BUILD_TOOLS/apksigner" ]] || { echo "Missing build-tools at $BUILD_TOOLS"; exit 1; }
[[ -f "$KEYSTORE" && -f "$PASS_FILE" ]] || { echo "Missing keystore or pass file (see android/SIGNING.md)"; exit 1; }

if [[ ! -d "$DECODE_DIR" ]]; then
  [[ -n "$BASE_APK" && -f "$BASE_APK" ]] || { echo "No DECODE_DIR and no --base-apk"; exit 1; }
  java -jar "$APKTOOL_JAR" d -f -o "$DECODE_DIR" "$BASE_APK"
fi

WWW="$DECODE_DIR/assets/www"
mkdir -p "$WWW"
rm -rf "$WWW"/*
for f in "${WWW_FILES[@]}"; do
  [[ -f "$SRC/$f" ]] || { echo "Missing web asset: $SRC/$f"; exit 1; }
  cp "$SRC/$f" "$WWW/"
done

# Bump version in apktool.yml
if [[ -n "$VERSION_CODE" ]]; then
  sed -i "s/^  versionCode:.*/  versionCode: $VERSION_CODE/" "$DECODE_DIR/apktool.yml"
fi
if [[ -n "$VERSION_NAME" ]]; then
  sed -i "s/^  versionName:.*/  versionName: $VERSION_NAME/" "$DECODE_DIR/apktool.yml"
fi

mkdir -p "$BUILD_DIR" "$(dirname "$OUT_APK")"
UNSIGNED="$BUILD_DIR/anvil-unsigned.apk"
ALIGNED="$BUILD_DIR/anvil-aligned.apk"

java -jar "$APKTOOL_JAR" b -o "$UNSIGNED" "$DECODE_DIR"
zipalign -f -p 4 "$UNSIGNED" "$ALIGNED"

STOREPASS="$(cat "$PASS_FILE")"
apksigner sign \
  --ks "$KEYSTORE" \
  --ks-key-alias anvil \
  --ks-pass "pass:$STOREPASS" \
  --key-pass "pass:$STOREPASS" \
  --out "$OUT_APK" \
  "$ALIGNED"

apksigner verify --print-certs "$OUT_APK"
echo "Built: $OUT_APK"
aapt dump badging "$OUT_APK" | head -1
