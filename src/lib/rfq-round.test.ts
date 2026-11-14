import { describe, expect, it } from "vitest";
import { ROUND_CLOSE_REASONS } from "@/database/schema";
import {
  answeredInRound,
  dueClose,
  lateAnswerOpen,
  leadsToReview,
  silentDeclineReason,
  targetReached,
} from "@/lib/rfq-round";

describe("silentDeclineReason", () => {
  it("is no_response only when the supplier was written to AND the window ran out", () => {
    expect(silentDeclineReason("deadline", true)).toBe("no_response");
  });

  it("never blames a supplier the RFQ did not reach — not even on the deadline", () => {
    for (const reason of ROUND_CLOSE_REASONS) {
      expect(silentDeclineReason(reason, false)).toBe("not_reached");
    }
  });

  it("never blames a supplier for a round OSI or the buyer cut short", () => {
    expect(silentDeclineReason("early", true)).toBe("closed_before_deadline");
    expect(silentDeclineReason("target_reached", true)).toBe("closed_before_deadline");
    expect(silentDeclineReason("withdrawn", true)).toBe("closed_before_deadline");
  });
});

describe("leadsToReview", () => {
  it("is true for every close but the buyer's withdrawal", () => {
    expect(ROUND_CLOSE_REASONS.filter((reason) => !leadsToReview(reason))).toEqual(["withdrawn"]);
  });
});

describe("targetReached", () => {
  it("closes on the target, and on more than the target", () => {
    expect(targetReached(4, 5)).toBe(false);
    expect(targetReached(5, 5)).toBe(true);
    expect(targetReached(6, 5)).toBe(true);
  });
});

describe("dueClose", () => {
  const now = new Date("2026-11-20T12:00:00Z");
  const open = {
    requestOver: false,
    offers: 2,
    targetOffers: 5,
    closesAt: new Date("2026-11-21T12:00:00Z"),
    now,
  };

  it("leaves a round alone while it has time and room", () => {
    expect(dueClose(open)).toBeNull();
  });

  it("closes on the deadline, to the instant", () => {
    expect(dueClose({ ...open, closesAt: now })).toBe("deadline");
    expect(dueClose({ ...open, closesAt: new Date(now.getTime() + 1) })).toBeNull();
  });

  it("prefers the target to the deadline when both hold", () => {
    expect(dueClose({ ...open, offers: 5, closesAt: new Date("2026-11-19T12:00:00Z") })).toBe(
      "target_reached",
    );
  });

  it("withdraws a round whose request is over, whatever the clock says", () => {
    expect(dueClose({ ...open, requestOver: true })).toBe("withdrawn");
    expect(
      dueClose({
        ...open,
        requestOver: true,
        offers: 5,
        closesAt: new Date("2026-11-19T12:00:00Z"),
      }),
    ).toBe("withdrawn");
  });

  it("closes a round with no offer at all when its time is up", () => {
    expect(dueClose({ ...open, offers: 0, closesAt: now })).toBe("deadline");
  });
});

describe("lateAnswerOpen", () => {
  const closedAt = new Date("2026-11-18T12:00:00Z");
  const open = {
    status: "declined",
    declineReason: "no_response",
    requestStatus: "pack_review",
    round: { closedAt, closeReason: "deadline" },
  } as const;

  it("is open on a quote its round declined as silent, while the pack is in review", () => {
    expect(lateAnswerOpen(open)).toBe(true);
    expect(
      lateAnswerOpen({
        ...open,
        declineReason: "closed_before_deadline",
        round: { closedAt, closeReason: "early" },
      }),
    ).toBe(true);
  });

  it("is closed for a supplier the RFQ never reached — they cannot have answered it", () => {
    expect(lateAnswerOpen({ ...open, declineReason: "not_reached" })).toBe(false);
  });

  it("is closed for a decline a person chose, or one the buyer's choice caused", () => {
    expect(lateAnswerOpen({ ...open, declineReason: "supplier_declined" })).toBe(false);
    expect(lateAnswerOpen({ ...open, declineReason: "lost" })).toBe(false);
    expect(lateAnswerOpen({ ...open, declineReason: null })).toBe(false);
  });

  it("is closed on anything that is not declined", () => {
    for (const status of ["requested", "received", "accepted", "expired"] as const) {
      expect(lateAnswerOpen({ ...open, status })).toBe(false);
    }
  });

  it("is closed outside a closed round", () => {
    expect(lateAnswerOpen({ ...open, round: null })).toBe(false);
    expect(lateAnswerOpen({ ...open, round: { closedAt: null, closeReason: null } })).toBe(false);
  });

  it("is closed when the buyer withdrew the request", () => {
    expect(
      lateAnswerOpen({
        ...open,
        declineReason: "closed_before_deadline",
        round: { closedAt, closeReason: "withdrawn" },
      }),
    ).toBe(false);
  });

  it("is closed once the request has left the pack review", () => {
    for (const requestStatus of [
      "soliciting",
      "report_ready",
      "unfulfilled",
      "cancelled",
      "closed",
    ] as const) {
      expect(lateAnswerOpen({ ...open, requestStatus })).toBe(false);
    }
  });
});

describe("answeredInRound", () => {
  const closedAt = new Date("2026-11-18T12:00:30Z");

  it("accepts an answer up to the instant the round closed", () => {
    expect(answeredInRound(new Date("2026-11-17T09:00:00Z"), closedAt)).toBe(true);
    expect(answeredInRound(closedAt, closedAt)).toBe(true);
  });

  it("refuses one that came after", () => {
    expect(answeredInRound(new Date(closedAt.getTime() + 1), closedAt)).toBe(false);
  });
});
