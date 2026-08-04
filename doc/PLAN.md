# OSI — Product Plan

> Status: living document. Decisions dated 2026-08-04.

## Product model

OSI (Oversea Sourcing Intelligence) is a **facilitated marketplace** for industrial
sourcing. Buyers describe a need in natural language; the platform's AI extracts
structured criteria, searches globally, and ranks the most compatible suppliers.
When the buyer selects a supplier, **OSI steps in as facilitator** of the
connection — introduction, coordination, then transaction tracking through delivery.

- **Two-sided eventually, buyer-first now.** MVP1 covers the buyer journey only;
  the facilitation handoff is the bridge to the supplier side (no supplier portal in MVP1).
- **Multi-tenant** buyer workspaces from day one.
- **Payments are track-only** in MVP; escrow integration is deferred.

## Supplier data strategy (hybrid)

1. **Import pipeline** — baseline coverage aggregated from external sources
   (B2B directories, trade registries, customs/import data).
2. **Live AI web research** — "Recherche mondiale" is literal: per request, an AI
   agent searches the web, extracts candidate suppliers, and **enriches the
   database as a byproduct**. Every request grows the dataset.

Consequences:
- Every supplier record carries **provenance**: `imported | ai_researched | osi_verified`.
- The **confidence score** maps to verification level + data completeness.
- Dedup / entity resolution is a core subsystem, not an afterthought.

## Feature map

### Foundations
- Backend API + Postgres, buyer auth, company workspaces, roles (admin/buyer/viewer)
- File storage (attachments, plans, documents), background jobs (async pipeline)
- Notifications (in-app + email), audit log, server-side i18n (FR/EN)

### Demandes — the core loop
- Create request (free text + attachments) → **AI criteria extraction** (Claude API)
- Criteria review/edit + **conversational refinement** (per-request AI chat)
- Async pipeline: Reçue → Analyse IA → Recherche mondiale → Validation → Rapport
- **Report generation** (PDF, bilingual)

### Fournisseurs — supplier intelligence
- Supplier DB: profiles, capabilities, certifications, provenance
- Matching engine (criteria × capabilities) → candidate set
- Scores: **compatibility** (the "32 OSI criteria" — to be defined), **confidence**,
  **risk** (country, financial, compliance)
- Top-5 ranking + side-by-side comparison

### Facilitation — where OSI jumps in
- Buyer selects a supplier → **engagement** created
- OSI ops notified → outreach → status tracked back to the buyer
- Facilitation queue lives in the **admin backoffice**

### Transactions
- Milestone timeline: confirmed → payment → manufacturing (%) → inspection →
  shipping → customs → delivery (manual updates first)
- Payment tracking only (amounts, currency, status); escrow later

### Admin backoffice (internal — part of MVP1)
- Supplier DB management, verification workflow, import runs
- Facilitation queue for the ops team

### Documents · Partenaires · Analyses · Paramètres
- Documents: central repo linked to requests/transactions/suppliers (versioning; e-sign later)
- Partenaires: inspection / freight / financing directory (MVP2+)
- Analyses: real aggregation of spend, savings, regional & category breakdowns
- Paramètres: profile, team, language, sourcing rules (preferred regions, required certs)

## Build phases

| Phase | Scope | Outcome |
| --- | --- | --- |
| **1 — Foundations** | Backend + Postgres + auth + workspaces + storage + jobs | Real accounts, real persistence |
| **2 — Core loop (MVP1)** | Requests + AI extraction + supplier import + AI research + scoring + Top 5 + facilitation handoff + report + admin backoffice | A buyer gets a real sourcing result and OSI facilitates the connection |
| **3 — Execution** | Transactions timeline + documents + notifications + real analytics | Orders tracked from PO to delivery |
| **4 — Ecosystem** | Supplier portal (RFQs/quotes), escrow provider, partners, advanced risk data | The full two-sided vision |

## Deferred / open decisions

- Backend architecture: extend TanStack Start (server routes, monolith) vs separate API service — **next decision**
- Database engine & ORM (Postgres assumed; ORM TBD)
- External supplier data sources & licensing (which directories / trade data)
- Escrow / payment provider choice (Phase 4)
- The concrete list of the "32 compatibility criteria"
