// RFQ rounds — server fns (Phase V · V06, V07). Staff only, `deals`.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { RfqBatchResult, RfqPreview } from "@/server/rfq";
import type { CloseRoundResult } from "@/server/rfq-window";

export type { RfqBatchResult, RfqBlocker, RfqPreview, RoundView } from "@/server/rfq";
export type { CloseRoundResult } from "@/server/rfq-window";

async function requireRfqStaff() {
  const [{ auth }, { getRequest }, { effectiveHasPermission }] = await Promise.all([
    import("@/server/auth"),
    import("@tanstack/react-start/server"),
    import("@/server/workspace-guard"),
  ]);
  const session = await auth.api.getSession({ headers: getRequest().headers });
  if (!session || !(await effectiveHasPermission(session, "deals"))) return null;
  return session;
}

/** Who a send would write to, what stops it, and the email itself — so what
 *  staff approve is exactly what leaves. Null for anyone but staff. */
export const getRfqPreviewFn = createServerFn({ method: "GET" })
  .inputValidator(z.object({ requestId: z.string().min(1) }))
  .handler(async ({ data }): Promise<RfqPreview | null> => {
    if (!(await requireRfqStaff())) return null;
    const { previewRfq } = await import("@/server/rfq");
    return await previewRfq(data.requestId);
  });

export const sendRfqBatchFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ requestId: z.string().min(1) }))
  .handler(async ({ data }): Promise<RfqBatchResult | { ok: false; reason: "forbidden" }> => {
    const session = await requireRfqStaff();
    if (!session) return { ok: false, reason: "forbidden" };
    const { sendRfqBatch } = await import("@/server/rfq");
    const result = await sendRfqBatch(data.requestId, {
      id: session.user.id,
      name: session.user.name,
    });
    if (result.ok && result.sent > 0) {
      const { logAudit, actorOf } = await import("@/server/audit");
      await logAudit({
        ...actorOf(session),
        action: "rfq.sent",
        target: `#${data.requestId}`,
        detail: {
          round: result.round.roundNo,
          sent: result.sent,
          failed: result.failed.length,
          closesAt: result.round.closesAt,
        },
      });
    }
    return result;
  });

/**
 * Staff stop waiting (V07). The note is REQUIRED: cutting a round short
 * declines every supplier who had not answered yet, and "why" is the only
 * thing that lets anyone review that decision afterwards. The audit row is
 * written by `closeRound` itself, like every other close.
 */
export const closeRoundEarlyFn = createServerFn({ method: "POST" })
  // No `.min(1)` on the note: an empty one is refused by `closeRound` with a
  // reason the page can show, rather than by the validator with a thrown error.
  .inputValidator(z.object({ roundId: z.string().min(1), note: z.string().trim().max(500) }))
  .handler(async ({ data }): Promise<CloseRoundResult | { ok: false; reason: "forbidden" }> => {
    const session = await requireRfqStaff();
    if (!session) return { ok: false, reason: "forbidden" };
    const { closeRound } = await import("@/server/rfq-window");
    return await closeRound(
      data.roundId,
      "early",
      { id: session.user.id, name: session.user.name },
      data.note,
    );
  });
