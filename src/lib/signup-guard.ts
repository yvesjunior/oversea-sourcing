// Signup abuse controls (E1) — pure, so the form and the server share one
// definition of the honeypot field name and one set of rules.
//
// Measured 2026-08-16 before this existed: 12 consecutive POSTs to
// /api/auth/sign-up/email from one IP all returned 200. Every account creates a
// workspace and can submit requests, and with AI_RESEARCH on each request spends
// real money — so an open signup endpoint is both a data-flood and a spend vector.
//
// Three layers, cheapest first. None of them is a CAPTCHA: the real fix is email
// verification (E1, needs an email provider), and these hold the line until then.

/** Throwaway-inbox providers. Not exhaustive by design — this stops casual
 *  scripted signup, it is not a war on disposable mail. */
const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com",
  "guerrillamail.com",
  "guerrillamail.info",
  "sharklasers.com",
  "10minutemail.com",
  "10minutemail.net",
  "tempmail.com",
  "temp-mail.org",
  "throwawaymail.com",
  "yopmail.com",
  "yopmail.fr",
  "getnada.com",
  "trashmail.com",
  "dispostable.com",
  "maildrop.cc",
  "fakeinbox.com",
  "mohmal.com",
  "spam4.me",
  "grr.la",
  "mailnesia.com",
  "tempinbox.com",
  "emailondeck.com",
  "moakt.com",
  "tmpmail.org",
  "burnermail.io",
]);

/** Filled only by a bot: the field is hidden from humans in the form. */
export const HONEYPOT_FIELD = "companyWebsite";

export type SignupRejection = { reason: string; message: string } | null;

/**
 * Validate a signup payload. Returns null when it looks like a person.
 *
 * Deliberately returns the SAME generic message for every rejection: telling a
 * script which check it tripped is telling it how to pass next time.
 */
export function checkSignupPayload(body: unknown): SignupRejection {
  const payload = (body ?? {}) as Record<string, unknown>;
  const generic = "Signup could not be completed. Please check your details and try again.";

  // 1 · Honeypot — a human never sees this field, so any value is a bot.
  const honeypot = payload[HONEYPOT_FIELD];
  if (typeof honeypot === "string" && honeypot.trim() !== "") {
    return { reason: "honeypot", message: generic };
  }

  const email = typeof payload["email"] === "string" ? payload["email"].trim().toLowerCase() : "";
  if (!email || !email.includes("@")) {
    return { reason: "invalid_email", message: generic };
  }

  // 2 · Disposable inbox — an account nobody can be held to.
  const domain = email.slice(email.lastIndexOf("@") + 1);
  if (DISPOSABLE_DOMAINS.has(domain)) {
    return { reason: "disposable_email", message: generic };
  }

  // 3 · Plus-addressing is how one inbox becomes a hundred accounts. Allowed in
  //     principle, but it is the single cheapest way to script signups, so it is
  //     refused while there is no email verification to anchor identity.
  const localPart = email.slice(0, email.indexOf("@"));
  if (localPart.includes("+")) {
    return { reason: "plus_addressing", message: generic };
  }

  const name = typeof payload["name"] === "string" ? payload["name"].trim() : "";
  if (name.length < 2) {
    return { reason: "name_too_short", message: generic };
  }

  return null;
}
