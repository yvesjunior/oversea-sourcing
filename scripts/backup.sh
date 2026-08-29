#!/usr/bin/env bash
#
# Dump the OSI Postgres database AND the uploads volume to ./backups/.
# Remote (prod VM) by default; --local for the local stack.
#
# GUARDED: the `database` service ships with epic E0 (doc/BACKLOG.md). Until it
# exists in docker-compose.prod.yml, this script exits with a clear message.
#
# Two artifacts per run, because Postgres is only half the state (fixed
# 2026-08-29): buyer attachments and countersigned contracts live in the
# `osi-uploads` volume, which no dump has ever covered. A signed contract is a
# legal record; losing it because the backup only knew about rows is not a
# recoverable mistake.
#
# Usage:
#   ./scripts/backup.sh              # dump prod VM DB + uploads → ./backups/
#   ./scripts/backup.sh --local      # dump local DB + uploads → ./backups/
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
FILES_OUT="backups/osi-files-${STAMP}.tar.gz"
UPLOADS_DIR="/data/uploads"

has_db_service() {
  docker compose -f docker-compose.prod.yml config --services 2>/dev/null | grep -qx "database"
}

if [ "${1:-}" = "--local" ]; then
  has_db_service || { echo "✗ No 'database' service in docker-compose.prod.yml yet — it ships with E0 (doc/BACKLOG.md)."; exit 1; }
  mkdir -p backups
  echo "▶ Dumping local ${POSTGRES_DB} → ${OUT}"
  docker compose -f docker-compose.prod.yml exec -T database \
    pg_dump -U "${POSTGRES_USER}" "${POSTGRES_DB}" | gzip > "${OUT}"
  echo "▶ Archiving uploads → ${FILES_OUT}"
  # Through the running `web` container: the volume has no host path worth
  # depending on, and tar-ing from inside it works the same in dev and prod.
  docker compose -f docker-compose.prod.yml exec -T web \
    tar -czf - -C "${UPLOADS_DIR}" . > "${FILES_OUT}" 2>/dev/null || {
    echo "⚠ uploads archive failed — the DB dump above is still valid" >&2
    rm -f "${FILES_OUT}"
  }
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
  echo "▶ Archiving uploads on ${DEPLOY_HOST}…"
  ssh "${DEPLOY_HOST}" "
    set -euo pipefail
    cd '${DEPLOY_PATH}'
    docker compose -f docker-compose.prod.yml exec -T web \
      tar -czf - -C '${UPLOADS_DIR}' . > 'backups/osi-files-${STAMP}.tar.gz' 2>/dev/null || {
      echo '⚠ uploads archive failed — the DB dump is still valid' >&2
      rm -f 'backups/osi-files-${STAMP}.tar.gz'
    }
  "
  mkdir -p backups
  scp -q "${DEPLOY_HOST}:${DEPLOY_PATH}/backups/osi-${STAMP}.sql.gz" "${OUT}"
  scp -q "${DEPLOY_HOST}:${DEPLOY_PATH}/backups/osi-files-${STAMP}.tar.gz" "${FILES_OUT}" 2>/dev/null \
    || echo "⚠ no uploads archive to copy back"
fi

ls -lh "${OUT}" "${FILES_OUT}" 2>/dev/null || ls -lh "${OUT}"
echo "✓ Backup complete. Test restores regularly: ./scripts/restore.sh ${OUT} --local"
