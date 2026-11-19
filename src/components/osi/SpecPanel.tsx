import { useState } from "react";
import { Check, ClipboardList, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatDayTime } from "@/lib/instant";
import { specCriterionLine } from "@/lib/request-spec";
import { getRequestSpecFn, type SpecView } from "@/lib/spec-fns";
import { cn } from "@/lib/utils";

/**
 * The cahier des charges (Phase V · V19): what a supplier is asked to quote
 * against, as a recorded version — and the weights the rankings use.
 *
 * Read-only. Earlier versions stay readable from the version buttons: that
 * is the point of keeping them. Validating and adjusting comes with V20.
 */
export function SpecPanel({
  requestId,
  initial,
  showOfferWeights,
  validated,
}: {
  requestId: string;
  initial: SpecView;
  showOfferWeights: boolean;
  /** The buyer's validation (V20): when, by whom, and of which version. */
  validated: { at: string; byName: string | null; specVersion: number } | null;
}) {
  const { t, i18n } = useTranslation();
  // The loader's copy is the LATEST version. If the buyer browses an older
  // one it is held here until they return to the latest — at which point the
  // loader's copy is shown again, so a new version made meanwhile appears.
  const [older, setOlder] = useState<SpecView | null>(null);
  const [loading, setLoading] = useState<number | null>(null);
  const latest = initial.version;
  const spec = older ?? initial;

  const show = async (version: number) => {
    if (version === spec.version || loading !== null) return;
    if (version === latest) {
      setOlder(null);
      return;
    }
    setLoading(version);
    try {
      const fetched = await getRequestSpecFn({ data: { requestId, version } });
      if (fetched) setOlder(fetched);
    } finally {
      setLoading(null);
    }
  };

  const { content, profile } = spec;
  return (
    <section className="card-surface overflow-hidden">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-6 py-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <ClipboardList className="size-4 text-gold" /> {t("spec.title")}
        </h2>
        <span className="text-xs text-muted-foreground">
          {t("spec.version", { version: spec.version })}
        </span>
      </div>

      <div className="space-y-5 p-6">
        {initial.versions.length > 1 && (
          <div className="flex flex-wrap items-center gap-2">
            {initial.versions.map((v) => (
              <button
                key={v.version}
                type="button"
                onClick={() => void show(v.version)}
                aria-pressed={v.version === spec.version}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs transition-colors",
                  v.version === spec.version
                    ? "border-gold bg-gold-soft font-semibold text-gold"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {loading === v.version && <Loader2 className="mr-1 inline size-3 animate-spin" />}
                {t("spec.versionShort", { version: v.version })}
              </button>
            ))}
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          {spec.createdByName
            ? t("spec.madeBy", {
                when: formatDayTime(spec.createdAt, i18n.language),
                name: spec.createdByName,
              })
            : t("spec.madeBySystem", { when: formatDayTime(spec.createdAt, i18n.language) })}
          {spec.version !== latest && <> · {t("spec.superseded", { version: latest })}</>}
        </p>

        {/* Said on the version it applies to, and only there: version 2, made
            later by the platform from an attachment, was not validated. */}
        {validated && validated.specVersion === spec.version && (
          <p className="flex items-center gap-2 text-xs font-medium text-success">
            <Check className="size-3.5 shrink-0" />
            {validated.byName
              ? t("spec.validatedBy", {
                  when: formatDayTime(validated.at, i18n.language),
                  name: validated.byName,
                })
              : t("spec.validatedOn", { when: formatDayTime(validated.at, i18n.language) })}
          </p>
        )}
        {validated && validated.specVersion !== spec.version && spec.version === latest && (
          <p className="text-xs text-muted-foreground">
            {t("spec.validatedOther", { version: validated.specVersion })}
          </p>
        )}

        <div>
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t("spec.need")}
          </h3>
          <p className="mt-1 text-sm font-medium">{content.title}</p>
        </div>

        {content.criteria.length > 0 && (
          <div>
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("spec.specifications")}
            </h3>
            <ul className="mt-2 space-y-1.5">
              {content.criteria.map((criterion) => (
                <li
                  key={criterion.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 text-sm"
                >
                  <span className="min-w-0">
                    {specCriterionLine(criterion)}
                    {criterion.required && (
                      <span className="ml-2 rounded-full bg-gold-soft px-1.5 py-0.5 text-[10px] font-semibold text-gold">
                        {t("spec.required")}
                      </span>
                    )}
                  </span>
                  {/* The weight belongs to the LATEST profile; a criterion of an
                      older version may no longer be in it, hence the guard. */}
                  {profile && spec.version === latest && profile.criteria[criterion.id] && (
                    <span className="text-xs text-muted-foreground">
                      {t("spec.weight", { weight: profile.criteria[criterion.id] })}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {content.description && (
          <div>
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("spec.description")}
            </h3>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed">
              {content.description}
            </p>
          </div>
        )}

        {content.attachments > 0 && (
          <p className="text-xs text-muted-foreground">
            {t("spec.attachments", { count: content.attachments })}
          </p>
        )}

        {profile && showOfferWeights && spec.version === latest && (
          <div className="rounded-lg bg-secondary/60 p-4">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("spec.profileTitle", { version: profile.version })}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {t(`spec.profileSource.${profile.source}`)}
            </p>
            <ul className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              {profile.offers.map(({ factor, weight }) => (
                <li
                  key={factor}
                  className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 text-muted-foreground"
                >
                  <span>{t(`spec.factor.${factor}`)}</span>
                  <span className="font-medium text-foreground">{weight}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
