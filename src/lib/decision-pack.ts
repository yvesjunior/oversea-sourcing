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
export type StoredPackItem = Omit<PackItemDraft, "quoteId" | "kpiResultId" | "rankShown"> & {
  quoteId: string | null;
  kpiResultId: string | null;
  /** Null once a person has taken the offer out of what the buyer sees. */
  rankShown: number | null;
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
  /** Null = taken out of what the buyer is shown (a correction, V11). */
  rankShown: number | null;
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
  releasedAt: string | null;
  releasedByName: string | null;
  refusedReason: string | null;
  assignedTo: string | null;
  assignedToName: string | null;
};

export type PackItemView = {
  quoteId: string | null;
  /** The order the buyer is shown. For staff, null on an item a person took
   *  out; the buyer never receives such an item at all. */
  rank: number | null;
  /** STAFF ONLY — where KPI #2 put it. Absent for the buyer. */
  rankComputed?: number;
  offer: PackOfferSnapshot;
  /** How well the SUPPLIER fits the need (KPI #1, 0–100) — an absolute
   *  figure about that supplier, so it says nothing about the other offers. */
  fit: number | null;
  /** The offer's validity had already lapsed when the round closed. */
  validityExpired: boolean;
  /**
   * STAFF ONLY — the ranking's factors and notes. Absent for the buyer, and
   * not out of tidiness: every factor is scored AGAINST THE OTHER RANKED
   * OFFERS, withheld ones included. "Lead time: 67 points" in a response
   * that shows a single offer says a faster one exists. What the buyer's
   * page compares, it works out from the offers it was given (`explainOffer`).
   */
  reason?: PackRankingReason | null;
};

export type PackView = {
  id: string;
  requestId: string;
  status: PackStatus;
  builtAt: string;
  /** When it was sent — the buyer may know that; who sent it is staff's. */
  releasedAt: string | null;
  /** A person released it (V14). False on an automatic release — and the one
   *  thing about HOW it left that the buyer's page needs: it may only say
   *  "reviewed by our team" when somebody did. */
  reviewed: boolean;
  items: PackItemView[];
  /** STAFF ONLY. */
  internal?: {
    roundId: string;
    releaseMode: ReleaseMode;
    kpiRunId: string | null;
    createdAt: string;
    releasedByName: string | null;
    refusedReason: string | null;
    assignedTo: string | null;
    assignedToName: string | null;
  };
};

/**
 * The pack as one audience may read it — or null when it may not read it at
 * all.
 *
 * The buyer reads a RELEASED pack and nothing else: a pending one is OSI's
 * working draft (its items still move), and a refused or withdrawn one was
 * never sent. Items come back in the order shown, and an item a person took
 * out is not among them: the buyer cannot tell that anything was withheld.
 */
export function projectPack(
  pack: PackRow,
  items: readonly PackItemRow[],
  audience: PackAudience,
): PackView | null {
  if (audience === "buyer" && pack.status !== "released") return null;
  const shown = items
    .filter((item) => item.rankShown !== null)
    .sort((a, b) => (a.rankShown as number) - (b.rankShown as number));
  // Staff see the withheld ones too, after the shown ones, in computed order.
  const withheld =
    audience === "staff"
      ? items
          .filter((item) => item.rankShown === null)
          .sort((a, b) => a.rankComputed - b.rankComputed)
      : [];
  return {
    id: pack.id,
    requestId: pack.requestId,
    status: pack.status,
    builtAt: pack.builtAt,
    releasedAt: pack.releasedAt,
    // The name is a snapshot kept when the account goes, so null means
    // nobody ever was there — the system released it.
    reviewed: pack.releasedByName !== null,
    items: [...shown, ...withheld].map((item) => {
      const fit = item.reason?.factors.kpi1;
      return {
        quoteId: item.quoteId,
        rank: item.rankShown,
        ...(audience === "staff" ? { rankComputed: item.rankComputed } : {}),
        offer: item.offer,
        fit: fit && fit.state === "scored" && fit.points !== null ? Math.round(fit.points) : null,
        validityExpired: item.reason?.notes.includes("validity_expired") ?? false,
        ...(audience === "staff" ? { reason: item.reason } : {}),
      };
    }),
    ...(audience === "staff"
      ? {
          internal: {
            roundId: pack.roundId,
            releaseMode: pack.releaseMode,
            kpiRunId: pack.kpiRunId,
            createdAt: pack.createdAt,
            releasedByName: pack.releasedByName,
            refusedReason: pack.refusedReason,
            assignedTo: pack.assignedTo,
            assignedToName: pack.assignedToName,
          },
        }
      : {}),
  };
}

// ── the four powers (V11) ───────────────────────────────────────────────────

export type CorrectionRefusal =
  /** An id in `order` or `removals` that is not an item of this pack. */
  | "unknown_item"
  /** `order` and `removals` together do not cover every item exactly once. */
  | "incomplete_order"
  /** Everything was removed: that is a refusal, and has its own door. */
  | "nothing_shown"
  /** The order asked for IS the computed one, with nothing removed: that is
   *  an approval. Recording it as a correction would count a pack staff left
   *  alone among the ones they changed. */
  | "nothing_changed";

export type CorrectionPlan =
  | {
      ok: true;
      /** quoteId → the rank the buyer will see; null = withheld. */
      ranks: Map<string, number | null>;
      /** What moved, for the record: computed place → shown place. */
      moves: { quoteId: string; from: number; to: number | null }[];
    }
  | { ok: false; reason: CorrectionRefusal };

/**
 * Check a correction and work out what it does — without touching anything.
 *
 * `order` is the offers the buyer will see, best first; `removals` the ones
 * withheld. Together they must name every item of the pack exactly once: a
 * correction that silently dropped an offer by leaving it out of both lists
 * would withhold it with no trace of anyone having decided to.
 */
export function planCorrection(
  items: readonly { quoteId: string | null; rankComputed: number }[],
  order: readonly string[],
  removals: readonly string[],
): CorrectionPlan {
  const known = new Map<string, number>();
  for (const item of items) if (item.quoteId) known.set(item.quoteId, item.rankComputed);
  const named = [...order, ...removals];
  if (named.some((id) => !known.has(id))) return { ok: false, reason: "unknown_item" };
  if (new Set(named).size !== named.length || named.length !== known.size) {
    return { ok: false, reason: "incomplete_order" };
  }
  if (order.length === 0) return { ok: false, reason: "nothing_shown" };

  const ranks = new Map<string, number | null>();
  order.forEach((id, index) => ranks.set(id, index + 1));
  for (const id of removals) ranks.set(id, null);

  // "Unchanged" = nothing removed and the order is the computed order. The
  // computed ranks need not be 1..n (a pack capped at its target after a
  // decline), so the test is on ORDER, not on rank values.
  const computedOrder = [...known.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);
  const unchanged = removals.length === 0 && computedOrder.every((id, i) => order[i] === id);
  if (unchanged) return { ok: false, reason: "nothing_changed" };

  const position = new Map(computedOrder.map((id, index) => [id, index + 1]));
  const moves = named
    .map((id) => ({ quoteId: id, from: position.get(id) as number, to: ranks.get(id) ?? null }))
    .filter((move) => move.from !== move.to)
    .sort((a, b) => a.from - b.from);
  return { ok: true, ranks, moves };
}

/**
 * May this supplier be asked (again) in a relaunch — and what were they?
 *
 *  • `never_asked` — on the shortlist, never solicited;
 *  • `closed_before_deadline` — written to, cut short by OSI: they still had
 *    time, and asking again is only fair;
 *  • `not_reached` — the RFQ never got to them;
 *  • `no_response` — they had a full window and said nothing. Asking again
 *    is ALLOWED, but it is a decision, and the page says so.
 *
 * Not eligible (null): a supplier whose offer is in hand (it stays in the
 * pack — an answer already held is never thrown away), one who said no
 * (`supplier_declined`), one still being asked, and anything else.
 */
export type RelaunchState =
  "never_asked" | "closed_before_deadline" | "not_reached" | "no_response";

export function relaunchState(
  quote: { status: string; declineReason: string | null } | null,
): RelaunchState | null {
  if (!quote) return "never_asked";
  if (quote.status !== "declined") return null;
  if (
    quote.declineReason === "closed_before_deadline" ||
    quote.declineReason === "not_reached" ||
    quote.declineReason === "no_response"
  ) {
    return quote.declineReason;
  }
  return null;
}

// ── choosing from the pack (V13) ────────────────────────────────────────────

/** Where an offer of the pack stands NOW — the pack is frozen, whether an
 *  offer can still be taken is not. */
export type PackOfferState =
  /** Received and within its validity: can be accepted. */
  | "open"
  /** Its validity ran out: cannot be accepted, can be asked for again. */
  | "expired"
  | "accepted"
  /** The buyer accepted another offer. */
  | "lost"
  /** Asked for again — a new round is collecting it. */
  | "reasked"
  /** Anything else (declined since by the supplier, quote gone). */
  | "unavailable";

/**
 * The live state of one offer, from its quote row.
 *
 * Expiry is DERIVED from `valid_until`, like everywhere else in the product:
 * a received offer whose date has passed is `expired` whatever the column
 * still says, and one with no date never expires on the clock.
 */
export function packOfferState(
  quote: { status: string; validUntil: Date | null; declineReason: string | null },
  now: Date,
): PackOfferState {
  switch (quote.status) {
    case "accepted":
      return "accepted";
    case "received":
      return quote.validUntil !== null && quote.validUntil.getTime() < now.getTime()
        ? "expired"
        : "open";
    case "expired":
      return "expired";
    case "requested":
      return "reasked";
    case "declined":
      return quote.declineReason === "lost" ? "lost" : "unavailable";
    default:
      return "unavailable";
  }
}

// ── The other release mode (V14) ────────────────────────────────────────────

/** Why a pack is NOT released by the system when its round closes. */
export type AutoReleaseHold =
  /** Its stored mode says a person sends it. */
  | "manual"
  /** Something was already done to it — held once, relaunched, taken. A pack
   *  that reached a person stays a person's, whatever closes afterwards. */
  | "in_hand"
  /** The round closed with no offer of its own, or the pack shows none. */
  | "no_offers";

/**
 * Whether a pack leaves by itself at the close of its round — null when it
 * does.
 *
 * Automatic release happens at ONE moment only: the close that built the
 * pack, when that round brought at least one offer. Everything else goes to
 * a person, and stays there:
 *
 * • a round that came back empty is a decision (relaunch or refuse), not a
 *   delivery — and a round that added nothing to offers already held is the
 *   same question;
 * • once a pack has any history, somebody is — or was — deciding about it.
 *   Without this, flipping the setting back to `manual` would still let a
 *   relaunched pack leave alone when its second round closed, because the
 *   mode a pack carries is the one it was created with.
 */
export function autoReleaseHold(pack: {
  releaseMode: ReleaseMode;
  /** Rows of `decision_pack_event` the pack already has. */
  events: number;
  /** Offers answered in the round that just closed. */
  offersInRound: number;
  /** Items the pack would show. */
  items: number;
}): AutoReleaseHold | null {
  if (pack.releaseMode !== "automatic") return "manual";
  if (pack.events > 0) return "in_hand";
  if (pack.offersInRound === 0 || pack.items === 0) return "no_offers";
  return null;
}
