import { describe, expect, it } from "vitest";
import {
  canTransitionContract,
  canTransitionDeal,
  canTransitionQuote,
  contractFilter,
  isExpired,
  signatureProgress,
  statusFromSignatures,
  awaitsBuyerReview,
  awaitsStaffClosure,
} from "@/lib/deal-status";

const party = (required: boolean, signatureStatus: string) => ({ required, signatureStatus });

describe("quote transitions", () => {
  it("walks the normal path", () => {
    expect(canTransitionQuote("requested", "received")).toBe(true);
    expect(canTransitionQuote("received", "accepted")).toBe(true);
  });

  it("cannot accept an offer that never came back", () => {
    expect(canTransitionQuote("requested", "accepted")).toBe(false);
  });

  it("an accepted offer is terminal — no re-acceptance, no swap", () => {
    // "Pas de répartitions" (owner 2026-08-29): changing supplier means a new
    // request. The DB enforces one accepted quote per request too.
    expect(canTransitionQuote("accepted", "declined")).toBe(false);
    expect(canTransitionQuote("accepted", "received")).toBe(false);
  });
});

describe("deal closure is two acts by two actors", () => {
  it("the buyer reviews before staff can close", () => {
    expect(canTransitionDeal("delivered", "reviewed")).toBe(true);
    expect(canTransitionDeal("reviewed", "closed")).toBe(true);
  });

  it("staff cannot close over a buyer who has not spoken", () => {
    expect(canTransitionDeal("delivered", "closed")).toBe(false);
    expect(canTransitionDeal("shipping", "closed")).toBe(false);
  });

  it("names who is being waited on", () => {
    expect(awaitsBuyerReview("delivered")).toBe(true);
    expect(awaitsStaffClosure("delivered")).toBe(false);
    expect(awaitsStaffClosure("reviewed")).toBe(true);
  });

  it("a closed dossier is terminal", () => {
    expect(canTransitionDeal("closed", "open")).toBe(false);
    expect(canTransitionDeal("closed", "cancelled")).toBe(false);
  });
});

describe("contract status follows the party rows", () => {
  it("is signed only when every MANDATORY party has signed", () => {
    expect(
      statusFromSignatures([party(true, "signed"), party(true, "signed"), party(false, "pending")]),
    ).toBe("signed");
  });

  it("an optional signature alone does not complete a contract", () => {
    expect(statusFromSignatures([party(true, "pending"), party(false, "signed")])).toBe(
      "partially_signed",
    );
  });

  it("nothing signed yet stays sent", () => {
    expect(statusFromSignatures([party(true, "pending"), party(true, "pending")])).toBe("sent");
  });
});

describe("the 2/4 indicator counts mandatory signatures only", () => {
  it("ignores optional parties on both sides of the fraction", () => {
    const parties = [
      party(true, "signed"),
      party(true, "signed"),
      party(true, "pending"),
      party(true, "pending"),
      party(false, "signed"),
    ];
    expect(signatureProgress(parties)).toEqual({ signed: 2, required: 4 });
  });
});

describe("expiry is read-time", () => {
  const yesterday = new Date("2026-08-28T00:00:00Z");
  const now = new Date("2026-08-29T00:00:00Z");

  it("expires a contract whose échéance has passed", () => {
    expect(isExpired({ status: "sent", dueAt: yesterday }, now)).toBe(true);
  });

  it("never expires a signed or voided contract", () => {
    expect(isExpired({ status: "signed", dueAt: yesterday }, now)).toBe(false);
    expect(isExpired({ status: "voided", dueAt: yesterday }, now)).toBe(false);
  });

  it("a contract with no échéance never expires", () => {
    expect(isExpired({ status: "sent", dueAt: null }, now)).toBe(false);
  });
});

describe("the brief's list filters are derived", () => {
  const now = new Date("2026-08-29T00:00:00Z");
  const past = new Date("2026-08-28T00:00:00Z");

  it("expiry wins over everything else", () => {
    expect(
      contractFilter({ status: "partially_signed", dueAt: past }, [party(true, "signed")], now),
    ).toBe("expires");
  });

  it("signed lands in complétés", () => {
    expect(contractFilter({ status: "signed", dueAt: null }, [party(true, "signed")], now)).toBe(
      "completes",
    );
  });

  it("sent with nothing signed is en attente, with one signature is à signer", () => {
    const two = [party(true, "pending"), party(true, "pending")];
    expect(contractFilter({ status: "sent", dueAt: null }, two, now)).toBe("en_attente");
    const one = [party(true, "signed"), party(true, "pending")];
    expect(contractFilter({ status: "sent", dueAt: null }, one, now)).toBe("a_signer");
  });

  it("a draft is active, not waiting on anyone", () => {
    expect(contractFilter({ status: "draft", dueAt: null }, [], now)).toBe("actifs");
  });
});

describe("contract transitions", () => {
  it("cannot go straight from draft to signed", () => {
    expect(canTransitionContract("draft", "signed")).toBe(false);
  });

  it("a signed contract is immutable", () => {
    expect(canTransitionContract("signed", "voided")).toBe(false);
    expect(canTransitionContract("signed", "expired")).toBe(false);
  });

  it("an expired contract can still be voided for tidiness", () => {
    expect(canTransitionContract("expired", "voided")).toBe(true);
  });
});
