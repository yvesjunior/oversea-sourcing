# OSI — Oversea Sourcing Intelligence

AI-driven industrial sourcing dashboard. Built with [Lovable](https://lovable.dev)
on TanStack Start (Vite · React · Nitro SSR) with shadcn/ui and a bilingual
**FR / EN** interface.

Continue developing in the [Lovable editor](https://lovable.dev/projects/a2274c53-10c7-432f-8ad5-d1aeff813df3).
Every change made in Lovable is committed straight to this repo; pushes to `main`
sync back into Lovable.

## Development

### Local (Node)

Needs Node.js + npm ([install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)).

```sh
npm install
npm run dev        # http://localhost:8080
```

Other scripts: `npm run build`, `npm run preview`, `npm run lint`, `npm run format`.

### Docker

A single, committed, secret-free `.env` at the root is the one config source for
the whole project (both compose files load it). Keep secrets out of it — use a
gitignored `.env.local` for local secret overrides.

```sh
# Dev — hot-reload, source mounted, http://localhost:8080
docker compose -f docker-compose.dev.yml up --build

# Prod — built image
docker compose -f docker-compose.prod.yml up --build
```

## Internationalization

- Library: `react-i18next`; French is the default, English the fallback.
- Locale files: `src/i18n/locales/{fr,en}.json` — all user-facing text lives here.
- Config: `src/i18n/config.ts`. The language toggle is in the top bar and persists
  to `localStorage`.
- Never hardcode user-facing strings in components; add a key and use `t(...)`.
  Mock data in `src/data/osi.ts` stores i18n **keys**, translated at render time.

## Project structure

| Path | Purpose |
| --- | --- |
| `src/` | Web app (frontend) |
| `src/i18n/` | i18n config + `fr`/`en` locales |
| `src/data/osi.ts` | Mock data (as i18n keys) |
| `src/database/` | Database layer — **placeholder, engine TBD** |
| `infra/Docker/` | Container images (`web.Dockerfile`; `database` TBD) |
| `docker-compose.dev.yml` / `.prod.yml` | Dev / prod orchestration |
| `.env` | Single project env file (root only; keep secret-free) |
| `doc/` | Additional documentation |

## Open decisions (TODO)

- **Database engine** — Postgres / ORM / backend service undecided. `src/database`
  is a placeholder and the `database` service is commented out in the compose files.
- **Web deploy target** — the build defaults to Cloudflare Workers. Running `web`
  as a standalone Node container needs Nitro's `node-server` preset
  (`NITRO_PRESET=node-server`); see `infra/Docker/web.Dockerfile`.
- **`src/web/`** — the frontend currently lives at `src/`. Moving it under `src/web/`
  requires rewiring the Lovable vite plugin, `tsconfig` paths and `styles.css`, and
  risks breaking Lovable editor sync — deferred.
