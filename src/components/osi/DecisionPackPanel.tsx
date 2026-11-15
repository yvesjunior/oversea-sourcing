// The Decision Pack as it stands — staff only (Phase V · V10).
//
// What the buyer WILL be shown once the pack is released: which offers, in
// which order, with the figures as the pack holds them (a frozen copy, not
// the live quote). While it is pending it follows the round, so this panel
// and the ranking above it can only disagree for the instant between the two
// writes. The four things staff can do with it — approve, correct, relaunch,
// refuse — arrive with the release queue (V11); this is the reading side.

import { useTranslation } from "react-i18next";
import { PackageOpen } from "lucide-react";
import { formatDayTime, formatInstant } from "@/lib/instant";
import type { PackItemView, RequestPackView } from "@/lib/pack-fns";
import { cn } from "@/lib/utils";

const STATUS_STYLE: Record<string, string> = {
  pending: "border-gold/50 bg-gold-soft text-gold",
  released: "border-success/50 text-success",
  refused: "border-border text-muted-foreground",
};

function money(cents: number | null, currency: string | null, lang: string): string {
  if (cents === null) return "—";
  const value = cents / 100;
  // In the currency it was quoted in — never converted (ADR-002).
  return currency
    ? new Intl.NumberFormat(lang, { style: "currency", currency }).format(value)
    : value.toLocaleString(lang);
}

function ItemRow({ item }: { item: PackItemView }) {
  const { t, i18n } = useTranslation();
  const { offer } = item;
  const moved = item.rankComputed !== undefined && item.rankComputed !== item.rank;
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-3 rounded-lg border border-border p-3">
      <span className="text-sm font-semibold tabular-nums text-muted-foreground">#{item.rank}</span>
      <div className="min-w-0">
        <span className="block truncate text-sm font-semibold">{offer.supplierName}</span>
        <span className="block text-xs text-muted-foreground">
          {[
            money(offer.amountCents, offer.currency, i18n.language),
            offer.leadTimeDays !== null ? t("ranking.days", { count: offer.leadTimeDays }) : null,
            offer.incoterm,
            offer.paymentTerms,
            offer.validUntil
              ? t("ranking.validUntil", {
                  date: formatInstant(offer.validUntil, i18n.language, {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  }),
                })
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
        {/* Only once a person has moved it (V11): the computed place beside
            the shown one — never sent to the buyer. */}
        {moved && (
          <span className="block text-[11px] text-warning">
            {t("pack.movedFrom", { rank: item.rankComputed })}
          </span>
        )}
      </div>
      {offer.channel && (
        <span
          title={t(`soumissions.channelHint.${offer.channel}`)}
          className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
        >
          {t(`soumissions.channel.${offer.channel}`)}
        </span>
      )}
    </li>
  );
}

export function DecisionPackPanel({ data }: { data: RequestPackView }) {
  const { t, i18n } = useTranslation();
  const { pack, offersInRound, targetOffers } = data;
  const left = offersInRound - pack.items.length;

  return (
    <section className="card-surface p-6">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <PackageOpen className="size-4 text-muted-foreground" />
            {t("pack.title")}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">{t(`pack.subtitle.${pack.status}`)}</p>
        </div>
        <span
          className={cn(
            "rounded-full border px-2.5 py-0.5 text-[11px] font-semibold",
            STATUS_STYLE[pack.status],
          )}
        >
          {t(`pack.status.${pack.status}`)}
        </span>
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        {t("pack.built", { date: formatDayTime(pack.builtAt, i18n.language) })}
        {pack.internal && (
          <>
            {" · "}
            {t("pack.mode", {
              mode: t(`platformSettings.options.${pack.internal.releaseMode}`).toLowerCase(),
            })}
          </>
        )}
      </p>

      {pack.items.length === 0 ? (
        <p className="mt-3 rounded-lg bg-secondary/40 px-3 py-2 text-sm">{t("pack.empty")}</p>
      ) : (
        <ol className="mt-3 space-y-2">
          {pack.items.map((item) => (
            <ItemRow key={item.quoteId ?? `${item.rank}-${item.offer.supplierName}`} item={item} />
          ))}
        </ol>
      )}

      {left > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          {t("pack.capped", { left, target: targetOffers })}
        </p>
      )}
    </section>
  );
}
