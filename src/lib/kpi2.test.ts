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
