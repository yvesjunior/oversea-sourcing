// The buyer confirms reception (Phase V · V30) — the rows.
//
// The act the `deal` table has been waiting for since P1: `satisfaction`,
// `review_comment`, `reviewed_at` and `reviewed_by` existed and nothing wrote
// them. It is the BUYER's act — `mayConfirmReception` gives it to nobody
// else, staff included — and it takes the dossier from `delivered` to
// `reviewed`, which is what lets staff close it afterwards. Two acts, two
// actors.
//
// Something not as agreed does NOT stop the reception: the goods arrived, and
// what is wrong with them is recorded beside that fact as issues — which is
// what then stands in the way of closing, until settled.

import { eq } from "drizzle-orm";
import { db } from "@/database";
import * as schema from "@/database/schema";
import { isSatisfaction, mayConfirmReception } from "@/lib/dossier";
import { logAudit } from "@/server/audit";
import { recordDealEvent, transitionDeal } from "@/server/deals";
import { openDossier, type DossierReader } from "@/server/dossier";

export type ReceptionResult =
  | { ok: true; issues: number }
  | {
      ok: false;
      reason:
        /** Not the buyer's dossier — or no such dossier. */
        | "not_found"
        /** Not the buyer: staff, a supplier, a partner. */
        | "forbidden"
        /** Not delivered yet — or already confirmed. */
        | "not_delivered"
        | "bad_satisfaction";
    };

export async function confirmReception(
  reader: DossierReader,
  dealId: string,
  input: {
    satisfaction: number;
    comment: string | null;
    issues: Array<{ kind: schema.DealIssueKind; description: string }>;
  },
): Promise<ReceptionResult> {
  if (!isSatisfaction(input.satisfaction)) return { ok: false, reason: "bad_satisfaction" };
  const loaded = await openDossier(reader, dealId);
  if (!loaded) return { ok: false, reason: "not_found" };
  if (loaded.audience.kind !== "buyer") return { ok: false, reason: "forbidden" };
  if (!mayConfirmReception(loaded.audience, loaded.deal.status)) {
    return { ok: false, reason: "not_delivered" };
  }
  const partyId = loaded.audience.partyId;

  const outcome = await db.transaction(async (tx) => {
    // Locked: two members of the workspace confirming at once record one
    // reception, and its discrepancies once.
    const [deal] = await tx
      .select()
      .from(schema.deal)
      .where(eq(schema.deal.id, dealId))
      .for("update");
    if (!deal || deal.status !== "delivered") return { refusal: "not_delivered" as const };
    if (input.issues.length > 0) {
      await tx.insert(schema.dealIssue).values(
        input.issues.map((issue) => ({
          id: crypto.randomUUID(),
          dealId,
          kind: issue.kind,
          description: issue.description,
          raisedBy: reader.userId,
          raisedByName: reader.userName,
          raisedByRole: "buyer" as const,
          raisedByPartyId: partyId,
        })),
      );
    }
    return { deal };
  });
  if ("refusal" in outcome) return { ok: false, reason: outcome.refusal };

  const { deal } = outcome;
  await transitionDeal(dealId, deal.organizationId, "delivered", "reviewed", {
    satisfaction: input.satisfaction,
    reviewComment: input.comment,
    reviewedAt: new Date(),
    reviewedBy: reader.userId,
    reviewedByName: reader.userName,
  });
  for (const issue of input.issues) {
    await recordDealEvent(dealId, deal.organizationId, "issue.raised", { kind: issue.kind });
  }
  await logAudit({
    actorId: reader.userId,
    actorName: reader.userName,
    organizationId: deal.organizationId,
    action: "dossier.reception_confirmed",
    target: deal.title,
    detail: { dealId, satisfaction: input.satisfaction, issues: input.issues.length },
  });
  return { ok: true, issues: input.issues.length };
}
