// Tier ladder derivation (ADR-001 §4) — the trust tier is DERIVED from
// evidence, never set; these fixtures pin the ladder's semantics.

import { describe, expect, it } from "vitest";
import { nameSlug } from "./supplier-key";
import { deriveTier, deriveVerificationStatus, type EvidenceLite } from "./verification";

const passed = (check: EvidenceLite["check"]): EvidenceLite => ({ check, status: "passed" });
const failed = (check: EvidenceLite["check"]): EvidenceLite => ({ check, status: "failed" });
const maybe = (check: EvidenceLite["check"]): EvidenceLite => ({ check, status: "inconclusive" });

describe("deriveTier", () => {
  it("tier 0 with no evidence", () => {
    expect(deriveTier([])).toEqual({ tier: 0, sanctionsHit: false });
  });

  it("tier 1 = existence + sanctions clear + identity not failed", () => {
    expect(
      deriveTier([passed("existence"), passed("sanctions"), passed("digital_identity")]),
    ).toEqual({ tier: 1, sanctionsHit: false });
    // Inconclusive identity (no website) does not block tier 1.
    expect(
      deriveTier([passed("existence"), passed("sanctions"), maybe("digital_identity")]),
    ).toEqual({ tier: 1, sanctionsHit: false });
    // A dead website does.
    expect(
      deriveTier([passed("existence"), passed("sanctions"), failed("digital_identity")]),
    ).toEqual({ tier: 0, sanctionsHit: false });
    // Existence inconclusive (country not covered) is not tier 1.
    expect(
      deriveTier([maybe("existence"), passed("sanctions"), passed("digital_identity")]),
    ).toEqual({ tier: 0, sanctionsHit: false });
  });

  it("tier 2 = tier 1 + export history or verified certification", () => {
    const base = [passed("existence"), passed("sanctions"), passed("digital_identity")];
    expect(deriveTier([...base, passed("export_record")]).tier).toBe(2);
    expect(deriveTier([...base, passed("certification")]).tier).toBe(2);
    // Capability evidence without the tier-1 floor stays tier 0.
    expect(deriveTier([passed("export_record")]).tier).toBe(0);
  });

  it("tier 3 = human review, regardless of the automated checks", () => {
    expect(deriveTier([passed("human_review")]).tier).toBe(3);
    expect(deriveTier([passed("human_review"), failed("digital_identity")]).tier).toBe(3);
  });

  it("a sanctions hit dominates everything, even a human review", () => {
    expect(deriveTier([failed("sanctions"), passed("human_review"), passed("existence")])).toEqual({
      tier: 0,
      sanctionsHit: true,
    });
  });
});

describe("deriveVerificationStatus (legacy-column projection)", () => {
  it("maps tiers onto the scorer's statuses", () => {
    expect(deriveVerificationStatus([])).toBe("unverified");
    expect(
      deriveVerificationStatus([
        passed("existence"),
        passed("sanctions"),
        passed("digital_identity"),
      ]),
    ).toBe("pending");
    expect(deriveVerificationStatus([passed("human_review")])).toBe("verified");
    expect(deriveVerificationStatus([failed("sanctions")])).toBe("rejected");
  });
});

describe("nameSlug (sanctions screening column)", () => {
  it("folds case, accents, punctuation and legal suffixes", () => {
    expect(nameSlug("Banco Nacional de Cuba S.A.")).toBe(nameSlug("BANCO NACIONAL DE CUBA"));
    expect(nameSlug("Aérocaribbean Airlines Ltd")).toBe("aerocaribbeanairlines");
  });

  it("never collapses to null when only legal words remain", () => {
    // Both tokens are legal suffixes — the fallback keeps them all rather
    // than producing an empty (colliding) slug.
    expect(nameSlug("Industries SA")).toBe("industriessa");
    expect(nameSlug("")).toBeNull();
  });
});
