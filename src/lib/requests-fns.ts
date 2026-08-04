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

/** YOUR sourcing requests, newest first — personal surfaces are own-workspace
 *  only for everyone ("Vos dossiers récents"). Buyers' data for employees
 *  lives on the ops surfaces (getAllRequestsFn → Facilitation). */
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

    const rows = await db
      .select({
        id: schema.request.id,
        title: schema.request.title,
        status: schema.request.status,
        compatibilityScore: schema.request.compatibilityScore,
        updatedAt: schema.request.updatedAt,
      })
      .from(schema.request)
      .where(eq(schema.request.organizationId, workspaceId))
      .orderBy(desc(schema.request.updatedAt));

    return rows.map((row) => ({
      ...row,
      updatedAt: row.updatedAt.toISOString(),
      workspaceName: null,
    }));
  },
);

/** ALL buyers' requests — the ops view (Facilitation). Only owner/manager;
 *  everyone else gets an empty list (accountant is forbidden by policy). */
export const getAllRequestsFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<RequestSummary[]> => {
    const [{ auth }, { getRequest }, { db }, { desc, eq }, schema] = await Promise.all([
      import("@/server/auth"),
      import("@tanstack/react-start/server"),
      import("@/database"),
      import("drizzle-orm"),
      import("@/database/schema"),
    ]);
    const session = await auth.api.getSession({ headers: getRequest().headers });
    if (!session || !canSeeAllRequests(session.user.platformRole)) return [];
    const ownWorkspaceId = session.session.activeOrganizationId;

    const rows = await db
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

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      compatibilityScore: row.compatibilityScore,
      updatedAt: row.updatedAt.toISOString(),
      workspaceName: row.organizationId === ownWorkspaceId ? null : row.workspaceName,
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
