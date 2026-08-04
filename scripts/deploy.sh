#!/usr/bin/env bash
#
# Deploy OSI to the production VM.
# Pulls the latest branch on the VM, rebuilds the standalone Node image,
# restarts the container, and health-checks it.
#
# Override defaults via env vars:
#   DEPLOY_HOST  (default: yves@192.168.2.56)
#   DEPLOY_PATH  (default: /home/yves/workspace/apps/oversea-sourcing)
#   WEB_PORT     (default: 3010)
#   BRANCH       (default: main)
#
# Usage: ./scripts/deploy.sh
set -euo pipefail

DEPLOY_HOST="${DEPLOY_HOST:-yves@192.168.2.56}"
DEPLOY_PATH="${DEPLOY_PATH:-/home/yves/workspace/apps/oversea-sourcing}"
WEB_PORT="${WEB_PORT:-3010}"
BRANCH="${BRANCH:-main}"

echo "▶ Deploying OSI → ${DEPLOY_HOST}:${DEPLOY_PATH} (branch ${BRANCH}, port ${WEB_PORT})"

ssh "${DEPLOY_HOST}" "bash -s -- '${DEPLOY_PATH}' '${WEB_PORT}' '${BRANCH}'" <<'REMOTE'
set -euo pipefail
DEPLOY_PATH="$1"; export WEB_PORT="$2"; BRANCH="$3"

cd "${DEPLOY_PATH}"

echo "▶ Pulling ${BRANCH}…"
git fetch --quiet origin
git checkout --quiet "${BRANCH}"
git pull --ff-only origin "${BRANCH}"
echo "  now at: $(git --no-pager log --oneline -1)"

echo "▶ Building & starting prod container…"
docker compose -f docker-compose.prod.yml up -d --build

echo "▶ Health check on :${WEB_PORT}…"
for _ in $(seq 1 30); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:${WEB_PORT}/" || true)"
  if [ "${code}" = "200" ]; then
    echo "✓ Healthy (HTTP 200) on port ${WEB_PORT}"
    exit 0
  fi
  sleep 2
done
echo "✗ Health check failed — recent logs:"
docker compose -f docker-compose.prod.yml logs --tail=30 web
exit 1
REMOTE

echo "✓ Deployed → http://${DEPLOY_HOST#*@}:${WEB_PORT}"
