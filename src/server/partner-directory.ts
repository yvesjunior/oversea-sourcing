// Partners (Phase V · V21) — the rows.
//
// The directory staff keep: who the partners are, what slot each fills, how
// to reach them. Guards (session, permission) stay with the callers in
// `src/lib/partner-fns.ts`.

import { and, asc, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/database";
import * as schema from "@/database/schema";
import type { ContactLocale } from "@/database/schema";
import { partnerKindAvailable, type PartnerKind, type PartnerProvider } from "@/lib/partners";
import { logAudit } from "@/server/audit";

export type PartnerView = {
  id: string;
  name: string;
  kind: PartnerKind;
  provider: PartnerProvider;
  active: boolean;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  locale: ContactLocale;
  notes: string | null;
  createdAt: string;
  createdByName: string | null;
  /** Partner Hub (V23): the people at this partner who have an account. */
  accounts: Array<{ name: string; email: string }>;
  /** Addresses invited whose link has not been used yet (and not expired). */
  pendingInvitations: string[];
};

type Row = typeof schema.partner.$inferSelect;

function view(row: Row): Omit<PartnerView, "accounts" | "pendingInvitations"> {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    provider: row.provider,
    active: row.active,
    contactName: row.contactName,
    contactEmail: row.contactEmail,
    contactPhone: row.contactPhone,
    locale: row.locale,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    createdByName: row.createdByName,
  };
}

/** Every partner, by kind then name, with who can sign in for it. */
export async function listPartners(): Promise<PartnerView[]> {
  const rows = await db
    .select()
    .from(schema.partner)
    .orderBy(asc(schema.partner.kind), asc(schema.partner.name));
  const accounts = await db
    .select({
      partnerId: schema.partnerUser.partnerId,
      name: schema.user.name,
      email: schema.user.email,
    })
    .from(schema.partnerUser)
    .innerJoin(schema.user, eq(schema.user.id, schema.partnerUser.userId))
    .orderBy(asc(schema.user.name));
  const pending = await db
    .select({
      partnerId: schema.partnerInvitation.partnerId,
      email: schema.partnerInvitation.email,
    })
    .from(schema.partnerInvitation)
    .where(
      and(
        isNull(schema.partnerInvitation.registeredUserId),
        gt(schema.partnerInvitation.expiresAt, new Date()),
      ),
    );
  return rows.map((row) => ({
    ...view(row),
    accounts: accounts
      .filter((a) => a.partnerId === row.id)
      .map(({ name, email }) => ({ name, email })),
    // One line per address, however many times it was invited.
    pendingInvitations: [
      ...new Set(pending.filter((p) => p.partnerId === row.id).map((p) => p.email)),
    ],
  }));
}

export type PartnerFields = {
  name: string;
  kind: PartnerKind;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  locale: ContactLocale;
  notes: string | null;
};

export type PartnerWriteResult =
  | { ok: true; id: string }
  | {
      ok: false;
      reason:
        /** A kind the platform cannot use yet (`settlement`: legal opinion). */
        | "kind_unavailable"
        /** Another partner of the same kind already has this name. */
        | "name_taken"
        | "not_found";
    };

type Actor = { id: string; name: string };

async function nameTaken(name: string, kind: PartnerKind, exceptId?: string): Promise<boolean> {
  const sameKind = await db
    .select({ id: schema.partner.id, name: schema.partner.name })
    .from(schema.partner)
    .where(eq(schema.partner.kind, kind));
  const wanted = name.trim().toLowerCase();
  return sameKind.some((p) => p.id !== exceptId && p.name.trim().toLowerCase() === wanted);
}

/** A new partner. Always behind the `manual` provider: there is no other. */
export async function createPartner(
  fields: PartnerFields,
  actor: Actor,
): Promise<PartnerWriteResult> {
  if (!partnerKindAvailable(fields.kind)) return { ok: false, reason: "kind_unavailable" };
  if (await nameTaken(fields.name, fields.kind)) return { ok: false, reason: "name_taken" };
  const id = crypto.randomUUID();
  await db.insert(schema.partner).values({
    id,
    ...fields,
    name: fields.name.trim(),
    provider: "manual",
    createdBy: actor.id,
    createdByName: actor.name,
  });
  await logAudit({
    actorId: actor.id,
    actorName: actor.name,
    action: "partner.created",
    target: fields.name.trim(),
    detail: { kind: fields.kind, provider: "manual" },
  });
  return { ok: true, id };
}

/**
 * Change a partner's name, contact or notes — or switch it on or off. The
 * KIND does not change: a transport partner that also inspects is two
 * partners, because a case is opened with a slot, not with a company.
 */
export async function updatePartner(
  id: string,
  fields: Omit<PartnerFields, "kind"> & { active: boolean },
  actor: Actor,
): Promise<PartnerWriteResult> {
  const [current] = await db.select().from(schema.partner).where(eq(schema.partner.id, id));
  if (!current) return { ok: false, reason: "not_found" };
  if (await nameTaken(fields.name, current.kind, id)) return { ok: false, reason: "name_taken" };
  await db
    .update(schema.partner)
    .set({ ...fields, name: fields.name.trim(), updatedAt: new Date() })
    .where(eq(schema.partner.id, id));
  await logAudit({
    actorId: actor.id,
    actorName: actor.name,
    action: "partner.updated",
    target: fields.name.trim(),
    detail: {
      kind: current.kind,
      ...(current.active !== fields.active ? { active: fields.active } : {}),
      ...(current.name !== fields.name.trim() ? { was: current.name } : {}),
    },
  });
  return { ok: true, id };
}
