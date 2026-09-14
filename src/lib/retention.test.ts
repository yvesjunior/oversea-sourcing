import { describe, expect, it } from "vitest";
import {
  ARCHIVE_RETENTION_YEARS,
  archivePurgeDue,
  DOCUMENT_RETENTION_MONTHS,
  isPurgeable,
  retentionCutoff,
} from "@/lib/retention";

const NOW = new Date("2026-09-13T12:00:00Z");

describe("document retention", () => {
  it("keeps an orphaned document for 36 months", () => {
    expect(DOCUMENT_RETENTION_MONTHS).toBe(36);
    expect(retentionCutoff(NOW).toISOString()).toBe("2023-09-13T12:00:00.000Z");
  });

  it("never purges a document that is still attached to something", () => {
    // Null is the normal state, and the sweep only stamps a row once BOTH its
    // request and its quote are gone. A bug here deletes live paperwork.
    expect(isPurgeable(null, NOW)).toBe(false);
  });

  it("keeps an orphan inside the window and purges one past it", () => {
    expect(isPurgeable(new Date("2023-09-14T00:00:00Z"), NOW)).toBe(false);
    expect(isPurgeable(new Date("2023-09-12T00:00:00Z"), NOW)).toBe(true);
  });

  it("treats the boundary as still kept", () => {
    // Exactly 36 months old survives. When the rule is "36 months", the day a
    // document becomes 36 months old is not the day it disappears.
    expect(isPurgeable(retentionCutoff(NOW), NOW)).toBe(false);
  });

  it("counts in calendar months, and rolls a missing day forward", () => {
    // 31 August minus 36 months is 31 August 2023 — a real date, so nothing
    // rolls. The rollover case is 31 March minus one month, and it matters
    // here only because setMonth is what does the counting: a window that
    // moves by a day at some month ends is noise against three years, but it
    // should be KNOWN behaviour rather than a surprise in a support
    // conversation.
    expect(retentionCutoff(new Date("2026-08-31T00:00:00Z")).toISOString().slice(0, 10)).toBe(
      "2023-08-31",
    );
    expect(retentionCutoff(new Date("2026-03-31T00:00:00Z")).toISOString().slice(0, 10)).toBe(
      "2023-03-31",
    );
  });

  it("is a duration, so an hour of DST drift is not worth correcting", () => {
    // setMonth works in LOCAL time, so a cutoff crossing a DST boundary can
    // land an hour off in UTC. Named here so nobody "fixes" it with the
    // civil-date machinery in period.ts: that exists because a DAY boundary
    // decides which week a row belongs to. An hour inside three years decides
    // nothing.
    const cutoff = retentionCutoff(new Date("2026-08-31T00:00:00Z"));
    expect(Math.abs(cutoff.getUTCHours())).toBeLessThanOrEqual(1);
  });
});

describe("archive retention", () => {
  it("keeps an archived workspace far longer than a loose document", () => {
    // Two windows, two units, and the test states the reason so nobody
    // "harmonises" them: 36 months is time to realise you still needed a file;
    // six years is a books-and-records obligation on a workspace holding
    // contracts OSI is a party to.
    expect(ARCHIVE_RETENTION_YEARS).toBe(6);
    expect(ARCHIVE_RETENTION_YEARS * 12).toBeGreaterThan(DOCUMENT_RETENTION_MONTHS);
    expect(archivePurgeDue(new Date("2026-09-13T00:00:00Z")).toISOString()).toBe(
      "2032-09-13T00:00:00.000Z",
    );
  });

  it("handles a leap-year edge without inventing a day", () => {
    expect(archivePurgeDue(new Date("2026-02-28T00:00:00Z")).toISOString().slice(0, 10)).toBe(
      "2032-02-28",
    );
  });
});
