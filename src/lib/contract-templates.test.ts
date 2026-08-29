import { describe, expect, it } from "vitest";
import {
  CONTRACT_TEMPLATE_VERSION,
  isStaleContent,
  renderContract,
  type TemplateFacts,
} from "@/lib/contract-templates";

const FACTS: TemplateFacts = {
  number: "OSI-2026-0042",
  date: new Date("2026-08-29T12:00:00Z"),
  buyerName: "Aciers Boréal",
  osiName: "Oversea Sourcing Intelligence",
  supplierName: "Hy-Lok Canada",
  dealTitle: "Raccords inox 316L",
  amountCents: 1699000,
  currency: "CAD",
  incoterm: "EXW",
  paymentTerms: "30 % dépôt, solde avant expédition",
  leadTimeDays: 45,
  quantity: "5 000 unités",
  moq: "1 000 unités",
};

describe("renderContract", () => {
  it("names both parties in the mandate", () => {
    const doc = renderContract("mandate_osi_client", "fr", FACTS);
    const text = doc.sections.map((s) => s.body).join(" ");
    expect(text).toContain("Aciers Boréal");
    expect(text).toContain("Oversea Sourcing Intelligence");
  });

  it("carries the accepted offer's terms into the purchase order", () => {
    const doc = renderContract("purchase_order", "fr", FACTS);
    const text = doc.sections.map((s) => s.body).join(" ");
    // The commercial substance came from the quote the buyer accepted — if
    // any of these stopped being interpolated the contract would look
    // complete while saying nothing.
    expect(text).toContain("5 000 unités");
    expect(text).toContain("EXW");
    expect(text).toContain("45 jours");
    expect(text).toContain("30 % dépôt, solde avant expédition");
    // French formatting groups with a (narrow) no-break space, not a plain one.
    expect(text).toMatch(/16[\s\u00a0\u202f]?990/);
  });

  it("states OSI is not a party to the sale, in both documents", () => {
    // The one substantive claim the platform makes about itself: it
    // facilitates, it does not sell. A template edit that loses it would
    // misrepresent the business.
    const mandate = renderContract("mandate_osi_client", "fr", FACTS);
    const order = renderContract("purchase_order", "fr", FACTS);
    expect(mandate.sections.map((s) => s.body).join(" ")).toContain("n'est ni le vendeur");
    expect(order.sections.map((s) => s.body).join(" ")).toContain("n'est pas partie à la vente");
  });

  it("renders every section in the requested language only", () => {
    const en = renderContract("purchase_order", "en", FACTS);
    expect(en.locale).toBe("en");
    expect(en.title).toBe("Purchase order");
    const text = en.sections.map((s) => `${s.heading} ${s.body}`).join(" ");
    expect(text).toContain("Buyer");
    expect(text).toContain("45 days");
    // No French leaked through — the document IS one language, not two.
    expect(text).not.toMatch(/\b(Acheteur|Fournisseur|jours)\b/);
  });

  it("shows a missing term as a blank to fill, never as a default", () => {
    // A contract that invents a payment term is worse than one showing a
    // line to complete.
    const doc = renderContract("purchase_order", "fr", {
      ...FACTS,
      paymentTerms: null,
      quantity: null,
      moq: "   ",
      leadTimeDays: null,
      amountCents: null,
    });
    const text = doc.sections.map((s) => s.body).join(" ");
    expect(text).toContain("[à compléter]");
    expect(text).not.toMatch(/\bnull\b|undefined|NaN/);
  });

  it("leaves no unsubstituted placeholder in either language", () => {
    for (const locale of ["fr", "en"] as const) {
      for (const type of ["mandate_osi_client", "purchase_order"] as const) {
        const doc = renderContract(type, locale, FACTS);
        for (const section of doc.sections) {
          expect(section.heading.trim().length).toBeGreaterThan(0);
          expect(section.body.trim().length).toBeGreaterThan(0);
          expect(section.body).not.toMatch(/\{\{|\}\}|\bundefined\b|\bnull\b/);
        }
      }
    }
  });

  it("stamps the version that produced the text", () => {
    const doc = renderContract("mandate_osi_client", "fr", FACTS);
    expect(doc.version).toBe(CONTRACT_TEMPLATE_VERSION);
  });

  it("is pure — the same facts render the same document", () => {
    // What makes freezing the result safe.
    expect(renderContract("purchase_order", "fr", FACTS)).toEqual(
      renderContract("purchase_order", "fr", FACTS),
    );
  });
});

describe("isStaleContent", () => {
  it("flags text drafted under an older template", () => {
    expect(isStaleContent({ version: 0, locale: "fr", title: "x", sections: [] })).toBe(true);
  });

  it("does not flag current text, or a contract drafted before templates", () => {
    expect(
      isStaleContent({
        version: CONTRACT_TEMPLATE_VERSION,
        locale: "fr",
        title: "x",
        sections: [],
      }),
    ).toBe(false);
    // Null is "no content at all" — the fiche handles that separately, and
    // calling it stale would put a re-draft prompt on every pre-P5 contract
    // for a reason that is not true.
    expect(isStaleContent(null)).toBe(false);
  });
});
