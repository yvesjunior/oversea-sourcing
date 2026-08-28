// Team management server fns (B3/B7, 2026-08-23).
//
// Invite / accept / decline / revoke / remove / change-role all go through
// better-auth's organization plugin endpoints (seat caps and the one-owner
// rule enforced inside via organizationHooks in src/server/auth.ts). What
// lives here is what the plugin does not cover: ownership TRANSFER (an atomic
// swap, never a second owner) and the public invitation lookup for the
// /invitation/$id page.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type InvitationView = {
  id: string;
  workspaceName: string;
  inviterName: string;
  email: string;
  role: string;
  status: string;
  expired: boolean;
  /** The signed-in caller's relation to it: they can act only when `match`. */
  caller: "anonymous" | "match" | "mismatch";
} | null;

/** Public lookup for the invitation page — the id is the capability. */
export const getInvitationFn = createServerFn({ method: "GET" })
  .inputValidator(z.object({ id: z.string() }))
  .handler(async ({ data }): Promise<InvitationView> => {
    const [{ auth }, { getRequest }, { db }, { eq }, schema] = await Promise.all([
      import("@/server/auth"),
      import("@tanstack/react-start/server"),
      import("@/database"),
      import("drizzle-orm"),
      import("@/database/schema"),
    ]);
    const invitation = await db.query.invitation.findFirst({
      where: eq(schema.invitation.id, data.id),
    });
    if (!invitation) return null;

    const [workspace, inviter, session] = await Promise.all([
      db.query.organization.findFirst({
        where: eq(schema.organization.id, invitation.organizationId),
      }),
      db.query.user.findFirst({ where: eq(schema.user.id, invitation.inviterId) }),
      auth.api.getSession({ headers: getRequest().headers }),
    ]);

    const callerEmail = session?.user.email.toLowerCase();
    return {
      id: invitation.id,
      workspaceName: workspace?.name ?? "—",
      inviterName: inviter?.name ?? "—",
      email: invitation.email,
      role: invitation.role ?? "buyer",
      status: invitation.status,
      expired: invitation.expiresAt < new Date(),
      caller: !callerEmail
        ? "anonymous"
        : callerEmail === invitation.email.toLowerCase()
          ? "match"
          : "mismatch",
    };
  });

/**
 * Ownership transfer (B7): owner-only, target must already be a member, and
 * the swap is atomic — at every instant the workspace has exactly one owner.
 * The previous owner becomes `buyer` (decided 2026-08-23).
 */
export const transferOwnershipFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ toUserId: z.string() }))
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const [{ requireWorkspaceRole }, { getRequest }, { db }, { and, eq }, schema] =
      await Promise.all([
        import("@/server/workspace-guard"),
        import("@tanstack/react-start/server"),
        import("@/database"),
        import("drizzle-orm"),
        import("@/database/schema"),
      ]);
    const caller = await requireWorkspaceRole(getRequest().headers, "owner");
    if (!caller) return { ok: false };
    if (data.toUserId === caller.userId) return { ok: false };

    const target = await db.query.member.findFirst({
      where: and(
        eq(schema.member.organizationId, caller.workspaceId),
        eq(schema.member.userId, data.toUserId),
      ),
    });
    if (!target) return { ok: false };

    await db.transaction(async (tx) => {
      await tx
        .update(schema.member)
        .set({ role: "buyer" })
        .where(
          and(
            eq(schema.member.organizationId, caller.workspaceId),
            eq(schema.member.userId, caller.userId),
          ),
        );
      await tx.update(schema.member).set({ role: "owner" }).where(eq(schema.member.id, target.id));
    });
    const [newOwner, org] = await Promise.all([
      db.query.user.findFirst({ where: eq(schema.user.id, data.toUserId) }),
      db.query.organization.findFirst({ where: eq(schema.organization.id, caller.workspaceId) }),
    ]);
    const { logAudit } = await import("@/server/audit");
    await logAudit({
      actorId: caller.userId,
      organizationId: caller.workspaceId,
      organizationName: org?.name ?? null,
      action: "ownership.transferred",
      target: newOwner?.email ?? data.toUserId,
    });
    return { ok: true };
  });
