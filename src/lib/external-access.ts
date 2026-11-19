// Who may be reached by an EXTERNAL account (Phase V · V03) — the register.
//
// A supplier's or a partner's person is not a customer. The product's server
// functions were all written for workspace members, so the rule is
// default-deny: `auth.api.getSession` refuses an external session
// (src/server/auth.ts), and every function that obtains a session that way
// refuses with it — without having been edited, and including the ones not
// written yet.
//
// What is NOT covered by that default is written here, by name, and
// `external-access.test.ts` reads the source to check that the lists are the
// whole truth: a new server function that reads no session, or reaches for
// the unguarded getter, fails the suite until someone adds it below — which
// is the moment somebody decides.

/**
 * Server functions that read NO session, on purpose: what they return is the
 * same for an anonymous visitor, a buyer and a supplier. Each entry says what
 * it gives away.
 */
export const PUBLIC_FNS = {
  /** Which sign-in options the login page shows. */
  getAuthConfigFn: "login page configuration",
  /** Whether the request form's button launches or leads to validation, and
   *  whether it offers the assistant. Two booleans derived from platform
   *  flags; the form is public. */
  getIntakeOptionsFn: "wording of the public request form",
  /** The RFQ invitation link (V15): for a VALID token, the supplier's name
   *  and the address the email went to — both known to whoever holds that
   *  email. For any other token, nothing. Rate limited by caller address. */
  getRfqInvitationFn: "what a valid invitation link is for",
  /** Uses the link: creates a supplier account, or attaches the invitation to
   *  the supplier account already holding its address. Authorised by the
   *  token alone — its reader has no account yet. Rate limited. */
  redeemRfqInvitationFn: "redeeming an invitation link",
} as const;

/**
 * Server functions OPENED to external accounts. They obtain their session
 * through `getAnySession` or `src/server/party-guard.ts`, never through
 * `auth.api.getSession`, and they are responsible for their own partition:
 * a supplier sees what belongs to its `supplierIds` and nothing else.
 */
export const EXTERNAL_FNS = {
  /** The root session: it is what recognises an external account and sends
   *  it to the portal. Returns the caller's own account, nothing else. */
  getSessionFn: "the caller's own session",
} as const;

/**
 * The only modules that may import the unguarded session getter
 * (`getAnySession`) or the external guards (`party-guard`). Everything else
 * sees a session through `auth.api.getSession`, which refuses external
 * accounts.
 */
/**
 * The only module that may create an external account, besides the function's
 * own definition: an invitation is what vouches for one. A second caller
 * would be a second way to become a supplier — which is a decision.
 */
export const EXTERNAL_ACCOUNT_CREATORS = [
  "src/server/auth.ts",
  "src/server/portal-invitations.ts",
] as const;

export const EXTERNAL_AWARE_MODULES = [
  "src/server/auth.ts",
  "src/server/party-guard.ts",
  "src/lib/session-fns.ts",
] as const;
