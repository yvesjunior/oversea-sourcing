// The internal shortlist (Phase V · V05) — KPI #1's ranking, as OSI's working
// list rather than the buyer's answer.
//
// On the pack flow the ranked `match` rows are never the buyer's to read (see
// src/lib/request-status.ts). Staff read them here, with the one thing the
// ranking has always computed and no screen ever showed — `score_breakdown`,
// why each supplier ranks where it does — and confirm who will be asked.
//
// Confirming creates the `quote` rows, exactly the rows the buyer's own
// selection creates on the report flow. It does NOT send anything and does
// not move the request: `shortlisted → soliciting` is the batch leaving (V06).

import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/database";
import * as schema from "@/database/schema";
import type { QuoteStatus, RequestStatus, RiskLevel, VerificationStatus } from "@/database/schema";
import type { PerformanceReason } from "@/lib/supplier-performance";
import { primaryContactsFor } from "@/server/supplier-contacts";

export type BreakdownView = {
  total: number;
  criteriaPoints: number;
  confidencePoints: number;
  verificationPoints: number;
  riskPenalty: number;
  /** What the supplier's closed deals moved the score by (V31) — 0 and no
   *  reason for a supplier with no history. */
  performancePoints: number;
  performance: PerformanceReason[];
  checkableCount: number;
  matchedCount: number;
  criteria: {
    label: string;
    value: string;
    required: boolean;
    outcome: "matched" | "partial" | "missed" | "unverifiable";
  }[];
};

export type ShortlistCandidate = {
  supplierId: string;
  name: string;
  descriptor: string | null;
  countryCode: string;
  website: string | null;
  rank: number;
  score: number;
  confidence: number;
  riskLevel: RiskLevel;
  verificationStatus: VerificationStatus;
  /** Null on a row scored before breakdowns were stored, or one whose stored
   *  shape this reader does not recognise — shown as "no detail", never
   *  guessed at. */
  breakdown: BreakdownView | null;
  /** The address the RFQ would go to. Null = nobody to write to yet. */
  contactEmail: string | null;
  /** The solicitation already on this request for this supplier, if any. */
  quote: { status: QuoteStatus; sent: boolean } | null;
};

export type ShortlistData = {
  requestId: string;
  status: RequestStatus;
  /** Only while the request rests in `shortlisted`. */
  canConfirm: boolean;
  candidates: ShortlistCandidate[];
};

const OUTCOMES = ["matched", "partial", "missed", "unverifiable"] as const;

const num = (value: unknown): number => (typeof value === "number" ? value : 0);

/** The reasons behind a performance adjustment, read as defensively as the
 *  rest: only the three kinds this reader knows, with numbers where it
 *  expects numbers. */
function readReasons(raw: unknown): PerformanceReason[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry): PerformanceReason[] => {
    if (!entry || typeof entry !== "object") return [];
    const r = entry as Record<string, unknown>;
    const points = num(r["points"]);
    if (r["key"] === "late") return [{ key: "late", deals: num(r["deals"]), points }];
    if (r["key"] === "satisfaction") {
      return [{ key: "satisfaction", average: num(r["average"]), points }];
    }
    if (r["key"] === "disputed") return [{ key: "disputed", issues: num(r["issues"]), points }];
    return [];
  });
}

/** `score_breakdown` is jsonb, written by the matcher of its day. Read it
 *  defensively: the shape has changed before and will again. */
function readBreakdown(raw: unknown): BreakdownView | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Record<string, unknown>;
  if (!Array.isArray(b["criteria"])) return null;
  return {
    total: num(b["total"]),
    criteriaPoints: num(b["criteriaPoints"]),
    confidencePoints: num(b["confidencePoints"]),
    verificationPoints: num(b["verificationPoints"]),
    riskPenalty: num(b["riskPenalty"]),
    performancePoints: num(b["performancePoints"]),
    performance: readReasons(b["performance"]),
    checkableCount: num(b["checkableCount"]),
    matchedCount: num(b["matchedCount"]),
    criteria: (b["criteria"] as unknown[]).flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const c = entry as Record<string, unknown>;
      const outcome = OUTCOMES.find((o) => o === c["outcome"]);
      if (typeof c["label"] !== "string" || !outcome) return [];
      return [
        {
          label: c["label"],
          value: typeof c["value"] === "string" ? c["value"] : "",
          required: c["required"] === true,
          outcome,
        },
      ];
    }),
  };
}

export async function loadShortlist(requestId: string): Promise<ShortlistData | null> {
  const request = await db.query.request.findFirst({
    where: eq(schema.request.id, requestId),
    columns: { id: true, status: true },
  });
  if (!request) return null;

  const [rows, quotes] = await Promise.all([
    db
      .select({ match: schema.match, supplier: schema.supplier })
      .from(schema.match)
      .innerJoin(schema.supplier, eq(schema.match.supplierId, schema.supplier.id))
      .where(eq(schema.match.requestId, requestId))
      .orderBy(asc(schema.match.rank)),
    db.query.quote.findMany({ where: eq(schema.quote.requestId, requestId) }),
  ]);
  const contacts = await primaryContactsFor(rows.map((row) => row.supplier.id));
  const quoteBySupplier = new Map(quotes.map((quote) => [quote.supplierId, quote]));

  return {
    requestId: request.id,
    status: request.status,
    canConfirm: request.status === "shortlisted",
    candidates: rows.map(({ match, supplier }) => {
      const quote = quoteBySupplier.get(supplier.id);
      return {
        supplierId: supplier.id,
        name: supplier.name,
        descriptor: supplier.descriptor,
        countryCode: supplier.countryCode,
        website: supplier.website,
        rank: match.rank,
        score: match.compatibilityScore,
        confidence: match.confidenceScore,
        riskLevel: match.riskLevel,
        verificationStatus: supplier.verificationStatus,
        breakdown: readBreakdown(match.scoreBreakdown),
        contactEmail: contacts.get(supplier.id)?.email ?? null,
        quote: quote ? { status: quote.status, sent: quote.sentAt !== null } : null,
      };
    }),
  };
}

export type ConfirmShortlistResult =
  | { ok: true; selected: number; added: number; removed: number }
  | { ok: false; reason: "not_found" | "not_shortlisted" | "unknown_supplier" | "empty" };

/**
 * Set who will be asked for this request.
 *
 * Re-runnable until the batch leaves: confirming again with a different
 * selection adds the newcomers and removes the ones dropped — but ONLY the
 * ones still unsent. A solicitation that has gone out, or been answered, is a
 * fact about the world and is never deleted by un-ticking a box.
 */
export async function confirmShortlist(
  requestId: string,
  supplierIds: readonly string[],
  actor: { id: string; name: string },
): Promise<ConfirmShortlistResult> {
  const selection = [...new Set(supplierIds)];
  if (selection.length === 0) return { ok: false, reason: "empty" };

  const request = await db.query.request.findFirst({ where: eq(schema.request.id, requestId) });
  if (!request) return { ok: false, reason: "not_found" };
  if (request.status !== "shortlisted") return { ok: false, reason: "not_shortlisted" };

  // Only suppliers this request actually ranked. Anything else is a mistake
  // or someone probing the endpoint — same rule as the buyer's own selection.
  const ranked = await db
    .select({ id: schema.supplier.id, name: schema.supplier.name })
    .from(schema.match)
    .innerJoin(schema.supplier, eq(schema.match.supplierId, schema.supplier.id))
    .where(and(eq(schema.match.requestId, requestId), inArray(schema.match.supplierId, selection)));
  if (ranked.length !== selection.length) return { ok: false, reason: "unknown_supplier" };
  const nameById = new Map(ranked.map((supplier) => [supplier.id, supplier.name]));

  const { added, removed } = await db.transaction(async (tx) => {
    const existing = await tx.query.quote.findMany({
      where: eq(schema.quote.requestId, requestId),
    });
    const already = new Set(existing.map((quote) => quote.supplierId));

    const dropped = existing.filter(
      (quote) =>
        quote.supplierId !== null &&
        !selection.includes(quote.supplierId) &&
        quote.status === "requested" &&
        quote.sentAt === null,
    );
    if (dropped.length > 0) {
      await tx.delete(schema.quote).where(
        and(
          inArray(
            schema.quote.id,
            dropped.map((quote) => quote.id),
          ),
          // Re-checked in the statement itself: a send landing between the
          // read above and this delete must win.
          eq(schema.quote.status, "requested"),
          isNull(schema.quote.sentAt),
        ),
      );
    }

    const fresh = selection.filter((supplierId) => !already.has(supplierId));
    if (fresh.length > 0) {
      await tx
        .insert(schema.quote)
        .values(
          fresh.map((supplierId) => ({
            id: crypto.randomUUID(),
            requestId,
            organizationId: request.organizationId,
            supplierId,
            // Snapshot: the row stays readable if the supplier is gone.
            supplierName: nameById.get(supplierId) ?? "—",
            status: "requested" as const,
            // Staff, not the buyer: on the pack flow OSI picks who is asked.
            requestedBy: actor.id,
          })),
        )
        .onConflictDoNothing({ target: [schema.quote.requestId, schema.quote.supplierId] });
    }
    return { added: fresh.length, removed: dropped.length };
  });

  return { ok: true, selected: selection.length, added, removed };
}
