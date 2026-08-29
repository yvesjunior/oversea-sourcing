# ADR-002 — The transaction dossier & the contract centre

| | |
|---|---|
| **Status** | 🟡 **Proposed — awaiting owner validation** (drafted 2026-08-29) |
| **Baseline** | main @ `b9add64` · prod deploy #11 · tag `deploy-11-baseline` |
| **Source brief** | [doc/briefs/portail-entreprise.md](../briefs/portail-entreprise.md) (owner's `.docx`, 2026-08-29) |
| **Pretty version** | Claude artifact (diagrams, FR, design switch): <https://claude.ai/code/artifact/6bb88882-9f35-4a7c-b24d-c18c33b5e3f9> |
| **Implementation plan** | Phase P in [doc/BACKLOG.md](../BACKLOG.md) |
| **Retires** | **The entire E6 facilitation sketch and the E8 transaction sketch** — see "What this retires" below. Also the "facilitation last" priority (2026-08-26) and the E6 build gate (2026-08-23). |

## Context

OSI stops at `report_ready`. The buyer gets a ranked Top-N and a printable
report, and then the product ends — the facilitation that gives the company its
name has never been built (E6 has no tables; `/transactions` and `/documents`
render showcase constants from `src/data/osi.ts`).

The owner's brief asks for the rest of the cycle, and states the intent
plainly: *"donner l'impression qu'OSI orchestre la transaction complète, et non
seulement la recherche de fournisseurs."* Eleven tabs, of which
**Contrats is the declared development priority** — a contract centre with
multi-party signature, reminders, an immutable audit trail, versioning, and a
nine-step flow (§4) that turns an accepted quote into a live transaction.

**The brief brings its own process, and it is not the one the backlog held**
(owner, 2026-08-29). The old E6 design — buyer clicks *Engager* on a Top-N
supplier, an `engagement` row enters an ops queue, the buyer eventually sees
"connected" — does not appear anywhere in the brief and is **not what OSI
does**. The brief's process runs `demande → fournisseurs → **soumissions** →
acceptation → dossier de transaction → contrats → commande → livraison`.
This ADR is written from that process, not adapted to the old one.

Two standing decisions are reversed, deliberately:

- **"Foundation before facilitation — E6 is the LAST step before financial
  activities; do not propose starting it"** (owner, 2026-08-26). The foundation
  track has since closed (accounts, roles-as-data, journal, 2FA, verification
  battery all shipped through deploy #11). ADR-001 already named this loop the
  moat: *"the deal loop is the data-acquisition engine — every facilitation
  produces capability/pricing/responsiveness data that cannot be scraped."*
- **The E6 build gate** (*"do NOT implement until the facilitation flow is
  defined with the user"*, 2026-08-23). The brief's §4 **is** that definition.
  The gate is discharged by this ADR, not ignored.

**Weighting note (unchanged from ADR-001):** OSI is pre-launch — no customers on
dev or prod. There is no funnel to protect, no data to migrate, no backward
compatibility to honour.

## What this retires

| Retired | Why | Replaced by |
|---|---|---|
| `engagement` + `engagement_events` (E6) | Nothing in the brief's process corresponds to a buyer-initiated "engagement". Soliciting a supplier *is* asking for a quote. | `quote` rows (soumissions) |
| The **"Engager"** button on a Top-N supplier | The buyer does not engage a supplier; the buyer accepts an **offer**. Selection happens on the Soumissions tab, with something to compare. | "Demander une soumission" (staff-run) → accept on Soumissions |
| The **ops engagement queue** ("OSI is connecting you…") | "Connected" is not a destination the brief recognises. | The deal dossier — a state anyone can read at a glance |
| MVP1's definition of done — *"clicks Engager, OSI ops sees it in the queue, the buyer sees 'connected', downloads the PDF report"* | Ends one step after the report; the brief ends at a delivered order. | A signed contract and a tracked commande (restated in the backlog) |
| E8's standalone `transaction` sketch | Folded into the same spine rather than bolted beside it. | `deal` + `order_milestone` |

Nothing built is discarded — none of this was ever built. What is discarded is
a **plan**.

## Decision

### 1 · One dossier, three entities

Brief steps 1-2 (*"une soumission est acceptée … OSI crée automatiquement le
dossier de transaction"*) set the spine:

```mermaid
flowchart TB
    subgraph BUILT ["built today — ends at report_ready"]
        REQ["request"] --> MAT["match · Top-N"]
    end
    subgraph NEW ["Phase P — the transaction dossier"]
        MAT -->|"staff solicits"| Q["quote · soumission<br/>one per supplier asked"]
        Q -->|"buyer accepts ONE"| DEAL["deal · dossier de transaction"]
        DEAL --> CON["contract ×N<br/>parties · signatures"]
        DEAL --> ORD["order_milestone ×N<br/>production → livraison"]
        DEAL --> DOC["document ×N<br/>typed · versioned"]
        DEAL --> PAY["payment ×N<br/>tracked, never moved"]
        DEAL --> MSG["message_thread"]
        CON -->|"all mandatory signatures in"| ORD
    end
    Q -.->|"response time · MOQ<br/>lead time · price"| GRAPH[["supplier graph<br/>ADR-001 S6"]]
```

The entities and how they hang together:

```mermaid
erDiagram
    request   ||--o{ quote : "solicited from"
    supplier  ||--o{ quote : "answers"
    quote     ||--o| deal : "acceptance opens"
    deal      ||--o{ contract : has
    deal      ||--o{ order_milestone : tracks
    deal      ||--o{ payment : records
    deal      ||--o{ document : holds
    deal      ||--o{ deal_event : timeline
    contract  ||--o{ contract_party : "must be signed by"
    contract  ||--o{ contract_event : "immutable trail"
    contract  ||--o{ document : "annexes + signed PDF"
    document  }o--|| file : "bytes via storage.ts"
```

**A quote is the unit of facilitation.** Asking supplier X for an offer creates
a `quote` in `requested`; what comes back moves it to `received` with a price,
lead time, MOQ and terms; the buyer compares the received quotes side by side
(the Soumissions tab is a comparison surface, which is why several must exist)
and accepts one. Acceptance is the single event that creates the `deal`.

There is deliberately **no entity between the match and the quote.** The old
design put one there and it earned nothing: an engagement with no offer in it is
a status with no content.

**Quotes carry the moat.** Response time, MOQ, lead time and price per supplier
are exactly the unscrapable outcomes ADR-001's S6 promised to feed back onto the
supplier graph. They arrive as a by-product of the tab the brief asked for.

### 2 · External parties are RECORDS, never users

**Owner decision, 2026-08-29:** *"supplier does not have direct access to the
platform for now (we will include that later), platform staff handle the
interaction with them, maybe through the platform by email."*

Therefore `contract_party` (and `quote.supplier_id`) is a **row describing a
party**, not a membership: it points at a `supplier` or an `organization` when
we have one, and otherwise carries a bare name + email (a carrier we hold no
record of). Same tombstone pattern as `audit_log` — nullable references plus a
name/email snapshot, so the contract stays readable forever regardless of what
happens to the referenced row.

Consequences, all first-class:

- **No party accounts, no scoped guest sessions, no supplier login.** The
  `member` model and every tenancy guard stay exactly as they are.
- The portal has **exactly two audiences**: the buyer (own workspace) and OSI
  staff (internal workspace, via `effectivePlatformRole`). The brief's §6 rows
  for *Fournisseur* and *Sous-traitant* are recorded as **deferred, not
  dropped** — they land with the supplier-side space the README already parks
  behind `supplier_partner.claimed_by_user_id`.
- **Every external interaction is staff-mediated and outbound**: OSI sends, OSI
  records what came back. The platform's job is to make that legible and
  auditable, not to host the counterparty. A quote is *entered by staff*; a
  signature is *recorded by staff*.
- This does **not** weaken multi-party signature — see decision 3.

### 3 · E-signature: an adapter, and a manual provider that ships first

`src/server/esign.ts` becomes a vendor seam with the same rule as
`src/server/mail.ts`: **no domain code ever imports a vendor SDK.**

Two providers behind one interface:

- **`manual` — the v1 default, and the reason contracts are not blocked on a
  budget decision.** Staff sends the contract from the platform (through the
  existing mail adapter), the party signs however they sign, staff uploads the
  countersigned PDF and records the signature: who, when, what evidence. The
  platform tracks *signature state*; the paper is the paper. This is exactly how
  OSI operates today as a middleman, so v1 automates the record-keeping rather
  than imposing a new tool on counterparties.
- **`<vendor>` — later, behind gate G1.** Every e-sign vendor signs by emailed
  link with **no account on our side**, which is precisely why the owner's
  no-platform-access rule and real e-signature are compatible. When a vendor is
  chosen, the parties table and the status machine do not change: only the
  provider module and a webhook route.

### 4 · Signature evidence is permanent, and does not live in `audit_log`

`audit_log` is **purgeable** — `purgeAuditLogFn` deletes rows older than
`AUDIT_RETENTION_MONTHS = 3`. The brief requires an **immutable** trail for
signatures. These two cannot be the same store.

So: **signature evidence lives on the contract's own rows** (`contract_party`
and `contract_event`) as part of the contract record — never purged, never
FK-cascaded away. `audit_log` keeps recording the *operational* actions around
it (contract created, reminder sent, contract voided) as it does for everything
else. Two trails, two retention rules, on purpose.

### 5 · Required contracts are derived from the parties, never hand-picked

Brief step 3 (*"le système détermine les contrats requis selon les
intervenants"*). A deal with a carrier needs a carrier agreement; one with a
customs broker needs a brokerage mandate. That mapping is a **pure function of
which parties the deal has** (`src/lib/contract-types.ts`, the taxonomy pattern
from S1: a typed module, not a table, until staff need to edit it). Staff can
add a contract the mapping did not predict; staff cannot *silently miss* one the
mapping requires.

### 6 · Documents: one typed table, replacing the showcase constants

A single `document` row — kind (facture · certificat · douane · inspection ·
packing list · B/L · contrat signé · annexe), the deal and/or contract it hangs
from, a `file_id`, an issuer, a version. It absorbs the open E7 item (*"server-
rendered PDF stored as a `documents` row"*) and finally kills the dead constants
in `src/data/osi.ts`.

### 7 · Money is tracked, never moved

Unchanged from the README: payments are **track-only**, escrow deferred, no PSP.
The Paiements tab is a ledger view — dépôts, soldes, factures, frais OSI, état —
and `payment` rows are staff-entered records of things that happened elsewhere.
The brief agrees (§9 defers "paiements avancés").

### 8 · Status machines follow the pattern that already works

Every new entity gets guarded transitions in `src/lib/*-status.ts` (illegal ones
throw, as `request-status.ts` does), and every change writes an event row.
Timelines, the dashboard and the contract history stay **pure read-models of the
database** — the property that makes the request loop debuggable, kept.

The contract machine, which carries the brief's §3.1 filters (Tous · Actifs ·
À signer · En attente · Complétés · Expirés) as derived views, not as columns:

```mermaid
stateDiagram-v2
    [*] --> draft: staff creates<br/>(type derived from parties)
    draft --> sent: sent to parties<br/>(mail adapter)
    sent --> partially_signed: first signature recorded
    partially_signed --> partially_signed: n of m
    sent --> signed: all mandatory in
    partially_signed --> signed: all mandatory in
    signed --> [*]: unlocks the next<br/>operational step
    draft --> voided
    sent --> voided
    partially_signed --> voided
    sent --> expired: échéance passed
    partially_signed --> expired: échéance passed
```

`À signer` = mandatory party still pending. `Expirés` is read-time from the
échéance, no cron — the same trick the Recommandé tier uses.

### 9 · Staff powers stay data

New permission keys join the `platform_permission` matrix (`deals`,
`contracts`, plus fine-grained `contracts.send`, `contracts.sign`,
`contracts.void`), defaulting to the owner/manager split. Nothing hardcodes a
staff capability; the owner keeps toggling access live from **Rôles & accès**.

### 10 · Two designs, switchable by the user (owner, 2026-08-29)

**Owner decision:** *"we will have two designs — we keep the original and the
second one in this new doc; the user can switch among them."*

These are genuinely two designs, not a repaint. Verified in the code:

- **Design "clair" (original, today's default):** `:root` in `src/styles.css`
  is a **light** palette (`--background: oklch(0.985 0.002 250)`) with the gold
  accent `oklch(0.72 0.11 85)`.
- **Design "sombre" (the brief's §8):** noir/anthracite — `#111111` ground,
  `#1E1E1E` / `#202020` surfaces, `#E6E6E6` text, gold `#D4AF37` / `#C89C18`.

**The machinery already exists and is unreachable.** `src/styles.css` defines a
complete `.dark` block (line 117) redefining every neutral — and **nothing in
the app ever applies that class.** Shipping design 2 is therefore: retune the
existing `.dark` values to the brief's exact hexes, and wire a control to the
class. It is not a parallel stylesheet, and it must never become one.

**Two orthogonal axes, kept orthogonal:**

| Axis | What it swaps | Where it lives |
|---|---|---|
| **Design** (clair · sombre) | the neutral ramp — background, surfaces, text, borders | the `.dark` class on the root |
| **Accent** (5 palettes, exists) | `--gold` + `--gold-soft`, everything else derived by `color-mix` | `user.theme_color`, `src/lib/themes.ts` |

A user picks one of each; the five accents must read on **both** grounds
(today they were only ever checked against the light one — an audit is part of
the task). Persistence follows the `theme_color` precedent exactly: a `user`
column, applied by the root shell from the session, saved through
`updateProfileFn` (which already purges the cached session).

### 11 · Home IS the dashboard; the form moves to Demandes (owner, 2026-08-29)

**Owner decisions:** *"we are adding a dashboard page, actual home will be
renamed"* · *"move the search group component to the request page"* ·
*"define Home as Dashboard"*.

`/` today does five jobs: the SEO landing (it owns the `head()` meta and og
tags), the request form, the buyer dashboard, the staff Vue globale / Mes
données switcher, and the value-props footer. The resolution keeps the route
and moves the *form* out — not the page:

| Route | Anonymous | Signed in |
|---|---|---|
| `/` — **Tableau de bord** | landing: hero + form + « Nos engagements », SEO meta kept | the dashboard, enriched toward the brief's mockup |
| `/demandes` | — (auth) | **the form in the header**, then the dossier list |

- **No new route, no redirect, `PUBLIC_PATHS` unchanged.** The nav label
  `nav.accueil` becomes `nav.tableauDeBord`; the route stays `/`.
- **The form (`HeroPrompt`) renders in two places**: `/` for anonymous
  visitors — that is the conversion mechanic, not decoration — and `/demandes`
  for signed-in work. One component, two mounts. It matches the brief's own
  description of the tab: *« Création et suivi des demandes »*.
- On `/demandes` the form is **collapsed under a « Nouvelle demande » header**,
  auto-expanded when the buyer has no dossier yet, so seven fields never push
  the list below the fold.
- Anonymous visitors stop seeing a **stats grid full of zeros** — today `/`
  renders "0 demandes actives" to every prospect.

> ⚠️ **The trap, and it is silent.** The auth-gate draft resume lives INSIDE
> `HeroPrompt` (it reads `osi-draft-besoin-v2` on mount and auto-creates the
> request). Once the signed-in `/` stops rendering the form, **a draft typed
> before signup would never be created** — the funnel breaks with no error.
> Fix it in the same change: either lift the resume effect out of `HeroPrompt`
> so `/` runs it whether or not it shows the form, or land post-login on
> `/demandes` when a draft exists. Do not ship the move without this.

### 12 · The merged navigation (validated 2026-08-29)

**Client — 11 entries.** Renamed and new marked; nothing from today is lost.

| # | Label | Route | Icon | State |
|---|---|---|---|---|
| 1 | **Tableau de bord** | `/` | `LayoutDashboard` | renamed from Accueil, same route |
| 2 | Demandes | `/demandes` | `Inbox` | now carries the form |
| 3 | Fournisseurs | `/fournisseurs` | `Users` | unchanged |
| 4 | **Soumissions** | `/soumissions` | `ClipboardList` | new · P2 |
| 5 | **Contrats** | `/contrats` | `FileSignature` | new · P4 (the priority) |
| 6 | **Commandes** | `/commandes` | `Package` | ex-Transactions · P7 |
| 7 | Documents | `/documents` | `FileText` | shell → P8 |
| 8 | **Paiements** | `/paiements` | `Banknote` | new · P9 |
| 9 | **Messages** | `/messages` | `MessageSquare` | new · P10 |
| 10 | **Rapports** | `/rapports` | `BarChart3` | new, BUYER-facing · P11 |
| 11 | Paramètres | `/parametres` | `Settings` | unchanged |

**Interne — 9 entries** (permission-gated, unchanged except one move):
Facilitation (becomes the quote/deal ops queue) · Vérification fournisseurs ·
Clients · **Analyses** · Finance · Abonnements · Utilisateurs · Logging ·
Sources de données.

**`Analyses` moves from the client block into Interne.** It is already
staff-only (`feature: "analytics"` in `AppSidebar.tsx`) and merely *sits* in
the buyer list today — a misplacement the merge exposes. It is NOT renamed to
Rapports: those are two different surfaces for two different audiences, and
both survive.

Icons avoid collisions inside one sidebar: `Wallet` and `CreditCard` are taken
by Finance and Abonnements, hence `Banknote` for Paiements.

**15 entries today → 20.** Every new tab renders **disabled-not-hidden** from
P0 and lights up when its module lands, so the buyer sees the whole journey
without any tab lying about being ready.

## Options considered — external party access

**Option A — scoped party accounts** (each counterparty signs up, sees only
their transactions). Strongest identity assurance on a signature, and the
ground floor of the supplier-side space. Rejected by the owner for v1: it is a
second product (onboarding, support, abuse surface) before the first one has
customers.

**Option B — link-based capability access** (emailed link, no account, view and
sign). Light, and the `/invitation/$id` pattern already exists. Not selected:
it still puts counterparties on our surface, and a self-hosted signing page has
weaker evidentiary standing than either a real e-sign vendor or a signed PDF on
file.

**Option C — no external access at all, staff-mediated (SELECTED).** OSI is the
middleman; the platform is OSI's and the buyer's instrument for running that.
Cheapest to build, matches how the business actually operates today, and
forecloses nothing — A and B both remain reachable later, since parties are
already modelled as rows that a `claimed_by_user_id` can point at.

## Implementation plan (= Phase P in the backlog)

**Start, in dependency order:** P1 schema spine · P2 soumissions (request a
quote, record what came back) · P3 comparison + acceptance → deal · P4 contract
centre (list, fiche, parties) · P5 templates & pre-fill · P6 signature tracking,
reminders, `esign.ts` + manual provider · P7 commandes & milestones · P8
documents module · P9 paiements ledger · P10 messages · P11 rapports.

**Gates:** G1 e-sign vendor choice (budget) · G2 supplier-side access
(owner-deferred).

## Conflicts with decisions already made

Every point where the brief contradicts something recorded or built. Nothing
here is resolved unilaterally — the ones marked ❓ need the owner.

| # | The brief says | It contradicts | Resolution |
|---|---|---|---|
| 1 | Contrats is the development priority | *"Foundation before facilitation — E6 is the LAST step; do not propose starting it"* (owner, 2026-08-26) | ✅ Reversed by the brief itself; foundation track has closed |
| 2 | §4 defines the facilitation flow | The E6 build gate, *"do NOT implement until the flow is defined with the user"* (2026-08-23) | ✅ Gate discharged — the brief IS the definition |
| 3 | Process runs soumission → acceptation → dossier | The E6 task list (Engager → engagement → ops queue → "connected") and E8's standalone transaction | ✅ Retired — see "What this retires" (owner, 2026-08-29) |
| 4 | §6 grants **Fournisseur** and **Sous-traitant** portal access | The owner's own later instruction (2026-08-29): suppliers have **no** platform access; staff mediate | ✅ Owner's instruction wins — §6's last two rows are out of scope v1 (gate G2). *Do not build from §6.* |
| 5 | §7 *"piste d'audit immuable"* | `audit_log` is **purgeable at 3 months** (`AUDIT_RETENTION_MONTHS`, owner: *"we can delete a log older than 3 month"*) | ✅ Two trails: signature evidence lives on contract rows (permanent), audit_log keeps operational actions (purgeable). Decision 4 |
| 6 | §7 API de signature électronique | No paid vendor exists in the stack; the owner's hard constraint bans paid **data** providers — e-sign is not one, but it is the **first recurring bill** | ❓ Gate G1. The `manual` provider ships v1 so the module is not blocked either way |
| 7 | §7 *"politique de rétention"* for documents | No retention policy exists, and `storage.deleteFile` **is never called on user files** (known debt) — deleting a request drops its `file` rows and leaves the bytes | ❓ Needs a policy before legal documents land |
| 8 | Contracts, signed PDFs, B/L scans stored in the portal | **`scripts/backup.sh` dumps Postgres only. The `osi-uploads` volume is not backed up anywhere.** Today that risks re-uploadable spec sheets; with signed contracts it risks the legal record | ❗ **Must fix before P8.** Not a design question — a gap |
| 9 | Dashboard KPI *"Économies totales — 348 750 $"* | Nothing in the data model can compute a saving: there is no baseline price to compare against | ❓ Either capture a buyer-stated target/market price on the request, or drop the tile. The repo's honesty rule (numeric criteria are `unverifiable`, not misses) applies |
| 10 | Visual notes *"Next.js"*, *"AWS S3"* | The app is TanStack Start; storage is a local volume behind an S3-shaped adapter, and *"no cloud provider"* is a recorded infra decision | ✅ Graphic-designer notes, not requirements — ignored |
| 11 | Eleven tabs for every client | Plans gate `requests_per_day` / `suppliers_returned` only; a Free trial (1/day, 2 lifetime) would reach contracts and payments | ❓ Does the deal layer become a plan dimension, or is it open to everyone with a deal? Affects E12 |
| 12 | Notifications for signatures, reminders, milestones | The E9 registry holds exactly **two** types (`report_ready`, `invitation_accepted`) | ✅ Extension, not conflict — each new type is one registry entry + prefs row |
| 14 | §8 *"conserver l'identité actuelle d'OSI"* — a **dark** anthracite palette | The app's actual default is **light** (`:root` in `styles.css`); the brief describes a design the app does not currently render | ✅ Resolved as **two designs, user-switchable** (decision 10). The `.dark` block already exists in the stylesheet and is never applied — wiring it is the task |
| 15 | Tableau de bord as its own tab | `/` currently *is* the dashboard for signed-in users, and the public hero for anonymous ones | ✅ Split: new dashboard route, home renamed (decision 11). ❓ **What the home is renamed to is unanswered** |
| 13 | Rapports: *"performance fournisseur"* | Requires quote/deal outcomes that do not exist yet | ✅ Arrives free once quotes accumulate (ADR-001 S6) — it is a late phase, not a v1 tile |

**Not in conflict, and worth knowing:** the palette (`#D4AF37`/`#111111`/
`#1E1E1E`) already matches `src/lib/themes.ts`; multi-tenant isolation, RBAC as
data, the audit journal, notifications and the responsive shell all exist. The
brief's §7 "exigences techniques" is largely a description of what deploy #11
already does.

**One priority question the brief does not answer:** pick-up item ⓪, the search
relevance gate. The Top-N feeding these quotes is currently unreliable (a
verified supplier scores ~41 % with zero criteria matched, and can store-hit any
request). Orchestrating a transaction on top of that orchestrates the wrong
deal. It is a small fix and it is not part of Phase P — but it should land
before, or alongside, P2.

## Consequences

- **E6 and E8 stop existing as designed.** The epics survive as names for the
  work; their task lists are replaced by Phase P.
- MVP1's definition of done is restated: *a buyer submits a need, gets a Top-N,
  OSI solicits quotes, the buyer accepts one, the contracts are signed, and the
  commande is tracked to delivery.*
- The buyer nav roughly doubles. The disabled-not-hidden rule means every new
  tab renders greyed until it has data behind it, so the shell can land ahead of
  the modules without lying about what works.
- **Cost shape barely moves.** None of this calls Claude; the spend stays in
  research. The one recurring bill would be an e-sign vendor, which G1 defers
  and the manual provider makes optional.
- Pick-up item ⓪ (the search relevance gate) is **not** superseded. A portal
  that orchestrates a transaction built on an irrelevant Top-5 orchestrates the
  wrong deal — the fix stays a prerequisite for real buyers, whatever order it
  is built in.
- **ADR-001's S6 lands for free.** Quote outcomes are the feedback loop; the
  supplier graph starts accumulating what cannot be scraped from the first
  soumission recorded.

## Open questions

1. **Who solicits the quotes?** The brief implies OSI does. Does the buyer pick
   which of the Top-N to solicit, or does OSI choose on their behalf?
2. **Which contract types ship in v1?** The brief lists seven (§5). The mandate
   OSI↔client and the buyer↔supplier order are unavoidable; carrier, customs,
   inspection, NDA and annexes could follow.
3. **Who signs on OSI's behalf** — the platform owner alone, or any `manager`?
   (Sets the default for the `contracts.sign` key.)
4. **E-sign vendor + budget** (G1) — a vendor, or stay manual indefinitely.
5. **Contract numbering** — the brief shows `OSI-2026-0042`. Confirm per-year
   sequential and platform-global (a `contract_id_seq`, like `request_id_seq`).
6. **What is the current home renamed to?** It keeps the public hero and the
   request form — "Nouvelle demande" is the honest label, but it is your call.
7. **Is the design choice per user or per workspace?** Per user matches
   `theme_color` and is the cheaper answer; per workspace would let a client
   company standardise its own look.
8. **Currency** — the brief shows CAD with an Incoterm. Simplest v1 is
   store-the-currency and never convert; multi-currency dashboard totals would
   need a rate source.
