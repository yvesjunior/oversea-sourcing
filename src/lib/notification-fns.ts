// Notification server fns (E9, 2026-08-23) — the bell's data. Strictly the
// caller's own rows; no workspace scoping needed because recipient IS the
// scope.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

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
