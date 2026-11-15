// The Decision Pack — the RULES (Phase V · V10). Pure and client-safe; the
// table and its writes live in src/server/decision-pack.ts.
//
// Two things are decided here, and both are about what a reader may see:
//
//  • which offers a pack holds — the best `target_offers` of the ranking, in
//    the ranking's order (`selectPackItems`);
//  • what each AUDIENCE gets of it (`projectPack`). Staff see everything.
//    The buyer sees a pack only once it is released, in the order it is
//    SHOWN, and never the computed order behind it: when staff correct a
//    ranking, the difference between the two orders is OSI's working, and
//    the correction note beside it is not the buyer's to read (V11, V12).

import type { PackStatus, QuoteChannel, VerificationStatus } from "@/database/schema";
import type { FactorResult, Kpi2Factor, Kpi2Note } from "@/lib/kpi2";
import type { ReleaseMode } from "@/lib/platform-settings";

/**
 * An offer as the pack holds it — a FROZEN COPY, taken when the item is
 * built. Everything a reader of the pack needs about the offer and its
 * supplier, so that a quote corrected, expired or orphaned afterwards does
 * not change what the pack says.
 *
 * Deliberately absent: `quote.notes`. That field is staff's own remark on
 * the offer ("called twice, price firm until Friday") and has never been
 * written for the buyer.
 */
export type PackOfferSnapshot = {
  supplierName: string;
  supplierCountry: string | null;
  supplierVerification: VerificationStatus | null;
  amountCents: number | null;
  currency: string | null;
  quantity: string | null;
  moq: string | null;
  leadTimeDays: number | null;
  incoterm: string | null;
  paymentTerms: string | null;
  /** ISO instants. */
  validUntil: string | null;
  respondedAt: string | null;
  /** The route the offer came by: the supplier's own entry, or OSI's
   *  transcription of an email. */
  channel: QuoteChannel | null;
};

/** One ranked offer, as the builder receives it. */
export type RankedOffer = {
  quoteId: string;
  kpiResultId: string;
  /** KPI #2's rank within its run — 1 = best. */
  rank: number;
  offer: PackOfferSnapshot;
};

export type PackItemDraft = {
  quoteId: string;
  kpiResultId: string;
  rankComputed: number;
  rankShown: number;
  offer: PackOfferSnapshot;
};

/**
 * The items a pack should hold: the best `targetOffers` of the ranking.
 *
 * `targetOffers` is the ROUND's snapshot — the same number that closes the
 * window early. A round that closed on its deadline with more offers than
 * that still yields a pack of that size: the pack is the shortlist of
 * offers, not the list of them.
 *
 * `rankShown` starts equal to `rankComputed`. Only a person changes it
 * (a correction, V11), and never this function.
 */
export function selectPackItems(
  ranked: readonly RankedOffer[],
  targetOffers: number,
): PackItemDraft[] {
  return [...ranked]
    .sort((a, b) => a.rank - b.rank || a.quoteId.localeCompare(b.quoteId))
    .slice(0, Math.max(0, targetOffers))
    .map((entry) => ({
      quoteId: entry.quoteId,
      kpiResultId: entry.kpiResultId,
      rankComputed: entry.rank,
      rankShown: entry.rank,
      offer: entry.offer,
    }));
}

const SNAPSHOT_KEYS: readonly (keyof PackOfferSnapshot)[] = [
  "supplierName",
  "supplierCountry",
  "supplierVerification",
  "amountCents",
  "currency",
  "quantity",
  "moq",
  "leadTimeDays",
  "incoterm",
  "paymentTerms",
  "validUntil",
  "respondedAt",
  "channel",
];

function sameSnapshot(a: PackOfferSnapshot, b: PackOfferSnapshot): boolean {
  return SNAPSHOT_KEYS.every((key) => (a[key] ?? null) === (b[key] ?? null));
}

/** An item as the table holds it: its references can have been nulled by a
 *  deleted quote or ranking row. */
export type StoredPackItem = Omit<PackItemDraft, "quoteId" | "kpiResultId"> & {
  quoteId: string | null;
  kpiResultId: string | null;
};

/** Would rebuilding change anything? Compared field by field, not as JSON:
 *  the stored copy has been through the database and its key order is not
 *  the builder's. */
export function samePackItems(
  current: readonly StoredPackItem[],
  desired: readonly PackItemDraft[],
): boolean {
  if (current.length !== desired.length) return false;
  const byRank = [...current].sort((a, b) => a.rankComputed - b.rankComputed);
  return desired.every((item, index) => {
    const have = byRank[index];
    return (
      have !== undefined &&
      have.quoteId === item.quoteId &&
      have.kpiResultId === item.kpiResultId &&
      have.rankComputed === item.rankComputed &&
      have.rankShown === item.rankShown &&
      sameSnapshot(have.offer, item.offer)
    );
  });
}

// ── what each audience reads ────────────────────────────────────────────────

export type PackAudience = "staff" | "buyer";

/** Why an offer ranks where it does. The buyer gets the factors and the
 *  notes; the scorer's raw inputs stay with staff. */
export type PackRankingReason = {
  factors: Record<Kpi2Factor, FactorResult>;
  notes: Kpi2Note[];
};

export type PackItemRow = {
  quoteId: string | null;
  rankComputed: number;
  rankShown: number;
  offer: PackOfferSnapshot;
  reason: PackRankingReason | null;
};

export type PackRow = {
  id: string;
  requestId: string;
  roundId: string;
  status: PackStatus;
  releaseMode: ReleaseMode;
  kpiRunId: string | null;
  builtAt: string;
  createdAt: string;
};

export type PackItemView = {
  quoteId: string | null;
  /** The order the buyer is shown. */
  rank: number;
  /** STAFF ONLY — where KPI #2 put it. Absent for the buyer. */
  rankComputed?: number;
  offer: PackOfferSnapshot;
  reason: PackRankingReason | null;
};

export type PackView = {
  id: string;
  requestId: string;
  status: PackStatus;
  builtAt: string;
  items: PackItemView[];
  /** STAFF ONLY. */
  internal?: {
    roundId: string;
    releaseMode: ReleaseMode;
    kpiRunId: string | null;
    createdAt: string;
  };
};

/**
 * The pack as one audience may read it — or null when it may not read it at
 * all.
 *
 * The buyer reads a RELEASED pack and nothing else: a pending one is OSI's
 * working draft (its items still move), and a refused one was never sent.
 * Items come back in the order shown.
 */
export function projectPack(
  pack: PackRow,
  items: readonly PackItemRow[],
  audience: PackAudience,
): PackView | null {
  if (audience === "buyer" && pack.status !== "released") return null;
  const ordered = [...items].sort(
    (a, b) => a.rankShown - b.rankShown || a.rankComputed - b.rankComputed,
  );
  return {
    id: pack.id,
    requestId: pack.requestId,
    status: pack.status,
    builtAt: pack.builtAt,
    items: ordered.map((item) => ({
      quoteId: item.quoteId,
      rank: item.rankShown,
      ...(audience === "staff" ? { rankComputed: item.rankComputed } : {}),
      offer: item.offer,
      reason: item.reason,
    })),
    ...(audience === "staff"
      ? {
          internal: {
            roundId: pack.roundId,
            releaseMode: pack.releaseMode,
            kpiRunId: pack.kpiRunId,
            createdAt: pack.createdAt,
          },
        }
      : {}),
  };
}
