// Lets STAFF obtain a password-reset link instead of mailing it (2026-10-13).
//
// Why a capture rather than minting a token ourselves: better-auth owns the
// reset token's format, storage and expiry, and a hand-rolled copy would be a
// second implementation to keep in step — the kind that works until an
// upgrade quietly changes the format. So we ask better-auth for a reset in
// the normal way and intercept the URL in our OWN `sendResetPassword`
// callback, which is a documented seam rather than an internal.
//
// The outage is why this exists: email was the only route back into an
// account, so when the mailer died, so did account recovery. Now a human can
// read the link out over the phone. It stays useful afterwards — a customer
// whose mail silently spam-folders our domain has the same problem.
//
// Scope is deliberately tiny: an in-memory map, one entry per issuance,
// cleared in a `finally`. It never crosses a request boundary and nothing
// reads it except the callback a few milliseconds later. A capture left
// behind by a crash is harmless — the next issuance for that address
// overwrites it, and a stale entry only ever SUPPRESSES one email rather
// than leaking anything.

type Slot = { url?: string; resolve?: (url: string | undefined) => void };

const captures = new Map<string, Slot>();

const key = (email: string) => email.trim().toLowerCase();

/** Arm the capture: the next reset URL for this address is taken, not sent. */
export function beginCapture(email: string): void {
  captures.set(key(email), {});
}

/** Called from `sendResetPassword`. Returns true when the URL was captured,
 *  meaning the caller must NOT send an email. */
export function takeResetCapture(email: string, url: string): boolean {
  const slot = captures.get(key(email));
  if (!slot) return false;
  slot.url = url;
  slot.resolve?.(url);
  return true;
}

/**
 * Disarm and read. Always call this, in a `finally`.
 *
 * It WAITS rather than reading once, because better-auth does not promise
 * that `sendResetPassword` is awaited before `requestPasswordReset` resolves.
 * Reading immediately would work or not depending on that internal detail,
 * and would fail by silently reporting "no link" — the kind of bug that only
 * shows up in front of a locked-out customer. Waiting costs nothing when the
 * callback is synchronous, which is the common case.
 */
export async function endCapture(email: string, waitMs = 3000): Promise<string | undefined> {
  const k = key(email);
  const slot = captures.get(k);
  if (!slot) return undefined;
  if (slot.url !== undefined) {
    captures.delete(k);
    return slot.url;
  }
  const url = await new Promise<string | undefined>((resolve) => {
    slot.resolve = resolve;
    setTimeout(() => resolve(undefined), waitMs);
  });
  captures.delete(k);
  return url;
}
