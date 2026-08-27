// Plan administration (manager surface). Limits are data, so changing what the
// free tier gets is an UPDATE from the UI — no deploy, no restart.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { MODEL_TIERS, type ModelTier } from "@/database/schema";

export type PlanAudience = "individual" | "organization" | "internal";

export type PlanView = {
  id: string;
  code: string;
  name: string;
  audience: PlanAudience;
  requestsPerDay: number;
  /** Lifetime cap — 0 = unlimited (Free trial = 2). */
  maxRequestsTotal: number;
  /** Seats — 0 = unlimited/custom. */
  maxMembers: number;
  quotaScope: "workspace" | "user";
  suppliersReturned: number;
  modelTier: ModelTier;
  /** Workspaces currently on this plan. */
  workspaces: number;
  updatedAt: string;
  updatedByName: string | null;
};

export type WorkspaceSubscriptionView = {
  organizationId: string;
  organizationName: string;
  planCode: string;
  /** Requests made in the last rolling 24h. */
  usedToday: number;
};

export type PlanAdminData = { plans: PlanView[]; workspaces: WorkspaceSubscriptionView[] };

const EMPTY: PlanAdminData = { plans: [], workspaces: [] };

/** owner|manager only — the feature gate lives in src/lib/roles.ts. */
async function requirePlanAdmin() {
  const [{ auth }, { getRequest }, { hasPlatformFeature }] = await Promise.all([
    import("@/server/auth"),
    import("@tanstack/react-start/server"),
    import("@/lib/roles"),
  ]);
  const session = await auth.api.getSession({ headers: getRequest().headers });
  if (!session || !hasPlatformFeature(session.user.platformRole, "plans")) return null;
  return session;
}

export const getPlanAdminFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<PlanAdminData> => {
    const session = await requirePlanAdmin();
    if (!session) return EMPTY;

    const [{ db }, { and, count, eq, gte, sql }, schema] = await Promise.all([
      import("@/database"),
      import("drizzle-orm"),
      import("@/database/schema"),
    ]);

    const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [plans, planCounts, workspaces] = await Promise.all([
      db
        .select({
          id: schema.plan.id,
          code: schema.plan.code,
          name: schema.plan.name,
          audience: schema.plan.audience,
          requestsPerDay: schema.plan.requestsPerDay,
          maxRequestsTotal: schema.plan.maxRequestsTotal,
          maxMembers: schema.plan.maxMembers,
          quotaScope: schema.plan.quotaScope,
          suppliersReturned: schema.plan.suppliersReturned,
          modelTier: schema.plan.modelTier,
          updatedAt: schema.plan.updatedAt,
          updatedByName: schema.user.name,
        })
        .from(schema.plan)
        .leftJoin(schema.user, eq(schema.user.id, schema.plan.updatedBy))
        .orderBy(schema.plan.position),
      // Counted with a GROUP BY rather than a correlated subquery: one scan
      // instead of one per plan, and no reliance on how the sql template
      // renders a table reference inside a subquery.
      db
        .select({ planId: schema.subscription.planId, value: count() })
        .from(schema.subscription)
        .groupBy(schema.subscription.planId),
      db
        .select({
          organizationId: schema.organization.id,
          organizationName: schema.organization.name,
          planCode: schema.plan.code,
          usedToday: sql<number>`(
            select count(*)::int from ${schema.request}
            where ${schema.request.organizationId} = ${schema.organization.id}
              and ${schema.request.createdAt} >= ${windowStart}
          )`,
        })
        .from(schema.organization)
        .leftJoin(
          schema.subscription,
          eq(schema.subscription.organizationId, schema.organization.id),
        )
        .leftJoin(schema.plan, eq(schema.plan.id, schema.subscription.planId))
        .orderBy(schema.organization.name),
    ]);

    const countByPlan = new Map(planCounts.map((row) => [row.planId, row.value]));

    return {
      plans: plans.map((p) => ({
        ...p,
        workspaces: countByPlan.get(p.id) ?? 0,
        updatedAt: p.updatedAt.toISOString(),
        updatedByName: p.updatedByName ?? null,
      })),
      workspaces: workspaces.map((w) => ({ ...w, planCode: w.planCode ?? "—" })),
    };
  },
);

/** Edit a plan's limits. Ranges mirror sourcing-config so the UI cannot ask for
 *  a supplier count the research agent will not honour. */
export const updatePlanFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      id: z.string(),
      // 0 = unlimited; capped so a typo cannot commit thousands of requests/day.
      requestsPerDay: z.number().int().min(0).max(500),
      // Lifetime trial cap — 0 = unlimited; bounded like the daily quota.
      maxRequestsTotal: z.number().int().min(0).max(500),
      // Seats — 0 = unlimited/custom; bounded so a typo cannot sell 10k seats.
      maxMembers: z.number().int().min(0).max(500),
      quotaScope: z.enum(["workspace", "user"]),
      suppliersReturned: z.number().int().min(1).max(20),
      modelTier: z.enum(MODEL_TIERS),
    }),
  )
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const session = await requirePlanAdmin();
    if (!session) return { ok: false };

    const [{ db }, { eq }, schema] = await Promise.all([
      import("@/database"),
      import("drizzle-orm"),
      import("@/database/schema"),
    ]);
    await db
      .update(schema.plan)
      .set({
        requestsPerDay: data.requestsPerDay,
        maxRequestsTotal: data.maxRequestsTotal,
        maxMembers: data.maxMembers,
        quotaScope: data.quotaScope,
        suppliersReturned: data.suppliersReturned,
        modelTier: data.modelTier,
        // Cheap stand-in for an audit log: "who dropped the free tier to 0"
        // must have an answer.
        updatedBy: session.user.id,
        updatedAt: new Date(),
      })
      .where(eq(schema.plan.id, data.id));
    return { ok: true };
  });

/** Move a workspace onto a plan (creates the subscription if absent). */
export const assignPlanFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ organizationId: z.string(), planCode: z.string() }))
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const session = await requirePlanAdmin();
    if (!session) return { ok: false };

    const [{ db }, { eq }, schema] = await Promise.all([
      import("@/database"),
      import("drizzle-orm"),
      import("@/database/schema"),
    ]);
    const plan = await db.query.plan.findFirst({ where: eq(schema.plan.code, data.planCode) });
    if (!plan) return { ok: false };

    // Audience ↔ account-type enforcement (owner, 2026-08-26): individual
    // plans fit individual workspaces, organization plans fit enterprise
    // (and the internal org). Internal-audience plans stay a free staff
    // call — prod precedent: the platform owner's personal workspace runs
    // on `internal` since 2026-08-20.
    const workspace = await db.query.organization.findFirst({
      where: eq(schema.organization.id, data.organizationId),
    });
    if (!workspace) return { ok: false };
    const compatible =
      plan.audience === "internal" ||
      (plan.audience === "organization"
        ? workspace.type === "enterprise" || workspace.type === "internal"
        : workspace.type === "individual");
    if (!compatible) {
      console.warn(
        `assignPlan: refused ${plan.code} (${plan.audience}) on ${workspace.name} (${workspace.type})`,
      );
      return { ok: false };
    }

    await db
      .insert(schema.subscription)
      .values({
        id: crypto.randomUUID(),
        organizationId: data.organizationId,
        planId: plan.id,
        status: "active",
      })
      .onConflictDoUpdate({
        target: schema.subscription.organizationId,
        set: { planId: plan.id, status: "active", updatedAt: new Date() },
      });
    return { ok: true };
  });
