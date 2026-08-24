// Email adapter (B3/B9, 2026-08-23) — SendGrid behind the house vendor rule:
// nothing else imports or knows about SendGrid; swapping providers rewrites
// this file and nothing else. Plain fetch on the v3 API — the adapter IS the
// seam, an SDK would just be a second wrapper.
//
// Behavior by configuration:
//   SENDGRID_API_KEY unset  → sends are logged to stdout (fresh dev clones)
//   MAIL_SILENT=true        → same, even with a key (flow tests without
//                             sending real mail from the dev machine)
//   key present             → real send; the sender (MAIL_FROM) must be
//                             verified in SendGrid or the API refuses.
//
// Failures are returned, not thrown: an invitation whose email bounces is
// still a valid invitation (the copyable link covers delivery).

const SENDGRID_URL = "https://api.sendgrid.com/v3/mail/send";

export type MailInput = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

export type MailResult = { ok: boolean; skipped?: "no_key" | "silent"; error?: string };

export async function sendMail(input: MailInput): Promise<MailResult> {
  const apiKey = process.env["SENDGRID_API_KEY"];
  const from = process.env["MAIL_FROM"] ?? "no-reply@osi-solutions.com";
  const fromName = process.env["MAIL_FROM_NAME"] ?? "OSI";

  if (!apiKey || process.env["MAIL_SILENT"] === "true") {
    const why = !apiKey ? "no_key" : "silent";
    console.log(
      `mail (${why}): to=${input.to} subject="${input.subject}"\n${input.text ?? input.html}`,
    );
    return { ok: true, skipped: why as "no_key" | "silent" };
  }

  try {
    const response = await fetch(SENDGRID_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: input.to }] }],
        from: { email: from, name: fromName },
        subject: input.subject,
        content: [
          // text/plain first — SendGrid requires ascending specificity.
          ...(input.text ? [{ type: "text/plain", value: input.text }] : []),
          { type: "text/html", value: input.html },
        ],
      }),
    });
    if (response.status === 202) return { ok: true };
    const body = await response.text().catch(() => "");
    console.error(`mail: SendGrid refused (${response.status}) — ${body.slice(0, 300)}`);
    return { ok: false, error: `sendgrid_${response.status}` };
  } catch (error) {
    console.error("mail: send failed —", error);
    return { ok: false, error: "network" };
  }
}
