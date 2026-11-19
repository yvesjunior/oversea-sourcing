// Cases and enrichments (Phase V · V22) — the rows.
//
// Staff open a case with a partner about one offer; the partner's answer is
// recorded as an enrichment. The pure rules are `src/lib/partner-case.ts`.
//
// STEP 08 BLOCKS NOTHING (owner, 2026-10-24). Nothing here is waited on: a
// round closes, ranks and produces its pack whether or not anyone opened a
// case. An enrichment recorded while a pack is under review joins that pack;
// one recorded later joins nothing that was already sent.

import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/database";
import * as schema from "@/database/schema";
import {
  ENRICHMENT_OF,
  latestPerCase,
  type EnrichmentKind,
  type OfferEnrichment,
} from "@/lib/partner-case";
import type { PartnerKind } from "@/lib/partners";
import { logAudit } from "@/server/audit";
import { adapterFor } from "@/server/partners/adapter";

type Actor = { id: string; name: string };

export type EnrichmentView = {
  id: string;
  version: number;
  kind: EnrichmentKind;
  amountCents: number;
  currency: string;
  validUntil: string | null;
  /** How many of the supplier's units the figure covers (V24); null = not said. */
  units: number | null;
  note: string | null;
  channel: schema.QuoteChannel;
  createdByName: string | null;
  createdAt: string;
};

export type PartnerCaseView = {
  id: string;
  partnerId: string;
  partnerName: string;
  kind: PartnerKind;
  status: schema.PartnerCaseStatus;
  brief: string | null;
  openedByName: string | null;
  createdAt: string;
  /** Every figure on record for this case, newest first. The first one is
   *  the one that counts. */
  enrichments: EnrichmentView[];
};

/** Every case opened about an offer, newest first, with its figures. */
export async function casesForQuote(quoteId: string): Promise<PartnerCaseView[]> {
  const cases = await db
    .select({ case: schema.partnerCase, partnerName: schema.partner.name })
    .from(schema.partnerCase)
    .innerJoin(schema.partner, eq(schema.partner.id, schema.partnerCase.partnerId))
    .where(eq(schema.partnerCase.quoteId, quoteId))
    .orderBy(desc(schema.partnerCase.createdAt));
  if (cases.length === 0) return [];
  const enrichments = await db
    .select()
    .from(schema.partnerEnrichment)
    .where(
      inArray(
        schema.partnerEnrichment.caseId,
        cases.map((c) => c.case.id),
      ),
    )
    .orderBy(desc(schema.partnerEnrichment.version));
  return cases.map(({ case: row, partnerName }) => ({
    id: row.id,
    partnerId: row.partnerId,
    partnerName,
    kind: row.kind,
    status: row.status,
    brief: row.brief,
    openedByName: row.openedByName,
    createdAt: row.createdAt.toISOString(),
    enrichments: enrichments
      .filter((e) => e.caseId === row.id)
      .map((e) => ({
        id: e.id,
        version: e.version,
        kind: e.kind,
        amountCents: e.amountCents,
        currency: e.currency,
        validUntil: e.validUntil ? e.validUntil.toISOString() : null,
        units: e.units,
        note: e.details?.note ?? null,
        channel: e.channel,
        createdByName: e.createdByName,
        createdAt: e.createdAt.toISOString(),
      })),
  }));
}

/**
 * The figures that COUNT for each of these offers: the latest version of
 * every case that was not cancelled. What a pack freezes and an offer card
 * shows. An offer with none is simply absent from the map.
 */
export async function currentEnrichments(
  quoteIds: readonly string[],
): Promise<Map<string, OfferEnrichment[]>> {
  const ids = [...new Set(quoteIds)];
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ enrichment: schema.partnerEnrichment })
    .from(schema.partnerEnrichment)
    .innerJoin(schema.partnerCase, eq(schema.partnerCase.id, schema.partnerEnrichment.caseId))
    .where(
      and(
        inArray(schema.partnerEnrichment.quoteId, ids),
        ne(schema.partnerCase.status, "cancelled"),
      ),
    )
    .orderBy(asc(schema.partnerEnrichment.createdAt));
  const byQuote = new Map<string, OfferEnrichment[]>();
  for (const row of latestPerCase(rows.map((r) => r.enrichment))) {
    const list = byQuote.get(row.quoteId) ?? [];
    list.push({
      kind: row.kind,
      amountCents: row.amountCents,
      currency: row.currency,
      validUntil: row.validUntil ? row.validUntil.toISOString() : null,
      units: row.units,
    });
    byQuote.set(row.quoteId, list);
  }
  return byQuote;
}

export type OpenCaseResult =
  | { ok: true; caseId: string }
  | {
      ok: false;
      reason:
        | "quote_not_found"
        | "partner_not_found"
        /** Switched off: kept for its cases, offered for no new one. */
        | "partner_inactive"
        /** This kind of partner adds no figure to an offer (settlement). */
        | "kind_not_applicable"
        /** The offer already has a live case of this kind. */
        | "already_open";
    };

/**
 * Open a case with a partner about one offer (decision D10: staff assign,
 * per offer).
 *
 * Goes through the ADAPTER — `adapterFor(partner.provider).createCase` — and
 * never to a provider: with `manual` nothing is handed over and the case is
 * simply ours to follow; an integrated provider would return its own
 * reference, kept in `external_ref`.
 */
export async function openCase(
  input: { quoteId: string; partnerId: string; brief: string | null },
  actor: Actor,
): Promise<OpenCaseResult> {
  const [quote, partner] = await Promise.all([
    db.query.quote.findFirst({ where: eq(schema.quote.id, input.quoteId) }),
    db.query.partner.findFirst({ where: eq(schema.partner.id, input.partnerId) }),
  ]);
  if (!quote) return { ok: false, reason: "quote_not_found" };
  if (!partner) return { ok: false, reason: "partner_not_found" };
  if (!partner.active) return { ok: false, reason: "partner_inactive" };
  if (ENRICHMENT_OF[partner.kind] === null) return { ok: false, reason: "kind_not_applicable" };

  const live = await db.query.partnerCase.findFirst({
    where: and(
      eq(schema.partnerCase.quoteId, quote.id),
      eq(schema.partnerCase.kind, partner.kind),
      ne(schema.partnerCase.status, "cancelled"),
    ),
    columns: { id: true },
  });
  if (live) return { ok: false, reason: "already_open" };

  const caseId = crypto.randomUUID();
  const opened = await adapterFor(partner.provider).createCase({
    caseId,
    partner: {
      id: partner.id,
      name: partner.name,
      kind: partner.kind,
      contactEmail: partner.contactEmail,
    },
    // OSI's reference and the supplier's side of the offer — never the buyer.
    reference: `#${quote.requestId}`,
    summary: input.brief ?? "",
  });
  await db.insert(schema.partnerCase).values({
    id: caseId,
    partnerId: partner.id,
    quoteId: quote.id,
    requestId: quote.requestId,
    kind: partner.kind,
    brief: input.brief,
    externalRef: opened.handedOver ? opened.externalRef : null,
    openedBy: actor.id,
    openedByName: actor.name,
  });
  await logAudit({
    actorId: actor.id,
    actorName: actor.name,
    action: "partner_case.opened",
    target: partner.name,
    detail: { request: quote.requestId, kind: partner.kind, supplier: quote.supplierName },
  });
  // The partner's people who have a Partner Hub account are told (V23). A
  // side effect: it never throws, and a partner with no account is simply
  // reached by staff as before.
  const { tellCaseOpened } = await import("@/server/partner-hub");
  await tellCaseOpened(caseId);
  return { ok: true, caseId };
}

export type EnrichmentInput = {
  amountCents: number;
  currency: string;
  validUntil: Date | null;
  /** How many of the supplier's pricing units the figure covers (V24). Null
   *  = not said: the figure is kept and shown, and added to nothing. */
  units: number | null;
  note: string | null;
};

export type RecordEnrichmentResult =
  | { ok: true; version: number }
  | { ok: false; reason: "case_not_found" | "case_cancelled" | "validity_past" };

/**
 * Record what the partner answered — the first figure, or a correction (the
 * next version; the earlier one stays).
 *
 * `channel` says who typed it: staff on the partner's behalf, or the partner
 * themselves in the Partner Hub (V23).
 */
export async function recordEnrichment(
  caseId: string,
  input: EnrichmentInput,
  actor: Actor,
  channel: schema.QuoteChannel = "staff",
): Promise<RecordEnrichmentResult> {
  if (input.validUntil && input.validUntil.getTime() <= Date.now()) {
    return { ok: false, reason: "validity_past" };
  }
  const outcome = await db.transaction(async (tx) => {
    // The case is locked: two figures recorded at once take versions n and
    // n+1, not n twice (the unique index would refuse the second).
    const [row] = await tx
      .select()
      .from(schema.partnerCase)
      .where(eq(schema.partnerCase.id, caseId))
      .for("update");
    if (!row) return { refusal: "case_not_found" as const };
    if (row.status === "cancelled") return { refusal: "case_cancelled" as const };
    const kind = ENRICHMENT_OF[row.kind];
    if (kind === null) return { refusal: "case_not_found" as const };

    const [last] = await tx
      .select({ version: schema.partnerEnrichment.version })
      .from(schema.partnerEnrichment)
      .where(eq(schema.partnerEnrichment.caseId, row.id))
      .orderBy(desc(schema.partnerEnrichment.version))
      .limit(1);
    const version = (last?.version ?? 0) + 1;
    await tx.insert(schema.partnerEnrichment).values({
      id: crypto.randomUUID(),
      caseId: row.id,
      quoteId: row.quoteId,
      kind,
      amountCents: input.amountCents,
      currency: input.currency.toUpperCase(),
      details: input.note ? { note: input.note } : null,
      validUntil: input.validUntil,
      units: input.units !== null && input.units > 0 ? input.units : null,
      channel,
      version,
      createdBy: actor.id,
      createdByName: actor.name,
    });
    await tx
      .update(schema.partnerCase)
      .set({ status: "answered", updatedAt: new Date() })
      .where(eq(schema.partnerCase.id, row.id));
    return { row, version, kind };
  });
  if ("refusal" in outcome) return { ok: false, reason: outcome.refusal };

  await logAudit({
    actorId: actor.id,
    actorName: actor.name,
    action: "partner_case.enriched",
    target: `#${outcome.row.requestId}`,
    detail: {
      kind: outcome.kind,
      amountCents: input.amountCents,
      currency: input.currency.toUpperCase(),
      units: input.units,
      version: outcome.version,
      channel,
    },
  });
  await refreshPackOf(outcome.row.quoteId);
  return { ok: true, version: outcome.version };
}

/** Withdraw a case: its figures stop counting. They stay on record. */
export async function cancelCase(caseId: string, actor: Actor): Promise<{ ok: boolean }> {
  const [row] = await db
    .update(schema.partnerCase)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(and(eq(schema.partnerCase.id, caseId), ne(schema.partnerCase.status, "cancelled")))
    .returning();
  if (!row) return { ok: false };
  await logAudit({
    actorId: actor.id,
    actorName: actor.name,
    action: "partner_case.cancelled",
    target: `#${row.requestId}`,
    detail: { kind: row.kind },
  });
  await refreshPackOf(row.quoteId);
  return { ok: true };
}

/**
 * A figure changed on an offer whose round is under review: the pending pack
 * holds a frozen copy of that offer and must take the new one. `refreshPack`
 * does nothing for a round that is not in review, and never throws.
 */
async function refreshPackOf(quoteId: string): Promise<void> {
  const quote = await db.query.quote.findFirst({
    where: eq(schema.quote.id, quoteId),
    columns: { requestId: true, roundId: true },
  });
  if (!quote?.roundId) return;
  // The REQUEST's latest round, not the quote's own: after a relaunch an
  // offer kept from round 1 is reviewed in round 2's pack.
  const [latest] = await db
    .select({ id: schema.rfqRound.id })
    .from(schema.rfqRound)
    .where(eq(schema.rfqRound.requestId, quote.requestId))
    .orderBy(desc(schema.rfqRound.roundNo))
    .limit(1);
  if (!latest) return;
  const { refreshPack } = await import("@/server/decision-pack");
  await refreshPack(latest.id, "enrichment_changed");
}
