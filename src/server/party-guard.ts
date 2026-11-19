// The guards of the EXTERNAL accounts (Phase V · V03).
//
// A supplier's or a partner's person is not a workspace member. Everything
// else in the product asks "which workspace is this session in?"; these
// sessions answer "none", and `auth.api.getSession` therefore refuses them
// outright (src/server/auth.ts). The functions written FOR them come through
// here instead.
//
// What a guard here returns is the caller's whole authority. For a supplier:
// the ids of the suppliers they answer for (`supplier_user`). Every portal
// query must be filtered by those ids — there is no workspace to fall back on,
// and no "staff" exception: staff act for suppliers through their own tools.

import { eq } from "drizzle-orm";
import { db } from "@/database";
import * as schema from "@/database/schema";
import { externalKind } from "@/lib/account-types";
import { getAnySession } from "@/server/auth";

export type SupplierSession = {
  userId: string;
  userName: string;
  email: string;
  /** Preferred language of the account ("fr" | "en"). */
  locale: string;
  /** The suppliers this account answers for. Never empty: an account linked
   *  to no supplier has no session here at all. */
  supplierIds: string[];
};

/**
 * The supplier account behind this request, or null.
 *
 * Null — never a throw, never an empty `supplierIds` — for anyone who is not
 * a supplier account linked to at least one supplier: an anonymous caller, a
 * buyer, a staff member, a partner, and a supplier account whose link was
 * removed. Callers refuse on null; a guard that returned "a supplier with no
 * suppliers" would invite a query filtered by an empty list, and an empty
 * `IN ()` is exactly the kind of filter that gets "optimised" into no filter.
 */
export async function requireSupplierSession(headers: Headers): Promise<SupplierSession | null> {
  const session = await getAnySession(headers);
  if (!session) return null;
  const account = session.user as { accountType?: string; locale?: string };
  if (externalKind(account.accountType) !== "supplier") return null;

  const links = await db
    .select({ supplierId: schema.supplierUser.supplierId })
    .from(schema.supplierUser)
    .where(eq(schema.supplierUser.userId, session.user.id));
  if (links.length === 0) return null;

  return {
    userId: session.user.id,
    userName: session.user.name,
    email: session.user.email,
    locale: account.locale ?? "fr",
    supplierIds: links.map((link) => link.supplierId),
  };
}

export type PartnerSession = { userId: string; userName: string; partnerIds: string[] };

/**
 * The partner account behind this request, or null.
 *
 * Always null today. The `partner` account type exists so that it is REFUSED
 * like a supplier everywhere a customer is expected; what a partner may read
 * arrives with the partners themselves (`partner_user`, V21). Until then a
 * partner account has no authority anywhere — which this function states by
 * granting none, rather than by not existing.
 */
export async function requirePartnerSession(headers: Headers): Promise<PartnerSession | null> {
  const session = await getAnySession(headers);
  if (!session) return null;
  const account = session.user as { accountType?: string };
  if (externalKind(account.accountType) !== "partner") return null;
  return null;
}
