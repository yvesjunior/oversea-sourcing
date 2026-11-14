// The ranking of the offers a round closed with — KPI #2, staff only (Phase V
// · V09).
//
// It shows the order, and for each offer WHY: every factor says whether it
// was compared and what it earned. A score with no reason behind it is no use
// to the person who will have to defend the pack to a buyer. It also shows
// what was deliberately NOT compared — prices in different currencies — in
// words, because a missing factor reads as an oversight unless the page says
// it is a rule.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDayTime, formatInstant } from "@/lib/instant";
import {
  recomputeOfferRankingFn,
  type OfferRankingView,
  type RankedOfferView,
  type RankingRunView,
} from "@/lib/kpi-fns";
import { KPI2_FACTORS, type Kpi2Note } from "@/lib/kpi2";
import { cn } from "@/lib/utils";

/** Notes that describe the RUN (every offer carries them), shown once above
 *  the list rather than on each row. */
const RUN_NOTES: readonly Kpi2Note[] = ["mixed_currencies", "mixed_incoterms"];

function money(cents: number | null, currency: string | null, lang: string): string {
  if (cents === null) return "—";
  const value = cents / 100;
  // Shown in the currency it was quoted in — never converted (ADR-002).
  return currency
    ? new Intl.NumberFormat(lang, { style: "currency", currency }).format(value)
    : value.toLocaleString(lang);
}

function OfferRow({ offer }: { offer: RankedOfferView }) {
  const { t, i18n } = useTranslation();
  const { inputs, factors, notes } = offer.breakdown;
  const ownNotes = notes.filter((note) => !RUN_NOTES.includes(note));

  return (
    <li className="rounded-lg border border-border p-4">
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-3">
        <span className="text-sm font-semibold tabular-nums text-muted-foreground">
          #{offer.rank}
        </span>
        <span className="truncate text-sm font-semibold">{offer.supplierName}</span>
        <span className="text-sm font-semibold tabular-nums">
          {offer.score.toLocaleString(i18n.language, { maximumFractionDigits: 2 })}
          <span className="text-xs font-normal text-muted-foreground"> / 100</span>
        </span>
      </div>

      {/* What the supplier stated — the figures the factors were scored on. */}
      <p className="mt-1 text-xs text-muted-foreground">
        {[
          money(inputs.amountCents, inputs.currency, i18n.language),
          inputs.leadTimeDays !== null ? t("ranking.days", { count: inputs.leadTimeDays }) : null,
          inputs.incoterm,
          inputs.validUntil
            ? t("ranking.validUntil", {
                date: formatInstant(inputs.validUntil, i18n.language, {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                }),
              })
            : null,
          inputs.moq ? t("ranking.moq", { moq: inputs.moq }) : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>

      <ul className="mt-3 flex flex-wrap gap-1.5">
        {KPI2_FACTORS.map((key) => {
          const factor = factors[key];
          const compared = factor.points !== null;
          return (
            <li
              key={key}
              title={t(`ranking.state.${factor.state}`)}
              className={cn(
                "rounded-full border px-2 py-0.5 text-[11px]",
                compared && factor.state === "scored"
                  ? "border-border"
                  : "border-dashed border-border text-muted-foreground",
              )}
            >
              <span className="text-muted-foreground">{t(`ranking.factor.${key}`)} </span>
              {factor.state === "scored" ? (
                <span className="font-semibold tabular-nums">
                  {Math.round(factor.points ?? 0)}
                  <span className="font-normal text-muted-foreground"> × {factor.weight}</span>
                </span>
              ) : (
                <span>{t(`ranking.stateShort.${factor.state}`)}</span>
              )}
            </li>
          );
        })}
      </ul>

      {ownNotes.length > 0 && (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-warning">
          <AlertTriangle className="size-3.5 shrink-0" />
          {ownNotes.map((note) => t(`ranking.note.${note}`)).join(" ")}
        </p>
      )}
    </li>
  );
}

function runNotes(run: RankingRunView): Kpi2Note[] {
  const all = new Set(run.offers.flatMap((offer) => offer.breakdown.notes));
  return RUN_NOTES.filter((note) => all.has(note));
}

export function OfferRankingPanel({
  ranking,
  onChanged,
}: {
  ranking: OfferRankingView;
  onChanged: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const { current, earlier } = ranking;

  const recompute = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const outcome = await recomputeOfferRankingFn({ data: { roundId: ranking.roundId } });
      if (!outcome.ok) {
        setMessage({ text: t(`ranking.refusal.${outcome.reason}`), error: true });
        return;
      }
      setMessage({
        text: t(outcome.written ? "ranking.recomputed" : "ranking.unchanged"),
        error: false,
      });
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card-surface p-6">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{t("ranking.title")}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{t("ranking.subtitle")}</p>
        </div>
        {ranking.canRecompute && ranking.offersNow > 0 && (
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void recompute()}>
            <RefreshCw className="size-4" />
            {t("ranking.recompute")}
          </Button>
        )}
      </div>

      {message && (
        <p
          role={message.error ? "alert" : undefined}
          className={cn(
            "mt-3 text-xs",
            message.error ? "font-medium text-destructive" : "text-muted-foreground",
          )}
        >
          {message.text}
        </p>
      )}

      {current ? (
        <>
          <p className="mt-4 text-xs text-muted-foreground">
            {t("ranking.computed", {
              date: formatDayTime(current.computedAt, i18n.language),
              trigger: t(`ranking.trigger.${current.trigger}`),
              version: current.formulaVersion,
            })}
          </p>
          {ranking.stale && (
            <p role="alert" className="mt-2 flex items-center gap-1.5 text-xs text-warning">
              <AlertTriangle className="size-3.5 shrink-0" />
              {t("ranking.stale")}
            </p>
          )}
          {runNotes(current).map((note) => (
            <p key={note} className="mt-2 rounded-lg bg-secondary/40 px-3 py-2 text-xs">
              {t(`ranking.note.${note}`)}
            </p>
          ))}
          <ol className="mt-3 space-y-2">
            {current.offers.map((offer) => (
              <OfferRow key={offer.quoteId} offer={offer} />
            ))}
          </ol>
        </>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">
          {t(ranking.offersNow === 0 ? "ranking.noOffers" : "ranking.notComputed")}
        </p>
      )}

      {earlier.length > 0 && (
        <details className="mt-4 rounded-lg border border-border bg-secondary/30 p-3">
          <summary className="cursor-pointer text-xs font-medium">
            {t("ranking.earlier", { count: earlier.length })}
          </summary>
          <ul className="mt-3 space-y-3">
            {earlier.map((run) => (
              <li key={run.runId} className="text-xs">
                <p className="text-muted-foreground">
                  {t("ranking.computed", {
                    date: formatDayTime(run.computedAt, i18n.language),
                    trigger: t(`ranking.trigger.${run.trigger}`),
                    version: run.formulaVersion,
                  })}
                </p>
                <p className="mt-1">
                  {run.offers
                    .map(
                      (offer) =>
                        `${offer.rank}. ${offer.supplierName} (${offer.score.toLocaleString(
                          i18n.language,
                          { maximumFractionDigits: 2 },
                        )})`,
                    )
                    .join(" · ")}
                </p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
