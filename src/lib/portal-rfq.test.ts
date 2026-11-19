import { describe, expect, it } from "vitest";
import {
  canDecline,
  canSubmitOffer,
  parseAmountToCents,
  portalRfqState,
  windowOpen,
  type PortalRfqFacts,
} from "@/lib/portal-rfq";

const open: PortalRfqFacts = {
  quoteStatus: "requested",
  declineReason: null,
  roundClosedAt: null,
  requestStatus: "soliciting",
};
const closedAt = new Date("2026-11-20T00:00:00Z");

describe("what a supplier is told about an RFQ", () => {
  it("is to answer while the window is open", () => {
    expect(portalRfqState(open)).toBe("to_answer");
  });

  it("is answered once their offer is in — and stays so whatever became of it", () => {
    for (const facts of [
      { ...open, quoteStatus: "received" as const },
      {
        ...open,
        quoteStatus: "received" as const,
        roundClosedAt: closedAt,
        requestStatus: "pack_review" as const,
      },
      {
        ...open,
        quoteStatus: "accepted" as const,
        roundClosedAt: closedAt,
        requestStatus: "report_ready" as const,
      },
      {
        ...open,
        quoteStatus: "expired" as const,
        roundClosedAt: closedAt,
        requestStatus: "report_ready" as const,
      },
      // Not retained: the portal's status does not say so (V17 tells them).
      {
        ...open,
        quoteStatus: "declined" as const,
        declineReason: "lost" as const,
        roundClosedAt: closedAt,
        requestStatus: "report_ready" as const,
      },
    ]) {
      expect(portalRfqState(facts)).toBe("answered");
    }
  });

  it("is declined only when THEY declined", () => {
    expect(
      portalRfqState({ ...open, quoteStatus: "declined", declineReason: "supplier_declined" }),
    ).toBe("declined");
  });

  // Each of these says something about the other suppliers or the buyer; the
  // supplier is told one word for all of them.
  it("is simply closed for every other ending", () => {
    for (const reason of ["no_response", "closed_before_deadline", "not_reached"] as const) {
      expect(
        portalRfqState({
          quoteStatus: "declined",
          declineReason: reason,
          roundClosedAt: closedAt,
          requestStatus: "pack_review",
        }),
      ).toBe("closed");
    }
    expect(portalRfqState({ ...open, roundClosedAt: closedAt, requestStatus: "pack_review" })).toBe(
      "closed",
    );
    expect(portalRfqState({ ...open, requestStatus: "cancelled" })).toBe("closed");
  });
});

describe("when the window takes answers", () => {
  it("needs the round open AND the request soliciting", () => {
    expect(windowOpen(open)).toBe(true);
    expect(windowOpen({ roundClosedAt: closedAt, requestStatus: "soliciting" })).toBe(false);
    expect(windowOpen({ roundClosedAt: null, requestStatus: "cancelled" })).toBe(false);
    expect(windowOpen({ roundClosedAt: null, requestStatus: "pack_review" })).toBe(false);
  });

  it("lets them answer, revise, and change their mind after declining", () => {
    expect(canSubmitOffer(open)).toBe(true);
    expect(canSubmitOffer({ ...open, quoteStatus: "received" })).toBe(true);
    expect(
      canSubmitOffer({ ...open, quoteStatus: "declined", declineReason: "supplier_declined" }),
    ).toBe(true);
  });

  it("takes nothing once the window is closed", () => {
    for (const quoteStatus of ["requested", "received", "declined"] as const) {
      expect(
        canSubmitOffer({
          quoteStatus,
          declineReason: quoteStatus === "declined" ? "supplier_declined" : null,
          roundClosedAt: closedAt,
          requestStatus: "pack_review",
        }),
      ).toBe(false);
    }
  });

  it("does not reopen a quote the ROUND declined, nor an accepted one", () => {
    expect(canSubmitOffer({ ...open, quoteStatus: "declined", declineReason: "no_response" })).toBe(
      false,
    );
    expect(canSubmitOffer({ ...open, quoteStatus: "declined", declineReason: "lost" })).toBe(false);
    expect(canSubmitOffer({ ...open, quoteStatus: "accepted" })).toBe(false);
  });

  it("lets them decline only what they have not answered, while it is open", () => {
    expect(canDecline(open)).toBe(true);
    expect(canDecline({ ...open, quoteStatus: "received" })).toBe(false);
    expect(canDecline({ ...open, roundClosedAt: closedAt })).toBe(false);
  });
});

describe("parseAmountToCents", () => {
  it("reads both decimal marks and whole amounts", () => {
    expect(parseAmountToCents("12.50")).toBe(1250);
    expect(parseAmountToCents("12,5")).toBe(1250);
    expect(parseAmountToCents("980")).toBe(98000);
    expect(parseAmountToCents("1 250,00")).toBe(125000);
    expect(parseAmountToCents("0.29")).toBe(29);
  });

  it("refuses what is not an amount rather than guessing", () => {
    for (const input of ["", "abc", "12.345", "-5", "1,2,3", "1e3", "12 USD"]) {
      expect(parseAmountToCents(input), input).toBeNull();
    }
  });
});
