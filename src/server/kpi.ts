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
// The ranking spans the request's ROUNDS (V11): after a relaunch, the offers
// held from an earlier round are ranked with the new ones. A run is filed
// under the round whose close (or whose review) triggered it.
//
// Validity is measured from the round's `closed_at`, never from now: the
// offers are judged as of the moment the window closed, and a ranking that
// drifted with the clock would not be the same inputs giving the same order.

import { createHash } from "node:crypto";
import { and, asc, desc, eq, isNotNull, ne } from "drizzle-orm";
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
  type Kpi2Weights,
} from "@/lib/kpi2";
import type { FxRate } from "@/lib/landed-cost";

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

/**
 * Every offer the REQUEST holds — across all its rounds (V11).
 *
 * A relaunch opens a second round for more suppliers, and the offers already
 * in hand from the first are not thrown away (decision D5): they are ranked
 * together with the new ones. With one round this is that round's offers,
 * exactly as before. Only quotes that belong to a round: a report-flow quote
 * has none and is never ranked.
 */
async function gatherOffers(requestId: string): Promise<Kpi2Offer[]> {
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
    .where(
      and(
        eq(schema.quote.requestId, requestId),
        isNotNull(schema.quote.roundId),
        eq(schema.quote.status, "received"),
      ),
    )
    .orderBy(asc(schema.quote.id));
  // What partners added to each offer (V24): the figures that count, with
  // the units each covers. They are inputs of the ranking now.
  const { currentEnrichments } = await import("@/server/partner-cases");
  const enrichments = await currentEnrichments(rows.map((row) => row.quote.id));
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
    // Absent rather than empty when there is none: the stored inputs of an
    // offer nobody enriched read as they always did.
    ...(enrichments.has(quote.id) ? { enrichments: enrichments.get(quote.id)! } : {}),
  }));
}

/** The run fingerprint for these offers under today's rules and the
 *  request's weights. The weights are part of it: the same offers under a
 *  different profile are a different ranking, and a new run. */
function hashInputs(
  offers: readonly Kpi2Offer[],
  weights: Kpi2Weights,
  closedAt: Date,
  rates: readonly FxRate[],
): string {
  return createHash("sha256")
    .update(kpi2Fingerprint(offers, weights, closedAt, rates))
    .digest("hex");
}

/**
 * The exchange rates the request's pack under review holds (V24) — the only
 * rates anything is converted with. None until a staff member stores one;
 * none at all on the first run, when the pack does not exist yet.
 */
async function storedRates(requestId: string): Promise<FxRate[]> {
  const pack = await db.query.decisionPack.findFirst({
    where: and(
      eq(schema.decisionPack.requestId, requestId),
      eq(schema.decisionPack.status, "pending"),
    ),
    columns: { fxRates: true },
  });
  return pack?.fxRates ?? [];
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

  const offers = await gatherOffers(request.id);
  if (offers.length === 0) return { ok: false, reason: "no_offers" };

  // The weights are the request's KPI profile (V19), no longer a constant.
  // The default profile carries the same numbers, so a request nobody
  // adjusted ranks as before. `ensureSpec` writes nothing here in practice —
  // the criteria froze before the first RFQ left — except for a request that
  // predates specifications, which gets its version 1 now.
  const { ensureSpec } = await import("@/server/spec");
  const ensured = await ensureSpec(request.id);
  const weights = ensured.weights.kpi2;
  // What the offers ANSWERED is the spec their round carried.
  const specVersion = round.specVersion ?? ensured.specVersion;
  const rates = await storedRates(request.id);
  const inputsHash = hashInputs(offers, weights, round.closedAt, rates);

  // The error nobody notices (V19's gotcha): an offer that answered one
  // version of the spec, ranked beside offers that answered another. It
  // cannot happen while criteria freeze before the first RFQ, so if it ever
  // does, something changed that rule — say so loudly rather than rank on.
  const answered = await db
    .select({ id: schema.quote.id, specVersion: schema.quote.specVersion })
    .from(schema.quote)
    .where(eq(schema.quote.requestId, request.id));
  const offerIds = new Set(offers.map((o) => o.quoteId));
  const strays = answered.filter(
    (q) => offerIds.has(q.id) && q.specVersion !== null && q.specVersion !== specVersion,
  );
  if (strays.length > 0) {
    console.warn(
      `kpi2: request ${request.id} ranks offers made against different spec versions — ` +
        `run on v${specVersion}, but ${strays.map((q) => `${q.id}=v${q.specVersion}`).join(", ")}`,
    );
  }

  // The latest run of the REQUEST, whichever round triggered it: after a
  // relaunch the previous ranking lives under the earlier round's id.
  const latest = await db.query.kpiResult.findFirst({
    where: eq(schema.kpiResult.requestId, request.id),
    orderBy: [desc(schema.kpiResult.computedAt)],
    columns: { runId: true, inputsHash: true },
  });
  if (latest?.inputsHash === inputsHash) {
    return { ok: true, written: false, runId: latest.runId, offers: offers.length };
  }

  const results = rankOffers(offers, weights, round.closedAt, rates);
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
      specVersion,
      profileVersion: ensured.profileVersion,
      computedAt,
    })),
  );
  console.log(
    `kpi2: ranked ${results.length} offer(s) of request ${request.id}, round ${round.roundNo} (${trigger})`,
  );
  return { ok: true, written: true, runId, offers: results.length };
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
  // The latest round that CLOSED INTO A REVIEW — not simply the latest round:
  // while a relaunched round is open, the ranking the last review worked from
  // is still what there is to read.
  const round = await db.query.rfqRound.findFirst({
    where: and(
      eq(schema.rfqRound.requestId, requestId),
      isNotNull(schema.rfqRound.closedAt),
      ne(schema.rfqRound.closeReason, "withdrawn"),
    ),
    orderBy: [desc(schema.rfqRound.roundNo)],
  });
  if (!round?.closedAt) return null;

  const rows = await db
    .select({ result: schema.kpiResult, supplierName: schema.quote.supplierName })
    .from(schema.kpiResult)
    .innerJoin(schema.quote, eq(schema.quote.id, schema.kpiResult.quoteId))
    // Every run of the request — a relaunch does not hide the rankings
    // computed under the round before it.
    .where(eq(schema.kpiResult.requestId, requestId))
    .orderBy(desc(schema.kpiResult.computedAt), asc(schema.kpiResult.rank));

  const inReview = request.status === "pack_review";
  const offers = await gatherOffers(requestId);
  // A read path: the profile as stored, never written from here.
  const { latestProfile } = await import("@/server/spec");
  const weightsNow = (await latestProfile(requestId))?.weights.kpi2 ?? KPI2_DEFAULT_WEIGHTS;
  const hashNow =
    offers.length > 0
      ? hashInputs(offers, weightsNow, round.closedAt, await storedRates(requestId))
      : null;
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
