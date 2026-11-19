import { describe, expect, it } from "vitest";
import {
  MILESTONE_KINDS,
  MILESTONES,
  canComplete,
  isMilestoneKind,
  mayRecordMilestone,
  milestoneOwner,
  milestoneState,
  milestonesOpen,
  statusAfter,
  wasLate,
} from "@/lib/milestones";
import { canTransitionDeal } from "@/lib/deal-status";
import type { DossierAudience } from "@/lib/dossier";

const now = new Date("2026-12-10T15:00:00Z");

describe("the milestones of a dossier", () => {
  it("are four, in the order they happen", () => {
    expect([...MILESTONE_KINDS]).toEqual([
      "production_started",
      "production_finished",
      "shipped",
      "delivered",
    ]);
    expect(isMilestoneKind("shipped")).toBe(true);
    expect(isMilestoneKind("paid")).toBe(false);
  });

  // `transitionDeal` finally gets its callers — and only legal ones.
  it("move the dossier only along transitions the deal machine allows", () => {
    for (const milestone of MILESTONES) {
      if (milestone.to) {
        expect(canTransitionDeal(milestone.from, milestone.to), milestone.kind).toBe(true);
      }
    }
    expect(statusAfter("production_started")).toBe("in_production");
    expect(statusAfter("production_finished")).toBeNull();
    expect(statusAfter("shipped")).toBe("shipping");
    expect(statusAfter("delivered")).toBe("delivered");
  });

  it("never close or review a dossier: that is the buyer's act, then staff's", () => {
    const reached = MILESTONES.map((m) => m.to);
    expect(reached).not.toContain("reviewed");
    expect(reached).not.toContain("closed");
  });
});

// V27's gotcha: "Lateness is derived from planned_at, never a stored flag
// and never a cron."
describe("where a milestone stands", () => {
  it("is unplanned while nothing is known", () => {
    expect(milestoneState(null, now)).toBe("unplanned");
    expect(milestoneState({ plannedAt: null, completedAt: null }, now)).toBe("unplanned");
  });

  it("is planned until its day is over, and late from the next day — by itself", () => {
    const planned = { plannedAt: "2026-12-10T00:00:00.000Z", completedAt: null };
    // The planned day itself is not late, at any hour of it.
    expect(milestoneState(planned, new Date("2026-12-10T23:00:00Z"))).toBe("planned");
    expect(milestoneState(planned, new Date("2026-12-11T00:00:01Z"))).toBe("late");
    expect(milestoneState(planned, new Date("2026-12-09T08:00:00Z"))).toBe("planned");
  });

  it("is done once recorded, whatever the plan said", () => {
    expect(
      milestoneState(
        { plannedAt: "2026-12-01T00:00:00Z", completedAt: "2026-12-09T10:00:00Z" },
        now,
      ),
    ).toBe("done");
    expect(milestoneState({ plannedAt: null, completedAt: "2026-12-09T10:00:00Z" }, now)).toBe(
      "done",
    );
  });

  it("remembers that something done was done late", () => {
    expect(
      wasLate({ plannedAt: "2026-12-01T00:00:00Z", completedAt: "2026-12-03T10:00:00Z" }),
    ).toBe(true);
    // Done on the planned day, late in the evening: on time.
    expect(
      wasLate({ plannedAt: "2026-12-01T00:00:00Z", completedAt: "2026-12-01T22:00:00Z" }),
    ).toBe(false);
    expect(wasLate({ plannedAt: null, completedAt: "2026-12-03T10:00:00Z" })).toBe(false);
    expect(wasLate({ plannedAt: "2026-12-01T00:00:00Z", completedAt: null })).toBe(false);
  });
});

describe("who records a milestone", () => {
  const staff: DossierAudience = { kind: "staff" };
  const supplier: DossierAudience = { kind: "supplier", partyId: "p-s" };
  const buyer: DossierAudience = { kind: "buyer", partyId: "p-b" };
  const carrier: DossierAudience = { kind: "partner", partyId: "p-c", partnerKind: "transport" };

  it("lets the supplier record production, and nothing else", () => {
    expect(mayRecordMilestone(supplier, "production_started")).toBe(true);
    expect(mayRecordMilestone(supplier, "production_finished")).toBe(true);
    expect(mayRecordMilestone(supplier, "shipped")).toBe(false);
    expect(mayRecordMilestone(supplier, "delivered")).toBe(false);
  });

  // "Staff can enter the same update for a supplier off the platform."
  it("lets staff record every one, on the party's behalf", () => {
    for (const kind of MILESTONE_KINDS) expect(mayRecordMilestone(staff, kind), kind).toBe(true);
  });

  it("lets the buyer and a partner read, and record nothing", () => {
    for (const kind of MILESTONE_KINDS) {
      expect(mayRecordMilestone(buyer, kind), kind).toBe(false);
      expect(mayRecordMilestone(carrier, kind), kind).toBe(false);
    }
  });

  it("attributes production to the supplier and transport to the carrier", () => {
    expect(milestoneOwner("production_started")).toBe("supplier");
    expect(milestoneOwner("shipped")).toBe("carrier");
  });
});

describe("completing a milestone", () => {
  const facts = (patch: Partial<Parameters<typeof canComplete>[1]> = {}) => ({
    dealStatus: "contracting" as const,
    done: [],
    contractsSigned: true,
    ...patch,
  });

  it("starts production from a dossier under contract, with its contracts signed", () => {
    expect(canComplete("production_started", facts())).toBe("ok");
  });

  it("does not start production on a contract nobody signed", () => {
    expect(canComplete("production_started", facts({ contractsSigned: false }))).toBe(
      "contracts_pending",
    );
  });

  it("refuses a step whose earlier steps are not done", () => {
    expect(canComplete("shipped", facts({ dealStatus: "in_production" }))).toBe("out_of_order");
    expect(
      canComplete(
        "shipped",
        facts({ dealStatus: "in_production", done: ["production_started", "production_finished"] }),
      ),
    ).toBe("ok");
    expect(
      canComplete("delivered", facts({ dealStatus: "shipping", done: ["production_started"] })),
    ).toBe("out_of_order");
  });

  it("refuses a step from the wrong dossier status", () => {
    expect(canComplete("production_started", facts({ dealStatus: "open" }))).toBe("wrong_status");
    expect(
      canComplete(
        "production_finished",
        facts({ dealStatus: "contracting", done: ["production_started"] }),
      ),
    ).toBe("wrong_status");
  });

  it("does not record the same step twice", () => {
    expect(
      canComplete(
        "production_started",
        facts({ dealStatus: "in_production", done: ["production_started"] }),
      ),
    ).toBe("already_done");
  });

  it("walks a dossier from contracts to delivered", () => {
    let dealStatus: Parameters<typeof canComplete>[1]["dealStatus"] = "contracting";
    const done: (typeof MILESTONE_KINDS)[number][] = [];
    for (const kind of MILESTONE_KINDS) {
      expect(canComplete(kind, { dealStatus, done, contractsSigned: true }), kind).toBe("ok");
      done.push(kind);
      dealStatus = statusAfter(kind) ?? dealStatus;
    }
    expect(dealStatus).toBe("delivered");
  });
});

describe("when milestones can be touched", () => {
  it("from the day the dossier opens until it is delivered", () => {
    for (const status of ["open", "contracting", "in_production", "shipping"] as const) {
      expect(milestonesOpen(status), status).toBe(true);
    }
    for (const status of ["delivered", "reviewed", "closed", "cancelled"] as const) {
      expect(milestonesOpen(status), status).toBe(false);
    }
  });
});
