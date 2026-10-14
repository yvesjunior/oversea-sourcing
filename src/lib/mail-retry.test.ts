// The mail retry rules (2026-10-11) — written against the real outage: every
// send refused with 401 "Maximum credits exceeded" for hours.

import { describe, expect, it } from "vitest";
import {
  BACKOFF_BASE_MS,
  BACKOFF_CAP_MS,
  GIVE_UP_AFTER_MS,
  dueAt,
  hasAgedOut,
  isRetryableStatus,
} from "@/lib/mail-retry";

describe("a refusal is only repeated when repeating could help", () => {
  it("retries 401 — a broken key is fixable, and the message should survive it", () => {
    // Deliberate: on Resend a 401 is a missing or restricted key, not a
    // quota. Holding the message costs nothing and it goes out when the key
    // is fixed; abandoning it loses a password reset for good.
    expect(isRetryableStatus(401)).toBe(true);
  });

  it("retries 429 — an exhausted daily quota, which resets at midnight UTC", () => {
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(500)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
  });

  it("does not retry a refusal that will fail identically forever", () => {
    expect(isRetryableStatus(400)).toBe(false); // malformed payload
    expect(isRetryableStatus(403)).toBe(false); // unverified domain / sender outside it
    expect(isRetryableStatus(413)).toBe(false); // too large
  });
});

describe("backoff spaces out a long outage", () => {
  const t0 = new Date("2026-10-11T23:00:00Z");

  it("a message never attempted is due immediately", () => {
    expect(dueAt(0, null)).toBe(0);
  });

  it("doubles the wait per attempt", () => {
    expect(dueAt(1, t0)).toBe(t0.getTime() + BACKOFF_BASE_MS);
    expect(dueAt(2, t0)).toBe(t0.getTime() + BACKOFF_BASE_MS * 2);
    expect(dueAt(3, t0)).toBe(t0.getTime() + BACKOFF_BASE_MS * 4);
  });

  it("caps the wait, so a days-long outage still gets a few tries a day", () => {
    expect(dueAt(50, t0)).toBe(t0.getTime() + BACKOFF_CAP_MS);
  });
});

describe("a message too old to be worth sending is given up", () => {
  const now = new Date("2026-10-11T23:00:00Z").getTime();

  it("keeps a message that is merely stuck", () => {
    expect(hasAgedOut(new Date(now - GIVE_UP_AFTER_MS + 60_000), now)).toBe(false);
  });

  it("gives up once it is past the window", () => {
    expect(hasAgedOut(new Date(now - GIVE_UP_AFTER_MS - 60_000), now)).toBe(true);
  });
});
