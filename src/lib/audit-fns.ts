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

export type AuditLogData = {
  /** One page of rows (AUDIT_PAGE_SIZES), newest first. */
  rows: AuditRowView[];
  /** Total rows matching the filters — drives the range display. */
  total: number;
  page: number;
  filters: AuditFilters;
};

export const AUDIT_PAGE_SIZES = [25, 50, 100] as const;
export const AUDIT_PAGE_SIZE_DEFAULT = 25;

const EMPTY: AuditLogData = {
  rows: [],
  total: 0,
  page: 0,
  filters: { organizations: [], actors: [] },
};

export const getAuditLogFn = createServerFn({ method: "GET" })
  .inputValidator(
    z.object({
      organizationId: z.string().optional(),
      actorId: z.string().optional(),
      /** Inclusive time range, ISO datetimes (the client sends its local
       *  day boundaries so "Du 27/08" means the viewer's 27th). */
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
      /** Zero-based page over the filtered, newest-first ordering. */
      page: z.number().int().min(0).max(100_000).optional(),
      pageSize: z
        .number()
        .refine((n): n is (typeof AUDIT_PAGE_SIZES)[number] =>
          (AUDIT_PAGE_SIZES as readonly number[]).includes(n),
        )
        .optional(),
    }),
  )
  .handler(async ({ data }): Promise<AuditLogData> => {
    const [{ auth }, { getRequest }, { hasPlatformFeature }] = await Promise.all([
      import("@/server/auth"),
      import("@tanstack/react-start/server"),
      import("@/lib/roles"),
    ]);
    const session = await auth.api.getSession({ headers: getRequest().headers });
    if (!session) return EMPTY;
    const [{ db }, { and, count, desc, eq, gte, isNotNull, lte, sql }, schema] = await Promise.all([
      import("@/database"),
      import("drizzle-orm"),
      import("@/database/schema"),
    ]);

    // Two access tiers (owner rule 2026-08-27): platform staff (standing in
    // the internal workspace) read everything; otherwise the OWNER of an
    // organisation workspace reads their own org's rows only — the scope is
    // FORCED server-side, whatever organizationId the client sent.
    const { effectivePlatformRole, requireWorkspaceRole } =
      await import("@/server/workspace-guard");
    let forcedOrgId: string | null = null;
    if (!hasPlatformFeature(await effectivePlatformRole(session), "logging")) {
      const caller = await requireWorkspaceRole(getRequest().headers, "owner");
      if (!caller) return EMPTY;
      const workspace = await db.query.organization.findFirst({
        where: eq(schema.organization.id, caller.workspaceId),
        columns: { type: true },
      });
      // Individual workspaces are one person — no journal surface for them.
      if (!workspace || workspace.type === "individual") return EMPTY;
      forcedOrgId = caller.workspaceId;
    }
    const orgScope = forcedOrgId ?? data.organizationId;

    const page = data.page ?? 0;
    const pageSize = data.pageSize ?? AUDIT_PAGE_SIZE_DEFAULT;
    const conditions = [
      ...(orgScope ? [eq(schema.auditLog.organizationId, orgScope)] : []),
      ...(data.actorId ? [eq(schema.auditLog.actorId, data.actorId)] : []),
      ...(data.from ? [gte(schema.auditLog.at, new Date(data.from))] : []),
      ...(data.to ? [lte(schema.auditLog.at, new Date(data.to))] : []),
    ];
    const rowFilter = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, [totalRow], orgs, actors] = await Promise.all([
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
        .where(rowFilter)
        .orderBy(desc(schema.auditLog.at))
        .offset(page * pageSize)
        .limit(pageSize),
      db.select({ value: count() }).from(schema.auditLog).where(rowFilter),
      // Filter options come from the log itself: only orgs/actors that acted.
      // Ids are tombstones (no FK since 0028) — deleted accounts and
      // destroyed workspaces stay filterable through their snapshot names.
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
      // Cascading: with a workspace chosen, offer only ITS actors.
      db
        .selectDistinct({
          id: schema.auditLog.actorId,
          name: sql<string | null>`coalesce("user"."name", ${schema.auditLog.actorName})`,
        })
        .from(schema.auditLog)
        .leftJoin(schema.user, eq(schema.user.id, schema.auditLog.actorId))
        .where(
          orgScope
            ? and(isNotNull(schema.auditLog.actorId), eq(schema.auditLog.organizationId, orgScope))
            : isNotNull(schema.auditLog.actorId),
        ),
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
      total: totalRow?.value ?? 0,
      page,
      filters: { organizations: clean(orgs), actors: clean(actors) },
    };
  });

/** Only entries older than this are purgeable (owner rule 2026-08-27) —
 *  the recent window is always kept. */
export const AUDIT_RETENTION_MONTHS = 3;

/** Purge journal entries older than 3 months (owner-EXCLUSIVE — destructive
 *  ops are owner territory, like the store wipe). The purge itself writes an
 *  audit row, so the journal always says when it was trimmed and by whom. */
export const purgeAuditLogFn = createServerFn({ method: "POST" }).handler(
  async (): Promise<{ ok: boolean; deleted: number }> => {
    const [{ auth }, { getRequest }] = await Promise.all([
      import("@/server/auth"),
      import("@tanstack/react-start/server"),
    ]);
    const session = await auth.api.getSession({ headers: getRequest().headers });
    if (!session) return { ok: false, deleted: 0 };
    const { effectivePlatformRole } = await import("@/server/workspace-guard");
    if ((await effectivePlatformRole(session)) !== "owner") return { ok: false, deleted: 0 };

    const [{ db }, { lt }, schema] = await Promise.all([
      import("@/database"),
      import("drizzle-orm"),
      import("@/database/schema"),
    ]);
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - AUDIT_RETENTION_MONTHS);
    const deleted = await db
      .delete(schema.auditLog)
      .where(lt(schema.auditLog.at, cutoff))
      .returning({ id: schema.auditLog.id });

    const { logAudit, actorOf } = await import("@/server/audit");
    await logAudit({
      ...actorOf(session),
      action: "log.purged",
      detail: { deleted: deleted.length, cutoff: cutoff.toISOString() },
    });
    return { ok: true, deleted: deleted.length };
  },
);
