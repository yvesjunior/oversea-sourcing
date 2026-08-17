// Matching & scoring (E5 v1) — ranks the platform-global supplier pool against
// one request's criteria and persists the Top-N as `match` rows.
//
// What changed from v0 (2026-08-16): the old scorer never read the criteria at
// all. It ranked on confidence, verification and risk plus a hash jitter, so a
// supplier that genuinely made 316L plate heat exchangers could rank below one
// that made something else entirely. Research was finding the right companies
// and the ranking was throwing that away.
//
// What we can honestly check today: the supplier's own text (name, descriptor,
// description — the description comes from the research agent reading their
// site). The capability/certification satellite tables from doc/BACKLOG.md do
// not exist yet, so numeric criteria like "16 bar" are NOT checkable from a
// one-line description. Those are recorded as `unverifiable` and left OUT of
// the denominator rather than scored as misses — otherwise every supplier is
// penalised equally for something none of them could ever prove, which is
// noise dressed up as signal.

import { eq } from "drizzle-orm";
import { db } from "@/database";
import * as schema from "@/database/schema";
import { recordEvent } from "@/server/requests";
import { SUPPLIERS_RETURNED } from "@/server/sourcing-config";

/** How many suppliers reach the buyer — configured via SUPPLIERS_RETURNED. */
export const TOP_N = SUPPLIERS_RETURNED;

// ── Weights (sum of positives = 97, leaving 98 as an unreachable ceiling) ────
const BASE = 10;
const CRITERIA_WEIGHT = 55;
const CONFIDENCE_WEIGHT = 20;
const VERIFICATION_POINTS = { verified: 12, pending: 5, unverified: 0, rejected: -25 } as const;
const RISK_PENALTY = { low: 0, medium: 4, high: 10 } as const;
/** A required criterion counts double — missing one is a real disqualifier. */
const REQUIRED_MULTIPLIER = 2;

/** Categories whose values are numeric specs. A supplier's marketing text will
 *  not state "16 bar", so absence proves nothing — see the header note. */
const UNVERIFIABLE_CATEGORIES = new Set(["pressure", "flow", "quantity", "lead_time"]);

/** Units and filler that carry no matching signal. */
const NOISE = new Set([
  "de",
  "du",
  "des",
  "le",
  "la",
  "les",
  "et",
  "ou",
  "en",
  "un",
  "une",
  "pour",
  "avec",
  "sous",
  "par",
  "an",
  "the",
  "and",
  "or",
  "for",
  "with",
  "per",
  "year",
  "of",
  "mm",
  "cm",
  "bar",
  "kg",
  "kn",
  "mois",
  "jours",
  "jour",
  "days",
  "weeks",
  "semaines",
  "units",
  "unites",
  "unités",
  "pieces",
  "pièces",
  "pcs",
  "m3",
  "h",
]);

function normalize(input: string): string {
  return input.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function tokens(input: string): string[] {
  return normalize(input)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2 && !NOISE.has(token));
}

export type CriterionScore = {
  label: string;
  value: string;
  category: string;
  required: boolean;
  /** matched | missed | unverifiable — unverifiable never counts against. */
  outcome: "matched" | "missed" | "unverifiable";
};

export type ScoreBreakdown = {
  base: number;
  criteria: CriterionScore[];
  /** Points earned from criteria coverage, out of CRITERIA_WEIGHT. */
  criteriaPoints: number;
  confidencePoints: number;
  verificationPoints: number;
  riskPenalty: number;
  total: number;
};

type CriterionRow = typeof schema.requestCriterion.$inferSelect;
type SupplierRow = typeof schema.supplier.$inferSelect;

/** Everything we know about a supplier in words, for criterion matching. */
function searchableText(supplier: SupplierRow): string {
  return [supplier.name, supplier.descriptor, supplier.description].filter(Boolean).join(" ");
}

/**
 * Does the supplier's text evidence this criterion?
 *
 * Ratio rather than exact substring: "acier inoxydable 316L" should match a
 * description saying "échangeurs à plaques en acier inoxydable 316L", and a
 * certification list "ISO 9001, ATEX" should match on either.
 */
function criterionMatches(supplierTokens: Set<string>, criterion: CriterionRow): boolean {
  const wanted = tokens(criterion.value);
  if (wanted.length === 0) return false;
  const hits = wanted.filter((token) => supplierTokens.has(token)).length;
  return hits / wanted.length >= 0.5;
}

export function scoreSupplier(supplier: SupplierRow, criteria: CriterionRow[]): ScoreBreakdown {
  const supplierTokens = new Set(tokens(searchableText(supplier)));

  const scored: CriterionScore[] = criteria.map((criterion) => {
    const shared = {
      label: criterion.label,
      value: criterion.value,
      category: criterion.category,
      required: criterion.required,
    };
    if (UNVERIFIABLE_CATEGORIES.has(criterion.category)) {
      return { ...shared, outcome: "unverifiable" as const };
    }
    return {
      ...shared,
      outcome: criterionMatches(supplierTokens, criterion)
        ? ("matched" as const)
        : ("missed" as const),
    };
  });

  const weighed = scored.filter((c) => c.outcome !== "unverifiable");
  const totalWeight = weighed.reduce((sum, c) => sum + (c.required ? REQUIRED_MULTIPLIER : 1), 0);
  const earned = weighed
    .filter((c) => c.outcome === "matched")
    .reduce((sum, c) => sum + (c.required ? REQUIRED_MULTIPLIER : 1), 0);

  // Nothing checkable (no criteria, or all numeric): fall back to the midpoint
  // rather than zero, so an unscoreable request still ranks on the other signals.
  const coverage = totalWeight === 0 ? 0.5 : earned / totalWeight;

  const criteriaPoints = Math.round(CRITERIA_WEIGHT * coverage);
  const confidencePoints = Math.round((supplier.confidenceScore / 100) * CONFIDENCE_WEIGHT);
  const verificationPoints = VERIFICATION_POINTS[supplier.verificationStatus] ?? 0;
  const riskPenalty = RISK_PENALTY[supplier.riskLevel] ?? 0;

  const total = Math.max(
    1,
    Math.min(98, BASE + criteriaPoints + confidencePoints + verificationPoints - riskPenalty),
  );

  return {
    base: BASE,
    criteria: scored,
    criteriaPoints,
    confidencePoints,
    verificationPoints,
    riskPenalty,
    total,
  };
}

/** Ranks the pool for a request, writes the Top-N (idempotent — delete then
 *  insert), stamps the headline score and records matches.created. Returns the
 *  pool size that was scored. */
export async function createMatchesForRequest(
  requestId: string,
  organizationId: string,
  options: { recordEvent?: boolean } = {},
): Promise<number> {
  const [suppliers, criteria] = await Promise.all([
    db.query.supplier.findMany(),
    db.query.requestCriterion.findMany({
      where: eq(schema.requestCriterion.requestId, requestId),
    }),
  ]);
  if (suppliers.length === 0) return 0;

  const ranked = suppliers
    .map((supplier) => ({ supplier, breakdown: scoreSupplier(supplier, criteria) }))
    .sort(
      (a, b) =>
        // Score first; then confidence, then name — deterministic without the
        // fake hash jitter v0 used to manufacture variety.
        b.breakdown.total - a.breakdown.total ||
        b.supplier.confidenceScore - a.supplier.confidenceScore ||
        a.supplier.name.localeCompare(b.supplier.name),
    )
    .slice(0, TOP_N);

  await db.delete(schema.match).where(eq(schema.match.requestId, requestId));
  await db.insert(schema.match).values(
    ranked.map((entry, index) => ({
      id: `${requestId}-match-${entry.supplier.id}`,
      requestId,
      supplierId: entry.supplier.id,
      rank: index + 1,
      compatibilityScore: entry.breakdown.total,
      confidenceScore: entry.supplier.confidenceScore,
      riskLevel: entry.supplier.riskLevel,
      status: "presented" as const,
      scoreBreakdown: entry.breakdown,
    })),
  );

  const top = ranked[0];
  await db
    .update(schema.request)
    .set({ compatibilityScore: top ? top.breakdown.total : null, updatedAt: new Date() })
    .where(eq(schema.request.id, requestId));

  if (options.recordEvent !== false) {
    await recordEvent(requestId, organizationId, "matches.created", {
      count: ranked.length,
      analyzed: suppliers.length,
    });
  }
  return suppliers.length;
}
