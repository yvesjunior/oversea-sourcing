// KPI #2 — ranking the OFFERS a round closed with (Phase V · V09). Pure and
// client-safe: no server imports, no clock, no randomness. The same offers,
// weights and reference instant always give the same order.
//
// KPI #1 (src/server/matching.ts) scored SUPPLIERS: who is worth asking. This
// scores what they actually ANSWERED.
//
// ── What it ranks on ────────────────────────────────────────────────────────
//
// What the suppliers stated — price, lead time, incoterm, validity — plus two
// things the platform knows about the supplier: its verification as it stands
// now, and its KPI #1 score.
//
// VERSION 2 (V24): the PRICE factor compares the LANDED cost of one unit —
// the supplier's unit price plus what partners added (freight, insurance,
// duties, inspection), each brought to one unit (src/lib/landed-cost.ts).
// Version 1 compared the stated price alone, whatever the incoterm.
//
// The landed cost is compared over the cost lines known for EVERY priced
// offer, and over no other: a line one offer has no figure for is left out
// for all of them, and that offer is noted `landed_incomplete`. A missing
// figure is never read as zero — that would rank the least documented offer
// first. With no partner figure at all, the comparison rests on the price and
// on what the incoterms put inside it: version 1's order.
//
// ── Three rules that decide what is compared ────────────────────────────────
//
//  1. MONEY IS NEVER CONVERTED ON A RATE NOBODY STORED (ADR-002, decision
//     D7). When the offers that state a price are not all in one currency,
//     price is compared only if the pack holds a stored rate from each other
//     currency into one of them; otherwise it is compared for NOBODY: the
//     factor is dropped from every score and each breakdown says
//     `not_comparable`. Comparing it inside one currency and not across would
//     still let price decide the order between a USD offer and a EUR one.
//  2. A factor nobody stated is not compared (`not_stated`): there is nothing
//     to rank on, and its weight is not handed to an offer for free.
//  3. A factor some stated and this offer did not is `missing` and earns 0.
//     The ranking is of what suppliers stated; saying nothing is not neutral.
//
// A dropped factor's weight is redistributed: the score is always out of 100
// over the factors that WERE compared.
//
// MOQ is deliberately not a factor. `quote.moq` and `quote.quantity` are free
// text ("5 000 unités", "12 palettes" — the schema says "not something to
// compute with"), and the quantity the buyer needs is a free-text criterion.
// Scoring it would mean parsing prose and trusting the result. It is carried
// in the inputs so a reader sees it beside the ranking.

import type { VerificationStatus } from "@/database/schema";
import { readIncoterm, type Incoterm } from "@/lib/incoterm";
import {
  commonBasis,
  findRate,
  landedCost,
  missingLines,
  ratesFingerprint,
  unitCostOn,
  type FxRate,
  type LandedComponent,
  type LandedCost,
} from "@/lib/landed-cost";
import type { EnrichmentKind, OfferEnrichment } from "@/lib/partner-case";

export { readIncoterm };

/** Bumped whenever the formula or the default weights change, so a stored
 *  result always says which rules produced it. */
export const KPI2_VERSION = "kpi2.v2";

export const KPI2_FACTORS = [
  "price",
  "leadTime",
  "kpi1",
  "verification",
  "incoterm",
  "validity",
] as const;
export type Kpi2Factor = (typeof KPI2_FACTORS)[number];

export type Kpi2Weights = Record<Kpi2Factor, number>;

/** Version 1 weights — the platform's own, for every request. A per-request
 *  profile the buyer validates is decision D8 (V19); this function already
 *  takes the weights as an argument for that day. */
export const KPI2_DEFAULT_WEIGHTS: Kpi2Weights = {
  price: 40,
  leadTime: 20,
  kpi1: 20,
  verification: 10,
  incoterm: 5,
  validity: 5,
};

/** One offer, as KPI #2 sees it. Everything is a plain value so the whole
 *  input can be stored with the result and hashed. */
export type Kpi2Offer = {
  quoteId: string;
  amountCents: number | null;
  currency: string | null;
  leadTimeDays: number | null;
  incoterm: string | null;
  /** ISO instants. */
  validUntil: string | null;
  respondedAt: string | null;
  verification: VerificationStatus | null;
  /** `match.compatibility_score`; null when the supplier has no match row. */
  kpi1Score: number | null;
  /** Carried, never scored — see the header. */
  moq: string | null;
  /** What partners added to the offer (V24) — the figures that count, each
   *  with the units it covers. Absent = none. */
  enrichments?: OfferEnrichment[];
};

export type FactorState =
  /** Compared, and this offer earned `points`. */
  | "scored"
  /** Others stated it, this offer did not: 0 points. */
  | "missing"
  /** Stated, but in a form the scorer cannot read (an unknown incoterm). */
  | "unrecognised"
  /** Compared for nobody — mixed currencies. */
  | "not_comparable"
  /** Compared for nobody — no offer stated it. */
  | "not_stated";

export type FactorResult = {
  state: FactorState;
  /** 0–100, null when the factor was not compared. */
  points: number | null;
  /** The weight this factor carried in THIS run — 0 when not compared. */
  weight: number;
};

export type Kpi2Note =
  /** Price was dropped: the priced offers are not in one currency. */
  | "mixed_currencies"
  /** Prices were compared although quoted on different incoterms — the
   *  figures do not cover the same thing, and no landed cost corrects it. */
  | "mixed_incoterms"
  /** This offer's validity had already run out at the reference instant. */
  | "validity_expired"
  /** The supplier's verification was rejected. Ranked all the same — whether
   *  it belongs in a pack is a person's call, not the scorer's. */
  | "verification_rejected"
  /** This offer has no usable figure for a cost line another offer has one
   *  for: that line was left out of the comparison for everyone (V24). */
  | "landed_incomplete"
  /** A stored exchange rate was used to compare this offer's cost (V24). */
  | "converted";

/**
 * The arithmetic behind the price factor (V24) — everything a reader needs to
 * redo it by hand.
 */
export type LandedBreakdown = {
  /** The offer's own currency: `goodsUnitCents`, `components` and `unitCents`
   *  are in it. */
  currency: string;
  goodsUnitCents: number;
  /** Every cost line of this offer: included, added, or unknown and why. */
  components: LandedComponent[];
  /** The lines the comparison rested on — known for every priced offer. */
  basis: EnrichmentKind[];
  /** Unit price + the added components on `basis`. */
  unitCents: number;
  /** The lines THIS offer has nothing usable for. */
  missing: EnrichmentKind[];
  /** What was actually compared: `unitCents` in the comparison currency.
   *  Null when price was not compared at all (mixed currencies, no rate). */
  compared: { currency: string; unitCents: number; rate: FxRate | null } | null;
};

export type Kpi2Breakdown = {
  version: string;
  /** The instant validity was measured from (the round's close). */
  at: string;
  factors: Record<Kpi2Factor, FactorResult>;
  notes: Kpi2Note[];
  /** The offer exactly as it was scored — the audit trail for "why". */
  inputs: Kpi2Offer;
  /** The landed cost behind the price factor. Null when the offer states no
   *  price; absent on a run stored before version 2. */
  landed?: LandedBreakdown | null;
};

export type Kpi2Result = {
  quoteId: string;
  /** 1 = best. Dense and total: no two offers share a rank. */
  rank: number;
  /** 0–100, rounded to two decimals for display. The ORDER is decided on the
   *  unrounded value. */
  score: number;
  breakdown: Kpi2Breakdown;
};

// ── factor scoring ──────────────────────────────────────────────────────────

/** How much the SELLER takes on, as points. An ordinal scale, not a cost:
 *  the spacing is ours, which is why the factor weighs little. */
const INCOTERM_POINTS: Record<Incoterm, number> = {
  EXW: 0,
  FCA: 10,
  FAS: 20,
  FOB: 30,
  CFR: 45,
  CIF: 55,
  CPT: 60,
  CIP: 70,
  DAP: 80,
  DPU: 85,
  DDP: 100,
};

const VERIFICATION_POINTS: Record<VerificationStatus, number> = {
  verified: 100,
  pending: 40,
  unverified: 0,
  rejected: 0,
};

/** Full marks at 30 days of validity left or more, none once it has lapsed. */
const VALIDITY_FULL_DAYS = 30;
const DAY_MS = 86_400_000;

const round2 = (value: number) => Math.round(value * 100) / 100;

/** Lower is better, scored against the best stated value: the best gets 100,
 *  twice the best gets 50. Both values are positive by the time they get here. */
function relativeToBest(value: number, best: number): number {
  return round2(Math.min(100, (best / value) * 100));
}

/** A lead time of "0 days" is a same-day promise; counted as one day so that
 *  it does not turn every other offer's lead time into a division by zero. */
const leadDays = (days: number) => Math.max(1, days);

const notCompared = (state: "not_comparable" | "not_stated"): FactorResult => ({
  state,
  points: null,
  weight: 0,
});

const round4 = (value: number) => Math.round(value * 10_000) / 10_000;

/**
 * The currency the priced offers are compared in, and the stored rate that
 * brings each other currency to it — or null when they cannot be compared.
 *
 * One currency: that one, no rate. Several: the first of them — most offers
 * first, then alphabetical, so the choice never depends on input order — into
 * which every other one has a STORED rate. No inverse, no detour through a
 * third currency (see landed-cost.ts).
 */
function comparisonCurrency(
  costs: readonly LandedCost[],
  rates: readonly FxRate[],
): { currency: string; rates: Map<string, FxRate> } | null {
  const counts = new Map<string, number>();
  for (const cost of costs) counts.set(cost.currency, (counts.get(cost.currency) ?? 0) + 1);
  if (counts.size === 0) return null;
  const candidates = [...counts.keys()].sort(
    (a, b) => (counts.get(b) as number) - (counts.get(a) as number) || a.localeCompare(b),
  );
  for (const target of candidates) {
    const used = new Map<string, FxRate>();
    const covered = candidates.every((currency) => {
      if (currency === target) return true;
      const rate = findRate(rates, currency, target);
      if (rate) used.set(currency, rate);
      return rate !== null;
    });
    if (covered) return { currency: target, rates: used };
  }
  return null;
}

/**
 * Rank the offers of one round.
 *
 * `at` is the instant validity is measured from — pass the round's
 * `closed_at`, never "now": a ranking that moved every time it was looked at
 * would not be the same inputs giving the same order.
 */
export function rankOffers(
  offers: readonly Kpi2Offer[],
  weights: Kpi2Weights,
  at: Date,
  /** The rates stored on the pack under review. None = nothing is converted. */
  rates: readonly FxRate[] = [],
): Kpi2Result[] {
  if (offers.length === 0) return [];

  // ── what is compared at all ───────────────────────────────────────────────
  const priced = offers.filter((o) => o.amountCents !== null && o.amountCents > 0);
  const pricedIncoterms = new Set(priced.map((o) => readIncoterm(o.incoterm) ?? "?"));

  // The landed cost of each priced offer, in ITS currency (V24). An offer
  // that states a price and no currency has none: it is what makes the
  // comparison impossible, as in version 1.
  const costs = new Map<string, LandedCost>();
  for (const offer of priced) {
    const cost = landedCost(offer, rates, at);
    if (cost) costs.set(offer.quoteId, cost);
  }
  const comparison =
    costs.size === priced.length ? comparisonCurrency([...costs.values()], rates) : null;
  const priceCompared = priced.length > 0 && comparison !== null;
  // The lines every priced offer is known for — the only ones compared.
  const basis = commonBasis([...costs.values()]);
  const comparedCost = (quoteId: string): number | null => {
    const cost = costs.get(quoteId);
    if (!cost || !comparison) return null;
    const rate = comparison.rates.get(cost.currency);
    return round4(unitCostOn(cost, basis) * (rate ? rate.rate : 1));
  };
  const bestPrice = priceCompared
    ? Math.min(...priced.map((o) => comparedCost(o.quoteId) as number))
    : 0;

  const timed = offers.filter((o) => o.leadTimeDays !== null);
  const bestLead =
    timed.length > 0 ? Math.min(...timed.map((o) => leadDays(o.leadTimeDays as number))) : 0;

  const anyIncoterm = offers.some((o) => (o.incoterm ?? "").trim() !== "");
  const anyValidity = offers.some((o) => o.validUntil !== null);
  const anyVerification = offers.some((o) => o.verification !== null);
  const anyKpi1 = offers.some((o) => o.kpi1Score !== null);

  const scored = offers.map((offer) => {
    const notes: Kpi2Note[] = [];
    const factor = (
      compared: boolean,
      whyNot: "not_comparable" | "not_stated",
      key: Kpi2Factor,
      own: () => { state: FactorState; points: number },
    ): FactorResult => {
      if (!compared) return notCompared(whyNot);
      const { state, points } = own();
      return { state, points, weight: weights[key] };
    };

    const price = factor(
      priceCompared,
      priced.length === 0 ? "not_stated" : "not_comparable",
      "price",
      () => {
        const own = comparedCost(offer.quoteId);
        return own !== null
          ? { state: "scored", points: relativeToBest(own, bestPrice) }
          : { state: "missing", points: 0 };
      },
    );
    if (priced.length > 0 && !priceCompared) notes.push("mixed_currencies");
    if (priceCompared && pricedIncoterms.size > 1) notes.push("mixed_incoterms");

    // The arithmetic, for the reader — and whether THIS offer is the reason a
    // line was left out for everyone.
    const cost = costs.get(offer.quoteId) ?? null;
    let landed: LandedBreakdown | null = null;
    if (cost) {
      const missing = missingLines(cost);
      const own = comparedCost(offer.quoteId);
      const rate = comparison?.rates.get(cost.currency) ?? null;
      landed = {
        currency: cost.currency,
        goodsUnitCents: cost.goodsUnitCents,
        components: cost.components,
        basis,
        unitCents: unitCostOn(cost, basis),
        missing,
        compared:
          comparison && own !== null
            ? { currency: comparison.currency, unitCents: own, rate }
            : null,
      };
      const othersKnow = (line: EnrichmentKind) =>
        [...costs.values()].some(
          (other) =>
            other !== cost &&
            other.components.some((c) => c.line === line && c.state !== "unknown"),
        );
      if (missing.some(othersKnow)) notes.push("landed_incomplete");
      if (rate || cost.components.some((c) => c.state === "added" && c.rate)) {
        notes.push("converted");
      }
    }

    const leadTime = factor(timed.length > 0, "not_stated", "leadTime", () =>
      offer.leadTimeDays !== null
        ? { state: "scored", points: relativeToBest(leadDays(offer.leadTimeDays), bestLead) }
        : { state: "missing", points: 0 },
    );

    const incoterm = factor(anyIncoterm, "not_stated", "incoterm", () => {
      if ((offer.incoterm ?? "").trim() === "") return { state: "missing", points: 0 };
      const term = readIncoterm(offer.incoterm);
      return term
        ? { state: "scored", points: INCOTERM_POINTS[term] ?? 0 }
        : { state: "unrecognised", points: 0 };
    });

    const validity = factor(anyValidity, "not_stated", "validity", () => {
      if (!offer.validUntil) return { state: "missing", points: 0 };
      const days = (new Date(offer.validUntil).getTime() - at.getTime()) / DAY_MS;
      if (days <= 0) notes.push("validity_expired");
      return {
        state: "scored",
        points: round2(Math.max(0, Math.min(100, (days / VALIDITY_FULL_DAYS) * 100))),
      };
    });

    const verification = factor(anyVerification, "not_stated", "verification", () => {
      if (!offer.verification) return { state: "missing", points: 0 };
      if (offer.verification === "rejected") notes.push("verification_rejected");
      return { state: "scored", points: VERIFICATION_POINTS[offer.verification] };
    });

    const kpi1 = factor(anyKpi1, "not_stated", "kpi1", () =>
      offer.kpi1Score !== null
        ? { state: "scored", points: Math.max(0, Math.min(100, offer.kpi1Score)) }
        : { state: "missing", points: 0 },
    );

    const factors: Record<Kpi2Factor, FactorResult> = {
      price,
      leadTime,
      kpi1,
      verification,
      incoterm,
      validity,
    };
    const totalWeight = KPI2_FACTORS.reduce((sum, key) => sum + factors[key].weight, 0);
    const raw =
      totalWeight === 0
        ? 0
        : KPI2_FACTORS.reduce(
            (sum, key) => sum + (factors[key].points ?? 0) * factors[key].weight,
            0,
          ) / totalWeight;
    return { offer, raw, factors, notes, landed };
  });

  // A TOTAL order, so the same inputs can never come out two ways: score,
  // then the supplier's own standing (KPI #1), then who answered first, then
  // the id — which is arbitrary, and exists only to break a perfect tie the
  // same way every time.
  const ordered = [...scored].sort(
    (a, b) =>
      b.raw - a.raw ||
      (b.offer.kpi1Score ?? -1) - (a.offer.kpi1Score ?? -1) ||
      (a.offer.respondedAt ?? "9999").localeCompare(b.offer.respondedAt ?? "9999") ||
      a.offer.quoteId.localeCompare(b.offer.quoteId),
  );

  return ordered.map((entry, index) => ({
    quoteId: entry.offer.quoteId,
    rank: index + 1,
    score: round2(entry.raw),
    breakdown: {
      version: KPI2_VERSION,
      at: at.toISOString(),
      factors: entry.factors,
      notes: entry.notes,
      inputs: entry.offer,
      landed: entry.landed,
    },
  }));
}

/** A stable text form of everything a run depends on — the offers in id
 *  order, the weights, the reference instant, the formula version. Two runs
 *  with the same fingerprint would produce the same rows. */
export function kpi2Fingerprint(
  offers: readonly Kpi2Offer[],
  weights: Kpi2Weights,
  at: Date,
  rates: readonly FxRate[] = [],
): string {
  const canonical = [...offers]
    .sort((a, b) => a.quoteId.localeCompare(b.quoteId))
    .map((o) => [
      o.quoteId,
      o.amountCents,
      (o.currency ?? "").toUpperCase(),
      o.leadTimeDays,
      o.incoterm,
      o.validUntil,
      o.respondedAt,
      o.verification,
      o.kpi1Score,
      o.moq,
      // A partner's figure added, corrected or withdrawn is a new ranking.
      [...(o.enrichments ?? [])]
        .sort((a, b) => a.kind.localeCompare(b.kind))
        .map((e) => [
          e.kind,
          e.amountCents,
          e.currency.toUpperCase(),
          e.validUntil,
          e.units ?? null,
        ]),
    ]);
  return JSON.stringify([
    KPI2_VERSION,
    at.toISOString(),
    KPI2_FACTORS.map((key) => weights[key]),
    canonical,
    ratesFingerprint(rates),
  ]);
}
