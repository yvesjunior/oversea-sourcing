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
