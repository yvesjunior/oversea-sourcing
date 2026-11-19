// Closing a dossier (Phase V · V31) — the second of the two acts.
//
// The buyer has said how it went (V30: `delivered → reviewed`). Staff close
// (`reviewed → closed`) — and only then: `delivered → closed` is not a
// transition the deal machine has, so a dossier is never closed over a buyer
// who has not spoken. Nor over an issue still open (V28).
//
// Closing is also when the platform REMEMBERS: the dossier's facts are
// written to `supplier_performance` in the same transaction, for KPI #1 to
// read on the next request.

import { eq } from "drizzle-orm";
import { db } from "@/database";
import * as schema from "@/database/schema";
import { mayCloseDossier, openIssues } from "@/lib/dossier";
import { logAudit } from "@/server/audit";
import { recordDealEvent } from "@/server/deals";
import { openDossier, type DossierReader } from "@/server/dossier";
import { rememberDeal } from "@/server/supplier-performance";

export type CloseResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "not_found"
        /** Not staff. */
        | "forbidden"
        /** The buyer has not confirmed reception — or it is closed already. */
        | "not_reviewed"
        /** An issue is still open: settle it first. */
        | "open_issues";
    };

export async function closeDeal(reader: DossierReader, dealId: string): Promise<CloseResult> {
  const loaded = await openDossier(reader, dealId);
  if (!loaded) return { ok: false, reason: "not_found" };
  if (loaded.audience.kind !== "staff") return { ok: false, reason: "forbidden" };

  const outcome = await db.transaction(async (tx) => {
    const [deal] = await tx
      .select()
      .from(schema.deal)
      .where(eq(schema.deal.id, dealId))
      .for("update");
    if (!deal) return { refusal: "not_found" as const };
    const issues = await tx
      .select({ status: schema.dealIssue.status })
      .from(schema.dealIssue)
      .where(eq(schema.dealIssue.dealId, dealId));
    const verdict = mayCloseDossier(loaded.audience, deal.status, openIssues(issues));
    if (verdict !== "ok") return { refusal: verdict };

    const closedAt = new Date();
    // Remembered and closed together, or neither — which is why the status
    // is written here, on this transaction, and not through `transitionDeal`.
    // `reviewed → closed` is the one move `mayCloseDossier` lets through, and
    // it is a legal one (`DEAL_TRANSITIONS`).
    await rememberDeal(deal, closedAt, tx);
    await tx
      .update(schema.deal)
      .set({
        status: "closed",
        closedAt,
        closedBy: reader.userId,
        closedByName: reader.userName,
        updatedAt: closedAt,
      })
      .where(eq(schema.deal.id, dealId));
    return { deal };
  });
  if ("refusal" in outcome) return { ok: false, reason: outcome.refusal };

  await recordDealEvent(dealId, outcome.deal.organizationId, "status.closed");
  await logAudit({
    actorId: reader.userId,
    actorName: reader.userName,
    organizationId: outcome.deal.organizationId,
    action: "dossier.closed",
    target: outcome.deal.title,
    detail: { dealId, satisfaction: outcome.deal.satisfaction },
  });
  return { ok: true };
}
