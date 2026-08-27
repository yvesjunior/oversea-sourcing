// Customer accounts for the staff view (`/interne/clients`, 2026-08-26) —
// every workspace that is NOT the internal one, with its type, owner, plan
// and usage. Account-centric on purpose: /interne/utilisateurs manages
// PEOPLE; this screen reads ACCOUNTS (individual vs organisation).

import { createServerFn } from "@tanstack/react-start";

export type CustomerAccountView = {
  id: string;
  name: string;
  type: string;
  ownerName: string | null;
  ownerEmail: string | null;
  members: number;
  /** Plan code, or null when the workspace runs on the env fallback. */
  planCode: string | null;
  requestsTotal: number;
  createdAt: string;
};

export const getCustomerAccountsFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<CustomerAccountView[]> => {
    const [{ auth }, { getRequest }, { hasPlatformFeature }] = await Promise.all([
      import("@/server/auth"),
      import("@tanstack/react-start/server"),
      import("@/lib/roles"),
    ]);
    const session = await auth.api.getSession({ headers: getRequest().headers });
    if (!session || !hasPlatformFeature(session.user.platformRole, "clients")) return [];

    const [{ db }, { desc, ne, sql }, schema] = await Promise.all([
      import("@/database"),
      import("drizzle-orm"),
      import("@/database/schema"),
    ]);

    const rows = await db
      .select({
        id: schema.organization.id,
        name: schema.organization.name,
        type: schema.organization.type,
        createdAt: schema.organization.createdAt,
        // Correlated subqueries use QUALIFIED raw identifiers on purpose:
        // interpolating schema.organization.id here renders an unqualified
        // "id", which Postgres rejects as ambiguous inside the subquery.
        ownerName: sql<string | null>`(
          select u.name from "member" m
          join "user" u on u.id = m.user_id
          where m.organization_id = "organization"."id" and m.role = 'owner'
          limit 1
        )`,
        ownerEmail: sql<string | null>`(
          select u.email from "member" m
          join "user" u on u.id = m.user_id
          where m.organization_id = "organization"."id" and m.role = 'owner'
          limit 1
        )`,
        members: sql<number>`(
          select count(*)::int from "member" m
          where m.organization_id = "organization"."id"
        )`,
        planCode: sql<string | null>`(
          select p.code from "subscription" s
          join "plan" p on p.id = s.plan_id
          where s.organization_id = "organization"."id" and s.status = 'active'
          limit 1
        )`,
        requestsTotal: sql<number>`(
          select count(*)::int from "request" r
          where r.organization_id = "organization"."id"
        )`,
      })
      .from(schema.organization)
      // A CUSTOMER account = not the internal workspace, and not a staff
      // member's personal workspace (owner feedback 2026-08-26: listing
      // those made "Clients" a mirror of "Utilisateurs"). Ownership by a
      // platform-role holder disqualifies the workspace from this screen.
      .where(
        sql`${ne(schema.organization.type, "internal")} and not exists (
          select 1 from "member" m join "user" u on u.id = m.user_id
          where m.organization_id = "organization"."id"
            and m.role = 'owner' and u.platform_role <> 'user'
        )`,
      )
      .orderBy(desc(schema.organization.createdAt));

    return rows.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
    }));
  },
);
