// The impure half of the transaction spine (Phase P) — DB writes and guarded
// transitions. The pure state machines live in src/lib/deal-status.ts, and
// this module is their only writer, exactly as src/server/requests.ts is for
// the request machine.

import { eq } from "drizzle-orm";
import { db } from "@/database";
import * as schema from "@/database/schema";
import type { DealStatus, QuoteStatus } from "@/database/schema";
import { canTransitionDeal, canTransitionQuote } from "@/lib/deal-status";

/** Timeline entry for a dossier. Same pattern as `recordEvent` for requests:
 *  a type plus JSON params rendered client-side, so history re-reads in
 *  whatever language the viewer is using. */
export async function recordDealEvent(
  dealId: string,
  organizationId: string,
  type: string,
  params?: Record<string, unknown>,
): Promise<void> {
  await db.insert(schema.dealEvent).values({
    id: crypto.randomUUID(),
    dealId,
    organizationId,
    type,
    message: params ? JSON.stringify(params) : null,
  });
}

/** Guarded quote transition. Throws on an illegal move rather than writing a
 *  state the machine forbids — a bug should surface where it happens. */
export async function transitionQuote(
  quoteId: string,
  from: QuoteStatus,
  to: QuoteStatus,
  patch: Partial<typeof schema.quote.$inferInsert> = {},
): Promise<void> {
  if (!canTransitionQuote(from, to)) {
    throw new Error(`Illegal quote transition ${from} → ${to} (quote ${quoteId})`);
  }
  await db
    .update(schema.quote)
    .set({ ...patch, status: to, updatedAt: new Date() })
    .where(eq(schema.quote.id, quoteId));
}

/**
 * Guarded deal transition, with the timestamps the machine implies.
 *
 * `delivered → closed` is deliberately NOT reachable (owner 2026-08-29:
 * "closed by staff, after buyer review with satisfaction") — it must pass
 * through `reviewed`, so a dossier can never be closed over a buyer who has
 * not spoken. That rule lives in `DEAL_TRANSITIONS`; this function simply
 * refuses what the table refuses.
 */
export async function transitionDeal(
  dealId: string,
  organizationId: string,
  from: DealStatus,
  to: DealStatus,
  patch: Partial<typeof schema.deal.$inferInsert> = {},
): Promise<void> {
  if (!canTransitionDeal(from, to)) {
    throw new Error(`Illegal deal transition ${from} → ${to} (deal ${dealId})`);
  }
  await db
    .update(schema.deal)
    .set({
      ...patch,
      status: to,
      ...(to === "closed" ? { closedAt: new Date() } : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.deal.id, dealId));
  await recordDealEvent(dealId, organizationId, `status.${to}`);
}
