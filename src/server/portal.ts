// The supplier portal (Phase V · V16) — the rows.
//
// Every function here takes the caller's `supplierIds` — what
// `requireSupplierSession` returned — and EVERY query is filtered by them.
// That list is the whole of a supplier account's authority: there is no
// workspace to fall back on and no staff exception. A quote that is not one
// of theirs does not exist, as far as this file answers: the same `null` as
// an id nobody has.
//
// What leaves this file is only what a supplier may know (V03's acceptance):
// the specification, the deadline, their own offer and their own documents.
// Never the buyer, another supplier, how many were asked, how many answered,
// a rank, a score, or a note of OSI's. The views below are built field by
// field for that reason — nothing is spread from a row.
//
// The pure rules are `src/lib/portal-rfq.ts`.

import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/database";
import * as schema from "@/database/schema";
import { defaultQuoteValidUntil } from "@/lib/deal-status";
import {
  canDecline,
  canSubmitOffer,
  portalRfqState,
  windowOpen,
  type PortalRfqFacts,
  type PortalRfqState,
} from "@/lib/portal-rfq";
import { specCriterionLine } from "@/lib/request-spec";
import { logAudit } from "@/server/audit";
import { notifyStaff } from "@/server/notify";
import { specForReading } from "@/server/spec";

/** The caller, as the guard returned it. */
export type PortalCaller = {
  userId: string;
  userName: string;
  supplierIds: string[];
  locale: string;
};

/**
 * The quotes a supplier account may reach: their supplier's, and only those
 * the PLATFORM sent in a round. A soumission staff emailed by hand on the
 * report flow has no round, no deadline to show and no window to answer in —
 * it is not an RFQ of the portal's.
 */
function theirs(supplierIds: string[]) {
  return and(
    inArray(schema.quote.supplierId, supplierIds),
    isNotNull(schema.quote.roundId),
    isNotNull(schema.quote.sentAt),
  );
}

export type PortalRfqSummary = {
  /** The quote's id — the RFQ, for this supplier. */
  id: string;
  /** OSI's reference, the one printed in the RFQ email. */
  reference: string;
  /** Which of the caller's suppliers it was sent to. */
  supplierName: string;
  title: string;
  closesAt: string;
  state: PortalRfqState;
  /** When they answered; null otherwise. */
  answeredAt: string | null;
};

type Joined = {
  quote: typeof schema.quote.$inferSelect;
  round: typeof schema.rfqRound.$inferSelect;
  requestStatus: schema.RequestStatus;
  requestTitle: string;
};

async function joined(supplierIds: string[], quoteId?: string): Promise<Joined[]> {
  return db
    .select({
      quote: schema.quote,
      round: schema.rfqRound,
      requestStatus: schema.request.status,
      requestTitle: schema.request.title,
    })
    .from(schema.quote)
    .innerJoin(schema.rfqRound, eq(schema.rfqRound.id, schema.quote.roundId))
    .innerJoin(schema.request, eq(schema.request.id, schema.quote.requestId))
    .where(quoteId ? and(theirs(supplierIds), eq(schema.quote.id, quoteId)) : theirs(supplierIds))
    .orderBy(desc(schema.rfqRound.closesAt));
}

function factsOf(row: Joined): PortalRfqFacts {
  return {
    quoteStatus: row.quote.status,
    declineReason: row.quote.declineReason ?? null,
    roundClosedAt: row.round.closedAt,
    requestStatus: row.requestStatus,
  };
}

function summaryOf(row: Joined, title: string): PortalRfqSummary {
  const state = portalRfqState(factsOf(row));
  return {
    id: row.quote.id,
    reference: row.quote.requestId,
    supplierName: row.quote.supplierName,
    title,
    closesAt: row.round.closesAt.toISOString(),
    state,
    answeredAt:
      state === "answered" && row.quote.respondedAt ? row.quote.respondedAt.toISOString() : null,
  };
}

/** The RFQs addressed to the caller's supplier(s), most recent deadline first. */
export async function listRfqs(caller: PortalCaller): Promise<PortalRfqSummary[]> {
  const rows = await joined(caller.supplierIds);
  return rows.map((row) => summaryOf(row, row.requestTitle));
}

export type PortalOffer = {
  amountCents: number | null;
  currency: string | null;
  quantity: string | null;
  moq: string | null;
  leadTimeDays: number | null;
  incoterm: string | null;
  paymentTerms: string | null;
  notes: string | null;
  validUntil: string | null;
};

export type PortalRfqDetail = PortalRfqSummary & {
  /** What they are asked to quote: the specification of the round's version. */
  spec: {
    criteria: Array<{ line: string; required: boolean }>;
    /** The client's own description, as written. */
    description: string;
    attachments: number;
  };
  /** Their offer as it stands; null until they answer. */
  offer: PortalOffer | null;
  /** The files attached to THEIR offer. */
  documents: Array<{ id: string; fileId: string; filename: string; createdAt: string }>;
  canSubmit: boolean;
  canDecline: boolean;
};

/** One RFQ — or null when it is not one of theirs, which reads exactly like
 *  an id that does not exist. */
export async function readRfq(
  caller: PortalCaller,
  quoteId: string,
): Promise<PortalRfqDetail | null> {
  const [row] = await joined(caller.supplierIds, quoteId);
  if (!row) return null;

  // The spec the round carried — what the email said, not what the request
  // says today. English values are a translation aid kept on the criterion
  // rows (V19); a reader whose account is in English gets them.
  const [spec, english, documents] = await Promise.all([
    specForReading(row.quote.requestId, row.round.specVersion),
    db
      .select({ id: schema.requestCriterion.id, valueEn: schema.requestCriterion.valueEn })
      .from(schema.requestCriterion)
      .where(eq(schema.requestCriterion.requestId, row.quote.requestId)),
    db
      .select({
        id: schema.document.id,
        fileId: schema.document.fileId,
        filename: schema.file.filename,
        createdAt: schema.document.createdAt,
      })
      .from(schema.document)
      .innerJoin(schema.file, eq(schema.file.id, schema.document.fileId))
      .where(eq(schema.document.quoteId, row.quote.id))
      .orderBy(desc(schema.document.createdAt)),
  ]);
  const valueEn = new Map(english.map((c) => [c.id, c.valueEn]));
  const inEnglish = caller.locale === "en";

  const facts = factsOf(row);
  const state = portalRfqState(facts);
  const answered = state === "answered";
  const { quote } = row;
  return {
    ...summaryOf(row, spec?.title ?? row.requestTitle),
    spec: {
      criteria: (spec?.criteria ?? []).map((c) => ({
        line: specCriterionLine({
          label: c.label,
          value: inEnglish ? (valueEn.get(c.id) ?? c.value) : c.value,
          unit: c.unit,
        }),
        required: c.required,
      })),
      description: spec?.description ?? "",
      attachments: spec?.attachments ?? 0,
    },
    offer: answered
      ? {
          amountCents: quote.amountCents,
          currency: quote.currency,
          quantity: quote.quantity,
          moq: quote.moq,
          leadTimeDays: quote.leadTimeDays,
          incoterm: quote.incoterm,
          paymentTerms: quote.paymentTerms,
          notes: quote.notes,
          validUntil: quote.validUntil ? quote.validUntil.toISOString() : null,
        }
      : null,
    documents: documents.map((d) => ({
      id: d.id,
      fileId: d.fileId,
      filename: d.filename,
      createdAt: d.createdAt.toISOString(),
    })),
    canSubmit: canSubmitOffer(facts),
    canDecline: canDecline(facts),
  };
}

export type OfferInput = {
  amountCents: number;
  currency: string;
  quantity: string | null;
  moq: string | null;
  leadTimeDays: number | null;
  incoterm: string | null;
  paymentTerms: string | null;
  notes: string | null;
  /** Until when the offer stands. Null = one month from the answer, the same
   *  default as an offer staff key in. */
  validUntil: Date | null;
};

export type PortalWriteResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        /** Not one of theirs — or no such RFQ. One answer for both. */
        | "not_found"
        /** The window closed, or the request ended, before this arrived. */
        | "closed"
        | "validity_past";
    };

/** The quote, its round and its request, locked, IF it is one of theirs. */
async function lockTheirs(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  caller: PortalCaller,
  quoteId: string,
) {
  const [quote] = await tx
    .select()
    .from(schema.quote)
    .where(and(theirs(caller.supplierIds), eq(schema.quote.id, quoteId)))
    .for("update");
  if (!quote?.roundId) return null;
  const [round] = await tx
    .select()
    .from(schema.rfqRound)
    .where(eq(schema.rfqRound.id, quote.roundId))
    .for("share");
  const [request] = await tx
    .select({ status: schema.request.status })
    .from(schema.request)
    .where(eq(schema.request.id, quote.requestId))
    .for("share");
  if (!round || !request) return null;
  const facts: PortalRfqFacts = {
    quoteStatus: quote.status,
    declineReason: quote.declineReason ?? null,
    roundClosedAt: round.closedAt,
    requestStatus: request.status,
  };
  return { quote, round, facts };
}

/**
 * The supplier sends their offer — or revises it while the window is open.
 *
 * Decided under a lock on the quote and a shared lock on its round: an offer
 * racing the close either lands before it and is in the round, or finds the
 * round closed and is refused. Never "accepted, but not ranked".
 *
 * `responded_at` is the server's clock, not a typed date — this is the one
 * route where the answer time is observed rather than reported — and it is
 * the FIRST answer's: a revision does not make a prompt supplier look slow.
 */
export async function submitOffer(
  caller: PortalCaller,
  quoteId: string,
  input: OfferInput,
): Promise<PortalWriteResult> {
  const now = new Date();
  if (input.validUntil && input.validUntil.getTime() <= now.getTime()) {
    return { ok: false, reason: "validity_past" };
  }

  const outcome = await db.transaction(async (tx) => {
    const locked = await lockTheirs(tx, caller, quoteId);
    if (!locked) return { refusal: "not_found" as const };
    const { quote, facts } = locked;
    if (!canSubmitOffer(facts)) return { refusal: "closed" as const };

    const first = quote.status !== "received";
    const respondedAt = first ? now : (quote.respondedAt ?? now);
    await tx
      .update(schema.quote)
      .set({
        status: "received",
        amountCents: input.amountCents,
        currency: input.currency.toUpperCase(),
        quantity: input.quantity,
        moq: input.moq,
        leadTimeDays: input.leadTimeDays,
        incoterm: input.incoterm,
        paymentTerms: input.paymentTerms,
        notes: input.notes,
        validUntil: input.validUntil ?? defaultQuoteValidUntil(respondedAt),
        respondedAt,
        // Whoever last wrote the figures owns them: an offer the supplier
        // revises in the portal is the supplier's, even if staff had typed
        // the first version from an email. `recorded_by` null = no staff
        // member stands between the supplier and these numbers.
        channel: "portal",
        recordedBy: null,
        declineReason: null,
        updatedAt: now,
      })
      .where(eq(schema.quote.id, quote.id));
    return { quote, first };
  });
  if ("refusal" in outcome) return { ok: false, reason: outcome.refusal };
  const { quote, first } = outcome;

  // The platform's journal, not the buyer's workspace's: the actor is a
  // supplier's person, and on the pack flow the buyer learns of no supplier
  // before the Decision Pack.
  await logAudit({
    actorId: caller.userId,
    actorName: caller.userName,
    action: first ? "quote.received" : "quote.corrected",
    target: quote.supplierName,
    detail: {
      request: quote.requestId,
      channel: "portal",
      amountCents: input.amountCents,
      currency: input.currency.toUpperCase(),
      ...(input.leadTimeDays != null ? { leadTimeDays: input.leadTimeDays } : {}),
    },
  });

  if (first) {
    // Nobody types this one in, so somebody has to be told it arrived.
    await notifyStaff("deals", {
      type: "portal_offer_received",
      params: { id: quote.requestId, supplier: quote.supplierName },
      link: `/demandes/${quote.requestId}`,
      exceptUserId: null,
    });
    // The offer that fills the round closes it (V07) — the same call the
    // staff route makes, and the sweep repeats it within the minute if this
    // fails. Never allowed to fail the offer, which is already recorded.
    if (quote.roundId) {
      try {
        const { closeRoundIfTargetReached } = await import("@/server/rfq-window");
        await closeRoundIfTargetReached(quote.roundId);
      } catch (error) {
        console.error(`portal: target check failed for round ${quote.roundId}`, error);
      }
    }
  }
  return { ok: true };
}

/** The supplier says no. Their words, when they give any, are kept with it. */
export async function declineRfq(
  caller: PortalCaller,
  quoteId: string,
  note: string | null,
): Promise<PortalWriteResult> {
  const now = new Date();
  const outcome = await db.transaction(async (tx) => {
    const locked = await lockTheirs(tx, caller, quoteId);
    if (!locked) return { refusal: "not_found" as const };
    if (!canDecline(locked.facts)) return { refusal: "closed" as const };
    await tx
      .update(schema.quote)
      .set({
        status: "declined",
        declineReason: "supplier_declined",
        respondedAt: now,
        channel: "portal",
        recordedBy: null,
        notes: note,
        updatedAt: now,
      })
      .where(eq(schema.quote.id, locked.quote.id));
    return { quote: locked.quote };
  });
  if ("refusal" in outcome) return { ok: false, reason: outcome.refusal };

  await logAudit({
    actorId: caller.userId,
    actorName: caller.userName,
    action: "quote.declined",
    target: outcome.quote.supplierName,
    detail: { request: outcome.quote.requestId, reason: "supplier_declined", channel: "portal" },
  });
  await notifyStaff("deals", {
    type: "portal_rfq_declined",
    params: { id: outcome.quote.requestId, supplier: outcome.quote.supplierName },
    link: `/demandes/${outcome.quote.requestId}`,
    exceptUserId: null,
  });
  return { ok: true };
}

/**
 * The quote a document may be attached to by this caller — theirs, and its
 * window still open. Null otherwise. Shared by the portal's upload route.
 */
export async function quoteForUpload(caller: PortalCaller, quoteId: string) {
  const [row] = await joined(caller.supplierIds, quoteId);
  if (!row || !windowOpen(factsOf(row))) return null;
  return row.quote;
}

/**
 * A file the caller may read back: one attached, as a document, to a quote
 * of THEIRS. The second access path to a row whose owner is the buyer's
 * workspace (P8's ownership rule) — and the only one a supplier has.
 */
export async function fileForDownload(caller: PortalCaller, fileId: string) {
  const [row] = await db
    .select({ file: schema.file })
    .from(schema.file)
    .innerJoin(schema.document, eq(schema.document.fileId, schema.file.id))
    .innerJoin(schema.quote, eq(schema.quote.id, schema.document.quoteId))
    .where(and(eq(schema.file.id, fileId), theirs(caller.supplierIds)));
  return row?.file ?? null;
}
