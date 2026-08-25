// Data-source administration (C1 + Phase D, staff surface) — the catalogue
// screen `/interne/sources`: enable/disable sources, browse each source's
// store (raw `source_record` candidates, promoted or not), trigger the
// full-pull "Mettre à jour" on static sources, manage bans (per-record and
// global) with a who/when/why trail, and WIPE a store (Phase D: stores are
// disposable — promoted suppliers, matches and requests are never touched).
//
// The refresh runs on the research queue (worker-research owns all
// collection — web never calls Claude): the fn creates the source_run row so
// the screen shows it as running immediately, then enqueues {sourceRunId}.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { DataSourceType } from "@/database/schema";

export type SourceRunView = {
  id: string;
  trigger: "request" | "admin";
  status: "running" | "succeeded" | "failed";
  /** 'wipe' for store-wipe audit rows; null for collections. */
  action: string | null;
  /** Records deleted by a wipe (audit detail). */
  deleted: number | null;
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
  /** A registered connector can collect; without one the source is store-only. */
  hasConnector: boolean;
  /** The full pull needs a staff-uploaded file (file-fed source). */
  requiresFile: boolean;
  /** Where staff downloads that file (link shown on the tab). */
  downloadUrl: string | null;
  storeActive: number;
  storeBanned: number;
  /** Active records seen within STORE_FRESH_DAYS. */
  storeFresh: number;
  /** Records promoted to suppliers (Phase D). */
  storePromoted: number;
  runningRuns: number;
  lastRun: SourceRunView | null;
};

export type SourceRecordView = {
  recordId: string;
  /** Set when promoted — the supplier row this record feeds. */
  supplierId: string | null;
  name: string;
  countryCode: string;
  website: string | null;
  confidenceScore: number;
  status: "active" | "banned";
  firstSeenAt: string;
  lastSeenAt: string;
  bannedByName: string | null;
  bannedReason: string | null;
  /** Global ban on the promoted supplier (never matched, for anyone). */
  globallyBanned: boolean;
  globalBanReason: string | null;
};

export type SourceDetailView = {
  /** One page of records (STORE_PAGE_SIZE), filtered by `search` when given. */
  records: SourceRecordView[];
  /** Total records matching the filter — drives the range display. */
  total: number;
  page: number;
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
    action: typeof scope["action"] === "string" ? scope["action"] : null,
    deleted: typeof scope["deleted"] === "number" ? scope["deleted"] : null,
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
          dataSourceId: schema.sourceRecord.dataSourceId,
          active: sql<number>`count(*) filter (where ${schema.sourceRecord.status} = 'active')::int`,
          banned: sql<number>`count(*) filter (where ${schema.sourceRecord.status} = 'banned')::int`,
          fresh: sql<number>`count(*) filter (where ${schema.sourceRecord.status} = 'active' and ${schema.sourceRecord.lastSeenAt} >= ${freshCutoff})::int`,
          promoted: sql<number>`count(*) filter (where ${schema.sourceRecord.supplierId} is not null)::int`,
        })
        .from(schema.sourceRecord)
        .groupBy(schema.sourceRecord.dataSourceId),
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
        requiresFile: getConnector(source.code)?.meta.requiresFile === true,
        downloadUrl: getConnector(source.code)?.meta.downloadUrl ?? null,
        storeActive: counts?.active ?? 0,
        storeBanned: counts?.banned ?? 0,
        storeFresh: counts?.fresh ?? 0,
        storePromoted: counts?.promoted ?? 0,
        runningRuns: runningBySource.get(source.id) ?? 0,
        lastRun: lastRun ? toRunView(lastRun) : null,
      };
    });
  },
);

/** Page sizes the store browser offers (registry stores hold ~400k rows —
 *  the browser paginates and searches instead of capping). */
export const STORE_PAGE_SIZES = [5, 10, 50, 100] as const;
export const STORE_PAGE_SIZE_DEFAULT = 10;

export const getSourceDetailFn = createServerFn({ method: "GET" })
  .inputValidator(
    z.object({
      dataSourceId: z.string(),
      /** Case-insensitive substring match on the record name. */
      search: z.string().trim().max(100).optional(),
      /** Zero-based page over the filtered, last-seen-desc ordering. */
      page: z.number().int().min(0).max(100_000).optional(),
      pageSize: z
        .number()
        .refine((n): n is (typeof STORE_PAGE_SIZES)[number] =>
          (STORE_PAGE_SIZES as readonly number[]).includes(n),
        )
        .optional(),
    }),
  )
  .handler(async ({ data }): Promise<SourceDetailView> => {
    const session = await requireSourceAdmin();
    if (!session) return { records: [], total: 0, page: 0, runs: [] };

    const [{ db }, { and, count, desc, eq, ilike }, schema] = await Promise.all([
      import("@/database"),
      import("drizzle-orm"),
      import("@/database/schema"),
    ]);

    const page = data.page ?? 0;
    const pageSize = data.pageSize ?? STORE_PAGE_SIZE_DEFAULT;
    const recordFilter = data.search
      ? and(
          eq(schema.sourceRecord.dataSourceId, data.dataSourceId),
          ilike(schema.sourceRecord.name, `%${data.search}%`),
        )
      : eq(schema.sourceRecord.dataSourceId, data.dataSourceId);

    const [records, [totalRow], runs] = await Promise.all([
      db
        .select({
          recordId: schema.sourceRecord.id,
          supplierId: schema.sourceRecord.supplierId,
          name: schema.sourceRecord.name,
          countryCode: schema.sourceRecord.countryCode,
          website: schema.sourceRecord.website,
          confidenceScore: schema.sourceRecord.confidenceScore,
          status: schema.sourceRecord.status,
          firstSeenAt: schema.sourceRecord.firstSeenAt,
          lastSeenAt: schema.sourceRecord.lastSeenAt,
          bannedByName: schema.user.name,
          bannedReason: schema.sourceRecord.bannedReason,
          globalBannedAt: schema.supplier.bannedAt,
          globalBanReason: schema.supplier.bannedReason,
        })
        .from(schema.sourceRecord)
        .leftJoin(schema.supplier, eq(schema.supplier.id, schema.sourceRecord.supplierId))
        .leftJoin(schema.user, eq(schema.user.id, schema.sourceRecord.bannedBy))
        .where(recordFilter)
        .orderBy(desc(schema.sourceRecord.lastSeenAt))
        .offset(page * pageSize)
        .limit(pageSize),
      db.select({ value: count() }).from(schema.sourceRecord).where(recordFilter),
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

    return {
      records: records.map((row) => ({
        recordId: row.recordId,
        supplierId: row.supplierId,
        name: row.name,
        countryCode: row.countryCode,
        website: row.website,
        confidenceScore: row.confidenceScore,
        status: row.status,
        firstSeenAt: row.firstSeenAt.toISOString(),
        lastSeenAt: row.lastSeenAt.toISOString(),
        bannedByName: row.status === "banned" ? row.bannedByName : null,
        bannedReason: row.status === "banned" ? row.bannedReason : null,
        globallyBanned: row.globalBannedAt !== null,
        globalBanReason: row.globalBanReason,
      })),
      total: totalRow?.value ?? 0,
      page,
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

/** Trigger a full pull ("Mettre à jour") — STATIC sources only (settled
 *  2026-08-24): the connector collects everything its source has; dedup makes
 *  every trigger an idempotent, duplicate-free sync, so no scope is taken.
 *  Dynamic sources (global_web) are refused — they are fed exclusively
 *  through requests. Store-only sources are refused too (nothing to run).
 *  A disabled source CAN be refreshed on purpose: warming a store before
 *  enabling it is a legitimate rollout move. */
export const triggerSourceRefreshFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      dataSourceId: z.string(),
      /** Storage key of a staff upload — required by file-fed sources. */
      fileKey: z.string().max(300).optional(),
    }),
  )
  .handler(async ({ data }): Promise<{ ok: boolean; error?: string }> => {
    const session = await requireSourceAdmin();
    if (!session) return { ok: false, error: "forbidden" };

    const [
      { db },
      { and, eq },
      schema,
      { getConnector },
      { enqueueAdminRefresh },
      { isDynamicSource },
    ] = await Promise.all([
      import("@/database"),
      import("drizzle-orm"),
      import("@/database/schema"),
      import("@/server/sources/registry"),
      import("@/server/queue"),
      import("@/lib/source-kind"),
    ]);

    const source = await db.query.dataSource.findFirst({
      where: eq(schema.dataSource.id, data.dataSourceId),
    });
    if (!source) return { ok: false, error: "not_found" };
    if (isDynamicSource(source.type)) return { ok: false, error: "dynamic_source" };
    const connector = getConnector(source.code);
    if (!connector) return { ok: false, error: "store_only" };
    if (connector.meta.requiresFile && !data.fileKey) return { ok: false, error: "file_required" };

    // One admin pull at a time per source — a second click must not run two
    // syncs over each other while the first is still collecting.
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
      ...(data.fileKey ? { scope: { fileKey: data.fileKey } } : {}),
    });
    await enqueueAdminRefresh(runId);
    return { ok: true };
  });

/** WIPE a source's store (Phase D) — platform OWNER only, deliberately above
 *  the manager-level feature gate: it deletes every record of the source.
 *  Promoted suppliers, matches and requests are untouched by construction
 *  (supplier rows stand alone; record links die with the records). Audited
 *  as a source_run row (scope.action = 'wipe', scope.deleted = N). */
export const wipeSourceStoreFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ dataSourceId: z.string() }))
  .handler(async ({ data }): Promise<{ ok: boolean; deleted?: number }> => {
    const session = await requireSourceAdmin();
    if (!session || session.user.platformRole !== "owner") return { ok: false };

    const [{ db }, { eq }, schema] = await Promise.all([
      import("@/database"),
      import("drizzle-orm"),
      import("@/database/schema"),
    ]);
    const deleted = await db
      .delete(schema.sourceRecord)
      .where(eq(schema.sourceRecord.dataSourceId, data.dataSourceId))
      .returning({ id: schema.sourceRecord.id });

    await db.insert(schema.sourceRun).values({
      id: crypto.randomUUID(),
      dataSourceId: data.dataSourceId,
      trigger: "admin",
      triggeredBy: session.user.id,
      status: "succeeded",
      scope: { action: "wipe", deleted: deleted.length },
      completedAt: new Date(),
    });
    return { ok: true, deleted: deleted.length };
  });

/** Per-record ban/unban — this source's data for the company is ignored while
 *  other sources can still surface it. Sticky across re-collection (the
 *  upsert in research.ts only touches active rows). */
export const setRecordStatusFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.discriminatedUnion("action", [
      z.object({
        action: z.literal("ban"),
        recordId: z.string(),
        reason: z.string().trim().min(3).max(300),
      }),
      z.object({ action: z.literal("unban"), recordId: z.string() }),
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
      .update(schema.sourceRecord)
      .set(
        data.action === "ban"
          ? { status: "banned", bannedBy: session.user.id, bannedReason: data.reason }
          : { status: "active", bannedBy: null, bannedReason: null },
      )
      .where(eq(schema.sourceRecord.id, data.recordId));
    return { ok: true };
  });

/** Global supplier ban — never matched, never shown, for anyone (fraud,
 *  sanctions). Sticky: the dedup key lands re-encounters on this row. Only
 *  meaningful for promoted records (unpromoted ones have no supplier). */
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
