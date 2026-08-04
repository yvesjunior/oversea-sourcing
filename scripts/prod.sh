#!/usr/bin/env bash
#
# Build & run the production Node image locally in Docker (for testing the
# prod build on your machine — not the remote VM; use scripts/deploy.sh for that).
# Serves on http://localhost:3010.
#
# Usage: ./scripts/prod.sh [extra docker compose args]
set -euo pipefail
cd "$(dirname "$0")/.."
exec docker compose -f docker-compose.prod.yml up -d --build "$@"
