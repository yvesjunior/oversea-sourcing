// Partners (Phase V · V21) — staff's server functions.
//
// Staff holding `partners`, standing in the internal workspace. A partner's
// own people never come through here: theirs is the Partner Hub (V23), behind
// `requirePartnerSession`.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { CONTACT_LOCALES } from "@/database/schema";
import { PARTNER_KINDS } from "@/lib/partners";
import type { PartnerKind } from "@/lib/partners";
import type {
  OpenCaseResult,
  PartnerCaseView,
  RecordEnrichmentResult,
} from "@/server/partner-cases";
import type { PartnerView, PartnerWriteResult } from "@/server/partner-directory";

export type {
  OpenCaseResult,
  PartnerCaseView,
  PartnerView,
  PartnerWriteResult,
  RecordEnrichmentResult,
};

async function requirePartnerStaff() {
  const [{ auth }, { getRequest }, { effectiveHasPermission }] = await Promise.all([
    import("@/server/auth"),
    import("@tanstack/react-start/server"),
    import("@/server/workspace-guard"),
  ]);
  const session = await auth.api.getSession({ headers: getRequest().headers });
  if (!session || !(await effectiveHasPermission(session, "partners"))) return null;
  return session;
}

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((value) => (value ? value : null));

const contactFields = {
  name: z.string().trim().min(2).max(120),
  contactName: optional(120),
  contactEmail: z
    .union([z.string().trim().email().max(200), z.literal(""), z.null()])
    .transform((value) => (value ? value.toLowerCase() : null)),
  contactPhone: optional(40),
  locale: z.enum(CONTACT_LOCALES),
  notes: optional(1000),
};

/** Every partner on file. Null = not staff. */
export const getPartnersFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<PartnerView[] | null> => {
    if (!(await requirePartnerStaff())) return null;
    const { listPartners } = await import("@/server/partner-directory");
    return listPartners();
  },
);

export const createPartnerFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ kind: z.enum(PARTNER_KINDS), ...contactFields }))
  .handler(async ({ data }): Promise<PartnerWriteResult | { ok: false; reason: "forbidden" }> => {
    const session = await requirePartnerStaff();
    if (!session) return { ok: false, reason: "forbidden" };
    const { createPartner } = await import("@/server/partner-directory");
    return createPartner(data, { id: session.user.id, name: session.user.name });
  });

export const updatePartnerFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string().min(1), active: z.boolean(), ...contactFields }))
  .handler(async ({ data }): Promise<PartnerWriteResult | { ok: false; reason: "forbidden" }> => {
    const session = await requirePartnerStaff();
    if (!session) return { ok: false, reason: "forbidden" };
    const { updatePartner } = await import("@/server/partner-directory");
    const { id, ...fields } = data;
    return updatePartner(id, fields, { id: session.user.id, name: session.user.name });
  });

// ── cases and enrichments (V22) ─────────────────────────────────────────────

export type PartnerWork = {
  /** Every case opened about the offer, newest first, with its figures. */
  cases: PartnerCaseView[];
  /** The partners a new case can be opened with: active, and of a kind that
   *  adds a figure to an offer. */
  partners: Array<{ id: string; name: string; kind: PartnerKind }>;
};

/** What partners have been asked, and have answered, about one offer. */
export const getPartnerWorkFn = createServerFn({ method: "GET" })
  .inputValidator(z.object({ quoteId: z.string().min(1) }))
  .handler(async ({ data }): Promise<PartnerWork | null> => {
    if (!(await requirePartnerStaff())) return null;
    const [{ casesForQuote }, { listPartners }, { ENRICHMENT_OF }] = await Promise.all([
      import("@/server/partner-cases"),
      import("@/server/partner-directory"),
      import("@/lib/partner-case"),
    ]);
    const [cases, partners] = await Promise.all([casesForQuote(data.quoteId), listPartners()]);
    return {
      cases,
      partners: partners
        .filter((p) => p.active && ENRICHMENT_OF[p.kind] !== null)
        .map((p) => ({ id: p.id, name: p.name, kind: p.kind })),
    };
  });

/** Open a case with a partner about an offer (decision D10: staff assign). */
export const openPartnerCaseFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({ quoteId: z.string().min(1), partnerId: z.string().min(1), brief: optional(500) }),
  )
  .handler(async ({ data }): Promise<OpenCaseResult | { ok: false; reason: "forbidden" }> => {
    const session = await requirePartnerStaff();
    if (!session) return { ok: false, reason: "forbidden" };
    const { openCase } = await import("@/server/partner-cases");
    return openCase(data, { id: session.user.id, name: session.user.name });
  });

/** Record what the partner answered, on their behalf — or correct it. */
export const recordEnrichmentFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      caseId: z.string().min(1),
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
      note: optional(500),
    }),
  )
  .handler(
    async ({ data }): Promise<RecordEnrichmentResult | { ok: false; reason: "forbidden" }> => {
      const session = await requirePartnerStaff();
      if (!session) return { ok: false, reason: "forbidden" };
      const { recordEnrichment } = await import("@/server/partner-cases");
      return recordEnrichment(
        data.caseId,
        {
          amountCents: data.amountCents,
          currency: data.currency,
          validUntil: data.validUntil ? new Date(`${data.validUntil}T23:59:59.000Z`) : null,
          note: data.note,
        },
        { id: session.user.id, name: session.user.name },
        "staff",
      );
    },
  );

/** Withdraw a case: its figures stop counting, and stay on record. */
export const cancelPartnerCaseFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ caseId: z.string().min(1) }))
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const session = await requirePartnerStaff();
    if (!session) return { ok: false };
    const { cancelCase } = await import("@/server/partner-cases");
    return cancelCase(data.caseId, { id: session.user.id, name: session.user.name });
  });
