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

| Situation                        | Command                                                                    |
| -------------------------------- | -------------------------------------------------------------------------- |
| **New machine, first time**      | `./scripts/setup.sh` — checks Docker, creates `.env.local`                 |
| **Develop locally** (hot-reload) | `./scripts/dev.sh` → http://localhost:3010                                 |
| **Test the prod image locally**  | `./scripts/prod.sh` → http://localhost:3010 (stop dev first — same port)   |
| **Stop local stacks**            | `./scripts/stop.sh [dev\|prod\|all]` (volumes kept)                        |
| **Provision a (new) prod VM**    | `./scripts/setup-vm.sh` — Docker check, clone, `.env.local`                |
| **Deploy to prod**               | `./scripts/deploy.sh` — pull `main`, rebuild, restart, health-check        |
| **See what's running where**     | `./scripts/status.sh` — local + VM containers & health                     |
| **Follow logs**                  | `./scripts/logs.sh [dev\|prod]` · `./scripts/logs.sh --remote`             |
| **Enable optional infra**        | `./scripts/addons.sh [--remote] storage monitoring …`                      |
| **Disable optional infra**       | `./scripts/addons.sh [--remote] --down` (never touches the app)            |
| **Back up the database**         | `./scripts/backup.sh [--local]` → `./backups/`                             |
| **Restore a backup**             | `./scripts/restore.sh <dump> --local\|--remote` _(destructive, confirmed)_ |

All remote scripts default to `DEPLOY_HOST=yves@192.168.2.56`,
`DEPLOY_PATH=/home/yves/workspace/apps/oversea-sourcing`, `WEB_PORT=3010`,
`BRANCH=main` — override any of them per run:

```sh
BRANCH=hotfix/my-branch WEB_PORT=3011 ./scripts/deploy.sh
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

Prod is live at **https://osi-solutions.com** — served from the VM through a
**Cloudflare Tunnel** (`cloudflared` container; LAN address for direct access:
http://192.168.2.56:3010). **Currently in test phase**: prod runs the seeded
demo data (accounts, dossiers, 12-supplier pool) with the test login box
enabled — all of it gets wiped before real users. Optional add-on components
(MinIO, Redis, Meilisearch, Uptime-Kuma, Dozzle, ClamAV, Adminer) are
profile-gated in `docker-compose.addons.yml` — off by default, catalog and
enable-triggers in [doc/INFRA.md](doc/INFRA.md).

### Database & auth

The stack includes Postgres 16 (+pgvector) and [better-auth](https://better-auth.com)
(email/password; Google activates automatically once `GOOGLE_CLIENT_ID/SECRET` are set —
prod needs a domain + TLS first). Migrations run automatically on every
`up` via the one-shot `migrate` service.

```sh
npm run db:generate   # generate a migration after editing src/database/schema.ts
npm run db:migrate    # apply migrations (compose does this automatically)
npm run db:studio     # browse the dev database (drizzle-kit studio)

# Seed demo accounts (dev only) — password: osi-demo-1234
docker compose -f docker-compose.dev.yml exec web npm run db:seed
# owner@osi.dev · manager@osi.dev · accountant@osi.dev (platform employees)
# buyer@osi.dev (regular buyer, seeded with 6 demo dossiers incl. criteria/chat/matches)
# + a 12-supplier platform-global pool (stands in for the E4 import pipeline)
```

A one-click **"Connexion rapide — test"** box on `/login` signs in as any demo
account: always visible in dev builds, and elsewhere when `SHOW_TEST_LOGIN=true`
(runtime flag, read per request — a container restart is enough). It is **on**
in the committed `.env` for the current test phase; set it to `false` before
real users, the seeded credentials are public.

Required secrets in `.env.local` (**prod**): `POSTGRES_PASSWORD`, `DATABASE_URL`,
`BETTER_AUTH_SECRET` (32+ chars), `BETTER_AUTH_URL`. Dev uses safe defaults baked
into `docker-compose.dev.yml` — nothing to configure. Both compose files also load
`.env.local` so `ANTHROPIC_API_KEY` reaches the containers.

### Background worker & AI (E3)

A third process — `worker` (same image, [`src/worker.ts`](src/worker.ts), pg-boss
queue in Postgres) — runs the request pipeline asynchronously.

**There is no pre-search AI analysis (removed 2026-08-05).** An ℹ️ info helper
on the hero prompt guides buyers to structured input; the platform does the
rest without spending a token. AI is reserved for supplier research (E4) and
the flag-gated chat:

1. **Create** (`createRequestFn`): the hero prompt inserts a `request` (ids
   from `request_id_seq`, `#3000+`), **parses criteria synchronously at
   intake** (`src/server/parse-criteria.ts`, deterministic regex — instant,
   zero tokens, still manually editable on the dossier) and enqueues the
   pipeline. No pause, no analysis stage.
2. **Pipeline** (worker): `received → searching → validating → report_ready`.
   During `searching` it scores the platform-global `supplier` pool and
   persists a ranked Top-5 in `match` (deterministic heuristic in
   `src/server/matching.ts` — the E5 seam replaced by the real engine later).
3. **Recovery sweep**: on boot and every 60 s the worker re-adopts requests
   stranded mid-pipeline (crash, lost enqueue) and runs them to completion.

| Flag      | OFF (default)                                       | ON                                                      |
| --------- | ---------------------------------------------------- | ------------------------------------------------------- |
| `AI_CHAT` | Assistant chat hidden (server refuses new messages) | Per-request assistant chat (can apply criteria changes) |

Legacy note: dossiers created under the old flow may rest in the `analyzing`
status — they keep a manual "Lancer la recherche" button and are otherwise
handled by the same pipeline.

Every status change writes a `request_event` row — timelines, activity feeds and
dashboard stats are pure read-models of the DB. Attachments upload via
`/api/upload` to a named volume (`UPLOAD_DIR`, S3-swappable adapter in
`src/server/storage.ts`). Worker logs: `./scripts/logs.sh dev worker`.

> Public ingress + TLS are handled by the **Cloudflare Tunnel** on
> [osi-solutions.com](https://osi-solutions.com) — the container is not exposed
> to the internet directly. `BETTER_AUTH_URL` in the VM's `.env.local` must be
> the public origin (`https://osi-solutions.com`), otherwise better-auth rejects
> logins from the domain with `INVALID_ORIGIN`.

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
  Remaining showcase data in `src/data/osi.ts` stores i18n **keys**, translated at
  render time (requests, criteria, chat AND suppliers/matches are DB-backed;
  only transactions/analyses remain showcase until E8).

## Project structure

| Path                                   | Purpose                                                                                  |
| -------------------------------------- | ---------------------------------------------------------------------------------------- |
| `src/`                                 | Web app (frontend)                                                                       |
| `src/i18n/`                            | i18n config + `fr`/`en` locales                                                          |
| `src/data/osi.ts`                      | Remaining showcase data (transactions/analyses — E8)                                     |
| `src/database/`                        | Drizzle schema, migrations, seed (Postgres 16 + pgvector)                                |
| `src/server/`                          | Server-only modules: auth, AI gateway (`ai/`), queue, matching, storage, transitions     |
| `src/worker.ts`                        | Background worker entrypoint (pg-boss: extraction + pipeline jobs)                       |
| `src/lib/*-fns.ts`                     | Server functions (requests, criteria, chat, suppliers, stats) — zod-validated            |
| `infra/Docker/`                        | Container images (`web.Dockerfile`; database uses the pgvector image)                    |
| `docker-compose.dev.yml` / `.prod.yml` | Dev / prod orchestration                                                                 |
| `docker-compose.addons.yml`            | Optional infra (profile-gated, off by default) — see `doc/INFRA.md`                      |
| `scripts/`                             | `dev.sh` / `prod.sh` (local Docker) · `deploy.sh` (prod VM)                              |
| `.env`                                 | Single project env file (root only; keep secret-free)                                    |
| `doc/`                                 | `PLAN.md` (product) · `BACKLOG.md` (MVP1 tasks/data model) · `INFRA.md` (infrastructure) |

## Open decisions (TODO)

- **`src/web/`** — the frontend currently lives at `src/`. Moving it under `src/web/`
  requires rewiring the Lovable vite plugin, `tsconfig` paths and `styles.css`, and
  risks breaking Lovable editor sync — deferred.
