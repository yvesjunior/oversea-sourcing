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
//    known and LABELS what is not: each line is the supplier's price, inside
//    that price by the incoterm, a partner's figure, or simply not provided.
//  • `knownUnitCostOf` — the one figure the block states (V24): what ONE
//    UNIT costs over what is known. The supplier quotes a unit price, so a
//    partner's shipment figure is brought to one unit before it is added
//    (src/lib/landed-cost.ts). It is never called a total: the lines nobody
//    provided and the two fees are named beside it. A sum that silently left
//    them out would be the one number on the page that is wrong.

import type { PackOfferSnapshot } from "@/lib/decision-pack";
import { readIncoterm, termCovers } from "@/lib/incoterm";
import {
  costQuoteStanding,
  knownUnitCost,
  landedComponent,
  landedCost,
  missingLines,
  type CostQuoteStanding,
  type FxRate,
} from "@/lib/landed-cost";
import type { EnrichmentKind, OfferEnrichment } from "@/lib/partner-case";

// One verdict, one place (V24): the calculation and the label agree because
// the label is read off the calculation.
export { costQuoteStanding, type CostQuoteStanding };

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
  | "applies_unquoted"
  /** A partner gave a figure for it (V22) — see `quote`. */
  | "quoted";

export type CostLine = {
  key: CostLineKey;
  state: CostLineState;
  /**
   * Set when `state` is `quoted`: the partner's figure, in ITS currency, and
   * what can be said of it next to the supplier's price (`CostQuoteStanding`).
   * The amount is shown in every case; only what is said changes.
   */
  quote?: {
    amountCents: number;
    currency: string;
    validUntil: string | null;
    /** How many of the supplier's units the figure covers — null = not said. */
    units: number | null;
    standing: CostQuoteStanding;
    /** What it comes to PER UNIT in the offer's currency, when it is added. */
    unitCents: number | null;
    /** The stored rate it was converted with, when one was. */
    rate: FxRate | null;
  };
};

type CostOffer = {
  amountCents: number | null;
  currency?: string | null;
  incoterm: string | null;
  enrichments?: readonly OfferEnrichment[];
};

export function landedCostLines(
  offer: CostOffer,
  /** The instant validity is judged at — the page's "now". */
  at: Date = new Date(),
  /** The rates stored on the pack (V24). None = nothing is converted. */
  rates: readonly FxRate[] = [],
): CostLine[] {
  // A partner's figure for a line (V22) is SHOWN whatever the incoterm says:
  // somebody asked for it on purpose. It keeps its own currency and validity;
  // whether it is ADDED to the supplier's price is said, never assumed.
  const line = (key: EnrichmentKind): CostLine => {
    const enrichment = offer.enrichments?.find((e) => e.kind === key);
    if (!enrichment) {
      return { key, state: termCovers(offer.incoterm, key) ? "included" : "not_provided" };
    }
    const component = landedComponent(key, offer, rates, at);
    return {
      key,
      state: "quoted",
      quote: {
        amountCents: enrichment.amountCents,
        currency: enrichment.currency,
        validUntil: enrichment.validUntil,
        units: enrichment.units ?? null,
        standing: costQuoteStanding(enrichment, offer, at, rates),
        unitCents: component.state === "added" ? component.unitCents : null,
        rate: component.state === "added" ? component.rate : null,
      },
    };
  };
  return [
    { key: "goods", state: offer.amountCents !== null ? "stated" : "not_provided" },
    line("main_carriage"),
    line("insurance"),
    line("import_duties"),
    line("inspection"),
    { key: "osi_fee", state: "applies_unquoted" },
    { key: "settlement_fee", state: "applies_unquoted" },
  ];
}

/**
 * The one figure the cost block may state (V24): what ONE UNIT costs over
 * everything known about this offer — the supplier's unit price plus each
 * partner figure brought to one unit.
 *
 * It is NOT a total, and the page says what it leaves out: the lines nobody
 * provided, and the two fees, which are not quoted at this stage. Null when
 * the supplier stated no price, or when nothing was added to it — a "landed
 * cost" equal to the price would claim an arithmetic that did not happen.
 */
export type KnownUnitCost = {
  unitCents: number;
  currency: string;
  /** The lines added to the price, in order. */
  added: EnrichmentKind[];
  /** The lines already inside the price by the incoterm. */
  included: EnrichmentKind[];
  /** The lines not known — what the figure does NOT cover. */
  missing: EnrichmentKind[];
};

export function knownUnitCostOf(
  offer: CostOffer,
  at: Date = new Date(),
  rates: readonly FxRate[] = [],
): KnownUnitCost | null {
  const cost = landedCost(offer, rates, at);
  if (!cost) return null;
  const added = cost.components.filter((c) => c.state === "added").map((c) => c.line);
  if (added.length === 0) return null;
  return {
    unitCents: knownUnitCost(cost),
    currency: cost.currency,
    added,
    included: cost.components.filter((c) => c.state === "included").map((c) => c.line),
    missing: missingLines(cost),
  };
}
