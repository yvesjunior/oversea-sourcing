// Partners (Phase V · V21) — staff's server functions.
//
// Staff holding `partners`, standing in the internal workspace. A partner's
// own people never come through here: theirs is the Partner Hub (V23), behind
// `requirePartnerSession`.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { CONTACT_LOCALES } from "@/database/schema";
import { PARTNER_KINDS } from "@/lib/partners";
import type { PartnerView, PartnerWriteResult } from "@/server/partner-directory";

export type { PartnerView, PartnerWriteResult };

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
