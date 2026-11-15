import { describe, expect, it } from "vitest";
import {
  projectPack,
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
  });

  it("gives staff every state, both orders and the internals", () => {
    for (const status of ["pending", "released", "refused"] as const) {
      const view = projectPack(pack(status), items, "staff");
      expect(view?.status).toBe(status);
      expect(view?.items.map((item) => item.rankComputed)).toEqual([2, 1]);
      expect(view?.internal).toEqual({
        roundId: "r1",
        releaseMode: "manual",
        kpiRunId: "run-1",
        createdAt: "2026-11-18T12:00:00.000Z",
      });
    }
  });

  it("reads an empty pack as an empty pack", () => {
    expect(projectPack(pack("pending"), [], "staff")?.items).toEqual([]);
  });
});
