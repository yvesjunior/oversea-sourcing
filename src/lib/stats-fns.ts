import { createServerFn } from "@tanstack/react-start";

export type DashboardStats = {
  activeRequests: number;
  suppliersEvaluated: number;
  ongoingTransactions: number;
  /** In dollars. */
  savingsGenerated: number;
  /** Week-over-week deltas — null until there is history to compare. */
  deltas: {
    activeRequests: number | null;
    suppliersEvaluated: number | null;
    ongoingTransactions: number | null;
    savingsGenerated: number | null;
  };
};

const ZERO_STATS: DashboardStats = {
  activeRequests: 0,
  suppliersEvaluated: 0,
  ongoingTransactions: 0,
  savingsGenerated: 0,
  deltas: {
    activeRequests: null,
    suppliersEvaluated: null,
    ongoingTransactions: null,
    savingsGenerated: null,
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
    if (!session || !canSeeAllRequests(session.user.platformRole)) return null;

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
