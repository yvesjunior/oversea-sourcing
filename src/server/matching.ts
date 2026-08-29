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

import { eq, inArray } from "drizzle-orm";
import { db } from "@/database";
import * as schema from "@/database/schema";
// Tokenization lives in the shared lib (C2b): the SQL prefilter in
// sources/scope.ts must use the exact same vocabulary as this scorer.
import { tokens } from "@/lib/match-tokens";
import { recordEvent } from "@/server/requests";
import { SUPPLIERS_RETURNED } from "@/server/sourcing-config";
import { eligibleCandidates, resolveScope, type MatchCandidate } from "@/server/sources/scope";

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
  /** How many criteria could be checked at all (numeric specs cannot). */
  checkableCount: number;
  /** How many of those the supplier's own text actually evidences. */
  matchedCount: number;
};

type CriterionRow = typeof schema.requestCriterion.$inferSelect;

/** What the scorer actually reads — structural, so supplier rows AND
 *  store-record candidates (Phase D) both qualify. */
export type Scoreable = {
  name: string;
  descriptor: string | null;
  description: string | null;
  confidenceScore: number;
  verificationStatus: schema.VerificationStatus;
  riskLevel: schema.RiskLevel;
};

/** Everything we know about a supplier in words, for criterion matching. */
function searchableText(supplier: Scoreable): string {
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
  // Tokens carrying a digit are the discriminating half of a spec: "ISO 9001"
  // and "ISO 8573" differ only in the number, and a ratio that ignores it
  // matches the wrong certification (A8 field evidence, 2026-08-22: a
  // compressor request store-hit off valve suppliers through the shared
  // "iso"). Every numeric token must hit; the 0.5 ratio covers the words.
  const strong = wanted.filter((token) => /\d/.test(token));
  if (strong.some((token) => !supplierTokens.has(token))) return false;
  const hits = wanted.filter((token) => supplierTokens.has(token)).length;
  return hits / wanted.length >= 0.5;
}

export function scoreSupplier(supplier: Scoreable, criteria: CriterionRow[]): ScoreBreakdown {
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
  const matchedCount = weighed.filter((c) => c.outcome === "matched").length;
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
    checkableCount: weighed.length,
    matchedCount,
  };
}

/**
 * RELEVANCE IS A GATE, NOT A COMPONENT (fix 2026-08-29, owner-validated).
 *
 * The three quality terms — base, confidence, verification, minus risk — are
 * awarded independently of whether the supplier has anything to do with the
 * request. A verified, confident supplier therefore scored ~40-41 with ZERO
 * criteria matched, which produced two failures at once:
 *
 *   1. ranking: an electronics request came back with a Top-5 of pump
 *      companies, every criterion `missed`, each shown as "41 % compatible";
 *   2. worse — that floor clears STORE_MIN_SCORE (40), so a pool of ≥ 2×N
 *      verified suppliers could store-hit ANY request and suppress live
 *      research entirely. New categories were served the old pool forever.
 *
 * So relevance no longer contributes points; it decides ELIGIBILITY. Quality
 * then orders suppliers WITHIN the relevant set, which is what those terms
 * were always meant to do.
 *
 * A request with nothing checkable (all-numeric criteria, or none at all)
 * cannot judge relevance — every candidate stays eligible so the dossier
 * still ranks on quality. `countQualifyingCandidates` treats that case
 * separately: it must never satisfy store-first, or an unjudgeable request
 * would be answered from the pool without ever searching.
 */
export function isRelevant(breakdown: ScoreBreakdown): boolean {
  if (breakdown.checkableCount === 0) return true;
  return breakdown.matchedCount > 0;
}

/**
 * Ranks the workspace's logical candidates for a request, PROMOTES the Top-N
 * that aren't suppliers yet (Phase D: a supplier row is created only when a
 * record group actually surfaces for a buyer — the store stays disposable),
 * writes the `match` rows (idempotent — delete then insert), stamps the
 * headline score and records matches.created. Returns the pool size scored.
 *
 * Source + country scope is a HARD filter (validated 2026-08-22): candidates
 * are built from the workspace's effective scope, exclusion not down-scoring.
 */
export async function createMatchesForRequest(
  requestId: string,
  organizationId: string,
  options: { recordEvent?: boolean; candidates?: MatchCandidate[] } = {},
): Promise<number> {
  const criteria = await db.query.requestCriterion.findMany({
    where: eq(schema.requestCriterion.requestId, requestId),
  });
  const candidates =
    options.candidates ??
    (await eligibleCandidates(
      await resolveScope(organizationId),
      // Criteria feed the big-store SQL prefilter (C2b).
      criteria.map((c) => c.value),
    ));
  if (candidates.length === 0) {
    if (options.recordEvent !== false) {
      await recordEvent(requestId, organizationId, "matches.created", { count: 0, analyzed: 0 });
    }
    return 0;
  }

  const ranked = candidates
    .map((candidate) => ({ candidate, breakdown: scoreSupplier(candidate, criteria) }))
    // The gate. A candidate that evidences NOTHING the buyer asked for is not
    // a worse match — it is not a match, and padding the Top-N with it is
    // worse than returning fewer. An empty result is honest and, upstream,
    // makes the pipeline fall through to live research.
    .filter((entry) => isRelevant(entry.breakdown))
    .sort(
      (a, b) =>
        // Score first; then confidence, then name — deterministic without the
        // fake hash jitter v0 used to manufacture variety.
        b.breakdown.total - a.breakdown.total ||
        b.candidate.confidenceScore - a.candidate.confidenceScore ||
        a.candidate.name.localeCompare(b.candidate.name),
    )
    .slice(0, TOP_N);

  // Promotion: the ranked record groups become suppliers NOW — matches (and
  // everything downstream) only ever reference supplier rows. The dedup
  // unique index settles races; a re-run finds the existing row and promotes
  // nothing new.
  const supplierIds = new Map<string, string>(); // dedupKey → supplier id
  for (const entry of ranked) {
    const c = entry.candidate;
    if (c.supplierId) {
      supplierIds.set(c.dedupKey, c.supplierId);
      continue;
    }
    const inserted = await db
      .insert(schema.supplier)
      .values({
        id: crypto.randomUUID(),
        name: c.name,
        descriptor: c.descriptor,
        countryCode: c.countryCode,
        website: c.website,
        description: c.description,
        provenance:
          c.sourceType === "global_web" ? ("ai_researched" as const) : ("imported" as const),
        verificationStatus: "unverified" as const,
        confidenceScore: c.confidenceScore,
        riskLevel: "medium" as const,
        sourceRef: c.sourceUrl,
        dedupKey: c.dedupKey,
        discoveredByRequestId: requestId,
        lastResearchedAt: c.lastSeenAt ?? new Date(),
      })
      .onConflictDoNothing({ target: schema.supplier.dedupKey })
      .returning({ id: schema.supplier.id });
    let supplierId = inserted[0]?.id;
    if (!supplierId) {
      const existing = await db.query.supplier.findFirst({
        where: eq(schema.supplier.dedupKey, c.dedupKey),
        columns: { id: true },
      });
      if (!existing) continue; // raced with a delete — drop this candidate
      supplierId = existing.id;
    }
    if (c.recordIds.length > 0) {
      await db
        .update(schema.sourceRecord)
        .set({ supplierId })
        .where(inArray(schema.sourceRecord.id, c.recordIds));
    }
    supplierIds.set(c.dedupKey, supplierId);
  }
  const placed = ranked.filter((entry) => supplierIds.has(entry.candidate.dedupKey));

  await db.delete(schema.match).where(eq(schema.match.requestId, requestId));
  await db.insert(schema.match).values(
    placed.map((entry, index) => ({
      id: `${requestId}-match-${supplierIds.get(entry.candidate.dedupKey)!}`,
      requestId,
      supplierId: supplierIds.get(entry.candidate.dedupKey)!,
      rank: index + 1,
      compatibilityScore: entry.breakdown.total,
      confidenceScore: entry.candidate.confidenceScore,
      riskLevel: entry.candidate.riskLevel,
      status: "presented" as const,
      scoreBreakdown: entry.breakdown,
    })),
  );

  const top = placed[0];
  await db
    .update(schema.request)
    .set({ compatibilityScore: top ? top.breakdown.total : null, updatedAt: new Date() })
    .where(eq(schema.request.id, requestId));

  if (options.recordEvent !== false) {
    await recordEvent(requestId, organizationId, "matches.created", {
      count: placed.length,
      analyzed: candidates.length,
    });
  }
  return candidates.length;
}
