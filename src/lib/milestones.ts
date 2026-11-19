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

import type { ContractPartyRole, DealStatus } from "@/database/schema";
import type { DossierAudience } from "@/lib/dossier";

/**
 * The milestones of a dossier, in the order they happen. Each one says the
 * dossier status it is completed FROM and the status it moves the dossier TO
 * (null = the dossier stays where it is), and whose work it is.
 *
 * V28 and V29 add inspection, booking and customs to this list; the table
 * and everything below already work for any kind in it.
 */
export const MILESTONES = [
  { kind: "production_started", from: "contracting", to: "in_production", owner: "supplier" },
  { kind: "production_finished", from: "in_production", to: null, owner: "supplier" },
  { kind: "shipped", from: "in_production", to: "shipping", owner: "carrier" },
  { kind: "delivered", from: "shipping", to: "delivered", owner: "carrier" },
] as const satisfies readonly {
  kind: string;
  from: DealStatus;
  to: DealStatus | null;
  owner: ContractPartyRole;
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
 * production ones. The buyer and a partner read (a carrier's own milestones
 * become theirs to record in V29).
 */
export function mayRecordMilestone(audience: DossierAudience, kind: MilestoneKind): boolean {
  if (audience.kind === "staff") return true;
  return audience.kind === "supplier" && milestoneOwner(kind) === "supplier";
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
  if (MILESTONE_KINDS.slice(0, index).some((earlier) => !facts.done.includes(earlier))) {
    return "out_of_order";
  }
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
