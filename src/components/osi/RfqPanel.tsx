// Sending the RFQ, and the round it opens — staff only (Phase V · V06).
//
// Shows who would be written to, what stops the send if anything does, and
// the email itself, word for word: the buyer's free-text description goes out
// as written, so a person reads it before a supplier does.

import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDayTime } from "@/lib/instant";
import { sendRfqBatchFn, type RfqPreview } from "@/lib/rfq-fns";
import { cn } from "@/lib/utils";

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
        <p className="mt-1 text-sm">
          {t("rfq.roundOpen", {
            no: rfq.round.roundNo,
            opened: formatDayTime(rfq.round.openedAt, i18n.language),
            closes: formatDayTime(rfq.round.closesAt, i18n.language),
            hours: rfq.round.windowHours,
          })}
        </p>
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
