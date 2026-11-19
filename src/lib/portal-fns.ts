// The supplier portal (Phase V · V16) — server functions.
//
// EVERY function here goes through `requireSupplierSession`, and passes what
// it returns — the caller's `supplierIds` — to `src/server/portal.ts`, where
// every query is filtered by them. A caller who is not a supplier account
// linked to a supplier gets the same refusal whatever they asked for.
//
// Listed in `src/lib/external-access.ts` as opened to external accounts; the
// test there fails if one of them reads its session any other way.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { DossierView } from "@/lib/dossier";
import { MILESTONE_KINDS, isMilestoneKind } from "@/lib/milestones";
import type { DossierSummary, DossierWriteResult } from "@/server/dossier";
import type { MilestoneWriteResult } from "@/server/milestones";
import type { PortalRfqDetail, PortalRfqSummary, PortalWriteResult } from "@/server/portal";
import type {
  SupplierContractSummary,
  SupplierContractView,
  SupplierSignResult,
} from "@/server/signatures";

export type {
  PortalRfqDetail,
  PortalRfqSummary,
  PortalWriteResult,
  SupplierContractSummary,
  SupplierContractView,
  SupplierSignResult,
};

async function caller() {
  const [{ requireSupplierSession }, { getRequest }] = await Promise.all([
    import("@/server/party-guard"),
    import("@tanstack/react-start/server"),
  ]);
  const session = await requireSupplierSession(getRequest().headers);
  if (!session) return null;
  return {
    userId: session.userId,
    userName: session.userName,
    supplierIds: session.supplierIds,
    locale: session.locale,
  };
}

/** The RFQs addressed to the caller's supplier(s). Null = not a supplier
 *  account — a refusal, which the page turns into "sign in". */
export const getMyRfqsFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<PortalRfqSummary[] | null> => {
    const who = await caller();
    if (!who) return null;
    const { listRfqs } = await import("@/server/portal");
    return listRfqs(who);
  },
);

/** One RFQ. Null when the caller is not a supplier account, AND when the RFQ
 *  is not one of theirs — indistinguishable on purpose. */
export const getRfqFn = createServerFn({ method: "GET" })
  .inputValidator(z.object({ id: z.string().min(1).max(100) }))
  .handler(async ({ data }): Promise<PortalRfqDetail | null> => {
    const who = await caller();
    if (!who) return null;
    const { readRfq } = await import("@/server/portal");
    return readRfq(who, data.id);
  });

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((value) => (value ? value : null));

/** Send an offer, or revise one while the window is open. */
export const submitOfferFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      id: z.string().min(1).max(100),
      // A price is what makes it an offer: required here, where the supplier
      // writes it themselves. (Staff keying in an email may leave it out.)
      amountCents: z.number().int().min(1).max(1_000_000_000_00),
      currency: z
        .string()
        .trim()
        .regex(/^[A-Za-z]{3}$/),
      quantity: text(80),
      moq: text(80),
      leadTimeDays: z.number().int().min(0).max(3650).nullable(),
      incoterm: text(20),
      paymentTerms: text(200),
      notes: text(2000),
      /** A day, "2026-12-31"; the offer stands until the end of it (UTC). */
      validUntil: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .nullable(),
    }),
  )
  .handler(async ({ data }): Promise<PortalWriteResult> => {
    const who = await caller();
    if (!who) return { ok: false, reason: "not_found" };
    const { submitOffer } = await import("@/server/portal");
    const { id, validUntil, ...fields } = data;
    return submitOffer(who, id, {
      ...fields,
      validUntil: validUntil ? new Date(`${validUntil}T23:59:59.000Z`) : null,
    });
  });

/** Decline an RFQ. */
export const declineRfqFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string().min(1).max(100), note: text(300) }))
  .handler(async ({ data }): Promise<PortalWriteResult> => {
    const who = await caller();
    if (!who) return { ok: false, reason: "not_found" };
    const { declineRfq } = await import("@/server/portal");
    return declineRfq(who, data.id, data.note);
  });

// ── the Transaction Room, the supplier's slice (V25) ────────────────────────
//
// Same guard, same rule: the caller's `supplierIds` decide which dossiers are
// theirs — the ones their supplier is a PARTY to — and src/lib/dossier.ts
// decides what a supplier reads of one: its own offer, OSI, the buyer only
// once disclosed, the documents and threads shared with it. No partner.

/** The dossiers the caller's supplier(s) are a party to. */
export const getMyDossiersFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<DossierSummary[] | null> => {
    const who = await caller();
    if (!who) return null;
    const { listDossiers } = await import("@/server/dossier");
    return listDossiers({ kind: "supplier", ...who });
  },
);

/** One dossier — null when the caller's supplier is not a party to it. */
export const getMyDossierFn = createServerFn({ method: "GET" })
  .inputValidator(z.object({ id: z.string().min(1).max(100) }))
  .handler(async ({ data }): Promise<DossierView | null> => {
    const who = await caller();
    if (!who) return null;
    const { readDossier } = await import("@/server/dossier");
    return readDossier({ kind: "supplier", ...who }, data.id);
  });

const messageBody = z.string().trim().min(1).max(4000);

/** Write to OSI about a dossier. A supplier's thread is with OSI alone. */
export const startMyThreadFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      dealId: z.string().min(1).max(100),
      subject: z.string().trim().min(2).max(160),
      body: messageBody,
    }),
  )
  .handler(async ({ data }): Promise<DossierWriteResult> => {
    const who = await caller();
    if (!who) return { ok: false, reason: "not_found" };
    const { createThread } = await import("@/server/dossier");
    return createThread({ kind: "supplier", ...who }, data.dealId, { ...data, parties: [] });
  });

/** Answer in a thread the caller's supplier is in. */
export const postMyMessageFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ threadId: z.string().min(1).max(100), body: messageBody }))
  .handler(async ({ data }): Promise<DossierWriteResult> => {
    const who = await caller();
    if (!who) return { ok: false, reason: "not_found" };
    const { postMessage } = await import("@/server/dossier");
    return postMessage({ kind: "supplier", ...who }, data.threadId, data.body);
  });

// ── contracts, the supplier's own line (V26) ────────────────────────────────
//
// A supplier's person reads the contracts their supplier is a PARTY to — once
// sent, on a dossier where the buyer has been disclosed — and, when the
// platform setting `contracts.supplier_signature` is on, signs their own line.
// Off by default: until then they read, and staff record the countersigned
// PDF as before.

/** The caller's contracts on one dossier. */
export const getMyContractsFn = createServerFn({ method: "GET" })
  .inputValidator(z.object({ dealId: z.string().min(1).max(100) }))
  .handler(async ({ data }): Promise<SupplierContractSummary[] | null> => {
    const who = await caller();
    if (!who) return null;
    const { listSupplierContracts } = await import("@/server/signatures");
    return listSupplierContracts(who, data.dealId);
  });

/** One contract, with its text — null when it is not the caller's to read. */
export const getMyContractFn = createServerFn({ method: "GET" })
  .inputValidator(z.object({ id: z.string().min(1).max(100) }))
  .handler(async ({ data }): Promise<SupplierContractView | null> => {
    const who = await caller();
    if (!who) return null;
    const { readSupplierContract } = await import("@/server/signatures");
    return readSupplierContract(who, data.id);
  });

/** Sign the caller's own line. They sign as themselves: the session is the
 *  signatory, and where it signed from is kept beside the date. */
export const signMyContractFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ contractId: z.string().min(1).max(100) }))
  .handler(async ({ data }): Promise<SupplierSignResult> => {
    const who = await caller();
    if (!who) return { ok: false, reason: "not_found" };
    const [{ signAsSupplier }, { getRequest }] = await Promise.all([
      import("@/server/signatures"),
      import("@tanstack/react-start/server"),
    ]);
    const headers = getRequest().headers;
    return signAsSupplier(who, data.contractId, {
      ip: headers.get("cf-connecting-ip") ?? headers.get("x-forwarded-for") ?? null,
      userAgent: headers.get("user-agent") ?? null,
    });
  });

// ── production, recorded by the supplier (V27) ──────────────────────────────
//
// The supplier says when its production is meant to start and finish, and
// records that it did — the milestones that are its own work
// (`mayRecordMilestone`). The buyer reads them, dated, with which side
// recorded them. Proofs are uploaded through /api/portal/milestone-proof.

const milestoneKind = z.enum(MILESTONE_KINDS as [string, ...string[]]);

/** Say when one of the caller's own milestones is meant to happen. */
export const planMyMilestoneFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      dealId: z.string().min(1).max(100),
      kind: milestoneKind,
      plannedAt: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .nullable(),
    }),
  )
  .handler(async ({ data }): Promise<MilestoneWriteResult> => {
    const who = await caller();
    if (!who || !isMilestoneKind(data.kind)) return { ok: false, reason: "not_found" };
    const { planMilestone } = await import("@/server/milestones");
    return planMilestone(
      { kind: "supplier", ...who },
      data.dealId,
      data.kind,
      data.plannedAt ? new Date(`${data.plannedAt}T00:00:00.000Z`) : null,
    );
  });

/** Record that one of the caller's own milestones happened. */
export const completeMyMilestoneFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      dealId: z.string().min(1).max(100),
      kind: milestoneKind,
      note: z
        .string()
        .trim()
        .max(1000)
        .nullable()
        .transform((value) => (value ? value : null)),
    }),
  )
  .handler(async ({ data }): Promise<MilestoneWriteResult> => {
    const who = await caller();
    if (!who || !isMilestoneKind(data.kind)) return { ok: false, reason: "not_found" };
    const { completeMilestone } = await import("@/server/milestones");
    return completeMilestone({ kind: "supplier", ...who }, data.dealId, data.kind, data.note);
  });
