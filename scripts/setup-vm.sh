#!/usr/bin/env bash
#
# Provision a (new) production VM: verify Docker, clone the repo, prepare
# .env.local — then hand off to ./scripts/deploy.sh for the first deploy.
# Idempotent: safe to re-run on an already-provisioned VM.
#
# Docker is NOT installed automatically (needs sudo); if missing, the script
# prints the exact commands and exits.
#
# Override defaults via env vars:
#   DEPLOY_HOST  (default: yves@192.168.2.56)
#   DEPLOY_PATH  (default: /home/yves/workspace/apps/oversea-sourcing)
#   REPO_URL     (default: git@github.com:yvesjunior/oversea-sourcing.git)
#
# Usage: ./scripts/setup-vm.sh
set -euo pipefail

DEPLOY_HOST="${DEPLOY_HOST:-yves@192.168.2.56}"
DEPLOY_PATH="${DEPLOY_PATH:-/home/yves/workspace/apps/oversea-sourcing}"
REPO_URL="${REPO_URL:-git@github.com:yvesjunior/oversea-sourcing.git}"

echo "▶ Provisioning ${DEPLOY_HOST} → ${DEPLOY_PATH}"

ssh "${DEPLOY_HOST}" "bash -s -- '${DEPLOY_PATH}' '${REPO_URL}'" <<'REMOTE'
set -euo pipefail
DEPLOY_PATH="$1"; REPO_URL="$2"

echo "▶ Checking Docker…"
if ! command -v docker >/dev/null 2>&1; then
  echo "✗ Docker is not installed. Install it first (needs sudo):"
  echo "    curl -fsSL https://get.docker.com | sudo sh"
  echo "    sudo usermod -aG docker \$USER   # then log out/in"
  exit 1
fi
docker info >/dev/null 2>&1 || { echo "✗ Docker daemon not running / no permission (usermod -aG docker?)"; exit 1; }
echo "✓ $(docker --version)"

echo "▶ Repository…"
if [ -d "${DEPLOY_PATH}/.git" ]; then
  echo "✓ Repo already present at ${DEPLOY_PATH}"
else
  mkdir -p "$(dirname "${DEPLOY_PATH}")"
  git clone "${REPO_URL}" "${DEPLOY_PATH}"
  echo "✓ Cloned ${REPO_URL}"
fi

cd "${DEPLOY_PATH}"
if [ ! -f .env.local ]; then
  cat > .env.local <<'EOF'
# ── OSI prod secrets — NEVER commit. Fill in as components get enabled. ──────
# MINIO_ROOT_PASSWORD=
# MEILI_MASTER_KEY=
# DATABASE_URL=
# ANTHROPIC_API_KEY=
EOF
  chmod 600 .env.local
  echo "✓ Created ${DEPLOY_PATH}/.env.local (fill in prod secrets)"
else
  echo "✓ .env.local already present — left untouched"
fi
REMOTE

echo
echo "✓ VM provisioned. Next: ./scripts/deploy.sh"
