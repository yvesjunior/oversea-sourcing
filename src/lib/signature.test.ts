import { describe, expect, it } from "vitest";
import { canRecordManual, canRemind, canSignInPlatform, mechanismFor } from "@/lib/signature";

const SENT = { status: "sent" } as const;
const STAFF = { workspaceId: "org-osi-internal", workspaceRole: "owner", maySignForOsi: true };
const BUYER = { workspaceId: "org-buyer", workspaceRole: "buyer", maySignForOsi: false };

const buyerParty = {
  role: "buyer" as const,
  organizationId: "org-buyer",
  signatureStatus: "pending",
};
const osiParty = { role: "osi" as const, organizationId: null, signatureStatus: "pending" };
const supplierParty = {
  role: "supplier" as const,
  organizationId: null,
  signatureStatus: "pending",
};

describe("mechanismFor", () => {
  it("puts the two account-holding parties in the platform", () => {
    expect(mechanismFor("buyer")).toBe("in_platform");
    expect(mechanismFor("osi")).toBe("in_platform");
  });

  it("puts everyone else on manual upload", () => {
    // Suppliers have no login (owner 2026-08-29) and neither do the parties
    // that join with the deferred contract types.
    for (const role of ["supplier", "carrier", "customs_broker", "inspector", "other"] as const) {
      expect(mechanismFor(role)).toBe("manual_upload");
    }
  });
});

describe("canSignInPlatform", () => {
  it("lets the buyer's workspace sign the buyer's line", () => {
    expect(canSignInPlatform(SENT, buyerParty, BUYER)).toBe("ok");
  });

  it("lets staff with the permission sign OSI's line", () => {
    expect(canSignInPlatform(SENT, osiParty, STAFF)).toBe("ok");
  });

  it("refuses staff without contracts.sign", () => {
    // Owner-only by default: a manager putting the company's name to a
    // commercial commitment is a real delegation, granted per role.
    expect(canSignInPlatform(SENT, osiParty, { ...STAFF, maySignForOsi: false })).toBe("forbidden");
  });

  it("refuses a viewer seat on the buyer's own line", () => {
    expect(canSignInPlatform(SENT, buyerParty, { ...BUYER, workspaceRole: "viewer" })).toBe(
      "forbidden",
    );
  });

  it("refuses another workspace's buyer line", () => {
    expect(canSignInPlatform(SENT, buyerParty, { ...BUYER, workspaceId: "org-someone-else" })).toBe(
      "not_your_party",
    );
    // Staff are not the buyer either — being staff does not make you a party.
    expect(canSignInPlatform(SENT, buyerParty, STAFF)).toBe("not_your_party");
  });

  it("refuses an external party outright", () => {
    expect(canSignInPlatform(SENT, supplierParty, STAFF)).toBe("external_party");
  });

  it("refuses a draft — nobody has seen the document yet", () => {
    expect(canSignInPlatform({ status: "draft" }, buyerParty, BUYER)).toBe("not_sent");
  });

  it("refuses a voided or expired contract", () => {
    expect(canSignInPlatform({ status: "voided" }, buyerParty, BUYER)).toBe("contract_closed");
    expect(canSignInPlatform({ status: "expired" }, buyerParty, BUYER)).toBe("contract_closed");
  });

  it("never records a second signature for the same party", () => {
    for (const status of ["signed", "declined"]) {
      expect(canSignInPlatform(SENT, { ...buyerParty, signatureStatus: status }, BUYER)).toBe(
        "already_recorded",
      );
    }
  });

  it("keeps signing available while the contract is partially signed", () => {
    expect(canSignInPlatform({ status: "partially_signed" }, buyerParty, BUYER)).toBe("ok");
  });
});

describe("canRecordManual", () => {
  it("lets staff record an external party's offline signature", () => {
    expect(canRecordManual(SENT, supplierParty, { maySignForOsi: true })).toBe("ok");
  });

  it("refuses staff without the permission", () => {
    expect(canRecordManual(SENT, supplierParty, { maySignForOsi: false })).toBe("forbidden");
  });

  it("refuses the in-platform parties — they sign for themselves", () => {
    // Staff uploading a PDF "for the buyer" would substitute a weaker
    // signature for the stronger one the buyer can give in-app.
    expect(canRecordManual(SENT, buyerParty, { maySignForOsi: true })).toBe("not_your_party");
    expect(canRecordManual(SENT, osiParty, { maySignForOsi: true })).toBe("not_your_party");
  });

  it("refuses a draft and a dead contract", () => {
    expect(canRecordManual({ status: "draft" }, supplierParty, { maySignForOsi: true })).toBe(
      "not_sent",
    );
    expect(canRecordManual({ status: "voided" }, supplierParty, { maySignForOsi: true })).toBe(
      "contract_closed",
    );
  });
});

describe("canRemind", () => {
  it("reminds a pending party on a live contract", () => {
    expect(canRemind(SENT, { signatureStatus: "pending" })).toBe(true);
    expect(canRemind({ status: "partially_signed" }, { signatureStatus: "pending" })).toBe(true);
  });

  it("does not chase someone who already answered", () => {
    expect(canRemind(SENT, { signatureStatus: "signed" })).toBe(false);
    expect(canRemind(SENT, { signatureStatus: "declined" })).toBe(false);
  });

  it("does not chase on a draft, a completed, or a dead contract", () => {
    for (const status of ["draft", "signed", "voided", "expired"] as const) {
      expect(canRemind({ status }, { signatureStatus: "pending" })).toBe(false);
    }
  });
});
