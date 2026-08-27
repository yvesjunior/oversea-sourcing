import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgSequence,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ─────────────────────────────────────────────────────────────────────────────
// Identity & tenancy — better-auth core tables + organization plugin.
// "organization" IS the OSI workspace (see doc/BACKLOG.md). Members carry the
// workspace role (buyer companies): owner | buyer | viewer — "admin" stays
// schema-valid but unused (owner/admin merged 2026-08-23; owner manages
// account AND team).
// user.platformRole is for OSI *employees* (admin backoffice):
//   user (default — not an employee) | owner | manager | accountant
// ─────────────────────────────────────────────────────────────────────────────

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  // OSI custom fields
  locale: text("locale").notNull().default("fr"),
  platformRole: text("platform_role").notNull().default("user"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  // organization plugin: the workspace the user is currently acting in
  activeOrganizationId: text("active_organization_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ── Workspaces (better-auth organization plugin) ─────────────────────────────

/** Account model made explicit (owner, 2026-08-26):
 *  - `internal`   — the one staff workspace, "Oversea Sourcing Intelligence"
 *                   (every platform staff member belongs to it)
 *  - `individual` — a buyer's personal workspace (created at signup)
 *  - `enterprise` — a buyer company's shared workspace */
export const ORGANIZATION_TYPES = ["internal", "individual", "enterprise"] as const;
export type OrganizationType = (typeof ORGANIZATION_TYPES)[number];

export const organization = pgTable("organization", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").unique(),
  type: text("type").$type<OrganizationType>().notNull().default("individual"),
  logo: text("logo"),
  metadata: text("metadata"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const member = pgTable("member", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  // owner | buyer | viewer ("admin" schema-valid but unused since 2026-08-23)
  role: text("role").notNull().default("buyer"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ── Requests (demandes) — the core loop (doc/BACKLOG.md E3) ─────────────────

/** Display ids for requests ("#3000", "#3001", …) — seed uses 2536-2541, so no collision. */
export const requestIdSeq = pgSequence("request_id_seq", { startWith: "3000" });

export const REQUEST_STATUSES = [
  "draft",
  "received",
  "analyzing",
  "searching",
  "validating",
  "report_ready",
  "closed",
  "cancelled",
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const request = pgTable(
  "request",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    descriptionRaw: text("description_raw").notNull().default(""),
    /** Taxonomy node id (src/lib/taxonomy.ts) — ADR-001 S2: the structured
     *  form makes the category explicit; null = legacy/free-text intake.
     *  The cache/coverage key of the demand-pull design. */
    categoryId: text("category_id"),
    status: text("status").$type<RequestStatus>().notNull().default("draft"),
    locale: text("locale").notNull().default("fr"),
    // Denormalized display cache — source of truth becomes `matches` at E5.
    compatibilityScore: integer("compatibility_score"),
    launchedAt: timestamp("launched_at"),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("request_org_idx").on(table.organizationId),
    index("request_created_by_idx").on(table.createdBy),
    // Coverage measurement per category (ADR-001): cheap to hold from day one.
    index("request_category_idx").on(table.categoryId),
  ],
);

export const CRITERIA_CATEGORIES = [
  "material",
  "flow",
  "pressure",
  "certification",
  "quantity",
  "lead_time",
  "other",
] as const;
export type CriteriaCategory = (typeof CRITERIA_CATEGORIES)[number];

/** AI-extracted, user-editable sourcing criteria for a request (E3). */
export const requestCriterion = pgTable(
  "request_criterion",
  {
    id: text("id").primaryKey(),
    requestId: text("request_id")
      .notNull()
      .references(() => request.id, { onDelete: "cascade" }),
    category: text("category").$type<CriteriaCategory>().notNull().default("other"),
    label: text("label").notNull(),
    value: text("value").notNull(),
    unit: text("unit"),
    required: boolean("required").notNull().default(false),
    /** ai = extracted by the gateway · user = added/edited by the buyer */
    source: text("source").$type<"ai" | "user">().notNull().default("ai"),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [index("request_criterion_request_idx").on(table.requestId)],
);

/** Per-request AI chat (E3). */
export const requestMessage = pgTable(
  "request_message",
  {
    id: text("id").primaryKey(),
    requestId: text("request_id")
      .notNull()
      .references(() => request.id, { onDelete: "cascade" }),
    role: text("role").$type<"user" | "assistant">().notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [index("request_message_request_idx").on(table.requestId)],
);

/** Pipeline/activity events — powers timelines and the activity feed (E3). */
export const requestEvent = pgTable(
  "request_event",
  {
    id: text("id").primaryKey(),
    requestId: text("request_id")
      .notNull()
      .references(() => request.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** e.g. status.received, status.analyzing, criteria.extracted, chat.refined */
    type: text("type").notNull(),
    message: text("message"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("request_event_request_idx").on(table.requestId),
    index("request_event_org_idx").on(table.organizationId),
  ],
);

// ── Suppliers & matching (E4/E5 data layer, pulled forward) ─────────────────
// Suppliers are PLATFORM-GLOBAL by design (doc/BACKLOG.md tenancy rule): the
// dataset is OSI's shared asset. Matches tie a supplier to one request.

export const SUPPLIER_PROVENANCES = ["imported", "ai_researched", "osi_verified"] as const;
export type SupplierProvenance = (typeof SUPPLIER_PROVENANCES)[number];

export const VERIFICATION_STATUSES = ["unverified", "pending", "verified", "rejected"] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const RISK_LEVELS = ["low", "medium", "high"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const supplier = pgTable(
  "supplier",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    /** brand descriptor shown under the name (e.g. "Solutions", "Pumps") */
    descriptor: text("descriptor"),
    countryCode: text("country_code").notNull(),
    website: text("website"),
    description: text("description"),
    provenance: text("provenance").$type<SupplierProvenance>().notNull().default("imported"),
    verificationStatus: text("verification_status")
      .$type<VerificationStatus>()
      .notNull()
      .default("unverified"),
    /** 0-100 — provenance + profile completeness (heuristic until E5 scoring) */
    confidenceScore: integer("confidence_score").notNull().default(50),
    riskLevel: text("risk_level").$type<RiskLevel>().notNull().default("medium"),
    /** Where this record came from — the source URL for `ai_researched` rows (E4). */
    sourceRef: text("source_ref"),
    /** The request whose research first surfaced this company (E4 provenance).
     *  `set null` on delete, never cascade: the supplier is a platform-global
     *  asset that outlives the request that happened to find it. */
    discoveredByRequestId: text("discovered_by_request_id").references(() => request.id, {
      onDelete: "set null",
    }),
    /** Entity resolution (E4): normalized `name|COUNTRY`. The unique index is
     *  what actually stops the research agent re-adding a company we already
     *  know — application-side checks race, this doesn't. */
    dedupKey: text("dedup_key"),
    /** Touched whenever any collection re-encounters this company (a dedup hit
     *  proves it still exists). Store-first coverage counts entries fresher
     *  than STORE_FRESH_DAYS; older ones still match but trigger a top-up. */
    lastResearchedAt: timestamp("last_researched_at"),
    /** Global ban — never matched, never shown, for anyone (fraud, sanctions).
     *  Sticky across re-collection: the dedup key lands new encounters on this
     *  row, so a banned supplier cannot be resurrected by a fresh crawl. */
    bannedAt: timestamp("banned_at"),
    bannedBy: text("banned_by").references(() => user.id, { onDelete: "set null" }),
    bannedReason: text("banned_reason"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [uniqueIndex("supplier_dedup_key_uq").on(table.dedupKey)],
);

// ── Data sources (validated 2026-08-22) — the platform-curated catalogue ─────
// Each source is an independent pull-only connector (src/server/sources/);
// requests never specify a source — effective set = enabled ∩ workspace-activated.

export const DATA_SOURCE_TYPES = ["global_web", "country_registry", "import"] as const;
export type DataSourceType = (typeof DATA_SOURCE_TYPES)[number];

/** ADR-001 (2026-08-26) — the role axis, orthogonal to dynamic/static:
 *  - `discovery` finds candidates for matching; workspace-selectable in
 *    Préférences de sourcing (global_web; customs/marketplaces later).
 *  - `verification` backs the per-candidate checks (all registries): never
 *    fed into matching, never workspace-selectable — its store is a local
 *    verification lookup table, refreshed ~every 6 months. */
export const DATA_SOURCE_ROLES = ["discovery", "verification"] as const;
export type DataSourceRole = (typeof DATA_SOURCE_ROLES)[number];

export const dataSource = pgTable(
  "data_source",
  {
    id: text("id").primaryKey(),
    /** Stable identifier used by the connector registry (`global_web`, `registry-ca`…). */
    code: text("code").notNull(),
    name: text("name").notNull(),
    type: text("type").$type<DataSourceType>().notNull(),
    /** ADR-001: only `discovery` sources enter matching / workspace settings;
     *  `verification` sources back the E10 checks. */
    role: text("role").$type<DataSourceRole>().notNull().default("discovery"),
    /** Null = worldwide (global_web); set for national registries. */
    countryCode: text("country_code"),
    /** A disabled source is never consulted, for anyone. For a verification
     *  source this means "verification backend active", not buyer exposure. */
    enabled: boolean("enabled").notNull().default(false),
    config: jsonb("config").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [uniqueIndex("data_source_code_uq").on(table.code)],
);

/** A source's STORE (Phase D, decided 2026-08-24): what a source collects is
 *  kept here as raw records — CANDIDATES to become suppliers, not suppliers
 *  yet. `supplier_id` is set only at PROMOTION (the record ranked into a
 *  request's Top-N). Everything load-bearing (requests, matches, reports)
 *  references promoted suppliers, so a store can be wiped at any time
 *  without impacting the platform. Per-record ban ignores THIS source's data
 *  for the company while other sources can still surface it; sticky across
 *  re-collection (the upsert only touches active rows). */
export const sourceRecord = pgTable(
  "source_record",
  {
    id: text("id").primaryKey(),
    dataSourceId: text("data_source_id")
      .notNull()
      .references(() => dataSource.id, { onDelete: "cascade" }),
    /** Same normalized `name|COUNTRY` key as supplier.dedup_key — records of
     *  the same company across sources group on it, and promotion lands on
     *  the existing supplier row through the supplier unique index. */
    dedupKey: text("dedup_key").notNull(),
    /** Set at promotion; `set null` on supplier delete — the record then
     *  simply becomes a candidate again. */
    supplierId: text("supplier_id").references(() => supplier.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    descriptor: text("descriptor"),
    countryCode: text("country_code").notNull(),
    website: text("website"),
    description: text("description"),
    /** 0-100, already clamped by the core (AI ceiling etc.). */
    confidenceScore: integer("confidence_score").notNull().default(50),
    /** Where this source saw the company (URL, registry entry…). */
    sourceUrl: text("source_url"),
    /** The connector's raw payload, verbatim. */
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    status: text("status").$type<"active" | "banned">().notNull().default("active"),
    firstSeenAt: timestamp("first_seen_at").notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
    bannedBy: text("banned_by").references(() => user.id, { onDelete: "set null" }),
    bannedReason: text("banned_reason"),
  },
  (table) => [
    uniqueIndex("source_record_source_key_uq").on(table.dataSourceId, table.dedupKey),
    index("source_record_source_idx").on(table.dataSourceId),
    index("source_record_supplier_idx").on(table.supplierId),
  ],
);

/** Audit of every collection — request-triggered fallback or admin
 *  "Mettre à jour". Absorbs the formerly planned `import_run`. */
export const sourceRun = pgTable(
  "source_run",
  {
    id: text("id").primaryKey(),
    dataSourceId: text("data_source_id")
      .notNull()
      .references(() => dataSource.id, { onDelete: "cascade" }),
    trigger: text("trigger").$type<"request" | "admin">().notNull(),
    requestId: text("request_id").references(() => request.id, { onDelete: "set null" }),
    triggeredBy: text("triggered_by").references(() => user.id, { onDelete: "set null" }),
    status: text("status").$type<"running" | "succeeded" | "failed">().notNull().default("running"),
    /** Optional admin-refresh scope (category, country). */
    scope: jsonb("scope").$type<Record<string, unknown>>(),
    candidatesFound: integer("candidates_found").notNull().default(0),
    suppliersAdded: integer("suppliers_added").notNull().default(0),
    membershipsUpserted: integer("memberships_upserted").notNull().default(0),
    error: text("error"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    completedAt: timestamp("completed_at"),
  },
  (table) => [index("source_run_source_idx").on(table.dataSourceId)],
);

// ── Verification battery (ADR-001 §4 = E10, built 2026-08-26) ────────────────
// Verification is EVIDENCE ACCUMULATION, not a status someone sets: each check
// writes one row here (what was checked, from which source, with what result,
// when), and the supplier's trust tier / verification_status is DERIVED from
// these rows by src/lib/verification.ts — never set by hand. One row per
// (supplier, check): a re-run refreshes it; recency lives in checked_at.

export const VERIFICATION_CHECKS = [
  /** Legal existence — lookup against the verification-role registry stores. */
  "existence",
  /** Website alive, MX present, domain age (RDAP). */
  "digital_identity",
  /** OFAC SDN screening (local list, refreshed ≤7d). A hit is a hard flag. */
  "sanctions",
  /** Customs/BoL export history — DORMANT: the owner's no-paid-data
   *  constraint (2026-08-26) closed every access route; revives only if a
   *  genuinely free licensed route ever appears. */
  "export_record",
  /** Cert registries (IAF CertSearch…) — later; claims stay unverified. */
  "certification",
  /** Staff review — the Tier 3 gate (Vérifié OSI). */
  "human_review",
] as const;
export type VerificationCheck = (typeof VERIFICATION_CHECKS)[number];

export type VerificationOutcome = "passed" | "failed" | "inconclusive";

export const supplierVerification = pgTable(
  "supplier_verification",
  {
    id: text("id").primaryKey(),
    supplierId: text("supplier_id")
      .notNull()
      .references(() => supplier.id, { onDelete: "cascade" }),
    check: text("check").$type<VerificationCheck>().notNull(),
    status: text("status").$type<VerificationOutcome>().notNull(),
    /** Which backend answered (e.g. `registry-qc`, `rdap`, `ofac_sdn`). */
    source: text("source"),
    sourceUrl: text("source_url"),
    /** Check-specific detail (snapshot date, domain age, matched entry…). */
    result: jsonb("result").$type<Record<string, unknown>>(),
    checkedAt: timestamp("checked_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("supplier_verification_uq").on(table.supplierId, table.check),
    index("supplier_verification_supplier_idx").on(table.supplierId),
  ],
);

/** Local sanctions list (OFAC SDN v1) — downloaded and screened offline;
 *  worker-research refreshes it when stale (≤7 days). */
export const sanctionEntry = pgTable(
  "sanction_entry",
  {
    id: text("id").primaryKey(),
    /** Which list ('ofac_sdn'; EU/UN lists join later). */
    list: text("list").notNull(),
    /** The list's own entry id (SDN ent_num). */
    uid: text("uid").notNull(),
    name: text("name").notNull(),
    /** supplier-key nameSlug of the name — the screening join column. */
    nameSlug: text("name_slug").notNull(),
    program: text("program"),
    entityType: text("entity_type"),
    importedAt: timestamp("imported_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("sanction_entry_uq").on(table.list, table.uid),
    index("sanction_entry_slug_idx").on(table.nameSlug),
  ],
);

// ── Notifications (E9, 2026-08-23) — in-app inbox, one row per recipient ─────
// Same i18n pattern as request_event: `type` + `params` are rendered
// client-side with the user's language, so a notification created in FR reads
// in EN after a language switch. `link` is where clicking it navigates.

export const notification = pgTable(
  "notification",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Workspace context (null for account-level notices). */
    organizationId: text("organization_id").references(() => organization.id, {
      onDelete: "cascade",
    }),
    /** i18n key suffix — rendered as t(`notifications.${type}`, params). */
    type: text("type").notNull(),
    params: jsonb("params").$type<Record<string, string | number>>(),
    /** In-app destination when clicked (e.g. /demandes/3021). */
    link: text("link"),
    readAt: timestamp("read_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [index("notification_user_idx").on(table.userId, table.readAt)],
);

/** Per-user notification preferences (E9/E11) — gate ONLY what goes through
 *  src/server/notify.ts; transactional auth mail is never silenceable. No
 *  row / missing type / missing flag = ON (src/lib/notification-types.ts). */
export const notificationPref = pgTable(
  "notification_pref",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** `{[type]: {inApp?, email?}}` — see NotificationPrefs. */
    prefs: jsonb("prefs").$type<Record<string, { inApp?: boolean; email?: boolean }>>().notNull(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [uniqueIndex("notification_pref_user_uq").on(table.userId)],
);

/** Per-workspace sourcing preferences (validated 2026-08-22): activate sources
 *  once in Settings — requests never specify a source. No row = defaults
 *  (all enabled sources, global origin). */
export const sourcingRules = pgTable(
  "sourcing_rules",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** Null = all platform-enabled sources (the default). */
    activatedSourceIds: jsonb("activated_source_ids").$type<string[]>(),
    countryMode: text("country_mode").$type<"global" | "list">().notNull().default("global"),
    /** Only read when countryMode = list. */
    countryCodes: jsonb("country_codes").$type<string[]>(),
    updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [uniqueIndex("sourcing_rules_org_uq").on(table.organizationId)],
);

// ── Plans & subscriptions ────────────────────────────────────────────────────
// Limits live in rows, not in code or env: changing what the free tier gets is
// an UPDATE from the manager screen, not a deploy. The env values remain the
// fallback for a workspace with no subscription, so dev works with no rows.

export const MODEL_TIERS = ["cheap", "balanced", "best"] as const;
export type ModelTier = (typeof MODEL_TIERS)[number];

export const plan = pgTable(
  "plan",
  {
    id: text("id").primaryKey(),
    /** Stable identifier used in code (`free`, `pro`, `business`, `internal`). */
    code: text("code").notNull(),
    name: text("name").notNull(),
    /** Requests per rolling 24h. **0 means unlimited** — so the internal plan
     *  needs no special case, and an accidental 0 reads as "no cap" rather than
     *  silently locking every buyer out. */
    requestsPerDay: integer("requests_per_day").notNull().default(1),
    /** Lifetime request cap (B8, decided 2026-08-23): Free is a trial — after
     *  this many requests EVER, the only path is a paid plan. 0 = unlimited. */
    maxRequestsTotal: integer("max_requests_total").notNull().default(0),
    /** Seats: members a workspace on this plan may hold. Invitations are
     *  refused at the cap (that's what makes Free/Pro solo BY PLAN, not by
     *  missing UI). 0 = unlimited/custom. */
    maxMembers: integer("max_members").notNull().default(0),
    /** Who the daily/lifetime counters bind to: `user` (individual plans —
     *  limits follow the person) or `workspace` (organization plans — the
     *  team pools its allowance). */
    quotaScope: text("quota_scope").$type<"workspace" | "user">().notNull().default("workspace"),
    /** Which tab of the Abonnements screen this plan lives in, and which
     *  workspaces it may be assigned to. */
    audience: text("audience")
      .$type<"individual" | "organization" | "internal">()
      .notNull()
      .default("individual"),
    /** Overrides SUPPLIERS_RETURNED for workspaces on this plan. */
    suppliersReturned: integer("suppliers_returned").notNull().default(5),
    /** Overrides ANTHROPIC_MODEL. Drives both quality and cost per request. */
    modelTier: text("model_tier").$type<ModelTier>().notNull().default("cheap"),
    /** Display order on the manager screen. */
    position: integer("position").notNull().default(0),
    /** Who last changed the limits — the cheap stand-in for an audit log. */
    updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [uniqueIndex("plan_code_uq").on(table.code)],
);

export const SUBSCRIPTION_STATUSES = ["active", "past_due", "cancelled"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const subscription = pgTable(
  "subscription",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    planId: text("plan_id")
      .notNull()
      .references(() => plan.id, { onDelete: "restrict" }),
    status: text("status").$type<SubscriptionStatus>().notNull().default("active"),
    /** Null while billing does not exist — plans work before Stripe does. */
    currentPeriodEnd: timestamp("current_period_end"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  // One subscription per workspace: "which plan am I on" must have one answer.
  (table) => [uniqueIndex("subscription_org_uq").on(table.organizationId)],
);

// ── Research runs (E4) — one row per AI web-research pass over a request ─────

export const RESEARCH_RUN_STATUSES = ["running", "succeeded", "failed"] as const;
export type ResearchRunStatus = (typeof RESEARCH_RUN_STATUSES)[number];

export const researchRun = pgTable(
  "research_run",
  {
    id: text("id").primaryKey(),
    requestId: text("request_id")
      .notNull()
      .references(() => request.id, { onDelete: "cascade" }),
    status: text("status").$type<ResearchRunStatus>().notNull().default("running"),
    /** Normalized digest of what was searched (category + criteria + country
     *  scope) — a matching fingerprint on a recent run is evidence the store is
     *  warm for this need, however it was worded. */
    fingerprint: text("fingerprint"),
    /** The search queries the agent actually ran — the audit trail for a result. */
    queries: jsonb("queries").$type<string[]>(),
    /** Companies the agent proposed, before dedup. */
    candidatesFound: integer("candidates_found").notNull().default(0),
    /** Companies that were genuinely new and got inserted. */
    suppliersAdded: integer("suppliers_added").notNull().default(0),
    error: text("error"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    completedAt: timestamp("completed_at"),
  },
  (table) => [index("research_run_request_idx").on(table.requestId)],
);

export const MATCH_STATUSES = ["candidate", "presented", "selected", "rejected"] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];

/** Ranked supplier candidates for a request (the Top 5). */
export const match = pgTable(
  "match",
  {
    id: text("id").primaryKey(),
    requestId: text("request_id")
      .notNull()
      .references(() => request.id, { onDelete: "cascade" }),
    supplierId: text("supplier_id")
      .notNull()
      .references(() => supplier.id, { onDelete: "cascade" }),
    rank: integer("rank").notNull(),
    compatibilityScore: integer("compatibility_score").notNull(),
    confidenceScore: integer("confidence_score").notNull(),
    riskLevel: text("risk_level").$type<RiskLevel>().notNull().default("medium"),
    status: text("status").$type<MatchStatus>().notNull().default("presented"),
    /** Per-criterion detail behind `compatibility_score` (E5) — which criteria
     *  matched, which could not be checked, and how the modifiers landed. The
     *  score is worthless to a buyer without the reason, and to us without an
     *  audit trail when someone asks why rank 1 is rank 1. */
    scoreBreakdown: jsonb("score_breakdown"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("match_request_idx").on(table.requestId),
    uniqueIndex("match_request_supplier_uq").on(table.requestId, table.supplierId),
  ],
);

/** Generic file store (E3) — workspace-scoped; bytes live behind src/server/storage.ts. */
export const file = pgTable(
  "file",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    storageKey: text("storage_key").notNull(),
    filename: text("filename").notNull(),
    mime: text("mime").notNull(),
    size: bigint("size", { mode: "number" }).notNull(),
    uploadedBy: text("uploaded_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [index("file_org_idx").on(table.organizationId)],
);

export const requestAttachment = pgTable(
  "request_attachment",
  {
    id: text("id").primaryKey(),
    requestId: text("request_id")
      .notNull()
      .references(() => request.id, { onDelete: "cascade" }),
    fileId: text("file_id")
      .notNull()
      .references(() => file.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [index("request_attachment_request_idx").on(table.requestId)],
);

export const invitation = pgTable("invitation", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role"),
  status: text("status").notNull().default("pending"),
  expiresAt: timestamp("expires_at").notNull(),
  inviterId: text("inviter_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
