// What the platform remembers about a supplier (Phase V · V31) — the rows.
//
// Written once, when staff close a dossier (`rememberDeal`, called by
// `closeDeal`); read by KPI #1 when it ranks (`performanceBySupplier`). The
// table holds facts and no score: see src/lib/supplier-performance.ts.

import { eq, inArray } from "drizzle-orm";
import { db } from "@/database";
import * as schema from "@/database/schema";
import {
  aggregatePerformance,
  performanceFacts,
  type PerformanceAggregate,
} from "@/lib/supplier-performance";
import type { Executor } from "@/server/requests";

/** The aggregate of each of these suppliers' closed deals. A supplier with
 *  none is simply absent from the map. */
export async function performanceBySupplier(
  supplierIds: readonly string[],
): Promise<Map<string, PerformanceAggregate>> {
  const ids = [...new Set(supplierIds)];
  if (ids.length === 0) return new Map();
  const rows = await db
    .select()
    .from(schema.supplierPerformance)
    .where(inArray(schema.supplierPerformance.supplierId, ids));
  const bySupplier = new Map<string, typeof rows>();
  for (const row of rows) {
    if (!row.supplierId) continue;
    const list = bySupplier.get(row.supplierId) ?? [];
    list.push(row);
    bySupplier.set(row.supplierId, list);
  }
  const aggregates = new Map<string, PerformanceAggregate>();
  for (const [supplierId, list] of bySupplier) {
    const aggregate = aggregatePerformance(list);
    if (aggregate) aggregates.set(supplierId, aggregate);
  }
  return aggregates;
}

/**
 * Write down what happened on a dossier that is being closed — its facts,
 * read from its own rows at that instant. Inside the closing transaction: a
 * dossier is not closed without being remembered, nor remembered twice (the
 * unique index on `deal_id` refuses a second row).
 */
export async function rememberDeal(
  deal: typeof schema.deal.$inferSelect,
  closedAt: Date,
  executor: Executor = db,
): Promise<void> {
  // One after the other: these may run on a transaction's single connection.
  const quote = deal.quoteId
    ? await executor
        .select({ sentAt: schema.quote.sentAt, respondedAt: schema.quote.respondedAt })
        .from(schema.quote)
        .where(eq(schema.quote.id, deal.quoteId))
    : [];
  const milestones = await executor
    .select()
    .from(schema.orderMilestone)
    .where(eq(schema.orderMilestone.dealId, deal.id));
  const issues = await executor
    .select({ status: schema.dealIssue.status })
    .from(schema.dealIssue)
    .where(eq(schema.dealIssue.dealId, deal.id));
  const facts = performanceFacts({
    sentAt: quote[0]?.sentAt ?? null,
    respondedAt: quote[0]?.respondedAt ?? null,
    milestones: milestones.map((milestone) => ({
      kind: milestone.kind,
      plannedAt: milestone.plannedAt ? milestone.plannedAt.toISOString() : null,
      completedAt: milestone.completedAt ? milestone.completedAt.toISOString() : null,
    })),
    satisfaction: deal.satisfaction,
    issues,
  });
  await executor.insert(schema.supplierPerformance).values({
    id: crypto.randomUUID(),
    supplierId: deal.supplierId,
    supplierName: deal.supplierName,
    dealId: deal.id,
    ...facts,
    closedAt,
  });
}
