// How this app renders an INSTANT — one rule, applied everywhere.
//
// ── The bug this exists to make impossible ────────────────────────────────
//
// A timestamp formatted without an explicit time zone uses whatever zone the
// process is in. The web container has no TZ set, so it is **UTC**; the
// visitor's browser is not. The server therefore rendered "29 août · 18:29"
// and the browser re-rendered "29 août · 14:29" from the same instant, which
// is a hydration mismatch by construction — React threw
// "Hydration failed because the server rendered text…", discarded the server
// HTML for that subtree and re-rendered it client-side. The page looked
// right, so it went unnoticed on prod for a while; the real cost is that SSR
// is silently wasted there, and a genuine hydration bug landing later hides
// inside the noise.
//
// It also affected DATE-ONLY renderings, which is easy to miss: an instant at
// 01:30 UTC is the previous day in Toronto, so "created 29 August" and
// "created 28 August" are the same row seen from two zones.
//
// ── The rule ──────────────────────────────────────────────────────────────
//
// Every instant is formatted in ONE fixed zone, named here, on the server and
// in the browser alike. Determinism is the point: the two sides cannot
// disagree, so the mismatch cannot come back the next time someone renders a
// date.
//
// The alternative — render the viewer's local zone after mount — was
// considered and rejected. It re-introduces two renders (the SSR one must
// still be the fixed zone to hydrate cleanly), which makes every timestamp
// visibly jump by the offset a moment after load. A stable operational clock
// reads better than a flickering one.
//
// The zone is OSI's own, deliberately: these timestamps are the record of
// when OSI's system did something — a search completed, a quote was
// recorded, a contract was drafted. `suppressHydrationWarning` is NOT the fix
// here (it is right for the relative "il y a 6 minutes" on DossierCard, where
// the drift is seconds): it would silence the warning while leaving the
// server's UTC text on screen, showing everyone the wrong hour.

/** OSI operates from Québec; the platform clock is that clock. Changing this
 *  changes every timestamp in the app at once — which is the property that
 *  makes it safe. */
export const OSI_TIME_ZONE = "America/Toronto";

/** `fr` / `en` as the app stores them; anything else falls back to the tag
 *  itself, which Intl handles. */
type Lang = string;

/**
 * The one formatter. Identical output on the server and in the browser,
 * because the zone never comes from the environment.
 */
export function formatInstant(
  value: string | number | Date,
  lang: Lang,
  options: Intl.DateTimeFormatOptions,
): string {
  return new Date(value).toLocaleString(lang, { ...options, timeZone: OSI_TIME_ZONE });
}

/** "29 août 2026" — the common date-only stamp on lists and tables. */
export function formatDay(
  value: string | number | Date,
  lang: Lang,
  month: "short" | "long" = "short",
): string {
  return formatInstant(value, lang, { day: "numeric", month, year: "numeric" });
}

/**
 * "29 août 2026 · 14:29" — the timeline stamp.
 *
 * Composed from two calls rather than `dateStyle`/`timeStyle` so the
 * separator stays the app's own middle dot, which is what the date-fns
 * patterns this replaced produced.
 */
export function formatDayTime(
  value: string | number | Date,
  lang: Lang,
  { withYear = true, month = "short" }: { withYear?: boolean; month?: "short" | "long" } = {},
): string {
  const day = formatInstant(value, lang, {
    day: "numeric",
    month,
    ...(withYear ? { year: "numeric" } : {}),
  });
  const time = formatInstant(value, lang, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return `${day} · ${time}`;
}

/** "2026-08-29 14:29" — the compact stamp for dense admin tables. */
export function formatShortDateTime(value: string | number | Date, lang: Lang): string {
  return formatInstant(value, lang, { dateStyle: "short", timeStyle: "short" });
}
