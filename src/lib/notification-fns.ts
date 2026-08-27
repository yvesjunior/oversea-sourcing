// Notification server fns (E9, 2026-08-23) — the bell's data. Strictly the
// caller's own rows; no workspace scoping needed because recipient IS the
// scope.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { isKnownNotificationType, type NotificationPrefs } from "@/lib/notification-types";

export type NotificationView = {
  id: string;
  type: string;
  params: Record<string, string | number>;
  link: string | null;
  read: boolean;
  createdAt: string;
};

export type NotificationsData = { items: NotificationView[]; unread: number };

async function requireSession() {
  const [{ auth }, { getRequest }] = await Promise.all([
    import("@/server/auth"),
    import("@tanstack/react-start/server"),
  ]);
  return auth.api.getSession({ headers: getRequest().headers });
}

export const getNotificationsFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<NotificationsData> => {
    const session = await requireSession();
    if (!session) return { items: [], unread: 0 };

    const [{ db }, { and, count, desc, eq, isNull }, schema] = await Promise.all([
      import("@/database"),
      import("drizzle-orm"),
      import("@/database/schema"),
    ]);

    const [rows, unreadRow] = await Promise.all([
      db.query.notification.findMany({
        where: eq(schema.notification.userId, session.user.id),
        orderBy: [desc(schema.notification.createdAt)],
        limit: 20,
      }),
      db
        .select({ value: count() })
        .from(schema.notification)
        .where(
          and(eq(schema.notification.userId, session.user.id), isNull(schema.notification.readAt)),
        ),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        type: row.type,
        params: row.params ?? {},
        link: row.link,
        read: row.readAt !== null,
        createdAt: row.createdAt.toISOString(),
      })),
      unread: unreadRow[0]?.value ?? 0,
    };
  },
);

/** Mark one (id) or all (no id) of the caller's notifications read. */
export const markNotificationsReadFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string().optional() }))
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const session = await requireSession();
    if (!session) return { ok: false };

    const [{ db }, { and, eq, isNull }, schema] = await Promise.all([
      import("@/database"),
      import("drizzle-orm"),
      import("@/database/schema"),
    ]);
    await db
      .update(schema.notification)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(schema.notification.userId, session.user.id),
          isNull(schema.notification.readAt),
          ...(data.id ? [eq(schema.notification.id, data.id)] : []),
        ),
      );
    return { ok: true };
  });

/** The caller's notification preferences (E11) — `{[type]: {inApp?, email?}}`,
 *  missing = ON. Gates ONLY notify.ts emissions (never transactional mail). */
export const getNotificationPrefsFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<NotificationPrefs> => {
    const session = await requireSession();
    if (!session) return {};

    const [{ db }, { eq }, schema] = await Promise.all([
      import("@/database"),
      import("drizzle-orm"),
      import("@/database/schema"),
    ]);
    const row = await db.query.notificationPref.findFirst({
      where: eq(schema.notificationPref.userId, session.user.id),
    });
    return row?.prefs ?? {};
  },
);

export const updateNotificationPrefsFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      prefs: z.record(
        // Only registered types are storable — a typo'd key would silently
        // gate nothing forever.
        z.string().refine(isKnownNotificationType),
        z.object({ inApp: z.boolean().optional(), email: z.boolean().optional() }),
      ),
    }),
  )
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const session = await requireSession();
    if (!session) return { ok: false };

    const [{ db }, schema] = await Promise.all([import("@/database"), import("@/database/schema")]);
    // Strip undefined flags (exactOptionalPropertyTypes) — stored JSON only
    // carries explicit booleans; missing means ON.
    const prefs: Record<string, { inApp?: boolean; email?: boolean }> = {};
    for (const [type, flags] of Object.entries(data.prefs)) {
      prefs[type] = {
        ...(flags.inApp !== undefined ? { inApp: flags.inApp } : {}),
        ...(flags.email !== undefined ? { email: flags.email } : {}),
      };
    }
    await db
      .insert(schema.notificationPref)
      .values({
        id: crypto.randomUUID(),
        userId: session.user.id,
        prefs,
      })
      .onConflictDoUpdate({
        target: schema.notificationPref.userId,
        set: { prefs, updatedAt: new Date() },
      });
    return { ok: true };
  });
