// The audit journal reader (owner request 2026-08-27) — staff surface,
// filterable PER ORG and PER USER. Writes happen through src/server/audit.ts.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type AuditRowView = {
  id: string;
  at: string;
  actorId: string | null;
  /** Live name while the account exists, else the snapshot, else null. */
  actorName: string | null;
  organizationId: string | null;
  /** Live name while the workspace exists, else the snapshot, else null. */
  organizationName: string | null;
  action: string;
  target: string | null;
  detail: Record<string, string | number | boolean | null> | null;
};

export type AuditFilters = {
  organizations: Array<{ id: string; name: string }>;
  actors: Array<{ id: string; name: string }>;
};

export type AuditLogData = { rows: AuditRowView[]; filters: AuditFilters };

export const getAuditLogFn = createServerFn({ method: "GET" })
  .inputValidator(
    z.object({
      organizationId: z.string().optional(),
      actorId: z.string().optional(),
    }),
  )
  .handler(async ({ data }): Promise<AuditLogData> => {
    const [{ auth }, { getRequest }, { hasPlatformFeature }] = await Promise.all([
      import("@/server/auth"),
      import("@tanstack/react-start/server"),
      import("@/lib/roles"),
    ]);
    const session = await auth.api.getSession({ headers: getRequest().headers });
    if (!session) return { rows: [], filters: { organizations: [], actors: [] } };
    // Staff powers only from the internal workspace (2026-08-27).
    const { effectivePlatformRole } = await import("@/server/workspace-guard");
    if (!hasPlatformFeature(await effectivePlatformRole(session), "users")) {
      return { rows: [], filters: { organizations: [], actors: [] } };
    }

    const [{ db }, { and, desc, eq, isNotNull, sql }, schema] = await Promise.all([
      import("@/database"),
      import("drizzle-orm"),
      import("@/database/schema"),
    ]);

    const conditions = [
      ...(data.organizationId ? [eq(schema.auditLog.organizationId, data.organizationId)] : []),
      ...(data.actorId ? [eq(schema.auditLog.actorId, data.actorId)] : []),
    ];

    const [rows, orgs, actors] = await Promise.all([
      db
        .select({
          id: schema.auditLog.id,
          at: schema.auditLog.at,
          actorId: schema.auditLog.actorId,
          // Live name first (accounts get renamed), snapshot as the fallback.
          actorName: sql<string | null>`coalesce("user"."name", ${schema.auditLog.actorName})`,
          organizationId: schema.auditLog.organizationId,
          organizationName: sql<
            string | null
          >`coalesce("organization"."name", ${schema.auditLog.organizationName})`,
          action: schema.auditLog.action,
          target: schema.auditLog.target,
          detail: schema.auditLog.detail,
        })
        .from(schema.auditLog)
        .leftJoin(schema.user, eq(schema.user.id, schema.auditLog.actorId))
        .leftJoin(schema.organization, eq(schema.organization.id, schema.auditLog.organizationId))
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(schema.auditLog.at))
        .limit(100),
      // Filter options come from the log itself: only orgs/actors that acted.
      db
        .selectDistinct({
          id: schema.auditLog.organizationId,
          name: sql<
            string | null
          >`coalesce("organization"."name", ${schema.auditLog.organizationName})`,
        })
        .from(schema.auditLog)
        .leftJoin(schema.organization, eq(schema.organization.id, schema.auditLog.organizationId))
        .where(isNotNull(schema.auditLog.organizationId)),
      db
        .selectDistinct({
          id: schema.auditLog.actorId,
          name: sql<string | null>`coalesce("user"."name", ${schema.auditLog.actorName})`,
        })
        .from(schema.auditLog)
        .leftJoin(schema.user, eq(schema.user.id, schema.auditLog.actorId))
        .where(isNotNull(schema.auditLog.actorId)),
    ]);

    const clean = <T extends { id: string | null; name: string | null }>(list: T[]) =>
      list
        .filter((x): x is T & { id: string } => x.id !== null)
        .map((x) => ({ id: x.id, name: x.name ?? x.id }))
        .sort((a, b) => a.name.localeCompare(b.name));

    return {
      rows: rows.map((row) => ({
        ...row,
        at: row.at.toISOString(),
        detail: (row.detail ?? null) as AuditRowView["detail"],
      })),
      filters: { organizations: clean(orgs), actors: clean(actors) },
    };
  });
