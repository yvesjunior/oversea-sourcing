// « Ce que la revue a changé » — the database side (Phase V · V14). The rules
// are pure and live in src/lib/pack-review-report.ts.
//
// Everything here is read from rows that are KEPT: `decision_pack`,
// `decision_pack_event`, `rfq_round`. Nothing from `audit_log` — it is purged
// at three months, and a report that has to cover a year cannot stand on it.

import { and, asc, desc, eq, gte, inArray, isNotNull, or } from "drizzle-orm";
import { db } from "@/database";
import * as schema from "@/database/schema";
import {
  buildReviewReport,
  type DecidedPack,
  type ReportPeriod,
  type ReviewReport,
} from "@/lib/pack-review-report";

export type EarlyClose = {
  requestId: string;
  requestTitle: string;
  roundNo: number;
  closedAt: string;
  /** Null if the account is gone and left no name — never the system: only a
   *  person closes a window early. */
  closedByName: string | null;
  note: string | null;
};

export type PackReviewReportData = Omit<ReviewReport, "packs"> & {
  days: ReportPeriod;
  from: string;
  to: string;
  packs: (DecidedPack & { requestTitle: string; organizationName: string })[];
  /** Relaunches SENT in the period, packs still undecided included — the
   *  outcome counts only see a relaunch once its pack is decided. */
  relaunchesSent: number;
  /** `automatic` packs the system held for a person (round without offer). */
  heldForPerson: number;
  earlyCloses: EarlyClose[];
};

export async function loadReviewReport(days: ReportPeriod): Promise<PackReviewReportData> {
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);

  // Which requests had something decided in the span: a release dated on the
  // pack, or a refusal dated on its event.
  const [released, periodEvents, earlyRounds] = await Promise.all([
    db
      .select({ requestId: schema.decisionPack.requestId })
      .from(schema.decisionPack)
      .where(
        and(eq(schema.decisionPack.status, "released"), gte(schema.decisionPack.releasedAt, from)),
      ),
    db
      .select({
        action: schema.decisionPackEvent.action,
        requestId: schema.decisionPack.requestId,
      })
      .from(schema.decisionPackEvent)
      .innerJoin(schema.decisionPack, eq(schema.decisionPack.id, schema.decisionPackEvent.packId))
      .where(
        and(
          gte(schema.decisionPackEvent.createdAt, from),
          or(
            eq(schema.decisionPackEvent.action, "refused"),
            eq(schema.decisionPackEvent.action, "relaunched"),
            eq(schema.decisionPackEvent.action, "held"),
          ),
        ),
      ),
    db
      .select({
        requestId: schema.rfqRound.requestId,
        requestTitle: schema.request.title,
        roundNo: schema.rfqRound.roundNo,
        closedAt: schema.rfqRound.closedAt,
        closedByName: schema.rfqRound.closedByName,
        note: schema.rfqRound.earlyNote,
      })
      .from(schema.rfqRound)
      .innerJoin(schema.request, eq(schema.request.id, schema.rfqRound.requestId))
      .where(
        and(
          eq(schema.rfqRound.closeReason, "early"),
          isNotNull(schema.rfqRound.closedAt),
          gte(schema.rfqRound.closedAt, from),
        ),
      )
      .orderBy(desc(schema.rfqRound.closedAt)),
  ]);

  const requestIds = [
    ...new Set([
      ...released.map((row) => row.requestId),
      ...periodEvents.filter((row) => row.action === "refused").map((row) => row.requestId),
    ]),
  ];

  // EVERYTHING about those requests, not only the span: a wait starts at a
  // round that may have opened before it (see `buildReviewReport`).
  const [packs, rounds, requests] =
    requestIds.length === 0
      ? [[], [], []]
      : await Promise.all([
          db.query.decisionPack.findMany({
            where: inArray(schema.decisionPack.requestId, requestIds),
          }),
          db.query.rfqRound.findMany({
            where: inArray(schema.rfqRound.requestId, requestIds),
            orderBy: [asc(schema.rfqRound.openedAt)],
          }),
          db
            .select({
              id: schema.request.id,
              title: schema.request.title,
              organizationName: schema.organization.name,
            })
            .from(schema.request)
            .leftJoin(
              schema.organization,
              eq(schema.organization.id, schema.request.organizationId),
            )
            .where(inArray(schema.request.id, requestIds)),
        ]);
  const events =
    packs.length === 0
      ? []
      : await db.query.decisionPackEvent.findMany({
          where: inArray(
            schema.decisionPackEvent.packId,
            packs.map((pack) => pack.id),
          ),
          orderBy: [asc(schema.decisionPackEvent.createdAt)],
        });

  const report = buildReviewReport({
    from: from.getTime(),
    to: to.getTime(),
    packs: packs.map((pack) => ({
      id: pack.id,
      requestId: pack.requestId,
      status: pack.status,
      releasedAt: pack.releasedAt ? pack.releasedAt.toISOString() : null,
      releasedByName: pack.releasedByName,
    })),
    events: events.map((event) => ({
      packId: event.packId,
      action: event.action,
      at: event.createdAt.toISOString(),
    })),
    rounds: rounds.map((round) => ({
      requestId: round.requestId,
      openedAt: round.openedAt.toISOString(),
      closedAt: round.closedAt ? round.closedAt.toISOString() : null,
      closeReason: round.closeReason ?? null,
    })),
  });

  const requestById = new Map(requests.map((request) => [request.id, request]));
  return {
    ...report,
    days,
    from: from.toISOString(),
    to: to.toISOString(),
    packs: report.packs.map((pack) => ({
      ...pack,
      requestTitle: requestById.get(pack.requestId)?.title ?? "",
      organizationName: requestById.get(pack.requestId)?.organizationName ?? "",
    })),
    relaunchesSent: periodEvents.filter((row) => row.action === "relaunched").length,
    heldForPerson: periodEvents.filter((row) => row.action === "held").length,
    earlyCloses: earlyRounds.flatMap((round) =>
      round.closedAt
        ? [
            {
              requestId: round.requestId,
              requestTitle: round.requestTitle,
              roundNo: round.roundNo,
              closedAt: round.closedAt.toISOString(),
              closedByName: round.closedByName ?? null,
              note: round.note ?? null,
            },
          ]
        : [],
    ),
  };
}
