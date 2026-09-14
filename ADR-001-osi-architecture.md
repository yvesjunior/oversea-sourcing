# ADR-001 — The OSI architecture: demand-pull sourcing and the transaction spine

| | |
|---|---|
| **Status** | ✅ **Accepted and largely built** — consolidated 2026-09-07 |
| **Consolidates** | the former **ADR-001** (Supplier Provisioning Strategy, accepted 2026-08-26) and **ADR-002** (The transaction dossier & contract centre, accepted 2026-08-29), which this file replaces |
| **Baseline** | main @ `bcbd99d` · prod deploy #38 (consolidated at `615d7e0` / #30; re-checked against the code 2026-09-13) |
| **Source brief** | [doc/briefs/portail-entreprise.md](doc/briefs/portail-entreprise.md) (owner's `.docx`, 2026-08-29) |
| **Implementation plan** | Phase S and Phase P in [doc/BACKLOG.md](doc/BACKLOG.md) |
| **Pretty version** | Claude artifact, diagrams + build state: <https://claude.ai/code/artifact/a537df29-e576-4725-b8de-661efd1d1438> — **the only published page**; its source is [`/osi-decision-record.html`](osi-decision-record.html) at the repo root (edit there, republish to the same URL). The three companion artifacts it absorbed (parcours swimlane, 2026-08-22 architecture review, 2026-08-17 pipeline teardown) are archived verbatim in [doc/archive/](doc/archive/README.md) as of 2026-09-13 |

> **Reading the cross-references.** ~90 code comments and backlog lines cite
> `ADR-001 §4`, `ADR-001 S6`, `ADR-002 §5`, `ADR-002 conflict #9` and the like.
> Those anchors are **preserved**: `ADR-001 §N` / `S-N` is **Part I** below,
> `ADR-002 §N` is **Part II**. Nothing needs rewriting to stay true.
>
> **What consolidation dropped**, and why it is safe: the rejected options
> (registry supply-push; scoped party accounts), the *"What this retires"*
> table (E6/E8 were plans, never code, and are long gone), the conflicts table
> (13 of 15 rows resolved — the two live ones are Open questions 1 and 2
> below), and every question since answered. The two original files remain in
> git history at `8dd740d` if the reasoning behind a rejected option is ever
> wanted. **ADRs are conventionally immutable and superseded rather than
> merged** — this merge is deliberate, on the owner's instruction, and trades
> that convention for one current document.

## Context

OSI is a **facilitated marketplace** for industrial sourcing: a buyer describes
a need, the platform finds and ranks compatible manufacturers, and OSI
facilitates the resulting deal end to end. Two questions shape the whole system,
and this record answers both:

1. **Where supplier data comes from, and when money is spent on it** (Part I).
2. **What happens after the report — the transaction OSI actually facilitates**
   (Part II).

**Weighting note, still true:** OSI is **pre-launch** — testers only, no
customers on dev or prod. There is no funnel to protect, no data to migrate and
no backward compatibility to honour. Cost shape weighs *more*: pre-revenue is
exactly when spend must be demand-justified.

---

# Part 0 — The runtime everything else sits on

*(folded in 2026-09-07 from the former "OSI Platform Architecture" and "OSI
Request Pipeline" artifacts, corrected against the running system)*

A **modular monolith with physical seams**: one codebase, one image, six
services on a single VM behind a Cloudflare Tunnel. Every module sits behind an
interface that could become a network boundary — extraction would be a deploy
change, not a refactor.

| Service | Job |
|---|---|
| `web` | Nitro SSR + server functions + `/api/*`. Enqueues; never consumes. |
| `worker` | The `pipeline` queue: orchestration, matching, and the recovery sweep. |
| `worker-research` | The `research` queue only: collection and verification — all outbound network. |
| `database` | Postgres 16 + pgvector. Application state **and** the pg-boss queues. |
| `redis` | Rate-limit counters only, and **fail-open**: if it is down, requests are allowed. |
| `migrate` | One-shot, runs to completion before the others start. |

**Containers never call each other. Postgres is the only meeting point** —
rows in, jobs out — which is what makes each one independently replaceable and
replicable. The same `src/server/` core runs inside `web` and inside both
workers as ordinary in-process function calls; core is a *layer*, not a
process.

**Two queues, split on purpose:** `pipeline` is fast orchestration, `research`
is slow and expensive. A research burst can never starve status transitions,
and replicas of `worker-research` are the scaling knob for the one hotspot.

**The pipeline is resume-capable, and that is load-bearing.** It reads a
request's current status and picks up wherever it rests, so a re-run is safe.
On boot and every 60 s, the sweep re-enqueues anything sitting in `received`,
`searching` or `validating` untouched for two minutes — a worker crash, a lost
job or a container restart mid-flight all self-heal. (`analyzing` is
deliberately excluded: it is the legacy pause state, and those dossiers wait
for a manual launch.)

**Every transition writes an event row**, and the timelines, the activity feed
and the dashboard are pure reads of those tables. Nothing recomputes state to
display it.

**No broker, deliberately.** pg-boss gives transactional enqueue for free — a
request and its job commit together — which RabbitMQ would only match through
an outbox pattern, i.e. a queue in Postgres anyway. `pg_dump` snapshots state
and in-flight jobs together. All enqueues go through one `queue.ts` seam, so
swapping it later is an adapter, not a refactor. The bottleneck is the Claude
API's concurrency, never the queue.

---

# Part I — The demand-pull supplier graph

*(cited elsewhere as `ADR-001 §…` / `S1`–`S6`)*

Two operating principles:

1. **Demand-pull, not supply-push** — nothing is spent on a supplier until a
   real request needs them; spend grows as a candidate approaches presentation.
2. **The deal loop is the data-acquisition engine** — every facilitation
   produces capability, pricing and responsiveness data that cannot be scraped.
   That is the moat; everything scraped is bootstrap.

The flow, as built:

```
REQUEST (structured form → taxonomy node)
  → RETRIEVE from the supplier graph (store-first coverage check)
  → coverage insufficient?
      DISCOVER via global_web (Claude + web_search) — free sources only
  → VERIFY each presented candidate (battery, §4)
  → PRESENT Top-N (trust tier + evidence)
  → FACILITATE (Part II)
  → outcomes (response time · MOQ · lead time · price · satisfaction)
    feed the graph back  ← S6, the moat
```

**Supplier graph** = the `supplier` table as node plus dated, sourced edges:
source records, verification evidence, quotes, deals. Plain Postgres — "graph"
is the shape, not the engine. The lifecycle `lead → profiled → verified →
engaged` is **derived** from which edges a node has, never set by hand.

### §1 · No paid data providers, ever

**Owner, 2026-08-26 — a hard constraint on every future design.** No paid
subscription to any data provider, now or later; no design may align with one.

The customs/BoL investigation (README §9) found no free route, so **customs data
is closed**: the `export_record` check is dormant, and tier-2 capability
evidence must come from certifications and the deal loop instead. New connectors
are added only for genuinely free licensed sources.

### §2 · Sources have a ROLE: discovery or verification

An axis orthogonal to dynamic/static, and the decision that makes registries pay
for themselves without enrichment:

- **Discovery** sources (today: `global_web` alone) are workspace-selectable in
  Préférences de sourcing and are the **only** sources that enter matching.
- **Verification** sources (**all registries**) are platform infrastructure:
  never in workspace settings, never fed into matching. Buyers meet them only as
  evidence lines on a supplier profile — *"Existence vérifiée — Registre du
  Québec, actif, consulté 2026-08"*.

Enforced in `src/server/sources/scope.ts`, which resolves only
`role = 'discovery'` sources. A supplier known **only** through a verification
record is invisible to matching until a discovery source or the deal loop
evidences it.

Registry stores are kept as local lookup tables, refreshed by full pull roughly
**every six months per source**, with staff upload for the file-fed ones.
Coverage expands on demand: when discovery surfaces candidates from an uncovered
country, that triggers adding its registry. Where no registry route exists
(China), tiering falls back to facilitation-time documents.

### §3 · Enrichment is lazy, and store-sized batches do not exist

Nothing is enriched ahead of demand. The ~$12k store-scale enrichment gate that
sank the old strategy dissolves because registry records never need enrichment —
they are verification evidence, not candidates.

### §4 · The verification battery, and the derived trust tier

Six checks were specified, each writing an evidence row (type, source, result,
URL, checked_at). **Three run automatically today** (`AUTO_CHECKS` in
`src/lib/verification.ts`); the rest are dormant or manual, and honestly so:

| # | Check | State |
|---|---|---|
| ① | **Legal existence** — local registry store, live API where one exists | ✅ automated (TTL 180 d) |
| ② | **Digital identity** — site/TLS/domain age/MX/name coherence | ✅ automated (TTL 30 d) |
| ③ | **Sanctions** — OFAC/EU/UN + local lists; a hit **blocks presentation** | ✅ automated (TTL 7 d) |
| ④ | **Export track record** — customs/BoL | ⛔ dormant — no free route (§1) |
| ⑤ | **Certifications** — free cert-registry routes | ❌ not built |
| ⑥ | **Human review** — a staff decision | ✅ staff action (TTL 5 y) |

**The tier is DERIVED from evidence rows, never set** (`deriveTier`):
0 unverified → 1 existence verified (the floor for a Top-N) → 2 capability
evidenced → 3 Vérifié OSI. A sanctions hit dominates everything: the candidate
is flagged, not tiered. `supplier.verification_status` is a projection of the
tier, not an input.

**AI-found suppliers are capped at confidence 70** (`AI_CONFIDENCE_CEILING`), so
a confident-sounding model can never outrank an OSI-verified company.

### §5 · Intake is structured, and the pool is bilingual

The structured request form is the primary intake: category (required, from the
taxonomy), product, material, certifications, quantity, lead time, free-text
details. Typed fields become criteria rows directly with `source: "user"` —
nothing guessed.

The taxonomy (`src/lib/taxonomy.ts`) is one canonical in-house tree mapped
behind the scenes to HS headings — **a typed module, not a table**, because it
is code-adjacent data that evolves by commit. Node ids are stable and are
persisted on requests. *(This closes the old open question "HS, NAICS or
in-house?" — in-house, mapped.)*

**Search runs English-first and the pool stores both languages.** Most of the
manufacturing web is in English; criteria carry a `value_en` and suppliers a
`description_en`, so a French request reaches English text and a later English
buyer finds the supplier a French request discovered.

### §6 · The deal loop feeds the graph — the moat

Response time, MOQ, lead time, price and the buyer's satisfaction score are
exactly the outcomes nobody can scrape. They arrive as a by-product of Part II,
not as a separate project.

Two fields protect that data at the source (2026-09-12, migration 0040):
response time is measured from **`sent_at`** — when staff actually emailed the
supplier — and falls back to `requested_at` only when nobody stamped it, so
OSI's own lag is not published as a slow supplier; and `decline_reason`
separates `no_response` (the strongest negative signal the platform owns) from
`supplier_declined` and `lost` (the buyer picked someone else, which says
nothing about the supplier).

---

# Part II — The transaction dossier and the contract centre

*(cited elsewhere as `ADR-002 §…`)*

OSI used to stop at `report_ready`. The owner's brief asks for the rest of the
cycle and states the intent plainly: *"donner l'impression qu'OSI orchestre la
transaction complète, et non seulement la recherche de fournisseurs."*

The process is `demande → fournisseurs → soumissions → acceptation → dossier de
transaction → contrats → commande → livraison`.

### §1 · One dossier, three entities

```
request → match (Top-N)
        → quote      (soumission — one per supplier asked)
        → deal       (dossier de transaction — opened by ONE acceptance)
            ├── contract ×N   (parties · signatures)
            ├── order_milestone ×N   (production → livraison)   [not built]
            ├── document ×N   (typed · versioned)               [not built]
            ├── payment ×N    (tracked, never moved)            [not built]
            └── message_thread                                  [not built]
```

**A quote is the unit of facilitation.** Asking supplier X creates a `quote` in
`requested`; what comes back moves it to `received` with price, lead time, MOQ
and terms; the buyer compares and accepts **one**, and that acceptance is the
single event that creates the `deal`.

There is deliberately **no entity between the match and the quote**. An
engagement with no offer in it is a status with no content.

**The buyer picks who is approached** (owner, 2026-08-29) — they select from
their Top-N and ask OSI to solicit. Nothing is ever solicited automatically.

**No splitting** (*"pas de répartitions"*): one accepted offer, one dossier.
Enforced by a partial unique index (`quote_one_accepted_per_request_uq`), not by
an application check — two acceptances arriving together would both pass the
latter.

### §2 · External parties are RECORDS, never users

**Owner, 2026-08-29:** suppliers have no platform access for now; staff handle
the interaction with them.

So `contract_party` (and `quote.supplier_id`) is a **row describing a party**,
not a membership: it points at a `supplier` or an `organization` when we have
one, and otherwise carries a bare name + email. Same tombstone pattern as
`audit_log` — nullable references plus a name snapshot, so the record stays
readable forever regardless of what happens to the row it referenced.

Consequences, all first-class:

- **No party accounts, no guest sessions, no supplier login.** The `member`
  model and every tenancy guard stay exactly as they are.
- The portal has **exactly two audiences**: the buyer (own workspace) and OSI
  staff (internal workspace, via `effectivePlatformRole`).
- **Every external interaction is staff-mediated and outbound**: OSI sends, OSI
  records what came back. A quote is *entered by staff*; an external signature
  is *recorded by staff*.

### §3 · Two signature mechanisms, split by who the party IS

| Party | Mechanism | Evidence |
|---|---|---|
| **Buyer · OSI** (they hold accounts) | **signed in the platform** — no vendor, no email round trip | user id + name snapshot, when, IP, user agent |
| **Supplier · carrier · broker · inspector** (no account) | **manual upload** — staff send it, receive it signed, upload the countersigned PDF | who signed as stated, when, the document, and which staff member recorded it |

The mechanism follows the party's **role**, not a setting and not
`contract_party.user_id` (which is null at draft time). Both paths write the
same `contract_party` row and the same `contract_event` trail, so the N/M
indicator and the "all mandatory signatures in" transition do not care which
produced a signature.

The in-platform signature is the **stronger** of the two by construction — an
authenticated session, not a claim in an email — and it covers the two parties
that matter most.

**No e-signature vendor** (owner, 2026-08-29). `src/server/esign.ts` is the
seam for the external path only; its one provider is `manual`. The **intended
successor is a private signing link** — our own capability URL, emailed to a
party with no account (the `/invitation/$id` pattern already does this) — kept
for later, **optional and additive**: some counterparties will always return a
signed PDF by post, and a link that replaced upload would strand them. Still not
a vendor, so no recurring bill appears.

### §4 · Signature evidence is permanent; `audit_log` is not

`audit_log` is **purged at `AUDIT_RETENTION_MONTHS = 3`**. Signature evidence
must be immutable. These cannot be the same store.

Signature evidence therefore lives on the contract's own rows
(`contract_party`, `contract_event`) — never purged, never FK-cascaded away.
`audit_log` keeps recording the *operational* actions around it. **Two trails,
two retention rules, on purpose.**

"Never FK-cascaded away" became true against workspace deletion only on
2026-09-12 (migration 0043): a workspace that carries a **contract or a deal is
archived, never erased** — `organization.archived_at`, every route redirects to
`/recuperation`, the owner restores it by signing in, and the archive is kept
six years (`ARCHIVE_RETENTION_YEARS`; nothing purges it yet). A workspace with
no financial trace is still destroyed outright. No foreign key changed.

### §5 · Required contracts are derived from the parties

A deal with a carrier needs a carrier agreement; one with a customs broker needs
a brokerage mandate. That mapping is a **pure function of which parties the deal
has** (`src/lib/contract-types.ts`, a typed module like the taxonomy). Staff can
add a contract the mapping did not predict; staff cannot *silently miss* one it
requires.

**v1 ships the two unavoidable types** — mandat OSI↔client and the
buyer↔supplier order. Transporteur, courtier, inspection, NDA and annexes follow
once the machinery is proven.

**Contract text is frozen at draft time** and rendered in the request's
language, not the reader's — a contract is a record of what the parties saw.
Numbering is `OSI-2026-0000`, per-year sequential and platform-global
(`contract_number_seq`).

### §6 · Documents: one typed table *(first slice built 2026-09-12 — P8)*

A single `document` row — kind, what it hangs from, a `file_id`, an issuer, a
version — absorbing the open E7 item (the stored PDF report).

**What exists** (migrations 0041–0042): the `document` table over `file`, kind
`offer | other`, hanging from a **quote and/or request** (both SET NULL, so a
document outlives its source); staff attach a supplier's PDF/PNG/JPG to an
offer through `/api/quote-document`; `/documents` lists them naming and
linking both sources; and an orphan is purged **36 months** after losing both
references — the first time `storage.deleteFile` has ever run on a user file.
**Ownership follows the paperwork, not the uploader**: staff upload, the rows
belong to the buyer's workspace.

**Still open:** documents hanging from a deal or a contract (the
countersigned-contract upload still writes a `file` row directly), the fuller
kind vocabulary (facture, douane, B/L… — each lands with the phase that
produces it), versions, and the stored PDF report.

### §7 · Money is tracked, never moved

Payments are track-only: no PSP, no escrow. `payment` rows will be staff-entered
records of things that happened elsewhere. *(Not built — P9.)*

### §8 · Status machines and derived views

Every entity gets guarded transitions in `src/lib/*-status.ts` — **an illegal
transition throws** rather than writing a state the machine forbids — and every
change writes an event row. Timelines and dashboards stay **pure read-models**.

The contract filters (Tous · Actifs · À signer · En attente · Complétés ·
Expirés) are **derived views, never columns**. `Expirés` is computed at read
time from the échéance — no cron.

### §9 · Staff powers are data, including who may sign

`contracts.sign` is a permission key in the `platform_permission` matrix,
owner-assigned per role from **Rôles & accès**. Custom staff roles beyond
`manager`/`accountant` are built (Phase R): roles are rows, the matrix is
dynamic.

**The owner is never a row, and role granting stays owner-only, forever** — or
the matrix could lock out its own editor.

---

# The parcours — 16 steps, and where it actually stops

*(folded in 2026-09-07 from the former "Parcours OSI" artifact, re-checked
against the code — the original claimed the product stopped at step 4. Its
three-lane swimlane, acheteur · OSI · tiers, was redrawn into the published
record on 2026-09-13 with today's build state; the French original is
archived at [doc/archive/2026-08-29-parcours-swimlane.html](doc/archive/2026-08-29-parcours-swimlane.html).)*

The owner-validated journey, with **who acts** at each step. The two steps that
leave the platform are the whole of decision Part II §2 made concrete: a
supplier is reached by email and answers by email, and nothing else about them
touches the product.

| # | Step | Who acts | State |
|---|---|---|---|
| 01 | Describes the need | Buyer | ✅ built |
| 02 | Search — pool first, web only if thin | Platform | ✅ built |
| 03 | Verification of each candidate | Platform | ✅ built (3 of 6 checks) |
| 04 | Top-N + printable report | Buyer receives | ✅ built |
| 05 | **Picks who to solicit** | Buyer — *decision* | ✅ built |
| 06 | Sends the quote requests | OSI staff | ⚠️ the ask is recorded and staff are alerted; **the email goes out by hand** |
| 07 | Answers with price, MOQ, lead time | **Supplier — off platform** | by design; no account exists |
| 08 | Records each offer | OSI staff | ✅ built |
| 09 | **Compares and accepts ONE** | Buyer — *decision* | ✅ built |
| 10 | Dossier opens automatically | Platform | ✅ built |
| 11 | Required contracts drafted | OSI staff | ✅ built |
| 12 | **Signs** | Buyer + OSI in-platform; **supplier off platform** | ✅ built |
| 13 | All mandatory signatures in | Platform | ✅ built |
| 14 | Tracks the order to delivery | OSI staff | ❌ **not built** |
| 15 | **Validates reception and rates** | Buyer — *decision* | ❌ **not built** |
| 16 | Closes the dossier | OSI staff | ❌ **not built** |

**Where it actually stops, precisely.** The `deal` table already carries
`satisfaction`, `reviewed_at`, `reviewed_by`, `review_comment`, `closed_at` and
`closed_by`, and `DEAL_TRANSITIONS` enforces the full ladder
`open → contracting → in_production → shipping → delivered → reviewed →
closed`. But **`transitionDeal` has exactly one caller**: sending a contract
moves the dossier `open → contracting` (`signature-fns.ts`). Nothing moves it
after that.

So a dossier today opens, advances one step when its first contract goes out,
and then cannot progress — not because the machine is missing, but because no
surface drives it. That is the honest shape of steps 14-16, and it is why P7
(commandes) is the next real piece of work rather than a late polish.

# Standing constraints

The rules that bind every future design. Breaking one needs the owner, not a
pull request.

| Constraint | Source |
|---|---|
| **No paid data-provider subscription, ever** | owner, 2026-08-26 · Part I §1 |
| **No e-signature vendor** (gate G1) | owner, 2026-08-29 · Part II §3 |
| **No cloud provider** — prod is a local VM behind Cloudflare Tunnel, at every scale stage | owner, 2026-08-04 |
| **Suppliers have no platform access**; staff mediate every external interaction (gate G2) | owner, 2026-08-29 · Part II §2 |
| **Money is tracked, never moved** | README · Part II §7 |
| **One accepted offer per request** — no splitting | owner, 2026-08-29 |
| **Nothing is solicited without the buyer's explicit selection** | owner, 2026-08-29 |
| **Derived, not stored**: trust tiers, contract filters, expiry, the N/M indicator | Part I §4, Part II §8 |
| **The platform workspace holds no customer data** and cannot be deleted | owner, 2026-08-29 |
| **Registries never enter matching** | Part I §2 |
| **A workspace carrying a contract or a deal is archived, never erased** — six-year retention | owner, 2026-09-12 · Part II §4 |

# Where the build actually stands (re-checked 2026-09-13, prod deploy #38)

**Built and live:**

- **Since the 2026-09-07 consolidation (deploys #31–#38):** the audit trail
  covers the commercial spine and sign-ins; quotes record *why* they were
  declined and *whose clock* the response time is on (Part I §6); a recorded
  price can be corrected while `received`, and a declined or unanswered
  supplier can be re-asked; **P8 slice 1** — the `document` table, quote
  paperwork, `/documents`, 36-month retention (Part II §6); a workspace
  carrying money is **archived, never erased** (Part II §4).

- Part I: the demand-pull flow end to end — taxonomy (S1), structured intake
  (S2), store-first coverage, `global_web` discovery, the discovery/verification
  role split, the three automated checks and the derived tier, the bilingual
  pool, English-first search.
- Part II: **P1–P6** — the quote/deal/contract spine, soumissions, comparison
  and acceptance, the contract centre, bilingual templates frozen at draft, and
  signature tracking with reminders and the manual provider.
- **Phase R** — custom staff roles, the dynamic permission matrix.
- Staff are alerted by email when a buyer asks for quotes (2026-09-07).

**Specified here but NOT built:**

| What | Where |
|---|---|
| **S3 — category-aware retrieval.** `request.category_id` participates in neither retrieval nor matching; the big-store prefilter is still a name-only `ILIKE` (`scope.ts`). Largely defused by §2 (registries never enter matching), but the capability is absent. | Part I |
| **S4 — lazy per-request enrichment.** No scrape/enrich stage exists; descriptions come straight from the discovery findings. | Part I |
| **Checks ④ ⑤** — export record (dormant by §1) and certifications. | Part I §4 |
| **P7 commandes** (`order_milestone`) · **P8 documents beyond slice 1** (deal/contract documents, kinds, versions, the stored PDF report) · **P9 paiements** · **P10 messages** · **P11 rapports** | Part II |
| **The deal lifecycle past `contracting`.** The columns and the guarded ladder exist; `transitionDeal` has one caller. Steps 14-16 of the parcours have no surface. | Part II §8 |

# Open questions

1. ~~**Document retention policy.**~~ **Answered** (owner, 2026-09-12/13):
   a document orphaned from its request and quote is kept **36 months**, then
   row, `file` row and bytes go; an archived workspace is kept **six years**.
   **What remains open:** destroying a workspace with **no** contract or deal
   still cascades its `document` and `file` rows away without passing through
   the sweep, so those bytes linger on the volume. And the remote-vs-local
   storage backend is still deferred to an env-var switch, to be discussed.
2. **Is the deal layer a plan dimension?** Plans gate `requests_per_day` and
   `suppliers_returned` only, so a Free-trial workspace can currently reach
   contracts. Affects E12.
3. **Who updates production milestones?** Every update is an email then a manual
   entry — the real cost of "no supplier access". **Blocks P7.**
4. **Per-request enrichment budget** — dollars or candidates, per plan tier?
   Moot until S4 exists, but it is the first question S4 raises.
5. **Supplier-claim flow timing** — with the supplier-side space (G2), or after
   the first facilitated deals?
6. **May OSI nudge a buyer** who never picks suppliers, and is
   signature-before-deposit the right order?
7. **Keep or remove "Marquer comme envoyée" on a quote?** (raised 2026-09-12.)
   The buyer notification on a recorded offer already exists and is
   untouched; the button is the *outbound* stamp (`sent_at`) that lets the
   response time measure the supplier's lag rather than OSI's (Part I §6).
   Removing it puts OSI's own lag back into the moat's headline number.
