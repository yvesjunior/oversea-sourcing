#!/usr/bin/env bash
#
# Talk to the OSI database. Interactive shell by default, or pass psql flags.
#
# Usage:
#   ./scripts/db.sh                            # interactive psql (dev)
#   ./scripts/db.sh -c "select count(*) from request;"
#   ./scripts/db.sh -f some/file.sql
#   ./scripts/db.sh prod -c "select 1;"        # against the prod stack on THIS host
#
# Credentials come from the compose service, not from your shell — dev uses the
# compose defaults, prod reads .env.
set -euo pipefail
cd "$(dirname "$0")/.."

ENVIRONMENT="dev"
case "${1:-}" in
  dev | prod)
    ENVIRONMENT="$1"
    shift
    ;;
esac

COMPOSE_FILE="docker-compose.${ENVIRONMENT}.yml"
[ -f "$COMPOSE_FILE" ] || {
  echo "✗ $COMPOSE_FILE not found" >&2
  exit 1
}

if ! docker compose -f "$COMPOSE_FILE" ps --status running --services 2>/dev/null | grep -qx database; then
  echo "✗ the '$ENVIRONMENT' database is not running — start it with ./scripts/${ENVIRONMENT}.sh" >&2
  exit 1
fi

# -T (no TTY) only when running a one-shot command; an interactive shell needs one.
DOCKER_FLAGS=()
[ "$#" -gt 0 ] && DOCKER_FLAGS+=(-T)

exec docker compose -f "$COMPOSE_FILE" exec "${DOCKER_FLAGS[@]}" database \
  psql -U "${POSTGRES_USER:-osi}" -d "${POSTGRES_DB:-osi}" "$@"
