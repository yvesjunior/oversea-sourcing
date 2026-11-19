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

import { and, asc, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/database";
import * as schema from "@/database/schema";
import type { KpiRunTrigger, PackEventAction } from "@/database/schema";
import {
  autoReleaseHold,
  packOfferState,
  planCorrection,
  projectPack,
  relaunchState,
  samePackItems,
  selectPackItems,
  type AutoReleaseHold,
  type CorrectionRefusal,
  type PackAudience,
  type PackItemRow,
  type PackOfferState,
  type PackOfferSnapshot,
  type PackRow,
  type PackView,
  type RankedOffer,
  type RelaunchState,
} from "@/lib/decision-pack";
import type { Kpi2Breakdown } from "@/lib/kpi2";
import { logAudit } from "@/server/audit";
import { runKpi2 } from "@/server/kpi";
import { notifyUser } from "@/server/notify";
import { getSetting } from "@/server/platform-settings";
import { transitionRequest } from "@/server/requests";
import { ensureSpec } from "@/server/spec";
import { sendRfqBatch } from "@/server/rfq";
import { tellOfferHolders } from "@/server/rfq-window";
import { primaryContactsFor } from "@/server/supplier-contacts";

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
async function latestRanking(requestId: string): Promise<{
  runId: string | null;
  ranked: RankedOffer[];
}> {
  const latest = await db.query.kpiResult.findFirst({
    where: eq(schema.kpiResult.requestId, requestId),
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
  // What partners added to each offer (V22), frozen into the copy with the
  // rest. An offer nobody enriched carries no list at all.
  const { currentEnrichments } = await import("@/server/partner-cases");
  const enrichments = await currentEnrichments(rows.map((row) => row.quote.id));
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
        ...(enrichments.has(quote.id) ? { enrichments: enrichments.get(quote.id)! } : {}),
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
    const { runId, ranked } = await latestRanking(request.id);
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
    releasedAt: pack.releasedAt ? pack.releasedAt.toISOString() : null,
    releasedByName: pack.releasedByName,
    refusedReason: pack.refusedReason,
    assignedTo: pack.assignedTo,
    assignedToName: pack.assignedToName,
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

/** One thing done to a pack, shaped for the page. `payload` is jsonb written
 *  by the action of its day — read defensively, and never passed through as
 *  it is. */
export type PackEventView = {
  action: PackEventAction;
  actorName: string | null;
  at: string;
  /** The correction's or relaunch's note, or the refusal's reason. */
  note: string | null;
  /** A correction: computed place → shown place (null = withheld). */
  moves: { supplier: string | null; from: number; to: number | null }[];
  /** A relaunch: who was asked, and what each had been closed as. */
  suppliers: { name: string; was: string }[];
  round: number | null;
  /** An assignment: to whom — null when it was put back. */
  toName: string | null;
};

function readEvent(event: typeof schema.decisionPackEvent.$inferSelect): PackEventView {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === "string" ? value : null);
  const list = (value: unknown) => (Array.isArray(value) ? (value as unknown[]) : []);
  return {
    action: event.action,
    actorName: event.actorName,
    at: event.createdAt.toISOString(),
    note: text(payload["note"]) ?? text(payload["reason"]),
    moves: list(payload["moves"]).flatMap((entry) => {
      const move = (entry ?? {}) as Record<string, unknown>;
      return typeof move["from"] === "number"
        ? [
            {
              supplier: text(move["supplier"]),
              from: move["from"],
              to: typeof move["to"] === "number" ? move["to"] : null,
            },
          ]
        : [];
    }),
    suppliers: list(payload["suppliers"]).flatMap((entry) => {
      const supplier = (entry ?? {}) as Record<string, unknown>;
      const name = text(supplier["name"]);
      return name ? [{ name, was: text(supplier["was"]) ?? "" }] : [];
    }),
    round: typeof payload["round"] === "number" ? payload["round"] : null,
    toName: text(payload["toName"]),
  };
}

export type RelaunchCandidate = {
  supplierId: string;
  name: string;
  /** KPI #1's rank — the order the shortlist was in. */
  rank: number;
  state: RelaunchState;
  /** No primary contact = cannot be written to; add one first. */
  hasContact: boolean;
};

export type RequestPackView = {
  pack: PackView;
  /** Offers the request holds right now. More than the pack's items when the
   *  round's target capped it. */
  offersInRound: number;
  targetOffers: number;
  /** The four powers apply: the pack is pending AND the request is in
   *  review. False while a relaunched round is open — nothing to decide
   *  until it closes. */
  canAct: boolean;
  /** Since when it has been waiting on a person — the close of the round
   *  that last built it. */
  waitingSince: string | null;
  /** Suppliers of the shortlist a relaunch could ask. */
  candidates: RelaunchCandidate[];
  /** A relaunch writes to suppliers, so it needs somewhere for them to
   *  answer — the same rule as the first batch. */
  replyToSet: boolean;
  /** What was done to this pack, oldest first. */
  events: PackEventView[];
};

/** The shortlist suppliers who could be asked in a relaunch, in KPI #1 order. */
async function relaunchCandidates(requestId: string): Promise<RelaunchCandidate[]> {
  const [ranked, quotes] = await Promise.all([
    db
      .select({ id: schema.supplier.id, name: schema.supplier.name, rank: schema.match.rank })
      .from(schema.match)
      .innerJoin(schema.supplier, eq(schema.supplier.id, schema.match.supplierId))
      .where(eq(schema.match.requestId, requestId))
      .orderBy(asc(schema.match.rank)),
    db.query.quote.findMany({ where: eq(schema.quote.requestId, requestId) }),
  ]);
  const quoteBySupplier = new Map(quotes.map((quote) => [quote.supplierId, quote]));
  const contacts = await primaryContactsFor(ranked.map((supplier) => supplier.id));
  return ranked.flatMap((supplier) => {
    const quote = quoteBySupplier.get(supplier.id) ?? null;
    const state = relaunchState(
      quote ? { status: quote.status, declineReason: quote.declineReason ?? null } : null,
    );
    return state
      ? [
          {
            supplierId: supplier.id,
            name: supplier.name,
            rank: supplier.rank,
            state,
            hasContact: contacts.has(supplier.id),
          },
        ]
      : [];
  });
}

/** The request's most recent pack, for staff — with what the page needs to
 *  act on it and to say why it may hold fewer offers than came in. */
export async function loadPackForRequest(requestId: string): Promise<RequestPackView | null> {
  const pack = await db.query.decisionPack.findFirst({
    where: eq(schema.decisionPack.requestId, requestId),
    orderBy: [desc(schema.decisionPack.createdAt)],
  });
  if (!pack) return null;
  const view = await loadPack(pack, "staff");
  if (!view) return null;
  const [request, round, offers, events, replyTo] = await Promise.all([
    db.query.request.findFirst({
      where: eq(schema.request.id, requestId),
      columns: { status: true },
    }),
    db.query.rfqRound.findFirst({
      where: eq(schema.rfqRound.id, pack.roundId),
      columns: { targetOffers: true, closedAt: true },
    }),
    db
      .select({ id: schema.quote.id })
      .from(schema.quote)
      .where(
        and(
          eq(schema.quote.requestId, requestId),
          isNotNull(schema.quote.roundId),
          eq(schema.quote.status, "received"),
        ),
      ),
    db.query.decisionPackEvent.findMany({
      where: eq(schema.decisionPackEvent.packId, pack.id),
      orderBy: [asc(schema.decisionPackEvent.createdAt)],
    }),
    getSetting("rfq.reply_to"),
  ]);
  const canAct = pack.status === "pending" && request?.status === "pack_review";
  return {
    pack: view,
    offersInRound: offers.length,
    targetOffers: round?.targetOffers ?? 0,
    canAct,
    waitingSince: round?.closedAt ? round.closedAt.toISOString() : null,
    // Only worth computing when a relaunch is possible.
    candidates: canAct ? await relaunchCandidates(requestId) : [],
    replyToSet: replyTo !== "",
    events: events.map(readEvent),
  };
}

// ── the four powers, and the desk (V11) ─────────────────────────────────────
//
// Approve, correct, relaunch, refuse (owner, 2026-10-25) — and assign.
//
// RELEASE IS THE IRREVERSIBLE ACT. Approving and correcting both end in it:
// the pack goes `released`, the request `pack_review → report_ready`, and
// from that instant nothing rebuilds the pack — `syncPack` refuses anything
// that is not pending, `runKpi2` anything outside the review. What the buyer
// was shown is then exactly these rows.
//
// Every act locks the REQUEST first, then the pack, in one transaction, and
// checks under the lock that the request is still in review and the pack
// still pending: two people deciding at once, or a decision racing a buyer's
// cancel, end as one decision.

type Actor = { id: string; name: string };

export type PackActionRefusal =
  | "not_found"
  /** Already released, refused or withdrawn — or the request has moved on. */
  | "not_pending"
  /** Nothing in it that the buyer could be shown. */
  | "empty"
  | "note_required"
  | CorrectionRefusal
  | "no_suppliers"
  /** A supplier named is not one a relaunch may ask (see `relaunchState`). */
  | "not_eligible"
  | "missing_contact"
  | "no_reply_address";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Lock the request, then the pack; null unless the pack is pending and the
 *  request in review. */
async function lockForDecision(tx: Tx, packId: string) {
  const found = await tx.query.decisionPack.findFirst({
    where: eq(schema.decisionPack.id, packId),
    columns: { requestId: true },
  });
  if (!found) return { refusal: "not_found" as const };
  const [request] = await tx
    .select()
    .from(schema.request)
    .where(eq(schema.request.id, found.requestId))
    .for("update");
  const [pack] = await tx
    .select()
    .from(schema.decisionPack)
    .where(eq(schema.decisionPack.id, packId))
    .for("update");
  if (!request || !pack) return { refusal: "not_found" as const };
  if (pack.status !== "pending" || request.status !== "pack_review") {
    return { refusal: "not_pending" as const };
  }
  return { request, pack };
}

async function recordPackEvent(
  tx: Tx,
  packId: string,
  action: PackEventAction,
  actor: Actor | null,
  payload: Record<string, unknown> | null,
): Promise<void> {
  await tx.insert(schema.decisionPackEvent).values({
    id: crypto.randomUUID(),
    packId,
    action,
    actorId: actor?.id ?? null,
    actorName: actor?.name ?? null,
    payload,
  });
}

/** The irreversible half, shared by approve, correct and the automatic
 *  release. `actor` null = the system released it (V14): `released_by` AND
 *  its name stay null, and that pair means nothing else — a person whose
 *  account is later deleted keeps their name here. */
async function release(
  tx: Tx,
  pack: PackRecord,
  request: { id: string; organizationId: string },
  actor: Actor | null,
): Promise<void> {
  const now = new Date();
  await tx
    .update(schema.decisionPack)
    .set({
      status: "released",
      releasedAt: now,
      releasedBy: actor?.id ?? null,
      releasedByName: actor?.name ?? null,
    })
    .where(eq(schema.decisionPack.id, pack.id));
  await transitionRequest(request.id, request.organizationId, "pack_review", "report_ready", tx);
}

export type PackActionResult =
  { ok: true; requestId: string; items: number } | { ok: false; reason: PackActionRefusal };

/** Release the pack exactly as it was built. */
export async function approvePack(packId: string, actor: Actor): Promise<PackActionResult> {
  const result = await db.transaction(async (tx) => {
    const locked = await lockForDecision(tx, packId);
    if ("refusal" in locked) return { ok: false as const, reason: locked.refusal };
    const items = await tx.query.decisionPackItem.findMany({
      where: eq(schema.decisionPackItem.packId, packId),
    });
    // An empty pack is a round that came back with nothing. Sending the
    // buyer "here are your zero offers" is not an approval; relaunch or
    // refuse.
    if (items.length === 0) return { ok: false as const, reason: "empty" as const };
    await release(tx, locked.pack, locked.request, actor);
    await recordPackEvent(tx, packId, "approved", actor, { items: items.length });
    return { ok: true as const, requestId: locked.request.id, items: items.length };
  });
  if (result.ok) await tellBuyerPackReady(result.requestId, true);
  return result;
}

/**
 * Change what the buyer is shown — the order, or which offers — and release.
 *
 * Writes `rank_shown` and NEVER `rank_computed`: the pair is what lets "would
 * the automatic release have shown the same?" be asked afterwards. The note
 * is required and stays with the pack, in `decision_pack_event`.
 */
export async function correctPack(
  packId: string,
  actor: Actor,
  input: { order: readonly string[]; removals: readonly string[]; note: string },
): Promise<PackActionResult> {
  const note = input.note.trim();
  if (note === "") return { ok: false, reason: "note_required" };
  const result = await db.transaction(async (tx) => {
    const locked = await lockForDecision(tx, packId);
    if ("refusal" in locked) return { ok: false as const, reason: locked.refusal };
    const items = await tx.query.decisionPackItem.findMany({
      where: eq(schema.decisionPackItem.packId, packId),
    });
    if (items.length === 0) return { ok: false as const, reason: "empty" as const };
    const plan = planCorrection(items, input.order, input.removals);
    if (!plan.ok) return { ok: false as const, reason: plan.reason };

    for (const item of items) {
      if (!item.quoteId) continue;
      await tx
        .update(schema.decisionPackItem)
        .set({ rankShown: plan.ranks.get(item.quoteId) ?? null })
        .where(eq(schema.decisionPackItem.id, item.id));
    }
    await release(tx, locked.pack, locked.request, actor);
    const nameOf = new Map(items.map((item) => [item.quoteId, item.offer.supplierName]));
    await recordPackEvent(tx, packId, "corrected", actor, {
      note,
      // Names beside the ids: the record must still read when a quote is gone.
      moves: plan.moves.map((move) => ({ ...move, supplier: nameOf.get(move.quoteId) ?? null })),
    });
    return { ok: true as const, requestId: locked.request.id, items: input.order.length };
  });
  if (result.ok) await tellBuyerPackReady(result.requestId, true);
  return result;
}

/**
 * The pack is released: tell the person who filed the request (V12).
 *
 * After the commit, and never allowed to undo it — `notifyUser` swallows its
 * own failures. Says nothing about HOW a person released it: approved as
 * built or corrected is OSI's working, and the buyer's message is the same
 * either way. The one difference it does carry is `reviewed` (V14): a pack
 * the system released was not looked at by anyone, so the message must not
 * say it was.
 */
async function tellBuyerPackReady(requestId: string, reviewed: boolean): Promise<void> {
  const request = await db.query.request.findFirst({
    where: eq(schema.request.id, requestId),
    columns: { id: true, createdBy: true, organizationId: true },
  });
  // created_by is null when the creator's account was deleted — the pack is
  // released all the same, there is simply nobody to notify.
  if (!request?.createdBy) return;
  const link = `/demandes/${request.id}/pack`;
  const base = process.env["BETTER_AUTH_URL"] ?? "http://localhost:3010";
  await notifyUser({
    userId: request.createdBy,
    organizationId: request.organizationId,
    type: "pack_ready",
    params: { id: request.id },
    link,
    email: {
      subjectFr: `Votre Decision Pack OSI #${request.id} est prêt`,
      subjectEn: `Your OSI Decision Pack #${request.id} is ready`,
      bodyFr: `${reviewed ? `Les offres reçues pour votre demande #${request.id} ont été revues par notre équipe` : `Les offres reçues pour votre demande #${request.id} ont été classées`} : votre Decision Pack est disponible.\nConsultez-le : ${base}${link}`,
      bodyEn: `${reviewed ? `The offers received for your request #${request.id} have been reviewed by our team` : `The offers received for your request #${request.id} have been ranked`}: your Decision Pack is available.\nView it: ${base}${link}`,
    },
  });
}

export type AutoReleaseOutcome =
  | { released: true; packId: string; requestId: string; items: number }
  | {
      released: false;
      reason:
        | AutoReleaseHold
        | "no_pack"
        /** Decided, or the request left the review, while this was on its way. */
        | "not_pending"
        /** The pack was not rebuilt for this close — the refresh failed. */
        | "not_built";
    };

/**
 * The other release mode (V14): a round just closed — does its pack leave
 * without a person?
 *
 * Reads the mode STORED ON THE PACK, never the setting: flipping the setting
 * changes the packs created afterwards and none that already exist. The rule
 * itself is `autoReleaseHold`; this is its transaction. An `automatic` pack
 * that is held for want of an offer gets a `held` event, which is what makes
 * it a person's from then on — and what the review report counts.
 *
 * Called by `closeRound` only, after `refreshPack`. Not by a late answer, a
 * correction or a recomputation: those happen to a pack already in review.
 */
export async function releaseAutomatically(roundId: string): Promise<AutoReleaseOutcome> {
  const round = await db.query.rfqRound.findFirst({
    where: eq(schema.rfqRound.id, roundId),
    columns: { requestId: true, roundNo: true },
  });
  if (!round) return { released: false, reason: "no_pack" };
  const pending = await db.query.decisionPack.findFirst({
    where: and(
      eq(schema.decisionPack.requestId, round.requestId),
      eq(schema.decisionPack.status, "pending"),
    ),
    columns: { id: true, releaseMode: true },
  });
  if (!pending) return { released: false, reason: "no_pack" };
  // The mode never changes once the pack exists, so this needs no lock —
  // and it is every pack there is while the setting stays on `manual`.
  if (pending.releaseMode !== "automatic") return { released: false, reason: "manual" };

  const outcome = await db.transaction(async (tx): Promise<AutoReleaseOutcome> => {
    const locked = await lockForDecision(tx, pending.id);
    if ("refusal" in locked) return { released: false, reason: "not_pending" };
    const { pack, request } = locked;
    if (pack.roundId !== roundId) return { released: false, reason: "not_built" };
    const items = await tx.query.decisionPackItem.findMany({
      where: eq(schema.decisionPackItem.packId, pack.id),
      columns: { id: true },
    });
    const events = await tx.query.decisionPackEvent.findMany({
      where: eq(schema.decisionPackEvent.packId, pack.id),
      columns: { id: true },
    });
    const inRound = await tx
      .select({ id: schema.quote.id })
      .from(schema.quote)
      .where(and(eq(schema.quote.roundId, roundId), eq(schema.quote.status, "received")));
    const hold = autoReleaseHold({
      releaseMode: pack.releaseMode,
      events: events.length,
      offersInRound: inRound.length,
      items: items.length,
    });
    if (hold) {
      if (hold === "no_offers") {
        // `cause`, not `reason` or `note`: those two are a person's words,
        // and `readEvent` prints them as such.
        await recordPackEvent(tx, pack.id, "held", null, {
          cause: "no_offers",
          round: round.roundNo,
        });
      }
      return { released: false, reason: hold };
    }
    await release(tx, pack, request, null);
    await recordPackEvent(tx, pack.id, "auto_released", null, { items: items.length });
    return { released: true, packId: pack.id, requestId: request.id, items: items.length };
  });

  if (outcome.released) {
    await tellBuyerPackReady(outcome.requestId, false);
    const request = await db.query.request.findFirst({
      where: eq(schema.request.id, outcome.requestId),
      columns: { organizationId: true },
    });
    await logAudit({
      // No actor: the rule ran, nobody acted (as on a deadline close).
      actorId: null,
      actorName: null,
      organizationId: request?.organizationId ?? null,
      action: "pack.auto_released",
      target: `#${outcome.requestId}`,
      detail: { pack: outcome.packId, items: outcome.items, round: round.roundNo },
    });
    console.log(
      `pack: ${outcome.packId} released automatically — ${outcome.items} item(s), request ${outcome.requestId}`,
    );
  }
  return outcome;
}

export type RefusePackResult =
  { ok: true; requestId: string; holdersTold: number } | { ok: false; reason: PackActionRefusal };

/**
 * Refuse to send a pack: the request ends `unfulfilled`, and the buyer is
 * told why. The reason is required — it is the only thing the buyer gets for
 * having waited through a window and a review.
 */
export async function refusePack(
  packId: string,
  actor: Actor,
  rawReason: string,
): Promise<RefusePackResult> {
  const reason = rawReason.trim();
  if (reason === "") return { ok: false, reason: "note_required" };
  const outcome = await db.transaction(async (tx) => {
    const locked = await lockForDecision(tx, packId);
    if ("refusal" in locked) return { ok: false as const, reason: locked.refusal };
    const { request, pack } = locked;
    const now = new Date();
    await tx
      .update(schema.decisionPack)
      .set({ status: "refused", refusedReason: reason })
      .where(eq(schema.decisionPack.id, pack.id));
    await transitionRequest(request.id, request.organizationId, "pack_review", "unfulfilled", tx);
    await tx
      .update(schema.request)
      .set({
        unfulfilledReason: reason,
        unfulfilledAt: now,
        unfulfilledBy: actor.id,
        unfulfilledByName: actor.name,
      })
      .where(eq(schema.request.id, request.id));
    await recordPackEvent(tx, packId, "refused", actor, { reason });
    return { ok: true as const, request };
  });
  if (!outcome.ok) return outcome;
  const { request } = outcome;

  // ── After the commit: the people who were waiting ─────────────────────────
  if (request.createdBy) {
    const link = `/demandes/${request.id}`;
    const base = process.env["BETTER_AUTH_URL"] ?? "http://localhost:3010";
    await notifyUser({
      userId: request.createdBy,
      organizationId: request.organizationId,
      type: "request_unfulfilled",
      params: { id: request.id },
      link,
      email: {
        subjectFr: `Votre demande OSI #${request.id} est classée sans suite`,
        subjectEn: `Your OSI request #${request.id} has been closed without a result`,
        bodyFr: `Notre équipe n'a pas pu vous transmettre de Decision Pack pour la demande #${request.id}.\nMotif : ${reason}\nAucune offre ne vous sera transmise pour cette demande. Vous pouvez en déposer une nouvelle à tout moment : ${base}${link}`,
        bodyEn: `Our team could not send you a Decision Pack for request #${request.id}.\nReason: ${reason}\nNo offer will be passed on for this request. You can submit a new one at any time: ${base}${link}`,
      },
    });
  }
  let holdersTold = 0;
  try {
    holdersTold = await tellOfferHolders(request.id, "closed");
  } catch (error) {
    console.error(`pack: could not tell the suppliers of ${request.id} it is closed —`, error);
  }
  return { ok: true, requestId: request.id, holdersTold };
}

export type RelaunchPackResult =
  | {
      ok: true;
      requestId: string;
      roundNo: number;
      sent: number;
      /** Suppliers the RFQ could not be handed over for — still unsent, and
       *  written to again by « Renvoyer » on the dossier. */
      failed: string[];
    }
  | { ok: false; reason: PackActionRefusal; suppliers?: string[] };

/**
 * Ask more suppliers: a NEW round opens for the ones named, and the request
 * goes back to `soliciting`. The pack stays pending, and the offers already
 * in hand stay where they are — when the new round closes, the pack is
 * rebuilt from all of them together (decision D5 as its default: an answer
 * already held is never thrown away; the new round has its own clock).
 *
 * A supplier asked again keeps ONE quote row (`quote_request_supplier_uq`):
 * it is reopened and moved to the new round, so what it had been closed as
 * is recorded HERE, in the event's payload, before the row forgets it.
 */
export async function relaunchPack(
  packId: string,
  actor: Actor,
  input: { supplierIds: readonly string[]; note: string },
): Promise<RelaunchPackResult> {
  const note = input.note.trim();
  if (note === "") return { ok: false, reason: "note_required" };
  const supplierIds = [...new Set(input.supplierIds)];
  if (supplierIds.length === 0) return { ok: false, reason: "no_suppliers" };
  // Refused before anything is opened, like the first batch: an RFQ whose
  // replies vanish, or with nobody to send it to, is worse than none.
  if ((await getSetting("rfq.reply_to")) === "") return { ok: false, reason: "no_reply_address" };

  const found = await db.query.decisionPack.findFirst({
    where: eq(schema.decisionPack.id, packId),
    columns: { requestId: true },
  });
  if (!found) return { ok: false, reason: "not_found" };
  const candidates = await relaunchCandidates(found.requestId);
  const byId = new Map(candidates.map((candidate) => [candidate.supplierId, candidate]));
  const chosen = supplierIds.map((id) => byId.get(id));
  if (chosen.some((candidate) => !candidate)) return { ok: false, reason: "not_eligible" };
  const asked = chosen as RelaunchCandidate[];
  const unreachable = asked.filter((candidate) => !candidate.hasContact);
  if (unreachable.length > 0) {
    return { ok: false, reason: "missing_contact", suppliers: unreachable.map((c) => c.name) };
  }
  const [windowHours, targetOffers] = await Promise.all([
    getSetting("rfq.window_hours"),
    getSetting("rfq.target_offers"),
  ]);

  let opened;
  try {
    opened = await db.transaction(async (tx) => {
      const locked = await lockForDecision(tx, packId);
      if ("refusal" in locked) return { ok: false as const, reason: locked.refusal };
      const { request } = locked;
      const [last] = await tx
        .select({ roundNo: schema.rfqRound.roundNo })
        .from(schema.rfqRound)
        .where(eq(schema.rfqRound.requestId, request.id))
        .orderBy(desc(schema.rfqRound.roundNo))
        .limit(1);
      const openedAt = new Date();
      const [round] = await tx
        .insert(schema.rfqRound)
        .values({
          id: crypto.randomUUID(),
          requestId: request.id,
          roundNo: (last?.roundNo ?? 0) + 1,
          specVersion: (await ensureSpec(request.id, null, tx)).specVersion,
          openedAt,
          closesAt: new Date(openedAt.getTime() + windowHours * 3_600_000),
          windowHours,
          targetOffers,
          openedBy: actor.id,
          openedByName: actor.name,
        })
        .returning();

      // Under the lock: what each supplier's quote is NOW decides whether it
      // is reopened or created, whatever the candidates list said a moment ago.
      const existing = await tx.query.quote.findMany({
        where: and(
          eq(schema.quote.requestId, request.id),
          inArray(schema.quote.supplierId, supplierIds),
        ),
      });
      const quoteBySupplier = new Map(existing.map((quote) => [quote.supplierId, quote]));
      for (const candidate of asked) {
        const quote = quoteBySupplier.get(candidate.supplierId);
        if (quote) {
          const reopened = await tx
            .update(schema.quote)
            .set({
              status: "requested",
              declineReason: null,
              sentAt: null,
              sentBy: null,
              respondedAt: null,
              channel: null,
              roundId: round!.id,
              requestedAt: openedAt,
              requestedBy: actor.id,
              updatedAt: openedAt,
            })
            // Still declined: an offer keyed in since (a late answer) must
            // not be thrown away by a relaunch that was planned before it.
            .where(and(eq(schema.quote.id, quote.id), eq(schema.quote.status, "declined")))
            .returning({ id: schema.quote.id });
          if (reopened.length === 0) throw new RelaunchConflict();
        } else {
          await tx.insert(schema.quote).values({
            id: crypto.randomUUID(),
            requestId: request.id,
            organizationId: request.organizationId,
            supplierId: candidate.supplierId,
            supplierName: candidate.name,
            status: "requested",
            requestedBy: actor.id,
            roundId: round!.id,
          });
        }
      }
      await transitionRequest(request.id, request.organizationId, "pack_review", "soliciting", tx);
      await recordPackEvent(tx, packId, "relaunched", actor, {
        note,
        round: round!.roundNo,
        suppliers: asked.map((c) => ({ supplierId: c.supplierId, name: c.name, was: c.state })),
      });
      return { ok: true as const, requestId: request.id, roundNo: round!.roundNo };
    });
  } catch (error) {
    if (error instanceof RelaunchConflict) return { ok: false, reason: "not_eligible" };
    throw error;
  }
  if (!opened.ok) return opened;

  // The round is open and the quotes are tied to it, unsent: from here this
  // is exactly a batch that has not left yet, and `sendRfqBatch` RESUMES it —
  // one email each, `sent_at` stamped only for a message that left.
  const sent = await sendRfqBatch(opened.requestId, actor);
  return {
    ok: true,
    requestId: opened.requestId,
    roundNo: opened.roundNo,
    sent: sent.ok ? sent.sent : 0,
    failed: sent.ok ? sent.failed.map((f) => f.supplier) : asked.map((c) => c.name),
  };
}

class RelaunchConflict extends Error {}

/** Take a pack, hand it over, or put it back (`to` null). Only while it is
 *  pending — a decided pack is nobody's desk. */
export async function assignPack(
  packId: string,
  actor: Actor,
  to: Actor | null,
): Promise<{ ok: true } | { ok: false; reason: "not_found" | "not_pending" }> {
  return await db.transaction(async (tx) => {
    const [pack] = await tx
      .select()
      .from(schema.decisionPack)
      .where(eq(schema.decisionPack.id, packId))
      .for("update");
    if (!pack) return { ok: false as const, reason: "not_found" as const };
    if (pack.status !== "pending") return { ok: false as const, reason: "not_pending" as const };
    if (pack.assignedTo === (to?.id ?? null)) return { ok: true as const };
    await tx
      .update(schema.decisionPack)
      .set({ assignedTo: to?.id ?? null, assignedToName: to?.name ?? null })
      .where(eq(schema.decisionPack.id, packId));
    await recordPackEvent(tx, packId, "assigned", actor, {
      to: to?.id ?? null,
      toName: to?.name ?? null,
    });
    return { ok: true as const };
  });
}

/** The buyer cancelled the request: its pending pack, if any, is withdrawn
 *  with it. Not a refusal — nobody at OSI decided anything — and it leaves
 *  the queue. Safe to call when there is none. */
export async function withdrawPendingPack(requestId: string): Promise<boolean> {
  const withdrawn = await db
    .update(schema.decisionPack)
    .set({ status: "withdrawn" })
    .where(
      and(eq(schema.decisionPack.requestId, requestId), eq(schema.decisionPack.status, "pending")),
    )
    .returning({ id: schema.decisionPack.id });
  return withdrawn.length > 0;
}

export type QueuedPack = {
  packId: string;
  requestId: string;
  requestTitle: string;
  organizationName: string;
  /** `review` = waiting on a person. `relaunched` = a new round is open and
   *  the pack waits on suppliers; listed so it is not lost sight of. */
  state: "review" | "relaunched";
  items: number;
  /** Since when it waits — the close of the round that last built it. */
  waitingSince: string | null;
  assignedTo: string | null;
  assignedToName: string | null;
};

/** Every pack awaiting a decision, the one that has waited longest first. */
export async function listPackQueue(): Promise<QueuedPack[]> {
  const rows = await db
    .select({
      pack: schema.decisionPack,
      title: schema.request.title,
      status: schema.request.status,
      organizationName: schema.organization.name,
      closedAt: schema.rfqRound.closedAt,
    })
    .from(schema.decisionPack)
    .innerJoin(schema.request, eq(schema.request.id, schema.decisionPack.requestId))
    .innerJoin(schema.organization, eq(schema.organization.id, schema.decisionPack.organizationId))
    .innerJoin(schema.rfqRound, eq(schema.rfqRound.id, schema.decisionPack.roundId))
    .where(
      and(
        eq(schema.decisionPack.status, "pending"),
        inArray(schema.request.status, ["pack_review", "soliciting"]),
      ),
    );
  const counts = await db
    .select({ packId: schema.decisionPackItem.packId, id: schema.decisionPackItem.id })
    .from(schema.decisionPackItem)
    .where(inArray(schema.decisionPackItem.packId, rows.map((row) => row.pack.id).concat("-")));
  const itemsByPack = new Map<string, number>();
  for (const row of counts) itemsByPack.set(row.packId, (itemsByPack.get(row.packId) ?? 0) + 1);
  return rows
    .map((row) => ({
      packId: row.pack.id,
      requestId: row.pack.requestId,
      requestTitle: row.title,
      organizationName: row.organizationName,
      state: row.status === "pack_review" ? ("review" as const) : ("relaunched" as const),
      items: itemsByPack.get(row.pack.id) ?? 0,
      waitingSince: row.closedAt ? row.closedAt.toISOString() : null,
      assignedTo: row.pack.assignedTo,
      assignedToName: row.pack.assignedToName,
    }))
    .sort(
      (a, b) =>
        // Packs waiting on a person first; among them, the oldest wait first.
        Number(a.state === "relaunched") - Number(b.state === "relaunched") ||
        (a.waitingSince ?? "").localeCompare(b.waitingSince ?? ""),
    );
}

// ── the buyer's side (V12) ──────────────────────────────────────────────────

/** A supplier's document attached to an offer the buyer is shown. */
export type PackDocument = { fileId: string; filename: string; size: number };

export type BuyerPackView = {
  pack: PackView;
  requestId: string;
  requestTitle: string;
  /** Documents per quote id — only for the offers SHOWN in this pack. */
  documents: Record<string, PackDocument[]>;
};

/**
 * The request's released pack, as the buyer reads it. Null when there is
 * none: still pending, refused, withdrawn, or never built.
 *
 * Goes through `getPackView(…, "buyer")` and nothing else, so what this
 * returns is by construction what `projectPack` allows a buyer: the shown
 * order, no computed rank, no internals, no withheld offer. The CALLER
 * decides who may ask — this function does not know about workspaces.
 */
export async function loadReleasedPackForRequest(requestId: string): Promise<BuyerPackView | null> {
  const [pack, request] = await Promise.all([
    db.query.decisionPack.findFirst({
      where: and(
        eq(schema.decisionPack.requestId, requestId),
        eq(schema.decisionPack.status, "released"),
      ),
      // A request can collect several over its life; the buyer reads the
      // latest one that was sent to them.
      orderBy: [desc(schema.decisionPack.releasedAt)],
    }),
    db.query.request.findFirst({
      where: eq(schema.request.id, requestId),
      columns: { id: true, title: true },
    }),
  ]);
  if (!pack || !request) return null;
  const view = await loadPack(pack, "buyer");
  if (!view) return null;

  const quoteIds = view.items.map((item) => item.quoteId).filter((id): id is string => !!id);
  const rows =
    quoteIds.length === 0
      ? []
      : await db
          .select({
            quoteId: schema.document.quoteId,
            fileId: schema.file.id,
            filename: schema.file.filename,
            size: schema.file.size,
          })
          .from(schema.document)
          .innerJoin(schema.file, eq(schema.file.id, schema.document.fileId))
          .where(inArray(schema.document.quoteId, quoteIds))
          .orderBy(asc(schema.document.createdAt));
  const documents: Record<string, PackDocument[]> = {};
  for (const row of rows) {
    if (!row.quoteId) continue;
    (documents[row.quoteId] ??= []).push({
      fileId: row.fileId,
      filename: row.filename,
      size: Number(row.size),
    });
  }
  return { pack: view, requestId: request.id, requestTitle: request.title, documents };
}

/**
 * Among `quoteIds`, the offers a buyer HAS been shown: an item of a released
 * pack, not withheld.
 *
 * The one exception to "the owning workspace reads no supplier on the pack
 * flow": once an offer is in a pack that was sent, the supplier behind it is
 * disclosed, and so is the quotation they attached. An offer staff took out
 * of the pack stays undisclosed — the buyer was never shown it.
 */
export async function disclosedQuoteIds(quoteIds: readonly string[]): Promise<Set<string>> {
  const ids = [...new Set(quoteIds)];
  if (ids.length === 0) return new Set();
  const rows = await db
    .select({ quoteId: schema.decisionPackItem.quoteId })
    .from(schema.decisionPackItem)
    .innerJoin(schema.decisionPack, eq(schema.decisionPack.id, schema.decisionPackItem.packId))
    .where(
      and(
        inArray(schema.decisionPackItem.quoteId, ids),
        eq(schema.decisionPack.status, "released"),
        isNotNull(schema.decisionPackItem.rankShown),
      ),
    );
  return new Set(rows.map((row) => row.quoteId).filter((id): id is string => !!id));
}

// ── choosing from the pack (V13) ────────────────────────────────────────────

/** The request's pack the buyer is CURRENTLY shown: the latest released. */
async function currentReleasedPack(requestId: string): Promise<PackRecord | null> {
  const pack = await db.query.decisionPack.findFirst({
    where: and(
      eq(schema.decisionPack.requestId, requestId),
      eq(schema.decisionPack.status, "released"),
    ),
    orderBy: [desc(schema.decisionPack.releasedAt)],
  });
  return pack ?? null;
}

/**
 * The pack this offer can be accepted FROM, or null.
 *
 * Not null only when the quote is a SHOWN item of the request's LATEST
 * released pack. An offer staff withheld, one that only an older pack held,
 * one beyond the pack's cap — none of them was put in front of the buyer by
 * the pack they are reading, so none can be accepted.
 */
export async function packOfferingQuote(
  requestId: string,
  quoteId: string,
): Promise<string | null> {
  const pack = await currentReleasedPack(requestId);
  if (!pack) return null;
  const item = await db.query.decisionPackItem.findFirst({
    where: and(
      eq(schema.decisionPackItem.packId, pack.id),
      eq(schema.decisionPackItem.quoteId, quoteId),
      isNotNull(schema.decisionPackItem.rankShown),
    ),
    columns: { id: true },
  });
  return item ? pack.id : null;
}

/** The live state of each offer of a pack, by quote id. */
export async function packOfferStates(
  quoteIds: readonly string[],
): Promise<Record<string, PackOfferState>> {
  const states: Record<string, PackOfferState> = {};
  if (quoteIds.length === 0) return states;
  const quotes = await db.query.quote.findMany({
    where: inArray(schema.quote.id, [...quoteIds]),
    columns: { id: true, status: true, validUntil: true, declineReason: true },
  });
  const now = new Date();
  for (const quote of quotes) {
    states[quote.id] = packOfferState(
      {
        status: quote.status,
        validUntil: quote.validUntil,
        declineReason: quote.declineReason ?? null,
      },
      now,
    );
  }
  // A quote row that is gone: nothing left to accept.
  for (const id of quoteIds) states[id] ??= "unavailable";
  return states;
}

export type ReaskResult =
  | { ok: true; requestId: string; roundNo: number; sent: boolean }
  | {
      ok: false;
      reason:
        | "not_found"
        /** Not an offer of the pack the buyer is reading. */
        | "not_in_pack"
        /** Still within its validity: accept it, do not ask again. */
        | "not_expired"
        /** The request has moved (already re-solicited, or an offer accepted). */
        | "pack_reopened"
        /** No reply address, or the supplier has no contact: OSI must fix
         *  that before the platform can write to them. */
        | "cannot_send";
    };

/**
 * An offer expired while the buyer was deciding, and they ask for it again
 * (V13) — the pack flow's second return: `report_ready → soliciting`.
 *
 * Opens a NEW round for that one supplier and sends them the RFQ. The quote
 * row is reopened into it (one row per supplier per request), its old answer
 * time, validity and channel cleared — they belong to the offer that
 * lapsed. The other offers of the pack are untouched; when the round closes,
 * a new pack is built from everything the request holds and goes back
 * through staff's review. Until it is released, nothing can be accepted:
 * the pack on the buyer's screen is no longer the current one.
 */
export async function reaskExpiredOffer(
  quoteId: string,
  workspaceId: string,
  actor: Actor,
): Promise<ReaskResult> {
  const quote = await db.query.quote.findFirst({
    where: and(eq(schema.quote.id, quoteId), eq(schema.quote.organizationId, workspaceId)),
  });
  if (!quote) return { ok: false, reason: "not_found" };
  if (!(await packOfferingQuote(quote.requestId, quote.id))) {
    return { ok: false, reason: "not_in_pack" };
  }
  const state = (await packOfferStates([quote.id]))[quote.id];
  if (state !== "expired") {
    return { ok: false, reason: state === "open" ? "not_expired" : "pack_reopened" };
  }
  // Refused before anything is opened, like every send: the buyer cannot fix
  // either, so the page tells them to contact OSI.
  const contacts = await primaryContactsFor(quote.supplierId ? [quote.supplierId] : []);
  if ((await getSetting("rfq.reply_to")) === "" || contacts.size === 0) {
    return { ok: false, reason: "cannot_send" };
  }
  const [windowHours, targetOffers] = await Promise.all([
    getSetting("rfq.window_hours"),
    getSetting("rfq.target_offers"),
  ]);

  const opened = await db.transaction(async (tx) => {
    const [request] = await tx
      .select()
      .from(schema.request)
      .where(eq(schema.request.id, quote.requestId))
      .for("update");
    // Under the lock: still showing a released pack, and nothing accepted.
    if (!request || request.status !== "report_ready") {
      return { ok: false as const, reason: "pack_reopened" as const };
    }
    const [last] = await tx
      .select({ roundNo: schema.rfqRound.roundNo })
      .from(schema.rfqRound)
      .where(eq(schema.rfqRound.requestId, request.id))
      .orderBy(desc(schema.rfqRound.roundNo))
      .limit(1);
    const openedAt = new Date();
    const [round] = await tx
      .insert(schema.rfqRound)
      .values({
        id: crypto.randomUUID(),
        requestId: request.id,
        roundNo: (last?.roundNo ?? 0) + 1,
        specVersion: (await ensureSpec(request.id, null, tx)).specVersion,
        openedAt,
        closesAt: new Date(openedAt.getTime() + windowHours * 3_600_000),
        windowHours,
        targetOffers,
        openedBy: actor.id,
        openedByName: actor.name,
      })
      .returning();
    // `received → expired → requested` in the quote machine, written as one
    // update: the expiry was derived from `valid_until` and never stored, so
    // there is no row state to pass through — only to leave.
    const reopened = await tx
      .update(schema.quote)
      .set({
        status: "requested",
        declineReason: null,
        sentAt: null,
        sentBy: null,
        respondedAt: null,
        channel: null,
        validUntil: null,
        roundId: round!.id,
        requestedAt: openedAt,
        requestedBy: actor.id,
        updatedAt: openedAt,
      })
      .where(and(eq(schema.quote.id, quote.id), eq(schema.quote.status, "received")))
      .returning({ id: schema.quote.id });
    if (reopened.length === 0) return { ok: false as const, reason: "pack_reopened" as const };
    await transitionRequest(request.id, request.organizationId, "report_ready", "soliciting", tx);
    return { ok: true as const, requestId: request.id, roundNo: round!.roundNo };
  });
  if (!opened.ok) return opened;

  // The round is open with one quote tied to it, unsent — `sendRfqBatch`
  // resumes it, exactly as it does after a relaunch.
  const sent = await sendRfqBatch(opened.requestId, actor);
  return {
    ok: true,
    requestId: opened.requestId,
    roundNo: opened.roundNo,
    sent: sent.ok && sent.sent > 0,
  };
}

export type { PackOfferState } from "@/lib/decision-pack";
