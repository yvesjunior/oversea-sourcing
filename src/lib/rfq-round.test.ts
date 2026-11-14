import { describe, expect, it } from "vitest";
import { ROUND_CLOSE_REASONS } from "@/database/schema";
import { dueClose, leadsToReview, silentDeclineReason, targetReached } from "@/lib/rfq-round";

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
