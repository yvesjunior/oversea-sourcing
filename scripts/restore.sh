#!/usr/bin/env bash
#
# Restore an OSI Postgres dump (made by ./scripts/backup.sh).
# DESTRUCTIVE: replaces the target database content. Asks for confirmation.
#
# GUARDED: requires the `database` service (ships with E0 — doc/BACKLOG.md).
#
# Usage:
#   ./scripts/restore.sh backups/osi-YYYYmmdd-HHMMSS.sql.gz --local    # into local DB
#   ./scripts/restore.sh backups/osi-YYYYmmdd-HHMMSS.sql.gz --remote   # into prod VM DB
#
# Env overrides: DEPLOY_HOST, DEPLOY_PATH, POSTGRES_DB (default: osi), POSTGRES_USER (default: osi)
set -euo pipefail
cd "$(dirname "$0")/.."

DEPLOY_HOST="${DEPLOY_HOST:-yves@192.168.2.56}"
DEPLOY_PATH="${DEPLOY_PATH:-/home/yves/workspace/apps/oversea-sourcing}"
POSTGRES_DB="${POSTGRES_DB:-osi}"
POSTGRES_USER="${POSTGRES_USER:-osi}"

DUMP="${1:-}"; TARGET="${2:-}"
[ -n "${DUMP}" ] && [ -f "${DUMP}" ] || { echo "Usage: $0 <dump.sql.gz> --local|--remote"; exit 1; }
[ "${TARGET}" = "--local" ] || [ "${TARGET}" = "--remote" ] || { echo "Specify --local or --remote explicitly."; exit 1; }

echo "⚠ This will REPLACE the '${POSTGRES_DB}' database (${TARGET#--}) with ${DUMP}."
read -r -p "Type 'restore' to confirm: " answer
[ "${answer}" = "restore" ] || { echo "Aborted."; exit 1; }

if [ "${TARGET}" = "--local" ]; then
  docker compose -f docker-compose.prod.yml config --services | grep -qx database \
    || { echo "✗ No 'database' service yet — ships with E0 (doc/BACKLOG.md)."; exit 1; }
  echo "▶ Restoring into local ${POSTGRES_DB}…"
  gunzip -c "${DUMP}" | docker compose -f docker-compose.prod.yml exec -T database \
    psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" --set ON_ERROR_STOP=1 --quiet
else
  echo "▶ Copying dump to ${DEPLOY_HOST}…"
  ssh "${DEPLOY_HOST}" "mkdir -p '${DEPLOY_PATH}/backups'"
  scp -q "${DUMP}" "${DEPLOY_HOST}:${DEPLOY_PATH}/backups/_restore.sql.gz"
  echo "▶ Restoring into ${POSTGRES_DB} on the VM…"
  ssh "${DEPLOY_HOST}" "
    set -euo pipefail
    cd '${DEPLOY_PATH}'
    docker compose -f docker-compose.prod.yml config --services | grep -qx database \
      || { echo '✗ No database service on the VM yet — ships with E0.'; exit 1; }
    gunzip -c backups/_restore.sql.gz | docker compose -f docker-compose.prod.yml exec -T database \
      psql -U '${POSTGRES_USER}' -d '${POSTGRES_DB}' --set ON_ERROR_STOP=1 --quiet
    rm -f backups/_restore.sql.gz
  "
fi
echo "✓ Restore complete."
