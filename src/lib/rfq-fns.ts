// RFQ rounds — server fns (Phase V · V06). Staff only, `deals`.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { RfqBatchResult, RfqPreview } from "@/server/rfq";

export type { RfqBatchResult, RfqBlocker, RfqPreview, RoundView } from "@/server/rfq";

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
