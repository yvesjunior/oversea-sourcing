import { describe, expect, it } from "vitest";
import {
  ENRICHMENT_KINDS,
  ENRICHMENT_OF,
  enrichmentsFingerprint,
  enrichmentStanding,
  isExpired,
  latestPerCase,
  type OfferEnrichment,
} from "@/lib/partner-case";
import { COST_LINES } from "@/lib/pack-explain";
import { PARTNER_KINDS, PARTNER_KINDS_AVAILABLE } from "@/lib/partners";

const now = new Date("2026-11-18T12:00:00Z");
const freight: OfferEnrichment = {
  kind: "main_carriage",
  amountCents: 125000,
  currency: "USD",
  validUntil: "2026-12-18T00:00:00.000Z",
};

describe("which cost line a partner fills", () => {
  it("is one line per kind of partner that can be created", () => {
    for (const kind of PARTNER_KINDS_AVAILABLE) {
      expect(ENRICHMENT_OF[kind], kind).not.toBeNull();
    }
    const lines = PARTNER_KINDS_AVAILABLE.map((kind) => ENRICHMENT_OF[kind]);
    expect(new Set(lines).size).toBe(lines.length);
  });

  it("gives the settlement partner no line: its fees are the money circuit's", () => {
    expect(ENRICHMENT_OF.settlement).toBeNull();
    expect(Object.keys(ENRICHMENT_OF).sort()).toEqual([...PARTNER_KINDS].sort());
  });

  it("only ever names a line the pack's cost block has", () => {
    for (const kind of ENRICHMENT_KINDS) expect(COST_LINES).toContain(kind);
  });
});

describe("latestPerCase", () => {
  it("keeps the last version of each case, whatever order the rows come in", () => {
    const rows = [
      { caseId: "a", version: 1, amountCents: 100 },
      { caseId: "b", version: 1, amountCents: 300 },
      { caseId: "a", version: 3, amountCents: 120 },
      { caseId: "a", version: 2, amountCents: 110 },
    ];
    expect(
      latestPerCase(rows)
        .map((r) => [r.caseId, r.amountCents])
        .sort(),
    ).toEqual([
      ["a", 120],
      ["b", 300],
    ]);
  });
});

describe("whether a figure can stand next to the supplier's price", () => {
  it("can, in the offer's currency, while it is valid", () => {
    expect(enrichmentStanding(freight, "USD", now)).toBe("addable");
    expect(enrichmentStanding(freight, "usd", now)).toBe("addable");
  });

  // Decision D7: a freight quote in USD on an offer in EUR is not added to it.
  it("cannot in another currency, or when the offer states none", () => {
    expect(enrichmentStanding(freight, "EUR", now)).toBe("other_currency");
    expect(enrichmentStanding(freight, null, now)).toBe("other_currency");
    expect(enrichmentStanding(freight, " ", now)).toBe("other_currency");
  });

  it("cannot once its validity has run out — whatever the currency", () => {
    const stale = { ...freight, validUntil: "2026-11-01T00:00:00.000Z" };
    expect(isExpired(stale, now)).toBe(true);
    expect(enrichmentStanding(stale, "USD", now)).toBe("expired");
  });

  it("stands with no end date", () => {
    expect(enrichmentStanding({ ...freight, validUntil: null }, "USD", now)).toBe("addable");
  });
});

describe("enrichmentsFingerprint", () => {
  it("is the same whatever the order, and for none or a missing list", () => {
    const insurance: OfferEnrichment = {
      kind: "insurance",
      amountCents: 900,
      currency: "usd",
      validUntil: null,
    };
    expect(enrichmentsFingerprint([freight, insurance])).toBe(
      enrichmentsFingerprint([{ ...insurance, currency: "USD" }, freight]),
    );
    expect(enrichmentsFingerprint([])).toBe(enrichmentsFingerprint(undefined));
  });

  it("changes with the amount, the currency or the validity", () => {
    const base = enrichmentsFingerprint([freight]);
    expect(enrichmentsFingerprint([{ ...freight, amountCents: 1 }])).not.toBe(base);
    expect(enrichmentsFingerprint([{ ...freight, currency: "EUR" }])).not.toBe(base);
    expect(enrichmentsFingerprint([{ ...freight, validUntil: null }])).not.toBe(base);
    expect(enrichmentsFingerprint([])).not.toBe(base);
  });
});
