// The Partner Hub's way in (Phase V · V23) — server functions.
//
// The counterpart of `portal-auth-fns.ts`, for a partner's person. Both are
// PUBLIC: they read no session, because their caller has no account yet. What
// authorises them is the token from the invitation email, never stored (its
// hash is). Both are rate limited by caller address, on the same counter as
// the supplier's links — an address guessing tokens is one address.
//
// Listed in `src/lib/external-access.ts` as public, with what they give away:
// for a VALID token, the partner's name and the address the email went to —
// both known to whoever received that email. For any other token, nothing.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { PartnerInvitationView, RedeemPartnerResult } from "@/server/partner-invitations";

export type { PartnerInvitationView, RedeemPartnerResult };

const ATTEMPTS = 30;
const WINDOW_SECONDS = 600;

const tokenSchema = z.string().min(20).max(200);

async function allowed(): Promise<boolean> {
  const [{ getRequest }, { allowAttempt, callerAddress }] = await Promise.all([
    import("@tanstack/react-start/server"),
    import("@/server/rate-limit"),
  ]);
  return allowAttempt(
    `invitation:${callerAddress(getRequest().headers)}`,
    ATTEMPTS,
    WINDOW_SECONDS,
  );
}

/** What the registration page shows for this link. */
export const getPartnerInvitationFn = createServerFn({ method: "GET" })
  .inputValidator(z.object({ token: tokenSchema }))
  .handler(async ({ data }): Promise<PartnerInvitationView | { state: "limited" }> => {
    if (!(await allowed())) return { state: "limited" };
    const { viewPartnerInvitation } = await import("@/server/partner-invitations");
    return viewPartnerInvitation(data.token);
  });

/**
 * Use the link: create the partner account, or attach the invitation to the
 * partner account that already holds its address. Creates no session — the
 * page signs in through better-auth's own `/sign-in/email`.
 */
export const redeemPartnerInvitationFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      token: tokenSchema,
      name: z.string().trim().max(120).default(""),
      password: z.string().max(200).default(""),
    }),
  )
  .handler(async ({ data }): Promise<RedeemPartnerResult | { ok: false; reason: "limited" }> => {
    if (!(await allowed())) return { ok: false, reason: "limited" };
    const { redeemPartnerInvitation } = await import("@/server/partner-invitations");
    return redeemPartnerInvitation(data);
  });
