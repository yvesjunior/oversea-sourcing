// The contract centre (Phase P4) — the brief's declared priority.
//
// Everything the list needs is DERIVED, never stored: the five filters come
// from `contractFilter()` and the N/M indicator from `signatureProgress()`,
// both pure and unit-tested in src/lib/deal-status.ts. There is deliberately
// no `filter` or `signed_count` column — a stored copy is a second source of
// truth that will eventually disagree with the party rows.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { ContractPartyRole, ContractStatus, ContractType } from "@/database/schema";
import { contractFilter, signatureProgress, type ContractFilter } from "@/lib/deal-status";

export type PartyView = {
  id: string;
  role: ContractPartyRole;
  name: string;
  email: string | null;
  required: boolean;
  signatureStatus: string;
  /** in_platform for a party with an account, manual_upload for one without. */
  method: string | null;
  signedAt: string | null;
  signedByName: string | null;
  /** True when this party IS the caller — the only one who may sign in-app. */
  isCaller: boolean;
};

export type ContractView = {
  id: string;
  number: string;
  title: string;
  type: ContractType;
  status: ContractStatus;
  dealId: string;
  dealTitle: string;
  supplierName: string;
  amountCents: number | null;
  currency: string | null;
  incoterm: string | null;
  paymentTerms: string | null;
  dueAt: string | null;
  createdAt: string;
  /** Derived, not stored. */
  filter: ContractFilter;
  signed: number;
  requiredSignatures: number;
  parties: PartyView[];
};

/** A dossier whose required contracts have not been drafted yet. Surfaced so
 *  staff cannot silently MISS one the mapping requires — they may add a
 *  contract it did not predict, but not forget one it did. */
export type PendingDeal = { id: string; title: string; supplierName: string; missing: number };

export type ContractListResult = {
  contracts: ContractView[];
  /** Staff only — empty for a buyer. */
  pendingDeals: PendingDeal[];
  /** Staff powers, resolved server-side so the UI never re-derives a rule. */
  canDraft: boolean;
  canSend: boolean;
  canSign: boolean;
  canVoid: boolean;
};

/** Anyone reading a contract sees the same shape, buyer or staff. */
function toView(
  contract: typeof import("@/database/schema").contract.$inferSelect,
  parties: (typeof import("@/database/schema").contractParty.$inferSelect)[],
  deal: { title: string; supplierName: string },
  callerUserId: string,
  now: Date,
): ContractView {
  const progress = signatureProgress(parties);
  return {
    id: contract.id,
    number: contract.number,
    title: contract.title,
    type: contract.type,
    status: contract.status,
    dealId: contract.dealId,
    dealTitle: deal.title,
    supplierName: deal.supplierName,
    amountCents: contract.amountCents,
    currency: contract.currency,
    incoterm: contract.incoterm,
    paymentTerms: contract.paymentTerms,
    dueAt: contract.dueAt ? contract.dueAt.toISOString() : null,
    createdAt: contract.createdAt.toISOString(),
    filter: contractFilter(contract, parties, now),
    signed: progress.signed,
    requiredSignatures: progress.required,
    parties: parties
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((party) => ({
        id: party.id,
        role: party.role,
        name: party.name,
        email: party.email,
        required: party.required,
        signatureStatus: party.signatureStatus,
        method: party.method,
        signedAt: party.signedAt ? party.signedAt.toISOString() : null,
        signedByName: party.signedByName,
        isCaller: party.userId === callerUserId,
      })),
  };
}

/** Every contract the caller may see: their workspace's, or — for staff with
 *  the `contracts` permission standing in the internal workspace — all of
 *  them. Same ops-half rule P2 had to learn the hard way. */
export const getContractsFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<ContractListResult> => {
    const [
      { requireWorkspaceRole, effectiveHasPermission },
      { auth },
      { getRequest },
      { db },
      { desc, eq, inArray },
      schema,
    ] = await Promise.all([
      import("@/server/workspace-guard"),
      import("@/server/auth"),
      import("@tanstack/react-start/server"),
      import("@/database"),
      import("drizzle-orm"),
      import("@/database/schema"),
    ]);
    const headers = getRequest().headers;
    const caller = await requireWorkspaceRole(headers, "viewer");
    const session = await auth.api.getSession({ headers });
    if (!caller || !session) {
      return {
        contracts: [],
        pendingDeals: [],
        canDraft: false,
        canSend: false,
        canSign: false,
        canVoid: false,
      };
    }

    const [canDraft, canSend, canSign, canVoid] = await Promise.all([
      effectiveHasPermission(session, "contracts"),
      effectiveHasPermission(session, "contracts.send"),
      effectiveHasPermission(session, "contracts.sign"),
      effectiveHasPermission(session, "contracts.void"),
    ]);

    // Staff see every workspace's contracts; a buyer sees their own.
    const rows = await db
      .select({ contract: schema.contract, deal: schema.deal })
      .from(schema.contract)
      .innerJoin(schema.deal, eq(schema.deal.id, schema.contract.dealId))
      .where(canDraft ? undefined : eq(schema.contract.organizationId, caller.workspaceId))
      .orderBy(desc(schema.contract.createdAt));
    // Which dossiers still owe contracts — staff only, and computed from the
    // same mapping that drafts them, so the two cannot disagree.
    let pendingDeals: PendingDeal[] = [];
    if (canDraft) {
      const { missingContracts } = await import("@/lib/contract-types");
      const deals = await db.query.deal.findMany();
      const drafted = await db.query.contract.findMany({
        columns: { dealId: true, type: true },
      });
      pendingDeals = deals
        .map((deal) => {
          const existing = drafted.filter((c) => c.dealId === deal.id).map((c) => c.type);
          const missing = missingContracts(["buyer", "osi", "supplier"], existing).length;
          return { id: deal.id, title: deal.title, supplierName: deal.supplierName, missing };
        })
        .filter((d) => d.missing > 0);
    }

    if (rows.length === 0) {
      return { contracts: [], pendingDeals, canDraft, canSend, canSign, canVoid };
    }

    const parties = await db.query.contractParty.findMany({
      where: inArray(
        schema.contractParty.contractId,
        rows.map((r) => r.contract.id),
      ),
    });
    const byContract = new Map<string, typeof parties>();
    for (const party of parties) {
      const list = byContract.get(party.contractId) ?? [];
      list.push(party);
      byContract.set(party.contractId, list);
    }

    const now = new Date();
    return {
      contracts: rows.map((r) =>
        toView(r.contract, byContract.get(r.contract.id) ?? [], r.deal, caller.userId, now),
      ),
      pendingDeals,
      canDraft,
      canSend,
      canSign,
      canVoid,
    };
  },
);

/**
 * Draft the contracts a deal requires. Staff action: the mapping in
 * `contract-types.ts` decides WHICH, so nobody has to remember, and the
 * parties are filled from the deal — the buyer's workspace, OSI itself, and
 * the supplier, who is a ROW and not a user.
 */
export const draftContractsFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ dealId: z.string().min(1) }))
  .handler(async ({ data }): Promise<{ ok: boolean; created: number; reason?: string }> => {
    const [{ effectiveHasPermission }, { auth }, { getRequest }, { db }, { eq, sql }, schema] =
      await Promise.all([
        import("@/server/workspace-guard"),
        import("@/server/auth"),
        import("@tanstack/react-start/server"),
        import("@/database"),
        import("drizzle-orm"),
        import("@/database/schema"),
      ]);
    const headers = getRequest().headers;
    const session = await auth.api.getSession({ headers });
    if (!session || !(await effectiveHasPermission(session, "contracts"))) {
      return { ok: false, created: 0, reason: "forbidden" };
    }

    const deal = await db.query.deal.findFirst({ where: eq(schema.deal.id, data.dealId) });
    if (!deal) return { ok: false, created: 0, reason: "not_found" };

    const workspace = await db.query.organization.findFirst({
      where: eq(schema.organization.id, deal.organizationId),
    });
    const existing = await db.query.contract.findMany({
      where: eq(schema.contract.dealId, deal.id),
    });

    const { missingContracts, formatContractNumber } = await import("@/lib/contract-types");
    // The buyer and OSI always exist; the supplier comes from the deal.
    const roles: ContractPartyRole[] = ["buyer", "osi", "supplier"];
    const todo = missingContracts(
      roles,
      existing.map((c) => c.type),
    );
    if (todo.length === 0) return { ok: true, created: 0 };

    const year = new Date().getFullYear();
    let created = 0;
    for (const spec of todo) {
      const [seq] = await db
        .execute<{ n: string }>(sql`select nextval('contract_number_seq')::text as n`)
        .then((r) => r.rows as { n: string }[]);
      const contractId = crypto.randomUUID();
      await db.insert(schema.contract).values({
        id: contractId,
        number: formatContractNumber(Number(seq?.n ?? 0), year),
        dealId: deal.id,
        organizationId: deal.organizationId,
        type: spec.type,
        title: `${deal.title}`,
        status: "draft",
        // Pre-filled from the deal (brief §4 step 4) — the commercial terms
        // were agreed in the accepted quote, not invented here.
        amountCents: deal.amountCents,
        currency: deal.currency,
        incoterm: deal.incoterm,
        createdBy: session.user.id,
        createdByName: session.user.name,
      });

      // Parties: snapshots always, references only where one exists.
      const partyRows = spec.parties.map((role, index) => {
        const base = {
          id: crypto.randomUUID(),
          contractId,
          role,
          required: true,
          position: index,
        };
        if (role === "buyer") {
          return {
            ...base,
            organizationId: deal.organizationId,
            name: workspace?.name ?? "Client",
          };
        }
        if (role === "osi") return { ...base, name: "Oversea Sourcing Intelligence" };
        // The supplier has NO account — a row, a name, nothing else.
        return { ...base, supplierId: deal.supplierId, name: deal.supplierName };
      });
      await db.insert(schema.contractParty).values(partyRows);

      await db.insert(schema.contractEvent).values({
        id: crypto.randomUUID(),
        contractId,
        type: "contract.created",
        actorId: session.user.id,
        actorName: session.user.name,
        detail: { type: spec.type },
      });
      created += 1;
    }

    const { recordDealEvent } = await import("@/server/deals");
    await recordDealEvent(deal.id, deal.organizationId, "contracts.drafted", { count: created });
    return { ok: true, created };
  });
