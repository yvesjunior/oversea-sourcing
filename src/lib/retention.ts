// The retention policy itself — pure, so the rule can be read and tested
// without a database.

/**
 * How long a document survives after it loses everything it hung from
 * (owner, 2026-09-12). Counted from the day the sweep first noticed, not from
 * upload: the point is to give someone six months to realise they still needed
 * it, and that clock starts when the thing disappeared.
 */
export const DOCUMENT_RETENTION_MONTHS = 6;

/**
 * How long an ARCHIVED workspace is kept before it may be purged (owner,
 * 2026-09-13). Six YEARS, not six months, and the difference is the point:
 * six months is a reversal window — time for someone to realise they still
 * needed it — while an archive exists because the workspace holds contracts
 * and transactions, and those are OSI's own books. Canadian practice is to
 * keep books and records for six years, and OSI is a signing party to the
 * mandate, not merely the customer's filing cabinet.
 *
 * Nothing purges on this schedule yet; the number is recorded so the policy is
 * one constant rather than a memory, and `archivePurgeDue` says when a given
 * archive reaches it.
 */
export const ARCHIVE_RETENTION_YEARS = 6;

/** When an archive stamped at `archivedAt` becomes eligible for purging. */
export function archivePurgeDue(archivedAt: Date): Date {
  const due = new Date(archivedAt);
  due.setFullYear(due.getFullYear() + ARCHIVE_RETENTION_YEARS);
  return due;
}

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
