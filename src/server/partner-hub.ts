// The Partner Hub (Phase V · V23) — what a partner's person reads and writes.
//
// THE PARTITION. Every query here is filtered by the caller's own
// `partnerIds` — the whole of a partner account's authority
// (`requirePartnerSession`). A case of another partner is "not found", the
// same answer as a case that does not exist.
//
// THE NEED-TO-KNOW. Within a case of theirs, a partner is shown what that
// KIND of case needs and nothing else: `factsForCase` (src/lib/partner-need.ts)
// removes the rest before anything leaves this file. What never leaves it for
// any kind: the buyer, the workspace, another offer, a rank, OSI's fee, the
// supplier's payment terms and notes, another partner's figures, and the name
// of the staff member who opened the case.

import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/database";
import * as schema from "@/database/schema";
import { buildCaseOpenedMail } from "@/lib/partner-mail";
import { canAnswerCase, factsForCase, type CaseFacts } from "@/lib/partner-need";
import type { PartnerKind } from "@/lib/partners";
import { specCriterionLine } from "@/lib/request-spec";
import { sendMail } from "@/server/mail";
import { recordEnrichment, type EnrichmentInput } from "@/server/partner-cases";
import { specForReading } from "@/server/spec";

/** Who is asking: what `requirePartnerSession` returned. */
export type HubCaller = {
  userId: string;
  userName: string;
  locale: string;
  partnerIds: string[];
};

export type HubFigure = {
  version: number;
  amountCents: number;
  currency: string;
  validUntil: string | null;
  /** How many of the supplier's units the figure covers (V24). */
  units: number | null;
  note: string | null;
  /** Who typed it: the partner in the Hub, or OSI on their behalf. Never a
   *  staff member's name. */
  channel: schema.QuoteChannel;
  createdAt: string;
};

export type HubCaseSummary = {
  id: string;
  /** OSI's reference for the dossier — "#3049". */
  reference: string;
  kind: PartnerKind;
  /** Which of the caller's partners it was addressed to. */
  partnerName: string;
  status: schema.PartnerCaseStatus;
  /** What the goods are — every kind of case is shown that much. */
  title: string;
  openedAt: string;
  /** The figure that counts, if one was given. */
  current: HubFigure | null;
};

export type HubCaseDetail = HubCaseSummary & {
  /** What OSI asked, in its own words. */
  brief: string | null;
  /** The facts this kind of case needs. A key the kind does not need is
   *  ABSENT, not null. */
  facts: Partial<CaseFacts>;
  /** Every figure given for this case, newest first. */
  figures: HubFigure[];
  canAnswer: boolean;
};

type CaseRow = {
  case: typeof schema.partnerCase.$inferSelect;
  partnerName: string;
  requestTitle: string;
};

/** The caller's cases — the one query everything else starts from. */
async function ownCases(caller: HubCaller, caseId?: string): Promise<CaseRow[]> {
  // `partnerIds` is never empty (the guard returns null instead), and this
  // refuses anyway: an empty list must not become "no filter".
  if (caller.partnerIds.length === 0) return [];
  return db
    .select({
      case: schema.partnerCase,
      partnerName: schema.partner.name,
      requestTitle: schema.request.title,
    })
    .from(schema.partnerCase)
    .innerJoin(schema.partner, eq(schema.partner.id, schema.partnerCase.partnerId))
    .innerJoin(schema.request, eq(schema.request.id, schema.partnerCase.requestId))
    .where(
      and(
        inArray(schema.partnerCase.partnerId, caller.partnerIds),
        ...(caseId ? [eq(schema.partnerCase.id, caseId)] : []),
      ),
    )
    .orderBy(desc(schema.partnerCase.createdAt));
}

async function figuresOf(caseIds: string[]): Promise<Map<string, HubFigure[]>> {
  const byCase = new Map<string, HubFigure[]>();
  if (caseIds.length === 0) return byCase;
  const rows = await db
    .select()
    .from(schema.partnerEnrichment)
    .where(inArray(schema.partnerEnrichment.caseId, caseIds))
    .orderBy(desc(schema.partnerEnrichment.version));
  for (const row of rows) {
    const list = byCase.get(row.caseId) ?? [];
    list.push({
      version: row.version,
      amountCents: row.amountCents,
      currency: row.currency,
      validUntil: row.validUntil ? row.validUntil.toISOString() : null,
      units: row.units,
      note: row.details?.note ?? null,
      channel: row.channel,
      createdAt: row.createdAt.toISOString(),
    });
    byCase.set(row.caseId, list);
  }
  return byCase;
}

function summary(row: CaseRow, figures: HubFigure[]): HubCaseSummary {
  return {
    id: row.case.id,
    reference: `#${row.case.requestId}`,
    kind: row.case.kind,
    partnerName: row.partnerName,
    status: row.case.status,
    title: row.requestTitle,
    openedAt: row.case.createdAt.toISOString(),
    // A withdrawn case's figures no longer count: none is "current".
    current: row.case.status === "cancelled" ? null : (figures[0] ?? null),
  };
}

/** Every case addressed to the caller's partner(s), newest first. */
export async function listCases(caller: HubCaller): Promise<HubCaseSummary[]> {
  const rows = await ownCases(caller);
  const figures = await figuresOf(rows.map((row) => row.case.id));
  return rows.map((row) => summary(row, figures.get(row.case.id) ?? []));
}

/** One case of the caller's, with what its kind needs. Null = not theirs. */
export async function readCase(caller: HubCaller, caseId: string): Promise<HubCaseDetail | null> {
  const [row] = await ownCases(caller, caseId);
  if (!row) return null;

  const quote = await db.query.quote.findFirst({ where: eq(schema.quote.id, row.case.quoteId) });
  if (!quote) return null;
  const [spec, supplier, english, figures] = await Promise.all([
    specForReading(quote.requestId, quote.specVersion),
    quote.supplierId
      ? db.query.supplier.findFirst({
          where: eq(schema.supplier.id, quote.supplierId),
          columns: { countryCode: true },
        })
      : null,
    db
      .select({ id: schema.requestCriterion.id, valueEn: schema.requestCriterion.valueEn })
      .from(schema.requestCriterion)
      .where(eq(schema.requestCriterion.requestId, quote.requestId)),
    figuresOf([row.case.id]),
  ]);
  const valueEn = new Map(english.map((c) => [c.id, c.valueEn]));
  const inEnglish = caller.locale === "en";

  // Everything that could be said — then cut down to what this kind needs.
  const everything: CaseFacts = {
    goods: {
      title: spec?.title ?? row.requestTitle,
      lines: (spec?.criteria ?? []).map((c) =>
        specCriterionLine({
          label: c.label,
          value: inEnglish ? (valueEn.get(c.id) ?? c.value) : c.value,
          unit: c.unit,
        }),
      ),
    },
    quantity: quote.quantity,
    origin: supplier?.countryCode ?? null,
    incoterm: quote.incoterm,
    lead_time: quote.leadTimeDays,
    goods_value:
      quote.amountCents !== null && quote.currency
        ? { amountCents: quote.amountCents, currency: quote.currency }
        : null,
    supplier_identity: quote.supplierName,
  };
  const own = figures.get(row.case.id) ?? [];
  return {
    ...summary(row, own),
    brief: row.case.brief,
    facts: factsForCase(row.case.kind, everything),
    figures: own,
    canAnswer: canAnswerCase(row.case.status),
  };
}

export type HubAnswerResult =
  | { ok: true; version: number }
  | {
      ok: false;
      reason:
        /** Not one of theirs — or no such case. One answer for both. */
        | "not_found"
        /** OSI withdrew the case. */
        | "cancelled"
        | "validity_past";
    };

/**
 * The partner's own answer: a figure on one of THEIR cases — the first, or a
 * correction. Recorded exactly as a figure staff key in on their behalf,
 * with the channel `portal`.
 */
export async function answerCase(
  caller: HubCaller,
  caseId: string,
  input: EnrichmentInput,
): Promise<HubAnswerResult> {
  const [row] = await ownCases(caller, caseId);
  if (!row) return { ok: false, reason: "not_found" };
  if (!canAnswerCase(row.case.status)) return { ok: false, reason: "cancelled" };
  const result = await recordEnrichment(
    caseId,
    input,
    { id: caller.userId, name: caller.userName },
    "portal",
  );
  if (result.ok) return result;
  if (result.reason === "validity_past") return { ok: false, reason: "validity_past" };
  return { ok: false, reason: result.reason === "case_cancelled" ? "cancelled" : "not_found" };
}

/**
 * Tell the partner's people that a case was opened — the accounts the partner
 * already has, each in its own language. A partner with no account is told
 * nothing here: staff reach them as before, or invite them.
 *
 * A side effect of opening a case: it never throws, and a refused address
 * does not stop the others.
 */
export async function tellCaseOpened(caseId: string): Promise<number> {
  try {
    const partnerCase = await db.query.partnerCase.findFirst({
      where: eq(schema.partnerCase.id, caseId),
    });
    if (!partnerCase) return 0;
    const people = await db
      .select({ email: schema.user.email, name: schema.user.name, locale: schema.user.locale })
      .from(schema.partnerUser)
      .innerJoin(schema.user, eq(schema.user.id, schema.partnerUser.userId))
      .where(eq(schema.partnerUser.partnerId, partnerCase.partnerId));
    const base = process.env["BETTER_AUTH_URL"] ?? "http://localhost:3010";
    let told = 0;
    for (const person of people) {
      const mail = buildCaseOpenedMail({
        locale: person.locale === "en" ? "en" : "fr",
        greetingName: person.name,
        reference: `#${partnerCase.requestId}`,
        kind: partnerCase.kind,
        url: `${base}/partenaires/dossier/${partnerCase.id}`,
      });
      try {
        const result = await sendMail({
          to: person.email,
          subject: mail.subject,
          html: mail.html,
          text: mail.text,
        });
        if (result.ok || result.queued) told += 1;
      } catch (error) {
        console.error(`partner: case notice to ${person.email} failed —`, error);
      }
    }
    return told;
  } catch (error) {
    console.error(`partner: could not announce case ${caseId} —`, error);
    return 0;
  }
}
