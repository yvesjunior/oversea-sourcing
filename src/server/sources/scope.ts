// Effective sourcing scope for a workspace (validated 2026-08-22):
//
//   effective sources = platform-enabled ∩ workspace-activated
//
// Requests never specify a source — the workspace activated its set once in
// Settings (`sourcing_rules`; no row = all enabled sources, worldwide). The
// scope is applied twice, on purpose: connectors collect within it, and the
// matcher enforces it again as a HARD filter.
//
// Phase D (2026-08-24): matching ranks LOGICAL CANDIDATES, not suppliers —
// store records grouped by dedup_key across the effective sources, merged
// with already-promoted suppliers. A record group without a supplier is a
// candidate to become one (promotion happens in the matcher, at Top-N).
// Suppliers with no records at all stay visible everywhere: they predate the
// store model or survived a store wipe — the supplier pool is the platform's
// asset and never depends on any store's continued existence.

import { and, eq, inArray, isNotNull, or } from "drizzle-orm";
import { db } from "@/database";
import * as schema from "@/database/schema";
import type { DataSourceType, RiskLevel, VerificationStatus } from "@/database/schema";

export type EffectiveScope = {
  /** Enabled ∩ activated — empty means "this workspace turned everything off". */
  sources: Array<{ id: string; code: string; name: string; type: DataSourceType }>;
  /** Null = worldwide. */
  countryCodes: string[] | null;
};

export async function resolveScope(organizationId: string): Promise<EffectiveScope> {
  const [enabled, rules] = await Promise.all([
    db.query.dataSource.findMany({ where: eq(schema.dataSource.enabled, true) }),
    db.query.sourcingRules.findFirst({
      where: eq(schema.sourcingRules.organizationId, organizationId),
    }),
  ]);

  const activated = rules?.activatedSourceIds;
  const sources = (
    activated == null ? enabled : enabled.filter((s) => activated.includes(s.id))
  ).map((s) => ({ id: s.id, code: s.code, name: s.name, type: s.type }));

  const countryCodes =
    rules?.countryMode === "list" && rules.countryCodes && rules.countryCodes.length > 0
      ? rules.countryCodes.map((c) => c.toUpperCase())
      : null;

  return { sources, countryCodes };
}

/** One rankable company for a request: either a promoted supplier or an
 *  unpromoted record group (same dedup_key across the effective sources). */
export type MatchCandidate = {
  /** Null = unpromoted — a supplier row is created only if it ranks Top-N. */
  supplierId: string | null;
  dedupKey: string;
  name: string;
  descriptor: string | null;
  description: string | null;
  countryCode: string;
  website: string | null;
  sourceUrl: string | null;
  confidenceScore: number;
  verificationStatus: VerificationStatus;
  riskLevel: RiskLevel;
  /** Latest evidence the company exists (records' last_seen; suppliers also
   *  keep last_researched_at) — the store-first freshness input. */
  lastSeenAt: Date | null;
  /** Type of the record's source — provenance at promotion (null = supplier
   *  with no in-scope records, i.e. legacy/post-wipe). */
  sourceType: DataSourceType | null;
  /** Records to link (`supplier_id`) when this candidate gets promoted. */
  recordIds: string[];
};

type RecordRow = typeof schema.sourceRecord.$inferSelect;

function latest(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

/**
 * The candidates a scope may rank: promoted suppliers (not globally banned,
 * country in scope, known through at least one active in-scope record — or
 * through none at all, the legacy/post-wipe case) plus unpromoted record
 * groups from the effective sources.
 *
 * Loads the pool in memory — fine at the current scale (matching already does
 * the same); the day the pool outgrows this, both move to one SQL query.
 */
export async function eligibleCandidates(scope: EffectiveScope): Promise<MatchCandidate[]> {
  // Records are loaded scope-filtered in SQL — a static source can hold
  // hundreds of thousands of rows (registry-ca: ~640k), and a workspace that
  // never activated it must not pay for them. Promoted rows load regardless
  // of scope/status: they carry the supplier fold-in and the "known only via
  // out-of-scope or banned sources → hidden" rule. The one semantic drift:
  // an UNPROMOTED out-of-scope record that key-matches a supplier no longer
  // hides it — acceptable, promotion is what ties records to suppliers.
  const scopeIds = [...new Set(scope.sources.map((s) => s.id))];
  const recordFilter =
    scopeIds.length > 0
      ? or(
          and(
            eq(schema.sourceRecord.status, "active"),
            inArray(schema.sourceRecord.dataSourceId, scopeIds),
          ),
          isNotNull(schema.sourceRecord.supplierId),
        )
      : isNotNull(schema.sourceRecord.supplierId);
  const [suppliers, records, sources] = await Promise.all([
    db.query.supplier.findMany(),
    db.query.sourceRecord.findMany({ where: recordFilter }),
    db.query.dataSource.findMany(),
  ]);

  const typeBySource = new Map(sources.map((s) => [s.id, s.type]));
  const scopeSourceIds = new Set(scope.sources.map((s) => s.id));
  const inCountry = (code: string) =>
    !scope.countryCodes || scope.countryCodes.includes(code.toUpperCase());

  // A record belongs to a supplier via its promotion link OR its dedup key —
  // the key is how a second source's record of an already-promoted company
  // folds into that supplier's candidacy instead of duplicating it.
  const supplierByKey = new Map(suppliers.filter((s) => s.dedupKey).map((s) => [s.dedupKey!, s]));
  const supplierById = new Map(suppliers.map((s) => [s.id, s]));
  const recordsBySupplier = new Map<string, RecordRow[]>();
  const unclaimedByKey = new Map<string, RecordRow[]>();
  for (const record of records) {
    const owner =
      (record.supplierId && supplierById.get(record.supplierId)) ??
      supplierByKey.get(record.dedupKey);
    if (owner) {
      const list = recordsBySupplier.get(owner.id) ?? [];
      list.push(record);
      recordsBySupplier.set(owner.id, list);
    } else {
      const list = unclaimedByKey.get(record.dedupKey) ?? [];
      list.push(record);
      unclaimedByKey.set(record.dedupKey, list);
    }
  }

  const candidates: MatchCandidate[] = [];

  for (const supplier of suppliers) {
    if (supplier.bannedAt) continue;
    if (!inCountry(supplier.countryCode)) continue;
    const own = recordsBySupplier.get(supplier.id) ?? [];
    const activeInScope = own.filter(
      (r) => r.status === "active" && scopeSourceIds.has(r.dataSourceId),
    );
    // Known only through banned or out-of-scope sources → invisible here.
    // No records at all → legacy/post-wipe supplier, visible everywhere.
    if (own.length > 0 && activeInScope.length === 0) continue;

    const recordFreshness = activeInScope.reduce<Date | null>(
      (acc, r) => latest(acc, r.lastSeenAt),
      null,
    );
    candidates.push({
      supplierId: supplier.id,
      dedupKey: supplier.dedupKey ?? `legacy:${supplier.id}`,
      name: supplier.name,
      descriptor: supplier.descriptor,
      description: supplier.description,
      countryCode: supplier.countryCode,
      website: supplier.website,
      sourceUrl: supplier.sourceRef,
      confidenceScore: supplier.confidenceScore,
      verificationStatus: supplier.verificationStatus,
      riskLevel: supplier.riskLevel,
      lastSeenAt: latest(recordFreshness, supplier.lastResearchedAt),
      sourceType: activeInScope[0]
        ? (typeBySource.get(activeInScope[0].dataSourceId) ?? null)
        : null,
      recordIds: activeInScope.map((r) => r.id),
    });
  }

  for (const [dedupKey, group] of unclaimedByKey) {
    const eligible = group.filter(
      (r) => r.status === "active" && scopeSourceIds.has(r.dataSourceId),
    );
    if (eligible.length === 0) continue;
    // The most confident record speaks for the group's descriptive fields.
    const best = eligible.reduce((a, b) => (b.confidenceScore > a.confidenceScore ? b : a));
    if (!inCountry(best.countryCode)) continue;

    candidates.push({
      supplierId: null,
      dedupKey,
      name: best.name,
      descriptor: best.descriptor,
      description: best.description,
      countryCode: best.countryCode,
      website: best.website,
      sourceUrl: best.sourceUrl,
      confidenceScore: best.confidenceScore,
      // Unpromoted by definition: nothing has vouched for it yet.
      verificationStatus: "unverified",
      riskLevel: "medium",
      lastSeenAt: eligible.reduce<Date | null>((acc, r) => latest(acc, r.lastSeenAt), null),
      sourceType: typeBySource.get(best.dataSourceId) ?? null,
      recordIds: eligible.map((r) => r.id),
    });
  }

  return candidates;
}

/** Batch-load enabled data_source rows by id (used by the research loop). */
export async function loadSources(ids: string[]) {
  if (ids.length === 0) return [];
  return db.query.dataSource.findMany({ where: inArray(schema.dataSource.id, ids) });
}
