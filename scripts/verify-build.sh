#!/usr/bin/env bash
#
# Prove the PRODUCTION bundle works before it reaches the VM.
#
# Why this exists: on 2026-08-29 a change that passed tsc, eslint, 132 tests and
# `vite dev` returned 500 on every SSR request inside the container, and prod was
# down until it was rolled back. Neither `npm run dev` nor a plain `npm run build`
# can see that failure — the plain build produces the Cloudflare Worker preset,
# while infra/Docker/web.Dockerfile forces `node-server`. Only building the way
# the container builds, and then RUNNING it, tests what actually ships.
#
# Three checks, cheapest first:
#   1. the production-preset build succeeds
#   2. no dangerous chunk cycle in the SSR bundle (scripts/check-bundle-cycles.mjs)
#   3. the built server boots and answers 200
#
# Check 3 needs a reachable database. When none is up it is SKIPPED with a
# warning rather than failing — a missing dev stack is not a broken build — but
# 1 and 2 still run, and they are the ones that caught the outage.
#
# Usage: ./scripts/verify-build.sh          (also run by scripts/deploy.sh)
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${VERIFY_PORT:-3099}"
DB_URL="${VERIFY_DATABASE_URL:-postgres://osi:local-test-password@localhost:5433/osi}"

echo "▶ 1/3 Building with the container's preset (NODE_ENV=production, NITRO_PRESET=node-server)…"
NODE_ENV=production NITRO_PRESET=node-server npm run build >/tmp/osi-verify-build.log 2>&1 || {
  echo "✗ build failed — last lines:"; tail -20 /tmp/osi-verify-build.log; exit 1;
}
echo "  ✓ built"

echo "▶ 2/3 Checking the SSR bundle for the __exportAll chunk cycle…"
node scripts/check-bundle-cycles.mjs

echo "▶ 3/3 Booting the built server on :${PORT}…"
DATABASE_URL="$DB_URL" PORT="$PORT" NODE_ENV=production \
  node .output/server/index.mjs >/tmp/osi-verify-run.log 2>&1 &
SERVER_PID=$!
# Kill it however this script ends, including on failure.
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT

code=""
for _ in $(seq 1 15); do
  sleep 1
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:${PORT}/" || true)"
  [ "$code" = "200" ] && break
done

if [ "$code" = "200" ]; then
  echo "  ✓ served HTTP 200"
elif grep -q "ECONNREFUSED\|database" /tmp/osi-verify-run.log 2>/dev/null && [ -z "$code" ]; then
  echo "  ⚠ SKIPPED — no database reachable at ${DB_URL%%\?*}. Build and bundle checks passed."
else
  echo "✗ the built server did not serve 200 (got '${code:-no response}') — log:"
  tail -20 /tmp/osi-verify-run.log
  exit 1
fi

echo "✓ Build verified — safe to deploy."
