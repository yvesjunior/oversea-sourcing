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
 * Does this workspace carry financial activity?
 *
 * A contract or a deal — a deal IS the money: it snapshots the accepted
 * amount, currency and incoterm. `payment` joins this list the day P9 creates
 * it; until then there is no third thing to check.
 *
 * This is the whole of the archive rule. Everything else about the workspace —
 * requests, suppliers, sourcing preferences — is the customer's and may be
 * erased with them.
 */
export async function hasFinancialActivity(workspaceId: string): Promise<boolean> {
  const [contract, deal] = await Promise.all([
    db.query.contract.findFirst({
      where: eq(schema.contract.organizationId, workspaceId),
      columns: { id: true },
    }),
    db.query.deal.findFirst({
      where: eq(schema.deal.organizationId, workspaceId),
      columns: { id: true },
    }),
  ]);
  return Boolean(contract ?? deal);
}

export type WorkspaceRemoval =
  /** Erased outright: nothing financial was attached to it. */
  | { outcome: "destroyed"; deletedUsers: number }
  /** Kept, hidden, recoverable by signing in. */
  | { outcome: "archived" }
  /** The internal workspace, or no such workspace. */
  | { outcome: "refused" };

/**
 * Remove a workspace at its owner's request (owner capability, 2026-08-26;
 * archive rule added 2026-09-12).
 *
 * TWO OUTCOMES, decided by the data and not by the caller:
 *
 * - **Financial activity present → ARCHIVED, never deleted.** Destroying the
 *   organisation cascades fifteen tables, contract → contract_party →
 *   contract_event among them, which is the signature evidence on a mandate
 *   OSI signed as a party. ADR Part II §4 promises that evidence is never
 *   cascaded away; the promise only becomes true here. The workspace vanishes
 *   from the product and its owner restores it by signing in.
 * - **Nothing financial → destroyed**, exactly as before: the organisation row
 *   goes, every workspace-scoped table cascades, and each former member whose
 *   ONLY workspace this was loses their account (UC-6). An abandoned signup is
 *   not a record worth keeping.
 *
 * Member accounts are NEVER deleted on the archive path — the owner has to be
 * able to sign in to recover, so deleting their account would lock the archive
 * shut forever.
 */
export async function destroyWorkspace(
  workspaceId: string,
  actor?: { actorId: string; actorName: string },
): Promise<WorkspaceRemoval> {
  const workspace = await db.query.organization.findFirst({
    where: eq(schema.organization.id, workspaceId),
  });
  if (!workspace || workspace.type === "internal") return { outcome: "refused" };

  if (await hasFinancialActivity(workspaceId)) {
    await db
      .update(schema.organization)
      .set({
        archivedAt: new Date(),
        archivedBy: actor?.actorId ?? null,
        archivedByName: actor?.actorName ?? null,
      })
      .where(eq(schema.organization.id, workspaceId));
    const { logAudit } = await import("@/server/audit");
    await logAudit({
      ...(actor ?? {}),
      organizationId: workspaceId,
      organizationName: workspace.name,
      action: "workspace.archived",
      target: workspace.name,
      detail: { type: workspace.type, reason: "financial_activity" },
    });
    console.log(`workspace archived: "${workspace.name}" — financial activity, kept for recovery`);
    return { outcome: "archived" };
  }

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
  return { outcome: "destroyed", deletedUsers };
}

/**
 * Bring an archived workspace back (2026-09-12).
 *
 * Called from the recovery screen a member lands on when they sign in to an
 * archived workspace — the archive is meant to be undone by the person who
 * asked for it, without a support conversation.
 */
export async function restoreWorkspace(
  workspaceId: string,
  actor?: { actorId: string; actorName: string },
): Promise<boolean> {
  const workspace = await db.query.organization.findFirst({
    where: eq(schema.organization.id, workspaceId),
  });
  if (!workspace?.archivedAt) return false;
  await db
    .update(schema.organization)
    .set({ archivedAt: null, archivedBy: null, archivedByName: null })
    .where(eq(schema.organization.id, workspaceId));
  const { logAudit } = await import("@/server/audit");
  await logAudit({
    ...(actor ?? {}),
    organizationId: workspaceId,
    organizationName: workspace.name,
    action: "workspace.restored",
    target: workspace.name,
  });
  return true;
}
