// The RFQ invitation link (Phase V · V15) — the rows and the token.
//
// An RFQ email carries a link. Whoever opens it controls a mailbox OSI holds
// for that supplier, and that is what vouches for the account it creates: no
// approval step, no queue (owner, 2026-10-25). It is also the only door —
// there is no supplier signup form, and `createExternalAccount` is called
// from here and nowhere else (`external-access.test.ts`).
//
// The pure rules are `src/lib/portal-invitation.ts`.

import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/database";
import * as schema from "@/database/schema";
import {
  invitationExpiry,
  invitationOffer,
  invitationState,
  type InvitationOffer,
  type InvitationState,
} from "@/lib/portal-invitation";
import { logAudit } from "@/server/audit";
import { createExternalAccount } from "@/server/auth";
import type { Executor } from "@/server/requests";

/** What is stored. The token itself exists in the email and nowhere else. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Make an invitation for one RFQ email and return its token — once. The
 * caller puts it in the email it is about to send; it cannot be read back.
 * The id is for `withdrawInvitation`, should that email fail to leave.
 */
export async function issueInvitation(
  input: { quoteId: string; contactId: string | null; email: string; sentAt: Date },
  executor: Executor = db,
): Promise<{ id: string; token: string }> {
  // 32 random bytes: nobody guesses one, which is why opening the link needs
  // no password and no account.
  const token = randomBytes(32).toString("base64url");
  const id = crypto.randomUUID();
  await executor.insert(schema.rfqInvitation).values({
    id,
    quoteId: input.quoteId,
    contactId: input.contactId,
    email: input.email.trim().toLowerCase(),
    tokenHash: hashToken(token),
    expiresAt: invitationExpiry(input.sentAt),
  });
  return { id, token };
}

/** Take back an invitation whose email never left: an invitation counted as
 *  "invited" in the funnel must be one somebody could have received. */
export async function withdrawInvitation(id: string): Promise<void> {
  await db.delete(schema.rfqInvitation).where(eq(schema.rfqInvitation.id, id));
}

export type InvitationView = {
  state: InvitationState;
  /** Set when `state` is `valid`. */
  offer: InvitationOffer | null;
  /** The supplier the link was sent to — shown so the reader knows what they
   *  are creating an account FOR. Null unless valid or used. */
  supplierName: string | null;
  /** The address the link was sent to; the account gets exactly this one. */
  email: string | null;
  /** The contact's name as OSI holds it, to prefill the form. */
  contactName: string | null;
  locale: "fr" | "en";
};

const NOTHING: InvitationView = {
  state: "unknown",
  offer: null,
  supplierName: null,
  email: null,
  contactName: null,
  locale: "fr",
};

async function find(token: string, executor: Executor = db) {
  const [row] = await executor
    .select({
      invitation: schema.rfqInvitation,
      supplierId: schema.quote.supplierId,
      supplierName: schema.quote.supplierName,
    })
    .from(schema.rfqInvitation)
    .innerJoin(schema.quote, eq(schema.quote.id, schema.rfqInvitation.quoteId))
    .where(eq(schema.rfqInvitation.tokenHash, hashToken(token)));
  return row ?? null;
}

/**
 * What the registration page shows for this token. Tells an unknown token
 * and an expired one apart only by `state`; neither gets a supplier name or
 * an address — a wrong link must not confirm that a supplier exists.
 */
export async function viewInvitation(token: string): Promise<InvitationView> {
  const found = await find(token);
  const state = invitationState(found?.invitation ?? null, new Date());
  if (!found || state === "unknown" || state === "expired") return { ...NOTHING, state };

  const { invitation } = found;
  // The first step of the funnel (V17). Written once.
  if (!invitation.openedAt) {
    await db
      .update(schema.rfqInvitation)
      .set({ openedAt: new Date() })
      .where(
        and(eq(schema.rfqInvitation.id, invitation.id), isNull(schema.rfqInvitation.openedAt)),
      );
  }

  const contact = invitation.contactId
    ? await db.query.supplierContact.findFirst({
        where: eq(schema.supplierContact.id, invitation.contactId),
        columns: { name: true, locale: true },
      })
    : null;
  const holder = await db.query.user.findFirst({
    where: eq(schema.user.email, invitation.email),
    columns: { accountType: true },
  });

  return {
    state,
    offer: state === "valid" ? invitationOffer(holder ? holder.accountType : null) : null,
    supplierName: found.supplierName,
    email: invitation.email,
    contactName: contact?.name ?? null,
    locale: contact?.locale === "en" ? "en" : "fr",
  };
}

export type RedeemResult =
  /** `created` = a new account, sign in with the password just chosen;
   *  `attached` = an existing supplier account now also answers for this
   *  supplier, sign in as usual. */
  | { ok: true; outcome: "created" | "attached"; email: string }
  | {
      ok: false;
      reason:
        | "unknown"
        | "expired"
        | "used"
        /** The address belongs to a customer account (see `invitationOffer`). */
        | "conflict"
        /** The RFQ names no supplier record to answer for. */
        | "no_supplier"
        | "weak_password"
        | "name_required";
    };

/**
 * Turn an invitation into access: a new supplier account, or an existing one
 * attached to this supplier.
 *
 * The invitation row is locked for the duration, so two submissions of the
 * same link make one account.
 */
export async function redeemInvitation(input: {
  token: string;
  name: string;
  password: string;
}): Promise<RedeemResult> {
  return db.transaction(async (tx): Promise<RedeemResult> => {
    const hash = hashToken(input.token);
    const [invitation] = await tx
      .select()
      .from(schema.rfqInvitation)
      .where(eq(schema.rfqInvitation.tokenHash, hash))
      .for("update");
    const state = invitationState(invitation ?? null, new Date());
    if (!invitation || state !== "valid") {
      return { ok: false, reason: state === "valid" ? "unknown" : state };
    }

    const [quote] = await tx
      .select({ supplierId: schema.quote.supplierId, supplierName: schema.quote.supplierName })
      .from(schema.quote)
      .where(eq(schema.quote.id, invitation.quoteId));
    if (!quote?.supplierId) return { ok: false, reason: "no_supplier" };

    const [holder] = await tx
      .select({ id: schema.user.id, accountType: schema.user.accountType, name: schema.user.name })
      .from(schema.user)
      .where(eq(schema.user.email, invitation.email));
    const offer = invitationOffer(holder ? holder.accountType : null);
    if (offer === "conflict") return { ok: false, reason: "conflict" };

    let userId: string;
    let userName: string;
    if (offer === "attach") {
      // Same address, already a supplier account: reaching this link proves
      // the same mailbox the account was made from. No second account.
      userId = holder!.id;
      userName = holder!.name;
    } else {
      const name = input.name.trim();
      if (name.length < 2) return { ok: false, reason: "name_required" };
      const contact = invitation.contactId
        ? await tx.query.supplierContact.findFirst({
            where: eq(schema.supplierContact.id, invitation.contactId),
            columns: { locale: true },
          })
        : null;
      const created = await createExternalAccount({
        email: invitation.email,
        name,
        password: input.password,
        accountType: "supplier",
        locale: contact?.locale === "en" ? "en" : "fr",
      });
      if (!created.ok) {
        // `email_taken` cannot happen under the lock unless a customer signed
        // up with this address in the same instant — which is the conflict.
        return {
          ok: false,
          reason: created.reason === "weak_password" ? "weak_password" : "conflict",
        };
      }
      userId = created.userId;
      userName = name;
    }

    await tx
      .insert(schema.supplierUser)
      .values({ id: crypto.randomUUID(), userId, supplierId: quote.supplierId })
      .onConflictDoNothing();
    await tx
      .update(schema.rfqInvitation)
      .set({ registeredUserId: userId, registeredAt: new Date() })
      .where(eq(schema.rfqInvitation.id, invitation.id));

    await logAudit({
      actorId: userId,
      actorName: userName,
      action: offer === "attach" ? "supplier.account_attached" : "supplier.account_created",
      target: quote.supplierName,
      detail: { supplierId: quote.supplierId, quoteId: invitation.quoteId },
    });
    return {
      ok: true,
      outcome: offer === "attach" ? "attached" : "created",
      email: invitation.email,
    };
  });
}
