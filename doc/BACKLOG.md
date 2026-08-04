# OSI — MVP1 Technical Backlog

> Companion to [PLAN.md](PLAN.md). Data model + epics → tasks. Living document.

## Architecture (decided)

Monolith on the existing TanStack Start app (Nitro server = API host), deployed as
the standalone Node container we already ship.

| Concern          | Choice                                                                        |
| ---------------- | ----------------------------------------------------------------------------- |
| Database         | **PostgreSQL 16** (compose service, named volume)                             |
| ORM / migrations | **Drizzle** + drizzle-kit                                                     |
| Background jobs  | **pg-boss** (queue lives in Postgres — no Redis to operate)                   |
| Auth             | **better-auth** (TS-native, Drizzle adapter) — email/password + sessions      |
| Validation       | **zod** on every API boundary                                                 |
| AI               | **Claude API** (extraction, chat refinement, research agent, report drafting) |
| File storage     | Local Docker volume for MVP1, S3-compatible interface from day one            |
| Email            | SMTP provider (Resend or similar), templates FR/EN                            |

**Tenancy rule:** every buyer-facing query is workspace-scoped. **Exception by design:
`suppliers` and their satellite tables are platform-global** — the supplier dataset is
OSI's shared asset, enriched by every request. Requests, engagements, transactions,
documents are tenant-scoped.

---

## 1 · Data model

```mermaid
erDiagram
    users ||--o{ memberships : has
    workspaces ||--o{ memberships : has
    workspaces ||--o{ requests : owns
    users ||--o{ requests : creates
    requests ||--o{ request_criteria : has
    requests ||--o{ request_messages : chat
    requests ||--o{ matches : ranked
    suppliers ||--o{ matches : candidate
    suppliers ||--o{ supplier_capabilities : has
    suppliers ||--o{ supplier_certifications : has
    suppliers ||--o{ supplier_contacts : has
    matches ||--o| engagements : selected
    engagements ||--o{ engagement_events : timeline
    engagements ||--o| transactions : becomes
    transactions ||--o{ transaction_milestones : tracks
    workspaces ||--o{ documents : owns
    requests ||--o{ research_runs : triggers
```

### Identity & tenancy

| Table                    | Key fields                                                                                            | Notes                                                                                                                                                                                                                                  |
| ------------------------ | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users`                  | email (uq), name, locale `fr\|en`, `platform_role` `user\|owner\|manager\|accountant`, email_verified | `platform_role` = OSI **employee** roles (gates the admin backoffice): `owner` (full control) · `manager` (ops: facilitation, supplier verification) · `accountant` (finance: transactions, payments). `user` = regular buyer, default |
| `workspaces`             | name, slug (uq)                                                                                       | The company account                                                                                                                                                                                                                    |
| `memberships`            | workspace_id, user_id, role `owner\|admin\|buyer\|viewer`                                             | uq(workspace, user)                                                                                                                                                                                                                    |
| `invitations`            | workspace_id, email, role, token, invited_by, expires_at, accepted_at                                 |                                                                                                                                                                                                                                        |
| `sessions` / auth tables |                                                                                                       | Managed by better-auth                                                                                                                                                                                                                 |

**Workspace roles** (buyer companies): `owner` (everything + delete workspace) · `admin`
(members, settings) · `buyer` (create requests, select suppliers, engagements) · `viewer`
(read-only).

**Platform roles** (OSI employees, decided 2026-08-04): `owner` (full platform control) ·
`manager` (ops — facilitation queue, supplier verification, imports) · `accountant`
(finance — transactions and payment oversight). Stored on `users.platform_role`;
regular buyers keep the default `user`.

**One dashboard for everyone (decided 2026-08-04):** there is **no separate admin
backoffice app**. Every user gets the same shell/dashboard; features are added or
removed based on role. Employee features (facilitation queue, supplier verification,
imports, finance) appear as extra role-gated navigation sections in the shared
dashboard. Feature→role mapping lives in `src/lib/roles.ts`:
facilitation/verification/imports → `owner|manager` · finance → `owner|accountant`.

**Per-user dashboard (decided 2026-08-04):** after login every user lands on _their own_
dashboard — greeting, stats, "Vos dossiers récents" and activity feed scoped to **them**
(their requests + their engagements). Workspace-wide visibility follows the role
(owner/admin see all workspace requests; buyer manages their own; viewer reads all).
Signup creates a personal workspace, so solo users are fully isolated by construction.

**Public landing / auth gate (decided 2026-08-04):** the default page (`/`) requires
**no login** — anonymous visitors see the hero prompt and value props and can type their
need. Clicking **“Lancer l’analyse IA” is the auth gate**: it redirects to login/signup,
the typed draft (+ attachments intent) is preserved across the redirect, and the request
is created automatically right after auth. Every other app route (demandes, fournisseurs,
transactions…) requires login. Logged-in users see the personal dashboard on `/`.

### Requests (demandes)

| Table                 | Key fields                                                                                                                                            | Notes                                                                                                    |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `requests`            | workspace_id, created_by, title, description_raw, status, locale, launched_at, completed_at                                                           | status: `draft → received → analyzing → searching → validating → report_ready` (+ `closed`, `cancelled`) |
| `request_criteria`    | request_id, category `material\|flow\|pressure\|certification\|quantity\|lead_time\|other`, label, value, unit, required, source `ai\|user`, position | AI-extracted, user-editable                                                                              |
| `request_messages`    | request_id, role `user\|assistant`, content                                                                                                           | The per-request AI chat                                                                                  |
| `files`               | workspace_id, storage_key, filename, mime, size, uploaded_by                                                                                          | Generic file store                                                                                       |
| `request_attachments` | request_id, file_id                                                                                                                                   |                                                                                                          |

### Suppliers (platform-global)

| Table                     | Key fields                                                                                                                                                                                                           | Notes                     |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `suppliers`               | name, legal_name, country_code, website (uq-ish), description, employee_range, **provenance** `imported\|ai_researched\|osi_verified`, **verification_status** `unverified\|pending\|verified\|rejected`, source_ref | Provenance is first-class |
| `supplier_capabilities`   | supplier_id, category, label, details jsonb                                                                                                                                                                          | What they can make        |
| `supplier_certifications` | supplier_id, code (ISO9001, CE, ATEX…), valid_until, verified                                                                                                                                                        |                           |
| `supplier_contacts`       | supplier_id, name, email, phone, role                                                                                                                                                                                | Used by ops for outreach  |
| `import_runs`             | source, status, stats jsonb, triggered_by                                                                                                                                                                            | Batch import tracking     |
| `research_runs`           | request_id, status, queries jsonb, results_count                                                                                                                                                                     | AI web-research tracking  |

### Matching & facilitation

| Table               | Key fields                                                                                                                                                                                              | Notes                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `matches`           | request_id, supplier_id, rank, compatibility_score, confidence_score, risk_level `low\|medium\|high`, **score_breakdown jsonb**, status `candidate\|presented\|selected\|rejected`                      | uq(request, supplier); breakdown = per-criterion detail |
| `engagements`       | request_id, match_id, workspace_id, supplier_id, requested_by, status `requested → ops_review → contacting_supplier → supplier_responded → connected` (+ `declined`, `abandoned`), assigned_ops_user_id | **The facilitation moment**                             |
| `engagement_events` | engagement_id, type, message, actor_user_id                                                                                                                                                             | Timeline shown to buyer & ops                           |

### Execution & misc

| Table                    | Key fields                                                                                                                                                                   | Notes                  |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| `transactions`           | workspace_id, engagement_id, reference, supplier_id, amount, currency, incoterm, status, expected_delivery_date                                                              |                        |
| `transaction_milestones` | transaction_id, type `order_confirmed\|payment\|manufacturing\|inspection\|shipping\|customs\|delivered`, status `pending\|in_progress\|done`, progress %, occurred_at, note | Manual updates in MVP1 |
| `documents`              | workspace_id, file_id, kind `contract\|certificate\|inspection_report\|customs\|invoice\|report\|other`, request_id?, transaction_id?, supplier_id?                          |                        |
| `notifications`          | user_id, workspace_id, type, payload jsonb, read_at                                                                                                                          | In-app bell            |
| `sourcing_rules`         | workspace_id, preferred_regions[], banned_countries[], required_certifications[], max_lead_time_days                                                                         | Applied by the matcher |
| `audit_log`              | workspace_id?, actor_user_id, action, entity_type, entity_id, meta jsonb                                                                                                     |                        |

---

## 2 · Epics → tasks

### E0 — Dev foundations

- [x] Enable `database` (postgres:16) in both compose files: volume, healthcheck, `depends_on`
- [x] `DATABASE_URL` wiring — secrets in `.env.local`, never in committed `.env`
- [x] Drizzle + drizzle-kit: schema layout in `src/database/`, migration workflow, `npm run db:migrate` / `db:seed`
- [ ] API route structure under TanStack Start (`/api/*`), zod validation, typed error envelope
- [ ] pg-boss bootstrap + worker entrypoint (same container, second process) — job: `echo` smoke test
- [ ] Seed script: demo workspace, users per role, ~20 suppliers, 1 request in each status

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
- [ ] Rate limiting on auth endpoints

### E2 — Workspaces, roles & tenancy

- [ ] Workspace CRUD (create at signup, rename)
- [ ] Memberships + role checks: `requireRole(workspace, 'buyer')` helpers
- [ ] Tenancy scoping utility — every query filtered by workspace_id (make the safe path the easy path)
- [ ] Invitations: send (email), accept (join flow), revoke
- [ ] Team management UI in Paramètres (list, invite, change role, remove)
- [ ] Audit log writes on auth/membership mutations

### E3 — Requests core loop

- [ ] `requests` CRUD + status state machine (guarded transitions, timestamps)
- [ ] Hero prompt → creates draft request (wire existing UI)
- [ ] File upload endpoint + storage adapter (local volume; S3 interface)
- [ ] **Job: AI criteria extraction** (Claude) → `request_criteria` rows; status `analyzing`
- [ ] Criteria review/edit UI (add/remove/edit before launching search)
- [ ] **Per-request AI chat**: message → Claude with criteria context → optional criteria mutation + re-run
- [ ] Pipeline orchestrator job: `analyzing → searching → validating → report_ready` with progress events
- [ ] Wire demandes list + detail pages to real data (drop mock)
- [ ] **Personal dashboard** (Accueil): real session user greeting, stats + "Vos dossiers
      récents" scoped to the logged-in user, per-role workspace visibility
- [ ] Activity feed: recent events across _my_ requests/engagements (from engagement_events + status changes)

### E4 — Supplier data platform

- [ ] Supplier schema + satellites (capabilities, certifications, contacts) + provenance fields
- [ ] CSV/JSON import pipeline v1 + `import_runs` (admin-triggered)
- [ ] **Job: AI research agent** — web search per request criteria → LLM extraction → candidate `suppliers` (provenance `ai_researched`, `research_runs` tracked)
- [ ] Dedup / entity resolution v1 (normalize name + country + website; merge tool in admin)
- [ ] Supplier directory UI wiring (list, detail, filters) — real data
- [ ] Country risk reference table (seed data)

### E5 — Matching & scoring

- [ ] **Define the 32 compatibility criteria** (product workshop — weights per category)
- [ ] Matching query: request criteria × supplier capabilities × sourcing_rules → candidate set
- [ ] Compatibility score: weighted per-criterion, store breakdown jsonb
- [ ] Confidence score: provenance + profile completeness + verification
- [ ] Risk level: country risk + data flags (v1 heuristic)
- [ ] Top-5 persistence in `matches` + ranking; "87 fournisseurs analysés" becomes real
- [ ] Comparison view wiring ("Comparer" side-by-side)

### E6 — Facilitation (engagements) · the OSI moment

- [ ] Engagement creation from a match (buyer clicks "Engager" on a Top-5 supplier)
- [ ] Status machine + `engagement_events` timeline
- [ ] Ops queue in admin: list, assign to ops user, transition statuses, add notes
- [ ] Buyer-side status panel on request detail ("OSI is connecting you…")
- [ ] Notifications on every transition (buyer + assigned ops)

### E7 — Report generation

- [ ] Report data assembly (request, criteria, top-5, scores, recommendation)
- [ ] PDF rendering (bilingual, OSI branding) → stored as `documents` kind `report`
- [ ] "Voir le rapport" button wiring + download

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

### E11 — Settings

- [ ] Profile + language (server-persisted)
- [ ] Sourcing rules UI → consumed by matcher (E5)
- [ ] Notification preferences

### Cross-cutting (throughout)

- [ ] Audit log on all mutations of money/status/membership
- [ ] Error monitoring hook (server logs first)
- [ ] Postgres backup cron on the VM (`pg_dump` → dated dumps)
- [ ] Security pass before exposing beyond LAN (rate limits, headers, TLS/reverse-proxy)

---

## 3 · Suggested execution order

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

## 4 · Open items

- The 32 criteria list (E5 task — needs a product session)
- External data sources & licensing for imports (E4)
- Web-search provider for the research agent (Brave/Tavily/SerpAPI…)
- Email provider choice (Resend vs SMTP)
- When to put a reverse proxy + TLS in front of prod (before first external user)
