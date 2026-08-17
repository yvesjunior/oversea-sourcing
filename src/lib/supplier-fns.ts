// Supplier directory server functions (E4 seam). The supplier dataset is
// PLATFORM-GLOBAL by design (doc/BACKLOG.md tenancy rule) — every logged-in
// user browses the same pool; per-request ranking lives in `match`.

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
    if (!session) return EMPTY;

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
      })
      .from(schema.supplier)
      .leftJoin(schema.match, eq(schema.match.supplierId, schema.supplier.id))
      .leftJoin(schema.request, eq(schema.request.id, schema.supplier.discoveredByRequestId))
      .groupBy(schema.supplier.id, schema.request.organizationId)
      .orderBy(desc(schema.supplier.confidenceScore), asc(schema.supplier.name));

    const suppliers = rows.map((row) =>
      gateDiscovery(row, session.session.activeOrganizationId, session.user.platformRole),
    );
    return { suppliers, total: suppliers.length };
  },
);

/** Suppliers shortlisted on the caller's own workspace's requests — the
 *  employee "Mes données" tab (and any personal view). */
export const getMyMatchedSuppliersFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<SupplierDirectory> => {
    const [{ auth }, { getRequest }, { db }, { asc, count, desc, eq }, schema] = await Promise.all([
      import("@/server/auth"),
      import("@tanstack/react-start/server"),
      import("@/database"),
      import("drizzle-orm"),
      import("@/database/schema"),
    ]);
    const session = await auth.api.getSession({ headers: getRequest().headers });
    const workspaceId = session?.session.activeOrganizationId;
    if (!session || !workspaceId) return EMPTY;

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
      })
      .from(schema.supplier)
      .innerJoin(schema.match, eq(schema.match.supplierId, schema.supplier.id))
      .innerJoin(schema.request, eq(schema.match.requestId, schema.request.id))
      .where(eq(schema.request.organizationId, workspaceId))
      .groupBy(schema.supplier.id, schema.request.organizationId)
      .orderBy(desc(schema.supplier.confidenceScore), asc(schema.supplier.name));

    const suppliers = rows.map((row) => gateDiscovery(row, workspaceId, session.user.platformRole));
    return { suppliers, total: suppliers.length };
  },
);
