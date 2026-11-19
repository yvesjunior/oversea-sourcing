// The RFQ invitation link (Phase V · V15) — the pure half.
//
// What an invitation is worth at a given instant, and where its link points.
// The rows and the token live in `src/server/portal-invitations.ts`.

/** How long a link registers someone. An RFQ window is days; the link
 *  outlives it on purpose — a supplier who answers by email first may still
 *  come back to open an account and see what became of their offer. */
export const INVITATION_TTL_DAYS = 30;

export function invitationExpiry(sentAt: Date): Date {
  return new Date(sentAt.getTime() + INVITATION_TTL_DAYS * 24 * 3_600_000);
}

/** Where the link in the email leads. The token is the last path segment and
 *  nothing else is in the URL — no supplier, no request, no email address. */
export function registrationPath(token: string): string {
  return `/portail/inscription/${token}`;
}

export type InvitationState =
  /** No row has this token. Said the same way as "expired" to the reader: a
   *  link that does not work, and the way to sign in. */
  | "unknown"
  | "expired"
  /** It already made, or was attached to, an account. */
  | "used"
  | "valid";

/**
 * `used` wins over `expired`: someone who registered through the link and
 * comes back to it a year later should be told they have an account, not
 * that a deadline passed.
 */
export function invitationState(
  invitation: { expiresAt: Date; registeredUserId: string | null } | null,
  now: Date,
): InvitationState {
  if (!invitation) return "unknown";
  if (invitation.registeredUserId) return "used";
  return invitation.expiresAt.getTime() <= now.getTime() ? "expired" : "valid";
}

/**
 * What a VALID link offers, given who already holds its email address.
 *
 *   register   nobody does: the form creates an account of the link's kind.
 *   attach     an account of THAT kind does — the same person, invited again
 *              or by another request: the invitation is attached to it, no
 *              second account ("linked, not duplicated").
 *   conflict   an account of any OTHER type does: a customer's, or the other
 *              external kind's. An account's type never changes, so it cannot
 *              become this one, and a second account cannot share its email.
 *              OSI has to write to another address.
 *
 * `kind` is the kind of account the link makes: `supplier` for an RFQ link
 * (V15), `partner` for a Partner Hub link (V23). A supplier's address invited
 * as a partner is a conflict, and the reverse.
 */
export type InvitationOffer = "register" | "attach" | "conflict";

export function invitationOffer(
  existingAccountType: string | null | undefined,
  kind: "supplier" | "partner" = "supplier",
): InvitationOffer {
  if (existingAccountType === null || existingAccountType === undefined) return "register";
  return existingAccountType === kind ? "attach" : "conflict";
}

/** Where a Partner Hub invitation leads (V23) — the token and nothing else. */
export function partnerRegistrationPath(token: string): string {
  return `/partenaires/inscription/${token}`;
}
