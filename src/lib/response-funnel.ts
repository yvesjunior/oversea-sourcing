// The supplier response funnel (Phase V · V17) — pure.
//
// The whole pack flow rests on suppliers answering: a window closes on five
// offers, or on its deadline with fewer. If suppliers do not open the link,
// do not register, or do not answer, rounds close short and a `no_response`
// stops meaning "this supplier is slow" and starts meaning "our RFQ does not
// reach people". This is the early warning.
//
// One row per RFQ the platform sent, read in order:
//
//   sent → with a link → opened → registered → answered (→ in time)
//
// and, of the answers, which route they came by: the portal, or an email a
// staff member typed in.

import type { QuoteChannel, QuoteDeclineReason, QuoteStatus } from "@/database/schema";

export const FUNNEL_PERIODS = [30, 90, 365] as const;
export type FunnelPeriod = (typeof FUNNEL_PERIODS)[number];

/** One RFQ the platform sent, as the funnel needs it. */
export type FunnelRfq = {
  quoteId: string;
  roundId: string;
  /** An invitation link went with it. False for an RFQ sent before the
   *  portal existed, or re-sent without one. */
  hasLink: boolean;
  opened: boolean;
  registered: boolean;
  status: QuoteStatus;
  declineReason: QuoteDeclineReason | null;
  respondedAt: Date | null;
  channel: QuoteChannel | null;
  /** The deadline the supplier was given. */
  roundClosesAt: Date;
  /** When the round actually closed; null while it is open. */
  roundClosedAt: Date | null;
};

export type FunnelCounts = {
  /** RFQs sent. */
  sent: number;
  /** …of which carried a portal link. The base of the next two. */
  withLink: number;
  opened: number;
  registered: number;
  /** Sent an offer — by either route. */
  answered: number;
  /** …before the window closed. */
  answeredInTime: number;
  answeredPortal: number;
  answeredStaff: number;
  /** Said no. An answer of a kind, and not a silence. */
  declined: number;
  /** The window closed on them without a word. */
  silent: number;
  /** The window is still open and they have not answered yet. */
  pending: number;
};

const ZERO: FunnelCounts = {
  sent: 0,
  withLink: 0,
  opened: 0,
  registered: 0,
  answered: 0,
  answeredInTime: 0,
  answeredPortal: 0,
  answeredStaff: 0,
  declined: 0,
  silent: 0,
  pending: 0,
};

/**
 * Did this supplier send an OFFER? A received offer stays one whatever became
 * of it — accepted, expired, or closed out as `lost` when the buyer chose
 * someone else. (`lost` is the reason this cannot simply be "status is
 * received": most offers that were ever made end up declined.)
 */
export function madeAnOffer(rfq: Pick<FunnelRfq, "status" | "declineReason">): boolean {
  return (
    rfq.status === "received" ||
    rfq.status === "accepted" ||
    rfq.status === "expired" ||
    (rfq.status === "declined" && rfq.declineReason === "lost")
  );
}

/** Before the window closed: its deadline, or the earlier instant it was
 *  closed at. An answer with no time on record is not counted as in time. */
export function answeredInTime(
  rfq: Pick<FunnelRfq, "respondedAt" | "roundClosesAt" | "roundClosedAt">,
): boolean {
  if (!rfq.respondedAt) return false;
  const limit = Math.min(
    rfq.roundClosesAt.getTime(),
    rfq.roundClosedAt?.getTime() ?? Number.POSITIVE_INFINITY,
  );
  return rfq.respondedAt.getTime() <= limit;
}

export function countFunnel(rfqs: readonly FunnelRfq[]): FunnelCounts {
  const counts = { ...ZERO };
  for (const rfq of rfqs) {
    counts.sent += 1;
    if (rfq.hasLink) {
      counts.withLink += 1;
      if (rfq.opened) counts.opened += 1;
      if (rfq.registered) counts.registered += 1;
    }
    if (madeAnOffer(rfq)) {
      counts.answered += 1;
      if (answeredInTime(rfq)) counts.answeredInTime += 1;
      // No channel on record = keyed in before the column existed: by staff.
      if (rfq.channel === "portal") counts.answeredPortal += 1;
      else counts.answeredStaff += 1;
    } else if (rfq.status === "declined" && rfq.declineReason === "supplier_declined") {
      counts.declined += 1;
    } else if (rfq.roundClosedAt === null && rfq.status === "requested") {
      counts.pending += 1;
    } else {
      counts.silent += 1;
    }
  }
  return counts;
}

/** A share as a whole percentage; null when there is nothing to divide by —
 *  "0 %" of nothing would read as a result. */
export function share(part: number, whole: number): number | null {
  return whole === 0 ? null : Math.round((part / whole) * 100);
}

export type RoundFunnel = { roundId: string; counts: FunnelCounts };

/** The same counts, round by round, in the order the rounds are given. */
export function funnelByRound(rfqs: readonly FunnelRfq[]): RoundFunnel[] {
  const byRound = new Map<string, FunnelRfq[]>();
  for (const rfq of rfqs) {
    const list = byRound.get(rfq.roundId) ?? [];
    list.push(rfq);
    byRound.set(rfq.roundId, list);
  }
  return [...byRound].map(([roundId, list]) => ({ roundId, counts: countFunnel(list) }));
}
