// The audit emitter (owner request 2026-08-27) — one door for "who did what".
// Failure-tolerant on purpose: a log row that cannot be written must never
// break the action it describes. Rows are per-org and per-user filterable;
// name snapshots keep history readable after the actor or workspace is gone.

import { db } from "@/database";
import * as schema from "@/database/schema";

export type AuditInput = {
  actorId?: string | null;
  actorName?: string | null;
  organizationId?: string | null;
  organizationName?: string | null;
  /** Dot-namespaced action code (account.deleted, plan.assigned…). */
  action: string;
  target?: string | null;
  detail?: Record<string, unknown> | null;
};

export async function logAudit(input: AuditInput): Promise<void> {
  try {
    await db.insert(schema.auditLog).values({
      id: crypto.randomUUID(),
      actorId: input.actorId ?? null,
      actorName: input.actorName ?? null,
      organizationId: input.organizationId ?? null,
      organizationName: input.organizationName ?? null,
      action: input.action,
      target: input.target ?? null,
      detail: input.detail ?? null,
    });
  } catch (error) {
    console.error(`audit: failed to log ${input.action}`, error);
  }
}

/** Convenience for server fns holding a better-auth session. */
export function actorOf(session: { user: { id: string; name: string } }): {
  actorId: string;
  actorName: string;
} {
  return { actorId: session.user.id, actorName: session.user.name };
}
