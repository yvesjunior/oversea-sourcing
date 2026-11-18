// What a buyer is told about an offer in a Decision Pack (Phase V · V12).
// Pure and client-safe.
//
// Two things, and both are about not saying more than is known:
//
//  • `explainOffer` — what was observed about the offer, in plain statements
//    the buyer can check against the figures on the page — every comparison
//    is against the other offers ON THAT PAGE. Not a score: the order the
//    buyer sees may have been corrected by a person, and a number that
//    disagreed with the order shown would explain nothing.
//  • `landedCostLines` — the "coût total rendu" block, which says what is
//    known and LABELS what is not. No total is ever computed: the price is
//    what the supplier stated (a unit price, against a quantity kept as
//    free text), and transport, duties, inspection and fees are either
//    inside that price by the incoterm, or simply not known yet. A sum that
//    silently left them out would be the one number on the page that is
//    wrong.

import type { PackOfferSnapshot } from "@/lib/decision-pack";
import { readIncoterm } from "@/lib/kpi2";

/** One statement about an offer: an i18n key under `packView.explain.` and
 *  the values it interpolates. */
export type ExplainLine = { key: string; params?: Record<string, number | string> };

/** How far above the best, in whole percent: 1 050 against 980 is 7. */
function percentAbove(value: number, best: number): number {
  return Math.round((value / best - 1) * 100);
}

const leadDays = (days: number) => Math.max(1, days);

/**
 * What OSI observed about this offer, relative to the others THE BUYER IS
 * SHOWN.
 *
 * `shown` is the pack as this reader gets it. The comparisons are worked out
 * here, from the frozen copies on the page — NOT taken from the ranking's
 * factor points, which compare against every offer that was ranked (and
 * which the buyer's projection does not even carry). An offer
 * staff withheld would otherwise leave its trace on the others: "a lead time
 * 50 % longer than the shortest", when the shortest is nowhere on the page,
 * tells the buyer that something was taken out.
 *
 * With a single offer shown there is nothing to compare, and nothing
 * comparative is said. A figure this supplier did not give is said to be
 * missing — "they did not tell us" is a fact the buyer should weigh.
 */
export function explainOffer(
  offer: PackOfferSnapshot,
  shown: readonly PackOfferSnapshot[],
  /** The two things taken from the ranking — both absolute, neither a
   *  comparison with another offer. */
  facts: { fit: number | null; validityExpired: boolean },
): ExplainLine[] {
  const lines: ExplainLine[] = [];
  const comparing = shown.length > 1;

  // ── price — only inside one currency: no amount is ever converted ─────────
  const priced = shown.filter((o) => o.amountCents !== null && o.amountCents > 0);
  const currencies = new Set(priced.map((o) => (o.currency ?? "").toUpperCase()));
  const hasPrice = offer.amountCents !== null && offer.amountCents > 0;
  if (comparing && priced.length > 0) {
    if (!hasPrice) lines.push({ key: "price.missing" });
    else if (currencies.size > 1 || currencies.has("")) lines.push({ key: "price.not_comparable" });
    else if (priced.length > 1) {
      const best = Math.min(...priced.map((o) => o.amountCents as number));
      const pct = percentAbove(offer.amountCents as number, best);
      lines.push(pct <= 0 ? { key: "price.best" } : { key: "price.above", params: { pct } });
    }
  }

  // ── lead time ─────────────────────────────────────────────────────────────
  const timed = shown.filter((o) => o.leadTimeDays !== null);
  if (comparing && timed.length > 0) {
    if (offer.leadTimeDays === null) lines.push({ key: "leadTime.missing" });
    else if (timed.length > 1) {
      const best = Math.min(...timed.map((o) => leadDays(o.leadTimeDays as number)));
      const pct = percentAbove(leadDays(offer.leadTimeDays), best);
      lines.push(pct <= 0 ? { key: "leadTime.best" } : { key: "leadTime.above", params: { pct } });
    }
  }

  // ── about the supplier — absolute, so nothing here depends on the others ──
  if (facts.fit !== null) lines.push({ key: "fit", params: { score: facts.fit } });
  // From the frozen copy: what the supplier's verification WAS when the pack
  // was built.
  if (offer.supplierVerification) {
    lines.push({ key: `verification.${offer.supplierVerification}` });
  }

  // Prices side by side that do not cover the same costs — among the offers
  // shown, and only when prices are being compared at all.
  const terms = new Set(priced.map((o) => readIncoterm(o.incoterm) ?? "?"));
  if (comparing && hasPrice && priced.length > 1 && currencies.size === 1 && terms.size > 1) {
    lines.push({ key: "mixed_incoterms" });
  }
  if (facts.validityExpired) lines.push({ key: "validity_expired" });
  return lines;
}

export const COST_LINES = [
  "goods",
  "main_carriage",
  "insurance",
  "import_duties",
  "inspection",
  "osi_fee",
  "settlement_fee",
] as const;
export type CostLineKey = (typeof COST_LINES)[number];

export type CostLineState =
  /** The supplier stated it — the price. */
  | "stated"
  /** Inside the supplier's price, by the incoterm they quoted on. */
  | "included"
  /** Nobody has provided it. Said, not skipped. */
  | "not_provided"
  /** It WILL apply, and its amount is not quoted at this stage. */
  | "applies_unquoted";

export type CostLine = { key: CostLineKey; state: CostLineState };

/** Incoterms 2020: what the seller's price covers. Only what the rules say —
 *  main carriage to the named place, insurance where the seller must insure,
 *  import duties under DDP alone. */
const CARRIAGE_INCLUDED = new Set(["CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP"]);
const INSURANCE_INCLUDED = new Set(["CIF", "CIP"]);
const DUTIES_INCLUDED = new Set(["DDP"]);

/**
 * The lines of the landed-cost block for one offer.
 *
 * The two FEES are always `applies_unquoted`: OSI's and the settlement
 * partner's will both be charged, and the buyer must not read the supplier's
 * price as the whole cost — but no rate is quoted here. The rates await the
 * legal review of the money circuit (README §2c: for anything financial, do
 * not build it yet), and the partner's schedule "needs confirming before it
 * is quoted to anyone".
 */
export function landedCostLines(offer: {
  amountCents: number | null;
  incoterm: string | null;
}): CostLine[] {
  const term = readIncoterm(offer.incoterm);
  const covered = (set: Set<string>): CostLineState =>
    term !== null && set.has(term) ? "included" : "not_provided";
  return [
    { key: "goods", state: offer.amountCents !== null ? "stated" : "not_provided" },
    { key: "main_carriage", state: covered(CARRIAGE_INCLUDED) },
    { key: "insurance", state: covered(INSURANCE_INCLUDED) },
    { key: "import_duties", state: covered(DUTIES_INCLUDED) },
    { key: "inspection", state: "not_provided" },
    { key: "osi_fee", state: "applies_unquoted" },
    { key: "settlement_fee", state: "applies_unquoted" },
  ];
}
