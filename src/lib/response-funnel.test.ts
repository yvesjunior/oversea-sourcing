import { describe, expect, it } from "vitest";
import {
  answeredInTime,
  countFunnel,
  funnelByRound,
  madeAnOffer,
  share,
  type FunnelRfq,
} from "@/lib/response-funnel";

const closes = new Date("2026-11-20T12:00:00Z");
const closedAt = new Date("2026-11-19T12:00:00Z"); // closed a day early
const base: FunnelRfq = {
  quoteId: "q",
  roundId: "r1",
  hasLink: true,
  opened: false,
  registered: false,
  status: "requested",
  declineReason: null,
  respondedAt: null,
  channel: null,
  roundClosesAt: closes,
  roundClosedAt: closedAt,
};
const at = (iso: string) => new Date(iso);

describe("madeAnOffer", () => {
  it("counts an offer whatever became of it", () => {
    expect(madeAnOffer({ status: "received", declineReason: null })).toBe(true);
    expect(madeAnOffer({ status: "accepted", declineReason: null })).toBe(true);
    expect(madeAnOffer({ status: "expired", declineReason: null })).toBe(true);
    // The buyer chose someone else: still a supplier who answered.
    expect(madeAnOffer({ status: "declined", declineReason: "lost" })).toBe(true);
  });

  it("does not count a refusal, a silence or an unanswered RFQ", () => {
    expect(madeAnOffer({ status: "declined", declineReason: "supplier_declined" })).toBe(false);
    expect(madeAnOffer({ status: "declined", declineReason: "no_response" })).toBe(false);
    expect(madeAnOffer({ status: "declined", declineReason: "closed_before_deadline" })).toBe(
      false,
    );
    expect(madeAnOffer({ status: "requested", declineReason: null })).toBe(false);
  });
});

describe("answeredInTime", () => {
  it("is before the deadline, or before an earlier close", () => {
    expect(answeredInTime({ ...base, respondedAt: at("2026-11-19T11:00:00Z") })).toBe(true);
    // After the early close, though before the deadline in the email.
    expect(answeredInTime({ ...base, respondedAt: at("2026-11-19T18:00:00Z") })).toBe(false);
    expect(
      answeredInTime({ ...base, roundClosedAt: null, respondedAt: at("2026-11-20T11:00:00Z") }),
    ).toBe(true);
    expect(
      answeredInTime({ ...base, roundClosedAt: null, respondedAt: at("2026-11-21T00:00:00Z") }),
    ).toBe(false);
  });

  it("is false with no answer time on record", () => {
    expect(answeredInTime(base)).toBe(false);
  });
});

describe("countFunnel", () => {
  const rfqs: FunnelRfq[] = [
    // Opened, registered, answered in the portal.
    {
      ...base,
      quoteId: "a",
      opened: true,
      registered: true,
      status: "received",
      channel: "portal",
      respondedAt: at("2026-11-19T10:00:00Z"),
    },
    // Opened the link, never registered, answered by email — typed by staff.
    {
      ...base,
      quoteId: "b",
      opened: true,
      status: "declined",
      declineReason: "lost",
      channel: "staff",
      respondedAt: at("2026-11-19T09:00:00Z"),
    },
    // Registered and said no.
    {
      ...base,
      quoteId: "c",
      opened: true,
      registered: true,
      status: "declined",
      declineReason: "supplier_declined",
      channel: "portal",
      respondedAt: at("2026-11-19T08:00:00Z"),
    },
    // Never opened anything; the window closed on them.
    { ...base, quoteId: "d", status: "declined", declineReason: "closed_before_deadline" },
    // Sent before the portal existed: no link. Answered, keyed in, no channel.
    {
      ...base,
      quoteId: "e",
      hasLink: false,
      status: "accepted",
      respondedAt: at("2026-11-18T09:00:00Z"),
    },
    // Another round, still open, nothing yet.
    { ...base, quoteId: "f", roundId: "r2", roundClosedAt: null },
  ];

  it("reads the funnel in order", () => {
    expect(countFunnel(rfqs)).toEqual({
      sent: 6,
      withLink: 5,
      opened: 3,
      registered: 2,
      answered: 3,
      answeredInTime: 3,
      answeredPortal: 1,
      answeredStaff: 2,
      declined: 1,
      silent: 1,
      pending: 1,
    });
  });

  it("puts every RFQ in exactly one ending", () => {
    const c = countFunnel(rfqs);
    expect(c.answered + c.declined + c.silent + c.pending).toBe(c.sent);
    expect(c.answeredPortal + c.answeredStaff).toBe(c.answered);
  });

  it("does not count an open link or a registration on an RFQ that had no link", () => {
    const c = countFunnel([{ ...base, hasLink: false, opened: true, registered: true }]);
    expect(c).toMatchObject({ withLink: 0, opened: 0, registered: 0 });
  });

  it("is all zeros for nothing", () => {
    const c = countFunnel([]);
    expect(Object.values(c).every((n) => n === 0)).toBe(true);
  });

  it("splits by round", () => {
    const rounds = funnelByRound(rfqs);
    expect(rounds.map((r) => [r.roundId, r.counts.sent])).toEqual([
      ["r1", 5],
      ["r2", 1],
    ]);
    expect(rounds[1]?.counts.pending).toBe(1);
  });
});

describe("share", () => {
  it("is a whole percentage, and nothing at all of nothing", () => {
    expect(share(2, 5)).toBe(40);
    expect(share(1, 3)).toBe(33);
    expect(share(0, 4)).toBe(0);
    expect(share(0, 0)).toBeNull();
  });
});
