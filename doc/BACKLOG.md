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
| **E1** Auth & users | better-auth, signup, guards, verification, reset, **2FA (2026-08-27)**, **verification ENFORCED (2026-08-28)** | ✅ done |
| **E2** Workspaces & tenancy | Roles, invitations, team UI | ✅ Phase B (2026-08-23) + audit journal (2026-08-27); invites are organisation-only |
| **E12** Plans & quotas | Full ladder, seats, trial cap, Abonnements | 🟡 billing provider open |
| **E3** Request core loop | Pipeline, criteria, attachments, dossier | ✅ done |
| **E4** Supplier data | **Web research**, dedup, directory, sources admin | 🟡 **ADR-001 pivot (2026-08-26) → Phase S**; import/merge open |
| **E5** Matching & scoring | Criteria-aware v1 + breakdown | 🟡 the "32 criteria" + comparison view open |
| **E6** Facilitation | ~~Engagements~~ → **soumissions → dossier de transaction → contrats** | 🔵 **redefined 2026-08-29 by [ADR-002](adr/ADR-002-transaction-and-contract-centre.md) → Phase P**; old task list RETIRED |
| **E7** Reports | Printable report + PDF export | 🟡 stored `documents` rows open |
| **E8** Transactions | Milestones, tracking, paiements | 🔵 **folded into Phase P** by ADR-002 (the `deal` spine); standalone sketch retired |
| **E9** Notifications | In-app + email | 🟡 bell, emitters, **prefs (2026-08-26)** live; E6 templates gated |
| **E10** Admin surfaces | Verification, imports, ops queue | 🟡 **verification LIVE (S5b/S5c, 2026-08-26)**; imports/ops queue placeholders |
| **E11** Settings | Profile, sourcing rules | 🟡 Paramètres + notification prefs live; **password / 2FA / theme / rename (2026-08-27)** live; buyer Abonnement self-service waits for billing |

**MVP1 = E0–E7 + E10.** Definition of done **restated 2026-08-29 by ADR-002**
(the old one — *"clicks Engager, ops sees it in the queue, the buyer sees
'connected'"* — is retired with the E6 sketch): a real buyer signs up, submits a
real need, gets a real Top-N, **OSI solicits quotes, the buyer accepts one, the
required contracts are signed by every mandatory party, and the commande is
tracked to delivery** — with the PDF report available throughout.

## Resume here (last session: 2026-08-29 — the portal brief + deploys #12 to #16)

### Session digest 2026-08-29 — the portal brief, and deploy #12

**DEPLOY #16 IS LIVE — commit `cf83c39`, code-only** — pending drafts expire
after **1 h** (owner, same day). Backup: `backups/osi-20260829-122252.sql.gz`.

**DEPLOY #15 — commit `1cccd7e`, code-only, no migrations** (a
pending draft never spends money on its own). Backup first:
`backups/osi-20260829-120827.sql.gz`. Verified ON PROD: origin 200, five
containers up, VM on `1cccd7e`, data intact (10 users · 11 orgs · 8 requests ·
67 suppliers · 40 matches), and the anonymous landing still carries the intake
form + the gate hint — the auth gate is intact, it simply no longer submits
for the buyer.

**DEPLOY #14 — commit `0508475`, migration 0032** (the two designs).
Backup first: `backups/osi-20260829-114957.sql.gz` (31M). Verified ON PROD:
`user.design` column present with default `light`; origin 200; data intact
(10 users · 11 orgs · 8 requests · 67 suppliers · 40 matches); and the two
preference cookies compose correctly at the SSR layer —
`<html lang="fr">` with no cookie, `<html lang="en" class="dark">` under
`Cookie: osi-design=dark; osi-lang=en`. **Existing users are unaffected until
they touch the switch: light is the default.**

**DEPLOY #13 — commit `2565e64`, code-only, no migrations** (the
i18n hydration fix). Backup first: `backups/osi-20260829-113209.sql.gz`.
Verified ON PROD: `https://osi-solutions.com/` serves French nav with no
cookie and **English nav under `Cookie: osi-lang=en`**, `<html lang>` follows
in both, five containers up. That is the defect fixed at the source — SSR now
renders the visitor's language instead of switching after hydration.

**DEPLOY #12 — commit `95812c8`, code-only, no migrations.** Backup
first: `backups/osi-20260829-112247.sql.gz` (31M). Verified on prod: public
origin 200 · five containers up (migrate exited clean) · the merged nav
rendered by prod SSR (Tableau de bord · Demandes · Fournisseurs · Soumissions ·
Contrats · Commandes · Documents · Paiements · Messages · Rapports ·
Paramètres) · the anonymous landing keeps the hero + intake form · data intact
(10 users · 11 orgs · 8 requests · 67 suppliers · 40 matches).
**Rollback = `git checkout deploy-11-baseline` + rebuild on the VM** (the tag
marks deploy #11, the pre-session state).

**What shipped:** the intake form moved to `/demandes` (P0 ③), home became the
dashboard (P0 ②), the merged navigation — 15 entries → 20, unbuilt ones greyed
with no route (P0 ④) — `Analyses` moved into the INTERNE block, and a
`suppressHydrationWarning` guard on the dossier timestamp.

**The language-toggle hydration defect** was diagnosed after deploy #12 and
**fixed in deploy #13 the same day** — cookie + one i18n instance per
language + server-side resolution. Full write-up under
"~~Hydration breaks once a visitor picks a language~~ ✅ FIXED" below.

**Next code task: pick-up item ⓪ (the search relevance gate).**

**P0 is DONE** (deploys #12 and #14). The only piece deliberately left is
**enriching the dashboard toward the brief's mockup** (dépenses chart,
activités récentes) — cosmetic, and it belongs with the Tableau de bord work
rather than the shell.

**The design pass (docs only, no code):**
- [doc/briefs/portail-entreprise.md](briefs/portail-entreprise.md) — the brief
  transcribed into the repo (it existed only on the owner's Desktop).
- [ADR-002](adr/ADR-002-transaction-and-contract-centre.md) — the transaction
  dossier & contract centre. **Status: PROPOSED, awaiting owner validation.**
- **Phase P** below — the implementation plan, P1…P11 plus its gates.

**The one thing a future session must not get wrong:** the brief brings a NEW
process, and the old E6 facilitation design is **retired, not extended** (owner,
2026-08-29). There is no `engagement` entity, no "Engager" button, no ops queue,
no "connected" state. The process is `demande → fournisseurs → soumissions →
acceptation → dossier de transaction → contrats → commande → livraison`, and a
**quote (soumission) is the unit of facilitation**. Suppliers and
sub-contractors have **NO platform access** — parties are rows, staff mediate
everything by email.

**Two hard gaps this surfaced, neither of them design questions:**
- ❗ `scripts/backup.sh` dumps Postgres only — **the `osi-uploads` volume is not
  backed up anywhere.** Tolerable for re-uploadable spec sheets; not for signed
  contracts. Must be fixed before P8.
- ❗ No document retention policy, and `storage.deleteFile` is never called on
  user files (bytes orphan when a request is deleted).

**Still the next CODE task, unchanged:** pick-up item ⓪, the search relevance
gate — quotes solicited off an irrelevant Top-N are the wrong quotes.

### Previous session digest (2026-08-27/28 — the logging + foundation-gaps session)

**Digest 2026-08-27/28 — the deploy #6-#11 wave:**

**Prod state: see the deploy markers on ②l–②q below — FIVE deploys this
session (#6 `67b4b5d` migs 0028–0030 · #7 `31f8a4c` · #8 `49d6521` mig
0031 · #9 `5eb82cb` · #10 `10998d9`), plus #11 (the ②q wave — the deploy
record on the entry states the commit). Migrations through 0031 applied
everywhere; every deploy verified (origin 200, containers, data) with a
pre-deploy backup in `backups/`.**

**The one-paragraph state of the world (2026-08-28 EOD):** the buyer loop
runs end to end on prod with enforced email verification (prod-only —
dev opts out via `REQUIRE_EMAIL_VERIFICATION=false`), opt-in 2FA, personal
themes, org-only invitations, and readable-formats-only uploads. Staff
access is a live permission matrix (owner always-on; manager currently
holds facilitation/finance/plans/source-toggle per the owner's grants);
staff powers exist only inside the OSI workspace; every lifecycle/admin
action lands in a deletion-proof, purgeable, two-tier journal. Sources
are presented as SEARCH (global_web, the default) vs VERIFICATION
(registries — platform switch is the single control, honored by the
battery since #9). Team on prod: Yves (owner) + Henrik & Renaud
(managers, OSI-enrolled, internal-plan personal workspaces). **The next
code task is pick-up item ⓪ (the search relevance gate); the next design
task is the E6 facilitation discussion.**

**What shipped (details in ②l / ②m below):**
- **Deploy #6** (`67b4b5d`, migs 0028–0030): the Logging surface
  (own nav entry, range pagination, cascading org→user + time-range
  filters), deletion-proof audit (tombstone ids — history survives
  account/workspace deletion; actor captured on member actions), the
  Profil personal hub (password change · **2FA** · personal accent
  theme), workspace rename with live badge refresh, owner-exclusive
  platform-role grant that enrolls into the OSI org, and
  **individual workspaces cannot invite** (org-only, both layers).
- **Deploy #7** (`31f8a4c`, code-only): journal **purge** (owner-only,
  entries older than `AUDIT_RETENTION_MONTHS = 3`, self-auditing) and
  **two-tier journal access** — staff see all on /interne/logging; an
  organisation's OWNER sees their own org's rows on Paramètres →
  Journal (scope forced server-side; shared AuditJournal component).
- **Live plan edit (no deploy)**: internal plan `model_tier → cheap`
  on dev AND prod (~$0.07 vs ~$0.20 per staff test request).
- Measured per-request AI cost (6 real dev runs, cheap tier): ~30k in /
  ~1.3k out tokens, 3–5 searches, **≈ $0.07–0.09 all-in**; store-hits $0.

**Pick-up list (next session):**
⓪ **SEARCH ACCURACY — diagnosed 2026-08-28, fix designed and VALIDATED
  with the owner, NOT yet implemented.** Root cause: quality points
  masquerade as compatibility — the scorer awards `10 base + 20×conf +
  12 verified − risk` INDEPENDENT of relevance, so a verified supplier
  scores ~40-41 with ZERO criteria matched. Evidence (dev): request
  #2540 "Composants électroniques" — the whole Top-5 is pump/bearing
  companies, every criterion `missed`, each at 40-41%; #2536 textiles
  carries ITALPOMPE at rank 5 on the same floor. WORSE: the floor
  clears `STORE_MIN_SCORE=40`, so `countQualifyingCandidates` lets a
  pool of ≥2×N verified irrelevant suppliers STORE-HIT any request —
  new categories never trigger web research and get served the old
  pool. Amplifiers: Top-N pads with ineligibles (`slice(N)`), and
  all-numeric-criteria requests get a free 0.5 coverage midpoint (+27).
  **The agreed fix — relevance is a GATE, not a component:**
  ① a candidate with zero matched CHECKABLE criteria is ineligible
  (excluded from ranking AND from store-first qualification) whenever
  the request has ≥1 checkable criterion — quality points then order
  suppliers WITHIN the relevant set only; ② Top-N presents fewer than N
  rather than padding (empty relevant set ⇒ store-first falls through
  to live research — exactly what research is for); ③ the all-numeric
  midpoint keeps ranking but never counts toward store-hit
  qualification. Implementation surface: `scoreSupplier`/
  `createMatchesForRequest` (matching.ts) + `countQualifyingCandidates`
  (research.ts); the A7 unit tests cover both — extend them with the
  #2540 shape (verified supplier, zero matches ⇒ ineligible).
① **Owner's manual pass** on the password-gated flows: change a
  password once; run 2FA enable → confirm code → sign out →
  /2fa sign-in (everything else is live-verified; agents cannot type
  passwords).
② ~~S4 lazy enrichment~~ **DEFERRED 2026-08-28** (design review with the
  owner: its driver died with S5a — see the Phase S entry for the
  revive triggers). **Next substantial step: the E6 facilitation design
  discussion** (MVP1 blocker, the real moat per ADR-001's deal loop).
③ Small offer on the table: persist `usage` + `estimated_cost` onto
  `research_run` (one migration) so per-request spend survives log
  rotation.
④ **Source doctrine (owner, 2026-08-28)**: sources are presented as two
  categories — **SEARCH** (feed matching; `global_web` is and stays the
  default) and **VERIFICATION** (registries; per-candidate checks,
  never matched). **Bills-of-lading/customs data joins the SEARCH
  category wherever a genuinely FREE route exists (free bulk or free
  API — the no-paid-data constraint stands unchanged);** the US routes
  investigated 2026-08-26 are all paid → still closed, but the category
  is open to free BoL routes in other jurisdictions when found.
  /interne/sources now groups its tabs by category (Recherche |
  Vérification); the role label "Découverte" was renamed "Recherche".

**Known nit:** the internal workspace badge follows the user's personal
accent theme (the shield icon still marks it) — pin it to gold if that
ever bothers.

### Previous session digest 2026-08-26/27

**DEPLOY #6 (2026-08-27 evening, commit `67b4b5d`, migrations
0028–0030) — the ②l foundation wave is LIVE.** Backup first:
`backups/osi-20260827-225516.sql.gz` (31M). Verified on prod: public
origin 200 · five containers up (migrate exited clean) · `two_factor`
table + `user.two_factor_enabled`/`theme_color` present ·
`audit_log` has ZERO foreign keys (tombstone ids live) · data intact
(9 users / 9 orgs / 67 suppliers / 7 requests). The request count
dropped 8→7 since deploy #5 — **the prod audit journal itself explained
it**: the platform owner destroyed their own personal workspace at
21:07 (request cascaded, then re-registered) and verified a supplier at
21:11 — the journal's first real catch. Rollback = `git checkout
1436e0e` + rebuild + restore if needed. NOTE for the owner: prod logins
now honor 2FA once enabled; the enable/verify loop still wants one
manual pass (recorded in ②l).

**EVENING WAVE (2026-08-27) — DEPLOYED AS #5, commit `d603dd7`,
migration 0027, verified (origin 200, audit_log live, data intact —
9 users / 67 suppliers / 8 requests; prod signups are happening).**
Backup first: `backups/osi-20260827-210338.sql.gz`. Three features:
- **Staff powers follow the internal workspace** (`effectivePlatformRole`
  in workspace-guard — the ONLY way to gate staff powers server-side;
  never test raw `user.platformRole`). Staff sessions default to the OSI
  workspace at login; in any other workspace a staff member is exactly a
  buyer (no INTERNE, no Vue globale, cross-tenant reads refused).
  Org members were already sealed from org data in personal spaces (B1).
- **The audit journal** (②i): `audit_log` (mig 0027, FK + name-snapshot
  double storage), emitter `src/server/audit.ts` (the one door), ~20
  lifecycle/admin actions wired, viewer filterable PER ESPACE / PER
  UTILISATEUR — **moved 2026-08-27 to its own nav entry "Logging"
  (`/interne/logging`, feature `logging`, owner/manager) with range
  pagination (25/50/100 per page, offset+count server-side — the log is
  never listed in one shot), cascading org→user filters, and
  deletion-proof tracking (mig 0028: tombstone ids, no FKs; actor captured
  on member.removed/.role_updated via a root after-hook)** — see ②i.
- **Owner/manager split CLOSED** (②j): owner combines ALL rights;
  manager is operate-only (no plan editing/assignment, no source
  enable/disable, no wipe, no Finance). Enforced server-side.

**Updated pick-up list (next session):** ① ~~settings/account small
gaps~~ ✅ ALL DONE 2026-08-27 (②l below: password change · workspace
rename · 2FA · personal theme color); ② ~~cosmetic follow-ups~~ ✅ DONE
2026-08-27 (②l: badge refresh · remove-member warning copy · role grant
enrolls into the OSI org); ③ S4 lazy enrichment (Phase S) when
foundation feels done; ④ E6 facilitation stays LAST before financial
features (owner priority). ~~Prod = main = `d603dd7` (deploy #5)~~ —
**SUPERSEDED: deploys #6 (`67b4b5d`, migs 0028–0030) and #7
(`31f8a4c`) shipped 2026-08-27; see the 2026-08-27/28 digest above.**

②q **DONE 2026-08-28 — header profile menu + search-accuracy diagnosis
documented — DEPLOYED as #11 (commit `8c374fa`, code-only; backup
`backups/osi-20260829-100827.sql.gz`; verified: origin 200, VM on
`8c374fa`, five containers up)**:
- **UserMenu** (`src/components/osi/UserMenu.tsx`, owner: "add in the
  header top right user profile for deconnexion and listing of profile
  information, instead of having that in nav bottom"): top-right avatar
  (initials on the gold accent — follows the personal theme) → dropdown
  with name, email, staff-role badge (staff only), Paramètres link,
  Se déconnecter. The sidebar-bottom profile block is REMOVED — the
  sidebar is navigation only (anonymous keeps its "Se connecter"
  button). *Live-verified: menu renders with the profile info; sign-out
  through it lands on the public hero with the session cleared.*
- **Search-accuracy finding** written up as pick-up item ⓪ (diagnosis +
  the owner-validated three-part fix, implementation surfaces, test
  guidance) and as a ⚠️ block in README → §2 Scoring. NOT implemented
  yet — deliberately the next session's first code task.

②p **DONE 2026-08-28 — upload block + email-verification enforcement —
DEPLOYED as #10 (commit `10998d9`, code-only; backup taken pre-deploy;
verified: origin 200, VM on `10998d9`, five containers up, auth endpoint
answering normally)** (owner: "BLOCK THEM" · "AT REGISTRATION EMAIL SHOULD
VERIFY"):
- **`.docx`/`.xlsx` refused at upload** (server MIME allowlist → 415 +
  the picker's `accept` filter) — they were stored but unreadable, a
  silent lie to the buyer. Re-allow only with a real reader. Readable
  today: PDF, images, TXT, CSV.
- **Email verification ENFORCED at login — PROD-ONLY** (owner
  follow-up: "not for dev" — `REQUIRE_EMAIL_VERIFICATION`, default
  enforced; docker-compose.dev.yml sets `false`, dev-verified: an
  unverified account signs straight in) (`requireEmailVerification`
  + `sendOnSignIn` — a blocked attempt re-sends the link, so
  pre-enforcement accounts self-heal). AuthForm: dedicated
  EMAIL_NOT_VERIFIED message (form + quick-login) and a post-signup
  "check your inbox" notice (no session until verified). The seed marks
  demo accounts verified (quick-login would die otherwise) — dev DB
  updated the same way. *Live-verified END TO END in dev:* unverified
  buyer → blocked with the right message → verification mail logged →
  link followed → flag flipped → login succeeds. **Prod impact on
  deploy: existing unverified testers will be blocked once, get the
  email, click, continue** — closes the E12 free-tier multi-account
  hole (a trial now costs a real inbox).

②o **DONE 2026-08-28 — source categories surfaced + S4 deferred + small
polish — DEPLOYED as #9 (commit `5eb82cb`, code-only, no migrations;
backup `backups/osi-20260828-131325.sql.gz`; verified: origin 200, VM
on `5eb82cb`, five containers up; no prod behavior change on
verification checks — its registries are disabled and empty)**: ① `/interne/sources` tabs grouped into
**Recherche | Vérification** (the S5a `data_source.role`, now visible;
label "Découverte" renamed "Recherche"; no schema change) — doctrine in
the pick-up list ④: free-only BoL joins SEARCH when found, global_web
stays the default; ② **S4 enrichment DEFERRED** after a design review
with the owner (see the Phase S entry — driver died with S5a; revive
triggers recorded); ③ the workspace switcher no longer names the role
on individual workspaces (always the owner — zero information);
④ **verification sources honor their platform switch** (owner rule
2026-08-28: "if a verification datasource is enabled in the platform it
is used by default everywhere, user has no control"): `checkExistence`
now consults ENABLED verification sources only — the catalogue switch
is the owner's single control (it previously ignored `enabled` and read
any warmed store); workspaces still never see or choose them (S5a).
Dev consequence: CA+QC enabled → their checks unchanged; SG/JP/IN
disabled → their countries read `country_not_covered` until switched
on. Prod unchanged (all registries disabled AND stores empty). The
/interne/sources verification explainer states the rule.

②n **DONE 2026-08-28 — staff access is DATA: the Rôles & accès matrix —
DEPLOYED as #8 (commit `49d6521`, migration 0031; backup
`backups/osi-20260828-103953.sql.gz`; verified: origin 200, VM on
`49d6521`, 24 matrix rows seeded, the owner's four manager grants
re-applied on prod + audited). Also on prod the same day: Henrik
Bergeron and Renaud Lacoursiere Theroux granted MANAGER (role + OSI-org
enrollment + audit rows, by SQL on owner request — effective at their
next sign-in; their personal workspaces stay on Free, the known E12
item).** (owner pivot: "maybe it should be a role table where we
can track/activate access for those staff roles, create sub tab in user
page"):
- **`platform_permission` table (migration 0031)**: one row per
  capability × staff role (manager | accountant), seeded with the
  pre-2026-08-28 hardcoded behavior. Keys = the 9 nav features + 3
  fine-grained capabilities (`sources.toggle`, `sources.wipe`,
  `logging.purge`). **The OWNER is never a row — always has everything
  (no self-lockout); role granting stays owner-only hardcoded forever**
  (a manager who can grant roles can promote himself).
- **Resolution**: `src/server/permissions.ts` (30s in-process cache,
  busted on update; missing row falls back to the roles.ts defaults).
  Server fns check via `effectiveHasPermission(session, key)`
  (workspace-guard); the session ships the resolved set
  (`platformFeatures`) so nav + route guards follow automatically
  (`hasSessionFeature` in auth-guard). The old per-role nav greying
  (disabledForRoles) is gone — granted = live link, ungranted = hidden.
- **UI**: /interne/utilisateurs now has sub-tabs **Équipe | Rôles &
  accès** (matrix visible to the owner only); every toggle writes a
  `permission.updated` audit row.
- **Three pre-existing raw-role bugs fixed in the sweep** (checked
  `user.platformRole` instead of the effective role, violating ②h):
  store wipe (source-admin-fns), analytics (stats-fns), and
  /api/source-upload.
- **Owner's four grants applied as data (dev)**: manager now has
  facilitation (nav un-greyed — the page has the real ops list),
  finance, plans (Abonnements edit + assignment) and sources.toggle.
  *Live-verified as Manager: all 8 INTERNE entries live, the source
  enable/disable switch renders; grants + audit rows in the DB.* NOTE:
  prod gets the matrix at the next deploy — its seed carries the OLD
  defaults, so re-flip the four switches on prod after deploying (or
  ask for it with the deploy).

②m **DONE 2026-08-27 — journal lifecycle + org-owner access — DEPLOYED
as #7 (commit `31f8a4c`, code-only, no migrations; backup
`backups/osi-20260827-234130.sql.gz`; verified: origin 200, VM on
`31f8a4c`, five containers up, internal plan on cheap tier)** (owner rules: "we can delete a log older than 3
month" · "platform owner can see all logs, but org owner is limited to
his own org related logs"):
- **Purge**: `purgeAuditLogFn` (platform-owner-EXCLUSIVE) deletes
  entries older than `AUDIT_RETENTION_MONTHS = 3` — the recent window is
  never deletable; the purge writes its own `log.purged` row (count +
  cutoff). Button on /interne/logging. *Live-verified: two seeded
  4/5-month rows deleted, recent kept, purge row written.*
- **Two access tiers on `getAuditLogFn`**: platform staff (feature
  `logging`) read everything; otherwise the OWNER of a non-individual
  workspace reads THEIR org's rows — scope FORCED server-side (any
  client-sent organizationId is overridden), actor options scoped too.
  Surface: Paramètres → **Journal** tab (non-individual, owner-gated
  disabled-not-hidden), reusing the extracted
  `src/components/osi/AuditJournal.tsx` (the /interne/logging route
  keeps the org filter + purge). *Live-verified: Camille sees exactly
  Atelier's 4 rows, no OSI-internal rows, no org filter, no purge.*
- Old-log coverage note (owner): pre-journal history is NOT expected —
  no backfill; emitters only cover actions from when they shipped.
- **Internal plan → cheap tier** (owner, 2026-08-27): staff test
  requests run on haiku (~$0.07 vs ~$0.20/request) — a plans-are-rows
  live UPDATE applied on dev AND prod, README table updated. Editable
  anytime from Abonnements.

②l **DONE 2026-08-27 — the foundation-gaps wave** (owner: "remaining
foundation items, all small… 2fa can be enable on user profile · each
user has a profile with parameters, personal info and this 2fa thing,
with password · each user can define its own thematic color"):
- **Profil is the personal hub now**: name/email/language + **password
  change** (better-auth `/change-password`, other sessions revoked) +
  **2FA** (better-auth `twoFactor` plugin, issuer OSI, migration 0029:
  `two_factor` table + `user.two_factor_enabled`; enable = password →
  secret + backup codes shown ONCE → a first TOTP code confirms; login
  with 2FA on redirects to the public bare **/2fa** page — TOTP or
  backup code; `twoFactorClient` in auth-client does the redirect) +
  **personal theme color** (migration 0030 `user.theme_color`, 5
  accents in `src/lib/themes.ts`; styles.css gradients/shadow now
  derive from `--gold` via color-mix so ONE variable pair retheming
  works; applied by __root from the session additionalField, saved via
  updateProfileFn which purges the Redis session cache). *Live-verified:
  emerald theme applied + survived navigation; password/2FA sections
  render; the enable/verify password loop needs one manual pass.*
  Known nuance: the internal workspace badge follows the personal
  accent (the shield icon still marks it).
- **Workspace rename** (`renameWorkspaceFn`, enterprise + owner only,
  unique-name check, audited `workspace.renamed`) — a RenamePanel atop
  the Organisation tab. *Live-verified as Camille, incl. the audit row.*
- **Badge refresh** — WorkspaceSwitcher refetches on every navigation
  (fixes stale badge after invitation accept) and on the
  `osi:workspaces-changed` window event (fired by rename).
  *Live-verified: rename updated the badge without a reload.*
- **Remove-member warning copy** now states the UC-6 account deletion.
- **Individual workspaces cannot invite** (owner rule 2026-08-27:
  "individual account cannot invite member, only in a org"): the
  Utilisateurs tab is hidden on individual workspaces (same treatment
  as the Organisation tab), and `beforeCreateInvitation` refuses
  `INVITE_NOT_ALLOWED_INDIVIDUAL` server-side so a direct endpoint call
  cannot bypass it. *Live-verified: Buyer (individual) has no
  Utilisateurs tab; Camille (enterprise) keeps it.*
- **Platform-role grant UI** (`setPlatformRoleFn`, owner-EXCLUSIVE):
  grant-by-email panel + per-row role select on /interne/utilisateurs;
  granting **enrolls into the OSI org** (②b follow-up closed), revoking
  removes that membership, re-points stale sessions and purges the
  Redis session cache; audited `platform_role.updated` {from,to}.
  *Live-verified: buyer@osi.dev granted accountant (role + membership +
  audit) then revoked clean (membership gone, sessions re-pointed).*


**One session changed the product's strategy AND its account model —
and it is LIVE: DEPLOYED TO PROD 2026-08-27 (deploy #4, commit `52b1827`,
migrations 0017–0026 applied cleanly).** 26 commits past the tag
`adr-001-baseline` (= `e6e2d1b`, the rollback point), everything
dev-verified live in the browser before shipping.

**Deploy #4 verified on prod:** public origin 200 · five containers up
(migrate exited clean) · data intact (7 users · 63 suppliers · 35 matches
· 7 requests) · the staff org "Oversea Sourcing Intelligence" created with
yves enrolled (1 member) · all six sources present, registries flipped to
`verification` role, global_web the sole discovery source · plans ladder
carries `org_trial` · the signup account-type fork renders on
osi-solutions.com/signup (with the prod-only Google button). Backup taken
minutes before: `backups/osi-20260827-111706.sql.gz` (30M). Rollback =
`git checkout adr-001-baseline` + rebuild on the VM + restore if needed.

**Strategy (ADR-001, ACCEPTED then AMENDED — the governing document):**
[doc/adr/ADR-001-supplier-provisioning.md](adr/ADR-001-supplier-provisioning.md)
(pretty version with diagrams: the Claude artifact linked inside it).
Supplier provisioning pivoted to the **demand-pull supplier graph**;
registries became **verification infrastructure** (never matched, never
workspace-selectable, ~6-month store refresh); the **no-paid-data
amendment is a HARD owner constraint** — no paid subscription to any data
provider, EVER (customs/BoL closed; never re-propose paid options).
Built from it (Phase S below): S5a source-role split (mig 0018) · S1
taxonomy (78 nodes, `src/lib/taxonomy.ts`) · S2 structured request form
as primary intake (mig 0019, searchable category combobox) · S5b
verification battery (mig 0020 — evidence rows, derived tiers, OFAC list;
`server/verification.ts` is the ONLY writer of `verification_status`) ·
S5c the `/interne/verification` review screen (Vérifié OSI = earnable).
Still open in Phase S: **S4 lazy enrichment** (deprioritized behind the
foundation track) · S3 (only when a discovery store grows big) · S6
(gated with E6).

**Account model (owner decisions, all implemented + live-verified):**
- **PRIORITY: foundation before facilitation** — E6 is deliberately LAST
  before financial features; do not propose it.
- `organization.type` = `internal | individual | enterprise` (mig 0022);
  ONE staff workspace **"Oversea Sourcing Intelligence"** (slug `osi`,
  internal plan, all staff enrolled).
- **Signup forks** Individuel | Organisation (mig 0023): organisation
  signups get an enterprise workspace named after the company on the
  seeded **`org_trial`** plan (Free-like, 3 seats) and **NO personal
  workspace** (Q1 extended; Q3 staff-assisted-only SUPERSEDED).
  **Organisation names are unique** (case-insensitive, mig 0025).
- **UC-6 re-interpreted**: removal from your ONLY workspace **deletes the
  account** (re-register to return); the tenant keeps the work —
  `request.created_by` / `file.uploaded_by` nullable set-null (mig 0024),
  displayed via the `created_by_name` snapshot ("Créé par …" survives
  deletion, mig 0025).
- **Workspace-owner lifecycle powers**: billing (owner-only when Stripe
  lands) + **account destruction** — Paramètres "Zone de danger"
  (typed-name confirm; internal workspace indestructible). ALL account
  deletions go through **`src/server/account.ts`** (Redis session purge
  included) — never delete users any other way.
- **Organisation profile** tab (org info + tax info, mig 0026): owner
  edits, members read-only.
- **Staff views scoped**: `/interne/utilisateurs` = the INTERNAL team
  only; customer ACCOUNTS (individual|organisation tabs) + plan
  assignment (audience-filtered) live on **`/interne/clients`**; the
  workspace badge in the top bar is always visible and color-coded
  (gold internal · emerald enterprise · neutral individual); Imports nav
  REMOVED entirely.
- **Notification preferences** shipped (mig 0021; prefs gate ONLY
  notify.ts; transactional mail never silenceable).

**Dev accounts (all password `osi-demo-1234`, quick-login grouped
INTERNE/CLIENTS):** staff owner/manager/accountant@osi.dev + buyer@osi.dev
(individual customer) + the seeded fake customer org **"Atelier Boréal
Fabrication"** — camille@atelier-boreal.dev (owner) and
marc@atelier-boreal.dev (buyer, invited, no personal workspace). The seed
recreates all of it idempotently through the REAL signup/invitation paths.

**Open decisions awaiting the owner:** ① ~~owner-vs-manager split~~
✅ DECIDED 2026-08-27 (owner combines all rights; manager operate-only —
②j); ② taxonomy anchor
(in-house tree is live; HS mapping shipped — formal choice recorded as
"in-house mapped", revisit only if it pinches).

**Known nits (cosmetic, unfixed):** the workspace badge doesn't appear
until the next page load after accepting an invitation (switcher fetches
memberships on mount only); the remove-member button has no
"this deletes their account" warning copy yet.

~~A future prod deploy carries migrations 0017–0026~~ **SHIPPED as deploy
#4 (see above).** No new env vars were required (DATA_GOV_IN_API_KEY
remains optional for registry-in whenever the owner creates the key).

### Previous session context (2026-08-25/26 — sourcing waves)

**(Superseded by deploy #4 above — kept for history.)**
**Production was at commit `8177522` (deploy #3, 2026-08-26).**
Deploy #3 shipped the registry-qc wave (file-fed machinery: streamed
`PUT /api/source-upload`, `SearchBrief.fileKey`, `meta.requiresFile` +
`downloadUrl`, fflate ZIP tooling, shared `sources/csv.ts` +
`sources/file-tools.ts`) **and the Asia wave** (registry-sg autonomous,
registry-jp file-fed), migrations **0015 + 0016**. Prod's catalogue is
five sources: `global_web` (enabled) + CA/QC/SG/JP registries (ALL
disabled, stores empty — staff warms them: CA/SG autonomously, QC/JP by
ZIP upload from the links on their tabs). Display names shortened per
owner request: Web mondial · Registre Canada · Registre Québec · Registre
Singapour · Registre Japon · Registre Inde (i18n `sourceNames.*`).
**Main is ahead of prod by the India source** (`registry-in` + migration
**0017**, additive) — sixth catalogue entry, deploy on request.

**Dev wiped clean of buyer-interaction data (owner request, 2026-08-26,
after S2 shipped):** 0 requests / suppliers / matches / criteria /
research runs / notifications — a buyer-untouched base for testing the new
intake. Kept intact: the 4 demo accounts + workspaces, plans,
sourcing_rules, data_source catalogue, **all 1 821 915 store records**
(supplier links nulled by the Phase D FK, as designed) and the source_run
audit.

**Dev store state at session end (2026-08-26):** registry-ca 393 339 ·
registry-qc 814 921 (real archive) · registry-jp fixture-only (2) ·
registry-sg **613 653** (full pull
succeeded 2026-08-26 after two interrupted attempts — 618 889 candidates
across its 27 datasets) · registry-in empty, awaiting
`DATA_GOV_IN_API_KEY` (owner signup) for its first 2.6M-row pull.

**Dev source-store state (2026-08-25):** `global_web` enabled, store empty —
wiped during the Phase D disposability test, refills request by request
(suppliers/matches untouched, by design). `registry-ca` **enabled in dev**,
393 339 records. `registry-qc` **disabled, store warmed with the REAL
archive**: the staff flow was exercised for real — actual Registraire ZIP
downloaded in a browser, uploaded on the tab, parsed at full scale:
**830 419 candidates → 814 921 records in 65 s** (batched upserts held up;
activity descriptions populated — these records are matchable). Enabling
either registry for customers is the recorded product call (bare names for
CA; QC records carry activities and clear the bar honestly).

**⚡ ADR-001 ACCEPTED 2026-08-26 — supplier provisioning pivoted to the
demand-pull supplier graph.** Full decision record:
[doc/adr/ADR-001-supplier-provisioning.md](adr/ADR-001-supplier-provisioning.md).
It SUPERSEDES the enrichment decision gate (resolved below) and the
availability-driven connector roadmap; registries become **verification
infrastructure** (never matched, never workspace-selectable, stores kept as
local verification tables on a ~6-month refresh). Implementation plan =
**Phase S** below.

**Phase S progress (2026-08-26, same day as acceptance):** S5a (source-role
split, migration 0018) + **S1 (taxonomy, 78 nodes)** + **S2 (structured
request form, migration 0019)** are BUILT and dev-verified — see the Phase
S entries. Baseline tag before any of it: `adr-001-baseline`.

**PRIORITY ORDER (owner, 2026-08-26): foundation before facilitation.**
E6 (staff-as-middleman on orders) is deliberately the LAST step before
financial activities (E8/billing) — do not propose starting it; S6 waits
with it. First: user management, organisation setup, settings.

**Where to pick up next session (foundation track) — updated 2026-08-27:**
① **remaining settings/account gaps**: password change in Profil ·
workspace rename (owner) · 2FA (E1) — ~~account deletion~~ ✅ (danger
zone, ②g) and ~~create-enterprise flow~~ ✅ (signup fork, ②d) are done;
② ~~the platform owner-vs-manager split~~ ✅ DECIDED + BUILT 2026-08-27
(②j: owner combines all rights; manager = operate-only);
③ ~~E2 audit log~~ ✅ DONE 2026-08-27 (②i);
④ **small follow-ups**: platform-role grants should enroll into the OSI
org (manual SQL meanwhile) · workspace-badge refresh after invitation
accept · warning copy on remove-member ("deletes their account");
⑤ **S4 lazy enrichment** when the foundation track clears;
⑥ ~~deploy when asked~~ ✅ **deploy #4 shipped 2026-08-27** — prod = main
= `52b1827`. Read "Contracts a next session must NOT re-derive
differently" before writing code.

**History of the foundation waves (2026-08-26/27), newest first:**
②j **DONE 2026-08-27 — the owner/manager split, CLOSED** (owner: "owner
combined all the rights"): the platform OWNER holds everything; the
MANAGER is operate-only. Owner-exclusive now: **plan limit editing +
plan assignment (feature `plans` → owner)**, **source enable/disable**
(toggleSourceFn checks effective role; managers see the state, not the
switch), store wipe (already), Finance (owner+accountant). Manager
keeps the operations: facilitation, verification approvals, clients
view (plan shown as a read-only chip — empty plans list = no select),
users + audit journal, source refresh/uploads, record/supplier bans,
analytics. All of it auditable via ②i. *Verified live as Manager:*
lands in the OSI workspace, no Abonnements nav, static "Activée" text
instead of the source switch, plan chip on Clients.
②i **DONE 2026-08-27 — the audit journal** (owner: "actions are logged,
keep track of activities — per org, per user"): migration **0027**
(`audit_log`: actor + workspace stored as FK *and* name snapshot, so
history survives account deletion and workspace destruction; indexed per
org / per actor / by time). Emitter `src/server/audit.ts` (`logAudit` —
failure-tolerant, one door). **Wired actions:** account.created/.deleted,
workspace.destroyed, member.removed/.role_updated, invitation.created/
.accepted, ownership.transferred, plan.assigned/.updated,
supplier.verified/.verification_revoked/.banned/.unbanned,
source_record.banned/.unbanned, source.enabled/.disabled/
.refresh_triggered/.store_wiped, sourcing.updated, org_profile.updated.
(Requests keep their own request_event trail — the journal is lifecycle/
admin actions.) **Viewer:** "Journal d'activité" — own nav entry
**"Logging"** at `/interne/logging` since 2026-08-27 (feature `logging`,
owner/manager; was a section of /interne/utilisateurs), **range-paginated**
(25/50/100 rows per page, server-side offset + count — verified live with
62 rows across two pages), filter selects PER ESPACE and PER UTILISATEUR
(options from the log itself; **cascading since 2026-08-27** — choosing a
workspace narrows the user list to ITS actors and resets the user choice),
action labels via `auditActions.*` i18n with raw-code fallback, detail
JSON in the tooltip.
**Deletion-proof since 2026-08-27** (owner: "even when the user got
deleted we should be able to track"): migration **0028 drops the audit_log
FKs** — actor_id/organization_id are TOMBSTONE ids that survive account
deletion and workspace destruction (the FK set-null was erasing exactly
the trail the journal exists for), display coalesces live name → snapshot.
Every emitter now writes BOTH name snapshots (`requireWorkspaceRole`
returns `userName` for this). **member.removed / member.role_updated
finally carry the ACTOR**: the org-plugin hooks never see the acting
session, so those two rows are written by a root `hooks.after` in auth.ts
(session via `getSessionFromCtx`), merged with what only the org hook can
still read (previous role, target email — gone after the mutation) via the
`stashAuditContext` seam in server/audit.ts. *Verified live:* Camille
role-changed then removed Marc (UC-6 deleted his account) → both rows
carry actor "Camille Tremblay" + org + his email; the org/user filters
still list them. The stale-fetch race on rapid filter changes is also
guarded (cancelled-effect flag). *Verified live:* source toggle
on/off produced two rows with actor + target + timestamps; E2's
"audit log on auth/membership mutations" is covered and checked off.
②h **DONE 2026-08-27 — staff powers follow the internal workspace** (owner
decision: "staff in their personal workspace should not have access to
global view" — and org members already can't reach org data from personal
spaces, by the B1 scoping). One concept: **`effectivePlatformRole`**
(workspace-guard) — your platform role only exists while STANDING IN the
internal workspace; anywhere else you are exactly a buyer. Client side:
getSessionFn ships the EFFECTIVE role (presentation only — every server fn
re-derives), so sidebar/INTERNE/Vue globale/route guards all follow the
badge with zero per-component logic. Server sweep: sources/users/
verification/clients/plans admin fns + getAllRequestsFn + both foreign
dossier reads + global stats + supplier discovery gate + /api/files
cross-tenant read. Staff sessions now DEFAULT to the internal workspace
at login (personal = a deliberate switch). *Verified live:* Owner login →
lands in the gold OSI org with INTERNE; switch to personal → INTERNE and
Vue globale gone, direct /interne/clients bounces home; switch back →
restored.
②b **DONE 2026-08-26 — the staff org + explicit account types** (owner
decisions): migration **0022** adds `organization.type`
(`internal | individual | enterprise`, default individual) and seeds the
one staff workspace **"Oversea Sourcing Intelligence"** (slug `osi`,
type internal, internal plan) with every platform staff member (the
platform owner as workspace owner, other staff as buyers). Existing
workspaces backfilled `individual` (no enterprise exists yet anywhere).
*Verified in dev:* 3 staff members seeded, switcher shows the org.
**Follow-up:** granting a platform role on /interne/utilisateurs should
also add OSI-org membership (manual SQL meanwhile); signup UX for the
individual-vs-organisation choice is the open design question;
②g **DONE 2026-08-27 — owner lifecycle powers + staff-view scoping**
(owner decisions): ① **workspace-owner account destruction** — Paramètres
"Zone de danger" (Organisation tab for enterprises, Profil for
individuals; internal workspace indestructible, server+UI): typed-name
confirm → `destroyWorkspace()` deletes the org (all scoped data cascades)
and applies the UC-6 rule to members (only-workspace members lose their
accounts, org-signup owners included). Account-deletion MECHANICS
centralized in `src/server/account.ts` (incl. the Redis session purge) —
the one place users die. Billing = the other owner-only capability,
recorded for when Stripe lands. *Verified live:* Camille destroyed
Atelier Boréal through the UI → org + both accounts gone → one db:seed
recreated it (seed now provisions the fake org via the real
signup+invitation paths; quick-login grouped INTERNE/CLIENTS covers it).
② **/interne/utilisateurs rescoped to the INTERNAL team only** ("from
the users nav we should not see other orgs' users") — customer people
are their workspace owner's business; **plan assignment moved to
/interne/clients** (an account action, audience-filtered options).
②f **DONE 2026-08-26 — the org-account polish wave** (owner requests,
all live-verified): ① request **creator attribution** everywhere
("Créé par …" on cards + detail) via a `created_by_name` SNAPSHOT
(migration 0025, backfilled) — display resolves live name → snapshot →
"utilisateur supprimé", so it survives account deletion; ② **unique
organisation names** (case-insensitive partial index on
enterprise+internal, 0025) + a clear signup error; ③ **organisation
profile tab** in Paramètres (org info + tax info; owner edits, members
read-only; `organization_profile`, migration 0026, updated_by trail);
④ **personal settings confirmed user-scoped** (Profil + Notifications
follow the person across workspaces — already true by design);
⑤ `/interne/clients` now excludes staff-owned personal workspaces (was
mirroring /interne/utilisateurs); ⑥ **Imports nav removed** (superseded
by the sources model). Two defects found live and fixed: **SECURITY —
deleting a user left their Redis-cached session usable** (afterRemoveMember
now purges session tokens + active-sessions from secondary storage;
gotcha: NEVER delete users by raw SQL without purging the cache), and
**org-signup sessions could land with a NULL active workspace**
(hook/session race) — requireWorkspaceRole self-heals by adopting the
first membership and purging the cached session.
②e **DONE 2026-08-26 — removal from the only workspace deletes the
account** (owner decision; kills the orphan-login deadlock — a user with
no workspace would loop between login and the auth gate forever). UC-6
re-interpreted: **the tenant keeps the work, the person doesn't need to
exist** — migration **0024** makes `request.created_by` and
`file.uploaded_by` nullable `set null`; the org-plugin `afterRemoveMember`
hook deletes the user when no membership remains (never platform staff;
an individual-first user just falls back to their own workspace). The
report_ready notifier skips null creators. *Verified in dev:* deleting a
user left their request intact with `created_by` null. Re-joining =
re-registering (fresh account) — recorded as accepted.
②d **DONE 2026-08-26 — the signup account-type fork** (owner confirmed
the three choices: self-serve organisation signup — supersedes Q3's
staff-assisted-only rule for the entry tier; org trial = Free-like + 3
seats; NO personal workspace for organisation signups — Q1 extended):
migration **0023** adds `user.account_type`/`company_name` (signup
intent, kept as audit) and seeds the **`org_trial`** plan (1/day, 2
lifetime, 3 seats, pooled, audience organization — owner-editable live).
Signup form: Individuel | Organisation segmented choice + company-name
field; better-auth additionalFields carry the intent; the before-hook
validates it (organisation requires a company name); the user-create
hook provisions EITHER the personal workspace (unchanged) OR an
`enterprise` workspace named after the company on org_trial. Social
signups default to individual. `assignPlanFn` now enforces
audience ↔ organization.type (internal audience stays a free staff
call — prod precedent). *Verified live in dev end to end:* organisation
signup → "Nordik Manufacturing Inc." (type enterprise, plan org_trial,
exactly ONE membership), emerald badge in the top bar, intent audited
on the user row; test account removed after.
②c **DONE 2026-08-26 — prominent workspace badge + /interne/clients**
(owner requests): the top-bar workspace indicator is always visible and
color-coded by type (gold = OSI staff org, emerald = enterprise, neutral
= personal; type named in tooltip + dropdown subtitles); new staff
screen **Clients** (feature `clients`, owner/manager) lists every
non-internal account in two tabs (individuels / organisations) with
owner, plan, members, lifetime requests, created date — account-centric
counterpart of /interne/utilisateurs. Also fixed: /interne/verification
un-greyed for managers (real screen since S5c). Gotcha for posterity:
interpolating a drizzle column into a raw sql`` correlated subquery
renders it UNQUALIFIED ("id" — ambiguous); qualify identifiers by hand;
~~The workspace/organisation design revisit~~ ✅ HELD 2026-08-26/27 —
this session WAS the revisit: the account model is now settled and
implemented (see the digest and the ②b–②g entries above).

### DECISION GATE — the source enrichment agent — ✅ RESOLVED 2026-08-26

> **Resolved by ADR-001:** Option 3 (lazy per-request, the ~3×N candidates a
> live request surfaces) is PRIMARY; Option 2 (keyword-scoped batches) is the
> staff-aimed secondary; Option 1 (blind capped batches) is dead. And
> **registry records are never enriched at all** — they carry the
> verification role now, out of matching entirely. The implementation seams
> at the end of this section remain the guide (→ Phase S task S4). Original
> discussion kept below for history.

**Agreed flow (validated in discussion, diagrammed):** staff triggers from
`/interne/sources` → worker pulls the registry data into the store (built)
→ **an AI agent enriches store records in the worker** (web search per
company: website, what they make, confidence — written back onto
`source_record`; the app's own ANTHROPIC_API_KEY, never a Claude Code
session) → enriched records visible in the store browser → matching ranks
them → Top-N promotion (built). Only the enrichment stage is unbuilt.

**The open decision is enrichment SCOPE + budget** (~$0.01–0.03 per record
at cheap tier; stores now hold 393k CA + 815k QC — enriching everything is
$12k+, not a thing):
- **Option 1 — capped batches**: each trigger enriches the next N
  un-enriched records. Bounded spend, blind targeting.
- **Option 2 — scoped by keyword** *(recommended first)*: staff enters a
  category ("pompes hydrauliques"), agent enriches the name/activity-matching
  records (a search on the QC store's activity text makes this precise).
  One more control on the source tab; staff aims the spend.
- **Option 3 — lazy per-request** *(recommended follow-up)*: when a buyer
  request matches store records, enrich those few inline. Zero waste, adds
  request latency/cost.
Implementation seams when decided: enrichment fields update `source_record`
(description/website/confidence + an `enriched_at` column — small
migration), an `enrich` job on the research queue, agent module beside
`ai/research.ts`, per-run `source_run`-style audit with token cost.

### ~~IN FLIGHT~~ ✅ DONE — notification preferences (E9/E11, 2026-08-26)

**Shipped as planned below** (foundation track, after the owner's
facilitation-last priority call): migration **0021** (`notification_pref`,
user uq, prefs jsonb), `notify.ts` gates BOTH channels through
`channelEnabled()` (fail-open: a prefs read failure never mutes anything),
`get/updateNotificationPrefsFn` (zod keys restricted to registered types;
undefined flags stripped), and the Paramètres → **Notifications** tab (all
roles, per-user): one row per registry type, in-app + email switches
(email only where the type sends one), the "transactional mail is always
sent" note, save + Enregistré ✓. *Verified live in dev:* email toggled off
for report_ready → row `{"report_ready":{"email":false}}` → `notifyUser`
wrote the in-app row and sent NO mail (dev logs every send — none
appeared). Transactional-mail boundary untouched. Original plan kept
below for history.

Design settled, one file landed:
- ✅ `src/lib/notification-types.ts` (committed): the type registry
  (`report_ready` in-app+email, `invitation_accepted` in-app only),
  `NotificationPrefs` = `{[type]: {inApp?, email?}}`, missing = ON,
  `channelEnabled()` helper. **Boundary decided: prefs gate ONLY
  `notify.ts` emissions — transactional auth mail (verification, reset,
  invitations via mail.ts) is never silenceable.**
Remaining to build:
- `notification_pref` table: `user_id` uq FK, `prefs` jsonb, updated_at
  (migration 0016 — pure create, no prompt).
- `notify.ts`: load the row, skip in-app insert if `inApp === false`, skip
  email if `email === false` (stay failure-tolerant).
- `getNotificationPrefsFn` / `updateNotificationPrefsFn` in
  `notification-fns.ts` (session user; zod record limited to known types).
- Paramètres: new "Notifications" tab (all roles, per-user) — one row per
  registry type, Switch per channel (email switch only where the type has
  email), save button; i18n `settings.tabNotifications` +
  `settings.notifTypes.*`; remember the dev gotcha: new i18n keys need a
  web-container restart.
**Deploy #2 (evening)** shipped the sourcing-admin wave on top of the
morning's `b187039`: the `registry-ca` static connector + catalogue row
(migration 0014, **seeded DISABLED on prod** — its store is empty until
staff triggers the full pull), the `/interne/sources` tabs layout with
localized source names, store-browser search + range pagination +
rows-per-page, grouped panel sections, the dynamic-only request-fallback
guard, and C2b (big-store SQL prefilter — registry safe to enable;
product call recorded below keeps prod's switch off until enrichment).
The full backlog since `d4f93a2` shipped in one go: the sourcing engine
(Phase A), six-service topology (worker-research + redis first-class,
one-shot migrate), all of Phase B (roles, switcher, invitations, Paramètres,
plan ladder), E1 verification/reset emails, E9 notifications, C1
`/interne/sources`, the two source kinds, and **Phase D** (source_record
stores + promotion, migrations 0008–0013). Verified post-deploy: six
containers up (redis healthy), public origin 200, **7 users · 63 suppliers ·
35 matches intact, 63 records backfilled all-promoted** (prod had grown
51→63 during the day — the backfill caught everything), plans ladder
correct, SENDGRID_API_KEY + MAIL_FROM live in the containers (no
MAIL_SILENT). Backups on hand: `backups/osi-20260824-004821.sql.gz` and
`-192042` (taken minutes before the deploy). Rollback = `git checkout
d4f93a2` + rebuild on the VM.
**Still unverified on prod:** a real outbound email (needs a real signup or
password reset — watch SendGrid the first time one fires).

**After the deploy, same day:** `registry-ca` built and loaded in dev (C2
entry in Phase C — 393k records, enabled=false behind gate C2b; NOT yet on
prod, ships with the next deploy — pulling the store on prod is one click
on `/interne/sources` afterwards). **Parked mid-flight: notification
preferences** (Paramètres tab, E9/E11) — the type registry
`src/lib/notification-types.ts` is drafted (uncommitted); remaining:
`notification_pref` table + fns + notify.ts gating + the tab. Transactional
auth mail must stay ungated (boundary documented in that file).

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

**Phase A landed the same day (A1–A6 done, dev-verified; deployed 2026-08-24):**
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
point. ~~Prod still runs `d4f93a2`~~ — **deployed 2026-08-24** (`b187039`);
the migration backfilled prod's suppliers automatically as promised.

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
dev; **deployed to prod 2026-08-24** (`b187039`).

**E1 shipped 2026-08-23 (`6fec867`):** email verification (sendOnSignUp,
auto sign-in, resend in Profil — **recorded, not enforced**) and password
reset (`/mot-de-passe-oublie` → email → `/reinitialiser?token=`), both through
the SendGrid adapter. Implementation facts in README → "Email verification &
password reset".

**E9 core shipped 2026-08-24 (`91538fc`):** `notification` table (type+params
i18n pattern), `notify.ts` single failure-tolerant emitter, real bell (dot
only when unread, click = read + navigate). First emitters: `report_ready`
(worker, in-app + email) and `invitation_accepted` (→ inviter). Open in E9:
engagement templates (gated with E6); ~~preferences~~ ✅ shipped 2026-08-26.

**E6 is GATED (user decision):** no facilitation implementation until the
flow is defined together — statuses, actors, what "connected" means. Open
that discussion before touching E6.

**C1 `/interne/sources` shipped 2026-08-24** (deployed same day): the data-source admin screen — catalogue with enable/disable,
per-source store browser, per-source + global bans with a who/when/why trail,
and the admin "Mettre à jour" running on the research queue. Completes the
three 🟡 E4 partials. Details in the Phase C entry below.

**2026-08-24 — the sourcing model was settled AND built** (README → "The two
kinds of source, and the store→supplier promotion model"): dynamic vs static
sources (admin refresh is static-only full pull; `global_web` is request-fed
only), and **Phase D** — stores hold raw candidate records
(`source_record`, migrations 0012/0013), suppliers are created only at
promotion (Top-N), stores are wipeable without impacting the platform. All
dev-verified live, including a full store wipe with dossiers intact. C2
investigation also done (registries = verification, not discovery — README
§9). **Note:** the pinned deploy branch `release/2026-08-24` predates Phase
D on purpose; 0012/0013 are rehearsed green on a prod dump, so a post-D
deploy point can be re-pinned whenever wanted.

**Where to pick up next session:** ① the E6 flow discussion (unlocks MVP1),
② backpressure pair (server-fn rate limits + queue-depth guard), ③ E10
verification workflow (the federal registry API from C2 slots in here).
Read "Contracts a next session must NOT re-derive differently" below before
writing any code.

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
- **Two source kinds** (2026-08-24, `src/lib/source-kind.ts`): dynamic
  (`global_web`) is fed ONLY through requests — never admin-triggered;
  static (`registry`/`import`) is admin-triggered as a FULL PULL, no scope —
  dedup makes every trigger idempotent. The request-time fallback collects
  from DYNAMIC sources only — a static connector must never fire mid-request.
- **Big stores are SQL-prefiltered** (C2b): candidate loading for sources
  above `BIG_STORE_THRESHOLD` filters by request-criteria name tokens using
  the scorer's OWN vocabulary (`src/lib/match-tokens.ts` — keep them shared,
  or the prefilter drops records the scorer would have matched).
- **Stores are disposable; suppliers are promoted** (2026-08-24, Phase D —
  BUILT): collections write `source_record` rows only; `supplier` rows are
  created ONLY by promotion in `createMatchesForRequest` (Top-N). Never
  write suppliers from a connector or collection path. Wiping a store must
  never impact requests/matches/reports — keep every load-bearing FK on
  `supplier`, never on `source_record`.
- **Containers never call each other** — Postgres (rows + pg-boss) is the
  only meeting point; worker owns `pipeline`+sweep, worker-research owns
  `research`; Redis is disposable (fail-open, sessions stay in Postgres).
- **Email verification IS enforced at login since 2026-08-28** (owner
  decision) — `requireEmailVerification` + `sendOnSignIn` in auth.ts;
  blocked attempts re-send the link; the seed verifies demo accounts.
- **Account lifecycle (2026-08-26/27)**: user deletions and workspace
  destruction go ONLY through `src/server/account.ts` (session-cache purge
  included). Removal from your only workspace deletes the account (UC-6
  re-interpreted); the tenant keeps the work (`created_by`/`uploaded_by`
  null out; display uses the `created_by_name` snapshot). The internal
  workspace is indestructible. `verification_status` is written ONLY by
  `src/server/verification.ts` (evidence-derived).
- **Account model (2026-08-26)**: signup forks individual|organization;
  organisation signups get NO personal workspace; organisation names are
  unique (case-insensitive, enterprise+internal); plan audience ↔
  `organization.type` is enforced in `assignPlanFn`; staff see customer
  ACCOUNTS on /interne/clients, never customer-org users on
  /interne/utilisateurs.
- **No prod deploys unless explicitly requested** — dev is the test ground;
  main accumulates.
- **ADR-001 (accepted 2026-08-26) governs supplier provisioning** —
  registries are verification-only (never matched, never
  workspace-selectable; stores = local verification tables, ~6-mo refresh),
  enrichment is demand-pulled (~3×N per request, never store-sized), the
  connector roadmap is demand-driven over **genuinely free sources only —
  the owner's HARD no-paid-data-subscription constraint (2026-08-26)
  excludes every paid feed/API, permanently (customs/BoL is closed)** —
  and intake goes form-first (category from the S1 taxonomy).
  Backlog/README text predating the ADR is superseded where it conflicts —
  update it, don't follow it.

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

- **`./scripts/db.sh prod` is NOT the VM.** It targets a prod-compose stack
  on *this* host — and because both compose files share the project name, on
  a machine running the dev stack it silently answers from the **dev**
  database while claiming to be prod. Cost a false alarm on deploy day
  (2026-08-24). For the VM: `ssh` + `docker compose exec database psql`,
  or `./scripts/status.sh`.
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
- **`npm install <pkg>` on macOS can silently break the prod build** (bit
  on 2026-08-26, deploy #3): npm drops other platforms' optional native
  bindings from package-lock (npm/cli#4828) — the VM's image build then
  fails on rolldown's missing linux-x64 binding. Cure: regenerate the lock
  cleanly (`rm -rf node_modules package-lock.json && npm install`)… which
  has its own trap: caret ranges drift (better-auth went 1.6.25 → 1.7.x
  with breaking types — now PINNED EXACT at 1.6.25; upgrade deliberately or
  not at all). After any lockfile change, REBUILD the dev image too
  (`docker compose -f docker-compose.dev.yml build web && up -d`) or the
  containers mix old image deps with new lock (TanStack export crash).
- **Recreating a worker container kills its in-flight pull.** The job dies
  with the process; the source_run strands as `running` (pg-boss re-delivers
  only after the job's expiration, up to 1h). Settle it
  (`update source_run set status='failed' … where status='running'`) and
  re-trigger from the tab. Cost the Singapore pull twice on 2026-08-26.
- **pg-boss cancels handlers at the job's expiration (default 15 min).**
  A registry full pull can run longer; the handler is killed mid-pull and
  the source_run strands as `running`. Admin refreshes are enqueued with
  `expireInSeconds: 3600` (src/server/queue.ts) — keep that in mind for any
  future long-running job type.
- **tsx watch misses edits that land during a restart.** The dev workers
  restart on file change, but a second file saved while a restart is in
  flight is silently skipped — the process then runs one stale module (cost
  a failed registry-qc run on 2026-08-25: fresh connector + stale
  research.ts). When a worker behaves as if an edit didn't happen:
  `docker restart osi-worker-research-1` (or -worker-1) and re-test.
- **New npm deps need installing INSIDE the dev containers.** node_modules
  is an image-baked anonymous volume (compose masks the bind mount), so a
  host `npm install` is invisible to them. After adding a dependency:
  `docker compose -f docker-compose.dev.yml exec <svc> npm i <pkg> --no-save`
  for web, worker AND worker-research — or rebuild the image (fflate,
  2026-08-25).
- **NEVER delete a user by raw SQL.** With Redis as better-auth secondary
  storage, sessions are served from the CACHE — deleting only the rows
  leaves the deleted account a WORKING session until the cache expires
  (found live 2026-08-26). All deletions go through
  `src/server/account.ts` (`deleteUserAccount` / `destroyWorkspace`),
  which purges the cached tokens. For manual dev surgery:
  `docker exec osi-redis-1 redis-cli flushall` after the SQL.
- **Interpolating a drizzle column into a raw sql\`\` correlated subquery
  renders it UNQUALIFIED** (`"id"` — Postgres rejects it as ambiguous).
  Hand-qualify identifiers inside sql\`\` subqueries (bit /interne/clients
  on 2026-08-26).
- **A signup's session can be created before the user-create hook finishes
  provisioning the workspace** — active_organization_id lands NULL
  (observed on an organisation signup). `requireWorkspaceRole` self-heals
  (adopts the first membership, persists it, purges the cached session);
  keep that guard when touching auth.
- **New i18n keys need a dev web-container restart.** `src/i18n/config.ts`
  guards `init` with `i18n.isInitialized`, and the i18next singleton lives in
  the long-running SSR process — vite re-runs the config on locale edits but
  the guard skips re-init, so SSR renders raw keys (and every hydration fails)
  until `docker restart` of the web container. Cost an hour on 2026-08-24.

### A pending draft never spends money on its own (owner rule, 2026-08-29)

**Owner:** *"when a request is launched without the user being logged in, we
cannot continue it until the user is logged; if not, cancel it, do not run, so
we will not spend some token."*

An anonymous visitor could never create a request — `createRequestFn` and
`startRequestPipelineFn` both refuse without a session. The hole was on the
**resume** side: `HeroPrompt` auto-SUBMITTED the saved draft the moment a
logged-in user mounted the form. Two consequences, both real:

- the draft had **no expiry**, so a need typed and abandoned days earlier
  fired a paid research pass at that person's next sign-in (dev request #3030
  "ccx" is exactly that: a throwaway anonymous input that ran a full pipeline
  on login);
- since 2026-08-29 the form also mounts on `/demandes`, where it is
  **collapsed by default** — so it could fire from a surface the user could
  not even see, and they would just find themselves on a new dossier.

**The rule now (do not undo):** a restored draft is **put back in the form and
left there**. Concretely — drafts carry a `savedAt` and anything older than
**1 h is discarded**; the restore effect fills the fields, shows
`home.draftRestored`, and calls `onDraftRestored` so `/demandes` **opens the
collapsed form** (a restored draft nobody can see is worse than none); and
nothing is submitted until the buyer presses the button. `submitLegacyText`
was deleted with the auto-submit — a legacy plain-text draft now lands in the
details field and leaves through the normal path.

*Verified live in dev:* anonymous need → auth gate → login → the form opened
with the input and the notice, **and the request count did not move** (9 → 9,
zero tokens); pressing the button then created #3031 normally.

**Expiry is 1 h** (owner, same day — tightened from the initial 24 h). Worth
knowing, because two rules meet here: **prod enforces email verification at
login**, so a brand-new visitor's trip is type → sign up → wait for the mail →
click → sign in. Someone who does not check their inbox within the hour loses
the draft and retypes. That is the owner's call and the safe direction (a
stale draft costs money, a retype costs a minute); revisit if signup feedback
says otherwise.

### ~~Hydration breaks once a visitor picks a language~~ ✅ FIXED 2026-08-29

**The defect (found and fixed the same day).** Deterministic before the fix —
same server, no restarts between runs: `osi-lang` absent in localStorage =
clean; `osi-lang="en"` = `Hydration failed because the server rendered text…`
on every page. React discarded the server HTML and re-rendered the whole root
on the client, so SSR was silently wasted for anyone who had ever touched the
language toggle.

**Mechanism.** The old design stored the choice in localStorage and applied it
in a `useEffect` in `__root.tsx`, on the theory that always server-rendering
the default keeps markup stable. React 19 hydrates PROGRESSIVELY: the root's
effect fires while child subtrees are still hydrating, `changeLanguage`
re-renders react-i18next's subscribers, and those children hydrate French
server HTML against English client output. Timing-dependent, hence
intermittent-looking.

**The fix — the language reaches the SERVER (contract, do not undo):**
- **A cookie, not localStorage** (`osi-lang`, `src/i18n/config.ts`). The server
  cannot read localStorage, and SSR must render in the chosen language.
  Works for anonymous visitors too, which `user.locale` cannot.
- **One i18n instance PER LANGUAGE, memoized** (`getI18n(lang)`), handed to the
  tree by `<I18nextProvider>` in `__root`. **Never a single mutable singleton**:
  the SSR process serves concurrent requests from one module graph, so a
  `changeLanguage` on a shared instance leaks one visitor's language into
  another's render. Each instance has a fixed `lng` and never changes.
- **Resolution happens once, server-side**, in `getSessionFn` (which already
  runs in `beforeLoad` — one round trip, not two): cookie → the account's
  `user.locale` → `fr`. It returns `{ session, lang }` and `beforeLoad` puts
  both in the router context; `<html lang>` reads the same value.
- **Switching = cookie + `router.invalidate()`** (TopBar, and the Paramètres
  profile save). beforeLoad re-resolves, the tree re-renders with the other
  instance — a normal client render, never a hydration comparison. **There is
  deliberately no post-hydration `changeLanguage` anywhere.**

*Verified in dev:* SSR under `Cookie: osi-lang=en` returns English nav labels;
a fresh tab with that cookie loads `/parametres` fully in English with a
**clean console**; the toggle flips cookie + `<html lang>` + all copy with no
reload and no error; `/demandes`, `/fournisseurs`, `/interne/sources` clean.

**One-time cost, accepted (pre-launch, no customers):** a visitor whose old
preference lived in localStorage falls back to French until they use the
toggle once. No migration shim — reading localStorage during the first render
is exactly the bug that was removed.

**Known and out of scope:** page `<title>`s are static French strings in each
route's `head()`, so they do not follow the language. Separate task.

**Two investigation traps that cost time here** — the browser console buffer is
**per tab and survives navigation**, so one stale error looks like it
reproduces everywhere (open a NEW tab before concluding); and a probe reading
`window.__hyd` returns `[]` when the probe was never installed, which reads
exactly like "no errors". Both produced a confidently wrong first diagnosis
(blamed on `DossierCard`'s relative timestamp, then on dev-container
restarts). `DossierCard` keeps its `suppressHydrationWarning` as prophylaxis —
that mismatch is real in principle and costs one attribute.

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
| Redis-backed distributed rate limiting (fail-open) | `deccfd1` — deployed 2026-08-24 |
| Sourcing engine: connectors, store-first, research queue, quota lock | `6ad0232` — Phase A core; deployed 2026-08-24 |
| Full architecture in both stacks: worker-research + redis first-class | `0736f1e` + README interaction docs `3030065`; deployed 2026-08-24 |
| Footer heading: "Nos engagements" / "Our commitments to you" | `186ecd5` + `17615cd`; deployed 2026-08-24 |


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
- ✅ **Fixed 2026-08-26 (S5b): supplier verification is evidence-derived** —
  `verification_status` is a projection of `supplier_verification` rows
  computed in `src/lib/verification.ts`, written ONLY by
  `src/server/verification.ts`. Suppliers now actually earn `pending` (+5)
  through the automated battery; `verified` (+12) waits for the E10 staff
  review surface (human_review rows)
- ✅ **Fixed 2026-08-28 (owner: "BLOCK THEM"): `.docx`/`.xlsx` are refused
  at upload** — they were accepted but `attachments.ts` cannot read them,
  so the pipeline silently skipped a file the buyer thought counted. Both
  gates: the `/api/upload` MIME allowlist (415) and the file picker's
  `accept` filter. Re-allow only when a Word/Excel reader exists
  (readable today: PDF, images, TXT, CSV)
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
      (`sources` feature in `src/lib/roles.ts`): one tab per source
      (layout reworked 2026-08-24) with enable/disable switch, store browser (memberships, freshness,
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

- [x] **C2 · First registry connector** (`registry-ca`) — ✅ **BUILT
      2026-08-24** (investigation same day, findings in README §9). Static
      connector over the federal bulk open data (OGL, commercial OK):
      full-pull of the "Active business corporations" CSV (~100 MB, 643 863
      rows, daily upstream), self-contained streaming RFC 4180 parser,
      numbered shells filtered (~249k — digit-only names would false-match
      numeric criteria like "ISO 9001"), confidence 60, no fabricated
      descriptions, per-corp provenance URL. Seeded **enabled=false**
      (migration 0014). *Verified live in dev:* pull → **393 339 records in
      ~40 s** (chunked upserts); second pull → `added=0`, idempotent by
      dedup; default-scope record query stays at **0.04 ms** (SQL scope
      filter in scope.ts). Registry data stays a name-only discovery source —
      its real value is E10 verification (federal lookup API, per §9).
- [x] **C2b · Big-store SQL prefilter** (2026-08-24) — enabling `registry-ca`
      is now performance-safe. Sources above `BIG_STORE_THRESHOLD` (5k rows,
      env-tunable) are prefiltered IN SQL: only records whose NAME matches a
      request-criteria token (≥3 chars, same vocabulary as the scorer —
      shared `src/lib/match-tokens.ts`, raw accented variants included, capped
      at `BIG_STORE_FILTER_LIMIT` 20k) are loaded; with no usable tokens a big
      store contributes only its promoted records. Small stores keep the full
      in-memory behavior. *Measured in dev with registry-ca (393k) enabled:*
      token-less request → 36 ms, pool 42; token-rich request ("vannes …
      inox 316L") → **345 ms, pool 2 450, 53 qualifying → store-hit**. Also
      fixed same day: the request-time fallback collects from DYNAMIC sources
      only (`ec374a1`) — a static connector can never fire mid-request.
      **Remaining product caveat, not a code gate:** name-matched registry
      records can now legitimately store-hit and reach a Top-N as bare names
      (no website, no description, ~45 % compatibility). Enabled in dev to
      exercise it; keep prod's switch OFF until the enrichment agent exists
      or the bare-name quality is accepted.

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

### Phase D — stores are disposable; suppliers are promoted

**✅ BUILT 2026-08-24 (same session as the design).** What sources collect
lives in per-source stores as raw `source_record` rows — *candidates* to
become suppliers; a `supplier` row is created only at **promotion** (ranking
into a request's Top-N). **A store can be wiped at any time without
impacting the platform** — everything load-bearing references promoted
suppliers only.

- [x] **D1 · Migration — `source_record`** (0012 + 0013): replaces
      `supplier_source`; uq(data_source_id, dedup_key), candidate fields,
      payload, ban trail, **nullable `supplier_id` set at promotion**.
      Backfill: every membership became a promoted record (fields copied
      from the supplier; legacy null dedup_keys get `legacy:<id>`), then
      `supplier_source` dropped. *Verified on dev AND on a prod-dump
      restore (51 records backfilled promoted, matches untouched).*
- [x] **D2 · Collection writes records, never suppliers** —
      `persistFromSource` upserts `source_record` only; re-encounter
      refreshes last_seen (+ the promoted supplier's freshness); ban
      stickiness at record level (upsert touches active rows only).
- [x] **D3 · Matching over logical candidates + promotion at Top-N** —
      `eligibleCandidates()` (scope.ts) groups records by dedup_key across
      effective sources and merges promoted suppliers (records fold into
      their supplier via link OR key); `scoreSupplier` generalized to the
      structural `Scoreable`; `createMatchesForRequest` promotes the ranked
      Top-N (supplier insert through the dedup unique index +
      `source_record.supplier_id`) before writing matches. *Verified live:
      cold request #3023 collected 6 records → exactly Top-5 promoted, the
      6th stayed an unpromoted candidate in the store.*
- [x] **D4 · Store wipe** — `wipeSourceStoreFn`, platform-OWNER only (above
      the manager feature gate), two-step confirm, audited as a source_run
      row (`scope: {action:'wipe', deleted:N}`). *Verified live: wiped all
      43 records → 42 suppliers, 50 matches intact, dossier #3023 rendered
      identically.*
- [x] **D5 · Screen follows** — store browser lists records with the
      "promu" badge, global-ban control only on promoted rows, counts add
      "N promus", wipe button, runs table renders full-pull and wipe rows.
- [x] **D6 · Tests** — existing units updated to the candidate shape (27
      pass). Promotion idempotence, wipe safety and ban stickiness are
      DB-bound — verified live against the dev stack per the repo's
      unit-only policy (integration tests come with CI, if CI ever comes).

### Phase S — ADR-001: the demand-pull supplier graph (ACCEPTED 2026-08-26)

**The supplier-provisioning strategy pivoted** — decision record in
[doc/adr/ADR-001-supplier-provisioning.md](adr/ADR-001-supplier-provisioning.md)
(diagrammed artifact linked from there). Principles: **demand-pull** (nothing
is spent on a supplier until a request needs them) and **the deal loop is
the data-acquisition engine** (facilitation outcomes are the unscrapable
moat). New source-role axis: *discovery* sources are workspace-selectable;
**registries are verification infrastructure** — never matched, never in
workspace settings, evidence lines on supplier profiles only; their stores
stay as local verification tables, refreshed ~every 6 months. The supplier
graph = the `supplier` table as node + dated, sourced edges (capabilities,
shipments, registry snapshots, certs, verification evidence, deal
outcomes); lifecycle `lead → profiled → verified → engaged → partner` is
derived from edges, never set by hand.

- [x] **S1 · Category taxonomy — BUILT 2026-08-26** (`src/lib/taxonomy.ts`):
      in-house tree, **78 nodes** (16 sectors → 62 categories), FR/EN
      labels, HS heading mappings (the customs bridge), matching keywords
      drawn from the scorer's own vocabulary (`match-tokens`). Helpers:
      `categoryById/rootCategories/childrenOf/categoryLabel` and
      `suggestCategory(text)` (pure keyword scoring — pre-fills the form
      from typed text, no AI). A typed module, deliberately not a table
      (moves to rows the day staff editing is needed); **node ids are
      stable — never reuse one**. Integrity + suggestion under unit test
      (`taxonomy.test.ts`).
- [x] **S2 · Structured request form — BUILT 2026-08-26** (primary intake):
      HeroPrompt is now the form — product* + quantité / **catégorie***
      (**searchable combobox** over the S1 tree — cmdk/Popover
      `CategoryCombobox.tsx`, accent-insensitive, matches BOTH locales +
      the node keywords, so "pump" finds "Pompes"; auto-suggested on blur
      while unchosen) /
      matériau / certifications / délai / détails textarea; attachments +
      mic unchanged. Migration **0019**: `request.category_id` (+index).
      `createRequestFn` takes the optional `structured` payload: fields
      become criteria rows VERBATIM (**source "user"**, product row
      required — the primary matching signal; certifications required),
      details still regex-parsed for extra specs without duplicating a
      category the form answered (`structuredCriteria` in
      parse-criteria.ts, unit-tested); title = product; invalid category
      ids stored null, never trusted into cache keys. Auth-gate draft is
      the whole form as JSON (`osi-draft-besoin-v2`); a legacy plain-text
      draft is restored into the details field the same way. *Verified live
      in dev end to end:* form → suggestion picked "Pompes" → request
      #3024 with `category_id=pumps`, 3 user-source criteria rows, pipeline
      store-hit (pool 42 — promoted suppliers only, registries absent per
      S5a), report_ready.
- [ ] **S3 · Category/activity-code retrieval** — replaces the name-only
      big-store ILIKE prefilter for discovery stores: criteria/category →
      activity-code mapping (NIC, SSIC, QC activity classes), zero AI cost.
- [ ] **S4 · Lazy per-request enrichment — ⏸️ DEFERRED (owner + design
      review, 2026-08-28: "is it really a good idea" → no, not now).**
      The original driver died with S5a: bare registry records no longer
      enter matching (verification role), and `global_web` — the only
      search source — returns candidates WITH descriptions, so the
      thin-candidate population S4 exists for is near-empty today, while
      the cost (~$0.15–0.45/request at 3×N) would dwarf research itself
      (~$0.07). **Revive triggers**: a search source that returns bare
      names (e.g. a free BoL connector), or evidence from real requests
      that profiles are too thin (matching misses, buyer feedback).
      Cheapest first slice when revived: enrich only the presented Top-N
      (N, not 3×N), AFTER the report, as profile-deepening + tier-2
      capability evidence. Original seams still apply: `enrich` job on
      the research queue, agent module beside `ai/research.ts`,
      enrichment fields + `enriched_at` on `source_record`, per-run
      audit with token cost.
- [ ] **S5 · Verification battery + source roles** (customs connector
      REMOVED from scope — see below).
      **Customs access investigated 2026-08-26 → CLOSED** (README §9
      "customs-us investigation"): **no free route exists** (Enigma
      retired, FOIA rejected 2023, OEC paywalled; the only routes are the
      paid CBP feed or paid APIs), and the **owner set a HARD CONSTRAINT
      2026-08-26: no paid subscription to any data provider, ever — do not
      align any design with one.** Consequences: `customs-us` is not built;
      discovery = `global_web` + genuinely free sources only; the China
      corridor stays covered by global_web; the `export_record` check is
      dormant unless a truly free licensed route ever appears; tier-2
      capability evidence comes from certifications and the S6 engagement
      loop instead. Do not re-propose paid data options.
      Verification battery =
      the E10 spec (ADR §4): six checks → evidence rows → derived tier
      ladder (0 unverified → 1 existence → 2 capability → 3 Vérifié OSI);
      sanctions hit blocks presentation; scheduled ~6-mo registry refresh
      (the scheduler is the third legitimate caller of connectors, as the
      README always reserved).
  - [x] **S5c · E10 staff review surface — BUILT 2026-08-26**:
        `/interne/verification` (placeholder replaced; owner/manager via the
        existing `verification` feature gate) lists every supplier that has
        been through the battery — **sanctions alerts first**, then
        evidenced (tiers 1-2), tier 0, verified last — with one evidence
        chip per check (detail in the tooltip: registry name, snapshot,
        HTTP status, MX, matched SDN entries, reviewer). **"Vérifier
        (Vérifié OSI)"** writes the `human_review` evidence row (who/when,
        via `recordHumanReview` in server/verification.ts — the
        single-writer rule holds) → derived `verified`, +12 in matching,
        the ✓ badge in /fournisseurs; **"Retirer la vérification"** deletes
        the row and the tier falls back to the automated evidence. Server
        fns in `src/lib/verification-fns.ts` (typed EvidenceDetail
        projection of the jsonb). *Verified live in dev end to end:*
        request #3027 (bearings) → 5 suppliers × 3 checks → screen rendered
        chips incl. an honest "Registre ✗" for NTN·JP (covered country,
        fixture store, not found) → Vérifier on AST Bearings → Examen OSI ✓
        chip, gold Vérifié OSI tier, ✓ badge live in the directory,
        human_review row carries reviewedBy. Tier 3 is now EARNABLE — the
        scorer's +12 stopped being dead weight.
  - [x] **S5b · Verification battery v1 — BUILT 2026-08-26** (the free
        checks; = the E10 core): migration **0020** adds
        `supplier_verification` (one evidence row per supplier × check —
        status, source, sourceUrl, result jsonb, checked_at; uq pair) and
        `sanction_entry` (local OFAC SDN copy, name_slug join column).
        Checks (src/server/verification.ts): **existence** (offline lookup
        of the supplier's dedup_key in the verification-role stores of its
        country — passed with registry name + snapshot date; `failed` =
        covered country, not found; `inconclusive` = country not covered,
        e.g. CN); **digital_identity** (site reachable, MX, RDAP domain
        age — young-domain flagged, never auto-failed); **sanctions**
        (OFAC SDN downloaded when >7 days old — 19 319 entries — screened
        by conservative whole-`nameSlug` equality; a hit → status
        `rejected`, −25, staff reviews). Tier ladder DERIVED in
        `src/lib/verification.ts` (0 → 1 existence → 2 capability → 3
        human_review; projection onto `verification_status`: 3→verified,
        1-2→pending, hit→rejected) — **verification.ts is the ONLY writer
        of that column**; the "any code can set any status" debt dies by
        construction. Runs as a `verify` job on the research queue,
        enqueued right after Top-N promotion (async — the report never
        waits; the tier-1-as-presentation-floor rule flips to inline
        later, once the checks have soak time). Per-check TTLs (existence
        180d aligned to the 6-mo store refresh · identity 30d · sanctions
        7d) make re-runs ≈free. export_record is DORMANT (no-paid-data
        constraint — only a truly free licensed route would revive it);
        certification joins with a free cert-registry route; human_review
        = the E10 staff screen (open). *Verified live in dev end to end:* request
        #3026 → 5 suppliers → SDN auto-downloaded → CN/CZ suppliers
        existence-inconclusive (`country_not_covered`, honest) with
        site/MX evidence; a supplier keyed to a real registry-qc record →
        existence passed (registry name + snapshot 2026-08-25) → derived
        **pending**. 46 unit tests green (tier ladder + nameSlug pinned).
  - [x] **S5a · Source-role split — BUILT 2026-08-26** (first ADR-001 code;
        baseline tag `adr-001-baseline`): migration **0018** adds
        `data_source.role` (`discovery | verification`, default discovery)
        and flips every `country_registry` to verification. `resolveScope`
        now feeds matching from DISCOVERY sources only — a supplier known
        only through verification records is invisible to matching by the
        existing out-of-scope rule (a bare registry name is not a
        presentable candidate). `updateSourcingRulesFn` drops verification
        ids from any payload; Paramètres lists discovery sources only +
        the "registres = vérification automatique" note;
        `/interne/sources` shows a role badge per tab and the ADR-001
        verification explainer (store = lookup table, ~6-mo cadence);
        refresh/upload/wipe unchanged (store warming stays legitimate).
        *Verified in dev:* migration applied (6 rows correct), Paramètres
        shows only Web mondial, registry tabs badge + hint render; tsc,
        eslint, 28 unit tests green. **Bonus same evening: the Singapore
        pull completed** — 618 889 candidates → **613 653 records**, its
        store is warmed as a verification table.
- [ ] **S6 · Engagement feedback loop** — gated with E6: outcomes (response
      time, MOQ, lead time, quotes) write back onto the supplier as edges.
      The moat; build the schema seams when E6's flow is defined.

### Phase P — the transaction dossier & contract centre (ADR-002, proposed 2026-08-29)

**The portal brief** ([doc/briefs/portail-entreprise.md](briefs/portail-entreprise.md))
brings its own process and it is NOT the one this backlog held. Decision record:
[ADR-002](adr/ADR-002-transaction-and-contract-centre.md) — **status: proposed,
awaiting owner validation. No code until it is accepted.**

**RETIRED by ADR-002** (do not build these — they were never built, only
planned): the `engagement` entity and `engagement_events`, the "Engager" button
on a Top-N supplier, the ops engagement queue and the "connected" state, and
E8's standalone `transaction`. The process is now
`demande → fournisseurs → soumissions → acceptation → dossier de transaction →
contrats → commande → livraison`.

**Owner constraints already recorded:** suppliers and sub-contractors have **no
platform access** in v1 — staff mediate every external interaction, by email
through the platform (2026-08-29). Parties are ROWS, never users.

- [x] **P0 · Shell, navigation & designs — DONE 2026-08-29.**
      ① **Two designs, user-switchable — BUILT.** `light` (the original) and
      `dark` (the brief's `#111111` · `#1E1E1E` · `#202020` · `#E6E6E6`), the
      switch being the **sun/moon button in the top bar**. Contracts:
      **server-rendered** — `<html class="dark">` comes from the request
      (`osi-design` cookie → `user.design` (migration **0032**) → `light`),
      resolved in `getSessionFn` beside the language, so there is **no flash
      of the wrong theme and no hydration mismatch**; the dark palette is a
      **token block in `styles.css`, never a parallel stylesheet**, giving
      three grounds (sidebar `#0B0B0B` < page `#111111` < card `#1E1E1E`) —
      a dark sidebar on a dark page dissolved into it otherwise;
      **`--gold-soft` is now DERIVED** by `color-mix` from `--gold` per design
      (white tint in light, `#111111` tint in dark), so an accent is **one
      value** and cannot be light-only by construction — that was the actual
      bug behind "audit the accents on both grounds", since the stored
      near-white tint made every accent chip a glaring block on dark.
      Signed-in users persist through `setDesignFn` (session cache purged);
      anonymous visitors keep the cookie. *Live-verified: SSR emits the class
      from the cookie, a fresh tab renders dark with a clean console, the
      toggle flips instantly with no reload, all five accents read on both
      grounds, and the light design is unchanged.*
      ② **Home IS the dashboard — BUILT** (deploy #12). `/` keeps its route
      and SEO meta; `nav.accueil` → `nav.tableauDeBord`; the signed-in view is
      the dashboard with its own header. *Enriching it toward the brief's
      mockup (dépenses chart, activités récentes) is still to do.*
      ③ **The form moved to Demandes — BUILT** (deploy #12): `HeroPrompt`
      gained `hero` | `embedded`; `/` keeps the hero mount for anonymous
      visitors (that IS the auth gate), `/demandes` carries the form under a
      « Nouvelle demande » toggle. The draft trap is closed — the gate returns
      to `/demandes` and the collapsed section is hidden with CSS, never
      unmounted, so the resume effect always runs.
      ④ **Merged nav — BUILT** (deploy #12): 11 client + 9 interne = 20;
      unbuilt entries are greyed with **no route at all**; `Analyses` moved
      into the INTERNE block. Full table in ADR-002 §12.
      ⑤ **Dead download button removed** from the top bar (owner, 2026-08-29)
      — it had no handler and never did anything; its i18n key went with it.
- [ ] **P1 · Schema spine.** `quote` (soumission: request + supplier, status
      `requested | received | declined | accepted | expired`, price, currency,
      lead time, MOQ, incoterm, terms, received_at), `deal` (the dossier —
      accepted quote, buyer org, supplier, value, currency, status), `deal_event`
      (timeline, `request_event` pattern), `contract` + `contract_party` +
      `contract_event`, `order_milestone`, `document`, `payment`,
      `message_thread` + `message`. Every buyer-facing table workspace-scoped
      and indexed on it; party references nullable + name/email snapshot
      (tombstone rule). Status machines in `src/lib/*-status.ts`, guarded like
      `request-status.ts`.
- [ ] **P2 · Soumissions — solicit & record.** Staff asks N suppliers of a
      Top-N for an offer (`quote` rows in `requested`, outbound mail through
      `mail.ts`); staff records what came back. Buyer sees the tab fill up.
      **This is where the moat starts accumulating** (response time, MOQ, lead
      time, price — ADR-001 S6).
- [ ] **P3 · Comparison & acceptance.** Side-by-side comparison of received
      quotes; the buyer accepts ONE; acceptance opens the `deal` automatically
      (brief §4 steps 1-2) and marks the losing `match` rows `rejected` (the
      enum already carries `selected`/`rejected` — currently unused).
- [ ] **P4 · Contract centre v1 — THE PRIORITY.** List view with the §3.1
      filters (Tous · Actifs · À signer · En attente · Complétés · Expirés — all
      derived, no status columns), search, the `2/4` signature indicator,
      « Nouveau contrat ». Fiche per §3.2. Parties table per §3.3 with per-party
      status and actions.
- [ ] **P5 · Required-contract derivation + templates.** `src/lib/contract-types.ts`
      maps parties → required contracts (brief §4 step 3, §5 types); templates
      pre-filled from the deal (step 4).
- [ ] **P6 · Signature tracking + reminders.** `src/server/esign.ts` adapter with
      the **`manual` provider first** (staff sends, records the countersigned
      PDF with who/when/evidence). Reminders to pending signers; all mandatory
      signatures ⇒ `signed` ⇒ the next operational step unlocks (steps 5-8).
      **Signature evidence never goes in `audit_log`** — it is purgeable at 3
      months; evidence lives on `contract_party` / `contract_event`, permanently.
- [ ] **P7 · Commandes.** `order_milestone` — production, inspection, transport,
      douanes, livraison; staff updates, buyer reads. Replaces the showcase
      constants in `src/data/osi.ts` (`etapesTransaction` finally dies).
- [ ] **P8 · Documents module.** Typed `document` rows (facture · certificat ·
      douane · inspection · packing list · B/L · contrat signé · annexe),
      versioned, behind `storage.ts`. Absorbs E7's open "server-rendered PDF
      stored as a documents row". **BLOCKED until the uploads volume is backed
      up** — see the gap below.
- [ ] **P9 · Paiements.** Ledger view: dépôts, soldes, factures, frais OSI, état.
      Track-only, no PSP, staff-entered (README rule unchanged).
- [ ] **P10 · Messages.** Threads per deal, buyer ↔ staff in-app; external
      parties by email through the platform (never an account).
- [ ] **P11 · Rapports.** Dépenses, économies, performance fournisseur. Needs
      the ⓪-class honesty pass: **"économies" cannot be computed today** — no
      baseline price exists to compare against.

**Gaps and gates that must be settled inside Phase P:**

- ❗ **The `osi-uploads` volume is not backed up.** `scripts/backup.sh` dumps
      Postgres only. Acceptable while uploads are re-uploadable spec sheets;
      **unacceptable once signed contracts live there.** Fix before P8.
- ❗ **No document retention policy, and `storage.deleteFile` is never called on
      user files** — deleting a request drops its `file` rows and orphans the
      bytes. Brief §7 asks for a policy.
- ❓ **G1 — e-sign vendor + budget.** Deferred: the `manual` provider ships v1.
- ❓ **G2 — supplier/sub-contractor portal access.** Owner-deferred 2026-08-29;
      brief §6's last two rows are out of scope. `contract_party` is where it
      attaches later.
- ❓ **Plan dimension.** Do deals/contracts belong to a plan tier, or are they
      open to any workspace with a deal? (E12.)
- ❓ **Who signs for OSI** — owner only, or any manager (`contracts.sign` key).
- ⚠️ **Pick-up item ⓪ (search relevance) is not part of Phase P but gates its
      value** — quotes solicited from an irrelevant Top-N are the wrong quotes.
      Land it before or alongside P2.

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
      login/signup → the draft comes BACK IN THE FORM and the buyer presses
      the button (no retyping, but no automatic spend either — owner
      2026-08-29; drafts expire after 1 h)
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
- [x] **Audit log — BUILT 2026-08-27** (see ②i in Resume here: audit_log
      table + emitter + journal on /interne/utilisateurs, per org / per
      user)

### E3 — Requests core loop

- [x] `requests` CRUD + status state machine (guarded transitions in `src/lib/request-status.ts` + `src/server/requests.ts`, launchedAt/completedAt timestamps, request_event trail)
- [x] Hero prompt → creates request (sequence ids from 3000; draft→received + extraction job; a post-auth draft is RESTORED into the form, never auto-submitted — see the 2026-08-29 entry)
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
- [x] **Structured request form as primary intake** — ✅ **BUILT 2026-08-26
      as Phase S task S2** (see the Phase S entry for the implementation
      facts). Original scoping below (owner decision
      2026-08-26 — context in ADR-001, the supplier-
      provisioning review: https://claude.ai/code/artifact/a537df29-e576-4725-b8de-661efd1d1438).
      Replace the free-text-only intake with a form: **category (required,
      from a new in-house taxonomy ~50–100 nodes, mapped behind the scenes
      to HS/NIC/SSIC codes)** · product name · spec chips (material,
      standards) · certifications multi-select · quantity + unit · target
      lead time · free-text details field for nuance. The form writes
      `request_criterion` rows directly — `createRequestFn` stays the single
      choke point; the regex parser is superseded wherever the form covers
      it. **Why it matters beyond UX:** the category field is the intake
      half of the taxonomy spine — it unlocks category→activity-code
      retrieval over the registry stores (prefilter v2, fixing the
      name-only prefilter gap at `src/server/sources/scope.ts:147`), makes
      the cache key honest, and makes coverage measurable per
      category × corridor. **Pre-launch, no conversion constraint** (no
      customers on dev or prod): build form-first now; the low-friction
      plain-language hero is a launch-time design task, and the form's
      fields will define exactly what that parser must extract. Dependency:
      the taxonomy (ADR-001 open question #2) — resolve it first.

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
- [ ] ~~**Next connectors** (roadmap): `registry-ca` ✅ → `alibaba` →
      `registry-us` → per demand~~ — **SUPERSEDED by ADR-001 (2026-08-26)**:
      no more registries are built for discovery; connector priority is
      demand-driven over **genuinely free sources only** (customs/BoL is
      CLOSED — no free route + the owner's no-paid-data constraint).
      Existing registry connectors + stores are retained as verification
      backends. The alibaba ToS/licensing gate still applies if a
      marketplace connector is ever wanted (marketplaces are
      discovery-role, and free-tier only).
- [ ] **`registry-us` — SPEC'D but DEPRIORITIZED by ADR-001** (registries
      are verification-role now; build it only when discovery demand
      surfaces US-verification volume — the spec below then applies
      unchanged, feeding a verification store instead of matching)
      (investigated 2026-08-25,
      full plan in README §9 → "registry-us investigation"): v1 = SAM.gov
      monthly public entity extract via the Extracts API (free personal key
      → `SAM_API_KEY`; autonomous static pull; NAICS code titles become the
      record description, so its records are matchable like registry-qc's).
      Prerequisite before coding: create the SAM.gov account/key and verify
      the key-based extract download works server-side; the registry-qc
      file-fed seam is the drop-in fallback if it doesn't. Seed disabled,
      warm, then decide enabling.
- [x] **`registry-qc` — BUILT 2026-08-25** (owner decision 2026-08-24 to
      proceed) as the first **FILE-FED static source**: the registry endpoint
      sits behind an anti-bot wall, so autonomous fetching is impossible —
      staff downloads the ZIP in their own browser and uploads it on the
      source's tab (`PUT /api/source-upload`, streamed to the uploads volume,
      never buffered; the run consumes then deletes the file). Connector
      parses `Entreprise.csv` (status `IM` only, **activity descriptions —
      the matching signal no other registry has**) joined with `Nom.csv` by
      NEQ (legal-type in-force name first, other in-force name as fallback,
      retired/anterior names and numbered shells skipped), UTF-8 with a
      windows-1252 fallback sniff, confidence 65. New seams built for it:
      `SearchBrief.fileKey`, `meta.requiresFile`, `putFileStream`, the
      upload control on the tab, error `file_required`. Migration 0015 seeds
      the row **disabled**. *Verified end to end in dev with a
      guide-conformant fixture ZIP through the real UI: 4 enterprises → 3
      records with accents + descriptions intact (deregistered excluded,
      numbered legal name replaced by its fallback, retired name replaced by
      the current one); upload deleted after the run.* **Real archive pulled
      2026-08-25** (staff flow exercised for real): **830 419 candidates →
      814 921 records in 65 s**, activity descriptions populated. Store
      warmed while disabled; upstream refreshes twice a month — re-download
      + re-upload on that cadence, idempotent. The tab carries the download
      link (`meta.downloadUrl`). **Why not autonomous:** the endpoint sits
      behind an anti-bot JS challenge (verified: server fetch → 403
      challenge page; automated browser → never released). We do not
      circumvent bot detection. The clean path to automation: ask the
      Registraire (guide contact `groupe.pilotage@req.gouv.qc.ca`) for a
      machine endpoint or IP exemption — the connector then flips to
      autonomous with the parsing unchanged.
- [x] **`registry-sg` — BUILT 2026-08-25/26** (Asia wave): AUTONOMOUS static
      source over data.gov.sg's open datastore (no key, no account) — the
      ACRA corporate-entities collection, 27 datasets paged at 1000
      rows/page with a server-side LIVE-status filter and a `fields`
      selection (full rows carry 50+ columns). Every record has its
      **primary SSIC activity code + description** → matchable records,
      like registry-qc. Retries with backoff on every call (~600 sequential
      requests make transient blips a certainty — the first attempt died on
      one), per-dataset progress logs, confidence 65. Seeded disabled
      (migration 0016). *First real pull ran in dev at commit time —
      dataset-by-dataset totals matching the probes (16 031 live in
      "others", 115k+ through 6/27); final store count in the source tab.*
- [x] **`registry-jp` — BUILT 2026-08-25/26** (Asia wave): FILE-FED static
      source (the NTA download is a per-session CSRF-token form POST —
      probed; `downloadUrl` on the tab points at the 全件データ page). Staff
      uploads the Unicode CSV ZIPs chunk by chunk — each pull is an
      idempotent partial sync that accumulates. Parses the NTA's HEADERLESS
      30-column format: keeps latest (col 24), open (col 19 empty),
      displayed (col 30 ≠ 1), non-government (kind ≠ 101/201) rows; name =
      official English name when present, else the registered kanji name.
      No activity data → confidence 60, name-only like registry-ca.
      **Prerequisite fixed in `src/lib/supplier-key.ts`: the dedup tokenizer
      is Unicode-aware now — the old `[^a-z0-9]` class reduced kanji names
      to empty keys and every Japanese company would have been silently
      dropped (unit-tested).** *Fixture verified through the real UI: 2 of
      5 rows kept — the active kanji corp and the English-named one; closed,
      non-latest and government rows excluded.*
- [ ] **`registry-in` — BUILT 2026-08-26, first pull PENDING a free key**:
      AUTONOMOUS static source over data.gov.in's consolidated MCA resource
      ("RoC-wise Company Master Data", 3.67M rows, updated 2026-07 — probed:
      **2 597 823 Active companies**, every record with an NIC code +
      industrial-classification text → matchable records). Pages the API
      with a server-side Active filter, retries/backoff, progress logs;
      confidence 65. **Prerequisite: `DATA_GOV_IN_API_KEY` in `.env`** —
      free signup at data.gov.in; the public sample key is capped at 10
      rows/page and rate-limited (smoke run failed cleanly with HTTP 429 —
      the error path is verified end to end: retries fired, run failed
      clean, error surfaced on the tab). `REGISTRY_IN_PAGE_SIZE` /
      `REGISTRY_IN_MAX_PAGES` env knobs exist for tuning/smoke. Migration
      0017 seeds the row disabled. Full-pull verification happens when the
      key lands (expect ~2.6M records, ~30-45 min).
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

> **⚠️ SUPERSEDED 2026-08-29 — the gate is discharged and the design below is
> RETIRED.** The owner's portal brief brought its own process; the decision
> record is [ADR-002](adr/ADR-002-transaction-and-contract-centre.md) and the
> plan is **Phase P** above. There is no `engagement` entity, no "Engager"
> button, no ops queue, no "connected" state — a **soumission (quote)** is the
> unit of facilitation, and accepting one opens the `deal`. The unchecked
> tasks below are kept only to show what was replaced; do not build them.

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
- [x] **Verification workflow — BUILT 2026-08-26 (ADR-001 S5b/S5c)**:
      evidence-derived tiers + the `/interne/verification` review screen
      (battery evidence, sanctions alerts, Vérifier/Retirer via
      `human_review` rows). Supplier search/edit + merge duplicates still
      pending
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

**MVP1 = E0–E7 + E10.** Definition of done — **restated by ADR-002
(2026-08-29)**: a real buyer signs up, submits a real need, gets a real Top-N,
OSI solicits quotes, the buyer accepts one, the required contracts are signed by
every mandatory party, and the commande is tracked to delivery.

## Open items

- The 32 criteria list (E5 task — needs a product session)
- External data sources & licensing for imports (E4)
- ~~Web-search provider for the research agent~~ — **decided 2026-08-16: none needed.** Claude's server-side `web_search` tool runs the search inside the existing API call, so there is no second vendor, key or bill. It is called only from `src/server/ai/research.ts`, so a Tavily/Brave adapter can replace it without touching domain code (INFRA principle 4)
- ~~Email provider choice~~ — **decided 2026-08-23: SendGrid** (see B9)
- When to put a reverse proxy + TLS in front of prod (before first external user)
