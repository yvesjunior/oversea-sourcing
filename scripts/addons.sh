#!/usr/bin/env bash
#
# Enable/disable optional infrastructure add-ons (docker-compose.addons.yml).
# All add-ons are profile-gated and OFF by default — see doc/INFRA.md §8.
#
# Profiles: storage · cache · search · dbtools · monitoring · av
#
# Usage:
#   ./scripts/addons.sh storage monitoring          # enable locally (prod stack)
#   ./scripts/addons.sh --remote storage            # enable on the prod VM
#   ./scripts/addons.sh --down                      # stop ALL addon containers (local)
#   ./scripts/addons.sh --remote --down             # same, on the VM
#
# Secrets (e.g. MINIO_ROOT_PASSWORD) are read from .env.local on the target.
set -euo pipefail
cd "$(dirname "$0")/.."

DEPLOY_HOST="${DEPLOY_HOST:-yves@192.168.2.56}"
DEPLOY_PATH="${DEPLOY_PATH:-/home/yves/workspace/apps/oversea-sourcing}"
VALID_PROFILES="storage cache search dbtools monitoring av"
ADDON_SERVICES="minio redis meilisearch adminer uptime-kuma dozzle clamav"

remote=0; down=0; profiles=()
for arg in "$@"; do
  case "${arg}" in
    --remote) remote=1 ;;
    --down)   down=1 ;;
    *)
      if ! grep -qw "${arg}" <<<"${VALID_PROFILES}"; then
        echo "✗ Unknown profile '${arg}'. Valid: ${VALID_PROFILES}"; exit 1
      fi
      profiles+=("${arg}") ;;
  esac
done

if [ "${down}" = 0 ] && [ "${#profiles[@]}" = 0 ]; then
  echo "Usage: $0 [--remote] [--down] <profile…>"; echo "Profiles: ${VALID_PROFILES}"; exit 1
fi

# Build the compose command. --env-file .env.local lets compose interpolate
# secrets referenced in the addons file (compose does not read .env.local alone).
build_cmd() {
  local cmd="docker compose -f docker-compose.prod.yml -f docker-compose.addons.yml --env-file .env"
  [ -f .env.local ] && cmd+=" --env-file .env.local"
  if [ "${down}" = 1 ]; then
    # Down ONLY the addon services (never the web app). All profiles must be
    # active for compose to consider them.
    for p in ${VALID_PROFILES}; do cmd+=" --profile ${p}"; done
    cmd+=" down ${ADDON_SERVICES}"
  else
    for p in "${profiles[@]}"; do cmd+=" --profile ${p}"; done
    cmd+=" up -d"
  fi
  echo "${cmd}"
}

if [ "${remote}" = 1 ]; then
  echo "▶ On ${DEPLOY_HOST}: $(build_cmd)"
  ssh "${DEPLOY_HOST}" "cd '${DEPLOY_PATH}' && $(build_cmd)"
else
  echo "▶ Local: $(build_cmd)"
  eval "$(build_cmd)"
fi
echo "✓ Done — tool UIs bind to 127.0.0.1 on the host (use an SSH tunnel for the VM)"
