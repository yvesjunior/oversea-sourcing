// Notification emitter (E9, 2026-08-23) — the one door for telling a user
// something happened. Writes the in-app row and, when asked, sends the email
// through the mail adapter. Failure-tolerant on purpose: a notification that
// cannot be written or mailed must never break the action that caused it —
// the pipeline finishing matters more than the bell ringing.

import { db } from "@/database";
import * as schema from "@/database/schema";

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
    await db.insert(schema.notification).values({
      id: crypto.randomUUID(),
      userId: input.userId,
      organizationId: input.organizationId ?? null,
      type: input.type,
      params: input.params ?? null,
      link: input.link ?? null,
    });

    if (input.email) {
      const { eq } = await import("drizzle-orm");
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
