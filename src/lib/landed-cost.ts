// Landed cost (Phase V · V24) — what the goods cost DELIVERED. Pure and
// client-safe: no clock of its own, no database.
//
// ── The basis: PER UNIT (owner, 2026-11-19) ─────────────────────────────────
//
// A supplier quotes a UNIT price (the RFQ asks for one; the quantity is free
// text). A partner quotes a figure for a shipment. They are added only once
// they are on one basis: every partner figure says how many of the supplier's
// units it covers, and is divided by that number.
//
//     landed unit cost = unit price + Σ (partner figure ÷ units it covers)
//
// A figure that does not say how many units it covers is shown and added to
// nothing.
//
// ── What is never done ──────────────────────────────────────────────────────
//
//  • No conversion on a rate nobody stored (decision D7). A figure in another
//    currency is added only when the pack holds a rate for exactly that pair,
//    in that direction — never an inverse, never a rate through a third
//    currency: those would be rates somebody computed, not rates somebody
//    stored.
//  • A missing component is NOT zero. Each line of an offer is either known —
//    inside the price by the incoterm, or added from a partner's figure — or
//    unknown, with the reason. `commonBasis` then keeps, for a comparison,
//    only the lines known for EVERY offer compared: an offer nobody
//    documented is not made to look cheap by what it leaves out, and a
//    documented one is not punished for it.
//  • The fees (OSI's, the settlement partner's) are not in here: they are not
//    quoted at this stage (slice 6).

import { termCovers } from "@/lib/incoterm";
import {
  ENRICHMENT_KINDS,
  isExpired,
  type EnrichmentKind,
  type OfferEnrichment,
} from "@/lib/partner-case";

/** One exchange rate somebody stored: 1 `from` = `rate` `to`. */
export type FxRate = {
  from: string;
  to: string;
  rate: number;
  /** Where the number comes from — "Banque du Canada", "contrat de change". */
  source: string;
  /** The day the rate is of — YYYY-MM-DD. */
  asOf: string;
};

const code = (currency: string | null | undefined) => (currency ?? "").trim().toUpperCase();

/** The stored rate for exactly this pair and direction, or null. */
export function findRate(rates: readonly FxRate[], from: string, to: string): FxRate | null {
  const [a, b] = [code(from), code(to)];
  return rates.find((rate) => code(rate.from) === a && code(rate.to) === b) ?? null;
}

/** Four decimals of a cent: a freight figure spread over 20 000 units is
 *  fractions of a cent per unit, and rounding to the cent would erase it. */
const round4 = (value: number) => Math.round(value * 10_000) / 10_000;

export type UnknownReason =
  /** No partner gave a figure, and the incoterm does not cover the line. */
  | "not_provided"
  /** A figure exists; its validity has passed. */
  | "expired"
  /** A figure exists; it does not say how many units it covers. */
  | "no_quantity"
  /** A figure exists, in another currency, and no rate is stored for it. */
  | "other_currency";

export type LandedComponent = { line: EnrichmentKind } & (
  | {
      /** Inside the supplier's price by the incoterm: nothing to add. A
       *  partner's figure for the same line, if any, is NOT added on top. */
      state: "included";
    }
  | {
      /** A partner's figure, brought to one unit in the offer's currency. */
      state: "added";
      unitCents: number;
      /** The figure as given. */
      amountCents: number;
      currency: string;
      units: number;
      /** The stored rate it was converted with — null in the offer's own
       *  currency. */
      rate: FxRate | null;
    }
  | { state: "unknown"; reason: UnknownReason }
);

export type LandedCost = {
  /** The offer's currency: every amount below is in it. */
  currency: string;
  /** The supplier's unit price. */
  goodsUnitCents: number;
  /** One entry per cost line, in `ENRICHMENT_KINDS` order. */
  components: LandedComponent[];
};

export type LandedOffer = {
  amountCents: number | null;
  currency?: string | null;
  incoterm: string | null;
  enrichments?: readonly OfferEnrichment[];
};

/** What one line of this offer is: included, added, or unknown and why. */
export function landedComponent(
  line: EnrichmentKind,
  offer: LandedOffer,
  rates: readonly FxRate[],
  at: Date,
): LandedComponent {
  // The incoterm first: a line inside the price is never added again,
  // whatever a partner quoted for it.
  if (termCovers(offer.incoterm, line)) return { line, state: "included" };
  const figure = offer.enrichments?.find((e) => e.kind === line);
  if (!figure) return { line, state: "unknown", reason: "not_provided" };
  if (isExpired(figure, at)) return { line, state: "unknown", reason: "expired" };
  const units = figure.units ?? null;
  if (units === null || !(units > 0)) return { line, state: "unknown", reason: "no_quantity" };

  const same = code(figure.currency) === code(offer.currency) && code(offer.currency) !== "";
  const rate = same ? null : findRate(rates, figure.currency, offer.currency ?? "");
  if (!same && !rate) return { line, state: "unknown", reason: "other_currency" };
  return {
    line,
    state: "added",
    unitCents: round4((figure.amountCents * (rate ? rate.rate : 1)) / units),
    amountCents: figure.amountCents,
    currency: code(figure.currency),
    units,
    rate,
  };
}

/**
 * The landed cost of one offer, line by line — or null when the supplier
 * stated no price (there is nothing to add to).
 *
 * `at` is the instant a figure's validity is judged at.
 */
export function landedCost(
  offer: LandedOffer,
  rates: readonly FxRate[],
  at: Date,
): LandedCost | null {
  if (offer.amountCents === null || !(offer.amountCents > 0) || code(offer.currency) === "") {
    return null;
  }
  return {
    currency: code(offer.currency),
    goodsUnitCents: offer.amountCents,
    components: ENRICHMENT_KINDS.map((line) => landedComponent(line, offer, rates, at)),
  };
}

/** The lines this offer's cost is known for. */
export function knownLines(cost: LandedCost): EnrichmentKind[] {
  return cost.components.filter((c) => c.state !== "unknown").map((c) => c.line);
}

/** The lines it is NOT known for. */
export function missingLines(cost: LandedCost): EnrichmentKind[] {
  return cost.components.filter((c) => c.state === "unknown").map((c) => c.line);
}

/**
 * The lines a COMPARISON may rest on: those known for every offer compared.
 *
 * One offer with no freight figure takes freight out of the comparison for
 * all of them. That is the point: adding freight to the others and nothing to
 * that one would rank the least documented offer first.
 */
export function commonBasis(costs: readonly LandedCost[]): EnrichmentKind[] {
  return ENRICHMENT_KINDS.filter((line) =>
    costs.every((cost) => cost.components.some((c) => c.line === line && c.state !== "unknown")),
  );
}

/** The unit cost over the supplier's price and the given lines — in the
 *  offer's currency. A line that is `included` adds nothing: it is already
 *  in the price. */
export function unitCostOn(cost: LandedCost, lines: readonly EnrichmentKind[]): number {
  return round4(
    cost.components.reduce(
      (sum, c) => (lines.includes(c.line) && c.state === "added" ? sum + c.unitCents : sum),
      cost.goodsUnitCents,
    ),
  );
}

/** The unit cost over everything known about THIS offer. */
export function knownUnitCost(cost: LandedCost): number {
  return unitCostOn(cost, knownLines(cost));
}

/**
 * What can be said of a partner's figure next to the supplier's price — the
 * same verdict the calculation reaches, as one word for a label.
 */
export type CostQuoteStanding =
  | "already_included"
  | "expired"
  | "no_quantity"
  | "other_currency"
  /** Added, through a stored rate. */
  | "converted"
  /** Added, in the offer's own currency. */
  | "addable";

export function costQuoteStanding(
  enrichment: OfferEnrichment,
  offer: { currency?: string | null; incoterm: string | null },
  at: Date,
  rates: readonly FxRate[] = [],
): CostQuoteStanding {
  const component = landedComponent(
    enrichment.kind,
    // A price is not needed to judge a figure: only the currency and the term.
    {
      amountCents: 1,
      currency: offer.currency ?? null,
      incoterm: offer.incoterm,
      enrichments: [enrichment],
    },
    rates,
    at,
  );
  if (component.state === "included") return "already_included";
  if (component.state === "added") return component.rate ? "converted" : "addable";
  // `not_provided` cannot happen: the figure was handed in.
  return component.reason === "not_provided" ? "other_currency" : component.reason;
}

/** A stable text form of a set of rates, for "did anything change?". */
export function ratesFingerprint(rates: readonly FxRate[] | null | undefined): string {
  return JSON.stringify(
    [...(rates ?? [])]
      .map((r) => [code(r.from), code(r.to), r.rate, r.source, r.asOf])
      .sort((a, b) => `${a[0]}${a[1]}`.localeCompare(`${b[0]}${b[1]}`)),
  );
}

/**
 * A per-unit amount for a reader: the currency's usual two decimals, and up
 * to four when the amount needs them — a freight figure spread over a
 * shipment is often a fraction of a cent a unit.
 */
export function formatUnitCost(cents: number, currency: string, lang: string): string {
  return new Intl.NumberFormat(lang, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(cents / 100);
}
