// Account lifecycle helpers (2026-08-26) — the ONE place a user account is
// deleted from. Deletion must always purge better-auth's Redis-cached
// sessions (secondary storage) or the deleted account keeps a working
// session until the cache expires — found live; never delete users by raw
// SQL without going through here.

import { eq } from "drizzle-orm";
import { db } from "@/database";
import * as schema from "@/database/schema";
import { secondaryStorage } from "@/server/kv";

/** Delete a user account and purge their cached sessions. The caller is
 *  responsible for the POLICY (only users with no remaining membership and
 *  platform_role 'user' are ever auto-deleted); this owns the MECHANICS. */
export async function deleteUserAccount(
  userId: string,
  actor?: { actorId: string; actorName: string },
): Promise<void> {
  const [sessions, user] = await Promise.all([
    db.query.session.findMany({
      where: eq(schema.session.userId, userId),
      columns: { token: true },
    }),
    db.query.user.findFirst({ where: eq(schema.user.id, userId) }),
  ]);
  await db.delete(schema.user).where(eq(schema.user.id, userId));
  if (secondaryStorage) {
    for (const s of sessions) await secondaryStorage.delete(s.token);
    await secondaryStorage.delete(`active-sessions-${userId}`);
  }
  const { logAudit } = await import("@/server/audit");
  await logAudit({
    ...(actor ?? {}),
    action: "account.deleted",
    target: user?.email ?? userId,
  });
}

/**
 * Destroy a whole workspace account (owner capability, 2026-08-26): the
 * organisation row goes (every workspace-scoped table cascades — requests,
 * matches, files, subscription, sourcing rules, profile, invitations), and
 * each former member whose ONLY workspace this was loses their account
 * (UC-6 re-interpretation) — org-signup owners included. Individual-first
 * members fall back to their personal workspaces; platform staff are never
 * auto-deleted. The internal workspace is indestructible.
 *
 * Returns the number of user accounts deleted alongside the workspace.
 */
export async function destroyWorkspace(
  workspaceId: string,
  actor?: { actorId: string; actorName: string },
): Promise<number | null> {
  const workspace = await db.query.organization.findFirst({
    where: eq(schema.organization.id, workspaceId),
  });
  if (!workspace || workspace.type === "internal") return null;

  const members = await db.query.member.findMany({
    where: eq(schema.member.organizationId, workspaceId),
    columns: { userId: true },
  });

  await db.delete(schema.organization).where(eq(schema.organization.id, workspaceId));
  const { logAudit } = await import("@/server/audit");
  await logAudit({
    ...(actor ?? {}),
    organizationName: workspace.name,
    action: "workspace.destroyed",
    target: workspace.name,
    detail: { type: workspace.type, members: members.length },
  });

  let deletedUsers = 0;
  for (const { userId } of members) {
    const [user, remaining] = await Promise.all([
      db.query.user.findFirst({ where: eq(schema.user.id, userId) }),
      db.query.member.findFirst({ where: eq(schema.member.userId, userId) }),
    ]);
    if (!user || remaining || user.platformRole !== "user") continue;
    await deleteUserAccount(userId, actor);
    deletedUsers += 1;
  }
  console.log(
    `workspace destroyed: "${workspace.name}" (${workspace.type}) — ${deletedUsers} account(s) deleted with it`,
  );
  return deletedUsers;
}
