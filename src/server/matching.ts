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
// site). The capability/certification satellite tables from BACKLOG.md do
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
import { criterionWeight, KPI1_BASE_WEIGHTS, type Kpi1Weights } from "@/lib/kpi-profile";
import { haystackTokens, tokens } from "@/lib/match-tokens";
import { recordEvent } from "@/server/requests";
import { SUPPLIERS_RETURNED } from "@/server/sourcing-config";
import { syncResearchedContacts } from "@/server/supplier-contacts";
import { eligibleCandidates, resolveScope, type MatchCandidate } from "@/server/sources/scope";

/** How many suppliers reach the buyer — configured via SUPPLIERS_RETURNED. */
export const TOP_N = SUPPLIERS_RETURNED;

// ── Weights ─────────────────────────────────────────────────────────────────
// They are no longer constants of this file (V19): they come from the
// request's KPI profile (`src/lib/kpi-profile.ts`, table `kpi_profile`), and
// `scoreSupplier` takes them as an argument. The default profile is the
// numbers this file used to hold — base 10, criteria 55, confidence 20, a
// required criterion counting double, a partial match on the product earning
// half — so a request nobody adjusted ranks exactly as before.

/** Categories whose values are numeric specs. A supplier's marketing text will
 *  not state "16 bar", so absence proves nothing — see the header note. */
const UNVERIFIABLE_CATEGORIES = new Set(["pressure", "flow", "quantity", "lead_time"]);

export type CriterionScore = {
  label: string;
  value: string;
  category: string;
  required: boolean;
  /** matched | partial | missed | unverifiable. `partial` exists only on the
   *  PRIMARY row: the product words match but a grade code does not. Never
   *  counts against; earns the profile's `partialCredit` rather than full. */
  outcome: "matched" | "partial" | "missed" | "unverifiable";
};

export type ScoreBreakdown = {
  base: number;
  criteria: CriterionScore[];
  /** Points earned from criteria coverage, out of the profile's `criteria`. */
  criteriaPoints: number;
  confidencePoints: number;
  verificationPoints: number;
  riskPenalty: number;
  total: number;
  /** How many criteria could be checked at all (numeric specs cannot). */
  checkableCount: number;
  /** How many of those the supplier's own text actually evidences. */
  matchedCount: number;
  /** Primary rows matched on the product words but not the grade code. */
  partialCount: number;
  /** Did the PRODUCT criterion match? null when the request has no checkable
   *  primary row (legacy free-text intake, or a numeric-only product). */
  primaryMatched: boolean | null;
};

type CriterionRow = typeof schema.requestCriterion.$inferSelect;

/** What the scorer actually reads — structural, so supplier rows AND
 *  store-record candidates (Phase D) both qualify. */
export type Scoreable = {
  name: string;
  descriptor: string | null;
  description: string | null;
  /** English form of the description, when known. */
  descriptionEn?: string | null;
  confidenceScore: number;
  verificationStatus: schema.VerificationStatus;
  riskLevel: schema.RiskLevel;
};

/** Everything we know about a supplier in words, for criterion matching —
 *  in BOTH languages (2026-08-29).
 *
 *  Descriptions are written in the language of the request that discovered
 *  the company, so a pool built by French requests could not answer an
 *  English one: the product gate would reject every supplier and the buyer
 *  would pay for a fresh search of companies we already knew. Searching both
 *  texts costs nothing and makes the store serve either language.
 *
 *  Union rather than "pick the request's language": we do not know which
 *  language the criteria are in, and a false NEGATIVE here is expensive (a
 *  wasted research pass) while a false positive is bounded — the tokens still
 *  have to match. */
function searchableText(supplier: Scoreable): string {
  return [supplier.name, supplier.descriptor, supplier.description, supplier.descriptionEn]
    .filter(Boolean)
    .join(" ");
}

/** full = everything the criterion asks for · partial = the product words but
 *  not the grade code (primary row only) · none = not evidenced. */
type MatchStrength = "full" | "partial" | "none";

/**
 * How well does the supplier's text evidence this criterion?
 *
 * Ratio rather than exact substring: "acier inoxydable 316L" should match a
 * description saying "échangeurs à plaques en acier inoxydable 316L", and a
 * certification list "ISO 9001, ATEX" should match on either.
 */
function matchStrength(
  supplierTokens: Set<string>,
  value: string,
  /** Only the PRIMARY row may come back `partial` — see below. */
  allowPartial: boolean,
): MatchStrength {
  const wanted = tokens(value);
  if (wanted.length === 0) return "none";
  // Tokens carrying a digit are the discriminating half of a spec: "ISO 9001"
  // and "ISO 8573" differ only in the number, and a ratio that ignores it
  // matches the wrong certification (A8 field evidence, 2026-08-22: a
  // compressor request store-hit off valve suppliers through the shared
  // "iso"). Every numeric token must hit; the 0.5 ratio covers the words.
  const strong = wanted.filter((token) => /\d/.test(token));
  const missingStrong = strong.some((token) => !supplierTokens.has(token));
  const hits = wanted.filter((token) => supplierTokens.has(token)).length;
  if (!missingStrong) return hits / wanted.length >= 0.5 ? "full" : "none";
  if (!allowPartial) return "none";

  // ── The grade code is a preference, not a disqualifier (owner 2026-10-11) ──
  // A buyer asking for "PVC Paste Resin PSH25" wants that grade, and will also
  // look at the nine other houses that make PVC paste resin. Returning only
  // the one exact maker — or, before this, returning NOTHING — is not what a
  // sourcing agent does.
  //
  // The guard that keeps this from reopening the 2026-08-22 defect: the words
  // AROUND the code must carry signal of their own, and there must be at least
  // two of them. "ISO 8573-1" has exactly one word, "iso", which is why a
  // certification can never qualify this way; "PVC paste resin" has three.
  const words = wanted.filter((token) => !/\d/.test(token));
  if (words.length < 2) return "none";
  const wordHits = words.filter((token) => supplierTokens.has(token)).length;
  return wordHits / words.length >= 0.5 ? "partial" : "none";
}

/**
 * Does the supplier's text evidence this criterion, in EITHER language?
 *
 * Company information is listed in English far more often than in French
 * (Singapore's registry: ~613k English activity descriptions), so a French
 * criterion alone would never reach it — and since the product criterion is
 * now a gate, "never reach it" means the supplier is invisible, not merely
 * ranked lower. `value_en` is filled by the worker before matching
 * (src/server/criteria-translation.ts).
 *
 * Either form matching is enough. Both are the buyer's own requirement said
 * two ways, so this widens reach without loosening what counts as a match:
 * the tokens still have to be there.
 */
function criterionStrength(supplierTokens: Set<string>, criterion: CriterionRow): MatchStrength {
  const native = matchStrength(supplierTokens, criterion.value, criterion.isPrimary);
  if (native === "full" || !criterion.valueEn) return native;
  const english = matchStrength(supplierTokens, criterion.valueEn, criterion.isPrimary);
  // Best of the two forms: either is the buyer's own requirement said twice.
  if (english === "full") return "full";
  return native === "partial" || english === "partial" ? "partial" : "none";
}

export function scoreSupplier(
  supplier: Scoreable,
  criteria: CriterionRow[],
  /** The request's KPI #1 weights. Omitted = the platform's own, with every
   *  criterion weighed required ×2 / optional ×1 — what a default profile
   *  says too, so callers with no profile at hand score identically. */
  weights: Kpi1Weights = KPI1_BASE_WEIGHTS,
): ScoreBreakdown {
  const supplierTokens = new Set(haystackTokens(searchableText(supplier)));

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
    const strength = criterionStrength(supplierTokens, criterion);
    return {
      ...shared,
      outcome:
        strength === "full"
          ? ("matched" as const)
          : strength === "partial"
            ? ("partial" as const)
            : ("missed" as const),
    };
  });

  // `scored` is index-aligned with `criteria`, which is where the weight of
  // each row comes from: the profile names criteria by id.
  const weighedRows = scored
    .map((score, index) => ({ score, weight: criterionWeight(weights, criteria[index]!) }))
    .filter((row) => row.score.outcome !== "unverifiable");
  const weighed = weighedRows.map((row) => row.score);
  const totalWeight = weighedRows.reduce((sum, row) => sum + row.weight, 0);
  const earned = weighedRows.reduce((sum, row) => {
    if (row.score.outcome === "matched") return sum + row.weight;
    if (row.score.outcome === "partial") return sum + row.weight * weights.partialCredit;
    return sum;
  }, 0);

  // Nothing checkable (no criteria, or all numeric): fall back to the midpoint
  // rather than zero, so an unscoreable request still ranks on the other signals.
  const coverage = totalWeight === 0 ? 0.5 : earned / totalWeight;

  const criteriaPoints = Math.round(weights.criteria * coverage);
  const matchedCount = weighed.filter((c) => c.outcome === "matched").length;
  const partialCount = weighed.filter((c) => c.outcome === "partial").length;
  // The product row, when the request has one and it is checkable at all.
  const primary = criteria.findIndex((c) => c.isPrimary);
  const primaryOutcome = primary >= 0 ? scored[primary]?.outcome : undefined;
  // A partial primary IS relevant — it is an alternative to the exact grade,
  // and it scores lower rather than being excluded.
  const primaryMatched =
    primaryOutcome === undefined || primaryOutcome === "unverifiable"
      ? null
      : primaryOutcome === "matched" || primaryOutcome === "partial";
  const confidencePoints = Math.round((supplier.confidenceScore / 100) * weights.confidence);
  const verificationPoints = weights.verification[supplier.verificationStatus] ?? 0;
  const riskPenalty = weights.risk[supplier.riskLevel] ?? 0;

  const total = Math.max(
    1,
    Math.min(
      98,
      weights.base + criteriaPoints + confidencePoints + verificationPoints - riskPenalty,
    ),
  );

  return {
    base: weights.base,
    criteria: scored,
    criteriaPoints,
    confidencePoints,
    verificationPoints,
    riskPenalty,
    total,
    checkableCount: weighed.length,
    matchedCount,
    partialCount,
    primaryMatched,
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
 *
 * THE PRODUCT IS THE GATE when the request names one (owner 2026-08-29:
 * "certification is just a supplementary criterion, product is the first").
 * Asking for merely ANY matched criterion let a supplier through on a
 * near-universal certification alone — "ISO 9001" says nothing about whether
 * they make the thing. Requests from the structured form always carry a
 * primary row; legacy free-text ones do not, and fall back to the looser
 * "at least one criterion" rule, which is the best that intake supports.
 *
 * The obvious worry — that a strict product gate empties the Top-N when a
 * French product string meets an English supplier description — is handled
 * by the design rather than by loosening the gate: an empty relevant set
 * fails store-first, which sends the request to live research, and the agent
 * writes its descriptions in the buyer's own language. The system corrects
 * itself instead of showing junk.
 */
export function isRelevant(breakdown: ScoreBreakdown): boolean {
  if (breakdown.checkableCount === 0) return true;
  if (breakdown.primaryMatched !== null) return breakdown.primaryMatched;
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
  const request = await db.query.request.findFirst({
    where: eq(schema.request.id, requestId),
    columns: { countryCodes: true },
  });
  const candidates =
    options.candidates ??
    (await eligibleCandidates(
      await resolveScope(organizationId, request?.countryCodes ?? null),
      // Criteria feed the big-store SQL prefilter (C2b).
      criteria.map((c) => c.value),
    ));
  if (candidates.length === 0) {
    if (options.recordEvent !== false) {
      await recordEvent(requestId, organizationId, "matches.created", { count: 0, analyzed: 0 });
    }
    return 0;
  }

  // The weights are the request's KPI profile, and the ranking records which
  // spec and which profile it was made against (V19). `ensureSpec` writes a
  // version only if the request changed since the last one — and version 1
  // for a request that reaches the ranking without any (launched before
  // specifications existed, or seeded).
  const { ensureSpec } = await import("@/server/spec");
  const ensured = await ensureSpec(requestId);
  const weights = ensured.weights.kpi1;

  const ranked = candidates
    .map((candidate) => ({ candidate, breakdown: scoreSupplier(candidate, criteria, weights) }))
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
        descriptionEn: c.descriptionEn,
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

  // The addresses research read off these suppliers' own pages become
  // contacts now — the first moment a supplier row exists to hang them from
  // (V02). Opportunistic, so a failure here must never cost the buyer their
  // ranking: an uncaught throw in this function is how request 3026
  // crash-looped for 90 minutes.
  try {
    await syncResearchedContacts([...supplierIds.values()]);
  } catch (error) {
    console.error(`matching: contact sync failed for ${requestId}:`, error);
  }

  await db.delete(schema.match).where(eq(schema.match.requestId, requestId));
  // An empty Top-N is a legitimate outcome, not an error: the gate presents
  // fewer than N rather than padding, and it may present none. Drizzle throws
  // on an empty VALUES, which is how prod request 3026 crash-looped in
  // `searching` for 90 minutes (2026-10-11) — the sweep re-adopted it every
  // 60 s and the same insert threw every time. Writing no rows is the answer.
  if (placed.length > 0) {
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
        specVersion: ensured.specVersion,
        profileVersion: ensured.profileVersion,
      })),
    );
  }

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
