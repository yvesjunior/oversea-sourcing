import { describe, expect, it } from "vitest";
import { buildSpecContent, specFingerprint, type SpecInput } from "@/lib/request-spec";

const input: SpecInput = {
  locale: "fr",
  title: "Vannes papillon inox DN50",
  categoryId: "valves",
  description: "Pour un réseau d'eau potable. Livraison à Montréal.",
  criteria: [
    {
      id: "c2",
      category: "pressure",
      label: "Pression",
      value: "16",
      unit: "bar",
      required: false,
      isPrimary: false,
      position: 1,
    },
    {
      id: "c1",
      category: "other",
      label: "Besoin",
      value: "Vannes papillon inox DN50",
      unit: null,
      required: true,
      isPrimary: true,
      position: 0,
    },
    {
      id: "c3",
      category: "quantity",
      label: "Quantité",
      value: "500",
      unit: "pièces",
      required: true,
      isPrimary: false,
      position: 2,
    },
  ],
  attachments: 2,
};

describe("buildSpecContent", () => {
  it("keeps the criteria in the dossier's order, whatever order the rows came in", () => {
    expect(buildSpecContent(input).criteria.map((c) => c.id)).toEqual(["c1", "c2", "c3"]);
  });

  it("renders what a supplier needs, in the request's language", () => {
    expect(buildSpecContent(input).text).toBe(
      [
        "BESOIN",
        "Vannes papillon inox DN50",
        "",
        "SPÉCIFICATIONS",
        "  - Besoin: Vannes papillon inox DN50 (obligatoire)",
        "  - Pression: 16 bar",
        "  - Quantité: 500 pièces (obligatoire)",
        "",
        "DESCRIPTION DU CLIENT (TELLE QU'IL L'A RÉDIGÉE)",
        "Pour un réseau d'eau potable. Livraison à Montréal.",
        "",
        "2 pièces jointes au dossier",
      ].join("\n"),
    );
  });

  it("renders in English for an English request, and treats any other locale as French", () => {
    expect(buildSpecContent({ ...input, locale: "en" }).text).toContain("WHAT IS NEEDED");
    expect(buildSpecContent({ ...input, locale: "en" }).text).toContain("(required)");
    expect(buildSpecContent({ ...input, locale: "es" }).locale).toBe("fr");
  });

  it("leaves out the blocks that have nothing to say", () => {
    const bare = buildSpecContent({ ...input, criteria: [], description: "  ", attachments: 0 });
    expect(bare.text).toBe("BESOIN\nVannes papillon inox DN50");
  });

  // The builder's input has no field for a workspace, a person or a request
  // number — so the type itself is the guarantee. This pins the shape: a
  // field added to the content has to be added here, on purpose.
  it("holds nothing but the need", () => {
    expect(Object.keys(buildSpecContent(input)).sort()).toEqual([
      "attachments",
      "categoryId",
      "criteria",
      "description",
      "locale",
      "text",
      "title",
    ]);
  });
});

describe("specFingerprint", () => {
  const print = (override: Partial<SpecInput>) =>
    specFingerprint(buildSpecContent({ ...input, ...override }));
  const base = print({});

  it("is stable for the same request", () => {
    expect(print({ criteria: [...input.criteria].reverse() })).toBe(base);
  });

  it("does not change when a criterion is deleted and typed back identically", () => {
    const retyped = input.criteria.map((c) => (c.id === "c2" ? { ...c, id: "c9" } : c));
    expect(print({ criteria: retyped })).toBe(base);
  });

  it("changes with anything a supplier would be asked differently", () => {
    const edit = (id: string, change: Partial<SpecInput["criteria"][number]>) =>
      input.criteria.map((c) => (c.id === id ? { ...c, ...change } : c));
    expect(print({ criteria: edit("c2", { value: "10" }) })).not.toBe(base);
    expect(print({ criteria: edit("c2", { unit: "psi" }) })).not.toBe(base);
    expect(print({ criteria: edit("c2", { required: true }) })).not.toBe(base);
    expect(print({ criteria: input.criteria.slice(0, 2) })).not.toBe(base);
    expect(print({ description: "Autre chose." })).not.toBe(base);
    expect(print({ title: "Vannes à boisseau" })).not.toBe(base);
    expect(print({ attachments: 3 })).not.toBe(base);
  });
});
