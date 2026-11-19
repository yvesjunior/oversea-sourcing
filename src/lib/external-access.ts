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
  /** The Partner Hub invitation link (V23) — the same two, for a partner's
   *  person: for a VALID token, the partner's name and the address the
   *  invitation went to. Rate limited on the same counter. */
  getPartnerInvitationFn: "what a valid partner invitation link is for",
  redeemPartnerInvitationFn: "redeeming a partner invitation link",
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
  // ── the supplier portal (V16): each through `requireSupplierSession`, each
  //    filtered by the caller's own `supplierIds` in src/server/portal.ts ──
  /** The RFQs addressed to the caller's supplier(s). */
  getMyRfqsFn: "the caller's own RFQs",
  /** One RFQ: its specification, its deadline, the caller's own offer and
   *  documents. Not the buyer, not another supplier, no count, no rank. */
  getRfqFn: "one of the caller's own RFQs",
  submitOfferFn: "the caller's own offer",
  declineRfqFn: "the caller's own refusal",
  // The Transaction Room, the supplier's slice (V25): the dossiers their
  // supplier is a PARTY to — own offer, OSI, the buyer once disclosed, what
  // is shared with them. No partner, no other offer.
  getMyDossiersFn: "the dossiers the caller's supplier is a party to",
  getMyDossierFn: "one of those dossiers, the supplier's slice",
  startMyThreadFn: "the caller's own thread with OSI",
  postMyMessageFn: "the caller's own message, in a thread they are in",
  // Contracts (V26): those the caller's supplier is a PARTY to, once sent,
  // and the caller's own signature on their own line.
  getMyContractsFn: "the caller's own contracts on a dossier",
  getMyContractFn: "one of the caller's own contracts",
  signMyContractFn: "the caller's own signature",
  // Production (V27): the milestones that are the supplier's own work, on a
  // dossier their supplier is a party to.
  planMyMilestoneFn: "the planned date of the caller's own milestone",
  completeMyMilestoneFn: "the caller's own milestone, recorded as done",
  // ── the Partner Hub (V23): each through `requirePartnerSession`, each
  //    filtered by the caller's own `partnerIds` in src/server/partner-hub.ts,
  //    each case cut down to what its kind needs (src/lib/partner-need.ts) ──
  /** The cases addressed to the caller's partner(s). */
  getHubCasesFn: "the caller's own cases",
  /** One case: what its kind needs to be answered. Not the buyer, not
   *  another offer, not OSI's fee; the price only where the kind requires. */
  getHubCaseFn: "one of the caller's own cases",
  answerHubCaseFn: "the caller's own figure",
  // The Transaction Room, a partner's slice (V25): the dossiers staff put
  // their partner on — what that kind of work needs, never the buyer.
  getHubDossiersFn: "the dossiers the caller's partner is a party to",
  getHubDossierFn: "one of those dossiers, the partner's slice",
  startHubThreadFn: "the caller's own thread with OSI",
  postHubMessageFn: "the caller's own message, in a thread they are in",
} as const;

/**
 * Which guard each file of external functions uses — and the ONLY one it may
 * use. A supplier's functions never see a partner session and the reverse:
 * the two audiences do not share a need-to-know, so they do not share a
 * guard (V23: "do not reuse the supplier guard with a flag").
 */
export const EXTERNAL_FN_FILES = {
  "src/lib/portal-fns.ts": { guard: "requireSupplierSession", helper: "caller" },
  "src/lib/partner-portal-fns.ts": { guard: "requirePartnerSession", helper: "partnerCaller" },
} as const;

/**
 * API routes written for external accounts. Like the functions above, they
 * read their session through `party-guard` and never through the workspace
 * getter — which would refuse their callers.
 */
export const EXTERNAL_API_ROUTES = [
  "src/routes/api/portal/quote-document.ts",
  "src/routes/api/portal/file.$id.ts",
  // V27: a supplier attaches a proof to one of its own milestones.
  "src/routes/api/portal/milestone-proof.ts",
] as const;

/**
 * The same, for a partner's people (V25) — behind the PARTNER guard, under
 * their own path. A supplier's route never answers a partner and the reverse.
 */
export const PARTNER_API_ROUTES = ["src/routes/api/partner/file.$id.ts"] as const;

/**
 * The only modules that may import the unguarded session getter
 * (`getAnySession`) or the external guards (`party-guard`). Everything else
 * sees a session through `auth.api.getSession`, which refuses external
 * accounts.
 */
/**
 * The only modules that may create an external account, besides the
 * function's own definition: an invitation is what vouches for one. Each
 * creates ONE kind — an RFQ link a supplier account, a Partner Hub link a
 * partner account. Another caller would be another way to become a supplier
 * or a partner — which is a decision.
 */
export const EXTERNAL_ACCOUNT_CREATORS = [
  "src/server/auth.ts",
  "src/server/portal-invitations.ts",
  "src/server/partner-invitations.ts",
] as const;

/** The kind each invitation module creates, and the only one. */
export const ACCOUNT_KIND_CREATED = {
  "src/server/portal-invitations.ts": "supplier",
  "src/server/partner-invitations.ts": "partner",
} as const;

export const EXTERNAL_AWARE_MODULES = [
  "src/server/auth.ts",
  "src/server/party-guard.ts",
  "src/lib/session-fns.ts",
  "src/lib/portal-fns.ts",
  "src/lib/partner-portal-fns.ts",
  ...EXTERNAL_API_ROUTES,
  ...PARTNER_API_ROUTES,
] as const;
