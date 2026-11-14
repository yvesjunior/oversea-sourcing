// How a round closes — the RULES (Phase V · V07). Pure and client-safe; the
// writes live in src/server/rfq-window.ts.
//
// Three things close a round — enough offers, the deadline, a person — plus
// the buyer withdrawing the request. What differs between them is not the
// round but what the close SAYS about the suppliers who had not answered, and
// that is the part worth getting exactly right: `no_response` is the one
// signal about a supplier that cannot be scraped from anywhere, so it must
// only ever be written when the supplier really was given their full time.

import type {
  QuoteDeclineReason,
  QuoteStatus,
  RequestStatus,
  RoundCloseReason,
} from "@/database/schema";

/**
 * Why a quote still waiting for an answer is declined when its round closes.
 *
 * Three different facts, and only the first is about the supplier:
 *  • `no_response` — they were written to AND the whole window ran out on
 *    them. Both halves, or it is not this.
 *  • `closed_before_deadline` — they were written to, but the round was cut
 *    short: a target, a person's decision, the buyer withdrawing. They still
 *    had time, and may have been about to answer.
 *  • `not_reached` — the RFQ never got to them (a refused address, a batch
 *    that died half way). Whatever closed the round: silence from someone
 *    who was not asked is not silence.
 */
export function silentDeclineReason(reason: RoundCloseReason, sent: boolean): QuoteDeclineReason {
  if (!sent) return "not_reached";
  return reason === "deadline" ? "no_response" : "closed_before_deadline";
}

/** Does this close hand the request to the pack review? Every reason but the
 *  buyer's withdrawal — including a round that closes with NO offer at all:
 *  whether to relaunch or refuse is a person's decision, never the system's. */
export function leadsToReview(reason: RoundCloseReason): boolean {
  return reason !== "withdrawn";
}

/** `target` is the round's own snapshot, never the setting as it stands. */
export function targetReached(offers: number, target: number): boolean {
  return offers >= target;
}

/**
 * What the sweep should do with a round that is still open, if anything.
 *
 * The order matters. A request that is over (cancelled under an open round —
 * the cancel died before it could withdraw it) is withdrawn, whatever the
 * clock says: closing it on `deadline` would mark as silent suppliers nobody
 * was waiting for any more. Then the target before the deadline, so a round
 * that filled up while its trigger was missed is not recorded as having run
 * out of time.
 */
export function dueClose(input: {
  requestOver: boolean;
  offers: number;
  targetOffers: number;
  closesAt: Date;
  now: Date;
}): RoundCloseReason | null {
  if (input.requestOver) return "withdrawn";
  if (targetReached(input.offers, input.targetOffers)) return "target_reached";
  if (input.closesAt.getTime() <= input.now.getTime()) return "deadline";
  return null;
}

/**
 * May staff still record an answer on a quote its round declined? (V08)
 *
 * On the staff route an offer reaches the platform when someone TYPES it, not
 * when the supplier sends it. A round that closes in between declines the
 * quote as silent — and a supplier who answered on time is then on record as
 * never having answered, which is the one signal `no_response` exists to keep
 * clean. This is the door that lets the late typing be done.
 *
 * Open only when ALL of these hold:
 *  • the round declined it as unanswered — `no_response` or
 *    `closed_before_deadline`. Not `not_reached` (nobody the RFQ never
 *    reached can have answered it), and not a decline a person chose;
 *  • the round did not end by the buyer withdrawing — there is no request
 *    left to put an offer in front of;
 *  • the request is still in `pack_review`. Once the pack is released,
 *    relaunched or refused, the offers it was decided on are history.
 *
 * It says nothing about WHEN the supplier answered: the caller must also
 * check the typed time is not after the round closed (`answeredInRound`).
 */
export function lateAnswerOpen(input: {
  status: QuoteStatus;
  declineReason: QuoteDeclineReason | null;
  requestStatus: RequestStatus;
  round: { closedAt: Date | null; closeReason: RoundCloseReason | null } | null;
}): boolean {
  if (input.status !== "declined") return false;
  if (input.declineReason !== "no_response" && input.declineReason !== "closed_before_deadline") {
    return false;
  }
  if (!input.round?.closedAt || input.round.closeReason === "withdrawn") return false;
  return input.requestStatus === "pack_review";
}

/** Did the answer arrive while the round was open? Up to the instant it
 *  actually closed — for a deadline close that is the sweep's instant, up to
 *  a minute after `closes_at`, and an answer in that minute was in time. */
export function answeredInRound(respondedAt: Date, closedAt: Date): boolean {
  return respondedAt.getTime() <= closedAt.getTime();
}
