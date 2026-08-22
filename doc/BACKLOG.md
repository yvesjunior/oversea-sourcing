# OSI — Backlog

> **What is done, in progress, and still open.** Everything else — what the
> product is, how a request flows, the data model, architecture, infrastructure
> and configuration — lives in [the README](../README.md), which is the single
> reference for the project.
>
> Living document. **Updated in the same commit as every prod push.**

## Status at a glance

| Epic | Scope | State |
| --- | --- | --- |
| **E0** Dev foundations | Postgres, Drizzle, pg-boss, seed | ✅ done |
| **E1** Auth & users | better-auth, signup, guards, **abuse controls** | 🟡 email verification + 2FA open |
| **E2** Workspaces & tenancy | Roles, invitations, team UI | 🔴 invitations + team UI not started |
| **E12** Plans & quotas | Per-workspace limits, manager UI | 🟡 billing provider open |
| **E3** Request core loop | Pipeline, criteria, attachments, dossier | ✅ done |
| **E4** Supplier data | **Web research**, dedup, directory | 🟡 import pipeline + merge tool open |
| **E5** Matching & scoring | Criteria-aware v1 + breakdown | 🟡 the "32 criteria" + comparison view open |
| **E6** Facilitation | Engagements — *the OSI moment* | 🔴 not started (no tables) |
| **E7** Reports | Printable report + PDF export | 🟡 stored `documents` rows open |
| **E8** Transactions | Milestones, tracking | 🔴 not started (no tables) |
| **E9** Notifications | In-app + email | 🔴 not started |
| **E10** Admin surfaces | Verification, imports, ops queue | 🔴 placeholders only |
| **E11** Settings | Profile, sourcing rules | 🔴 not started |

**MVP1 = E0–E7 + E10.** Definition of done: a real buyer signs up, submits a real
need, gets a real Top-N (researched + imported suppliers, scored), clicks
*Engager*, OSI ops sees it in the queue, the buyer sees "connected", and
downloads the PDF report.

## Resume here (last session: 2026-08-22)

**Production is live and healthy at [osi-solutions.com](https://osi-solutions.com), commit `d4f93a2`.**
Dev and prod are in sync; nothing is uncommitted except three unrelated PNG
deletions at the repo root. Real users are arriving through Google sign-in —
four organic signups in the week to 2026-08-21.

**2026-08-22 was a design day, not a code day.** The SaaS platform design was
specified and validated end to end — it all lives in the README: the account
model (Individual/Enterprise, three populations, rights matrix, UC-1…11,
decisions Q1–Q6 settled except Q4 pricing), and the sourcing engine
(data-source catalogue → independent pull-only connectors → workspace
activation → **store-first flow with a quality fallback** → per-source
stores/bans → manual admin refresh → Vérifié/Recommandé tiers → banded
ranking). Two items deliberately stay open: **cross-source search order +
fallback thresholds** (DISCUSS task in E4) and **enterprise pricing** (Q4).
An architecture review page (current vs target, build order) was published as
a Claude artifact for validation.

**Suggested next code steps (Phase A):** refactor `global_web` behind the
connector contract + the store-first coverage check — and take the
**quota-race advisory lock** along for the ride.

### Start working

```sh
./scripts/dev.sh -d                 # dev stack → http://localhost:3010
./scripts/db.sh -c "select …"       # dev database (add `prod` for the VM)
./scripts/logs.sh dev worker        # watch the research pipeline
./scripts/deploy.sh                 # ship main to the VM
```

Quality gates are `npx tsc --noEmit` and `npx eslint src/` — both clean as of
this commit. There is no test suite (see debts).

### Things that will bite you

- **`.env` is gitignored on every host.** A fresh clone needs
  `cp .env.example .env` plus a real `ANTHROPIC_API_KEY`. Prod's copy is only on
  the VM — backups there are `~/osi-env-backup-*`.
- **`POSTGRES_PASSWORD` only applies when the volume is first initialised.**
  Changing it later does not change the database's password; it just breaks
  `DATABASE_URL`, and drizzle-kit reports that as a bare `exit 1` with no message.
  This cost a failed deploy on 2026-08-16.
- **`BETTER_AUTH_URL` must be the public origin in prod**, or every login fails
  with `INVALID_ORIGIN`.
- **Prod containers pin IPv4 DNS.** Do not remove `--dns-result-order=ipv4first`
  unless the VM gains a working IPv6 route.
- **Dev has no Google credentials on purpose** — the button would render and then
  fail. Google is prod-only.

### Live data (do not assume it is disposable)

Production holds **only real accounts** — seven as of 2026-08-22:
`yves@overseaimportexports.com` (platform `owner`, via Google, `internal` plan
since 2026-08-20), plus six buyers on Free: `renaud819@gmail.com`,
`yves1bat@gmail.com`, `alexhockeydureau14@gmail.com`, `joey.saulnier@gmail.com`,
`ericlab6@gmail.com`, `marisemercure@gmail.com`.

The four `@osi.dev` demo accounts were **deleted from prod on 2026-08-22**
(users + their workspaces; a backup was taken first). Their password is public
in this repo, they sat on the unlimited `internal` plan, and one was a full
platform owner — hiding the quick-login panel (`SHOW_TEST_LOGIN=false`,
2026-08-20) still left them reachable by plain email/password. The 29 suppliers
their requests had discovered stay in the pool (`discovered_by_request_id` is
`SET NULL` — the supplier pool is a platform asset). **Demo accounts are
dev-only from now on**: prod never runs `db:seed`, so they cannot come back on
their own.

### Unverified at the end of the session

~~Google sign-in was fixed (IPv4 pin) but no human had completed a login since.~~
**Confirmed 2026-08-20:** five real Google signups landed on 2026-08-17/19, all
with `email_verified = true`, a provisioned workspace and the Free plan.

### What shipped on 2026-08-16/17

| Commit | What |
| ------ | ---- |
| `b53f7fc` | E4 web research, attachment reading, E5 criteria-aware matching, E7 report + PDF, single `.env` |
| `ae1b2c2` | Real analytics aggregates, role-aware nav gating |
| `e25fcbb` | Signup abuse controls; PLAN.md + INFRA.md absorbed into the README |
| `6d7263d` | Plans, subscriptions, daily quotas, manager screen |
| `b69a671` | Fix: new workspaces had no subscription → unlimited quota |
| `db41b78` | Fix: IPv6 black hole broke Google sign-in |

### What happened on 2026-08-20/22 (ops + one feature)

| Change | How |
| ------ | ---- |
| Quick-login panel off on prod | `SHOW_TEST_LOGIN=false` in the VM `.env`, web recreated — no deploy |
| Platform owner's workspace → `internal` plan | SQL on prod; staff-lands-on-Free gap recorded in E12 |
| Daily-quota refusal made a prominent warning alert | `d4f93a2`, deployed 2026-08-20 |
| Demo accounts deleted from prod (dev-only now) | SQL on prod after a backup; suppliers they discovered kept |


## Where we actually are (2026-08-22)

**The core loop works end to end on production.** A buyer describes a need, the
platform parses criteria (from the text *and* from any attached spec sheet),
searches the web for real manufacturers, stores them in the shared pool, ranks
them against the criteria, and produces a printable report. Daily quotas and
plans are enforced.

**18 tables exist.** Missing entirely: `engagement`, `transaction`, `document`,
`notification`, `sourcing_rules`, `audit_log`, `import_run`, and the supplier
satellites (capabilities, certifications, contacts).

**Pages that are still placeholders** (16–20 lines each, no data behind them):
`/interne/finance`, `/interne/imports`, `/interne/verification`. `/transactions`
and `/documents` render showcase constants and are disabled in the nav.
`/interne/facilitation` lists dossiers but has no engagement queue.

### The gap to MVP1, in dependency order

| # | What | Why it blocks |
| - | ---- | ------------- |
| 1 | **E6 facilitation** — `engagement` + `engagement_events`, "Engager" on a Top-N supplier, ops queue | This is *the OSI moment* in the product story. Without it the platform finds suppliers and then stops; nothing connects a buyer to one |
| 2 | **E10 supplier verification** — the `unverified → pending → verified` workflow behind a real screen | The matcher already pays +12 for `verified` and the research agent creates everything as `unverified`, so today that lever is dead weight — no supplier can ever earn it |
| 3 | **E4 import pipeline + merge tool** | Half the hybrid strategy. Research alone grows the pool one request at a time, and dedup has no human review path for near-misses |
| 4 | **E1 email verification** | The only real fix for free-tier abuse: signup provisions a workspace, so one person with several addresses gets several free allowances |
| 5 | **E5 the 32 criteria** | Needs a product workshop, not code. The weighted v1 scorer stands in and is honest about what it cannot check |

### Known deviations and debts

- ✅ **Fixed 2026-08-17: IPv6 black hole broke Google sign-in.** The VM has no
  IPv6 route while DNS returns AAAA for Google; Node raced both families and the
  v6 attempt hung until timeout, so better-auth's token exchange failed with
  `ETIMEDOUT` and no user-visible error. Both prod containers now prefer A
  records. Worth remembering as a class of bug: *outbound* egress can be broken
  for one address family while everything looks healthy from outside

- ⚠️ **Research runs inline in the pipeline job**, not on its own `research` queue
  as the architecture requires. It is platform hotspot #1 — move it before load
  arrives, not after
- ⚠️ **The daily quota races** — check-then-act, reproduced at 2 rows against a
  limit of 1 when two creates arrive together. Needs an advisory lock on the
  workspace id around check-and-insert. **The most concrete defect on prod**
- ⚠️ **Nothing rate-limits request creation or uploads** — only `/api/auth/*` is
  covered. The plan quota bounds volume per day, not rate, so a Business
  workspace can fire 50 requests in one second
- ⚠️ **Rate-limit counters are in-memory** — they do not add up once the web tier
  is replicated; Redis is the swap
- ⚠️ **`storage.deleteFile` is never called** — deleting a request removes its
  `file` rows but leaves the bytes on the uploads volume
- ⚠️ **No test suite at all** — no test script, no test files. Every check in this
  repo is a typecheck, a lint, or a manual run
- ⚠️ **Supplier verification has no state machine**, unlike requests: any code can
  set any status
- ⚠️ `.docx` / `.xlsx` attachments are accepted at upload but cannot be read
- ⚠️ `/transactions` still renders showcase constants from `src/data/osi.ts`
  (`etapesTransaction`). Analytics is DB-backed now, so `kpisAnalyses`,
  `repartition`, `categories` and `tendance` in that file are **dead code**


## Implementation plan — the validated design (2026-08-22)

> The README holds the **what and why** (account model, sourcing engine —
> everything marked VALIDATED). This section holds the **how**: tasks precise
> enough to execute in a fresh session with no other context. IDs (A1…, B1…,
> C1…) are referenced from the epic lists below. Work top-to-bottom inside a
> phase; phases can interleave with MVP1 (E6/E10) work.

### Phase A — sourcing engine core (connector contract + store-first)

**Goal:** every request answers store-first; live AI search becomes connector
#1 behind one contract; the quota race dies on the way.

- [ ] **A1 · Schema migration — sourcing tables.** Edit
      `src/database/schema.ts`, then `npm run db:generate`. New tables:
      - `data_source`: `id`, `code` (uq, e.g. `global_web`), `name`, `type`
        (`global_web | country_registry | import`), `country_code` (null =
        worldwide), `enabled` bool default false, `config` jsonb,
        `created_at/updated_at`
      - `supplier_source`: `id`, `supplier_id` FK, `data_source_id` FK,
        **uq(supplier_id, data_source_id)**, `status` (`active | banned`)
        default active, `first_seen_at`, `last_seen_at`, `payload` jsonb,
        `banned_by` FK user null, `banned_reason` null
      - `source_run`: `id`, `data_source_id` FK, `trigger`
        (`request | admin`), `request_id` FK null, `triggered_by` FK user
        null, `status` (`running | succeeded | failed`), `scope` jsonb
        (category/country), `candidates_found`, `suppliers_added`,
        `memberships_upserted`, `error`, timestamps
      - `sourcing_rules`: `id`, `organization_id` FK **uq**, `activated_source_ids`
        text[] null (**null = all enabled**), `country_mode`
        (`global | list`), `country_codes` text[] null, `updated_by`,
        timestamps
      - Columns on existing tables: `supplier.last_researched_at` timestamp
        null, `supplier.banned_at/banned_by/banned_reason` null,
        `research_run.fingerprint` text null + index
      - **Seed in the migration** (prod never runs `db:seed`): one
        `data_source` row `code='global_web'`, enabled=true
      - **Backfill**: insert `supplier_source` memberships for every existing
        supplier → global_web (they all came from AI research);
        `last_researched_at` = supplier.`created_at`
      *Accept:* `npm run db:migrate` clean on a prod-dump restore; existing
      requests/matches untouched.

- [ ] **A2 · Connector contract.** New `src/server/sources/types.ts`:
      `SearchBrief` (criteria rows, countryCodes | null, wanted count, locale,
      request text digest), `SupplierCandidate` (name, countryCode, website?,
      descriptor?, description?, evidence?, raw payload), and
      `SupplierSourceConnector` (`meta {code, type, countryCode?, name}`,
      `collect(brief): Promise<SupplierCandidate[]>`). New
      `src/server/sources/registry.ts`: map `data_source.code → connector`,
      `getConnector(code)` returning undefined for store-only/missing codes
      (never throw). **No connector imports anything from `src/server/ai/`
      except its own implementation needs; the core never imports a connector
      directly — only via the registry.**
      *Accept:* `npx tsc --noEmit` clean; registry returns the global_web
      connector by code.

- [ ] **A3 · Refactor `global_web` behind the contract.** New
      `src/server/sources/global-web/index.ts` wrapping the existing agent
      (`researchSuppliers()` in `src/server/ai/research.ts:248` stays where it
      is — the connector adapts its input/output to the contract).
      Persistence (dedup via `supplierDedupKey()` in
      `src/lib/supplier-key.ts`, provenance, confidence) stays in
      `src/server/research.ts` — **moves out of reach of connectors**. Every
      collection (request-triggered or admin) writes a `source_run` row and
      upserts `supplier_source` (`last_seen_at = now()`, also touch
      `supplier.last_researched_at`).
      *Accept:* a dev request produces identical suppliers/matches as before
      the refactor, plus `source_run` + membership rows.

- [ ] **A4 · Store-first flow in the pipeline.** In
      `runResearchForRequest()` (`src/server/research.ts:126`):
      1. Resolve effective sources: enabled `data_source` ∩ workspace's
         `sourcing_rules.activated_source_ids` (null = all enabled)
      2. Store-first: candidates = suppliers with an `active` membership in an
         effective source, not globally banned, `last_researched_at` ≤ 90
         days, `country_code` within `sourcing_rules` scope; score them with
         `scoreSupplier()` (`src/server/matching.ts:140`)
      3. Fallback per source **only if** the store answer is insufficient —
         fewer than `TOP_N × 2` candidates **or** top scores below a
         compatibility floor **or** confidence below a floor (thresholds in
         `src/server/sourcing-config.ts`, env-overridable — exact numbers are
         the A8 discussion) — and only for sources with a registered connector
      4. Persist fallback results (A3 path), then `createMatchesForRequest()`
         **filtered to effective sources + country scope (hard filters)**
      5. `request_event` types: `research.store_hit`, `research.topped_up`,
         `research.full_search`; report methodology renders which path ran
      *Accept:* second identical request in a category skips the web
      (`research.store_hit`, $0 AI cost, report says pool); a workspace with
      `global_web` deactivated never calls Claude for research.

- [ ] **A5 · Quota advisory lock** (kills the documented race). In
      `createRequestFn` (`src/lib/requests-fns.ts:184`): wrap quota check +
      insert in one transaction opening with
      `SELECT pg_advisory_xact_lock(hashtext('request-quota:' || workspaceId))`.
      *Accept:* two parallel creates against limit 1 → exactly 1 row
      (reproduce with `Promise.all` of two calls in a dev script).

- [ ] **A6 · Report path disclosure.** `/demandes/$id/rapport` methodology
      section reads the `research.*` events and states: store / top-up / full
      search + which sources were consulted. FR/EN keys in
      `src/i18n/locales/`.

- [ ] **A7 · Connector unit tests — the first tests in the repo.** Add
      `vitest` (dev-only), `npm test` script. Cover: contract conformance for
      global_web (mock the agent), store-first decision matrix (warm / thin /
      stale / low-confidence), dedup-preserves-ban, advisory-lock race (A5
      repro as a test).
      *Accept:* `npm test` green in CI-less local run; wired into the quality
      gates listed in "Start working".

- [ ] **A8 · DISCUSS before coding A4 thresholds:** exact numbers for "too
      few / match too low / confidence too low", and cross-source order
      (parallel vs priority). Decision recorded in the README flow section.

### Phase B — accounts & team (E2 + settings surfaces)

**Goal:** Enterprise workspaces are real: members, rights, switcher, settings.

- [ ] **B1 · `requireRole` backbone.** `src/server/workspace-guard.ts`:
      `requireMember(userId, workspaceId, minRole)` with rank
      `viewer < buyer < admin < owner` (roles in `member.role`,
      `src/database/schema.ts:88`). Audit **every mutating server fn** in
      `src/lib/*-fns.ts` to call it (requests: ≥ buyer; criteria edits:
      ≥ buyer; plan/rename/delete: owner). Viewer gets read-only: nav renders
      "Lancer la recherche" disabled (same disabled-not-hidden rule).
      *Accept:* a viewer session cannot create a request via direct server-fn
      call (not just hidden UI).

- [ ] **B2 · Workspace switcher.** better-auth organization plugin's active-
      organization session state; switcher UI in the top bar (only when the
      user has > 1 membership). Every workspace-scoped query already keys on
      the active workspace id — verify each `src/lib/*-fns.ts` reads it from
      session, never from client input.
      *Accept:* switching re-scopes dashboard/requests/stats with no leakage.

- [ ] **B3 · Invitations.** Server fns create/accept/decline/revoke on the
      existing `invitation` table (`src/database/schema.ts:411`), 7-day
      expiry, role payload. **Interim without email provider:** creating an
      invitation returns a copyable link (`/invitation/$id?token=…`); the
      owner sends it themselves. Signup via invitation link still passes
      `signup-guard` (decided Q5). Auto-attach on login for existing accounts
      (match verified email).
      *Accept:* full loop in dev: invite → link → signup → member row with
      invited role; revoked/expired links refuse politely (FR/EN).

- [ ] **B4 · Create-member-directly (UC-4).** Owner/admin creates
      name+email; account created passwordless via better-auth admin API with
      a set-password token (reuse reset-password mechanics, 48h). **No
      personal workspace for these users (decided Q1).** Blocked on the email
      provider for sending; interim: show the set-password link once to the
      creator.

- [ ] **B5 · Paramètres surfaces.** Route `/parametres` with panels:
      **Profil** (name, locale server-persisted — closes the E11 item),
      **Abonnement** (read-only: plan name, limits, live usage vs rolling
      24h quota — reuse `checkRequestQuota()` internals from
      `src/server/plan.ts`; upgrade CTA = "Contactez-nous"),
      **Préférences de sourcing** (edit `sourcing_rules`: activate sources
      from the enabled catalogue, country mode global/list — owner/admin
      only), **Utilisateurs** (enterprise only, owner/admin only: member list
      + roles, invite (B3), create (B4), change role, remove; pending
      invitations with revoke/copy-link). Nav entry gated per role.

- [ ] **B6 · Managerial view.** "Mon équipe" tab beside Utilisateurs:
      per-member request counts + list links, usage vs pooled quota in the
      current window. Reuses `EmployeeTabs` pattern.

- [ ] **B7 · Ownership transfer.** Owner-only server fn: transfer to another
      member, previous owner → admin, confirm dialog. Exactly-one-owner
      invariant enforced in the fn.

- [ ] **B8 · Enterprise plan + per-user quota scope.** Migration: `plan` row
      `enterprise` (requests/day 100?, suppliers 20, `best`) **and**
      `plan.quota_scope` (`workspace | user`, default workspace; Free flips to
      `user`). `checkRequestQuota()` counts on `request.created_by` when
      scope = user. Optional per-member ceiling column deferred until a
      client asks.
      *Accept:* two members of one Free-plan workspace each get their own
      allowance; a Business workspace still pools.

- [ ] **B9 · GATE — email provider decision** (Resend vs SMTP). Unblocks
      real email for B3/B4, email verification (E1) and notifications (E9).
      One decision, record in README §9.

### Phase C — collections, admin & the commercial tier

**Goal:** staff runs the source catalogue; Recommandé exists and ranks fairly.

- [ ] **C1 · `/interne/sources`** (platform owner/manager,
      `PLATFORM_FEATURES` gets a `sources` entry in `src/lib/roles.ts`):
      catalogue list (enable/disable), per-source store browser (memberships,
      freshness, counts), **"Mettre à jour"** (scoped category/country →
      runs the connector → `source_run` trigger=admin), per-source ban/unban
      with reason, global supplier ban. Health column from last `source_run`
      outcomes.

- [ ] **C2 · First registry connector** (`registry-ca`). Investigation task
      first: which Canadian registry API (Corporations Canada / provincial
      registries), auth, rate limits, licensing — write findings to README §9
      before coding. Then: connector module + `data_source` row, store-only
      (no request-time fallback).

- [ ] **C3 · `supplier_partner` + `/interne/partenaires`.** Migration per
      README schema (status, source `paid|granted`, granted_by, starts/ends,
      notes; uq supplier_id). Grant requires `verification_status='verified'`
      (enforced in the fn). Screen: grant/renew/suspend with trail. Read-time
      expiry (`ends_at > now()` in the matcher query, no cron).

- [ ] **C4 · Banded ranking + badges.** In `createMatchesForRequest()`
      (`src/server/matching.ts:195`): order by 5-point band → tier
      (Recommandé > Vérifié > none) → exact score → existing deterministic
      tiebreak; tier + band recorded in `score_breakdown`. **Zero score
      points for Recommandé.** UI: badge components (nothing / ✓ Vérifié /
      ★ Recommandé) on dossier top-N, supplier directory, report; report
      methodology gains the disclosure line (FR/EN).
      *Accept:* fixture test — two suppliers same band, partner ranks first;
      partner in a lower band stays below.

- [ ] **C5 · GATE — Alibaba ToS/licensing check** before any `alibaba`
      connector code. Legal reading, record verdict in README §9.

### Sequencing & dependencies

```
A1 → A2 → A3 → A4 (A8 discussion feeds A4 thresholds)
A5, A6, A7 ride along inside Phase A
B1 → B2 → B3/B5 → B6/B7 · B4 + real email need B9 · B8 anytime after B1
C1 needs A1-A3 · C2 needs C1 · C3/C4 independent of C1-C2 · C5 gates alibaba
MVP1 (E6 facilitation, E10 verification) interleaves freely — verification
feeds C3/C4 value (Recommandé requires Vérifié)
```

## Epics → tasks

### E0 — Dev foundations

- [x] Enable `database` (postgres:16) in both compose files: volume, healthcheck, `depends_on`
- [x] `DATABASE_URL` wiring — secrets in `.env.local`, never in committed `.env`
- [x] Drizzle + drizzle-kit: schema layout in `src/database/`, migration workflow, `npm run db:migrate` / `db:seed`
- [x] API route structure under TanStack Start (`/api/*` upload/download routes, zod on every server fn) — typed error envelope still ad-hoc
- [x] pg-boss bootstrap + worker entrypoint (`src/worker.ts`, separate compose service, same image) — jobs: criteria extraction + pipeline
- [x] Seed script: demo accounts per role (named after the role) + 6 demo dossiers for the buyer — suppliers arrive with E4

### E1 — Auth & user management

- [x] better-auth setup (email/password, argon2, httpOnly session cookie)
- [x] Signup flow → creates user + personal workspace (owner)
- [ ] Email verification + password reset (token + email)
- [x] Login/logout UI (new routes) — bilingual
- [x] Route guards: `/` public (anonymous = hero + value props; logged-in = personal
      dashboard); all other app routes require auth
- [x] **“Lancer l’analyse IA” auth gate**: anonymous click → preserve the typed draft →
      login/signup → auto-create the request and resume the flow (no retyping)
- [ ] User profile: name, locale (persist language server-side, sync with the existing toggle)
- [ ] `platform_role` on users; guard helper `requireStaff()`
- [x] **Signup abuse controls** (2026-08-16) — before this, 12 consecutive POSTs
      to `/api/auth/sign-up/email` from one IP all returned 200, and every account
      creates a workspace that can spend API budget. Now: per-IP rate limits
      (3 signups/hour, 10 logins/5 min, 3 password resets/hour), a honeypot field,
      and rejection of disposable domains and plus-addressing. All rejections
      return one generic message so a script cannot learn which check it tripped
      (`src/lib/signup-guard.ts`). **In-memory storage — needs Redis before the
      web tier is replicated**
- [x] Quick-login facilitator on /login (Buyer/Manager/Accountant/Owner) — always in dev builds, elsewhere via runtime `SHOW_TEST_LOGIN=true` (on during the test phase; off before real users)
- [x] Shell session from router context (no stale "Se connecter" after sign-in/out)

### E2 — Workspaces, roles & tenancy

> The SaaS account model (Individual vs Enterprise, invitations, rights,
> managerial view) is specified in the README under **"Account model —
> Individual & Enterprise (SaaS)"** — **validated 2026-08-22**; its use cases
> and decisions are the specification for the tasks below and the Enterprise
> items in E12 (only Q4, enterprise pricing, remains open).

- [ ] Workspace CRUD (create at signup, rename)
- [ ] Memberships + role checks: `requireRole(workspace, 'buyer')` helpers
- [ ] Tenancy scoping utility — every query filtered by workspace_id (make the safe path the easy path)
- [ ] Invitations: send (email), accept (join flow), revoke
- [ ] Team management UI in Paramètres (list, invite, change role, remove)
- [ ] Audit log writes on auth/membership mutations

### E3 — Requests core loop

- [x] `requests` CRUD + status state machine (guarded transitions in `src/lib/request-status.ts` + `src/server/requests.ts`, launchedAt/completedAt timestamps, request_event trail)
- [x] Hero prompt → creates request (sequence ids from 3000; draft→received + extraction job; post-auth draft auto-creates)
- [x] File upload endpoint + storage adapter (`/api/upload`, `/api/files/$id`, local volume behind S3-shaped `src/server/storage.ts`)
- [x] **Criteria at intake** — the pre-search AI analysis was **removed entirely (decided 2026-08-05)**: an ℹ️ info helper on the hero prompt guides buyers to structured input, and `src/server/parse-criteria.ts` parses criteria synchronously at creation (zero tokens). Requests go **straight to supplier search** — no pause, no `AI_PROMPT_ANALYSIS` flag. Legacy `analyzing` dossiers keep a manual launch button.
- [x] Criteria review/edit UI (add/remove/edit) — editable on the dossier until it closes
- [x] **Per-request AI chat** — behind `AI_CHAT` (default **false**: UI + transcripts hidden, server refuses; the hero prompt is the only AI-facing input): message → Claude with criteria context → optional criteria mutations applied (persisted in `request_message`)
- [x] Worker recovery sweep: requests stranded mid-pipeline (crash/lost enqueue) are re-adopted on boot + every 60s
- [x] Pipeline orchestrator job: `analyzing → searching → validating → report_ready` with progress events — **simulated stages (~10s each) until E4/E5 provide real search/matching**
- [x] Wire demandes list + detail pages to real data (drop mock) — `request` table (migration 0001), workspace-scoped queries; detail criteria/top-5/chat remain showcase until E3/E5
- [x] **Personal dashboard** (Accueil): real session user greeting, stats + "Vos dossiers
      récents" scoped to the logged-in user, per-role workspace visibility
- [ ] Activity feed: recent events across _my_ requests/engagements (from engagement_events + status changes)

### E4 — Supplier data platform

- [x] Supplier schema core (provenance, verification_status, confidence, risk — platform-global) — satellites (capabilities, certifications, contacts) still pending
- [ ] CSV/JSON import pipeline v1 — now an `import`-type **connector**; its
      audit rows are `source_run` (which absorbed the planned `import_runs`).
      Seed script stands in for now
- [x] **Job: AI research agent** (2026-08-16) — real web search per request, results persisted as `ai_researched` suppliers, `research_run` rows for the audit trail. Runs in the `searching` stage behind `AI_RESEARCH` (default **on**). Gateway: `src/server/ai/research.ts`; orchestration + persistence: `src/server/research.ts`
- [x] **Attachment reading** (2026-08-16) — buyer uploads are opened, not just stored: text/CSV decoded directly, PDF and images read by the model. Criteria parsed out of them with the same intake regexes, and the content feeds the search brief (`src/server/attachments.ts`)
- [x] Dedup / entity resolution v1 — normalized `name|COUNTRY` key on `supplier.dedup_key` with a **unique index**, so a repeat search cannot re-add a known company (`src/lib/supplier-key.ts`). **Merge tool in admin still pending**
- [x] Supplier directory UI wiring (list) — real data with match counts, plus a link back to the request whose research found each company (workspace-gated). Detail page + filters still pending
- [ ] Country risk reference table (seed data)
- [ ] **Supplier cache — coverage check before research** (validated
      2026-08-22, README → supplier cache) — score the pool against the request
      first; pool-only / top-up / full-research paths, `research_run.fingerprint`,
      `supplier.last_researched_at` (90-day freshness), report says which path
      ran, pool-only costs the same quota unit
- [ ] **`data_source` catalogue** (validated 2026-08-22, README → data sources &
      sourcing preferences) — platform-curated source rows (`global_web` ·
      `country_registry` · `import`, optional country, enabled flag) +
      `/interne/sources` admin screen (platform owner). Research agent and
      import pipeline consult only enabled sources; `supplier.source_ref`
      points at the source that found each company
- [ ] **Source connector architecture** (validated 2026-08-22, README → every
      source is an independent connector module) — `src/server/sources/`:
      one contract (`collect(brief) → SupplierCandidate[]`, pull-only,
      self-describing meta), a registry keyed by `data_source.code`,
      per-connector timeout + independent failure recorded per source on
      `research_run`. Dedup/provenance/confidence applied by the platform core
      after collection, never inside a connector. **First step: refactor the
      existing AI web research behind the interface as connector #1
      (`global_web`)** — adding any later source is one module + one row.
      Roadmap: `global_web` → first registry (`registry-ca`) → `alibaba`
      (**ToS/licensing gate before coding**) → `registry-us` → per demand
- [ ] **`supplier_source` memberships + bans** (validated 2026-08-22, README →
      per-source collections & bans) — one supplier entity, N source
      memberships (uq pair, per-source payload, first/last_seen); per-source
      ban (`status=banned`) and global ban (`supplier.banned_at/by/reason`),
      **both sticky across re-collection** via the dedup key; staff-only with
      a trail, managed from the source's collection view
- [ ] **`source_run` audit + "Mettre à jour" trigger** (validated 2026-08-22)
      — staff refresh one source on demand from `/interne/sources` with an
      optional category/country scope; upserts memberships, re-warms
      `last_seen_at`; rows record source, trigger `request|admin`, who,
      counts, errors
- [ ] **DISCUSS at implementation: the request flow across sources** — the
      validated working draft (README → the request flow across sources):
      effective sources = platform-enabled ∩ workspace-activated (requests
      never specify a source), **store-first for every source (global_web
      included)**, live-collection fallback only on insufficient store answer
      (too few candidates / match too low / confidence too low — thresholds
      TBD) and only for sources with a live collector (today: global_web),
      source scope as a hard match-time filter. **Also decide: cross-source
      search order — priority sequence vs all stores in parallel.** Refine
      thresholds and failure UX before coding

### E5 — Matching & scoring

- [ ] **Define the 32 compatibility criteria** (product workshop — weights per category)
- [x] **Matching v1 — criteria-aware** (2026-08-16). v0 never read the criteria at all (confidence + verification + risk + a hash jitter), so a supplier that genuinely matched could rank below one that did not. v1 scores each criterion against the supplier's own text: `10 base + 55×coverage + 20×confidence/100 + verification(12/5/0/−25) − risk(0/4/10)`, required criteria weighted ×2, ties broken deterministically. `sourcing_rules` still unused (E11)
- [x] Compatibility score: weighted per-criterion, **breakdown persisted in `match.score_breakdown` jsonb** — which criteria matched, which were unverifiable, how each modifier landed
- [ ] **Numeric criteria are scored as `unverifiable`, not as misses** — pressure/flow/quantity/lead_time cannot be checked against a one-line supplier description, so they are excluded from the denominator rather than penalising every supplier equally. They become checkable once `supplier_capabilities` / `supplier_certifications` exist
- [ ] Confidence score: provenance + profile completeness + verification
- [ ] Risk level: country risk + data flags (v1 heuristic)
- [x] Top-5 persistence in `match` + ranking; "N fournisseurs analysés" is real (matches.created event)
- [ ] Comparison view wiring ("Comparer" side-by-side)
- [ ] **Band + tier ordering** (validated 2026-08-22, README → visibility
      tiers) — 5-point score bands; within a band Recommandé > Vérifié > none;
      Recommandé adds zero score points (Vérifié keeps its +12); band and tier
      recorded in `score_breakdown`; one-line disclosure in the report

### E6 — Facilitation (engagements) · the OSI moment

- [x] Ops list view on `/interne/facilitation`: all buyer dossiers + Vue globale/Mes données tabs (engagement queue below still pending)
- [ ] Engagement creation from a match (buyer clicks "Engager" on a Top-5 supplier)
- [ ] Status machine + `engagement_events` timeline
- [ ] Ops queue in admin: list, assign to ops user, transition statuses, add notes
- [ ] Buyer-side status panel on request detail ("OSI is connecting you…")
- [ ] Notifications on every transition (buyer + assigned ops)

### E7 — Report generation

- [x] Report data assembly (2026-08-16) — `/demandes/$id/rapport`: the need in the buyer's own words, criteria applied, ranked suppliers with scores/risk, and a methodology section citing the research pass
- [x] "Voir le rapport" button wiring + download — the button now opens the report; **Télécharger en PDF** uses the browser's own print-to-PDF (print stylesheet in `src/styles.css`, chrome hidden via `print:hidden`)
- [ ] **Server-rendered PDF stored as a `documents` row** — needs the `documents` table (unbuilt) and Playwright/Chromium in the image. The route is the seam that feeds it; browser print covers the need until then

### E8 — Transactions (tracking only)

- [ ] Create transaction from a `connected` engagement (ops action)
- [ ] Milestones CRUD — manual updates by ops, manufacturing progress %
- [ ] Buyer timeline UI wiring (page exists) + linked documents

### E9 — Notifications

- [ ] `notifications` table + API (list, mark read)
- [ ] Bell dropdown UI (badge exists — make it real)
- [ ] Email sender + FR/EN templates (verification, invitation, engagement updates)

### E10 — Admin backoffice (`/admin`, staff-gated)

- [ ] Layout + `requireStaff` guard
- [ ] Facilitation queue (E6 surface)
- [ ] Supplier management: search, edit, **verification workflow** (`unverified → pending → verified`), merge duplicates
- [ ] Import runs: trigger, monitor, error report
- [ ] Ops dashboard: counts (open engagements, pending verifications, active requests)
- [ ] **`supplier_partner` table + `/interne/partenaires`** (validated
      2026-08-22, README → visibility tiers) — grant/renew/suspend Recommandé
      (`paid` or `granted`, time-boxed, `granted_by` trail); requires Vérifié;
      read-time expiry. **The seam for the future supplier-side space** —
      `claimed_by_user_id`, supplier logins and partner dashboards attach here
- [ ] Supplier badges in dossier + report UI — none / ✓ Vérifié / ★ Recommandé
      (absence of a badge stays neutral — no "unverified" mention)

### E12 — Plans & quotas

- [x] **`plan` / `subscription` tables** (2026-08-16) — limits are rows, editable
      at runtime; seeded in a migration since prod never runs `db:seed`
- [x] **Daily request quota** — enforced in `createRequestFn` before the insert,
      counted over a rolling 24h window from `request` rows (no counter column).
      The refusal is surfaced as a prominent warning alert on the hero prompt
      (amber border, icon, title — was a quiet grey line; flagged too subtle
      2026-08-20), typed text still preserved
- [x] **Per-plan overrides** — `suppliers_returned` and `model_tier` come from the
      plan, falling back to the env values when a workspace has no subscription
- [x] **Manager screen** `/interne/plans` — edit limits with validation and a live
      cost estimate (requests/day is a cost commitment; a form that hides the money
      is a footgun), assign plans to workspaces, `updated_by` trail
- [ ] **Billing provider** (Stripe or equivalent) — plans work without it; the
      provider columns stay null until it lands
- [x] **New workspaces land on Free** (2026-08-17) — the seeding migration only
      covered workspaces that existed when it ran, so every account created
      afterwards had no subscription, fell through to the env fallback, and got an
      **unlimited** daily quota. Now assigned in better-auth's user-create hook, so
      it covers social sign-up too
- [ ] **Free-tier integrity** — signup creates a personal workspace, so one person
      with several emails gets several free allowances. Rate limits and
      disposable-domain blocks slow this; only **email verification** fixes it
- [x] **Google sign-in — live on prod** (2026-08-17), verified by a real signup
      that arrived with `email_verified = true`, a provisioned workspace and the
      Free plan. **Production only**: the credentials are deliberately absent in
      dev, where the button would fail with `redirect_uri_mismatch`. The email
      signup guards do **not** apply to the social route, and account linking is
      left on better-auth's default (an email/password user clicking Google with
      the same address will likely be refused rather than linked — undecided)
- [ ] AI chat as a plan feature — postponed until the chat is exercised
- [ ] **Staff workspaces land on Free** — the user-create hook assigns Free to
      every new workspace, and granting `platform_role` later (SQL) does not
      touch the plan, so a staff member's personal workspace stays quota-bound.
      Bitten 2026-08-20: the platform owner's own workspace was on Free (1/day)
      until moved to `internal` by hand. Either auto-move workspaces to
      `internal` when a platform role is granted, or exempt employees in
      `checkRequestQuota`
- [ ] **Subscription flow for buyers** (requested 2026-08-20) — a "Plan de
      subscription" surface where a workspace can see its current plan and
      upgrade/downgrade. Today plans are assigned only by staff from
      `/interne/plans`; buyers have no self-service view. Depends on the billing
      provider for paid upgrades, but a read-only "your plan & usage" panel can
      ship before payments
- [ ] **Enterprise plan** (requested 2026-08-20) — a tier above Business,
      possibly with a managerial view: several members in one workspace, an
      owner/admin who sees the team's requests and usage. First plan whose value
      is *seats + oversight* rather than just higher limits — depends on E2
      (invitations + team UI), which is why it doesn't exist yet
- [ ] **Per-user quota on the Free plan** (requested 2026-08-20) — today the
      quota counts `request` rows per *workspace*. That is the right unit for
      paid team plans, but on Free it should bind per *user* so that limits
      follow the person. Mostly equivalent today (signup = personal workspace,
      one member) but it closes the gap once invitations (E2) let several users
      share a workspace — and it is the right base for the Enterprise
      distinction above: Free limits the user, Enterprise pools the team.
      Implementation seam: `createRequestFn` already knows the caller; count on
      `request.created_by` instead of `organization_id` when the plan says so
      (add a `quota_scope` column to `plan`: `workspace` | `user`)

### E11 — Settings

- [ ] Profile + language (server-persisted)
- [ ] **Abonnement panel** — active workspace's plan, limits, live usage vs
      quota, upgrade CTA ("Contactez-nous" until billing; self-service after
      Stripe). Buyer-facing read-only mirror of `/interne/plans` (README →
      account model UC-9)
- [ ] **Utilisateurs view** (enterprise, owner/admin-gated) — members + roles,
      invite/create, change rights, remove, pending invitations (README →
      account model UC-10; the surface for the E2 flows)
- [ ] **Sourcing preferences UI** (`sourcing_rules`, validated 2026-08-22) —
      per-workspace: **activate** available data sources once (requests never
      specify a source afterwards — effective set = platform-enabled ∩
      workspace-activated) and supplier country origin (global / country list
      / local). Editable by workspace owner/admin; consumed by the pipeline
      (which connectors run) and the matcher (hard filter, not a down-score)
      — E4/E5
- [ ] Notification preferences

### Cross-cutting (throughout)

- [ ] Audit log on all mutations of money/status/membership
- [ ] Error monitoring hook (server logs first)
- [ ] Postgres backup cron on the VM (`pg_dump` → dated dumps)
- [ ] Security pass before exposing beyond LAN (rate limits, headers, TLS/reverse-proxy)

---

## Suggested execution order

```
E0 → E1 → E2         (foundations: ~the "login and persist" milestone)
E3 → E4 → E5         (the core loop: request → research → Top 5)
E6 → E7              (facilitation + report = MVP1 demo-able)
E10 in parallel from E4 (admin grows with supplier data)
E8, E9, E11          (execution & comfort)
```

**MVP1 = E0–E7 + E10.** Definition of done: a real buyer signs up, submits a real
need, gets a real Top 5 (imported + AI-researched suppliers, scored), clicks
_Engager_, OSI ops sees it in the queue, buyer sees "connected", downloads the PDF report.

## Open items

- The 32 criteria list (E5 task — needs a product session)
- External data sources & licensing for imports (E4)
- ~~Web-search provider for the research agent~~ — **decided 2026-08-16: none needed.** Claude's server-side `web_search` tool runs the search inside the existing API call, so there is no second vendor, key or bill. It is called only from `src/server/ai/research.ts`, so a Tavily/Brave adapter can replace it without touching domain code (INFRA principle 4)
- Email provider choice (Resend vs SMTP)
- When to put a reverse proxy + TLS in front of prod (before first external user)
