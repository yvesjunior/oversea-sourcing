// Platform user management (staff surface, 2026-08-23) — every account, its
// platform role, workspace, plan and usage. This is USER-centric on purpose:
// the Abonnements screen edits plans; people are managed here.

import { createServerFn } from "@tanstack/react-start";

export type PlatformUserView = {
  userId: string;
  name: string;
  email: string;
  platformRole: string;
  emailVerified: boolean;
  createdAt: string;
  /** The user's personal/primary workspace (first membership). */
  workspaceId: string | null;
  workspaceName: string | null;
  workspaceRole: string | null;
  planCode: string | null;
  /** Requests created by this user in the rolling 24h window. */
  usedToday: number;
  /** Requests created by this user, ever (the Free trial counts these). */
  usedTotal: number;
};

/** owner|manager only — the feature gate lives in src/lib/roles.ts. */
async function requireUserAdmin() {
  const [{ auth }, { getRequest }, { hasPlatformFeature }] = await Promise.all([
    import("@/server/auth"),
    import("@tanstack/react-start/server"),
    import("@/lib/roles"),
  ]);
  const session = await auth.api.getSession({ headers: getRequest().headers });
  if (!session || !hasPlatformFeature(session.user.platformRole, "users")) return null;
  return session;
}

export const getPlatformUsersFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<PlatformUserView[]> => {
    const session = await requireUserAdmin();
    if (!session) return [];

    const [{ db }, { eq, sql }, schema] = await Promise.all([
      import("@/database"),
      import("drizzle-orm"),
      import("@/database/schema"),
    ]);

    const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const rows = await db
      .select({
        userId: schema.user.id,
        name: schema.user.name,
        email: schema.user.email,
        platformRole: schema.user.platformRole,
        emailVerified: schema.user.emailVerified,
        createdAt: schema.user.createdAt,
        workspaceId: schema.organization.id,
        workspaceName: schema.organization.name,
        workspaceRole: schema.member.role,
        planCode: schema.plan.code,
        usedToday: sql<number>`(
          select count(*)::int from ${schema.request}
          where ${schema.request.createdBy} = ${schema.user.id}
            and ${schema.request.createdAt} >= ${windowStart}
        )`,
        usedTotal: sql<number>`(
          select count(*)::int from ${schema.request}
          where ${schema.request.createdBy} = ${schema.user.id}
        )`,
      })
      .from(schema.user)
      .leftJoin(schema.member, eq(schema.member.userId, schema.user.id))
      .leftJoin(schema.organization, eq(schema.organization.id, schema.member.organizationId))
      .leftJoin(schema.subscription, eq(schema.subscription.organizationId, schema.organization.id))
      .leftJoin(schema.plan, eq(schema.plan.id, schema.subscription.planId))
      .orderBy(schema.user.createdAt);

    // One row per user: keep the first membership (personal workspace) — the
    // multi-membership detail belongs to the workspace screens, not here.
    const seen = new Map<string, PlatformUserView>();
    for (const row of rows) {
      if (seen.has(row.userId)) continue;
      seen.set(row.userId, {
        ...row,
        platformRole: row.platformRole ?? "user",
        createdAt: row.createdAt.toISOString(),
      });
    }
    return [...seen.values()];
  },
);
