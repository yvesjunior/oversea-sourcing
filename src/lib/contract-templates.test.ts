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

  it("states the price as a unit price, and prints no total", () => {
    // The supplier is asked for « Prix unitaire et devise » and the amount on
    // the deal is a copy of that answer. Version 1 printed it as « Prix total
    // convenu »: a contract two parties sign, stating a unit price as the
    // total. The quantity is free text, so no total can be computed either —
    // the text says where it comes from instead of printing a figure.
    const fr = renderContract("purchase_order", "fr", FACTS);
    const price = fr.sections.find((s) => s.heading === "3. Prix")?.body ?? "";
    expect(price).toMatch(/Prix unitaire convenu : 16[\s\u00a0\u202f]?990/);
    expect(price).toContain("quantité indiquée à l'article 2 (Marchandise)");
    expect(price).not.toMatch(/prix total convenu/i);
    // One figure in the clause: the unit price. Anything else would be a
    // total somebody computed.
    expect(price.match(/\d[\d\s\u00a0\u202f]*,\d{2}/g)).toHaveLength(1);
    // The clause points at section 2, so section 2 has to be the one that
    // carries the quantity.
    expect(fr.sections[1]?.heading).toBe("2. Marchandise");
    expect(fr.sections[1]?.body).toContain("Quantité : 5 000 unités");

    const en = renderContract("purchase_order", "en", FACTS);
    const enPrice = en.sections.find((s) => s.heading === "3. Price")?.body ?? "";
    expect(enPrice).toContain("Agreed unit price: $16,990.00");
    expect(enPrice).toContain("quantity stated in section 2 (Goods)");
    expect(enPrice).not.toMatch(/total agreed price/i);
    expect(en.sections[1]?.heading).toBe("2. Goods");
    expect(en.sections[1]?.body).toContain("Quantity: 5 000 unités");
  });

  it("does not call the unit price the value of the transaction, in the mandate", () => {
    // Same amount, same mistake, other document: the mandate has no goods
    // section, so it states the quantity beside the price it applies to.
    const fr = renderContract("mandate_osi_client", "fr", FACTS).sections[3]?.body ?? "";
    expect(fr).toMatch(/Prix unitaire de la soumission acceptée : 16[\s\u00a0\u202f]?990/);
    expect(fr).toContain("Quantité : 5 000 unités");
    expect(fr).not.toMatch(/Valeur de la transaction : /);

    const en = renderContract("mandate_osi_client", "en", FACTS).sections[3]?.body ?? "";
    expect(en).toContain("Unit price of the accepted quotation: $16,990.00");
    expect(en).toContain("Quantity: 5 000 unités");
    expect(en).not.toMatch(/Transaction value: /);
  });

  it("leaves the quantity a blank to fill when the offer gave none", () => {
    // The sentence about the total then points at a line somebody has to
    // complete before sending — which is the point: no quantity, no total.
    for (const type of ["mandate_osi_client", "purchase_order"] as const) {
      const text = renderContract(type, "fr", { ...FACTS, quantity: null })
        .sections.map((s) => s.body)
        .join(" ");
      expect(text).toContain("Quantité : [à compléter]");
      expect(text).toMatch(/[Pp]rix unitaire[^.]*16[\s\u00a0\u202f]?990/);
    }
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

  it("flags a draft written under the wording that called a unit price the total", () => {
    // Version 1 is that wording. If this stops being stale, the drafts that
    // carry « Prix total convenu » can no longer be told from corrected ones.
    expect(CONTRACT_TEMPLATE_VERSION).toBeGreaterThanOrEqual(2);
    expect(isStaleContent({ version: 1, locale: "fr", title: "x", sections: [] })).toBe(true);
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
