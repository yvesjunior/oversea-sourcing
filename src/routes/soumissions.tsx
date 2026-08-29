// Soumissions (Phase P2, parcours steps 05-08).
//
// The buyer's side of the facilitation loop: what OSI was asked to approach,
// and what came back. Staff with the `deals` permission additionally get the
// entry form — the supplier has no account, so every offer is keyed in by the
// person who received it.

import { useState } from "react";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { ChevronRight, ClipboardList } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  acceptQuoteFn,
  getAllQuotesFn,
  getMyQuotesFn,
  recordQuoteFn,
  declineQuoteFn,
  type QuoteView,
} from "@/lib/quote-fns";
import { EmployeeTabs } from "@/components/osi/EmployeeTabs";
import { accountOptions } from "@/components/osi/AccountFilter";
import { applyListFilters, ListFiltersBar, useListFilters } from "@/components/osi/ListFilters";
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
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("CAD");
  const [leadTime, setLeadTime] = useState("");
  const [moq, setMoq] = useState("");
  const [incoterm, setIncoterm] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

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
        {t("soumissions.recordTitle", { supplier: quote.supplierName })}
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
      <div className="mt-3 flex gap-2">
        <Button variant="gold" size="sm" disabled={saving} onClick={() => void save()}>
          {t("soumissions.save")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={saving}
          onClick={() => void declineQuoteFn({ data: { quoteId: quote.id } }).then(onDone)}
        >
          {t("soumissions.decline")}
        </Button>
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
        <StaffQuotes quotes={all.quotes} />
      ) : (
        <QuoteList quotes={mine.quotes} canRecord={mine.canRecord} canAccept={mine.canAct} />
      )}
    </div>
  );
}

/** The ops queue, narrowable by customer account and by period (owner
 *  2026-08-29). Staff see every account's soumissions at once, which is right
 *  for a queue and useless when the question is "where are we with account X",
 *  or "what came in this week". */
function StaffQuotes({ quotes }: { quotes: QuoteView[] }) {
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
      <QuoteList quotes={shown} canRecord showAccount />
    </div>
  );
}

function QuoteList({
  quotes,
  canRecord,
  canAccept = false,
  showAccount = false,
}: {
  quotes: QuoteView[];
  canRecord: boolean;
  /** Only the buyer commits their company to a supplier — never staff. */
  canAccept?: boolean;
  /** Staff lists span accounts, so each dossier names its owner. A buyer has
   *  exactly one account and does not need to be told which. */
  showAccount?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const [openForm, setOpenForm] = useState<string | null>(null);
  const [accepting, setAccepting] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

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
                  <li key={quote.id} className="rounded-lg border border-border p-4">
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
                        {quote.responseHours !== null && (
                          <span className="text-[11px] text-muted-foreground">
                            {t("soumissions.responseTime")}: {quote.responseHours} h
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
                        {canRecord && quote.status === "requested" && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setOpenForm(openForm === quote.id ? null : quote.id)}
                          >
                            {t("soumissions.record")}
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
