// Filtering a list by period — week, month, year, or a chosen range.
//
// ── Why this compares CALENDAR DATES, not instants ────────────────────────
//
// "This week" is a question about a calendar, and which calendar depends on
// the zone you ask from. The app already pins every displayed timestamp to
// OSI_TIME_ZONE (src/lib/instant.ts); if the filter used the browser's zone
// instead, a quote stamped "29 août · 23:30" in Montréal would fall into the
// next day's — and sometimes the next month's — bucket for a viewer in Paris,
// while the row on screen still read 29 août. The list would disagree with
// itself.
//
// So every comparison happens on the OSI-zone civil date ("2026-08-29") as a
// plain string. Sorted lexicographically, ISO dates compare correctly, which
// means no offset arithmetic anywhere and nothing to get wrong across a DST
// boundary. The calendar maths that derives the bounds runs on a UTC date
// built from those civil parts, and never converts back — UTC has no DST, so
// "seven days earlier" is exactly seven days.

import { OSI_TIME_ZONE } from "@/lib/instant";

export const PERIOD_KEYS = ["all", "week", "month", "year", "custom"] as const;
export type PeriodKey = (typeof PERIOD_KEYS)[number];

/** Inclusive bounds, as civil dates in OSI's zone. `null` = unbounded. */
export type DateRange = { from: string | null; to: string | null };

export const UNBOUNDED: DateRange = { from: null, to: null };

/** The civil date an instant falls on, in OSI's zone: "2026-08-29".
 *  en-CA formats as YYYY-MM-DD, which is exactly the sortable form. */
export function civilDate(value: string | number | Date): string {
  return new Date(value).toLocaleDateString("en-CA", { timeZone: OSI_TIME_ZONE });
}

/** Civil date → the UTC noon Date used for calendar arithmetic. Noon, not
 *  midnight, so no amount of offset nudging can roll the day over. */
function civilToUtc(civil: string): Date {
  const [year, month, day] = civil.split("-").map(Number);
  return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1, 12));
}

function utcToCivil(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(civil: string, days: number): string {
  const date = civilToUtc(civil);
  date.setUTCDate(date.getUTCDate() + days);
  return utcToCivil(date);
}

/**
 * The range a preset covers, relative to `now`.
 *
 * Weeks start MONDAY — the working week these lists describe, and the ISO
 * convention both locales in this app share. `custom` has no derivable range;
 * the caller supplies it.
 */
export function periodRange(key: PeriodKey, now: Date = new Date()): DateRange {
  if (key === "all" || key === "custom") return UNBOUNDED;
  const today = civilDate(now);
  const date = civilToUtc(today);

  if (key === "year") {
    const year = date.getUTCFullYear();
    return { from: `${year}-01-01`, to: `${year}-12-31` };
  }
  if (key === "month") {
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth();
    const last = new Date(Date.UTC(year, month + 1, 0, 12));
    return { from: utcToCivil(new Date(Date.UTC(year, month, 1, 12))), to: utcToCivil(last) };
  }
  // Week: back up to Monday (getUTCDay is 0 for Sunday, which is day 7 here).
  const weekday = date.getUTCDay();
  const backToMonday = weekday === 0 ? 6 : weekday - 1;
  const monday = addDays(today, -backToMonday);
  return { from: monday, to: addDays(monday, 6) };
}

/** Is this instant inside the range? Unbounded ends match everything. */
export function inRange(value: string | number | Date, range: DateRange): boolean {
  if (range.from === null && range.to === null) return true;
  const day = civilDate(value);
  if (range.from !== null && day < range.from) return false;
  if (range.to !== null && day > range.to) return false;
  return true;
}

/** A custom range typed backwards is a mistake, not an empty list: swap it
 *  rather than silently showing nothing. */
export function normalizeRange(range: DateRange): DateRange {
  if (range.from !== null && range.to !== null && range.from > range.to) {
    return { from: range.to, to: range.from };
  }
  return range;
}
