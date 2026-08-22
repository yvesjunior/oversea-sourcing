# OSI — Oversea Sourcing Intelligence

A **facilitated marketplace** for industrial sourcing. A buyer describes a need in
plain language; the platform extracts structured criteria, searches the web for
real manufacturers, and ranks the most compatible ones. When the buyer picks a
supplier, **OSI steps in as facilitator** — introduction, coordination, then
transaction tracking through to delivery.

Live at **[osi-solutions.com](https://osi-solutions.com)** · TanStack Start
(Vite · React 19 · Nitro SSR) · Postgres 16 · bilingual **FR / EN**.

> This README is the single reference for the project: what it is, how it works,
> how to run it, and why it is built this way. **[`doc/BACKLOG.md`](doc/BACKLOG.md)
> is the companion** — current state, what is done, and what is left to reach MVP1.
>
> **Working today:** the full request loop — criteria (typed *and* from attached
> spec sheets) → real web research → shared supplier pool → criteria-aware
> ranking → printable report, with per-workspace plans and daily quotas.
> **Not built:** facilitation (engagements), transactions, documents,
> notifications, and the supplier import pipeline.

Built with [Lovable](https://lovable.dev)
([editor](https://lovable.dev/projects/a2274c53-10c7-432f-8ad5-d1aeff813df3));
pushes to `main` sync back into Lovable, so avoid rewriting published history.

---

## 1 · The product

**Two-sided eventually, buyer-first now.** MVP1 covers the buyer journey; the
facilitation handoff is the bridge to the supplier side. Multi-tenant buyer
workspaces from day one. Payments are **track-only**; escrow is deferred.

**Public landing, gated action.** `/` needs no login — anyone can type their
need. Clicking *Lancer la recherche* is the auth gate: the draft is preserved
across login/signup and the request is created automatically afterwards. Every
other route requires auth.

### Supplier data strategy (hybrid)

The supplier pool is **platform-global** — OSI's shared asset, enriched by every
request — while requests, engagements and documents are tenant-scoped.

1. **Import pipeline** — baseline coverage from B2B directories, trade
   registries, customs data. *(Not built; the seed script stands in.)*
2. **Live AI web research** — ✅ *live since 2026-08-16.* Per request, an agent
   searches the web, extracts candidate suppliers, and **enriches the database as
   a byproduct**. Every request grows the dataset, so repeat searches in a
   category get cheaper: the DB is the cache.

Consequences, all first-class rather than afterthoughts:

- Every supplier carries **provenance** — `imported` · `ai_researched` · `osi_verified`
- **Confidence** maps to verification level and profile completeness
- **Dedup / entity resolution** is a core subsystem — a unique index on a
  normalized `name|COUNTRY` key, so a repeat search cannot re-add a known company

### Plans & quotas

Limits live in **`plan` rows, not in code or env** — changing what the Free tier
gets is an `UPDATE` from `/interne/plans`, live on the next request, no deploy.

| | Free | Pro | Business | Internal |
|---|---|---|---|---|
| Requests / day | **1** | 10 | 50 | **0 = unlimited** |
| Suppliers returned | 5 | 10 | 20 | 10 |
| Model tier | `cheap` | `best` | `best` | `best` |

`0` means unlimited so the internal plan needs no special case, and an accidental
`0` reads as "no cap" rather than silently locking every buyer out. A workspace
with **no** subscription falls back to the env values, so dev works with an empty
`plan` table.

Quota is enforced in `createRequestFn` — the single choke point every request
passes through, including the post-login auto-create — **before** the insert, so
a refusal leaves no half-created dossier and the buyer keeps their typed text. It
counts `request` rows in a **rolling 24h window** rather than a counter column:
always accurate, nothing to reconcile, and no "two requests at 23:59" hole that a
calendar reset leaves. The allowance returns when the *oldest* request in the
window ages out.

Plan rows are seeded in a **migration**, not the seed script — prod runs
migrations on every deploy and never runs `db:seed`.

> Staff and demo workspaces are moved to `internal` by that migration. With
> `SHOW_TEST_LOGIN=true` and public credentials, `buyer@osi.dev` on the free tier
> would mean one stranger burns the day's allowance and the demo is dead.

**Billing is not wired.** Plans and enforcement work without a payment provider;
`subscription.current_period_end` and the provider columns stay null until Stripe
(or equivalent) lands.

### Sign-in

Email/password plus **Google — production only** (decided 2026-08-17). The code
is always present; the button appears when `GOOGLE_CLIENT_ID` and
`GOOGLE_CLIENT_SECRET` are both set, so dev simply leaves them out. Putting them
in dev would render a button that fails with `redirect_uri_mismatch` unless
`localhost` were also registered, and a broken affordance is worse than none.

The redirect URI Google must have registered is derived from `BETTER_AUTH_URL`:

```
https://osi-solutions.com/api/auth/callback/google
```

Exact string — scheme, host, path, no trailing slash. A mismatch is the single
most common failure. Scopes are `email profile openid` (non-sensitive, so no
Google review), and the consent screen must be **Published**, not left in
*Testing*, or only listed test users can sign in.

Google accounts arrive with `email_verified = true`; email/password accounts do
not, because email verification is not built. Note the signup guards (honeypot,
disposable domains, plus-addressing) only run on `/sign-up/email` — the social
route bypasses them, which is defensible since Google has verified the address.

**Platform roles are granted in the database, never at signup.** `platformRole`
is declared `input: false`, so a signup payload cannot request it — otherwise
anyone could register as platform owner:

```sql
UPDATE "user" SET platform_role = 'owner' WHERE email = '…';
```

The change takes effect on the next sign-in, since the role is read from the
session established at login.

### Roles

**Workspace roles** (buyer companies): `owner` · `admin` · `buyer` · `viewer`.

**Platform roles** (OSI employees, on `user.platform_role`): `owner` (full
control) · `manager` (ops) · `accountant` (finance) · `user` (regular buyer,
default).

**One dashboard for everyone** — there is no separate admin app. Every user gets
the same shell; features are added or removed by role, mapped in
[`src/lib/roles.ts`](src/lib/roles.ts). Buyers see their own workspace only;
`owner`/`manager` see all sourcing dossiers; `accountant` is **forbidden** from
buyers' dossiers — their domain is finance.

Employee surfaces split into **"Vue globale"** / **"Mes données"** via the shared
`EmployeeTabs` component.

**Nav gating:** entries whose feature has no data behind it render **disabled** —
greyed, `aria-disabled`, emitted as a `<span>` rather than a styled link so they
cannot be reached by keyboard or middle-click — rather than being hidden or
linking to an empty page.

### Account model — Individual & Enterprise (SaaS)

> **Status: PROPOSAL — awaiting validation (2026-08-22).** Nothing here is
> built beyond what is explicitly marked as existing. Once validated, the use
> cases become the E2/E12 implementation checklist in
> [doc/BACKLOG.md](doc/BACKLOG.md).

#### The idea in one paragraph

OSI becomes a two-tier SaaS: an **Individual account** is what exists today — a
person signs up and gets a personal workspace with a plan (Free by default). An
**Enterprise account** is a shared workspace owned by a company: one
subscription, many user accounts inside it, invited or created by the workspace
owner, each with rights the owner chooses (manage the account, create requests,
read-only). The enterprise owner gets a managerial view of the team's sourcing
activity and usage.

**Why this is mostly wiring, not building:** the tenancy model was designed for
this from day one. `organization` *is* the workspace, `member` already carries
the four roles (`owner | admin | buyer | viewer`), the `invitation` table
already exists in the schema (better-auth organization plugin — never wired to
any UI), and plans/quotas already attach to the workspace, not the user. What
is missing is the surface: invitation flows, a team screen, role enforcement
helpers, and the managerial view. That is exactly backlog **E2** ([doc/BACKLOG.md](doc/BACKLOG.md)), plus the
Enterprise items added to **E12** on 2026-08-20.

#### Who is who — the three populations

| Population | Identified by | Examples | Powers come from |
|---|---|---|---|
| **Platform staff** (OSI employees) | `user.platform_role` = `owner` · `manager` · `accountant` | ops running facilitation, finance | [`roles.ts`](src/lib/roles.ts) feature map — internal surfaces, all-tenant visibility |
| **Customer — Individual** | regular `user` (+ personal workspace, 1 member) | a solo buyer on Free/Pro | their `member.role` in their own workspace |
| **Customer — Enterprise** | regular `user`s sharing a company workspace | a purchasing team on Business/Enterprise | their `member.role` in the company workspace |

The two axes never mix: `platform_role` is granted only in the database and
gives OSI-internal powers; `member.role` is granted by a workspace owner/admin
and gives powers **inside that workspace only**. A staff member who also buys
would simply have both — like `yves@overseaimportexports.com` today (platform
`owner` + owner of his own workspace).

#### Account types (customers)

| | Individual | Enterprise |
|---|---|---|
| Workspace | Personal, created at signup | Company workspace, shared |
| Members | Exactly 1 (the person) | Many; invited/created by owner or admin |
| Who pays | The person (Free/Pro) | The company (Enterprise plan) |
| Quota unit | **Per user** (= per workspace, since 1 member) | **Pooled per workspace**, with optional per-member ceilings |
| Managerial view | — | Owner/admin see all team requests + usage |
| Plans | Free · Pro | Business · Enterprise |

An individual account is not a separate concept in the database — it is simply
a workspace with one member. Nothing about today's signup flow changes.

#### Workspace roles and rights

The four existing `member.role` values, given precise meanings:

| Right | `owner` | `admin` | `buyer` | `viewer` |
|---|---|---|---|---|
| Manage the account (plan, billing, rename, delete) | ✅ | — | — | — |
| Invite / create members, assign roles | ✅ | ✅ | — | — |
| Remove members, revoke invitations | ✅ | ✅ (not the owner) | — | — |
| See all the team's requests & reports | ✅ | ✅ | — | — |
| See team usage (quota consumption, per member) | ✅ | ✅ | — | — |
| Create sourcing requests | ✅ | ✅ | ✅ | — |
| See own requests & reports | ✅ | ✅ | ✅ | — |
| See requests shared with the workspace | ✅ | ✅ | ✅ | ✅ |

Rules that keep this simple:

- **Exactly one `owner` per workspace.** Ownership transfers, it does not fork.
  (Transfer is an owner-only action; the previous owner becomes `admin`.)
- **`admin` is "manage the team", `owner` is "manage the account".** The single
  right that separates them is money and account lifecycle.
- Roles are per-workspace: the same user can be `owner` of their personal
  workspace and `buyer` inside an enterprise.
- Workspace roles are unrelated to `user.platform_role` (OSI staff). An
  enterprise owner has no OSI-internal powers, ever.

#### Use cases

##### UC-1 — Individual signup *(exists today, unchanged)*
A person signs up (email/password or Google). A personal workspace is created,
they are its `owner`, subscription = Free. Everything below is additive.

##### UC-2 — Create an enterprise workspace
An authenticated user clicks **"Créer un espace entreprise"** (Paramètres),
names the company, and becomes its `owner`. Their personal workspace is
untouched — they now belong to two workspaces and can switch between them (the
active workspace is session state; better-auth's org plugin supports this
natively). The enterprise workspace starts on a trial/Business plan until
billing lands (open question Q3).

*Acceptance:* switching workspaces re-scopes every list (requests, suppliers
links, stats) with no leakage between the two; the workspace switcher shows
both, with the active one marked.

##### UC-3 — Invite an existing or new user by email
Owner/admin enters an email + role on the **Équipe** screen. An `invitation`
row is created (`pending`, expires in 7 days).
- Email already has an OSI account → they see the invitation at next login
  (and receive an email once E9 lands), accept or decline.
- Email unknown → the invitation email carries a signup link; after signup the
  invitation auto-attaches (match on verified email).

*Acceptance:* accepting creates exactly one `member` row with the invited role;
declining or expiry ends the flow; the inviter sees status (pending / accepted
/ expired) and can revoke while pending. Signup-guard rules still apply to the
new-user path (an invitation is not a rate-limit bypass, but it does bypass the
disposable-domain block only if we decide so — open question Q5, default: no
bypass).

##### UC-4 — Owner creates a member account directly
For companies that don't want a signup dance: owner/admin enters name + email,
OSI creates the account **without a password** and emails a set-password link
(same mechanics as password reset). Until the link is used the account cannot
log in. No temporary passwords: they end up on sticky notes; a set-password
link expires cleanly.

*Acceptance:* the created user lands directly as a member with the assigned
role, `email_verified = false` until the link is used; the link expires (48h)
and can be re-sent.

##### UC-5 — Change a member's rights
Owner/admin changes a member's role from the team screen. Effect is immediate
on next request (server functions re-read membership per call — no session
invalidation needed since role lives in `member`, not the session).
Constraints: `admin` cannot touch the `owner` or promote anyone **to** owner;
demoting yourself below `admin` is confirmed with a warning if you are the last
admin besides the owner.

##### UC-6 — Remove a member / member leaves
Owner/admin removes a member; or a member leaves voluntarily (Paramètres).
Their `member` row is deleted; their user account and personal workspace are
untouched. **Their requests stay with the enterprise workspace** — the data
belongs to the tenant, not the person (this is the whole point of enterprise).
The `owner` cannot be removed and cannot leave without transferring ownership.

##### UC-7 — Quota & usage (the money view)
The enterprise plan's `requests_per_day` is a **pooled workspace limit**
(existing behavior — quotas already count per `organization_id`). Optional:
a per-member daily ceiling within the pool (e.g. pool 50/day, each buyer max
10/day) so one person cannot exhaust the team's allowance — this is the
`quota_scope` refinement already sketched in E12. The Free individual plan
counts per user, which is identical to per-workspace while workspaces have one
member, so **individual accounts need no code change**.

*Acceptance:* the quota refusal alert (shipped 2026-08-20) states which limit
was hit — "your daily limit" vs "your team's daily limit".

##### UC-8 — Managerial view
Owner/admin get a **Mon équipe** surface in the workspace: members and their
roles, pending invitations, each member's requests (count + list, linkable),
and usage against the pooled quota over the current window. Buyers see only
their own dossiers, exactly as today; viewers see dossiers shared with the
workspace but the "Lancer la recherche" affordance is disabled for them (same
disabled-not-hidden nav rule the app already follows).

##### UC-9 — Settings & subscription (every account)
Every account — individual and enterprise — gets a **Paramètres** surface with:

- **Profil** — name, language (server-persisted; syncs the existing toggle)
- **Abonnement** — the workspace's current plan, its limits, live usage
  against the daily quota, and the upgrade path. Read-only until billing
  lands (the upgrade CTA is "Contactez-nous" for now); becomes self-service
  with Stripe. This is the buyer-facing counterpart of the staff screen
  `/interne/plans` — same data, no editing.

The panel is scoped to the **active workspace**: switch workspace, see that
workspace's plan. Visible to every member; plan *changes* stay owner-only
(rights matrix above).

##### UC-10 — Enterprise user management view
Enterprise workspaces additionally show a **Utilisateurs** section in
Paramètres — visible to `owner`/`admin` only (disabled-not-hidden for others,
per the nav rule). It is the operational home of UC-3…UC-6: members list with
roles, invite by email, create an account directly, change rights, remove,
pending invitations with revoke/resend. The managerial *analytics* (UC-8) can
live as a tab of the same surface — "Utilisateurs" manages people,
"Mon équipe" reads activity; one screen, two tabs.

##### UC-11 — Billing (deferred, unchanged)
One subscription per workspace — already the data model. Enterprise pricing is
per-seat or flat (open question Q4); the `subscription` provider columns stay
null until Stripe lands. Nothing in UC-1…UC-10 depends on billing.

#### What it takes to build (delta over today)

| Piece | Status |
| --- | --- |
| `organization`, `member` (4 roles), `invitation`, `subscription` tables | ✅ exist |
| Pooled workspace quota at the choke point | ✅ exists (`checkRequestQuota`) |
| Workspace switcher + active-organization session state | ⬜ better-auth org plugin feature — wire it |
| `requireRole(workspaceId, minRole)` helper used by every mutating server fn | ⬜ E2 — the enforcement backbone, build first |
| Invitation server fns (create/accept/decline/revoke) + team screen | ⬜ E2 |
| Create-member-with-set-password-link flow | ⬜ needs the email provider (E9 dependency) |
| Managerial view (members, usage, team requests) | ⬜ new surface, reads existing tables |
| Paramètres: profile + **Abonnement** panel (plan, usage, upgrade CTA) | ⬜ E11/E12 — read-only version needs no billing |
| Paramètres: **Utilisateurs** view (enterprise, owner/admin-gated) | ⬜ E2 — the home of invite/create/rights/remove |
| Per-member ceiling within the pool (`quota_scope`) | ⬜ E12 refinement, small |
| Enterprise plan row | ⬜ one migration (plans are rows) |
| Ownership transfer | ⬜ small server fn + confirm UI |

**Hard dependency to call out:** UC-3 and UC-4 need an **email provider**
(Resend vs SMTP — open decision since E9). Without it we can ship
invite-by-link (owner copies an invitation URL and sends it themselves) as an
interim: same tables, no email.

#### Open questions to validate

- **Q1 — Do enterprise members keep a personal workspace?** Proposal says yes
  (it already exists for anyone who signed up individually). Alternative: users
  created via UC-4 get *no* personal workspace — they live only in the
  enterprise. **Proposed default: UC-4 users get no personal workspace;
  self-signup users keep theirs.**
- **Q2 — Can one user belong to several enterprises?** The schema allows it.
  Proposed default: allow, it costs nothing; the switcher handles it.
- **Q3 — What plan does a fresh enterprise workspace get before billing
  exists?** Proposed: `business` limits, assigned manually by OSI staff from
  `/interne/plans` after a sales conversation — no self-service enterprise
  creation until billing lands. This also answers "who can create an enterprise
  workspace today": staff-assisted only, behind a "Contactez-nous".
- **Q4 — Enterprise pricing model** — per-seat or flat + pooled quota. Pure
  business decision; schema is agnostic (`plan` rows).
- **Q5 — Do invitations bypass signup guards?** Proposed: no bypass of
  disposable-domain/plus-addressing; invitations are not an abuse hole.
- **Q6 — Viewer scope** — "requests shared with the workspace": is every team
  request visible to viewers, or per-request sharing? Proposed v1: all team
  requests are visible to every member ≥ viewer; per-request confidentiality is
  a later refinement if a client asks.

---

## 2 · How a request works

```
draft → received → searching → validating → report_ready → closed
                                    ↓
                              (cancelled)
```

Guarded transitions live in [`src/lib/request-status.ts`](src/lib/request-status.ts);
illegal ones throw. Every change writes a `request_event` row, so timelines,
activity feeds and dashboard stats are **pure read-models of the DB**.

1. **Create** (`createRequestFn`) — the hero prompt inserts a `request` (ids from
   `request_id_seq`, `#3000+`) and **parses criteria synchronously at intake**
   ([`parse-criteria.ts`](src/server/parse-criteria.ts) — deterministic regex,
   instant, zero tokens, editable afterwards). There is no pre-search AI analysis
   *(removed 2026-08-05)*; an ℹ️ helper on the prompt guides buyers to structured
   input instead. With attachments, the pipeline is held until the upload
   finishes, then released.
2. **Research** (worker, `searching`) — reads any attachments, runs a **real web
   search**, and inserts newly-found companies as `ai_researched` suppliers,
   deduped on `supplier.dedup_key`.
3. **Match** — scores the pool against the request's criteria and persists a
   ranked Top-N in `match`, with the per-criterion reasoning in `score_breakdown`.
4. **Report** — `/demandes/$id/rapport` renders the need, criteria, ranked
   suppliers and methodology, with PDF export via the browser's print pipeline.
5. **Recovery sweep** — on boot and every 60 s the worker re-adopts requests
   stranded mid-pipeline (crash, lost enqueue) and runs them to completion.

### Attachments are read, not just stored

A sourcing need often lives in a spec sheet rather than a textarea. Text/CSV are
decoded directly (zero tokens); PDFs and images are read by the model. Criteria
found in them are parsed with the **same intake regexes**, so a criterion from a
PDF is indistinguishable from a typed one, and the content also feeds the search
brief. See [`src/server/attachments.ts`](src/server/attachments.ts).

### Scoring

```
10 base
+55 × criteria coverage        (required criteria weighted ×2)
+20 × confidence / 100
+12 verified · +5 pending · 0 unverified · −25 rejected
−0 / 4 / 10                    risk: low / medium / high
```

Numeric criteria (pressure, flow, quantity, lead time) are recorded as
**`unverifiable`** and excluded from the denominator rather than counted as
misses — a one-line supplier description cannot evidence "16 bar", and scoring
absence as failure penalises every supplier equally. They become checkable when
the capability/certification satellite tables exist.

---

## 3 · Running it

Everything operational is a script in [`scripts/`](scripts). Config is a single
**gitignored** `.env` holding config *and* secrets — `cp .env.example .env` to
start.

| Situation                        | Command                                                                    |
| -------------------------------- | -------------------------------------------------------------------------- |
| **New machine, first time**      | `./scripts/setup.sh` — checks Docker, creates `.env`                       |
| **Develop locally** (hot-reload) | `./scripts/dev.sh` → http://localhost:3010                                 |
| **Test the prod image locally**  | `./scripts/prod.sh` → http://localhost:3010 (stop dev first — same port)   |
| **Stop local stacks**            | `./scripts/stop.sh [dev\|prod\|all]` (volumes kept)                        |
| **Query the database**           | `./scripts/db.sh [dev\|prod] [-c "SQL"]` — psql shell by default           |
| **Provision a (new) prod VM**    | `./scripts/setup-vm.sh` — Docker check, clone, `.env`                      |
| **Deploy to prod**               | `./scripts/deploy.sh` — pull `main`, rebuild, restart, health-check        |
| **See what's running where**     | `./scripts/status.sh` — local + VM containers & health                     |
| **Follow logs**                  | `./scripts/logs.sh [dev\|prod]` · `./scripts/logs.sh --remote`             |
| **Enable optional infra**        | `./scripts/addons.sh [--remote] storage monitoring …`                      |
| **Disable optional infra**       | `./scripts/addons.sh [--remote] --down` (never touches the app)            |
| **Back up the database**         | `./scripts/backup.sh [--local]` → `./backups/`                             |
| **Restore a backup**             | `./scripts/restore.sh <dump> --local\|--remote` _(destructive, confirmed)_ |

Remote scripts default to `DEPLOY_HOST=yves@192.168.2.56`,
`DEPLOY_PATH=/home/yves/workspace/apps/oversea-sourcing`, `WEB_PORT=3010`,
`BRANCH=main` — override per run: `BRANCH=hotfix/x ./scripts/deploy.sh`.

> **Every prod push updates [`doc/BACKLOG.md`](doc/BACKLOG.md) and this README in
> the same commit.** With no CI and no staging, these files are the only durable
> record of why prod looks the way it does. Check off what shipped, record the
> decision, name the deviation.

```sh
# Day-to-day
./scripts/setup.sh && ./scripts/dev.sh

# Ship to production — docs updated in the same commit
git push && ./scripts/deploy.sh && ./scripts/status.sh
```

Without Docker: `npm install && npm run dev` → http://localhost:8080 (Vite's own
port; Docker maps it to 3010). Other scripts: `build`, `preview`, `lint`,
`format`, `typecheck`.

### Configuration

Required in `.env`: `POSTGRES_PASSWORD`, `DATABASE_URL`, `BETTER_AUTH_SECRET`
(32+ chars), `BETTER_AUTH_URL`, `ANTHROPIC_API_KEY`. Dev uses safe database
defaults from `docker-compose.dev.yml`, so a fresh clone needs only
`cp .env.example .env` plus the API key.

> ⚠️ `POSTGRES_PASSWORD` applies **only when the volume is first initialised**.
> Changing it later does not change the database's password — it just breaks
> `DATABASE_URL`, and drizzle-kit reports the failure as a silent `exit 1`.

> ⚠️ `BETTER_AUTH_URL` **must be the public origin in production**
> (`https://osi-solutions.com`), or better-auth rejects logins from the domain
> with `INVALID_ORIGIN`.

| Setting              | Default    | What it does                                                                          |
| -------------------- | ---------- | ------------------------------------------------------------------------------------- |
| `AI_RESEARCH`        | **`true`** | Real web search per request. Off falls back to a simulated search stage               |
| `AI_CHAT`            | `false`    | Per-request assistant chat. Off hides the UI and the server refuses messages          |
| `ANTHROPIC_MODEL`    | `cheap`    | Tier (`cheap`/`balanced`/`best`) or a raw model id — registry in `ai/models.ts`        |
| `SUPPLIERS_RETURNED` | `5`        | Suppliers shown per dossier. **Search count and candidate caps derive from it**       |
| `SHOW_TEST_LOGIN`    | `true`     | One-click demo login on `/login`. **Set false before real users** — creds are public  |

Measured 2026-08-16 on identical requests: `cheap` (haiku-4-5, 3 searches) ≈
**$0.06** · `best` (opus-5, 6 searches) ≈ **$0.20** · `balanced` (sonnet-5, 6) ≈
**$0.21** — no cheaper than `best` despite a 60% lower rate, because it spent
2.5× the output tokens. `cheap` finds roughly half as many companies and lets the
odd directory through.

### Database

Postgres 16 (+pgvector) with Drizzle. Migrations run automatically on every `up`
via the one-shot `migrate` service.

```sh
npm run db:generate   # after editing src/database/schema.ts
npm run db:migrate    # compose does this automatically
npm run db:studio     # browse the dev database

# Seed demo accounts (dev) — password: osi-demo-1234
docker compose -f docker-compose.dev.yml exec web npm run db:seed
# owner@ · manager@ · accountant@ · buyer@osi.dev  (+ a 12-supplier pool)
```

---

## 4 · Architecture

**Modular monolith with physical seams.** One codebase, but every module sits
behind an interface that could become a network boundary — extraction is a deploy
change, not a refactor.

| Concern      | Choice                                                              |
| ------------ | ------------------------------------------------------------------- |
| Web / API    | TanStack Start monolith (Nitro server *is* the API host)             |
| Database     | PostgreSQL 16 + pgvector, Drizzle + drizzle-kit                     |
| Jobs         | **pg-boss** — the queue lives in Postgres, no Redis to operate       |
| Auth         | **better-auth** + organization plugin (`organization` = workspace)   |
| Validation   | **zod** on every server-fn boundary                                  |
| AI           | Claude via the `src/server/ai/` gateway                              |
| File storage | Local volume behind an S3-shaped adapter                             |

**Hard rules that make this work:**

- Domain code never imports a vendor SDK directly — always through an adapter
- Every job idempotent (safe to retry); every handler workspace-scoped
- One image, three processes: `web`, `worker`, one-shot `migrate`

### Module map and extraction seams

| Module            | Lives in                                   | Seam when overloaded                                        |
| ----------------- | ------------------------------------------ | ----------------------------------------------------------- |
| Web/SSR + API     | Node container (Nitro)                     | Stateless → replicate behind the proxy                       |
| Workers           | Separate container, same image             | Scale replicas; per-queue concurrency                        |
| AI gateway        | `src/server/ai/` — sole owner of Claude calls, retries, cost metering, model tiering | Own service if several apps consume it |
| **Research agent** | ⚠️ **Inline in the pipeline job** — the plan calls for its own `research` queue from day one. Known deviation; move it before load, not after | Dedicated queue + worker pool |
| Database          | Postgres container + named volume          | pgbouncer → dedicated local DB VM (no managed cloud PG)      |
| File storage      | Local volume, S3-shaped adapter            | Same code → MinIO / R2 / S3                                  |
| Search            | Postgres FTS + trigram                     | Meilisearch when the directory outgrows SQL                  |

### Where overload hits first

| # | Hotspot                | Symptom                                   | Lever (designed in)                                             |
| - | ---------------------- | ----------------------------------------- | ---------------------------------------------------------------- |
| 1 | **AI research**        | Requests stuck in `searching`; rate limits | Own queue + concurrency; worker replicas; **the DB is the cache** |
| 2 | **Claude cost/limits** | Bill spikes, 429s                          | Model tiering, budget guards, prompt caching                     |
| 3 | **Postgres**           | Slow matching, connection exhaustion       | Indexes on every `workspace_id` (day one); pgbouncer            |
| 4 | **SSR under traffic**  | Slow TTFB                                  | Replicate web containers (stateless by rule)                     |

---

## 5 · Data model

**Tenancy rule:** every buyer-facing query is workspace-scoped. **Exception by
design: `supplier` and its satellites are platform-global.**

```mermaid
erDiagram
    user ||--o{ member : has
    organization ||--o{ member : has
    organization ||--o{ request : owns
    request ||--o{ request_criterion : has
    request ||--o{ request_event : timeline
    request ||--o{ request_attachment : has
    request ||--o{ research_run : triggers
    request ||--o{ match : ranked
    supplier ||--o{ match : candidate
    request_attachment }o--|| file : points_to
```

| Table                | Key fields                                                                                                                              |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `user`               | email (uq), name, locale, **`platform_role`** `user\|owner\|manager\|accountant`                                                          |
| `organization`       | name, slug — **the workspace** (better-auth organization plugin)                                                                         |
| `member`             | organization_id, user_id, role `owner\|admin\|buyer\|viewer`                                                                             |
| `request`            | organization_id, created_by, title, description_raw, **status**, locale, compatibility_score, launched_at, completed_at                   |
| `request_criterion`  | request_id, category `material\|flow\|pressure\|certification\|quantity\|lead_time\|other`, label, value, unit, required, source `ai\|user` |
| `request_event`      | request_id, organization_id, type (`status.*`, `research.*`, `criteria.*`), message (JSON params)                                        |
| `supplier`           | name, descriptor, country_code, website, description, **provenance**, **verification_status**, confidence_score, risk_level, source_ref, **`dedup_key` (uq)**, **`discovered_by_request_id`** |
| `match`              | request_id, supplier_id, rank, compatibility_score, confidence_score, risk_level, status, **`score_breakdown` jsonb** — uq(request, supplier) |
| `research_run`       | request_id, status `running\|succeeded\|failed`, queries jsonb, candidates_found, suppliers_added, error                                  |
| `file` / `request_attachment` | organization-scoped file store; bytes behind `src/server/storage.ts`                                                            |

**Not yet built:** `engagement`, `transaction`, `document`, `notification`,
`sourcing_rules`, `audit_log`, `import_run`, and the supplier satellites
(capabilities, certifications, contacts).

---

## 6 · Infrastructure

Single VM (`192.168.2.56`), docker compose. Public ingress and TLS via a
**Cloudflare Tunnel** (`cloudflared`) on **osi-solutions.com** — the app
container is never internet-exposed and the VM needs no public IP.

```mermaid
flowchart LR
    U((Users)) --> CF[Cloudflare · TLS/DDoS]
    subgraph VM [prod VM · no public IP]
        CF -. tunnel .-> T[cloudflared]
        T --> W1[web · Node SSR/API]
        W1 --> PG[(Postgres 16)]
        WK[worker · pg-boss] --> PG
        W1 --> UP[(uploads volume)]
        WK --> UP
    end
    WK -.-> CL[Claude API + web search]
```

**Decisions that shape this** — all deliberate, all reversible on a signal:

- **No cloud provider.** Local/own VMs behind the tunnel at every stage; scaling
  means more local hardware, not a migration.
- **No CI, no image registry.** Builds are local everywhere; the VM pulls `main`
  and builds its own image. Rollback = `git checkout <sha>` + rebuild.
- **No staging.** Dev and prod only; rehearse risky migrations on a dev restore
  of a prod dump.
- **Not Kubernetes.** If orchestration is ever needed, Docker Swarm across local
  VMs — compose files translate almost as-is.

Optional components (MinIO, Redis, Meilisearch, Uptime-Kuma, Dozzle, ClamAV,
Adminer) are **profile-gated** in `docker-compose.addons.yml` — nothing starts
unless asked: `./scripts/addons.sh [--remote] <profile>`.

> **The prod containers force IPv4 DNS resolution** (`NODE_OPTIONS=--dns-result-order=ipv4first`).
> The VM has no IPv6 route, but DNS returns AAAA records for Google, Anthropic
> and most large hosts; Node's happy-eyeballs races both families and the dead v6
> attempt can hang until the socket times out rather than failing fast. That is
> what made Google sign-in "fail silently" on 2026-08-17 — the server-to-server
> token exchange timed out inside better-auth with no user-visible error. It
> applies to `web` **and** `worker`, since the worker's Claude and web-search
> calls are exposed to the same hang. Remove it if the VM ever gets real IPv6.

### Security baseline

- ✅ TLS + ingress via Cloudflare Tunnel; Postgres not exposed on host ports in prod
- ✅ **Signup abuse controls** — IP rate limits (3 signups/hour, 10 logins/5 min),
  honeypot field, disposable-domain and plus-addressing blocks
  ([`src/lib/signup-guard.ts`](src/lib/signup-guard.ts)). Real client IP resolved
  from `cf-connecting-ip` behind the tunnel
- ✅ Nightly `pg_dump`; restore drills via `scripts/restore.sh`
- ⚠️ Rate-limit storage is **in-memory** — per-process counters do not add up once
  the web tier is replicated; Redis is the swap
- ⚠️ **Only `/api/auth/*` is rate limited.** TanStack server functions
  (`/_serverFn/*`) and `/api/upload` have no limit of their own: the plan quota
  bounds how many requests a workspace may make per day, not how fast, so a
  Business workspace can fire all 50 at once
- ⚠️ **The daily quota races.** It is check-then-act: two requests arriving in the
  same instant both read the count, both pass, and both insert — reproduced at
  2 rows against a limit of 1. Fix is an advisory lock on the workspace id around
  check-and-insert
- ⬜ Email verification (needs a provider), 2FA, error tracking

---

## 7 · Internationalization

`react-i18next`; **French is the default**, English the fallback. All
user-facing text lives in `src/i18n/locales/{fr,en}.json` — never hardcode a
string in a component; add a key and use `t(...)`. The language toggle is in the
top bar and persists to `localStorage`.

Country names fall back to `Intl.DisplayNames`, so a supplier from any country
renders correctly without a translation entry.

---

## 8 · Project structure

| Path                          | Purpose                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------ |
| `src/routes/`                 | File-based routes; `api/` for upload/download/auth                             |
| `src/lib/*-fns.ts`            | Server functions (requests, criteria, chat, suppliers, stats) — zod-validated   |
| `src/lib/*.ts`                | Pure, client- and server-safe logic (roles, status machine, dedup key, guards)  |
| `src/server/`                 | Server-only: auth, queue, matching, research, attachments, storage              |
| `src/server/ai/`              | **The only place that calls Claude** — gateway, model registry, research agent  |
| `src/server/sourcing-config.ts` | `SUPPLIERS_RETURNED` and everything derived from it                          |
| `src/worker.ts`               | Background worker entrypoint (pg-boss)                                         |
| `src/database/`               | Drizzle schema, migrations, seed                                               |
| `src/data/osi.ts`             | Remaining showcase data (transactions only — analytics is now DB-backed)        |
| `infra/Docker/`               | `web.Dockerfile` (database uses the pgvector image)                            |
| `scripts/`                    | Everything operational                                                          |
| `doc/BACKLOG.md`              | **What is done, in progress, and open**                                        |

---

## 9 · Open decisions

- **External supplier data sources & licensing** for the import pipeline
- **The concrete "32 compatibility criteria"** — needs a product workshop; the
  weighted v1 scorer stands in
- **Email provider** (Resend vs SMTP) — blocks email verification and invitations
- **Escrow / payment provider** (Phase 4)
- **`src/web/`** — the frontend lives at `src/`; moving it risks breaking Lovable
  editor sync, so it is deferred
