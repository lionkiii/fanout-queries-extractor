#!/usr/bin/env bash
# Build a Chrome Web Store package containing ONLY the files the extension needs.
# Uses an explicit allowlist so sample data (ai urls output.json, *.csv), the
# .claude/ dir, README, and any other stray files can never leak into the zip.
set -euo pipefail

cd "$(dirname "$0")"

OUT="dist"
ZIP="ai-url-extractor.zip"

# Runtime files only. PRIVACY.md is included because popup.html links to it.
FILES=(
  manifest.json
  background.js
  popup.html
  popup.js
  popup.css
  analytics.js
  capture-hook.js
  capture-bridge.js
  icon16.png
  icon48.png
  icon128.png
  PRIVACY.md
)

# Verify every allowlisted file exists before packaging.
for f in "${FILES[@]}"; do
  [ -f "$f" ] || { echo "ERROR: missing required file: $f" >&2; exit 1; }
done

rm -rf "$OUT"
mkdir -p "$OUT"
cp "${FILES[@]}" "$OUT"/

rm -f "$ZIP"
( cd "$OUT" && zip -r -X "../$ZIP" . )

echo ""
echo "Built $ZIP with $(unzip -l "$ZIP" | tail -1 | awk '{print $2}') files:"
unzip -Z1 "$ZIP"
