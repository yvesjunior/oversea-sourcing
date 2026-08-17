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
// workspace role (buyer companies): owner | admin | buyer | viewer.
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

export const organization = pgTable("organization", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").unique(),
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
  // owner | admin | buyer | viewer
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
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [uniqueIndex("supplier_dedup_key_uq").on(table.dedupKey)],
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
});
