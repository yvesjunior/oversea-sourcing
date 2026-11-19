import { describe, expect, it } from "vitest";
import {
  canRecordManual,
  canRemind,
  canSignInPlatform,
  canSupplierSign,
  mechanismFor,
  signatureWays,
} from "@/lib/signature";

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

// ── V26: a supplier with an account signs its own line ──────────────────────
describe("canSupplierSign", () => {
  const sent = { status: "sent" as const };
  const line = (patch: Partial<Parameters<typeof canSupplierSign>[1]> = {}) => ({
    role: "supplier" as const,
    organizationId: null,
    supplierId: "sup-1",
    signatureStatus: "pending",
    ...patch,
  });
  const me = { supplierIds: ["sup-1"] };

  it("lets a supplier's account sign that supplier's line, when the setting is on", () => {
    expect(canSupplierSign(sent, line(), me, true)).toBe("ok");
    expect(canSupplierSign({ status: "partially_signed" }, line(), me, true)).toBe("ok");
  });

  // Off by default: the legal question about an external party's signature
  // in the platform is not settled by shipping the code.
  it("refuses while the setting is off", () => {
    expect(canSupplierSign(sent, line(), me, false)).toBe("feature_off");
  });

  it("refuses another supplier's line — and says nothing about the setting", () => {
    expect(canSupplierSign(sent, line({ supplierId: "sup-2" }), me, true)).toBe("not_your_party");
    expect(canSupplierSign(sent, line({ supplierId: "sup-2" }), me, false)).toBe("not_your_party");
    expect(canSupplierSign(sent, line({ supplierId: null }), me, true)).toBe("not_your_party");
    expect(canSupplierSign(sent, line(), { supplierIds: [] }, true)).toBe("not_your_party");
  });

  it("refuses every line that is not a supplier's", () => {
    for (const role of [
      "buyer",
      "osi",
      "carrier",
      "customs_broker",
      "inspector",
      "other",
    ] as const) {
      expect(canSupplierSign(sent, line({ role }), me, true), role).toBe("not_your_party");
    }
  });

  it("refuses a draft, a dead contract, and a line already signed", () => {
    expect(canSupplierSign({ status: "draft" }, line(), me, true)).toBe("not_sent");
    expect(canSupplierSign({ status: "voided" }, line(), me, true)).toBe("contract_closed");
    expect(canSupplierSign({ status: "expired" }, line(), me, true)).toBe("contract_closed");
    expect(canSupplierSign(sent, line({ signatureStatus: "signed" }), me, true)).toBe(
      "already_recorded",
    );
  });
});

describe("the two ways a supplier's signature is obtained", () => {
  const facts = (enabled: boolean, account: boolean) => ({
    supplierSignatureEnabled: enabled,
    supplierHasAccount: account,
  });

  it("keeps the paper route open for a supplier in every case — both stay", () => {
    for (const enabled of [true, false]) {
      for (const account of [true, false]) {
        expect(signatureWays("supplier", facts(enabled, account)).manual).toBe(true);
      }
    }
    // And staff can still record it: the rule that says so did not move.
    expect(
      canRecordManual(
        { status: "sent" },
        { role: "supplier", organizationId: null, signatureStatus: "pending" },
        { maySignForOsi: true },
      ),
    ).toBe("ok");
  });

  it("opens the portal route only with the setting on AND an account", () => {
    expect(signatureWays("supplier", facts(true, true)).inPlatform).toBe(true);
    expect(signatureWays("supplier", facts(true, false)).inPlatform).toBe(false);
    expect(signatureWays("supplier", facts(false, true)).inPlatform).toBe(false);
  });

  it("changes nothing for the buyer, OSI, or the other external parties", () => {
    for (const role of ["buyer", "osi"] as const) {
      expect(signatureWays(role, facts(true, true))).toEqual({ inPlatform: true, manual: false });
    }
    for (const role of ["carrier", "customs_broker", "inspector", "other"] as const) {
      expect(signatureWays(role, facts(true, true))).toEqual({ inPlatform: false, manual: true });
    }
  });
});
