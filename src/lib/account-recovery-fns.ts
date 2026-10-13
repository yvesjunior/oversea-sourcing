// Getting a person back into their account WITHOUT email (2026-10-13).
//
// The SendGrid outage made the gap plain: a buyer who cannot receive mail
// cannot verify a new address and cannot reset a password, so email was a
// single point of failure for access itself. These two staff actions are the
// manual path — the same shape as the invitation's copyable link, which has
// always worked this way.
//
// Both are gated on the `users` permission (owner + manager by default, and
// revocable from Rôles & accès) and both write an audit row. Issuing a reset
// link is effectively account takeover, so it is deliberately traceable: the
// journal names who issued it, for whom, and when.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type RecoveryResult =
  | { ok: true; link?: string; alreadyVerified?: boolean }
  | { ok: false; error: "forbidden" | "not_found" | "no_link" };

/** owner|manager by default — the grant lives in src/lib/roles.ts (`users`). */
async function requireRecoveryRights() {
  const [{ auth }, { getRequest }] = await Promise.all([
    import("@/server/auth"),
    import("@tanstack/react-start/server"),
  ]);
  const session = await auth.api.getSession({ headers: getRequest().headers });
  if (!session) return null;
  // Staff powers only from the internal workspace (2026-08-27).
  const { effectiveHasPermission } = await import("@/server/workspace-guard");
  if (!(await effectiveHasPermission(session, "users"))) return null;
  return session;
}

/**
 * Mark an address verified by hand.
 *
 * Verification is ENFORCED at login (2026-08-28) to make a free trial cost a
 * real inbox. That rule is right, and it becomes a trap the moment we cannot
 * send: the person is asked for a link that physically cannot arrive. Staff
 * confirming the human some other way is the escape hatch — not a weakening
 * of the rule, since a human is still vouching for the address.
 */
export const markEmailVerifiedFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ email: z.string().trim().toLowerCase().email() }))
  .handler(async ({ data }): Promise<RecoveryResult> => {
    const session = await requireRecoveryRights();
    if (!session) return { ok: false, error: "forbidden" };

    const [{ db }, { eq }, schema] = await Promise.all([
      import("@/database"),
      import("drizzle-orm"),
      import("@/database/schema"),
    ]);
    const target = await db.query.user.findFirst({ where: eq(schema.user.email, data.email) });
    if (!target) return { ok: false, error: "not_found" };
    if (target.emailVerified) return { ok: true, alreadyVerified: true };

    await db
      .update(schema.user)
      .set({ emailVerified: true, updatedAt: new Date() })
      .where(eq(schema.user.id, target.id));

    const { logAudit, actorOf } = await import("@/server/audit");
    await logAudit({
      ...actorOf(session),
      organizationId: null,
      organizationName: null,
      action: "user.email_verified_by_staff",
      target: target.email,
      detail: { reason: "manual verification" },
    });
    return { ok: true };
  });

/**
 * Produce a password-reset link for staff to pass on by phone or WhatsApp.
 *
 * It is a REAL reset link with better-auth's own one-hour expiry — not a
 * bypass, not a password staff can read. The person still chooses their own
 * password, and the link dies on the usual schedule. What changes is only the
 * delivery channel.
 *
 * `requestPasswordReset` deliberately answers the same whether or not the
 * account exists, to stop enumeration on the public form. Here the caller is
 * already authenticated staff with the `users` permission, so we look the
 * account up first and say plainly that it does not exist.
 */
export const issuePasswordResetLinkFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ email: z.string().trim().toLowerCase().email() }))
  .handler(async ({ data }): Promise<RecoveryResult> => {
    const session = await requireRecoveryRights();
    if (!session) return { ok: false, error: "forbidden" };

    const [{ db }, { eq }, schema] = await Promise.all([
      import("@/database"),
      import("drizzle-orm"),
      import("@/database/schema"),
    ]);
    const target = await db.query.user.findFirst({ where: eq(schema.user.email, data.email) });
    if (!target) return { ok: false, error: "not_found" };

    const [{ auth }, { beginCapture, endCapture }] = await Promise.all([
      import("@/server/auth"),
      import("@/server/reset-capture"),
    ]);

    let link: string | undefined;
    beginCapture(target.email);
    try {
      await auth.api.requestPasswordReset({
        body: { email: target.email, redirectTo: "/reinitialiser" },
      });
    } finally {
      link = await endCapture(target.email);
    }
    // No link means better-auth declined to start a reset — most often
    // because the account has no password (Google-only sign-in), where a
    // reset link would be meaningless anyway.
    if (!link) return { ok: false, error: "no_link" };

    const { logAudit, actorOf } = await import("@/server/audit");
    await logAudit({
      ...actorOf(session),
      organizationId: null,
      organizationName: null,
      action: "user.reset_link_issued",
      target: target.email,
      detail: { channel: "staff_handover" },
    });
    return { ok: true, link };
  });
