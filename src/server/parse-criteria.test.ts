// The structured intake's criteria builder (ADR-001 S2) — typed fields become
// rows verbatim, details still feed the regex parser without duplicating a
// category the form already answered.

import { describe, expect, it } from "vitest";
import { structuredCriteria } from "./parse-criteria";

describe("structuredCriteria", () => {
  it("turns every filled field into a row, product first and required", () => {
    const rows = structuredCriteria(
      {
        categoryId: "valves",
        product: "Vannes papillon DN50",
        material: "acier inoxydable 316L",
        certifications: ["ISO 9001", "CE"],
        quantity: "5 000 unités / an",
        leadTime: "60 jours",
      },
      "fr",
    );
    expect(rows[0]).toMatchObject({
      category: "other",
      value: "Vannes papillon DN50",
      required: true,
    });
    expect(rows.map((r) => r.category)).toEqual([
      "other",
      "material",
      "certification",
      "quantity",
      "lead_time",
    ]);
    const certs = rows.find((r) => r.category === "certification")!;
    expect(certs.value).toBe("ISO 9001, CE");
    expect(certs.required).toBe(true);
  });

  it("skips empty fields and parses extra specs out of the details", () => {
    const rows = structuredCriteria(
      {
        categoryId: "pumps",
        product: "Pompes centrifuges",
        details: "Pression de service 16 bars, débit 40 m3/h",
      },
      "fr",
    );
    const categories = rows.map((r) => r.category);
    expect(categories).toContain("pressure");
    expect(categories).toContain("flow");
    expect(categories.filter((c) => c === "other")).toHaveLength(1); // no parser fallback row
  });

  it("never duplicates a category the form already answered", () => {
    const rows = structuredCriteria(
      {
        categoryId: "pumps",
        product: "Pompes",
        material: "inox 316L",
        details: "corps en acier inoxydable, ISO 9001",
      },
      "en",
    );
    expect(rows.filter((r) => r.category === "material")).toHaveLength(1);
    expect(rows.find((r) => r.category === "material")!.value).toBe("inox 316L"); // the typed one
    expect(rows.filter((r) => r.category === "certification")).toHaveLength(1); // from details
  });
});
