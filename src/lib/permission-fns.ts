// The Rôles & accès matrix (owner request 2026-08-28) — staff access is
// data: what MANAGER and ACCOUNTANT may do lives in `platform_permission`,
// toggled here by the platform OWNER only (who always has everything and is
// never a row). Every toggle is audited.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { BUILT_IN_STAFF_ROLES, PERMISSION_KEYS, type PermissionKey } from "@/lib/roles";

/** A column of the matrix. Built-ins cannot be deleted; custom ones can. */
export type StaffRole = { name: string; label: string; builtIn: boolean };

export type PermissionMatrix = {
  keys: PermissionKey[];
  /** Built-ins first, then the owner's own roles, alphabetical. */
  roles: StaffRole[];
  /** grants[role][key] — true when granted. */
  grants: Record<string, Record<string, boolean>>;
} | null;

/** Slug rules for a role name: it is stored on `user.platform_role` and on
 *  every permission row, so it must be stable, lowercase and free of the
 *  separators those keys use. */
export function slugifyRoleName(label: string): string {
  return label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

/** Names the role system reserves — taking one would either collide with a
 *  built-in or, for `owner`/`user`, create a role the resolver short-circuits
 *  before it ever reads the table. */
export const RESERVED_ROLE_NAMES = ["owner", "user", ...BUILT_IN_STAFF_ROLES] as const;

export const getPermissionMatrixFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<PermissionMatrix> => {
    const [{ auth }, { getRequest }] = await Promise.all([
      import("@/server/auth"),
      import("@tanstack/react-start/server"),
    ]);
    const session = await auth.api.getSession({ headers: getRequest().headers });
    if (!session) return null;
    const { effectivePlatformRole } = await import("@/server/workspace-guard");
    if ((await effectivePlatformRole(session)) !== "owner") return null;

    const [{ grantedFeatures }, { db }, schema] = await Promise.all([
      import("@/server/permissions"),
      import("@/database"),
      import("@/database/schema"),
    ]);
    const custom = await db.select().from(schema.platformRoleTable);
    const roles: StaffRole[] = [
      ...BUILT_IN_STAFF_ROLES.map((name) => ({ name, label: name, builtIn: true })),
      ...custom
        .map((row) => ({ name: row.name, label: row.label, builtIn: false }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    ];

    const asMap = (granted: PermissionKey[]) =>
      Object.fromEntries(PERMISSION_KEYS.map((k) => [k, granted.includes(k)]));
    const grants: Record<string, Record<string, boolean>> = {};
    for (const role of roles) grants[role.name] = asMap(await grantedFeatures(role.name));

    return { keys: [...PERMISSION_KEYS], roles, grants };
  },
);

export const updatePermissionFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      feature: z
        .string()
        .refine((k): k is PermissionKey => PERMISSION_KEYS.includes(k as PermissionKey)),
      // Any role EXCEPT owner/user: the owner always has everything and a
      // plain user never does, so a row for either would be dead weight the
      // resolver ignores — and an owner row could imply it is revocable.
      role: z.string().min(1).max(32),
      enabled: z.boolean(),
    }),
  )
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const [{ auth }, { getRequest }] = await Promise.all([
      import("@/server/auth"),
      import("@tanstack/react-start/server"),
    ]);
    const session = await auth.api.getSession({ headers: getRequest().headers });
    if (!session) return { ok: false };
    const { effectivePlatformRole } = await import("@/server/workspace-guard");
    if ((await effectivePlatformRole(session)) !== "owner") return { ok: false };

    const [{ db }, { eq }, schema] = await Promise.all([
      import("@/database"),
      import("drizzle-orm"),
      import("@/database/schema"),
    ]);
    // The role must be a real one: a built-in, or one the owner created. A
    // typo would otherwise write a permission row for a role nobody holds.
    const isBuiltIn = (BUILT_IN_STAFF_ROLES as readonly string[]).includes(data.role);
    if (!isBuiltIn) {
      const exists = await db.query.platformRoleTable.findFirst({
        where: eq(schema.platformRoleTable.name, data.role),
      });
      if (!exists) return { ok: false };
    }
    await db
      .insert(schema.platformPermission)
      .values({
        feature: data.feature,
        role: data.role,
        enabled: data.enabled,
        updatedBy: session.user.id,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [schema.platformPermission.feature, schema.platformPermission.role],
        set: { enabled: data.enabled, updatedBy: session.user.id, updatedAt: new Date() },
      });
    const { bustPermissionsCache } = await import("@/server/permissions");
    bustPermissionsCache();

    const { logAudit, actorOf } = await import("@/server/audit");
    await logAudit({
      ...actorOf(session),
      action: "permission.updated",
      target: `${data.role}:${data.feature}`,
      detail: { role: data.role, feature: data.feature, enabled: data.enabled },
    });
    return { ok: true };
  });

/**
 * Create a staff role (Phase R, owner-only).
 *
 * The role is a NAME and nothing else: what it may do lives in
 * `platform_permission`, and a fresh role matches no default, so it starts
 * with **nothing** granted. That is deliberate — inheriting manager's access
 * would make "create a role" a way to hand out powers by accident.
 */
export const createStaffRoleFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ label: z.string().trim().min(2).max(40) }))
  .handler(
    async ({
      data,
    }): Promise<
      { ok: true; name: string } | { ok: false; reason: "forbidden" | "reserved" | "exists" }
    > => {
      const [{ auth }, { getRequest }] = await Promise.all([
        import("@/server/auth"),
        import("@tanstack/react-start/server"),
      ]);
      const session = await auth.api.getSession({ headers: getRequest().headers });
      if (!session) return { ok: false, reason: "forbidden" };
      // Role granting is OWNER-ONLY, forever: a role that can grant roles can
      // promote itself, so this check is never delegated to a permission key.
      const { effectivePlatformRole } = await import("@/server/workspace-guard");
      if ((await effectivePlatformRole(session)) !== "owner") {
        return { ok: false, reason: "forbidden" };
      }

      const name = slugifyRoleName(data.label);
      if (!name) return { ok: false, reason: "reserved" };
      if ((RESERVED_ROLE_NAMES as readonly string[]).includes(name)) {
        return { ok: false, reason: "reserved" };
      }

      const [{ db }, { eq }, schema] = await Promise.all([
        import("@/database"),
        import("drizzle-orm"),
        import("@/database/schema"),
      ]);
      const existing = await db.query.platformRoleTable.findFirst({
        where: eq(schema.platformRoleTable.name, name),
      });
      if (existing) return { ok: false, reason: "exists" };

      await db.insert(schema.platformRoleTable).values({
        name,
        label: data.label.trim(),
        createdBy: session.user.id,
        createdByName: session.user.name,
      });

      const { logAudit, actorOf } = await import("@/server/audit");
      await logAudit({
        ...actorOf(session),
        action: "role.created",
        target: name,
        detail: { label: data.label.trim() },
      });
      return { ok: true, name };
    },
  );

/**
 * Delete a staff role (owner-only).
 *
 * REFUSED while anyone still holds it. Silently demoting those accounts to
 * `user` would strip people of access in a screen that is about roles, not
 * about users — the owner reassigns them first, deliberately. Built-ins cannot
 * be deleted at all: the code's defaults refer to them.
 */
export const deleteStaffRoleFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ name: z.string().min(1).max(32) }))
  .handler(
    async ({
      data,
    }): Promise<
      | { ok: true }
      | { ok: false; reason: "forbidden" | "built_in" | "not_found" | "in_use"; holders?: number }
    > => {
      const [{ auth }, { getRequest }] = await Promise.all([
        import("@/server/auth"),
        import("@tanstack/react-start/server"),
      ]);
      const session = await auth.api.getSession({ headers: getRequest().headers });
      if (!session) return { ok: false, reason: "forbidden" };
      const { effectivePlatformRole } = await import("@/server/workspace-guard");
      if ((await effectivePlatformRole(session)) !== "owner") {
        return { ok: false, reason: "forbidden" };
      }
      if ((RESERVED_ROLE_NAMES as readonly string[]).includes(data.name)) {
        return { ok: false, reason: "built_in" };
      }

      const [{ db }, { count, eq }, schema] = await Promise.all([
        import("@/database"),
        import("drizzle-orm"),
        import("@/database/schema"),
      ]);
      const role = await db.query.platformRoleTable.findFirst({
        where: eq(schema.platformRoleTable.name, data.name),
      });
      if (!role) return { ok: false, reason: "not_found" };

      const [holders] = await db
        .select({ value: count() })
        .from(schema.user)
        .where(eq(schema.user.platformRole, data.name));
      if ((holders?.value ?? 0) > 0) {
        return { ok: false, reason: "in_use", holders: holders?.value ?? 0 };
      }

      // The permission rows go with it: leaving them would silently re-arm the
      // role if the same name were ever created again.
      await db
        .delete(schema.platformPermission)
        .where(eq(schema.platformPermission.role, data.name));
      await db.delete(schema.platformRoleTable).where(eq(schema.platformRoleTable.name, data.name));

      const { bustPermissionsCache } = await import("@/server/permissions");
      bustPermissionsCache();
      const { logAudit, actorOf } = await import("@/server/audit");
      await logAudit({
        ...actorOf(session),
        action: "role.deleted",
        target: data.name,
        detail: { label: role.label },
      });
      return { ok: true };
    },
  );

/** The staff roles a user may be assigned — built-ins plus the owner's own.
 *  Feeds the role picker on /interne/utilisateurs. */
export const getAssignableRolesFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<StaffRole[]> => {
    const [{ auth }, { getRequest }] = await Promise.all([
      import("@/server/auth"),
      import("@tanstack/react-start/server"),
    ]);
    const session = await auth.api.getSession({ headers: getRequest().headers });
    if (!session) return [];
    const { effectiveHasPermission } = await import("@/server/workspace-guard");
    if (!(await effectiveHasPermission(session, "users"))) return [];

    const [{ db }, schema] = await Promise.all([import("@/database"), import("@/database/schema")]);
    const custom = await db.select().from(schema.platformRoleTable);
    return [
      ...BUILT_IN_STAFF_ROLES.map((name) => ({ name, label: name, builtIn: true })),
      ...custom
        .map((row) => ({ name: row.name, label: row.label, builtIn: false }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    ];
  },
);
