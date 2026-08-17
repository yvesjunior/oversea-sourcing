// Plan resolution and request quota (subscriptions).
//
// Limits are rows, not constants: the manager screen edits them and the change
// is live on the next request — no deploy, no restart. A workspace with no
// subscription falls back to the environment defaults, so dev works with an
// empty `plan` table and nothing breaks on the way in.

import { and, count, eq, gte } from "drizzle-orm";
import { db } from "@/database";
import * as schema from "@/database/schema";
import type { ModelTier } from "@/database/schema";
import { RESEARCH_MODEL } from "@/server/ai/client";
import { SUPPLIERS_RETURNED } from "@/server/sourcing-config";

/** 0 means unlimited — see the column comment in schema.ts. */
export const UNLIMITED = 0;

export type EffectivePlan = {
  code: string;
  name: string;
  requestsPerDay: number;
  suppliersReturned: number;
  modelTier: ModelTier;
  /** False when the workspace has no subscription and we used env defaults. */
  fromSubscription: boolean;
};

/** What a workspace gets when no plan row applies to it. */
function envFallback(): EffectivePlan {
  return {
    code: "default",
    name: "Default",
    requestsPerDay: UNLIMITED,
    suppliersReturned: SUPPLIERS_RETURNED,
    modelTier: (RESEARCH_MODEL.id.includes("haiku")
      ? "cheap"
      : RESEARCH_MODEL.id.includes("sonnet")
        ? "balanced"
        : "best") as ModelTier,
    fromSubscription: false,
  };
}

export async function resolvePlan(organizationId: string): Promise<EffectivePlan> {
  const row = await db
    .select({
      code: schema.plan.code,
      name: schema.plan.name,
      requestsPerDay: schema.plan.requestsPerDay,
      suppliersReturned: schema.plan.suppliersReturned,
      modelTier: schema.plan.modelTier,
      status: schema.subscription.status,
    })
    .from(schema.subscription)
    .innerJoin(schema.plan, eq(schema.plan.id, schema.subscription.planId))
    .where(eq(schema.subscription.organizationId, organizationId))
    .limit(1);

  const found = row[0];
  // A cancelled or past-due subscription is not a licence to the paid limits,
  // but it must not lock the workspace out either — it drops to Free.
  if (!found) return envFallback();
  if (found.status !== "active") {
    const free = await db.query.plan.findFirst({ where: eq(schema.plan.code, "free") });
    if (!free) return envFallback();
    return {
      code: free.code,
      name: free.name,
      requestsPerDay: free.requestsPerDay,
      suppliersReturned: free.suppliersReturned,
      modelTier: free.modelTier,
      fromSubscription: true,
    };
  }

  return {
    code: found.code,
    name: found.name,
    requestsPerDay: found.requestsPerDay,
    suppliersReturned: found.suppliersReturned,
    modelTier: found.modelTier,
    fromSubscription: true,
  };
}

export type QuotaCheck = {
  allowed: boolean;
  /** Requests already made in the window. */
  used: number;
  /** 0 = unlimited. */
  limit: number;
  /** When the oldest request in the window ages out — null when unlimited. */
  resetAt: Date | null;
  planName: string;
};

/**
 * Has this workspace got a request left today?
 *
 * Counted from `request` rows in a rolling 24h window rather than a counter
 * column: always accurate, survives crashes, nothing to reconcile. A rolling
 * window also avoids the "two requests at 23:59" hole a calendar reset leaves,
 * and the "whose midnight?" support question that follows it.
 */
export async function checkRequestQuota(organizationId: string): Promise<QuotaCheck> {
  const plan = await resolvePlan(organizationId);
  if (plan.requestsPerDay === UNLIMITED) {
    return { allowed: true, used: 0, limit: UNLIMITED, resetAt: null, planName: plan.name };
  }

  const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [row] = await db
    .select({ value: count() })
    .from(schema.request)
    .where(
      and(
        eq(schema.request.organizationId, organizationId),
        gte(schema.request.createdAt, windowStart),
      ),
    );
  const used = row?.value ?? 0;

  // The allowance returns when the OLDEST request in the window ages out, not
  // at midnight — that is what a rolling window actually means.
  let resetAt: Date | null = null;
  if (used >= plan.requestsPerDay) {
    const oldest = await db.query.request.findFirst({
      where: and(
        eq(schema.request.organizationId, organizationId),
        gte(schema.request.createdAt, windowStart),
      ),
      orderBy: (fields, { asc }) => [asc(fields.createdAt)],
    });
    if (oldest) resetAt = new Date(oldest.createdAt.getTime() + 24 * 60 * 60 * 1000);
  }

  return {
    allowed: used < plan.requestsPerDay,
    used,
    limit: plan.requestsPerDay,
    resetAt,
    planName: plan.name,
  };
}
