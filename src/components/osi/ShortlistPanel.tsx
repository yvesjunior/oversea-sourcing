// The internal shortlist, on the dossier — staff only (Phase V · V05).
//
// KPI #1's ranking with the reason for each rank, who an RFQ would go to, and
// the one decision this stage holds: who is asked. Confirming sends nothing.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, BadgeCheck, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CountryTag } from "@/components/osi/CountryTag";
import { SupplierContactsDialog } from "@/components/osi/SupplierContactsDialog";
import {
  confirmShortlistFn,
  type BreakdownView,
  type ShortlistCandidate,
  type ShortlistData,
} from "@/lib/shortlist-fns";
import { cn } from "@/lib/utils";

const OUTCOME_STYLE: Record<BreakdownView["criteria"][number]["outcome"], string> = {
  matched: "border-success/50 bg-success/10 text-success",
  partial: "border-warning/60 bg-warning/10 text-foreground",
  missed: "border-destructive/50 bg-destructive/10 text-destructive",
  unverifiable: "border-border bg-secondary text-muted-foreground",
};

function Breakdown({ breakdown }: { breakdown: BreakdownView | null }) {
  const { t } = useTranslation();
  if (!breakdown) {
    return <p className="mt-2 text-xs text-muted-foreground">{t("shortlist.noBreakdown")}</p>;
  }
  const points: [string, number][] = [
    [t("shortlist.points.criteria"), breakdown.criteriaPoints],
    [t("shortlist.points.confidence"), breakdown.confidencePoints],
    [t("shortlist.points.verification"), breakdown.verificationPoints],
    [t("shortlist.points.risk"), -breakdown.riskPenalty],
    // What the supplier's closed deals moved the score by (V31).
    [t("shortlist.points.performance"), breakdown.performancePoints],
  ];
  return (
    <div className="mt-2 space-y-2">
      <p className="text-xs text-muted-foreground">
        {t("shortlist.criteriaCoverage", {
          matched: breakdown.matchedCount,
          checkable: breakdown.checkableCount,
        })}
        {" · "}
        {points
          .filter(([, value]) => value !== 0)
          .map(([label, value]) => `${label} ${value > 0 ? "+" : ""}${value}`)
          .join(" · ")}
      </p>
      {/* WHY the history moved the score: each fact with its points. */}
      {breakdown.performance.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {t("shortlist.history")}{" "}
          {breakdown.performance
            .map((reason) =>
              t(`shortlist.reason.${reason.key}`, {
                count:
                  reason.key === "late"
                    ? reason.deals
                    : reason.key === "disputed"
                      ? reason.issues
                      : 0,
                average: reason.key === "satisfaction" ? reason.average : 0,
                points: `${reason.points > 0 ? "+" : ""}${reason.points}`,
              }),
            )
            .join(" · ")}
        </p>
      )}
      <ul className="flex flex-wrap gap-1.5">
        {breakdown.criteria.map((criterion) => (
          <li
            key={`${criterion.label}-${criterion.value}`}
            className={cn(
              "rounded-full border px-2 py-0.5 text-[11px]",
              OUTCOME_STYLE[criterion.outcome],
            )}
          >
            {criterion.label}
            {criterion.value ? `: ${criterion.value}` : ""} —{" "}
            {t(`shortlist.outcome.${criterion.outcome}`)}
            {criterion.required ? ` (${t("shortlist.required")})` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ShortlistPanel({
  shortlist,
  onChanged,
}: {
  shortlist: ShortlistData;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const alreadyChosen = shortlist.candidates.filter((c) => c.quote !== null);
  // Nothing confirmed yet → the whole ranking is proposed, and staff untick.
  // Once confirmed, the boxes show what was actually decided.
  const [picked, setPicked] = useState<string[]>(
    (alreadyChosen.length > 0 ? alreadyChosen : shortlist.candidates).map((c) => c.supplierId),
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [contactsOf, setContactsOf] = useState<ShortlistCandidate | null>(null);

  const toggle = (supplierId: string) =>
    setPicked((current) =>
      current.includes(supplierId)
        ? current.filter((id) => id !== supplierId)
        : [...current, supplierId],
    );

  const confirm = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await confirmShortlistFn({
        data: { requestId: shortlist.requestId, supplierIds: picked },
      });
      if (!result.ok) {
        setMessage({ text: t(`shortlist.problem.${result.reason}`), error: true });
        return;
      }
      setMessage({
        text: t("shortlist.confirmed", {
          selected: result.selected,
          added: result.added,
          removed: result.removed,
        }),
        error: false,
      });
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card-surface p-6">
      <h2 className="text-base font-semibold">{t("shortlist.title")}</h2>
      <p className="mt-1 text-xs text-muted-foreground">{t("shortlist.subtitle")}</p>

      <ul className="mt-5 space-y-3">
        {shortlist.candidates.map((candidate) => {
          // A solicitation that has left cannot be withdrawn by un-ticking.
          const locked = candidate.quote !== null && candidate.quote.sent;
          return (
            <li key={candidate.supplierId} className="rounded-lg border border-border p-4">
              <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1 size-4 accent-[var(--gold)]"
                  checked={picked.includes(candidate.supplierId)}
                  disabled={!shortlist.canConfirm || locked || busy}
                  onChange={() => toggle(candidate.supplierId)}
                  aria-label={candidate.name}
                />
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                    <span className="text-muted-foreground">#{candidate.rank}</span>
                    <span className="truncate">{candidate.name}</span>
                    {candidate.verificationStatus === "verified" && (
                      <BadgeCheck
                        className="size-4 shrink-0 text-success"
                        aria-label={t("verification.verified")}
                      />
                    )}
                    {locked && (
                      <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {t("shortlist.alreadySent")}
                      </span>
                    )}
                  </p>
                  {candidate.descriptor && (
                    <p className="truncate text-xs text-muted-foreground">{candidate.descriptor}</p>
                  )}
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                    {candidate.contactEmail ? (
                      <>
                        <span className="text-muted-foreground">{t("shortlist.contact")}</span>
                        <span className="font-medium">{candidate.contactEmail}</span>
                      </>
                    ) : (
                      <span className="flex items-center gap-1 text-warning">
                        <AlertTriangle className="size-3.5" />
                        {t("shortlist.noContact")}
                      </span>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 px-2 text-[11px]"
                      onClick={() => setContactsOf(candidate)}
                    >
                      <Mail className="size-3" />
                      {t("shortlist.manageContacts")}
                    </Button>
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <CountryTag code={candidate.countryCode} />
                  <span className="text-xs text-muted-foreground">
                    {t("shortlist.score")}{" "}
                    <span className="text-sm font-semibold text-foreground">{candidate.score}</span>
                    {" · "}
                    {t("shortlist.confidence")} {candidate.confidence}
                  </span>
                </div>
              </div>

              <details className="mt-3 rounded-lg bg-secondary/40 p-3">
                <summary className="cursor-pointer text-xs font-medium">
                  {t("shortlist.why")}
                </summary>
                <Breakdown breakdown={candidate.breakdown} />
              </details>
            </li>
          );
        })}
      </ul>

      {shortlist.canConfirm ? (
        <div className="mt-5 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-lg border border-border bg-secondary/40 px-4 py-3">
          <p
            role={message?.error ? "alert" : undefined}
            className={cn(
              "min-w-0 text-xs",
              message?.error ? "font-medium text-destructive" : "text-muted-foreground",
            )}
          >
            {message?.text ?? t("shortlist.confirmHint")}
          </p>
          <Button
            variant="gold"
            size="sm"
            disabled={busy || picked.length === 0}
            onClick={() => void confirm()}
          >
            {t("shortlist.confirm", { count: picked.length })}
          </Button>
        </div>
      ) : (
        <p className="mt-5 rounded-lg bg-secondary px-3 py-2 text-xs text-muted-foreground">
          {t("shortlist.readOnly")}
        </p>
      )}

      <SupplierContactsDialog
        supplier={contactsOf ? { id: contactsOf.supplierId, name: contactsOf.name } : null}
        onClose={() => setContactsOf(null)}
        onChanged={onChanged}
      />
    </section>
  );
}
