#!/usr/bin/env bash
#
# Stop local Docker stacks (containers + networks; volumes are kept).
# Also removes any addon containers (as orphans of the same project).
#
# Usage: ./scripts/stop.sh [dev|prod|all]   (default: all)
set -euo pipefail
cd "$(dirname "$0")/.."

target="${1:-all}"

stop_dev()  { echo "▶ Stopping dev stack…";  docker compose -f docker-compose.dev.yml down --remove-orphans; }
stop_prod() { echo "▶ Stopping prod stack…"; docker compose -f docker-compose.prod.yml -f docker-compose.addons.yml down --remove-orphans; }

case "${target}" in
  dev)  stop_dev ;;
  prod) stop_prod ;;
  all)  stop_dev; stop_prod ;;
  *) echo "Usage: $0 [dev|prod|all]"; exit 1 ;;
esac
echo "✓ Done (volumes preserved)"
