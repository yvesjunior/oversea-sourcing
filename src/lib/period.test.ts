import { describe, expect, it } from "vitest";
import { civilDate, inRange, normalizeRange, periodRange } from "@/lib/period";

// A Saturday, 18:29 UTC = 14:29 in Toronto.
const SATURDAY = new Date("2026-08-29T18:29:00.000Z");
// 01:30 UTC on the 1st is still the PREVIOUS month in Toronto — the case that
// decides whether "this month" agrees with the date shown on the row.
const FIRST_OF_MONTH_UTC = "2026-09-01T01:30:00.000Z";

describe("civilDate", () => {
  it("reads the date in OSI's zone, not the host's", () => {
    expect(civilDate(SATURDAY)).toBe("2026-08-29");
    expect(civilDate(FIRST_OF_MONTH_UTC)).toBe("2026-08-31");
  });
});

describe("periodRange", () => {
  it("runs a week Monday to Sunday", () => {
    expect(periodRange("week", SATURDAY)).toEqual({ from: "2026-08-24", to: "2026-08-30" });
  });

  it("treats Sunday as the END of its week, never the start", () => {
    // The off-by-one that a naive getDay() produces: Sunday would jump to the
    // week about to begin and hide everything the user just did.
    const sunday = new Date("2026-08-30T16:00:00.000Z");
    expect(periodRange("week", sunday)).toEqual({ from: "2026-08-24", to: "2026-08-30" });
  });

  it("covers a month to its real last day", () => {
    expect(periodRange("month", SATURDAY)).toEqual({ from: "2026-08-01", to: "2026-08-31" });
    // February in a leap year — the classic wrong answer is the 28th.
    expect(periodRange("month", new Date("2028-02-10T12:00:00.000Z"))).toEqual({
      from: "2028-02-01",
      to: "2028-02-29",
    });
  });

  it("covers a calendar year", () => {
    expect(periodRange("year", SATURDAY)).toEqual({ from: "2026-01-01", to: "2026-12-31" });
  });

  it("leaves 'all' and 'custom' unbounded", () => {
    expect(periodRange("all", SATURDAY)).toEqual({ from: null, to: null });
    expect(periodRange("custom", SATURDAY)).toEqual({ from: null, to: null });
  });

  it("uses OSI's calendar for the boundary, not UTC's", () => {
    // 01:30 UTC on 1 September is 31 August in Toronto, so the period this
    // instant belongs to is AUGUST — the same month the row displays.
    const range = periodRange("month", new Date(FIRST_OF_MONTH_UTC));
    expect(range).toEqual({ from: "2026-08-01", to: "2026-08-31" });
    expect(inRange(FIRST_OF_MONTH_UTC, range)).toBe(true);
  });
});

describe("inRange", () => {
  const week = periodRange("week", SATURDAY);

  it("includes both ends", () => {
    expect(inRange("2026-08-24T12:00:00.000Z", week)).toBe(true);
    expect(inRange("2026-08-30T12:00:00.000Z", week)).toBe(true);
  });

  it("excludes what falls outside", () => {
    expect(inRange("2026-08-23T12:00:00.000Z", week)).toBe(false);
    expect(inRange("2026-08-31T12:00:00.000Z", week)).toBe(false);
  });

  it("matches everything when unbounded", () => {
    expect(inRange(SATURDAY, { from: null, to: null })).toBe(true);
  });

  it("honours a half-open range", () => {
    expect(inRange("2026-01-01T12:00:00.000Z", { from: "2026-06-01", to: null })).toBe(false);
    expect(inRange("2026-12-01T12:00:00.000Z", { from: "2026-06-01", to: null })).toBe(true);
  });
});

describe("normalizeRange", () => {
  it("swaps a range typed backwards instead of showing nothing", () => {
    expect(normalizeRange({ from: "2026-08-30", to: "2026-08-01" })).toEqual({
      from: "2026-08-01",
      to: "2026-08-30",
    });
  });

  it("leaves a sane range alone", () => {
    const range = { from: "2026-08-01", to: "2026-08-30" };
    expect(normalizeRange(range)).toEqual(range);
  });
});
