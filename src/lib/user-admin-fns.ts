// Platform user management (staff surface, 2023-08-23 · rescoped
// 2026-08-27): the INTERNAL team only — owner feedback: "from the users
// nav we should not see other orgs' users". Customer people are their own
// workspace owner's business; customer ACCOUNTS live on /interne/clients
// (where plan assignment moved).

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
  if (!session) return null;
  // Staff powers only from the internal workspace (2026-08-27).
  const { effectivePlatformRole } = await import("@/server/workspace-guard");
  if (!hasPlatformFeature(await effectivePlatformRole(session), "users")) return null;
  return session;
}

export const getPlatformUsersFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<PlatformUserView[]> => {
    const session = await requireUserAdmin();
    if (!session) return [];

    const [{ db }, { eq, ne, sql }, schema] = await Promise.all([
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
      // Staff only — a customer org's people are never listed here.
      .where(ne(schema.user.platformRole, "user"))
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
