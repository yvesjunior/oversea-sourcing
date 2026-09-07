// Notification emitter (E9, 2026-08-23) — the one door for telling a user
// something happened. Writes the in-app row and, when asked, sends the email
// through the mail adapter. Failure-tolerant on purpose: a notification that
// cannot be written or mailed must never break the action that caused it —
// the pipeline finishing matters more than the bell ringing.

import { eq } from "drizzle-orm";
import { db } from "@/database";
import * as schema from "@/database/schema";
import { channelEnabled } from "@/lib/notification-types";
import type { PermissionKey } from "@/lib/roles";

export type NotifyInput = {
  userId: string;
  organizationId?: string | null;
  /** i18n key suffix — the UI renders t(`notifications.${type}`, params). */
  type: string;
  params?: Record<string, string | number>;
  /** In-app destination when the notification is clicked. */
  link?: string;
  /** Also send an email (localized here, since emails cannot re-render). */
  email?: { subjectFr: string; subjectEn: string; bodyFr: string; bodyEn: string };
};

export async function notifyUser(input: NotifyInput): Promise<void> {
  try {
    // E11 preferences gate BOTH channels — but only here: transactional auth
    // mail (mail.ts callers) is never silenceable. Missing row/flag = ON,
    // and a prefs read failure must not mute anything (fail-open).
    let prefs: Record<string, { inApp?: boolean; email?: boolean }> | null = null;
    try {
      const row = await db.query.notificationPref.findFirst({
        where: eq(schema.notificationPref.userId, input.userId),
      });
      prefs = row?.prefs ?? null;
    } catch (error) {
      console.error(`notify: prefs read failed for ${input.userId} — defaulting to ON`, error);
    }

    if (channelEnabled(prefs, input.type, "inApp")) {
      await db.insert(schema.notification).values({
        id: crypto.randomUUID(),
        userId: input.userId,
        organizationId: input.organizationId ?? null,
        type: input.type,
        params: input.params ?? null,
        link: input.link ?? null,
      });
    }

    if (input.email && channelEnabled(prefs, input.type, "email")) {
      const user = await db.query.user.findFirst({ where: eq(schema.user.id, input.userId) });
      if (user) {
        const fr = user.locale !== "en";
        const subject = fr ? input.email.subjectFr : input.email.subjectEn;
        const body = fr ? input.email.bodyFr : input.email.bodyEn;
        const { sendMail } = await import("@/server/mail");
        await sendMail({
          to: user.email,
          subject,
          text: body,
          html: `<p>${body.replaceAll("\n", "</p><p>")}</p>`,
        });
      }
    }
  } catch (error) {
    console.error(`notify: failed for user ${input.userId} (${input.type}) —`, error);
  }
}

/**
 * Tell every STAFF member who can act on it (E9, 2026-09-07).
 *
 * `notifyUser` addresses one known person; this addresses a job. A buyer
 * asking OSI to solicit suppliers has no single owner on our side, so the
 * alert goes to whoever holds the permission that lets them act — not to
 * "all staff". Notifying an accountant who cannot record a quote only teaches
 * them to ignore the mail.
 *
 * Note it resolves the RAW `user.platform_role`, not `effectivePlatformRole`.
 * That guard answers "may this session use staff powers right now", which
 * depends on the workspace the person happens to be standing in — the wrong
 * question here. A manager reading mail on their phone is still the manager
 * who should hear about this. Membership of the internal workspace plus the
 * permission is the honest test.
 *
 * The in-app row matters as much as the email: it is the durable record a
 * future mobile app reads to ring. Email is what reaches someone today.
 */
export async function notifyStaff(
  permission: PermissionKey,
  input: Omit<NotifyInput, "userId" | "organizationId"> & {
    /** Skip this user — the person who caused the event does not need to be
     *  told about it. Staff acting as a buyer in their own workspace can
     *  legitimately trigger a staff alert. */
    exceptUserId?: string | null;
  },
): Promise<void> {
  try {
    const internal = await db.query.organization.findFirst({
      where: eq(schema.organization.type, "internal"),
      columns: { id: true },
    });
    if (!internal) return;

    const members = await db
      .select({ userId: schema.member.userId, platformRole: schema.user.platformRole })
      .from(schema.member)
      .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
      .where(eq(schema.member.organizationId, internal.id));

    const { roleHasPermission } = await import("@/server/permissions");
    const { exceptUserId, ...notification } = input;
    for (const member of members) {
      if (member.userId === exceptUserId) continue;
      if (!(await roleHasPermission(member.platformRole ?? "user", permission))) continue;
      await notifyUser({
        ...notification,
        userId: member.userId,
        // The internal workspace is where this work lives — the LINK points at
        // the customer's request, but the notification belongs to OSI's side.
        organizationId: internal.id,
      });
    }
  } catch (error) {
    // Same contract as notifyUser: the bell must never break the action.
    console.error(`notifyStaff: failed for ${permission} (${input.type}) —`, error);
  }
}
