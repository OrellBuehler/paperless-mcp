#!/bin/sh
set -e
if [ "$(id -u)" = "0" ]; then
  chown -R node:node "$PAPERLESS_MCP_DATA" 2>/dev/null || true
  exec env HOME=/home/node setpriv --reuid=node --regid=node --init-groups "$@"
fi
exec "$@"
