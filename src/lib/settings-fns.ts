// Paramètres server fns (B5, 2026-08-23) — profile, subscription view,
// sourcing preferences and the workspace member list. Reads are scoped to the
// active workspace; writes go through the B1 guards (sourcing prefs and the
// member list are owner territory, profile is the caller's own).

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type SettingsData = {
  profile: { name: string; email: string; locale: string };
  workspace: { id: string; name: string; role: string };
  subscription: {
    planCode: string;
    planName: string;
    requestsPerDay: number;
    maxRequestsTotal: number;
    maxMembers: number;
    quotaScope: "workspace" | "user";
    suppliersReturned: number;
    usedToday: number;
    usedTotal: number;
    seatsUsed: number;
  };
  sourcing: {
    /** The platform-enabled catalogue the workspace can activate from. */
    catalogue: Array<{ id: string; code: string; name: string }>;
    /** Null = all enabled sources (the default). */
    activatedSourceIds: string[] | null;
    countryMode: "global" | "list";
    countryCodes: string[];
  };
  /** Owner-only (empty for other roles): the workspace's members. */
  members: Array<{ userId: string; name: string; email: string; role: string }>;
} | null;

export const getSettingsFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<SettingsData> => {
    const [{ requireWorkspaceRole }, { getRequest }, { db }, { count, eq }, schema] =
      await Promise.all([
        import("@/server/workspace-guard"),
        import("@tanstack/react-start/server"),
        import("@/database"),
        import("drizzle-orm"),
        import("@/database/schema"),
      ]);
    const caller = await requireWorkspaceRole(getRequest().headers, "viewer");
    if (!caller) return null;

    const { resolvePlan, checkRequestQuota } = await import("@/server/plan");

    const [user, workspace, plan, quota, seatRow, enabledSources, rules] = await Promise.all([
      db.query.user.findFirst({ where: eq(schema.user.id, caller.userId) }),
      db.query.organization.findFirst({ where: eq(schema.organization.id, caller.workspaceId) }),
      resolvePlan(caller.workspaceId),
      checkRequestQuota(caller.workspaceId, caller.userId),
      db
        .select({ value: count() })
        .from(schema.member)
        .where(eq(schema.member.organizationId, caller.workspaceId)),
      db.query.dataSource.findMany({ where: eq(schema.dataSource.enabled, true) }),
      db.query.sourcingRules.findFirst({
        where: eq(schema.sourcingRules.organizationId, caller.workspaceId),
      }),
    ]);
    if (!user || !workspace) return null;

    const members =
      caller.role === "owner"
        ? (
            await db
              .select({
                userId: schema.user.id,
                name: schema.user.name,
                email: schema.user.email,
                role: schema.member.role,
              })
              .from(schema.member)
              .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
              .where(eq(schema.member.organizationId, caller.workspaceId))
          ).sort((a, b) => a.name.localeCompare(b.name))
        : [];

    return {
      profile: { name: user.name, email: user.email, locale: user.locale ?? "fr" },
      workspace: { id: workspace.id, name: workspace.name, role: caller.role },
      subscription: {
        planCode: plan.code,
        planName: plan.name,
        requestsPerDay: plan.requestsPerDay,
        maxRequestsTotal: plan.maxRequestsTotal,
        maxMembers: plan.maxMembers,
        quotaScope: plan.quotaScope,
        suppliersReturned: plan.suppliersReturned,
        usedToday: quota.used,
        usedTotal: quota.usedTotal,
        seatsUsed: seatRow[0]?.value ?? 0,
      },
      sourcing: {
        catalogue: enabledSources.map((s) => ({ id: s.id, code: s.code, name: s.name })),
        activatedSourceIds: rules?.activatedSourceIds ?? null,
        countryMode: rules?.countryMode ?? "global",
        countryCodes: rules?.countryCodes ?? [],
      },
      members,
    };
  },
);

/** The caller edits their own profile — name and language (server-persisted). */
export const updateProfileFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      name: z.string().trim().min(2).max(80),
      locale: z.enum(["fr", "en"]),
    }),
  )
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const [{ requireWorkspaceRole }, { getRequest }, { db }, { eq }, schema] = await Promise.all([
      import("@/server/workspace-guard"),
      import("@tanstack/react-start/server"),
      import("@/database"),
      import("drizzle-orm"),
      import("@/database/schema"),
    ]);
    const caller = await requireWorkspaceRole(getRequest().headers, "viewer");
    if (!caller) return { ok: false };

    await db
      .update(schema.user)
      .set({ name: data.name, locale: data.locale, updatedAt: new Date() })
      .where(eq(schema.user.id, caller.userId));
    return { ok: true };
  });

/** Sourcing preferences — owner only (B1 guard). Activation is workspace-wide
 *  and requests never specify a source (validated 2026-08-22). */
export const updateSourcingRulesFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      /** Null = all enabled sources. */
      activatedSourceIds: z.array(z.string()).nullable(),
      countryMode: z.enum(["global", "list"]),
      countryCodes: z.array(z.string().trim().toUpperCase().length(2)).max(30),
    }),
  )
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const [{ requireWorkspaceRole }, { getRequest }, { db }, schema] = await Promise.all([
      import("@/server/workspace-guard"),
      import("@tanstack/react-start/server"),
      import("@/database"),
      import("@/database/schema"),
    ]);
    const caller = await requireWorkspaceRole(getRequest().headers, "owner");
    if (!caller) return { ok: false };

    await db
      .insert(schema.sourcingRules)
      .values({
        id: crypto.randomUUID(),
        organizationId: caller.workspaceId,
        activatedSourceIds: data.activatedSourceIds,
        countryMode: data.countryMode,
        countryCodes: data.countryMode === "list" ? data.countryCodes : null,
        updatedBy: caller.userId,
      })
      .onConflictDoUpdate({
        target: schema.sourcingRules.organizationId,
        set: {
          activatedSourceIds: data.activatedSourceIds,
          countryMode: data.countryMode,
          countryCodes: data.countryMode === "list" ? data.countryCodes : null,
          updatedBy: caller.userId,
          updatedAt: new Date(),
        },
      });
    return { ok: true };
  });
