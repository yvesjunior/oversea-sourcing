import { describe, expect, it } from "vitest";
import {
  buildReviewReport,
  formatWait,
  type ReportEvent,
  type ReportPack,
  type ReportRound,
} from "@/lib/pack-review-report";

const H = 3_600_000;
const T0 = Date.UTC(2026, 10, 1, 8, 0, 0);
const at = (hours: number) => new Date(T0 + hours * H).toISOString();

const pack = (id: string, over: Partial<ReportPack> = {}): ReportPack => ({
  id,
  requestId: `r-${id}`,
  status: "released",
  releasedAt: at(80),
  releasedByName: "Awa",
  ...over,
});
const event = (packId: string, action: ReportEvent["action"], hours: number): ReportEvent => ({
  packId,
  action,
  at: at(hours),
});
const round = (
  requestId: string,
  opened: number,
  closed: number | null,
  closeReason: string | null = "deadline",
): ReportRound => ({
  requestId,
  openedAt: at(opened),
  closedAt: closed === null ? null : at(closed),
  closeReason: closed === null ? null : closeReason,
});

const span = { from: T0 - 1000 * H, to: T0 + 1000 * H };

describe("what each decided pack counts as", () => {
  it("tells the five outcomes apart", () => {
    const report = buildReviewReport({
      ...span,
      packs: [
        pack("a"),
        pack("b"),
        pack("c"),
        pack("d", { status: "refused", releasedAt: null, releasedByName: null }),
        pack("e", { releasedByName: null }),
      ],
      events: [
        event("a", "approved", 80),
        event("b", "corrected", 80),
        event("c", "relaunched", 75),
        event("c", "approved", 80),
        event("d", "refused", 80),
        event("e", "auto_released", 80),
      ],
      rounds: [],
    });
    expect(report.outcomes).toEqual({
      untouched: 1,
      corrected: 1,
      relaunched: 1,
      refused: 1,
      automatic: 1,
    });
    // The system's release is in neither side of the ratio.
    expect(report.reviewed).toBe(4);
    expect(report.changed).toBe(3);
  });

  it("counts a correction after a relaunch once, as a correction", () => {
    const report = buildReviewReport({
      ...span,
      packs: [pack("a")],
      events: [event("a", "relaunched", 70), event("a", "corrected", 80)],
      rounds: [],
    });
    expect(report.outcomes.corrected).toBe(1);
    expect(report.outcomes.relaunched).toBe(0);
    expect(report.packs[0]?.relaunches).toBe(1);
  });

  // Taking a pack onto a desk, or the system holding an empty one, is not a
  // decision — and neither turns an untouched release into a changed one.
  it("is not moved by assignments or holds", () => {
    const report = buildReviewReport({
      ...span,
      packs: [pack("a")],
      events: [event("a", "held", 72), event("a", "assigned", 73), event("a", "approved", 80)],
      rounds: [],
    });
    expect(report.outcomes.untouched).toBe(1);
    expect(report.changed).toBe(0);
  });

  it("leaves out packs nobody at OSI decided", () => {
    const report = buildReviewReport({
      ...span,
      packs: [
        pack("pending", { status: "pending", releasedAt: null, releasedByName: null }),
        pack("withdrawn", { status: "withdrawn", releasedAt: null, releasedByName: null }),
      ],
      events: [event("pending", "relaunched", 75)],
      rounds: [],
    });
    expect(report.packs).toEqual([]);
    expect(report.reviewed).toBe(0);
    expect(report.waits).toBeNull();
  });

  it("reads a released pack with no event from the pack row itself", () => {
    const report = buildReviewReport({
      ...span,
      packs: [pack("person"), pack("system", { releasedByName: null })],
      events: [],
      rounds: [],
    });
    expect(report.outcomes.untouched).toBe(1);
    expect(report.outcomes.automatic).toBe(1);
  });
});

describe("the period", () => {
  it("keeps the packs DECIDED in the span, whenever they were built", () => {
    const packs = [pack("old", { releasedAt: at(10) }), pack("new", { releasedAt: at(80) })];
    const events = [event("old", "approved", 10), event("new", "approved", 80)];
    const report = buildReviewReport({
      packs,
      events,
      rounds: [],
      from: T0 + 50 * H,
      to: T0 + 100 * H,
    });
    expect(report.packs.map((entry) => entry.packId)).toEqual(["new"]);
  });

  it("dates a refusal by its event — the pack row has no instant for it", () => {
    const report = buildReviewReport({
      packs: [pack("a", { status: "refused", releasedAt: null, releasedByName: null })],
      events: [event("a", "refused", 60)],
      rounds: [],
      from: T0 + 50 * H,
      to: T0 + 100 * H,
    });
    expect(report.packs[0]?.decidedAt).toBe(at(60));
  });
});

describe("the two waits", () => {
  it("splits one round into its window and the desk after it", () => {
    const report = buildReviewReport({
      ...span,
      packs: [pack("a")],
      events: [event("a", "approved", 80)],
      rounds: [round("r-a", 0, 72)],
    });
    expect(report.packs[0]).toMatchObject({ windowMs: 72 * H, deskMs: 8 * H, totalMs: 80 * H });
  });

  // Round 1 (0→72), desk until the relaunch (72→76), round 2 (76→100), desk
  // until the release (100→103): two windows, two desks, one buyer waiting.
  it("adds every round and every desk of a relaunched pack", () => {
    const report = buildReviewReport({
      ...span,
      packs: [pack("a", { releasedAt: at(103) })],
      events: [event("a", "relaunched", 76), event("a", "approved", 103)],
      rounds: [round("r-a", 0, 72), round("r-a", 76, 100)],
    });
    expect(report.packs[0]).toMatchObject({ windowMs: 96 * H, deskMs: 7 * H, totalMs: 103 * H });
  });

  // An expired offer asked again gives the request a second pack; its wait
  // starts at the round opened after the first pack was sent.
  it("starts a second pack's wait after the first one was sent", () => {
    const report = buildReviewReport({
      ...span,
      packs: [
        pack("first", { requestId: "r", releasedAt: at(80) }),
        pack("second", { requestId: "r", releasedAt: at(250) }),
      ],
      events: [event("first", "approved", 80), event("second", "approved", 250)],
      rounds: [round("r", 0, 72), round("r", 200, 248)],
    });
    const second = report.packs.find((entry) => entry.packId === "second");
    expect(second).toMatchObject({ windowMs: 48 * H, deskMs: 2 * H, totalMs: 50 * H });
  });

  it("ignores a withdrawn round, an open one, and other requests' rounds", () => {
    const report = buildReviewReport({
      ...span,
      packs: [pack("a")],
      events: [event("a", "approved", 80)],
      rounds: [
        round("r-a", 0, 72),
        round("r-a", 73, 74, "withdrawn"),
        round("r-a", 75, null),
        round("elsewhere", 0, 10),
      ],
    });
    expect(report.packs[0]).toMatchObject({ windowMs: 72 * H, totalMs: 80 * H });
  });

  it("means the waits so that window + desk is the total", () => {
    const report = buildReviewReport({
      ...span,
      packs: [pack("a", { releasedAt: at(80) }), pack("b", { releasedAt: at(30) })],
      events: [event("a", "approved", 80), event("b", "auto_released", 30)],
      rounds: [round("r-a", 0, 72), round("r-b", 0, 30)],
    });
    expect(report.waits).toEqual({
      packs: 2,
      windowMs: 51 * H,
      deskMs: 4 * H,
      totalMs: 55 * H,
      longestMs: 80 * H,
    });
  });

  it("measures nothing for a pack no round can be tied to", () => {
    const report = buildReviewReport({
      ...span,
      packs: [pack("a")],
      events: [event("a", "approved", 80)],
      rounds: [],
    });
    expect(report.packs[0]).toMatchObject({ windowMs: null, deskMs: null, totalMs: null });
    expect(report.waits).toBeNull();
  });
});

describe("a wait, as printed", () => {
  it("does not round a short desk down to nothing", () => {
    expect(formatWait(20 * 60_000, "fr")).toBe("20 min");
    expect(formatWait(0, "fr")).toBe("0 min");
  });

  it("prints hours, then days and hours", () => {
    expect(formatWait(5 * H, "fr")).toBe("5 h");
    expect(formatWait(52 * H, "fr")).toBe("2 j 4 h");
    expect(formatWait(52 * H, "en")).toBe("2 d 4 h");
    expect(formatWait(null, "fr")).toBe("—");
  });
});
