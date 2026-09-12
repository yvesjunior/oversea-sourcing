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
  type QuoteView,
  type RequestNeed,
} from "@/lib/quote-fns";
import { EmployeeTabs } from "@/components/osi/EmployeeTabs";
import { accountOptions } from "@/components/osi/AccountFilter";
import { applyListFilters, ListFiltersBar, useListFilters } from "@/components/osi/ListFilters";
import { offerEntryMode } from "@/lib/deal-status";
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
  expired: "border-border text-muted-foreground",
};

function money(cents: number | null, currency: string | null, lang: string): string {
  if (cents === null) return "—";
  const value = cents / 100;
  // Store the currency, never convert (ADR-002): a rate source does not exist.
  return currency
    ? new Intl.NumberFormat(lang, { style: "currency", currency }).format(value)
    : value.toLocaleString(lang);
}

/** Staff-only: key in what arrived by email. */
function RecordForm({ quote, onDone }: { quote: QuoteView; onDone: () => void }) {
  const { t } = useTranslation();
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
  const [notes, setNotes] = useState(quote.notes ?? "");
  const [declineReason, setDeclineReason] = useState<StaffDeclineReason>("no_response");
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
    try {
      const parsed = Number.parseFloat(amount.replace(",", "."));
      await recordQuoteFn({
        data: {
          quoteId: quote.id,
          amountCents: Number.isFinite(parsed) ? Math.round(parsed * 100) : null,
          currency: currency.trim() ? currency.trim().toUpperCase().slice(0, 3) : null,
          leadTimeDays: leadTime.trim() ? Number.parseInt(leadTime, 10) : null,
          moq: moq.trim() || null,
          incoterm: incoterm.trim() || null,
          notes: notes.trim() || null,
        },
      });
      onDone();
    } finally {
      setSaving(false);
    }
  };

  const label = "mb-1 block text-xs font-medium text-muted-foreground";
  return (
    <div className="mt-3 rounded-lg border border-border bg-secondary/40 p-4">
      <p className="mb-3 text-xs font-semibold">
        {t(mode === "correct" ? "soumissions.correctTitle" : "soumissions.recordTitle", {
          supplier: quote.supplierName,
        })}
      </p>
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

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="gold" size="sm" disabled={saving} onClick={() => void save()}>
          {t(mode === "correct" ? "soumissions.saveCorrection" : "soumissions.save")}
        </Button>
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
          {STAFF_DECLINE_REASONS.map((reason) => (
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
              data: { quoteId: quote.id, reason: declineReason, ...(notes ? { note: notes } : {}) },
            }).then(onDone)
          }
        >
          {t("soumissions.decline")}
        </Button>
      </div>
    </div>
  );
}

/** What staff can choose when closing an offer. `lost` is deliberately not
 *  here: it means "the buyer accepted someone else", which acceptQuoteFn
 *  writes for the siblings — offering it as a manual choice would invite the
 *  one value that must stay machine-written to stay trustworthy. */
const STAFF_DECLINE_REASONS = ["no_response", "supplier_declined"] as const;
type StaffDeclineReason = (typeof STAFF_DECLINE_REASONS)[number];

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
        <StaffQuotes quotes={all.quotes} needs={all.needs} />
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
}: {
  quotes: QuoteView[];
  needs: Record<string, RequestNeed>;
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
      <QuoteList quotes={shown} needs={needs} canRecord showAccount />
    </div>
  );
}

function QuoteList({
  quotes,
  needs,
  canRecord,
  canAccept = false,
  showAccount = false,
}: {
  quotes: QuoteView[];
  /** The specification behind each request, keyed by request id. */
  needs: Record<string, RequestNeed>;
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

              {list.filter((q) => q.status === "received").length > 1 && canAccept && (
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
                        <span className="text-xs text-muted-foreground">
                          {quote.status === "received" || quote.status === "accepted"
                            ? `${money(quote.amountCents, quote.currency, i18n.language)} · ${
                                quote.leadTimeDays !== null
                                  ? `${quote.leadTimeDays} j`
                                  : t("soumissions.leadTime")
                              }${quote.incoterm ? ` · ${quote.incoterm}` : ""}`
                            : t("soumissions.awaiting")}
                        </span>
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
                        <span
                          className={cn(
                            "rounded-full border px-2.5 py-0.5 text-[11px] font-semibold",
                            STATUS_STYLE[quote.status],
                          )}
                        >
                          {t(`soumissions.${quote.status}`)}
                        </span>
                        {canAccept && quote.status === "received" && (
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
                        {canRecord && quote.status === "requested" && !quote.sentAt && (
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
                        {canRecord && offerEntryMode(quote.status) !== null && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setOpenForm(openForm === quote.id ? null : quote.id)}
                          >
                            {t(
                              offerEntryMode(quote.status) === "correct"
                                ? "soumissions.correct"
                                : "soumissions.record",
                            )}
                          </Button>
                        )}
                      </div>
                    </div>
                    {openForm === quote.id && (
                      <RecordForm
                        quote={quote}
                        onDone={() => {
                          setOpenForm(null);
                          void router.invalidate();
                        }}
                      />
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
