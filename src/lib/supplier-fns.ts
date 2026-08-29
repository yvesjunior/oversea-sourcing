// Supplier directory server functions (E4 seam). The supplier dataset is
// PLATFORM-GLOBAL by design (doc/BACKLOG.md tenancy rule) — one pool, enriched
// by every request; per-request ranking lives in `match`.
//
// WHO SEES WHAT (owner, 2026-08-29). The whole pool is an OSI-internal view:
// `getSuppliersFn` answers only for staff standing in the internal workspace.
// Everyone else — buyers, and staff in their own personal workspace — gets
// `getLinkedSuppliersFn`: the companies their workspace is actually involved
// with.

import { createServerFn } from "@tanstack/react-start";
import { canSeeAllRequests } from "@/lib/roles";
import type { RiskLevel, SupplierProvenance, VerificationStatus } from "@/database/schema";

export type SupplierView = {
  id: string;
  name: string;
  descriptor: string | null;
  countryCode: string;
  provenance: SupplierProvenance;
  verificationStatus: VerificationStatus;
  confidenceScore: number;
  riskLevel: RiskLevel;
  /** How many requests (platform-wide) this supplier was shortlisted on. */
  matchCount: number;
  /**
   * The request whose research first surfaced this company — null when it was
   * seeded/imported, and ALSO null when the caller is not allowed to open it.
   *
   * Suppliers are platform-global but requests are workspace-scoped, so
   * exposing this id unconditionally would tell one buyer that another company
   * searched for a given part. The id is withheld here, not just hidden in the
   * UI, so it never reaches the browser.
   */
  discoveredByRequestId: string | null;
  /** ISO timestamp — when this company entered the pool. What the period
   *  filter asks about; there is deliberately no ACCOUNT dimension here,
   *  since the pool is platform-global (ADR-001) and answering "whose
   *  supplier is this" would leak which customer searched for a given part. */
  createdAt: string;
};

export type SupplierDirectory = {
  suppliers: SupplierView[];
  total: number;
};

const EMPTY: SupplierDirectory = { suppliers: [], total: 0 };

/** Strip the discovering-request id unless the caller may actually open that
 *  request: own workspace, or an employee with cross-workspace sourcing sight. */
function gateDiscovery<
  T extends { discoveredByRequestId: string | null; discoveredByOrgId: string | null },
>(
  row: T,
  callerWorkspaceId: string | null | undefined,
  platformRole: string | undefined,
): Omit<T, "discoveredByOrgId"> {
  const { discoveredByOrgId, ...rest } = row;
  const visible =
    discoveredByOrgId !== null &&
    (discoveredByOrgId === callerWorkspaceId || canSeeAllRequests(platformRole));
  return { ...rest, discoveredByRequestId: visible ? rest.discoveredByRequestId : null };
}

export const getSuppliersFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<SupplierDirectory> => {
    const [{ auth }, { getRequest }, { db }, { asc, count, desc, eq }, schema] = await Promise.all([
      import("@/server/auth"),
      import("@tanstack/react-start/server"),
      import("@/database"),
      import("drizzle-orm"),
      import("@/database/schema"),
    ]);
    const session = await auth.api.getSession({ headers: getRequest().headers });
    // Staff powers only from the internal workspace (2026-08-27).
    const { effectivePlatformRole } = await import("@/server/workspace-guard");
    const effectiveRole = session ? await effectivePlatformRole(session) : "user";
    if (!session) return EMPTY;
    // The WHOLE pool is an OSI-internal view (owner 2026-08-29: outside the
    // platform workspace you see only what you are involved in). A staff
    // member in their personal workspace is an ordinary buyer here, like
    // everyone else, and gets `getMyMatchedSuppliersFn` instead.
    //
    // Withheld on the SERVER, not merely hidden: the directory carries which
    // companies OSI has found and how they scored, and shipping it to a
    // browser that will not render it is still shipping it. Same rule that
    // already withholds `discoveredByRequestId` above.
    if (!canSeeAllRequests(effectiveRole)) return EMPTY;

    const rows = await db
      .select({
        id: schema.supplier.id,
        name: schema.supplier.name,
        descriptor: schema.supplier.descriptor,
        countryCode: schema.supplier.countryCode,
        provenance: schema.supplier.provenance,
        verificationStatus: schema.supplier.verificationStatus,
        confidenceScore: schema.supplier.confidenceScore,
        riskLevel: schema.supplier.riskLevel,
        matchCount: count(schema.match.id),
        discoveredByRequestId: schema.supplier.discoveredByRequestId,
        discoveredByOrgId: schema.request.organizationId,
        createdAt: schema.supplier.createdAt,
      })
      .from(schema.supplier)
      .leftJoin(schema.match, eq(schema.match.supplierId, schema.supplier.id))
      .leftJoin(schema.request, eq(schema.request.id, schema.supplier.discoveredByRequestId))
      .groupBy(schema.supplier.id, schema.request.organizationId)
      .orderBy(desc(schema.supplier.confidenceScore), asc(schema.supplier.name));

    const suppliers = rows.map((row) => ({
      ...gateDiscovery(row, session.session.activeOrganizationId, effectiveRole),
      createdAt: row.createdAt.toISOString(),
    }));
    return { suppliers, total: suppliers.length };
  },
);

/**
 * The suppliers the caller's workspace is INVOLVED with (owner, 2026-08-29:
 * "buyer sees what is linked to them somehow").
 *
 * "Involved" is deliberately wider than "shortlisted". A supplier is linked by
 * ANY of four traces, and each is a real relationship the buyer would expect
 * to find:
 *
 *   • shortlisted on one of their requests (`match`)
 *   • asked for an offer (`quote`)
 *   • the one they accepted (`deal`)
 *   • a party to one of their contracts (`contract_party`)
 *
 * The last three are not decoration. **Matching is delete-then-insert**: when a
 * request re-runs, its `match` rows are replaced, so a supplier that has since
 * dropped out of the Top-N would vanish from this list while the buyer's quote
 * — or their signed contract — still points straight at it. Union, not join.
 */
export const getLinkedSuppliersFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<SupplierDirectory> => {
    const [{ auth }, { getRequest }, { db }, { asc, count, desc, eq, inArray }, schema] =
      await Promise.all([
        import("@/server/auth"),
        import("@tanstack/react-start/server"),
        import("@/database"),
        import("drizzle-orm"),
        import("@/database/schema"),
      ]);
    const session = await auth.api.getSession({ headers: getRequest().headers });
    // Staff powers only from the internal workspace (2026-08-27).
    const { effectivePlatformRole } = await import("@/server/workspace-guard");
    const effectiveRole = session ? await effectivePlatformRole(session) : "user";
    const workspaceId = session?.session.activeOrganizationId;
    if (!session || !workspaceId) return EMPTY;

    // Four small id queries unioned in memory, rather than one query with three
    // OR'd EXISTS clauses: each trace stays legible, and adding the fifth (a
    // message thread, when P10 lands) is one more block, not a rewrite.
    const [matched, quoted, dealt, partied] = await Promise.all([
      db
        .select({ id: schema.match.supplierId })
        .from(schema.match)
        .innerJoin(schema.request, eq(schema.match.requestId, schema.request.id))
        .where(eq(schema.request.organizationId, workspaceId)),
      db
        .select({ id: schema.quote.supplierId })
        .from(schema.quote)
        .where(eq(schema.quote.organizationId, workspaceId)),
      db
        .select({ id: schema.deal.supplierId })
        .from(schema.deal)
        .where(eq(schema.deal.organizationId, workspaceId)),
      db
        .select({ id: schema.contractParty.supplierId })
        .from(schema.contractParty)
        .innerJoin(schema.contract, eq(schema.contractParty.contractId, schema.contract.id))
        .where(eq(schema.contract.organizationId, workspaceId)),
    ]);

    // The supplier reference is nullable on quote/deal/contract_party — the row
    // survives its supplier (the tombstone rule), and a null cannot be looked up.
    const linkedIds = [
      ...new Set(
        [...matched, ...quoted, ...dealt, ...partied]
          .map((row) => row.id)
          .filter((id): id is string => id !== null),
      ),
    ];
    if (linkedIds.length === 0) return EMPTY;

    const rows = await db
      .select({
        id: schema.supplier.id,
        name: schema.supplier.name,
        descriptor: schema.supplier.descriptor,
        countryCode: schema.supplier.countryCode,
        provenance: schema.supplier.provenance,
        verificationStatus: schema.supplier.verificationStatus,
        confidenceScore: schema.supplier.confidenceScore,
        riskLevel: schema.supplier.riskLevel,
        // Scoped to THEIR requests: "shortlisted on 3 of your dossiers" is a
        // number the buyer can check. The platform-wide count is staff's.
        matchCount: count(schema.match.id),
        discoveredByRequestId: schema.supplier.discoveredByRequestId,
        discoveredByOrgId: schema.request.organizationId,
        createdAt: schema.supplier.createdAt,
      })
      .from(schema.supplier)
      .leftJoin(schema.match, eq(schema.match.supplierId, schema.supplier.id))
      .leftJoin(schema.request, eq(schema.match.requestId, schema.request.id))
      .where(inArray(schema.supplier.id, linkedIds))
      .groupBy(schema.supplier.id, schema.request.organizationId)
      .orderBy(desc(schema.supplier.confidenceScore), asc(schema.supplier.name));

    const suppliers = rows.map((row) => ({
      ...gateDiscovery(row, workspaceId, effectiveRole),
      createdAt: row.createdAt.toISOString(),
    }));
    return { suppliers, total: suppliers.length };
  },
);
