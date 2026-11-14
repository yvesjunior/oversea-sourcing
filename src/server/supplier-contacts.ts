// Supplier contacts — reads and writes (Phase V · V02, 2026-11-14).
//
// The pure rules (what an address is, which researched ones are kept) live in
// src/lib/supplier-contact.ts. This file owns the table and ONE invariant:
//
//   a supplier with any contact has exactly one PRIMARY contact.
//
// "At most one" is the database's job (`supplier_contact_one_primary_uq`).
// "At least one" is `ensurePrimary` below, called after every add and every
// remove — because the RFQ batch (V06) sends to the primary, and a supplier
// that has addresses but no primary would be silently unreachable.

import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/database";
import * as schema from "@/database/schema";
import type { ContactLocale, SupplierContactSource } from "@/database/schema";
import { normalizeEmail } from "@/lib/supplier-contact";

export type SupplierContactRow = typeof schema.supplierContact.$inferSelect;

/** Postgres unique_violation, however drizzle wraps it. */
function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: string; cause?: { code?: string } } | null) ?? null;
  return code?.code === "23505" || code?.cause?.code === "23505";
}

/** Primary first, then oldest — the order every list shows them in. */
export async function listContacts(supplierId: string): Promise<SupplierContactRow[]> {
  return await db.query.supplierContact.findMany({
    where: eq(schema.supplierContact.supplierId, supplierId),
    orderBy: [
      sql`${schema.supplierContact.isPrimary} desc`,
      asc(schema.supplierContact.createdAt),
      asc(schema.supplierContact.id),
    ],
  });
}

/**
 * Give the supplier a primary contact if it has contacts and none is primary.
 *
 * Promotes the OLDEST: deterministic, so two callers racing pick the same
 * row and the second update is a no-op. Should they ever pick differently,
 * the partial unique index refuses the second — which is the outcome wanted,
 * so that refusal is swallowed rather than surfaced.
 */
async function ensurePrimary(supplierId: string): Promise<void> {
  try {
    await db.execute(sql`
      update supplier_contact set is_primary = true, updated_at = now()
      where id = (
        select id from supplier_contact
        where supplier_id = ${supplierId}
        order by created_at asc, id asc
        limit 1
      )
      and not exists (
        select 1 from supplier_contact where supplier_id = ${supplierId} and is_primary
      )
    `);
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
  }
}

export type AddContactInput = {
  supplierId: string;
  email: string;
  name?: string | null;
  role?: string | null;
  phone?: string | null;
  locale?: ContactLocale;
  source: SupplierContactSource;
  /** Null for a research-sourced row — no person entered it. */
  actor: { id: string; name: string } | null;
};

/** Add one address. The first contact a supplier gets becomes its primary. */
export async function addContact(
  input: AddContactInput,
): Promise<{ ok: true; id: string } | { ok: false; reason: "duplicate" }> {
  const id = crypto.randomUUID();
  const inserted = await db
    .insert(schema.supplierContact)
    .values({
      id,
      supplierId: input.supplierId,
      email: normalizeEmail(input.email),
      name: input.name?.trim() || null,
      role: input.role?.trim() || null,
      phone: input.phone?.trim() || null,
      locale: input.locale ?? "en",
      source: input.source,
      createdBy: input.actor?.id ?? null,
      createdByName: input.actor?.name ?? null,
    })
    .onConflictDoNothing({
      target: [schema.supplierContact.supplierId, schema.supplierContact.email],
    })
    .returning({ id: schema.supplierContact.id });
  if (inserted.length === 0) return { ok: false, reason: "duplicate" };
  await ensurePrimary(input.supplierId);
  return { ok: true, id };
}

/** Make this contact the one RFQs go to. */
export async function setPrimaryContact(id: string): Promise<SupplierContactRow | null> {
  return await db.transaction(async (tx) => {
    const contact = await tx.query.supplierContact.findFirst({
      where: eq(schema.supplierContact.id, id),
    });
    if (!contact) return null;
    if (contact.isPrimary) return contact;
    // Demote first: the unique index is not deferrable, so two primaries may
    // not coexist even for the length of one transaction.
    await tx
      .update(schema.supplierContact)
      .set({ isPrimary: false, updatedAt: new Date() })
      .where(
        and(
          eq(schema.supplierContact.supplierId, contact.supplierId),
          eq(schema.supplierContact.isPrimary, true),
        ),
      );
    const promoted = await tx
      .update(schema.supplierContact)
      .set({ isPrimary: true, updatedAt: new Date() })
      .where(eq(schema.supplierContact.id, id))
      .returning();
    return promoted[0] ?? null;
  });
}

/** Remove a contact. If it was the primary, the oldest one left takes over. */
export async function removeContact(id: string): Promise<SupplierContactRow | null> {
  const removed = await db
    .delete(schema.supplierContact)
    .where(eq(schema.supplierContact.id, id))
    .returning();
  const contact = removed[0];
  if (!contact) return null;
  await ensurePrimary(contact.supplierId);
  return contact;
}

/**
 * Turn the addresses the research found into contacts, for suppliers that
 * have just been promoted or re-encountered.
 *
 * Called by the matcher AFTER promotion, because that is the first moment a
 * supplier row exists to hang a contact from: the store holds records, and a
 * record becomes a supplier only when it ranks Top-N. The address was already
 * gated when the record was stored (`acceptResearchedEmail`), so nothing is
 * re-checked here.
 *
 * Never overwrites: an address already on file for that supplier — whoever
 * entered it — is left exactly as it is, and a research address never takes
 * the primary slot from a contact a person chose.
 */
export async function syncResearchedContacts(supplierIds: readonly string[]): Promise<number> {
  const ids = [...new Set(supplierIds)];
  if (ids.length === 0) return 0;
  const found = await db
    .selectDistinct({
      supplierId: schema.sourceRecord.supplierId,
      email: schema.sourceRecord.contactEmail,
    })
    .from(schema.sourceRecord)
    .where(
      and(
        inArray(schema.sourceRecord.supplierId, ids),
        isNotNull(schema.sourceRecord.contactEmail),
        eq(schema.sourceRecord.status, "active"),
      ),
    );
  let added = 0;
  for (const row of found) {
    if (!row.supplierId || !row.email) continue;
    const result = await addContact({
      supplierId: row.supplierId,
      email: row.email,
      source: "research",
      actor: null,
    });
    if (result.ok) added += 1;
  }
  return added;
}

/** How many contacts each supplier has — the directory's count column. */
export async function contactCounts(): Promise<Map<string, number>> {
  const rows = await db
    .select({ supplierId: schema.supplierContact.supplierId, n: sql<number>`count(*)::int` })
    .from(schema.supplierContact)
    .groupBy(schema.supplierContact.supplierId);
  return new Map(rows.map((row) => [row.supplierId, row.n]));
}

export type PrimaryContact = { email: string; name: string | null; locale: ContactLocale };

/** The address an RFQ goes to, per supplier. A supplier absent from the map
 *  has no contact at all and cannot be written to from the platform. */
export async function primaryContactsFor(
  supplierIds: readonly string[],
): Promise<Map<string, PrimaryContact>> {
  const ids = [...new Set(supplierIds)];
  if (ids.length === 0) return new Map();
  const rows = await db.query.supplierContact.findMany({
    where: and(
      inArray(schema.supplierContact.supplierId, ids),
      eq(schema.supplierContact.isPrimary, true),
    ),
  });
  return new Map(
    rows.map((row) => [row.supplierId, { email: row.email, name: row.name, locale: row.locale }]),
  );
}
