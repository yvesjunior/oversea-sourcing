// Trust-tier derivation (ADR-001 §4 = E10) — pure and client-safe.
//
// The tier is DERIVED from evidence rows, never set by hand; the legacy
// `supplier.verification_status` becomes a projection of the tier so the
// existing scorer weights (+12 verified · +5 pending · −25 rejected) and the
// existing UI badge keep working unchanged. The single writer of that column
// is src/server/verification.ts — nothing else may set it (this kills the
// "any code can set any status" debt by construction).

import type { VerificationCheck, VerificationOutcome, VerificationStatus } from "@/database/schema";

export type EvidenceLite = { check: VerificationCheck; status: VerificationOutcome };

/** How long each check's evidence stays fresh before a re-run is due. */
export const CHECK_TTL_DAYS: Record<VerificationCheck, number> = {
  existence: 180, // registry stores refresh ~6-monthly (ADR-001)
  digital_identity: 30,
  sanctions: 7, // OFAC updates continuously; the local list refreshes weekly
  export_record: 90,
  certification: 180,
  human_review: 365 * 5, // a staff decision does not silently expire
};

/** The checks the battery can actually run today (free, no external spend).
 *  export_record joins with the customs-us source; certification with a cert
 *  registry route; human_review is a staff action, never auto-run. */
export const AUTO_CHECKS = [
  "existence",
  "digital_identity",
  "sanctions",
] as const satisfies readonly VerificationCheck[];
export type AutoCheck = (typeof AUTO_CHECKS)[number];

export type TrustTier = 0 | 1 | 2 | 3;

/**
 * Tier ladder (ADR-001 §4):
 *   0 unverified   — checks failed or inconclusive
 *   1 existence    — registry-attested + identity coherent + sanctions clear
 *   2 capability   — tier 1 + export history or verified certification
 *   3 Vérifié OSI  — human review (and later: answered an OSI outreach)
 * A sanctions HIT dominates everything — the candidate is flagged, not tiered.
 */
export function deriveTier(evidence: EvidenceLite[]): { tier: TrustTier; sanctionsHit: boolean } {
  const by = new Map(evidence.map((row) => [row.check, row.status]));

  if (by.get("sanctions") === "failed") return { tier: 0, sanctionsHit: true };
  if (by.get("human_review") === "passed") return { tier: 3, sanctionsHit: false };

  const tier1 =
    by.get("existence") === "passed" &&
    by.get("sanctions") === "passed" &&
    by.get("digital_identity") !== "failed";
  if (!tier1) return { tier: 0, sanctionsHit: false };

  const tier2 = by.get("export_record") === "passed" || by.get("certification") === "passed";
  return { tier: tier2 ? 2 : 1, sanctionsHit: false };
}

/** Projection onto the legacy column the scorer and UI already consume.
 *  A sanctions hit maps to `rejected` (−25 in the scorer, staff reviews it —
 *  the slug-equality screening is conservative, but a hit must never rank
 *  quietly). Tiers 1–2 map to `pending` (+5): evidenced but not OSI-vouched. */
export function deriveVerificationStatus(evidence: EvidenceLite[]): VerificationStatus {
  const { tier, sanctionsHit } = deriveTier(evidence);
  if (sanctionsHit) return "rejected";
  if (tier === 3) return "verified";
  if (tier >= 1) return "pending";
  return "unverified";
}
