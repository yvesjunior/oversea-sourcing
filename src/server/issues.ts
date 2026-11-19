// Issues on a dossier (Phase V · V28) — the rows.
//
// Something is not as agreed: an inspector found a nonconformity, the buyer
// received less than ordered, a delivery is damaged. Whoever sees it raises
// it; OSI tracks it to a resolution and records what was done — OSI being the
// one party that speaks to every side.
//
// Who may raise one and who reads one are pure rules (src/lib/dossier.ts);
// who is asking is resolved the dossier's way (`openDossier`).

import { and, eq } from "drizzle-orm";
import { db } from "@/database";
import * as schema from "@/database/schema";
import { mayRaiseIssue } from "@/lib/dossier";
import { logAudit } from "@/server/audit";
import { recordDealEvent } from "@/server/deals";
import { openDossier, type DossierReader } from "@/server/dossier";

export type IssueWriteResult =
  | { ok: true; id: string }
  | {
      ok: false;
      reason:
        /** Not a party to this dossier, or no such dossier / issue. */
        | "not_found"
        | "forbidden"
        /** Already settled: a resolution is not rewritten over. */
        | "already_settled";
    };

/** Raise an issue. The dossier's timeline says that one was — its text is on
 *  the dossier, for the readers it concerns. */
export async function raiseIssue(
  reader: DossierReader,
  dealId: string,
  input: { kind: schema.DealIssueKind; description: string },
): Promise<IssueWriteResult> {
  const loaded = await openDossier(reader, dealId);
  if (!loaded) return { ok: false, reason: "not_found" };
  if (!mayRaiseIssue(loaded.audience, loaded.deal.status)) {
    return { ok: false, reason: "forbidden" };
  }
  const partyId = loaded.audience.kind === "staff" ? null : loaded.audience.partyId;
  const role =
    partyId === null
      ? ("osi" as const)
      : (loaded.parties.find((party) => party.id === partyId)?.role ?? ("other" as const));
  const id = crypto.randomUUID();
  await db.insert(schema.dealIssue).values({
    id,
    dealId,
    kind: input.kind,
    description: input.description,
    raisedBy: reader.userId,
    raisedByName: reader.userName,
    raisedByRole: role,
    raisedByPartyId: partyId,
  });
  await recordDealEvent(dealId, loaded.deal.organizationId, "issue.raised", { kind: input.kind });
  await logAudit({
    actorId: reader.userId,
    actorName: reader.userName,
    organizationId: loaded.deal.organizationId,
    action: "dossier.issue_raised",
    target: loaded.deal.title,
    detail: { dealId, kind: input.kind, role },
  });
  return { ok: true, id };
}

/**
 * Settle an issue — STAFF. `resolved` with what was done about it, or
 * `disputed` when the sides do not agree: on record either way, and no longer
 * standing in the way of closing.
 */
export async function settleIssue(
  reader: DossierReader,
  issueId: string,
  input: { status: "resolved" | "disputed"; resolution: string },
): Promise<IssueWriteResult> {
  const issue = await db.query.dealIssue.findFirst({ where: eq(schema.dealIssue.id, issueId) });
  if (!issue) return { ok: false, reason: "not_found" };
  const loaded = await openDossier(reader, issue.dealId);
  if (!loaded) return { ok: false, reason: "not_found" };
  if (loaded.audience.kind !== "staff") return { ok: false, reason: "forbidden" };
  const now = new Date();
  const [settled] = await db
    .update(schema.dealIssue)
    .set({
      status: input.status,
      resolution: input.resolution,
      resolvedBy: reader.userId,
      resolvedByName: reader.userName,
      resolvedAt: now,
      updatedAt: now,
    })
    // Only an OPEN issue: two people settling it at once record one outcome.
    .where(and(eq(schema.dealIssue.id, issueId), eq(schema.dealIssue.status, "open")))
    .returning({ id: schema.dealIssue.id });
  if (!settled) return { ok: false, reason: "already_settled" };
  await recordDealEvent(issue.dealId, loaded.deal.organizationId, `issue.${input.status}`, {
    kind: issue.kind,
  });
  await logAudit({
    actorId: reader.userId,
    actorName: reader.userName,
    organizationId: loaded.deal.organizationId,
    action: "dossier.issue_settled",
    target: loaded.deal.title,
    detail: { dealId: issue.dealId, kind: issue.kind, status: input.status },
  });
  return { ok: true, id: issueId };
}
