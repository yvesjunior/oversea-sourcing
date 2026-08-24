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
| **E1** Auth & users | better-auth, signup, guards, verification, reset | 🟡 2FA open; verification not enforced (deliberate) |
| **E2** Workspaces & tenancy | Roles, invitations, team UI | ✅ Phase B (2026-08-23) — audit-log task open |
| **E12** Plans & quotas | Full ladder, seats, trial cap, Abonnements | 🟡 billing provider open |
| **E3** Request core loop | Pipeline, criteria, attachments, dossier | ✅ done |
| **E4** Supplier data | **Web research**, dedup, directory, sources admin | 🟡 import pipeline + merge tool open |
| **E5** Matching & scoring | Criteria-aware v1 + breakdown | 🟡 the "32 criteria" + comparison view open |
| **E6** Facilitation | Engagements — *the OSI moment* | 🔴 not started (no tables) |
| **E7** Reports | Printable report + PDF export | 🟡 stored `documents` rows open |
| **E8** Transactions | Milestones, tracking | 🔴 not started (no tables) |
| **E9** Notifications | In-app + email | 🟡 bell + first emitters live; E6 templates + prefs open |
| **E10** Admin surfaces | Verification, imports, ops queue | 🔴 placeholders only |
| **E11** Settings | Profile, sourcing rules | 🟡 Paramètres live (B5); notification prefs open |

**MVP1 = E0–E7 + E10.** Definition of done: a real buyer signs up, submits a real
need, gets a real Top-N (researched + imported suppliers, scored), clicks
*Engager*, OSI ops sees it in the queue, the buyer sees "connected", and
downloads the PDF report.

## Resume here (last session: 2026-08-23/24)

**Production is live and healthy at [osi-solutions.com](https://osi-solutions.com), commit `d4f93a2`.**
**`main` is ~30 commits ahead of prod** — the sourcing engine, the six-service
architecture, Redis, all of Phase B, E1 emails and E9 notifications are
dev-verified and NOT deployed (per the standing no-unrequested-deploys rule;
migrations 0008–0011 are additive). When the deploy is requested: backup
first, add SENDGRID_API_KEY + MAIL_FROM to the VM `.env` (no MAIL_SILENT) or
emails will only log, and recreate all containers so they pick the env up.
Real users keep arriving through Google sign-in (7 accounts as of 08-22).

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

**Phase A landed the same day (A1–A6 done, dev-verified, not yet deployed):**
sourcing tables migrated (`data_source`, `supplier_source`, `source_run`,
`sourcing_rules` + supplier ban/freshness columns, `research_run.fingerprint`),
connector contract + `global_web` as connector #1, **store-first flow on a
dedicated `research` queue**, quota advisory lock, store-hit disclosure in the
report. Verified end to end in dev: cold request → research queue → new
suppliers with memberships + `source_run` audit; warm request →
`research.store_hit`, zero AI cost. **Still open in Phase A: A7 (vitest +
connector tests) and A8 (threshold numbers + cross-source order discussion).**
Redis-backed rate limiting also shipped (`deccfd1`).

**The full architecture now runs in dev AND is defined for prod (`0736f1e`):**
six services, identical topology in both stacks — `web`, `worker` (pipeline +
sweep), `worker-research` (collection, always-on — no more `scale` profile),
`redis` (first-class, out of the addons; fail-open counters), `database`,
one-shot `migrate`. Addons hold only ops tools now, attachable to either stack
(`./scripts/addons.sh dev …`). Cross-container handoff verified live:
`worker` → research queue → `worker-research` (collected under a transient
API error, `source_run` audit) → back to `worker` for matching. README §4
documents the containers, dev-vs-prod differences, and the interaction
diagram — containers never call each other; Postgres is the only meeting
point. **Prod still runs `d4f93a2`** — everything above ships whenever the
deploy is requested (migration is additive; backfills prod's suppliers as
`global_web` memberships automatically).

**Phase B complete (2026-08-23, commits `f905439`…`1b93c19`, all dev-only):**
the SaaS account model is real. B1 role enforcement on every mutating fn
(membership re-read per call) · B2 workspace switcher · B5 Paramètres
(Profil / Abonnement with usage bars / Préférences de sourcing writing
`sourcing_rules` / Utilisateurs) · B8 plan ladder (audiences, Free trial
1/day + 2 lifetime, seats, quota scope, Abonnements tabs — all owner-editable
live) · B3/B4 invitations via the org plugin (seat caps in-flow, SendGrid
adapter, public /invitation page, invited signups get no personal workspace)
· B6 per-member usage · B7 atomic ownership transfer. Platform staff also got
`/interne/utilisateurs` (user management, plan assignment moved there).
Workspace roles simplified to owner | buyer | viewer. All verified live in
dev; **prod still runs `d4f93a2`** — now 20+ commits behind, deploy on
request (migrations 0008–0010 are additive).

**E1 shipped 2026-08-23 (`6fec867`):** email verification (sendOnSignUp,
auto sign-in, resend in Profil — **recorded, not enforced**) and password
reset (`/mot-de-passe-oublie` → email → `/reinitialiser?token=`), both through
the SendGrid adapter. Implementation facts in README → "Email verification &
password reset".

**E9 core shipped 2026-08-24 (`91538fc`):** `notification` table (type+params
i18n pattern), `notify.ts` single failure-tolerant emitter, real bell (dot
only when unread, click = read + navigate). First emitters: `report_ready`
(worker, in-app + email) and `invitation_accepted` (→ inviter). Open in E9:
engagement templates (gated with E6) and preferences (E11).

**E6 is GATED (user decision):** no facilitation implementation until the
flow is defined together — statuses, actors, what "connected" means. Open
that discussion before touching E6.

**C1 `/interne/sources` shipped 2026-08-24** (dev-only, like everything since
`d4f93a2`): the data-source admin screen — catalogue with enable/disable,
per-source store browser, per-source + global bans with a who/when/why trail,
and the admin "Mettre à jour" running on the research queue. Completes the
three 🟡 E4 partials. Details in the Phase C entry below.

**Where to pick up next session:** ① the E6 flow discussion (unlocks MVP1),
② backpressure pair (server-fn rate limits + queue-depth guard), ③ E10
verification workflow, ④ C2 `registry-ca` investigation (C1 gave it its
screen). Read "Contracts a next session must NOT re-derive differently"
below before writing any code.

### Contracts a next session must NOT re-derive differently

- **Quota**: two ceilings in `checkRequestQuota(orgId, userId)` — lifetime
  checked BEFORE daily; refusal reasons `lifetime` (upgrade pitch) vs `daily`
  (reset time); scope from `plan.quota_scope`; all under the per-workspace
  advisory lock in `createRequestFn`.
- **Roles**: workspace = `owner | buyer | viewer` (admin schema-valid, ranks
  like buyer, never minted). Rank helper `src/lib/workspace-roles.ts`; every
  mutating fn calls `requireMember` (membership re-read per call). One owner
  per workspace — moved only by `transferOwnershipFn` (atomic swap → buyer).
- **Plans are rows**: every limit (incl. `max_requests_total`,
  `max_members`, `quota_scope`, `audience`) edits live on the Abonnements
  screen; never hardcode a limit.
- **Seats**: enforced inside the org-plugin flow (`organizationHooks` →
  `assertSeatAvailable`) — invite counts pending, accept counts members.
  Never enforce seats only in UI or in a wrapper fn.
- **Invitations**: org-plugin endpoints + our hooks; invited roles
  buyer|viewer only; public `/invitation/$id` (id = capability); invited
  signups get NO personal workspace (user-create hook checks pending
  invitations).
- **Mail**: everything goes through `src/server/mail.ts` (fetch, no SDK).
  Modes: no key → log; MAIL_SILENT=true → log; else send. Mail failures
  return, never throw.
- **Sourcing**: store-first before any collection; connectors are pull-only
  modules behind `src/server/sources/types.ts`; dedup/provenance/confidence
  applied ONLY in `src/server/research.ts`; source+country scope are hard
  match-time filters; effective sources = enabled ∩ activated (null = all).
- **Containers never call each other** — Postgres (rows + pg-boss) is the
  only meeting point; worker owns `pipeline`+sweep, worker-research owns
  `research`; Redis is disposable (fail-open, sessions stay in Postgres).
- **Email verification is NOT enforced at login** — deliberate; flipping
  `requireEmailVerification` is a product decision, not a cleanup.
- **No prod deploys unless explicitly requested** — dev is the test ground;
  main accumulates.

### Start working

```sh
./scripts/dev.sh -d                 # dev stack → http://localhost:3010
./scripts/db.sh -c "select …"       # dev database (add `prod` for the VM)
./scripts/logs.sh dev worker        # watch the research pipeline
./scripts/deploy.sh                 # ship main to the VM
```

Quality gates are `npm test` (vitest, 27 unit tests),
`npx tsc --noEmit` and `npx eslint src/` — all clean as of this commit.

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
- **New i18n keys need a dev web-container restart.** `src/i18n/config.ts`
  guards `init` with `i18n.isInitialized`, and the i18next singleton lives in
  the long-running SSR process — vite re-runs the config on locale edits but
  the guard skips re-init, so SSR renders raw keys (and every hydration fails)
  until `docker restart` of the web container. Cost an hour on 2026-08-24.

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
| Redis-backed distributed rate limiting (fail-open) | `deccfd1` — dormant without `REDIS_URL`; **not deployed** |
| Sourcing engine: connectors, store-first, research queue, quota lock | `6ad0232` — Phase A core; **not deployed** |
| Full architecture in both stacks: worker-research + redis first-class | `0736f1e` + README interaction docs `3030065`; **not deployed** |
| Footer heading: "Nos engagements" / "Our commitments to you" | `186ecd5` + `17615cd`; **not deployed** |


## Where we actually are (2026-08-22)

**The core loop works end to end on production.** A buyer describes a need, the
platform parses criteria (from the text *and* from any attached spec sheet),
searches the web for real manufacturers, stores them in the shared pool, ranks
them against the criteria, and produces a printable report. Daily quotas and
plans are enforced.

**22 tables exist** (the sourcing-engine four landed 2026-08-22). Missing
entirely: `engagement`, `transaction`, `document`, `notification`, `audit_log`,
and the supplier satellites (capabilities, certifications, contacts,
`supplier_partner`).

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

- ✅ **Fixed 2026-08-22: research runs on its own `research` queue**, behind
  the connector contract, store-first. `WORKER_QUEUES` + the `scale` compose
  profile turn the split into a dedicated container when load arrives
- ✅ **Fixed 2026-08-22: the daily quota race** — check + insert now run under
  `pg_advisory_xact_lock` on the workspace id in `createRequestFn`, so two
  simultaneous creates serialize instead of both passing
- ⚠️ **Nothing rate-limits request creation or uploads** — only `/api/auth/*` is
  covered. The plan quota bounds volume per day, not rate, so a Business
  workspace can fire 50 requests in one second
- ✅ **Fixed 2026-08-22: rate-limit counters are Redis-ready** — `REDIS_URL` +
  the `cache` addon put better-auth's counters in Redis (fail-open wrappers in
  `src/server/kv.ts`; sessions pinned to Postgres). Verified in dev: 429 after
  the limit with the counter key in Redis; Redis killed mid-run → 401s, not
  500s. Not yet enabled on prod (single web container doesn't need it)
- ⚠️ **`storage.deleteFile` is never called** — deleting a request removes its
  `file` rows but leaves the bytes on the uploads volume
- 🟡 **Test suite started 2026-08-22** (`npm test`, vitest, 22 unit tests:
  matcher, store-first qualifier, connector contract, dedup key). Still
  unit-only — DB-bound behavior (ban stickiness, quota lock) is verified
  manually against the dev stack; no CI runs any of it automatically
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

- [x] **A1 · Schema migration — sourcing tables.** Edit
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

- [x] **A2 · Connector contract.** New `src/server/sources/types.ts`:
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

- [x] **A3 · Refactor `global_web` behind the contract.** New
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

- [x] **A4 · Store-first flow in the pipeline.** In
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

- [x] **A5 · Quota advisory lock** (kills the documented race). In
      `createRequestFn` (`src/lib/requests-fns.ts:184`): wrap quota check +
      insert in one transaction opening with
      `SELECT pg_advisory_xact_lock(hashtext('request-quota:' || workspaceId))`.
      *Accept:* two parallel creates against limit 1 → exactly 1 row
      (reproduce with `Promise.all` of two calls in a dev script).

- [x] **A6 · Report path disclosure.** `/demandes/$id/rapport` methodology
      section reads the `research.*` events and states: store / top-up / full
      search + which sources were consulted. FR/EN keys in
      `src/i18n/locales/`.

- [x] **A7 · Unit tests — the first tests in the repo** (2026-08-22). vitest
      + `npm test` (22 tests): global_web contract conformance (agent mocked),
      the store-first decision matrix (warm / thin / stale / low-confidence /
      low-match via the pure `countQualifyingCandidates`), the matcher's A8
      fixes, dedup-key normalization, fingerprint stability. **Deliberately
      unit-only:** ban stickiness and the advisory-lock race are DB-bound —
      verified manually against the dev stack; integration tests come with CI
      if CI ever comes. Gotcha for posterity: `beforeEach(() =>
      mock.mockReset())` without braces returns the mock, which vitest calls
      as a TEARDOWN hook — brace your hooks.

- [x] **A8 · Thresholds settled** (2026-08-22, recorded in the README flow
      section): defaults stand (2×Top-N · score ≥ 40 · confidence ≥ 30 ·
      fresh ≤ 90d, env-tunable); cross-source order = sequential in catalogue
      order until a second live connector justifies parallel fan-out; failure
      UX = per-source isolation, failed collection still ranks the store.
      The field defects were fixed in the **matcher**, not the thresholds:
      numeric tokens must all match (ISO 9001 ≠ ISO 8573-1) + morphological
      aliases (inox ↔ inoxydable). Verified live: the request wording that
      previously forced research now store-hits (20 qualifying)

### Phase B — accounts & team (E2 + settings surfaces)

**Goal:** Enterprise workspaces are real: members, rights, switcher, settings.

- [x] **B1 · `requireRole` backbone** (2026-08-23). `src/server/workspace-guard.ts`:
      `requireMember(userId, workspaceId, minRole)` with rank
      `viewer < buyer < owner` (owner/admin merged 2026-08-23; roles in `member.role`,
      `src/database/schema.ts`). Membership **re-read per call** — a demotion
      or removal bites on the very next request, no session invalidation.
      Guarded ≥ buyer: createRequestFn (returns `forbidden`, UI shows the
      "Accès en lecture seule" alert), startRequestPipelineFn, launchSearchFn,
      cancelRequestFn, all criteria mutations, chat, `/api/upload` (403).
      Pure rank helper `src/lib/workspace-roles.ts` shared with future UI
      gating, under unit test (legacy `admin` ranks like buyer). *Verified
      live:* buyer demoted to viewer → create refused with the alert, zero
      rows leaked, restore → works again. Owner-only checks land with their
      surfaces (B5/B7 — no owner-gated mutation exists yet).

- [x] **B2 · Workspace switcher** (2026-08-23). Top-bar switcher
      (`WorkspaceSwitcher.tsx` + `getMyWorkspacesFn`) — renders only with > 1
      membership, shows name + localized role, switches via better-auth
      `organization.setActive` (session state) and lands on the dashboard.
      Query audit passed: every server fn reads the workspace from the
      session; the only fn accepting an organizationId from input is the
      staff-gated `assignPlanFn` (deliberately cross-tenant). *Verified live:*
      buyer + a second viewer membership → switcher appears, switch re-scopes
      stats/dossiers to zero with no leakage, and B1 refuses creation in the
      viewer workspace with the read-only alert; switch back re-scopes home.
      **Note (user, 2026-08-23): the organisation/workspace design may change
      later — current design accepted to keep moving; revisit planned.**

- [x] **B3 · Invitations** (2026-08-23) — via better-auth's org plugin with
      our rules injected as organizationHooks: 7-day expiry, re-invite
      replaces, **seat cap enforced inside the plugin flow** (members +
      pending at invite time, members at accept time — a direct endpoint call
      cannot bypass it), invited roles restricted to buyer|viewer (one owner,
      ever). SendGrid adapter `src/server/mail.ts` (fetch, no SDK; no key or
      MAIL_SILENT=true → logged) sends the bilingual email; the link stays
      copyable on the team panel. Public `/invitation/$id` page (the id is the
      capability): anonymous → login/signup with return redirect; mismatch →
      told which address; match → accept/decline, accept sets the active
      workspace. *Verified live end to end*, including the seat-cap refusal
      on a Free workspace and a schema fix (invitation.created_at was missing
      for better-auth 1.6). Custom AC (`src/lib/org-access.ts`) teaches the
      plugin our roles — only owner manages the org

- [x] **B4 · Create-member-directly — delivered through the invitation
      flow** (2026-08-23, known deviation from UC-4's set-password-link
      design): the owner enters email + role; a newcomer creates their
      account through the invitation link (their signup IS the set-password
      step — no temporary passwords) and **gets no personal workspace** (Q1:
      the user-create hook skips it when a pending invitation matches the
      email). The dedicated passwordless pre-created-account flow can come
      with E1's reset infrastructure if ever needed

- [x] **B5 · Paramètres surfaces** (2026-08-23). `/parametres` live for every
      role (sidebar un-gated), four tabs: **Profil** (name + language,
      server-persisted, syncs the i18n toggle — closes the E11 item),
      **Abonnement** (read-only: plan, usage bars for daily/lifetime/seats,
      "Contactez-nous" CTA until billing), **Préférences de sourcing** (the UI
      that finally WRITES `sourcing_rules`: activate sources, country origin
      global/list — owner edits, others read; all-activated stores null so
      future sources arrive activated), **Utilisateurs** (owner-gated tab,
      disabled-not-hidden: member list + seat usage; invite/create arrive with
      B3/B4). *Verified live:* rules row written (`list ["FR","DE"]`,
      updated_by trail) and reset; Abonnement mirrors the internal plan.

- [x] **B6 · Managerial view** (2026-08-23) — folded into the Utilisateurs
      panel: per-member requests (rolling 24h + lifetime) beside each role,
      seat usage at the top. A separate "Mon équipe" tab can split out when
      the table outgrows one screen

- [x] **B7 · Ownership transfer** (2026-08-23) — `transferOwnershipFn`:
      owner-only, target must be a member, atomic swap in one transaction
      (previous owner → buyer); confirm dialog on the team panel. Role edits
      can never mint or touch an owner (beforeUpdateMemberRole hook).
      *Verified live: swap executed, exactly one owner at every instant*

- [x] **B8 · Plan ladder built** (2026-08-23, one migration `0009`):
      `plan.audience` (individual | organization | internal), **lifetime trial
      cap** `max_requests_total` (Free = 2 — checked BEFORE the daily window;
      distinct `lifetime` refusal, hero pitches the upgrade), `max_members`
      (Free/Pro 1 · Business 5 · Enterprise 0 = custom — enforced at
      invitation time when B3 lands), `quota_scope` (individual = per user,
      organization = pooled; `checkRequestQuota(orgId, userId)` counts on
      `created_by` for user scope). New `enterprise` row (100/day, 20, best).
      **Abonnements screen**: nav renamed, tabs per audience, every new column
      editable with validation + cost estimate + `updated_by`. *Verified
      live:* Free workspace with prior requests → "Essai gratuit épuisé"
      upgrade alert; both tabs render with correct values. Note: audience-
      constrained assignment is UI-grouped only — hard enforcement waits for
      the workspace-type decision (design revisit).

- [x] **B9 · GATE — email provider: SendGrid** (decided 2026-08-23, recorded
      in README §9). Unblocks real email for B3/B4, email verification (E1)
      and notifications (E9). Wiring task: `src/server/mail.ts` adapter
      (vendor-SDK rule applies — nothing imports SendGrid directly),
      `SENDGRID_API_KEY` in `.env` (prod only; dev logs sends), FR/EN
      templates live with E9.

### Phase C — collections, admin & the commercial tier

**Goal:** staff runs the source catalogue; Recommandé exists and ranks fairly.

- [x] **C1 · `/interne/sources`** (2026-08-24) — platform owner/manager
      (`sources` feature in `src/lib/roles.ts`): catalogue list with
      enable/disable switch, per-source store browser (memberships, freshness,
      counts, capped at 200), **"Mettre à jour"** (category required + optional
      country → `source_run` trigger=admin created by the fn, collection runs
      on the **research queue** — web never calls Claude; one admin run at a
      time per source), per-source ban/unban with mandatory reason + who/when
      trail, global supplier ban/unban, health column from the last
      `source_run` (5s polling while a run is live). Server fns in
      `src/lib/source-admin-fns.ts`; `runAdminRefresh()` in
      `src/server/research.ts` reuses the exact request-path persistence.
      Store-only sources render the button-less explanation instead of the
      form; a **disabled source can still be refreshed on purpose** (warming a
      store before enabling it is a legitimate rollout move). *Verified live
      in dev end to end:* admin refresh « vannes papillon inox sanitaires ·
      DE » → worker-research collected → 1 candidate, 1 new supplier,
      membership + audit row, screen live-updated; per-source ban → DB row
      with reason + banned_by → unban; global ban/unban; enable toggle.

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
- [x] **Email verification + password reset** (E1, 2026-08-23 — full detail
      in README → "Email verification & password reset"). better-auth
      built-ins + the SendGrid adapter: `sendOnSignUp` verification with
      auto sign-in, resend button in Paramètres → Profil, reset via
      `/mot-de-passe-oublie` → email link → `/reinitialiser?token=`.
      **Enforcement deliberately OFF** (`requireEmailVerification`) — prod
      has real unverified users; flipping it on is a product decision.
      No-enumeration on the forgot form. Verified end to end in dev
      (MAIL_SILENT logs). **To send real mail in an env:** SENDGRID_API_KEY
      set, MAIL_SILENT absent, MAIL_FROM verified in SendGrid
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
- [x] **Supplier cache — coverage check before research** (built 2026-08-22,
      `6ad0232`) — `evaluateStoreCoverage` scores the eligible pool before any
      research; store-hit / research paths, `research_run.fingerprint`,
      `supplier.last_researched_at` (90-day freshness), report says which path
      ran, store-only costs the same quota unit. Verified both paths in dev
- [x] **`data_source` catalogue** — table + `global_web` row seeded and
      consulted by the pipeline (2026-08-22); the `/interne/sources` admin
      screen (enable/disable, per-source store browser, health from
      `source_run`) shipped 2026-08-24 → C1 done
- [x] **Source connector architecture** (built 2026-08-22, `6ad0232`) —
      `src/server/sources/`: one contract (`collect(brief) →
      SourceCandidate[]`, pull-only, self-describing meta), registry keyed by
      `data_source.code`, per-source isolated failure recorded on
      `source_run`. Dedup/provenance/confidence applied by the platform core
      after collection, never inside a connector. `global_web` refactored in
      as connector #1 — adding any later source is one module + one row
- [ ] **Next connectors** (roadmap): first registry (`registry-ca` —
      investigate the API/licensing first, findings to README §9) → `alibaba`
      (**ToS/licensing gate before coding**) → `registry-us` → per demand.
      Store-only connectors also need C1's "Mettre à jour" trigger to be
      useful
- [x] **`supplier_source` memberships + bans** — schema + persistence built
      2026-08-22 (uq pair, payload, first/last_seen, upserts on every
      collection, bans sticky across re-collection via the dedup key; banned
      memberships never resurrected, matcher skips global bans). The staff
      ban/unban surfaces (per-source + global, mandatory reason, who/when
      trail) shipped 2026-08-24 in `/interne/sources` → C1 done
- [x] **`source_run` audit + "Mettre à jour" trigger** — table built and
      written on every request-triggered collection (2026-08-22); the
      admin-triggered refresh (`trigger=admin`, category + optional country
      scope, `triggered_by`, rides the research queue) shipped 2026-08-24
      from `/interne/sources` → C1 done
- [x] **Store-first thresholds + cross-source order settled (= A8,
      2026-08-22)** — see the Phase A entry above and the README flow section
      for the decisions; the token-matching defects were fixed in the matcher
      (numeric-token guard + aliases) rather than by moving thresholds.
      Numbers stay env-tunable for re-tuning against real prod usage

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

> **GATED (user, 2026-08-23): do NOT implement until the facilitation flow is
> defined with the user.** The engagement status machine, who does what at
> each step (buyer / ops / supplier), and what "connected" means operationally
> are product decisions to take together first — same discuss-then-build
> pattern as the sourcing engine. The task list below is the raw material for
> that discussion, not a spec.

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

- [x] **`notification` table + API** (2026-08-23) — one row per recipient;
      `type` + `params` rendered client-side via i18n (same pattern as
      request_event, so language switches re-render history), `link` for
      navigation, `read_at`. `getNotificationsFn` (latest 20 + unread count),
      `markNotificationsReadFn` (one or all). Emitter: `src/server/notify.ts`
      — the ONE door; failure-tolerant (a notification must never break the
      action that caused it); optional localized email through the mail
      adapter
- [x] **Bell made real** (2026-08-23) — `NotificationBell.tsx`: gold dot
      only when unread > 0 (hardcoded dot removed), dropdown lists latest 20,
      click marks read + navigates the link, "Tout marquer comme lu". Fetch
      on mount + on open; no realtime until the product needs it
- [x] Email sender + FR/EN templates — verification & reset (E1),
      invitations (B3), **report-ready** (2026-08-23: in-app + email from the
      worker on the report_ready transition). Engagement-update templates
      wait for gated E6. First emitters wired: `report_ready` (worker) and
      `invitation_accepted` (afterAcceptInvitation hook → inviter)

### E10 — Admin backoffice (`/admin`, staff-gated)

- [x] **Platform user management `/interne/utilisateurs`** (2026-08-23, own
      nav entry) — every account with platform-role badge, email-verified
      mark, workspace, **plan assignment** (moved here from the Abonnements
      screen: people are managed user-centric; Abonnements only edits what
      plans grant), 24h + lifetime usage (the Free-trial counter), signup
      date. Gated by the new `users` platform feature (owner + manager)
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
      an owner who sees the team's requests and usage. First plan whose value
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

- [x] Profile + language (server-persisted) — B5, 2026-08-23
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
- ~~Email provider choice~~ — **decided 2026-08-23: SendGrid** (see B9)
- When to put a reverse proxy + TLS in front of prod (before first external user)
