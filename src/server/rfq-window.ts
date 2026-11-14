// The window closes (Phase V · V07).
//
// `closeRound` is the ONLY function that closes a round. Four things call it
// — the offer that reaches the target, the deadline sweep, a staff member who
// decides not to wait, a buyer cancelling the request — and they can arrive
// together: the fifth offer keyed in as the sweep runs, two people clicking
// at once. So the close is one conditional update (`WHERE closed_at IS NULL`)
// and everything else acts on whether THIS call got the row. Whoever did not
// get it does nothing at all — no second notification, no second email.
//
// ── What a close does, in one transaction ───────────────────────────────────
//
//   0. lock the request, and decide the reason from what it is NOW
//   1. stamp the round            (the conditional update — the gate)
//   2. decline whoever had not answered, with the reason the close implies
//   3. soliciting → pack_review   (every close but the buyer's withdrawal)
//   4. the timeline event
//
// One transaction because a half-closed round is worse than either state: a
// closed round with suppliers still "awaiting an answer", or a request still
// `soliciting` over a round nobody can answer any more. Only what cannot be
// rolled back — the notification, the emails, the audit row — happens after
// the commit.

import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/database";
import * as schema from "@/database/schema";
import type { RoundCloseReason } from "@/database/schema";
import { isTerminal } from "@/lib/request-status";
import { buildRfqWithdrawnMail } from "@/lib/rfq-mail";
import { dueClose, leadsToReview, silentDeclineReason } from "@/lib/rfq-round";
import { logAudit } from "@/server/audit";
import { sendMail } from "@/server/mail";
import { notifyStaff } from "@/server/notify";
import { getSetting } from "@/server/platform-settings";
import { recordEvent, transitionRequest } from "@/server/requests";
import { primaryContactsFor } from "@/server/supplier-contacts";

export type RoundCounts = {
  /** Offers in — what the target is counted against. */
  offers: number;
  /** Written to and still silent. */
  awaiting: number;
};

/** Counts for several rounds at once; a round with no quote left reads 0/0. */
export async function roundCounts(roundIds: readonly string[]): Promise<Map<string, RoundCounts>> {
  const counts = new Map<string, RoundCounts>(
    roundIds.map((id) => [id, { offers: 0, awaiting: 0 }]),
  );
  if (roundIds.length === 0) return counts;
  const rows = await db
    .select({
      roundId: schema.quote.roundId,
      offers: sql<number>`count(*) filter (where ${schema.quote.status} = 'received')::int`,
      awaiting: sql<number>`count(*) filter (where ${schema.quote.status} = 'requested' and ${schema.quote.sentAt} is not null)::int`,
    })
    .from(schema.quote)
    .where(inArray(schema.quote.roundId, [...roundIds]))
    .groupBy(schema.quote.roundId);
  for (const row of rows) {
    if (row.roundId) counts.set(row.roundId, { offers: row.offers, awaiting: row.awaiting });
  }
  return counts;
}

export type CloseRoundResult =
  | {
      ok: true;
      /** False when the round was already closed — this call did nothing. */
      closed: boolean;
      offers: number;
      /** Solicitations this close declined. */
      declined: number;
    }
  | { ok: false; reason: "not_found" | "note_required" };

type Silent = {
  supplierId: string | null;
  supplierName: string;
  sent: boolean;
};

/**
 * Close a round. Idempotent: closing a closed round is a no-op, reported as
 * `closed: false`.
 *
 * `actor` is the person who closed it; leave it out when the system did (the
 * target, the deadline). `note` is required for `early` — a round cut short
 * with no reason on record is a decision nobody can review later.
 */
export async function closeRound(
  roundId: string,
  requested: RoundCloseReason,
  actor?: { id: string; name: string } | null,
  note?: string | null,
): Promise<CloseRoundResult> {
  if (requested === "early" && (note ?? "").trim() === "") {
    return { ok: false, reason: "note_required" };
  }

  const existing = await db.query.rfqRound.findFirst({ where: eq(schema.rfqRound.id, roundId) });
  if (!existing) return { ok: false, reason: "not_found" };
  const request = await db.query.request.findFirst({
    where: eq(schema.request.id, existing.requestId),
  });
  if (!request) return { ok: false, reason: "not_found" };

  const now = new Date();
  const outcome = await db.transaction(async (tx) => {
    // FIRST, the request — locked, and read under the lock. Everything below
    // depends on whether it is still alive, and a buyer can cancel it at any
    // instant: decided on a status read before the lock, a cancel landing in
    // that gap would be closed as a `deadline`, its suppliers recorded as
    // silent and never told.
    const [current] = await tx
      .select({ status: schema.request.status })
      .from(schema.request)
      .where(eq(schema.request.id, request.id))
      .for("update");
    if (!current) return null;

    // A round whose request is already over can only be WITHDRAWN, whatever
    // the caller asked for: there is no review to hand it to, and its
    // suppliers are owed the notice.
    const reason: RoundCloseReason = isTerminal(current.status) ? "withdrawn" : requested;
    const earlyNote = reason === "early" ? (note ?? "").trim() : "";

    // THE GATE. Two closes racing both reach this line; the database lets
    // exactly one of them change the row.
    const [round] = await tx
      .update(schema.rfqRound)
      .set({
        closedAt: now,
        closeReason: reason,
        closedBy: actor?.id ?? null,
        closedByName: actor?.name ?? null,
        earlyNote: reason === "early" ? earlyNote : null,
      })
      .where(and(eq(schema.rfqRound.id, roundId), isNull(schema.rfqRound.closedAt)))
      .returning();
    if (!round) return null;

    // Whoever had not answered. Two updates because the reason depends on
    // whether the RFQ ever reached them (see `silentDeclineReason`).
    const silent: Silent[] = [];
    for (const sent of [true, false]) {
      const rows = await tx
        .update(schema.quote)
        .set({
          status: "declined",
          declineReason: silentDeclineReason(reason, sent),
          updatedAt: now,
        })
        .where(
          and(
            eq(schema.quote.roundId, roundId),
            eq(schema.quote.status, "requested"),
            sent ? isNotNull(schema.quote.sentAt) : isNull(schema.quote.sentAt),
          ),
        )
        .returning({
          supplierId: schema.quote.supplierId,
          supplierName: schema.quote.supplierName,
        });
      silent.push(...rows.map((row) => ({ ...row, sent })));
    }

    const answered = await tx
      .select({ supplierId: schema.quote.supplierId, supplierName: schema.quote.supplierName })
      .from(schema.quote)
      .where(and(eq(schema.quote.roundId, roundId), eq(schema.quote.status, "received")));

    if (leadsToReview(reason)) {
      if (current.status === "soliciting") {
        await transitionRequest(
          request.id,
          request.organizationId,
          "soliciting",
          "pack_review",
          tx,
        );
      }
      // A COUNT, like `rfq.sent`: the owner may know how many offers came
      // back, never from whom.
      await recordEvent(
        request.id,
        request.organizationId,
        "rfq.closed",
        { offers: answered.length },
        tx,
      );
    }
    return { round, silent, answered, reason, earlyNote };
  });

  if (!outcome) return { ok: true, closed: false, offers: 0, declined: 0 };
  const { round, silent, answered, reason, earlyNote } = outcome;
  const offers = answered.length;

  // ── After the commit: what cannot be rolled back ──────────────────────────

  // Rank what the window closed with (V09) — before anyone is told, so the
  // person who opens the request on the notification finds the ranking there.
  // Never allowed to undo a close that is already committed.
  if (leadsToReview(reason) && offers > 0) {
    const { refreshKpi2 } = await import("@/server/kpi");
    await refreshKpi2(round.id, "round_closed");
  }

  let told = 0;
  if (reason === "withdrawn") {
    told = await tellWithdrawn(request, [
      ...silent.filter((s) => s.sent).map((s) => ({ ...s, answered: false })),
      ...answered.map((a) => ({ ...a, answered: true })),
    ]);
    if (told > 0) {
      await recordEvent(request.id, request.organizationId, "rfq.withdrawn", { count: told });
    }
  } else {
    const link = `/demandes/${request.id}`;
    const base = process.env["BETTER_AUTH_URL"] ?? "http://localhost:3010";
    const why = CLOSE_SENTENCES[reason];
    // Two different facts, kept apart in the message as they are on the
    // quotes: suppliers who were asked and did not answer, and suppliers the
    // RFQ never reached.
    const unanswered = silent.filter((s) => s.sent).length;
    const unreached = silent.length - unanswered;
    await notifyStaff("deals", {
      type: "rfq_window_closed",
      params: { id: request.id, offers },
      link,
      // The person who closed it early does not need telling; the system's
      // closes have no such person and reach everyone.
      exceptUserId: actor?.id ?? null,
      email: {
        subjectFr: `Fenêtre de réponse fermée — demande #${request.id}`,
        subjectEn: `Response window closed — request #${request.id}`,
        bodyFr: `${why.fr}\nOffres reçues : ${offers}. Fournisseurs sollicités restés sans réponse : ${unanswered}.${unreached > 0 ? ` Fournisseurs que l'appel d'offres n'a jamais joints : ${unreached}.` : ""}\nLa demande attend maintenant la revue de l'équipe : ${base}${link}`,
        bodyEn: `${why.en}\nOffers received: ${offers}. Suppliers asked who had not answered: ${unanswered}.${unreached > 0 ? ` Suppliers the RFQ never reached: ${unreached}.` : ""}\nThe request now waits for staff review: ${base}${link}`,
      },
    });
  }

  await logAudit({
    // No actor on a target or deadline close: that is the rule running, not
    // a person acting (same convention as the retention sweep).
    actorId: actor?.id ?? null,
    actorName: actor?.name ?? null,
    organizationId: request.organizationId,
    action: "rfq.closed",
    target: `#${request.id}`,
    detail: {
      round: round.roundNo,
      reason,
      offers,
      declined: silent.length,
      unreached: silent.filter((s) => !s.sent).length,
      ...(reason === "early" ? { note: earlyNote } : {}),
      ...(reason === "withdrawn" ? { told } : {}),
    },
  });
  console.log(
    `rfq: round ${round.roundNo} of ${request.id} closed (${reason}) — ${offers} offer(s), ${silent.length} declined`,
  );
  return { ok: true, closed: true, offers, declined: silent.length };
}

const CLOSE_SENTENCES: Record<
  Exclude<RoundCloseReason, "withdrawn">,
  { fr: string; en: string }
> = {
  target_reached: {
    fr: "Le nombre d'offres visé est atteint : la fenêtre s'est fermée sans attendre le délai.",
    en: "The target number of offers is in: the window closed without waiting for the deadline.",
  },
  deadline: {
    fr: "Le délai de réponse est écoulé : la fenêtre s'est fermée.",
    en: "The response deadline has passed: the window has closed.",
  },
  early: {
    fr: "Un membre de l'équipe a fermé la fenêtre avant le délai.",
    en: "A staff member closed the window before the deadline.",
  },
};

/**
 * Tell the suppliers who were written to that the RFQ no longer stands.
 *
 * Goes to each supplier's PRIMARY contact as it is now — the address an RFQ
 * was sent to is not kept on the quote, so a contact changed since the send
 * means the notice goes to the new one. A supplier left with no contact at
 * all cannot be told, and is not counted.
 */
async function tellWithdrawn(
  request: typeof schema.request.$inferSelect,
  suppliers: { supplierId: string | null; supplierName: string; answered: boolean }[],
): Promise<number> {
  if (suppliers.length === 0) return 0;
  const [contacts, replyTo] = await Promise.all([
    primaryContactsFor(suppliers.map((s) => s.supplierId).filter((id): id is string => !!id)),
    getSetting("rfq.reply_to"),
  ]);
  let told = 0;
  for (const supplier of suppliers) {
    const contact = supplier.supplierId ? contacts.get(supplier.supplierId) : undefined;
    if (!contact) {
      console.error(
        `rfq: ${supplier.supplierName} could not be told request ${request.id} was withdrawn — no contact`,
      );
      continue;
    }
    const mail = buildRfqWithdrawnMail({
      locale: contact.locale,
      requestId: request.id,
      title: request.title,
      greetingName: contact.name,
      answered: supplier.answered,
    });
    try {
      const result = await sendMail({
        to: contact.email,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        ...(replyTo ? { replyTo } : {}),
      });
      if (result.ok || result.queued) told += 1;
    } catch (error) {
      // The round is closed and committed; one refused address must not stop
      // the others being told.
      console.error(`rfq: withdrawal notice to ${supplier.supplierName} failed —`, error);
    }
  }
  return told;
}

/** Close the round if its target is in. Called after every offer recorded on
 *  a quote that belongs to a round; the sweep runs the same check, so an
 *  offer whose trigger was lost still closes its round within the minute. */
export async function closeRoundIfTargetReached(roundId: string): Promise<boolean> {
  const round = await db.query.rfqRound.findFirst({ where: eq(schema.rfqRound.id, roundId) });
  if (!round || round.closedAt) return false;
  const counts = (await roundCounts([roundId])).get(roundId);
  if (!counts || counts.offers < round.targetOffers) return false;
  const result = await closeRound(roundId, "target_reached");
  return result.ok && result.closed;
}

/** A buyer cancelled the request: close whatever round is still open on it
 *  and tell its suppliers. Safe to call when there is none. */
export async function withdrawOpenRounds(
  requestId: string,
  actor: { id: string; name: string },
): Promise<void> {
  const open = await db.query.rfqRound.findMany({
    where: and(eq(schema.rfqRound.requestId, requestId), isNull(schema.rfqRound.closedAt)),
    columns: { id: true },
  });
  for (const round of open) await closeRound(round.id, "withdrawn", actor);
}

/**
 * The sweep — every open round, once a minute, on the pipeline worker.
 *
 * It is the DEADLINE's only trigger and the safety net for the other two:
 * a target whose trigger was lost, and a cancelled request whose round the
 * cancel did not get to withdraw. `dueClose` decides which, in that order.
 */
export async function sweepRounds(now: Date = new Date()): Promise<number> {
  const open = await db
    .select({
      id: schema.rfqRound.id,
      closesAt: schema.rfqRound.closesAt,
      targetOffers: schema.rfqRound.targetOffers,
      requestStatus: schema.request.status,
    })
    .from(schema.rfqRound)
    .innerJoin(schema.request, eq(schema.request.id, schema.rfqRound.requestId))
    .where(isNull(schema.rfqRound.closedAt));
  if (open.length === 0) return 0;
  const counts = await roundCounts(open.map((round) => round.id));
  let closed = 0;
  for (const round of open) {
    const reason = dueClose({
      requestOver: isTerminal(round.requestStatus),
      offers: counts.get(round.id)?.offers ?? 0,
      targetOffers: round.targetOffers,
      closesAt: round.closesAt,
      now,
    });
    if (!reason) continue;
    try {
      const result = await closeRound(round.id, reason);
      if (result.ok && result.closed) closed += 1;
    } catch (error) {
      // One round that cannot close must not keep the others open.
      console.error(`rfq: sweep could not close round ${round.id} —`, error);
    }
  }
  return closed;
}
