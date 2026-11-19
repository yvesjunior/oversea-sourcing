import { describe, expect, it } from "vitest";
import type * as schema from "@/database/schema";
import {
  criterionWeight,
  defaultProfile,
  KPI1_BASE_WEIGHTS,
  profileFingerprint,
} from "@/lib/kpi-profile";
import { KPI2_DEFAULT_WEIGHTS } from "@/lib/kpi2";
import { scoreSupplier } from "@/server/matching";

type CriterionRow = typeof schema.requestCriterion.$inferSelect;

function criterion(overrides: Partial<CriterionRow>): CriterionRow {
  return {
    id: "c",
    requestId: "3000",
    category: "certification",
    label: "Certifications",
    value: "ISO 9001",
    unit: null,
    required: false,
    source: "ai",
    valueEn: null,
    isPrimary: false,
    position: 0,
    createdAt: new Date(0),
    ...overrides,
  };
}

const criteria: CriterionRow[] = [
  criterion({
    id: "c1",
    category: "other",
    label: "Besoin",
    value: "vannes papillon",
    required: true,
    isPrimary: true,
  }),
  criterion({
    id: "c2",
    category: "material",
    label: "Matériau",
    value: "inox 316L",
    required: true,
  }),
  criterion({ id: "c3", category: "certification", value: "ISO 9001" }),
  criterion({ id: "c4", category: "certification", value: "ATEX" }),
  criterion({ id: "c5", category: "pressure", label: "Pression", value: "16", unit: "bar" }),
];

const suppliers = [
  {
    description: "Vannes papillon en inox 316L, certifiées ISO 9001",
    verificationStatus: "verified",
    riskLevel: "low",
    confidenceScore: 80,
  },
  {
    description: "Vannes papillon en acier, ATEX",
    verificationStatus: "unverified",
    riskLevel: "medium",
    confidenceScore: 55,
  },
  {
    description: "Robinetterie inox 316L ISO 9001 ATEX",
    verificationStatus: "pending",
    riskLevel: "high",
    confidenceScore: 30,
  },
  {
    description: "Pompes centrifuges",
    verificationStatus: "rejected",
    riskLevel: "low",
    confidenceScore: 90,
  },
].map((s) => ({
  name: "Fournisseur",
  descriptor: null,
  ...s,
})) as Parameters<typeof scoreSupplier>[0][];

describe("defaultProfile", () => {
  it("weighs a required criterion double and names every criterion", () => {
    const { kpi1 } = defaultProfile(criteria);
    expect(kpi1.criterionWeights).toEqual({ c1: 2, c2: 2, c3: 1, c4: 1, c5: 1 });
  });

  it("carries the platform's own numbers for everything else", () => {
    const profile = defaultProfile(criteria);
    expect({ ...profile.kpi1, criterionWeights: {} }).toEqual(KPI1_BASE_WEIGHTS);
    expect(profile.kpi2).toEqual(KPI2_DEFAULT_WEIGHTS);
  });

  it("does not hand out the shared objects", () => {
    const profile = defaultProfile(criteria);
    profile.kpi2.price = 1;
    profile.kpi1.criterionWeights["x"] = 9;
    expect(KPI2_DEFAULT_WEIGHTS.price).toBe(40);
    expect(KPI1_BASE_WEIGHTS.criterionWeights).toEqual({});
  });

  // The point of building the profile this way: until a buyer adjusts one,
  // no ranking moves. Same suppliers, same criteria — with the default
  // profile and with no profile at all.
  it("ranks exactly as the scorer did before profiles existed", () => {
    const { kpi1 } = defaultProfile(criteria);
    for (const supplier of suppliers) {
      expect(scoreSupplier(supplier, criteria, kpi1)).toEqual(scoreSupplier(supplier, criteria));
    }
  });
});

describe("criterionWeight", () => {
  it("reads the profile, and falls back to required / optional for a criterion it does not name", () => {
    const { kpi1 } = defaultProfile(criteria);
    expect(criterionWeight(kpi1, { id: "c1", required: true })).toBe(2);
    expect(criterionWeight(kpi1, { id: "new", required: true })).toBe(2);
    expect(criterionWeight(kpi1, { id: "new", required: false })).toBe(1);
  });

  it("lets a profile say one criterion matters more — and the ranking follows", () => {
    const { kpi1 } = defaultProfile(criteria);
    const atexFirst = { ...kpi1, criterionWeights: { ...kpi1.criterionWeights, c4: 10 } };
    const [withIso, withAtex] = suppliers;
    // By default the supplier covering more of the criteria is ahead…
    expect(scoreSupplier(withIso!, criteria, kpi1).criteriaPoints).toBeGreaterThan(
      scoreSupplier(withAtex!, criteria, kpi1).criteriaPoints,
    );
    // …and once ATEX weighs ten, the one that has it is.
    expect(scoreSupplier(withAtex!, criteria, atexFirst).criteriaPoints).toBeGreaterThan(
      scoreSupplier(withIso!, criteria, atexFirst).criteriaPoints,
    );
  });
});

describe("profileFingerprint", () => {
  it("is the same for equal weights whatever order the keys came back in", () => {
    const a = defaultProfile(criteria);
    const b = defaultProfile([...criteria].reverse());
    expect(profileFingerprint(a)).toBe(profileFingerprint(b));
    // A jsonb round-trip does not keep key order either.
    const roundTripped = JSON.parse(JSON.stringify(a)) as typeof a;
    expect(profileFingerprint(roundTripped)).toBe(profileFingerprint(a));
  });

  it("changes when a criterion becomes required, appears, or a weight moves", () => {
    const base = profileFingerprint(defaultProfile(criteria));
    const required = criteria.map((c) => (c.id === "c3" ? { ...c, required: true } : c));
    expect(profileFingerprint(defaultProfile(required))).not.toBe(base);
    expect(profileFingerprint(defaultProfile([...criteria, criterion({ id: "c6" })]))).not.toBe(
      base,
    );
    const moved = defaultProfile(criteria);
    moved.kpi2.price = 30;
    expect(profileFingerprint(moved)).not.toBe(base);
  });
});
