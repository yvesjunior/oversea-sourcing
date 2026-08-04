import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { RequestStatus } from "@/database/schema";

/** Shape the UI consumes; E3 will extend (criteria, pipeline progress…). */
export type RequestSummary = {
  id: string;
  title: string;
  status: RequestStatus;
  compatibilityScore: number | null;
  /** ISO timestamp */
  updatedAt: string;
};

/** The logged-in user's sourcing requests, newest first — straight from the DB.
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
    if (!workspaceId) return [];

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

    return rows.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() }));
  },
);

/** A single request, workspace-scoped (null when absent or not yours). */
export const getRequestFn = createServerFn({ method: "GET" })
  .inputValidator(z.object({ id: z.string() }))
  .handler(async ({ data }): Promise<RequestSummary | null> => {
    const [{ auth }, { getRequest }, { db }, { and, eq }, schema] = await Promise.all([
      import("@/server/auth"),
      import("@tanstack/react-start/server"),
      import("@/database"),
      import("drizzle-orm"),
      import("@/database/schema"),
    ]);
    const session = await auth.api.getSession({ headers: getRequest().headers });
    const workspaceId = session?.session.activeOrganizationId;
    if (!workspaceId) return null;

    const row = await db.query.request.findFirst({
      where: and(eq(schema.request.id, data.id), eq(schema.request.organizationId, workspaceId)),
    });
    if (!row) return null;
    return {
      id: row.id,
      title: row.title,
      status: row.status,
      compatibilityScore: row.compatibilityScore,
      updatedAt: row.updatedAt.toISOString(),
    };
  });
