// The reset-link capture (2026-10-13) — small, but it sits directly on the
// password-reset path, where a mistake either leaks a link or silently
// swallows a customer's reset email.

import { beforeEach, describe, expect, it } from "vitest";
import { beginCapture, endCapture, takeResetCapture } from "@/server/reset-capture";

describe("a reset URL is captured only when staff asked for it", () => {
  beforeEach(async () => {
    // Drain anything a previous test armed.
    await endCapture("someone@example.com", 0);
    await endCapture("other@example.com", 0);
  });

  it("does NOT capture an ordinary reset — the customer still gets their email", () => {
    // The default path. If this ever returns true, every self-service reset
    // silently stops being delivered.
    expect(takeResetCapture("someone@example.com", "https://osi/reset?token=abc")).toBe(false);
  });

  it("captures once armed, and tells the caller not to send", async () => {
    beginCapture("someone@example.com");
    expect(takeResetCapture("someone@example.com", "https://osi/reset?token=abc")).toBe(true);
    await expect(endCapture("someone@example.com")).resolves.toBe("https://osi/reset?token=abc");
  });

  it("captures only the address it was armed for", async () => {
    beginCapture("someone@example.com");
    expect(takeResetCapture("other@example.com", "https://osi/reset?token=xyz")).toBe(false);
    await expect(endCapture("other@example.com", 0)).resolves.toBeUndefined();
  });

  it("is case- and whitespace-insensitive, as email addresses are", () => {
    beginCapture("  Someone@Example.com ");
    expect(takeResetCapture("someone@example.com", "https://osi/reset?token=abc")).toBe(true);
  });

  it("disarms after one read, so the NEXT reset is delivered normally", async () => {
    beginCapture("someone@example.com");
    takeResetCapture("someone@example.com", "https://osi/reset?token=abc");
    await endCapture("someone@example.com");
    expect(takeResetCapture("someone@example.com", "https://osi/reset?token=def")).toBe(false);
  });

  it("returns undefined when armed but never filled — a failed issuance", async () => {
    beginCapture("someone@example.com");
    await expect(endCapture("someone@example.com", 10)).resolves.toBeUndefined();
  });

  it("waits for a callback that arrives LATE — better-auth may not await it", async () => {
    // The reason endCapture is async at all. If it read once and returned,
    // this is the case that would report "no link" to staff standing next to
    // a locked-out customer.
    beginCapture("someone@example.com");
    setTimeout(() => takeResetCapture("someone@example.com", "https://osi/reset?token=late"), 40);
    await expect(endCapture("someone@example.com", 2000)).resolves.toBe(
      "https://osi/reset?token=late",
    );
  });
});
