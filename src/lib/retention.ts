// The retention policy itself — pure, so the rule can be read and tested
// without a database.

/**
 * How long a document survives after it loses everything it hung from
 * (owner, 2026-09-12). Counted from the day the sweep first noticed, not from
 * upload: the point is to give someone six months to realise they still needed
 * it, and that clock starts when the thing disappeared.
 */
export const DOCUMENT_RETENTION_MONTHS = 6;

/** Orphans stamped before this are past the window. */
export function retentionCutoff(now: Date = new Date()): Date {
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - DOCUMENT_RETENTION_MONTHS);
  return cutoff;
}

/** Whether one orphan is due for purging. Null = still attached to something. */
export function isPurgeable(orphanedAt: Date | null, now: Date = new Date()): boolean {
  if (orphanedAt === null) return false;
  return orphanedAt.getTime() < retentionCutoff(now).getTime();
}
