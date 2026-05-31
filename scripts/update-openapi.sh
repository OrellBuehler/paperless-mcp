#!/usr/bin/env bash
set -euo pipefail

: "${PAPERLESS_URL:?Set PAPERLESS_URL to your Paperless-ngx base URL}"
: "${PAPERLESS_TOKEN:?Set PAPERLESS_TOKEN to your Paperless-ngx API token}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/paperless-openapi.yaml}"

curl -fsSL \
  -H "Authorization: Token ${PAPERLESS_TOKEN}" \
  "${PAPERLESS_URL%/}/api/schema/" \
  -o "$OUT"

echo "Wrote $OUT (version $(grep -m1 '^  version:' "$OUT" | sed 's/^  version: //'))"
