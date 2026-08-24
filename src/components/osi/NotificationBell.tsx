// The bell, made real (E9, 2026-08-23). The gold dot only shows when there
// are unread rows; opening the dropdown lists the latest 20, clicking one
// marks it read and navigates its link. Fetch on mount + on open — no
// realtime machinery until the product needs it.

import { useEffect, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { Bell } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  getNotificationsFn,
  markNotificationsReadFn,
  type NotificationsData,
  type NotificationView,
} from "@/lib/notification-fns";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function NotificationBell() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const [data, setData] = useState<NotificationsData>({ items: [], unread: 0 });

  const load = () => void getNotificationsFn().then(setData);
  useEffect(load, []);

  const open = (notification: NotificationView) => {
    void markNotificationsReadFn({ data: { id: notification.id } }).then(load);
    if (notification.link) void router.navigate({ to: notification.link });
  };

  const markAll = () => void markNotificationsReadFn({ data: {} }).then(load);

  const stamp = (iso: string) =>
    new Date(iso).toLocaleString(i18n.language, {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <DropdownMenu onOpenChange={(isOpen) => isOpen && load()}>
      <DropdownMenuTrigger
        aria-label={t("topbar.notifications")}
        className="relative transition-colors hover:text-foreground"
      >
        <Bell className="size-[18px]" />
        {data.unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-gold" />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        {data.items.length === 0 ? (
          <p className="px-3 py-4 text-center text-sm text-muted-foreground">
            {t("notifications.empty")}
          </p>
        ) : (
          <>
            {data.items.map((notification) => (
              <DropdownMenuItem
                key={notification.id}
                onSelect={() => open(notification)}
                className="flex flex-col items-start gap-0.5 py-2"
              >
                <span className={notification.read ? "text-muted-foreground" : "font-medium"}>
                  {t(`notifications.${notification.type}`, {
                    ...notification.params,
                    defaultValue: notification.type,
                  })}
                </span>
                <span className="text-xs text-muted-foreground">
                  {stamp(notification.createdAt)}
                </span>
              </DropdownMenuItem>
            ))}
            {data.unread > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={markAll}
                  className="justify-center text-xs text-muted-foreground"
                >
                  {t("notifications.markAllRead")}
                </DropdownMenuItem>
              </>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
