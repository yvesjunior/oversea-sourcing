import { describe, expect, it } from "vitest";
import type { PackOfferSnapshot } from "@/lib/decision-pack";
import {
  COST_LINES,
  costQuoteStanding,
  explainOffer,
  knownUnitCostOf,
  landedCostLines,
} from "@/lib/pack-explain";

const offer = (patch: Partial<PackOfferSnapshot> = {}): PackOfferSnapshot => ({
  supplierName: "Acme",
  supplierCountry: "CN",
  supplierVerification: "verified",
  amountCents: 100_000,
  currency: "USD",
  quantity: null,
  moq: null,
  leadTimeDays: 30,
  incoterm: "FOB",
  paymentTerms: null,
  validUntil: "2026-12-18T12:00:00.000Z",
  respondedAt: "2026-11-17T09:00:00.000Z",
  channel: "staff",
  ...patch,
});

const facts = (patch: Partial<{ fit: number | null; validityExpired: boolean }> = {}) => ({
  fit: 75,
  validityExpired: false,
  ...patch,
});
const keys = (lines: { key: string }[]) => lines.map((line) => line.key);

describe("explainOffer", () => {
  const cheap = offer({ supplierName: "Cheap", amountCents: 98_000, leadTimeDays: 30 });
  const fast = offer({
    supplierName: "Fast",
    amountCents: 105_000,
    leadTimeDays: 20,
    incoterm: "FOB",
  });

  it("says an offer is the cheapest, and how far above it the other is", () => {
    const shown = [cheap, fast];
    expect(explainOffer(cheap, shown, facts())).toContainEqual({ key: "price.best" });
    expect(explainOffer(fast, shown, facts())).toContainEqual({
      key: "price.above",
      params: { pct: 7 },
    });
  });

  it("says which lead time is the shortest, and how much longer the other is", () => {
    const shown = [cheap, fast];
    expect(explainOffer(fast, shown, facts())).toContainEqual({ key: "leadTime.best" });
    expect(explainOffer(cheap, shown, facts())).toContainEqual({
      key: "leadTime.above",
      params: { pct: 50 },
    });
  });

  it("compares only with the offers SHOWN — a withheld offer leaves no trace", () => {
    // `fast` was withheld: `cheap` is alone on the page, and must not say it
    // is 50 % slower than something the reader cannot see.
    const lines = explainOffer(cheap, [cheap], facts());
    expect(keys(lines).some((key) => key.startsWith("leadTime") || key.startsWith("price"))).toBe(
      false,
    );
  });

  it("says nothing comparative about a lone offer", () => {
    expect(keys(explainOffer(cheap, [cheap], facts()))).toEqual(["fit", "verification.verified"]);
  });

  it("says so when prices are not in one currency, rather than staying silent", () => {
    const eur = offer({ supplierName: "Eur", currency: "EUR" });
    expect(keys(explainOffer(cheap, [cheap, eur], facts()))).toContain("price.not_comparable");
    expect(keys(explainOffer(eur, [cheap, eur], facts()))).toContain("price.not_comparable");
  });

  it("says what the supplier did not tell us", () => {
    const silent = offer({ supplierName: "Silent", amountCents: null, leadTimeDays: null });
    expect(keys(explainOffer(silent, [cheap, silent], facts()))).toEqual(
      expect.arrayContaining(["price.missing", "leadTime.missing"]),
    );
  });

  it("says nothing about a figure no shown offer states", () => {
    const a = offer({ supplierName: "A", leadTimeDays: null });
    const b = offer({ supplierName: "B", leadTimeDays: null });
    expect(keys(explainOffer(a, [a, b], facts())).some((key) => key.startsWith("leadTime"))).toBe(
      false,
    );
  });

  it("gives the fit with the need as a whole number", () => {
    expect(explainOffer(cheap, [cheap], facts({ fit: 75 }))).toContainEqual({
      key: "fit",
      params: { score: 75 },
    });
  });

  it("states the supplier's verification as the pack holds it", () => {
    for (const status of ["verified", "pending", "unverified", "rejected"] as const) {
      const o = offer({ supplierVerification: status });
      expect(keys(explainOffer(o, [o], facts()))).toContain(`verification.${status}`);
    }
    const unknown = offer({ supplierVerification: null });
    expect(
      keys(explainOffer(unknown, [unknown], facts())).some((key) => key.startsWith("verification")),
    ).toBe(false);
  });

  it("warns when the prices compared do not cover the same costs", () => {
    const cif = offer({ supplierName: "Cif", incoterm: "CIF" });
    expect(keys(explainOffer(cheap, [cheap, cif], facts()))).toContain("mixed_incoterms");
    expect(keys(explainOffer(cheap, [cheap, fast], facts()))).not.toContain("mixed_incoterms");
  });

  it("never mentions a score, a rank or a weight", () => {
    const text = JSON.stringify(explainOffer(cheap, [cheap, fast], facts()));
    expect(text).not.toMatch(/weight|rank|points/);
  });

  it("says an offer's validity had lapsed when it had", () => {
    expect(keys(explainOffer(cheap, [cheap], facts({ validityExpired: true })))).toContain(
      "validity_expired",
    );
  });

  it("still says what it can when the ranking row is gone", () => {
    expect(keys(explainOffer(cheap, [cheap], facts({ fit: null })))).toEqual([
      "verification.verified",
    ]);
  });
});

describe("landedCostLines", () => {
  const state = (lines: ReturnType<typeof landedCostLines>, key: string) =>
    lines.find((line) => line.key === key)?.state;

  it("always lists every line — an unknown is said, not skipped", () => {
    expect(landedCostLines(offer()).map((line) => line.key)).toEqual([...COST_LINES]);
    expect(landedCostLines({ amountCents: null, incoterm: null }).map((l) => l.key)).toEqual([
      ...COST_LINES,
    ]);
  });

  it("FOB: the price is stated, and nothing else is in it", () => {
    const lines = landedCostLines(offer({ incoterm: "FOB Shanghai" }));
    expect(state(lines, "goods")).toBe("stated");
    expect(state(lines, "main_carriage")).toBe("not_provided");
    expect(state(lines, "insurance")).toBe("not_provided");
    expect(state(lines, "import_duties")).toBe("not_provided");
  });

  it("CIF: carriage and insurance are inside the price, duties are not", () => {
    const lines = landedCostLines(offer({ incoterm: "CIF" }));
    expect(state(lines, "main_carriage")).toBe("included");
    expect(state(lines, "insurance")).toBe("included");
    expect(state(lines, "import_duties")).toBe("not_provided");
  });

  it("CFR and DAP: carriage, but no insurance obligation", () => {
    for (const incoterm of ["CFR", "DAP"]) {
      const lines = landedCostLines(offer({ incoterm }));
      expect(state(lines, "main_carriage")).toBe("included");
      expect(state(lines, "insurance")).toBe("not_provided");
    }
  });

  it("DDP alone includes import duties", () => {
    expect(state(landedCostLines(offer({ incoterm: "DDP" })), "import_duties")).toBe("included");
    expect(state(landedCostLines(offer({ incoterm: "DAP" })), "import_duties")).toBe(
      "not_provided",
    );
  });

  it("assumes nothing from an incoterm it cannot read, or from none", () => {
    for (const incoterm of ["franco", null]) {
      const lines = landedCostLines(offer({ incoterm }));
      expect(state(lines, "main_carriage")).toBe("not_provided");
      expect(state(lines, "import_duties")).toBe("not_provided");
    }
  });

  it("says the fees apply without quoting them, whatever the offer", () => {
    for (const incoterm of ["EXW", "DDP", null]) {
      const lines = landedCostLines(offer({ incoterm }));
      expect(state(lines, "osi_fee")).toBe("applies_unquoted");
      expect(state(lines, "settlement_fee")).toBe("applies_unquoted");
    }
  });

  it("never says inspection is covered", () => {
    expect(state(landedCostLines(offer({ incoterm: "DDP" })), "inspection")).toBe("not_provided");
  });

  it("says the price is not provided when the supplier gave none", () => {
    expect(state(landedCostLines(offer({ amountCents: null })), "goods")).toBe("not_provided");
  });
});

// V22 — what a partner added to an offer.
describe("the cost block with a partner's figure", () => {
  const at = new Date("2026-11-18T12:00:00Z");
  const offer = { amountCents: 98000, currency: "USD", incoterm: "FOB Shanghai" };
  const freight = {
    kind: "main_carriage" as const,
    amountCents: 125000,
    currency: "USD",
    validUntil: "2026-12-18T00:00:00.000Z",
    // 1 250.00 USD to ship 20 000 units.
    units: 20000,
  };
  const lineOf = (lines: ReturnType<typeof landedCostLines>, key: string) =>
    lines.find((line) => line.key === key)!;

  it("is unchanged when nobody added anything — step 08 blocks nothing", () => {
    expect(landedCostLines(offer, at)).toEqual(landedCostLines({ ...offer, enrichments: [] }, at));
    expect(lineOf(landedCostLines(offer, at), "main_carriage")).toEqual({
      key: "main_carriage",
      state: "not_provided",
    });
  });

  it("shows a freight figure on its line, addable in the offer's currency", () => {
    const line = lineOf(landedCostLines({ ...offer, enrichments: [freight] }, at), "main_carriage");
    expect(line.state).toBe("quoted");
    expect(line.quote).toEqual({
      amountCents: 125000,
      currency: "USD",
      validUntil: freight.validUntil,
      units: 20000,
      standing: "addable",
      // 125 000 cents over 20 000 units.
      unitCents: 6.25,
      rate: null,
    });
  });

  // V24 (owner, 2026-11-19): the supplier quotes a UNIT price. A shipment
  // figure that does not say how many units it covers is added to nothing.
  it("shows a figure with no quantity, and adds it to nothing", () => {
    const line = lineOf(
      landedCostLines({ ...offer, enrichments: [{ ...freight, units: null }] }, at),
      "main_carriage",
    );
    expect(line.quote?.amountCents).toBe(125000);
    expect(line.quote?.standing).toBe("no_quantity");
    expect(line.quote?.unitCents).toBeNull();
  });

  it("converts a figure in another currency only with a stored rate for that pair", () => {
    const cad = { ...freight, currency: "CAD" };
    const rate = {
      from: "CAD",
      to: "USD",
      rate: 0.72,
      source: "Banque du Canada",
      asOf: "2026-11-18",
    };
    const without = lineOf(landedCostLines({ ...offer, enrichments: [cad] }, at), "main_carriage");
    expect(without.quote?.standing).toBe("other_currency");
    const withRate = lineOf(
      landedCostLines({ ...offer, enrichments: [cad] }, at, [rate]),
      "main_carriage",
    );
    expect(withRate.quote?.standing).toBe("converted");
    expect(withRate.quote?.unitCents).toBe(4.5); // 125 000 × 0.72 ÷ 20 000
    expect(withRate.quote?.rate).toEqual(rate);
    // The inverse pair is a rate nobody stored.
    const inverse = { ...rate, from: "USD", to: "CAD" };
    expect(
      lineOf(landedCostLines({ ...offer, enrichments: [cad] }, at, [inverse]), "main_carriage")
        .quote?.standing,
    ).toBe("other_currency");
  });

  // Decision D7: a freight quote in USD on an offer in EUR is not added to it.
  it("shows a figure in another currency as one — the amount stays, the standing says so", () => {
    const line = lineOf(
      landedCostLines({ ...offer, currency: "EUR", enrichments: [freight] }, at),
      "main_carriage",
    );
    expect(line.quote?.amountCents).toBe(125000);
    expect(line.quote?.standing).toBe("other_currency");
  });

  it("shows an expired figure as expired", () => {
    const stale = { ...freight, validUntil: "2026-11-01T00:00:00.000Z" };
    expect(
      lineOf(landedCostLines({ ...offer, enrichments: [stale] }, at), "main_carriage").quote
        ?.standing,
    ).toBe("expired");
  });

  // Found in the live run: freight quoted by a partner on a CIF offer was
  // shown as if it came on top of a price that already carries the freight.
  it("shows a figure the incoterm already covers, and says it must not be added", () => {
    const cif = { ...offer, incoterm: "CIF Montreal" };
    expect(lineOf(landedCostLines(cif, at), "main_carriage").state).toBe("included");
    const line = lineOf(landedCostLines({ ...cif, enrichments: [freight] }, at), "main_carriage");
    expect(line.state).toBe("quoted");
    expect(line.quote?.amountCents).toBe(125000);
    expect(line.quote?.standing).toBe("already_included");
  });

  it("says 'already included' before anything else — currency and validity do not matter", () => {
    const cif = { currency: "EUR", incoterm: "CIF" };
    const stale = { ...freight, validUntil: "2026-11-01T00:00:00.000Z" };
    expect(costQuoteStanding(stale, cif, at)).toBe("already_included");
    // Insurance under CIF, duties under DDP alone, inspection never.
    const of = (kind: "insurance" | "import_duties" | "inspection", incoterm: string) =>
      costQuoteStanding({ ...freight, kind }, { currency: "USD", incoterm }, at);
    expect(of("insurance", "CIF")).toBe("already_included");
    expect(of("insurance", "CFR")).toBe("addable");
    expect(of("import_duties", "DDP")).toBe("already_included");
    expect(of("import_duties", "DAP")).toBe("addable");
    expect(of("inspection", "DDP")).toBe("addable");
  });

  it("leaves the other lines and the two fees as they were", () => {
    const lines = landedCostLines({ ...offer, enrichments: [freight] }, at);
    expect(lineOf(lines, "insurance").state).toBe("not_provided");
    expect(lineOf(lines, "inspection").state).toBe("not_provided");
    expect(lineOf(lines, "osi_fee").state).toBe("applies_unquoted");
    expect(lineOf(lines, "settlement_fee").state).toBe("applies_unquoted");
  });

  // ── the one figure the block may state (V24) ──────────────────────────────
  it("states what one unit costs over what is known, and what that leaves out", () => {
    const known = knownUnitCostOf({ ...offer, enrichments: [freight] }, at);
    expect(known).toEqual({
      unitCents: 98006.25, // 98 000 + 6.25
      currency: "USD",
      added: ["main_carriage"],
      included: [],
      missing: ["insurance", "import_duties", "inspection"],
    });
  });

  it("states no landed figure when nothing was added to the price", () => {
    expect(knownUnitCostOf(offer, at)).toBeNull();
    // A figure that cannot be added does not make one either.
    expect(
      knownUnitCostOf({ ...offer, enrichments: [{ ...freight, units: null }] }, at),
    ).toBeNull();
    // Nor does a price nobody stated.
    expect(knownUnitCostOf({ ...offer, amountCents: null, enrichments: [freight] }, at)).toBeNull();
  });

  it("does not add on a CIF offer what the price already carries", () => {
    const cif = { ...offer, incoterm: "CIF Montreal" };
    expect(knownUnitCostOf({ ...cif, enrichments: [freight] }, at)).toBeNull();
    const duties = { ...freight, kind: "import_duties" as const, amountCents: 40000 };
    expect(knownUnitCostOf({ ...cif, enrichments: [freight, duties] }, at)).toEqual({
      unitCents: 98002, // duties only: 40 000 ÷ 20 000
      currency: "USD",
      added: ["import_duties"],
      included: ["main_carriage", "insurance"],
      missing: ["inspection"],
    });
  });
});
