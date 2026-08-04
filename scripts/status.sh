#!/usr/bin/env bash
#
# Show the state of every OSI stack: local dev, local prod, and the prod VM
# (containers + HTTP health).
#
# Usage: ./scripts/status.sh [--local-only]
# Env overrides: DEPLOY_HOST, DEPLOY_PATH, WEB_PORT (same as deploy.sh).
set -euo pipefail
cd "$(dirname "$0")/.."

DEPLOY_HOST="${DEPLOY_HOST:-yves@192.168.2.56}"
DEPLOY_PATH="${DEPLOY_PATH:-/home/yves/workspace/apps/oversea-sourcing}"
WEB_PORT="${WEB_PORT:-3010}"

echo "── Local · dev (http://localhost:3010) ─────────────────────────"
docker compose -f docker-compose.dev.yml ps 2>/dev/null | tail -n +1 || true

echo
echo "── Local · prod (http://localhost:3010) ────────────────────────"
docker compose -f docker-compose.prod.yml -f docker-compose.addons.yml ps 2>/dev/null | tail -n +1 || true

if [ "${1:-}" = "--local-only" ]; then exit 0; fi

echo
echo "── Prod VM · ${DEPLOY_HOST} (http://${DEPLOY_HOST#*@}:${WEB_PORT}) ──"
ssh -o ConnectTimeout=8 "${DEPLOY_HOST}" "
  cd '${DEPLOY_PATH}' 2>/dev/null || { echo '(not provisioned — run scripts/setup-vm.sh)'; exit 0; }
  files='-f docker-compose.prod.yml'
  [ -f docker-compose.addons.yml ] && files=\"\$files -f docker-compose.addons.yml\"
  docker compose \$files ps
  code=\$(curl -s -o /dev/null -w '%{http_code}' http://localhost:${WEB_PORT}/ || true)
  if [ \"\$code\" = '200' ]; then echo \"health: ✓ HTTP 200\"; else echo \"health: ✗ HTTP \$code\"; fi
" || echo "(VM unreachable)"
