// The bell, made real (E9, 2026-08-23), and made to ALERT (owner, 2026-09-14:
// "notification should add icon with pin to alert the user on the platform…
// a ringtone to alert").
//
// Three things it does that it did not before:
//
//   1. A pinned COUNT on the icon instead of a dot, and the same count as a
//      prefix on the tab title — a backgrounded tab still shows it.
//   2. It POLLS the unread count every 30 s while the tab is visible, and
//      refetches the moment the tab comes back to the foreground. Until now
//      it loaded once on mount, so a buyer learnt of a notification only by
//      reloading; email was the only channel that reached anyone. The poll
//      is count-only (`getUnreadCountFn`); the twenty rows still come down
//      only when the menu opens.
//   3. A short CHIME when the count goes UP between two polls — generated
//      with WebAudio, no asset to host, nothing the CSP has to allow. Two
//      limits are the browser's, not ours: nothing plays before the visitor
//      has interacted with the page once (autoplay policy — the first
//      notification after a cold load is silent), and a hidden tab may
//      throttle timers. The mute switch at the bottom of the menu is
//      remembered per browser (localStorage), default ON: a laptop can be
//      quiet while a phone rings.
//
// Why a poll and not SSE: one small request every 30 s per open tab is
// nothing at this scale, it survives the tunnel and every proxy, and it
// needs no server plumbing. SSE is the upgrade when tabs number in the
// hundreds, not before.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { Bell, BellOff, Volume2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  getNotificationsFn,
  getUnreadCountFn,
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
import { formatInstant } from "@/lib/instant";

/** How often the unread count is asked for while the tab is visible. */
const POLL_MS = 30_000;
/** Per-browser mute preference. Absent = sound on. */
const SOUND_KEY = "osi-notif-sound";
/** Above this the badge reads "9+" — a count that wide stops being a count. */
const BADGE_MAX = 9;

function readSoundPref(): boolean {
  try {
    return window.localStorage.getItem(SOUND_KEY) !== "off";
  } catch {
    return true;
  }
}

function writeSoundPref(on: boolean): void {
  try {
    window.localStorage.setItem(SOUND_KEY, on ? "on" : "off");
  } catch {
    /* private mode or blocked storage — the session keeps the in-memory value */
  }
}

/**
 * Two rising sine notes, 130 ms each, with a soft envelope — a chime, not an
 * alarm. Built on demand so no AudioContext exists until a sound is actually
 * wanted, and every failure is swallowed: a browser that refuses to play
 * before a gesture, or has no audio device, must never break the bell.
 */
function chime(): void {
  try {
    const Ctx = window.AudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const play = () => {
      const now = ctx.currentTime;
      [
        [659.25, 0], // E5
        [880, 0.14], // A5
      ].forEach(([freq, at]) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq!;
        gain.gain.setValueAtTime(0.0001, now + at!);
        gain.gain.exponentialRampToValueAtTime(0.18, now + at! + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + at! + 0.13);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now + at!);
        osc.stop(now + at! + 0.14);
      });
      window.setTimeout(() => void ctx.close().catch(() => undefined), 600);
    };
    if (ctx.state === "suspended") {
      // Autoplay policy: resume() rejects until the visitor has interacted
      // with the page. That is the browser's rule; we stay silent, no error.
      void ctx.resume().then(play, () => void ctx.close().catch(() => undefined));
    } else {
      play();
    }
  } catch {
    /* no audio — the badge still shows */
  }
}

/** `(3) Demandes | OSI` — the count rides the tab title so a hidden tab shows it. */
function stampTitle(unread: number): void {
  if (typeof document === "undefined") return;
  const base = document.title.replace(/^\(\d+\+?\)\s/, "");
  document.title = unread > 0 ? `(${unread > BADGE_MAX ? `${BADGE_MAX}+` : unread}) ${base}` : base;
}

export function NotificationBell() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const [data, setData] = useState<NotificationsData>({ items: [], unread: 0 });
  const [soundOn, setSoundOn] = useState(true);
  // What the last poll saw. Null until the first answer, so the initial load
  // never rings: a count that was already there is not news.
  const lastUnread = useRef<number | null>(null);

  const applyUnread = useCallback((unread: number) => {
    if (lastUnread.current !== null && unread > lastUnread.current && readSoundPref()) chime();
    lastUnread.current = unread;
    stampTitle(unread);
    setData((current) => (current.unread === unread ? current : { ...current, unread }));
  }, []);

  const load = useCallback(() => {
    void getNotificationsFn().then((fresh) => {
      setData(fresh);
      applyUnread(fresh.unread);
    });
  }, [applyUnread]);

  const poll = useCallback(() => {
    if (typeof document !== "undefined" && document.hidden) return;
    void getUnreadCountFn().then(({ unread }) => applyUnread(unread));
  }, [applyUnread]);

  useEffect(() => {
    setSoundOn(readSoundPref());
    load();
    const timer = window.setInterval(poll, POLL_MS);
    // Coming back to the tab is the moment someone actually looks — ask now
    // rather than up to 30 s later.
    const onVisible = () => {
      if (!document.hidden) poll();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load, poll]);

  const open = (notification: NotificationView) => {
    void markNotificationsReadFn({ data: { id: notification.id } }).then(load);
    if (notification.link) void router.navigate({ to: notification.link });
  };

  const markAll = () => void markNotificationsReadFn({ data: {} }).then(load);

  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    writeSoundPref(next);
    // Turning it on IS a gesture, so this one can play: the visitor hears
    // what they just enabled.
    if (next) chime();
  };

  const stamp = (iso: string) =>
    formatInstant(iso, i18n.language, {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });

  const badge = data.unread > BADGE_MAX ? `${BADGE_MAX}+` : String(data.unread);

  return (
    <DropdownMenu onOpenChange={(isOpen) => isOpen && load()}>
      <DropdownMenuTrigger
        aria-label={
          data.unread > 0
            ? t("notifications.unreadBadge", { count: data.unread })
            : t("topbar.notifications")
        }
        className="relative transition-colors hover:text-foreground"
      >
        <Bell className="size-[18px]" />
        {data.unread > 0 && (
          <span
            aria-hidden="true"
            className="absolute -right-2 -top-2 grid h-4 min-w-4 place-items-center rounded-full bg-gold px-1 text-[10px] font-semibold leading-none text-gold-foreground tabular-nums shadow-gold"
          >
            {badge}
          </span>
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
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault(); // keep the menu open so the change is visible
            toggleSound();
          }}
          className="justify-center gap-2 text-xs text-muted-foreground"
        >
          {soundOn ? <Volume2 className="size-3.5" /> : <BellOff className="size-3.5" />}
          {t(soundOn ? "notifications.soundOn" : "notifications.soundOff")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
