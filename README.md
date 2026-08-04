# OSI — Oversea Sourcing Intelligence

AI-driven industrial sourcing dashboard. Built with [Lovable](https://lovable.dev)
on TanStack Start (Vite · React · Nitro SSR) with shadcn/ui and a bilingual
**FR / EN** interface.

Continue developing in the [Lovable editor](https://lovable.dev/projects/a2274c53-10c7-432f-8ad5-d1aeff813df3).
Every change made in Lovable is committed straight to this repo; pushes to `main`
sync back into Lovable.

## Scripts — how to proceed in each case

Everything operational is a script in [`scripts/`](scripts). Config comes from the
single committed, secret-free [`.env`](.env); secrets live in a gitignored
`.env.local` (created by the setup scripts).

| Situation | Command |
| --- | --- |
| **New machine, first time** | `./scripts/setup.sh` — checks Docker, creates `.env.local` |
| **Develop locally** (hot-reload) | `./scripts/dev.sh` → http://localhost:3010 |
| **Test the prod image locally** | `./scripts/prod.sh` → http://localhost:3010 (stop dev first — same port) |
| **Stop local stacks** | `./scripts/stop.sh [dev\|prod\|all]` (volumes kept) |
| **Provision a (new) prod VM** | `./scripts/setup-vm.sh` — Docker check, clone, `.env.local` |
| **Deploy to prod** | `./scripts/deploy.sh` — pull `main`, rebuild, restart, health-check |
| **See what's running where** | `./scripts/status.sh` — local + VM containers & health |
| **Follow logs** | `./scripts/logs.sh [dev\|prod]` · `./scripts/logs.sh --remote` |
| **Enable optional infra** | `./scripts/addons.sh [--remote] storage monitoring …` |
| **Disable optional infra** | `./scripts/addons.sh [--remote] --down` (never touches the app) |
| **Back up the database** | `./scripts/backup.sh [--local]` → `./backups/` *(active once E0 lands)* |
| **Restore a backup** | `./scripts/restore.sh <dump> --local\|--remote` *(destructive, confirmed)* |

All remote scripts default to `DEPLOY_HOST=yves@192.168.2.56`,
`DEPLOY_PATH=/home/yves/workspace/apps/oversea-sourcing`, `WEB_PORT=3010`,
`BRANCH=main` — override any of them per run:

```sh
BRANCH=staging WEB_PORT=3011 ./scripts/deploy.sh
```

### Typical flows

```sh
# Day-to-day development
./scripts/setup.sh && ./scripts/dev.sh

# Ship to production
git push && ./scripts/deploy.sh && ./scripts/status.sh

# Bring up monitoring + object storage on the VM
./scripts/addons.sh --remote monitoring storage
```

Prod is live at **http://192.168.2.56:3010**. Optional add-on components
(MinIO, Redis, Meilisearch, Uptime-Kuma, Dozzle, ClamAV, Adminer) are
profile-gated in `docker-compose.addons.yml` — off by default, catalog and
enable-triggers in [doc/INFRA.md](doc/INFRA.md).

> No reverse proxy / TLS / firewall sits in front of the container yet — it's
> exposed directly on the VM's LAN. Required before any external user (see INFRA §7).

### Without Docker (plain Node)

```sh
npm install && npm run dev    # http://localhost:8080 (Vite's own port — Docker maps it to 3010)
```

Other npm scripts: `build`, `preview`, `lint`, `format`.

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
| `docker-compose.addons.yml` | Optional infra (profile-gated, off by default) — see `doc/INFRA.md` |
| `scripts/` | `dev.sh` / `prod.sh` (local Docker) · `deploy.sh` (prod VM) |
| `.env` | Single project env file (root only; keep secret-free) |
| `doc/` | `PLAN.md` (product) · `BACKLOG.md` (MVP1 tasks/data model) · `INFRA.md` (infrastructure) |

## Open decisions (TODO)

- **Database engine** — Postgres / ORM / backend service undecided. `src/database`
  is a placeholder and the `database` service is commented out in the compose files.
- **`src/web/`** — the frontend currently lives at `src/`. Moving it under `src/web/`
  requires rewiring the Lovable vite plugin, `tsconfig` paths and `styles.css`, and
  risks breaking Lovable editor sync — deferred.
