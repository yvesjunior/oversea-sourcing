// Platform user management (staff surface, 2023-08-23 · rescoped
// 2026-08-27): the INTERNAL team only — owner feedback: "from the users
// nav we should not see other orgs' users". Customer people are their own
// workspace owner's business; customer ACCOUNTS live on /interne/clients
// (where plan assignment moved).

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { BUILT_IN_STAFF_ROLES } from "@/lib/roles";

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
  const [{ auth }, { getRequest }] = await Promise.all([
    import("@/server/auth"),
    import("@tanstack/react-start/server"),
  ]);
  const session = await auth.api.getSession({ headers: getRequest().headers });
  if (!session) return null;
  // Staff powers only from the internal workspace (2026-08-27).
  const { effectiveHasPermission } = await import("@/server/workspace-guard");
  if (!(await effectiveHasPermission(session, "users"))) return null;
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

/** Grant / change / revoke a platform role (owner-EXCLUSIVE, 2026-08-27 —
 *  rights management is owner territory per the ②j split). Granting a staff
 *  role also enrolls the person into the internal OSI workspace (the ②b
 *  follow-up — no more manual SQL); revoking removes that membership and
 *  re-points any session that was standing in it. */
export const setPlatformRoleFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      email: z.string().trim().toLowerCase().email(),
      // Open since Phase R: any built-in, `user`, `owner`, or a role the owner
      // created. Validated against the real set below rather than by a closed
      // enum, which could not know about a role added five minutes ago.
      role: z.string().trim().min(1).max(32),
    }),
  )
  .handler(
    async ({ data }): Promise<{ ok: boolean; error?: "forbidden" | "not_found" | "self" }> => {
      const [{ auth }, { getRequest }] = await Promise.all([
        import("@/server/auth"),
        import("@tanstack/react-start/server"),
      ]);
      const session = await auth.api.getSession({ headers: getRequest().headers });
      if (!session) return { ok: false, error: "forbidden" };
      const { effectivePlatformRole } = await import("@/server/workspace-guard");
      if ((await effectivePlatformRole(session)) !== "owner") {
        return { ok: false, error: "forbidden" };
      }

      const [{ db }, { and, eq }, schema] = await Promise.all([
        import("@/database"),
        import("drizzle-orm"),
        import("@/database/schema"),
      ]);
      // The role has to exist: a typo would otherwise strand an account on a
      // role name that resolves to no permissions at all.
      const assignable = new Set<string>(["user", "owner", ...BUILT_IN_STAFF_ROLES]);
      if (!assignable.has(data.role)) {
        const custom = await db.query.platformRoleTable.findFirst({
          where: eq(schema.platformRoleTable.name, data.role),
        });
        if (!custom) return { ok: false, error: "not_found" };
      }

      const target = await db.query.user.findFirst({ where: eq(schema.user.email, data.email) });
      if (!target) return { ok: false, error: "not_found" };
      // The owner never edits their own role — ownership questions are not
      // settled from a dropdown.
      if (target.id === session.user.id) return { ok: false, error: "self" };
      if (target.platformRole === data.role) return { ok: true };

      const internalOrg = await db.query.organization.findFirst({
        where: eq(schema.organization.type, "internal"),
      });

      await db
        .update(schema.user)
        .set({ platformRole: data.role, updatedAt: new Date() })
        .where(eq(schema.user.id, target.id));

      if (internalOrg) {
        const membership = await db.query.member.findFirst({
          where: and(
            eq(schema.member.organizationId, internalOrg.id),
            eq(schema.member.userId, target.id),
          ),
        });
        if (data.role !== "user" && !membership) {
          // Raw insert on purpose: staff enrollment bypasses seat caps and
          // the org-plugin hooks (the internal plan is unlimited anyway).
          await db.insert(schema.member).values({
            id: crypto.randomUUID(),
            organizationId: internalOrg.id,
            userId: target.id,
            role: "buyer",
            createdAt: new Date(),
          });
        }
        if (data.role === "user" && membership && membership.role !== "owner") {
          await db.delete(schema.member).where(eq(schema.member.id, membership.id));
          // Sessions still standing in the OSI workspace must fall back to a
          // remaining membership (or none) — and the Redis-cached copies go.
          const fallback = await db.query.member.findFirst({
            where: eq(schema.member.userId, target.id),
          });
          await db
            .update(schema.session)
            .set({ activeOrganizationId: fallback?.organizationId ?? null })
            .where(
              and(
                eq(schema.session.userId, target.id),
                eq(schema.session.activeOrganizationId, internalOrg.id),
              ),
            );
          const { secondaryStorage } = await import("@/server/kv");
          if (secondaryStorage) {
            const sessions = await db.query.session.findMany({
              where: eq(schema.session.userId, target.id),
              columns: { token: true },
            });
            for (const s of sessions) await secondaryStorage.delete(s.token);
          }
        }
      }

      const { logAudit, actorOf } = await import("@/server/audit");
      await logAudit({
        ...actorOf(session),
        organizationId: internalOrg?.id ?? null,
        organizationName: internalOrg?.name ?? null,
        action: "platform_role.updated",
        target: target.email,
        detail: { from: target.platformRole, to: data.role },
      });
      return { ok: true };
    },
  );
