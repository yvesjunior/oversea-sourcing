// The dossier's own acts (Phase V · V30) — server functions.
//
// `confirmReceptionFn` is the BUYER's. It asks for a working seat in the
// buyer's workspace (`buyer` — a viewer reads and confirms nothing) and then
// for the rule: `mayConfirmReception` gives the act to the buyer's party and
// to nobody else. A staff member standing in the internal workspace is OSI on
// that dossier and is refused — two acts by two actors.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { DEAL_ISSUE_KINDS } from "@/database/schema";
import type { DossierReader } from "@/server/dossier";
import type { CloseResult } from "@/server/closure";
import type { ReceptionResult } from "@/server/reception";

export type { CloseResult, ReceptionResult };

async function dealReader(): Promise<DossierReader | null> {
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

/**
 * Confirm that the goods were received, say how it went, and report what is
 * not as agreed. A discrepancy does not stop the reception: it is recorded
 * beside it as an issue.
 */
export const confirmReceptionFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      dealId: z.string().min(1).max(100),
      satisfaction: z.number().int().min(1).max(5),
      comment: z
        .string()
        .trim()
        .max(2000)
        .nullable()
        .transform((value) => (value ? value : null)),
      issues: z
        .array(
          z.object({
            kind: z.enum(DEAL_ISSUE_KINDS),
            description: z.string().trim().min(5).max(2000),
          }),
        )
        .max(20)
        .default([]),
    }),
  )
  .handler(async ({ data }): Promise<ReceptionResult> => {
    const reader = await dealReader();
    if (!reader) return { ok: false, reason: "forbidden" };
    const { confirmReception } = await import("@/server/reception");
    return confirmReception(reader, data.dealId, data);
  });

/**
 * STAFF: close a dossier the buyer has reviewed (V31) — the second act.
 * Refused while an issue is open. What happened is written to the supplier's
 * record in the same step.
 */
export const closeDealFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ dealId: z.string().min(1).max(100) }))
  .handler(async ({ data }): Promise<CloseResult> => {
    const reader = await dealReader();
    if (!reader) return { ok: false, reason: "forbidden" };
    const { closeDeal } = await import("@/server/closure");
    return closeDeal(reader, data.dealId);
  });
