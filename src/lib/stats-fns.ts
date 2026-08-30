import { createServerFn } from "@tanstack/react-start";

export type DashboardStats = {
  activeRequests: number;
  suppliersEvaluated: number;
  ongoingTransactions: number;
  /** Week-over-week deltas — null until there is history to compare. */
  deltas: {
    activeRequests: number | null;
    suppliersEvaluated: number | null;
    ongoingTransactions: number | null;
  };
};

const ZERO_STATS: DashboardStats = {
  activeRequests: 0,
  suppliersEvaluated: 0,
  ongoingTransactions: 0,
  deltas: {
    activeRequests: null,
    suppliersEvaluated: null,
    ongoingTransactions: null,
  },
};

/** Dashboard stats scoped to the logged-in user's workspace.
 *  Anonymous visitors get zeros (public landing shows the section with 0s). */
export const getDashboardStatsFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<DashboardStats> => {
    const [{ auth }, { getRequest }] = await Promise.all([
      import("@/server/auth"),
      import("@tanstack/react-start/server"),
    ]);
    const session = await auth.api.getSession({ headers: getRequest().headers });
    const workspaceId = session?.session.activeOrganizationId;
    if (!session || !workspaceId) return ZERO_STATS;

    const [{ db }, { and, count, eq, notInArray }, schema] = await Promise.all([
      import("@/database"),
      import("drizzle-orm"),
      import("@/database/schema"),
    ]);
    // Own-workspace scope for everyone; the global view is getAllStatsFn.
    const [[requests], [evaluated]] = await Promise.all([
      db
        .select({ value: count() })
        .from(schema.request)
        .where(
          and(
            eq(schema.request.organizationId, workspaceId),
            // Drafts are unlaunched/abandoned — "active" means launched work.
            notInArray(schema.request.status, ["draft", "closed", "cancelled"]),
          ),
        ),
      db
        .select({ value: count() })
        .from(schema.match)
        .innerJoin(schema.request, eq(schema.match.requestId, schema.request.id))
        .where(eq(schema.request.organizationId, workspaceId)),
    ]);

    // Remaining metrics land with their tables:
    //   ongoingTransactions → E8: count(transactions) where status active
    //   savingsGenerated    → E8: sum of realized savings
    return {
      ...ZERO_STATS,
      activeRequests: requests?.value ?? 0,
      suppliersEvaluated: evaluated?.value ?? 0,
    };
  },
);

/** Platform-wide stats — the employee "global view" tab (owner/manager only,
 *  null for everyone else). */
export const getAllStatsFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<DashboardStats | null> => {
    const [{ auth }, { getRequest }, { canSeeAllRequests }] = await Promise.all([
      import("@/server/auth"),
      import("@tanstack/react-start/server"),
      import("@/lib/roles"),
    ]);
    const session = await auth.api.getSession({ headers: getRequest().headers });
    if (!session) return null;
    // Staff powers only from the internal workspace (2026-08-27).
    const { effectiveHasPermission } = await import("@/server/workspace-guard");
    if (!(await effectiveHasPermission(session, "requests.all"))) return null;

    const [{ db }, { count, notInArray }, schema] = await Promise.all([
      import("@/database"),
      import("drizzle-orm"),
      import("@/database/schema"),
    ]);
    const [[requests], [evaluated]] = await Promise.all([
      db
        .select({ value: count() })
        .from(schema.request)
        .where(notInArray(schema.request.status, ["draft", "closed", "cancelled"])),
      db.select({ value: count() }).from(schema.match),
    ]);
    return {
      ...ZERO_STATS,
      activeRequests: requests?.value ?? 0,
      suppliersEvaluated: evaluated?.value ?? 0,
    };
  },
);

// ── Analytics (employee surface) ─────────────────────────────────────────────

export type AnalyticsData = {
  requests: { total: number; active: number; completed: number };
  suppliers: {
    total: number;
    byProvenance: Array<{ key: string; value: number }>;
    topCountries: Array<{ key: string; value: number }>;
  };
  research: { runs: number; searches: number; candidatesFound: number; suppliersAdded: number };
  /** Requests created per month, oldest first — the only real trend we have. */
  trend: Array<{ month: string; value: number }>;
  /** Spend/savings need the transactions table (E8). Null = "no data source
   *  yet", which the UI states plainly instead of inventing a figure. */
  spend: null;
  savings: null;
};

const EMPTY_ANALYTICS: AnalyticsData = {
  requests: { total: 0, active: 0, completed: 0 },
  suppliers: { total: 0, byProvenance: [], topCountries: [] },
  research: { runs: 0, searches: 0, candidatesFound: 0, suppliersAdded: 0 },
  trend: [],
  spend: null,
  savings: null,
};

/** Platform-wide analytics for the employee surface. Everything here is a real
 *  aggregate — metrics without a table are returned as null, never invented. */
export const getAnalyticsFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<AnalyticsData> => {
    const [{ auth }, { getRequest }] = await Promise.all([
      import("@/server/auth"),
      import("@tanstack/react-start/server"),
    ]);
    const session = await auth.api.getSession({ headers: getRequest().headers });
    const { effectiveHasPermission } = await import("@/server/workspace-guard");
    if (!session || !(await effectiveHasPermission(session, "analytics"))) {
      return EMPTY_ANALYTICS;
    }

    const [{ db }, { count, desc, sql }, schema] = await Promise.all([
      import("@/database"),
      import("drizzle-orm"),
      import("@/database/schema"),
    ]);

    const [requestsByStatus, suppliersByProvenance, byCountry, [research], trendRows] =
      await Promise.all([
        db
          .select({ status: schema.request.status, value: count() })
          .from(schema.request)
          .groupBy(schema.request.status),
        db
          .select({ key: schema.supplier.provenance, value: count() })
          .from(schema.supplier)
          .groupBy(schema.supplier.provenance)
          .orderBy(desc(count())),
        db
          .select({ key: schema.supplier.countryCode, value: count() })
          .from(schema.supplier)
          .groupBy(schema.supplier.countryCode)
          .orderBy(desc(count()))
          .limit(6),
        db
          .select({
            runs: count(),
            searches: sql<number>`coalesce(sum(jsonb_array_length(${schema.researchRun.queries})), 0)::int`,
            candidatesFound: sql<number>`coalesce(sum(${schema.researchRun.candidatesFound}), 0)::int`,
            suppliersAdded: sql<number>`coalesce(sum(${schema.researchRun.suppliersAdded}), 0)::int`,
          })
          .from(schema.researchRun),
        db
          .select({
            month: sql<string>`to_char(date_trunc('month', ${schema.request.createdAt}), 'YYYY-MM')`,
            value: count(),
          })
          .from(schema.request)
          .groupBy(sql`date_trunc('month', ${schema.request.createdAt})`)
          .orderBy(sql`date_trunc('month', ${schema.request.createdAt})`)
          .limit(12),
      ]);

    const byStatus = new Map<string, number>(
      requestsByStatus.map((r) => [r.status as string, r.value]),
    );
    const sum = (statuses: string[]) =>
      statuses.reduce((total, status) => total + (byStatus.get(status) ?? 0), 0);

    return {
      requests: {
        total: requestsByStatus.reduce((t, r) => t + r.value, 0),
        active: sum(["received", "analyzing", "searching", "validating"]),
        completed: sum(["report_ready", "closed"]),
      },
      suppliers: {
        total: suppliersByProvenance.reduce((t, r) => t + r.value, 0),
        byProvenance: suppliersByProvenance,
        topCountries: byCountry,
      },
      research: {
        runs: research?.runs ?? 0,
        searches: research?.searches ?? 0,
        candidatesFound: research?.candidatesFound ?? 0,
        suppliersAdded: research?.suppliersAdded ?? 0,
      },
      trend: trendRows,
      spend: null,
      savings: null,
    };
  },
);

/** One line of the dashboard's activity feed. */
export type ActivityEntry = {
  id: string;
  /** `request.*` · `deal.*` · `contract.*` — the i18n key is derived from it. */
  type: string;
  /** What it happened to: a request id, a dossier title, a contract number. */
  subject: string;
  /** Where clicking should go. */
  link: string;
  at: string;
};

/**
 * The dashboard's "Activités récentes" (visual dossier §1).
 *
 * Merged from the three event tables that already exist — `request_event`,
 * `deal_event`, `contract_event` — rather than a new "activity" table. Those
 * rows are written by the state machines as their timelines; a fourth store
 * would be a second source of truth that could disagree with the dossier a
 * user opens from this very feed.
 *
 * Workspace-scoped like everything else: staff standing in the internal
 * workspace see every account's, since that is their queue.
 */
export const getRecentActivityFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<ActivityEntry[]> => {
    const [
      { requireWorkspaceRole, effectiveHasPermission },
      { auth },
      { getRequest },
      { db },
      { desc, eq },
      schema,
    ] = await Promise.all([
      import("@/server/workspace-guard"),
      import("@/server/auth"),
      import("@tanstack/react-start/server"),
      import("@/database"),
      import("drizzle-orm"),
      import("@/database/schema"),
    ]);
    const headers = getRequest().headers;
    const caller = await requireWorkspaceRole(headers, "viewer");
    const session = await auth.api.getSession({ headers });
    if (!caller || !session) return [];
    const seesAll = await effectiveHasPermission(session, "requests.all");
    const LIMIT = 8;

    // Each source is capped before the merge: fetching everything to keep
    // eight rows would scan three tables in full as they grow.
    const [requestEvents, dealEvents, contractRows] = await Promise.all([
      db
        .select({
          id: schema.requestEvent.id,
          type: schema.requestEvent.type,
          requestId: schema.requestEvent.requestId,
          at: schema.requestEvent.createdAt,
        })
        .from(schema.requestEvent)
        .where(seesAll ? undefined : eq(schema.requestEvent.organizationId, caller.workspaceId))
        .orderBy(desc(schema.requestEvent.createdAt))
        .limit(LIMIT),
      db
        .select({
          id: schema.dealEvent.id,
          type: schema.dealEvent.type,
          dealId: schema.dealEvent.dealId,
          title: schema.deal.title,
          at: schema.dealEvent.createdAt,
        })
        .from(schema.dealEvent)
        .innerJoin(schema.deal, eq(schema.deal.id, schema.dealEvent.dealId))
        .where(seesAll ? undefined : eq(schema.dealEvent.organizationId, caller.workspaceId))
        .orderBy(desc(schema.dealEvent.createdAt))
        .limit(LIMIT),
      db
        .select({
          id: schema.contractEvent.id,
          type: schema.contractEvent.type,
          contractId: schema.contractEvent.contractId,
          number: schema.contract.number,
          organizationId: schema.contract.organizationId,
          at: schema.contractEvent.at,
        })
        .from(schema.contractEvent)
        .innerJoin(schema.contract, eq(schema.contract.id, schema.contractEvent.contractId))
        .where(seesAll ? undefined : eq(schema.contract.organizationId, caller.workspaceId))
        .orderBy(desc(schema.contractEvent.at))
        .limit(LIMIT),
    ]);

    return [
      ...requestEvents.map((row) => ({
        id: row.id,
        type: row.type,
        subject: `#${row.requestId}`,
        link: `/demandes/${row.requestId}`,
        at: row.at.toISOString(),
      })),
      ...dealEvents.map((row) => ({
        id: row.id,
        type: row.type,
        subject: row.title,
        link: `/contrats`,
        at: row.at.toISOString(),
      })),
      ...contractRows.map((row) => ({
        id: row.id,
        type: row.type,
        subject: row.number,
        link: `/contrats/${row.contractId}`,
        at: row.at.toISOString(),
      })),
    ]
      .sort((a, b) => (a.at < b.at ? 1 : -1))
      .slice(0, LIMIT);
  },
);
