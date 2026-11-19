// The Decision Pack, as the buyer reads it (Phase V · V12).
//
// The pack flow's answer: the offers OSI obtained, in the order OSI proposes,
// each with what the supplier stated, what OSI observed about it, and a
// landed-cost block that says what is known and LABELS what is not.
//
// What this page must never show: the computed order behind a correction,
// the note that went with it, an offer staff withheld, staff's own remarks on
// an offer. None of that reaches this file — the server fn returns the buyer
// projection (`projectPack`) and nothing else, for staff previewing too.
//
// Choosing (V13): a `buyer` seat accepts ONE offer here, and that opens the
// dossier de transaction — the same act as on the report flow, tied to the
// pack it was chosen from. An offer whose validity ran out cannot be
// accepted; it can be asked for again, which reopens the RFQ for that
// supplier. A `viewer` seat reads everything and can do neither, and staff
// previewing a customer's pack never act on their behalf.

import { useState } from "react";
import { createFileRoute, Link, redirect, useRouter } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft, CheckCircle2, Download, FileText, Info, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CountryTag } from "@/components/osi/CountryTag";
import { formatDay, formatDayTime, formatInstant } from "@/lib/instant";
import { explainOffer, landedCostLines } from "@/lib/pack-explain";
import {
  getRequestPackFn,
  reaskExpiredOfferFn,
  type BuyerPackData,
  type PackDocument,
  type PackItemView,
  type PackOfferSnapshot,
  type PackOfferState,
} from "@/lib/pack-fns";
import { acceptQuoteFn } from "@/lib/quote-fns";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/demandes/$id_/pack")({
  head: ({ params }) => ({
    meta: [{ title: `Decision Pack — demande #${params.id} | OSI` }],
  }),
  loader: async ({ params }): Promise<BuyerPackData> => {
    const pack = await getRequestPackFn({ data: { requestId: params.id } });
    // No released pack (still in review, refused, withdrawn) or not the
    // reader's to see: the dossier is where that is explained.
    if (!pack) throw redirect({ to: "/demandes/$id", params: { id: params.id } });
    return pack;
  },
  component: DecisionPackPage,
});

function money(cents: number | null, currency: string | null, lang: string): string | null {
  if (cents === null) return null;
  const value = cents / 100;
  // In the currency the supplier quoted in — never converted (ADR-002).
  return currency
    ? new Intl.NumberFormat(lang, { style: "currency", currency }).format(value)
    : value.toLocaleString(lang);
}

const VERIFICATION_STYLE: Record<string, string> = {
  verified: "border-success/50 text-success",
  pending: "border-border text-muted-foreground",
  unverified: "border-border text-muted-foreground",
  rejected: "border-destructive/40 text-destructive",
};

function Figure({ label, value }: { label: string; value: string | null }) {
  const { t } = useTranslation();
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={cn("break-words text-sm", value ? "font-medium" : "text-muted-foreground")}>
        {value ?? t("packView.notStated")}
      </dd>
    </div>
  );
}

const STATE_STYLE: Record<PackOfferState, string> = {
  open: "",
  expired: "border-destructive/40 text-destructive",
  accepted: "border-success/50 text-success",
  lost: "border-border text-muted-foreground",
  reasked: "border-border text-muted-foreground",
  unavailable: "border-border text-muted-foreground",
};

/** What a `buyer` seat can do with one offer — accept it, or ask for it
 *  again once it has expired. Accepting is terminal (one offer, one dossier),
 *  so it takes a second click. */
function OfferActions({
  item,
  state,
  onChanged,
}: {
  item: PackItemView;
  state: PackOfferState;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const quoteId = item.quoteId;
  if (!quoteId || (state !== "open" && state !== "expired")) return null;

  const accept = async () => {
    setBusy(true);
    setRefusal(null);
    try {
      const result = await acceptQuoteFn({ data: { quoteId } });
      // A refusal is data, not an exception — the buyer needs to know WHY.
      if (!result.ok) setRefusal(t(`soumissions.refusal_${result.reason}`));
      else onChanged();
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };
  const reask = async () => {
    setBusy(true);
    setRefusal(null);
    try {
      const result = await reaskExpiredOfferFn({ data: { quoteId } });
      if (!result.ok) setRefusal(t(`packView.reaskRefusal.${result.reason}`));
      else onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-5 border-t border-border pt-4 print:hidden">
      {state === "open" &&
        (confirming ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="min-w-0 flex-1 text-sm">
              {t("packView.acceptConfirm", { supplier: item.offer.supplierName })}
            </p>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirming(false)}>
              {t("packView.cancel")}
            </Button>
            <Button variant="gold" size="sm" disabled={busy} onClick={() => void accept()}>
              <CheckCircle2 className="size-4" />
              {t("packView.acceptYes")}
            </Button>
          </div>
        ) : (
          <Button variant="gold" size="sm" onClick={() => setConfirming(true)}>
            {t("packView.accept")}
          </Button>
        ))}
      {state === "expired" && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="min-w-0 flex-1 text-xs text-muted-foreground">{t("packView.reaskHint")}</p>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void reask()}>
            <RotateCcw className="size-4" />
            {t("packView.reask")}
          </Button>
        </div>
      )}
      {refusal && (
        <p role="alert" className="mt-2 text-xs font-medium text-destructive">
          {refusal}
        </p>
      )}
    </div>
  );
}

function Offer({
  item,
  shown,
  documents,
  state,
  actions,
}: {
  item: PackItemView;
  /** Every offer on this page — what this one is compared with. */
  shown: PackOfferSnapshot[];
  documents: PackDocument[];
  /** Where the offer stands now — the pack is frozen, this is not. */
  state: PackOfferState;
  /** The buttons, when this reader may act and the pack is current. */
  actions: React.ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const { offer } = item;
  const price = money(offer.amountCents, offer.currency, i18n.language);
  const observed = explainOffer(offer, shown, item);
  const costs = landedCostLines(offer);

  return (
    <li className="card-surface break-inside-avoid p-6 print:border print:shadow-none">
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-4">
        <span className="flex size-10 items-center justify-center rounded-full bg-gold-soft font-display text-lg font-semibold text-gold">
          {item.rank}
        </span>
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold">{offer.supplierName}</h2>
          {offer.supplierCountry && <CountryTag code={offer.supplierCountry} className="mt-1" />}
        </div>
        <span className="flex flex-wrap items-center justify-end gap-2">
          {/* Only when it is no longer simply "on offer": expired, accepted,
              not retained, asked for again. */}
          {state !== "open" && (
            <span
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-[11px] font-semibold",
                STATE_STYLE[state],
              )}
            >
              {t(`packView.state.${state}`)}
            </span>
          )}
          {offer.supplierVerification && (
            <span
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-[11px] font-semibold",
                VERIFICATION_STYLE[offer.supplierVerification],
              )}
            >
              {t(`packView.verification.${offer.supplierVerification}`)}
            </span>
          )}
        </span>
      </div>

      {/* What the supplier stated. A figure they did not give is said to be
          missing, never left as a blank the reader has to interpret. */}
      <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        <Figure label={t("packView.price")} value={price} />
        <Figure
          label={t("packView.leadTime")}
          value={
            offer.leadTimeDays !== null ? t("packView.days", { count: offer.leadTimeDays }) : null
          }
        />
        <Figure label={t("packView.incoterm")} value={offer.incoterm} />
        <Figure
          label={t("packView.validUntil")}
          value={
            offer.validUntil
              ? formatInstant(offer.validUntil, i18n.language, {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })
              : null
          }
        />
        <Figure label={t("packView.quantity")} value={offer.quantity} />
        <Figure label={t("packView.moq")} value={offer.moq} />
        <Figure label={t("packView.paymentTerms")} value={offer.paymentTerms} />
        <Figure
          label={t("packView.channel")}
          value={offer.channel ? t(`packView.channelValue.${offer.channel}`) : null}
        />
      </dl>

      {observed.length > 0 && (
        <div className="mt-5">
          <h3 className="text-sm font-semibold">{t("packView.observedTitle")}</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {observed.map((line) => (
              <li key={line.key}>{t(`packView.explain.${line.key}`, line.params ?? {})}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-5 rounded-lg border border-border bg-secondary/30 p-4">
        <h3 className="text-sm font-semibold">{t("packView.costTitle")}</h3>
        <dl className="mt-2 divide-y divide-border text-sm">
          {costs.map((line) => (
            <div key={line.key} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 py-1.5">
              <dt>{t(`packView.cost.${line.key}`)}</dt>
              <dd
                className={cn(
                  "text-right",
                  line.state === "stated" && "font-semibold",
                  line.state === "not_provided" && "text-warning",
                  line.state === "applies_unquoted" && "text-muted-foreground",
                  line.state === "quoted" &&
                    line.quote?.standing === "expired" &&
                    "text-destructive",
                )}
              >
                {line.key === "goods" && line.state === "stated" ? (
                  price
                ) : line.state === "quoted" && line.quote ? (
                  // A partner's figure (V22): its own amount, in its own
                  // currency. What can be said about it next to the
                  // supplier's price is the row below.
                  <span className="font-semibold">
                    {money(line.quote.amountCents, line.quote.currency, i18n.language)}
                  </span>
                ) : (
                  t(`packView.costState.${line.state}`, { incoterm: offer.incoterm ?? "" })
                )}
              </dd>
              {line.state === "quoted" && line.quote && (
                // Its own row, full width: beside the amount it squeezed the
                // line's name off the grid.
                <dd
                  className={cn(
                    "col-span-2 text-right text-xs",
                    line.quote.standing === "expired"
                      ? "text-destructive"
                      : "text-muted-foreground",
                  )}
                >
                  {t(
                    line.quote.standing === "addable" && !line.quote.validUntil
                      ? "packView.quoteStanding.addable_open"
                      : `packView.quoteStanding.${line.quote.standing}`,
                    {
                      date: line.quote.validUntil
                        ? formatDay(line.quote.validUntil, i18n.language, "long")
                        : "",
                      incoterm: offer.incoterm ?? "",
                    },
                  )}
                </dd>
              )}
            </div>
          ))}
        </dl>
        {/* No total, and the page says why — a sum that left out what is not
            known would be the one wrong number here. */}
        <p className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          {t("packView.noTotal")}
        </p>
      </div>

      {documents.length > 0 && (
        <div className="mt-5 print:hidden">
          <h3 className="text-sm font-semibold">{t("packView.documentsTitle")}</h3>
          <ul className="mt-2 space-y-1">
            {documents.map((doc) => (
              <li key={doc.fileId}>
                <a
                  href={`/api/files/${doc.fileId}`}
                  className="flex items-center gap-2 text-sm underline-offset-2 hover:underline"
                >
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{doc.filename}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {actions}
    </li>
  );
}

function DecisionPackPage() {
  const { t, i18n } = useTranslation();
  // Cast like the dossier and the report beside it: a loader that can throw
  // a redirect is typed loosely by the router.
  const data = Route.useLoaderData() as BuyerPackData;
  const { pack } = data;
  const router = useRouter();
  const refresh = () => void router.invalidate();
  const stateOf = (item: PackItemView): PackOfferState =>
    (item.quoteId && data.offers[item.quoteId]) || "unavailable";
  const accepted = pack.items.find((item) => stateOf(item) === "accepted");

  return (
    <div className="space-y-6 pt-6 print:space-y-4 print:pt-0">
      {/* Screen-only controls — never part of the printed document. */}
      <header className="flex items-center justify-between gap-4 print:hidden">
        <Link
          to="/demandes/$id"
          params={{ id: data.requestId }}
          className="flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> {t("detail.back")}
        </Link>
        <Button variant="outline" size="sm" onClick={() => window.print()}>
          <Download className="size-4" /> {t("packView.print")}
        </Button>
      </header>

      {data.preview && (
        <p
          role="status"
          className="rounded-lg border border-border bg-secondary/40 px-4 py-2 text-xs print:hidden"
        >
          {t("packView.preview")}
        </p>
      )}

      <div>
        <p className="text-xs uppercase tracking-widest text-muted-foreground">
          {t("packView.kicker", { id: data.requestId })}
        </p>
        <h1 className="mt-1 font-display text-2xl font-semibold">{data.requestTitle}</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          {/* "after review by our team" only when somebody did review it:
              a pack the system released (V14) says what is true of it. */}
          {t(pack.reviewed ? "packView.intro" : "packView.introAutomatic", {
            count: pack.items.length,
          })}
          {pack.releasedAt &&
            ` ${t("packView.sentOn", { date: formatDayTime(pack.releasedAt, i18n.language, { month: "long" }) })}`}
        </p>
      </div>

      {accepted && (
        <p
          role="status"
          className="flex items-start gap-3 rounded-xl border border-success/40 bg-success/5 p-4 text-sm"
        >
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" />
          <span>
            {t("packView.acceptedBanner", { supplier: accepted.offer.supplierName })}{" "}
            <Link
              to="/demandes/$id"
              params={{ id: data.requestId }}
              className="font-medium underline underline-offset-2"
            >
              {t("packView.acceptedLink")}
            </Link>
          </span>
        </p>
      )}
      {/* The request is being solicited again: what is on screen is the pack
          as it was sent, and a new one is on its way. */}
      {!data.current && !accepted && (
        <p role="status" className="rounded-xl border border-border bg-secondary/40 p-4 text-sm">
          {t("packView.reopened")}
        </p>
      )}

      <ol className="space-y-4">
        {pack.items.map((item) => (
          <Offer
            key={item.quoteId ?? `${item.rank}-${item.offer.supplierName}`}
            item={item}
            shown={pack.items.map((other) => other.offer)}
            documents={item.quoteId ? (data.documents[item.quoteId] ?? []) : []}
            state={stateOf(item)}
            actions={
              data.canAct && data.current && !accepted ? (
                <OfferActions item={item} state={stateOf(item)} onChanged={refresh} />
              ) : null
            }
          />
        ))}
      </ol>
    </div>
  );
}
