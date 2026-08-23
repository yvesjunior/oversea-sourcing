// Unit tests for the criteria-aware scorer (E5 v1) — including the two A8
// field defects fixed 2026-08-22: numeric tokens must match ("ISO 9001" must
// not satisfy "ISO 8573-1"), and morphological aliases ("inox" ↔ "inoxydable").

import { describe, expect, it } from "vitest";
import { scoreSupplier } from "@/server/matching";
import type * as schema from "@/database/schema";

type SupplierRow = typeof schema.supplier.$inferSelect;
type CriterionRow = typeof schema.requestCriterion.$inferSelect;

function makeSupplier(overrides: Partial<SupplierRow> = {}): SupplierRow {
  return {
    id: "sup-1",
    name: "Acme Valves",
    descriptor: null,
    countryCode: "FR",
    website: null,
    description: null,
    provenance: "ai_researched",
    verificationStatus: "unverified",
    confidenceScore: 50,
    riskLevel: "medium",
    sourceRef: null,
    discoveredByRequestId: null,
    dedupKey: "acme valves|FR",
    lastResearchedAt: new Date(),
    bannedAt: null,
    bannedBy: null,
    bannedReason: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function makeCriterion(overrides: Partial<CriterionRow> = {}): CriterionRow {
  return {
    id: "crit-1",
    requestId: "3000",
    category: "certification",
    label: "Certifications",
    value: "ISO 9001",
    unit: null,
    required: false,
    source: "ai",
    position: 0,
    createdAt: new Date(),
    ...overrides,
  };
}

function outcome(supplier: SupplierRow, criterion: CriterionRow) {
  return scoreSupplier(supplier, [criterion]).criteria[0]?.outcome;
}

describe("criterion matching", () => {
  it("matches a certification when the number agrees", () => {
    const supplier = makeSupplier({ description: "Fabricant certifié ISO 9001" });
    expect(outcome(supplier, makeCriterion({ value: "ISO 9001" }))).toBe("matched");
  });

  it("refuses a certification whose number differs (ISO 9001 ≠ ISO 8573-1)", () => {
    const supplier = makeSupplier({ description: "Fabricant certifié ISO 9001" });
    expect(outcome(supplier, makeCriterion({ value: "ISO 8573-1" }))).toBe("missed");
  });

  it("matches 'inox' against 'inoxydable' (alias, both directions)", () => {
    const supplier = makeSupplier({ description: "Vannes en acier inoxydable 316L" });
    expect(outcome(supplier, makeCriterion({ category: "material", value: "inox 316L" }))).toBe(
      "matched",
    );

    const short = makeSupplier({ description: "Vannes en inox 316L" });
    expect(
      outcome(short, makeCriterion({ category: "material", value: "acier inoxydable 316L" })),
    ).toBe("matched");
  });

  it("requires the numeric grade to be present (316L)", () => {
    const supplier = makeSupplier({ description: "Vannes en acier inoxydable 304" });
    expect(
      outcome(supplier, makeCriterion({ category: "material", value: "acier inoxydable 316L" })),
    ).toBe("missed");
  });

  it("records numeric-spec categories as unverifiable, never as misses", () => {
    const supplier = makeSupplier({ description: "Fabricant de pompes" });
    expect(
      outcome(supplier, makeCriterion({ category: "pressure", value: "16", unit: "bar" })),
    ).toBe("unverifiable");
  });
});

describe("score composition", () => {
  it("pays the verification bonus and charges the risk penalty", () => {
    const criteria = [makeCriterion({ value: "ISO 9001" })];
    const base = makeSupplier({ description: "ISO 9001", confidenceScore: 50 });
    const verified = makeSupplier({
      description: "ISO 9001",
      confidenceScore: 50,
      verificationStatus: "verified",
      riskLevel: "high",
    });
    const baseScore = scoreSupplier(base, criteria).total;
    const verifiedScore = scoreSupplier(verified, criteria).total;
    // +12 verified − (10 high − 4 medium) risk = +6 over the baseline.
    expect(verifiedScore - baseScore).toBe(6);
  });

  it("weighs a required criterion double", () => {
    const supplier = makeSupplier({ description: "acier inoxydable" });
    const criteria = [
      makeCriterion({ id: "c1", category: "material", value: "acier inoxydable", required: true }),
      makeCriterion({ id: "c2", value: "ISO 8573-1" }),
    ];
    const breakdown = scoreSupplier(supplier, criteria);
    // required match (×2) over total weight 3 → coverage 2/3 → 37 of 55.
    expect(breakdown.criteriaPoints).toBe(37);
  });
});
