import { describe, expect, it } from "vitest";
import {
  acceptResearchedEmail,
  emailMatchesWebsite,
  isPlausibleEmail,
  normalizeEmail,
} from "@/lib/supplier-contact";

describe("an address, as typed", () => {
  it("is trimmed and lower-cased before anything compares it", () => {
    expect(normalizeEmail("  Sales@Acme.COM ")).toBe("sales@acme.com");
  });

  it("is accepted when it has the shape of one", () => {
    expect(isPlausibleEmail("sales@acme.com")).toBe(true);
    expect(isPlausibleEmail("j.doe+rfq@eu.acme.co.kr")).toBe(true);
  });

  it("is refused when it does not", () => {
    for (const bad of ["", "acme.com", "sales@", "@acme.com", "sales@acme", "a b@acme.com"]) {
      expect(isPlausibleEmail(bad), bad).toBe(false);
    }
    expect(isPlausibleEmail(`${"a".repeat(250)}@acme.com`)).toBe(false);
  });
});

describe("whose address it is", () => {
  it("matches the site's own domain, with or without www and scheme", () => {
    expect(emailMatchesWebsite("sales@acme.com", "https://www.acme.com/contact")).toBe(true);
    expect(emailMatchesWebsite("sales@acme.com", "acme.com")).toBe(true);
    expect(emailMatchesWebsite("SALES@ACME.COM", "http://ACME.com")).toBe(true);
  });

  it("matches across a subdomain, in either direction", () => {
    expect(emailMatchesWebsite("sales@acme.com", "https://shop.acme.com")).toBe(true);
    expect(emailMatchesWebsite("info@eu.acme.com", "https://acme.com")).toBe(true);
  });

  it("does not match another company, however similar the name", () => {
    expect(emailMatchesWebsite("sales@acme-industrial.com", "https://acme.com")).toBe(false);
    expect(emailMatchesWebsite("sales@notacme.com", "https://acme.com")).toBe(false);
    expect(emailMatchesWebsite("acme@gmail.com", "https://acme.com")).toBe(false);
  });

  it("has no answer without a usable website", () => {
    expect(emailMatchesWebsite("sales@acme.com", null)).toBe(false);
    expect(emailMatchesWebsite("sales@acme.com", "")).toBe(false);
    expect(emailMatchesWebsite("sales@acme.com", "not a url at all")).toBe(false);
  });
});

describe("an address the research pass reports", () => {
  it("is kept when it is on the supplier's own domain", () => {
    expect(acceptResearchedEmail(" Sales@Hy-Lok.com ", "https://www.hy-lok.com")).toBe(
      "sales@hy-lok.com",
    );
  });

  // The whole reason for the gate: a guess looks exactly like "sales@" plus
  // the company's name, and a directory's address is not the supplier's.
  it("is dropped when it is on someone else's domain", () => {
    expect(acceptResearchedEmail("hylok@gmail.com", "https://www.hy-lok.com")).toBeNull();
    expect(acceptResearchedEmail("leads@thomasnet.com", "https://www.hy-lok.com")).toBeNull();
  });

  it("is dropped when no website was reported to check it against", () => {
    expect(acceptResearchedEmail("sales@hy-lok.com", null)).toBeNull();
  });

  it("is dropped when nobody reads that mailbox", () => {
    for (const local of ["noreply", "no-reply", "donotreply", "do-not-reply", "postmaster"]) {
      expect(acceptResearchedEmail(`${local}@acme.com`, "acme.com"), local).toBeNull();
    }
  });

  it("is dropped when it is not an address, or not there at all", () => {
    expect(acceptResearchedEmail("contact us via the form", "acme.com")).toBeNull();
    expect(acceptResearchedEmail("", "acme.com")).toBeNull();
    expect(acceptResearchedEmail(null, "acme.com")).toBeNull();
    expect(acceptResearchedEmail(undefined, "acme.com")).toBeNull();
  });
});

describe("a storefront on someone else's domain", () => {
  it("does not make the marketplace's address the supplier's", () => {
    expect(emailMatchesWebsite("service@alibaba.com", "https://acme.en.alibaba.com")).toBe(false);
    expect(emailMatchesWebsite("info@made-in-china.com", "acme.en.made-in-china.com")).toBe(false);
    expect(acceptResearchedEmail("sales@alibaba.com", "https://acme.en.alibaba.com")).toBeNull();
  });

  it("nor an address on a site builder's domain", () => {
    expect(emailMatchesWebsite("hello@wixsite.com", "https://acme.wixsite.com/home")).toBe(false);
    expect(emailMatchesWebsite("acme@acme.myshopify.com", "acme.myshopify.com")).toBe(false);
  });

  it("still accepts a supplier's own domain, including one that merely resembles a shared host", () => {
    expect(emailMatchesWebsite("sales@acme.com", "https://shop.acme.com")).toBe(true);
    expect(emailMatchesWebsite("sales@notalibaba.com", "https://www.notalibaba.com")).toBe(true);
  });
});
