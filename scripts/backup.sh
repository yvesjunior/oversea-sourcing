#!/usr/bin/env bash
#
# Dump the OSI Postgres database to a compressed file in ./backups/.
# Remote (prod VM) by default; --local for the local stack.
#
# GUARDED: the `database` service ships with epic E0 (doc/BACKLOG.md). Until it
# exists in docker-compose.prod.yml, this script exits with a clear message.
#
# Usage:
#   ./scripts/backup.sh              # dump prod VM DB → ./backups/ (scp'd back)
#   ./scripts/backup.sh --local      # dump local DB → ./backups/
#
# Env overrides: DEPLOY_HOST, DEPLOY_PATH, POSTGRES_DB (default: osi), POSTGRES_USER (default: osi)
set -euo pipefail
cd "$(dirname "$0")/.."

DEPLOY_HOST="${DEPLOY_HOST:-yves@192.168.2.56}"
DEPLOY_PATH="${DEPLOY_PATH:-/home/yves/workspace/apps/oversea-sourcing}"
POSTGRES_DB="${POSTGRES_DB:-osi}"
POSTGRES_USER="${POSTGRES_USER:-osi}"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="backups/osi-${STAMP}.sql.gz"

has_db_service() {
  docker compose -f docker-compose.prod.yml config --services 2>/dev/null | grep -qx "database"
}

if [ "${1:-}" = "--local" ]; then
  has_db_service || { echo "✗ No 'database' service in docker-compose.prod.yml yet — it ships with E0 (doc/BACKLOG.md)."; exit 1; }
  mkdir -p backups
  echo "▶ Dumping local ${POSTGRES_DB} → ${OUT}"
  docker compose -f docker-compose.prod.yml exec -T database \
    pg_dump -U "${POSTGRES_USER}" "${POSTGRES_DB}" | gzip > "${OUT}"
else
  echo "▶ Dumping ${POSTGRES_DB} on ${DEPLOY_HOST}…"
  ssh "${DEPLOY_HOST}" "
    set -euo pipefail
    cd '${DEPLOY_PATH}'
    docker compose -f docker-compose.prod.yml config --services | grep -qx database \
      || { echo '✗ No database service on the VM yet — ships with E0.'; exit 1; }
    mkdir -p backups
    docker compose -f docker-compose.prod.yml exec -T database \
      pg_dump -U '${POSTGRES_USER}' '${POSTGRES_DB}' | gzip > 'backups/osi-${STAMP}.sql.gz'
  "
  mkdir -p backups
  scp -q "${DEPLOY_HOST}:${DEPLOY_PATH}/backups/osi-${STAMP}.sql.gz" "${OUT}"
fi

ls -lh "${OUT}"
echo "✓ Backup complete. Test restores regularly: ./scripts/restore.sh ${OUT} --local"
