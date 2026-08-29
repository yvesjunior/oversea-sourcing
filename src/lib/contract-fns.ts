// The contract centre (Phase P4) — the brief's declared priority.
//
// Everything the list needs is DERIVED, never stored: the five filters come
// from `contractFilter()` and the N/M indicator from `signatureProgress()`,
// both pure and unit-tested in src/lib/deal-status.ts. There is deliberately
// no `filter` or `signed_count` column — a stored copy is a second source of
// truth that will eventually disagree with the party rows.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type {
  ContractContent,
  ContractPartyRole,
  ContractStatus,
  ContractType,
} from "@/database/schema";
import { isStaleContent, type TemplateLocale } from "@/lib/contract-templates";
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
  /** How this party signs, from its ROLE (P6): in_platform for the buyer and
   *  OSI, manual_upload for everyone without an account. */
  mechanism: string;
  /** The three actions, RESOLVED on the server against the pure rules in
   *  src/lib/signature.ts. The UI shows a button when one is true and never
   *  re-derives the rule; the server fn re-checks it anyway. */
  canSignNow: boolean;
  canRecordManualNow: boolean;
  canRemindNow: boolean;
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
  /** The customer account this contract belongs to — staff lists carry every
   *  account at once, so a row has to name its own. Filtering keys on the id. */
  organizationId: string;
  organizationName: string;
  amountCents: number | null;
  currency: string | null;
  incoterm: string | null;
  paymentTerms: string | null;
  dueAt: string | null;
  createdAt: string;
  /** The rendered document, frozen at draft time (P5). Null on a contract
   *  drafted before templates existed. */
  content: ContractContent | null;
  /** True when `content` was rendered from an older template wording — staff
   *  may re-draft, but only while the contract is still a draft. */
  contentStale: boolean;
  /** Derived, not stored. */
  filter: ContractFilter;
  signed: number;
  requiredSignatures: number;
  parties: PartyView[];
};

/** A dossier whose required contracts have not been drafted yet. Surfaced so
 *  staff cannot silently MISS one the mapping requires — they may add a
 *  contract it did not predict, but not forget one it did. */
export type PendingDeal = {
  id: string;
  title: string;
  supplierName: string;
  missing: number;
  organizationId: string;
  organizationName: string;
};

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
  deal: { title: string; supplierName: string; organizationName: string },
  callerUserId: string,
  now: Date,
  signer: {
    workspaceId: string;
    workspaceRole: string;
    maySignForOsi: boolean;
    maySend: boolean;
  },
  rules: typeof import("@/lib/signature"),
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
    organizationId: contract.organizationId,
    organizationName: deal.organizationName,
    amountCents: contract.amountCents,
    currency: contract.currency,
    incoterm: contract.incoterm,
    paymentTerms: contract.paymentTerms,
    dueAt: contract.dueAt ? contract.dueAt.toISOString() : null,
    createdAt: contract.createdAt.toISOString(),
    content: contract.content,
    contentStale: isStaleContent(contract.content),
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
        mechanism: rules.mechanismFor(party.role),
        canSignNow: rules.canSignInPlatform(contract, party, signer) === "ok",
        canRecordManualNow:
          rules.canRecordManual(contract, party, { maySignForOsi: signer.maySignForOsi }) === "ok",
        canRemindNow: signer.maySend && rules.canRemind(contract, party),
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

    const [canDraft, canSend2, canSign, canVoid] = await Promise.all([
      effectiveHasPermission(session, "contracts"),
      effectiveHasPermission(session, "contracts.send"),
      effectiveHasPermission(session, "contracts.sign"),
      effectiveHasPermission(session, "contracts.void"),
    ]);

    // Staff see every workspace's contracts; a buyer sees their own.
    const rows = await db
      .select({
        contract: schema.contract,
        deal: schema.deal,
        organizationName: schema.organization.name,
      })
      .from(schema.contract)
      .innerJoin(schema.deal, eq(schema.deal.id, schema.contract.dealId))
      .innerJoin(schema.organization, eq(schema.organization.id, schema.contract.organizationId))
      .where(canDraft ? undefined : eq(schema.contract.organizationId, caller.workspaceId))
      .orderBy(desc(schema.contract.createdAt));
    // Which dossiers still owe contracts — staff only, and computed from the
    // same mapping that drafts them, so the two cannot disagree.
    let pendingDeals: PendingDeal[] = [];
    if (canDraft) {
      const { missingContracts } = await import("@/lib/contract-types");
      const deals = await db
        .select({ deal: schema.deal, organizationName: schema.organization.name })
        .from(schema.deal)
        .innerJoin(schema.organization, eq(schema.organization.id, schema.deal.organizationId));
      const drafted = await db.query.contract.findMany({
        columns: { dealId: true, type: true },
      });
      pendingDeals = deals
        .map(({ deal, organizationName }) => {
          const existing = drafted.filter((c) => c.dealId === deal.id).map((c) => c.type);
          const missing = missingContracts(["buyer", "osi", "supplier"], existing).length;
          return {
            id: deal.id,
            title: deal.title,
            supplierName: deal.supplierName,
            missing,
            organizationId: deal.organizationId,
            organizationName,
          };
        })
        .filter((d) => d.missing > 0);
    }

    if (rows.length === 0) {
      return { contracts: [], pendingDeals, canDraft, canSend: canSend2, canSign, canVoid };
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
    const rules = await import("@/lib/signature");
    const signer = {
      workspaceId: caller.workspaceId,
      workspaceRole: caller.role,
      maySignForOsi: canSign,
      maySend: canSend2,
    };
    return {
      contracts: rows.map((r) =>
        toView(
          r.contract,
          byContract.get(r.contract.id) ?? [],
          { ...r.deal, organizationName: r.organizationName },
          caller.userId,
          now,
          signer,
          rules,
        ),
      ),
      pendingDeals,
      canDraft,
      canSend: canSend2,
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
    // The accepted offer carries terms the deal row does not keep: payment
    // terms, quantity, MOQ, lead time. They were agreed there, so the
    // template quotes them rather than inventing them.
    const quote = deal.quoteId
      ? await db.query.quote.findFirst({ where: eq(schema.quote.id, deal.quoteId) })
      : undefined;
    // The document's language is the REQUEST's, not the reader's — see the
    // header of contract-templates.ts. A contract is an instrument, not a
    // timeline entry that re-reads in whatever locale you happen to use.
    const request = deal.requestId
      ? await db.query.request.findFirst({ where: eq(schema.request.id, deal.requestId) })
      : undefined;
    const locale: TemplateLocale = request?.locale === "en" ? "en" : "fr";

    const { missingContracts, formatContractNumber } = await import("@/lib/contract-types");
    const { renderContract } = await import("@/lib/contract-templates");
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
      const number = formatContractNumber(Number(seq?.n ?? 0), year);
      await db.insert(schema.contract).values({
        id: contractId,
        number,
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
        paymentTerms: quote?.paymentTerms ?? null,
        // Rendered ONCE and frozen (P5). Re-rendering later would rewrite a
        // document the parties may already have read.
        content: renderContract(spec.type, locale, {
          number,
          date: new Date(),
          buyerName: workspace?.name ?? "Client",
          osiName: "Oversea Sourcing Intelligence",
          supplierName: deal.supplierName,
          dealTitle: deal.title,
          amountCents: deal.amountCents,
          currency: deal.currency,
          incoterm: deal.incoterm,
          paymentTerms: quote?.paymentTerms ?? null,
          leadTimeDays: quote?.leadTimeDays ?? null,
          quantity: quote?.quantity ?? null,
          moq: quote?.moq ?? null,
        }),
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

/**
 * Re-render a DRAFT contract's text from the current template (P5).
 *
 * Deliberately refused on anything past `draft`: once a contract has been
 * sent, the text is what the parties were shown, and re-rendering it would
 * quietly replace the document under them. That is the same reasoning that
 * makes the content stored rather than derived in the first place — so the
 * guard lives here, on the only writer, rather than in the UI.
 */
export const regenerateContractContentFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ contractId: z.string().min(1) }))
  .handler(async ({ data }): Promise<{ ok: boolean; reason?: string }> => {
    const [{ effectiveHasPermission }, { auth }, { getRequest }, { db }, { eq }, schema] =
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
      return { ok: false, reason: "forbidden" };
    }

    const contract = await db.query.contract.findFirst({
      where: eq(schema.contract.id, data.contractId),
    });
    if (!contract) return { ok: false, reason: "not_found" };
    if (contract.status !== "draft") return { ok: false, reason: "not_draft" };

    const deal = await db.query.deal.findFirst({ where: eq(schema.deal.id, contract.dealId) });
    if (!deal) return { ok: false, reason: "not_found" };
    const workspace = await db.query.organization.findFirst({
      where: eq(schema.organization.id, deal.organizationId),
    });
    const quote = deal.quoteId
      ? await db.query.quote.findFirst({ where: eq(schema.quote.id, deal.quoteId) })
      : undefined;
    const request = deal.requestId
      ? await db.query.request.findFirst({ where: eq(schema.request.id, deal.requestId) })
      : undefined;
    const locale: TemplateLocale = request?.locale === "en" ? "en" : "fr";

    const { renderContract } = await import("@/lib/contract-templates");
    const content = renderContract(contract.type, locale, {
      number: contract.number,
      date: contract.createdAt,
      buyerName: workspace?.name ?? "Client",
      osiName: "Oversea Sourcing Intelligence",
      supplierName: deal.supplierName,
      dealTitle: deal.title,
      amountCents: deal.amountCents,
      currency: deal.currency,
      incoterm: deal.incoterm,
      paymentTerms: quote?.paymentTerms ?? null,
      leadTimeDays: quote?.leadTimeDays ?? null,
      quantity: quote?.quantity ?? null,
      moq: quote?.moq ?? null,
    });

    await db
      .update(schema.contract)
      .set({
        content,
        paymentTerms: quote?.paymentTerms ?? contract.paymentTerms,
        updatedAt: new Date(),
      })
      .where(eq(schema.contract.id, contract.id));

    // On the contract's OWN trail, not audit_log: this changes what the
    // document says, which is exactly the kind of fact that must outlive the
    // three-month journal purge.
    await db.insert(schema.contractEvent).values({
      id: crypto.randomUUID(),
      contractId: contract.id,
      type: "contract.redrafted",
      actorId: session.user.id,
      actorName: session.user.name,
      detail: { version: content.version, locale: content.locale },
    });
    return { ok: true };
  });

/** What a request's dossier knows about its contracts. Null `deal` means the
 *  buyer has not accepted an offer yet, and the dossier shows nothing. */
export type RequestDealStatus = {
  deal: { id: string; title: string; supplierName: string; status: string } | null;
  contracts: {
    id: string;
    number: string;
    type: ContractType;
    status: ContractStatus;
    signed: number;
    requiredSignatures: number;
  }[];
  /** Required types with no contract yet — the gap the dossier surfaces. */
  missing: ContractType[];
  canDraft: boolean;
};

/**
 * The contract state of one request's dossier (P5).
 *
 * The contracts list already shows staff which dossiers owe contracts. This
 * puts the same fact where the work actually happens — on the dossier — so a
 * missing required contract is visible to the buyer too, not only to whoever
 * happens to open /contrats. The mapping is the SAME `missingContracts` the
 * drafting fn uses, so the warning and the draft button cannot disagree.
 */
export const getRequestDealStatusFn = createServerFn({ method: "GET" })
  .inputValidator(z.object({ requestId: z.string().min(1) }))
  .handler(async ({ data }): Promise<RequestDealStatus> => {
    const [
      { requireWorkspaceRole, effectiveHasPermission },
      { auth },
      { getRequest },
      { db },
      { eq, inArray },
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
    const empty: RequestDealStatus = { deal: null, contracts: [], missing: [], canDraft: false };
    if (!caller || !session) return empty;

    const canDraft = await effectiveHasPermission(session, "contracts");

    const deal = await db.query.deal.findFirst({
      where: eq(schema.deal.requestId, data.requestId),
    });
    if (!deal) return { ...empty, canDraft };
    // Staff stand in the internal workspace, so scope to the caller's own
    // workspace only when they are NOT staff — the ops-half rule P2 learned.
    if (!canDraft && deal.organizationId !== caller.workspaceId) return { ...empty, canDraft };

    const contracts = await db.query.contract.findMany({
      where: eq(schema.contract.dealId, deal.id),
    });
    const parties = contracts.length
      ? await db.query.contractParty.findMany({
          where: inArray(
            schema.contractParty.contractId,
            contracts.map((c) => c.id),
          ),
        })
      : [];

    const { missingContracts } = await import("@/lib/contract-types");
    const missing = missingContracts(
      ["buyer", "osi", "supplier"],
      contracts.map((c) => c.type),
    ).map((spec) => spec.type);

    return {
      deal: {
        id: deal.id,
        title: deal.title,
        supplierName: deal.supplierName,
        status: deal.status,
      },
      contracts: contracts.map((contract) => {
        const progress = signatureProgress(parties.filter((p) => p.contractId === contract.id));
        return {
          id: contract.id,
          number: contract.number,
          type: contract.type,
          status: contract.status,
          signed: progress.signed,
          requiredSignatures: progress.required,
        };
      }),
      missing,
      canDraft,
    };
  });

/** The contract's own trail (brief §3.2) — created, sent, each signature,
 *  each reminder. Deliberately NOT audit_log: the journal is purged at three
 *  months and signature evidence has to outlive that. */
export type ContractEventView = {
  id: string;
  type: string;
  actorName: string | null;
  partyName: string | null;
  /** Narrow on purpose: a server fn's return has to be serializable, and the
   *  trail only ever renders these. */
  detail: {
    method?: string;
    role?: string;
    mailed?: boolean;
    notified?: number;
    parties?: number;
    hasDocument?: boolean;
  } | null;
  at: string;
};

export const getContractEventsFn = createServerFn({ method: "GET" })
  .inputValidator(z.object({ contractId: z.string().min(1) }))
  .handler(async ({ data }): Promise<ContractEventView[]> => {
    const [
      { requireWorkspaceRole, effectiveHasPermission },
      { auth },
      { getRequest },
      { db },
      { asc, eq },
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
    if (!caller || !session) return [];

    const contract = await db.query.contract.findFirst({
      where: eq(schema.contract.id, data.contractId),
    });
    if (!contract) return [];
    // Same visibility as the contract itself: your own workspace's, or every
    // one of them for staff standing in the internal workspace.
    const isStaff = await effectiveHasPermission(session, "contracts");
    if (!isStaff && contract.organizationId !== caller.workspaceId) return [];

    const rows = await db.query.contractEvent.findMany({
      where: eq(schema.contractEvent.contractId, contract.id),
      orderBy: asc(schema.contractEvent.at),
    });
    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      actorName: row.actorName,
      partyName: row.partyName,
      detail: (row.detail ?? null) as ContractEventView["detail"],
      at: row.at.toISOString(),
    }));
  });
