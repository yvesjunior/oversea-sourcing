import { describe, expect, it } from "vitest";
import type { PackOfferSnapshot } from "@/lib/decision-pack";
import { COST_LINES, explainOffer, landedCostLines } from "@/lib/pack-explain";

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
