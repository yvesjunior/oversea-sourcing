# ─────────────────────────────────────────────────────────────────────────────
# OSI — web app (TanStack Start · Vite · Nitro SSR)
#
# DEPLOY TARGET: standalone Node container.
# The Lovable vite plugin defaults Nitro to the Cloudflare Workers preset, so the
# build is forced to Nitro's "node-server" preset below, producing a Node entry at
# .output/server/index.mjs. NODE_ENV=production is set explicitly — without it, a
# dev-mode JSX runtime leaks into the SSR bundle and crashes rendering at runtime.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS base
WORKDIR /app

# ── deps: install once, cached on lockfile changes ──────────────────────────
FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci

# ── build: compile the SSR bundle (standalone Node output) ───────────────────
FROM deps AS build
ENV NODE_ENV=production
ENV NITRO_PRESET=node-server
COPY . .
RUN npm run build

# ── runtime: minimal production image ───────────────────────────────────────
FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=build /app/.output ./.output
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
