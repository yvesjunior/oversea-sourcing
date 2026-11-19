import { describe, expect, it } from "vitest";
import { buildCaseOpenedMail, buildPartnerInvitationMail } from "@/lib/partner-mail";

describe("the Partner Hub invitation", () => {
  const url = "https://osi.example/partenaires/inscription/tok_abc";

  it("names the partner, carries the link, and greets the person when known", () => {
    const mail = buildPartnerInvitationMail({
      locale: "fr",
      partnerName: "Transit Boréal",
      greetingName: "Léa Fortin",
      url,
    });
    expect(mail.subject).toContain("Transit Boréal");
    expect(mail.text).toContain("Bonjour Léa Fortin,");
    expect(mail.text).toContain(url);
    expect(mail.html).toContain(`<a href="${url}">`);
  });

  it("greets nobody by name when the address is not the contact's", () => {
    const mail = buildPartnerInvitationMail({
      locale: "en",
      partnerName: "Inspect North Ltd",
      greetingName: null,
      url,
    });
    expect(mail.text.startsWith("Hello,")).toBe(true);
    expect(mail.subject).toBe("Your access to the OSI Partner Hub — Inspect North Ltd");
  });

  it("escapes a partner name in the HTML", () => {
    const mail = buildPartnerInvitationMail({
      locale: "en",
      partnerName: "A <b>& Co",
      greetingName: null,
      url,
    });
    expect(mail.html).toContain("A &lt;b&gt;&amp; Co");
    expect(mail.html).not.toContain("<b>&");
  });
});

describe("the new-case notice", () => {
  const input = {
    greetingName: "Léa Fortin",
    reference: "#3049",
    kind: "customs" as const,
    url: "https://osi.example/partenaires/dossier/case-1",
  };

  it("says what kind of question it is, in the reader's language", () => {
    expect(buildCaseOpenedMail({ ...input, locale: "fr" }).subject).toBe(
      "Nouveau dossier douane #3049 — OSI",
    );
    expect(buildCaseOpenedMail({ ...input, locale: "en" }).subject).toBe(
      "New customs case #3049 — OSI",
    );
  });

  it("carries the case's link and OSI's reference", () => {
    const mail = buildCaseOpenedMail({ ...input, locale: "en" });
    expect(mail.text).toContain(input.url);
    expect(mail.text).toContain("OSI reference: #3049");
  });

  // An email travels further than a page behind a session. Its input has no
  // field for a supplier, a buyer or an amount: what it cannot be given, it
  // cannot say.
  it("has nowhere to put a supplier, a buyer or a price", () => {
    const fields = Object.keys({ ...input, locale: "en" }).sort();
    expect(fields).toEqual(["greetingName", "kind", "locale", "reference", "url"]);
  });
});
