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
    if (!workspaceId) return ZERO_STATS;

    const [{ db }, { and, count, eq, notInArray }, schema] = await Promise.all([
      import("@/database"),
      import("drizzle-orm"),
      import("@/database/schema"),
    ]);
    const [row] = await db
      .select({ value: count() })
      .from(schema.request)
      .where(
        and(
          eq(schema.request.organizationId, workspaceId),
          notInArray(schema.request.status, ["closed", "cancelled"]),
        ),
      );

    // Remaining metrics land with their tables:
    //   suppliersEvaluated  → E4/E5: count(matches) across the user's requests
    //   ongoingTransactions → E8: count(transactions) where status active
    //   savingsGenerated    → E8: sum of realized savings
    return { ...ZERO_STATS, activeRequests: row?.value ?? 0 };
  },
);
