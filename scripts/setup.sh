#!/usr/bin/env bash
#
# First-time LOCAL setup: verify prerequisites and prepare .env.local.
# Safe to re-run (idempotent).
#
# Usage: ./scripts/setup.sh
set -euo pipefail
cd "$(dirname "$0")/.."

echo "▶ Checking prerequisites…"
command -v docker >/dev/null 2>&1 || { echo "✗ Docker is required → https://docs.docker.com/get-docker/"; exit 1; }
docker info >/dev/null 2>&1 || { echo "✗ Docker daemon is not running — start Docker Desktop / dockerd"; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "✗ docker compose v2 is required"; exit 1; }
echo "✓ $(docker --version)"
echo "✓ $(docker compose version --short | sed 's/^/compose /')"

if [ ! -f .env.local ]; then
  cat > .env.local <<'EOF'
# ── OSI local secrets — gitignored. ──────────────────────────────────────────
# The committed .env holds only non-secret config; every secret lives here.
# Fill values in as the matching component gets enabled (see doc/INFRA.md §8).

# Add-ons (docker-compose.addons.yml)
# MINIO_ROOT_PASSWORD=
# MEILI_MASTER_KEY=

# Database (arrives with E0 — see doc/BACKLOG.md)
# DATABASE_URL=

# AI (arrives with E3)
# ANTHROPIC_API_KEY=
EOF
  echo "✓ Created .env.local (fill in secrets as components get enabled)"
else
  echo "✓ .env.local already present — left untouched"
fi

echo
echo "Done. Next steps:"
echo "  ./scripts/dev.sh     # run the app locally (hot-reload) → http://localhost:3010"
echo "  ./scripts/prod.sh    # test the production image locally → http://localhost:3010"
echo "  (dev and local-prod share port 3010 — run one at a time)"
