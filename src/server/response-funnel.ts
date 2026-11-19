// The supplier response funnel (Phase V · V17) — the rows.
//
// Read from `quote`, `rfq_round` and `rfq_invitation` only. The counting is
// `src/lib/response-funnel.ts`.

import { and, desc, eq, gte, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/database";
import * as schema from "@/database/schema";
import {
  countFunnel,
  funnelByRound,
  type FunnelCounts,
  type FunnelPeriod,
  type FunnelRfq,
} from "@/lib/response-funnel";

export type ResponseFunnelData = {
  days: FunnelPeriod;
  from: string;
  to: string;
  total: FunnelCounts;
  /** Round by round, most recent first. */
  rounds: Array<{
    roundId: string;
    requestId: string;
    roundNo: number;
    openedAt: string;
    closedAt: string | null;
    counts: FunnelCounts;
  }>;
};

/** Every RFQ the platform sent in the last `days` days, and what became of it. */
export async function loadResponseFunnel(days: FunnelPeriod): Promise<ResponseFunnelData> {
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 3_600_000);

  const rows = await db
    .select({ quote: schema.quote, round: schema.rfqRound })
    .from(schema.quote)
    .innerJoin(schema.rfqRound, eq(schema.rfqRound.id, schema.quote.roundId))
    .where(and(isNotNull(schema.quote.sentAt), gte(schema.quote.sentAt, from)))
    .orderBy(desc(schema.rfqRound.openedAt));

  // What became of each RFQ's link(s). An RFQ may have been sent twice (a
  // resumed batch): opened or registered through ANY of its links counts.
  const quoteIds = rows.map((row) => row.quote.id);
  const invitations =
    quoteIds.length === 0
      ? []
      : await db
          .select({
            quoteId: schema.rfqInvitation.quoteId,
            openedAt: schema.rfqInvitation.openedAt,
            registeredUserId: schema.rfqInvitation.registeredUserId,
          })
          .from(schema.rfqInvitation)
          .where(inArray(schema.rfqInvitation.quoteId, quoteIds));
  const links = new Map<string, { opened: boolean; registered: boolean }>();
  for (const invitation of invitations) {
    const seen = links.get(invitation.quoteId) ?? { opened: false, registered: false };
    links.set(invitation.quoteId, {
      opened: seen.opened || invitation.openedAt !== null,
      registered: seen.registered || invitation.registeredUserId !== null,
    });
  }

  const rfqs: FunnelRfq[] = rows.map(({ quote, round }) => {
    const link = links.get(quote.id);
    return {
      quoteId: quote.id,
      roundId: round.id,
      hasLink: link !== undefined,
      opened: link?.opened ?? false,
      registered: link?.registered ?? false,
      status: quote.status,
      declineReason: quote.declineReason ?? null,
      respondedAt: quote.respondedAt,
      channel: quote.channel ?? null,
      roundClosesAt: round.closesAt,
      roundClosedAt: round.closedAt,
    };
  });

  const roundOf = new Map(rows.map((row) => [row.round.id, row.round]));
  return {
    days,
    from: from.toISOString(),
    to: to.toISOString(),
    total: countFunnel(rfqs),
    rounds: funnelByRound(rfqs).map(({ roundId, counts }) => {
      const round = roundOf.get(roundId)!;
      return {
        roundId,
        requestId: round.requestId,
        roundNo: round.roundNo,
        openedAt: round.openedAt.toISOString(),
        closedAt: round.closedAt ? round.closedAt.toISOString() : null,
        counts,
      };
    }),
  };
}
