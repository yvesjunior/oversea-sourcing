import { describe, expect, it } from "vitest";
import {
  formatDay,
  formatDayTime,
  formatInstant,
  formatShortDateTime,
  OSI_TIME_ZONE,
} from "@/lib/instant";

// 01:30 UTC is the PREVIOUS day in Toronto — the case that makes a date-only
// stamp disagree between a UTC server and a North American browser.
const ACROSS_MIDNIGHT = "2026-08-29T01:30:00.000Z";
const AFTERNOON = "2026-08-29T18:29:00.000Z";

describe("formatInstant", () => {
  it("ignores the host time zone entirely", () => {
    // The whole point: the output is a function of the instant and the
    // locale, never of the environment the code happens to run in. If this
    // ever fails, the server and the browser can disagree again.
    const pinned = new Date(AFTERNOON).toLocaleString("fr", {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone: OSI_TIME_ZONE,
    });
    expect(
      formatInstant(AFTERNOON, "fr", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
    ).toBe(pinned);
  });

  it("renders OSI's clock, not UTC", () => {
    // 18:29 UTC is 14:29 in Toronto (EDT). Rendering the UTC hour is exactly
    // the bug: it showed every viewer a time four hours off.
    const time = formatInstant(AFTERNOON, "fr", {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    expect(time).toContain("14");
    expect(time).not.toContain("18");
  });

  it("puts an instant near midnight on the right calendar day", () => {
    // 01:30 UTC on the 29th is 21:30 on the 28th in Toronto. A date-only
    // stamp that used UTC would name the wrong day.
    expect(formatDay(ACROSS_MIDNIGHT, "fr")).toContain("28");
    expect(formatDay(ACROSS_MIDNIGHT, "fr")).not.toContain("29");
  });
});

describe("formatDayTime", () => {
  it("joins the date and the time with the app's middle dot", () => {
    const stamp = formatDayTime(AFTERNOON, "fr");
    expect(stamp).toContain(" · ");
    expect(stamp).toContain("2026");
    expect(stamp).toContain("14:29");
  });

  it("drops the year on request, for a dense timeline", () => {
    expect(formatDayTime(AFTERNOON, "fr", { withYear: false })).not.toContain("2026");
  });

  it("uses a 24-hour clock in English too — this is an operations log", () => {
    const stamp = formatDayTime(AFTERNOON, "en");
    expect(stamp).toContain("14:29");
    expect(stamp).not.toMatch(/PM|AM/i);
  });
});

describe("formatShortDateTime", () => {
  it("is stable across locales in the same zone", () => {
    // Different strings, same underlying moment — what matters is that
    // neither is the host's idea of "now-ish".
    expect(formatShortDateTime(AFTERNOON, "fr")).toContain("14:29");
    expect(formatShortDateTime(AFTERNOON, "en")).toMatch(/2:29|14:29/);
  });
});
