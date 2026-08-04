#!/usr/bin/env bash
#
# Follow container logs — local by default, prod VM with --remote.
#
# Usage:
#   ./scripts/logs.sh [dev|prod] [service]      # local (default: prod, service: web)
#   ./scripts/logs.sh --remote [service]        # prod VM
#
# Env overrides for --remote: DEPLOY_HOST, DEPLOY_PATH (same as deploy.sh).
set -euo pipefail
cd "$(dirname "$0")/.."

DEPLOY_HOST="${DEPLOY_HOST:-yves@192.168.2.56}"
DEPLOY_PATH="${DEPLOY_PATH:-/home/yves/workspace/apps/oversea-sourcing}"

if [ "${1:-}" = "--remote" ]; then
  service="${2:-web}"
  echo "▶ Following ${service} logs on ${DEPLOY_HOST} (Ctrl-C to stop)…"
  exec ssh -t "${DEPLOY_HOST}" \
    "cd '${DEPLOY_PATH}' && docker compose -f docker-compose.prod.yml logs -f --tail=100 '${service}'"
fi

stack="${1:-prod}"
service="${2:-web}"
case "${stack}" in
  dev)  file=docker-compose.dev.yml ;;
  prod) file=docker-compose.prod.yml ;;
  *) echo "Usage: $0 [dev|prod] [service]  |  $0 --remote [service]"; exit 1 ;;
esac
exec docker compose -f "${file}" logs -f --tail=100 "${service}"
