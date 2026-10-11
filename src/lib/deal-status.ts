// Pure state machines for the transaction spine — client- and server-safe,
// no server imports. Same shape as src/lib/request-status.ts: the tables of
// legal transitions live here, the DB writes and events live in
// src/server/deals.ts. An illegal transition throws rather than being
// silently ignored, so a bug surfaces where it happens.

import type { ContractStatus, DealStatus, QuoteStatus } from "@/database/schema";

// ── Soumission ──────────────────────────────────────────────────────────────
// requested → the buyer picked this supplier, OSI has asked
// received  → staff keyed in what came back
// accepted  → the buyer chose THIS one; the deal opens
// declined  → the supplier said no, or the buyer chose another
// expired   → the offer's validity ran out (owner 2026-09-14: one month by
//             default, staff may set another date when they record the offer;
//             an expired offer can be asked for again from the same request)

export const QUOTE_TRANSITIONS: Record<QuoteStatus, readonly QuoteStatus[]> = {
  requested: ["received", "declined", "expired"],
  received: ["accepted", "declined", "expired"],
  // Terminal: an accepted offer is what a dossier is built on. Changing
  // supplier means a new request, not a re-acceptance (see "no splitting").
  accepted: [],
  // Back to `requested` is RE-ASKING a supplier (2026-09-12). A supplier who
  // declined, or never answered, may be worth approaching again — circumstances
  // change, and a buyer who wants to should not have to file a whole new
  // request to do it. Before this the ask was silently dropped:
  // `onConflictDoNothing` on (request_id, supplier_id) meant the second
  // solicitation did nothing at all and the buyer was told "0 approached".
  //
  // Only from these two. `received` and `accepted` are NOT reopenable: asking
  // again would throw away an answer we already have.
  declined: ["requested"],
  expired: ["requested"],
};

export function canTransitionQuote(from: QuoteStatus, to: QuoteStatus): boolean {
  return QUOTE_TRANSITIONS[from].includes(to);
}

/**
 * What staff may do with the offer form on a quote in this state.
 *
 * A CORRECTION IS NOT A TRANSITION, which is why this is a separate rule
 * rather than a `received → received` self-loop in the table above. The
 * machine describes how a quote MOVES; fixing a mistyped price moves nothing,
 * and adding a self-loop would make every reader of that table wonder what
 * state change it represents.
 *
 * Frozen once the quote leaves `received`: an accepted offer has been copied
 * onto the dossier (amount, currency, incoterm are snapshots on `deal`), so
 * editing the quote afterwards would leave the two disagreeing about what was
 * agreed — and a declined one is simply over.
 */
export function offerEntryMode(status: QuoteStatus): "record" | "correct" | null {
  if (status === "requested") return "record";
  if (status === "received") return "correct";
  return null;
}

/** A quote can only be compared once it holds an answer. */
export function isComparable(status: QuoteStatus): boolean {
  return status === "received" || status === "accepted";
}

// ── Validity ────────────────────────────────────────────────────────────────
// Owner, 2026-09-14: "a quote is valid for 1 month by default (if not set);
// when staff respond to a quote they can specify the time a quote is valid,
// so if a quote expires the buyer can request the quote again."
//
// `valid_until` is STORED — it is a fact the supplier stated (or the default
// staff accepted) at the moment the offer was recorded. Whether the offer has
// EXPIRED is DERIVED at read time from that date, never a cron and never a
// stored flag — the same rule contracts follow below. The `expired` status is
// written only at the moment something acts on the expiry (the buyer asks
// again), so the row's history says when that happened.

/** Default validity when staff record an offer without a date: one calendar
 *  month from the answer. A month, not 30 days, because that is how the
 *  supplier's email will have put it. */
export function defaultQuoteValidUntil(respondedAt: Date): Date {
  const until = new Date(respondedAt);
  until.setMonth(until.getMonth() + 1);
  return until;
}

/** Has this offer's validity run out? Only a RECEIVED offer can expire on the
 *  clock: a request still awaiting an answer has no validity yet, and an
 *  accepted one is a deal. A stored `expired` status is expired by
 *  definition. */
export function isQuoteExpired(
  quote: { status: QuoteStatus; validUntil: Date | null },
  now: Date = new Date(),
): boolean {
  if (quote.status === "expired") return true;
  if (quote.status !== "received") return false;
  return quote.validUntil !== null && quote.validUntil.getTime() < now.getTime();
}

/** The status a reader should act on: `expired` once the validity has run
 *  out, whatever the row still says. Feed THIS to offerEntryMode and
 *  isComparable, not the raw column. */
export function effectiveQuoteStatus(
  quote: { status: QuoteStatus; validUntil: Date | null },
  now: Date = new Date(),
): QuoteStatus {
  return isQuoteExpired(quote, now) ? "expired" : quote.status;
}

// ── Dossier de transaction ──────────────────────────────────────────────────
// The parcours validated 2026-08-29, steps 10 → 15. Closure is deliberately
// TWO acts by two actors: the buyer reviews (delivered → reviewed), then
// staff close (reviewed → closed). A dossier therefore cannot be closed over
// a buyer who has not spoken.

export const DEAL_TRANSITIONS: Record<DealStatus, readonly DealStatus[]> = {
  open: ["contracting", "cancelled"],
  contracting: ["in_production", "cancelled"],
  in_production: ["shipping", "cancelled"],
  shipping: ["delivered", "cancelled"],
  delivered: ["reviewed", "cancelled"],
  // Only staff move this one, and only after the buyer's review exists.
  reviewed: ["closed"],
  closed: [],
  cancelled: [],
};

export function canTransitionDeal(from: DealStatus, to: DealStatus): boolean {
  return DEAL_TRANSITIONS[from].includes(to);
}

/** Steps 10-15 in order, for the dossier timeline. */
export const DEAL_ORDER = [
  { status: "open", stepKey: "open" },
  { status: "contracting", stepKey: "contracting" },
  { status: "in_production", stepKey: "production" },
  { status: "shipping", stepKey: "shipping" },
  { status: "delivered", stepKey: "delivered" },
  { status: "reviewed", stepKey: "reviewed" },
  { status: "closed", stepKey: "closed" },
] as const satisfies readonly { status: DealStatus; stepKey: string }[];

export function dealIndex(status: DealStatus): number {
  return DEAL_ORDER.findIndex((step) => step.status === status);
}

/** The buyer's review is what unlocks closing — never the other way round. */
export function awaitsBuyerReview(status: DealStatus): boolean {
  return status === "delivered";
}

export function awaitsStaffClosure(status: DealStatus): boolean {
  return status === "reviewed";
}

// ── Contrat ─────────────────────────────────────────────────────────────────
// The brief's §3.1 filters (Actifs · À signer · En attente · Complétés ·
// Expirés) are DERIVED from this plus the party rows — never stored columns.

export const CONTRACT_TRANSITIONS: Record<ContractStatus, readonly ContractStatus[]> = {
  draft: ["sent", "voided"],
  sent: ["partially_signed", "signed", "voided", "expired"],
  partially_signed: ["signed", "voided", "expired"],
  signed: [],
  voided: [],
  expired: ["voided"],
};

export function canTransitionContract(from: ContractStatus, to: ContractStatus): boolean {
  return CONTRACT_TRANSITIONS[from].includes(to);
}

/** What a contract's status becomes given its parties' signatures. The status
 *  is a FUNCTION of the party rows, so the `2/4` indicator and the stored
 *  status can never disagree. Only the mandatory parties gate `signed` —
 *  that is what makes a non-required party meaningful. */
export function statusFromSignatures(
  parties: readonly { required: boolean; signatureStatus: string }[],
): "sent" | "partially_signed" | "signed" {
  const mandatory = parties.filter((p) => p.required);
  const signedCount = parties.filter((p) => p.signatureStatus === "signed").length;
  const mandatorySigned = mandatory.filter((p) => p.signatureStatus === "signed").length;
  if (mandatory.length > 0 && mandatorySigned === mandatory.length) return "signed";
  return signedCount > 0 ? "partially_signed" : "sent";
}

/** The "2 / 4" the brief asks for on every row of the contract list.
 *  Counts MANDATORY signatures only: an optional party signing must not make
 *  the indicator read complete. */
export function signatureProgress(
  parties: readonly { required: boolean; signatureStatus: string }[],
): { signed: number; required: number } {
  const mandatory = parties.filter((p) => p.required);
  return {
    signed: mandatory.filter((p) => p.signatureStatus === "signed").length,
    required: mandatory.length,
  };
}

/** Expiry is read-time, never a cron and never a stored flag — the same rule
 *  the Recommandé tier follows. A contract already signed or voided is not
 *  expired, whatever its échéance says. */
export function isExpired(
  contract: { status: ContractStatus; dueAt: Date | null },
  now: Date = new Date(),
): boolean {
  if (contract.status === "signed" || contract.status === "voided") return false;
  return contract.dueAt !== null && contract.dueAt < now;
}

/** The brief's §3.1 filter a contract belongs to, derived. */
export type ContractFilter = "actifs" | "a_signer" | "en_attente" | "completes" | "expires";

export function contractFilter(
  contract: { status: ContractStatus; dueAt: Date | null },
  parties: readonly { required: boolean; signatureStatus: string }[],
  now: Date = new Date(),
): ContractFilter {
  if (isExpired(contract, now)) return "expires";
  if (contract.status === "signed") return "completes";
  if (contract.status === "draft" || contract.status === "voided") return "actifs";
  const { signed, required } = signatureProgress(parties);
  // Nothing signed yet reads as "waiting"; a partial signature reads as
  // "still needs signatures" — which is the distinction the brief draws.
  return signed === 0 && required > 0 ? "en_attente" : "a_signer";
}
