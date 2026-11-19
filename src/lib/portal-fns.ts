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
import type { PortalRfqDetail, PortalRfqSummary, PortalWriteResult } from "@/server/portal";

export type { PortalRfqDetail, PortalRfqSummary, PortalWriteResult };

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
