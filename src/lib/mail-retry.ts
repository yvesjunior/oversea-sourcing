// When a refused email is worth sending again, and when to stop (2026-10-11).
//
// Pure and client-safe, like the other rule modules: the adapter in
// src/server/mail.ts owns the provider and the database, this owns the
// decisions, and the decisions are what a test can actually pin down.
//
// Born out of the SendGrid outage — the mailer answered every send with 401
// "Maximum credits exceeded" and the messages were dropped on the floor.

/** First retry delay; doubles per attempt up to BACKOFF_CAP_MS. */
export const BACKOFF_BASE_MS = 5 * 60_000;
export const BACKOFF_CAP_MS = 6 * 60 * 60_000;
/** After this long a pending message is abandoned. A week-old "reset your
 *  password" is not worth delivering, and the row stays for the record. */
export const GIVE_UP_AFTER_MS = 7 * 24 * 60 * 60_000;

/**
 * Whether a refusal is worth repeating.
 *
 * A used-up allowance is **429** on Resend (`daily_quota_exceeded`, reset at
 * midnight UTC) — plainly retryable, and the reason this rule exists.
 *
 * **401 stays retryable too**, which looks wrong: on Resend it means a
 * missing or restricted key, not a quota. Keeping it retryable is a choice
 * about which way to fail. A held message costs nothing and is delivered the
 * moment somebody fixes the key; an abandoned one is gone, and the message
 * most likely to hit a broken key is a password reset. (It was also, until
 * 2026-10-13, how SendGrid reported an exhausted account — "Maximum credits
 * exceeded" behind an auth status, which is what made the outage so
 * confusing.)
 *
 * 403 and 4xx validation failures are NOT retried: an unverified domain, a
 * sender outside it, or a malformed payload fails identically forever, and
 * retrying only burns the daily allowance the real messages need.
 */
export function isRetryableStatus(status: number): boolean {
  if (status === 401 || status === 429) return true;
  return status >= 500;
}

/** Epoch ms at which a message with this many attempts may be tried again. */
export function dueAt(attempts: number, lastAttemptAt: Date | null): number {
  if (!lastAttemptAt) return 0;
  const wait = Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1), BACKOFF_CAP_MS);
  return lastAttemptAt.getTime() + wait;
}

/** Too old to be worth delivering. */
export function hasAgedOut(createdAt: Date, now: number): boolean {
  return now - createdAt.getTime() > GIVE_UP_AFTER_MS;
}
