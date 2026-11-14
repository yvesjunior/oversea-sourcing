// The internal shortlist — server fns (Phase V · V05). Staff only, `deals`.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { ConfirmShortlistResult, ShortlistData } from "@/server/shortlist";

export type {
  BreakdownView,
  ConfirmShortlistResult,
  ShortlistCandidate,
  ShortlistData,
} from "@/server/shortlist";

async function requireShortlistStaff() {
  const [{ auth }, { getRequest }, { effectiveHasPermission }] = await Promise.all([
    import("@/server/auth"),
    import("@tanstack/react-start/server"),
    import("@/server/workspace-guard"),
  ]);
  const session = await auth.api.getSession({ headers: getRequest().headers });
  if (!session || !(await effectiveHasPermission(session, "deals"))) return null;
  return session;
}

/** Null for anyone who is not staff with `deals` — including the workspace
 *  that owns the request, which never reads its own shortlist on this flow. */
export const getShortlistFn = createServerFn({ method: "GET" })
  .inputValidator(z.object({ requestId: z.string().min(1) }))
  .handler(async ({ data }): Promise<ShortlistData | null> => {
    if (!(await requireShortlistStaff())) return null;
    const { loadShortlist } = await import("@/server/shortlist");
    return await loadShortlist(data.requestId);
  });

export const confirmShortlistFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      requestId: z.string().min(1),
      supplierIds: z.array(z.string().min(1)).max(50),
    }),
  )
  .handler(
    async ({ data }): Promise<ConfirmShortlistResult | { ok: false; reason: "forbidden" }> => {
      const session = await requireShortlistStaff();
      if (!session) return { ok: false, reason: "forbidden" };

      const { confirmShortlist } = await import("@/server/shortlist");
      const result = await confirmShortlist(data.requestId, data.supplierIds, {
        id: session.user.id,
        name: session.user.name,
      });
      if (!result.ok) return result;

      const [{ db }, { eq }, schema] = await Promise.all([
        import("@/database"),
        import("drizzle-orm"),
        import("@/database/schema"),
      ]);
      const request = await db.query.request.findFirst({
        where: eq(schema.request.id, data.requestId),
        columns: { organizationId: true },
      });
      if (request) {
        // On the request's own timeline, as a COUNT: the buyer may know that
        // five suppliers are being consulted, never which five.
        const { recordEvent } = await import("@/server/requests");
        await recordEvent(data.requestId, request.organizationId, "shortlist.confirmed", {
          count: result.selected,
        });
      }
      const { logAudit, actorOf } = await import("@/server/audit");
      await logAudit({
        ...actorOf(session),
        action: "shortlist.confirmed",
        target: `#${data.requestId}`,
        detail: { selected: result.selected, added: result.added, removed: result.removed },
      });
      return result;
    },
  );
