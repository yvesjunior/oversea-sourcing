# ADR-001 — The OSI architecture: demand-pull sourcing and the transaction spine

| | |
|---|---|
| **Status** | ✅ **Accepted and largely built** — consolidated 2026-09-07 |
| **Consolidates** | the former **ADR-001** (Supplier Provisioning Strategy, accepted 2026-08-26) and **ADR-002** (The transaction dossier & contract centre, accepted 2026-08-29), which this file replaces |
| **Baseline** | main @ `615d7e0` · prod deploy #30 |
| **Source brief** | [doc/briefs/portail-entreprise.md](../briefs/portail-entreprise.md) (owner's `.docx`, 2026-08-29) |
| **Implementation plan** | Phase S and Phase P in [doc/BACKLOG.md](../BACKLOG.md) |
| **Pretty version** | Claude artifact, diagrams + build state: <https://claude.ai/code/artifact/a537df29-e576-4725-b8de-661efd1d1438> |

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

Response time (`requested_at → responded_at`), MOQ, lead time, price and the
buyer's satisfaction score are exactly the outcomes nobody can scrape. They
arrive as a by-product of Part II, not as a separate project.

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

### §6 · Documents: one typed table *(not built — P8)*

A single `document` row — kind, the deal and/or contract it hangs from, a
`file_id`, an issuer, a version — absorbing the open E7 item (the stored PDF
report). Until it exists, the countersigned-contract upload writes a `file` row
directly, owned by the **buyer's** workspace.

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

# Where the build actually stands (2026-09-07, prod deploy #30)

**Built and live:**

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
| **P7 commandes** (`order_milestone`) · **P8 documents** · **P9 paiements** · **P10 messages** · **P11 rapports** | Part II |

# Open questions

1. **Document retention policy.** None exists, and `storage.deleteFile` is never
   called on user files — deleting a request drops its `file` rows and leaves
   the bytes. Needs an answer **before P8** puts legal documents in there.
   Related: the owner has deferred the remote-vs-local storage backend to an
   env-var switch, to be discussed.
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
