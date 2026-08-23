// Unit tests for the pure half of the store-first decision (A7) — the
// warm / thin / stale / low-confidence / low-match matrix — and the request
// fingerprint. DB-bound behavior (ban stickiness via the dedup upsert, the
// quota advisory lock) is verified against the dev stack, not here.

import { describe, expect, it } from "vitest";
import { countQualifyingCandidates, requestFingerprint } from "@/server/research";
import type * as schema from "@/database/schema";

type SupplierRow = typeof schema.supplier.$inferSelect;
type CriterionRow = typeof schema.requestCriterion.$inferSelect;

const NOW = new Date("2026-08-22T12:00:00Z");
const DAYS = 24 * 60 * 60 * 1000;

function makeSupplier(overrides: Partial<SupplierRow> = {}): SupplierRow {
  return {
    id: Math.random().toString(36).slice(2),
    name: "Vannes Industrielles SA",
    descriptor: null,
    countryCode: "FR",
    website: null,
    description: "Fabricant de vannes papillon en acier inoxydable 316L, certifié ISO 9001",
    provenance: "ai_researched",
    verificationStatus: "unverified",
    confidenceScore: 60,
    riskLevel: "medium",
    sourceRef: null,
    discoveredByRequestId: null,
    dedupKey: null,
    lastResearchedAt: new Date(NOW.getTime() - 5 * DAYS),
    bannedAt: null,
    bannedBy: null,
    bannedReason: null,
    createdAt: new Date(NOW.getTime() - 5 * DAYS),
    ...overrides,
  };
}

const CRITERIA: CriterionRow[] = [
  {
    id: "c1",
    requestId: "3000",
    category: "material",
    label: "Matériau",
    value: "acier inoxydable 316L",
    unit: null,
    required: true,
    source: "ai",
    position: 0,
    createdAt: NOW,
  },
];

describe("countQualifyingCandidates — the store-first matrix", () => {
  it("counts a fresh, confident, matching supplier (warm store)", () => {
    expect(countQualifyingCandidates([makeSupplier()], CRITERIA, NOW)).toBe(1);
  });

  it("excludes stale entries (older than the freshness window)", () => {
    const stale = makeSupplier({ lastResearchedAt: new Date(NOW.getTime() - 120 * DAYS) });
    expect(countQualifyingCandidates([stale], CRITERIA, NOW)).toBe(0);
  });

  it("excludes never-researched entries", () => {
    expect(
      countQualifyingCandidates([makeSupplier({ lastResearchedAt: null })], CRITERIA, NOW),
    ).toBe(0);
  });

  it("excludes low-confidence entries", () => {
    expect(countQualifyingCandidates([makeSupplier({ confidenceScore: 10 })], CRITERIA, NOW)).toBe(
      0,
    );
  });

  it("excludes low-match entries (wrong product entirely)", () => {
    const wrong = makeSupplier({
      name: "Textile Mills Ltd",
      description: "Cotton fabrics and garments",
      confidenceScore: 35,
    });
    expect(countQualifyingCandidates([wrong], CRITERIA, NOW)).toBe(0);
  });

  it("a thin store stays below the sufficiency bar", () => {
    const pool = [makeSupplier(), makeSupplier(), makeSupplier()];
    expect(countQualifyingCandidates(pool, CRITERIA, NOW)).toBe(3); // < 2×Top-N
  });
});

describe("requestFingerprint", () => {
  it("is order-insensitive and case-normalized", () => {
    const a = requestFingerprint(
      [
        { category: "material", value: "Acier 316L" },
        { category: "certification", value: "ISO 9001" },
      ],
      null,
    );
    const b = requestFingerprint(
      [
        { category: "certification", value: "iso 9001" },
        { category: "material", value: "acier 316l" },
      ],
      null,
    );
    expect(a).toBe(b);
  });

  it("changes with the country scope", () => {
    const global = requestFingerprint([{ category: "material", value: "316L" }], null);
    const local = requestFingerprint([{ category: "material", value: "316L" }], ["FR", "DE"]);
    expect(global).not.toBe(local);
    expect(local.startsWith("DE,FR::")).toBe(true);
  });
});
