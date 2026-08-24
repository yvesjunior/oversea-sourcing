// Data-source administration (C1, staff surface) — the catalogue screen
// `/interne/sources`: enable/disable sources, browse each source's store
// (supplier_source memberships), trigger a scoped "Mettre à jour" collection,
// and manage bans (per-source and global) with a who/when/why trail.
//
// The refresh itself runs on the research queue (worker-research owns all
// collection — web never calls Claude): the fn creates the source_run row so
// the screen shows it as running immediately, then enqueues {sourceRunId}.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { DataSourceType } from "@/database/schema";

export type SourceRunView = {
  id: string;
  trigger: "request" | "admin";
  status: "running" | "succeeded" | "failed";
  /** Refresh scope (category/country) for admin runs; null for request runs. */
  category: string | null;
  countryCode: string | null;
  requestId: string | null;
  triggeredByName: string | null;
  candidatesFound: number;
  suppliersAdded: number;
  membershipsUpserted: number;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
};

export type SourceCatalogueView = {
  id: string;
  code: string;
  name: string;
  type: DataSourceType;
  countryCode: string | null;
  enabled: boolean;
  /** A registered connector can collect live; without one the source is
   *  store-only and "Mettre à jour" has nothing to run. */
  hasConnector: boolean;
  storeActive: number;
  storeBanned: number;
  /** Active memberships seen within STORE_FRESH_DAYS. */
  storeFresh: number;
  runningRuns: number;
  lastRun: SourceRunView | null;
};

export type SourceMembershipView = {
  membershipId: string;
  supplierId: string;
  name: string;
  countryCode: string;
  website: string | null;
  verificationStatus: string;
  confidenceScore: number;
  status: "active" | "banned";
  firstSeenAt: string;
  lastSeenAt: string;
  bannedByName: string | null;
  bannedReason: string | null;
  /** Global ban on the supplier itself (never matched, for anyone). */
  globallyBanned: boolean;
  globalBanReason: string | null;
};

export type SourceDetailView = {
  memberships: SourceMembershipView[];
  /** True when the store browser was capped — the tail exists but isn't shown. */
  truncated: boolean;
  runs: SourceRunView[];
};

/** owner|manager only — the feature gate lives in src/lib/roles.ts. */
async function requireSourceAdmin() {
  const [{ auth }, { getRequest }, { hasPlatformFeature }] = await Promise.all([
    import("@/server/auth"),
    import("@tanstack/react-start/server"),
    import("@/lib/roles"),
  ]);
  const session = await auth.api.getSession({ headers: getRequest().headers });
  if (!session || !hasPlatformFeature(session.user.platformRole, "sources")) return null;
  return session;
}

type RunRow = {
  id: string;
  trigger: "request" | "admin";
  status: "running" | "succeeded" | "failed";
  scope: Record<string, unknown> | null;
  requestId: string | null;
  triggeredByName: string | null;
  candidatesFound: number;
  suppliersAdded: number;
  membershipsUpserted: number;
  error: string | null;
  createdAt: Date;
  completedAt: Date | null;
};

function toRunView(row: RunRow): SourceRunView {
  const scope = row.scope ?? {};
  return {
    id: row.id,
    trigger: row.trigger,
    status: row.status,
    category: typeof scope["category"] === "string" ? scope["category"] : null,
    countryCode: typeof scope["countryCode"] === "string" ? scope["countryCode"] : null,
    requestId: row.requestId,
    triggeredByName: row.triggeredByName,
    candidatesFound: row.candidatesFound,
    suppliersAdded: row.suppliersAdded,
    membershipsUpserted: row.membershipsUpserted,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

export const getSourceAdminFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<SourceCatalogueView[]> => {
    const session = await requireSourceAdmin();
    if (!session) return [];

    const [{ db }, { desc, eq, sql }, schema, { getConnector }, { STORE_FRESH_DAYS }] =
      await Promise.all([
        import("@/database"),
        import("drizzle-orm"),
        import("@/database/schema"),
        import("@/server/sources/registry"),
        import("@/server/sourcing-config"),
      ]);

    const freshCutoff = new Date(Date.now() - STORE_FRESH_DAYS * 24 * 60 * 60 * 1000);
    const [sources, storeCounts, runs] = await Promise.all([
      db.query.dataSource.findMany({ orderBy: [schema.dataSource.createdAt] }),
      db
        .select({
          dataSourceId: schema.supplierSource.dataSourceId,
          active: sql<number>`count(*) filter (where ${schema.supplierSource.status} = 'active')::int`,
          banned: sql<number>`count(*) filter (where ${schema.supplierSource.status} = 'banned')::int`,
          fresh: sql<number>`count(*) filter (where ${schema.supplierSource.status} = 'active' and ${schema.supplierSource.lastSeenAt} >= ${freshCutoff})::int`,
        })
        .from(schema.supplierSource)
        .groupBy(schema.supplierSource.dataSourceId),
      // Health comes from real usage: the latest run per source + running count.
      db
        .select({
          id: schema.sourceRun.id,
          dataSourceId: schema.sourceRun.dataSourceId,
          trigger: schema.sourceRun.trigger,
          status: schema.sourceRun.status,
          scope: schema.sourceRun.scope,
          requestId: schema.sourceRun.requestId,
          triggeredByName: schema.user.name,
          candidatesFound: schema.sourceRun.candidatesFound,
          suppliersAdded: schema.sourceRun.suppliersAdded,
          membershipsUpserted: schema.sourceRun.membershipsUpserted,
          error: schema.sourceRun.error,
          createdAt: schema.sourceRun.createdAt,
          completedAt: schema.sourceRun.completedAt,
        })
        .from(schema.sourceRun)
        .leftJoin(schema.user, eq(schema.user.id, schema.sourceRun.triggeredBy))
        .orderBy(desc(schema.sourceRun.createdAt))
        .limit(200),
    ]);

    const countsBySource = new Map(storeCounts.map((row) => [row.dataSourceId, row]));
    const lastRunBySource = new Map<string, RunRow>();
    const runningBySource = new Map<string, number>();
    for (const run of runs) {
      if (!lastRunBySource.has(run.dataSourceId)) lastRunBySource.set(run.dataSourceId, run);
      if (run.status === "running") {
        runningBySource.set(run.dataSourceId, (runningBySource.get(run.dataSourceId) ?? 0) + 1);
      }
    }

    return sources.map((source) => {
      const counts = countsBySource.get(source.id);
      const lastRun = lastRunBySource.get(source.id);
      return {
        id: source.id,
        code: source.code,
        name: source.name,
        type: source.type,
        countryCode: source.countryCode,
        enabled: source.enabled,
        hasConnector: getConnector(source.code) !== undefined,
        storeActive: counts?.active ?? 0,
        storeBanned: counts?.banned ?? 0,
        storeFresh: counts?.fresh ?? 0,
        runningRuns: runningBySource.get(source.id) ?? 0,
        lastRun: lastRun ? toRunView(lastRun) : null,
      };
    });
  },
);

/** The store cap — plenty for the current pool; the day a source holds more,
 *  this screen needs search/pagination, not a bigger cap. */
const STORE_BROWSER_LIMIT = 200;

export const getSourceDetailFn = createServerFn({ method: "GET" })
  .inputValidator(z.object({ dataSourceId: z.string() }))
  .handler(async ({ data }): Promise<SourceDetailView> => {
    const session = await requireSourceAdmin();
    if (!session) return { memberships: [], truncated: false, runs: [] };

    const [{ db }, { desc, eq }, schema] = await Promise.all([
      import("@/database"),
      import("drizzle-orm"),
      import("@/database/schema"),
    ]);

    const [memberships, runs] = await Promise.all([
      db
        .select({
          membershipId: schema.supplierSource.id,
          supplierId: schema.supplier.id,
          name: schema.supplier.name,
          countryCode: schema.supplier.countryCode,
          website: schema.supplier.website,
          verificationStatus: schema.supplier.verificationStatus,
          confidenceScore: schema.supplier.confidenceScore,
          status: schema.supplierSource.status,
          firstSeenAt: schema.supplierSource.firstSeenAt,
          lastSeenAt: schema.supplierSource.lastSeenAt,
          bannedByName: schema.user.name,
          bannedReason: schema.supplierSource.bannedReason,
          globalBannedAt: schema.supplier.bannedAt,
          globalBanReason: schema.supplier.bannedReason,
        })
        .from(schema.supplierSource)
        .innerJoin(schema.supplier, eq(schema.supplier.id, schema.supplierSource.supplierId))
        .leftJoin(schema.user, eq(schema.user.id, schema.supplierSource.bannedBy))
        .where(eq(schema.supplierSource.dataSourceId, data.dataSourceId))
        .orderBy(desc(schema.supplierSource.lastSeenAt))
        .limit(STORE_BROWSER_LIMIT + 1),
      db
        .select({
          id: schema.sourceRun.id,
          dataSourceId: schema.sourceRun.dataSourceId,
          trigger: schema.sourceRun.trigger,
          status: schema.sourceRun.status,
          scope: schema.sourceRun.scope,
          requestId: schema.sourceRun.requestId,
          triggeredByName: schema.user.name,
          candidatesFound: schema.sourceRun.candidatesFound,
          suppliersAdded: schema.sourceRun.suppliersAdded,
          membershipsUpserted: schema.sourceRun.membershipsUpserted,
          error: schema.sourceRun.error,
          createdAt: schema.sourceRun.createdAt,
          completedAt: schema.sourceRun.completedAt,
        })
        .from(schema.sourceRun)
        .leftJoin(schema.user, eq(schema.user.id, schema.sourceRun.triggeredBy))
        .where(eq(schema.sourceRun.dataSourceId, data.dataSourceId))
        .orderBy(desc(schema.sourceRun.createdAt))
        .limit(20),
    ]);

    const truncated = memberships.length > STORE_BROWSER_LIMIT;
    return {
      memberships: memberships.slice(0, STORE_BROWSER_LIMIT).map((row) => ({
        membershipId: row.membershipId,
        supplierId: row.supplierId,
        name: row.name,
        countryCode: row.countryCode,
        website: row.website,
        verificationStatus: row.verificationStatus,
        confidenceScore: row.confidenceScore,
        status: row.status,
        firstSeenAt: row.firstSeenAt.toISOString(),
        lastSeenAt: row.lastSeenAt.toISOString(),
        bannedByName: row.status === "banned" ? row.bannedByName : null,
        bannedReason: row.status === "banned" ? row.bannedReason : null,
        globallyBanned: row.globalBannedAt !== null,
        globalBanReason: row.globalBanReason,
      })),
      truncated,
      runs: runs.map(toRunView),
    };
  });

/** Enable/disable a catalogue source — a disabled source is never consulted,
 *  for anyone (its store stays intact and comes back with the flag). */
export const toggleSourceFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string(), enabled: z.boolean() }))
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const session = await requireSourceAdmin();
    if (!session) return { ok: false };

    const [{ db }, { eq }, schema] = await Promise.all([
      import("@/database"),
      import("drizzle-orm"),
      import("@/database/schema"),
    ]);
    await db
      .update(schema.dataSource)
      .set({ enabled: data.enabled, updatedAt: new Date() })
      .where(eq(schema.dataSource.id, data.id));
    return { ok: true };
  });

/** Trigger a scoped collection ("Mettre à jour"). Category is required — the
 *  only live connector is a web search, and an unscoped "refresh the internet"
 *  is not a thing; store-only sources are refused (nothing to run). A disabled
 *  source CAN be refreshed on purpose: warming a store before enabling it is a
 *  legitimate rollout move. */
export const triggerSourceRefreshFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      dataSourceId: z.string(),
      category: z.string().trim().min(2).max(120),
      countryCode: z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[A-Z]{2}$/)
        .optional(),
    }),
  )
  .handler(async ({ data }): Promise<{ ok: boolean; error?: string }> => {
    const session = await requireSourceAdmin();
    if (!session) return { ok: false, error: "forbidden" };

    const [{ db }, { and, eq }, schema, { getConnector }, { enqueueAdminRefresh }] =
      await Promise.all([
        import("@/database"),
        import("drizzle-orm"),
        import("@/database/schema"),
        import("@/server/sources/registry"),
        import("@/server/queue"),
      ]);

    const source = await db.query.dataSource.findFirst({
      where: eq(schema.dataSource.id, data.dataSourceId),
    });
    if (!source) return { ok: false, error: "not_found" };
    if (!getConnector(source.code)) return { ok: false, error: "store_only" };

    // One admin refresh at a time per source — a second click must not double
    // the Claude spend while the first is still collecting.
    const alreadyRunning = await db.query.sourceRun.findFirst({
      where: and(
        eq(schema.sourceRun.dataSourceId, source.id),
        eq(schema.sourceRun.trigger, "admin"),
        eq(schema.sourceRun.status, "running"),
      ),
    });
    if (alreadyRunning) return { ok: false, error: "already_running" };

    const runId = crypto.randomUUID();
    await db.insert(schema.sourceRun).values({
      id: runId,
      dataSourceId: source.id,
      trigger: "admin",
      triggeredBy: session.user.id,
      status: "running",
      scope: {
        category: data.category,
        ...(data.countryCode ? { countryCode: data.countryCode } : {}),
      },
    });
    await enqueueAdminRefresh(runId);
    return { ok: true };
  });

/** Per-source ban/unban — this source's data for the company is ignored while
 *  other sources can still surface it. Sticky across re-collection (the
 *  upsert in research.ts only touches active rows). */
export const setMembershipStatusFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.discriminatedUnion("action", [
      z.object({
        action: z.literal("ban"),
        membershipId: z.string(),
        reason: z.string().trim().min(3).max(300),
      }),
      z.object({ action: z.literal("unban"), membershipId: z.string() }),
    ]),
  )
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const session = await requireSourceAdmin();
    if (!session) return { ok: false };

    const [{ db }, { eq }, schema] = await Promise.all([
      import("@/database"),
      import("drizzle-orm"),
      import("@/database/schema"),
    ]);
    await db
      .update(schema.supplierSource)
      .set(
        data.action === "ban"
          ? { status: "banned", bannedBy: session.user.id, bannedReason: data.reason }
          : { status: "active", bannedBy: null, bannedReason: null },
      )
      .where(eq(schema.supplierSource.id, data.membershipId));
    return { ok: true };
  });

/** Global supplier ban — never matched, never shown, for anyone (fraud,
 *  sanctions). Sticky: the dedup key lands re-encounters on this row. */
export const setSupplierBanFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.discriminatedUnion("action", [
      z.object({
        action: z.literal("ban"),
        supplierId: z.string(),
        reason: z.string().trim().min(3).max(300),
      }),
      z.object({ action: z.literal("unban"), supplierId: z.string() }),
    ]),
  )
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const session = await requireSourceAdmin();
    if (!session) return { ok: false };

    const [{ db }, { eq }, schema] = await Promise.all([
      import("@/database"),
      import("drizzle-orm"),
      import("@/database/schema"),
    ]);
    await db
      .update(schema.supplier)
      .set(
        data.action === "ban"
          ? { bannedAt: new Date(), bannedBy: session.user.id, bannedReason: data.reason }
          : { bannedAt: null, bannedBy: null, bannedReason: null },
      )
      .where(eq(schema.supplier.id, data.supplierId));
    return { ok: true };
  });
