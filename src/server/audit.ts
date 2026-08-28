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

// ── Cross-hook context stash ─────────────────────────────────────────────────
// better-auth's organizationHooks receive only the affected records — never
// the acting session — while the root after-hook has the session but runs
// after the mutation (the previous role is overwritten, a UC-6 removal has
// already deleted the user). The org hook therefore stashes what only IT can
// see, keyed by member id, and the after-hook (same request) picks it up to
// write ONE audit row carrying both halves. Entries expire in case the
// endpoint dies between the two.

const auditStash = new Map<string, Record<string, unknown>>();

export function stashAuditContext(key: string, value: Record<string, unknown>): void {
  auditStash.set(key, value);
  setTimeout(() => auditStash.delete(key), 30_000).unref?.();
}

export function takeAuditContext(key: string): Record<string, unknown> | undefined {
  const value = auditStash.get(key);
  auditStash.delete(key);
  return value;
}
