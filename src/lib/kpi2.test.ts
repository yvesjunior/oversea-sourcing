import { describe, expect, it } from "vitest";
import {
  KPI2_DEFAULT_WEIGHTS,
  KPI2_FACTORS,
  KPI2_VERSION,
  kpi2Fingerprint,
  rankOffers,
  readIncoterm,
  type Kpi2Offer,
} from "@/lib/kpi2";

const at = new Date("2026-11-18T12:00:00Z");

const offer = (quoteId: string, patch: Partial<Kpi2Offer> = {}): Kpi2Offer => ({
  quoteId,
  amountCents: 100_000,
  currency: "USD",
  leadTimeDays: 30,
  incoterm: "FOB",
  validUntil: "2026-12-18T12:00:00Z",
  respondedAt: "2026-11-17T09:00:00Z",
  verification: "verified",
  kpi1Score: 75,
  moq: null,
  ...patch,
});

const rank = (offers: Kpi2Offer[]) => rankOffers(offers, KPI2_DEFAULT_WEIGHTS, at);
const order = (offers: Kpi2Offer[]) => rank(offers).map((r) => r.quoteId);
const of = (results: ReturnType<typeof rank>, id: string) => {
  const found = results.find((r) => r.quoteId === id);
  if (!found) throw new Error(`no result for ${id}`);
  return found;
};

describe("the weights", () => {
  it("add up to 100 and cover every factor", () => {
    expect(KPI2_FACTORS.reduce((sum, key) => sum + KPI2_DEFAULT_WEIGHTS[key], 0)).toBe(100);
  });
});

describe("ranking", () => {
  it("returns nothing for no offers", () => {
    expect(rank([])).toEqual([]);
  });

  it("gives a lone offer rank 1", () => {
    const [only] = rank([offer("a")]);
    expect(only?.rank).toBe(1);
    expect(only?.breakdown.version).toBe(KPI2_VERSION);
  });

  it("puts the cheaper offer first, everything else equal", () => {
    expect(order([offer("dear", { amountCents: 120_000 }), offer("cheap")])).toEqual([
      "cheap",
      "dear",
    ]);
  });

  it("scores price against the best: twice the best earns half", () => {
    const results = rank([offer("a"), offer("b", { amountCents: 200_000 })]);
    expect(of(results, "a").breakdown.factors.price.points).toBe(100);
    expect(of(results, "b").breakdown.factors.price.points).toBe(50);
  });

  it("puts the faster offer first, everything else equal", () => {
    expect(
      order([offer("slow", { leadTimeDays: 60 }), offer("fast", { leadTimeDays: 20 })]),
    ).toEqual(["fast", "slow"]);
  });

  it("does not divide by zero on a same-day lead time", () => {
    const results = rank([offer("now", { leadTimeDays: 0 }), offer("later", { leadTimeDays: 10 })]);
    expect(of(results, "now").breakdown.factors.leadTime.points).toBe(100);
    expect(of(results, "later").breakdown.factors.leadTime.points).toBe(10);
  });

  it("hands out ranks 1..n with no gaps and no ties", () => {
    const results = rank([offer("a"), offer("b"), offer("c")]);
    expect(results.map((r) => r.rank)).toEqual([1, 2, 3]);
  });
});

describe("determinism", () => {
  const offers = [
    offer("b", { amountCents: 90_000 }),
    offer("a", { leadTimeDays: 12 }),
    offer("c", { verification: "pending" }),
  ];

  it("gives the same order whatever order the offers arrive in", () => {
    const forward = order(offers);
    expect(order([...offers].reverse())).toEqual(forward);
    expect(order([offers[1]!, offers[2]!, offers[0]!])).toEqual(forward);
  });

  it("breaks a perfect tie the same way every time: KPI #1, then first to answer, then id", () => {
    expect(order([offer("b"), offer("a")])).toEqual(["a", "b"]);
    expect(order([offer("a"), offer("b", { respondedAt: "2026-11-16T09:00:00Z" })])).toEqual([
      "b",
      "a",
    ]);
  });

  it("does not depend on the clock: validity is measured from `at`", () => {
    const first = rank(offers);
    const second = rank(offers);
    expect(second).toEqual(first);
  });
});

describe("money is never converted (D7)", () => {
  const mixed = [
    offer("usd", { amountCents: 500_000, currency: "USD" }),
    offer("eur", { amountCents: 100_000, currency: "EUR" }),
  ];

  it("compares price for nobody when the offers are not in one currency", () => {
    for (const result of rank(mixed)) {
      expect(result.breakdown.factors.price).toEqual({
        state: "not_comparable",
        points: null,
        weight: 0,
      });
      expect(result.breakdown.notes).toContain("mixed_currencies");
    }
  });

  it("so a price five times lower in another currency changes nothing", () => {
    const withoutPrices = rank(mixed.map((o) => ({ ...o, amountCents: null, currency: null })));
    expect(rank(mixed).map((r) => r.score)).toEqual(withoutPrices.map((r) => r.score));
  });

  it("still scores out of 100 over the factors that were compared", () => {
    const [top] = rank(mixed);
    // Identical on everything else, FOB earns 30 of 100 on incoterm.
    expect(top?.score).toBeGreaterThan(50);
    expect(top?.score).toBeLessThanOrEqual(100);
  });

  it("treats currency codes case-insensitively", () => {
    const results = rank([offer("a", { currency: "usd" }), offer("b", { currency: "USD" })]);
    expect(of(results, "a").breakdown.factors.price.state).toBe("scored");
  });

  it("does not compare a price that names no currency", () => {
    const results = rank([offer("a", { currency: null }), offer("b", { currency: null })]);
    expect(of(results, "a").breakdown.factors.price.state).toBe("not_comparable");
  });
});

describe("what was not stated", () => {
  it("drops a factor nobody stated, without penalty", () => {
    const results = rank([offer("a", { leadTimeDays: null }), offer("b", { leadTimeDays: null })]);
    expect(of(results, "a").breakdown.factors.leadTime).toEqual({
      state: "not_stated",
      points: null,
      weight: 0,
    });
    expect(of(results, "a").score).toBe(of(results, "b").score);
  });

  it("gives 0 on a factor others stated and this offer did not", () => {
    const results = rank([offer("said"), offer("silent", { leadTimeDays: null })]);
    expect(of(results, "silent").breakdown.factors.leadTime).toEqual({
      state: "missing",
      points: 0,
      weight: 20,
    });
    expect(results[0]?.quoteId).toBe("said");
  });

  it("ranks an offer with no price last on price, not first", () => {
    const results = rank([
      offer("priced", { amountCents: 900_000 }),
      offer("unpriced", { amountCents: null }),
    ]);
    expect(of(results, "unpriced").breakdown.factors.price.state).toBe("missing");
    expect(results[0]?.quoteId).toBe("priced");
  });
});

describe("incoterms", () => {
  it("reads the term out of what the supplier wrote", () => {
    expect(readIncoterm("fob Shanghai")).toBe("FOB");
    expect(readIncoterm("DDP")).toBe("DDP");
    expect(readIncoterm("franco de port")).toBeNull();
    expect(readIncoterm(null)).toBeNull();
  });

  it("prefers the term where the seller takes on more", () => {
    expect(order([offer("exw", { incoterm: "EXW" }), offer("ddp", { incoterm: "DDP" })])).toEqual([
      "ddp",
      "exw",
    ]);
  });

  it("says so when it cannot read a term, rather than guessing one", () => {
    const results = rank([offer("a"), offer("b", { incoterm: "franco" })]);
    expect(of(results, "b").breakdown.factors.incoterm).toEqual({
      state: "unrecognised",
      points: 0,
      weight: 5,
    });
  });

  it("flags prices compared across different incoterms", () => {
    const results = rank([offer("a", { incoterm: "EXW" }), offer("b", { incoterm: "CIF" })]);
    expect(of(results, "a").breakdown.notes).toContain("mixed_incoterms");
    expect(rank([offer("a"), offer("b")])[0]?.breakdown.notes).not.toContain("mixed_incoterms");
  });
});

describe("validity", () => {
  it("is full at 30 days or more, half at 15, nothing once lapsed", () => {
    const results = rank([
      offer("long", { validUntil: "2027-03-01T00:00:00Z" }),
      offer("half", { validUntil: "2026-12-03T12:00:00Z" }),
      offer("gone", { validUntil: "2026-11-17T12:00:00Z" }),
    ]);
    expect(of(results, "long").breakdown.factors.validity.points).toBe(100);
    expect(of(results, "half").breakdown.factors.validity.points).toBe(50);
    expect(of(results, "gone").breakdown.factors.validity.points).toBe(0);
    expect(of(results, "gone").breakdown.notes).toContain("validity_expired");
  });
});

describe("the supplier behind the offer", () => {
  it("prefers a verified supplier, everything else equal", () => {
    expect(order([offer("unverified", { verification: "unverified" }), offer("verified")])).toEqual(
      ["verified", "unverified"],
    );
  });

  it("ranks a rejected supplier's offer, and flags it", () => {
    const results = rank([offer("ok"), offer("rejected", { verification: "rejected" })]);
    expect(results).toHaveLength(2);
    expect(of(results, "rejected").breakdown.notes).toContain("verification_rejected");
  });

  it("prefers the higher KPI #1 score, everything else equal", () => {
    expect(order([offer("low", { kpi1Score: 40 }), offer("high", { kpi1Score: 90 })])).toEqual([
      "high",
      "low",
    ]);
  });
});

describe("the breakdown", () => {
  it("keeps the offer exactly as it was scored", () => {
    const input = offer("a", { moq: "5 000 unités" });
    expect(rank([input])[0]?.breakdown.inputs).toEqual(input);
  });

  it("carries the MOQ without scoring it", () => {
    const withMoq = rank([offer("a", { moq: "1" }), offer("b", { moq: "1 000 000" })]);
    expect(withMoq[0]?.score).toBe(withMoq[1]?.score);
  });
});

describe("the fingerprint", () => {
  const offers = [offer("a"), offer("b", { amountCents: 90_000 })];
  const print = (list: Kpi2Offer[], when = at) => kpi2Fingerprint(list, KPI2_DEFAULT_WEIGHTS, when);

  it("is the same for the same offers in any order", () => {
    expect(print([...offers].reverse())).toBe(print(offers));
  });

  it("changes when a figure, the set, the weights or the instant changes", () => {
    const base = print(offers);
    expect(print([offers[0]!, { ...offers[1]!, amountCents: 91_000 }])).not.toBe(base);
    expect(print([offers[0]!])).not.toBe(base);
    expect(print(offers, new Date(at.getTime() + 1))).not.toBe(base);
    expect(kpi2Fingerprint(offers, { ...KPI2_DEFAULT_WEIGHTS, price: 41 }, at)).not.toBe(base);
  });
});

// ── version 2: the price factor compares LANDED unit cost (V24) ─────────────
describe("landed cost", () => {
  // 20 000 units in every case, so a shipment figure divides cleanly.
  const figure = (
    kind: "main_carriage" | "insurance" | "import_duties" | "inspection",
    amountCents: number,
    patch: Partial<NonNullable<Kpi2Offer["enrichments"]>[number]> = {},
  ) => ({
    kind,
    amountCents,
    currency: "USD",
    validUntil: "2026-12-18T12:00:00Z",
    units: 20_000,
    ...patch,
  });
  const landedOf = (results: ReturnType<typeof rank>, id: string) => {
    const landed = of(results, id).breakdown.landed;
    if (!landed) throw new Error(`no landed cost for ${id}`);
    return landed;
  };

  // V24's acceptance: "Two offers, one cheaper ex-works and dearer delivered:
  // KPI #2 puts the delivered-cheaper one first and the breakdown shows the
  // arithmetic."
  it("puts the delivered-cheaper offer first, and shows the arithmetic", () => {
    const exWorks = offer("exw", {
      amountCents: 90, // 0.90 a unit, at the factory gate
      incoterm: "EXW Changzhou",
      // 4 000.00 to ship 20 000 units: 0.20 a unit.
      enrichments: [figure("main_carriage", 400_000)],
    });
    const delivered = offer("cif", { amountCents: 105, incoterm: "CIF Montreal" });
    const results = rank([exWorks, delivered]);
    expect(results.map((r) => r.quoteId)).toEqual(["cif", "exw"]);

    const exw = landedOf(results, "exw");
    expect(exw.basis).toEqual(["main_carriage"]);
    expect(exw.goodsUnitCents).toBe(90);
    expect(exw.components[0]).toMatchObject({
      line: "main_carriage",
      state: "added",
      unitCents: 20,
      amountCents: 400_000,
      units: 20_000,
      rate: null,
    });
    expect(exw.unitCents).toBe(110);
    expect(exw.compared).toEqual({ currency: "USD", unitCents: 110, rate: null });

    const cif = landedOf(results, "cif");
    expect(cif.components[0]).toEqual({ line: "main_carriage", state: "included" });
    expect(cif.unitCents).toBe(105);
    expect(of(results, "cif").breakdown.factors.price.points).toBe(100);
    expect(of(results, "exw").breakdown.factors.price.points).toBe(95.45); // 105 / 110

    // On the stated price alone — version 1 — the order was the other way.
    expect(order([{ ...exWorks, enrichments: [] }, delivered])).toEqual(["exw", "cif"]);
  });

  // The gotcha: "A missing freight figure read as zero makes the least
  // documented offer look cheapest. Incomplete is a state, not a number."
  it("never reads a missing figure as zero: the line is left out for everyone", () => {
    const documented = offer("doc", {
      amountCents: 90,
      enrichments: [figure("main_carriage", 400_000)],
    });
    const silent = offer("silent", { amountCents: 95 });
    const results = rank([documented, silent]);
    // Compared on the goods alone — the one thing known for both.
    expect(landedOf(results, "doc").basis).toEqual([]);
    expect(landedOf(results, "doc").unitCents).toBe(90);
    expect(landedOf(results, "silent").unitCents).toBe(95);
    expect(results.map((r) => r.quoteId)).toEqual(["doc", "silent"]);
    // The documented offer is not punished for its freight figure…
    expect(of(results, "doc").breakdown.factors.price.points).toBe(100);
    expect(of(results, "doc").breakdown.notes).not.toContain("landed_incomplete");
    // …and the silent one is marked, with what it lacks.
    expect(of(results, "silent").breakdown.notes).toContain("landed_incomplete");
    expect(landedOf(results, "silent").missing).toContain("main_carriage");
    // The figure itself stays in the breakdown: the arithmetic not used.
    expect(landedOf(results, "doc").components[0]).toMatchObject({ state: "added", unitCents: 20 });
  });

  it("does not mark an offer incomplete for a line nobody has", () => {
    const results = rank([offer("a"), offer("b", { amountCents: 90_000 })]);
    for (const id of ["a", "b"]) {
      expect(of(results, id).breakdown.notes).not.toContain("landed_incomplete");
      expect(landedOf(results, id).missing).toEqual([
        "main_carriage",
        "insurance",
        "import_duties",
        "inspection",
      ]);
    }
  });

  it("ranks as version 1 did when no partner added anything", () => {
    const offers = [
      offer("a", { amountCents: 100_000, incoterm: "FOB" }),
      offer("b", { amountCents: 90_000, incoterm: "CIF" }),
      offer("c", { amountCents: 120_000, incoterm: "DDP" }),
    ];
    const results = rank(offers);
    // Price points are still the stated prices against the best of them.
    expect(of(results, "b").breakdown.factors.price.points).toBe(100);
    expect(of(results, "a").breakdown.factors.price.points).toBe(90);
    expect(of(results, "c").breakdown.factors.price.points).toBe(75);
  });

  it("adds nothing for a figure that is expired, has no quantity, or duplicates the incoterm", () => {
    const base = { amountCents: 90, incoterm: "FOB" };
    const other = offer("other", {
      amountCents: 100,
      enrichments: [figure("main_carriage", 400_000)],
    });
    const reasonOf = (enrichment: ReturnType<typeof figure>) => {
      const results = rank([offer("x", { ...base, enrichments: [enrichment] }), other]);
      return landedOf(results, "x").components[0];
    };
    expect(
      reasonOf(figure("main_carriage", 400_000, { validUntil: "2026-11-01T00:00:00Z" })),
    ).toEqual({ line: "main_carriage", state: "unknown", reason: "expired" });
    expect(reasonOf(figure("main_carriage", 400_000, { units: null }))).toEqual({
      line: "main_carriage",
      state: "unknown",
      reason: "no_quantity",
    });
    expect(reasonOf(figure("main_carriage", 400_000, { currency: "CAD" }))).toEqual({
      line: "main_carriage",
      state: "unknown",
      reason: "other_currency",
    });
    // Freight quoted on a CIF offer: inside the price, never added on top.
    const cif = rank([
      offer("x", {
        amountCents: 105,
        incoterm: "CIF",
        enrichments: [figure("main_carriage", 400_000)],
      }),
      other,
    ]);
    expect(landedOf(cif, "x").components[0]).toEqual({ line: "main_carriage", state: "included" });
    expect(landedOf(cif, "x").unitCents).toBe(105);
  });

  describe("with stored exchange rates", () => {
    const cadToUsd = {
      from: "CAD",
      to: "USD",
      rate: 0.72,
      source: "Banque du Canada",
      asOf: "2026-11-18",
    };
    const ranked = (offers: Kpi2Offer[], rates = [cadToUsd]) =>
      rankOffers(offers, KPI2_DEFAULT_WEIGHTS, at, rates);

    it("converts a partner's figure with the rate for exactly that pair", () => {
      const results = ranked([
        offer("a", {
          amountCents: 90,
          enrichments: [figure("import_duties", 500_000, { currency: "CAD" })],
        }),
        offer("b", { amountCents: 100, enrichments: [figure("import_duties", 200_000)] }),
      ]);
      const duties = landedOf(results, "a").components.find((c) => c.line === "import_duties");
      // 5 000.00 CAD × 0.72 ÷ 20 000 units = 0.18 USD a unit.
      expect(duties).toMatchObject({ state: "added", unitCents: 18, rate: cadToUsd });
      expect(landedOf(results, "a").unitCents).toBe(108);
      expect(landedOf(results, "b").unitCents).toBe(110);
      expect(of(results, "a").breakdown.notes).toContain("converted");
      expect(of(results, "b").breakdown.notes).not.toContain("converted");
    });

    it("compares offers in two currencies only when a rate is stored between them", () => {
      const offers = [
        offer("usd", { amountCents: 100, currency: "USD" }),
        offer("usd2", { amountCents: 104, currency: "USD" }),
        offer("cad", { amountCents: 130, currency: "CAD" }),
      ];
      // No rate: price is compared for nobody, as before.
      const without = ranked(offers, []);
      expect(of(without, "usd").breakdown.factors.price.state).toBe("not_comparable");
      expect(of(without, "usd").breakdown.notes).toContain("mixed_currencies");
      expect(landedOf(without, "cad").compared).toBeNull();

      // CAD → USD stored: everything is compared in USD, the majority's.
      const withRate = ranked(offers);
      expect(landedOf(withRate, "cad").compared).toEqual({
        currency: "USD",
        unitCents: 93.6, // 130 × 0.72
        rate: cadToUsd,
      });
      expect(of(withRate, "cad").breakdown.factors.price.points).toBe(100);
      expect(of(withRate, "cad").breakdown.notes).toContain("converted");
      expect(of(withRate, "usd").breakdown.notes).not.toContain("mixed_currencies");
    });

    it("never uses a rate backwards", () => {
      const usdToCad = { ...cadToUsd, from: "USD", to: "CAD", rate: 1.39 };
      const results = ranked(
        [
          offer("usd", { amountCents: 100, currency: "USD" }),
          offer("usd2", { amountCents: 104, currency: "USD" }),
          offer("cad", { amountCents: 130, currency: "CAD" }),
        ],
        [usdToCad],
      );
      // USD → CAD is stored, so the comparison is made in CAD — not in USD by
      // inverting it.
      expect(landedOf(results, "usd").compared).toEqual({
        currency: "CAD",
        unitCents: 139,
        rate: usdToCad,
      });
      expect(landedOf(results, "cad").compared).toEqual({
        currency: "CAD",
        unitCents: 130,
        rate: null,
      });
    });
  });

  it("gives an offer with no price no landed cost, and no points for price", () => {
    const results = rank([offer("a"), offer("none", { amountCents: null })]);
    expect(of(results, "none").breakdown.landed).toBeNull();
    expect(of(results, "none").breakdown.factors.price).toMatchObject({
      state: "missing",
      points: 0,
    });
  });

  it("is a new ranking when a figure or a rate changes", () => {
    const base = [offer("a", { enrichments: [figure("main_carriage", 400_000)] })];
    const print = (list: Kpi2Offer[], rates: Parameters<typeof kpi2Fingerprint>[3] = []) =>
      kpi2Fingerprint(list, KPI2_DEFAULT_WEIGHTS, at, rates);
    expect(print([offer("a", { enrichments: [figure("main_carriage", 400_001)] })])).not.toBe(
      print(base),
    );
    expect(
      print([offer("a", { enrichments: [figure("main_carriage", 400_000, { units: 10_000 })] })]),
    ).not.toBe(print(base));
    expect(print([offer("a")])).not.toBe(print(base));
    expect(
      print(base, [{ from: "CAD", to: "USD", rate: 0.72, source: "x", asOf: "2026-11-18" }]),
    ).not.toBe(print(base));
    // No figure and an empty list are the same thing.
    expect(print([offer("a", { enrichments: [] })])).toBe(print([offer("a")]));
  });
});
