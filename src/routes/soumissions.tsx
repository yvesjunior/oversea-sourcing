// Soumissions (Phase P2, parcours steps 05-08).
//
// The buyer's side of the facilitation loop: what OSI was asked to approach,
// and what came back. Staff with the `deals` permission additionally get the
// entry form — the supplier has no account, so every offer is keyed in by the
// person who received it.

import { useEffect, useState } from "react";
import { createFileRoute, Link, useRouter, useRouterState } from "@tanstack/react-router";
import { ChevronRight, ClipboardList } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  acceptQuoteFn,
  markQuoteSentFn,
  getAllQuotesFn,
  getMyQuotesFn,
  recordQuoteFn,
  declineQuoteFn,
  STAFF_DECLINE_REASONS,
  type StaffDeclineReason,
  type QuoteListResult,
  type QuoteView,
  type RequestNeed,
} from "@/lib/quote-fns";
import { EmployeeTabs } from "@/components/osi/EmployeeTabs";
import { accountOptions } from "@/components/osi/AccountFilter";
import { applyListFilters, ListFiltersBar, useListFilters } from "@/components/osi/ListFilters";
import { offerEntryMode } from "@/lib/deal-status";
import type { QuoteStatus } from "@/database/schema";
import { formatInstant } from "@/lib/instant";
import { costQuoteStanding } from "@/lib/pack-explain";
import { PartnerWorkPanel } from "@/components/osi/PartnerWorkPanel";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/soumissions")({
  head: () => ({
    meta: [
      { title: "Soumissions | OSI" },
      {
        name: "description",
        content: "Les offres demandées aux fournisseurs et celles reçues, par dossier.",
      },
    ],
  }),
  loader: async () => {
    // Staff work from the internal workspace while quotes live in the buyer's,
    // so the ops list is a separate query — empty for everyone else.
    const [mine, all] = await Promise.all([getMyQuotesFn(), getAllQuotesFn()]);
    return { mine, all };
  },
  component: Soumissions,
});

const STATUS_STYLE: Record<string, string> = {
  requested: "border-border text-muted-foreground",
  received: "border-gold/50 bg-gold-soft text-gold",
  accepted: "border-success/50 text-success",
  declined: "border-border text-muted-foreground line-through",
  expired: "border-destructive/40 text-destructive",
};

/** What one row IS to a reader today: `expired` once the validity ran out,
 *  whatever the column says (derived server-side, `quote.expired`). */
function shownStatus(quote: QuoteView): QuoteStatus {
  return quote.expired ? "expired" : quote.status;
}

/** yyyy-mm-dd for a date input, in the browser's zone — a validity is a day. */
function dateInputValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** yyyy-mm-ddThh:mm for a datetime-local input, in the browser's zone. */
function dateTimeInputValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dateInputValue(iso)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The default staff see in the field: one calendar month from today. */
function defaultValidityInput(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return dateInputValue(d.toISOString());
}

function money(cents: number | null, currency: string | null, lang: string): string {
  if (cents === null) return "—";
  const value = cents / 100;
  // Store the currency, never convert (ADR-002): a rate source does not exist.
  return currency
    ? new Intl.NumberFormat(lang, { style: "currency", currency }).format(value)
    : value.toLocaleString(lang);
}

/** Staff-only: key in what arrived by email.
 *
 *  `late` = the late-keyed answer (V08): the quote was declined as silent by
 *  its round closing, and the answer — which arrived in time — is only now
 *  being typed. Same form; the answer time starts EMPTY, because "now" is by
 *  definition after the round closed and would be refused. */
function RecordForm({
  quote,
  late = false,
  onDone,
}: {
  quote: QuoteView;
  late?: boolean;
  onDone: () => void;
}) {
  const { t, i18n } = useTranslation();
  // Prefilled when correcting: retyping every field to fix one of them is how
  // the SECOND typo happens.
  const mode = offerEntryMode(quote.status);
  const [amount, setAmount] = useState(
    quote.amountCents !== null ? String(quote.amountCents / 100) : "",
  );
  const [currency, setCurrency] = useState(quote.currency ?? "CAD");
  const [leadTime, setLeadTime] = useState(
    quote.leadTimeDays !== null ? String(quote.leadTimeDays) : "",
  );
  const [moq, setMoq] = useState(quote.moq ?? "");
  const [incoterm, setIncoterm] = useState(quote.incoterm ?? "");
  // Validity (owner 2026-09-14): one month by default, editable. Shown
  // prefilled rather than left blank so the default is a choice staff SEE.
  const [validUntil, setValidUntil] = useState(
    quote.validUntil ? dateInputValue(quote.validUntil) : defaultValidityInput(),
  );
  // When the SUPPLIER answered (V08) — not when this form is filled. Shown
  // prefilled with now on a first entry, because most offers are typed as
  // they arrive; staff move it back when the email is older than that.
  const [initialAnsweredAt] = useState(() =>
    late
      ? ""
      : dateTimeInputValue(mode === "correct" ? quote.respondedAt : new Date().toISOString()),
  );
  const [answeredAt, setAnsweredAt] = useState(initialAnsweredAt);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [notes, setNotes] = useState(quote.notes ?? "");
  // On the pack flow "never answered" is the round's verdict, not a choice:
  // the only thing a person can report there is that the supplier said no.
  const declineReasons = STAFF_DECLINE_REASONS.filter(
    (reason) => !(quote.onPackFlow && reason === "no_response"),
  );
  const [declineReason, setDeclineReason] = useState<StaffDeclineReason>(
    quote.onPackFlow ? "supplier_declined" : "no_response",
  );
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const upload = async (chosen: FileList | null) => {
    if (!chosen || chosen.length === 0) return;
    setUploading(true);
    setUploadError(null);
    try {
      const body = new FormData();
      body.set("quoteId", quote.id);
      for (const file of chosen) body.append("files", file);
      const response = await fetch("/api/quote-document", { method: "POST", body });
      if (!response.ok) {
        // The endpoint refuses by TYPE and SIZE, and the person needs to know
        // which — a silent no-op reads as a broken button.
        setUploadError(t("soumissions.attachError"));
        return;
      }
      const result = (await response.json()) as { documents: unknown[] };
      setUploaded((count) => count + result.documents.length);
    } catch {
      setUploadError(t("soumissions.attachError"));
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setRefusal(null);
    try {
      const parsed = Number.parseFloat(amount.replace(",", "."));
      const result = await recordQuoteFn({
        data: {
          quoteId: quote.id,
          amountCents: Number.isFinite(parsed) ? Math.round(parsed * 100) : null,
          currency: currency.trim() ? currency.trim().toUpperCase().slice(0, 3) : null,
          leadTimeDays: leadTime.trim() ? Number.parseInt(leadTime, 10) : null,
          moq: moq.trim() || null,
          incoterm: incoterm.trim() || null,
          notes: notes.trim() || null,
          // End of the chosen day, in this browser's zone: "valid until the
          // 14th" means the 14th counts.
          validUntil: validUntil ? new Date(`${validUntil}T23:59:59`).toISOString() : null,
          // On a correction, only when it was actually changed: the field
          // has no seconds, so sending back what it was prefilled with would
          // round the stored answer time and log a change nobody made.
          ...(answeredAt && (mode !== "correct" || answeredAt !== initialAnsweredAt)
            ? { respondedAt: new Date(answeredAt).toISOString() }
            : {}),
        },
      });
      // A refusal is data: the form stays open and says which rule it hit,
      // instead of closing as though the offer had been saved.
      if (!result.ok) {
        setRefusal(t(`soumissions.recordRefusal.${result.reason}`));
        return;
      }
      onDone();
    } finally {
      setSaving(false);
    }
  };

  const label = "mb-1 block text-xs font-medium text-muted-foreground";
  return (
    <div className="mt-3 rounded-lg border border-border bg-secondary/40 p-4">
      <p className="mb-3 text-xs font-semibold">
        {t(
          late
            ? "soumissions.lateTitle"
            : mode === "correct"
              ? "soumissions.correctTitle"
              : "soumissions.recordTitle",
          { supplier: quote.supplierName },
        )}
      </p>
      {late && quote.lateAnswerUntil && (
        <p className="-mt-1 mb-3 text-[11px] text-muted-foreground">
          {t("soumissions.lateHint", {
            closed: formatInstant(quote.lateAnswerUntil, i18n.language, {
              day: "numeric",
              month: "short",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            }),
          })}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <div>
          <label className={label} htmlFor={`amt-${quote.id}`}>
            {t("soumissions.price")}
          </label>
          <Input
            id={`amt-${quote.id}`}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="h-9"
            inputMode="decimal"
          />
        </div>
        <div>
          <label className={label} htmlFor={`cur-${quote.id}`}>
            Devise
          </label>
          <Input
            id={`cur-${quote.id}`}
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className="h-9"
            maxLength={3}
          />
        </div>
        <div>
          <label className={label} htmlFor={`lt-${quote.id}`}>
            {t("soumissions.leadTime")}
          </label>
          <Input
            id={`lt-${quote.id}`}
            value={leadTime}
            onChange={(e) => setLeadTime(e.target.value)}
            className="h-9"
            inputMode="numeric"
          />
        </div>
        <div>
          <label className={label} htmlFor={`moq-${quote.id}`}>
            {t("soumissions.moq")}
          </label>
          <Input
            id={`moq-${quote.id}`}
            value={moq}
            onChange={(e) => setMoq(e.target.value)}
            className="h-9"
          />
        </div>
        <div>
          <label className={label} htmlFor={`inc-${quote.id}`}>
            {t("soumissions.incoterm")}
          </label>
          <Input
            id={`inc-${quote.id}`}
            value={incoterm}
            onChange={(e) => setIncoterm(e.target.value)}
            className="h-9"
          />
        </div>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-[220px_220px_minmax(0,1fr)]">
        <div>
          <label className={label} htmlFor={`ra-${quote.id}`}>
            {t("soumissions.answeredAt")}
          </label>
          <Input
            id={`ra-${quote.id}`}
            type="datetime-local"
            value={answeredAt}
            // The same bounds the server enforces, so the picker greys out
            // what would be refused: not before the request reached them, not
            // in the future — and, for a late-keyed answer, not after the
            // round closed.
            min={dateTimeInputValue(quote.sentAt ?? quote.requestedAt)}
            max={dateTimeInputValue(
              late && quote.lateAnswerUntil ? quote.lateAnswerUntil : new Date().toISOString(),
            )}
            onChange={(e) => {
              setRefusal(null);
              setAnsweredAt(e.target.value);
            }}
            className="h-9"
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            {t("soumissions.answeredAtHint")}
          </p>
        </div>
        <div>
          <label className={label} htmlFor={`vu-${quote.id}`}>
            {t("soumissions.validUntil")}
          </label>
          <Input
            id={`vu-${quote.id}`}
            type="date"
            value={validUntil}
            onChange={(e) => setValidUntil(e.target.value)}
            className="h-9"
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            {t("soumissions.validUntilHint")}
          </p>
        </div>
      </div>
      <div className="mt-3">
        <label className={label} htmlFor={`nt-${quote.id}`}>
          {t("soumissions.notes")}
        </label>
        <Textarea
          id={`nt-${quote.id}`}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="min-h-[56px] resize-none text-sm"
        />
      </div>
      {/* The supplier answers by email, so their quotation arrives as a PDF or
          a photo. Staff attach it here, against the quote it belongs to, and
          it shows up on the buyer's Documents page — the offer and its
          paperwork stop living in someone's inbox. */}
      <div className="mt-3 rounded-lg border border-dashed border-border p-3">
        <label className="text-xs font-medium text-muted-foreground" htmlFor={`doc-${quote.id}`}>
          {t("soumissions.attach")}
        </label>
        <input
          id={`doc-${quote.id}`}
          type="file"
          multiple
          accept="application/pdf,image/png,image/jpeg"
          disabled={uploading}
          onChange={(e) => void upload(e.target.files)}
          className="mt-1 block w-full text-xs file:mr-3 file:rounded-md file:border file:border-border file:bg-secondary file:px-3 file:py-1.5 file:text-xs file:font-medium"
        />
        <p className="mt-1 text-[11px] text-muted-foreground">
          {uploadError ??
            (uploaded > 0
              ? t("soumissions.attachDone", { count: uploaded })
              : t("soumissions.attachHint"))}
        </p>
      </div>

      {refusal && (
        <p role="alert" className="mt-3 text-xs font-medium text-destructive">
          {refusal}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="gold" size="sm" disabled={saving} onClick={() => void save()}>
          {t(mode === "correct" ? "soumissions.saveCorrection" : "soumissions.save")}
        </Button>
        {/* Not on a late-keyed answer: that quote is already declined — the
            only thing to do here is record the offer or leave it be. */}
        {!late && (
          <>
            {/* The reason is REQUIRED, so it is picked here rather than asked for
                in a second step: a decline with no reason is the row that taught
                the supplier graph nothing. `lost` is absent on purpose — staff
                never choose it, acceptQuoteFn writes it for the siblings. */}
            <select
              aria-label={t("soumissions.declineReasonLabel")}
              value={declineReason}
              onChange={(e) => setDeclineReason(e.target.value as StaffDeclineReason)}
              className="h-9 rounded-lg border border-border bg-background px-2 text-sm"
            >
              {declineReasons.map((reason) => (
                <option key={reason} value={reason}>
                  {t(`soumissions.declineReason.${reason}`)}
                </option>
              ))}
            </select>
            <Button
              variant="outline"
              size="sm"
              disabled={saving}
              onClick={() =>
                void declineQuoteFn({
                  data: {
                    quoteId: quote.id,
                    reason: declineReason,
                    ...(notes ? { note: notes } : {}),
                  },
                }).then(onDone)
              }
            >
              {t("soumissions.decline")}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function Soumissions() {
  const { t } = useTranslation();
  const { mine, all } = Route.useLoaderData();
  const isStaff = all.canRecord;

  return (
    <div className="space-y-6 pt-6">
      <header>
        <h1 className="font-display text-2xl font-semibold">{t("soumissions.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("soumissions.subtitle", { count: isStaff ? all.quotes.length : mine.quotes.length })}
        </p>
      </header>

      {/* No "Mes données": staff stand in OSI's own workspace, which holds no
          soumissions by rule (owner 2026-08-29). Their own dossiers live in
          their personal workspace, one switch away. */}
      {isStaff ? (
        <StaffQuotes quotes={all.quotes} needs={all.needs} contacts={all.contacts} />
      ) : (
        <QuoteList
          quotes={mine.quotes}
          needs={mine.needs}
          canRecord={mine.canRecord}
          canAccept={mine.canAct}
        />
      )}
    </div>
  );
}

/** The ops queue, narrowable by customer account and by period (owner
 *  2026-08-29). Staff see every account's soumissions at once, which is right
 *  for a queue and useless when the question is "where are we with account X",
 *  or "what came in this week". */
function StaffQuotes({
  quotes,
  needs,
  contacts,
}: {
  quotes: QuoteView[];
  needs: Record<string, RequestNeed>;
  contacts: QuoteListResult["contacts"];
}) {
  const filters = useListFilters();
  // Filtered on requestedAt — when OSI ASKED. The answer's date would move a
  // dossier between periods every time a supplier replied, which is not what
  // "the soumissions of this week" means to the person asking.
  const shown = applyListFilters(quotes, filters, {
    accountOf: (quote) => quote.organizationId,
    dateOf: (quote) => quote.requestedAt,
  });

  return (
    <div className="space-y-4">
      <ListFiltersBar
        filters={filters}
        accounts={accountOptions(quotes)}
        total={quotes.length}
        shown={shown.length}
      />
      <QuoteList quotes={shown} needs={needs} contacts={contacts} canRecord showAccount />
    </div>
  );
}

function QuoteList({
  quotes,
  needs,
  contacts,
  canRecord,
  canAccept = false,
  showAccount = false,
}: {
  quotes: QuoteView[];
  /** The specification behind each request, keyed by request id. */
  needs: Record<string, RequestNeed>;
  /** Who to write to, per supplier — passed by the staff list only. Absent on
   *  a buyer's list, which is what keeps the address off their screen. */
  contacts?: QuoteListResult["contacts"] | undefined;
  canRecord: boolean;
  /** Only the buyer commits their company to a supplier — never staff. */
  canAccept?: boolean;
  /** Staff lists span accounts, so each dossier names its owner. A buyer has
   *  exactly one account and does not need to be told which. */
  showAccount?: boolean;
}) {
  const { t, i18n } = useTranslation();
  // Arriving from a document's "soumission" link: bring the row into view and
  // mark it, because a list of offers all look alike and "it scrolled a bit"
  // is not an answer to "which one".
  const hash = useRouterState({ select: (state) => state.location.hash });
  const highlighted = hash.startsWith("quote-") ? hash.slice("quote-".length) : null;
  useEffect(() => {
    if (!highlighted) return;
    document.getElementById(`quote-${highlighted}`)?.scrollIntoView({ block: "center" });
  }, [highlighted]);
  const router = useRouter();
  const [openForm, setOpenForm] = useState<string | null>(null);
  const [accepting, setAccepting] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [marking, setMarking] = useState<string | null>(null);

  const markSent = async (quote: QuoteView) => {
    setMarking(quote.id);
    try {
      await markQuoteSentFn({ data: { quoteIds: [quote.id] } });
      await router.invalidate();
    } finally {
      setMarking(null);
    }
  };

  const accept = async (quote: QuoteView) => {
    setAccepting(quote.id);
    setRefusal(null);
    try {
      const result = await acceptQuoteFn({ data: { quoteId: quote.id } });
      if (result.ok) {
        await router.invalidate();
      } else {
        // A refusal is data, not an exception — the buyer needs to know WHY.
        setRefusal(t(`soumissions.refusal_${result.reason}`));
      }
    } finally {
      setAccepting(null);
    }
  };

  // Grouped by request: comparing offers only means something within one need.
  const byRequest = new Map<string, QuoteView[]>();
  for (const quote of quotes) {
    const list = byRequest.get(quote.requestId) ?? [];
    list.push(quote);
    byRequest.set(quote.requestId, list);
  }

  return (
    <>
      {quotes.length === 0 ? (
        <div className="card-surface border-dashed px-6 py-12 text-center">
          <ClipboardList className="mx-auto size-8 text-muted-foreground/50" />
          <p className="mt-3 text-sm text-muted-foreground">{t("soumissions.empty")}</p>
        </div>
      ) : (
        <div className="space-y-6">
          {[...byRequest.entries()].map(([requestId, list]) => (
            <section key={requestId} className="card-surface p-5">
              <Link
                to="/demandes/$id"
                params={{ id: requestId }}
                className="group flex items-center gap-2 text-sm font-semibold transition-colors hover:text-gold"
              >
                #{requestId} — {list[0]?.requestTitle}
                <ChevronRight className="size-4 opacity-0 transition-opacity group-hover:opacity-100" />
              </Link>
              {showAccount && list[0] && (
                <p className="mt-1 text-xs text-muted-foreground">{list[0].organizationName}</p>
              )}

              {/* What the supplier was actually asked. Staff keying in a reply
                  need the specification in front of them — sending them to the
                  dossier in another tab is how the wrong figure gets typed. */}
              {needs[requestId] && (
                <details className="mt-3 rounded-lg border border-border bg-secondary/30 p-3">
                  <summary className="cursor-pointer text-xs font-medium">
                    {t("soumissions.viewRequest")}
                  </summary>
                  <p className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">
                    {needs[requestId]?.description}
                  </p>
                  {(needs[requestId]?.criteria.length ?? 0) > 0 && (
                    <ul className="mt-2 flex flex-wrap gap-1.5">
                      {needs[requestId]?.criteria.map((criterion) => (
                        <li
                          key={`${criterion.label}-${criterion.value}`}
                          className="rounded-full border border-border px-2 py-0.5 text-[11px]"
                        >
                          <span className="text-muted-foreground">{criterion.label} : </span>
                          {criterion.value}
                          {criterion.unit ? ` ${criterion.unit}` : ""}
                        </li>
                      ))}
                    </ul>
                  )}
                </details>
              )}

              {list.filter((q) => shownStatus(q) === "received").length > 1 && canAccept && (
                <p className="mt-2 text-xs text-muted-foreground">{t("soumissions.compareHint")}</p>
              )}
              {refusal && (
                <p role="alert" className="mt-2 text-xs text-destructive">
                  {refusal}
                </p>
              )}

              <ul className="mt-4 space-y-3">
                {list.map((quote) => (
                  // Anchor target for the Documents page: a document names the
                  // quote it arrived against, and the reader must be able to
                  // GET there, not just read a supplier's name.
                  <li
                    key={quote.id}
                    id={`quote-${quote.id}`}
                    className={cn(
                      "rounded-lg border p-4 scroll-mt-24",
                      highlighted === quote.id ? "border-gold bg-gold-soft/30" : "border-border",
                    )}
                  >
                    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                      <div className="min-w-0">
                        <span className="block truncate text-sm font-semibold">
                          {quote.supplierName}
                        </span>
                        {/* Who to write to, while there is still something to
                            send or to chase (V02). Staff lists only. */}
                        {contacts && quote.status === "requested" && (
                          <span className="block truncate text-xs">
                            {quote.supplierId && contacts[quote.supplierId] ? (
                              <>
                                <span className="text-muted-foreground">
                                  {t("soumissions.writeTo")}{" "}
                                </span>
                                <a
                                  href={`mailto:${contacts[quote.supplierId]?.email}`}
                                  className="font-medium underline-offset-2 hover:underline"
                                >
                                  {contacts[quote.supplierId]?.email}
                                </a>
                              </>
                            ) : (
                              <span className="text-warning">{t("soumissions.noContact")}</span>
                            )}
                          </span>
                        )}
                        {/* "Awaiting an answer" is true of a request still
                            out, and of nothing else: a declined quote is not
                            waiting for anyone. */}
                        {(quote.status === "received" ||
                          quote.status === "accepted" ||
                          quote.status === "requested") && (
                          <span className="text-xs text-muted-foreground">
                            {quote.status === "requested"
                              ? t("soumissions.awaiting")
                              : `${money(quote.amountCents, quote.currency, i18n.language)} · ${
                                  quote.leadTimeDays !== null
                                    ? `${quote.leadTimeDays} j`
                                    : t("soumissions.leadTime")
                                }${quote.incoterm ? ` · ${quote.incoterm}` : ""}`}
                          </span>
                        )}
                        {/* Until when the offer stands — and, once it has run
                            out, what the buyer can do about it. */}
                        {quote.status === "received" && quote.validUntil && (
                          <span
                            className={cn(
                              "block text-[11px]",
                              quote.expired ? "text-destructive" : "text-muted-foreground",
                            )}
                          >
                            {t(
                              quote.expired ? "soumissions.expiredOn" : "soumissions.validUntilOn",
                              {
                                date: formatInstant(quote.validUntil, i18n.language, {
                                  day: "numeric",
                                  month: "short",
                                  year: "numeric",
                                }),
                              },
                            )}
                          </span>
                        )}
                        {/* What partners added to this offer (V22). Each with
                            ITS currency and validity: nothing is summed here,
                            and a figure in another currency than the offer's
                            is said to be one. */}
                        {quote.enrichments.map((enrichment) => {
                          const standing = costQuoteStanding(enrichment, quote, new Date());
                          return (
                            <span
                              key={enrichment.kind}
                              className={cn(
                                "block text-[11px]",
                                standing === "expired"
                                  ? "text-destructive"
                                  : "text-muted-foreground",
                              )}
                            >
                              {t(`packView.cost.${enrichment.kind}`)} :{" "}
                              <span className="font-medium text-foreground">
                                {money(enrichment.amountCents, enrichment.currency, i18n.language)}
                              </span>{" "}
                              —{" "}
                              {enrichment.units
                                ? `${t("partnerWork.forUnits", { units: enrichment.units.toLocaleString(i18n.language) })} — `
                                : ""}
                              {t(`partnerWork.standing.${standing}`, {
                                incoterm: quote.incoterm ?? "",
                              })}
                            </span>
                          );
                        })}
                      </div>
                      <div className="flex items-center gap-3">
                        {/* WHY it is out of the running, not just that it is —
                            "lost" and "no response" look identical otherwise,
                            and they mean opposite things about a supplier. */}
                        {quote.status === "declined" && quote.declineReason && (
                          <span className="text-[11px] text-muted-foreground">
                            {t(`soumissions.declineReason.${quote.declineReason}`)}
                          </span>
                        )}
                        {quote.responseHours !== null && (
                          <span
                            className="text-[11px] text-muted-foreground"
                            // A figure measured from the buyer's ask still
                            // contains OSI's own lag. Say so rather than let it
                            // be read as supplier responsiveness.
                            title={
                              quote.responseFrom === "requested"
                                ? t("soumissions.responseFromRequested")
                                : undefined
                            }
                          >
                            {t("soumissions.responseTime")}: {quote.responseHours} h
                            {quote.responseFrom === "requested" && " *"}
                          </span>
                        )}
                        {/* Which route the answer came by (V08): OSI's
                            transcription of an email, or the supplier's own
                            entry. Only where there IS an answer. */}
                        {quote.channel &&
                          (quote.status === "received" || quote.status === "accepted") && (
                            <span
                              title={t(`soumissions.channelHint.${quote.channel}`)}
                              className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
                            >
                              {t(`soumissions.channel.${quote.channel}`)}
                            </span>
                          )}
                        <span
                          className={cn(
                            "rounded-full border px-2.5 py-0.5 text-[11px] font-semibold",
                            STATUS_STYLE[shownStatus(quote)],
                          )}
                        >
                          {t(`soumissions.${shownStatus(quote)}`)}
                        </span>
                        {canAccept && shownStatus(quote) === "received" && (
                          <Button
                            variant="gold"
                            size="sm"
                            disabled={accepting !== null}
                            onClick={() => void accept(quote)}
                          >
                            {t("soumissions.accept")}
                          </Button>
                        )}
                        {/* Step 06: the email goes out by hand, so the only
                            thing the platform can do is record that it did —
                            and that stamp is what makes the response time a
                            SUPPLIER measurement rather than ours plus theirs. */}
                        {/* Pack flow: the platform sends the RFQ itself, as
                            one batch, from the dossier — there is no hand-set
                            stamp to offer, only the way to where it is sent. */}
                        {canRecord &&
                          quote.onPackFlow &&
                          quote.status === "requested" &&
                          !quote.sentAt && (
                            <Button variant="outline" size="sm" asChild>
                              <Link to="/demandes/$id" params={{ id: quote.requestId }}>
                                {t("soumissions.sendFromDossier")}
                              </Link>
                            </Button>
                          )}
                        {canRecord &&
                          !quote.onPackFlow &&
                          quote.status === "requested" &&
                          !quote.sentAt && (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={marking === quote.id}
                              onClick={() => void markSent(quote)}
                            >
                              {t("soumissions.markSent")}
                            </Button>
                          )}
                        {/* Open for a RECEIVED quote too: a mistyped price
                            used to be permanent, because this button was the
                            only way in and it only appeared before the answer
                            was recorded. Frozen once accepted or declined —
                            offerEntryMode returns null and the button is gone. */}
                        {canRecord &&
                          offerEntryMode(shownStatus(quote)) !== null &&
                          // Pack flow: no offer before the RFQ has left — the
                          // server refuses it (`rfq_not_sent`), so the button
                          // is not offered either.
                          !(quote.onPackFlow && quote.status === "requested" && !quote.sentAt) && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setOpenForm(openForm === quote.id ? null : quote.id)}
                            >
                              {t(
                                offerEntryMode(shownStatus(quote)) === "correct"
                                  ? "soumissions.correct"
                                  : "soumissions.record",
                              )}
                            </Button>
                          )}
                        {/* The late-keyed answer (V08): the round closed
                            and declined this supplier as silent, but an
                            answer that arrived in time can still be typed in
                            while the pack is in review. */}
                        {canRecord && quote.lateAnswerUntil && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setOpenForm(openForm === quote.id ? null : quote.id)}
                          >
                            {t("soumissions.recordLate")}
                          </Button>
                        )}
                      </div>
                    </div>
                    {openForm === quote.id && (
                      <RecordForm
                        quote={quote}
                        late={quote.lateAnswerUntil !== null}
                        onDone={() => {
                          setOpenForm(null);
                          void router.invalidate();
                        }}
                      />
                    )}
                    {/* Step 08 (V22): ask a partner what only a partner knows
                        about THIS offer. Staff only, and only on an offer
                        that exists. */}
                    {canRecord && (quote.status === "received" || quote.status === "accepted") && (
                      <PartnerWorkPanel quoteId={quote.id} offerCurrency={quote.currency} />
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
