import { describe, expect, it } from "vitest";
import {
  buildRfqClosedMail,
  buildRfqMail,
  buildRfqWithdrawnMail,
  formatDeadline,
  type RfqMailInput,
} from "@/lib/rfq-mail";

const base: RfqMailInput = {
  locale: "en",
  requestId: "3049",
  title: "roulements à billes acier chrome",
  description: "Nous cherchons des billes 100Cr6.\nQuantité : 50 000 pièces.",
  criteria: [
    { label: "Matériau", value: "acier chrome 100Cr6", valueEn: "chrome steel 100Cr6", unit: null },
    { label: "Quantité", value: "50 000", valueEn: null, unit: "pièces" },
  ],
  closesAt: new Date("2026-11-17T16:00:00Z"),
  greetingName: "Dana",
};

describe("the deadline", () => {
  // The reader may be anywhere. A deadline in OSI's own time zone would be
  // misread by most of the suppliers it is sent to.
  it("is always given in UTC, and says so", () => {
    expect(formatDeadline(new Date("2026-11-17T16:00:00Z"), "en")).toBe(
      "17 November 2026, 16:00 UTC",
    );
    expect(formatDeadline(new Date("2026-11-17T16:00:00Z"), "fr")).toBe(
      "17 novembre 2026 à 16:00 UTC",
    );
  });

  it("does not drift into the next day near midnight UTC", () => {
    expect(formatDeadline(new Date("2026-11-17T23:30:00Z"), "en")).toBe(
      "17 November 2026, 23:30 UTC",
    );
  });
});

describe("an RFQ in English", () => {
  const mail = buildRfqMail(base);

  it("carries the reference in the subject and asks to keep it", () => {
    expect(mail.subject).toBe("Request for quotation #3049 — roulements à billes acier chrome");
    expect(mail.text).toContain("Reference: #3049");
  });

  it("states the deadline once, in UTC", () => {
    expect(mail.text).toContain("Please send your offer by 17 November 2026, 16:00 UTC.");
  });

  it("gives the English form of a value when there is one, the original otherwise", () => {
    expect(mail.text).toContain("Matériau: chrome steel 100Cr6");
    expect(mail.text).toContain("Quantité: 50 000 pièces");
    expect(mail.text).not.toContain("acier chrome 100Cr6");
  });

  it("asks for the figures the offer form takes", () => {
    for (const field of ["Unit price and currency", "MOQ", "Lead time", "Incoterm", "valid"]) {
      expect(mail.text, field).toContain(field);
    }
  });

  it("greets the person when there is a name", () => {
    expect(mail.text.startsWith("Hello Dana,")).toBe(true);
    expect(buildRfqMail({ ...base, greetingName: null }).text.startsWith("Hello,")).toBe(true);
  });
});

describe("an RFQ in French", () => {
  const mail = buildRfqMail({ ...base, locale: "fr" });

  it("keeps the buyer's own wording for values", () => {
    expect(mail.subject).toBe("Appel d'offres #3049 — roulements à billes acier chrome");
    expect(mail.text).toContain("Matériau: acier chrome 100Cr6");
    expect(mail.text).toContain("au plus tard le 17 novembre 2026 à 16:00 UTC");
  });
});

describe("what it must not contain", () => {
  // The builder is never GIVEN the workspace, so it cannot print it. This
  // pins that down: a field added to the input later would have to be added
  // here on purpose.
  it("has no field through which the buyer's identity could arrive", () => {
    expect(Object.keys(base).sort()).toEqual([
      "closesAt",
      "criteria",
      "description",
      "greetingName",
      "locale",
      "requestId",
      "title",
    ]);
  });

  it("escapes the buyer's free text in the HTML version", () => {
    const mail = buildRfqMail({
      ...base,
      title: 'Valves <1/2"> & fittings',
      description: '<script>alert("x")</script>\nline two',
    });
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;<br>line two");
    expect(mail.html).toContain("Valves &lt;1/2&quot;&gt; &amp; fittings");
    // The plain version is what it is — no escaping there.
    expect(mail.text).toContain('<script>alert("x")</script>');
  });

  // A silent supplier is excluded, not chased (owner, 2026-10-24). The email
  // must not promise — or threaten — a follow-up that will never come.
  it("does not mention a reminder", () => {
    for (const locale of ["en", "fr"] as const) {
      const text = buildRfqMail({ ...base, locale }).text.toLowerCase();
      expect(text).not.toContain("reminder");
      expect(text).not.toContain("relance");
    }
  });

  it("leaves out the sections that would be empty", () => {
    const mail = buildRfqMail({ ...base, criteria: [], description: "   " });
    expect(mail.text).not.toContain("SPECIFICATIONS");
    expect(mail.text).not.toContain("own description");
    expect(mail.html).not.toContain("<ul></ul>");
  });
});

describe("the withdrawal notice", () => {
  const base = {
    requestId: "3049",
    title: "Roulements à billes",
    greetingName: "Mei",
  } as const;

  it("tells a supplier who had not answered to stop", () => {
    const mail = buildRfqWithdrawnMail({ ...base, locale: "en", answered: false });
    expect(mail.subject).toBe("Request for quotation #3049 withdrawn — Roulements à billes");
    expect(mail.text).toContain("Hello Mei,");
    expect(mail.text).toContain("has withdrawn the request");
    expect(mail.text).toContain("do not prepare or send an offer");
    expect(mail.text).not.toContain("Thank you for the offer");
  });

  it("thanks a supplier who had, and does not tell them not to bother", () => {
    const mail = buildRfqWithdrawnMail({ ...base, locale: "fr", answered: true });
    expect(mail.subject).toBe("Appel d'offres #3049 retiré — Roulements à billes");
    expect(mail.text).toContain("Merci pour l'offre");
    expect(mail.text).not.toContain("ne pas préparer");
  });

  it("asks for nothing: no deadline, no reply instructions", () => {
    for (const locale of ["en", "fr"] as const) {
      const mail = buildRfqWithdrawnMail({ ...base, locale, answered: false });
      expect(mail.text).not.toMatch(/UTC/);
      expect(mail.text).not.toMatch(/WHAT IS NEEDED|LE BESOIN/);
      expect(mail.text).not.toMatch(/Reply to this email|Répondez à ce courriel/);
      expect(mail.text).not.toMatch(/keep it in your reply|conserver dans votre réponse/);
    }
  });

  it("escapes the title in the HTML version", () => {
    const mail = buildRfqWithdrawnMail({
      ...base,
      title: "Vis <M8> & écrous",
      locale: "fr",
      answered: false,
    });
    expect(mail.html).toContain("Vis &lt;M8&gt; &amp; écrous");
  });
});

describe("the closing notice after a refusal", () => {
  const base = { requestId: "3049", title: "Roulements à billes", greetingName: "Mei" } as const;

  it("thanks the supplier and says no order will follow", () => {
    const mail = buildRfqClosedMail({ ...base, locale: "en" });
    expect(mail.subject).toBe("Request for quotation #3049 closed — Roulements à billes");
    expect(mail.text).toContain("Thank you for the offer");
    expect(mail.text).toContain("no order will follow");
  });

  it("claims neither that the client withdrew nor that the offer was not the reason", () => {
    for (const locale of ["en", "fr"] as const) {
      const { text } = buildRfqClosedMail({ ...base, locale });
      expect(text).not.toMatch(/withdrawn|retiré/i);
      expect(text).not.toMatch(/nothing to do with|ne tient pas à/i);
    }
  });

  it("asks for nothing", () => {
    const { text } = buildRfqClosedMail({ ...base, locale: "fr" });
    expect(text).not.toMatch(/UTC|Répondez à ce courriel/);
    expect(buildRfqClosedMail({ ...base, locale: "fr" }).subject).toBe(
      "Appel d'offres #3049 clos — Roulements à billes",
    );
  });
});

// V15 — the link that opens a supplier account.
describe("the portal link", () => {
  const url = "https://osi-solutions.com/portail/inscription/Tk9-abc_123";

  it("is absent when no link is given, and the email asks for a reply as before", () => {
    const mail = buildRfqMail(base);
    expect(mail.text).toContain("HOW TO ANSWER");
    expect(mail.text).toContain("Reply to this email with:");
    expect(mail.text).not.toContain("ANSWER ONLINE");
    expect(mail.text).not.toContain("/portail/");
  });

  it("comes first when given, and keeps the reply by email as the alternative", () => {
    const mail = buildRfqMail({ ...base, portalUrl: url });
    expect(mail.text).toContain(`ANSWER ONLINE\n`);
    expect(mail.text).toContain(url);
    expect(mail.text).toContain("Or reply to this email with:");
    expect(mail.text.indexOf("ANSWER ONLINE")).toBeLessThan(mail.text.indexOf("Or reply"));
    // Both ways stay: the fields to send by email are still listed.
    expect(mail.text).toContain("Unit price and currency");
  });

  it("is a real link in the HTML version, with the address escaped", () => {
    const mail = buildRfqMail({ ...base, portalUrl: `${url}?a=1&b=2` });
    expect(mail.html).toContain(`<a href="${url}?a=1&amp;b=2">${url}?a=1&amp;b=2</a>`);
  });

  it("is said in the recipient's language", () => {
    const mail = buildRfqMail({ ...base, locale: "fr", portalUrl: url });
    expect(mail.text).toContain("RÉPONDRE EN LIGNE");
    expect(mail.text).toContain("Ou répondez à ce courriel en indiquant :");
  });

  it("does not put the buyer, the supplier or an address in the link block", () => {
    const mail = buildRfqMail({ ...base, portalUrl: url });
    const block = mail.text.slice(
      mail.text.indexOf("ANSWER ONLINE"),
      mail.text.indexOf("Or reply"),
    );
    expect(block).not.toContain("@");
  });
});
