// Paramètres server fns (B5, 2026-08-23) — profile, subscription view,
// sourcing preferences and the workspace member list. Reads are scoped to the
// active workspace; writes go through the B1 guards (sourcing prefs and the
// member list are owner territory, profile is the caller's own).

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type SettingsData = {
  profile: {
    name: string;
    email: string;
    locale: string;
    emailVerified: boolean;
    twoFactorEnabled: boolean;
    themeColor: string;
  };
  workspace: { id: string; name: string; role: string; type: string };
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
  /** Owner-only (empty for other roles): the workspace's members, with the
   *  managerial usage view (B6) — requests in 24h and lifetime, per member. */
  members: Array<{
    memberId: string;
    userId: string;
    name: string;
    email: string;
    role: string;
    usedToday: number;
    usedTotal: number;
  }>;
  /** Owner-only: pending invitations. */
  invitations: Array<{ id: string; email: string; role: string; expiresAt: string }>;
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
      // ADR-001: only DISCOVERY-role sources are workspace-selectable —
      // verification sources (registries) never appear in workspace settings.
      db.query.dataSource.findMany({
        where: (t, { and: andOp }) => andOp(eq(t.enabled, true), eq(t.role, "discovery")),
      }),
      db.query.sourcingRules.findFirst({
        where: eq(schema.sourcingRules.organizationId, caller.workspaceId),
      }),
    ]);
    if (!user || !workspace) return null;

    const { and, gte, sql } = await import("drizzle-orm");
    const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const members =
      caller.role === "owner"
        ? (
            await db
              .select({
                memberId: schema.member.id,
                userId: schema.user.id,
                name: schema.user.name,
                email: schema.user.email,
                role: schema.member.role,
                usedToday: sql<number>`(
                  select count(*)::int from ${schema.request}
                  where ${schema.request.createdBy} = ${schema.user.id}
                    and ${schema.request.organizationId} = ${caller.workspaceId}
                    and ${schema.request.createdAt} >= ${windowStart}
                )`,
                usedTotal: sql<number>`(
                  select count(*)::int from ${schema.request}
                  where ${schema.request.createdBy} = ${schema.user.id}
                    and ${schema.request.organizationId} = ${caller.workspaceId}
                )`,
              })
              .from(schema.member)
              .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
              .where(eq(schema.member.organizationId, caller.workspaceId))
          ).sort((a, b) => a.name.localeCompare(b.name))
        : [];

    const invitations =
      caller.role === "owner"
        ? (
            await db.query.invitation.findMany({
              where: and(
                eq(schema.invitation.organizationId, caller.workspaceId),
                eq(schema.invitation.status, "pending"),
                gte(schema.invitation.expiresAt, new Date()),
              ),
            })
          ).map((row) => ({
            id: row.id,
            email: row.email,
            role: row.role ?? "buyer",
            expiresAt: row.expiresAt.toISOString(),
          }))
        : [];

    return {
      profile: {
        name: user.name,
        email: user.email,
        locale: user.locale ?? "fr",
        emailVerified: user.emailVerified,
        twoFactorEnabled: user.twoFactorEnabled,
        themeColor: user.themeColor ?? "gold",
      },
      workspace: {
        id: workspace.id,
        name: workspace.name,
        role: caller.role,
        type: workspace.type,
      },
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
      invitations,
    };
  },
);

/** The caller edits their own profile — name and language (server-persisted). */
/** Persist the DESIGN chosen from the header (2026-08-29). Its own fn rather
 *  than updateProfileFn: the toggle knows the design and nothing else, and
 *  should not have to round-trip a whole profile to save one field. The
 *  cookie is what the SERVER reads on the next request — this is what makes
 *  the choice follow the person to another device. Anonymous visitors keep
 *  the cookie alone and never call this. */
export const setDesignFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ design: z.enum(["light", "dark"]) }))
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
      .set({ design: data.design, updatedAt: new Date() })
      .where(eq(schema.user.id, caller.userId));
    // The design rides the session — purge the cached copy so the next
    // getSessionFn sees the new value without waiting for expiry (same rule
    // as the accent in updateProfileFn below).
    const { secondaryStorage } = await import("@/server/kv");
    if (secondaryStorage) {
      const sessions = await db.query.session.findMany({
        where: eq(schema.session.userId, caller.userId),
        columns: { token: true },
      });
      for (const row of sessions) await secondaryStorage.delete(row.token);
    }
    return { ok: true };
  });

export const updateProfileFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      name: z.string().trim().min(2).max(80),
      locale: z.enum(["fr", "en"]),
      themeColor: z.enum(["gold", "emerald", "ocean", "violet", "crimson"]).optional(),
      design: z.enum(["light", "dark"]).optional(),
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
      .set({
        name: data.name,
        locale: data.locale,
        ...(data.themeColor ? { themeColor: data.themeColor } : {}),
        ...(data.design ? { design: data.design } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.user.id, caller.userId));
    // The theme rides the session — purge the cached copy so the next
    // getSession sees the new value without waiting for expiry.
    const { secondaryStorage } = await import("@/server/kv");
    if (secondaryStorage && (data.themeColor || data.design)) {
      const sessions = await db.query.session.findMany({
        where: eq(schema.session.userId, caller.userId),
        columns: { token: true },
      });
      for (const s of sessions) await secondaryStorage.delete(s.token);
    }
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

    // ADR-001: a workspace can only activate DISCOVERY-role sources —
    // verification ids in the payload are dropped, never stored.
    const { and, eq, inArray } = await import("drizzle-orm");
    let activatedSourceIds = data.activatedSourceIds;
    if (activatedSourceIds && activatedSourceIds.length > 0) {
      const discovery = await db.query.dataSource.findMany({
        where: and(
          eq(schema.dataSource.role, "discovery"),
          inArray(schema.dataSource.id, activatedSourceIds),
        ),
        columns: { id: true },
      });
      activatedSourceIds = discovery.map((s) => s.id);
    }

    await db
      .insert(schema.sourcingRules)
      .values({
        id: crypto.randomUUID(),
        organizationId: caller.workspaceId,
        activatedSourceIds,
        countryMode: data.countryMode,
        countryCodes: data.countryMode === "list" ? data.countryCodes : null,
        updatedBy: caller.userId,
      })
      .onConflictDoUpdate({
        target: schema.sourcingRules.organizationId,
        set: {
          activatedSourceIds,
          countryMode: data.countryMode,
          countryCodes: data.countryMode === "list" ? data.countryCodes : null,
          updatedBy: caller.userId,
          updatedAt: new Date(),
        },
      });
    const { logAudit } = await import("@/server/audit");
    const workspace = await db.query.organization.findFirst({
      where: eq(schema.organization.id, caller.workspaceId),
      columns: { name: true },
    });
    await logAudit({
      actorId: caller.userId,
      actorName: caller.userName,
      organizationId: caller.workspaceId,
      organizationName: workspace?.name ?? null,
      action: "sourcing.updated",
      detail: { countryMode: data.countryMode, countryCodes: data.countryCodes },
    });
    return { ok: true };
  });

/** Organisation profile (owner, 2026-08-26) — legal & tax identity of a
 *  non-individual workspace. Any member reads; only the owner writes. */
export type OrganizationProfileData = {
  legalName: string;
  website: string;
  phone: string;
  addressLine: string;
  city: string;
  postalCode: string;
  countryCode: string;
  registrationNumber: string;
  taxId: string;
};

const EMPTY_ORG_PROFILE: OrganizationProfileData = {
  legalName: "",
  website: "",
  phone: "",
  addressLine: "",
  city: "",
  postalCode: "",
  countryCode: "",
  registrationNumber: "",
  taxId: "",
};

export const getOrganizationProfileFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<OrganizationProfileData> => {
    const [{ requireWorkspaceRole }, { getRequest }, { db }, { eq }, schema] = await Promise.all([
      import("@/server/workspace-guard"),
      import("@tanstack/react-start/server"),
      import("@/database"),
      import("drizzle-orm"),
      import("@/database/schema"),
    ]);
    const caller = await requireWorkspaceRole(getRequest().headers, "viewer");
    if (!caller) return EMPTY_ORG_PROFILE;

    const row = await db.query.organizationProfile.findFirst({
      where: eq(schema.organizationProfile.organizationId, caller.workspaceId),
    });
    if (!row) return EMPTY_ORG_PROFILE;
    return {
      legalName: row.legalName ?? "",
      website: row.website ?? "",
      phone: row.phone ?? "",
      addressLine: row.addressLine ?? "",
      city: row.city ?? "",
      postalCode: row.postalCode ?? "",
      countryCode: row.countryCode ?? "",
      registrationNumber: row.registrationNumber ?? "",
      taxId: row.taxId ?? "",
    };
  },
);

export const updateOrganizationProfileFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      legalName: z.string().trim().max(160),
      website: z.string().trim().max(200),
      phone: z.string().trim().max(40),
      addressLine: z.string().trim().max(200),
      city: z.string().trim().max(80),
      postalCode: z.string().trim().max(20),
      countryCode: z.string().trim().toUpperCase().max(2),
      registrationNumber: z.string().trim().max(60),
      taxId: z.string().trim().max(60),
    }),
  )
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const [{ requireWorkspaceRole }, { getRequest }, { db }, schema] = await Promise.all([
      import("@/server/workspace-guard"),
      import("@tanstack/react-start/server"),
      import("@/database"),
      import("@/database/schema"),
    ]);
    // Owner-only writes — everyone else is read-only by design.
    const caller = await requireWorkspaceRole(getRequest().headers, "owner");
    if (!caller) return { ok: false };

    const nullable = (value: string) => (value === "" ? null : value);
    const columns = {
      legalName: nullable(data.legalName),
      website: nullable(data.website),
      phone: nullable(data.phone),
      addressLine: nullable(data.addressLine),
      city: nullable(data.city),
      postalCode: nullable(data.postalCode),
      countryCode: nullable(data.countryCode),
      registrationNumber: nullable(data.registrationNumber),
      taxId: nullable(data.taxId),
      updatedBy: caller.userId,
      updatedAt: new Date(),
    };
    await db
      .insert(schema.organizationProfile)
      .values({ id: crypto.randomUUID(), organizationId: caller.workspaceId, ...columns })
      .onConflictDoUpdate({ target: schema.organizationProfile.organizationId, set: columns });
    const { logAudit } = await import("@/server/audit");
    const { eq } = await import("drizzle-orm");
    const workspace = await db.query.organization.findFirst({
      where: eq(schema.organization.id, caller.workspaceId),
      columns: { name: true },
    });
    await logAudit({
      actorId: caller.userId,
      actorName: caller.userName,
      organizationId: caller.workspaceId,
      organizationName: workspace?.name ?? null,
      action: "org_profile.updated",
    });
    return { ok: true };
  });

/** Destroy the whole workspace account (owner capability, 2026-08-26):
 *  the workspace and all its data go; members whose only workspace this was
 *  lose their accounts (org-signup owners included). The typed name must
 *  match — a destructive action never rides a single click. */
export const destroyWorkspaceFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ confirmName: z.string().trim().min(1).max(200) }))
  .handler(async ({ data }): Promise<{ ok: boolean; selfDeleted: boolean }> => {
    const [{ requireWorkspaceRole }, { getRequest }, { db }, { eq }, schema] = await Promise.all([
      import("@/server/workspace-guard"),
      import("@tanstack/react-start/server"),
      import("@/database"),
      import("drizzle-orm"),
      import("@/database/schema"),
    ]);
    const caller = await requireWorkspaceRole(getRequest().headers, "owner");
    if (!caller) return { ok: false, selfDeleted: false };

    const workspace = await db.query.organization.findFirst({
      where: eq(schema.organization.id, caller.workspaceId),
    });
    if (!workspace || workspace.type === "internal") return { ok: false, selfDeleted: false };
    if (data.confirmName.trim() !== workspace.name) return { ok: false, selfDeleted: false };

    const { destroyWorkspace } = await import("@/server/account");
    const actorName = (await db.query.user.findFirst({ where: eq(schema.user.id, caller.userId) }))
      ?.name;
    const deleted = await destroyWorkspace(caller.workspaceId, {
      actorId: caller.userId,
      actorName: actorName ?? caller.userId,
    });
    if (deleted === null) return { ok: false, selfDeleted: false };

    // Did the caller's own account go with it? (No remaining user row.)
    const stillExists = await db.query.user.findFirst({
      where: eq(schema.user.id, caller.userId),
      columns: { id: true },
    });
    return { ok: true, selfDeleted: !stillExists };
  });

/** Workspace rename (E2 gap closed 2026-08-27) — owner-only, enterprise
 *  workspaces only: personal workspaces are named after the person, and the
 *  internal OSI workspace's name is product identity. Enterprise names stay
 *  unique (same rule as the signup fork; the partial unique index of
 *  migration 0025 is the race-proof backstop). */
export const renameWorkspaceFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ name: z.string().trim().min(2).max(80) }))
  .handler(async ({ data }): Promise<{ ok: boolean; error?: "name_taken" | "forbidden" }> => {
    const [{ requireWorkspaceRole }, { getRequest }, { db }, { and, eq, ne, sql }, schema] =
      await Promise.all([
        import("@/server/workspace-guard"),
        import("@tanstack/react-start/server"),
        import("@/database"),
        import("drizzle-orm"),
        import("@/database/schema"),
      ]);
    const caller = await requireWorkspaceRole(getRequest().headers, "owner");
    if (!caller) return { ok: false, error: "forbidden" };

    const workspace = await db.query.organization.findFirst({
      where: eq(schema.organization.id, caller.workspaceId),
    });
    if (!workspace || workspace.type !== "enterprise") return { ok: false, error: "forbidden" };
    if (workspace.name === data.name) return { ok: true };

    const taken = await db.query.organization.findFirst({
      where: and(
        sql`lower(${schema.organization.name}) = ${data.name.toLowerCase()}`,
        ne(schema.organization.id, workspace.id),
      ),
      columns: { id: true },
    });
    if (taken) return { ok: false, error: "name_taken" };

    await db
      .update(schema.organization)
      .set({ name: data.name })
      .where(eq(schema.organization.id, workspace.id));
    const { logAudit } = await import("@/server/audit");
    await logAudit({
      actorId: caller.userId,
      actorName: caller.userName,
      organizationId: workspace.id,
      organizationName: data.name,
      action: "workspace.renamed",
      target: data.name,
      detail: { from: workspace.name, to: data.name },
    });
    return { ok: true };
  });
