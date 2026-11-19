// KPIProfile v1 (Phase V · V19) — the weights both scorers use, as data.
//
// Before this file the weights were constants inside each scorer: KPI #1's in
// `src/server/matching.ts`, KPI #2's in `src/lib/kpi2.ts`. A request could
// not have its own, nothing recorded which ones produced a ranking, and the
// buyer had no way to say "the certification matters more than the price".
//
// A profile is one request's weights, versioned (`kpi_profile`). This file is
// its pure half: what a profile holds, and the DEFAULT one.
//
// ── The default changes no ranking ──────────────────────────────────────────
//
// `defaultProfile` is today's constants, moved here unchanged. The one part
// that comes "from the criteria the buyer marked required" is the part that
// already did: a required criterion counts double in KPI #1's coverage. It is
// now written out per criterion (`criterionWeights`), which is what makes it
// adjustable later — the buyer validates and edits the profile with the
// cahier des charges (decision D8, task V20). Until a buyer does, every
// request ranks exactly as it did before profiles existed, and
// `kpi-profile.test.ts` pins that.

import type { RiskLevel, VerificationStatus } from "@/database/schema";
import { KPI2_DEFAULT_WEIGHTS, KPI2_FACTORS, type Kpi2Weights } from "@/lib/kpi2";

export const KPI_PROFILE_SOURCES = ["default", "buyer"] as const;
/** `default` = proposed by the platform from the criteria; `buyer` = adjusted
 *  and validated by the buyer (V20 — nothing writes it yet). */
export type KpiProfileSource = (typeof KPI_PROFILE_SOURCES)[number];

/** What KPI #1 (`scoreSupplier`) weighs. Positives sum to 97, which leaves
 *  98 as a ceiling no supplier reaches — kept from the scorer's first days. */
export type Kpi1Weights = {
  /** Points every supplier starts with. */
  base: number;
  /** Points available for covering the criteria. */
  criteria: number;
  /** Points available for the supplier record's confidence. */
  confidence: number;
  verification: Record<VerificationStatus, number>;
  /** Points REMOVED, by risk level. */
  risk: Record<RiskLevel, number>;
  /** What a partial match on the product row earns, as a share of a full one. */
  partialCredit: number;
  /** How much each criterion counts in the coverage, by criterion id. */
  criterionWeights: Record<string, number>;
  /** For a criterion the profile does not name — one added after the profile
   *  was built, before the next version exists. The same rule the default
   *  applies, so such a criterion is weighed as it always was. */
  requiredWeight: number;
  optionalWeight: number;
};

export type KpiProfileWeights = { kpi1: Kpi1Weights; kpi2: Kpi2Weights };

/** A required criterion counts double — missing one is a real disqualifier. */
export const REQUIRED_WEIGHT = 2;
export const OPTIONAL_WEIGHT = 1;

/** KPI #1's weights with no criterion named: every one falls back to
 *  required / optional. What the scorer uses when it is handed no profile. */
export const KPI1_BASE_WEIGHTS: Kpi1Weights = {
  base: 10,
  criteria: 55,
  confidence: 20,
  verification: { verified: 12, pending: 5, unverified: 0, rejected: -25 },
  risk: { low: 0, medium: 4, high: 10 },
  partialCredit: 0.5,
  criterionWeights: {},
  requiredWeight: REQUIRED_WEIGHT,
  optionalWeight: OPTIONAL_WEIGHT,
};

/** How much one criterion counts under a profile. */
export function criterionWeight(
  weights: Kpi1Weights,
  criterion: { id: string; required: boolean },
): number {
  return (
    weights.criterionWeights[criterion.id] ??
    (criterion.required ? weights.requiredWeight : weights.optionalWeight)
  );
}

/**
 * The profile the platform proposes for a request, from its criteria.
 *
 * Each criterion gets its weight in the coverage — 2 when the buyer marked it
 * required, 1 otherwise. Everything else is the platform's own, the same for
 * every request.
 */
export function defaultProfile(
  criteria: ReadonlyArray<{ id: string; required: boolean }>,
): KpiProfileWeights {
  const criterionWeights: Record<string, number> = {};
  for (const criterion of criteria) {
    criterionWeights[criterion.id] = criterion.required ? REQUIRED_WEIGHT : OPTIONAL_WEIGHT;
  }
  return {
    kpi1: { ...KPI1_BASE_WEIGHTS, criterionWeights },
    kpi2: { ...KPI2_DEFAULT_WEIGHTS },
  };
}

/**
 * A stable text form of a profile: two profiles with the same fingerprint
 * rank identically. Keys are written in a fixed order, so a jsonb round-trip
 * (which does not keep insertion order) cannot make equal weights look new.
 */
export function profileFingerprint(weights: KpiProfileWeights): string {
  const { kpi1, kpi2 } = weights;
  return JSON.stringify([
    kpi1.base,
    kpi1.criteria,
    kpi1.confidence,
    [
      kpi1.verification.verified,
      kpi1.verification.pending,
      kpi1.verification.unverified,
      kpi1.verification.rejected,
    ],
    [kpi1.risk.low, kpi1.risk.medium, kpi1.risk.high],
    kpi1.partialCredit,
    kpi1.requiredWeight,
    kpi1.optionalWeight,
    Object.keys(kpi1.criterionWeights)
      .sort()
      .map((id) => [id, kpi1.criterionWeights[id]]),
    KPI2_FACTORS.map((factor) => kpi2[factor]),
  ]);
}
