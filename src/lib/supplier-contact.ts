// Supplier contacts — the pure rules (Phase V · V02, 2026-11-14).
//
// Client- and server-safe: no server imports. The table and its writes live in
// src/server/supplier-contacts.ts.
//
// Until V02 a supplier had NO contact address anywhere in the schema: the RFQ
// left from a staff mailbox, to an address someone found by hand. Sending an
// RFQ from the platform (V06) needs somewhere to keep it.

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

// Deliberately modest: one @, no spaces, a dot in the domain. Anything
// stricter rejects real addresses, and the only true test of an address is
// whether mail sent to it arrives.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isPlausibleEmail(raw: string): boolean {
  const email = normalizeEmail(raw);
  return email.length <= 254 && EMAIL_SHAPE.test(email);
}

/** Local parts nobody reads. An RFQ sent there is an RFQ not sent, and it
 *  would start a response-time clock on a mailbox with no one behind it. */
const UNATTENDED =
  /^(no-?reply|do-?not-?reply|donotreply|mailer-daemon|postmaster|bounce)s?(\+.*)?$/;

function hostOf(website: string): string | null {
  const trimmed = website.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    return url.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * Does this address belong to the company whose site this is?
 *
 * True when the mail domain and the site's host are the same or one sits
 * under the other: `sales@acme.com` for `shop.acme.com`, `info@eu.acme.com`
 * for `acme.com`. No public-suffix list is consulted, so a bare registry
 * suffix used as a mail domain (`someone@co.uk`) would match every site under
 * it — nobody receives mail there, and the cost of the rare miss is one
 * wrong suggestion staff can delete.
 */
export function emailMatchesWebsite(email: string, website: string | null | undefined): boolean {
  if (!website) return false;
  const host = hostOf(website);
  const domain = normalizeEmail(email).split("@")[1];
  if (!host || !domain || !domain.includes(".")) return false;
  return domain === host || host.endsWith(`.${domain}`) || domain.endsWith(`.${host}`);
}

/**
 * The gate for an address the RESEARCH pass reports.
 *
 * Returns the normalised address, or null. An address is kept only when it is
 * well-formed, attended, and on the supplier's own domain. That last rule is
 * the point: a model asked for a contact will sometimes produce a plausible
 * one, and "sales@" plus the company's name is exactly what a guess looks
 * like. Requiring the domain to match the website the same pass reported
 * means an invented address has to be invented consistently with a real site
 * — and one that is on a different domain (a directory's, a marketplace's, a
 * free-mail account) is dropped rather than trusted.
 *
 * Staff are not held to this: a person who types an address has a reason to.
 */
export function acceptResearchedEmail(
  raw: string | null | undefined,
  website: string | null | undefined,
): string | null {
  if (!raw) return null;
  const email = normalizeEmail(raw);
  if (!isPlausibleEmail(email)) return null;
  if (UNATTENDED.test(email.split("@")[0] ?? "")) return null;
  return emailMatchesWebsite(email, website) ? email : null;
}
