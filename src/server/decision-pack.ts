// The Decision Pack — the database side (Phase V · V10). The rules (which
// offers a pack holds, what each audience reads) are pure and live in
// src/lib/decision-pack.ts.
//
// ── When a pack is built, and rebuilt ───────────────────────────────────────
//
// A pack is created when a round closes into the review — ALWAYS, even with
// no offer in it: an empty pack is what puts "this round came back with
// nothing" in front of a person, who alone decides between relaunching and
// refusing.
//
// While it is `pending` it follows the round: `refreshPack` re-ranks the
// offers (KPI #2) and rebuilds the items whenever an offer is added late,
// corrected or declined, or staff ask for a recomputation. A rebuild that
// would change nothing writes nothing.
//
// Once the request has left `pack_review` nothing here writes any more. What
// the buyer was shown is then a record, and a record that kept following
// the quote rows would not be one.

import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/database";
import * as schema from "@/database/schema";
import type { KpiRunTrigger } from "@/database/schema";
import {
  projectPack,
  samePackItems,
  selectPackItems,
  type PackAudience,
  type PackItemRow,
  type PackOfferSnapshot,
  type PackRow,
  type PackView,
  type RankedOffer,
} from "@/lib/decision-pack";
import type { Kpi2Breakdown } from "@/lib/kpi2";
import { runKpi2 } from "@/server/kpi";
import { getSetting } from "@/server/platform-settings";

function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: string; cause?: { code?: string } } | null) ?? null;
  return code?.code === "23505" || code?.cause?.code === "23505";
}

export type SyncPackOutcome =
  | {
      ok: true;
      packId: string;
      /** False when the pack already said exactly this. */
      changed: boolean;
      items: number;
      /** Offers the round holds — more than `items` when the target capped it. */
      offers: number;
    }
  | { ok: false; reason: "not_found" | "round_not_closed" | "not_in_review" };

type PackRecord = typeof schema.decisionPack.$inferSelect;

/** The request's pending pack, created if it has none. Two builds arriving
 *  together both try the insert; the partial unique index lets one through
 *  and the other reads what it made. */
async function ensurePendingPack(
  request: { id: string; organizationId: string },
  roundId: string,
): Promise<PackRecord> {
  const find = () =>
    db.query.decisionPack.findFirst({
      where: and(
        eq(schema.decisionPack.requestId, request.id),
        eq(schema.decisionPack.status, "pending"),
      ),
    });
  const existing = await find();
  if (existing) return existing;
  try {
    const [created] = await db
      .insert(schema.decisionPack)
      .values({
        id: crypto.randomUUID(),
        requestId: request.id,
        organizationId: request.organizationId,
        roundId,
        status: "pending",
        // Stored ONCE, here: how this pack will be released is decided by the
        // setting as it stood when the pack came to exist, not by whatever
        // the setting says the day someone gets to it.
        releaseMode: await getSetting("pack.release_mode"),
      })
      .returning();
    return created!;
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const winner = await find();
    if (!winner) throw error;
    return winner;
  }
}

/** The latest ranking of the round, joined to what a pack item copies. Only
 *  offers still `received`: a run can outlive an offer staff have since
 *  declined, and a declined offer is not shown to anyone. */
async function latestRanking(roundId: string): Promise<{
  runId: string | null;
  ranked: RankedOffer[];
}> {
  const latest = await db.query.kpiResult.findFirst({
    where: eq(schema.kpiResult.roundId, roundId),
    orderBy: [desc(schema.kpiResult.computedAt)],
    columns: { runId: true },
  });
  if (!latest) return { runId: null, ranked: [] };
  const rows = await db
    .select({
      result: schema.kpiResult,
      quote: schema.quote,
      country: schema.supplier.countryCode,
      verification: schema.supplier.verificationStatus,
    })
    .from(schema.kpiResult)
    .innerJoin(schema.quote, eq(schema.quote.id, schema.kpiResult.quoteId))
    .leftJoin(schema.supplier, eq(schema.supplier.id, schema.quote.supplierId))
    .where(and(eq(schema.kpiResult.runId, latest.runId), eq(schema.quote.status, "received")))
    .orderBy(asc(schema.kpiResult.rank));
  return {
    runId: latest.runId,
    ranked: rows.map(({ result, quote, country, verification }) => ({
      quoteId: quote.id,
      kpiResultId: result.id,
      rank: result.rank,
      offer: {
        supplierName: quote.supplierName,
        supplierCountry: country ?? null,
        supplierVerification: verification ?? null,
        amountCents: quote.amountCents,
        currency: quote.currency,
        quantity: quote.quantity,
        moq: quote.moq,
        leadTimeDays: quote.leadTimeDays,
        incoterm: quote.incoterm,
        paymentTerms: quote.paymentTerms,
        validUntil: quote.validUntil ? quote.validUntil.toISOString() : null,
        respondedAt: quote.respondedAt ? quote.respondedAt.toISOString() : null,
        channel: quote.channel ?? null,
      } satisfies PackOfferSnapshot,
    })),
  };
}

/**
 * Bring the request's pending pack in line with the round's latest ranking.
 *
 * Does NOT rank: it reads the latest stored run. Callers that changed an
 * offer go through `refreshPack`, which ranks first.
 */
export async function syncPack(roundId: string): Promise<SyncPackOutcome> {
  const round = await db.query.rfqRound.findFirst({ where: eq(schema.rfqRound.id, roundId) });
  if (!round) return { ok: false, reason: "not_found" };
  if (!round.closedAt || round.closeReason === "withdrawn") {
    return { ok: false, reason: "round_not_closed" };
  }
  const request = await db.query.request.findFirst({
    where: eq(schema.request.id, round.requestId),
    columns: { id: true, status: true, organizationId: true },
  });
  if (!request) return { ok: false, reason: "not_found" };
  if (request.status !== "pack_review") return { ok: false, reason: "not_in_review" };

  const pack = await ensurePendingPack(request, roundId);

  return await db.transaction(async (tx) => {
    // One rebuild at a time per pack: two arriving together (a close and a
    // correction) would otherwise interleave their delete and insert.
    const [locked] = await tx
      .select()
      .from(schema.decisionPack)
      .where(eq(schema.decisionPack.id, pack.id))
      .for("update");
    // Released or refused while this call was on its way: it is a record now.
    if (!locked || locked.status !== "pending") {
      return { ok: false as const, reason: "not_in_review" as const };
    }

    // Read under the lock, so the items written are the ranking as it is
    // once every earlier rebuild has finished.
    const { runId, ranked } = await latestRanking(roundId);
    const desired = selectPackItems(ranked, round.targetOffers);
    const current = await tx.query.decisionPackItem.findMany({
      where: eq(schema.decisionPackItem.packId, pack.id),
    });

    // The run a pack is "built from" only means something when it holds
    // items; an empty pack points at none.
    const builtFrom = desired.length > 0 ? runId : null;
    const unchanged =
      samePackItems(current, desired) &&
      locked.kpiRunId === builtFrom &&
      locked.roundId === roundId;
    if (!unchanged) {
      await tx.delete(schema.decisionPackItem).where(eq(schema.decisionPackItem.packId, pack.id));
      if (desired.length > 0) {
        await tx.insert(schema.decisionPackItem).values(
          desired.map((item) => ({
            id: crypto.randomUUID(),
            packId: pack.id,
            quoteId: item.quoteId,
            kpiResultId: item.kpiResultId,
            rankComputed: item.rankComputed,
            rankShown: item.rankShown,
            offer: item.offer,
          })),
        );
      }
      await tx
        .update(schema.decisionPack)
        .set({ roundId, kpiRunId: builtFrom, builtAt: new Date() })
        .where(eq(schema.decisionPack.id, pack.id));
    }
    return {
      ok: true as const,
      packId: pack.id,
      changed: !unchanged,
      items: desired.length,
      offers: ranked.length,
    };
  });
}

/**
 * Something about the round's offers changed — or the round just closed:
 * rank them again, then bring the pack in line.
 *
 * For callers that are side effects of something else (a close, an offer
 * entered, corrected or declined). Swallows everything: the close is
 * committed and the offer is saved whether or not the review material could
 * be refreshed, and a staff member can ask for it again from the dossier.
 */
export async function refreshPack(roundId: string | null, trigger: KpiRunTrigger): Promise<void> {
  if (!roundId) return;
  try {
    // `no_offers` is not a failure here: the pack must still be rebuilt, to
    // EMPTY, when the last offer of a round is declined.
    await runKpi2(roundId, trigger);
    const outcome = await syncPack(roundId);
    if (outcome.ok && outcome.changed) {
      console.log(
        `pack: ${outcome.packId} rebuilt — ${outcome.items} item(s) of ${outcome.offers} offer(s) (${trigger})`,
      );
    }
  } catch (error) {
    console.error(`pack: could not refresh round ${roundId} (${trigger}) —`, error);
  }
}

async function loadPack(pack: PackRecord, audience: PackAudience): Promise<PackView | null> {
  const rows = await db
    .select({ item: schema.decisionPackItem, breakdown: schema.kpiResult.breakdown })
    .from(schema.decisionPackItem)
    .leftJoin(schema.kpiResult, eq(schema.kpiResult.id, schema.decisionPackItem.kpiResultId))
    .where(eq(schema.decisionPackItem.packId, pack.id));
  const row: PackRow = {
    id: pack.id,
    requestId: pack.requestId,
    roundId: pack.roundId,
    status: pack.status,
    releaseMode: pack.releaseMode,
    kpiRunId: pack.kpiRunId,
    builtAt: pack.builtAt.toISOString(),
    createdAt: pack.createdAt.toISOString(),
  };
  const items: PackItemRow[] = rows.map(({ item, breakdown }) => {
    const reason = breakdown as Kpi2Breakdown | null;
    return {
      quoteId: item.quoteId,
      rankComputed: item.rankComputed,
      rankShown: item.rankShown,
      offer: item.offer,
      reason: reason ? { factors: reason.factors, notes: reason.notes } : null,
    };
  });
  return projectPack(row, items, audience);
}

/** One pack, as `audience` may read it. Null when there is no such pack, or
 *  when that audience may not read it (see `projectPack`). */
export async function getPackView(
  packId: string,
  audience: PackAudience,
): Promise<PackView | null> {
  const pack = await db.query.decisionPack.findFirst({
    where: eq(schema.decisionPack.id, packId),
  });
  return pack ? await loadPack(pack, audience) : null;
}

export type RequestPackView = {
  pack: PackView;
  /** Offers the round holds right now. More than the pack's items when the
   *  round's target capped it. */
  offersInRound: number;
  targetOffers: number;
};

/** The request's most recent pack, for staff — with what the page needs to
 *  say why it may hold fewer offers than came in. */
export async function loadPackForRequest(requestId: string): Promise<RequestPackView | null> {
  const pack = await db.query.decisionPack.findFirst({
    where: eq(schema.decisionPack.requestId, requestId),
    orderBy: [desc(schema.decisionPack.createdAt)],
  });
  if (!pack) return null;
  const view = await loadPack(pack, "staff");
  if (!view) return null;
  const [round, offers] = await Promise.all([
    db.query.rfqRound.findFirst({
      where: eq(schema.rfqRound.id, pack.roundId),
      columns: { targetOffers: true },
    }),
    db
      .select({ id: schema.quote.id })
      .from(schema.quote)
      .where(and(eq(schema.quote.roundId, pack.roundId), eq(schema.quote.status, "received"))),
  ]);
  return { pack: view, offersInRound: offers.length, targetOffers: round?.targetOffers ?? 0 };
}
