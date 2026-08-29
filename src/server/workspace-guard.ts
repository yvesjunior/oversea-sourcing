// The enforcement backbone (B1, 2026-08-23): every mutating server function
// calls one of these before touching data.
//
// Two deliberate properties:
// - The membership is RE-READ per call, never trusted from the session. A user
//   removed from a workspace (or demoted) loses the power on their very next
//   request — no session invalidation machinery needed.
// - Guards return null instead of throwing: server fns answer "forbidden" the
//   same way they answer "not found", and the caller decides the envelope.

import { and, count, eq } from "drizzle-orm";
import { db } from "@/database";
import * as schema from "@/database/schema";
import { hasWorkspaceRole, type RequiredWorkspaceRole } from "@/lib/workspace-roles";

export type WorkspaceMembership = {
  userId: string;
  workspaceId: string;
  role: string;
};

/**
 * The caller's EFFECTIVE platform role (owner decision 2026-08-27): staff
 * powers exist only while STANDING IN the internal workspace — the gold
 * badge is the powers. In a personal (or any customer) workspace, a staff
 * member is exactly a buyer: no INTERNE menu, no Vue globale, no
 * cross-tenant reads. Feed this to hasPlatformFeature/canSeeAllRequests
 * instead of the raw user.platformRole.
 */
export async function effectivePlatformRole(session: {
  user: { platformRole?: string | null | undefined };
  session: { activeOrganizationId?: string | null | undefined };
}): Promise<string> {
  const role = session.user.platformRole ?? "user";
  if (role === "user") return "user";
  const workspaceId = session.session.activeOrganizationId;
  if (!workspaceId) return "user";
  const workspace = await db.query.organization.findFirst({
    where: eq(schema.organization.id, workspaceId),
    columns: { type: true },
  });
  return workspace?.type === "internal" ? role : "user";
}

/**
 * True when this workspace is OSI's OWN (owner decision, 2026-08-29).
 *
 * The platform workspace exists for internal action and nothing else: staff
 * hold no requests, quotes or dossiers there, so a customer action attempted
 * from it is refused rather than quietly creating OSI-owned customer data
 * that every cross-tenant list would then carry. Staff who need to act as a
 * buyer switch to a buyer workspace — their personal one, or a shared test
 * account — where `effectivePlatformRole` already makes them an ordinary
 * buyer.
 *
 * Enforced server-side because the UI merely stops OFFERING the action; this
 * is what makes it impossible.
 */
export async function isInternalWorkspace(workspaceId: string): Promise<boolean> {
  const workspace = await db.query.organization.findFirst({
    where: eq(schema.organization.id, workspaceId),
    columns: { type: true },
  });
  return workspace?.type === "internal";
}

/** The caller's membership in a workspace, iff it grants at least `min`. */
export async function requireMember(
  userId: string,
  workspaceId: string,
  min: RequiredWorkspaceRole,
): Promise<WorkspaceMembership | null> {
  const membership = await db.query.member.findFirst({
    where: and(eq(schema.member.userId, userId), eq(schema.member.organizationId, workspaceId)),
  });
  if (!membership || !hasWorkspaceRole(membership.role, min)) return null;
  return { userId, workspaceId, role: membership.role };
}

/**
 * The whole dance in one call for server fns: session → active workspace →
 * fresh membership at `min`. Null when unauthenticated, workspace-less, not a
 * member anymore, or ranked below `min`.
 */
export async function requireWorkspaceRole(
  headers: Headers,
  min: RequiredWorkspaceRole,
): Promise<{
  userId: string;
  /** Name snapshot for audit rows — history must survive account deletion. */
  userName: string;
  workspaceId: string;
  role: string;
  locale: string;
  platformRole: string;
} | null> {
  const { auth } = await import("@/server/auth");
  const session = await auth.api.getSession({ headers });
  if (!session) return null;
  let workspaceId = session.session.activeOrganizationId;
  if (!workspaceId) {
    // Self-heal (2026-08-26): a signup's session can be created before the
    // user-create hook finishes provisioning the workspace (observed on an
    // organisation signup — active_organization_id landed NULL). The user
    // HAS a membership; adopt it, persist it on the session row, and purge
    // the Redis-cached copy so the healed value is what future getSession
    // calls see.
    const membership = await db.query.member.findFirst({
      where: eq(schema.member.userId, session.user.id),
    });
    if (!membership) return null;
    workspaceId = membership.organizationId;
    await db
      .update(schema.session)
      .set({ activeOrganizationId: workspaceId })
      .where(eq(schema.session.id, session.session.id));
    const { secondaryStorage } = await import("@/server/kv");
    if (secondaryStorage) await secondaryStorage.delete(session.session.token);
  }
  const membership = await requireMember(session.user.id, workspaceId, min);
  if (!membership) return null;
  return {
    userId: session.user.id,
    userName: session.user.name,
    workspaceId,
    role: membership.role,
    locale: session.user.locale ?? "fr",
    platformRole: session.user.platformRole ?? "user",
  };
}

/**
 * Seat cap (B8): throws when the workspace's plan has no seat left.
 * `countPending` includes pending invitations, so an owner cannot promise
 * more seats than the plan holds (invite time); at accept/add time only real
 * members count — the accepted invitation is consuming the seat it reserved.
 */
export async function assertSeatAvailable(
  workspaceId: string,
  options: { countPending: boolean },
): Promise<void> {
  const { resolvePlan, UNLIMITED } = await import("@/server/plan");
  const plan = await resolvePlan(workspaceId);
  if (plan.maxMembers === UNLIMITED) return;

  const [memberRow] = await db
    .select({ value: count() })
    .from(schema.member)
    .where(eq(schema.member.organizationId, workspaceId));
  let taken = memberRow?.value ?? 0;

  if (options.countPending) {
    const [inviteRow] = await db
      .select({ value: count() })
      .from(schema.invitation)
      .where(
        and(
          eq(schema.invitation.organizationId, workspaceId),
          eq(schema.invitation.status, "pending"),
        ),
      );
    taken += inviteRow?.value ?? 0;
  }

  if (taken >= plan.maxMembers) {
    const { APIError } = await import("better-auth/api");
    throw new APIError("FORBIDDEN", { message: "SEAT_LIMIT_REACHED" });
  }
}

/** One-call permission check for server fns (2026-08-28): effective role →
 *  the Rôles & accès matrix (owner always passes; see server/permissions.ts). */
export async function effectiveHasPermission(
  session: Parameters<typeof effectivePlatformRole>[0],
  permission: import("@/lib/roles").PermissionKey,
): Promise<boolean> {
  const { roleHasPermission } = await import("@/server/permissions");
  return roleHasPermission(await effectivePlatformRole(session), permission);
}
