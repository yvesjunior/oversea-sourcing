// The Partner Hub (Phase V · V23) — server functions.
//
// EVERY function here goes through `requirePartnerSession` — never the
// supplier's guard, never the workspace getter — and passes what it returns,
// the caller's `partnerIds`, to `src/server/partner-hub.ts`, where every
// query is filtered by them and every case is cut down to what its kind
// needs. A caller who is not a partner account linked to a partner gets the
// same refusal whatever they asked for.
//
// Listed in `src/lib/external-access.ts` as opened to external accounts; the
// test there fails if one of them reads its session any other way.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { DossierView } from "@/lib/dossier";
import type { DossierSummary, DossierWriteResult } from "@/server/dossier";
import type { HubAnswerResult, HubCaseDetail, HubCaseSummary } from "@/server/partner-hub";

export type { HubAnswerResult, HubCaseDetail, HubCaseSummary };

async function partnerCaller() {
  const [{ requirePartnerSession }, { getRequest }] = await Promise.all([
    import("@/server/party-guard"),
    import("@tanstack/react-start/server"),
  ]);
  const session = await requirePartnerSession(getRequest().headers);
  if (!session) return null;
  return {
    userId: session.userId,
    userName: session.userName,
    partnerIds: session.partnerIds,
    locale: session.locale,
  };
}

/** The cases addressed to the caller's partner(s). Null = not a partner
 *  account — a refusal, which the page says as such. */
export const getHubCasesFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<HubCaseSummary[] | null> => {
    const who = await partnerCaller();
    if (!who) return null;
    const { listCases } = await import("@/server/partner-hub");
    return listCases(who);
  },
);

/** One case. Null when the caller is not a partner account, AND when the
 *  case is not one of theirs — indistinguishable on purpose. */
export const getHubCaseFn = createServerFn({ method: "GET" })
  .inputValidator(z.object({ id: z.string().min(1).max(100) }))
  .handler(async ({ data }): Promise<HubCaseDetail | null> => {
    const who = await partnerCaller();
    if (!who) return null;
    const { readCase } = await import("@/server/partner-hub");
    return readCase(who, data.id);
  });

/** The partner's own figure on one of their cases — the first, or a
 *  correction (the earlier one stays on record). */
export const answerHubCaseFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      caseId: z.string().min(1).max(100),
      amountCents: z.number().int().min(0).max(1_000_000_000_00),
      currency: z
        .string()
        .trim()
        .regex(/^[A-Za-z]{3}$/),
      /** A day; the figure stands until the end of it (UTC). */
      validUntil: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .nullable(),
      /** How many of the supplier's units the figure covers (V24). */
      units: z.number().positive().max(1_000_000_000_000).nullable().default(null),
      note: z
        .string()
        .trim()
        .max(500)
        .nullable()
        .transform((value) => (value ? value : null)),
    }),
  )
  .handler(async ({ data }): Promise<HubAnswerResult> => {
    const who = await partnerCaller();
    // The same answer as a case that is not theirs.
    if (!who) return { ok: false, reason: "not_found" };
    const { answerCase } = await import("@/server/partner-hub");
    return answerCase(who, data.caseId, {
      amountCents: data.amountCents,
      currency: data.currency,
      validUntil: data.validUntil ? new Date(`${data.validUntil}T23:59:59.000Z`) : null,
      units: data.units,
      note: data.note,
    });
  });

// ── the Transaction Room, a partner's slice (V25) ───────────────────────────
//
// The dossiers the caller's partner was PUT ON by staff, and of each one what
// that kind of partner's work needs (src/lib/dossier.ts, on the same table as
// a case): never the buyer, the supplier only for an inspection, the price
// only where the work is computed from it.

/** The dossiers the caller's partner(s) are a party to. */
export const getHubDossiersFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<DossierSummary[] | null> => {
    const who = await partnerCaller();
    if (!who) return null;
    const { listDossiers } = await import("@/server/dossier");
    return listDossiers({ kind: "partner", ...who });
  },
);

/** One dossier — null when the caller's partner is not a party to it. */
export const getHubDossierFn = createServerFn({ method: "GET" })
  .inputValidator(z.object({ id: z.string().min(1).max(100) }))
  .handler(async ({ data }): Promise<DossierView | null> => {
    const who = await partnerCaller();
    if (!who) return null;
    const { readDossier } = await import("@/server/dossier");
    return readDossier({ kind: "partner", ...who }, data.id);
  });

const messageBody = z.string().trim().min(1).max(4000);

/** Write to OSI about a dossier. A partner's thread is with OSI alone. */
export const startHubThreadFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      dealId: z.string().min(1).max(100),
      subject: z.string().trim().min(2).max(160),
      body: messageBody,
    }),
  )
  .handler(async ({ data }): Promise<DossierWriteResult> => {
    const who = await partnerCaller();
    if (!who) return { ok: false, reason: "not_found" };
    const { createThread } = await import("@/server/dossier");
    return createThread({ kind: "partner", ...who }, data.dealId, { ...data, parties: [] });
  });

/** Answer in a thread the caller's partner is in. */
export const postHubMessageFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ threadId: z.string().min(1).max(100), body: messageBody }))
  .handler(async ({ data }): Promise<DossierWriteResult> => {
    const who = await partnerCaller();
    if (!who) return { ok: false, reason: "not_found" };
    const { postMessage } = await import("@/server/dossier");
    return postMessage({ kind: "partner", ...who }, data.threadId, data.body);
  });
