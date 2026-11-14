// Sending the RFQ, and the round it opens — staff only (Phase V · V06).
//
// Shows who would be written to, what stops the send if anything does, and
// the email itself, word for word: the buyer's free-text description goes out
// as written, so a person reads it before a supplier does.
//
// And how the round ends (V07): where it stands while it is open, the one
// way a person may end it early — with a reason — and, once closed, what
// closed it and what came back.

import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Send, TimerOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDayTime } from "@/lib/instant";
import { closeRoundEarlyFn, sendRfqBatchFn, type RfqPreview, type RoundView } from "@/lib/rfq-fns";
import { cn } from "@/lib/utils";

/** Ending an open round before its deadline. The note is not optional: this
 *  drops every supplier who has not answered yet, and the reason is the only
 *  thing that lets someone review the decision later. */
function CloseEarly({
  round,
  pending,
  onChanged,
}: {
  round: RoundView;
  /** Everyone the close would drop: written to and silent, plus anyone the
   *  RFQ has not reached yet. */
  pending: number;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const close = async () => {
    setBusy(true);
    setRefusal(null);
    try {
      const result = await closeRoundEarlyFn({ data: { roundId: round.id, note } });
      if (!result.ok) {
        setRefusal(t(`rfq.closeEarly.${result.reason}`));
        return;
      }
      // No message of its own on success: the reload replaces this form with
      // the closed round — reason, author and note — which says it better.
      // (Also true when someone else closed it first: `closed: false`.)
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <div className="mt-4">
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <TimerOff className="size-4" />
          {t("rfq.closeEarly.open")}
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-lg border border-border bg-secondary/40 p-4">
      <p className="text-sm font-semibold">{t("rfq.closeEarly.title")}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {t("rfq.closeEarly.warning", { count: pending })}
      </p>
      <Label htmlFor="close-early-note" className="mt-3 block text-xs font-medium">
        {t("rfq.closeEarly.noteLabel")}
      </Label>
      <Textarea
        id="close-early-note"
        value={note}
        maxLength={500}
        rows={3}
        placeholder={t("rfq.closeEarly.notePlaceholder")}
        onChange={(e) => {
          setRefusal(null);
          setNote(e.target.value);
        }}
        className="mt-1 text-sm"
      />
      {refusal && (
        <p role="alert" className="mt-2 text-xs font-medium text-destructive">
          {refusal}
        </p>
      )}
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => setOpen(false)}>
          {t("rfq.closeEarly.cancel")}
        </Button>
        <Button
          variant="destructive"
          size="sm"
          disabled={busy || note.trim() === ""}
          onClick={() => void close()}
        >
          {t("rfq.closeEarly.confirm")}
        </Button>
      </div>
    </div>
  );
}

/** Where the round stands: its clock and count while open, its outcome once
 *  closed. */
function RoundStatus({ round }: { round: RoundView }) {
  const { t, i18n } = useTranslation();
  if (!round.closedAt) {
    return (
      <>
        <p className="mt-1 text-sm">
          {t("rfq.roundOpen", {
            no: round.roundNo,
            opened: formatDayTime(round.openedAt, i18n.language),
            closes: formatDayTime(round.closesAt, i18n.language),
            hours: round.windowHours,
          })}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("rfq.roundProgress", {
            offers: round.offers,
            target: round.targetOffers,
            awaiting: round.awaiting,
          })}
        </p>
      </>
    );
  }
  return (
    <>
      <p className="mt-1 text-sm">
        {t("rfq.roundClosed", {
          no: round.roundNo,
          closed: formatDayTime(round.closedAt, i18n.language),
        })}{" "}
        {round.closeReason && (
          <span className="rounded bg-secondary px-1.5 py-0.5 text-xs font-semibold">
            {t(`rfq.closeReason.${round.closeReason}`)}
          </span>
        )}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {t("rfq.roundOutcome", { offers: round.offers })}{" "}
        {round.closedByName
          ? t("rfq.closedBy", { name: round.closedByName })
          : t("rfq.closedBySystem")}
      </p>
      {round.earlyNote && (
        <p className="mt-2 rounded-lg bg-secondary/40 px-3 py-2 text-xs">
          <span className="font-semibold">{t("rfq.earlyNote")}</span> {round.earlyNote}
        </p>
      )}
    </>
  );
}

export function RfqPanel({
  requestId,
  rfq,
  onChanged,
}: {
  requestId: string;
  rfq: RfqPreview;
  onChanged: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  const send = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await sendRfqBatchFn({ data: { requestId } });
      if (!result.ok) {
        setMessage({
          text:
            result.reason === "missing_contact" && result.suppliers
              ? t("rfq.blocked.missing_contact_named", { suppliers: result.suppliers.join(", ") })
              : t(`rfq.blocked.${result.reason}`),
          error: true,
        });
        return;
      }
      const closes = formatDayTime(result.round.closesAt, i18n.language);
      setMessage({
        text:
          result.failed.length === 0
            ? t("rfq.sent", { count: result.sent, closes })
            : t("rfq.sentWithFailures", {
                count: result.sent,
                closes,
                failed: result.failed.map((f) => f.supplier).join(", "),
              }),
        error: result.failed.length > 0,
      });
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  // Nothing to show: no round yet and no confirmed shortlist to send.
  if (!rfq.round && rfq.recipients.length === 0 && !message) return null;

  return (
    <section className="card-surface p-6">
      <h2 className="text-base font-semibold">{t("rfq.title")}</h2>

      {rfq.round ? (
        <RoundStatus round={rfq.round} />
      ) : (
        <p className="mt-1 text-xs text-muted-foreground">
          {t("rfq.notSentYet", { hours: rfq.windowHours })}
        </p>
      )}

      {rfq.recipients.length > 0 && (
        <>
          <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {rfq.round ? t("rfq.stillUnsent") : t("rfq.recipients")}
          </p>
          <ul className="mt-2 space-y-1 text-sm">
            {rfq.recipients.map((recipient) => (
              <li
                key={recipient.supplier}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3"
              >
                <span className="truncate">{recipient.supplier}</span>
                {recipient.email ? (
                  <span className="text-xs text-muted-foreground">{recipient.email}</span>
                ) : (
                  <span className="flex items-center gap-1 text-xs text-warning">
                    <AlertTriangle className="size-3.5" />
                    {t("rfq.noContact")}
                  </span>
                )}
              </li>
            ))}
          </ul>

          {rfq.sample && (
            <details className="mt-4 rounded-lg border border-border bg-secondary/30 p-3">
              <summary className="cursor-pointer text-xs font-medium">
                {t("rfq.preview", { to: rfq.sample.to })}
              </summary>
              <p className="mt-3 text-xs text-muted-foreground">
                {t("rfq.replyTo")}{" "}
                <span className="font-medium text-foreground">{rfq.replyTo || "—"}</span>
              </p>
              <p className="mt-2 text-sm font-semibold">{rfq.sample.subject}</p>
              <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-xs leading-relaxed">
                {rfq.sample.text}
              </pre>
            </details>
          )}

          <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-lg border border-border bg-secondary/40 px-4 py-3">
            <p
              role={message?.error || rfq.blockedBy ? "alert" : undefined}
              className={cn(
                "min-w-0 text-xs",
                message?.error || rfq.blockedBy
                  ? "font-medium text-destructive"
                  : "text-muted-foreground",
              )}
            >
              {message?.text ??
                (rfq.blockedBy ? t(`rfq.blocked.${rfq.blockedBy}`) : t("rfq.sendHint"))}
              {rfq.blockedBy === "no_reply_address" && !message && (
                <>
                  {" "}
                  <Link to="/interne/parametres" className="underline underline-offset-2">
                    {t("rfq.openSettings")}
                  </Link>
                </>
              )}
            </p>
            <Button
              variant="gold"
              size="sm"
              disabled={busy || rfq.blockedBy !== null}
              onClick={() => void send()}
            >
              <Send className="size-4" />
              {rfq.round
                ? t("rfq.resend", { count: rfq.recipients.length })
                : t("rfq.send", { count: rfq.recipients.length })}
            </Button>
          </div>
        </>
      )}

      {rfq.round && !rfq.round.closedAt && (
        <CloseEarly
          round={rfq.round}
          pending={rfq.round.awaiting + rfq.recipients.length}
          onChanged={onChanged}
        />
      )}

      {rfq.recipients.length === 0 && message && (
        <p
          className={cn(
            "mt-4 rounded-lg px-3 py-2 text-xs",
            message.error ? "bg-destructive/10 text-destructive" : "bg-secondary",
          )}
        >
          {message.text}
        </p>
      )}
    </section>
  );
}
