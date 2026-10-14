// Email adapter (B3/B9, 2026-08-23) — the house vendor rule: nothing else
// imports or knows which provider sends the mail, so swapping one rewrites
// this file and nothing else. Plain fetch, no SDK — the adapter IS the seam,
// an SDK would just be a second wrapper.
//
//   RESEND_API_KEY    → Resend (POST /emails, success is 200 + {id})
//   unset             → logged to stdout (fresh dev clones)
//   MAIL_SILENT=true  → logged even with a key (flow tests without sending)
//
// SendGrid was the provider from 2026-08-23 until 2026-10-13. It is gone, not
// kept as a fallback: it has had no free tier since May 2025, the trial ended,
// and the owner ruled out paying — so the "fallback" was a branch that could
// only ever fail. The dual-provider dispatch existed to make the cutover
// safe, and once Resend was proven in prod it was just a second contract to
// keep in step (202 vs 200, different error vocabularies) for no benefit.
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

// Overridable so the outbox can be exercised against a stub that actually
// SUCCEEDS — the one path a unit test cannot reach and the one that, if
// wrong, re-sends every message forever. Unset outside tests.
const RESEND_URL = process.env["RESEND_API_URL"] ?? "https://api.resend.com/emails";

type Provider = { key: string };

/** The configured provider, or null to log instead of send. */
function provider(): Provider | null {
  if (process.env["MAIL_SILENT"] === "true") return null;
  const key = process.env["RESEND_API_KEY"];
  return key ? { key } : null;
}

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

/**
 * One delivery attempt — the only code in the codebase that talks to a mail
 * provider.
 *
 * `idempotencyKey` is passed to Resend so a retry of a message that actually
 * WAS delivered (we sent it, the response was lost) does not arrive twice.
 * Resend expires these after 24 h, and our backoff can exceed that, so it
 * narrows the window rather than closing it — the right trade, since the
 * alternative to a rare duplicate is a lost password reset. SendGrid's v3
 * send endpoint has no equivalent.
 */
async function deliver(input: MailInput, via: Provider, idempotencyKey?: string): Promise<Attempt> {
  const from = process.env["MAIL_FROM"] ?? "no-reply@osi-solutions.com";
  const fromName = process.env["MAIL_FROM_NAME"] ?? "OSI";
  try {
    const response = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${via.key}`,
        "content-type": "application/json",
        ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from: `${fromName} <${from}>`,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        ...(input.text ? { text: input.text } : {}),
      }),
    });
    // Resend answers 200 with the message id.
    if (response.status === 200) return { ok: true };
    const body = await response.text().catch(() => "");
    console.error(`mail: resend refused (${response.status}) — ${body.slice(0, 300)}`);
    return {
      ok: false,
      error: `resend_${response.status}: ${body.slice(0, 200)}`,
      retryable: isRetryableStatus(response.status),
    };
  } catch (error) {
    console.error("mail: send failed —", error);
    return { ok: false, error: `network: ${String(error).slice(0, 200)}`, retryable: true };
  }
}

/** Keep a message the provider would not take. Never throws: the outbox is a
 *  safety net, and a safety net that can break the caller is worse than none. */
async function remember(
  input: MailInput,
  attempt: Attempt & { ok: false },
  idempotencyKey: string,
): Promise<boolean> {
  try {
    const [{ db }, schema] = await Promise.all([import("@/database"), import("@/database/schema")]);
    await db.insert(schema.mailOutbox).values({
      // The row IS the idempotency key — the failed first attempt already
      // carried it, so every retry repeats that same key rather than minting
      // a new one and risking a second copy of a message that did land.
      id: idempotencyKey,
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
  const via = provider();

  if (!via) {
    const why = process.env["MAIL_SILENT"] === "true" ? "silent" : "no_key";
    console.log(
      `mail (${why}): to=${input.to} subject="${input.subject}"\n${input.text ?? input.html}`,
    );
    return { ok: true, skipped: why };
  }

  // A fresh send has no outbox row yet, so its idempotency key is minted here
  // and travels with the message into the outbox — the retry then carries the
  // SAME key as the attempt that may already have landed.
  const idempotencyKey = crypto.randomUUID();
  const attempt = await deliver(input, via, idempotencyKey);
  if (attempt.ok) return { ok: true };
  const queued = await remember(input, attempt, idempotencyKey);
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
  const via = provider();
  if (!via) return outcome;

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
      via,
      // The row's OWN id is the idempotency key: stable across every retry,
      // which is exactly what makes a duplicate impossible inside Resend's
      // 24 h window.
      row.id,
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
