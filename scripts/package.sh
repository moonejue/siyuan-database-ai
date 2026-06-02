#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
rm -f package.zip
zip -qr package.zip index.js index.css plugin.json README.md README_zh_CN.md icon.png preview.png LICENSE assets
printf 'Created %s/package.zip\n' "$PWD"
