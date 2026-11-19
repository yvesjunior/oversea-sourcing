// The Partner Hub invitation (Phase V · V23) — the rows, the token, the mail.
//
// The supplier's RFQ link (V15) reused for a partner's person, with one
// difference in what vouches: a staff member sends this one, on purpose, to
// someone at a partner they keep on file. A partner works on many dossiers
// and is invited once; the cases come afterwards.
//
// Same guarantees as V15: only the token's hash is stored; a link that does
// not work confirms nothing; an account's type never changes, so an address
// already held by a customer or a supplier account is a conflict; the row is
// locked while it is redeemed. `createExternalAccount` is called from here
// with `partner` and from `portal-invitations.ts` with `supplier`, and from
// nowhere else (`external-access.test.ts`).

import { randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/database";
import * as schema from "@/database/schema";
import { buildPartnerInvitationMail } from "@/lib/partner-mail";
import {
  invitationExpiry,
  invitationOffer,
  invitationState,
  partnerRegistrationPath,
  type InvitationOffer,
  type InvitationState,
} from "@/lib/portal-invitation";
import { logAudit } from "@/server/audit";
import { createExternalAccount } from "@/server/auth";
import { sendMail } from "@/server/mail";
import { hashToken } from "@/server/portal-invitations";

type Actor = { id: string; name: string };

export type InvitePartnerResult =
  | { ok: true; email: string }
  | {
      ok: false;
      reason:
        | "partner_not_found"
        /** Switched off: no new access to a partner no longer used. */
        | "partner_inactive"
        /** The address belongs to a customer or a supplier account. */
        | "conflict"
        /** Already an account of this partner: nothing to send. */
        | "already_member"
        | "mail_failed";
    };

/**
 * Open the Partner Hub to one person at a partner: make the invitation and
 * send its link. The token leaves in the email and is never stored.
 */
export async function invitePartnerUser(
  input: { partnerId: string; email: string },
  actor: Actor,
): Promise<InvitePartnerResult> {
  const email = input.email.trim().toLowerCase();
  const partner = await db.query.partner.findFirst({
    where: eq(schema.partner.id, input.partnerId),
  });
  if (!partner) return { ok: false, reason: "partner_not_found" };
  if (!partner.active) return { ok: false, reason: "partner_inactive" };

  const holder = await db.query.user.findFirst({
    where: eq(schema.user.email, email),
    columns: { id: true, accountType: true },
  });
  if (invitationOffer(holder ? holder.accountType : null, "partner") === "conflict") {
    return { ok: false, reason: "conflict" };
  }
  if (holder) {
    const member = await db.query.partnerUser.findFirst({
      where: and(
        eq(schema.partnerUser.userId, holder.id),
        eq(schema.partnerUser.partnerId, partner.id),
      ),
      columns: { id: true },
    });
    if (member) return { ok: false, reason: "already_member" };
  }

  const token = randomBytes(32).toString("base64url");
  const id = crypto.randomUUID();
  const sentAt = new Date();
  await db.insert(schema.partnerInvitation).values({
    id,
    partnerId: partner.id,
    email,
    tokenHash: hashToken(token),
    expiresAt: invitationExpiry(sentAt),
    invitedBy: actor.id,
    invitedByName: actor.name,
  });

  const base = process.env["BETTER_AUTH_URL"] ?? "http://localhost:3010";
  const mail = buildPartnerInvitationMail({
    locale: partner.locale,
    partnerName: partner.name,
    // The contact's name only when the invitation goes to the contact: an
    // email to someone else must not greet them by another person's name.
    greetingName: partner.contactEmail === email ? partner.contactName : null,
    url: `${base}${partnerRegistrationPath(token)}`,
  });
  let delivered = false;
  try {
    const result = await sendMail({
      to: email,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    });
    delivered = result.ok || result.queued === true;
  } catch (error) {
    console.error(`partner: invitation to ${partner.name} failed —`, error);
  }
  if (!delivered) {
    // An invitation nobody could have received is not one.
    await db.delete(schema.partnerInvitation).where(eq(schema.partnerInvitation.id, id));
    return { ok: false, reason: "mail_failed" };
  }

  await logAudit({
    actorId: actor.id,
    actorName: actor.name,
    action: "partner.user_invited",
    target: partner.name,
    detail: { partnerId: partner.id, email },
  });
  return { ok: true, email };
}

export type PartnerInvitationView = {
  state: InvitationState;
  offer: InvitationOffer | null;
  /** The partner the link opens — null unless the link is valid or used. */
  partnerName: string | null;
  email: string | null;
  /** The contact's name as OSI holds it, when the link went to the contact. */
  contactName: string | null;
  locale: "fr" | "en";
};

const NOTHING: PartnerInvitationView = {
  state: "unknown",
  offer: null,
  partnerName: null,
  email: null,
  contactName: null,
  locale: "fr",
};

/**
 * What the registration page shows for this token. An unknown or expired
 * link gets no partner name and no address.
 */
export async function viewPartnerInvitation(token: string): Promise<PartnerInvitationView> {
  const [found] = await db
    .select({ invitation: schema.partnerInvitation, partner: schema.partner })
    .from(schema.partnerInvitation)
    .innerJoin(schema.partner, eq(schema.partner.id, schema.partnerInvitation.partnerId))
    .where(eq(schema.partnerInvitation.tokenHash, hashToken(token)));
  const state = invitationState(found?.invitation ?? null, new Date());
  if (!found || state === "unknown" || state === "expired") return { ...NOTHING, state };

  const { invitation, partner } = found;
  if (!invitation.openedAt) {
    await db
      .update(schema.partnerInvitation)
      .set({ openedAt: new Date() })
      .where(
        and(
          eq(schema.partnerInvitation.id, invitation.id),
          isNull(schema.partnerInvitation.openedAt),
        ),
      );
  }
  const holder = await db.query.user.findFirst({
    where: eq(schema.user.email, invitation.email),
    columns: { accountType: true },
  });
  return {
    state,
    offer:
      state === "valid" ? invitationOffer(holder ? holder.accountType : null, "partner") : null,
    partnerName: partner.name,
    email: invitation.email,
    contactName: partner.contactEmail === invitation.email ? partner.contactName : null,
    locale: partner.locale === "en" ? "en" : "fr",
  };
}

export type RedeemPartnerResult =
  | { ok: true; outcome: "created" | "attached"; email: string }
  | {
      ok: false;
      reason: "unknown" | "expired" | "used" | "conflict" | "weak_password" | "name_required";
    };

/**
 * Turn an invitation into access: a new partner account, or an existing
 * partner account that now also answers for this partner.
 */
export async function redeemPartnerInvitation(input: {
  token: string;
  name: string;
  password: string;
}): Promise<RedeemPartnerResult> {
  return db.transaction(async (tx): Promise<RedeemPartnerResult> => {
    const [invitation] = await tx
      .select()
      .from(schema.partnerInvitation)
      .where(eq(schema.partnerInvitation.tokenHash, hashToken(input.token)))
      .for("update");
    const state = invitationState(invitation ?? null, new Date());
    if (!invitation || state !== "valid") {
      return { ok: false, reason: state === "valid" ? "unknown" : state };
    }
    const [partner] = await tx
      .select({ id: schema.partner.id, name: schema.partner.name, locale: schema.partner.locale })
      .from(schema.partner)
      .where(eq(schema.partner.id, invitation.partnerId));
    if (!partner) return { ok: false, reason: "unknown" };

    const [holder] = await tx
      .select({ id: schema.user.id, accountType: schema.user.accountType, name: schema.user.name })
      .from(schema.user)
      .where(eq(schema.user.email, invitation.email));
    const offer = invitationOffer(holder ? holder.accountType : null, "partner");
    if (offer === "conflict") return { ok: false, reason: "conflict" };

    let userId: string;
    let userName: string;
    if (offer === "attach") {
      userId = holder!.id;
      userName = holder!.name;
    } else {
      const name = input.name.trim();
      if (name.length < 2) return { ok: false, reason: "name_required" };
      const created = await createExternalAccount({
        email: invitation.email,
        name,
        password: input.password,
        accountType: "partner",
        locale: partner.locale === "en" ? "en" : "fr",
      });
      if (!created.ok) {
        return {
          ok: false,
          reason: created.reason === "weak_password" ? "weak_password" : "conflict",
        };
      }
      userId = created.userId;
      userName = name;
    }

    await tx
      .insert(schema.partnerUser)
      .values({ id: crypto.randomUUID(), userId, partnerId: partner.id })
      .onConflictDoNothing();
    await tx
      .update(schema.partnerInvitation)
      .set({ registeredUserId: userId, registeredAt: new Date() })
      .where(eq(schema.partnerInvitation.id, invitation.id));

    await logAudit({
      actorId: userId,
      actorName: userName,
      action: offer === "attach" ? "partner.account_attached" : "partner.account_created",
      target: partner.name,
      detail: { partnerId: partner.id },
    });
    return {
      ok: true,
      outcome: offer === "attach" ? "attached" : "created",
      email: invitation.email,
    };
  });
}
