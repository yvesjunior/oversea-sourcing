// The Rôles & accès matrix (owner request 2026-08-28) — staff access is
// data: what MANAGER and ACCOUNTANT may do lives in `platform_permission`,
// toggled here by the platform OWNER only (who always has everything and is
// never a row). Every toggle is audited.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { PERMISSION_KEYS, type PermissionKey } from "@/lib/roles";

export type PermissionMatrix = {
  keys: PermissionKey[];
  /** grants[role][key] — true when granted. */
  grants: Record<"manager" | "accountant", Record<string, boolean>>;
} | null;

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

    const { grantedFeatures } = await import("@/server/permissions");
    const [manager, accountant] = await Promise.all([
      grantedFeatures("manager"),
      grantedFeatures("accountant"),
    ]);
    const asMap = (granted: PermissionKey[]) =>
      Object.fromEntries(PERMISSION_KEYS.map((k) => [k, granted.includes(k)]));
    return {
      keys: [...PERMISSION_KEYS],
      grants: { manager: asMap(manager), accountant: asMap(accountant) },
    };
  },
);

export const updatePermissionFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      feature: z
        .string()
        .refine((k): k is PermissionKey => PERMISSION_KEYS.includes(k as PermissionKey)),
      role: z.enum(["manager", "accountant"]),
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

    const [{ db }, schema] = await Promise.all([import("@/database"), import("@/database/schema")]);
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
