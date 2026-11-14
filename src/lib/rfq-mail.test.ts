import { describe, expect, it } from "vitest";
import { buildRfqMail, formatDeadline, type RfqMailInput } from "@/lib/rfq-mail";

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
