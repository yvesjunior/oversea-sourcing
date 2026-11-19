// Cases and enrichments (Phase V · V22) — the pure half.
//
// A partner adds to an offer what only a partner knows: what it costs to
// bring the goods here, to insure them, to clear them, to inspect them. This
// file holds what can be said about those figures without a database: which
// line of the offer's cost each one fills, which of several is the one that
// counts, and whether a figure can stand next to the supplier's price.
//
// Step 08 BLOCKS NOTHING (owner, 2026-10-24): a round with no enrichment at
// all still produces a pack. An absent figure is "not provided", said as
// such — never a zero.

import type { PartnerKind } from "@/lib/partners";

/**
 * What an enrichment is a figure FOR — one line of the offer's landed cost
 * (`COST_LINES` in pack-explain.ts carries the same keys).
 */
export const ENRICHMENT_KINDS = [
  "main_carriage",
  "insurance",
  "import_duties",
  "inspection",
] as const;
export type EnrichmentKind = (typeof ENRICHMENT_KINDS)[number];

/**
 * The cost line each kind of partner fills. One each: the kind of partner a
 * case is opened with decides what its answer is a figure for, so nobody
 * picks a line by hand and a freight quote cannot be filed under duties.
 * `settlement` fills none — its fees are the money circuit's (slice 6).
 */
export const ENRICHMENT_OF: Record<PartnerKind, EnrichmentKind | null> = {
  transport: "main_carriage",
  insurance: "insurance",
  customs: "import_duties",
  inspection: "inspection",
  settlement: null,
};

/** A partner's figure, as an offer carries it — in a pack's frozen copy, on
 *  the offer's card. No partner name: the buyer's counterpart is OSI. */
export type OfferEnrichment = {
  kind: EnrichmentKind;
  amountCents: number;
  currency: string;
  /** ISO instant; null = no end date given. */
  validUntil: string | null;
};

type Versioned = { caseId: string; version: number };

/**
 * The figure that counts for each case: its latest version. Cancelled cases
 * must be left out by the caller — this only resolves versions.
 */
export function latestPerCase<T extends Versioned>(rows: readonly T[]): T[] {
  const latest = new Map<string, T>();
  for (const row of rows) {
    const seen = latest.get(row.caseId);
    if (!seen || row.version > seen.version) latest.set(row.caseId, row);
  }
  return [...latest.values()];
}

export function isExpired(enrichment: Pick<OfferEnrichment, "validUntil">, at: Date): boolean {
  return (
    enrichment.validUntil !== null && new Date(enrichment.validUntil).getTime() <= at.getTime()
  );
}

/**
 * Can this figure stand NEXT TO the supplier's price as part of one cost?
 *
 * Only in the same currency (decision D7 — no amount is converted on a rate
 * nobody stored) and only while it is valid. Otherwise it is still shown, as
 * what it is: a figure in another currency, or an expired one.
 */
export type EnrichmentStanding = "addable" | "other_currency" | "expired";

export function enrichmentStanding(
  enrichment: OfferEnrichment,
  offerCurrency: string | null,
  at: Date,
): EnrichmentStanding {
  if (isExpired(enrichment, at)) return "expired";
  const same =
    offerCurrency !== null &&
    offerCurrency.trim() !== "" &&
    enrichment.currency.toUpperCase() === offerCurrency.toUpperCase();
  return same ? "addable" : "other_currency";
}

/** A stable text form of an offer's enrichments, for "did the pack change?". */
export function enrichmentsFingerprint(
  enrichments: readonly OfferEnrichment[] | undefined,
): string {
  return JSON.stringify(
    [...(enrichments ?? [])]
      .sort((a, b) => a.kind.localeCompare(b.kind))
      .map((e) => [e.kind, e.amountCents, e.currency.toUpperCase(), e.validUntil]),
  );
}
