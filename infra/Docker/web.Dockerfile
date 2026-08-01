# ─────────────────────────────────────────────────────────────────────────────
# OSI — web app (TanStack Start · Vite · Nitro SSR)
#
# NOTE ON DEPLOY TARGET (undecided — left as a TODO):
# `npm run build` currently targets Cloudflare Workers (see vite.config.ts / the
# Lovable vite plugin). To run as a standalone Node container, the build must use
# Nitro's "node-server" preset, e.g. build with `NITRO_PRESET=node-server`.
# Until the target is locked in, the `runtime` stage below assumes a Node output
# at .output/server/index.mjs.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS base
WORKDIR /app

# ── deps: install once, cached on lockfile changes ──────────────────────────
FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci

# ── build: compile the SSR bundle ───────────────────────────────────────────
FROM deps AS build
COPY . .
# TODO: enable when standalone Node output is required:
# ENV NITRO_PRESET=node-server
RUN npm run build

# ── runtime: minimal production image ───────────────────────────────────────
FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=build /app/.output ./.output
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
