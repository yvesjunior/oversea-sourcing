// Milestones (Phase V · V27) — server functions for the WORKSPACE side.
//
// In effect these are STAFF's: `mayRecordMilestone` gives a buyer none, so a
// buyer calling one is refused by the rule, not by a second guard written
// here. Staff record any milestone on the owning party's behalf — "the
// supplier, or staff for them" — and what is stored says it was staff
// (`channel`). The supplier's own functions are in portal-fns.ts.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { MILESTONE_KINDS } from "@/lib/milestones";
import type { DossierReader } from "@/server/dossier";
import type { MilestoneWriteResult } from "@/server/milestones";

export type { MilestoneWriteResult };

async function milestoneReader(): Promise<DossierReader | null> {
  const [{ requireWorkspaceRole, effectiveHasPermission }, { auth }, { getRequest }] =
    await Promise.all([
      import("@/server/workspace-guard"),
      import("@/server/auth"),
      import("@tanstack/react-start/server"),
    ]);
  const headers = getRequest().headers;
  const session = await auth.api.getSession({ headers });
  const caller = await requireWorkspaceRole(headers, "buyer");
  if (!session || !caller) return null;
  return {
    kind: "workspace",
    userId: caller.userId,
    userName: caller.userName,
    workspaceId: caller.workspaceId,
    staff: await effectiveHasPermission(session, "deals"),
  };
}

const kind = z.enum(MILESTONE_KINDS as [string, ...string[]]);
const dealId = z.string().min(1).max(100);

/** Say when a milestone is meant to happen — or take the date back. */
export const planMilestoneFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      dealId,
      kind,
      /** A day, "2026-12-12" — or null to remove the plan. */
      plannedAt: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .nullable(),
    }),
  )
  .handler(async ({ data }): Promise<MilestoneWriteResult> => {
    const reader = await milestoneReader();
    if (!reader) return { ok: false, reason: "forbidden" };
    const [{ planMilestone }, { isMilestoneKind }] = await Promise.all([
      import("@/server/milestones"),
      import("@/lib/milestones"),
    ]);
    if (!isMilestoneKind(data.kind)) return { ok: false, reason: "not_found" };
    return planMilestone(
      reader,
      data.dealId,
      data.kind,
      data.plannedAt ? new Date(`${data.plannedAt}T00:00:00.000Z`) : null,
    );
  });

/** Record that a milestone happened. The dossier follows. */
export const completeMilestoneFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      dealId,
      kind,
      note: z
        .string()
        .trim()
        .max(1000)
        .nullable()
        .transform((value) => (value ? value : null)),
    }),
  )
  .handler(async ({ data }): Promise<MilestoneWriteResult> => {
    const reader = await milestoneReader();
    if (!reader) return { ok: false, reason: "forbidden" };
    const [{ completeMilestone }, { isMilestoneKind }] = await Promise.all([
      import("@/server/milestones"),
      import("@/lib/milestones"),
    ]);
    if (!isMilestoneKind(data.kind)) return { ok: false, reason: "not_found" };
    return completeMilestone(reader, data.dealId, data.kind, data.note);
  });
