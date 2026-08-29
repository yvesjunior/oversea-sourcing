// Unit tests for the criteria-aware scorer (E5 v1) — including the two A8
// field defects fixed 2026-08-22: numeric tokens must match ("ISO 9001" must
// not satisfy "ISO 8573-1"), and morphological aliases ("inox" ↔ "inoxydable").

import { describe, expect, it } from "vitest";
import { isRelevant, scoreSupplier } from "@/server/matching";
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
    descriptionEn: null,
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
    isPrimary: false,
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

// ── The relevance gate (fix 2026-08-29) ─────────────────────────────────────
// Reproduces the shape that produced the defect in dev request #2540: an
// electronics request whose whole Top-5 was pump companies at "41 %".

describe("relevance is a gate, not a component", () => {
  const electronics: CriterionRow[] = [
    makeCriterion({
      id: "e1",
      category: "other",
      label: "Besoin",
      value: "composants électroniques",
      required: true,
    }),
    makeCriterion({
      id: "e2",
      category: "certification",
      label: "Certifications",
      value: "RoHS",
      required: true,
    }),
  ];

  it("a verified, confident supplier matching NOTHING is ineligible", () => {
    // This is the exact #2540 shape — and note the score it still earns.
    const pumpCompany = makeSupplier({
      name: "ITALPOMPE",
      description: "Fabricant de pompes centrifuges industrielles",
      verificationStatus: "verified",
      confidenceScore: 70,
      riskLevel: "low",
    });
    const breakdown = scoreSupplier(pumpCompany, electronics);
    expect(breakdown.matchedCount).toBe(0);
    // The quality terms alone still put it in the forties — which is exactly
    // why the fix had to be a gate and not a re-weighting.
    expect(breakdown.total).toBeGreaterThanOrEqual(35);
    expect(isRelevant(breakdown)).toBe(false);
  });

  it("one matched criterion is enough to be judged on quality", () => {
    const real = makeSupplier({
      name: "Nordic Electronics",
      description: "Assemblage de composants électroniques pour l'industrie",
    });
    const breakdown = scoreSupplier(real, electronics);
    expect(breakdown.matchedCount).toBeGreaterThan(0);
    expect(isRelevant(breakdown)).toBe(true);
  });

  it("an unjudgeable request keeps every candidate eligible", () => {
    // Nothing checkable: all criteria are numeric specs. Relevance cannot be
    // decided, so the dossier still ranks on quality rather than showing
    // nothing. countQualifyingCandidates handles this case separately — such
    // a request must never be answered from the store.
    const numericOnly: CriterionRow[] = [
      makeCriterion({ id: "n1", category: "pressure", label: "Pression", value: "16 bar" }),
      makeCriterion({ id: "n2", category: "quantity", label: "Quantité", value: "500" }),
    ];
    const breakdown = scoreSupplier(makeSupplier(), numericOnly);
    expect(breakdown.checkableCount).toBe(0);
    expect(isRelevant(breakdown)).toBe(true);
  });
});

// ── The product is the gate (owner 2026-08-29) ──────────────────────────────
// "Certification is just a supplementary criterion, product is the first."

describe("the product criterion decides, not any criterion", () => {
  const need: CriterionRow[] = [
    makeCriterion({
      id: "p1",
      category: "other",
      label: "Besoin",
      value: "cartes électroniques",
      required: true,
      isPrimary: true,
    }),
    makeCriterion({
      id: "p2",
      category: "certification",
      label: "Certifications",
      value: "ISO 9001",
      required: true,
    }),
  ];

  it("a near-universal certification alone is NOT a match", () => {
    // This is the loophole the looser gate left open: ISO 9001 says nothing
    // about whether they make the product.
    const anyone = makeSupplier({
      name: "Pompes Générales",
      description: "Fabricant de pompes centrifuges, certifié ISO 9001",
    });
    const breakdown = scoreSupplier(anyone, need);
    expect(breakdown.matchedCount).toBe(1); // the cert DID match…
    expect(breakdown.primaryMatched).toBe(false); // …but not the product
    expect(isRelevant(breakdown)).toBe(false);
  });

  it("the product matching is enough, with or without the certification", () => {
    const real = makeSupplier({
      name: "PCB Nord",
      description: "Assemblage de cartes électroniques pour l'industrie",
    });
    const breakdown = scoreSupplier(real, need);
    expect(breakdown.primaryMatched).toBe(true);
    expect(isRelevant(breakdown)).toBe(true);
  });

  it("falls back to any-criterion when the request names no product", () => {
    // Legacy free-text intake produces no primary row; the looser rule is the
    // best that intake can support.
    const legacy: CriterionRow[] = [
      makeCriterion({ id: "l1", category: "certification", value: "ISO 9001", required: true }),
    ];
    const breakdown = scoreSupplier(
      makeSupplier({ description: "Atelier certifié ISO 9001" }),
      legacy,
    );
    expect(breakdown.primaryMatched).toBeNull();
    expect(isRelevant(breakdown)).toBe(true);
  });
});

// ── The pool answers in either language (2026-08-29) ────────────────────────
// Descriptions are written in the language of the request that discovered the
// company. Without the English text beside it, a pool built by French buyers
// could not answer an English one: the product gate would reject every
// supplier and the buyer would pay to re-discover companies we already knew.

describe("matching reads both languages", () => {
  const englishNeed: CriterionRow[] = [
    makeCriterion({
      id: "b1",
      category: "other",
      label: "Need",
      value: "rubber conveyor belts",
      required: true,
      isPrimary: true,
    }),
  ];

  it("an English request matches a supplier discovered in French", () => {
    const found_by_a_french_buyer = makeSupplier({
      name: "Hanbelt Rubber Co.",
      description: "Producteur de courroies transporteuses en caoutchouc",
      descriptionEn: "Manufacturer of rubber conveyor belts",
    });
    const breakdown = scoreSupplier(found_by_a_french_buyer, englishNeed);
    expect(breakdown.primaryMatched).toBe(true);
    expect(isRelevant(breakdown)).toBe(true);
  });

  it("without the English text that same supplier is invisible", () => {
    // The regression this guards against — and the reason the extra field
    // earns its place.
    const french_only = makeSupplier({
      name: "Hanbelt Rubber Co.",
      description: "Producteur de courroies transporteuses en caoutchouc",
      descriptionEn: null,
    });
    expect(isRelevant(scoreSupplier(french_only, englishNeed))).toBe(false);
  });

  it("the French request still matches the French text", () => {
    const frenchNeed: CriterionRow[] = [
      makeCriterion({
        id: "b2",
        category: "other",
        label: "Besoin",
        value: "courroies transporteuses",
        required: true,
        isPrimary: true,
      }),
    ];
    const bilingual = makeSupplier({
      description: "Producteur de courroies transporteuses en caoutchouc",
      descriptionEn: "Manufacturer of rubber conveyor belts",
    });
    expect(isRelevant(scoreSupplier(bilingual, frenchNeed))).toBe(true);
  });
});
