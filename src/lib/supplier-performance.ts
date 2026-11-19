// What the platform remembers about a supplier (Phase V · V31). Pure.
//
// When staff close a dossier, what happened on it is written down as FACTS —
// how long the supplier took to answer, whether its own steps were on time,
// what the buyer said, what went wrong and whether it was settled
// (`supplier_performance`, one row per closed deal).
//
// KPI #1 then reads those facts for the next request. It reads them through
// THIS file: the facts are aggregated and turned into an adjustment here,
// every time, and nothing derived is ever stored. Change a weight below and
// every past deal is re-read under the new rule — which is exactly what a
// stored score could not do.

import { MILESTONES, wasLate, type MilestoneKind } from "@/lib/milestones";

/** What one closed deal says about its supplier. */
export type PerformanceFacts = {
  responseHours: number | null;
  supplierStepsPlanned: number;
  supplierStepsLate: number;
  deliveredLate: boolean | null;
  satisfaction: number | null;
  issuesRaised: number;
  issuesResolved: number;
  issuesDisputed: number;
};

/**
 * The facts of one dossier, from its rows. Only the supplier's OWN steps
 * count as the supplier being late: a carrier's late delivery is recorded
 * (`deliveredLate`) and held against nobody.
 */
export function performanceFacts(input: {
  sentAt: Date | null;
  respondedAt: Date | null;
  milestones: ReadonlyArray<{
    kind: MilestoneKind;
    plannedAt: string | null;
    completedAt: string | null;
  }>;
  satisfaction: number | null;
  issues: ReadonlyArray<{ status: "open" | "resolved" | "disputed" }>;
}): PerformanceFacts {
  const ownKinds = MILESTONES.filter((m) => m.owner === "supplier").map(
    (m) => m.kind as MilestoneKind,
  );
  const own = input.milestones.filter(
    (m) => ownKinds.includes(m.kind) && m.plannedAt !== null && m.completedAt !== null,
  );
  const delivery = input.milestones.find((m) => m.kind === "delivered");
  const hours =
    input.sentAt && input.respondedAt
      ? Math.round((input.respondedAt.getTime() - input.sentAt.getTime()) / 3_600_000)
      : null;
  return {
    // An answer dated before the send is a keying error, not a response time.
    responseHours: hours !== null && hours >= 0 ? hours : null,
    supplierStepsPlanned: own.length,
    supplierStepsLate: own.filter((m) => wasLate(m)).length,
    deliveredLate: delivery?.plannedAt && delivery.completedAt ? wasLate(delivery) : null,
    satisfaction: input.satisfaction,
    issuesRaised: input.issues.length,
    issuesResolved: input.issues.filter((issue) => issue.status === "resolved").length,
    issuesDisputed: input.issues.filter((issue) => issue.status === "disputed").length,
  };
}

/** A supplier's closed deals, summed up — what the scorer is handed. */
export type PerformanceAggregate = {
  /** Closed deals on record. */
  deals: number;
  /** Deals where at least one of the supplier's own steps was late. */
  lateDeals: number;
  /** The buyers' average satisfaction over the deals that have one, to one
   *  decimal — null when none has. */
  satisfactionAvg: number | null;
  /** Issues that ended in a disagreement. */
  disputedIssues: number;
};

/** Null for a supplier with no closed deal: it has no history, which is not
 *  the same as a clean one — and earns neither a bonus nor a penalty. */
export function aggregatePerformance(
  rows: ReadonlyArray<
    Pick<PerformanceFacts, "supplierStepsLate" | "satisfaction" | "issuesDisputed">
  >,
): PerformanceAggregate | null {
  if (rows.length === 0) return null;
  const rated = rows.map((row) => row.satisfaction).filter((value) => value !== null);
  return {
    deals: rows.length,
    lateDeals: rows.filter((row) => row.supplierStepsLate > 0).length,
    satisfactionAvg:
      rated.length === 0
        ? null
        : Math.round((rated.reduce((sum, value) => sum + value, 0) / rated.length) * 10) / 10,
    disputedIssues: rows.reduce((sum, row) => sum + row.issuesDisputed, 0),
  };
}

/**
 * What the facts are worth, in KPI #1 points. The platform's own — not part
 * of a request's profile: how much a late delivery costs is not something a
 * buyer tunes per request.
 *
 * Deliberately small beside the 55 points of criteria coverage: a history
 * orders suppliers that fit the need about equally; it never makes one that
 * does not fit look like one that does (relevance is a gate, upstream).
 */
export const PERFORMANCE_WEIGHTS = {
  /** Removed per deal delivered late by the supplier, up to `lateCap`. */
  lateDeal: 5,
  lateCap: 15,
  /** Per point of average satisfaction away from 3 (the middle of 1–5):
   *  an average of 5 adds 4, an average of 1 removes 4. */
  satisfactionStep: 2,
  /** Removed per issue that ended disputed, up to `disputedCap`. */
  disputedIssue: 3,
  disputedCap: 9,
} as const;

export type PerformanceReason =
  | { key: "late"; deals: number; points: number }
  | { key: "satisfaction"; average: number; points: number }
  | { key: "disputed"; issues: number; points: number };

/**
 * The adjustment to a supplier's KPI #1 score, and WHY — each part with the
 * points it moved, so the breakdown can say "2 late deliveries: −10" and not
 * just show a lower number.
 */
export function performanceAdjustment(aggregate: PerformanceAggregate | null | undefined): {
  points: number;
  reasons: PerformanceReason[];
} {
  if (!aggregate || aggregate.deals === 0) return { points: 0, reasons: [] };
  const w = PERFORMANCE_WEIGHTS;
  const reasons: PerformanceReason[] = [];
  if (aggregate.lateDeals > 0) {
    reasons.push({
      key: "late",
      deals: aggregate.lateDeals,
      points: -Math.min(w.lateCap, aggregate.lateDeals * w.lateDeal),
    });
  }
  if (aggregate.satisfactionAvg !== null) {
    const points = Math.round((aggregate.satisfactionAvg - 3) * w.satisfactionStep);
    if (points !== 0) {
      reasons.push({ key: "satisfaction", average: aggregate.satisfactionAvg, points });
    }
  }
  if (aggregate.disputedIssues > 0) {
    reasons.push({
      key: "disputed",
      issues: aggregate.disputedIssues,
      points: -Math.min(w.disputedCap, aggregate.disputedIssues * w.disputedIssue),
    });
  }
  return { points: reasons.reduce((sum, reason) => sum + reason.points, 0), reasons };
}
