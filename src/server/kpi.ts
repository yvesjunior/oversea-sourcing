// KPI #2 — the database side (Phase V · V09). The scorer itself is pure and
// lives in src/lib/kpi2.ts; this file gathers what it needs, stores what it
// returns, and reads it back.
//
// ── When it runs ────────────────────────────────────────────────────────────
//
// When a round closes into the pack review, and again whenever the set of
// offers in that closed round changes while the review lasts: a late-keyed
// answer, a correction, an offer staff decline. Each run is APPENDED — the
// earlier order stays in the table.
//
// A run whose inputs are identical to the latest one writes nothing
// (`inputs_hash`). So every caller can simply ask for a recomputation without
// working out whether anything changed, and a correction that touched only a
// note does not manufacture a "new ranking" that is the old one.
//
// Validity is measured from the round's `closed_at`, never from now: the
// offers are judged as of the moment the window closed, and a ranking that
// drifted with the clock would not be the same inputs giving the same order.

import { createHash } from "node:crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/database";
import * as schema from "@/database/schema";
import type { KpiRunTrigger } from "@/database/schema";
import {
  KPI2_DEFAULT_WEIGHTS,
  KPI2_VERSION,
  kpi2Fingerprint,
  rankOffers,
  type Kpi2Breakdown,
  type Kpi2Offer,
} from "@/lib/kpi2";

export type Kpi2RunOutcome =
  /** A new run was written. */
  | { ok: true; written: true; runId: string; offers: number }
  /** Nothing changed since the latest run — it stands. */
  | { ok: true; written: false; runId: string; offers: number }
  | {
      ok: false;
      reason:
        | "not_found"
        /** Open, or withdrawn: there is nothing to rank offers FOR. */
        | "round_not_closed"
        /** The request has left the pack review: the ranking it was decided
         *  on is history, and is not rewritten behind the decision. */
        | "not_in_review"
        | "no_offers";
    };

async function gatherOffers(roundId: string, requestId: string): Promise<Kpi2Offer[]> {
  const rows = await db
    .select({
      quote: schema.quote,
      verification: schema.supplier.verificationStatus,
      kpi1Score: schema.match.compatibilityScore,
    })
    .from(schema.quote)
    // Left joins: a supplier row can be deleted (the quote keeps its name
    // snapshot), and a quote can exist without a match row.
    .leftJoin(schema.supplier, eq(schema.supplier.id, schema.quote.supplierId))
    .leftJoin(
      schema.match,
      and(
        eq(schema.match.requestId, requestId),
        eq(schema.match.supplierId, schema.quote.supplierId),
      ),
    )
    .where(and(eq(schema.quote.roundId, roundId), eq(schema.quote.status, "received")))
    .orderBy(asc(schema.quote.id));
  return rows.map(({ quote, verification, kpi1Score }) => ({
    quoteId: quote.id,
    amountCents: quote.amountCents,
    currency: quote.currency,
    leadTimeDays: quote.leadTimeDays,
    incoterm: quote.incoterm,
    validUntil: quote.validUntil ? quote.validUntil.toISOString() : null,
    respondedAt: quote.respondedAt ? quote.respondedAt.toISOString() : null,
    verification: verification ?? null,
    kpi1Score: kpi1Score ?? null,
    moq: quote.moq,
  }));
}

/** The run fingerprint for these offers under today's rules and weights. */
function hashInputs(offers: readonly Kpi2Offer[], closedAt: Date): string {
  return createHash("sha256")
    .update(kpi2Fingerprint(offers, KPI2_DEFAULT_WEIGHTS, closedAt))
    .digest("hex");
}

/**
 * Rank the offers of a closed round and store the result — unless the latest
 * stored run already answers for exactly these inputs.
 *
 * Never throws for an expected reason; the callers are side effects of other
 * actions (a close, an offer entry) and must not fail them.
 */
export async function runKpi2(roundId: string, trigger: KpiRunTrigger): Promise<Kpi2RunOutcome> {
  const round = await db.query.rfqRound.findFirst({ where: eq(schema.rfqRound.id, roundId) });
  if (!round) return { ok: false, reason: "not_found" };
  if (!round.closedAt || round.closeReason === "withdrawn") {
    return { ok: false, reason: "round_not_closed" };
  }
  const request = await db.query.request.findFirst({
    where: eq(schema.request.id, round.requestId),
    columns: { id: true, status: true },
  });
  if (!request) return { ok: false, reason: "not_found" };
  if (request.status !== "pack_review") return { ok: false, reason: "not_in_review" };

  const offers = await gatherOffers(roundId, request.id);
  if (offers.length === 0) return { ok: false, reason: "no_offers" };

  const weights = KPI2_DEFAULT_WEIGHTS;
  const inputsHash = hashInputs(offers, round.closedAt);

  const latest = await db.query.kpiResult.findFirst({
    where: eq(schema.kpiResult.roundId, roundId),
    orderBy: [desc(schema.kpiResult.computedAt)],
    columns: { runId: true, inputsHash: true },
  });
  if (latest?.inputsHash === inputsHash) {
    return { ok: true, written: false, runId: latest.runId, offers: offers.length };
  }

  const results = rankOffers(offers, weights, round.closedAt);
  const runId = crypto.randomUUID();
  const computedAt = new Date();
  await db.insert(schema.kpiResult).values(
    results.map((result) => ({
      id: crypto.randomUUID(),
      runId,
      requestId: request.id,
      roundId,
      quoteId: result.quoteId,
      rank: result.rank,
      score: Math.round(result.score * 100),
      breakdown: result.breakdown,
      formulaVersion: KPI2_VERSION,
      inputsHash,
      trigger,
      computedAt,
    })),
  );
  console.log(
    `kpi2: ranked ${results.length} offer(s) of request ${request.id}, round ${round.roundNo} (${trigger})`,
  );
  return { ok: true, written: true, runId, offers: results.length };
}

/** `runKpi2` for callers that are side effects of something else: an offer
 *  was entered, corrected or declined, and IF its round is one under review,
 *  the ranking should follow. Swallows everything — the offer is saved
 *  whether or not the ranking could be refreshed. */
export async function refreshKpi2(roundId: string | null, trigger: KpiRunTrigger): Promise<void> {
  if (!roundId) return;
  try {
    await runKpi2(roundId, trigger);
  } catch (error) {
    console.error(`kpi2: could not refresh the ranking of round ${roundId} (${trigger}) —`, error);
  }
}

export type RankedOfferView = {
  quoteId: string;
  supplierName: string;
  rank: number;
  /** 0–100, two decimals. */
  score: number;
  breakdown: Kpi2Breakdown;
};

export type RankingRunView = {
  runId: string;
  computedAt: string;
  trigger: KpiRunTrigger;
  formulaVersion: string;
  offers: RankedOfferView[];
};

export type OfferRankingView = {
  roundId: string;
  roundNo: number;
  /** False once the request has left the review — the ranking is then a
   *  record, and can no longer be recomputed. */
  canRecompute: boolean;
  /** How many offers the round holds right now. */
  offersNow: number;
  /** The ranking that stands. Null when the round holds no offer (any run
   *  that once ranked some is then under `earlier`), or none was computed. */
  current: RankingRunView | null;
  /**
   * True when what the ranking depends on has changed since `current` was
   * computed — a verification result that landed, typically: nothing
   * announces those to the scorer. Derived at read time by comparing
   * fingerprints, so the panel never presents an out-of-date order as the
   * order.
   */
  stale: boolean;
  /** Earlier runs, most recent first — the order as it was before each
   *  change. */
  earlier: RankingRunView[];
};

/** The latest closed round's ranking and its history, for staff. Null when
 *  the request has no round that closed into a review. */
export async function loadOfferRanking(requestId: string): Promise<OfferRankingView | null> {
  const request = await db.query.request.findFirst({
    where: eq(schema.request.id, requestId),
    columns: { status: true },
  });
  if (!request) return null;
  const round = await db.query.rfqRound.findFirst({
    where: eq(schema.rfqRound.requestId, requestId),
    orderBy: [desc(schema.rfqRound.roundNo)],
  });
  if (!round?.closedAt || round.closeReason === "withdrawn") return null;

  const rows = await db
    .select({ result: schema.kpiResult, supplierName: schema.quote.supplierName })
    .from(schema.kpiResult)
    .innerJoin(schema.quote, eq(schema.quote.id, schema.kpiResult.quoteId))
    .where(eq(schema.kpiResult.roundId, round.id))
    .orderBy(desc(schema.kpiResult.computedAt), asc(schema.kpiResult.rank));

  const inReview = request.status === "pack_review";
  const offers = await gatherOffers(round.id, requestId);
  const hashNow = offers.length > 0 ? hashInputs(offers, round.closedAt) : null;
  const latestHash = rows[0]?.result.inputsHash ?? null;

  const runs: RankingRunView[] = [];
  for (const { result, supplierName } of rows) {
    let run = runs.find((r) => r.runId === result.runId);
    if (!run) {
      run = {
        runId: result.runId,
        computedAt: result.computedAt.toISOString(),
        trigger: result.trigger,
        formulaVersion: result.formulaVersion,
        offers: [],
      };
      runs.push(run);
    }
    run.offers.push({
      quoteId: result.quoteId,
      supplierName,
      rank: result.rank,
      score: result.score / 100,
      breakdown: result.breakdown as Kpi2Breakdown,
    });
  }

  return {
    roundId: round.id,
    roundNo: round.roundNo,
    canRecompute: inReview,
    offersNow: offers.length,
    // No offer left in the round: nothing stands as "the ranking", and every
    // stored run is history.
    current: offers.length > 0 ? (runs[0] ?? null) : null,
    // Only while it can still be acted on: once the request has left the
    // review the ranking is a record of what was decided on, and "the inputs
    // have moved since" is true of every record.
    stale: inReview && offers.length > 0 && latestHash !== null && latestHash !== hashNow,
    earlier: offers.length > 0 ? runs.slice(1) : runs,
  };
}
