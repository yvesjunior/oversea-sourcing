import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { canSeeAllRequests } from "@/lib/roles";
import type { RequestStatus } from "@/database/schema";

/** Shape the UI consumes; E3 will extend (criteria, pipeline progress…). */
export type RequestSummary = {
  id: string;
  title: string;
  status: RequestStatus;
  compatibilityScore: number | null;
  /** ISO timestamp */
  updatedAt: string;
  /** Set only when viewing across workspaces (employees): whose dossier this is. */
  workspaceName: string | null;
};

/** Sourcing requests, newest first — straight from the DB, visibility by role:
 *  buyer → own workspace · owner/manager → all workspaces · accountant → own.
 *  Anonymous visitors get an empty list. */
export const getMyRequestsFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<RequestSummary[]> => {
    const [{ auth }, { getRequest }, { db }, { desc, eq }, schema] = await Promise.all([
      import("@/server/auth"),
      import("@tanstack/react-start/server"),
      import("@/database"),
      import("drizzle-orm"),
      import("@/database/schema"),
    ]);
    const session = await auth.api.getSession({ headers: getRequest().headers });
    const workspaceId = session?.session.activeOrganizationId;
    if (!session || !workspaceId) return [];

    const seesAll = canSeeAllRequests(session.user.platformRole);
    const base = db
      .select({
        id: schema.request.id,
        title: schema.request.title,
        status: schema.request.status,
        compatibilityScore: schema.request.compatibilityScore,
        updatedAt: schema.request.updatedAt,
        workspaceName: schema.organization.name,
        organizationId: schema.request.organizationId,
      })
      .from(schema.request)
      .innerJoin(schema.organization, eq(schema.request.organizationId, schema.organization.id))
      .orderBy(desc(schema.request.updatedAt));

    const rows = seesAll
      ? await base
      : await base.where(eq(schema.request.organizationId, workspaceId));

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      compatibilityScore: row.compatibilityScore,
      updatedAt: row.updatedAt.toISOString(),
      // Label the owner workspace only for cross-workspace views (employees),
      // and only when it's not the viewer's own workspace.
      workspaceName: seesAll && row.organizationId !== workspaceId ? row.workspaceName : null,
    }));
  },
);

/** A single request — same visibility rules as the list (null when forbidden). */
export const getRequestFn = createServerFn({ method: "GET" })
  .inputValidator(z.object({ id: z.string() }))
  .handler(async ({ data }): Promise<RequestSummary | null> => {
    const [{ auth }, { getRequest }, { db }, { eq }, schema] = await Promise.all([
      import("@/server/auth"),
      import("@tanstack/react-start/server"),
      import("@/database"),
      import("drizzle-orm"),
      import("@/database/schema"),
    ]);
    const session = await auth.api.getSession({ headers: getRequest().headers });
    const workspaceId = session?.session.activeOrganizationId;
    if (!session || !workspaceId) return null;

    const row = await db.query.request.findFirst({
      where: eq(schema.request.id, data.id),
    });
    if (!row) return null;

    const seesAll = canSeeAllRequests(session.user.platformRole);
    const isOwn = row.organizationId === workspaceId;
    if (!isOwn && !seesAll) return null;

    let workspaceName: string | null = null;
    if (!isOwn) {
      const org = await db.query.organization.findFirst({
        where: eq(schema.organization.id, row.organizationId),
      });
      workspaceName = org?.name ?? null;
    }

    return {
      id: row.id,
      title: row.title,
      status: row.status,
      compatibilityScore: row.compatibilityScore,
      updatedAt: row.updatedAt.toISOString(),
      workspaceName,
    };
  });
