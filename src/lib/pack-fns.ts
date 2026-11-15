// The Decision Pack — server fns (Phase V · V10). Staff only, `deals`.
//
// Nothing here is for the workspace that owns the request: a pending pack is
// OSI's working draft, and the four things done to it are staff's. The
// buyer's reader arrives with the page that shows a released pack (V12),
// through `getPackView(…, "buyer")`.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type {
  PackActionResult,
  QueuedPack,
  RefusePackResult,
  RelaunchPackResult,
  RequestPackView,
} from "@/server/decision-pack";

export type {
  PackActionRefusal,
  PackActionResult,
  PackEventView,
  QueuedPack,
  RefusePackResult,
  RelaunchCandidate,
  RelaunchPackResult,
  RequestPackView,
} from "@/server/decision-pack";
export type {
  PackItemView,
  PackOfferSnapshot,
  PackRankingReason,
  PackView,
} from "@/lib/decision-pack";

async function requirePackStaff() {
  const [{ auth }, { getRequest }, { effectiveHasPermission }] = await Promise.all([
    import("@/server/auth"),
    import("@tanstack/react-start/server"),
    import("@/server/workspace-guard"),
  ]);
  const session = await auth.api.getSession({ headers: getRequest().headers });
  if (!session || !(await effectiveHasPermission(session, "deals"))) return null;
  return session;
}

type Forbidden = { ok: false; reason: "forbidden" };
const FORBIDDEN: Forbidden = { ok: false, reason: "forbidden" };

/** The request's most recent pack. Null for anyone but staff holding
 *  `deals`, and when no round of the request has closed into a review. */
export const getPackForRequestFn = createServerFn({ method: "GET" })
  .inputValidator(z.object({ requestId: z.string().min(1) }))
  .handler(async ({ data }): Promise<RequestPackView | null> => {
    if (!(await requirePackStaff())) return null;
    const { loadPackForRequest } = await import("@/server/decision-pack");
    return await loadPackForRequest(data.requestId);
  });

// ── the release queue (V11) ─────────────────────────────────────────────────
//
// Every act is recorded twice, on purpose: in `decision_pack_event` (by the
// server module, in the same transaction — permanent, beside the pack) and in
// `audit_log` (here — the journal staff read, purged at three months).

export type PackQueueData = { packs: QueuedPack[]; me: string };

/** Every pack awaiting a decision, longest wait first. */
export const getPackQueueFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<PackQueueData | null> => {
    const session = await requirePackStaff();
    if (!session) return null;
    const { listPackQueue } = await import("@/server/decision-pack");
    return { packs: await listPackQueue(), me: session.user.id };
  },
);

/** Release the pack as built. */
export const approvePackFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ packId: z.string().min(1) }))
  .handler(async ({ data }): Promise<PackActionResult | Forbidden> => {
    const session = await requirePackStaff();
    if (!session) return FORBIDDEN;
    const { approvePack } = await import("@/server/decision-pack");
    const result = await approvePack(data.packId, {
      id: session.user.id,
      name: session.user.name,
    });
    if (result.ok) {
      const { logAudit, actorOf } = await import("@/server/audit");
      await logAudit({
        ...actorOf(session),
        action: "pack.approved",
        target: `#${result.requestId}`,
        detail: { pack: data.packId, items: result.items },
      });
    }
    return result;
  });

/** Change the order or withhold offers, with a reason, and release. */
export const correctPackFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      packId: z.string().min(1),
      /** The offers the buyer will see, best first (quote ids). */
      order: z.array(z.string().min(1)).max(50),
      /** The offers withheld (quote ids). */
      removals: z.array(z.string().min(1)).max(50),
      note: z.string().trim().max(1000),
    }),
  )
  .handler(async ({ data }): Promise<PackActionResult | Forbidden> => {
    const session = await requirePackStaff();
    if (!session) return FORBIDDEN;
    const { correctPack } = await import("@/server/decision-pack");
    const result = await correctPack(
      data.packId,
      { id: session.user.id, name: session.user.name },
      { order: data.order, removals: data.removals, note: data.note },
    );
    if (result.ok) {
      const { logAudit, actorOf } = await import("@/server/audit");
      await logAudit({
        ...actorOf(session),
        action: "pack.corrected",
        target: `#${result.requestId}`,
        detail: {
          pack: data.packId,
          shown: result.items,
          withheld: data.removals.length,
          note: data.note,
        },
      });
    }
    return result;
  });

/** Open a new round for more suppliers; the pack stays pending. */
export const relaunchPackFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      packId: z.string().min(1),
      supplierIds: z.array(z.string().min(1)).max(50),
      note: z.string().trim().max(1000),
    }),
  )
  .handler(async ({ data }): Promise<RelaunchPackResult | Forbidden> => {
    const session = await requirePackStaff();
    if (!session) return FORBIDDEN;
    const { relaunchPack } = await import("@/server/decision-pack");
    const result = await relaunchPack(
      data.packId,
      { id: session.user.id, name: session.user.name },
      { supplierIds: data.supplierIds, note: data.note },
    );
    if (result.ok) {
      const { logAudit, actorOf } = await import("@/server/audit");
      await logAudit({
        ...actorOf(session),
        action: "pack.relaunched",
        target: `#${result.requestId}`,
        detail: {
          pack: data.packId,
          round: result.roundNo,
          sent: result.sent,
          failed: result.failed.length,
          note: data.note,
        },
      });
    }
    return result;
  });

/** Refuse to send a pack; the request ends `unfulfilled` and the buyer is
 *  told why. */
export const refusePackFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ packId: z.string().min(1), reason: z.string().trim().max(1000) }))
  .handler(async ({ data }): Promise<RefusePackResult | Forbidden> => {
    const session = await requirePackStaff();
    if (!session) return FORBIDDEN;
    const { refusePack } = await import("@/server/decision-pack");
    const result = await refusePack(
      data.packId,
      { id: session.user.id, name: session.user.name },
      data.reason,
    );
    if (result.ok) {
      const { logAudit, actorOf } = await import("@/server/audit");
      await logAudit({
        ...actorOf(session),
        action: "pack.refused",
        target: `#${result.requestId}`,
        detail: { pack: data.packId, reason: data.reason, holdersTold: result.holdersTold },
      });
    }
    return result;
  });

/** Take a pack onto one's own desk, or put it back. Assigning to someone
 *  ELSE is not offered: a pack lands on a desk because its owner took it. */
export const assignPackFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ packId: z.string().min(1), take: z.boolean() }))
  .handler(
    async ({
      data,
    }): Promise<
      { ok: true } | { ok: false; reason: "forbidden" | "not_found" | "not_pending" }
    > => {
      const session = await requirePackStaff();
      if (!session) return FORBIDDEN;
      const actor = { id: session.user.id, name: session.user.name };
      const { assignPack } = await import("@/server/decision-pack");
      const result = await assignPack(data.packId, actor, data.take ? actor : null);
      if (result.ok) {
        const { logAudit, actorOf } = await import("@/server/audit");
        await logAudit({
          ...actorOf(session),
          action: "pack.assigned",
          target: data.packId,
          detail: { taken: data.take },
        });
      }
      return result;
    },
  );
