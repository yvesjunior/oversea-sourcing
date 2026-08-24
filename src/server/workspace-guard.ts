// The enforcement backbone (B1, 2026-08-23): every mutating server function
// calls one of these before touching data.
//
// Two deliberate properties:
// - The membership is RE-READ per call, never trusted from the session. A user
//   removed from a workspace (or demoted) loses the power on their very next
//   request — no session invalidation machinery needed.
// - Guards return null instead of throwing: server fns answer "forbidden" the
//   same way they answer "not found", and the caller decides the envelope.

import { and, eq } from "drizzle-orm";
import { db } from "@/database";
import * as schema from "@/database/schema";
import { hasWorkspaceRole, type RequiredWorkspaceRole } from "@/lib/workspace-roles";

export type WorkspaceMembership = {
  userId: string;
  workspaceId: string;
  role: string;
};

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
  workspaceId: string;
  role: string;
  locale: string;
  platformRole: string;
} | null> {
  const { auth } = await import("@/server/auth");
  const session = await auth.api.getSession({ headers });
  const workspaceId = session?.session.activeOrganizationId;
  if (!session || !workspaceId) return null;
  const membership = await requireMember(session.user.id, workspaceId, min);
  if (!membership) return null;
  return {
    userId: session.user.id,
    workspaceId,
    role: membership.role,
    locale: session.user.locale ?? "fr",
    platformRole: session.user.platformRole ?? "user",
  };
}
