#!/usr/bin/env bash
#
# Run OSI locally in Docker — dev mode, hot-reload, source mounted.
# Serves on http://localhost:3010 — same port as prod (Ctrl-C to stop; add -d to detach).
# Note: dev and local-prod share port 3010 — stop one before starting the other.
#
# Usage: ./scripts/dev.sh [extra docker compose args]
set -euo pipefail
cd "$(dirname "$0")/.."
exec docker compose -f docker-compose.dev.yml up --build "$@"
