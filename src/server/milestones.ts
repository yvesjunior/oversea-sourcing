// Milestones (Phase V · V27) — the rows.
//
// The rules are pure (src/lib/milestones.ts). This file records what somebody
// says happened, and lets the dossier's status FOLLOW it: completing
// "production started" is what takes a dossier into production. Nothing here
// sets a dossier's status for its own sake — `transitionDeal` is still the
// only writer of that column, and this is where it finally gets called past
// the contracts.
//
// Who is asking is resolved the dossier's way (`openDossier`): a reader that
// is not a party to the dossier reads "not found", and one that is may record
// only the milestones `mayRecordMilestone` gives it.

import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/database";
import * as schema from "@/database/schema";
import {
  canComplete,
  mayRecordMilestone,
  milestoneOwner,
  milestonesOpen,
  statusAfter,
  type CompleteRefusal,
  type MilestoneKind,
} from "@/lib/milestones";
import { logAudit } from "@/server/audit";
import { recordDealEvent, transitionDeal } from "@/server/deals";
import { openDossier, type DossierReader, type OpenedDossier } from "@/server/dossier";

export type MilestoneWriteResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        /** Not a party to this dossier — or no such dossier. */
        | "not_found"
        /** A party, but this milestone is not theirs to record. */
        | "forbidden"
        /** The dossier is delivered, closed or cancelled. */
        | "closed"
        | CompleteRefusal;
    };

/** Staff type for a party (`staff`); the party types for itself (`portal`). */
function channelOf(loaded: OpenedDossier): schema.QuoteChannel {
  return loaded.audience.kind === "staff" ? "staff" : "portal";
}

async function authorised(
  reader: DossierReader,
  dealId: string,
  kind: MilestoneKind,
): Promise<{ loaded: OpenedDossier } | { refusal: "not_found" | "forbidden" | "closed" }> {
  const loaded = await openDossier(reader, dealId);
  if (!loaded) return { refusal: "not_found" };
  if (!mayRecordMilestone(loaded.audience, kind)) return { refusal: "forbidden" };
  if (!milestonesOpen(loaded.deal.status)) return { refusal: "closed" };
  return { loaded };
}

/**
 * Say when a milestone is MEANT to happen — or take the date back (`null`).
 * Allowed at any point while the dossier is live: a plan is not a fact, and
 * a buyer wants to know when production is due before it has started.
 */
export async function planMilestone(
  reader: DossierReader,
  dealId: string,
  kind: MilestoneKind,
  plannedAt: Date | null,
): Promise<MilestoneWriteResult> {
  const check = await authorised(reader, dealId, kind);
  if ("refusal" in check) return { ok: false, reason: check.refusal };
  const { loaded } = check;
  // The plan of something that has happened is history: changing it now
  // would change whether it "was late" after the fact.
  const existing = await db.query.orderMilestone.findFirst({
    where: and(eq(schema.orderMilestone.dealId, dealId), eq(schema.orderMilestone.kind, kind)),
    columns: { completedAt: true },
  });
  if (existing?.completedAt) return { ok: false, reason: "already_done" };
  const now = new Date();
  await db
    .insert(schema.orderMilestone)
    .values({
      id: crypto.randomUUID(),
      dealId,
      kind,
      plannedAt,
      channel: channelOf(loaded),
      updatedBy: reader.userId,
      updatedByName: reader.userName,
      // The SIDE the milestone is attributed to — whose work it is — whoever
      // typed it; `channel` says who typed.
      updatedByRole: milestoneOwner(kind),
    })
    .onConflictDoUpdate({
      target: [schema.orderMilestone.dealId, schema.orderMilestone.kind],
      set: {
        plannedAt,
        channel: channelOf(loaded),
        updatedBy: reader.userId,
        updatedByName: reader.userName,
        updatedAt: now,
      },
    });
  return { ok: true };
}

/** Does the dossier have a live contract, and is every live one signed? */
async function contractsSigned(dealId: string): Promise<boolean> {
  const contracts = await db
    .select({ status: schema.contract.status })
    .from(schema.contract)
    .where(eq(schema.contract.dealId, dealId));
  const live = contracts.filter((c) => c.status !== "voided" && c.status !== "expired");
  return live.length > 0 && live.every((c) => c.status === "signed");
}

/**
 * Record that a milestone HAPPENED, now — and move the dossier if this
 * milestone moves it.
 *
 * The dossier row is locked while the check runs, so two people marking the
 * same step done record it once, and a dossier is never moved twice.
 */
export async function completeMilestone(
  reader: DossierReader,
  dealId: string,
  kind: MilestoneKind,
  note: string | null,
): Promise<MilestoneWriteResult> {
  const check = await authorised(reader, dealId, kind);
  if ("refusal" in check) return { ok: false, reason: check.refusal };
  const { loaded } = check;
  const signed = await contractsSigned(dealId);

  const outcome = await db.transaction(async (tx) => {
    const [deal] = await tx
      .select()
      .from(schema.deal)
      .where(eq(schema.deal.id, dealId))
      .for("update");
    if (!deal) return { refusal: "not_found" as const };
    const recorded = await tx
      .select({ kind: schema.orderMilestone.kind, completedAt: schema.orderMilestone.completedAt })
      .from(schema.orderMilestone)
      .where(eq(schema.orderMilestone.dealId, dealId));
    const verdict = canComplete(kind, {
      dealStatus: deal.status,
      done: recorded.filter((row) => row.completedAt !== null).map((row) => row.kind),
      contractsSigned: signed,
    });
    if (verdict !== "ok") return { refusal: verdict };

    const now = new Date();
    await tx
      .insert(schema.orderMilestone)
      .values({
        id: crypto.randomUUID(),
        dealId,
        kind,
        completedAt: now,
        note,
        channel: channelOf(loaded),
        updatedBy: reader.userId,
        updatedByName: reader.userName,
        updatedByRole: milestoneOwner(kind),
      })
      .onConflictDoUpdate({
        target: [schema.orderMilestone.dealId, schema.orderMilestone.kind],
        set: {
          completedAt: now,
          // A note given now replaces the plan's; none given keeps it.
          note: note ?? sql`${schema.orderMilestone.note}`,
          channel: channelOf(loaded),
          updatedBy: reader.userId,
          updatedByName: reader.userName,
          updatedAt: now,
        },
      });
    return { deal };
  });
  if ("refusal" in outcome) return { ok: false, reason: outcome.refusal };

  const { deal } = outcome;
  await recordDealEvent(dealId, deal.organizationId, `milestone.${kind}`, {
    channel: channelOf(loaded),
  });
  // The dossier follows the milestone. `transitionDeal` refuses an illegal
  // move by throwing; `canComplete` has just checked this one is legal.
  const next = statusAfter(kind);
  if (next) await transitionDeal(dealId, deal.organizationId, deal.status, next);
  await logAudit({
    actorId: reader.userId,
    actorName: reader.userName,
    organizationId: deal.organizationId,
    action: "dossier.milestone_completed",
    target: deal.title,
    detail: { dealId, kind, channel: channelOf(loaded), movedTo: next },
  });
  return { ok: true };
}

export type ProofPlan =
  | {
      ok: true;
      deal: OpenedDossier["deal"];
      milestoneId: string;
      /** Who reads the proof: the supplier and the buyer. Staff read every
       *  document of a dossier. */
      sharedWith: string[];
    }
  | { ok: false; reason: "not_found" | "forbidden" | "closed" | "not_recorded" };

/**
 * May this reader attach a proof to this milestone, and who will read it?
 *
 * Asked by the upload routes before a byte is stored. A proof hangs from a
 * milestone that EXISTS — planned or done; evidence of nothing is not
 * evidence — and is read by the supplier and the buyer: it is what the
 * supplier shows the buyer.
 */
export async function planProof(
  reader: DossierReader,
  dealId: string,
  kind: MilestoneKind,
): Promise<ProofPlan> {
  const loaded = await openDossier(reader, dealId);
  if (!loaded) return { ok: false, reason: "not_found" };
  if (!mayRecordMilestone(loaded.audience, kind)) return { ok: false, reason: "forbidden" };
  // Evidence may still arrive once the dossier is delivered — a delivery
  // receipt — but not on one that is closed or cancelled.
  if (loaded.deal.status === "closed" || loaded.deal.status === "cancelled") {
    return { ok: false, reason: "closed" };
  }
  const milestone = await db.query.orderMilestone.findFirst({
    where: and(eq(schema.orderMilestone.dealId, dealId), eq(schema.orderMilestone.kind, kind)),
    columns: { id: true },
  });
  if (!milestone) return { ok: false, reason: "not_recorded" };
  const readers = await db
    .select({ id: schema.dealParty.id })
    .from(schema.dealParty)
    .where(
      and(
        eq(schema.dealParty.dealId, dealId),
        inArray(schema.dealParty.role, ["buyer", "supplier"]),
      ),
    );
  return {
    ok: true,
    deal: loaded.deal,
    milestoneId: milestone.id,
    sharedWith: readers.map((party) => party.id),
  };
}

/** Store a proof's rows once its bytes are in. Shared by the two upload
 *  routes (staff's and the supplier's) so a proof is the same row whoever
 *  attached it. */
export async function recordProof(
  plan: Extract<ProofPlan, { ok: true }>,
  file: { storageKey: string; filename: string; mime: string; size: number },
  by: { id: string; name: string },
): Promise<{ id: string }> {
  const fileId = crypto.randomUUID();
  const documentId = crypto.randomUUID();
  await db.insert(schema.file).values({
    id: fileId,
    // The buyer's workspace owns it, like every document of the dossier; who
    // READS it is `shared_with`.
    organizationId: plan.deal.organizationId,
    storageKey: file.storageKey,
    filename: file.filename,
    mime: file.mime,
    size: file.size,
    uploadedBy: by.id,
  });
  await db.insert(schema.document).values({
    id: documentId,
    organizationId: plan.deal.organizationId,
    fileId,
    kind: "proof",
    dealId: plan.deal.id,
    milestoneId: plan.milestoneId,
    sharedWith: plan.sharedWith,
    uploadedBy: by.id,
    uploadedByName: by.name,
  });
  return { id: documentId };
}
