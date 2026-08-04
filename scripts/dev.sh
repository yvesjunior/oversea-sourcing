#!/usr/bin/env bash
#
# Run OSI locally in Docker — dev mode, hot-reload, source mounted.
# Serves on http://localhost:8080  (Ctrl-C to stop; add -d to detach).
#
# Usage: ./scripts/dev.sh [extra docker compose args]
set -euo pipefail
cd "$(dirname "$0")/.."
exec docker compose -f docker-compose.dev.yml up --build "$@"
