# Account model — Individual & Enterprise (SaaS)

> **Status: PROPOSAL — awaiting validation.** Nothing here is built beyond what
> is explicitly marked as existing. Once validated, the use cases below become
> the E2/E12 implementation checklist. Written 2026-08-22.

## 1 · The idea in one paragraph

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
helpers, and the managerial view. That is exactly backlog **E2**, plus the
Enterprise items added to **E12** on 2026-08-20.

## 2 · Who is who — the three populations

| Population | Identified by | Examples | Powers come from |
|---|---|---|---|
| **Platform staff** (OSI employees) | `user.platform_role` = `owner` · `manager` · `accountant` | ops running facilitation, finance | [`roles.ts`](../src/lib/roles.ts) feature map — internal surfaces, all-tenant visibility |
| **Customer — Individual** | regular `user` (+ personal workspace, 1 member) | a solo buyer on Free/Pro | their `member.role` in their own workspace |
| **Customer — Enterprise** | regular `user`s sharing a company workspace | a purchasing team on Business/Enterprise | their `member.role` in the company workspace |

The two axes never mix: `platform_role` is granted only in the database and
gives OSI-internal powers; `member.role` is granted by a workspace owner/admin
and gives powers **inside that workspace only**. A staff member who also buys
would simply have both — like `yves@overseaimportexports.com` today (platform
`owner` + owner of his own workspace).

## 3 · Account types (customers)

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

## 4 · Workspace roles and rights

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

## 5 · Use cases

### UC-1 — Individual signup *(exists today, unchanged)*
A person signs up (email/password or Google). A personal workspace is created,
they are its `owner`, subscription = Free. Everything below is additive.

### UC-2 — Create an enterprise workspace
An authenticated user clicks **"Créer un espace entreprise"** (Paramètres),
names the company, and becomes its `owner`. Their personal workspace is
untouched — they now belong to two workspaces and can switch between them (the
active workspace is session state; better-auth's org plugin supports this
natively). The enterprise workspace starts on a trial/Business plan until
billing lands (open question Q3).

*Acceptance:* switching workspaces re-scopes every list (requests, suppliers
links, stats) with no leakage between the two; the workspace switcher shows
both, with the active one marked.

### UC-3 — Invite an existing or new user by email
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

### UC-4 — Owner creates a member account directly
For companies that don't want a signup dance: owner/admin enters name + email,
OSI creates the account **without a password** and emails a set-password link
(same mechanics as password reset). Until the link is used the account cannot
log in. No temporary passwords: they end up on sticky notes; a set-password
link expires cleanly.

*Acceptance:* the created user lands directly as a member with the assigned
role, `email_verified = false` until the link is used; the link expires (48h)
and can be re-sent.

### UC-5 — Change a member's rights
Owner/admin changes a member's role from the team screen. Effect is immediate
on next request (server functions re-read membership per call — no session
invalidation needed since role lives in `member`, not the session).
Constraints: `admin` cannot touch the `owner` or promote anyone **to** owner;
demoting yourself below `admin` is confirmed with a warning if you are the last
admin besides the owner.

### UC-6 — Remove a member / member leaves
Owner/admin removes a member; or a member leaves voluntarily (Paramètres).
Their `member` row is deleted; their user account and personal workspace are
untouched. **Their requests stay with the enterprise workspace** — the data
belongs to the tenant, not the person (this is the whole point of enterprise).
The `owner` cannot be removed and cannot leave without transferring ownership.

### UC-7 — Quota & usage (the money view)
The enterprise plan's `requests_per_day` is a **pooled workspace limit**
(existing behavior — quotas already count per `organization_id`). Optional:
a per-member daily ceiling within the pool (e.g. pool 50/day, each buyer max
10/day) so one person cannot exhaust the team's allowance — this is the
`quota_scope` refinement already sketched in E12. The Free individual plan
counts per user, which is identical to per-workspace while workspaces have one
member, so **individual accounts need no code change**.

*Acceptance:* the quota refusal alert (shipped 2026-08-20) states which limit
was hit — "your daily limit" vs "your team's daily limit".

### UC-8 — Managerial view
Owner/admin get a **Mon équipe** surface in the workspace: members and their
roles, pending invitations, each member's requests (count + list, linkable),
and usage against the pooled quota over the current window. Buyers see only
their own dossiers, exactly as today; viewers see dossiers shared with the
workspace but the "Lancer la recherche" affordance is disabled for them (same
disabled-not-hidden nav rule the app already follows).

### UC-9 — Billing (deferred, unchanged)
One subscription per workspace — already the data model. Enterprise pricing is
per-seat or flat (open question Q4); the `subscription` provider columns stay
null until Stripe lands. Nothing in UC-1…UC-8 depends on billing.

## 6 · What it takes to build (delta over today)

| Piece | Status |
| --- | --- |
| `organization`, `member` (4 roles), `invitation`, `subscription` tables | ✅ exist |
| Pooled workspace quota at the choke point | ✅ exists (`checkRequestQuota`) |
| Workspace switcher + active-organization session state | ⬜ better-auth org plugin feature — wire it |
| `requireRole(workspaceId, minRole)` helper used by every mutating server fn | ⬜ E2 — the enforcement backbone, build first |
| Invitation server fns (create/accept/decline/revoke) + team screen | ⬜ E2 |
| Create-member-with-set-password-link flow | ⬜ needs the email provider (E9 dependency) |
| Managerial view (members, usage, team requests) | ⬜ new surface, reads existing tables |
| Per-member ceiling within the pool (`quota_scope`) | ⬜ E12 refinement, small |
| Enterprise plan row | ⬜ one migration (plans are rows) |
| Ownership transfer | ⬜ small server fn + confirm UI |

**Hard dependency to call out:** UC-3 and UC-4 need an **email provider**
(Resend vs SMTP — open decision since E9). Without it we can ship
invite-by-link (owner copies an invitation URL and sends it themselves) as an
interim: same tables, no email.

## 7 · Open questions to validate

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
