import { describe, expect, it } from "vitest";
import {
  autoReleaseHold,
  packOfferState,
  planCorrection,
  projectPack,
  relaunchState,
  samePackItems,
  selectPackItems,
  type PackItemRow,
  type PackOfferSnapshot,
  type PackRow,
  type RankedOffer,
} from "@/lib/decision-pack";

const snapshot = (patch: Partial<PackOfferSnapshot> = {}): PackOfferSnapshot => ({
  supplierName: "Acme",
  supplierCountry: "CN",
  supplierVerification: "verified",
  amountCents: 100_000,
  currency: "USD",
  quantity: null,
  moq: null,
  leadTimeDays: 30,
  incoterm: "FOB",
  paymentTerms: null,
  validUntil: "2026-12-18T12:00:00.000Z",
  respondedAt: "2026-11-17T09:00:00.000Z",
  channel: "staff",
  ...patch,
});

const ranked = (
  quoteId: string,
  rank: number,
  patch?: Partial<PackOfferSnapshot>,
): RankedOffer => ({
  quoteId,
  kpiResultId: `k-${quoteId}`,
  rank,
  offer: snapshot(patch),
});

describe("selectPackItems", () => {
  it("keeps the ranking's order, whatever order the rows arrive in", () => {
    const items = selectPackItems([ranked("c", 3), ranked("a", 1), ranked("b", 2)], 5);
    expect(items.map((item) => item.quoteId)).toEqual(["a", "b", "c"]);
  });

  it("holds at most the round's target, taken from the top", () => {
    const seven = Array.from({ length: 7 }, (_, i) => ranked(`q${i + 1}`, i + 1));
    const items = selectPackItems(seven, 5);
    expect(items).toHaveLength(5);
    expect(items.map((item) => item.rankComputed)).toEqual([1, 2, 3, 4, 5]);
  });

  it("holds fewer when fewer offers came in — and none when none did", () => {
    expect(selectPackItems([ranked("a", 1), ranked("b", 2)], 5)).toHaveLength(2);
    expect(selectPackItems([], 5)).toEqual([]);
  });

  it("shows each offer where it was computed, until a person says otherwise", () => {
    for (const item of selectPackItems([ranked("a", 1), ranked("b", 2)], 5)) {
      expect(item.rankShown).toBe(item.rankComputed);
    }
  });

  it("points each item at the ranking row it came from", () => {
    expect(selectPackItems([ranked("a", 1)], 5)[0]?.kpiResultId).toBe("k-a");
  });
});

describe("samePackItems", () => {
  const desired = selectPackItems([ranked("a", 1), ranked("b", 2)], 5);

  it("is true for the same items, in any stored order", () => {
    expect(samePackItems([...desired].reverse(), desired)).toBe(true);
  });

  it("is false when the set, the order, a figure or the ranking row changed", () => {
    expect(samePackItems(desired.slice(0, 1), desired)).toBe(false);
    expect(samePackItems(selectPackItems([ranked("b", 1), ranked("a", 2)], 5), desired)).toBe(
      false,
    );
    expect(
      samePackItems(
        selectPackItems([ranked("a", 1, { amountCents: 99_000 }), ranked("b", 2)], 5),
        desired,
      ),
    ).toBe(false);
    expect(
      samePackItems(
        desired.map((item) => ({ ...item, kpiResultId: `new-${item.quoteId}` })),
        desired,
      ),
    ).toBe(false);
  });

  it("notices a change the ranking does not depend on — payment terms", () => {
    const changed = selectPackItems(
      [ranked("a", 1, { paymentTerms: "30 % à la commande" }), ranked("b", 2)],
      5,
    );
    expect(samePackItems(changed, desired)).toBe(false);
  });

  it("does not see a difference between a missing field and a null one", () => {
    const stored = desired.map((item) => {
      const offer = { ...item.offer } as Partial<PackOfferSnapshot>;
      delete offer.quantity;
      return { ...item, offer: offer as PackOfferSnapshot };
    });
    expect(samePackItems(stored, desired)).toBe(true);
  });
});

describe("projectPack", () => {
  const pack = (status: PackRow["status"]): PackRow => ({
    id: "p1",
    requestId: "3049",
    roundId: "r1",
    status,
    releaseMode: "manual",
    kpiRunId: "run-1",
    builtAt: "2026-11-18T12:00:01.000Z",
    createdAt: "2026-11-18T12:00:00.000Z",
    releasedAt: status === "released" ? "2026-11-19T09:00:00.000Z" : null,
    releasedByName: status === "released" ? "Dana" : null,
    refusedReason: status === "refused" ? "hors spécification" : null,
    assignedTo: "u1",
    assignedToName: "Dana",
  });
  // Corrected: the second by KPI #2 is shown first.
  const items: PackItemRow[] = [
    {
      quoteId: "a",
      rankComputed: 1,
      rankShown: 2,
      offer: snapshot({ supplierName: "A" }),
      reason: null,
    },
    {
      quoteId: "b",
      rankComputed: 2,
      rankShown: 1,
      offer: snapshot({ supplierName: "B" }),
      reason: null,
    },
  ];

  it("gives the buyer nothing of a pack that is still pending, or was refused", () => {
    expect(projectPack(pack("pending"), items, "buyer")).toBeNull();
    expect(projectPack(pack("refused"), items, "buyer")).toBeNull();
  });

  it("gives the buyer a released pack in the order SHOWN", () => {
    const view = projectPack(pack("released"), items, "buyer");
    expect(view?.items.map((item) => item.offer.supplierName)).toEqual(["B", "A"]);
    expect(view?.items.map((item) => item.rank)).toEqual([1, 2]);
  });

  it("never gives the buyer the computed order or the internals", () => {
    const view = projectPack(pack("released"), items, "buyer");
    expect(view).not.toHaveProperty("internal");
    for (const item of view?.items ?? []) expect(item).not.toHaveProperty("rankComputed");
    expect(JSON.stringify(view)).not.toContain("run-1");
    expect(JSON.stringify(view)).not.toContain("manual");
    // Who released it and whose desk it was on are OSI's.
    expect(JSON.stringify(view)).not.toContain("Dana");
    expect(view?.releasedAt).toBe("2026-11-19T09:00:00.000Z");
  });

  it("does not give the buyer an offer a person took out — nor a hint that one was", () => {
    const withheld: PackItemRow[] = [
      {
        quoteId: "a",
        rankComputed: 1,
        rankShown: null,
        offer: snapshot({ supplierName: "A" }),
        reason: null,
      },
      {
        quoteId: "b",
        rankComputed: 2,
        rankShown: 1,
        offer: snapshot({ supplierName: "B" }),
        reason: null,
      },
    ];
    const buyer = projectPack(pack("released"), withheld, "buyer");
    expect(buyer?.items.map((item) => item.offer.supplierName)).toEqual(["B"]);
    expect(buyer?.items.map((item) => item.rank)).toEqual([1]);
    const staff = projectPack(pack("released"), withheld, "staff");
    expect(staff?.items.map((item) => [item.offer.supplierName, item.rank])).toEqual([
      ["B", 1],
      ["A", null],
    ]);
  });

  it("gives the buyer the supplier's fit, and none of the factors scored against other offers", () => {
    const withReason: PackItemRow[] = [
      {
        quoteId: "b",
        rankComputed: 2,
        rankShown: 1,
        offer: snapshot({ supplierName: "B" }),
        reason: {
          factors: {
            price: { state: "scored", points: 100, weight: 40 },
            // 66.67 = "a third slower than an offer you may not be shown".
            leadTime: { state: "scored", points: 66.67, weight: 20 },
            kpi1: { state: "scored", points: 74.6, weight: 20 },
            verification: { state: "scored", points: 0, weight: 10 },
            incoterm: { state: "scored", points: 30, weight: 5 },
            validity: { state: "scored", points: 0, weight: 5 },
          },
          notes: ["validity_expired"],
        },
      },
    ];
    const buyer = projectPack(pack("released"), withReason, "buyer");
    expect(buyer?.items[0]?.fit).toBe(75);
    expect(buyer?.items[0]?.validityExpired).toBe(true);
    expect(buyer?.items[0]).not.toHaveProperty("reason");
    expect(JSON.stringify(buyer)).not.toMatch(/66\.67|"weight"|"factors"/);
    const staff = projectPack(pack("released"), withReason, "staff");
    expect(staff?.items[0]?.reason?.factors.leadTime.points).toBe(66.67);
  });

  it("gives the buyer nothing of a pack withdrawn with its request", () => {
    expect(projectPack(pack("withdrawn"), items, "buyer")).toBeNull();
  });

  it("gives staff every state, both orders and the internals", () => {
    for (const status of ["pending", "released", "refused"] as const) {
      const view = projectPack(pack(status), items, "staff");
      expect(view?.status).toBe(status);
      expect(view?.items.map((item) => item.rankComputed)).toEqual([2, 1]);
      expect(view?.internal).toMatchObject({
        roundId: "r1",
        releaseMode: "manual",
        kpiRunId: "run-1",
        createdAt: "2026-11-18T12:00:00.000Z",
        assignedToName: "Dana",
      });
    }
  });

  it("reads an empty pack as an empty pack", () => {
    expect(projectPack(pack("pending"), [], "staff")?.items).toEqual([]);
  });
});

describe("planCorrection", () => {
  const items = [
    { quoteId: "a", rankComputed: 1 },
    { quoteId: "b", rankComputed: 2 },
    { quoteId: "c", rankComputed: 3 },
  ];

  it("reorders, and says what moved", () => {
    const plan = planCorrection(items, ["b", "a", "c"], []);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect([...plan.ranks.entries()]).toEqual([
      ["b", 1],
      ["a", 2],
      ["c", 3],
    ]);
    expect(plan.moves).toEqual([
      { quoteId: "a", from: 1, to: 2 },
      { quoteId: "b", from: 2, to: 1 },
    ]);
  });

  it("withholds an offer and closes the gap it leaves", () => {
    const plan = planCorrection(items, ["a", "c"], ["b"]);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.ranks.get("b")).toBeNull();
    expect(plan.ranks.get("c")).toBe(2);
    expect(plan.moves).toEqual([
      { quoteId: "b", from: 2, to: null },
      { quoteId: "c", from: 3, to: 2 },
    ]);
  });

  it("refuses the computed order with nothing removed — that is an approval", () => {
    expect(planCorrection(items, ["a", "b", "c"], [])).toEqual({
      ok: false,
      reason: "nothing_changed",
    });
  });

  it("refuses to leave an offer out of both lists", () => {
    expect(planCorrection(items, ["a", "b"], [])).toEqual({
      ok: false,
      reason: "incomplete_order",
    });
  });

  it("refuses an offer named twice, or named in both lists", () => {
    expect(planCorrection(items, ["a", "a", "b"], ["c"]).ok).toBe(false);
    expect(planCorrection(items, ["a", "b", "c"], ["c"])).toEqual({
      ok: false,
      reason: "incomplete_order",
    });
  });

  it("refuses an offer that is not in the pack", () => {
    expect(planCorrection(items, ["a", "b", "x"], [])).toEqual({
      ok: false,
      reason: "unknown_item",
    });
  });

  it("refuses to remove everything — that is a refusal, with its own reason", () => {
    expect(planCorrection(items, [], ["a", "b", "c"])).toEqual({
      ok: false,
      reason: "nothing_shown",
    });
  });

  it("judges 'unchanged' on order, not on rank numbers", () => {
    // A pack capped after a decline: computed ranks 1 and 3.
    const gapped = [
      { quoteId: "a", rankComputed: 1 },
      { quoteId: "c", rankComputed: 3 },
    ];
    expect(planCorrection(gapped, ["a", "c"], [])).toEqual({
      ok: false,
      reason: "nothing_changed",
    });
    expect(planCorrection(gapped, ["c", "a"], []).ok).toBe(true);
  });
});

describe("relaunchState", () => {
  it("lets a supplier never asked be asked", () => {
    expect(relaunchState(null)).toBe("never_asked");
  });

  it("lets a supplier the round cut short, missed or timed out on be asked again", () => {
    for (const reason of ["closed_before_deadline", "not_reached", "no_response"] as const) {
      expect(relaunchState({ status: "declined", declineReason: reason })).toBe(reason);
    }
  });

  it("does not re-ask a supplier whose offer is in hand", () => {
    expect(relaunchState({ status: "received", declineReason: null })).toBeNull();
  });

  it("does not re-ask one who said no, lost, or is still being asked", () => {
    expect(relaunchState({ status: "declined", declineReason: "supplier_declined" })).toBeNull();
    expect(relaunchState({ status: "declined", declineReason: "lost" })).toBeNull();
    expect(relaunchState({ status: "requested", declineReason: null })).toBeNull();
    expect(relaunchState({ status: "accepted", declineReason: null })).toBeNull();
  });
});

describe("packOfferState", () => {
  const now = new Date("2026-12-01T12:00:00Z");
  const later = new Date("2026-12-20T00:00:00Z");
  const earlier = new Date("2026-11-30T00:00:00Z");
  const quote = (
    status: string,
    validUntil: Date | null = later,
    declineReason: string | null = null,
  ) => ({
    status,
    validUntil,
    declineReason,
  });

  it("is open while received and within its validity", () => {
    expect(packOfferState(quote("received"), now)).toBe("open");
  });

  it("is expired once the validity has passed, whatever the column says", () => {
    expect(packOfferState(quote("received", earlier), now)).toBe("expired");
    expect(packOfferState(quote("expired"), now)).toBe("expired");
  });

  it("never expires on the clock without a date", () => {
    expect(packOfferState(quote("received", null), now)).toBe("open");
  });

  it("tells the accepted offer from the ones it set aside", () => {
    expect(packOfferState(quote("accepted"), now)).toBe("accepted");
    expect(packOfferState(quote("declined", later, "lost"), now)).toBe("lost");
  });

  it("says an offer asked for again is being collected", () => {
    expect(packOfferState(quote("requested", null), now)).toBe("reasked");
  });

  it("calls anything else unavailable — a supplier who withdrew, a state it does not know", () => {
    expect(packOfferState(quote("declined", later, "supplier_declined"), now)).toBe("unavailable");
    expect(packOfferState(quote("something_new"), now)).toBe("unavailable");
  });
});

// The other release mode (V14). Switched off in production: the setting's
// default is `manual`, so every pack there answers "manual" here.
describe("whether a pack leaves by itself when its round closes", () => {
  const fresh = { releaseMode: "automatic" as const, events: 0, offersInRound: 2, items: 2 };

  it("releases an automatic pack at the close that built it", () => {
    expect(autoReleaseHold(fresh)).toBeNull();
  });

  it("never releases a manual pack, whatever it holds", () => {
    expect(autoReleaseHold({ ...fresh, releaseMode: "manual" })).toBe("manual");
  });

  // The acceptance line: a round with zero offers always goes to a person.
  it("hands a round that came back empty to a person", () => {
    expect(autoReleaseHold({ ...fresh, offersInRound: 0, items: 0 })).toBe("no_offers");
  });

  // A re-asked round nobody answered: the pack still holds the earlier
  // offers, but this close added nothing — the same question for a person.
  it("hands over a round that added nothing to offers already held", () => {
    expect(autoReleaseHold({ ...fresh, offersInRound: 0, items: 3 })).toBe("no_offers");
  });

  it("does not release offers the pack does not show", () => {
    expect(autoReleaseHold({ ...fresh, offersInRound: 1, items: 0 })).toBe("no_offers");
  });

  // Held once, relaunched, taken onto a desk: somebody is deciding. Without
  // this a relaunched pack would leave alone at its second close even after
  // the setting went back to manual — a pack keeps the mode it was born with.
  it("leaves a pack that already has a history to the person who has it", () => {
    expect(autoReleaseHold({ ...fresh, events: 1 })).toBe("in_hand");
    expect(autoReleaseHold({ ...fresh, events: 1, offersInRound: 0, items: 0 })).toBe("in_hand");
  });
});

describe("what a pack says about having been reviewed", () => {
  const row = (releasedByName: string | null): PackRow => ({
    id: "p1",
    requestId: "3049",
    roundId: "r1",
    status: "released",
    releaseMode: releasedByName ? "manual" : "automatic",
    kpiRunId: "run-1",
    builtAt: "2026-11-18T12:00:01.000Z",
    createdAt: "2026-11-18T12:00:00.000Z",
    releasedAt: "2026-11-18T12:00:02.000Z",
    releasedByName,
    refusedReason: null,
    assignedTo: null,
    assignedToName: null,
  });

  it("is reviewed when a person released it — and the buyer is told only that", () => {
    const buyer = projectPack(row("Dana"), [], "buyer");
    expect(buyer?.reviewed).toBe(true);
    expect(buyer?.internal).toBeUndefined();
  });

  it("is not reviewed when the system released it", () => {
    expect(projectPack(row(null), [], "buyer")?.reviewed).toBe(false);
    expect(projectPack(row(null), [], "staff")?.reviewed).toBe(false);
  });
});
