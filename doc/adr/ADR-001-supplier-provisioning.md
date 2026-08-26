# ADR-001 — Supplier Provisioning Strategy

| | |
|---|---|
| **Status** | ✅ **Accepted — Option B** (platform owner, 2026-08-26) |
| **Baseline** | main @ `508cb10` · prod deploy #3 |
| **Pretty version** | Claude artifact (diagrams): <https://claude.ai/code/artifact/a537df29-e576-4725-b8de-661efd1d1438> |
| **Implementation plan** | Phase S in [doc/BACKLOG.md](../BACKLOG.md) |

## Context

OSI's value chain: buyer describes an industrial need → the platform finds
and ranks compatible manufacturers → OSI facilitates the deal. Two questions
decide the supplier side's economics: **where supplier data comes from**, and
**when money is spent making it presentable**.

The strategy implemented through deploy #3 (registry-store supply-push)
accumulated national-registry datasets into per-source stores up front
(1.2 M+ records) and served requests store-first with AI web research as
fallback. A design review (2026-08-26) found it yield-bottlenecked:

- registry records are bare names needing an unfunded enrichment stage
  (~$12k+ at store scale) before they serve anyone;
- the big-store retrieval prefilter matched on company NAME only
  (`src/server/sources/scope.ts:147`) — QC/IN activity text never
  participated in candidate discovery;
- corridor coverage followed data availability (CA·QC·SG·JP), not buyer
  demand (China·Vietnam·India·Taiwan·Turkey·Mexico); China has no registry
  route at all;
- nothing accumulated that a competitor could not copy.

**Weighting note:** OSI is pre-launch — no customers on dev or prod.
Backward-compatibility and funnel-protection arguments carry no weight;
"already built" counts only where machinery fits the target design; cold
request latency is a launch-time UX task. Cost shape weighs MORE:
pre-revenue is exactly when spend must be demand-justified.

## Decision — the demand-pull supplier graph

Two operating principles:

1. **Demand-pull, not supply-push** — nothing is spent on a supplier until a
   real request needs them; spend grows progressively as a candidate
   approaches presentation.
2. **The deal loop is the data-acquisition engine** — every facilitation
   produces capability/pricing/responsiveness data that cannot be scraped.
   That is the moat; everything scraped is bootstrap.

The flow:

```
REQUEST (structured form → HS-aligned taxonomy node)
  → RETRIEVE from the supplier graph (hybrid: edge filters + text/embedding)
  → coverage thin for this category × corridor?
      DISCOVER fan-out: customs/BoL data (backbone) · marketplaces · web AI
  → ENRICH top ~3×N lazily (site scrape → evidence-cited capability profile)
  → VERIFY per candidate (battery below; registries plug in HERE)
  → PRESENT Top-N (trust tier + evidence)
  → ENGAGE (OSI facilitation)
  → outcomes (response time · MOQ · lead time · quotes) feed the graph back
```

**Supplier graph** = the existing `supplier` table as node + dated, sourced,
queryable **edges**: capability→category, shipments (customs), registry
snapshot, certifications, verification evidence, deal outcomes. Plain
Postgres — "graph" is the shape, not the engine. The supplier lifecycle
`lead → profiled → verified → engaged → partner` is DERIVED from which edges
a node has, never set by hand.

### Settled sub-decisions

- **Source roles** (new axis, orthogonal to dynamic/static): *discovery*
  sources (global_web; customs, marketplaces later) are workspace-selectable
  in Préférences de sourcing. *Verification* sources (ALL registries) are
  platform infrastructure: never in workspace settings, never fed into
  matching — buyers meet them only as evidence lines on supplier profiles
  ("Existence vérifiée — Registre du Québec, actif, consulté 2026-08").
  Consequences: registry records never need enrichment; `sourcing_rules` +
  Paramètres scope to discovery-role sources; `eligibleCandidates` drops
  verification-role stores.
- **Registry stores are kept** as local verification lookup tables,
  refreshed by scheduled full pull **~every 6 months per source**
  (per-source config; staff upload for file-fed QC/JP). Evidence rows record
  the snapshot date; finalists get a live registry-API confirm where one
  exists. Coverage expands on demand — when discovery surfaces candidates
  from an uncovered country, that triggers adding its registry (for
  verification). Where no registry route exists (China): tier from export
  records + facilitation-time documents (business licence).
- **Verification battery (= the E10 spec).** Six checks per presented
  candidate, each writing an evidence row (type, source, result, URL,
  checked_at): ① legal existence (local store + live API), ② digital
  identity (site/TLS/domain age/MX/name coherence), ③ export track record
  (customs/BoL), ④ certifications (IAF CertSearch/issuers), ⑤ sanctions
  (OFAC/EU/UN, local lists — a hit BLOCKS presentation), ⑥ LLM coherence
  read (~cents; the rest free). Trust tier is DERIVED: 0 unverified →
  1 existence verified (floor for a Top-N) → 2 capability evidenced →
  3 Vérifié OSI (human/outreach — a supplier that answers and quotes is
  real; E6 is the ultimate verifier). `verification_status` stops being
  settable by any code.
- **Enrichment is lazy**: ~3×N candidates per live request; keyword-scoped
  batches staff-aimed secondary; store-sized batches do not exist. The old
  enrichment DECISION GATE is resolved.
- **Intake**: structured request form becomes primary (category required
  from the taxonomy, product, spec chips, certs, qty, lead time, free-text
  details) — E3 task, backlogged 2026-08-26. The plain-language hero is a
  launch-time design task.

## Options considered

**Option A — registry-store supply-push (as built): rejected as strategy,
machinery retained.** Its architecture — disposable stores, promote-on-use,
the connector contract, dedup, bans — is precisely what Option B is built
on; its registry connectors + warmed stores become the verification backend.
Nothing structural is discarded; the strategy pointing it is.

## Implementation plan (= Phase S in the backlog)

**Stop:** new registry connectors for discovery · store-sized enrichment ·
the availability-driven roadmap (Companies House → SIRENE → BRREG).
**Keep:** store/promotion machinery · connector contract · dedup/bans · all
five registry connectors + warmed stores (as verification tables).
**Start, in dependency order:**

1. **S1** Category taxonomy (~50–100 nodes, in-house, mapped to HS/NIC/SSIC)
2. **S2** Structured request form as primary intake (E3)
3. **S3** Category/activity-code retrieval (replaces the name-only ILIKE)
4. **S4** Lazy per-request enrichment (~3×N; keyword batches secondary)
5. **S5** Customs/BoL discovery connector (free US records first) +
   verification battery (E10) + `data_source` role split
6. **S6** Engagement feedback loop (with E6) — the moat

## Consequences

- Deploy #3's machinery keeps earning; no rollback, no rewrite.
- The ~$12k enrichment gate dissolves; registry records never need enrichment.
- The registry enable/disable product call disappears — registries never
  enter matching, so there is nothing to switch on for customers.
- A taxonomy becomes the first dependency (also feeds E5's criteria workshop).
- A lightweight scheduler becomes the third caller of static connectors
  (~2 pulls/source/year — negligible).
- Cold-request latency grows with inline enrichment — acceptable pre-launch;
  provisional-then-final request UX before launch (event model supports it).

## Open questions

1. Customs data access tier — free US records only, or budget a paid
   provider for EU corridors?
2. Taxonomy choice — HS, NAICS/NACE, or in-house tree mapped to all three?
   (First in the start sequence; blocks S2.)
3. Per-request enrichment budget — cap in dollars or candidates? Per plan tier?
4. Supplier-claim flow timing — with E6, or after the first facilitated deals?
