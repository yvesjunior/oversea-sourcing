// Matching (E5 seam) — scores the platform-global supplier pool against a
// request and persists the Top 5 as `match` rows. Deterministic heuristic for
// now: the real engine (criteria × capabilities × sourcing_rules, the "32 OSI
// criteria") replaces `scoreSupplier` when E5 lands. Shared by worker + seed.

import { eq } from "drizzle-orm";
import { db } from "@/database";
import * as schema from "@/database/schema";
import { recordEvent } from "@/server/requests";

export const TOP_N = 5;

/** Stable per-(request, supplier) jitter so reruns rank identically. */
function hashJitter(seed: string, range: number): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % range;
}

function scoreSupplier(requestId: string, s: typeof schema.supplier.$inferSelect) {
  const verifiedBonus = s.verificationStatus === "verified" ? 6 : 0;
  const riskPenalty = s.riskLevel === "high" ? 8 : s.riskLevel === "medium" ? 3 : 0;
  const compatibility = Math.min(
    98,
    62 +
      Math.round(s.confidenceScore / 5) +
      verifiedBonus -
      riskPenalty +
      hashJitter(`${requestId}:${s.id}`, 14),
  );
  return { compatibility, confidence: s.confidenceScore };
}

/** Ranks all suppliers for the request, writes the Top 5 (idempotent —
 *  delete-then-insert), stamps the request's headline score and records the
 *  matches.created event with the analyzed pool size. Returns the pool size. */
export async function createMatchesForRequest(
  requestId: string,
  organizationId: string,
  options: { recordEvent?: boolean } = {},
): Promise<number> {
  const suppliers = await db.query.supplier.findMany();
  if (suppliers.length === 0) return 0;

  const ranked = suppliers
    .map((s) => ({ supplier: s, ...scoreSupplier(requestId, s) }))
    .sort((a, b) => b.compatibility - a.compatibility)
    .slice(0, TOP_N);

  await db.delete(schema.match).where(eq(schema.match.requestId, requestId));
  await db.insert(schema.match).values(
    ranked.map((entry, index) => ({
      id: `${requestId}-match-${entry.supplier.id}`,
      requestId,
      supplierId: entry.supplier.id,
      rank: index + 1,
      compatibilityScore: entry.compatibility,
      confidenceScore: entry.confidence,
      riskLevel: entry.supplier.riskLevel,
      status: "presented" as const,
    })),
  );

  const top = ranked[0];
  await db
    .update(schema.request)
    .set({ compatibilityScore: top ? top.compatibility : null, updatedAt: new Date() })
    .where(eq(schema.request.id, requestId));

  if (options.recordEvent !== false) {
    await recordEvent(requestId, organizationId, "matches.created", {
      count: ranked.length,
      analyzed: suppliers.length,
    });
  }
  return suppliers.length;
}
