// KPI #2 — server fns (Phase V · V09). Staff only, `deals`.
//
// The ranking is OSI's working material until a Decision Pack is released: it
// names every supplier who answered, so nothing here is ever returned to the
// workspace that owns the request.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { Kpi2RunOutcome, OfferRankingView } from "@/server/kpi";

export type {
  Kpi2RunOutcome,
  OfferRankingView,
  RankedOfferView,
  RankingRunView,
} from "@/server/kpi";

async function requireKpiStaff() {
  const [{ auth }, { getRequest }, { effectiveHasPermission }] = await Promise.all([
    import("@/server/auth"),
    import("@tanstack/react-start/server"),
    import("@/server/workspace-guard"),
  ]);
  const session = await auth.api.getSession({ headers: getRequest().headers });
  if (!session || !(await effectiveHasPermission(session, "deals"))) return null;
  return session;
}

/** The current ranking of a request's offers and the runs before it. Null
 *  for anyone but staff, and when no round has closed into a review. */
export const getOfferRankingFn = createServerFn({ method: "GET" })
  .inputValidator(z.object({ requestId: z.string().min(1) }))
  .handler(async ({ data }): Promise<OfferRankingView | null> => {
    if (!(await requireKpiStaff())) return null;
    const { loadOfferRanking } = await import("@/server/kpi");
    return await loadOfferRanking(data.requestId);
  });

/**
 * Staff ask for the ranking to be computed again — for what no offer event
 * announces: a supplier's verification result that landed after the round
 * closed. Writes a new run only if something the ranking depends on changed.
 */
export const recomputeOfferRankingFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ roundId: z.string().min(1) }))
  .handler(async ({ data }): Promise<Kpi2RunOutcome | { ok: false; reason: "forbidden" }> => {
    const session = await requireKpiStaff();
    if (!session) return { ok: false, reason: "forbidden" };
    const { runKpi2 } = await import("@/server/kpi");
    const outcome = await runKpi2(data.roundId, "manual");
    if (outcome.ok && outcome.written) {
      const [{ logAudit, actorOf }, { db }, { eq }, schema] = await Promise.all([
        import("@/server/audit"),
        import("@/database"),
        import("drizzle-orm"),
        import("@/database/schema"),
      ]);
      const round = await db.query.rfqRound.findFirst({
        where: eq(schema.rfqRound.id, data.roundId),
        columns: { requestId: true, roundNo: true },
      });
      await logAudit({
        ...actorOf(session),
        action: "kpi.recomputed",
        target: round ? `#${round.requestId}` : null,
        detail: { round: round?.roundNo ?? null, offers: outcome.offers, run: outcome.runId },
      });
    }
    return outcome;
  });
