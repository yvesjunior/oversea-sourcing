// Server-side request helpers — status transitions + activity events.
// Shared by server functions (via dynamic import) and the worker.

import { eq } from "drizzle-orm";
import { db } from "@/database";
import * as schema from "@/database/schema";
import type { RequestStatus } from "@/database/schema";
import { canTransition, isTerminal } from "@/lib/request-status";

/** Append an activity event; params are JSON-stringified into `message` and
 *  parsed at render time for i18n interpolation (e.g. {"count": 6}). */
export async function recordEvent(
  requestId: string,
  organizationId: string,
  type: string,
  params?: Record<string, unknown>,
): Promise<void> {
  await db.insert(schema.requestEvent).values({
    id: crypto.randomUUID(),
    requestId,
    organizationId,
    type,
    message: params ? JSON.stringify(params) : null,
  });
}

/** Guarded status transition: validates the state machine, stamps timestamps
 *  (launchedAt on →received, completedAt on terminal states) and records the
 *  status.* event. Throws on an illegal transition. */
export async function transitionRequest(
  requestId: string,
  organizationId: string,
  from: RequestStatus,
  to: RequestStatus,
): Promise<void> {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal request transition ${from} → ${to} (request ${requestId})`);
  }
  const now = new Date();
  await db
    .update(schema.request)
    .set({
      status: to,
      updatedAt: now,
      ...(to === "received" ? { launchedAt: now } : {}),
      // `report_ready` completes a request on either flow (the report, or the
      // released pack); the terminal states complete it by ending it.
      ...(to === "report_ready" || isTerminal(to) ? { completedAt: now } : {}),
      // Reopened — a research re-run sends report_ready back to searching, and
      // on the pack flow an expired offer sends it back to soliciting: a
      // request that is working again has no completion date, and leaving the
      // old one would have the dossier claim it finished before it did.
      ...(to === "searching" || to === "soliciting" ? { completedAt: null } : {}),
    })
    .where(eq(schema.request.id, requestId));
  await recordEvent(requestId, organizationId, `status.${to}`);
}
