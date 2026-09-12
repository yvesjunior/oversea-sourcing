// Document retention (owner, 2026-09-12: "keep documents 6 months after
// request deletion").
//
// Two acts, deliberately separate, because they answer different questions:
//
//   MARK  — a document whose request AND quote references are both gone is
//           orphaned; stamp when we first noticed. The references are SET NULL
//           (that is what lets a document survive its source), so the row
//           cannot otherwise say WHEN it was orphaned, and a retention rule is
//           nothing without that date.
//   PURGE — an orphan older than the window loses its row AND its bytes.
//
// The bytes are the point. `storage.deleteFile` had never been called on a
// user file anywhere in this codebase, so every deletion so far has left the
// upload volume growing forever — which was tolerable while it held
// re-uploadable spec sheets and stopped being tolerable the day it started
// holding supplier quotations.

import { and, eq, isNotNull, isNull, lt } from "drizzle-orm";
import { db } from "@/database";
import * as schema from "@/database/schema";
import { DOCUMENT_RETENTION_MONTHS, retentionCutoff } from "@/lib/retention";

export type RetentionOutcome = { marked: number; purged: number; bytesFreed: number };

/**
 * One pass of the policy. Safe to run as often as you like: marking is
 * idempotent (only rows with a null stamp), and purging only touches rows
 * whose stamp is already past the window.
 */
export async function sweepDocumentRetention(now = new Date()): Promise<RetentionOutcome> {
  const marked = await db
    .update(schema.document)
    .set({ orphanedAt: now })
    .where(
      and(
        isNull(schema.document.orphanedAt),
        isNull(schema.document.requestId),
        isNull(schema.document.quoteId),
      ),
    )
    .returning({ id: schema.document.id });

  const cutoff = retentionCutoff(now);
  const expired = await db
    .select({ document: schema.document, file: schema.file })
    .from(schema.document)
    .innerJoin(schema.file, eq(schema.file.id, schema.document.fileId))
    .where(and(isNotNull(schema.document.orphanedAt), lt(schema.document.orphanedAt, cutoff)));

  let bytesFreed = 0;
  const storage = await import("@/server/storage");
  for (const row of expired) {
    // Bytes first: a file row without its bytes is a broken download, while
    // bytes without a row are invisible. If this throws we have lost nothing
    // and the next pass retries.
    await storage.deleteFile(row.file.storageKey);
    // The document row goes with the file row (FK is cascade), so deleting the
    // file is enough — done explicitly here so the intent is readable.
    await db.delete(schema.document).where(eq(schema.document.id, row.document.id));
    await db.delete(schema.file).where(eq(schema.file.id, row.file.id));
    bytesFreed += row.file.size;
  }

  if (marked.length > 0 || expired.length > 0) {
    const { logAudit } = await import("@/server/audit");
    await logAudit({
      // No actor: this is the policy running, not a person acting.
      actorId: null,
      actorName: null,
      action: "document.retention_swept",
      detail: {
        marked: marked.length,
        purged: expired.length,
        bytesFreed,
        months: DOCUMENT_RETENTION_MONTHS,
      },
    });
    console.log(
      `retention: marked ${marked.length} orphan(s), purged ${expired.length} past ` +
        `${DOCUMENT_RETENTION_MONTHS} months (${bytesFreed} bytes freed)`,
    );
  }
  return { marked: marked.length, purged: expired.length, bytesFreed };
}
