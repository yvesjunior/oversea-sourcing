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
//
// AND, since 2026-10-11, a failure is also KEPT. SendGrid began refusing
// every send with 401 "Maximum credits exceeded"; the adapter logged one line
// and returned, four of its five callers discarded the result, and the mail
// was gone. A buyer waited 90 minutes for a report and was never told it had
// arrived. Password resets and signature invitations ran down the same drain.
// The provider outage was not the defect — silently destroying the message
// was. Anything that might yet succeed now lands in `mail_outbox` and is
// retried by the worker until it sends or ages out.

import type { MailOutboxStatus } from "@/database/schema";
import { dueAt, hasAgedOut, isRetryableStatus } from "@/lib/mail-retry";

/** Overridable so the outbox can be exercised against a stub that actually
 *  returns 202 — the one path a unit test cannot reach and the one that, if
 *  wrong, would re-send every message forever. Unset everywhere but tests. */
const SENDGRID_URL = process.env["SENDGRID_API_URL"] ?? "https://api.sendgrid.com/v3/mail/send";

/** How many pending messages one flush will try. */
const FLUSH_BATCH = 25;

export type MailInput = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

export type MailResult = {
  ok: boolean;
  skipped?: "no_key" | "silent";
  error?: string;
  /** Kept in `mail_outbox` for a later attempt — the message is not lost. */
  queued?: boolean;
};

type Attempt = { ok: true } | { ok: false; error: string; retryable: boolean };

/** One delivery attempt. The only function in the codebase that talks to the
 *  provider — everything else goes through sendMail or the outbox. */
async function deliver(input: MailInput, apiKey: string): Promise<Attempt> {
  const from = process.env["MAIL_FROM"] ?? "no-reply@osi-solutions.com";
  const fromName = process.env["MAIL_FROM_NAME"] ?? "OSI";
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
    return {
      ok: false,
      error: `sendgrid_${response.status}: ${body.slice(0, 200)}`,
      retryable: isRetryableStatus(response.status),
    };
  } catch (error) {
    console.error("mail: send failed —", error);
    return { ok: false, error: `network: ${String(error).slice(0, 200)}`, retryable: true };
  }
}

/** Keep a message the provider would not take. Never throws: the outbox is a
 *  safety net, and a safety net that can break the caller is worse than none. */
async function remember(input: MailInput, attempt: Attempt & { ok: false }): Promise<boolean> {
  try {
    const [{ db }, schema] = await Promise.all([import("@/database"), import("@/database/schema")]);
    await db.insert(schema.mailOutbox).values({
      id: crypto.randomUUID(),
      recipient: input.to,
      subject: input.subject,
      html: input.html,
      body: input.text ?? null,
      status: (attempt.retryable ? "pending" : "abandoned") satisfies MailOutboxStatus,
      attempts: 1,
      lastError: attempt.error,
      lastAttemptAt: new Date(),
    });
    console.error(
      `mail: ${attempt.retryable ? "kept for retry" : "ABANDONED (permanent refusal)"} — to=${input.to} subject="${input.subject}"`,
    );
    return attempt.retryable;
  } catch (error) {
    // The one case where mail really is lost. Say so loudly.
    console.error(`mail: OUTBOX WRITE FAILED, message lost — to=${input.to} —`, error);
    return false;
  }
}

export async function sendMail(input: MailInput): Promise<MailResult> {
  const apiKey = process.env["SENDGRID_API_KEY"];

  if (!apiKey || process.env["MAIL_SILENT"] === "true") {
    const why = !apiKey ? "no_key" : "silent";
    console.log(
      `mail (${why}): to=${input.to} subject="${input.subject}"\n${input.text ?? input.html}`,
    );
    return { ok: true, skipped: why as "no_key" | "silent" };
  }

  const attempt = await deliver(input, apiKey);
  if (attempt.ok) return { ok: true };
  const queued = await remember(input, attempt);
  return { ok: false, error: attempt.error, queued };
}

export type FlushOutcome = { tried: number; sent: number; kept: number; abandoned: number };

/**
 * Retry what the provider would not take. Run by the worker (never the web
 * process — one flusher, same reasoning as the stranded sweep).
 *
 * Returns what happened so the caller can decide whether to raise an alarm;
 * it deliberately does not raise one itself, because the adapter has no
 * opinion about who should be told.
 */
export async function flushMailOutbox(limit = FLUSH_BATCH): Promise<FlushOutcome> {
  const outcome: FlushOutcome = { tried: 0, sent: 0, kept: 0, abandoned: 0 };
  const apiKey = process.env["SENDGRID_API_KEY"];
  if (!apiKey || process.env["MAIL_SILENT"] === "true") return outcome;

  const [{ db }, schema, { and, asc, eq }] = await Promise.all([
    import("@/database"),
    import("@/database/schema"),
    import("drizzle-orm"),
  ]);

  const pending = await db.query.mailOutbox.findMany({
    where: eq(schema.mailOutbox.status, "pending"),
    orderBy: [asc(schema.mailOutbox.createdAt)],
    limit,
  });

  const now = Date.now();
  for (const row of pending) {
    if (now < dueAt(row.attempts, row.lastAttemptAt)) continue;

    if (hasAgedOut(row.createdAt, now)) {
      await db
        .update(schema.mailOutbox)
        .set({ status: "abandoned", lastError: `${row.lastError ?? ""} | aged out` })
        .where(and(eq(schema.mailOutbox.id, row.id)));
      outcome.abandoned += 1;
      continue;
    }

    outcome.tried += 1;
    const attempt = await deliver(
      {
        to: row.recipient,
        subject: row.subject,
        html: row.html,
        ...(row.body ? { text: row.body } : {}),
      },
      apiKey,
    );
    if (attempt.ok) {
      await db
        .update(schema.mailOutbox)
        .set({
          status: "sent",
          sentAt: new Date(),
          attempts: row.attempts + 1,
          lastAttemptAt: new Date(),
        })
        .where(eq(schema.mailOutbox.id, row.id));
      outcome.sent += 1;
      continue;
    }
    const giveUp = !attempt.retryable;
    await db
      .update(schema.mailOutbox)
      .set({
        status: giveUp ? "abandoned" : "pending",
        attempts: row.attempts + 1,
        lastError: attempt.error,
        lastAttemptAt: new Date(),
      })
      .where(eq(schema.mailOutbox.id, row.id));
    if (giveUp) outcome.abandoned += 1;
    else outcome.kept += 1;
  }
  return outcome;
}

/** How much mail is waiting — for the worker's log line and the staff alert. */
export async function countPendingMail(): Promise<number> {
  try {
    const [{ db }, schema, { count, eq }] = await Promise.all([
      import("@/database"),
      import("@/database/schema"),
      import("drizzle-orm"),
    ]);
    const [row] = await db
      .select({ value: count() })
      .from(schema.mailOutbox)
      .where(eq(schema.mailOutbox.status, "pending"));
    return row?.value ?? 0;
  } catch {
    return 0;
  }
}
