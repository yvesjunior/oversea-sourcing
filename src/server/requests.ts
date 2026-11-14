// Server-side request helpers — status transitions + activity events.
// Shared by server functions (via dynamic import) and the worker.

import { and, eq } from "drizzle-orm";
import { db } from "@/database";
import * as schema from "@/database/schema";
import type { RequestStatus } from "@/database/schema";
import { canTransition, isTerminal } from "@/lib/request-status";

/** The pool, or a transaction on it. Both helpers below take one so that a
 *  caller holding a transaction (closing an RFQ round, V07) can move the
 *  request and write its event inside it — all of it happens, or none. */
export type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Append an activity event; params are JSON-stringified into `message` and
 *  parsed at render time for i18n interpolation (e.g. {"count": 6}). */
export async function recordEvent(
  requestId: string,
  organizationId: string,
  type: string,
  params?: Record<string, unknown>,
  executor: Executor = db,
): Promise<void> {
  await executor.insert(schema.requestEvent).values({
    id: crypto.randomUUID(),
    requestId,
    organizationId,
    type,
    message: params ? JSON.stringify(params) : null,
  });
}

/**
 * The request was not in the state the caller read it in: something else
 * moved it in between (a buyer's cancel, the worker, another click).
 *
 * Thrown rather than swallowed so the caller decides. A worker job that
 * throws is retried and finds the request where it really is; a server fn
 * catches it and answers with a typed refusal.
 */
export class StaleTransitionError extends Error {
  constructor(
    readonly requestId: string,
    readonly from: RequestStatus,
    readonly to: RequestStatus,
  ) {
    super(`Stale request transition ${from} → ${to}: request ${requestId} is no longer ${from}`);
    this.name = "StaleTransitionError";
  }
}

/**
 * Guarded status transition: validates the state machine, stamps timestamps
 * (launchedAt on →received, completedAt on terminal states) and records the
 * status.* event. Throws on an illegal transition.
 *
 * CONDITIONAL since 2026-11-14: the row is only changed if it is still in
 * `from` (`StaleTransitionError` otherwise). It used to be written blindly,
 * so a status read a moment earlier could overwrite one written since — a
 * buyer's cancel undone by the pipeline finishing its stage, or by staff
 * sending an RFQ batch for a request withdrawn a second before. With the
 * pack flow there are more actors moving a request (staff, the round sweep,
 * the buyer), and each must lose cleanly to whoever got there first.
 */
export async function transitionRequest(
  requestId: string,
  organizationId: string,
  from: RequestStatus,
  to: RequestStatus,
  executor: Executor = db,
): Promise<void> {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal request transition ${from} → ${to} (request ${requestId})`);
  }
  const now = new Date();
  const moved = await executor
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
    .where(and(eq(schema.request.id, requestId), eq(schema.request.status, from)))
    .returning({ id: schema.request.id });
  if (moved.length === 0) throw new StaleTransitionError(requestId, from, to);
  await recordEvent(requestId, organizationId, `status.${to}`, undefined, executor);
}
