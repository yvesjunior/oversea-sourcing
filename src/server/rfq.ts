// RFQ rounds and the batch send (Phase V · V06).
//
// On the pack flow the platform writes to the suppliers itself. Until this
// file, "sent" was a stamp staff added after emailing from their own mailbox;
// here the send IS the platform's act, and the round it opens is the clock the
// whole window runs on (owner, 2026-11-14: one clock per round).
//
// ── The order of operations, and why ────────────────────────────────────────
//
//   1. open the round, tie the quotes to it          (one transaction)
//   2. shortlisted → soliciting
//   3. one email per supplier
//   4. stamp `quote.sent_at` — ONLY for an email that left or was queued
//
// `sent_at` is stamped after the fact, per supplier, and never in the opening
// transaction. So on this flow a quote in a round with no `sent_at` means
// exactly "this supplier was not written to" — a refused address, a mail
// outage that could not even queue, a process that died mid-batch — and
// calling this again RESUMES: it writes only to those. Stamping everyone up
// front would have made a failed send indistinguishable from a successful one
// and started a response clock on a mailbox that never got the message.

import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/database";
import * as schema from "@/database/schema";
import { buildRfqMail, type RfqMail } from "@/lib/rfq-mail";
import { sendMail } from "@/server/mail";
import { getSetting } from "@/server/platform-settings";
import { recordEvent, transitionRequest } from "@/server/requests";
import { primaryContactsFor, type PrimaryContact } from "@/server/supplier-contacts";

type QuoteRow = typeof schema.quote.$inferSelect;
type RoundRow = typeof schema.rfqRound.$inferSelect;

function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: string; cause?: { code?: string } } | null) ?? null;
  return code?.code === "23505" || code?.cause?.code === "23505";
}

export type RoundView = {
  roundNo: number;
  openedAt: string;
  closesAt: string;
  windowHours: number;
  targetOffers: number;
};

function toRoundView(round: RoundRow): RoundView {
  return {
    roundNo: round.roundNo,
    openedAt: round.openedAt.toISOString(),
    closesAt: round.closesAt.toISOString(),
    windowHours: round.windowHours,
    targetOffers: round.targetOffers,
  };
}

async function latestRound(requestId: string): Promise<RoundRow | null> {
  const round = await db.query.rfqRound.findFirst({
    where: eq(schema.rfqRound.requestId, requestId),
    orderBy: [desc(schema.rfqRound.roundNo)],
  });
  return round ?? null;
}

/** The solicitations a send would write to, for the state the request is in.
 *  Before a round: the confirmed shortlist. With one open: whoever in it has
 *  still not been written to. */
async function pendingQuotes(requestId: string, round: RoundRow | null): Promise<QuoteRow[]> {
  return await db.query.quote.findMany({
    where: and(
      eq(schema.quote.requestId, requestId),
      eq(schema.quote.status, "requested"),
      isNull(schema.quote.sentAt),
      round ? eq(schema.quote.roundId, round.id) : isNull(schema.quote.roundId),
    ),
  });
}

async function mailFor(
  request: typeof schema.request.$inferSelect,
  contact: PrimaryContact,
  closesAt: Date,
): Promise<RfqMail> {
  const criteria = await db.query.requestCriterion.findMany({
    where: eq(schema.requestCriterion.requestId, request.id),
    orderBy: [schema.requestCriterion.position],
  });
  return buildRfqMail({
    locale: contact.locale,
    requestId: request.id,
    title: request.title,
    description: request.descriptionRaw,
    criteria: criteria.map((c) => ({
      label: c.label,
      value: c.value,
      valueEn: c.valueEn,
      unit: c.unit,
    })),
    closesAt,
    greetingName: contact.name,
  });
}

export type RfqBlocker = "no_reply_address" | "missing_contact" | "nothing_to_send" | "wrong_state";

export type RfqPreview = {
  /** The open round, if the batch has already left. */
  round: RoundView | null;
  recipients: { supplier: string; email: string | null }[];
  /** Why a send would be refused right now; null when it would go. */
  blockedBy: RfqBlocker | null;
  replyTo: string;
  /** The delay a NEW round would get, from the setting as it stands. */
  windowHours: number;
  /** What the first recipient with an address would receive, word for word. */
  sample: { to: string; subject: string; text: string } | null;
};

export async function previewRfq(requestId: string): Promise<RfqPreview | null> {
  const request = await db.query.request.findFirst({ where: eq(schema.request.id, requestId) });
  if (!request) return null;
  const round = await latestRound(requestId);
  const [quotes, replyTo, windowHours] = await Promise.all([
    pendingQuotes(requestId, round),
    getSetting("rfq.reply_to"),
    getSetting("rfq.window_hours"),
  ]);
  const contacts = await primaryContactsFor(
    quotes.map((q) => q.supplierId).filter((id): id is string => id !== null),
  );
  const recipients = quotes.map((quote) => ({
    supplier: quote.supplierName,
    email: (quote.supplierId && contacts.get(quote.supplierId)?.email) || null,
  }));

  const sendable = request.status === "shortlisted" || request.status === "soliciting";
  const blockedBy: RfqBlocker | null = !sendable
    ? "wrong_state"
    : quotes.length === 0
      ? "nothing_to_send"
      : !replyTo
        ? "no_reply_address"
        : recipients.some((r) => r.email === null)
          ? "missing_contact"
          : null;

  const first = quotes.find((q) => q.supplierId && contacts.has(q.supplierId));
  const firstContact = first?.supplierId ? contacts.get(first.supplierId) : undefined;
  // A round not yet open has no deadline; show the one it would get if the
  // batch left now, so the preview reads like the real thing.
  const closesAt = round?.closesAt ?? new Date(Date.now() + windowHours * 3_600_000);
  const sampleMail = firstContact ? await mailFor(request, firstContact, closesAt) : null;

  return {
    round: round ? toRoundView(round) : null,
    recipients,
    blockedBy,
    replyTo,
    windowHours,
    sample:
      sampleMail && firstContact
        ? { to: firstContact.email, subject: sampleMail.subject, text: sampleMail.text }
        : null,
  };
}

export type RfqBatchResult =
  | {
      ok: true;
      round: RoundView;
      sent: number;
      /** Suppliers the message could not be handed over for — still unsent,
       *  and written to again by the next call. */
      failed: { supplier: string; error: string }[];
    }
  | { ok: false; reason: "not_found" | RfqBlocker; suppliers?: string[] };

/**
 * Send the RFQ to the confirmed shortlist, opening the round — or, when a
 * round is already open, to whoever in it has still not been written to.
 */
export async function sendRfqBatch(
  requestId: string,
  actor: { id: string; name: string },
): Promise<RfqBatchResult> {
  const request = await db.query.request.findFirst({ where: eq(schema.request.id, requestId) });
  if (!request) return { ok: false, reason: "not_found" };
  if (request.status !== "shortlisted" && request.status !== "soliciting") {
    return { ok: false, reason: "wrong_state" };
  }

  let round = await latestRound(requestId);
  const opening = round === null;
  const batch = await pendingQuotes(requestId, round);
  if (batch.length === 0) return { ok: false, reason: "nothing_to_send" };

  // Refused BEFORE anything is opened: an RFQ whose replies vanish is worse
  // than no RFQ — the supplier who answered would be recorded as silent.
  const replyTo = await getSetting("rfq.reply_to");
  if (!replyTo) return { ok: false, reason: "no_reply_address" };

  const contacts = await primaryContactsFor(
    batch.map((q) => q.supplierId).filter((id): id is string => id !== null),
  );
  const unreachable = batch.filter((q) => !q.supplierId || !contacts.has(q.supplierId));
  // The batch is the confirmed shortlist, whole — one send, one clock. A
  // supplier nobody can write to is either given an address or taken off the
  // shortlist; it is not quietly left out of a round it was confirmed for.
  if (opening && unreachable.length > 0) {
    return {
      ok: false,
      reason: "missing_contact",
      suppliers: unreachable.map((q) => q.supplierName),
    };
  }

  if (!round) {
    const [windowHours, targetOffers] = await Promise.all([
      getSetting("rfq.window_hours"),
      getSetting("rfq.target_offers"),
    ]);
    const openedAt = new Date();
    try {
      round = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(schema.rfqRound)
          .values({
            id: crypto.randomUUID(),
            requestId,
            roundNo: 1,
            openedAt,
            // Stored, never recomputed: a later change to the setting must
            // not move a round that is already open.
            closesAt: new Date(openedAt.getTime() + windowHours * 3_600_000),
            windowHours,
            targetOffers,
            openedBy: actor.id,
            openedByName: actor.name,
          })
          .returning();
        await tx
          .update(schema.quote)
          .set({ roundId: created!.id, updatedAt: openedAt })
          .where(
            and(
              inArray(
                schema.quote.id,
                batch.map((q) => q.id),
              ),
              isNull(schema.quote.roundId),
            ),
          );
        return created!;
      });
    } catch (error) {
      // Two clicks arrived together and the other one opened the round. Its
      // call is doing the sending; this one has nothing left to do.
      if (isUniqueViolation(error)) return { ok: false, reason: "nothing_to_send" };
      throw error;
    }
  }
  if (request.status === "shortlisted") {
    await transitionRequest(requestId, request.organizationId, "shortlisted", "soliciting");
  }

  let sent = 0;
  const failed: { supplier: string; error: string }[] = [];
  for (const quote of batch) {
    const contact = quote.supplierId ? contacts.get(quote.supplierId) : undefined;
    if (!contact) {
      failed.push({ supplier: quote.supplierName, error: "no_contact" });
      continue;
    }
    const mail = await mailFor(request, contact, round.closesAt);
    const result = await sendMail({
      to: contact.email,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      replyTo,
    });
    // Handed to the provider, or safely in the outbox to be retried: either
    // way the message will reach them, so the clock may start. Anything else
    // (a permanent refusal, an outbox that could not be written) has NOT
    // been sent, and saying it was would be the lie this file exists to avoid.
    if (!result.ok && !result.queued) {
      failed.push({ supplier: quote.supplierName, error: result.error ?? "refused" });
      continue;
    }
    // Everyone in the opening batch shares the round's own instant — they
    // left together. A supplier written to on a later, resumed call gets the
    // time they were actually written to.
    const stamp = opening ? round.openedAt : new Date();
    await db
      .update(schema.quote)
      .set({ sentAt: stamp, sentBy: actor.id, updatedAt: new Date() })
      .where(and(eq(schema.quote.id, quote.id), isNull(schema.quote.sentAt)));
    sent += 1;
  }

  if (sent > 0) {
    // A COUNT on the request's timeline — the buyer may know an RFQ went to
    // five suppliers and when it closes, never to whom.
    await recordEvent(requestId, request.organizationId, "rfq.sent", { count: sent });
  }
  return { ok: true, round: toRoundView(round), sent, failed };
}
