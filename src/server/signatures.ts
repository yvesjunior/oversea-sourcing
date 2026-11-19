// Signatures — the rows (Phase P6; Phase V · V26).
//
// The rules are pure (src/lib/signature.ts). The workspace's two ways of
// recording a signature are in src/lib/signature-fns.ts — the buyer's or
// OSI's own, and staff recording a countersigned PDF. This file holds what
// they share, and the THIRD way V26 adds: a supplier's person signing their
// own line in the portal.
//
// Two invariants, the same as before:
//
//   • A contract's status is NEVER set by hand: after any change to a party
//     row it is recomputed from the rows (`syncContractStatus`), so the status
//     and the N/M indicator cannot drift apart.
//   • Every signature writes a `contract_event` of type `contract.signed` —
//     the permanent evidence, kept beside the contract and not in the journal
//     that is purged at three months. A supplier's portal signature writes
//     the SAME event as a recorded PDF does; they differ in `detail.method`
//     and in nothing else.

import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/database";
import * as schema from "@/database/schema";
import type { ContractContent } from "@/database/schema";
import { signatureProgress, statusFromSignatures } from "@/lib/deal-status";
import { canSupplierSign, type SupplierSignRefusal } from "@/lib/signature";
import { logAudit } from "@/server/audit";
import { getSetting } from "@/server/platform-settings";

/** Recompute status from the party rows and stamp the contract. Returns the
 *  new status so callers can react to completion without re-reading. */
export async function syncContractStatus(contractId: string): Promise<string> {
  const parties = await db.query.contractParty.findMany({
    where: eq(schema.contractParty.contractId, contractId),
  });
  const status = statusFromSignatures(parties);
  await db
    .update(schema.contract)
    .set({
      status,
      ...(status === "signed" ? { signedAt: new Date() } : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.contract.id, contractId));
  return status;
}

/** Everyone mandatory has signed — tell the buyer their contract is complete. */
export async function notifyContractComplete(contractId: string): Promise<void> {
  const contract = await db.query.contract.findFirst({
    where: eq(schema.contract.id, contractId),
  });
  if (!contract) return;
  const deal = await db.query.deal.findFirst({ where: eq(schema.deal.id, contract.dealId) });
  const request = deal?.requestId
    ? await db.query.request.findFirst({ where: eq(schema.request.id, deal.requestId) })
    : undefined;
  if (!request?.createdBy) return;

  const { notifyUser } = await import("@/server/notify");
  await notifyUser({
    userId: request.createdBy,
    organizationId: contract.organizationId,
    type: "contract_signed",
    params: { number: contract.number },
    link: `/contrats/${contract.id}`,
    email: {
      subjectFr: `Contrat signé — ${contract.number}`,
      subjectEn: `Contract signed — ${contract.number}`,
      bodyFr: `Toutes les signatures obligatoires du contrat ${contract.number} sont réunies.`,
      bodyEn: `Every mandatory signature on contract ${contract.number} is in.`,
    },
  });
}

// ── the supplier's side (V26) ───────────────────────────────────────────────

/** Who is asking: what `requireSupplierSession` returned. */
export type SupplierSigner = { userId: string; userName: string; supplierIds: string[] };

/** A contract is the supplier's to read once it has LEFT OSI: a draft is an
 *  internal working copy, and a voided one is no longer a document. */
const VISIBLE: readonly schema.ContractStatus[] = ["sent", "partially_signed", "signed"];

export type SupplierContractSummary = {
  id: string;
  number: string;
  title: string;
  status: schema.ContractStatus;
  /** Mandatory signatures in, out of how many. */
  signed: number;
  required: number;
  /** The caller's own line. */
  yourStatus: schema.SignatureStatus;
  canSign: boolean;
};

export type SupplierContractView = SupplierContractSummary & {
  dealId: string;
  content: ContractContent | null;
  /** The parties as the contract names them. A contract is between named
   *  parties: whoever signs it reads who they are. */
  parties: Array<{
    role: schema.ContractPartyRole;
    name: string;
    signatureStatus: schema.SignatureStatus;
    signedAt: string | null;
    you: boolean;
  }>;
  /** Why the caller cannot sign right now — null when they can. */
  refusal: SupplierSignRefusal | null;
};

type Loaded = {
  contract: typeof schema.contract.$inferSelect;
  parties: (typeof schema.contractParty.$inferSelect)[];
  own: typeof schema.contractParty.$inferSelect;
};

/**
 * The caller's contracts — those where one of THEIR suppliers holds a
 * supplier line, that have been sent, on a dossier where the buyer's identity
 * has been disclosed to the supplier (a contract names its parties; it is not
 * shown before that step has been taken — decision D6).
 */
async function ownContracts(
  signer: SupplierSigner,
  filter: { dealId?: string; contractId?: string },
): Promise<Loaded[]> {
  if (signer.supplierIds.length === 0) return [];
  const lines = await db
    .select({ party: schema.contractParty, contract: schema.contract })
    .from(schema.contractParty)
    .innerJoin(schema.contract, eq(schema.contract.id, schema.contractParty.contractId))
    .innerJoin(schema.deal, eq(schema.deal.id, schema.contract.dealId))
    .where(
      and(
        eq(schema.contractParty.role, "supplier"),
        inArray(schema.contractParty.supplierId, signer.supplierIds),
        inArray(schema.contract.status, [...VISIBLE]),
        ...(filter.dealId ? [eq(schema.contract.dealId, filter.dealId)] : []),
        ...(filter.contractId ? [eq(schema.contract.id, filter.contractId)] : []),
      ),
    );
  if (lines.length === 0) return [];
  const disclosed = await db
    .select({ id: schema.deal.id, at: schema.deal.buyerDisclosedAt })
    .from(schema.deal)
    .where(
      inArray(
        schema.deal.id,
        lines.map((line) => line.contract.dealId),
      ),
    );
  const open = new Set(disclosed.filter((deal) => deal.at !== null).map((deal) => deal.id));
  const shown = lines.filter((line) => open.has(line.contract.dealId));
  if (shown.length === 0) return [];
  const parties = await db
    .select()
    .from(schema.contractParty)
    .where(
      inArray(
        schema.contractParty.contractId,
        shown.map((line) => line.contract.id),
      ),
    )
    .orderBy(asc(schema.contractParty.position));
  return shown.map((line) => ({
    contract: line.contract,
    own: line.party,
    parties: parties.filter((party) => party.contractId === line.contract.id),
  }));
}

function summary(loaded: Loaded, verdict: "ok" | SupplierSignRefusal): SupplierContractSummary {
  const progress = signatureProgress(loaded.parties);
  return {
    id: loaded.contract.id,
    number: loaded.contract.number,
    title: loaded.contract.title,
    status: loaded.contract.status,
    signed: progress.signed,
    required: progress.required,
    yourStatus: loaded.own.signatureStatus,
    canSign: verdict === "ok",
  };
}

async function enabled(): Promise<boolean> {
  return (await getSetting("contracts.supplier_signature")) === "on";
}

/** The caller's contracts on one dossier. */
export async function listSupplierContracts(
  signer: SupplierSigner,
  dealId: string,
): Promise<SupplierContractSummary[]> {
  const [contracts, on] = await Promise.all([ownContracts(signer, { dealId }), enabled()]);
  return contracts.map((loaded) =>
    summary(loaded, canSupplierSign(loaded.contract, loaded.own, signer, on)),
  );
}

/** One contract, with its text. Null when it is not the caller's to read. */
export async function readSupplierContract(
  signer: SupplierSigner,
  contractId: string,
): Promise<SupplierContractView | null> {
  const [[loaded], on] = await Promise.all([ownContracts(signer, { contractId }), enabled()]);
  if (!loaded) return null;
  const verdict = canSupplierSign(loaded.contract, loaded.own, signer, on);
  return {
    ...summary(loaded, verdict),
    dealId: loaded.contract.dealId,
    content: loaded.contract.content,
    parties: loaded.parties.map((party) => ({
      role: party.role,
      name: party.name,
      signatureStatus: party.signatureStatus,
      signedAt: party.signedAt ? party.signedAt.toISOString() : null,
      you: party.id === loaded.own.id,
    })),
    refusal: verdict === "ok" ? null : verdict,
  };
}

export type SupplierSignResult =
  { ok: true; status: string } | { ok: false; reason: SupplierSignRefusal | "not_found" };

/**
 * A supplier's person signs their own line.
 *
 * They sign AS THEMSELVES — an authenticated session, not a name typed by
 * someone else — which is what this path is worth as evidence, and exactly
 * what the buyer's own signature records: who, when, from where. The row is
 * re-read under a lock, so two clicks record one signature.
 */
export async function signAsSupplier(
  signer: SupplierSigner,
  contractId: string,
  request: { ip: string | null; userAgent: string | null },
): Promise<SupplierSignResult> {
  const [loaded] = await ownContracts(signer, { contractId });
  // Not theirs, not sent, or not disclosed: one answer.
  if (!loaded) return { ok: false, reason: "not_found" };
  const on = await enabled();

  const outcome = await db.transaction(async (tx) => {
    const [party] = await tx
      .select()
      .from(schema.contractParty)
      .where(eq(schema.contractParty.id, loaded.own.id))
      .for("update");
    const [contract] = await tx
      .select()
      .from(schema.contract)
      .where(eq(schema.contract.id, contractId));
    if (!party || !contract) return { refusal: "not_found" as const };
    const verdict = canSupplierSign(contract, party, signer, on);
    if (verdict !== "ok") return { refusal: verdict };

    await tx
      .update(schema.contractParty)
      .set({
        signatureStatus: "signed",
        method: "in_platform",
        signedAt: new Date(),
        signedByName: signer.userName,
        userId: signer.userId,
        evidence: {
          ip: request.ip,
          userAgent: request.userAgent,
          // Which kind of session signed: a supplier's own account, in the
          // portal — not a workspace member.
          signedAs: "supplier_account",
          supplierId: party.supplierId,
        },
      })
      .where(eq(schema.contractParty.id, party.id));
    await tx.insert(schema.contractEvent).values({
      id: crypto.randomUUID(),
      contractId: contract.id,
      type: "contract.signed",
      actorId: signer.userId,
      actorName: signer.userName,
      partyId: party.id,
      partyName: party.name,
      detail: { method: "in_platform", role: party.role },
    });
    return { contract, party };
  });
  if ("refusal" in outcome) return { ok: false, reason: outcome.refusal };

  // The operational row, beside the permanent evidence above.
  await logAudit({
    actorId: signer.userId,
    actorName: signer.userName,
    organizationId: outcome.contract.organizationId,
    action: "contract.signed",
    target: outcome.contract.number,
    detail: { role: outcome.party.role, method: "in_platform", by: "supplier_account" },
  });
  const status = await syncContractStatus(contractId);
  if (status === "signed") await notifyContractComplete(contractId);
  return { ok: true, status };
}

/**
 * Do these suppliers have a person with an account? For the workspace's
 * contract page, which says how each party's signature can be obtained.
 */
export async function suppliersWithAccount(supplierIds: readonly string[]): Promise<Set<string>> {
  const ids = [...new Set(supplierIds)];
  if (ids.length === 0) return new Set();
  const rows = await db
    .select({ supplierId: schema.supplierUser.supplierId })
    .from(schema.supplierUser)
    .where(inArray(schema.supplierUser.supplierId, ids));
  return new Set(rows.map((row) => row.supplierId));
}
