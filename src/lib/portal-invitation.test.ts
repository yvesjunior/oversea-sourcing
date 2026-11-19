import { describe, expect, it } from "vitest";
import {
  INVITATION_TTL_DAYS,
  invitationExpiry,
  invitationOffer,
  invitationState,
  registrationPath,
} from "@/lib/portal-invitation";

const now = new Date("2026-11-18T12:00:00Z");
const later = new Date("2026-12-01T00:00:00Z");
const earlier = new Date("2026-11-01T00:00:00Z");

describe("invitationState", () => {
  it("is unknown when no row has the token", () => {
    expect(invitationState(null, now)).toBe("unknown");
  });

  it("is valid until its expiry, and expired from that instant", () => {
    expect(invitationState({ expiresAt: later, registeredUserId: null }, now)).toBe("valid");
    expect(invitationState({ expiresAt: now, registeredUserId: null }, now)).toBe("expired");
    expect(invitationState({ expiresAt: earlier, registeredUserId: null }, now)).toBe("expired");
  });

  it("is used once it made an account — even after its expiry", () => {
    expect(invitationState({ expiresAt: later, registeredUserId: "u1" }, now)).toBe("used");
    expect(invitationState({ expiresAt: earlier, registeredUserId: "u1" }, now)).toBe("used");
  });
});

describe("invitationOffer", () => {
  it("registers when nobody holds the address", () => {
    expect(invitationOffer(null)).toBe("register");
    expect(invitationOffer(undefined)).toBe("register");
  });

  it("attaches to a supplier account rather than making a second one", () => {
    expect(invitationOffer("supplier")).toBe("attach");
  });

  it("refuses when the address belongs to a customer, a partner, or anything else", () => {
    for (const type of ["individual", "organization", "partner", "", "admin"]) {
      expect(invitationOffer(type), type).toBe("conflict");
    }
  });
});

describe("the link", () => {
  it("lasts thirty days from the send", () => {
    expect(INVITATION_TTL_DAYS).toBe(30);
    expect(invitationExpiry(new Date("2026-11-01T00:00:00Z")).toISOString()).toBe(
      "2026-12-01T00:00:00.000Z",
    );
  });

  it("carries the token and nothing that identifies anyone", () => {
    expect(registrationPath("abc123")).toBe("/portail/inscription/abc123");
  });
});
