// Unit tests for the pure half of the store-first decision (A7) — the
// warm / thin / stale / low-confidence / low-match matrix — and the request
// fingerprint. DB-bound behavior (ban stickiness via the dedup upsert, the
// quota advisory lock) is verified against the dev stack, not here.

import { describe, expect, it } from "vitest";
import { countQualifyingCandidates, requestFingerprint } from "@/server/research";
import type * as schema from "@/database/schema";
import type { MatchCandidate } from "@/server/sources/scope";

type CriterionRow = typeof schema.requestCriterion.$inferSelect;

const NOW = new Date("2026-08-22T12:00:00Z");
const DAYS = 24 * 60 * 60 * 1000;

function makeCandidate(overrides: Partial<MatchCandidate> = {}): MatchCandidate {
  return {
    supplierId: null,
    dedupKey: `vannes industrielles sa|FR#${Math.random().toString(36).slice(2)}`,
    name: "Vannes Industrielles SA",
    descriptor: null,
    countryCode: "FR",
    website: null,
    sourceUrl: null,
    description: "Fabricant de vannes papillon en acier inoxydable 316L, certifié ISO 9001",
    descriptionEn: null,
    verificationStatus: "unverified",
    confidenceScore: 60,
    riskLevel: "medium",
    lastSeenAt: new Date(NOW.getTime() - 5 * DAYS),
    sourceType: "global_web",
    recordIds: [],
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
    isPrimary: false,
    position: 0,
    createdAt: NOW,
  },
];

describe("countQualifyingCandidates — the store-first matrix", () => {
  it("counts a fresh, confident, matching supplier (warm store)", () => {
    expect(countQualifyingCandidates([makeCandidate()], CRITERIA, NOW)).toBe(1);
  });

  it("excludes stale entries (older than the freshness window)", () => {
    const stale = makeCandidate({ lastSeenAt: new Date(NOW.getTime() - 120 * DAYS) });
    expect(countQualifyingCandidates([stale], CRITERIA, NOW)).toBe(0);
  });

  it("excludes never-seen entries", () => {
    expect(countQualifyingCandidates([makeCandidate({ lastSeenAt: null })], CRITERIA, NOW)).toBe(0);
  });

  it("excludes low-confidence entries", () => {
    expect(countQualifyingCandidates([makeCandidate({ confidenceScore: 10 })], CRITERIA, NOW)).toBe(
      0,
    );
  });

  it("excludes low-match entries (wrong product entirely)", () => {
    const wrong = makeCandidate({
      name: "Textile Mills Ltd",
      description: "Cotton fabrics and garments",
      confidenceScore: 35,
    });
    expect(countQualifyingCandidates([wrong], CRITERIA, NOW)).toBe(0);
  });

  it("a thin store stays below the sufficiency bar", () => {
    const pool = [makeCandidate(), makeCandidate(), makeCandidate()];
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

// ── The gate closes the store-hit hole (fix 2026-08-29) ─────────────────────

describe("store-first cannot be satisfied by irrelevant suppliers", () => {
  const electronics: CriterionRow[] = [
    {
      id: "e1",
      requestId: "3000",
      category: "other",
      label: "Besoin",
      value: "composants électroniques",
      unit: null,
      required: true,
      source: "user",
      isPrimary: true,
      position: 0,
      createdAt: NOW,
    },
  ];

  it("a pool of verified pump companies does not answer an electronics request", () => {
    // Before the fix these scored ~41, cleared STORE_MIN_SCORE (40), and the
    // request was served from the pool without ever searching the web.
    const pool = Array.from({ length: 20 }, (_, i) =>
      makeCandidate({
        dedupKey: `pompes ${i}|FR`,
        name: `Pompes Industrielles ${i}`,
        description: "Fabricant de pompes centrifuges",
        verificationStatus: "verified",
        confidenceScore: 70,
      }),
    );
    expect(countQualifyingCandidates(pool, electronics, NOW)).toBe(0);
  });

  it("relevant suppliers still qualify normally", () => {
    const pool = Array.from({ length: 20 }, (_, i) =>
      makeCandidate({
        dedupKey: `electro ${i}|FR`,
        name: `Electro Composants ${i}`,
        description: "Distribution de composants électroniques",
        verificationStatus: "verified",
        confidenceScore: 70,
      }),
    );
    expect(countQualifyingCandidates(pool, electronics, NOW)).toBe(20);
  });

  it("a request with nothing checkable always goes to the web", () => {
    // Every candidate would otherwise coast on the 0.5 coverage midpoint and
    // the pool would look permanently sufficient.
    const numericOnly: CriterionRow[] = [
      {
        id: "n1",
        requestId: "3000",
        category: "pressure",
        label: "Pression",
        value: "16 bar",
        unit: "bar",
        required: true,
        source: "ai",
        isPrimary: false,
        position: 0,
        createdAt: NOW,
      },
    ];
    const pool = Array.from({ length: 20 }, () => makeCandidate({ confidenceScore: 80 }));
    expect(countQualifyingCandidates(pool, numericOnly, NOW)).toBe(0);
  });
});
