import { describe, expect, it } from "vitest";
import {
  PERFORMANCE_WEIGHTS,
  aggregatePerformance,
  performanceAdjustment,
  performanceFacts,
} from "@/lib/supplier-performance";

const step =
  (kind: "production_started" | "production_finished" | "shipped" | "delivered") =>
  (plannedAt: string | null, completedAt: string | null) => ({ kind, plannedAt, completedAt });

describe("the facts of one closed dossier", () => {
  const base = {
    sentAt: new Date("2026-11-01T08:00:00Z"),
    respondedAt: new Date("2026-11-02T20:00:00Z"),
    milestones: [],
    satisfaction: 4,
    issues: [],
  };

  it("measures how long the supplier took to answer", () => {
    expect(performanceFacts(base).responseHours).toBe(36);
    expect(performanceFacts({ ...base, sentAt: null }).responseHours).toBeNull();
    // An answer keyed in as earlier than the send is not a response time.
    expect(
      performanceFacts({ ...base, respondedAt: new Date("2026-10-30T08:00:00Z") }).responseHours,
    ).toBeNull();
  });

  it("counts the supplier's OWN steps against their plan — and no other party's", () => {
    const facts = performanceFacts({
      ...base,
      milestones: [
        step("production_started")("2026-12-01T00:00:00Z", "2026-12-01T10:00:00Z"), // on time
        step("production_finished")("2026-12-10T00:00:00Z", "2026-12-14T10:00:00Z"), // late
        // The carrier shipped late: recorded on the dossier, held against nobody.
        step("shipped")("2026-12-15T00:00:00Z", "2026-12-20T10:00:00Z"),
        step("delivered")("2026-12-30T00:00:00Z", "2027-01-05T10:00:00Z"),
      ],
    });
    expect(facts.supplierStepsPlanned).toBe(2);
    expect(facts.supplierStepsLate).toBe(1);
    expect(facts.deliveredLate).toBe(true);
  });

  it("does not call a step late when no day was planned for it", () => {
    const facts = performanceFacts({
      ...base,
      milestones: [
        step("production_started")(null, "2026-12-01T10:00:00Z"),
        step("delivered")(null, "2026-12-30T10:00:00Z"),
      ],
    });
    expect(facts.supplierStepsPlanned).toBe(0);
    expect(facts.supplierStepsLate).toBe(0);
    expect(facts.deliveredLate).toBeNull();
  });

  it("counts the issues, and how each ended", () => {
    const facts = performanceFacts({
      ...base,
      issues: [{ status: "resolved" }, { status: "resolved" }, { status: "disputed" }],
    });
    expect([facts.issuesRaised, facts.issuesResolved, facts.issuesDisputed]).toEqual([3, 2, 1]);
  });
});

describe("a supplier's history, summed up", () => {
  const deal = (supplierStepsLate: number, satisfaction: number | null, issuesDisputed = 0) => ({
    supplierStepsLate,
    satisfaction,
    issuesDisputed,
  });

  // No history is not a clean history.
  it("is nothing at all for a supplier with no closed deal", () => {
    expect(aggregatePerformance([])).toBeNull();
    expect(performanceAdjustment(null)).toEqual({ points: 0, reasons: [] });
    expect(performanceAdjustment(undefined)).toEqual({ points: 0, reasons: [] });
  });

  it("counts a deal as late once, however many of its steps were", () => {
    expect(aggregatePerformance([deal(2, 4), deal(0, 5), deal(1, 3)])).toEqual({
      deals: 3,
      lateDeals: 2,
      satisfactionAvg: 4,
      disputedIssues: 0,
    });
  });

  it("averages satisfaction over the deals that have one", () => {
    expect(aggregatePerformance([deal(0, 5), deal(0, null), deal(0, 4)])?.satisfactionAvg).toBe(
      4.5,
    );
    expect(aggregatePerformance([deal(0, null)])?.satisfactionAvg).toBeNull();
  });
});

// The gotcha: "Store the facts per deal and derive the score; a stored score
// cannot be re-weighted when the formula changes."
describe("what the history is worth", () => {
  const w = PERFORMANCE_WEIGHTS;

  it("removes points per late deal, up to a cap", () => {
    const two = performanceAdjustment({
      deals: 2,
      lateDeals: 2,
      satisfactionAvg: null,
      disputedIssues: 0,
    });
    expect(two.points).toBe(-2 * w.lateDeal);
    expect(two.reasons).toEqual([{ key: "late", deals: 2, points: -10 }]);
    const many = performanceAdjustment({
      deals: 9,
      lateDeals: 9,
      satisfactionAvg: null,
      disputedIssues: 0,
    });
    expect(many.points).toBe(-w.lateCap);
  });

  it("moves with satisfaction around the middle of the scale", () => {
    const at = (avg: number) =>
      performanceAdjustment({ deals: 1, lateDeals: 0, satisfactionAvg: avg, disputedIssues: 0 })
        .points;
    expect(at(5)).toBe(4);
    expect(at(1)).toBe(-4);
    expect(at(3)).toBe(0);
    // A middling average is said by nothing at all — not by a "+0".
    expect(
      performanceAdjustment({ deals: 1, lateDeals: 0, satisfactionAvg: 3, disputedIssues: 0 })
        .reasons,
    ).toEqual([]);
  });

  it("removes points for issues that ended disputed, up to a cap", () => {
    const one = performanceAdjustment({
      deals: 1,
      lateDeals: 0,
      satisfactionAvg: null,
      disputedIssues: 1,
    });
    expect(one.points).toBe(-w.disputedIssue);
    const many = performanceAdjustment({
      deals: 5,
      lateDeals: 0,
      satisfactionAvg: null,
      disputedIssues: 8,
    });
    expect(many.points).toBe(-w.disputedCap);
  });

  it("gives every reason with the points it moved, and they add up", () => {
    const result = performanceAdjustment({
      deals: 3,
      lateDeals: 1,
      satisfactionAvg: 4.5,
      disputedIssues: 1,
    });
    expect(result.reasons.map((r) => r.key)).toEqual(["late", "satisfaction", "disputed"]);
    expect(result.points).toBe(result.reasons.reduce((sum, r) => sum + r.points, 0));
    expect(result.points).toBe(-5 + 3 - 3);
  });

  // A history orders suppliers that fit about equally; it must stay small
  // beside what fitting the need is worth.
  it("can never move a score by more than the criteria are worth", () => {
    const worst = performanceAdjustment({
      deals: 20,
      lateDeals: 20,
      satisfactionAvg: 1,
      disputedIssues: 20,
    });
    expect(worst.points).toBe(-(w.lateCap + 2 * w.satisfactionStep + w.disputedCap));
    expect(Math.abs(worst.points)).toBeLessThan(55);
  });
});
