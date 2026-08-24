// Workspace membership queries (B2, 2026-08-23) — feeds the top-bar switcher.

import { createServerFn } from "@tanstack/react-start";

export type WorkspaceSummary = {
  id: string;
  name: string;
  /** The caller's role in it: owner | buyer | viewer (legacy admin possible). */
  role: string;
  /** The session's active workspace — where the caller is "standing". */
  active: boolean;
};

/** Every workspace the caller belongs to. Empty array when anonymous. */
export const getMyWorkspacesFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<WorkspaceSummary[]> => {
    const [{ auth }, { getRequest }, { db }, { eq }, schema] = await Promise.all([
      import("@/server/auth"),
      import("@tanstack/react-start/server"),
      import("@/database"),
      import("drizzle-orm"),
      import("@/database/schema"),
    ]);
    const session = await auth.api.getSession({ headers: getRequest().headers });
    if (!session) return [];
    const activeId = session.session.activeOrganizationId ?? null;

    const rows = await db
      .select({
        id: schema.organization.id,
        name: schema.organization.name,
        role: schema.member.role,
      })
      .from(schema.member)
      .innerJoin(schema.organization, eq(schema.organization.id, schema.member.organizationId))
      .where(eq(schema.member.userId, session.user.id));

    return rows
      .map((row) => ({ ...row, active: row.id === activeId }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
);
