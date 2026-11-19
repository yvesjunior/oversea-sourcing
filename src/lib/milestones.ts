// Milestones (Phase V · V27) — what moves a dossier. Pure and client-safe.
//
// Until V27 a dossier stopped at `contracting`: `transitionDeal` existed and
// nothing called it past the contracts. A milestone is what moves it now —
// "production started" takes the dossier into production, "shipped" into
// transit, "delivered" to delivered. The dossier's status is therefore never
// set by a button of its own: it FOLLOWS what somebody recorded as done.
//
// ── Three rules ─────────────────────────────────────────────────────────────
//
//  1. LATENESS IS DERIVED. A milestone is late when its planned date has
//     passed and it is not done. Nobody marks it late and no job does:
//     `milestoneState` is asked every time it is read.
//  2. IN ORDER. A milestone is completed only when the ones before it are —
//     a dossier cannot be shipped before production started — and only from
//     the dossier status it belongs to. Dates can be PLANNED at any time.
//  3. WHO RECORDS. The supplier records production; staff record anything,
//     on a party's behalf. That answers the question P7 left open ("who
//     updates milestones?") with: the party whose work it is, or OSI for
//     them. What was recorded says which (`channel`).

import type { ContractPartyRole, DealStatus, DocumentKind } from "@/database/schema";
import type { DossierAudience } from "@/lib/dossier";
import { PARTY_ROLE_OF } from "@/lib/partners";

/**
 * The milestones of a dossier, in the order they happen. Each one says the
 * dossier status it is completed FROM and the status it moves the dossier TO
 * (null = the dossier stays where it is), and whose work it is.
 *
 * V28 added the inspection, V29 the booking and the customs clearance — the
 * logistics partners' statuses are rows of this table, not a second one.
 */
export const MILESTONES = [
  {
    kind: "production_started",
    from: "contracting",
    to: "in_production",
    owner: "supplier",
    optional: false,
  },
  {
    kind: "production_finished",
    from: "in_production",
    to: null,
    owner: "supplier",
    optional: false,
  },
  // V28. OPTIONAL: most dossiers have no inspector, and a step nobody is
  // there to do must not stand between production and shipment.
  { kind: "inspection", from: "in_production", to: null, owner: "inspector", optional: true },
  // V29. The carrier's booking — said before the goods leave. Optional: a
  // dossier whose transport OSI follows by phone still ships.
  { kind: "booking", from: "in_production", to: null, owner: "carrier", optional: true },
  { kind: "shipped", from: "in_production", to: "shipping", owner: "carrier", optional: false },
  // V29. Customs clearance, while the goods are in transit. Optional for
  // the same reason — and because under DDP it is not the buyer's to follow.
  {
    kind: "customs_cleared",
    from: "shipping",
    to: null,
    owner: "customs_broker",
    optional: true,
  },
  { kind: "delivered", from: "shipping", to: "delivered", owner: "carrier", optional: false },
] as const satisfies readonly {
  kind: string;
  from: DealStatus;
  to: DealStatus | null;
  owner: ContractPartyRole;
  /** An optional milestone is never required before a later one. */
  optional: boolean;
}[];

export type MilestoneKind = (typeof MILESTONES)[number]["kind"];
export const MILESTONE_KINDS = MILESTONES.map((m) => m.kind) as readonly MilestoneKind[];

export function isMilestoneKind(value: string): value is MilestoneKind {
  return (MILESTONE_KINDS as readonly string[]).includes(value);
}

function definition(kind: MilestoneKind) {
  return MILESTONES.find((m) => m.kind === kind)!;
}

/** Whose work a milestone is — the side it is attributed to when recorded. */
export function milestoneOwner(kind: MilestoneKind): ContractPartyRole {
  return definition(kind).owner;
}

// ── the paperwork each step produces (V29) ──────────────────────────────────

/**
 * What a document attached to a milestone can BE. The first of each list is
 * what it is taken for when nobody says: a document on "shipped" is a bill
 * of lading unless its uploader says it is the packing list.
 *
 * It names the paperwork so the buyer can find "the bill of lading" — it
 * does not check it: no carrier or customs system is asked anything, and a
 * file is what the party that attached it says it is.
 */
export const PAPERWORK: Record<MilestoneKind, readonly DocumentKind[]> = {
  production_started: ["proof"],
  production_finished: ["proof", "packing_list"],
  inspection: ["inspection"],
  booking: ["proof", "insurance"],
  shipped: ["bill_of_lading", "packing_list", "insurance", "proof"],
  customs_cleared: ["customs"],
  delivered: ["proof"],
};

/** The kind a document attached to this milestone is stored as: the one
 *  asked for when the milestone allows it, its default otherwise. */
export function paperworkKind(kind: MilestoneKind, requested?: string | null): DocumentKind {
  const allowed = PAPERWORK[kind];
  return allowed.find((candidate) => candidate === requested) ?? allowed[0]!;
}

// ── state ───────────────────────────────────────────────────────────────────

export type MilestoneState =
  /** Recorded as done. */
  | "done"
  /** Its planned date has passed and it is not done. */
  | "late"
  /** A date is planned and has not come yet. */
  | "planned"
  /** Nothing is known about it yet. */
  | "unplanned";

export type MilestoneDates = { plannedAt: string | null; completedAt: string | null };

/**
 * Where a milestone stands at `now` — derived, never stored.
 *
 * A planned DATE is a day: a milestone planned for the 12th is late once the
 * 12th is over, not at the first second of it.
 */
export function milestoneState(milestone: MilestoneDates | null, now: Date): MilestoneState {
  if (!milestone) return "unplanned";
  if (milestone.completedAt) return "done";
  if (!milestone.plannedAt) return "unplanned";
  return endOfDay(milestone.plannedAt) < now.getTime() ? "late" : "planned";
}

/** Done, and after the day it was planned for. The fact V31 will read: a
 *  delivery that was late stays late in the record once it has happened. */
export function wasLate(milestone: MilestoneDates): boolean {
  return (
    milestone.completedAt !== null &&
    milestone.plannedAt !== null &&
    new Date(milestone.completedAt).getTime() > endOfDay(milestone.plannedAt)
  );
}

function endOfDay(iso: string): number {
  const day = new Date(iso);
  return Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 23, 59, 59, 999);
}

// ── who may record ──────────────────────────────────────────────────────────

/**
 * May this reader record (plan or complete) this milestone?
 *
 * Staff: every one, on the owning party's behalf. A supplier: its own — the
 * production ones. A partner: the ones of its role on the dossier. The buyer
 * reads.
 */
export function mayRecordMilestone(audience: DossierAudience, kind: MilestoneKind): boolean {
  const owner = milestoneOwner(kind);
  if (audience.kind === "staff") return true;
  if (audience.kind === "supplier") return owner === "supplier";
  // A partner records the milestones of ITS role on the dossier (V28): an
  // inspector the inspection, and from V29 a carrier its own.
  if (audience.kind === "partner") {
    // Every kind of work this account holds on the dossier (V29): a transit
    // agent that both ships and clears records both.
    const kinds = [audience.partnerKind, ...(audience.also ?? []).map((o) => o.partnerKind)];
    return kinds.some((partnerKind) => PARTY_ROLE_OF[partnerKind] === owner);
  }
  return false;
}

export type CompleteRefusal =
  /** The milestones before it are not all done. */
  | "out_of_order"
  /** The dossier is not at the status this milestone is completed from. */
  | "wrong_status"
  /** Production cannot start while a contract of the dossier is unsigned —
   *  or before any has been drafted. */
  | "contracts_pending"
  | "already_done";

/**
 * May this milestone be marked done now?
 *
 * `done` is the kinds already completed on the dossier; `contractsSigned`
 * whether the dossier has at least one live contract and every live one is
 * signed.
 */
export function canComplete(
  kind: MilestoneKind,
  facts: { dealStatus: DealStatus; done: readonly MilestoneKind[]; contractsSigned: boolean },
): "ok" | CompleteRefusal {
  if (facts.done.includes(kind)) return "already_done";
  const index = MILESTONE_KINDS.indexOf(kind);
  // Every REQUIRED step before it must be done; an optional one (an
  // inspection nobody ordered) never holds a dossier back.
  const missing = MILESTONES.slice(0, index).some(
    (earlier) => !earlier.optional && !facts.done.includes(earlier.kind),
  );
  if (missing) return "out_of_order";
  // The first step out of the paperwork: nothing is produced on a contract
  // nobody signed.
  if (kind === "production_started" && !facts.contractsSigned) return "contracts_pending";
  return facts.dealStatus === definition(kind).from ? "ok" : "wrong_status";
}

/** The status completing this milestone moves the dossier to — null when it
 *  leaves it where it is. */
export function statusAfter(kind: MilestoneKind): DealStatus | null {
  return definition(kind).to;
}

/** A dossier's milestones can be planned and recorded while it is live and
 *  not yet delivered. Planning is allowed from the first day — a buyer wants
 *  to know when production is meant to start before the contracts are in. */
export function milestonesOpen(status: DealStatus): boolean {
  return (
    status === "open" ||
    status === "contracting" ||
    status === "in_production" ||
    status === "shipping"
  );
}
