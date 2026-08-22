// Effective sourcing scope for a workspace (validated 2026-08-22):
//
//   effective sources = platform-enabled ∩ workspace-activated
//
// Requests never specify a source — the workspace activated its set once in
// Settings (`sourcing_rules`; no row = all enabled sources, worldwide). The
// scope is applied twice, on purpose: connectors collect within it, and the
// matcher enforces it again as a HARD filter, so a pool supplier known only
// from a non-activated source never appears for this workspace.

import { eq, inArray } from "drizzle-orm";
import { db } from "@/database";
import * as schema from "@/database/schema";

export type EffectiveScope = {
  /** Enabled ∩ activated — empty means "this workspace turned everything off". */
  sources: Array<{ id: string; code: string; name: string }>;
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
  ).map((s) => ({ id: s.id, code: s.code, name: s.name }));

  const countryCodes =
    rules?.countryMode === "list" && rules.countryCodes && rules.countryCodes.length > 0
      ? rules.countryCodes.map((c) => c.toUpperCase())
      : null;

  return { sources, countryCodes };
}

type SupplierRow = typeof schema.supplier.$inferSelect;

/**
 * Suppliers this scope may see: not globally banned, country within scope, and
 * carrying an ACTIVE membership in one of the scope's sources. Suppliers with
 * no membership rows at all stay visible everywhere — they predate the source
 * model (dev seeds, legacy rows) and hiding them would silently empty dev.
 *
 * Loads the pool in memory — fine at the current scale (matching already does
 * the same); the day the pool outgrows this, both move to one SQL query.
 */
export async function eligibleSuppliers(scope: EffectiveScope): Promise<SupplierRow[]> {
  const [suppliers, memberships] = await Promise.all([
    db.query.supplier.findMany(),
    db.query.supplierSource.findMany(),
  ]);

  const scopeSourceIds = new Set(scope.sources.map((s) => s.id));
  const membershipsBySupplier = new Map<string, typeof memberships>();
  for (const membership of memberships) {
    const list = membershipsBySupplier.get(membership.supplierId) ?? [];
    list.push(membership);
    membershipsBySupplier.set(membership.supplierId, list);
  }

  return suppliers.filter((supplier) => {
    if (supplier.bannedAt) return false;
    if (scope.countryCodes && !scope.countryCodes.includes(supplier.countryCode.toUpperCase())) {
      return false;
    }
    const own = membershipsBySupplier.get(supplier.id);
    if (!own || own.length === 0) return true; // legacy row — visible everywhere
    return own.some((m) => m.status === "active" && scopeSourceIds.has(m.dataSourceId));
  });
}

/** Convenience for the matcher's hard filter. */
export async function eligibleSupplierIds(scope: EffectiveScope): Promise<string[]> {
  return (await eligibleSuppliers(scope)).map((s) => s.id);
}

/** Batch-load enabled data_source rows by id (used by the research loop). */
export async function loadSources(ids: string[]) {
  if (ids.length === 0) return [];
  return db.query.dataSource.findMany({ where: inArray(schema.dataSource.id, ids) });
}
