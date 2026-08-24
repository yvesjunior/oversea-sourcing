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
  /** Lifetime cap (B8): 0 = unlimited; Free = 2 — the trial. */
  maxRequestsTotal: number;
  /** Seats: 0 = unlimited. Invitations are refused at the cap (B3). */
  maxMembers: number;
  /** Who the counters bind to: individual plans count per user, organization
   *  plans pool per workspace. */
  quotaScope: "workspace" | "user";
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
    maxRequestsTotal: UNLIMITED,
    maxMembers: UNLIMITED,
    quotaScope: "workspace",
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
      maxRequestsTotal: schema.plan.maxRequestsTotal,
      maxMembers: schema.plan.maxMembers,
      quotaScope: schema.plan.quotaScope,
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
      maxRequestsTotal: free.maxRequestsTotal,
      maxMembers: free.maxMembers,
      quotaScope: free.quotaScope,
      suppliersReturned: free.suppliersReturned,
      modelTier: free.modelTier,
      fromSubscription: true,
    };
  }

  return {
    code: found.code,
    name: found.name,
    requestsPerDay: found.requestsPerDay,
    maxRequestsTotal: found.maxRequestsTotal,
    maxMembers: found.maxMembers,
    quotaScope: found.quotaScope,
    suppliersReturned: found.suppliersReturned,
    modelTier: found.modelTier,
    fromSubscription: true,
  };
}

export type QuotaCheck = {
  allowed: boolean;
  /** Why a refusal refuses: the daily window resets; the lifetime cap only
   *  ends with an upgrade — the UI pitches different actions for each. */
  refusal: "daily" | "lifetime" | null;
  /** Requests already made in the rolling 24h window. */
  used: number;
  /** 0 = unlimited. */
  limit: number;
  /** Lifetime requests made / cap (0 = unlimited). */
  usedTotal: number;
  limitTotal: number;
  /** When the oldest request in the window ages out — null when unlimited. */
  resetAt: Date | null;
  planName: string;
};

/**
 * Has this caller got a request left?
 *
 * Two ceilings (B8, decided 2026-08-23): the rolling 24h window AND the
 * lifetime cap (Free = 2 — the trial). Both bind to the plan's quota scope:
 * individual plans count the USER's requests in this workspace, organization
 * plans pool the whole WORKSPACE's.
 *
 * Counted from `request` rows rather than a counter column: always accurate,
 * survives crashes, nothing to reconcile. A rolling window also avoids the
 * "two requests at 23:59" hole a calendar reset leaves, and the "whose
 * midnight?" support question that follows it.
 */
export async function checkRequestQuota(
  organizationId: string,
  userId?: string,
): Promise<QuotaCheck> {
  const plan = await resolvePlan(organizationId);

  const scopeCondition =
    plan.quotaScope === "user" && userId
      ? and(eq(schema.request.organizationId, organizationId), eq(schema.request.createdBy, userId))
      : eq(schema.request.organizationId, organizationId);

  const base = {
    used: 0,
    limit: plan.requestsPerDay,
    usedTotal: 0,
    limitTotal: plan.maxRequestsTotal,
    resetAt: null as Date | null,
    planName: plan.name,
  };

  // Lifetime first: an exhausted trial never comes back, so the daily answer
  // ("try again at 14:00") would be a lie.
  if (plan.maxRequestsTotal !== UNLIMITED) {
    const [totalRow] = await db
      .select({ value: count() })
      .from(schema.request)
      .where(scopeCondition);
    const usedTotal = totalRow?.value ?? 0;
    base.usedTotal = usedTotal;
    if (usedTotal >= plan.maxRequestsTotal) {
      return { ...base, allowed: false, refusal: "lifetime" };
    }
  }

  if (plan.requestsPerDay === UNLIMITED) {
    return { ...base, allowed: true, refusal: null, limit: UNLIMITED };
  }

  const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const windowCondition = and(scopeCondition, gte(schema.request.createdAt, windowStart));
  const [row] = await db.select({ value: count() }).from(schema.request).where(windowCondition);
  const used = row?.value ?? 0;
  base.used = used;

  // The allowance returns when the OLDEST request in the window ages out, not
  // at midnight — that is what a rolling window actually means.
  if (used >= plan.requestsPerDay) {
    const oldest = await db.query.request.findFirst({
      where: windowCondition,
      orderBy: (fields, { asc }) => [asc(fields.createdAt)],
    });
    if (oldest) base.resetAt = new Date(oldest.createdAt.getTime() + 24 * 60 * 60 * 1000);
    return { ...base, allowed: false, refusal: "daily" };
  }

  return { ...base, allowed: true, refusal: null };
}
