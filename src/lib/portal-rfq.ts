// The supplier portal's RFQs (Phase V · V16) — the pure half.
//
// What a supplier's person may do with an RFQ at a given moment, and the ONLY
// things they are ever told about it. The rows are `src/server/portal.ts`.

import type { QuoteDeclineReason, QuoteStatus, RequestStatus } from "@/database/schema";

/**
 * Where an RFQ stands, as its SUPPLIER sees it. Five words, and deliberately
 * no more: every finer distinction the platform holds says something about
 * someone else.
 *
 *   to_answer   the window is open and they have not answered
 *   answered    their offer is in
 *   declined    THEY said no
 *   closed      the window is over and they had not answered — whether it
 *               ran out, closed early because enough offers were in, or the
 *               buyer withdrew is not theirs to know: each of those reveals
 *               how the others answered
 *
 * Nothing here says whether an offer was retained. That is told once, in
 * its own words, when the buyer has chosen (V17) — a status that flipped to
 * "lost" the instant a pack was released would tell them the timing of a
 * decision that is not theirs.
 */
export type PortalRfqState = "to_answer" | "answered" | "declined" | "closed";

export type PortalRfqFacts = {
  quoteStatus: QuoteStatus;
  declineReason: QuoteDeclineReason | null;
  /** Null while the round is open. */
  roundClosedAt: Date | null;
  requestStatus: RequestStatus;
};

/** The window takes answers: its round is open and the request is still
 *  soliciting (a cancelled request closes its round, but the request's own
 *  status is checked too — belt and braces on the one write a stranger makes). */
export function windowOpen(
  facts: Pick<PortalRfqFacts, "roundClosedAt" | "requestStatus">,
): boolean {
  return facts.roundClosedAt === null && facts.requestStatus === "soliciting";
}

export function portalRfqState(facts: PortalRfqFacts): PortalRfqState {
  // An offer that was received stays "answered" whatever became of it
  // afterwards (accepted, expired, lost): see the note on the type.
  if (
    facts.quoteStatus === "received" ||
    facts.quoteStatus === "accepted" ||
    facts.quoteStatus === "expired" ||
    (facts.quoteStatus === "declined" && facts.declineReason === "lost")
  ) {
    return "answered";
  }
  if (facts.quoteStatus === "declined" && facts.declineReason === "supplier_declined") {
    return "declined";
  }
  if (facts.quoteStatus === "requested" && windowOpen(facts)) return "to_answer";
  return "closed";
}

/**
 * May they send — or revise — an offer?
 *
 * While the window is open: a first answer, a revision of their own offer,
 * and a change of mind after declining. Once it closes, nothing: the offers
 * are being compared, and a figure that could still move would not be the one
 * that was ranked.
 */
export function canSubmitOffer(facts: PortalRfqFacts): boolean {
  if (!windowOpen(facts)) return false;
  return (
    facts.quoteStatus === "requested" ||
    facts.quoteStatus === "received" ||
    (facts.quoteStatus === "declined" && facts.declineReason === "supplier_declined")
  );
}

/** May they decline? Only an RFQ they have not answered, while it is open —
 *  withdrawing an offer already sent is a conversation with OSI, not a button. */
export function canDecline(facts: PortalRfqFacts): boolean {
  return windowOpen(facts) && facts.quoteStatus === "requested";
}

/** Money as the form takes it — "12.50" or "12,50" — to integer cents. Null
 *  when it is not an amount: the server refuses rather than guesses. */
export function parseAmountToCents(input: string): number | null {
  const cleaned = input.replace(/\s/g, "").replace(",", ".");
  if (!/^\d{1,11}(\.\d{1,2})?$/.test(cleaned)) return null;
  const cents = Math.round(Number(cleaned) * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}
