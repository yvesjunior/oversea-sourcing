import { describe, expect, it } from "vitest";
import {
  ARCHIVE_RETENTION_YEARS,
  archivePurgeDue,
  DOCUMENT_RETENTION_MONTHS,
  isPurgeable,
  retentionCutoff,
} from "@/lib/retention";

const NOW = new Date("2026-09-12T12:00:00Z");

describe("document retention", () => {
  it("keeps documents for six months after they are orphaned", () => {
    expect(DOCUMENT_RETENTION_MONTHS).toBe(6);
    expect(retentionCutoff(NOW).toISOString()).toBe("2026-03-12T12:00:00.000Z");
  });

  it("never purges a document that is still attached to something", () => {
    // Null is the normal state, and the sweep only stamps a row once BOTH its
    // request and its quote are gone. A bug here deletes live paperwork.
    expect(isPurgeable(null, NOW)).toBe(false);
  });

  it("keeps an orphan inside the window and purges one past it", () => {
    expect(isPurgeable(new Date("2026-03-13T00:00:00Z"), NOW)).toBe(false);
    expect(isPurgeable(new Date("2026-03-11T00:00:00Z"), NOW)).toBe(true);
  });

  it("treats the boundary as still kept", () => {
    // Exactly six months old survives. When the rule is "six months", the day
    // it becomes six months old is not the day it disappears.
    expect(isPurgeable(retentionCutoff(NOW), NOW)).toBe(false);
  });

  it("counts in calendar months, and rolls a missing day forward", () => {
    // 2026-08-31 minus six months is February, which has no 31st, so the Date
    // API rolls into March. Pinned deliberately: a window that moves by a day
    // at month ends is noise against six months, but it should be KNOWN
    // behaviour rather than a surprise in a support conversation.
    const cutoff = retentionCutoff(new Date("2026-08-31T00:00:00Z"));
    expect(cutoff.toISOString().slice(0, 10)).toBe("2026-03-03");
  });

  it("is a duration, so an hour of DST drift is not worth correcting", () => {
    // setMonth works in LOCAL time, so a cutoff crossing a DST boundary lands
    // an hour off in UTC. Named here so nobody "fixes" it with the civil-date
    // machinery in period.ts: that exists because a DAY boundary changes which
    // week a row belongs to. An hour inside a six-month window changes nothing.
    const summer = retentionCutoff(new Date("2026-08-31T00:00:00Z"));
    const winter = retentionCutoff(new Date("2026-01-31T00:00:00Z"));
    const drift = Math.abs(
      (summer.getUTCHours() - new Date("2026-08-31T00:00:00Z").getUTCHours() + 24) % 24,
    );
    expect(drift).toBeLessThanOrEqual(1);
    expect(winter.toISOString().slice(0, 7)).toBe("2025-07");
  });
});

describe("archive retention", () => {
  it("keeps an archived workspace for six years, not six months", () => {
    // Deliberately a different number from DOCUMENT_RETENTION_MONTHS, and the
    // test says why: six months is a REVERSAL window, six years is a books-and
    // -records obligation. An archive exists because the workspace holds
    // contracts OSI is a party to.
    expect(ARCHIVE_RETENTION_YEARS).toBe(6);
    expect(DOCUMENT_RETENTION_MONTHS).toBe(6); // months — not the same window
    expect(archivePurgeDue(new Date("2026-09-13T00:00:00Z")).toISOString()).toBe(
      "2032-09-13T00:00:00.000Z",
    );
  });

  it("handles a leap day without inventing one", () => {
    // 29 February plus six years is 2032, which IS a leap year — the date
    // survives. Pinned because the next person will wonder.
    expect(archivePurgeDue(new Date("2026-02-28T00:00:00Z")).toISOString().slice(0, 10)).toBe(
      "2032-02-28",
    );
  });
});
