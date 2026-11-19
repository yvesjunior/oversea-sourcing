import { describe, expect, it } from "vitest";
import {
  CASE_FACTS,
  CASE_NEEDS,
  canAnswerCase,
  caseNeeds,
  factsForCase,
  type CaseFacts,
} from "@/lib/partner-need";
import { PARTNER_KINDS } from "@/lib/partners";

// Every fact filled in: what the server knows about the offer of a case.
const EVERYTHING: CaseFacts = {
  goods: { title: "Roulements à billes", lines: ["Diamètre : 12 mm"] },
  quantity: "20 000",
  origin: "CN",
  incoterm: "FOB Shanghai",
  lead_time: 30,
  goods_value: { amountCents: 98000, currency: "USD" },
  supplier_identity: "Changzhou Huari Steel Ball Co., Ltd.",
};

describe("what each kind of case is shown", () => {
  it("has a rule for every kind of partner, made of known facts only", () => {
    for (const kind of PARTNER_KINDS) {
      expect(CASE_NEEDS[kind], kind).toBeDefined();
      for (const fact of CASE_NEEDS[kind]) expect(CASE_FACTS).toContain(fact);
    }
  });

  // V23's acceptance: "not the supplier's price unless the case kind
  // requires it".
  it("gives the supplier's price to the kinds computed from it, and to no other", () => {
    expect(caseNeeds("insurance", "goods_value")).toBe(true);
    expect(caseNeeds("customs", "goods_value")).toBe(true);
    expect(caseNeeds("transport", "goods_value")).toBe(false);
    expect(caseNeeds("inspection", "goods_value")).toBe(false);
  });

  it("names the supplier to the inspector, who goes there, and to nobody else", () => {
    const named = PARTNER_KINDS.filter((kind) => caseNeeds(kind, "supplier_identity"));
    expect(named).toEqual(["inspection"]);
  });

  it("shows a settlement case nothing — that slot is not open", () => {
    expect(CASE_NEEDS.settlement).toEqual([]);
    expect(factsForCase("settlement", EVERYTHING)).toEqual({});
  });
});

describe("factsForCase removes what the kind does not need", () => {
  it("leaves a transport case without the price and without the supplier", () => {
    const shown = factsForCase("transport", EVERYTHING);
    expect(Object.keys(shown).sort()).toEqual(
      ["goods", "incoterm", "lead_time", "origin", "quantity"].sort(),
    );
    // Absent, not null: the page cannot show what it was never sent.
    expect("goods_value" in shown).toBe(false);
    expect("supplier_identity" in shown).toBe(false);
    expect(JSON.stringify(shown)).not.toContain("98000");
    expect(JSON.stringify(shown)).not.toContain("Changzhou");
  });

  it("gives an insurance and a customs case the value, never the supplier", () => {
    for (const kind of ["insurance", "customs"] as const) {
      const shown = factsForCase(kind, EVERYTHING);
      expect(shown.goods_value).toEqual({ amountCents: 98000, currency: "USD" });
      expect("supplier_identity" in shown).toBe(false);
      expect("lead_time" in shown).toBe(false);
    }
  });

  it("gives an inspection case the supplier, never the price", () => {
    const shown = factsForCase("inspection", EVERYTHING);
    expect(shown.supplier_identity).toBe("Changzhou Huari Steel Ball Co., Ltd.");
    expect("goods_value" in shown).toBe(false);
    expect("incoterm" in shown).toBe(false);
  });

  it("returns exactly the keys of the rule, for every kind", () => {
    for (const kind of PARTNER_KINDS) {
      expect(Object.keys(factsForCase(kind, EVERYTHING)).sort()).toEqual(
        [...CASE_NEEDS[kind]].sort(),
      );
    }
  });
});

describe("answering a case", () => {
  it("is possible until staff withdraw it — a correction included", () => {
    expect(canAnswerCase("open")).toBe(true);
    expect(canAnswerCase("answered")).toBe(true);
    expect(canAnswerCase("cancelled")).toBe(false);
  });
});
