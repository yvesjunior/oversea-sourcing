// Supplier directory server functions (E4 seam). The supplier dataset is
// PLATFORM-GLOBAL by design (BACKLOG.md tenancy rule) — one pool, enriched
// by every request; per-request ranking lives in `match`.
//
// WHO SEES WHAT (owner, 2026-08-29). The whole pool is an OSI-internal view:
// `getSuppliersFn` answers only for staff standing in the internal workspace.
// Everyone else — buyers, and staff in their own personal workspace — gets
// `getLinkedSuppliersFn`: the companies their workspace is actually involved
// with.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  CONTACT_LOCALES,
  type ContactLocale,
  type RiskLevel,
  type SupplierContactSource,
  type SupplierProvenance,
  type VerificationStatus,
} from "@/database/schema";
import { isPlausibleEmail } from "@/lib/supplier-contact";

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
  /**
   * How many contact addresses OSI holds for this supplier — staff directory
   * only. NULL for every buyer-facing list: a contact is never shown to a
   * buyer, and not even the count is, since "OSI has an address for this
   * one" is a fact about OSI's work and not about the supplier.
   */
  contactCount: number | null;
};

export type SupplierDirectory = {
  suppliers: SupplierView[];
  total: number;
  /** True for staff holding `deals` — the people who solicit suppliers are
   *  the ones who keep their addresses. */
  canManageContacts: boolean;
};

const EMPTY: SupplierDirectory = { suppliers: [], total: 0, canManageContacts: false };

/** Strip the discovering-request id unless the caller may actually open that
 *  request: own workspace, or an employee with cross-workspace sourcing sight. */
function gateDiscovery<
  T extends { discoveredByRequestId: string | null; discoveredByOrgId: string | null },
>(
  row: T,
  callerWorkspaceId: string | null | undefined,
  /** Already resolved by the caller — a custom role's answer lives in the
   *  database, so this cannot be re-derived from a role name here. */
  seesAllData: boolean,
): Omit<T, "discoveredByOrgId"> {
  const { discoveredByOrgId, ...rest } = row;
  const visible =
    discoveredByOrgId !== null && (discoveredByOrgId === callerWorkspaceId || seesAllData);
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
    const { effectiveHasPermission } = await import("@/server/workspace-guard");
    if (!session) return EMPTY;
    const seesAllData = await effectiveHasPermission(session, "requests.all");
    // The WHOLE pool is an OSI-internal view (owner 2026-08-29: outside the
    // platform workspace you see only what you are involved in). A staff
    // member in their personal workspace is an ordinary buyer here, like
    // everyone else, and gets `getMyMatchedSuppliersFn` instead.
    //
    // Withheld on the SERVER, not merely hidden: the directory carries which
    // companies OSI has found and how they scored, and shipping it to a
    // browser that will not render it is still shipping it. Same rule that
    // already withholds `discoveredByRequestId` above.
    if (!seesAllData) return EMPTY;

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

    const [{ contactCounts }, canManageContacts] = await Promise.all([
      import("@/server/supplier-contacts"),
      effectiveHasPermission(session, "deals"),
    ]);
    const counts = await contactCounts();
    const suppliers = rows.map((row) => ({
      ...gateDiscovery(row, session.session.activeOrganizationId, seesAllData),
      createdAt: row.createdAt.toISOString(),
      contactCount: counts.get(row.id) ?? 0,
    }));
    return { suppliers, total: suppliers.length, canManageContacts };
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
    const { effectiveHasPermission } = await import("@/server/workspace-guard");
    const workspaceId = session?.session.activeOrganizationId;
    if (!session || !workspaceId) return EMPTY;
    const seesAllData = await effectiveHasPermission(session, "requests.all");

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
      ...gateDiscovery(row, workspaceId, seesAllData),
      createdAt: row.createdAt.toISOString(),
      // Never for a buyer — see SupplierView.contactCount.
      contactCount: null,
    }));
    return { suppliers, total: suppliers.length, canManageContacts: false };
  },
);

// ── Supplier contacts (Phase V · V02) ───────────────────────────────────────
//
// Staff only, behind `deals`: the people who solicit suppliers keep their
// addresses. No buyer-facing fn in this file returns a contact, and none
// should — the pool is platform-global, and a buyer holding the address would
// simply write to the supplier and leave OSI out of its own transaction.

export type SupplierContactView = {
  id: string;
  email: string;
  name: string | null;
  role: string | null;
  phone: string | null;
  locale: ContactLocale;
  source: SupplierContactSource;
  isPrimary: boolean;
  createdByName: string | null;
  createdAt: string;
};

function toContactView(
  row: typeof import("@/database/schema").supplierContact.$inferSelect,
): SupplierContactView {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    phone: row.phone,
    locale: row.locale,
    source: row.source,
    isPrimary: row.isPrimary,
    createdByName: row.createdByName,
    createdAt: row.createdAt.toISOString(),
  };
}

async function requireContactStaff() {
  const [{ auth }, { getRequest }, { effectiveHasPermission }] = await Promise.all([
    import("@/server/auth"),
    import("@tanstack/react-start/server"),
    import("@/server/workspace-guard"),
  ]);
  const session = await auth.api.getSession({ headers: getRequest().headers });
  if (!session || !(await effectiveHasPermission(session, "deals"))) return null;
  return session;
}

export const getSupplierContactsFn = createServerFn({ method: "GET" })
  .inputValidator(z.object({ supplierId: z.string().min(1) }))
  .handler(async ({ data }): Promise<{ contacts: SupplierContactView[] }> => {
    if (!(await requireContactStaff())) return { contacts: [] };
    const { listContacts } = await import("@/server/supplier-contacts");
    return { contacts: (await listContacts(data.supplierId)).map(toContactView) };
  });

// No update fn on purpose: correcting a contact is removing it and adding it
// again, which is two journal lines that say exactly what happened.
const contactFields = {
  name: z.string().trim().max(120).nullable(),
  role: z.string().trim().max(120).nullable(),
  phone: z.string().trim().max(40).nullable(),
  locale: z.enum(CONTACT_LOCALES),
};

export type ContactMutationResult =
  { ok: true } | { ok: false; reason: "forbidden" | "not_found" | "invalid_email" | "duplicate" };

export const addSupplierContactFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({ supplierId: z.string().min(1), email: z.string().max(254), ...contactFields }),
  )
  .handler(async ({ data }): Promise<ContactMutationResult> => {
    const session = await requireContactStaff();
    if (!session) return { ok: false, reason: "forbidden" };
    if (!isPlausibleEmail(data.email)) return { ok: false, reason: "invalid_email" };

    const [{ db }, { eq }, schema] = await Promise.all([
      import("@/database"),
      import("drizzle-orm"),
      import("@/database/schema"),
    ]);
    const supplier = await db.query.supplier.findFirst({
      where: eq(schema.supplier.id, data.supplierId),
      columns: { id: true, name: true },
    });
    if (!supplier) return { ok: false, reason: "not_found" };

    const { addContact } = await import("@/server/supplier-contacts");
    const added = await addContact({
      supplierId: supplier.id,
      email: data.email,
      name: data.name,
      role: data.role,
      phone: data.phone,
      locale: data.locale,
      source: "staff",
      actor: { id: session.user.id, name: session.user.name },
    });
    if (!added.ok) return { ok: false, reason: "duplicate" };

    const { logAudit, actorOf } = await import("@/server/audit");
    await logAudit({
      ...actorOf(session),
      action: "supplier_contact.added",
      target: data.email.trim().toLowerCase(),
      detail: { supplier: supplier.name },
    });
    return { ok: true };
  });

export const setPrimarySupplierContactFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data }): Promise<ContactMutationResult> => {
    const session = await requireContactStaff();
    if (!session) return { ok: false, reason: "forbidden" };
    const { setPrimaryContact } = await import("@/server/supplier-contacts");
    const contact = await setPrimaryContact(data.id);
    if (!contact) return { ok: false, reason: "not_found" };
    const { logAudit, actorOf } = await import("@/server/audit");
    await logAudit({
      ...actorOf(session),
      action: "supplier_contact.primary_set",
      target: contact.email,
    });
    return { ok: true };
  });

export const removeSupplierContactFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data }): Promise<ContactMutationResult> => {
    const session = await requireContactStaff();
    if (!session) return { ok: false, reason: "forbidden" };
    const { removeContact } = await import("@/server/supplier-contacts");
    const removed = await removeContact(data.id);
    if (!removed) return { ok: false, reason: "not_found" };
    const { logAudit, actorOf } = await import("@/server/audit");
    await logAudit({
      ...actorOf(session),
      action: "supplier_contact.removed",
      target: removed.email,
    });
    return { ok: true };
  });
