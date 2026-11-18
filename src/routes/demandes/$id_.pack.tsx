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
// Read-only for now: choosing an offer from here is V13. A `viewer` seat
// reads everything on this page; choosing will not be theirs.

import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Download, FileText, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CountryTag } from "@/components/osi/CountryTag";
import { formatDayTime, formatInstant } from "@/lib/instant";
import { explainOffer, landedCostLines } from "@/lib/pack-explain";
import {
  getRequestPackFn,
  type BuyerPackData,
  type PackDocument,
  type PackItemView,
  type PackOfferSnapshot,
} from "@/lib/pack-fns";
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

function Offer({
  item,
  shown,
  documents,
}: {
  item: PackItemView;
  /** Every offer on this page — what this one is compared with. */
  shown: PackOfferSnapshot[];
  documents: PackDocument[];
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
            <div key={line.key} className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 py-1.5">
              <dt>{t(`packView.cost.${line.key}`)}</dt>
              <dd
                className={cn(
                  "text-right",
                  line.state === "stated" && "font-semibold",
                  line.state === "not_provided" && "text-warning",
                  line.state === "applies_unquoted" && "text-muted-foreground",
                )}
              >
                {line.key === "goods" && line.state === "stated"
                  ? price
                  : t(`packView.costState.${line.state}`, { incoterm: offer.incoterm ?? "" })}
              </dd>
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
    </li>
  );
}

function DecisionPackPage() {
  const { t, i18n } = useTranslation();
  // Cast like the dossier and the report beside it: a loader that can throw
  // a redirect is typed loosely by the router.
  const data = Route.useLoaderData() as BuyerPackData;
  const { pack } = data;

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
          {t("packView.intro", { count: pack.items.length })}
          {pack.releasedAt &&
            ` ${t("packView.sentOn", { date: formatDayTime(pack.releasedAt, i18n.language, { month: "long" }) })}`}
        </p>
      </div>

      <ol className="space-y-4">
        {pack.items.map((item) => (
          <Offer
            key={item.quoteId ?? `${item.rank}-${item.offer.supplierName}`}
            item={item}
            shown={pack.items.map((other) => other.offer)}
            documents={item.quoteId ? (data.documents[item.quoteId] ?? []) : []}
          />
        ))}
      </ol>
    </div>
  );
}
