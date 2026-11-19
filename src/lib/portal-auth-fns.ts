// The supplier portal's way in (Phase V · V15) — server functions.
//
// Both are PUBLIC: they read no session, because their caller has no account
// yet. What authorises them is the token from the RFQ email, which is the
// only input that matters and is never stored (its hash is). Both are rate
// limited by caller address — better-auth's limiter covers its own endpoints
// only.
//
// Listed in `src/lib/external-access.ts` as public, with what they give away:
// for a VALID token, the supplier's name and the address the email went to —
// both already known to whoever received that email. For any other token,
// nothing.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { InvitationView, RedeemResult } from "@/server/portal-invitations";

export type { InvitationView, RedeemResult };

/** Attempts per caller address per ten minutes, lookups and redemptions
 *  together. A person uses three or four; a script guessing tokens would need
 *  about 2^255 more. */
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

/** What the registration page shows for this link. `limited` when the caller
 *  has tried too often — said plainly rather than disguised as "unknown". */
export const getRfqInvitationFn = createServerFn({ method: "GET" })
  .inputValidator(z.object({ token: tokenSchema }))
  .handler(async ({ data }): Promise<InvitationView | { state: "limited" }> => {
    if (!(await allowed())) return { state: "limited" };
    const { viewInvitation } = await import("@/server/portal-invitations");
    return viewInvitation(data.token);
  });

/**
 * Use the link: create the supplier account, or attach the invitation to the
 * supplier account that already holds its address.
 *
 * Creates no session. The page signs in with the password just chosen through
 * better-auth's own `/sign-in/email` — its cookies, its rate limit, its audit
 * line — rather than a second, home-made way of opening a session.
 */
export const redeemRfqInvitationFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      token: tokenSchema,
      name: z.string().trim().max(120).default(""),
      password: z.string().max(200).default(""),
    }),
  )
  .handler(async ({ data }): Promise<RedeemResult | { ok: false; reason: "limited" }> => {
    if (!(await allowed())) return { ok: false, reason: "limited" };
    const { redeemInvitation } = await import("@/server/portal-invitations");
    return redeemInvitation(data);
  });
